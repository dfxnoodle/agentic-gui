import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildPrompt, readProjectContext, type PromptContext } from './prompt-builder.service.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function createTempProject(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-builder-'));
  tempDirs.push(dir);

  await Promise.all(
    Object.entries(files).map(([fileName, content]) => fs.writeFile(path.join(dir, fileName), content, 'utf-8')),
  );

  return dir;
}

describe('buildPrompt', () => {
  const base: PromptContext = {
    agentsMd: null,
    memoryMd: null,
    taskType: 'research',
    userMessage: 'What does this project do?',
  };

  it('includes user message', () => {
    const prompt = buildPrompt(base);
    expect(prompt).toContain('<user-request>');
    expect(prompt).toContain('What does this project do?');
    expect(prompt).toContain('</user-request>');
  });

  it('includes safety layer', () => {
    const prompt = buildPrompt(base);
    expect(prompt).toContain('<safety>');
    expect(prompt).toContain('ANALYSIS AND PLANNING');
    expect(prompt).toContain('Never state or imply that code/files were updated');
  });

  it('includes research instructions for research task', () => {
    const prompt = buildPrompt({ ...base, taskType: 'research' });
    expect(prompt).toContain('NON-TECHNICAL');
    expect(prompt).toContain('plain');
    expect(prompt).toContain('provide a developer-ready implementation plan');
  });

  it('includes feasibility instructions', () => {
    const prompt = buildPrompt({ ...base, taskType: 'feasibility' });
    expect(prompt).toContain('Feasible');
    expect(prompt).toContain('risks');
  });

  it('includes plan instructions', () => {
    const prompt = buildPrompt({ ...base, taskType: 'plan' });
    expect(prompt).toContain('## Summary');
    expect(prompt).toContain('## Steps');
  });

  it('includes contradiction instructions', () => {
    const prompt = buildPrompt({ ...base, taskType: 'contradiction' });
    expect(prompt).toContain('conflicts_found');
    expect(prompt).toContain('no_conflicts');
  });

  it('includes agents.md when provided', () => {
    const prompt = buildPrompt({ ...base, agentsMd: '# Agent Config\nUse TypeScript' });
    expect(prompt).toContain('<project-agent-config>');
    expect(prompt).toContain('Use TypeScript');
  });

  it('omits agents.md wrapper when null', () => {
    const prompt = buildPrompt(base);
    expect(prompt).not.toContain('<project-agent-config>');
  });

  it('includes MEMORY.md when provided', () => {
    const prompt = buildPrompt({ ...base, memoryMd: '## Decision: Use React' });
    expect(prompt).toContain('<project-memory>');
    expect(prompt).toContain('Use React');
  });

  it('omits memory wrapper when null', () => {
    const prompt = buildPrompt(base);
    expect(prompt).not.toContain('<project-memory>');
  });
});

describe('readProjectContext', () => {
  it('reads agents and memory files regardless of case', async () => {
    const projectPath = await createTempProject({
      'AgEnTs.Md': '# Agent Config',
      'memory.md': '# Project Memory',
    });

    const context = await readProjectContext(projectPath);

    expect(context).toEqual({
      agentsMd: '# Agent Config',
      memoryMd: '# Project Memory',
    });
  });

  it('returns null for missing context files', async () => {
    const projectPath = await createTempProject({});

    await expect(readProjectContext(projectPath)).resolves.toEqual({
      agentsMd: null,
      memoryMd: null,
    });
  });
});
