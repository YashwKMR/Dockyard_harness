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

export interface Trajectory {
  trajectoryId: string;
  task: string;
  startedAt: number;
  endedAt?: number;
  steps: TrajectoryStep[];
  finalReward: number;
  rewardBreakdown: {
    testsPassed?: boolean;
    lintersPassed?: boolean;
    taskGoalAchieved?: boolean;
    humanFeedbackScore?: number; // -1 to +1
    penalties?: number;
  };
  metadata?: Record<string, any>;
}

export interface DPOPreferencePair {
  prompt: string;
  chosen: string;
  rejected: string;
  scoreDifference: number;
  sourceTrajectoryId: string;
}

export class TrajectoryRecorder {
  private activeTrajectory: Trajectory | null = null;
  private storageDir: string;
  private recordedTrajectories: Trajectory[] = [];

  constructor(workspaceRoot: string) {
    this.storageDir = path.join(workspaceRoot, '.dockyard', 'trajectories');
  }

  async init(): Promise<void> {
    try {
      await fs.mkdir(this.storageDir, { recursive: true });
    } catch {
      // ignore
    }
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

  calculateReward(evaluators: {
    testsPassed?: boolean;
    lintersPassed?: boolean;
    taskGoalAchieved?: boolean;
    humanFeedbackScore?: number;
  }): number {
    let reward = 0;
    if (evaluators.taskGoalAchieved) reward += 1.0;
    if (evaluators.testsPassed) reward += 0.5;
    if (evaluators.lintersPassed) reward += 0.2;
    if (evaluators.humanFeedbackScore !== undefined) {
      reward += evaluators.humanFeedbackScore; // between -1 and +1
    }

    // Penalize excessive failed tool calls
    if (this.activeTrajectory) {
      const errorCount = this.activeTrajectory.steps.filter(s => s.toolResult?.isError).length;
      reward -= (errorCount * 0.1);
    }

    return Math.max(-2, Math.min(2.5, reward));
  }

  async finishTrajectory(evaluators: {
    testsPassed?: boolean;
    lintersPassed?: boolean;
    taskGoalAchieved?: boolean;
    humanFeedbackScore?: number;
  }): Promise<Trajectory> {
    if (!this.activeTrajectory) {
      throw new Error('No active trajectory to finish');
    }

    this.activeTrajectory.endedAt = Date.now();
    this.activeTrajectory.rewardBreakdown = evaluators;
    this.activeTrajectory.finalReward = this.calculateReward(evaluators);

    this.recordedTrajectories.push(this.activeTrajectory);
    const finished = this.activeTrajectory;

    try {
      await fs.mkdir(this.storageDir, { recursive: true });
      const filePath = path.join(this.storageDir, `${finished.trajectoryId}.json`);
      await fs.writeFile(filePath, JSON.stringify(finished, null, 2), 'utf-8');
    } catch (e) {
      console.error('Failed to persist trajectory:', e);
    }

    this.activeTrajectory = null;
    return finished;
  }

  getActiveTrajectory(): Trajectory | null {
    return this.activeTrajectory;
  }

  getRecordedTrajectories(): Trajectory[] {
    return this.recordedTrajectories;
  }

  exportDPOPairs(minScoreDiff = 0.5): DPOPreferencePair[] {
    // Generate DPO pairs comparing trajectories for similar tasks
    const pairs: DPOPreferencePair[] = [];
    const grouped = new Map<string, Trajectory[]>();

    for (const t of this.recordedTrajectories) {
      const list = grouped.get(t.task) || [];
      list.push(t);
      grouped.set(t.task, list);
    }

    for (const [task, trajList] of grouped.entries()) {
      if (trajList.length < 2) continue;
      trajList.sort((a, b) => b.finalReward - a.finalReward);
      const chosen = trajList[0];
      const rejected = trajList[trajList.length - 1];

      if (chosen.finalReward - rejected.finalReward >= minScoreDiff) {
        pairs.push({
          prompt: task,
          chosen: chosen.steps.map(s => `${s.thought || ''} -> ${s.toolCall?.name || ''}`).join('\n'),
          rejected: rejected.steps.map(s => `${s.thought || ''} -> ${s.toolCall?.name || ''}`).join('\n'),
          scoreDifference: chosen.finalReward - rejected.finalReward,
          sourceTrajectoryId: chosen.trajectoryId
        });
      }
    }
    return pairs;
  }
}
