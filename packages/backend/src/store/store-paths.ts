import path from 'node:path';
import fs from 'node:fs/promises';
import { config } from '../config.js';

export function getDataDir(): string {
  return config.dataDir;
}

export function getUsersPath(): string {
  return path.join(getDataDir(), 'users.json');
}

export function getConversationsDir(): string {
  return path.join(getDataDir(), 'conversations');
}

export function getPlansDir(): string {
  return path.join(getDataDir(), 'plans');
}

export function getProjectsDir(): string {
  return path.join(getDataDir(), 'projects');
}

export function getSecretsPath(): string {
  return path.join(getDataDir(), 'secrets.json');
}

export function getPermissionsPath(): string {
  return path.join(getDataDir(), 'permissions.json');
}

export function getRolesPath(): string {
  return path.join(getDataDir(), 'roles.json');
}

export async function initDataDir(): Promise<void> {
  const dirs = [getDataDir(), getConversationsDir(), getPlansDir(), getProjectsDir()];
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}
