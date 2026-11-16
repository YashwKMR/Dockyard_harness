import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { createStandardTools, resolveSafePath } from './tools/registry.js';
import { HierarchicalPlanner } from './planner/hierarchical.js';
import { TrajectoryRecorder } from './rl/trajectory.js';
import { MemoryEngine } from './memory/engine.js';
import {
  MockModelProvider,
  createModelProvider,
  createProviderFromEnv,
  detectProviderFromEnv,
  fetchWithRetry,
  OpenAICompatibleProvider
} from './models/providers.js';
import { DockyardAgent } from './agent.js';

async function tmp(prefix: string): Promise<string> {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
}

test('Provider Factory: Supports all cloud and local providers', () => {
  const openrouter = createModelProvider({ provider: 'openrouter', apiKey: 'test-or' });
  assert.equal(openrouter.name, 'openrouter');
  assert.equal((openrouter as OpenAICompatibleProvider).baseURL, 'https://openrouter.ai/api/v1');

  const nvidia = createModelProvider({ provider: 'nvidia', apiKey: 'test-nv' });
  assert.equal(nvidia.name, 'nvidia');
  assert.equal((nvidia as OpenAICompatibleProvider).baseURL, 'https://integrate.api.nvidia.com/v1');

  assert.equal(createModelProvider({ provider: 'anthropic', apiKey: 'test-ant' }).name, 'anthropic');
  assert.equal(createModelProvider({ provider: 'gemini', apiKey: 'test-gemini' }).name, 'gemini');
  assert.equal(createModelProvider({ provider: 'minimax', apiKey: 'test-minimax' }).name, 'minimax');

  const cf = createModelProvider({ provider: 'cloudflare', apiKey: 'test-cf', accountId: 'acc123' });
  assert.equal(cf.name, 'cloudflare');
  assert.ok((cf as OpenAICompatibleProvider).baseURL.includes('acc123'));

  assert.equal(createModelProvider({ provider: 'groq', apiKey: 'test-groq' }).name, 'groq');
  assert.equal(createModelProvider({ provider: 'cerebras', apiKey: 'test-cerebras' }).name, 'cerebras');

  const ollama = createModelProvider({ provider: 'ollama' });
  assert.equal(ollama.name, 'ollama');
  assert.equal((ollama as OpenAICompatibleProvider).baseURL, 'http://localhost:11434/v1');

  const lmstudio = createModelProvider({ provider: 'lmstudio' });
  assert.equal((lmstudio as OpenAICompatibleProvider).baseURL, 'http://localhost:1234/v1');

  const vllm = createModelProvider({ provider: 'vllm' });
  assert.equal((vllm as OpenAICompatibleProvider).baseURL, 'http://localhost:8000/v1');
});

test('Provider detection: env selection, explicit override and unknown names', () => {
  assert.equal(detectProviderFromEnv({}), undefined);
  assert.equal(createProviderFromEnv({}).provider, 'mock');
  assert.equal(detectProviderFromEnv({ GROQ_API_KEY: 'x' }), 'groq');
  assert.equal(detectProviderFromEnv({ GROQ_API_KEY: 'x', DOCKYARD_PROVIDER: 'Ollama' }), 'ollama');
  assert.throws(() => detectProviderFromEnv({ DOCKYARD_PROVIDER: 'opnai' }), /Unknown DOCKYARD_PROVIDER/);
  assert.throws(() => createModelProvider({ provider: 'nope' as any }), /Unknown provider/);
});

test('Provider: retries a rate-limited request and then succeeds', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls < 3) return new Response('slow down', { status: 429 });
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 });
  }) as typeof fetch;
  try {
    const res = await fetchWithRetry('http://example.invalid', { method: 'POST' }, { baseDelayMs: 1 });
    assert.equal(res.status, 200);
    assert.equal(calls, 3);

    calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response('bad key', { status: 401 }); }) as typeof fetch;
    const denied = await fetchWithRetry('http://example.invalid', { method: 'POST' }, { baseDelayMs: 1 });
    assert.equal(denied.status, 401);
    assert.equal(calls, 1, 'auth errors are not retried');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Tools: Read, write, and edit with diff', async () => {
  const tmpDir = await tmp('dockyard-test-');
  const tools = createStandardTools();
  const ctx = { workspaceRoot: tmpDir };

  const writeRes = await tools.execute('write_file', { filepath: 'sample.txt', content: 'hello world\nalpha\nbeta\n' }, ctx, 'call-9');
  assert.equal(writeRes.isError, undefined);
  assert.equal(writeRes.callId, 'call-9', 'results carry the id of the call that produced them');

  const readRes = await tools.execute('read_file', { filepath: 'sample.txt' }, ctx);
  assert.equal(readRes.output, 'hello world\nalpha\nbeta\n');

  const diffRes = await tools.execute('edit_file_diff', {
    filepath: 'sample.txt',
    diff: `<<<<<<< SEARCH\nalpha\n=======\ngamma\n>>>>>>> REPLACE`
  }, ctx);
  assert.equal(diffRes.isError, undefined);

  const verifyRead = await tools.execute('read_file', { filepath: 'sample.txt' }, ctx);
  assert.ok(verifyRead.output.includes('gamma'));
  assert.ok(!verifyRead.output.includes('alpha'));

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('Tools: edits keep "$" sequences literal, preserve CRLF, and refuse ambiguous matches', async () => {
  const tmpDir = await tmp('dockyard-edit-');
  const tools = createStandardTools();
  const ctx = { workspaceRoot: tmpDir };

  await fs.writeFile(path.join(tmpDir, 'a.js'), 'const price = OLD;\r\nconst other = 1;\r\n');
  const res = await tools.execute('edit_file_diff', {
    filepath: 'a.js',
    diff: "<<<<<<< SEARCH\nconst price = OLD;\n=======\nconst price = s.replace(/x/, '$&$1');\n>>>>>>> REPLACE"
  }, ctx);
  assert.equal(res.isError, undefined);
  assert.equal(await fs.readFile(path.join(tmpDir, 'a.js'), 'utf-8'), "const price = s.replace(/x/, '$&$1');\r\nconst other = 1;\r\n");

  await fs.writeFile(path.join(tmpDir, 'b.txt'), 'same\nsame\n');
  const ambiguous = await tools.execute('edit_file_diff', {
    filepath: 'b.txt',
    diff: '<<<<<<< SEARCH\nsame\n=======\nchanged\n>>>>>>> REPLACE'
  }, ctx);
  assert.equal(ambiguous.isError, true);
  assert.equal(await fs.readFile(path.join(tmpDir, 'b.txt'), 'utf-8'), 'same\nsame\n');

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('Tools: file access cannot leave the workspace', async () => {
  const parent = await tmp('dockyard-jail-');
  const workspace = path.join(parent, 'ws');
  const sibling = path.join(parent, 'ws-secret');
  await fs.mkdir(workspace);
  await fs.mkdir(sibling);
  await fs.writeFile(path.join(sibling, 'key.txt'), 'TOPSECRET');
  const tools = createStandardTools();
  const ctx = { workspaceRoot: workspace };

  // A sibling directory that merely shares the workspace's name as a prefix.
  const siblingRead = await tools.execute('read_file', { filepath: '../ws-secret/key.txt' }, ctx);
  assert.equal(siblingRead.isError, true);
  assert.ok(!siblingRead.output.includes('TOPSECRET'));

  const absolute = await tools.execute('read_file', { filepath: path.join(sibling, 'key.txt') }, ctx);
  assert.equal(absolute.isError, true);

  const escapeWrite = await tools.execute('write_file', { filepath: '../ws-secret/new.txt', content: 'x' }, ctx);
  assert.equal(escapeWrite.isError, true);

  if (process.platform !== 'win32') {
    await fs.symlink(path.join(sibling, 'key.txt'), path.join(workspace, 'link.txt'));
    await fs.symlink(sibling, path.join(workspace, 'linkdir'));
    await fs.symlink(path.join(sibling, 'not-yet.txt'), path.join(workspace, 'dangling.txt'));

    const viaLink = await tools.execute('read_file', { filepath: 'link.txt' }, ctx);
    assert.equal(viaLink.isError, true);
    const viaDir = await tools.execute('write_file', { filepath: 'linkdir/planted.txt', content: 'x' }, ctx);
    assert.equal(viaDir.isError, true);
    const viaDangling = await tools.execute('write_file', { filepath: 'dangling.txt', content: 'x' }, ctx);
    assert.equal(viaDangling.isError, true);
    await assert.rejects(fs.stat(path.join(sibling, 'planted.txt')));
    await assert.rejects(fs.stat(path.join(sibling, 'not-yet.txt')));
  }

  // Normal nested paths, including ones that do not exist yet, still work.
  assert.equal(await resolveSafePath(workspace, 'a/b/c.txt'), path.join(workspace, 'a', 'b', 'c.txt'));

  await fs.rm(parent, { recursive: true, force: true });
});

test('Tools: permission modes gate writes and commands, not reads', async () => {
  const tmpDir = await tmp('dockyard-perm-');
  await fs.writeFile(path.join(tmpDir, 'readme.txt'), 'needle here');
  const tools = createStandardTools();

  const ro = { workspaceRoot: tmpDir, mode: 'read-only' as const };
  assert.equal((await tools.execute('read_file', { filepath: 'readme.txt' }, ro)).output, 'needle here');
  assert.match((await tools.execute('search_text', { pattern: 'need.e' }, ro)).output, /readme\.txt:1: needle here/);
  assert.equal((await tools.execute('write_file', { filepath: 'x.txt', content: 'x' }, ro)).isError, true);
  assert.equal((await tools.execute('run_command', { command: 'echo hi' }, ro)).isError, true);
  await assert.rejects(fs.stat(path.join(tmpDir, 'x.txt')));

  const asked: string[] = [];
  const ask = {
    workspaceRoot: tmpDir,
    mode: 'ask' as const,
    requireApproval: async (name: string) => { asked.push(name); return name !== 'run_command'; }
  };
  await tools.execute('read_file', { filepath: 'readme.txt' }, ask);
  assert.equal((await tools.execute('write_file', { filepath: 'y.txt', content: 'y' }, ask)).isError, undefined);
  assert.equal((await tools.execute('run_command', { command: 'echo hi' }, ask)).isError, true);
  assert.deepEqual(asked, ['write_file', 'run_command'], 'reads are not interrupted for approval');

  // 'ask' with nobody to ask must fail closed.
  const noOne = await tools.execute('write_file', { filepath: 'z.txt', content: 'z' }, { workspaceRoot: tmpDir, mode: 'ask' });
  assert.equal(noOne.isError, true);

  const missing = await tools.execute('write_file', { filepath: 'only-path.txt' }, { workspaceRoot: tmpDir });
  assert.match(missing.error || '', /missing required argument "content"/);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('Tools: long output is truncated before it reaches the model', async () => {
  const tmpDir = await tmp('dockyard-trunc-');
  await fs.writeFile(path.join(tmpDir, 'big.txt'), 'x'.repeat(100_000));
  const res = await createStandardTools().execute('read_file', { filepath: 'big.txt' }, { workspaceRoot: tmpDir, maxOutputChars: 1000 });
  assert.ok(res.output.length < 1200);
  assert.match(res.output, /99000 characters truncated/);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('Planner: Checkpoint and state restoration', () => {
  const planner = new HierarchicalPlanner([
    { id: '1', title: 'Step 1', status: 'pending' },
    { id: '2', title: 'Step 2', status: 'pending' }
  ]);

  planner.startStep('1');
  planner.completeStep('1', 'Finished step 1');
  const cp = planner.createCheckpoint('Checkpoint 1', 'scratchpad test');

  planner.startStep('2');
  planner.completeStep('2', 'Finished step 2');
  assert.equal(planner.getSteps().filter(s => s.status === 'completed').length, 2);

  planner.restoreCheckpoint(cp.checkpointId);
  assert.equal(planner.getSteps().find(s => s.id === '1')?.status, 'completed');
  assert.equal(planner.getSteps().find(s => s.id === '2')?.status, 'pending');
});

test('Memory: persists, stays bounded, and ranks relevant episodes', async () => {
  const tmpDir = await tmp('dockyard-mem-');
  const mem = new MemoryEngine(tmpDir, { maxHeuristics: 3 });
  await mem.init();
  for (const h of ['one', 'two', 'three', 'four', 'four']) mem.addHeuristic(h);
  assert.deepEqual(mem.getHeuristics(), ['two', 'three', 'four']);

  mem.addEpisodicMemory({ task: 'Fix the login redirect', outcome: 'success', learnedLesson: 'check middleware', tags: [] });
  mem.addEpisodicMemory({ task: 'Update docs', outcome: 'success', learnedLesson: 'none', tags: [] });
  assert.equal(mem.getEpisodicCount(), 2);
  assert.equal(mem.getRelevantMemories('login bug')[0].task, 'Fix the login redirect');
  assert.equal(mem.getRelevantMemories('').length, 0);
  await mem.save();

  const reloaded = new MemoryEngine(tmpDir);
  await reloaded.init();
  assert.equal(reloaded.getEpisodicCount(), 2);

  // A named agent keeps its own memory file.
  const scoped = new MemoryEngine(tmpDir, { namespace: 'reviewer' });
  await scoped.init();
  assert.equal(scoped.getEpisodicCount(), 0);
  assert.throws(() => new MemoryEngine(tmpDir, { namespace: '../escape' }));

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('RL: reward counts only measured signals', async () => {
  const tmpDir = await tmp('dockyard-rl-');
  const recorder = new TrajectoryRecorder(tmpDir);
  await recorder.init();

  recorder.startTrajectory('Test task');
  recorder.recordStep('Initial thought');
  const unverified = await recorder.finishTrajectory({ taskGoalAchieved: true });
  assert.equal(unverified.finalReward, 1.0, 'no bonus for tests that never ran');
  assert.equal(unverified.rewardBreakdown.testsPassed, undefined);

  recorder.startTrajectory('Test task');
  recorder.recordStep('t', { id: 'c1', name: 'run_command', arguments: {} }, { callId: 'c1', output: '', error: 'boom', isError: true });
  const failed = await recorder.finishTrajectory({ taskGoalAchieved: true, testsPassed: false });
  assert.ok(Math.abs(failed.finalReward - 0.4) < 1e-9, 'failing verification and tool errors lower the reward');

  const rated = await recorder.applyHumanFeedback(unverified.trajectoryId, 1);
  assert.equal(rated?.finalReward, 2.0);

  // A fresh recorder sees earlier sessions and can build preference pairs from them.
  const later = new TrajectoryRecorder(tmpDir);
  assert.equal((await later.loadAll()).length, 2);
  const pairs = later.exportDPOPairs();
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].sourceTrajectoryId, unverified.trajectoryId);
  assert.equal(pairs[0].rejectedTrajectoryId, failed.trajectoryId);
  assert.match(pairs[0].rejected, /ACTION: run_command/);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('Agent: End-to-end loop with MockModelProvider', async () => {
  const tmpDir = await tmp('dockyard-agent-');
  const mockProvider = new MockModelProvider([
    {
      content: 'I will write the greeting file',
      toolCalls: [
        { id: 'call-1', name: 'write_file', arguments: { filepath: 'greeting.txt', content: 'Dockyard Agent Active' } }
      ]
    },
    { content: 'Greeting file has been successfully written and verified.' }
  ]);

  const agent = new DockyardAgent({ workspaceRoot: tmpDir, model: mockProvider });

  const res = await agent.run('Create greeting file');
  assert.equal(res.succeeded, true);
  assert.equal(res.stopReason, 'completed');
  assert.ok(res.trajectory.steps.length >= 2);
  assert.equal(res.trajectory.steps[0].toolResult?.callId, 'call-1');
  assert.equal(res.trajectory.finalReward, 1.0);
  assert.deepEqual(res.reflection?.identifiedHeuristics, [], 'no lessons are invented when the model gives no critique');

  const checkFile = await fs.readFile(path.join(tmpDir, 'greeting.txt'), 'utf-8');
  assert.equal(checkFile, 'Dockyard Agent Active');

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('Agent: verify command decides success and feeds the reward', async () => {
  const tmpDir = await tmp('dockyard-verify-');
  const pass = new DockyardAgent({
    workspaceRoot: tmpDir,
    model: new MockModelProvider([{ content: 'Done.' }]),
    verifyCommand: 'node -e "process.exit(0)"',
    reflect: false
  });
  const ok = await pass.run('noop');
  assert.equal(ok.succeeded, true);
  assert.equal(ok.verified, true);
  assert.equal(ok.trajectory.finalReward, 1.5);

  const fail = new DockyardAgent({
    workspaceRoot: tmpDir,
    model: new MockModelProvider([{ content: 'All done, tests pass!' }]),
    verifyCommand: 'node -e "process.exit(1)"',
    reflect: false
  });
  const bad = await fail.run('noop');
  assert.equal(bad.succeeded, false, 'the model saying it is done is not enough');
  assert.equal(bad.verified, false);
  assert.equal(bad.trajectory.rewardBreakdown.testsPassed, false);
  assert.match(bad.summary, /Verification failed/);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('Agent: reports iteration limit and model failures instead of claiming success', async () => {
  const tmpDir = await tmp('dockyard-limits-');
  const looping = new MockModelProvider(
    Array.from({ length: 5 }, (_, i) => ({ content: 'again', toolCalls: [{ id: `c${i}`, name: 'list_files', arguments: {} }] }))
  );
  const capped = await new DockyardAgent({ workspaceRoot: tmpDir, model: looping, maxIterations: 3, reflect: false }).run('loop');
  assert.equal(capped.succeeded, false);
  assert.equal(capped.stopReason, 'max_iterations');
  assert.equal(capped.trajectory.finalReward, 0);

  const broken = { name: 'broken', complete: async () => { throw new Error('upstream 500'); } };
  const errored = await new DockyardAgent({ workspaceRoot: tmpDir, model: broken }).run('anything');
  assert.equal(errored.succeeded, false);
  assert.equal(errored.stopReason, 'error');
  assert.match(errored.summary, /upstream 500/);
  const saved = await fs.readdir(path.join(tmpDir, '.dockyard', 'trajectories'));
  assert.equal(saved.length, 2, 'failed runs are still recorded');

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('Agent: plan tool drives the planner, AGENTS.md is loaded, read-only is enforced', async () => {
  const tmpDir = await tmp('dockyard-plan-');
  await fs.writeFile(path.join(tmpDir, 'AGENTS.md'), 'Always use tabs in this repo.');
  const model = new MockModelProvider([
    { content: 'Planning', toolCalls: [{ id: 'p1', name: 'update_plan', arguments: { steps: [{ title: 'Inspect', status: 'in_progress' }, { title: 'Change', status: 'pending' }] } }] },
    { content: 'Trying a write', toolCalls: [{ id: 'w1', name: 'write_file', arguments: { filepath: 'nope.txt', content: 'x' } }] },
    { content: 'Progress', toolCalls: [{ id: 'p2', name: 'update_plan', arguments: { steps: [{ title: 'Inspect', status: 'completed' }, { title: 'Change', status: 'skipped' }] } }] },
    { content: 'Finished: nothing could be changed in read-only mode.' }
  ]);
  const seen: string[] = [];
  const agent = new DockyardAgent({
    workspaceRoot: tmpDir,
    model,
    mode: 'read-only',
    reflect: false,
    onStepProgress: s => seen.push(`${s.title}:${s.status}`)
  });
  const res = await agent.run('Do the thing');

  assert.match(model.callHistory[0].messages[0].content, /Always use tabs in this repo/);
  assert.match(model.callHistory[0].messages[0].content, /Permission mode: read-only/);
  assert.deepEqual(agent.planner.getSteps().map(s => s.status), ['completed', 'skipped']);
  assert.deepEqual(seen, ['Inspect:in_progress', 'Change:pending', 'Inspect:completed', 'Change:skipped']);
  assert.ok(agent.planner.getCheckpoints().some(c => c.description === 'Completed: Inspect'));
  assert.equal(res.trajectory.steps[1].toolResult?.isError, true);
  await assert.rejects(fs.stat(path.join(tmpDir, 'nope.txt')));

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('Agent: chat sessions carry the conversation forward', async () => {
  const tmpDir = await tmp('dockyard-chat-');
  const model = new MockModelProvider([{ content: 'First answer' }, { content: 'Second answer' }, { content: 'Fresh' }]);
  const agent = new DockyardAgent({ workspaceRoot: tmpDir, model, reflect: false });

  await agent.run('first question', { resume: true });
  await agent.run('second question', { resume: true });
  const second = model.callHistory[1].messages.map(m => m.content);
  assert.ok(second.includes('first question') && second.includes('First answer') && second.includes('second question'));

  agent.resetSession();
  await agent.run('third question', { resume: true });
  assert.ok(!model.callHistory[2].messages.some(m => m.content === 'first question'));

  await fs.rm(tmpDir, { recursive: true, force: true });
});
