import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import {
  MultiProviderHub,
  ToolRegistry,
  HierarchicalPlanner,
  MemoryEngine,
  TrajectoryRecorder,
  SelfImprovementEngine,
  AutonomousAgent,
  DockyardServer,
} from './index.js';

describe('Dockyard Core Modules', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dockyard-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('MultiProviderHub completes mock queries across providers', async () => {
    const hub = new MultiProviderHub();
    const res = await hub.complete('openrouter', [{ role: 'user', content: 'hello' }]);
    expect(res).toBeDefined();
    expect(res.provider).toBe('openrouter');
    expect(res.content).toContain('Completed task request');
  });

  it('ToolRegistry executes filesystem tools safely', async () => {
    const registry = new ToolRegistry();
    const context = { workingDirectory: tmpDir };

    // write
    const writeRes = await registry.execute(
      'write_file',
      { filepath: 'test.txt', content: 'Dockyard Harness Works' },
      context
    );
    expect(writeRes.success).toBe(true);

    // read
    const readRes = await registry.execute('read_file', { filepath: 'test.txt' }, context);
    expect(readRes.success).toBe(true);
    expect(readRes.output).toBe('Dockyard Harness Works');

    // list
    const listRes = await registry.execute('list_files', {}, context);
    expect(listRes.success).toBe(true);
    expect(listRes.output).toContain('test.txt');
  });

  it('HierarchicalPlanner creates snapshots and tracks milestones', () => {
    const planner = new HierarchicalPlanner();
    planner.setPlan([
      {
        id: 'm1',
        title: 'Step 1',
        objective: 'First objective',
        status: 'pending',
        subtasks: [{ id: 's1', title: 'Sub 1', description: 'desc', status: 'pending', attempts: 0 }],
        dependencies: [],
      },
    ]);

    expect(planner.getMilestones().length).toBe(1);
    planner.updateMilestoneStatus('m1', 'in_progress');
    expect(planner.getCurrentMilestone()?.status).toBe('in_progress');

    planner.updateSubtask('m1', 's1', { status: 'completed' });
    expect(planner.isComplete()).toBe(true);
    expect(planner.getSnapshots().length).toBeGreaterThan(1);
  });

  it('MemoryEngine stores, retrieves, and formats memory categories', () => {
    const mem = new MemoryEngine();
    mem.set('heuristic', 'test_rule', 'Always verify tool execution results', ['testing']);
    mem.set('scratchpad', 'current_focus', 'Unit testing memory engine');

    expect(mem.get('test_rule')?.value).toBe('Always verify tool execution results');
    expect(mem.listByCategory('heuristic').length).toBe(1);
    expect(mem.formatForPrompt()).toContain('Learned Rules & Heuristics');
  });

  it('TrajectoryRecorder logs steps and exports DPO pairs', () => {
    const recorder = new TrajectoryRecorder();
    recorder.startTrajectory('t1', 'Fix bug in auth', 'openrouter', 'claude-3.5-sonnet');

    recorder.recordStep(
      'Need to test failing command',
      { toolName: 'execute_command', args: { command: 'cat nonexistent.txt' } },
      { success: false, output: '', error: 'File not found' },
      -0.5
    );

    recorder.recordStep(
      'Retry with correct command',
      { toolName: 'execute_command', args: { command: 'echo fixed' } },
      { success: true, output: 'fixed' },
      1.0
    );

    const traj = recorder.finishTrajectory('success');
    expect(traj.steps.length).toBe(2);
    expect(traj.totalReward).toBe(0.5);

    const dpoPairs = recorder.exportDPOPairs();
    expect(dpoPairs.length).toBe(1);
    expect(dpoPairs[0].margin).toBe(1.5);
    expect(dpoPairs[0].chosen.toolCall.arguments.command).toBe('echo fixed');
  });

  it('SelfImprovementEngine distills heuristics from failed executions', () => {
    const recorder = new TrajectoryRecorder();
    const memory = new MemoryEngine();
    const selfImprovement = new SelfImprovementEngine();

    recorder.startTrajectory('t2', 'Run build', 'groq', 'llama-3.3-70b');
    recorder.recordStep(
      'Attempt build',
      { toolName: 'execute_command', args: { command: 'npm run build' } },
      { success: false, output: '', error: 'missing package.json' }
    );
    const traj = recorder.finishTrajectory('failure');

    const critique = selfImprovement.critiqueAndDistill(traj, memory);
    expect(critique.extractedHeuristics.length).toBeGreaterThan(0);
    expect(memory.listByCategory('error_recovery').length).toBeGreaterThan(0);
  });

  it('AutonomousAgent completes full workflow loop', async () => {
    const agent = new AutonomousAgent({ workingDirectory: tmpDir });
    const result = await agent.run('Write test notes to notes.txt');
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    expect(result.trajectory).toBeDefined();
  });

  it('DockyardServer responds to health and RPC endpoints', async () => {
    const server = new DockyardServer({ port: 4899, agentConfig: { workingDirectory: tmpDir } });
    const port = await server.start();
    expect(port).toBe(4899);

    const res = await fetch(`http://localhost:${port}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe('ok');

    await server.stop();
  });
});
