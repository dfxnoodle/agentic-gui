import { describe, it, expect } from 'vitest';
import {
  classifyAuthFailure,
  stripProviderSecretsFromEnv,
  resolveCredentialAttempts,
} from './credential-strategy.js';

describe('classifyAuthFailure', () => {
  it('returns false on success', () => {
    expect(classifyAuthFailure('claude', 0, 'err', '')).toBe(false);
    expect(classifyAuthFailure('claude', null, 'err', '')).toBe(false);
  });

  it('detects 401 in stderr', () => {
    expect(classifyAuthFailure('claude', 1, 'Request failed with 401', '')).toBe(true);
  });

  it('detects invalid_api_key', () => {
    expect(classifyAuthFailure('codex', 1, 'invalid_api_key', '')).toBe(true);
  });

  it('returns false for generic errors', () => {
    expect(classifyAuthFailure('claude', 1, 'ENOENT: no such file', '')).toBe(false);
  });
});

describe('stripProviderSecretsFromEnv', () => {
  it('removes known keys for claude', () => {
    const env: NodeJS.ProcessEnv = { ...process.env, ANTHROPIC_API_KEY: 'x' };
    stripProviderSecretsFromEnv(env, 'claude');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('removes common provider keys for opencode', () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      OPENAI_API_KEY: 'x',
      ANTHROPIC_API_KEY: 'y',
    };
    stripProviderSecretsFromEnv(env, 'opencode');
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('removes Azure OpenAI keys for codex local attempts', () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      AZURE_OPENAI_API_KEY: 'x',
      AZURE_OPENAI_BASE_URL: 'https://example.openai.azure.com/openai/v1',
      AZURE_OPENAI_MODEL: 'gpt-5-codex',
    };
    stripProviderSecretsFromEnv(env, 'codex');
    expect(env.AZURE_OPENAI_API_KEY).toBeUndefined();
    expect(env.AZURE_OPENAI_BASE_URL).toBeUndefined();
    expect(env.AZURE_OPENAI_MODEL).toBeUndefined();
  });
});

describe('resolveCredentialAttempts', () => {
  it('returns only platform for Vertex', async () => {
    const plan = await resolveCredentialAttempts({
      provider: 'gemini',
      projectPath: '/tmp',
      credentialPreference: 'local_first',
      apiKey: null,
      hasAltAuth: true,
    });
    expect(plan.attempts).toEqual([{ mode: 'platform' }]);
  });

  it('platform_only with no key yields empty attempts', async () => {
    const plan = await resolveCredentialAttempts({
      provider: 'claude',
      projectPath: '/tmp',
      credentialPreference: 'platform_only',
      apiKey: null,
      hasAltAuth: false,
    });
    expect(plan.attempts).toEqual([]);
  });

  it('platform_only with key yields single platform attempt', async () => {
    const plan = await resolveCredentialAttempts({
      provider: 'claude',
      projectPath: '/tmp',
      credentialPreference: 'platform_only',
      apiKey: 'sk-test',
      hasAltAuth: false,
    });
    expect(plan.attempts).toEqual([{ mode: 'platform' }]);
    expect(plan.platformApiKey).toBe('sk-test');
  });

  it('detects OpenCode auth failures from API key messages', () => {
    expect(classifyAuthFailure('opencode', 1, 'missing api key for provider openai', '')).toBe(true);
  });
});
