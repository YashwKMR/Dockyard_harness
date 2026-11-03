import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface CodebaseSymbol {
  name: string;
  file: string;
  type: 'function' | 'class' | 'interface' | 'variable';
  line: number;
}

export interface EpisodicMemoryEntry {
  id: string;
  timestamp: number;
  task: string;
  outcome: 'success' | 'failure';
  learnedLesson: string;
  tags: string[];
}

export class MemoryEngine {
  private workspaceRoot: string;
  private memoryDir: string;
  private episodicMemory: EpisodicMemoryEntry[] = [];
  private workingScratchpad: string = '';
  private heuristics: string[] = [];

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.memoryDir = path.join(workspaceRoot, '.dockyard');
  }

  async init(): Promise<void> {
    try {
      await fs.mkdir(this.memoryDir, { recursive: true });
      const memFile = path.join(this.memoryDir, 'memory.json');
      const exists = await fs.stat(memFile).catch(() => null);
      if (exists) {
        const raw = await fs.readFile(memFile, 'utf-8');
        const parsed = JSON.parse(raw);
        this.episodicMemory = parsed.episodic || [];
        this.heuristics = parsed.heuristics || [];
      }
    } catch {
      // fresh memory directory
    }
  }

  async save(): Promise<void> {
    try {
      await fs.mkdir(this.memoryDir, { recursive: true });
      const memFile = path.join(this.memoryDir, 'memory.json');
      await fs.writeFile(
        memFile,
        JSON.stringify({ episodic: this.episodicMemory, heuristics: this.heuristics }, null, 2),
        'utf-8'
      );
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
    return fullEntry;
  }

  addHeuristic(heuristic: string) {
    if (!this.heuristics.includes(heuristic)) {
      this.heuristics.push(heuristic);
    }
  }

  getRelevantMemories(query: string, maxItems = 5): EpisodicMemoryEntry[] {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
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
      .sort((a, b) => b.score - a.score)
      .slice(0, maxItems)
      .map(item => item.entry);
  }

  getHeuristics(): string[] {
    return [...this.heuristics];
  }

  async buildContextBrief(taskDescription: string): Promise<string> {
    const relevantMemories = this.getRelevantMemories(taskDescription);
    let brief = '## Contextual Intelligence & Memory\n';

    if (this.heuristics.length > 0) {
      brief += '### Distilled Repo Heuristics:\n';
      for (const h of this.heuristics) {
        brief += `- ${h}\n`;
      }
    }

    if (relevantMemories.length > 0) {
      brief += '### Relevant Prior Experience:\n';
      for (const m of relevantMemories) {
        brief += `- [${m.outcome.toUpperCase()}] Task: "${m.task}" -> Lesson: ${m.learnedLesson}\n`;
      }
    }

    if (this.workingScratchpad.trim()) {
      brief += `### Working Scratchpad:\n${this.workingScratchpad}\n`;
    }

    return brief;
  }
}
