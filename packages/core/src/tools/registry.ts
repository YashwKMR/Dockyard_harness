import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { ToolDefinition, ToolResult } from '../models/types.js';

const execAsync = promisify(exec);

export interface ToolExecutionContext {
  workspaceRoot: string;
  requireApproval?: (toolName: string, args: Record<string, any>) => Promise<boolean>;
}

export interface ToolHandler {
  definition: ToolDefinition;
  execute(args: Record<string, any>, context: ToolExecutionContext): Promise<ToolResult>;
}

export class ToolRegistry {
  private tools = new Map<string, ToolHandler>();

  register(tool: ToolHandler) {
    this.tools.set(tool.definition.name, tool);
  }

  get(name: string): ToolHandler | undefined {
    return this.tools.get(name);
  }

  listDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  async execute(name: string, args: Record<string, any>, context: ToolExecutionContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        callId: args._callId || '',
        output: '',
        error: `Tool "${name}" not found in registry.`,
        isError: true
      };
    }

    if (context.requireApproval) {
      const approved = await context.requireApproval(name, args);
      if (!approved) {
        return {
          callId: args._callId || '',
          output: '',
          error: `Execution of tool "${name}" was rejected by user policy or approval checkpoint.`,
          isError: true
        };
      }
    }

    try {
      return await tool.execute(args, context);
    } catch (err: any) {
      return {
        callId: args._callId || '',
        output: '',
        error: err.message || String(err),
        isError: true
      };
    }
  }
}

function resolveSafePath(workspaceRoot: string, relativePath: string): string {
  // Normalize both POSIX and Windows separators
  const normalizedRel = relativePath.replace(/\\/g, '/');
  const full = path.resolve(workspaceRoot, normalizedRel);
  const normalizedRoot = path.resolve(workspaceRoot);
  // Ensure case-insensitive check on Windows or normal prefix check
  if (process.platform === 'win32') {
    if (!full.toLowerCase().startsWith(normalizedRoot.toLowerCase())) {
      throw new Error(`Access outside workspace root is forbidden: ${relativePath}`);
    }
  } else {
    if (!full.startsWith(normalizedRoot)) {
      throw new Error(`Access outside workspace root is forbidden: ${relativePath}`);
    }
  }
  return full;
}

export function createStandardTools(): ToolRegistry {
  const registry = new ToolRegistry();

  // 1. Read File (Cross-platform path resolution)
  registry.register({
    definition: {
      name: 'read_file',
      description: 'Read the text contents of a file within the workspace (supports Windows and macOS paths).',
      parameters: {
        type: 'object',
        properties: {
          filepath: { type: 'string', description: 'Relative path to file from workspace root.' }
        },
        required: ['filepath']
      }
    },
    async execute(args, context) {
      try {
        const fullPath = resolveSafePath(context.workspaceRoot, args.filepath);
        const content = await fs.readFile(fullPath, 'utf-8');
        return { callId: args._callId, output: content };
      } catch (e: any) {
        return { callId: args._callId, output: '', error: `Cannot read file: ${e.message}`, isError: true };
      }
    }
  });

  // 2. Write File
  registry.register({
    definition: {
      name: 'write_file',
      description: 'Create or overwrite a file with given content.',
      parameters: {
        type: 'object',
        properties: {
          filepath: { type: 'string', description: 'Relative path to file.' },
          content: { type: 'string', description: 'Full text content to write.' }
        },
        required: ['filepath', 'content']
      }
    },
    async execute(args, context) {
      try {
        const fullPath = resolveSafePath(context.workspaceRoot, args.filepath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, args.content, 'utf-8');
        return { callId: args._callId, output: `Successfully wrote ${args.content.length} characters to ${args.filepath}` };
      } catch (e: any) {
        return { callId: args._callId, output: '', error: `Cannot write file: ${e.message}`, isError: true };
      }
    }
  });

  // 3. Edit with Git Merge Diff
  registry.register({
    definition: {
      name: 'edit_file_diff',
      description: 'Apply targeted search-and-replace edit to an existing file using <<<<<<< SEARCH, =======, >>>>>>> REPLACE block.',
      parameters: {
        type: 'object',
        properties: {
          filepath: { type: 'string', description: 'Relative path to file.' },
          diff: { type: 'string', description: 'Diff block with <<<<<<< SEARCH, =======, >>>>>>> REPLACE' }
        },
        required: ['filepath', 'diff']
      }
    },
    async execute(args, context) {
      try {
        const fullPath = resolveSafePath(context.workspaceRoot, args.filepath);
        let fileContent = await fs.readFile(fullPath, 'utf-8');
        const diff = (args.diff as string).replace(/\r\n/g, '\n');
        fileContent = fileContent.replace(/\r\n/g, '\n');

        const searchMarker = '<<<<<<< SEARCH\n';
        const dividerMarker = '\n=======\n';
        const replaceMarker = '\n>>>>>>> REPLACE';

        const searchStart = diff.indexOf(searchMarker);
        const divider = diff.indexOf(dividerMarker, searchStart);
        const replaceEnd = diff.indexOf(replaceMarker, divider);

        if (searchStart === -1 || divider === -1 || replaceEnd === -1) {
          return { callId: args._callId, output: '', error: 'Invalid diff format. Expected SEARCH/REPLACE block.', isError: true };
        }

        const searchBlock = diff.substring(searchStart + searchMarker.length, divider);
        const replaceBlock = diff.substring(divider + dividerMarker.length, replaceEnd);

        if (!fileContent.includes(searchBlock)) {
          return { callId: args._callId, output: '', error: 'Search block not found in target file.', isError: true };
        }

        const newContent = fileContent.replace(searchBlock, replaceBlock);
        await fs.writeFile(fullPath, newContent, 'utf-8');
        return { callId: args._callId, output: `Successfully applied diff to ${args.filepath}` };
      } catch (e: any) {
        return { callId: args._callId, output: '', error: `Cannot edit file: ${e.message}`, isError: true };
      }
    }
  });

  // 4. Run Shell Command (cross-platform: Windows PowerShell / cmd or macOS/Linux bash/sh)
  registry.register({
    definition: {
      name: 'run_command',
      description: 'Execute a shell command (cross-platform on Windows PowerShell/CMD or macOS/Linux bash) with timeout.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute.' },
          timeoutMs: { type: 'number', description: 'Timeout in milliseconds (default: 30000).' }
        },
        required: ['command']
      }
    },
    async execute(args, context) {
      const timeout = args.timeoutMs || 30000;
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || '/bin/sh');

      try {
        const { stdout, stderr } = await execAsync(args.command, {
          cwd: context.workspaceRoot,
          timeout,
          shell,
          maxBuffer: 10 * 1024 * 1024
        });
        const combined = (stdout + (stderr ? `\nSTDERR:\n${stderr}` : '')).trim();
        return { callId: args._callId, output: combined || '(Command produced no output)' };
      } catch (err: any) {
        return {
          callId: args._callId,
          output: err.stdout || '',
          error: `Command failed: ${err.message}${err.stderr ? `\nSTDERR:\n${err.stderr}` : ''}`,
          isError: true
        };
      }
    }
  });

  // 5. List Files Tree
  registry.register({
    definition: {
      name: 'list_files',
      description: 'List directory entries or search for files matching a pattern.',
      parameters: {
        type: 'object',
        properties: {
          directory: { type: 'string', description: 'Directory path relative to workspace root (defaults to .)' },
          pattern: { type: 'string', description: 'Optional substring or extension pattern to filter.' }
        }
      }
    },
    async execute(args, context) {
      try {
        const targetDir = resolveSafePath(context.workspaceRoot, args.directory || '.');
        const files: string[] = [];
        async function walk(dir: string) {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const ent of entries) {
            if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'dist') continue;
            const full = path.join(dir, ent.name);
            const rel = path.relative(context.workspaceRoot, full).replace(/\\/g, '/');
            if (ent.isDirectory()) {
              await walk(full);
            } else {
              if (!args.pattern || rel.includes(args.pattern)) {
                files.push(rel);
              }
            }
          }
        }
        await walk(targetDir);
        return { callId: args._callId, output: files.slice(0, 200).join('\n') || '(no files found)' };
      } catch (e: any) {
        return { callId: args._callId, output: '', error: `Cannot list files: ${e.message}`, isError: true };
      }
    }
  });

  return registry;
}
