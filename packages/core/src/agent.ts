import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ChatMessage, ModelProvider, ToolCall, ToolResult } from './models/types.js';
import { createModelProvider } from './models/providers.js';
import {
  ToolRegistry,
  ToolExecutionContext,
  PermissionMode,
  createStandardTools,
  mostRestrictiveMode
} from './tools/registry.js';
import { MemoryEngine } from './memory/engine.js';
import { HierarchicalPlanner, PlanStep } from './planner/hierarchical.js';
import { TrajectoryRecorder, Trajectory, RewardEvaluators } from './rl/trajectory.js';
import { SelfImprovementLoop, ReflectionResult } from './rl/self_improvement.js';
import { AgentDefinition, AgentStore } from './agents/store.js';

export interface DockyardAgentConfig {
  workspaceRoot: string;
  model: ModelProvider;
  tools?: ToolRegistry;
  memory?: MemoryEngine;
  planner?: HierarchicalPlanner;
  trajectoryRecorder?: TrajectoryRecorder;
  maxIterations?: number;
  /** read-only | ask | auto. Defaults to 'ask' when requireApproval is given, otherwise 'auto'. */
  mode?: PermissionMode;
  /** Asked before a tool writes files or runs a command. agentName says which agent (lead or teammate) is asking. */
  requireApproval?: (toolName: string, args: Record<string, any>, agentName?: string) => Promise<boolean>;
  onStepProgress?: (step: PlanStep) => void;
  onStreamContent?: (chunk: string) => void;
  onToolCall?: (agentName: string, call: ToolCall, result: ToolResult) => void;
  /** Called just before a tool runs, so a teammate handoff can be shown as it starts. */
  onToolStart?: (agentName: string, call: ToolCall) => void;
  /**
   * Shell command that decides whether the work is actually done (e.g. "npm test").
   * Runs after the agent reports completion; its exit status is the `testsPassed` signal.
   */
  verifyCommand?: string;
  /** Run as a defined agent: its role prompt, tool allowlist, permission cap and own memory. */
  definition?: AgentDefinition;
  /** Where teammates are defined. Pass false to disable delegation. Defaults to `.dockyard/agents`. */
  agentStore?: AgentStore | false;
  /** How many levels of delegation are allowed below the top-level agent. Default 2. */
  maxDelegationDepth?: number;
  depth?: number;
  /** Run the post-task reflection pass. Default true. */
  reflect?: boolean;
  /** Load AGENTS.md from the workspace root into the system prompt. Default true. */
  projectInstructions?: boolean;
  /** Older tool output is dropped from the conversation once it grows past this size. */
  maxContextChars?: number;
}

export type StopReason = 'completed' | 'max_iterations' | 'error' | 'cancelled';

export interface RunTaskResult {
  /** The agent reported completion and, if a verify command is configured, it passed. */
  succeeded: boolean;
  summary: string;
  trajectory: Trajectory;
  reflection?: ReflectionResult;
  checkpoints: number;
  stopReason: StopReason;
  /** Result of the verify command; undefined when none was configured or it did not run. */
  verified?: boolean;
  iterations: number;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  error?: string;
}

const PROJECT_DOC = 'AGENTS.md';
const PROJECT_DOC_MAX_BYTES = 32 * 1024;
const DEFAULT_MAX_CONTEXT_CHARS = 400_000;
const ELIDED = '[earlier tool output removed to save context]';

function compactMessages(messages: ChatMessage[], maxChars: number): void {
  let total = messages.reduce((n, m) => n + m.content.length, 0);
  // Never touch the most recent exchange.
  for (let i = 0; i < messages.length - 6 && total > maxChars; i++) {
    const m = messages[i];
    if (m.role === 'tool' && m.content.length > ELIDED.length) {
      total -= m.content.length - ELIDED.length;
      m.content = ELIDED;
    }
  }
}

export class DockyardAgent {
  public workspaceRoot: string;
  public model: ModelProvider;
  /** The tools this agent may call. Rebuilt at the start of each run. */
  public tools: ToolRegistry;
  public memory: MemoryEngine;
  public planner: HierarchicalPlanner;
  public trajectoryRecorder: TrajectoryRecorder;
  public selfImprovement: SelfImprovementLoop;
  public readonly name: string;
  public readonly mode: PermissionMode;
  public readonly definition?: AgentDefinition;
  public readonly agentStore?: AgentStore;

  private baseTools: ToolRegistry;
  private maxIterations: number;
  private requireApproval?: (toolName: string, args: Record<string, any>, agentName?: string) => Promise<boolean>;
  private onStepProgress?: (step: PlanStep) => void;
  private onStreamContent?: (chunk: string) => void;
  private onToolCall?: (agentName: string, call: ToolCall, result: ToolResult) => void;
  private onToolStart?: (agentName: string, call: ToolCall) => void;
  private verifyCommand?: string;
  private depth: number;
  private maxDelegationDepth: number;
  private reflect: boolean;
  private projectInstructions: boolean;
  private maxContextChars: number;
  private session: ChatMessage[] | null = null;
  private running = false;
  private cancelRequested = false;

  constructor(config: DockyardAgentConfig) {
    this.workspaceRoot = config.workspaceRoot;
    this.model = config.model;
    this.definition = config.definition;
    this.name = config.definition?.name || 'dockyard';
    this.baseTools = config.tools || createStandardTools();
    this.tools = this.baseTools.subset(config.definition?.tools);
    this.memory = config.memory || new MemoryEngine(this.workspaceRoot, { namespace: config.definition?.name });
    this.planner = config.planner || new HierarchicalPlanner();
    this.trajectoryRecorder = config.trajectoryRecorder || new TrajectoryRecorder(this.workspaceRoot);
    this.selfImprovement = new SelfImprovementLoop(this.model, this.memory);
    this.maxIterations = config.maxIterations || config.definition?.maxIterations || 20;
    this.requireApproval = config.requireApproval;
    this.onStepProgress = config.onStepProgress;
    this.onStreamContent = config.onStreamContent;
    this.onToolCall = config.onToolCall;
    this.onToolStart = config.onToolStart;
    this.verifyCommand = config.verifyCommand?.trim() || undefined;
    this.depth = config.depth ?? 0;
    this.maxDelegationDepth = config.maxDelegationDepth ?? 2;
    this.reflect = config.reflect ?? true;
    this.projectInstructions = config.projectInstructions ?? true;
    this.maxContextChars = config.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
    this.agentStore = config.agentStore === false ? undefined : (config.agentStore || new AgentStore(this.workspaceRoot));

    const requested: PermissionMode = config.mode ?? (config.requireApproval ? 'ask' : 'auto');
    this.mode = config.definition?.mode ? mostRestrictiveMode(requested, config.definition.mode) : requested;
  }

  async init(): Promise<void> {
    await this.memory.init();
    await this.trajectoryRecorder.init();
  }

  /** Ask a running task to stop before its next model call. */
  cancel(): void {
    this.cancelRequested = true;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Forget the conversation kept for `run(task, { resume: true })`. */
  resetSession(): void {
    this.session = null;
  }

  private async loadProjectInstructions(): Promise<string> {
    if (!this.projectInstructions) return '';
    try {
      const raw = await fs.readFile(path.join(this.workspaceRoot, PROJECT_DOC));
      return raw.subarray(0, PROJECT_DOC_MAX_BYTES).toString('utf-8').trim();
    } catch {
      return '';
    }
  }

  private async loadTeammates(): Promise<AgentDefinition[]> {
    if (!this.agentStore || this.depth >= this.maxDelegationDepth) return [];
    const all = await this.agentStore.list().catch(() => [] as AgentDefinition[]);
    return all.filter(a => a.name !== this.name);
  }

  private buildTools(teammates: AgentDefinition[]): ToolRegistry {
    const tools = this.baseTools.subset(this.definition?.tools);

    tools.register({
      kind: 'meta',
      definition: {
        name: 'update_plan',
        description: 'Record or update the step-by-step plan for the current task. Send the full list of steps every time, with the current status of each.',
        parameters: {
          type: 'object',
          properties: {
            steps: {
              type: 'array',
              description: 'All steps of the plan, in order.',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'failed', 'skipped'] },
                  details: { type: 'string' }
                },
                required: ['title', 'status']
              }
            }
          },
          required: ['steps']
        }
      },
      execute: async args => {
        if (!Array.isArray(args.steps) || args.steps.length === 0) {
          return { output: '', error: '"steps" must be a non-empty list.', isError: true };
        }
        const allowed = new Set(['pending', 'in_progress', 'completed', 'failed', 'skipped']);
        const previous = new Map(this.planner.getSteps().map(s => [s.title, s.status]));
        const steps: PlanStep[] = args.steps.map((s: any, i: number) => ({
          id: String(i + 1),
          title: String(s?.title ?? `Step ${i + 1}`),
          status: allowed.has(s?.status) ? s.status : 'pending',
          details: typeof s?.details === 'string' ? s.details : undefined
        }));
        this.planner.setPlan(steps);
        this.memory.setScratchpad(this.planner.renderMarkdown());
        for (const step of steps) {
          if (previous.get(step.title) !== step.status) {
            if (step.status === 'completed') {
              this.planner.createCheckpoint(`Completed: ${step.title}`, this.memory.getScratchpad());
            }
            this.onStepProgress?.(step);
          }
        }
        return { output: `Plan updated:\n${this.planner.renderMarkdown()}` };
      }
    });

    if (teammates.length > 0) {
      tools.register({
        kind: 'meta',
        definition: {
          name: 'delegate_task',
          description:
            'Hand a self-contained piece of work to a teammate agent and get its report back. ' +
            'The teammate does not see this conversation, so put everything it needs in "task".',
          parameters: {
            type: 'object',
            properties: {
              agent: { type: 'string', enum: teammates.map(t => t.name), description: 'Name of the teammate.' },
              task: { type: 'string', description: 'Complete instructions for the teammate.' }
            },
            required: ['agent', 'task']
          }
        },
        execute: async args => {
          const def = teammates.find(t => t.name === args.agent);
          if (!def) {
            return { output: '', error: `No teammate named "${args.agent}". Available: ${teammates.map(t => t.name).join(', ')}.`, isError: true };
          }
          const child = new DockyardAgent({
            workspaceRoot: this.workspaceRoot,
            model: def.provider ? createModelProvider({ provider: def.provider, model: def.model }) : this.model,
            tools: this.baseTools,
            // A teammate never gets more authority than the agent delegating to it.
            mode: this.mode,
            requireApproval: this.requireApproval,
            definition: def,
            agentStore: this.agentStore,
            depth: this.depth + 1,
            maxDelegationDepth: this.maxDelegationDepth,
            maxIterations: def.maxIterations ?? this.maxIterations,
            reflect: this.reflect,
            projectInstructions: this.projectInstructions,
            onToolCall: this.onToolCall,
            onToolStart: this.onToolStart
          });
          const res = await child.run(String(args.task));
          const header = `Teammate "${def.name}" ${res.succeeded ? 'completed the task' : `did not complete the task (${res.stopReason})`} ` +
            `in ${res.trajectory.steps.length} step(s). Trajectory: ${res.trajectory.trajectoryId}`;
          return res.succeeded
            ? { output: `${header}\n\n${res.summary}` }
            : { output: res.summary, error: header, isError: true };
        }
      });
    }

    return tools;
  }

  private async buildSystemPrompt(task: string, teammates: AgentDefinition[]): Promise<string> {
    const contextBrief = await this.memory.buildContextBrief(task);
    const projectDoc = await this.loadProjectInstructions();
    const sections: string[] = [
      `You are ${this.definition ? `"${this.name}", a specialist agent running in the Dockyard harness` : 'Dockyard, an autonomous, long-horizon coding harness agent'}.
Operating System: ${process.platform} (${process.arch})
Workspace: ${this.workspaceRoot}
Permission mode: ${this.mode}${this.mode === 'read-only' ? ' (you cannot write files or run commands; report what should change instead)' : ''}`
    ];
    if (this.definition) {
      sections.push(`## Your role\n${this.definition.instructions}`);
    }
    if (projectDoc) {
      sections.push(`## Project instructions (${PROJECT_DOC})\n${projectDoc}`);
    }
    if (contextBrief) {
      sections.push(contextBrief.trim());
    }
    if (teammates.length > 0) {
      sections.push(
        '## Teammates\nYou can hand work to these agents with the delegate_task tool:\n' +
          teammates.map(t => `- ${t.name}: ${t.description}`).join('\n')
      );
    }
    sections.push(`Guidelines:
1. For any task with more than one step, call update_plan first and keep it current as you work.
2. Read before you edit, and verify modifications by running the project's own checks.
3. When the task is finished, reply with a short final summary and no tool calls.`);
    return sections.join('\n\n');
  }

  private async runVerification(): Promise<boolean> {
    const command = this.verifyCommand!;
    const runner = this.baseTools.get('run_command') || createStandardTools().get('run_command')!;
    const call: ToolCall = { id: 'verify', name: 'run_command', arguments: { command, timeoutMs: 600_000 } };
    let result: ToolResult;
    try {
      const out = await runner.execute(call.arguments, { workspaceRoot: this.workspaceRoot, mode: 'auto' });
      result = { ...out, callId: call.id };
    } catch (err: any) {
      result = { callId: call.id, output: '', error: err?.message || String(err), isError: true };
    }
    this.trajectoryRecorder.recordStep(`Verification: ${command}`, call, result);
    this.onToolCall?.(this.name, call, result);
    return !result.isError;
  }

  async run(task: string, options: { resume?: boolean } = {}): Promise<RunTaskResult> {
    if (this.running) {
      throw new Error(`Agent "${this.name}" is already running a task.`);
    }
    this.running = true;
    this.cancelRequested = false;
    try {
      return await this.runInternal(task, options);
    } finally {
      this.running = false;
    }
  }

  private async runInternal(task: string, options: { resume?: boolean }): Promise<RunTaskResult> {
    await this.init();
    this.trajectoryRecorder.startTrajectory(task, {
      agent: this.name,
      depth: this.depth,
      provider: this.model.name,
      mode: this.mode
    });

    const teammates = await this.loadTeammates();
    this.tools = this.buildTools(teammates);
    const toolDefs = this.tools.listDefinitions();
    const toolContext: ToolExecutionContext = {
      workspaceRoot: this.workspaceRoot,
      mode: this.mode,
      requireApproval: this.requireApproval
        ? (toolName, args) => this.requireApproval!(toolName, args, this.name)
        : undefined
    };

    let messages: ChatMessage[];
    if (options.resume && this.session) {
      messages = this.session;
      messages.push({ role: 'user', content: task });
    } else {
      messages = [
        { role: 'system', content: await this.buildSystemPrompt(task, teammates) },
        { role: 'user', content: task }
      ];
      this.session = messages;
    }

    const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let iteration = 0;
    let stopReason: StopReason = 'max_iterations';
    let finalSummary = '';
    let error: string | undefined;

    while (iteration < this.maxIterations) {
      if (this.cancelRequested) {
        stopReason = 'cancelled';
        break;
      }
      iteration++;
      compactMessages(messages, this.maxContextChars);

      let response;
      try {
        response = await this.model.complete(messages, { tools: toolDefs });
      } catch (err: any) {
        error = err?.message || String(err);
        stopReason = 'error';
        break;
      }

      if (response.usage) {
        usage.promptTokens += response.usage.promptTokens || 0;
        usage.completionTokens += response.usage.completionTokens || 0;
        usage.totalTokens += response.usage.totalTokens || 0;
      }
      if (this.onStreamContent && response.content) {
        this.onStreamContent(response.content);
      }

      if (response.toolCalls && response.toolCalls.length > 0) {
        messages.push({
          role: 'assistant',
          content: response.content || '',
          toolCalls: response.toolCalls,
          providerData: response.providerData
        });

        for (const tc of response.toolCalls) {
          this.onToolStart?.(this.name, tc);
          const toolResult = await this.tools.execute(tc.name, tc.arguments, toolContext, tc.id);
          this.trajectoryRecorder.recordStep(response.content, tc, toolResult);
          this.onToolCall?.(this.name, tc, toolResult);

          messages.push({
            role: 'tool',
            name: tc.name,
            toolCallId: tc.id,
            isError: !!toolResult.isError,
            content: toolResult.isError
              ? `ERROR: ${toolResult.error}${toolResult.output ? `\n${toolResult.output}` : ''}`
              : toolResult.output
          });
        }
      } else {
        // No tools called: the model considers the task finished.
        this.trajectoryRecorder.recordStep(response.content);
        messages.push({ role: 'assistant', content: response.content });
        finalSummary = response.content;
        stopReason = 'completed';
        break;
      }
    }

    const completed = stopReason === 'completed';
    let verified: boolean | undefined;
    if (completed && this.verifyCommand) {
      verified = await this.runVerification();
    }

    this.planner.createCheckpoint('Post-run checkpoint', this.memory.getScratchpad());

    // Only measured signals go into the reward. Completion is self-reported by the model;
    // testsPassed is present only when a verify command actually ran.
    const evaluators: RewardEvaluators = { taskGoalAchieved: completed };
    if (verified !== undefined) evaluators.testsPassed = verified;
    const finishedTrajectory = await this.trajectoryRecorder.finishTrajectory(evaluators);

    let reflection: ReflectionResult | undefined;
    if (this.reflect && stopReason !== 'error' && stopReason !== 'cancelled') {
      reflection = await this.selfImprovement.reflectOnTrajectory(finishedTrajectory);
    }

    let summary = finalSummary;
    if (stopReason === 'max_iterations') {
      summary = `Stopped after reaching the limit of ${this.maxIterations} iterations without finishing the task.`;
    } else if (stopReason === 'cancelled') {
      summary = 'Stopped because the task was cancelled.';
    } else if (stopReason === 'error') {
      summary = `Stopped because the model request failed: ${error}`;
    } else if (verified === false) {
      summary = `${finalSummary}\n\n[Verification failed: "${this.verifyCommand}" did not pass.]`;
    }

    return {
      succeeded: completed && verified !== false,
      summary: summary || 'Task execution finished.',
      trajectory: finishedTrajectory,
      reflection,
      checkpoints: this.planner.getCheckpoints().length,
      stopReason,
      verified,
      iterations: iteration,
      usage,
      error
    };
  }
}
