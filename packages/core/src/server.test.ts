import test from 'node:test';
import assert from 'node:assert/strict';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { AddressInfo } from 'node:net';
import { createDockyardServer } from './server/index.js';
import { MockModelProvider } from './models/providers.js';

async function start(options: Partial<Parameters<typeof createDockyardServer>[0]> = {}) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dockyard-server-')));
  const created = createDockyardServer({ workspaceRoot: dir, token: 'test-token', model: new MockModelProvider(), ...options });
  await new Promise<void>(resolve => created.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(created.server.address() as AddressInfo).port}`;
  const auth = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
  const stop = async () => {
    await new Promise(resolve => created.server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  };
  return { ...created, dir, base, auth, stop };
}

test('Server: requires the bearer token and only trusts local browser origins', async () => {
  const s = await start();
  try {
    assert.equal((await fetch(`${s.base}/api/status`)).status, 401);
    assert.equal((await fetch(`${s.base}/api/status`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(`${s.base}/api/run`, { method: 'POST', body: '{"task":"x"}' })).status, 401);

    const ok = await fetch(`${s.base}/api/status`, { headers: s.auth });
    assert.equal(ok.status, 200);
    const status: any = await ok.json();
    assert.equal(status.mode, 'read-only');
    assert.equal(status.provider, 'mock');

    const foreign = await fetch(`${s.base}/api/status`, { headers: { ...s.auth, Origin: 'https://evil.example' } });
    assert.equal(foreign.headers.get('access-control-allow-origin'), null);
    const local = await fetch(`${s.base}/api/status`, { headers: { ...s.auth, Origin: 'http://localhost:5173' } });
    assert.equal(local.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  } finally {
    await s.stop();
  }
});

test('Server: validates input, runs tasks, records feedback', async () => {
  const s = await start();
  try {
    const post = (route: string, body: string) => fetch(`${s.base}${route}`, { method: 'POST', headers: s.auth, body });

    assert.equal((await post('/api/run', '{}')).status, 400);
    assert.equal((await post('/api/run', 'not json')).status, 400);
    assert.equal((await post('/api/run', JSON.stringify({ task: 'x'.repeat(2 * 1024 * 1024) })).catch(() => ({ status: 413 }))).status, 413);
    assert.equal((await fetch(`${s.base}/api/nope`, { headers: s.auth })).status, 404);

    const run = await post('/api/run', JSON.stringify({ task: 'Check workspace' }));
    assert.equal(run.status, 200);
    const result: any = await run.json();
    assert.equal(result.succeeded, true);
    assert.equal(result.trajectory.finalReward, 1.0);

    const fb = await post('/api/feedback', JSON.stringify({ trajectoryId: result.trajectory.trajectoryId, score: -1 }));
    assert.equal(((await fb.json()) as any).finalReward, 0);
    assert.equal((await post('/api/feedback', JSON.stringify({ trajectoryId: 'missing', score: 1 }))).status, 404);
    assert.equal((await post('/api/feedback', JSON.stringify({ trajectoryId: 'x', score: 5 }))).status, 400);

    const list: any = await (await fetch(`${s.base}/api/trajectories`, { headers: s.auth })).json();
    assert.equal(list.trajectories.length, 1);
  } finally {
    await s.stop();
  }
});

test('Server: read-only by default, so an HTTP task cannot change the workspace', async () => {
  const model = new MockModelProvider([
    { content: 'writing', toolCalls: [{ id: 'w', name: 'write_file', arguments: { filepath: 'pwned.txt', content: 'x' } }] },
    { content: 'running', toolCalls: [{ id: 'c', name: 'run_command', arguments: { command: 'node -e "require(\'fs\').writeFileSync(\'pwned2.txt\',\'x\')"' } }] },
    { content: 'done' }
  ]);
  const s = await start({ model });
  try {
    const run = await fetch(`${s.base}/api/run`, { method: 'POST', headers: s.auth, body: JSON.stringify({ task: 'try it' }) });
    const result: any = await run.json();
    assert.equal(result.trajectory.steps[0].toolResult.isError, true);
    assert.equal(result.trajectory.steps[1].toolResult.isError, true);
    await assert.rejects(fs.stat(path.join(s.dir, 'pwned.txt')));
    await assert.rejects(fs.stat(path.join(s.dir, 'pwned2.txt')));
  } finally {
    await s.stop();
  }
});

test('Server: providers, teammates and memory endpoints', async () => {
  const s = await start({ mode: 'auto' });
  try {
    const get = async (route: string) => (await fetch(`${s.base}${route}`, { headers: s.auth })).json() as Promise<any>;
    const post = (route: string, body: unknown) => fetch(`${s.base}${route}`, { method: 'POST', headers: s.auth, body: JSON.stringify(body) });

    const providers = await get('/api/providers');
    assert.equal(providers.active, 'mock');
    const ids = providers.providers.map((p: any) => p.id);
    for (const id of ['openai', 'anthropic', 'gemini', 'glm', 'qwen', 'minimax']) assert.ok(ids.includes(id));
    assert.equal(providers.providers.find((p: any) => p.id === 'anthropic').defaultModel, 'claude-opus-5-5');

    assert.equal((await post('/api/agents', { name: 'Bad Name', description: 'x', instructions: 'y' })).status, 400);
    assert.equal((await post('/api/agents', { name: 'reviewer', description: 'Reviews', instructions: 'Review.', mode: 'read-only' })).status, 200);
    assert.deepEqual((await get('/api/agents')).agents.map((a: any) => a.name), ['reviewer']);

    const asAgent: any = await (await post('/api/run', { task: 'look', agent: 'reviewer' })).json();
    assert.equal(asAgent.trajectory.metadata.agent, 'reviewer');
    assert.equal(asAgent.trajectory.metadata.mode, 'read-only');
    assert.equal((await post('/api/run', { task: 'look', agent: 'ghost' })).status, 404);
    assert.equal((await post('/api/run', { task: 'look', provider: 'nope' })).status, 400);
    assert.equal((await post('/api/run', { task: 'look', mode: 'root' })).status, 400);

    const del = await fetch(`${s.base}/api/agents/reviewer`, { method: 'DELETE', headers: s.auth });
    assert.equal(del.status, 200);
    assert.equal((await fetch(`${s.base}/api/agents/reviewer`, { method: 'DELETE', headers: s.auth })).status, 404);

    await fs.mkdir(path.join(s.dir, '.dockyard'), { recursive: true });
    await fs.writeFile(path.join(s.dir, '.dockyard', 'memory.json'), JSON.stringify({ episodic: [], heuristics: ['keep', 'drop'] }));
    assert.deepEqual((await get('/api/memory')).heuristics, ['keep', 'drop']);
    assert.equal(((await (await post('/api/memory/forget', { heuristic: 'drop' })).json()) as any).removed, true);
    assert.deepEqual((await get('/api/memory')).heuristics, ['keep']);

    const dpo = await fetch(`${s.base}/api/dpo`, { headers: s.auth });
    assert.equal(dpo.status, 200);
    assert.equal(dpo.headers.get('x-dockyard-pairs'), '0');
  } finally {
    await s.stop();
  }
});

test('Server: background run with approvals through the API, as the app uses it', async () => {
  const model = new MockModelProvider([
    { content: 'Plan first', toolCalls: [{ id: 'p', name: 'update_plan', arguments: { steps: [{ title: 'Write file', status: 'in_progress' }] } }] },
    { content: 'Writing', toolCalls: [{ id: 'w1', name: 'write_file', arguments: { filepath: 'approved.txt', content: 'yes' } }] },
    { content: 'Writing another', toolCalls: [{ id: 'w2', name: 'write_file', arguments: { filepath: 'denied.txt', content: 'no' } }] },
    { content: 'All done.' }
  ]);
  const s = await start({ model, mode: 'ask' });
  try {
    const post = (route: string, body: unknown) => fetch(`${s.base}${route}`, { method: 'POST', headers: s.auth, body: JSON.stringify(body) });
    const current = async () => (await fetch(`${s.base}/api/run/current`, { headers: s.auth })).json() as Promise<any>;
    const until = async (cond: (r: any) => boolean) => {
      for (let i = 0; i < 200; i++) {
        const r = await current();
        if (cond(r)) return r;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error('timed out waiting for run state');
    };

    assert.equal((await current()).running, false);
    const started = await post('/api/run', { task: 'make files', wait: false });
    assert.equal(started.status, 202);
    assert.equal((await post('/api/run', { task: 'second', wait: false })).status, 409);

    const first = await until(r => r.pendingApproval);
    assert.equal(first.running, true);
    assert.equal(first.pendingApproval.tool, 'write_file');
    assert.equal(first.pendingApproval.args.filepath, 'approved.txt');
    assert.equal(first.plan[0].title, 'Write file');
    assert.equal((await post('/api/approve', { id: 'wrong', allow: true })).status, 404);
    await assert.rejects(fs.stat(path.join(s.dir, 'approved.txt')), 'nothing is written before approval');
    await post('/api/approve', { id: first.pendingApproval.id, allow: true });

    const second = await until(r => r.pendingApproval && r.pendingApproval.args.filepath === 'denied.txt');
    await post('/api/approve', { id: second.pendingApproval.id, allow: false });

    const done = await until(r => !r.running && r.result);
    assert.equal(done.result.succeeded, true);
    assert.equal(done.result.summary, 'All done.');
    assert.equal(await fs.readFile(path.join(s.dir, 'approved.txt'), 'utf-8'), 'yes');
    await assert.rejects(fs.stat(path.join(s.dir, 'denied.txt')));
    assert.ok(done.events.some((e: any) => e.kind === 'tool' && e.ok === false), 'the denied call is in the log');
    assert.equal(done.steps.length, 4);
  } finally {
    await s.stop();
  }
});

test('Server: a running task can be cancelled, and the mode in a request cannot exceed the server limit', async () => {
  const looping = new MockModelProvider(
    Array.from({ length: 50 }, (_, i) => ({ content: 'again', toolCalls: [{ id: `c${i}`, name: 'write_file', arguments: { filepath: `f${i}.txt`, content: 'x' } }] }))
  );
  const s = await start({ model: looping, mode: 'ask' });
  try {
    const post = (route: string, body: unknown) => fetch(`${s.base}${route}`, { method: 'POST', headers: s.auth, body: JSON.stringify(body) });
    assert.equal((await post('/api/run/cancel', {})).status, 409);
    // Asking for auto on an ask-limited server still requires approval.
    await post('/api/run', { task: 'loop', wait: false, mode: 'auto' });
    let state: any;
    for (let i = 0; i < 200; i++) {
      state = await (await fetch(`${s.base}/api/run/current`, { headers: s.auth })).json();
      if (state.pendingApproval) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(state.mode, 'ask');
    assert.ok(state.pendingApproval);
    assert.equal((await post('/api/run/cancel', {})).status, 200);
    for (let i = 0; i < 200 && state.running; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
      state = await (await fetch(`${s.base}/api/run/current`, { headers: s.auth })).json();
    }
    assert.equal(state.running, false);
    assert.equal(state.result.stopReason, 'cancelled');
    assert.equal(state.result.succeeded, false);
    await assert.rejects(fs.stat(path.join(s.dir, 'f0.txt')));
    assert.equal((await post('/api/run', { task: 'x', verify: 'echo hi' })).status, 403);
  } finally {
    await s.stop();
  }
});

test('Server: serves the app files without a token but never the API', async () => {
  const ui = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dockyard-ui-')));
  await fs.mkdir(path.join(ui, 'assets'));
  await fs.writeFile(path.join(ui, 'index.html'), '<!doctype html><title>Dockyard</title>');
  await fs.writeFile(path.join(ui, 'assets', 'app.js'), 'console.log(1)');
  await fs.writeFile(path.join(ui, '..', 'outside-secret.txt'), 'SECRET').catch(() => undefined);
  const s = await start({ staticDir: ui });
  try {
    const index = await fetch(`${s.base}/`);
    assert.equal(index.status, 200);
    assert.match(index.headers.get('content-type') || '', /text\/html/);
    assert.match(await index.text(), /Dockyard/);
    const js = await fetch(`${s.base}/assets/app.js`);
    assert.match(js.headers.get('content-type') || '', /javascript/);
    assert.equal((await fetch(`${s.base}/some/client/route`)).status, 200, 'unknown pages fall back to the app shell');
    assert.equal((await fetch(`${s.base}/missing.js`)).status, 404);
    assert.equal((await fetch(`${s.base}/api/status`)).status, 401);
    const escape = await fetch(`${s.base}/..%2Foutside-secret.txt`);
    assert.ok(!(await escape.text()).includes('SECRET'));
  } finally {
    await s.stop();
    await fs.rm(ui, { recursive: true, force: true });
    await fs.rm(path.join(ui, '..', 'outside-secret.txt'), { force: true });
  }
});

test('Server: a teammate handoff shows when it starts, and approvals say which agent is asking', async () => {
  const model = new MockModelProvider([
    { content: 'Handing off', toolCalls: [{ id: 'd1', name: 'delegate_task', arguments: { agent: 'builder', task: 'Create out.txt' } }] },
    { content: 'Writing', toolCalls: [{ id: 'b1', name: 'write_file', arguments: { filepath: 'out.txt', content: 'x' } }] },
    { content: 'Done writing.' },
    { content: 'not json' }, // the teammate's reflection pass
    { content: 'The builder created out.txt.' }
  ]);
  const s = await start({ model, mode: 'ask' });
  try {
    const post = (route: string, body: unknown) => fetch(`${s.base}${route}`, { method: 'POST', headers: s.auth, body: JSON.stringify(body) });
    const current = async () => (await fetch(`${s.base}/api/run/current`, { headers: s.auth })).json() as Promise<any>;
    assert.equal((await post('/api/agents', { name: 'builder', description: 'Writes files', instructions: 'Build.' })).status, 200);
    await post('/api/run', { task: 'make out.txt', wait: false });

    let state: any;
    for (let i = 0; i < 200 && !state?.pendingApproval; i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
      state = await current();
    }
    assert.equal(state.pendingApproval.agent, 'builder', 'the request is attributed to the teammate, not the lead');
    const handoff = state.events.find((e: any) => e.kind === 'delegate');
    assert.equal(handoff?.args.agent, 'builder', 'the handoff is visible while the teammate is still working');

    await post('/api/approve', { id: state.pendingApproval.id, allow: true });
    for (let i = 0; i < 200 && (state.running || !state.result); i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
      state = await current();
    }
    assert.equal(state.result.succeeded, true);
    const order = state.events.map((e: any) => `${e.kind}:${e.agent ?? ''}:${e.tool ?? ''}`);
    const start_ = order.indexOf('delegate:dockyard:delegate_task');
    const work = order.indexOf('tool:builder:write_file');
    const done = order.indexOf('tool:dockyard:delegate_task');
    assert.ok(start_ >= 0 && start_ < work && work < done, order.join(' | '));
    assert.equal(await fs.readFile(path.join(s.dir, 'out.txt'), 'utf-8'), 'x');
  } finally {
    await s.stop();
  }
});
