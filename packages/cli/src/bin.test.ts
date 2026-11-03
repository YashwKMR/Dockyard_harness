import test from 'node:test';
import assert from 'node:assert/strict';
import { runCLI } from './bin.js';

test('CLI: Version output without error', async () => {
  let output = '';
  const origLog = console.log;
  console.log = (...args) => {
    output += args.join(' ') + '\n';
  };
  try {
    await runCLI(['--version']);
    assert.ok(output.includes('Dockyard CLI v1.0.0'));
  } finally {
    console.log = origLog;
  }
});

test('CLI: Help menu display', async () => {
  let output = '';
  const origLog = console.log;
  console.log = (...args) => {
    output += args.join(' ') + '\n';
  };
  try {
    await runCLI(['help']);
    assert.ok(output.includes('Dockyard v1.0'));
    assert.ok(output.includes('dockyard <command>'));
  } finally {
    console.log = origLog;
  }
});
