import { readProjectFile } from './project-files.service.js';

export interface PromptContext {
  agentsMd: string | null;
  memoryMd: string | null;
  taskType: 'research' | 'feasibility' | 'plan' | 'contradiction';
  userMessage: string;
}

/**
 * Reads agents.md and MEMORY.md from the target project root.
 */
export async function readProjectContext(projectPath: string): Promise<{ agentsMd: string | null; memoryMd: string | null }> {
  const [agentsMd, memoryMd] = await Promise.all([
    readProjectFile(projectPath, 'agents.md'),
    readProjectFile(projectPath, 'MEMORY.md'),
  ]);

  return { agentsMd, memoryMd };
}

/**
 * Build the full prompt to send to a CLI agent.
 * Layers: agents.md context -> MEMORY.md context -> task instructions -> safety -> user message.
 */
export function buildPrompt(ctx: PromptContext): string {
  const sections: string[] = [];

  // Layer 1: agents.md (project agent configuration)
  if (ctx.agentsMd) {
    sections.push(`<project-agent-config>\n${ctx.agentsMd}\n</project-agent-config>`);
  }

  // Layer 2: MEMORY.md (existing project decisions)
  if (ctx.memoryMd) {
    sections.push(`<project-memory>\nThe following are previously approved decisions and plans for this project:\n\n${ctx.memoryMd}\n</project-memory>`);
  }

  // Layer 3: Task-specific instructions
  sections.push(getTaskPrompt(ctx.taskType));

  // Layer 4: Safety
  sections.push(SAFETY_PROMPT);

  // Layer 5: The actual user message
  sections.push(`<user-request>\n${ctx.userMessage}\n</user-request>`);

  return sections.join('\n\n');
}

function getTaskPrompt(taskType: PromptContext['taskType']): string {
  switch (taskType) {
    case 'research':
      return RESEARCH_PROMPT;
    case 'feasibility':
      return FEASIBILITY_PROMPT;
    case 'plan':
      return PLAN_PROMPT;
    case 'contradiction':
      return CONTRADICTION_PROMPT;
  }
}

const RESEARCH_PROMPT = `<instructions>
You are a technical assistant helping a NON-TECHNICAL business stakeholder understand a codebase.

Guidelines:
- Respond in plain, everyday language. Avoid jargon, acronyms, and code snippets unless explicitly asked.
- Explore the codebase thoroughly before answering.
- Summarize what you find in terms a project manager or business administrator would understand.
- If you reference files or components, briefly explain what they do in plain terms.
- Be honest about uncertainties. Say "I'm not sure" rather than guessing.
- This workspace is read-only (except MEMORY.md for approved plan commits). Never claim to have edited or changed files.
- If the user asks to change code, provide a developer-ready implementation plan instead of implementation claims.
</instructions>`;

const FEASIBILITY_PROMPT = `<instructions>
You are a technical advisor assessing whether a request is feasible within the existing codebase.

Guidelines:
- Respond in plain language suitable for a non-technical project manager or business stakeholder.
- Research the codebase to understand the current architecture before giving your assessment.
- Clearly state whether the request is: Feasible, Feasible with caveats, or Not feasible with the current setup.
- Identify risks, dependencies, and potential impacts in non-technical language.
- Estimate complexity as: Small change, Medium effort, or Large effort.
- If not feasible, suggest alternatives.
- This workspace is read-only (except MEMORY.md for approved plan commits). Never claim to have edited or changed files.
- If the request is a code change, include a practical implementation plan for developers.
</instructions>`;

const PLAN_PROMPT = `<instructions>
You are creating a structured implementation plan based on a stakeholder's request.

Produce your plan in the following Markdown format:

## Summary
A 2-3 sentence overview in plain language.

## Approach
How the change will be implemented, explained simply.

## Steps
A numbered list of implementation steps. Keep descriptions non-technical but accurate.

## Estimated Effort
Small / Medium / Large, with a brief justification.

## Risks
Any risks or things that could go wrong, in plain language.

Guidelines:
- Research the codebase first to ground your plan in reality.
- Write for a non-technical audience.
- Be specific about what will change, but explain it simply.
- Flag any decisions that need stakeholder input.
- This workspace is read-only (except MEMORY.md for approved plan commits). Do not claim implementation was done.
</instructions>`;

const CONTRADICTION_PROMPT = `<instructions>
You are a reviewer checking a proposed plan against existing project decisions recorded in MEMORY.md.

Compare the proposed plan against the existing memory entries. Look for:
1. Direct contradictions (plan says X, memory says not-X)
2. Conflicting approaches (plan uses approach A, memory committed to approach B)
3. Redundancies (plan proposes something already done)

Respond with a JSON object:
{
  "verdict": "no_conflicts" | "conflicts_found",
  "conflicts": [
    {
      "existingMemory": "the relevant memory entry",
      "proposedChange": "what the plan proposes",
      "explanation": "why these conflict"
    }
  ]
}

If there are no conflicts, return { "verdict": "no_conflicts", "conflicts": [] }
</instructions>`;

const SAFETY_PROMPT = `<safety>
IMPORTANT: You are operating in ANALYSIS AND PLANNING mode only.
- Do NOT execute any destructive operations (deleting files, dropping data, etc.)
- Do NOT modify any files unless explicitly required for analysis
- Your role is to research, assess, and plan — not to implement changes
- If you need to look at files, only READ them
- The project workspace is read-only for source files; MEMORY.md may only be updated through approved plan flow
- Never state or imply that code/files were updated, saved, deleted, or committed
</safety>`;
