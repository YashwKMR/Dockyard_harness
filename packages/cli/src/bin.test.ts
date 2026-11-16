import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runCLI, parseArgs } from './bin.js';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), 'bin.js');

async function capture(fn: () => Promise<void>): Promise<string> {
  let output = '';
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => { output += args.join(' ') + '\n'; };
  console.error = (...args) => { output += args.join(' ') + '\n'; };
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return output;
}

/** Run the built CLI as a real process, in a scratch workspace with no provider configured. */
function cli(args: string[], cwd: string) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/_API_KEY$|_BASE_URL$|^DOCKYARD_/.test(key)) delete env[key];
  }
  return spawnSync(process.execPath, [BIN, ...args], { cwd, env, encoding: 'utf-8' });
}

test('CLI: Version output without error', async () => {
  assert.ok((await capture(() => runCLI(['--version']))).includes('Dockyard CLI v1.0.0'));
  assert.ok((await capture(() => runCLI(['-v']))).includes('Dockyard CLI v1.0.0'));
});

test('CLI: Help menu display', async () => {
  const output = await capture(() => runCLI(['help']));
  assert.ok(output.includes('Dockyard v1.0'));
  assert.ok(output.includes('dockyard <command>'));
  assert.ok(output.includes('agent create'));
});

test('CLI: argument parsing', () => {
  const parsed = parseArgs(['run', '--mode', 'read-only', '--verify=npm test', '-y', 'fix', 'the', 'bug']);
  assert.deepEqual(parsed.positionals, ['run', 'fix', 'the', 'bug']);
  assert.deepEqual(parsed.flags, { mode: 'read-only', verify: 'npm test', yes: true });
  assert.throws(() => parseArgs(['run', '--mode']), /needs a value/);
});

test('CLI: runs when launched through a symlink, as npm installs it', { skip: process.platform === 'win32' }, () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dockyard-bin-')));
  const link = path.join(dir, 'dockyard');
  fs.symlinkSync(BIN, link);
  const res = spawnSync(process.execPath, [link, '--version'], { encoding: 'utf-8' });
  assert.match(res.stdout, /Dockyard CLI v1\.0\.0/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('CLI: agent create / list / run / delete, and unknown input fails loudly', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dockyard-cli-')));

  const created = cli(['agent', 'create', 'reviewer', '--description', 'Reviews diffs', '--instructions', 'Review carefully.', '--mode', 'read-only'], dir);
  assert.equal(created.status, 0, created.stderr);
  assert.ok(fs.existsSync(path.join(dir, '.dockyard', 'agents', 'reviewer.json')));

  assert.match(cli(['agent', 'list'], dir).stdout, /reviewer\s+-\s+Reviews diffs\s+\[mode=read-only\]/);

  const invalid = cli(['agent', 'create', 'Bad Name', '--description', 'x', '--instructions', 'y'], dir);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Agent name must be/);

  const run = cli(['run', '--agent', 'reviewer', 'Look around'], dir);
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /simulation mode/);
  assert.match(run.stdout, /Agent: reviewer \| Permission mode: read-only/);
  assert.match(run.stdout, /Status: SUCCESS/);

  const failing = cli(['run', '--verify', 'node -e "process.exit(1)"', 'Look around'], dir);
  assert.equal(failing.status, 1, 'a failed verification is a failed run');
  assert.match(failing.stdout, /Verification: FAILED/);

  assert.match(cli(['export-dpo'], dir).stdout, /Wrote \d+ preference pair\(s\) from 2 trajectories/);
  assert.equal(cli(['run', '--mode', 'yolo', 'x'], dir).status, 1);
  assert.equal(cli(['frobnicate'], dir).status, 1);
  assert.equal(cli(['run', '--agent', 'ghost', 'x'], dir).status, 1);

  assert.match(cli(['agent', 'delete', 'reviewer'], dir).stdout, /Deleted agent "reviewer"/);
  fs.rmSync(dir, { recursive: true, force: true });
});
