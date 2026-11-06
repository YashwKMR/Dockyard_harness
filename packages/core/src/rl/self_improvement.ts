import { AgentTrajectory } from './trajectory.js';
import { MemoryEngine } from '../memory/engine.js';

export interface CritiqueResult {
  trajectoryId: string;
  summary: string;
  extractedHeuristics: Array<{
    key: string;
    rule: string;
    confidence: number;
  }>;
  suggestedFixes: string[];
}

export class SelfImprovementEngine {
  /**
   * Run an automated retrospective pass over an agent trajectory
   * and distill durable heuristics into the memory engine.
   */
  public critiqueAndDistill(trajectory: AgentTrajectory, memory: MemoryEngine): CritiqueResult {
    const failedSteps = trajectory.steps.filter((s) => !s.observation.success);
    const successfulSteps = trajectory.steps.filter((s) => s.observation.success);

    const extractedHeuristics: CritiqueResult['extractedHeuristics'] = [];
    const suggestedFixes: string[] = [];

    // 1. Analyze failed tool executions
    for (const fail of failedSteps) {
      const tool = fail.action.toolName;
      const error = fail.observation.error || 'Unknown execution error';

      if (tool === 'execute_command') {
        const cmd = fail.action.args?.command || '';
        const fix = `Command failed: '${cmd}'. Error: ${error}. Recommend validating arguments and environment prerequisites first.`;
        suggestedFixes.push(fix);

        const heuristicKey = `rule_cmd_${Math.abs(hashString(cmd)).toString(16).substring(0, 6)}`;
        const rule = `When executing shell commands like '${cmd.split(' ')[0]}', handle error '${error.slice(0, 50)}'`;

        extractedHeuristics.push({
          key: heuristicKey,
          rule,
          confidence: 0.85,
        });

        memory.set('error_recovery', heuristicKey, rule, ['auto-distilled', tool]);
      } else if (tool === 'write_file' || tool === 'read_file') {
        const file = fail.action.args?.filepath || '';
        const rule = `Ensure parent directories exist and paths are verified before file operations on '${file}'.`;
        extractedHeuristics.push({
          key: `rule_fs_${tool}`,
          rule,
          confidence: 0.9,
        });
        memory.set('heuristic', `rule_fs_${tool}`, rule, ['filesystem', 'recovery']);
      }
    }

    // 2. Synthesize positive heuristics from successful step patterns
    if (successfulSteps.length > 0 && trajectory.outcome === 'success') {
      const summaryRule = `Successfully completed '${trajectory.taskPrompt.slice(0, 60)}' using ${trajectory.steps.length} verified steps.`;
      memory.set('heuristic', `success_${trajectory.taskId}`, summaryRule, ['proven_pattern']);
    }

    return {
      trajectoryId: trajectory.trajectoryId,
      summary: `Analyzed ${trajectory.steps.length} steps (${failedSteps.length} failures, ${successfulSteps.length} successes). Total reward: ${trajectory.totalReward.toFixed(2)}`,
      extractedHeuristics,
      suggestedFixes,
    };
  }
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
