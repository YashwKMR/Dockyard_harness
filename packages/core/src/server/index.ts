import http from 'node:http';
import { AutonomousAgent, AgentConfig } from '../agent.js';

export interface ServerOptions {
  port?: number;
  agentConfig?: AgentConfig;
}

export class DockyardServer {
  private server?: http.Server;
  private agent: AutonomousAgent;
  private port: number;

  constructor(options: ServerOptions = {}) {
    this.port = options.port ?? 4000;
    this.agent = new AutonomousAgent(options.agentConfig);
  }

  public start(): Promise<number> {
    return new Promise((resolve) => {
      this.server = http.createServer(async (req, res) => {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = new URL(req.url || '/', `http://${req.headers.host}`);

        // Health check
        if (req.method === 'GET' && url.pathname === '/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'ok', time: Date.now() }));
          return;
        }

        // Get status & metrics
        if (req.method === 'GET' && url.pathname === '/api/status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              milestones: this.agent.planner.getMilestones(),
              memory: this.agent.memory.getAll(),
              trajectoriesCount: this.agent.trajectoryRecorder.getAllTrajectories().length,
            })
          );
          return;
        }

        // Run agent task endpoint
        if (req.method === 'POST' && url.pathname === '/api/run') {
          let body = '';
          req.on('data', (chunk) => {
            body += chunk;
          });
          req.on('end', async () => {
            try {
              const data = JSON.parse(body || '{}');
              const prompt = data.prompt || 'Hello Dockyard';
              const result = await this.agent.run(prompt, data.taskId);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            } catch (err: any) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err?.message || String(err) }));
            }
          });
          return;
        }

        // Export DPO pairs
        if (req.method === 'GET' && url.pathname === '/api/rl/dpo') {
          const pairs = this.agent.trajectoryRecorder.exportDPOPairs();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(pairs));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      });

      this.server.listen(this.port, () => {
        resolve(this.port);
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
