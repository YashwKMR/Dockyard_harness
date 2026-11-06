#!/usr/bin/env node
import { AutonomousAgent, DockyardServer, ProviderId } from '@dockyard/core';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

export interface CliOptions {
  provider?: ProviderId;
  model?: string;
  port?: number;
  dir?: string;
}

export function parseArgs(args: string[]): { command: string; prompt: string; options: CliOptions } {
  const options: CliOptions = {};
  let command = 'help';
  const promptParts: string[] = [];

  let i = 0;
  if (args.length > 0 && !args[0].startsWith('-')) {
    command = args[0];
    i = 1;
  }

  for (; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--provider' || arg === '-p') {
      options.provider = args[++i] as ProviderId;
    } else if (arg === '--model' || arg === '-m') {
      options.model = args[++i];
    } else if (arg === '--port') {
      options.port = parseInt(args[++i], 10);
    } else if (arg === '--dir' || arg === '-d') {
      options.dir = args[++i];
    } else if (arg === '--help' || arg === '-h') {
      command = 'help';
    } else {
      promptParts.push(arg);
    }
  }

  return { command, prompt: promptParts.join(' '), options };
}

export function showHelp(): string {
  return `
Dockyard Harness CLI v1.0.0
Autonomous Multi-Provider Agentic AI Harness

Usage:
  dockyard <command> [options] [prompt]

Commands:
  run <prompt>    Run an autonomous agent task to completion
  chat            Start an interactive interactive conversation session
  serve           Start the local HTTP / RPC harness server
  help            Show this help reference

Options:
  -p, --provider  Model provider (openrouter, nvidia, anthropic, gemini, groq, cerebras, ollama, lmstudio)
  -m, --model     Specific model identifier
  --port          Server port (default: 4000 for serve)
  -d, --dir       Target working directory (default: current working directory)
  -h, --help      Display help manual
`;
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const { command, prompt, options } = parseArgs(argv);

  switch (command) {
    case 'help': {
      console.log(showHelp());
      return 0;
    }

    case 'run': {
      if (!prompt) {
        console.error('Error: Please specify a task prompt for dockyard run.');
        console.log(showHelp());
        return 1;
      }
      console.log(`⚓ Dockyard Harness: Running task with provider [${options.provider || 'openrouter'}]...`);
      const agent = new AutonomousAgent({
        provider: options.provider,
        model: options.model,
        workingDirectory: options.dir,
      });
      const result = await agent.run(prompt);
      console.log('\n--- Plan Execution Summary ---');
      console.log(agent.planner.formatMarkdown());
      console.log('\n--- Output ---');
      console.log(result.output);
      console.log(`\nCompleted in ${result.iterations} iterations. Success: ${result.success}`);
      return result.success ? 0 : 1;
    }

    case 'serve': {
      const port = options.port || 4000;
      console.log(`⚓ Dockyard Harness: Starting daemon on port ${port}...`);
      const server = new DockyardServer({
        port,
        agentConfig: {
          provider: options.provider,
          model: options.model,
          workingDirectory: options.dir,
        },
      });
      await server.start();
      console.log(`🚀 Harness server listening on http://localhost:${port}`);
      return 0;
    }

    case 'chat': {
      console.log(`⚓ Dockyard Harness: Interactive Chat Session (type 'exit' or 'quit' to end)`);
      const agent = new AutonomousAgent({
        provider: options.provider,
        model: options.model,
        workingDirectory: options.dir,
      });

      const rl = readline.createInterface({ input, output });
      try {
        while (true) {
          const userPrompt = await rl.question('\nDockyard > ');
          if (!userPrompt || userPrompt.trim() === 'exit' || userPrompt.trim() === 'quit') {
            break;
          }
          const res = await agent.run(userPrompt);
          console.log(`\n[Agent]: ${res.output}`);
        }
      } finally {
        rl.close();
      }
      return 0;
    }

    default: {
      console.error(`Unknown command: '${command}'`);
      console.log(showHelp());
      return 1;
    }
  }
}

// Auto-run when executed directly
if (process.argv[1] && process.argv[1].endsWith('bin.js')) {
  runCli().then((code) => {
    if (code !== 0 && process.argv[2] !== 'serve') process.exit(code);
  });
}
