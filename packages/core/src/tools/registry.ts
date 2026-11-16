import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { ToolDefinition, ToolResult } from '../models/types.js';

const execAsync = promisify(exec);

/**
 * How much the agent is allowed to do without a human in the loop.
 * - read-only: tools that write files or run commands are refused.
 * - ask:       those tools run only after `requireApproval` returns true.
 * - auto:      everything runs unattended.
 */
export type PermissionMode = 'read-only' | 'ask' | 'auto';

/** read = inspects the workspace, write = changes files, exec = runs commands, meta = harness bookkeeping. */
export type ToolKind = 'read' | 'write' | 'exec' | 'meta';

const MODE_RANK: Record<PermissionMode, number> = { 'read-only': 0, ask: 1, auto: 2 };

export function isPermissionMode(value: unknown): value is PermissionMode {
  return value === 'read-only' || value === 'ask' || value === 'auto';
}

export function mostRestrictiveMode(a: PermissionMode, b: PermissionMode): PermissionMode {
  return MODE_RANK[a] <= MODE_RANK[b] ? a : b;
}

export interface ToolExecutionContext {
  workspaceRoot: string;
  /** Defaults to 'ask' when requireApproval is supplied, otherwise 'auto'. */
  mode?: PermissionMode;
  requireApproval?: (toolName: string, args: Record<string, any>) => Promise<boolean>;
  /** Tool output longer than this is truncated before it reaches the model. */
  maxOutputChars?: number;
}

export type ToolOutput = Omit<ToolResult, 'callId'> & { callId?: string };

export interface ToolHandler {
  definition: ToolDefinition;
  /** Tools without a kind are treated as 'exec' (the most restricted class). */
  kind?: ToolKind;
  execute(args: Record<string, any>, context: ToolExecutionContext): Promise<ToolOutput>;
}

export const DEFAULT_MAX_TOOL_OUTPUT_CHARS = 30_000;

export function truncateOutput(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const head = Math.floor(maxChars * 0.7);
  const tail = maxChars - head;
  const dropped = text.length - maxChars;
  return `${text.slice(0, head)}\n...[${dropped} characters truncated]...\n${text.slice(text.length - tail)}`;
}

export class ToolRegistry {
  private tools = new Map<string, ToolHandler>();

  register(tool: ToolHandler) {
    this.tools.set(tool.definition.name, tool);
  }

  get(name: string): ToolHandler | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  listDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  /** A new registry holding the same handlers, optionally limited to an allowlist of tool names. */
  subset(allow?: string[]): ToolRegistry {
    const copy = new ToolRegistry();
    for (const [name, tool] of this.tools) {
      if (!allow || allow.includes(name)) copy.register(tool);
    }
    return copy;
  }

  async execute(
    name: string,
    args: Record<string, any>,
    context: ToolExecutionContext,
    callId = ''
  ): Promise<ToolResult> {
    const fail = (error: string): ToolResult => ({ callId, output: '', error, isError: true });

    const tool = this.tools.get(name);
    if (!tool) {
      return fail(`Tool "${name}" not found in registry.`);
    }

    const safeArgs = args && typeof args === 'object' ? args : {};
    for (const required of tool.definition.parameters.required || []) {
      if (safeArgs[required] === undefined || safeArgs[required] === null) {
        return fail(`Tool "${name}" is missing required argument "${required}".`);
      }
    }

    const kind = tool.kind ?? 'exec';
    if (kind === 'write' || kind === 'exec') {
      const mode: PermissionMode = context.mode ?? (context.requireApproval ? 'ask' : 'auto');
      if (mode === 'read-only') {
        return fail(`Tool "${name}" is not available in read-only mode.`);
      }
      if (mode === 'ask') {
        const approved = context.requireApproval ? await context.requireApproval(name, safeArgs) : false;
        if (!approved) {
          return fail(`Execution of tool "${name}" was rejected by user policy or approval checkpoint.`);
        }
      }
    }

    try {
      const result = await tool.execute(safeArgs, context);
      const max = context.maxOutputChars ?? DEFAULT_MAX_TOOL_OUTPUT_CHARS;
      return {
        ...result,
        callId,
        output: truncateOutput(result.output ?? '', max),
        error: result.error ? truncateOutput(result.error, max) : result.error
      };
    } catch (err: any) {
      return fail(err?.message || String(err));
    }
  }
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * Resolve a workspace-relative path and guarantee the result stays inside the workspace,
 * including after symlinks are followed. Works for paths that do not exist yet.
 */
export async function resolveSafePath(workspaceRoot: string, relativePath: string): Promise<string> {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new Error('A file path is required.');
  }
  const forbidden = () => new Error(`Access outside workspace root is forbidden: ${relativePath}`);
  const root = await fs.realpath(path.resolve(workspaceRoot));
  // Accept both POSIX and Windows separators from the model.
  const candidate = path.resolve(root, relativePath.replace(/\\/g, '/'));
  if (!isInside(root, candidate)) throw forbidden();

  // Follow symlinks on the deepest part of the path that already exists.
  let existing = candidate;
  const tail: string[] = [];
  for (;;) {
    try {
      existing = await fs.realpath(existing);
      break;
    } catch (err: any) {
      if (err?.code !== 'ENOENT' && err?.code !== 'ENOTDIR') throw err;
      // A dangling symlink would be followed by a later write, so refuse it.
      const link = await fs.lstat(existing).catch(() => null);
      if (link?.isSymbolicLink()) throw forbidden();
      const parent = path.dirname(existing);
      if (parent === existing) break;
      tail.unshift(path.basename(existing));
      existing = parent;
    }
  }
  const real = path.join(existing, ...tail);
  if (!isInside(root, real)) throw forbidden();
  return real;
}

const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', '.dockyard']);

async function walkFiles(
  startDir: string,
  workspaceRoot: string,
  visit: (relPath: string, fullPath: string) => Promise<boolean | void>
): Promise<void> {
  const root = await fs.realpath(path.resolve(workspaceRoot));
  let stop = false;
  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (stop) return;
      if (SKIPPED_DIRS.has(ent.name)) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
      } else if (ent.isFile()) {
        const rel = path.relative(root, full).replace(/\\/g, '/');
        if ((await visit(rel, full)) === false) stop = true;
      }
    }
  }
  await walk(startDir);
}

/** Environment for child processes with the harness's own credentials removed. */
function childEnv(): NodeJS.ProcessEnv {
  if (process.env.DOCKYARD_PASS_ENV === '1') return process.env;
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(OPENROUTER|NVIDIA|ANTHROPIC|OPENAI|GEMINI|MINIMAX|CLOUDFLARE|GROQ|CEREBRAS)_API_KEY$/.test(key) || key === 'DOCKYARD_SERVER_TOKEN') {
      delete env[key];
    }
  }
  return env;
}

const MAX_COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_LISTED_FILES = 200;
const MAX_SEARCH_MATCHES = 100;
const MAX_SEARCH_FILE_BYTES = 1024 * 1024;

export function createStandardTools(): ToolRegistry {
  const registry = new ToolRegistry();

  // 1. Read File
  registry.register({
    kind: 'read',
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
        const fullPath = await resolveSafePath(context.workspaceRoot, args.filepath);
        const content = await fs.readFile(fullPath, 'utf-8');
        return { output: content };
      } catch (e: any) {
        return { output: '', error: `Cannot read file: ${e.message}`, isError: true };
      }
    }
  });

  // 2. Write File
  registry.register({
    kind: 'write',
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
        if (typeof args.content !== 'string') {
          return { output: '', error: 'Cannot write file: "content" must be a string.', isError: true };
        }
        const fullPath = await resolveSafePath(context.workspaceRoot, args.filepath);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.writeFile(fullPath, args.content, 'utf-8');
        return { output: `Successfully wrote ${args.content.length} characters to ${args.filepath}` };
      } catch (e: any) {
        return { output: '', error: `Cannot write file: ${e.message}`, isError: true };
      }
    }
  });

  // 3. Targeted search-and-replace edit
  registry.register({
    kind: 'write',
    definition: {
      name: 'edit_file_diff',
      description: 'Apply targeted search-and-replace edit to an existing file using <<<<<<< SEARCH, =======, >>>>>>> REPLACE block. The SEARCH text must match exactly one place in the file.',
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
        const fullPath = await resolveSafePath(context.workspaceRoot, args.filepath);
        const original = await fs.readFile(fullPath, 'utf-8');
        const usesCRLF = original.includes('\r\n');
        const fileContent = original.replace(/\r\n/g, '\n');
        const diff = String(args.diff).replace(/\r\n/g, '\n');

        const searchMarker = '<<<<<<< SEARCH\n';
        const dividerMarker = '\n=======\n';
        const replaceMarker = '\n>>>>>>> REPLACE';

        const searchStart = diff.indexOf(searchMarker);
        const divider = searchStart === -1 ? -1 : diff.indexOf(dividerMarker, searchStart);
        const replaceEnd = divider === -1 ? -1 : diff.indexOf(replaceMarker, divider);

        if (searchStart === -1 || divider === -1 || replaceEnd === -1) {
          return { output: '', error: 'Invalid diff format. Expected SEARCH/REPLACE block.', isError: true };
        }

        const searchBlock = diff.substring(searchStart + searchMarker.length, divider);
        const replaceBlock = diff.substring(divider + dividerMarker.length, replaceEnd);

        if (searchBlock.length === 0) {
          return { output: '', error: 'Search block is empty.', isError: true };
        }
        const first = fileContent.indexOf(searchBlock);
        if (first === -1) {
          return { output: '', error: 'Search block not found in target file.', isError: true };
        }
        if (fileContent.indexOf(searchBlock, first + 1) !== -1) {
          return { output: '', error: 'Search block matches more than one place. Include more surrounding lines so it is unique.', isError: true };
        }

        // Splice rather than String.replace so "$&", "$1" etc. in the replacement stay literal.
        let newContent = fileContent.slice(0, first) + replaceBlock + fileContent.slice(first + searchBlock.length);
        if (usesCRLF) newContent = newContent.replace(/\n/g, '\r\n');
        await fs.writeFile(fullPath, newContent, 'utf-8');
        return { output: `Successfully applied diff to ${args.filepath}` };
      } catch (e: any) {
        return { output: '', error: `Cannot edit file: ${e.message}`, isError: true };
      }
    }
  });

  // 4. Run Shell Command. NOT sandboxed: runs with the user's privileges, starting in the workspace.
  registry.register({
    kind: 'exec',
    definition: {
      name: 'run_command',
      description: 'Execute a shell command (cross-platform on Windows PowerShell/CMD or macOS/Linux bash) with timeout.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute.' },
          timeoutMs: { type: 'number', description: 'Timeout in milliseconds (default: 30000, max: 600000).' }
        },
        required: ['command']
      }
    },
    async execute(args, context) {
      const requested = Number(args.timeoutMs);
      const timeout = Math.min(Number.isFinite(requested) && requested > 0 ? requested : 30000, MAX_COMMAND_TIMEOUT_MS);
      const isWindows = process.platform === 'win32';
      const shell = isWindows ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || '/bin/sh');

      try {
        const { stdout, stderr } = await execAsync(String(args.command), {
          cwd: context.workspaceRoot,
          timeout,
          shell,
          env: childEnv(),
          maxBuffer: 10 * 1024 * 1024
        });
        const combined = (stdout + (stderr ? `\nSTDERR:\n${stderr}` : '')).trim();
        return { output: combined || '(Command produced no output)' };
      } catch (err: any) {
        return {
          output: err.stdout || '',
          error: `Command failed: ${err.message}${err.stderr ? `\nSTDERR:\n${err.stderr}` : ''}`,
          isError: true
        };
      }
    }
  });

  // 5. List Files Tree
  registry.register({
    kind: 'read',
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
        const targetDir = await resolveSafePath(context.workspaceRoot, args.directory || '.');
        const files: string[] = [];
        let total = 0;
        await walkFiles(targetDir, context.workspaceRoot, async rel => {
          if (!args.pattern || rel.includes(args.pattern)) {
            total++;
            if (files.length < MAX_LISTED_FILES) files.push(rel);
          }
        });
        if (files.length === 0) return { output: '(no files found)' };
        const note = total > files.length ? `\n...[${total - files.length} more files not shown; narrow with "directory" or "pattern"]` : '';
        return { output: files.join('\n') + note };
      } catch (e: any) {
        return { output: '', error: `Cannot list files: ${e.message}`, isError: true };
      }
    }
  });

  // 6. Search file contents
  registry.register({
    kind: 'read',
    definition: {
      name: 'search_text',
      description: 'Search file contents in the workspace for a regular expression. Returns matching lines as path:line: text.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regular expression (falls back to a literal match if it does not compile).' },
          directory: { type: 'string', description: 'Directory path relative to workspace root (defaults to .)' },
          include: { type: 'string', description: 'Only search files whose path contains this substring, e.g. ".ts".' }
        },
        required: ['pattern']
      }
    },
    async execute(args, context) {
      try {
        const targetDir = await resolveSafePath(context.workspaceRoot, args.directory || '.');
        const source = String(args.pattern);
        let regex: RegExp;
        try {
          regex = new RegExp(source);
        } catch {
          regex = new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        }
        const matches: string[] = [];
        await walkFiles(targetDir, context.workspaceRoot, async (rel, full) => {
          if (args.include && !rel.includes(args.include)) return;
          const stat = await fs.stat(full).catch(() => null);
          if (!stat || stat.size > MAX_SEARCH_FILE_BYTES) return;
          const text = await fs.readFile(full, 'utf-8').catch(() => '');
          if (text.includes('\u0000')) return; // binary
          const lines = text.split(/\r?\n/);
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i])) {
              matches.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
              if (matches.length >= MAX_SEARCH_MATCHES) return false;
            }
          }
        });
        if (matches.length === 0) return { output: '(no matches)' };
        const note = matches.length >= MAX_SEARCH_MATCHES ? `\n...[stopped at ${MAX_SEARCH_MATCHES} matches; narrow the search]` : '';
        return { output: matches.join('\n') + note };
      } catch (e: any) {
        return { output: '', error: `Cannot search: ${e.message}`, isError: true };
      }
    }
  });

  return registry;
}
