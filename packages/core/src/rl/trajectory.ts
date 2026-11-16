import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ToolCall, ToolResult } from '../models/types.js';

export interface TrajectoryStep {
  stepIndex: number;
  thought?: string;
  toolCall?: ToolCall;
  toolResult?: ToolResult;
  timestamp: number;
  stepReward?: number;
}

/**
 * Only signals that were actually measured belong here. A field left undefined
 * means "not measured", and contributes nothing to the reward.
 */
export interface RewardEvaluators {
  /** A verification command (tests, build, linter) ran and exited cleanly. */
  testsPassed?: boolean;
  lintersPassed?: boolean;
  /** The agent finished on its own and reported completion. Self-reported, not verified. */
  taskGoalAchieved?: boolean;
  /** Score from a person, -1 to +1. */
  humanFeedbackScore?: number;
}

export interface Trajectory {
  trajectoryId: string;
  task: string;
  startedAt: number;
  endedAt?: number;
  steps: TrajectoryStep[];
  finalReward: number;
  rewardBreakdown: RewardEvaluators & { penalties?: number };
  metadata?: Record<string, any>;
}

export interface DPOPreferencePair {
  prompt: string;
  chosen: string;
  rejected: string;
  scoreDifference: number;
  sourceTrajectoryId: string;
  rejectedTrajectoryId: string;
}

const ERROR_PENALTY = 0.1;

function countErrors(t: Trajectory): number {
  return t.steps.filter(s => s.toolResult?.isError).length;
}

export function scoreTrajectory(evaluators: RewardEvaluators, errorCount: number): number {
  let reward = 0;
  if (evaluators.taskGoalAchieved) reward += 1.0;
  if (evaluators.testsPassed === true) reward += 0.5;
  if (evaluators.testsPassed === false) reward -= 0.5;
  if (evaluators.lintersPassed) reward += 0.2;
  if (typeof evaluators.humanFeedbackScore === 'number') {
    reward += Math.max(-1, Math.min(1, evaluators.humanFeedbackScore));
  }
  reward -= errorCount * ERROR_PENALTY;
  return Math.max(-2, Math.min(2.5, reward));
}

function normalizeTask(task: string): string {
  return task.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Render a trajectory as text a model could be trained on: thoughts, tool calls with arguments, outcomes. */
export function renderTrajectory(t: Trajectory): string {
  return t.steps
    .map(s => {
      const parts: string[] = [];
      if (s.thought) parts.push(`THOUGHT: ${s.thought}`);
      if (s.toolCall) parts.push(`ACTION: ${s.toolCall.name}(${JSON.stringify(s.toolCall.arguments)})`);
      if (s.toolResult) {
        const body = s.toolResult.isError ? `ERROR ${s.toolResult.error || ''}` : s.toolResult.output;
        parts.push(`RESULT: ${String(body).slice(0, 500)}`);
      }
      return parts.join('\n');
    })
    .join('\n');
}

export class TrajectoryRecorder {
  private activeTrajectory: Trajectory | null = null;
  private storageDir: string;
  private recordedTrajectories: Trajectory[] = [];

  constructor(workspaceRoot: string) {
    this.storageDir = path.join(workspaceRoot, '.dockyard', 'trajectories');
  }

  async init(): Promise<void> {
    await fs.mkdir(this.storageDir, { recursive: true }).catch(() => undefined);
  }

  /** Load every trajectory saved on disk (from earlier sessions and from other agents). */
  async loadAll(): Promise<Trajectory[]> {
    const known = new Set(this.recordedTrajectories.map(t => t.trajectoryId));
    const names = await fs.readdir(this.storageDir).catch(() => [] as string[]);
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const parsed = JSON.parse(await fs.readFile(path.join(this.storageDir, name), 'utf-8')) as Trajectory;
        if (parsed?.trajectoryId && Array.isArray(parsed.steps) && !known.has(parsed.trajectoryId)) {
          known.add(parsed.trajectoryId);
          this.recordedTrajectories.push(parsed);
        }
      } catch {
        // skip unreadable files
      }
    }
    this.recordedTrajectories.sort((a, b) => a.startedAt - b.startedAt);
    return this.recordedTrajectories;
  }

  startTrajectory(task: string, metadata?: Record<string, any>): Trajectory {
    const trajectory: Trajectory = {
      trajectoryId: `traj-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      task,
      startedAt: Date.now(),
      steps: [],
      finalReward: 0,
      rewardBreakdown: {},
      metadata
    };
    this.activeTrajectory = trajectory;
    return trajectory;
  }

  recordStep(thought?: string, toolCall?: ToolCall, toolResult?: ToolResult): TrajectoryStep {
    if (!this.activeTrajectory) {
      throw new Error('Cannot record step: No active trajectory');
    }
    const step: TrajectoryStep = {
      stepIndex: this.activeTrajectory.steps.length,
      thought,
      toolCall,
      toolResult,
      timestamp: Date.now()
    };
    this.activeTrajectory.steps.push(step);
    return step;
  }

  calculateReward(evaluators: RewardEvaluators): number {
    return scoreTrajectory(evaluators, this.activeTrajectory ? countErrors(this.activeTrajectory) : 0);
  }

  private async persist(t: Trajectory): Promise<void> {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      await fs.writeFile(path.join(this.storageDir, `${t.trajectoryId}.json`), JSON.stringify(t, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to persist trajectory:', e);
    }
  }

  async finishTrajectory(evaluators: RewardEvaluators): Promise<Trajectory> {
    if (!this.activeTrajectory) {
      throw new Error('No active trajectory to finish');
    }
    const finished = this.activeTrajectory;
    const errorCount = countErrors(finished);
    finished.endedAt = Date.now();
    finished.rewardBreakdown = { ...evaluators, penalties: errorCount * ERROR_PENALTY };
    finished.finalReward = scoreTrajectory(evaluators, errorCount);

    this.recordedTrajectories.push(finished);
    this.activeTrajectory = null;
    await this.persist(finished);
    return finished;
  }

  /** Attach a human rating (-1 to +1) to a finished trajectory and rescore it. */
  async applyHumanFeedback(trajectoryId: string, score: number): Promise<Trajectory | undefined> {
    if (!Number.isFinite(score)) throw new Error('Feedback score must be a number between -1 and 1.');
    let t = this.recordedTrajectories.find(x => x.trajectoryId === trajectoryId);
    if (!t) {
      await this.loadAll();
      t = this.recordedTrajectories.find(x => x.trajectoryId === trajectoryId);
    }
    if (!t) return undefined;
    const { penalties: _penalties, ...evaluators } = t.rewardBreakdown;
    evaluators.humanFeedbackScore = Math.max(-1, Math.min(1, score));
    const errorCount = countErrors(t);
    t.rewardBreakdown = { ...evaluators, penalties: errorCount * ERROR_PENALTY };
    t.finalReward = scoreTrajectory(evaluators, errorCount);
    await this.persist(t);
    return t;
  }

  getActiveTrajectory(): Trajectory | null {
    return this.activeTrajectory;
  }

  getRecordedTrajectories(): Trajectory[] {
    return this.recordedTrajectories;
  }

  /**
   * Build preference pairs from trajectories that attempted the same task with
   * different outcomes. Needs at least two runs of a task; call loadAll() first
   * to include earlier sessions.
   */
  exportDPOPairs(minScoreDiff = 0.5): DPOPreferencePair[] {
    const pairs: DPOPreferencePair[] = [];
    const grouped = new Map<string, Trajectory[]>();

    for (const t of this.recordedTrajectories) {
      const key = normalizeTask(t.task);
      const list = grouped.get(key) || [];
      list.push(t);
      grouped.set(key, list);
    }

    for (const trajList of grouped.values()) {
      if (trajList.length < 2) continue;
      const sorted = [...trajList].sort((a, b) => b.finalReward - a.finalReward);
      const chosen = sorted[0];
      const rejected = sorted[sorted.length - 1];

      if (chosen.finalReward - rejected.finalReward >= minScoreDiff) {
        pairs.push({
          prompt: chosen.task,
          chosen: renderTrajectory(chosen),
          rejected: renderTrajectory(rejected),
          scoreDifference: chosen.finalReward - rejected.finalReward,
          sourceTrajectoryId: chosen.trajectoryId,
          rejectedTrajectoryId: rejected.trajectoryId
        });
      }
    }
    return pairs;
  }
}
