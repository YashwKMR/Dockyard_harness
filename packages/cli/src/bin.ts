#!/usr/bin/env node
import * as readline from 'node:readline';
import {
  DockyardAgent,
  createModelProvider,
  MockModelProvider,
  createDockyardServer,
  SupportedProviderType
} from '@dockyard/core';

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
 Mode: Long-Horizon Agentic Work | RL Rewards | Contextual Intelligence
 Providers: OpenRouter | NVIDIA NIM | Anthropic | OpenAI | Gemini | MiniMax | Cloudflare | Groq | Cerebras | Ollama | LM Studio
========================================================================
`;

function detectAndBuildProvider() {
  const providerEnv = (process.env.DOCKYARD_PROVIDER || '').toLowerCase() as SupportedProviderType;

  let chosenProvider: SupportedProviderType = 'openai';
  if (providerEnv) {
    chosenProvider = providerEnv;
  } else if (process.env.OPENROUTER_API_KEY) {
    chosenProvider = 'openrouter';
  } else if (process.env.NVIDIA_API_KEY) {
    chosenProvider = 'nvidia';
  } else if (process.env.ANTHROPIC_API_KEY) {
    chosenProvider = 'anthropic';
  } else if (process.env.GEMINI_API_KEY) {
    chosenProvider = 'gemini';
  } else if (process.env.MINIMAX_API_KEY) {
    chosenProvider = 'minimax';
  } else if (process.env.CLOUDFLARE_API_KEY) {
    chosenProvider = 'cloudflare';
  } else if (process.env.GROQ_API_KEY) {
    chosenProvider = 'groq';
  } else if (process.env.CEREBRAS_API_KEY) {
    chosenProvider = 'cerebras';
  } else if (process.env.OPENAI_API_KEY) {
    chosenProvider = 'openai';
  } else if (process.env.OLLAMA_BASE_URL) {
    chosenProvider = 'ollama';
  } else if (process.env.LMSTUDIO_BASE_URL) {
    chosenProvider = 'lmstudio';
  } else {
    console.log('[Notice] No API keys detected. Running in Dockyard Local Simulation Mode.\n');
    return new MockModelProvider();
  }

  console.log(`[Dockyard Provider] Active provider: "${chosenProvider.toUpperCase()}"`);
  return createModelProvider({
    provider: chosenProvider,
    model: process.env.DOCKYARD_MODEL,
    baseURL: process.env.DOCKYARD_BASE_URL
  });
}

export async function runCLI(args: string[] = process.argv.slice(2)) {
  const command = args[0] || 'help';

  if (command === '--version' || command === '-v') {
    console.log('Dockyard CLI v1.0.0');
    return;
  }

  if (command === 'serve') {
    const port = parseInt(args[1] || '4040', 10);
    console.log(BANNER);
    const { server } = createDockyardServer({
      port,
      workspaceRoot: process.cwd()
    });
    server.listen(port, () => {
      console.log(`[Dockyard Core Server] Listening on http://localhost:${port}`);
      console.log(`[Dockyard Desktop / API] Ready for connections.`);
    });
    return;
  }

  if (command === 'run') {
    const task = args.slice(1).join(' ');
    if (!task) {
      console.error('Error: Please provide a task description to run.');
      console.log('Usage: dockyard run "<task description>"');
      process.exitCode = 1;
      return;
    }

    console.log(BANNER);
    console.log(`[Target Task]: ${task}\n`);
    const model = detectAndBuildProvider();
    const agent = new DockyardAgent({
      workspaceRoot: process.cwd(),
      model,
      requireApproval: async (toolName, toolArgs) => {
        console.log(`\n[Action Checkpoint]: Tool "${toolName}" requested with:`, JSON.stringify(toolArgs));
        return true;
      }
    });

    console.log('[Dockyard] Initializing context engine and state machine...');
    const result = await agent.run(task);

    console.log('\n================== Execution Result ==================');
    console.log(`Status: ${result.succeeded ? 'SUCCESS' : 'FAILED'}`);
    console.log(`Steps taken: ${result.trajectory.steps.length}`);
    console.log(`RL Reward: ${result.trajectory.finalReward.toFixed(2)}`);
    console.log(`Checkpoints saved: ${result.checkpoints}`);
    if (result.reflection) {
      console.log(`\nSelf-Reflection Critique: ${result.reflection.critique}`);
      console.log(`Identified Heuristics:`, result.reflection.identifiedHeuristics);
    }
    console.log('\nFinal Summary:\n' + result.summary);
    return;
  }

  if (command === 'chat') {
    console.log(BANNER);
    console.log('Interactive Dockyard Session. Type "exit" or "quit" to exit.\n');
    const model = detectAndBuildProvider();
    const agent = new DockyardAgent({
      workspaceRoot: process.cwd(),
      model
    });

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const askPrompt = () => {
      rl.question('\ndockyard> ', async input => {
        const query = input.trim();
        if (query === 'exit' || query === 'quit') {
          rl.close();
          return;
        }
        if (!query) {
          askPrompt();
          return;
        }

        console.log(`\n[Dockyard Agent working on: "${query}"...]`);
        const res = await agent.run(query);
        console.log(`\n${res.summary}`);
        console.log(`[Trajectory Reward: ${res.trajectory.finalReward.toFixed(2)}]`);
        askPrompt();
      });
    };

    askPrompt();
    return;
  }

  // Help command / fallback
  console.log(BANNER);
  console.log(`Usage: dockyard <command> [options]

Commands:
  run "<task>"      Run an autonomous agent task to completion in the current workspace.
  serve [port]      Start the local Dockyard server for Desktop UI & RPC connections (default: 4040).
  chat              Launch the interactive Dockyard terminal REPL session.
  help              Display this assistance menu.

Options:
  --version, -v     Show current version.

Supported Model Providers & Environment Variables:
  OPENROUTER_API_KEY   OpenRouter (DeepSeek, Claude 3.5, Llama 3.3, Hermes).
  NVIDIA_API_KEY       NVIDIA NIM (hosted Llama 3.3, DeepSeek, Nemotron).
  ANTHROPIC_API_KEY    Anthropic Claude 3.5 Sonnet / Opus.
  OPENAI_API_KEY       OpenAI GPT-4o, o1, o3-mini.
  GEMINI_API_KEY       Google Gemini 1.5 Pro / Flash.
  MINIMAX_API_KEY      MiniMax abab6.5s.
  CLOUDFLARE_API_KEY   Cloudflare Workers AI (+ CLOUDFLARE_ACCOUNT_ID).
  GROQ_API_KEY         Groq ultra-fast Llama 3.3.
  CEREBRAS_API_KEY     Cerebras high-speed inference.
  OLLAMA_BASE_URL      Local Ollama instance (default: http://localhost:11434/v1).
  LMSTUDIO_BASE_URL    Local LM Studio instance (default: http://localhost:1234/v1).
  VLLM_BASE_URL        Local vLLM endpoint (default: http://localhost:8000/v1).
  DOCKYARD_PROVIDER    Explicit provider override ('openrouter'|'nvidia'|'anthropic'|'openai'|'gemini'|'minimax'|'cloudflare'|'groq'|'cerebras'|'ollama'|'lmstudio'|'vllm').
  DOCKYARD_MODEL       Custom model name.
  DOCKYARD_BASE_URL    Custom endpoint URL.
`);
}

if (process.argv[1]?.endsWith('bin.js') || process.argv[1]?.endsWith('cli/dist/bin.js')) {
  runCLI().catch(err => {
    console.error('Fatal CLI Error:', err);
    process.exit(1);
  });
}
