import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { CLIProvider, CredentialPreference } from '@agentic-gui/shared';

export type CredentialAttemptMode = 'local' | 'platform';

export interface CredentialAttemptSpec {
  mode: CredentialAttemptMode;
}

export interface ResolveCredentialAttemptsInput {
  provider: CLIProvider;
  projectPath: string;
  credentialPreference: CredentialPreference;
  apiKey: string | null;
  /** True when Gemini Vertex (or other non-api_key) auth is configured */
  hasAltAuth: boolean;
}

export interface ResolvedCredentialPlan {
  attempts: CredentialAttemptSpec[];
  /** API key for platform-mode env injection (may be empty when only Vertex) */
  platformApiKey: string;
}

async function pathExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Heuristic: project-local or user-home config dirs that suggest the CLI was set up locally.
 */
export async function detectLocalSetup(provider: CLIProvider, projectPath: string): Promise<boolean> {
  const home = os.homedir();

  switch (provider) {
    case 'claude':
      return isDir(path.join(projectPath, '.claude'));
    case 'codex':
      if (await isDir(path.join(projectPath, '.codex'))) return true;
      return isDir(path.join(home, '.codex'));
    case 'gemini':
      if (await isDir(path.join(projectPath, '.gemini'))) return true;
      return isDir(path.join(home, '.gemini'));
    case 'cursor':
      if (await pathExists(path.join(projectPath, '.cursor'))) return true;
      return pathExists(path.join(home, '.cursor'));
    default:
      return false;
  }
}

/** Env vars cleared on local attempts so inherited shell keys do not mask workspace login. */
export const PROVIDER_SECRET_ENV_VARS: Record<CLIProvider, readonly string[]> = {
  claude: ['ANTHROPIC_API_KEY'],
  codex: ['CODEX_API_KEY', 'OPENAI_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  cursor: ['CURSOR_API_KEY'],
};

export function stripProviderSecretsFromEnv(env: NodeJS.ProcessEnv, provider: CLIProvider): void {
  for (const key of PROVIDER_SECRET_ENV_VARS[provider]) {
    delete env[key];
  }
}

/**
 * Conservative auth-failure detection for retrying with a platform API key.
 * Prefer false negatives over false positives (avoid duplicate billable runs).
 */
export function classifyAuthFailure(
  provider: CLIProvider,
  exitCode: number | null,
  stderr: string,
  stdout: string,
): boolean {
  if (exitCode === 0 || exitCode === null) return false;

  const text = `${stderr}\n${stdout}`.toLowerCase();

  if (/\b401\b/.test(text) || /\b403\b/.test(text)) return true;

  const strong = [
    'invalid api key',
    'invalid_api_key',
    'incorrect api key',
    'authentication failed',
    'not authenticated',
    'missing api key',
    'api key not found',
    'unauthorized',
    'permission denied',
    'invalid x-api-key',
  ];
  if (strong.some((s) => text.includes(s))) return true;

  if (provider === 'claude' && (text.includes('auth') && (text.includes('failed') || text.includes('error')))) {
    return true;
  }
  if (provider === 'codex' && text.includes('openai') && text.includes('invalid')) return true;
  if (provider === 'gemini' && text.includes('api key') && text.includes('invalid')) return true;
  if (provider === 'cursor' && text.includes('api key')) return true;

  return false;
}

export async function resolveCredentialAttempts(input: ResolveCredentialAttemptsInput): Promise<ResolvedCredentialPlan> {
  const { provider, projectPath, credentialPreference, apiKey, hasAltAuth } = input;

  if (hasAltAuth) {
    return {
      attempts: [{ mode: 'platform' }],
      platformApiKey: apiKey ?? '',
    };
  }

  const hasPlatformKey = Boolean(apiKey && apiKey.length > 0);

  if (credentialPreference === 'platform_only') {
    if (!hasPlatformKey) {
      return { attempts: [], platformApiKey: '' };
    }
    return {
      attempts: [{ mode: 'platform' }],
      platformApiKey: apiKey!,
    };
  }

  // local_first
  const localDetected = await detectLocalSetup(provider, projectPath);
  const attempts: CredentialAttemptSpec[] = [];

  if (localDetected) {
    attempts.push({ mode: 'local' });
  }

  if (hasPlatformKey) {
    attempts.push({ mode: 'platform' });
  }

  return {
    attempts,
    platformApiKey: apiKey ?? '',
  };
}
