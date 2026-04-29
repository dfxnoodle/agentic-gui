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
      const projectStats = await fs.stat(projectPath);
      if (!projectStats.isDirectory()) {
        throw new Error('path is not a directory');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw Object.assign(
        new Error(`Project destination folder is not accessible: ${projectPath}. ${message}`),
        { status: 400 },
      );
    }

    try {
      existing = await fs.readFile(memoryPath, 'utf-8');
    } catch (err) {
      if (isNotFoundError(err)) {
        // File doesn't exist — start with a header
        existing = '# Project Memory\n\nThis file records approved plans and decisions.\n\n---\n';
      } else {
        const message = err instanceof Error ? err.message : String(err);
        throw Object.assign(
          new Error(`Cannot read MEMORY.md at ${memoryPath}: ${message}`),
          { status: 500 },
        );
      }
    }

    const approvedAt = new Date();
    const entry = formatMemoryEntry(plan, approvedAt, approverName);

    const updated = existing.trimEnd() + '\n\n' + entry + '\n';

    // Atomic write
    const tmpPath = memoryPath + '.tmp';
    try {
      await fs.writeFile(tmpPath, updated, 'utf-8');
      await fs.rename(tmpPath, memoryPath);
    } catch (err) {
      await fs.rm(tmpPath, { force: true }).catch(() => undefined);
      const message = err instanceof Error ? err.message : String(err);
      throw Object.assign(
        new Error(`Cannot write MEMORY.md at ${memoryPath}: ${message}`),
        { status: 500 },
      );
    }
  },
};

function isNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

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
