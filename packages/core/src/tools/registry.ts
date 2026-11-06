import fs from 'node:fs/promises';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { ToolDefinition } from '../models/types.js';

const execAsync = promisify(exec);

export interface ToolExecutionContext {
  workingDirectory: string;
  env?: Record<string, string>;
  timeoutMs?: number;
}

export interface ToolResult {
  toolName: string;
  success: boolean;
  output: string;
  error?: string;
  executionTimeMs: number;
}

export type ToolHandler = (args: any, context: ToolExecutionContext) => Promise<string>;

export interface RegisteredTool {
  definition: ToolDefinition;
  handler: ToolHandler;
}

export class ToolRegistry {
  private tools: Map<string, RegisteredTool> = new Map();

  constructor() {
    this.registerDefaultTools();
  }

  public register(tool: RegisteredTool): void {
    this.tools.set(tool.definition.name, tool);
  }

  public getTool(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  public getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  public async execute(
    name: string,
    args: Record<string, any>,
    context: ToolExecutionContext
  ): Promise<ToolResult> {
    const startTime = Date.now();
    const tool = this.tools.get(name);

    if (!tool) {
      return {
        toolName: name,
        success: false,
        output: '',
        error: `Tool not found: ${name}`,
        executionTimeMs: Date.now() - startTime,
      };
    }

    try {
      const output = await tool.handler(args, context);
      return {
        toolName: name,
        success: true,
        output,
        executionTimeMs: Date.now() - startTime,
      };
    } catch (err: any) {
      return {
        toolName: name,
        success: false,
        output: '',
        error: err?.message || String(err),
        executionTimeMs: Date.now() - startTime,
      };
    }
  }

  private registerDefaultTools(): void {
    // 1. Bash / Shell command execution
    this.register({
      definition: {
        name: 'execute_command',
        description: 'Execute a cross-platform bash/cmd/PowerShell command in the sandbox environment.',
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The shell command to run.',
            },
          },
          required: ['command'],
        },
      },
      handler: async (args, context) => {
        const { stdout, stderr } = await execAsync(args.command, {
          cwd: context.workingDirectory,
          timeout: context.timeoutMs ?? 30000,
          env: { ...process.env, ...context.env },
        });
        return stdout ? stdout : stderr || '(command finished with no output)';
      },
    });

    // 2. Read file
    this.register({
      definition: {
        name: 'read_file',
        description: 'Read the contents of a file at the specified path.',
        parameters: {
          type: 'object',
          properties: {
            filepath: {
              type: 'string',
              description: 'Relative or absolute path of the file to read.',
            },
          },
          required: ['filepath'],
        },
      },
      handler: async (args, context) => {
        const targetPath = path.isAbsolute(args.filepath)
          ? args.filepath
          : path.resolve(context.workingDirectory, args.filepath);
        return await fs.readFile(targetPath, 'utf-8');
      },
    });

    // 3. Write file
    this.register({
      definition: {
        name: 'write_file',
        description: 'Write content to a file at the specified path.',
        parameters: {
          type: 'object',
          properties: {
            filepath: {
              type: 'string',
              description: 'Relative or absolute path of the file to write.',
            },
            content: {
              type: 'string',
              description: 'Text content to write into the file.',
            },
          },
          required: ['filepath', 'content'],
        },
      },
      handler: async (args, context) => {
        const targetPath = path.isAbsolute(args.filepath)
          ? args.filepath
          : path.resolve(context.workingDirectory, args.filepath);
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, args.content, 'utf-8');
        return `Successfully wrote ${args.content.length} characters to ${args.filepath}`;
      },
    });

    // 4. List files
    this.register({
      definition: {
        name: 'list_files',
        description: 'List files and directories under the given directory path.',
        parameters: {
          type: 'object',
          properties: {
            dirpath: {
              type: 'string',
              description: 'Directory path to list (defaults to current working directory).',
            },
          },
        },
      },
      handler: async (args, context) => {
        const targetPath = args.dirpath
          ? path.isAbsolute(args.dirpath)
            ? args.dirpath
            : path.resolve(context.workingDirectory, args.dirpath)
          : context.workingDirectory;
        const entries = await fs.readdir(targetPath, { withFileTypes: true });
        return entries
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .sort()
          .join('\n');
      },
    });
  }
}
