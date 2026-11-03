import * as http from 'node:http';
import { DockyardAgent } from '../agent.js';
import { MockModelProvider, OpenAICompatibleProvider } from '../models/providers.js';

export interface ServerOptions {
  port?: number;
  workspaceRoot: string;
}

export function createDockyardServer(options: ServerOptions) {
  const port = options.port || 4040;
  const workspaceRoot = options.workspaceRoot;

  // Default provider or OpenAI/Ollama compatible provider
  const apiKey = process.env.OPENAI_API_KEY || '';
  const baseURL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const modelName = process.env.DOCKYARD_MODEL || 'gpt-4o';

  const modelProvider = apiKey ? new OpenAICompatibleProvider({
    apiKey,
    baseURL,
    model: modelName
  }) : new MockModelProvider();

  const agent = new DockyardAgent({
    workspaceRoot,
    model: modelProvider
  });

  const server = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/api/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'online',
        workspaceRoot,
        os: process.platform,
        arch: process.arch,
        checkpoints: agent.planner.getCheckpoints().length,
        memoriesCount: agent.memory.getRelevantMemories('').length,
        heuristics: agent.memory.getHeuristics(),
        recordedTrajectories: agent.trajectoryRecorder.getRecordedTrajectories().length
      }));
      return;
    }

    if (url.pathname === '/api/run' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const parsed = JSON.parse(body || '{}');
          const task = parsed.task || 'Analyze workspace';
          const result = await agent.run(task);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (e: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    if (url.pathname === '/api/trajectories' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        trajectories: agent.trajectoryRecorder.getRecordedTrajectories(),
        dpoPairs: agent.trajectoryRecorder.exportDPOPairs()
      }));
      return;
    }

    if (url.pathname === '/api/memory' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        heuristics: agent.memory.getHeuristics(),
        scratchpad: agent.memory.getScratchpad()
      }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Endpoint not found' }));
  });

  return { server, port, agent };
}
