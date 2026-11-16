#!/usr/bin/env node
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AgentDefinition,
  AgentStore,
  DockyardAgent,
  ModelProvider,
  PermissionMode,
  TrajectoryRecorder,
  PROVIDER_CATALOG,
  createModelProvider,
  createProviderFromEnv,
  createDockyardServer,
  isPermissionMode,
  normalizeProvider
} from '@dockyard/core';

const VERSION = '1.0.0';

const BANNER = `
========================================================================
   ____             __                     __
  / __ \\____  _____/ /____  ______ _____  / /_
 / / / / __ \\/ ___/ //_/ / / / __ \`/ __ \\/ __/
/ /_/ / /_/ / /__/ ,< / /_/ / /_/ / / / / /_
\\____/\\____/\\___/_/|_|\\__, /\\__,_/_/ /_/\\__/
                     /____/
 Dockyard v1.0 - Autonomous Coding Harness & Agent Engine
 Platform: ${process.platform} (${process.arch})
 Providers: OpenRouter | Anthropic | OpenAI | Gemini | GLM | Qwen | MiniMax | DeepSeek | NVIDIA NIM
            Cloudflare | Groq | Cerebras | Ollama | LM Studio | vLLM
========================================================================
`;

const VALUE_FLAGS = new Set([
  'mode', 'verify', 'agent', 'max-steps', 'description', 'instructions',
  'tools', 'provider', 'model', 'port', 'host', 'out'
]);

interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-y') {
      flags.yes = true;
    } else if (arg === '-v') {
      flags.version = true;
    } else if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      if (VALUE_FLAGS.has(name)) {
        const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
        if (value === undefined) throw new Error(`Option --${name} needs a value.`);
        flags[name] = value;
      } else {
        flags[name] = true;
      }
    } else {
      positionals.push(arg);
    }
  }
  return { positionals, flags };
}

function resolveMode(flags: ParsedArgs['flags']): PermissionMode {
  if (flags.yes) return 'auto';
  const requested = flags.mode ?? process.env.DOCKYARD_MODE;
  if (requested !== undefined) {
    if (!isPermissionMode(requested)) {
      throw new Error(`Unknown mode "${requested}". Use read-only, ask or auto.`);
    }
    return requested;
  }
  // With nobody at the keyboard to approve actions, default to looking but not touching.
  return process.stdin.isTTY ? 'ask' : 'read-only';
}

function buildProvider(flags: ParsedArgs['flags'] = {}): ModelProvider {
  if (typeof flags.provider === 'string') {
    const provider = normalizeProvider(flags.provider);
    if (!provider) {
      throw new Error(`Unknown provider "${flags.provider}". Supported: ${PROVIDER_CATALOG.map(p => p.id).join(', ')}.`);
    }
    const model = createModelProvider({ provider, model: typeof flags.model === 'string' ? flags.model : undefined });
    console.log(`[Dockyard Provider] Active provider: "${provider.toUpperCase()}" (${(model as any).model || 'default model'})`);
    return model;
  }
  if (typeof flags.model === 'string') process.env.DOCKYARD_MODEL = flags.model;
  const { model, provider, modelName } = createProviderFromEnv();
  if (provider === 'mock') {
    console.log('[Notice] No provider configured. Running in simulation mode: canned replies, no real model, no tool use.\n');
  } else {
    console.log(`[Dockyard Provider] Active provider: "${provider.toUpperCase()}" (${modelName})`);
  }
  return model;
}

function printModels() {
  console.log('Provider      Default model                          API key variable        Other current models');
  for (const p of PROVIDER_CATALOG) {
    if (p.id === 'custom') continue;
    const key = p.local ? `(local) ${p.baseURLEnv}` : p.apiKeyEnv[0];
    console.log(`${p.id.padEnd(13)} ${p.defaultModel.padEnd(38)} ${key.padEnd(23)} ${p.models.filter(m => m !== p.defaultModel).join(', ')}`);
  }
  console.log('\nPick one with --provider <id> [--model <id>], or DOCKYARD_PROVIDER / DOCKYARD_MODEL.');
  console.log('Model IDs change often. If a call fails with "model not found", check the vendor\'s model list and pass --model.');
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, answer => resolve(answer.trim().toLowerCase())));
}

/** Ask the person at the terminal before a tool writes files or runs a command. */
function makeApprover(shared?: readline.Interface) {
  let allowAll = false;
  return async (toolName: string, toolArgs: Record<string, any>, agentName?: string): Promise<boolean> => {
    if (allowAll) return true;
    if (!process.stdin.isTTY) {
      console.log(`\n[Blocked] "${toolName}" needs approval but no terminal is attached. Re-run with --yes to allow it.`);
      return false;
    }
    const preview = JSON.stringify(toolArgs);
    console.log(`\n[Approval needed]${agentName && agentName !== 'dockyard' ? ` (${agentName})` : ''} ${toolName} ${preview.length > 600 ? preview.slice(0, 600) + '...' : preview}`);
    const rl = shared ?? readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = await ask(rl, 'Allow? [y]es / [n]o / [a]lways for this session: ');
      if (answer === 'a' || answer === 'always') {
        allowAll = true;
        return true;
      }
      return answer === 'y' || answer === 'yes';
    } finally {
      if (!shared) rl.close();
    }
  };
}

async function loadDefinition(name: string | boolean | undefined): Promise<AgentDefinition | undefined> {
  if (typeof name !== 'string') return undefined;
  const def = await new AgentStore(process.cwd()).get(name);
  if (!def) throw new Error(`No agent named "${name}". Create one with: dockyard agent create ${name} ...`);
  return def;
}

function parseMaxSteps(value: string | boolean | undefined): number | undefined {
  if (typeof value !== 'string') return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error('--max-steps must be a positive whole number.');
  return n;
}

async function agentCommand(sub: string | undefined, rest: string[], flags: ParsedArgs['flags']) {
  const store = new AgentStore(process.cwd());

  if (sub === 'list' || sub === undefined) {
    const defs = await store.list();
    if (defs.length === 0) {
      console.log('No agents defined yet. Create one with:\n  dockyard agent create reviewer --description "Reviews diffs" --instructions "You review code changes..."');
      return;
    }
    for (const d of defs) {
      const extras = [d.mode && `mode=${d.mode}`, d.provider && `provider=${d.provider}`, d.tools && `tools=${d.tools.join(',')}`].filter(Boolean).join(' ');
      console.log(`${d.name}  -  ${d.description}${extras ? `  [${extras}]` : ''}`);
    }
    return;
  }

  const name = rest[0];
  if (!name) throw new Error(`Usage: dockyard agent ${sub} <name>`);

  if (sub === 'create') {
    const def = await store.save({
      name,
      description: String(flags.description ?? ''),
      instructions: String(flags.instructions ?? ''),
      tools: typeof flags.tools === 'string' ? flags.tools.split(',').map(t => t.trim()).filter(Boolean) : undefined,
      provider: typeof flags.provider === 'string' ? (flags.provider as AgentDefinition['provider']) : undefined,
      model: typeof flags.model === 'string' ? flags.model : undefined,
      mode: typeof flags.mode === 'string' ? (flags.mode as PermissionMode) : undefined
    });
    console.log(`Created agent "${def.name}" at .dockyard/agents/${def.name}.json`);
    console.log(`Run it directly:  dockyard run --agent ${def.name} "<task>"`);
    console.log('Or let the lead agent delegate to it: it is now listed as a teammate in every run.');
    return;
  }

  if (sub === 'show') {
    const def = await store.get(name);
    if (!def) throw new Error(`No agent named "${name}".`);
    console.log(JSON.stringify(def, null, 2));
    return;
  }

  if (sub === 'delete') {
    console.log((await store.delete(name)) ? `Deleted agent "${name}".` : `No agent named "${name}".`);
    return;
  }

  throw new Error(`Unknown agent command "${sub}". Use create, list, show or delete.`);
}

const HELP = `Usage: dockyard <command> [options]

Commands:
  run "<task>"             Run an agent task to completion in the current workspace.
  chat                     Interactive session; the conversation carries over between turns.
  agent create <name>      Define a reusable agent (teammate). Needs --description and --instructions;
                           optional --tools a,b --provider p --model m --mode read-only|ask|auto.
  agent list|show|delete   Manage defined agents (stored in .dockyard/agents/).
  export-dpo               Write DPO preference pairs from recorded trajectories to a JSONL file (--out <file>).
  app [port]               Start the desktop app: local server plus web UI, opened from the printed link.
  serve [port]             Start the local API server only (default port 4040, loopback only, token protected).
  models                   List providers, their default models and the API key each one needs.
  help                     Display this assistance menu.

Options for run / chat:
  --mode <mode>            read-only: inspect only. ask: confirm before writing files or running
                           commands (default in a terminal). auto: no confirmation.
  --yes, -y                Same as --mode auto.
  --verify "<command>"     Run this after the agent finishes (e.g. "npm test"); the task only
                           counts as succeeded if it passes, and the result feeds the reward.
  --provider <id>          Use this provider (see "dockyard models") instead of auto-detecting from API keys.
  --model <id>             Use this model instead of the provider's default.
  --agent <name>           Run as a defined agent instead of the default one.
  --max-steps <n>          Limit on model turns (default 20).
  --version, -v            Show current version.

Project instructions: an AGENTS.md file in the workspace root is loaded into every run.

Environment variables:
  OPENROUTER_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, ZAI_API_KEY (GLM),
  DASHSCOPE_API_KEY (Qwen), MINIMAX_API_KEY, DEEPSEEK_API_KEY, NVIDIA_API_KEY,
  CLOUDFLARE_API_KEY (+ CLOUDFLARE_ACCOUNT_ID), GROQ_API_KEY, CEREBRAS_API_KEY
  OLLAMA_BASE_URL, LMSTUDIO_BASE_URL, VLLM_BASE_URL   Local model endpoints.
  DOCKYARD_PROVIDER      Explicit provider id (run "dockyard models" for the list).
  DOCKYARD_MODEL         Model name.            DOCKYARD_BASE_URL      Custom endpoint URL.
  DOCKYARD_MODE          Default permission mode.
  DOCKYARD_SERVER_TOKEN  Fixed bearer token for "serve" (otherwise one is generated at startup).
`;

export async function runCLI(args: string[] = process.argv.slice(2)) {
  const { positionals, flags } = parseArgs(args);
  const command = positionals[0] || 'help';

  if (flags.version || command === 'version') {
    console.log(`Dockyard CLI v${VERSION}`);
    return;
  }

  if (command === 'models') {
    printModels();
    return;
  }

  if (command === 'serve' || command === 'app') {
    const port = parseInt(String(flags.port ?? positionals[1] ?? '4040'), 10);
    const isApp = command === 'app';
    let staticDir: string | undefined;
    if (isApp) {
      staticDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'desktop', 'dist');
      if (!fs.existsSync(path.join(staticDir, 'index.html'))) {
        throw new Error(`The desktop app has not been built yet (${staticDir} is missing). Run "npm run build" in the Dockyard repository first.`);
      }
    }
    console.log(BANNER);
    if (typeof flags.provider === 'string') {
      const provider = normalizeProvider(flags.provider);
      if (!provider) throw new Error(`Unknown provider "${flags.provider}".`);
      process.env.DOCKYARD_PROVIDER = provider;
    }
    if (typeof flags.model === 'string') process.env.DOCKYARD_MODEL = flags.model;
    const { server, token, mode, provider, modelName, host } = createDockyardServer({
      port,
      host: typeof flags.host === 'string' ? flags.host : undefined,
      workspaceRoot: process.cwd(),
      // In the app a person is present to approve each action, so writes and commands are allowed (with approval by default).
      mode: flags.yes || flags.mode ? resolveMode(flags) : isApp ? 'auto' : undefined,
      verifyCommand: typeof flags.verify === 'string' ? flags.verify : undefined,
      staticDir
    });
    server.on('error', (err: any) => {
      console.error(err?.code === 'EADDRINUSE' ? `Error: port ${port} is already in use. Pass another port, e.g. "dockyard ${command} 4141".` : `Error: ${err?.message || err}`);
      process.exit(1);
    });
    server.listen(port, host, () => {
      const shownHost = host === '0.0.0.0' ? '127.0.0.1' : host;
      console.log(`[Dockyard] Workspace: ${process.cwd()}`);
      console.log(`[Dockyard] Provider: ${provider}${modelName ? ` (${modelName})` : ''} | Highest permission mode: ${mode}`);
      if (isApp) {
        console.log(`\n[Dockyard App] Open this link in your browser:\n  http://${shownHost}:${port}/#token=${token}\n`);
        console.log('[Dockyard App] The link contains your access token. Press Ctrl+C to stop.');
      } else {
        console.log(`[Dockyard Core Server] Listening on http://${shownHost}:${port}`);
        console.log(`[Dockyard Core Server] Send this header with every request:\n  Authorization: Bearer ${token}`);
        if (mode === 'read-only') {
          console.log('[Dockyard Core Server] Tasks can read the workspace but not change it. Start with --mode ask or --mode auto to allow edits and commands.');
        }
      }
    });
    return;
  }

  if (command === 'agent') {
    await agentCommand(positionals[1], positionals.slice(2), flags);
    return;
  }

  if (command === 'export-dpo') {
    const recorder = new TrajectoryRecorder(process.cwd());
    const trajectories = await recorder.loadAll();
    const pairs = recorder.exportDPOPairs();
    const out = path.resolve(typeof flags.out === 'string' ? flags.out : path.join('.dockyard', 'dpo_pairs.jsonl'));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, pairs.map(p => JSON.stringify(p)).join('\n') + (pairs.length ? '\n' : ''), 'utf-8');
    console.log(`Wrote ${pairs.length} preference pair(s) from ${trajectories.length} trajectories to ${out}`);
    if (pairs.length === 0) {
      console.log('A pair needs two recorded runs of the same task whose rewards differ by at least 0.5.');
    }
    return;
  }

  if (command === 'run') {
    const task = positionals.slice(1).join(' ');
    if (!task) {
      console.error('Error: Please provide a task description to run.');
      console.log('Usage: dockyard run "<task description>"');
      process.exitCode = 1;
      return;
    }

    console.log(BANNER);
    console.log(`[Target Task]: ${task}\n`);
    const mode = resolveMode(flags);
    const definition = await loadDefinition(flags.agent);
    const model = buildProvider(flags);
    const agent = new DockyardAgent({
      workspaceRoot: process.cwd(),
      model,
      mode,
      definition,
      maxIterations: parseMaxSteps(flags['max-steps']),
      verifyCommand: typeof flags.verify === 'string' ? flags.verify : undefined,
      requireApproval: makeApprover(),
      onStepProgress: step => console.log(`[Plan] ${step.status}: ${step.title}`),
      onToolCall: (who, call, result) =>
        console.log(`[${who}] ${call.name} -> ${result.isError ? 'ERROR' : 'ok'}`)
    });

    console.log(`[Dockyard] Agent: ${agent.name} | Permission mode: ${agent.mode}`);
    const result = await agent.run(task);

    console.log('\n================== Execution Result ==================');
    console.log(`Status: ${result.succeeded ? 'SUCCESS' : 'FAILED'} (${result.stopReason})`);
    console.log(`Steps taken: ${result.trajectory.steps.length}`);
    if (result.verified !== undefined) {
      console.log(`Verification: ${result.verified ? 'passed' : 'FAILED'}`);
    }
    console.log(`RL Reward: ${result.trajectory.finalReward.toFixed(2)}  ${JSON.stringify(result.trajectory.rewardBreakdown)}`);
    if (result.usage.totalTokens > 0) {
      console.log(`Tokens: ${result.usage.totalTokens}`);
    }
    if (result.reflection?.source === 'model') {
      console.log(`\nSelf-Reflection Critique: ${result.reflection.critique}`);
      console.log(`Identified Heuristics:`, result.reflection.identifiedHeuristics);
    }
    console.log('\nFinal Summary:\n' + result.summary);
    if (!result.succeeded) process.exitCode = 1;
    return;
  }

  if (command === 'chat') {
    console.log(BANNER);
    console.log('Interactive Dockyard Session. Type "exit" or "quit" to exit, "/new" to start a fresh conversation.\n');
    const mode = resolveMode(flags);
    const definition = await loadDefinition(flags.agent);
    const model = buildProvider(flags);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const agent = new DockyardAgent({
      workspaceRoot: process.cwd(),
      model,
      mode,
      definition,
      maxIterations: parseMaxSteps(flags['max-steps']),
      verifyCommand: typeof flags.verify === 'string' ? flags.verify : undefined,
      requireApproval: makeApprover(rl),
      onToolCall: (who, call, result) =>
        console.log(`[${who}] ${call.name} -> ${result.isError ? 'ERROR' : 'ok'}`)
    });
    console.log(`[Dockyard] Agent: ${agent.name} | Permission mode: ${agent.mode}`);

    for (;;) {
      const query = await new Promise<string>(resolve => rl.question('\ndockyard> ', a => resolve(a.trim())));
      if (query === 'exit' || query === 'quit') break;
      if (!query) continue;
      if (query === '/new') {
        agent.resetSession();
        console.log('[Started a fresh conversation]');
        continue;
      }
      try {
        const res = await agent.run(query, { resume: true });
        console.log(`\n${res.summary}`);
        console.log(`[Trajectory Reward: ${res.trajectory.finalReward.toFixed(2)}]`);
      } catch (err: any) {
        console.error(`[Error] ${err?.message || err}`);
      }
    }
    rl.close();
    return;
  }

  if (command !== 'help') {
    console.error(`Unknown command "${command}".\n`);
    process.exitCode = 1;
  }
  console.log(BANNER);
  console.log(HELP);
}

function isEntryPoint(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  try {
    // npm installs the bin as a symlink (or a shim), so compare real paths rather than names.
    const a = fs.realpathSync(invoked);
    const b = fs.realpathSync(fileURLToPath(import.meta.url));
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  runCLI().catch(err => {
    console.error(`Error: ${err?.message || err}`);
    process.exit(1);
  });
}
