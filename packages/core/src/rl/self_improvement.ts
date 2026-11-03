import { Trajectory } from '../rl/trajectory.js';
import { MemoryEngine } from '../memory/engine.js';
import { ModelProvider } from '../models/types.js';

export interface ReflectionResult {
  succeeded: boolean;
  critique: string;
  identifiedHeuristics: string[];
  suggestedAction: string;
}

export class SelfImprovementLoop {
  private model: ModelProvider;
  private memory: MemoryEngine;

  constructor(model: ModelProvider, memory: MemoryEngine) {
    this.model = model;
    this.memory = memory;
  }

  async reflectOnTrajectory(trajectory: Trajectory): Promise<ReflectionResult> {
    const errorCount = trajectory.steps.filter(s => s.toolResult?.isError).length;
    const succeeded = trajectory.finalReward > 0.5;

    const summaryOfSteps = trajectory.steps.map(s => {
      const tool = s.toolCall ? `${s.toolCall.name}(${JSON.stringify(s.toolCall.arguments)})` : 'none';
      const status = s.toolResult ? (s.toolResult.isError ? `FAILED: ${s.toolResult.error}` : 'SUCCESS') : 'no_result';
      return `- Step ${s.stepIndex}: ${s.thought || 'thought'} | Tool: ${tool} | Status: ${status}`;
    }).join('\n');

    const prompt = `You are the Dockyard Self-Improvement and Reflection Engine.
Analyze the following agent execution trajectory for task: "${trajectory.task}".
Score / Reward: ${trajectory.finalReward}
Steps:
${summaryOfSteps}

Provide a concise reflection in JSON format with:
- "succeeded": boolean
- "critique": string explaining what worked and what went wrong
- "identifiedHeuristics": array of strings with reusable rules or strategies to remember
- "suggestedAction": string recommendation for future tasks`;

    try {
      const resp = await this.model.complete([
        { role: 'system', content: 'You evaluate agent execution trajectories and distill lessons.' },
        { role: 'user', content: prompt }
      ]);

      let jsonMatch = resp.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // Update memory engine automatically with newly learned heuristics
        if (Array.isArray(parsed.identifiedHeuristics)) {
          for (const h of parsed.identifiedHeuristics) {
            this.memory.addHeuristic(h);
          }
        }
        this.memory.addEpisodicMemory({
          task: trajectory.task,
          outcome: succeeded ? 'success' : 'failure',
          learnedLesson: parsed.critique || 'Evaluated trajectory',
          tags: ['self-improvement', succeeded ? 'success' : 'failure']
        });
        await this.memory.save();

        return {
          succeeded: !!parsed.succeeded,
          critique: parsed.critique || 'Analysis complete',
          identifiedHeuristics: parsed.identifiedHeuristics || [],
          suggestedAction: parsed.suggestedAction || 'Continue iterative refinement'
        };
      }
    } catch {
      // Fallback rule-based reflection
    }

    // Heuristic fallback
    const fallbackHeuristics: string[] = [];
    if (errorCount > 0) {
      fallbackHeuristics.push(`Inspect files with read_file before attempting edit_file_diff to prevent search block mismatches.`);
    } else {
      fallbackHeuristics.push(`Direct command verification and automated linting confirm task completion effectively.`);
    }

    for (const h of fallbackHeuristics) {
      this.memory.addHeuristic(h);
    }
    this.memory.addEpisodicMemory({
      task: trajectory.task,
      outcome: succeeded ? 'success' : 'failure',
      learnedLesson: succeeded ? 'Task completed cleanly with positive reward.' : 'Encountered execution errors, retry recommended.',
      tags: ['reflection']
    });
    await this.memory.save();

    return {
      succeeded,
      critique: succeeded ? 'Execution completed within acceptable parameters.' : `Encountered ${errorCount} tool execution errors during run.`,
      identifiedHeuristics: fallbackHeuristics,
      suggestedAction: succeeded ? 'Persist successful trajectory patterns.' : 'Improve tool parameter validation.'
    };
  }
}
