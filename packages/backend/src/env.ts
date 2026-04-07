import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

export const ENV_FILE_PATH = path.join(repoRoot, '.env');
export const ENV_SAMPLE_FILE_PATH = path.join(repoRoot, '.env.example');

const requiredEnvVars = ['ADMIN_USERNAME', 'ADMIN_PASSWORD'] as const;

const exampleValues: Record<(typeof requiredEnvVars)[number], string> = {
  ADMIN_USERNAME: 'replace-admin-username',
  ADMIN_PASSWORD: 'replace-admin-password',
};

dotenv.config({ path: ENV_FILE_PATH, quiet: true });

export function getEnvironmentValidationError(fileExists: boolean, env: NodeJS.ProcessEnv): string | null {
  if (!fileExists) {
    return `Missing required environment file at ${ENV_FILE_PATH}. Copy ${ENV_SAMPLE_FILE_PATH} to .env and set the admin bootstrap credentials.`;
  }

  const missingVars = requiredEnvVars.filter((key) => !env[key]?.trim());
  if (missingVars.length > 0) {
    return `Missing required environment variables in ${ENV_FILE_PATH}: ${missingVars.join(', ')}`;
  }

  const unchangedExampleVars = requiredEnvVars.filter((key) => env[key] === exampleValues[key]);
  if (unchangedExampleVars.length > 0) {
    return `Update the sample values for ${unchangedExampleVars.join(', ')} in ${ENV_FILE_PATH} before starting the backend.`;
  }

  return null;
}

export function validateRuntimeEnvironment(): void {
  const error = getEnvironmentValidationError(fs.existsSync(ENV_FILE_PATH), process.env);
  if (error) {
    throw new Error(error);
  }
}