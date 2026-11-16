import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { AgentStore, validateAgentDefinition } from './agents/store.js';
import { DockyardAgent } from './agent.js';
import { ChatMessage, ModelCompletionOptions, ModelCompletionResponse, ModelProvider } from './models/types.js';

async function tmp(prefix: string): Promise<string> {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
}

/** One scripted model shared by lead and teammates; answers depend on which agent is asking. */
class RoleAwareModel implements ModelProvider {
  name = 'role-aware-mock';
  calls: { system: string; tools: string[] }[] = [];
  constructor(private script: (system: string, messages: ChatMessage[]) => ModelCompletionResponse) {}
  async complete(messages: ChatMessage[], options?: ModelCompletionOptions): Promise<ModelCompletionResponse> {
    const system = messages[0].content;
    this.calls.push({ system, tools: (options?.tools || []).map(t => t.name) });
    return this.script(system, messages);
  }
}

test('AgentStore: create, list, validate, delete', async () => {
  const dir = await tmp('dockyard-store-');
  const store = new AgentStore(dir);
  assert.deepEqual(await store.list(), []);

  await store.save({ name: 'reviewer', description: 'Reviews diffs', instructions: 'Review carefully.', tools: ['read_file'], mode: 'read-only' });
  await store.save({ name: 'builder', description: 'Implements changes', instructions: 'Write code.' });
  assert.deepEqual((await store.list()).map(a => a.name), ['builder', 'reviewer']);
  assert.equal((await store.get('reviewer'))?.mode, 'read-only');
  assert.equal(await store.get('missing'), undefined);

  assert.throws(() => validateAgentDefinition({ name: '../evil', description: 'x', instructions: 'y' }), /Agent name/);
  assert.throws(() => validateAgentDefinition({ name: 'ok', description: '', instructions: 'y' }), /description/);
  assert.throws(() => validateAgentDefinition({ name: 'ok', description: 'x', instructions: 'y', mode: 'root' }), /mode/);
  assert.throws(() => validateAgentDefinition({ name: 'ok', description: 'x', instructions: 'y', provider: 'nope' }), /provider/);
  await assert.rejects(store.get('../../etc/passwd'), /Invalid agent name/);

  assert.equal(await store.delete('builder'), true);
  assert.equal(await store.delete('builder'), false);
  await fs.rm(dir, { recursive: true, force: true });
});

test('Teammates: lead delegates, teammate works under its own role, limits and memory', async () => {
  const dir = await tmp('dockyard-team-');
  await fs.writeFile(path.join(dir, 'app.js'), 'console.log("hi")\n');
  const store = new AgentStore(dir);
  await store.save({
    name: 'reviewer',
    description: 'Reviews code and reports problems. Cannot edit.',
    instructions: 'You are a meticulous code reviewer.',
    tools: ['read_file', 'write_file'],
    mode: 'read-only'
  });

  const model = new RoleAwareModel((system, messages) => {
    const turn = messages.filter(m => m.role === 'assistant').length;
    if (system.includes('meticulous code reviewer')) {
      if (turn === 0) return { content: 'Reading', toolCalls: [{ id: 'r1', name: 'read_file', arguments: { filepath: 'app.js' } }] };
      if (turn === 1) return { content: 'Try to fix it myself', toolCalls: [{ id: 'r2', name: 'write_file', arguments: { filepath: 'app.js', content: 'hacked' } }] };
      return { content: 'Review: app.js lacks a trailing semicolon.' };
    }
    if (turn === 0) return { content: 'Delegating review', toolCalls: [{ id: 'l1', name: 'delegate_task', arguments: { agent: 'reviewer', task: 'Review app.js' } }] };
    const report = messages[messages.length - 1].content;
    return { content: `Lead summary. Reviewer said: ${report}` };
  });

  const lead = new DockyardAgent({ workspaceRoot: dir, model, mode: 'auto', reflect: false });
  const res = await lead.run('Get app.js reviewed');

  assert.equal(res.succeeded, true);
  assert.match(res.summary, /lacks a trailing semicolon/);

  const leadCall = model.calls[0];
  assert.match(leadCall.system, /## Teammates[\s\S]*- reviewer: Reviews code/);
  assert.ok(leadCall.tools.includes('delegate_task'));

  const reviewerCall = model.calls.find(c => c.system.includes('meticulous code reviewer'))!;
  assert.deepEqual(reviewerCall.tools.sort(), ['read_file', 'update_plan', 'write_file'], 'tool allowlist applies; no one left to delegate to');
  assert.match(reviewerCall.system, /Permission mode: read-only/);
  assert.equal(await fs.readFile(path.join(dir, 'app.js'), 'utf-8'), 'console.log("hi")\n', 'read-only teammate could not write even though the lead is in auto mode');

  // Lead and teammate each leave their own trajectory, tagged with who ran it.
  const files = await fs.readdir(path.join(dir, '.dockyard', 'trajectories'));
  const agents = await Promise.all(files.map(async f => JSON.parse(await fs.readFile(path.join(dir, '.dockyard', 'trajectories', f), 'utf-8')).metadata.agent));
  assert.deepEqual(agents.sort(), ['dockyard', 'reviewer']);

  await fs.rm(dir, { recursive: true, force: true });
});

test('Teammates: a teammate never gets more authority than the agent delegating to it', async () => {
  const dir = await tmp('dockyard-cap-');
  const store = new AgentStore(dir);
  await store.save({ name: 'builder', description: 'Implements changes', instructions: 'You are the builder.', mode: 'auto' });

  const model = new RoleAwareModel((system, messages) => {
    const turn = messages.filter(m => m.role === 'assistant').length;
    if (system.includes('You are the builder')) {
      if (turn === 0) return { content: 'Writing', toolCalls: [{ id: 'b1', name: 'write_file', arguments: { filepath: 'out.txt', content: 'x' } }] };
      return { content: 'Could not write.' };
    }
    if (turn === 0) return { content: 'Delegating', toolCalls: [{ id: 'l1', name: 'delegate_task', arguments: { agent: 'builder', task: 'Create out.txt' } }] };
    return { content: 'Done.' };
  });

  await new DockyardAgent({ workspaceRoot: dir, model, mode: 'read-only', reflect: false }).run('Make a file');
  await assert.rejects(fs.stat(path.join(dir, 'out.txt')));
  await fs.rm(dir, { recursive: true, force: true });
});

test('Teammates: delegation depth is bounded and named agents keep separate memory', async () => {
  const dir = await tmp('dockyard-depth-');
  const store = new AgentStore(dir);
  await store.save({ name: 'alpha', description: 'A', instructions: 'You are alpha.' });
  await store.save({ name: 'beta', description: 'B', instructions: 'You are beta.' });

  let delegations = 0;
  const model = new RoleAwareModel((system, messages) => {
    const turn = messages.filter(m => m.role === 'assistant').length;
    const other = system.includes('You are alpha') ? 'beta' : 'alpha';
    const canDelegate = system.includes('## Teammates');
    if (turn === 0 && canDelegate) {
      return { content: 'Passing it on', toolCalls: [{ id: `d${++delegations}`, name: 'delegate_task', arguments: { agent: other, task: 'keep going' } }] };
    }
    return { content: 'Stopping here.' };
  });

  const res = await new DockyardAgent({ workspaceRoot: dir, model, maxDelegationDepth: 2 }).run('ping-pong');
  assert.equal(res.succeeded, true);
  const files = await fs.readdir(path.join(dir, '.dockyard', 'trajectories'));
  assert.equal(files.length, 3, 'lead -> teammate -> teammate, then delegation stops');

  const memories = (await fs.readdir(path.join(dir, '.dockyard', 'agent-memory'))).sort();
  assert.deepEqual(memories, ['alpha.json', 'beta.json']);
  await fs.rm(dir, { recursive: true, force: true });
});
