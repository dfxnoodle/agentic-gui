import type { Plan, ContradictionCheck, CLIConfig, CredentialPreference, CLIProvider } from '@agentic-gui/shared';
import { runnerService } from './cli-runner/runner.service.js';
import { memoryService } from './memory.service.js';

/**
 * Spawns a sub-agent to check a proposed plan against existing MEMORY.md for contradictions.
 * Uses the project's configured CLI provider with --max-turns 1 and read-only mode.
 */
export const contradictionService = {
  async check(
    plan: Plan,
    projectPath: string,
    cliProvider: CLIProvider,
    cliConfig: CLIConfig,
    credentialPreference?: CredentialPreference,
  ): Promise<ContradictionCheck> {
    const existingMemory = await memoryService.read(projectPath);

    // If no memory exists, there can be no contradictions
    if (!existingMemory) {
      return {
        checkedAt: new Date().toISOString(),
        conflicts: [],
        verdict: 'no_conflicts',
      };
    }

    // Build a concise representation of the plan
    const planText = formatPlanForCheck(plan);

    const prompt = `You are a reviewer checking a proposed plan against existing project decisions.

<existing-memory>
${existingMemory}
</existing-memory>

<proposed-plan>
${planText}
</proposed-plan>

Compare the proposed plan against the existing memory entries. Look for:
1. Direct contradictions (plan says X, memory says not-X)
2. Conflicting approaches (plan uses approach A, memory committed to approach B)
3. Redundancies (plan proposes something already done)

Respond ONLY with a JSON object, no other text:
{
  "verdict": "no_conflicts" or "conflicts_found",
  "conflicts": [
    {
      "existingMemory": "the relevant memory entry",
      "proposedChange": "what the plan proposes",
      "explanation": "why these conflict"
    }
  ]
}

If there are no conflicts, return: {"verdict": "no_conflicts", "conflicts": []}`;

    try {
      // Use a restricted config for the contradiction check
      const checkConfig: CLIConfig = {
        ...cliConfig,
        maxTurns: 1,
        maxRuntimeMs: 60000, // 1 minute max
        watchdogTimeoutMs: 30000,
        allowedTools: ['Read'], // Read-only
      };

      const job = await runnerService.runJob({
        conversationId: `contradiction-${plan.id}`,
        projectId: plan.projectId,
        projectPath,
        cliProvider,
        cliConfig: checkConfig,
        userMessage: prompt,
        taskType: 'contradiction',
        credentialPreference,
      });

      const result = await job.completed;

      // Try to parse the JSON response
      return parseContradictionResponse(result.fullText);
    } catch (err) {
      // If the sub-agent fails, return a safe default (no conflicts detected)
      console.error('Contradiction check failed:', err);
      return {
        checkedAt: new Date().toISOString(),
        conflicts: [],
        verdict: 'no_conflicts',
      };
    }
  },
};

function formatPlanForCheck(plan: Plan): string {
  const lines: string[] = [];
  lines.push(`# ${plan.title}`);
  lines.push('');
  lines.push(plan.summary);
  lines.push('');
  for (const section of plan.sections) {
    lines.push(`## ${section.heading}`);
    lines.push(section.body);
    lines.push('');
  }
  return lines.join('\n');
}

function parseContradictionResponse(text: string): ContradictionCheck {
  const now = new Date().toISOString();

  // Try to extract JSON from the response
  const jsonMatch = text.match(/\{[\s\S]*"verdict"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        checkedAt: now,
        conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
        verdict: parsed.verdict === 'conflicts_found' ? 'conflicts_found' : 'no_conflicts',
      };
    } catch {
      // Fall through
    }
  }

  // If we can't parse, check for keywords
  const lower = text.toLowerCase();
  if (lower.includes('conflict') || lower.includes('contradict')) {
    return {
      checkedAt: now,
      conflicts: [{
        existingMemory: 'Unable to parse structured response',
        proposedChange: 'See full text below',
        explanation: text.slice(0, 500),
      }],
      verdict: 'conflicts_found',
    };
  }

  return {
    checkedAt: now,
    conflicts: [],
    verdict: 'no_conflicts',
  };
}
