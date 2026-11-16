import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface EpisodicMemoryEntry {
  id: string;
  timestamp: number;
  task: string;
  outcome: 'success' | 'failure';
  learnedLesson: string;
  tags: string[];
}

export interface MemoryEngineOptions {
  /**
   * Keeps a separate memory file for a named agent, so each teammate accumulates
   * its own lessons across sessions. Omit for the default workspace memory.
   */
  namespace?: string;
  maxHeuristics?: number;
  maxEpisodes?: number;
}

const DEFAULT_MAX_HEURISTICS = 50;
const DEFAULT_MAX_EPISODES = 200;

export class MemoryEngine {
  private memoryFile: string;
  private episodicMemory: EpisodicMemoryEntry[] = [];
  private workingScratchpad: string = '';
  private heuristics: string[] = [];
  private maxHeuristics: number;
  private maxEpisodes: number;
  private loaded = false;

  constructor(workspaceRoot: string, options: MemoryEngineOptions = {}) {
    const base = path.join(workspaceRoot, '.dockyard');
    if (options.namespace) {
      if (!/^[a-z0-9][a-z0-9_-]*$/i.test(options.namespace)) {
        throw new Error(`Invalid memory namespace: ${options.namespace}`);
      }
      this.memoryFile = path.join(base, 'agent-memory', `${options.namespace}.json`);
    } else {
      this.memoryFile = path.join(base, 'memory.json');
    }
    this.maxHeuristics = options.maxHeuristics ?? DEFAULT_MAX_HEURISTICS;
    this.maxEpisodes = options.maxEpisodes ?? DEFAULT_MAX_EPISODES;
  }

  async init(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    let raw: string;
    try {
      raw = await fs.readFile(this.memoryFile, 'utf-8');
    } catch {
      return; // no memory yet
    }
    try {
      const parsed = JSON.parse(raw);
      this.episodicMemory = Array.isArray(parsed.episodic) ? parsed.episodic : [];
      this.heuristics = Array.isArray(parsed.heuristics) ? parsed.heuristics.filter((h: unknown) => typeof h === 'string') : [];
    } catch {
      // Keep the unreadable file instead of silently overwriting it on the next save.
      await fs.rename(this.memoryFile, `${this.memoryFile}.corrupt-${Date.now()}`).catch(() => undefined);
    }
  }

  async save(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.memoryFile), { recursive: true });
      const tmp = `${this.memoryFile}.tmp-${process.pid}`;
      await fs.writeFile(
        tmp,
        JSON.stringify({ episodic: this.episodicMemory, heuristics: this.heuristics }, null, 2),
        'utf-8'
      );
      await fs.rename(tmp, this.memoryFile);
    } catch (e) {
      console.error('Failed to persist memory:', e);
    }
  }

  setScratchpad(text: string) {
    this.workingScratchpad = text;
  }

  getScratchpad(): string {
    return this.workingScratchpad;
  }

  addEpisodicMemory(entry: Omit<EpisodicMemoryEntry, 'id' | 'timestamp'>): EpisodicMemoryEntry {
    const fullEntry: EpisodicMemoryEntry = {
      ...entry,
      id: `ep-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now()
    };
    this.episodicMemory.push(fullEntry);
    if (this.episodicMemory.length > this.maxEpisodes) {
      this.episodicMemory = this.episodicMemory.slice(-this.maxEpisodes);
    }
    return fullEntry;
  }

  addHeuristic(heuristic: string) {
    const text = typeof heuristic === 'string' ? heuristic.trim() : '';
    if (!text || this.heuristics.includes(text)) return;
    this.heuristics.push(text);
    // Heuristics go into every system prompt, so the list has to stay bounded.
    if (this.heuristics.length > this.maxHeuristics) {
      this.heuristics = this.heuristics.slice(-this.maxHeuristics);
    }
  }

  removeHeuristic(heuristic: string): boolean {
    const before = this.heuristics.length;
    this.heuristics = this.heuristics.filter(h => h !== heuristic);
    return this.heuristics.length !== before;
  }

  getEpisodicCount(): number {
    return this.episodicMemory.length;
  }

  getRelevantMemories(query: string, maxItems = 5): EpisodicMemoryEntry[] {
    const tokens = Array.from(new Set(query.toLowerCase().split(/[^a-z0-9_]+/).filter(t => t.length >= 3)));
    if (tokens.length === 0) return [];
    return this.episodicMemory
      .map(entry => {
        let score = 0;
        const text = `${entry.task} ${entry.learnedLesson} ${entry.tags.join(' ')}`.toLowerCase();
        for (const token of tokens) {
          if (text.includes(token)) score += 1;
        }
        return { entry, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.timestamp - a.entry.timestamp)
      .slice(0, maxItems)
      .map(item => item.entry);
  }

  getHeuristics(): string[] {
    return [...this.heuristics];
  }

  async buildContextBrief(taskDescription: string): Promise<string> {
    const relevantMemories = this.getRelevantMemories(taskDescription);
    const sections: string[] = [];

    if (this.heuristics.length > 0) {
      sections.push('### Distilled Repo Heuristics:\n' + this.heuristics.map(h => `- ${h}`).join('\n'));
    }

    if (relevantMemories.length > 0) {
      sections.push(
        '### Relevant Prior Experience:\n' +
          relevantMemories.map(m => `- [${m.outcome.toUpperCase()}] Task: "${m.task}" -> Lesson: ${m.learnedLesson}`).join('\n')
      );
    }

    if (this.workingScratchpad.trim()) {
      sections.push(`### Working Scratchpad:\n${this.workingScratchpad}`);
    }

    if (sections.length === 0) return '';
    return `## Contextual Intelligence & Memory\n${sections.join('\n')}\n`;
  }
}
