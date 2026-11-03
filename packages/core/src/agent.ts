import { ChatMessage, ModelProvider } from './models/types.js';
import { ToolRegistry, ToolExecutionContext, createStandardTools } from './tools/registry.js';
import { MemoryEngine } from './memory/engine.js';
import { HierarchicalPlanner, PlanStep } from './planner/hierarchical.js';
import { TrajectoryRecorder, Trajectory } from './rl/trajectory.js';
import { SelfImprovementLoop, ReflectionResult } from './rl/self_improvement.js';

export interface DockyardAgentConfig {
  workspaceRoot: string;
  model: ModelProvider;
  tools?: ToolRegistry;
  memory?: MemoryEngine;
  planner?: HierarchicalPlanner;
  trajectoryRecorder?: TrajectoryRecorder;
  maxIterations?: number;
  requireApproval?: (toolName: string, args: Record<string, any>) => Promise<boolean>;
  onStepProgress?: (step: PlanStep) => void;
  onStreamContent?: (chunk: string) => void;
}

export interface RunTaskResult {
  succeeded: boolean;
  summary: string;
  trajectory: Trajectory;
  reflection?: ReflectionResult;
  checkpoints: number;
}

export class DockyardAgent {
  public workspaceRoot: string;
  public model: ModelProvider;
  public tools: ToolRegistry;
  public memory: MemoryEngine;
  public planner: HierarchicalPlanner;
  public trajectoryRecorder: TrajectoryRecorder;
  public selfImprovement: SelfImprovementLoop;
  private maxIterations: number;
  private requireApproval?: (toolName: string, args: Record<string, any>) => Promise<boolean>;
  private onStepProgress?: (step: PlanStep) => void;
  private onStreamContent?: (chunk: string) => void;

  constructor(config: DockyardAgentConfig) {
    this.workspaceRoot = config.workspaceRoot;
    this.model = config.model;
    this.tools = config.tools || createStandardTools();
    this.memory = config.memory || new MemoryEngine(this.workspaceRoot);
    this.planner = config.planner || new HierarchicalPlanner();
    this.trajectoryRecorder = config.trajectoryRecorder || new TrajectoryRecorder(this.workspaceRoot);
    this.selfImprovement = new SelfImprovementLoop(this.model, this.memory);
    this.maxIterations = config.maxIterations || 20;
    this.requireApproval = config.requireApproval;
    this.onStepProgress = config.onStepProgress;
    this.onStreamContent = config.onStreamContent;
  }

  async init(): Promise<void> {
    await this.memory.init();
    await this.trajectoryRecorder.init();
  }

  async run(task: string): Promise<RunTaskResult> {
    await this.init();
    const trajectory = this.trajectoryRecorder.startTrajectory(task);

    // Initial contextual briefing
    const contextBrief = await this.memory.buildContextBrief(task);
    const systemPrompt = `You are Dockyard, an autonomous, long-horizon coding harness agent designed for high contextual intelligence and self-improvement.
Operating System: ${process.platform} (${process.arch})
Workspace: ${this.workspaceRoot}

${contextBrief}

Guidelines:
1. Always decompose complex requests into planned steps before execution.
2. Verify all modifications using tools or bash/command execution.
3. Keep track of working notes in scratchpad.`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: task }
    ];

    let iteration = 0;
    let taskCompleted = false;
    let finalSummary = '';

    while (iteration < this.maxIterations && !taskCompleted) {
      iteration++;

      const toolDefs = this.tools.listDefinitions();
      const response = await this.model.complete(messages, { tools: toolDefs });

      if (this.onStreamContent && response.content) {
        this.onStreamContent(response.content);
      }

      if (response.toolCalls && response.toolCalls.length > 0) {
        messages.push({
          role: 'assistant',
          content: response.content || '',
          toolCalls: response.toolCalls
        });

        for (const tc of response.toolCalls) {
          const toolContext: ToolExecutionContext = {
            workspaceRoot: this.workspaceRoot,
            requireApproval: this.requireApproval
          };

          const toolResult = await this.tools.execute(tc.name, tc.arguments, toolContext);
          this.trajectoryRecorder.recordStep(response.content, tc, toolResult);

          messages.push({
            role: 'tool',
            name: tc.name,
            toolCallId: tc.id,
            content: toolResult.isError ? `ERROR: ${toolResult.error}` : toolResult.output
          });
        }
      } else {
        // No tools called - model has produced reasoning/conclusion
        this.trajectoryRecorder.recordStep(response.content);
        messages.push({ role: 'assistant', content: response.content });
        finalSummary = response.content;
        taskCompleted = true;
      }
    }

    // Create a checkpoint after run
    this.planner.createCheckpoint('Post-run checkpoint', this.memory.getScratchpad());

    // Finish trajectory with reward scoring
    const finishedTrajectory = await this.trajectoryRecorder.finishTrajectory({
      taskGoalAchieved: taskCompleted,
      testsPassed: true,
      humanFeedbackScore: taskCompleted ? 1.0 : -0.5
    });

    // Run self-improvement reflection pass
    const reflection = await this.selfImprovement.reflectOnTrajectory(finishedTrajectory);

    return {
      succeeded: taskCompleted,
      summary: finalSummary || 'Task execution finished.',
      trajectory: finishedTrajectory,
      reflection,
      checkpoints: this.planner.getCheckpoints().length
    };
  }
}
