import { describe, it, expect } from 'vitest';
import { applyProviderRuntimeDefaults, runnerService, type RunJobRequest } from './runner.service.js';
import { GeminiAdapter } from './adapters/gemini.adapter.js';
import type { CLIConfig, ProviderConfig } from '@agentic-gui/shared';

const baseConfig: CLIConfig = {
  maxTurns: 10,
  maxRuntimeMs: 300000,
  watchdogTimeoutMs: 60000,
};

describe('applyProviderRuntimeDefaults', () => {
  it('caps Cursor watchdog at 30 seconds', () => {
    const result = applyProviderRuntimeDefaults('cursor', {
      ...baseConfig,
      watchdogTimeoutMs: 90000,
    }, null);

    expect(result.watchdogTimeoutMs).toBe(30000);
  });

  it('extends OpenCode watchdog to at least 120 seconds for non-Ollama runs', () => {
    const result = applyProviderRuntimeDefaults('opencode', baseConfig, null);
    expect(result.watchdogTimeoutMs).toBe(120000);
  });

  it('extends Codex watchdog to at least 180 seconds for long reads', () => {
    const result = applyProviderRuntimeDefaults('codex', baseConfig, null);
    expect(result.watchdogTimeoutMs).toBe(180000);
  });

  it('does not extend provider watchdog beyond max runtime', () => {
    const result = applyProviderRuntimeDefaults('gemini', {
      ...baseConfig,
      maxRuntimeMs: 120000,
      watchdogTimeoutMs: 60000,
    }, null);
    expect(result.watchdogTimeoutMs).toBe(120000);
  });

  it('uses max runtime as watchdog for OpenCode Ollama local runs', () => {
    const providerConfig: ProviderConfig = {
      authMode: 'ollama_local',
      fields: {
        baseUrl: 'http://localhost:11434/v1',
        modelId: 'qwen3:8b-q4_K_M',
      },
    };

    const result = applyProviderRuntimeDefaults('opencode', baseConfig, providerConfig);
    expect(result.watchdogTimeoutMs).toBe(baseConfig.maxRuntimeMs);
  });
});

describe('runnerService._buildChildEnv', () => {
  const request: RunJobRequest = {
    conversationId: 'conv',
    projectId: 'project',
    projectPath: '/tmp/project',
    cliProvider: 'gemini',
    cliConfig: baseConfig,
    userMessage: 'hello',
    taskType: 'research',
  };

  it('preserves HOME for local credential attempts so CLI auth can be reused', async () => {
    const previousGeminiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'from-parent-env';

    try {
      const env = await runnerService._buildChildEnv(
        request,
        new GeminiAdapter(),
        'local',
        '',
        '/tmp/agentic-gui-test',
      );

      expect(env.HOME).toBe(process.env.HOME);
      expect(env.GEMINI_API_KEY).toBeUndefined();
    } finally {
      if (previousGeminiKey === undefined) {
        delete process.env.GEMINI_API_KEY;
      } else {
        process.env.GEMINI_API_KEY = previousGeminiKey;
      }
    }
  });

  it('isolates HOME for platform credential attempts', async () => {
    const env = await runnerService._buildChildEnv(
      request,
      new GeminiAdapter(),
      'platform',
      'platform-key',
      '/tmp/agentic-gui-test',
      {},
      { GEMINI_API_KEY: 'platform-key' },
    );

    expect(env.HOME).toBe('/tmp/agentic-gui-test');
    expect(env.GEMINI_API_KEY).toBe('platform-key');
  });
});
