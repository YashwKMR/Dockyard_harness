import { ToolCall } from '../models/types.js';

export interface TrajectoryStep {
  stepIndex: number;
  timestamp: number;
  thought: string;
  action: {
    toolName: string;
    toolCallId?: string;
    args: Record<string, any>;
  };
  observation: {
    success: boolean;
    output: string;
    error?: string;
  };
  reward?: number; // Normalized reward [ -1.0 to +1.0 ]
  critique?: string;
}

export interface AgentTrajectory {
  trajectoryId: string;
  taskId: string;
  taskPrompt: string;
  provider: string;
  model: string;
  startTime: number;
  endTime?: number;
  steps: TrajectoryStep[];
  outcome: 'success' | 'failure' | 'partial';
  totalReward: number;
  metadata?: Record<string, any>;
}

export interface DPOPreferencePair {
  prompt: string;
  chosen: {
    thought: string;
    toolCall: ToolCall;
    response?: string;
  };
  rejected: {
    thought: string;
    toolCall: ToolCall;
    response?: string;
  };
  margin: number;
  metadata: {
    trajectoryId: string;
    stepIndex: number;
  };
}

export class TrajectoryRecorder {
  private trajectories: Map<string, AgentTrajectory> = new Map();
  private currentTrajectory?: AgentTrajectory;

  public startTrajectory(
    taskId: string,
    taskPrompt: string,
    provider: string,
    model: string,
    metadata?: Record<string, any>
  ): AgentTrajectory {
    const trajectory: AgentTrajectory = {
      trajectoryId: `traj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      taskId,
      taskPrompt,
      provider,
      model,
      startTime: Date.now(),
      steps: [],
      outcome: 'partial',
      totalReward: 0,
      metadata,
    };
    this.trajectories.set(trajectory.trajectoryId, trajectory);
    this.currentTrajectory = trajectory;
    return trajectory;
  }

  public recordStep(
    thought: string,
    action: TrajectoryStep['action'],
    observation: TrajectoryStep['observation'],
    reward?: number,
    critique?: string
  ): TrajectoryStep {
    if (!this.currentTrajectory) {
      throw new Error('Cannot record step: No active trajectory started.');
    }

    // Default verifier reward: +1 for success, -0.5 for tool execution error
    const computedReward = reward !== undefined ? reward : observation.success ? 1.0 : -0.5;

    const step: TrajectoryStep = {
      stepIndex: this.currentTrajectory.steps.length + 1,
      timestamp: Date.now(),
      thought,
      action,
      observation,
      reward: computedReward,
      critique,
    };

    this.currentTrajectory.steps.push(step);
    this.currentTrajectory.totalReward += computedReward;
    return step;
  }

  public finishTrajectory(outcome: 'success' | 'failure' | 'partial'): AgentTrajectory {
    if (!this.currentTrajectory) {
      throw new Error('Cannot finish trajectory: No active trajectory.');
    }
    this.currentTrajectory.endTime = Date.now();
    this.currentTrajectory.outcome = outcome;
    const finished = this.currentTrajectory;
    this.currentTrajectory = undefined;
    return finished;
  }

  public getTrajectory(id: string): AgentTrajectory | undefined {
    return this.trajectories.get(id);
  }

  public getAllTrajectories(): AgentTrajectory[] {
    return Array.from(this.trajectories.values());
  }

  /**
   * Export pairs suitable for Direct Preference Optimization (DPO).
   * Generates chosen vs. rejected steps based on reward differential and verifier critiques.
   */
  public exportDPOPairs(): DPOPreferencePair[] {
    const pairs: DPOPreferencePair[] = [];

    for (const traj of this.trajectories.values()) {
      for (let i = 0; i < traj.steps.length; i++) {
        const step = traj.steps[i];
        if (step.observation.success && (step.reward ?? 0) > 0) {
          // Look for an error or retry in adjacent/prior attempts or construct negative from error
          const failedStep = traj.steps.find(
            (s) => !s.observation.success && s.action.toolName === step.action.toolName
          );

          if (failedStep) {
            pairs.push({
              prompt: traj.taskPrompt,
              chosen: {
                thought: step.thought,
                toolCall: {
                  id: step.action.toolCallId || `call_chosen_${step.stepIndex}`,
                  name: step.action.toolName,
                  arguments: step.action.args,
                },
                response: step.observation.output,
              },
              rejected: {
                thought: failedStep.thought,
                toolCall: {
                  id: failedStep.action.toolCallId || `call_rej_${failedStep.stepIndex}`,
                  name: failedStep.action.toolName,
                  arguments: failedStep.action.args,
                },
                response: failedStep.observation.error || failedStep.observation.output,
              },
              margin: (step.reward ?? 1.0) - (failedStep.reward ?? -0.5),
              metadata: {
                trajectoryId: traj.trajectoryId,
                stepIndex: step.stepIndex,
              },
            });
          }
        }
      }
    }

    return pairs;
  }

  public exportJSONL(): string {
    return this.getAllTrajectories()
      .map((t) => JSON.stringify(t))
      .join('\n');
  }
}
