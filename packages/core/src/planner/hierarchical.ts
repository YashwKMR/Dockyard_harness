export type MilestoneStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';

export interface Subtask {
  id: string;
  title: string;
  description: string;
  status: MilestoneStatus;
  result?: string;
  error?: string;
  attempts: number;
}

export interface Milestone {
  id: string;
  title: string;
  objective: string;
  status: MilestoneStatus;
  subtasks: Subtask[];
  dependencies: string[]; // Milestone IDs
  checkpointId?: string;
}

export interface PlanSnapshot {
  id: string;
  timestamp: number;
  milestones: Milestone[];
  currentMilestoneId?: string;
  notes?: string;
}

export class HierarchicalPlanner {
  private milestones: Milestone[] = [];
  private currentMilestoneIndex: number = 0;
  private snapshots: PlanSnapshot[] = [];

  constructor(initialMilestones: Milestone[] = []) {
    this.milestones = initialMilestones;
  }

  public setPlan(milestones: Milestone[]): void {
    this.milestones = milestones;
    this.currentMilestoneIndex = 0;
    this.createSnapshot('Initial plan established');
  }

  public getMilestones(): Milestone[] {
    return this.milestones;
  }

  public getCurrentMilestone(): Milestone | undefined {
    return this.milestones[this.currentMilestoneIndex];
  }

  public addMilestone(milestone: Milestone): void {
    this.milestones.push(milestone);
    this.createSnapshot(`Added milestone: ${milestone.title}`);
  }

  public updateMilestoneStatus(id: string, status: MilestoneStatus): boolean {
    const m = this.milestones.find((item) => item.id === id);
    if (!m) return false;
    m.status = status;
    if (status === 'completed' && this.milestones[this.currentMilestoneIndex]?.id === id) {
      this.currentMilestoneIndex++;
    }
    this.createSnapshot(`Updated milestone [${m.title}] status to ${status}`);
    return true;
  }

  public updateSubtask(
    milestoneId: string,
    subtaskId: string,
    updates: Partial<Omit<Subtask, 'id'>>
  ): boolean {
    const m = this.milestones.find((item) => item.id === milestoneId);
    if (!m) return false;
    const sub = m.subtasks.find((s) => s.id === subtaskId);
    if (!sub) return false;

    Object.assign(sub, updates);
    if (updates.status === 'in_progress' || updates.status === 'failed') {
      sub.attempts++;
    }

    // Auto-complete milestone if all subtasks completed
    if (m.subtasks.length > 0 && m.subtasks.every((s) => s.status === 'completed')) {
      m.status = 'completed';
      if (this.milestones[this.currentMilestoneIndex]?.id === milestoneId) {
        this.currentMilestoneIndex++;
      }
    }

    this.createSnapshot(`Updated subtask [${sub.title}] in milestone [${m.title}]`);
    return true;
  }

  public createSnapshot(notes?: string): PlanSnapshot {
    const snapshot: PlanSnapshot = {
      id: `snap_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
      milestones: JSON.parse(JSON.stringify(this.milestones)),
      currentMilestoneId: this.getCurrentMilestone()?.id,
      notes,
    };
    this.snapshots.push(snapshot);
    return snapshot;
  }

  public getSnapshots(): PlanSnapshot[] {
    return this.snapshots;
  }

  public rollbackToSnapshot(snapshotId: string): boolean {
    const snapshot = this.snapshots.find((s) => s.id === snapshotId);
    if (!snapshot) return false;

    this.milestones = JSON.parse(JSON.stringify(snapshot.milestones));
    const idx = this.milestones.findIndex((m) => m.id === snapshot.currentMilestoneId);
    this.currentMilestoneIndex = idx >= 0 ? idx : 0;
    this.createSnapshot(`Rollback to snapshot ${snapshotId}`);
    return true;
  }

  public isComplete(): boolean {
    return this.milestones.length > 0 && this.milestones.every((m) => m.status === 'completed');
  }

  public formatMarkdown(): string {
    if (this.milestones.length === 0) return '*(No active plan established)*';

    return this.milestones
      .map((m, idx) => {
        const check = m.status === 'completed' ? '[x]' : m.status === 'in_progress' ? '[>]' : '[ ]';
        const subtasksStr = m.subtasks
          .map((s) => {
            const sCheck = s.status === 'completed' ? '[x]' : s.status === 'in_progress' ? '[>]' : '[ ]';
            return `    - ${sCheck} ${s.title}: ${s.description}`;
          })
          .join('\n');
        return `${idx + 1}. ${check} **${m.title}** (${m.status})\n   ${m.objective}${
          subtasksStr ? '\n' + subtasksStr : ''
        }`;
      })
      .join('\n\n');
  }
}
