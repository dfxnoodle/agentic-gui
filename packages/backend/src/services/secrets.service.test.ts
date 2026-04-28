import { describe, it, expect } from 'vitest';
import {
  buildCodexAzureOpenAIConfigToml,
  buildCodexProviderEnvVars,
  buildOpenCodeProviderEnvVars,
  getCodexAzureOpenAIFieldsFromEnv,
} from './secrets.service.js';

describe('Codex Azure OpenAI config', () => {
  it('maps Azure OpenAI mode to Codex env vars', () => {
    const env = buildCodexProviderEnvVars({
      authMode: 'azure_openai',
      fields: {
        apiKey: 'azure-key',
        baseUrl: 'https://example.openai.azure.com/openai/v1',
        modelDeploymentName: 'gpt-5-codex',
        modelReasoningEffort: 'high',
      },
    });

    expect(env.AZURE_OPENAI_API_KEY).toBe('azure-key');
    expect(env.AZURE_OPENAI_BASE_URL).toBe('https://example.openai.azure.com/openai/v1');
    expect(env.AZURE_OPENAI_MODEL).toBe('gpt-5-codex');
    expect(env.CODEX_MODEL_REASONING_EFFORT).toBe('high');
  });

  it('builds Codex config.toml for Azure OpenAI Responses API', () => {
    const toml = buildCodexAzureOpenAIConfigToml({
      baseUrl: 'https://example.openai.azure.com',
      modelDeploymentName: 'gpt-5-codex',
    });

    expect(toml).toContain('model_provider = "azure"');
    expect(toml).toContain('base_url = "https://example.openai.azure.com/openai/v1"');
    expect(toml).toContain('env_key = "AZURE_OPENAI_API_KEY"');
    expect(toml).toContain('wire_api = "responses"');
  });

  it('detects complete Azure OpenAI env configuration', () => {
    const fields = getCodexAzureOpenAIFieldsFromEnv({
      AZURE_OPENAI_API_KEY: 'azure-key',
      AZURE_OPENAI_ENDPOINT: 'https://example.openai.azure.com',
      AZURE_OPENAI_DEPLOYMENT_NAME: 'gpt-5-codex',
    });

    expect(fields).toEqual({
      apiKey: 'azure-key',
      baseUrl: 'https://example.openai.azure.com',
      modelDeploymentName: 'gpt-5-codex',
    });
  });
});

describe('buildOpenCodeProviderEnvVars', () => {
  it('maps anthropic mode to ANTHROPIC_API_KEY', () => {
    const env = buildOpenCodeProviderEnvVars({
      authMode: 'anthropic_api_key',
      fields: { apiKey: 'sk-ant-test' },
    });

    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-test');
  });

  it('maps gemini mode to compatible google env vars', () => {
    const env = buildOpenCodeProviderEnvVars({
      authMode: 'gemini_api_key',
      fields: { apiKey: 'AIza-test' },
    });

    expect(env.GOOGLE_GENERATIVE_AI_API_KEY).toBe('AIza-test');
    expect(env.GOOGLE_API_KEY).toBe('AIza-test');
    expect(env.GEMINI_API_KEY).toBe('AIza-test');
  });

  it('builds openrouter inline config with api key', () => {
    const env = buildOpenCodeProviderEnvVars({
      authMode: 'openrouter_api_key',
      fields: { apiKey: 'sk-or-test' },
    });

    expect(env.OPENROUTER_API_KEY).toBe('sk-or-test');
    expect(env.OPENCODE_CONFIG_CONTENT).toBeDefined();

    const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT!);
    expect(config.provider.openrouter.options.apiKey).toBe('sk-or-test');
  });

  it('builds ollama local config with default model selection', () => {
    const env = buildOpenCodeProviderEnvVars({
      authMode: 'ollama_local',
      fields: {
        baseUrl: 'http://localhost:11434/v1',
        modelId: 'qwen2.5-coder:7b',
        modelName: 'Qwen 2.5 Coder 7B',
      },
    });

    expect(env.OPENCODE_CONFIG_CONTENT).toBeDefined();

    const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT!);
    expect(config.model).toBe('ollama/qwen2.5-coder:7b');
    expect(config.provider.ollama.options.baseURL).toBe('http://localhost:11434/v1');
    expect(config.provider.ollama.options.apiKey).toBe('ollama');
    expect(config.provider.ollama.models['qwen2.5-coder:7b']).toEqual({
      name: 'Qwen 2.5 Coder 7B',
      tool_call: true,
      reasoning: true,
    });
  });

  it('defaults the Ollama model display name to the model id', () => {
    const env = buildOpenCodeProviderEnvVars({
      authMode: 'ollama_local',
      fields: {
        baseUrl: 'http://localhost:11434/v1',
        modelId: 'qwen3:8b-q4_K_M',
      },
    });

    const config = JSON.parse(env.OPENCODE_CONFIG_CONTENT!);
    expect(config.provider.ollama.models['qwen3:8b-q4_K_M'].name).toBe('qwen3:8b-q4_K_M');
  });
});
