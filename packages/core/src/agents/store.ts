import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { PermissionMode, isPermissionMode } from '../tools/registry.js';
import { SupportedProviderType, normalizeProvider } from '../models/catalog.js';

/**
 * A reusable agent: a role with its own instructions, tool allowlist, model and
 * memory. Stored as JSON in `.dockyard/agents/<name>.json` so a team can commit
 * and share its agents. A lead agent can hand work to any defined agent with the
 * `delegate_task` tool.
 */
export interface AgentDefinition {
  name: string;
  /** One line shown to other agents so they know when to delegate here. */
  description: string;
  /** The role prompt: what this agent is responsible for and how it should work. */
  instructions: string;
  /** Tool names this agent may use. Omit for all standard tools. */
  tools?: string[];
  /** Run this agent on a different provider. `model` is only honoured together with `provider`. */
  provider?: SupportedProviderType;
  model?: string;
  /** Upper bound on this agent's permissions. It can never exceed the mode of whoever runs it. */
  mode?: PermissionMode;
  maxIterations?: number;
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;

export function validateAgentDefinition(input: any): AgentDefinition {
  if (!input || typeof input !== 'object') throw new Error('Agent definition must be an object.');
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!NAME_PATTERN.test(name)) {
    throw new Error('Agent name must be 1-48 characters: lowercase letters, digits, "-" or "_", starting with a letter or digit.');
  }
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  if (!description) throw new Error('Agent "description" is required.');
  const instructions = typeof input.instructions === 'string' ? input.instructions.trim() : '';
  if (!instructions) throw new Error('Agent "instructions" are required.');

  const def: AgentDefinition = { name, description, instructions };
  if (input.tools !== undefined) {
    if (!Array.isArray(input.tools) || input.tools.some((t: unknown) => typeof t !== 'string' || !t)) {
      throw new Error('Agent "tools" must be a list of tool names.');
    }
    def.tools = input.tools.map((t: string) => t.trim());
  }
  if (input.provider !== undefined) {
    const provider = normalizeProvider(input.provider);
    if (!provider) throw new Error(`Unknown provider "${input.provider}".`);
    def.provider = provider;
  }
  if (input.model !== undefined) {
    if (typeof input.model !== 'string' || !input.model) throw new Error('Agent "model" must be a string.');
    def.model = input.model;
  }
  if (input.mode !== undefined) {
    if (!isPermissionMode(input.mode)) throw new Error('Agent "mode" must be one of: read-only, ask, auto.');
    def.mode = input.mode;
  }
  if (input.maxIterations !== undefined) {
    const n = Number(input.maxIterations);
    if (!Number.isInteger(n) || n < 1 || n > 200) throw new Error('Agent "maxIterations" must be an integer from 1 to 200.');
    def.maxIterations = n;
  }
  return def;
}

export class AgentStore {
  private dir: string;

  constructor(workspaceRoot: string) {
    this.dir = path.join(workspaceRoot, '.dockyard', 'agents');
  }

  private fileFor(name: string): string {
    if (!NAME_PATTERN.test(name)) throw new Error(`Invalid agent name: ${name}`);
    return path.join(this.dir, `${name}.json`);
  }

  async list(): Promise<AgentDefinition[]> {
    const names = await fs.readdir(this.dir).catch(() => [] as string[]);
    const defs: AgentDefinition[] = [];
    for (const file of names.sort()) {
      if (!file.endsWith('.json')) continue;
      try {
        defs.push(validateAgentDefinition(JSON.parse(await fs.readFile(path.join(this.dir, file), 'utf-8'))));
      } catch {
        // ignore files that are not valid agent definitions
      }
    }
    return defs;
  }

  async get(name: string): Promise<AgentDefinition | undefined> {
    try {
      return validateAgentDefinition(JSON.parse(await fs.readFile(this.fileFor(name), 'utf-8')));
    } catch (err: any) {
      if (err?.code === 'ENOENT') return undefined;
      throw err;
    }
  }

  async save(input: AgentDefinition): Promise<AgentDefinition> {
    const def = validateAgentDefinition(input);
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.fileFor(def.name), JSON.stringify(def, null, 2) + '\n', 'utf-8');
    return def;
  }

  async delete(name: string): Promise<boolean> {
    try {
      await fs.unlink(this.fileFor(name));
      return true;
    } catch (err: any) {
      if (err?.code === 'ENOENT') return false;
      throw err;
    }
  }
}
