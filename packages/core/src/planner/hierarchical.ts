export interface PlanStep {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  details?: string;
  substeps?: PlanStep[];
  outcomeSummary?: string;
}

export interface WorkspaceCheckpoint {
  checkpointId: string;
  timestamp: number;
  description: string;
  completedStepIds: string[];
  scratchpad: string;
  metadata?: Record<string, any>;
}

export class HierarchicalPlanner {
  private steps: PlanStep[] = [];
  private checkpoints: WorkspaceCheckpoint[] = [];

  constructor(initialSteps?: PlanStep[]) {
    if (initialSteps) {
      this.steps = initialSteps;
    }
  }

  setPlan(steps: PlanStep[]) {
    this.steps = steps;
  }

  getSteps(): PlanStep[] {
    return this.steps;
  }

  getCurrentStep(): PlanStep | undefined {
    return this.steps.find(s => s.status === 'in_progress') || this.steps.find(s => s.status === 'pending');
  }

  startStep(stepId: string): boolean {
    const step = this.findStep(stepId);
    if (!step) return false;
    step.status = 'in_progress';
    return true;
  }

  completeStep(stepId: string, outcomeSummary?: string): boolean {
    const step = this.findStep(stepId);
    if (!step) return false;
    step.status = 'completed';
    if (outcomeSummary) {
      step.outcomeSummary = outcomeSummary;
    }
    return true;
  }

  failStep(stepId: string, reason?: string): boolean {
    const step = this.findStep(stepId);
    if (!step) return false;
    step.status = 'failed';
    step.details = reason || step.details;
    return true;
  }

  private findStep(id: string, list: PlanStep[] = this.steps): PlanStep | undefined {
    for (const item of list) {
      if (item.id === id) return item;
      if (item.substeps) {
        const found = this.findStep(id, item.substeps);
        if (found) return found;
      }
    }
    return undefined;
  }

  createCheckpoint(description: string, scratchpad: string): WorkspaceCheckpoint {
    const checkpoint: WorkspaceCheckpoint = {
      checkpointId: `chk-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
      description,
      completedStepIds: this.steps.filter(s => s.status === 'completed').map(s => s.id),
      scratchpad
    };
    this.checkpoints.push(checkpoint);
    return checkpoint;
  }

  getCheckpoints(): WorkspaceCheckpoint[] {
    return this.checkpoints;
  }

  restoreCheckpoint(checkpointId: string): WorkspaceCheckpoint | undefined {
    const cp = this.checkpoints.find(c => c.checkpointId === checkpointId);
    if (!cp) return undefined;
    for (const step of this.steps) {
      if (cp.completedStepIds.includes(step.id)) {
        step.status = 'completed';
      } else {
        step.status = 'pending';
      }
    }
    return cp;
  }

  renderMarkdown(): string {
    let out = '';
    for (let i = 0; i < this.steps.length; i++) {
      const s = this.steps[i];
      const mark = s.status === 'completed' ? '[x]' : s.status === 'in_progress' ? '[*]' : s.status === 'failed' ? '[!]' : '[ ]';
      out += `${i + 1}. ${mark} **${s.title}**\n`;
      if (s.details) {
        out += `   - ${s.details}\n`;
      }
      if (s.outcomeSummary) {
        out += `   - Outcome: ${s.outcomeSummary}\n`;
      }
    }
    return out;
  }
}
