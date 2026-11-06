import { MultiProviderHub } from './models/providers.js';
import { ProviderId, ModelMessage } from './models/types.js';
import { ToolRegistry, ToolExecutionContext } from './tools/registry.js';
import { HierarchicalPlanner, Milestone } from './planner/hierarchical.js';
import { MemoryEngine } from './memory/engine.js';
import { TrajectoryRecorder, AgentTrajectory } from './rl/trajectory.js';
import { SelfImprovementEngine } from './rl/self_improvement.js';

export interface AgentConfig {
  provider?: ProviderId;
  model?: string;
  maxIterations?: number;
  workingDirectory?: string;
  enableRLRecording?: boolean;
}

export interface AgentRunResult {
  taskId: string;
  success: boolean;
  output: string;
  iterations: number;
  trajectory?: AgentTrajectory;
}

export class AutonomousAgent {
  public providerHub: MultiProviderHub;
  public toolRegistry: ToolRegistry;
  public planner: HierarchicalPlanner;
  public memory: MemoryEngine;
  public trajectoryRecorder: TrajectoryRecorder;
  public selfImprovement: SelfImprovementEngine;

  private config: Required<AgentConfig>;

  constructor(config: AgentConfig = {}) {
    this.config = {
      provider: config.provider || 'openrouter',
      model: config.model || 'anthropic/claude-3.5-sonnet',
      maxIterations: config.maxIterations || 15,
      workingDirectory: config.workingDirectory || process.cwd(),
      enableRLRecording: config.enableRLRecording ?? true,
    };

    this.providerHub = new MultiProviderHub();
    this.toolRegistry = new ToolRegistry();
    this.planner = new HierarchicalPlanner();
    this.memory = new MemoryEngine();
    this.trajectoryRecorder = new TrajectoryRecorder();
    this.selfImprovement = new SelfImprovementEngine();
  }

  public async run(taskPrompt: string, taskId: string = `task_${Date.now()}`): Promise<AgentRunResult> {
    const trajectory = this.config.enableRLRecording
      ? this.trajectoryRecorder.startTrajectory(taskId, taskPrompt, this.config.provider, this.config.model)
      : undefined;

    // Establish initial plan
    const initialMilestones: Milestone[] = [
      {
        id: 'm1_explore',
        title: 'Explore & Understand Environment',
        objective: 'Analyze workspace files and understand requirements.',
        status: 'pending',
        subtasks: [
          {
            id: 's1_list',
            title: 'List directory contents',
            description: 'Inspect workspace files',
            status: 'pending',
            attempts: 0,
          },
        ],
        dependencies: [],
      },
      {
        id: 'm2_execute',
        title: 'Execute Core Objectives',
        objective: 'Implement requested functionality or execute actions.',
        status: 'pending',
        subtasks: [
          {
            id: 's2_work',
            title: 'Apply changes',
            description: taskPrompt,
            status: 'pending',
            attempts: 0,
          },
        ],
        dependencies: ['m1_explore'],
      },
      {
        id: 'm3_verify',
        title: 'Verify & Self-Critique',
        objective: 'Verify outputs and perform reflection passes.',
        status: 'pending',
        subtasks: [
          {
            id: 's3_check',
            title: 'Run verification tests or inspect results',
            description: 'Ensure correctness',
            status: 'pending',
            attempts: 0,
          },
        ],
        dependencies: ['m2_execute'],
      },
    ];

    this.planner.setPlan(initialMilestones);
    this.planner.updateMilestoneStatus('m1_explore', 'in_progress');

    const executionContext: ToolExecutionContext = {
      workingDirectory: this.config.workingDirectory,
    };

    const messages: ModelMessage[] = [
      {
        role: 'system',
        content: `You are Dockyard Agent, an autonomous software engineering and problem-solving assistant.\n` +
          `You have access to a tool sandbox, a hierarchical milestone planner, and multi-tier memory.\n\n` +
          `Current Memory Context:\n${this.memory.formatForPrompt()}\n\n` +
          `Current Hierarchical Plan:\n${this.planner.formatMarkdown()}`,
      },
      {
        role: 'user',
        content: taskPrompt,
      },
    ];

    let iteration = 0;
    let finalOutput = '';
    let isTaskDone = false;

    while (iteration < this.config.maxIterations && !isTaskDone) {
      iteration++;

      const completion = await this.providerHub.complete(this.config.provider, messages, {
        model: this.config.model,
        tools: this.toolRegistry.getDefinitions(),
      });

      const assistantMsg: ModelMessage = {
        role: 'assistant',
        content: completion.content,
        toolCalls: completion.toolCalls,
      };
      messages.push(assistantMsg);

      if (completion.toolCalls && completion.toolCalls.length > 0) {
        for (const tc of completion.toolCalls) {
          const toolResult = await this.toolRegistry.execute(tc.name, tc.arguments, executionContext);

          if (this.config.enableRLRecording) {
            this.trajectoryRecorder.recordStep(
              completion.content,
              { toolName: tc.name, toolCallId: tc.id, args: tc.arguments },
              { success: toolResult.success, output: toolResult.output, error: toolResult.error }
            );
          }

          messages.push({
            role: 'tool',
            name: tc.name,
            toolCallId: tc.id,
            content: toolResult.success ? toolResult.output : `ERROR: ${toolResult.error}`,
          });

          // Update milestone subtasks
          if (this.planner.getCurrentMilestone()?.id === 'm1_explore') {
            this.planner.updateSubtask('m1_explore', 's1_list', {
              status: 'completed',
              result: toolResult.output.slice(0, 100),
            });
            this.planner.updateMilestoneStatus('m2_execute', 'in_progress');
          } else if (this.planner.getCurrentMilestone()?.id === 'm2_execute') {
            this.planner.updateSubtask('m2_execute', 's2_work', {
              status: 'completed',
              result: 'Executed work',
            });
            this.planner.updateMilestoneStatus('m3_verify', 'in_progress');
          }
        }
      } else {
        // No more tool calls - task completed
        finalOutput = completion.content;
        this.planner.updateMilestoneStatus('m3_verify', 'completed');
        isTaskDone = true;
      }
    }

    if (!finalOutput) {
      finalOutput = messages[messages.length - 1]?.content || 'Task execution finished.';
    }

    let finishedTrajectory: AgentTrajectory | undefined;
    if (this.config.enableRLRecording && trajectory) {
      finishedTrajectory = this.trajectoryRecorder.finishTrajectory(isTaskDone ? 'success' : 'partial');
      this.selfImprovement.critiqueAndDistill(finishedTrajectory, this.memory);
    }

    return {
      taskId,
      success: isTaskDone,
      output: finalOutput,
      iterations: iteration,
      trajectory: finishedTrajectory,
    };
  }
}
