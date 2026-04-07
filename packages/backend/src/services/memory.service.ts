import fs from 'node:fs/promises';
import path from 'node:path';
import type { Plan } from '@agentic-gui/shared';
import { readProjectFile, resolveProjectFilePath } from './project-files.service.js';

export const memoryService = {
  /**
   * Read MEMORY.md from the target project root.
   */
  async read(projectPath: string): Promise<string | null> {
    return readProjectFile(projectPath, 'MEMORY.md');
  },

  /**
   * Append an approved plan entry to MEMORY.md.
   * Creates the file if it doesn't exist.
   * Uses atomic write (tmp + rename) to prevent corruption.
   */
  async appendPlan(projectPath: string, plan: Plan, approverName: string): Promise<void> {
    const memoryPath = await resolveProjectFilePath(projectPath, 'MEMORY.md') ?? path.join(projectPath, 'MEMORY.md');
    let existing = '';

    try {
      existing = await fs.readFile(memoryPath, 'utf-8');
    } catch {
      // File doesn't exist — start with a header
      existing = '# Project Memory\n\nThis file records approved plans and decisions.\n\n---\n';
    }

    const approvedAt = new Date();
    const entry = formatMemoryEntry(plan, approvedAt, approverName);

    const updated = existing.trimEnd() + '\n\n' + entry + '\n';

    // Atomic write
    const tmpPath = memoryPath + '.tmp';
    await fs.writeFile(tmpPath, updated, 'utf-8');
    await fs.rename(tmpPath, memoryPath);
  },
};

function formatMemoryEntry(plan: Plan, approvedAt: Date, approverName: string): string {
  const lines: string[] = [];
  const approvedAtIso = approvedAt.toISOString();

  lines.push(`## [${approvedAtIso}] ${plan.title}`);
  lines.push('');
  lines.push(`- **Approved by**: ${approverName}`);
  lines.push(`- **Plan ID**: ${plan.id}`);
  lines.push(`- **Plan version**: v${plan.version}`);
  lines.push(`- **Plan created at**: ${plan.createdAt}`);
  lines.push(`- **Plan approved at**: ${approvedAtIso}`);
  lines.push(`- **Summary**: ${plan.summary}`);
  lines.push('');

  // Preserve plan detail so MEMORY.md remains useful after the original plan is removed.
  lines.push('### Detailed Plan');
  lines.push('');
  for (const section of plan.sections) {
    const heading = section.heading.trim() || 'Details';
    lines.push(`#### ${heading}`);
    lines.push(section.body.trim() || '_No details provided._');
    if (section.estimatedEffort) {
      lines.push('');
      lines.push(`Estimated effort for section: **${section.estimatedEffort}**`);
    }
    lines.push('');
  }

  if (plan.sections.some((s) => s.estimatedEffort)) {
    const effort = plan.sections.find((s) => s.estimatedEffort)!.estimatedEffort;
    lines.push(`- **Overall estimated effort**: ${effort}`);
  }

  lines.push('');
  lines.push('---');

  return lines.join('\n');
}
