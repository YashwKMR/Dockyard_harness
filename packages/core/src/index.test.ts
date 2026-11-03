import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { createStandardTools } from './tools/registry.js';
import { HierarchicalPlanner } from './planner/hierarchical.js';
import { TrajectoryRecorder } from './rl/trajectory.js';
import { MemoryEngine } from './memory/engine.js';
import { MockModelProvider, createModelProvider, OpenAICompatibleProvider, AnthropicProvider } from './models/providers.js';
import { DockyardAgent } from './agent.js';

test('Provider Factory: Supports all cloud and local providers', () => {
  // OpenRouter
  const openrouter = createModelProvider({ provider: 'openrouter', apiKey: 'test-or' });
  assert.equal(openrouter.name, 'openrouter');
  assert.equal((openrouter as OpenAICompatibleProvider).baseURL, 'https://openrouter.ai/api/v1');

  // NVIDIA NIM
  const nvidia = createModelProvider({ provider: 'nvidia', apiKey: 'test-nv' });
  assert.equal(nvidia.name, 'nvidia');
  assert.equal((nvidia as OpenAICompatibleProvider).baseURL, 'https://integrate.api.nvidia.com/v1');

  // Anthropic
  const anthropic = createModelProvider({ provider: 'anthropic', apiKey: 'test-ant' });
  assert.equal(anthropic.name, 'anthropic');

  // Gemini
  const gemini = createModelProvider({ provider: 'gemini', apiKey: 'test-gemini' });
  assert.equal(gemini.name, 'gemini');

  // MiniMax
  const minimax = createModelProvider({ provider: 'minimax', apiKey: 'test-minimax' });
  assert.equal(minimax.name, 'minimax');

  // Cloudflare
  const cf = createModelProvider({ provider: 'cloudflare', apiKey: 'test-cf', accountId: 'acc123' });
  assert.equal(cf.name, 'cloudflare');
  assert.ok((cf as OpenAICompatibleProvider).baseURL.includes('acc123'));

  // Groq
  const groq = createModelProvider({ provider: 'groq', apiKey: 'test-groq' });
  assert.equal(groq.name, 'groq');

  // Cerebras
  const cerebras = createModelProvider({ provider: 'cerebras', apiKey: 'test-cerebras' });
  assert.equal(cerebras.name, 'cerebras');

  // Local Ollama
  const ollama = createModelProvider({ provider: 'ollama' });
  assert.equal(ollama.name, 'ollama');
  assert.equal((ollama as OpenAICompatibleProvider).baseURL, 'http://localhost:11434/v1');

  // Local LM Studio
  const lmstudio = createModelProvider({ provider: 'lmstudio' });
  assert.equal(lmstudio.name, 'lmstudio');
  assert.equal((lmstudio as OpenAICompatibleProvider).baseURL, 'http://localhost:1234/v1');

  // Local vLLM
  const vllm = createModelProvider({ provider: 'vllm' });
  assert.equal(vllm.name, 'vllm');
  assert.equal((vllm as OpenAICompatibleProvider).baseURL, 'http://localhost:8000/v1');
});

test('Tools: Read, write, and edit with diff', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dockyard-test-'));
  const tools = createStandardTools();

  const writeRes = await tools.execute('write_file', {
    filepath: 'sample.txt',
    content: 'hello world\nalpha\nbeta\n'
  }, { workspaceRoot: tmpDir });
  assert.equal(writeRes.isError, undefined);

  const readRes = await tools.execute('read_file', {
    filepath: 'sample.txt'
  }, { workspaceRoot: tmpDir });
  assert.equal(readRes.output, 'hello world\nalpha\nbeta\n');

  const diffRes = await tools.execute('edit_file_diff', {
    filepath: 'sample.txt',
    diff: `<<<<<<< SEARCH\nalpha\n=======\ngamma\n>>>>>>> REPLACE`
  }, { workspaceRoot: tmpDir });
  assert.equal(diffRes.isError, undefined);

  const verifyRead = await tools.execute('read_file', { filepath: 'sample.txt' }, { workspaceRoot: tmpDir });
  assert.ok(verifyRead.output.includes('gamma'));
  assert.ok(!verifyRead.output.includes('alpha'));

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

test('Memory & RL: Trajectory recording and heuristics', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dockyard-mem-'));
  const mem = new MemoryEngine(tmpDir);
  await mem.init();
  mem.addHeuristic('Always write tests first');
  assert.equal(mem.getHeuristics().length, 1);

  const recorder = new TrajectoryRecorder(tmpDir);
  await recorder.init();
  recorder.startTrajectory('Test task');
  recorder.recordStep('Initial thought');
  const finished = await recorder.finishTrajectory({ taskGoalAchieved: true, testsPassed: true });
  assert.ok(finished.finalReward > 0);

  await fs.rm(tmpDir, { recursive: true, force: true });
});

test('Agent: End-to-end loop with MockModelProvider', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dockyard-agent-'));
  const mockProvider = new MockModelProvider([
    {
      content: 'I will write the greeting file',
      toolCalls: [
        {
          id: 'call-1',
          name: 'write_file',
          arguments: { filepath: 'greeting.txt', content: 'Dockyard Agent Active' }
        }
      ]
    },
    {
      content: 'Greeting file has been successfully written and verified.'
    }
  ]);

  const agent = new DockyardAgent({
    workspaceRoot: tmpDir,
    model: mockProvider
  });

  const res = await agent.run('Create greeting file');
  assert.equal(res.succeeded, true);
  assert.ok(res.trajectory.steps.length >= 2);

  const checkFile = await fs.readFile(path.join(tmpDir, 'greeting.txt'), 'utf-8');
  assert.equal(checkFile, 'Dockyard Agent Active');

  await fs.rm(tmpDir, { recursive: true, force: true });
});
