export interface MemoryEntry {
  id: string;
  category: 'scratchpad' | 'fact' | 'heuristic' | 'error_recovery';
  key: string;
  value: string;
  confidence: number;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export class MemoryEngine {
  private entries: Map<string, MemoryEntry> = new Map();

  public set(category: MemoryEntry['category'], key: string, value: string, tags: string[] = []): MemoryEntry {
    const existing = this.entries.get(key);
    const now = Date.now();
    const entry: MemoryEntry = {
      id: existing ? existing.id : `mem_${now}_${Math.random().toString(36).substring(2, 7)}`,
      category,
      key,
      value,
      confidence: existing ? Math.min(1.0, existing.confidence + 0.1) : 0.8,
      tags,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };
    this.entries.set(key, entry);
    return entry;
  }

  public get(key: string): MemoryEntry | undefined {
    return this.entries.get(key);
  }

  public delete(key: string): boolean {
    return this.entries.delete(key);
  }

  public listByCategory(category: MemoryEntry['category']): MemoryEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.category === category);
  }

  public getAll(): MemoryEntry[] {
    return Array.from(this.entries.values());
  }

  public search(query: string): MemoryEntry[] {
    const q = query.toLowerCase();
    return Array.from(this.entries.values()).filter(
      (e) =>
        e.key.toLowerCase().includes(q) ||
        e.value.toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q))
    );
  }

  public formatForPrompt(): string {
    const heuristics = this.listByCategory('heuristic');
    const scratchpad = this.listByCategory('scratchpad');
    const recoveries = this.listByCategory('error_recovery');

    const sections: string[] = [];

    if (scratchpad.length > 0) {
      sections.push('### Working Scratchpad\n' + scratchpad.map((s) => `- [${s.key}]: ${s.value}`).join('\n'));
    }

    if (heuristics.length > 0) {
      sections.push(
        '### Learned Rules & Heuristics\n' + heuristics.map((h) => `- [${h.key}]: ${h.value}`).join('\n')
      );
    }

    if (recoveries.length > 0) {
      sections.push(
        '### Error Recovery Strategies\n' + recoveries.map((r) => `- [${r.key}]: ${r.value}`).join('\n')
      );
    }

    return sections.join('\n\n');
  }
}
