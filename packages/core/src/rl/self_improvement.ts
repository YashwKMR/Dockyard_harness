import { Trajectory } from '../rl/trajectory.js';
import { MemoryEngine } from '../memory/engine.js';
import { ModelProvider } from '../models/types.js';

export interface ReflectionResult {
  succeeded: boolean;
  critique: string;
  identifiedHeuristics: string[];
  suggestedAction: string;
  /** 'model' when the critique came from the model, 'fallback' when it is a factual summary only. */
  source: 'model' | 'fallback';
}

const MAX_HEURISTICS_PER_RUN = 5;
const MAX_HEURISTIC_CHARS = 240;

function cleanHeuristics(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((h): h is string => typeof h === 'string')
    .map(h => h.replace(/\s+/g, ' ').trim())
    .filter(h => h.length > 0 && h.length <= MAX_HEURISTIC_CHARS)
    .slice(0, MAX_HEURISTICS_PER_RUN);
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
      const tool = s.toolCall ? `${s.toolCall.name}(${JSON.stringify(s.toolCall.arguments).slice(0, 300)})` : 'none';
      const status = s.toolResult ? (s.toolResult.isError ? `FAILED: ${String(s.toolResult.error).slice(0, 300)}` : 'SUCCESS') : 'no_result';
      return `- Step ${s.stepIndex}: ${(s.thought || '').slice(0, 300)} | Tool: ${tool} | Status: ${status}`;
    }).join('\n');

    const prompt = `You are the Dockyard Self-Improvement and Reflection Engine.
Analyze the following agent execution trajectory for task: "${trajectory.task}".
Score / Reward: ${trajectory.finalReward}
Measured signals: ${JSON.stringify(trajectory.rewardBreakdown)}
Steps:
${summaryOfSteps}

Provide a concise reflection in JSON format with:
- "succeeded": boolean
- "critique": string explaining what worked and what went wrong
- "identifiedHeuristics": array of at most ${MAX_HEURISTICS_PER_RUN} short strings with reusable rules for THIS repository. Return an empty array if nothing reusable was learned.
- "suggestedAction": string recommendation for future tasks`;

    try {
      const resp = await this.model.complete([
        { role: 'system', content: 'You evaluate agent execution trajectories and distill lessons.' },
        { role: 'user', content: prompt }
      ]);

      const jsonMatch = resp.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const heuristics = cleanHeuristics(parsed.identifiedHeuristics);
        for (const h of heuristics) {
          this.memory.addHeuristic(h);
        }
        const critique = typeof parsed.critique === 'string' && parsed.critique ? parsed.critique : 'Evaluated trajectory';
        this.memory.addEpisodicMemory({
          task: trajectory.task,
          outcome: succeeded ? 'success' : 'failure',
          learnedLesson: critique.slice(0, 600),
          tags: ['self-improvement', succeeded ? 'success' : 'failure']
        });
        await this.memory.save();

        return {
          succeeded: !!parsed.succeeded,
          critique,
          identifiedHeuristics: heuristics,
          suggestedAction: typeof parsed.suggestedAction === 'string' && parsed.suggestedAction ? parsed.suggestedAction : 'Continue iterative refinement',
          source: 'model'
        };
      }
    } catch {
      // fall through to the factual summary below
    }

    // No usable critique from the model. Record what happened, and do not invent lessons:
    // anything stored as a heuristic is injected into every future prompt.
    const facts = `${trajectory.steps.length} step(s), ${errorCount} tool error(s), reward ${trajectory.finalReward.toFixed(2)}.`;
    this.memory.addEpisodicMemory({
      task: trajectory.task,
      outcome: succeeded ? 'success' : 'failure',
      learnedLesson: facts,
      tags: ['reflection-fallback', succeeded ? 'success' : 'failure']
    });
    await this.memory.save();

    return {
      succeeded,
      critique: `No model critique available. ${facts}`,
      identifiedHeuristics: [],
      suggestedAction: errorCount > 0 ? 'Review the failed tool calls in the trajectory.' : 'None.',
      source: 'fallback'
    };
  }
}
