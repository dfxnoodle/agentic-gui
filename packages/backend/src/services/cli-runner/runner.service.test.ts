import { describe, it, expect } from 'vitest';
import { applyProviderRuntimeDefaults } from './runner.service.js';
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
