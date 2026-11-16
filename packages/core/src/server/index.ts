import * as http from 'node:http';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { DockyardAgent, RunTaskResult } from '../agent.js';
import { ModelProvider, ToolCall, ToolResult } from '../models/types.js';
import { createModelProvider, createProviderFromEnv, describeProviders, normalizeProvider } from '../models/providers.js';
import { PermissionMode, isPermissionMode, mostRestrictiveMode } from '../tools/registry.js';
import { MemoryEngine } from '../memory/engine.js';
import { PlanStep } from '../planner/hierarchical.js';
import { TrajectoryRecorder } from '../rl/trajectory.js';
import { AgentStore } from '../agents/store.js';

export interface ServerOptions {
  port?: number;
  /** Interface to bind. Defaults to loopback only. */
  host?: string;
  workspaceRoot: string;
  /** Bearer token required on every API request. Defaults to DOCKYARD_SERVER_TOKEN, else a random one. */
  token?: string;
  /**
   * The most a task submitted over HTTP may do. A request can ask for less, never more.
   * read-only (default): inspect only. ask: writes and commands wait for approval through
   * POST /api/approve. auto: no approval.
   */
  mode?: PermissionMode;
  /** Use this model for every run instead of the environment's provider (used by tests). */
  model?: ModelProvider;
  verifyCommand?: string;
  /** Directory of a built web UI to serve at "/". API routes stay under /api. */
  staticDir?: string;
}

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_EVENTS = 500;
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json'
};

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

interface RunEvent {
  at: number;
  kind: 'info' | 'thought' | 'tool' | 'delegate' | 'plan' | 'approval' | 'result' | 'error';
  agent?: string;
  text: string;
  ok?: boolean;
  /** For tool events: the tool name and its arguments, with long strings shortened for display. */
  tool?: string;
  args?: Record<string, unknown>;
  error?: string;
}

interface PendingApproval {
  id: string;
  tool: string;
  args: Record<string, any>;
  /** The agent asking: the lead, or a teammate it handed work to. */
  agent?: string;
  resolve: (allowed: boolean) => void;
}

interface RunState {
  runId: string;
  task: string;
  provider: string;
  model: string;
  mode: PermissionMode;
  agentName: string;
  startedAt: number;
  running: boolean;
  events: RunEvent[];
  plan: PlanStep[];
  pending?: PendingApproval;
  result?: RunTaskResult;
  error?: string;
  agent: DockyardAgent;
}

function readJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf-8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new HttpError(400, 'Request body must be valid JSON'));
      }
    });
  });
}

function displayArgs(args: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args || {})) {
    if (typeof value === 'string') {
      out[key] = value.length > 300 ? `${value.slice(0, 300)}... (${value.length} characters)` : value;
    } else if (key === 'steps' && Array.isArray(value)) {
      out[key] = `${value.length} step(s)`;
    } else {
      out[key] = value;
    }
  }
  return out;
}

function clip(value: unknown, max = 400): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

export function createDockyardServer(options: ServerOptions) {
  const port = options.port || 4040;
  const host = options.host || '127.0.0.1';
  const workspaceRoot = options.workspaceRoot;
  const token = options.token || process.env.DOCKYARD_SERVER_TOKEN || randomBytes(24).toString('hex');
  const envMode = process.env.DOCKYARD_MODE;
  const mode: PermissionMode = options.mode ?? (isPermissionMode(envMode) ? envMode : 'read-only');
  const staticDir = options.staticDir ? path.resolve(options.staticDir) : undefined;

  const recorder = new TrajectoryRecorder(workspaceRoot);
  const agentStore = new AgentStore(workspaceRoot);
  let current: RunState | undefined;

  const envDefault = () => {
    if (options.model) return { provider: options.model.name, modelName: (options.model as any).model || '' };
    const detected = createProviderFromEnv();
    return { provider: detected.provider as string, modelName: detected.modelName };
  };

  const authorized = (req: http.IncomingMessage): boolean => {
    const header = req.headers.authorization || '';
    const supplied = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
    const expected = Buffer.from(token);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  };

  const publicRun = (run: RunState | undefined) => {
    if (!run) return { running: false };
    const active = run.agent.trajectoryRecorder.getActiveTrajectory();
    return {
      running: run.running,
      runId: run.runId,
      task: run.task,
      provider: run.provider,
      model: run.model,
      mode: run.mode,
      agent: run.agentName,
      startedAt: run.startedAt,
      events: run.events,
      plan: run.plan,
      steps: run.result ? run.result.trajectory.steps : active?.steps || [],
      pendingApproval: run.pending ? { id: run.pending.id, tool: run.pending.tool, args: run.pending.args, agent: run.pending.agent } : null,
      result: run.result
        ? {
            succeeded: run.result.succeeded,
            summary: run.result.summary,
            stopReason: run.result.stopReason,
            verified: run.result.verified,
            iterations: run.result.iterations,
            usage: run.result.usage,
            trajectoryId: run.result.trajectory.trajectoryId,
            finalReward: run.result.trajectory.finalReward,
            rewardBreakdown: run.result.trajectory.rewardBreakdown,
            reflection: run.result.reflection
          }
        : null,
      error: run.error || null
    };
  };

  async function startRun(body: any): Promise<{ run: RunState; done: Promise<RunTaskResult> }> {
    const task = typeof body.task === 'string' ? body.task.trim() : '';
    if (!task) throw new HttpError(400, '"task" is required');
    if (current?.running) throw new HttpError(409, 'A task is already running');

    if (body.mode !== undefined && !isPermissionMode(body.mode)) {
      throw new HttpError(400, '"mode" must be one of: read-only, ask, auto');
    }
    const runMode = mostRestrictiveMode(mode, body.mode ?? mode);

    let model: ModelProvider;
    let providerName: string;
    try {
      if (body.provider) {
        const provider = normalizeProvider(body.provider);
        if (!provider) throw new HttpError(400, `Unknown provider "${body.provider}"`);
        model = createModelProvider({
          provider,
          model: typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined,
          apiKey: typeof body.apiKey === 'string' && body.apiKey ? body.apiKey : undefined,
          baseURL: typeof body.baseURL === 'string' && body.baseURL.trim() ? body.baseURL.trim() : undefined
        });
        providerName = provider;
      } else if (options.model) {
        model = options.model;
        providerName = options.model.name;
      } else {
        const detected = createProviderFromEnv();
        model = detected.model;
        providerName = detected.provider;
      }
    } catch (err: any) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, err?.message || 'Could not configure the model provider');
    }

    let definition;
    if (body.agent) {
      definition = await agentStore.get(String(body.agent)).catch(() => undefined);
      if (!definition) throw new HttpError(404, `No agent named "${body.agent}"`);
    }

    // A verify command is arbitrary shell, so a request may only supply one when the server allows unattended commands.
    let verifyCommand = options.verifyCommand;
    if (typeof body.verify === 'string' && body.verify.trim()) {
      if (mode !== 'auto') throw new HttpError(403, 'A verify command can only be set per request when the server runs in auto mode');
      verifyCommand = body.verify.trim();
    }

    const maxSteps = Number(body.maxSteps);
    const run = {
      runId: `run-${Date.now()}-${randomBytes(3).toString('hex')}`,
      task,
      provider: providerName,
      model: (model as any).model || '',
      mode: runMode,
      agentName: definition?.name || 'dockyard',
      startedAt: Date.now(),
      running: true,
      events: [] as RunEvent[],
      plan: [] as PlanStep[]
    } as RunState;

    const emit = (event: Omit<RunEvent, 'at'>) => {
      run.events.push({ at: Date.now(), ...event });
      if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS);
    };

    run.agent = new DockyardAgent({
      workspaceRoot,
      model,
      mode: runMode,
      definition,
      agentStore,
      verifyCommand,
      maxIterations: Number.isInteger(maxSteps) && maxSteps > 0 && maxSteps <= 200 ? maxSteps : undefined,
      requireApproval: (tool, args, agent) =>
        new Promise<boolean>(resolve => {
          const id = `apr-${randomBytes(4).toString('hex')}`;
          run.pending = { id, tool, args, agent, resolve };
          emit({ kind: 'approval', agent, text: `Waiting for approval: ${tool} ${clip(args)}` });
        }),
      onStreamContent: text => emit({ kind: 'thought', agent: run.agentName, text: clip(text, 2000) }),
      onStepProgress: step => {
        run.plan = run.agent.planner.getSteps();
        emit({ kind: 'plan', text: `${step.status}: ${step.title}` });
      },
      onToolStart: (who: string, call: ToolCall) => {
        if (call.name !== 'delegate_task') return;
        emit({
          kind: 'delegate',
          agent: who,
          tool: call.name,
          args: displayArgs(call.arguments),
          text: `${who} -> ${call.arguments?.agent}: ${clip(call.arguments?.task ?? '', 300)}`
        });
      },
      onToolCall: (who: string, call: ToolCall, result: ToolResult) => {
        emit({
          kind: 'tool',
          agent: who,
          ok: !result.isError,
          tool: call.name,
          args: displayArgs(call.arguments),
          error: result.isError ? clip(result.error || '', 600) : undefined,
          text: `${call.name} ${clip(call.arguments)} -> ${result.isError ? `ERROR ${clip(result.error || '', 300)}` : 'ok'}`
        });
      }
    });

    emit({ kind: 'info', text: `Provider ${run.provider}${run.model ? ` (${run.model})` : ''}, mode ${run.mode}, agent ${run.agentName}` });
    current = run;

    const done = run.agent
      .run(task)
      .then(result => {
        run.result = result;
        run.plan = run.agent.planner.getSteps();
        emit({ kind: result.succeeded ? 'result' : 'error', ok: result.succeeded, text: result.summary });
        return result;
      })
      .catch(err => {
        run.error = err?.message || String(err);
        emit({ kind: 'error', ok: false, text: run.error! });
        throw err;
      })
      .finally(() => {
        run.running = false;
        run.pending?.resolve(false);
        run.pending = undefined;
      });

    return { run, done };
  }

  async function serveStatic(urlPath: string, res: http.ServerResponse): Promise<boolean> {
    if (!staticDir) return false;
    let rel = decodeURIComponent(urlPath);
    if (rel.endsWith('/')) rel += 'index.html';
    let file = path.resolve(staticDir, `.${rel}`);
    if (file !== staticDir && !file.startsWith(staticDir + path.sep)) return false;
    let data = await fs.readFile(file).catch(() => null);
    if (!data) {
      // Single-page app: unknown paths without an extension get index.html.
      if (path.extname(rel)) return false;
      file = path.join(staticDir, 'index.html');
      data = await fs.readFile(file).catch(() => null);
      if (!data) return false;
    }
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
    return true;
  }

  const server = http.createServer(async (req, res) => {
    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(payload));
    };

    // Only pages served from this machine may call the API from a browser.
    const origin = req.headers.origin;
    if (origin && LOCAL_ORIGIN.test(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const isApi = url.pathname === '/api' || url.pathname.startsWith('/api/');

      // The UI files are not secret; everything under /api needs the token.
      if (!isApi && staticDir && req.method === 'GET') {
        if (await serveStatic(url.pathname, res)) return;
        throw new HttpError(404, 'Not found');
      }

      if (!authorized(req)) {
        throw new HttpError(401, 'Missing or invalid bearer token');
      }

      const route = `${req.method} ${url.pathname}`;

      if (route === 'GET /api/status') {
        const memory = new MemoryEngine(workspaceRoot);
        await memory.init();
        const def = envDefault();
        send(200, {
          status: current?.running ? 'busy' : 'online',
          workspaceRoot,
          os: process.platform,
          arch: process.arch,
          provider: def.provider,
          model: def.modelName,
          mode,
          memoriesCount: memory.getEpisodicCount(),
          heuristics: memory.getHeuristics(),
          recordedTrajectories: (await recorder.loadAll()).length
        });
        return;
      }

      if (route === 'GET /api/providers') {
        const def = envDefault();
        send(200, { active: def.provider, activeModel: def.modelName, providers: describeProviders() });
        return;
      }

      if (route === 'POST /api/run') {
        const body = await readJsonBody(req);
        const { run, done } = await startRun(body);
        if (body.wait === false) {
          done.catch(() => undefined);
          send(202, { runId: run.runId });
          return;
        }
        send(200, await done);
        return;
      }

      if (route === 'GET /api/run/current') {
        send(200, publicRun(current));
        return;
      }

      if (route === 'POST /api/approve') {
        const body = await readJsonBody(req);
        const pending = current?.pending;
        if (!pending || pending.id !== body.id) throw new HttpError(404, 'No such pending approval');
        current!.pending = undefined;
        current!.events.push({ at: Date.now(), kind: 'approval', ok: body.allow === true, text: `${body.allow === true ? 'Approved' : 'Denied'}: ${pending.tool}` });
        pending.resolve(body.allow === true);
        send(200, { ok: true });
        return;
      }

      if (route === 'POST /api/run/cancel') {
        if (!current?.running) throw new HttpError(409, 'No task is running');
        current.agent.cancel();
        current.pending?.resolve(false);
        current.pending = undefined;
        send(200, { ok: true });
        return;
      }

      if (route === 'GET /api/trajectories') {
        await recorder.loadAll();
        send(200, {
          trajectories: recorder.getRecordedTrajectories(),
          dpoPairs: recorder.exportDPOPairs()
        });
        return;
      }

      if (route === 'GET /api/dpo') {
        await recorder.loadAll();
        const pairs = recorder.exportDPOPairs();
        res.writeHead(200, {
          'Content-Type': 'application/jsonl; charset=utf-8',
          'Content-Disposition': 'attachment; filename="dpo_pairs.jsonl"',
          'X-Dockyard-Pairs': String(pairs.length)
        });
        res.end(pairs.map(p => JSON.stringify(p)).join('\n') + (pairs.length ? '\n' : ''));
        return;
      }

      if (route === 'POST /api/feedback') {
        const body = await readJsonBody(req);
        const score = Number(body.score);
        if (typeof body.trajectoryId !== 'string' || !Number.isFinite(score) || score < -1 || score > 1) {
          throw new HttpError(400, '"trajectoryId" and a "score" between -1 and 1 are required');
        }
        const updated = await recorder.applyHumanFeedback(body.trajectoryId, score);
        if (!updated) throw new HttpError(404, 'Trajectory not found');
        send(200, { trajectoryId: updated.trajectoryId, finalReward: updated.finalReward, rewardBreakdown: updated.rewardBreakdown });
        return;
      }

      if (route === 'GET /api/memory') {
        const memory = new MemoryEngine(workspaceRoot);
        await memory.init();
        send(200, {
          heuristics: memory.getHeuristics(),
          episodes: memory.getEpisodicCount(),
          scratchpad: current?.agent.memory.getScratchpad() || ''
        });
        return;
      }

      if (route === 'POST /api/memory/forget') {
        const body = await readJsonBody(req);
        if (typeof body.heuristic !== 'string') throw new HttpError(400, '"heuristic" is required');
        const memory = new MemoryEngine(workspaceRoot);
        await memory.init();
        const removed = memory.removeHeuristic(body.heuristic);
        if (removed) await memory.save();
        send(200, { removed });
        return;
      }

      if (route === 'GET /api/plan') {
        send(200, { steps: current?.plan || [], checkpoints: current?.agent.planner.getCheckpoints() || [] });
        return;
      }

      if (route === 'GET /api/agents') {
        send(200, { agents: await agentStore.list() });
        return;
      }

      if (route === 'POST /api/agents') {
        const body = await readJsonBody(req);
        try {
          send(200, { agent: await agentStore.save(body) });
        } catch (err: any) {
          throw new HttpError(400, err?.message || 'Invalid agent definition');
        }
        return;
      }

      if (req.method === 'DELETE' && url.pathname.startsWith('/api/agents/')) {
        const name = decodeURIComponent(url.pathname.slice('/api/agents/'.length));
        let deleted = false;
        try {
          deleted = await agentStore.delete(name);
        } catch (err: any) {
          throw new HttpError(400, err?.message || 'Invalid agent name');
        }
        if (!deleted) throw new HttpError(404, `No agent named "${name}"`);
        send(200, { deleted: true });
        return;
      }

      throw new HttpError(404, 'Endpoint not found');
    } catch (e: any) {
      if (res.headersSent) {
        res.end();
        return;
      }
      send(e instanceof HttpError ? e.status : 500, { error: e?.message || 'Internal error' });
    }
  });

  const def = envDefault();
  return { server, port, host, token, mode, provider: def.provider, modelName: def.modelName };
}
