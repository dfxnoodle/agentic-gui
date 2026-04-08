import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CLIConfig } from '@agentic-gui/shared';
import { createReadOnlyCLIConfig, createReadOnlyWorkspaceSnapshot } from './read-only-workspace.js';

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(async (dir) => {
    await makeTreeWritable(dir);
    await fs.rm(dir, { recursive: true, force: true });
  }));
});

async function makeTreeWritable(rootPath: string): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      await makeTreeWritable(entryPath);
      await fs.chmod(entryPath, 0o755);
      continue;
    }

    if (entry.isFile()) {
      await fs.chmod(entryPath, 0o644);
    }
  }

  await fs.chmod(rootPath, 0o755);
}

describe('createReadOnlyCLIConfig', () => {
  it('strips mutating config and forces read-only tools', () => {
    const config: CLIConfig = {
      maxTurns: 10,
      maxBudgetUsd: 12,
      maxRuntimeMs: 60000,
      watchdogTimeoutMs: 30000,
      allowedTools: ['Read', 'Edit'],
      additionalFlags: ['--full-auto'],
      envOverrides: { HOME: '/tmp/elsewhere' },
    };

    expect(createReadOnlyCLIConfig(config)).toEqual({
      maxTurns: 10,
      maxBudgetUsd: 12,
      maxRuntimeMs: 60000,
      watchdogTimeoutMs: 30000,
      allowedTools: ['Read'],
      additionalFlags: undefined,
      envOverrides: undefined,
    });
  });
});

describe('createReadOnlyWorkspaceSnapshot', () => {
  it('copies files into a read-only snapshot and skips symlinks', async () => {
    const sourceDir = await createTempDir('readonly-source-');
    const isolationDir = await createTempDir('readonly-isolation-');
    const externalDir = await createTempDir('readonly-external-');

    const nestedDir = path.join(sourceDir, 'src');
    const externalFile = path.join(externalDir, 'secret.txt');
    const sourceFile = path.join(nestedDir, 'index.ts');
    const symlinkPath = path.join(sourceDir, 'linked-secret.txt');

    await fs.mkdir(nestedDir, { recursive: true });
    await fs.writeFile(sourceFile, 'export const answer = 42;\n', 'utf-8');
    await fs.writeFile(externalFile, 'outside workspace\n', 'utf-8');
    await fs.symlink(externalFile, symlinkPath);

    const snapshotPath = await createReadOnlyWorkspaceSnapshot(sourceDir, isolationDir);
    const snapshotFile = path.join(snapshotPath, 'src', 'index.ts');
    const snapshotDir = path.join(snapshotPath, 'src');

    await expect(fs.readFile(snapshotFile, 'utf-8')).resolves.toBe('export const answer = 42;\n');
    await expect(fs.access(path.join(snapshotPath, 'linked-secret.txt'))).rejects.toThrow();

    const fileStat = await fs.stat(snapshotFile);
    const dirStat = await fs.stat(snapshotDir);
    expect(fileStat.mode & 0o777).toBe(0o444);
    expect(dirStat.mode & 0o777).toBe(0o555);
  });

  it('skips unreadable files instead of failing snapshot creation', async () => {
    const sourceDir = await createTempDir('readonly-source-');
    const isolationDir = await createTempDir('readonly-isolation-');
    const readableFile = path.join(sourceDir, 'README.md');
    const unreadableFile = path.join(sourceDir, '.credentials_rsaparams');

    await fs.writeFile(readableFile, 'ok\n', 'utf-8');
    await fs.writeFile(unreadableFile, 'secret\n', 'utf-8');
    await fs.chmod(unreadableFile, 0o000);

    const snapshotPath = await createReadOnlyWorkspaceSnapshot(sourceDir, isolationDir);

    await expect(fs.readFile(path.join(snapshotPath, 'README.md'), 'utf-8')).resolves.toBe('ok\n');
    await expect(fs.access(path.join(snapshotPath, '.credentials_rsaparams'))).rejects.toThrow();
  });

  it('excludes node_modules, .git, and other heavy directories', async () => {
    const sourceDir = await createTempDir('readonly-source-');
    const isolationDir = await createTempDir('readonly-isolation-');

    await fs.mkdir(path.join(sourceDir, 'src'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'src', 'app.ts'), 'main()\n', 'utf-8');
    await fs.mkdir(path.join(sourceDir, 'node_modules', 'some-pkg'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'node_modules', 'some-pkg', 'index.js'), '{}', 'utf-8');
    await fs.mkdir(path.join(sourceDir, '.git', 'objects'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf-8');
    await fs.mkdir(path.join(sourceDir, 'dist'), { recursive: true });
    await fs.writeFile(path.join(sourceDir, 'dist', 'bundle.js'), '!function(){}', 'utf-8');

    const snapshotPath = await createReadOnlyWorkspaceSnapshot(sourceDir, isolationDir);

    await expect(fs.readFile(path.join(snapshotPath, 'src', 'app.ts'), 'utf-8')).resolves.toBe('main()\n');
    await expect(fs.access(path.join(snapshotPath, 'node_modules'))).rejects.toThrow();
    await expect(fs.access(path.join(snapshotPath, '.git'))).rejects.toThrow();
    await expect(fs.access(path.join(snapshotPath, 'dist'))).rejects.toThrow();
  });
});