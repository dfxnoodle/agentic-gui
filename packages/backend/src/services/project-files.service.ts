import fs from 'node:fs/promises';
import path from 'node:path';

export async function resolveProjectFilePath(projectPath: string, fileName: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(projectPath, { withFileTypes: true });
    const normalizedFileName = fileName.toLowerCase();
    const match = entries.find((entry) => entry.isFile() && entry.name.toLowerCase() === normalizedFileName);

    return match ? path.join(projectPath, match.name) : null;
  } catch {
    return null;
  }
}

export async function readProjectFile(projectPath: string, fileName: string): Promise<string | null> {
  const filePath = await resolveProjectFilePath(projectPath, fileName);
  if (!filePath) {
    return null;
  }

  return fs.readFile(filePath, 'utf-8');
}