import { describe, it, expect, vi } from 'vitest';
import { parseArgs, showHelp, runCli } from './bin.js';

describe('Dockyard CLI', () => {
  it('correctly parses command-line arguments and flags', () => {
    const res = parseArgs([
      'run',
      'Create README.md',
      '--provider',
      'groq',
      '-m',
      'llama-3.3-70b',
      '--dir',
      '/tmp',
    ]);
    expect(res.command).toBe('run');
    expect(res.prompt).toBe('Create README.md');
    expect(res.options.provider).toBe('groq');
    expect(res.options.model).toBe('llama-3.3-70b');
    expect(res.options.dir).toBe('/tmp');
  });

  it('displays comprehensive help message', () => {
    const help = showHelp();
    expect(help).toContain('Dockyard Harness CLI');
    expect(help).toContain('Commands:');
    expect(help).toContain('run <prompt>');
    expect(help).toContain('serve');
    expect(help).toContain('chat');
  });

  it('executes help command returning 0 exit code', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await runCli(['help']);
    expect(code).toBe(0);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('executes run command and outputs summary', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await runCli(['run', 'Inspect workspace', '--provider', 'ollama']);
    expect(code).toBe(0);
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
