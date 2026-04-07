import fs from 'node:fs/promises';
import path from 'node:path';
import type { CLIConfig } from '@agentic-gui/shared';

const READ_ONLY_FILE_MODE = 0o444;
const READ_ONLY_DIR_MODE = 0o555;

/**
 * Build a CLI config that cannot relax execution safety.
 * Project-level env overrides and ad-hoc flags are stripped in read-only mode.
 */
export function createReadOnlyCLIConfig(config: CLIConfig): CLIConfig {
  return {
    ...config,
    allowedTools: ['Read'],
    additionalFlags: undefined,
    envOverrides: undefined,
  };
}

/**
 * Copy the project into a disposable workspace and remove write bits from the snapshot.
 * Symlinks are skipped so the child process cannot follow them back into the live project.
 */
export async function createReadOnlyWorkspaceSnapshot(projectPath: string, isolationDir: string): Promise<string> {
  const snapshotPath = path.join(isolationDir, 'workspace');
  await copyDirectory(projectPath, snapshotPath);
  await makeTreeReadOnly(snapshotPath);
  return snapshotPath;
}

async function copyDirectory(sourceDir: string, destinationDir: string): Promise<void> {
  await fs.mkdir(destinationDir, { recursive: true });

  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);

    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
      continue;
    }

    if (entry.isFile()) {
      await fs.copyFile(sourcePath, destinationPath);
    }
  }
}

async function makeTreeReadOnly(rootPath: string): Promise<void> {
  const entries = await fs.readdir(rootPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(rootPath, entry.name);

    if (entry.isDirectory()) {
      await makeTreeReadOnly(entryPath);
      await fs.chmod(entryPath, READ_ONLY_DIR_MODE);
      continue;
    }

    if (entry.isFile()) {
      await fs.chmod(entryPath, READ_ONLY_FILE_MODE);
    }
  }

  await fs.chmod(rootPath, READ_ONLY_DIR_MODE);
}