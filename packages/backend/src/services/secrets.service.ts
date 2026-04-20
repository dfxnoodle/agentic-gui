import fs from 'node:fs/promises';
import path from 'node:path';
import { getSecretsPath } from '../store/store-paths.js';
import { CLI_AUTH_MODES } from '@agentic-gui/shared';
import type { CLIProvider, ProviderConfig } from '@agentic-gui/shared';

interface Secrets {
  apiKeys: Record<string, string>;
  providerConfigs: Record<string, ProviderConfig>;
}

const OPENCODE_CONFIG_SCHEMA = 'https://opencode.ai/config.json';

function buildOpenCodeInlineConfig(config: ProviderConfig): Record<string, unknown> | null {
  const apiKey = config.fields.apiKey?.trim();

  if (config.authMode === 'openrouter_api_key' && apiKey) {
    return {
      $schema: OPENCODE_CONFIG_SCHEMA,
      provider: {
        openrouter: {
          options: {
            apiKey,
          },
        },
      },
    };
  }

  if (config.authMode === 'ollama_local') {
    const modelId = config.fields.modelId?.trim();
    if (!modelId) return null;

    const baseUrl = config.fields.baseUrl?.trim() || 'http://localhost:11434/v1';
    const modelName = config.fields.modelName?.trim() || modelId;

    return {
      $schema: OPENCODE_CONFIG_SCHEMA,
      model: `ollama/${modelId}`,
      provider: {
        ollama: {
          npm: '@ai-sdk/openai-compatible',
          name: 'Ollama (local)',
          options: {
            baseURL: baseUrl,
            apiKey: 'ollama',
          },
          models: {
            [modelId]: {
              name: modelName,
              tool_call: true,
              reasoning: true,
            },
          },
        },
      },
    };
  }

  return null;
}

export function buildOpenCodeProviderEnvVars(config: ProviderConfig): Record<string, string> {
  const envVars: Record<string, string> = {};
  const apiKey = config.fields.apiKey?.trim();

  switch (config.authMode) {
    case 'api_key':
      if (apiKey) envVars.OPENAI_API_KEY = apiKey;
      break;
    case 'anthropic_api_key':
      if (apiKey) envVars.ANTHROPIC_API_KEY = apiKey;
      break;
    case 'gemini_api_key':
      if (apiKey) {
        envVars.GOOGLE_GENERATIVE_AI_API_KEY = apiKey;
        envVars.GOOGLE_API_KEY = apiKey;
        envVars.GEMINI_API_KEY = apiKey;
      }
      break;
    case 'openrouter_api_key':
      if (apiKey) envVars.OPENROUTER_API_KEY = apiKey;
      break;
  }

  const inlineConfig = buildOpenCodeInlineConfig(config);
  if (inlineConfig) {
    envVars.OPENCODE_CONFIG_CONTENT = JSON.stringify(inlineConfig);
  }

  return envVars;
}

async function readSecrets(): Promise<Secrets> {
  try {
    const raw = await fs.readFile(getSecretsPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      apiKeys: parsed.apiKeys ?? {},
      providerConfigs: parsed.providerConfigs ?? {},
    };
  } catch {
    return { apiKeys: {}, providerConfigs: {} };
  }
}

async function writeSecrets(secrets: Secrets): Promise<void> {
  const filePath = getSecretsPath();
  const tmpPath = filePath + '.tmp';
  await fs.writeFile(tmpPath, JSON.stringify(secrets, null, 2), 'utf-8');
  await fs.rename(tmpPath, filePath);
}

export const secretsService = {
  async validateProviderConfig(provider: string, config: ProviderConfig): Promise<void> {
    if (provider === 'gemini' && config.authMode === 'vertex_ai') {
      const credentialsPath = config.fields.gcpCredentials?.trim();
      if (!credentialsPath) {
        return;
      }

      if (!path.isAbsolute(credentialsPath)) {
        throw Object.assign(
          new Error('Gemini Vertex AI credentials must be an absolute path to a service account JSON file, or be left blank to use Application Default Credentials.'),
          { status: 400 },
        );
      }

      try {
        await fs.access(credentialsPath);
      } catch {
        throw Object.assign(
          new Error(`Gemini Vertex AI credentials file was not found at ${credentialsPath}. Update the path or leave it blank to use Application Default Credentials.`),
          { status: 400 },
        );
      }
      return;
    }

    if (provider === 'opencode' && config.authMode === 'ollama_local') {
      const baseUrl = config.fields.baseUrl?.trim();
      const modelId = config.fields.modelId?.trim();

      if (!baseUrl) {
        throw Object.assign(new Error('OpenCode Ollama mode requires an Ollama base URL.'), { status: 400 });
      }

      if (!modelId) {
        throw Object.assign(new Error('OpenCode Ollama mode requires a model ID.'), { status: 400 });
      }

      try {
        new URL(baseUrl);
      } catch {
        throw Object.assign(
          new Error(`OpenCode Ollama base URL "${baseUrl}" is not a valid URL.`),
          { status: 400 },
        );
      }
    }
  },

  async getApiKey(provider: string): Promise<string | null> {
    // First check env vars
    const envMap: Record<string, string | string[]> = {
      claude: 'ANTHROPIC_API_KEY',
      codex: 'CODEX_API_KEY',
      gemini: 'GEMINI_API_KEY',
      cursor: 'CURSOR_API_KEY',
      opencode: [
        'OPENAI_API_KEY',
        'ANTHROPIC_API_KEY',
        'GOOGLE_GENERATIVE_AI_API_KEY',
        'OPENROUTER_API_KEY',
        'GEMINI_API_KEY',
        'GOOGLE_API_KEY',
      ],
    };

    const envKey = envMap[provider];
    if (Array.isArray(envKey)) {
      for (const key of envKey) {
        if (process.env[key]) {
          return process.env[key]!;
        }
      }
    } else if (envKey && process.env[envKey]) {
      return process.env[envKey]!;
    }

    // Check provider config for saved API key fields
    const secrets = await readSecrets();
    const config = secrets.providerConfigs[provider];
    if (config?.fields.apiKey) {
      return config.fields.apiKey;
    }

    // Fall back to legacy stored secrets
    return secrets.apiKeys[provider] ?? null;
  },

  async getProviderConfig(provider: string): Promise<ProviderConfig | null> {
    const secrets = await readSecrets();
    return secrets.providerConfigs[provider] ?? null;
  },

  async setProviderConfig(provider: string, config: ProviderConfig): Promise<void> {
    await this.validateProviderConfig(provider, config);

    const secrets = await readSecrets();
    secrets.providerConfigs[provider] = config;

    // If api_key mode, also update legacy apiKeys for backward compat
    if (config.authMode === 'api_key' && config.fields.apiKey) {
      secrets.apiKeys[provider] = config.fields.apiKey;
    } else {
      delete secrets.apiKeys[provider];
    }

    await writeSecrets(secrets);
  },

  async getProviderEnvVars(provider: string): Promise<Record<string, string>> {
    const config = await this.getProviderConfig(provider);
    if (!config) return {};

    await this.validateProviderConfig(provider, config);

    const authModes = CLI_AUTH_MODES[provider as CLIProvider];
    if (!authModes) return {};

    const modeDef = authModes.find((m) => m.id === config.authMode);
    if (!modeDef) return {};

    const envVars: Record<string, string> = {};

    if (provider === 'opencode') {
      return buildOpenCodeProviderEnvVars(config);
    }

    // For Vertex AI, set the mode flag
    if (config.authMode === 'vertex_ai') {
      envVars['GOOGLE_GENAI_USE_VERTEXAI'] = 'true';
    }

    // Map field values to their env var names
    for (const fieldDef of modeDef.fields) {
      const value = config.fields[fieldDef.key];
      if (value) {
        envVars[fieldDef.envVar] = value;
      }
    }

    return envVars;
  },

  getMaskedProviderConfig(config: ProviderConfig, provider: string): { authMode: string; maskedFields: Record<string, string | null> } {
    const authModes = CLI_AUTH_MODES[provider as CLIProvider];
    const modeDef = authModes?.find((m) => m.id === config.authMode);
    const maskedFields: Record<string, string | null> = {};

    if (modeDef) {
      for (const fieldDef of modeDef.fields) {
        const value = config.fields[fieldDef.key];
        if (!value) {
          maskedFields[fieldDef.key] = null;
        } else if (fieldDef.type === 'password') {
          maskedFields[fieldDef.key] = `${value.slice(0, 6)}...${value.slice(-4)}`;
        } else {
          maskedFields[fieldDef.key] = value;
        }
      }
    }

    return { authMode: config.authMode, maskedFields };
  },

  // Legacy methods for backward compat
  async setApiKey(provider: string, key: string): Promise<void> {
    await this.setProviderConfig(provider, { authMode: 'api_key', fields: { apiKey: key } });
  },

  async deleteApiKey(provider: string): Promise<void> {
    const secrets = await readSecrets();
    delete secrets.apiKeys[provider];
    delete secrets.providerConfigs[provider];
    await writeSecrets(secrets);
  },

  async getMaskedKeys(): Promise<Record<string, string | null>> {
    const result: Record<string, string | null> = {};
    for (const provider of ['claude', 'codex', 'gemini', 'cursor', 'opencode']) {
      const key = await this.getApiKey(provider);
      result[provider] = key ? `${key.slice(0, 6)}...${key.slice(-4)}` : null;
    }
    return result;
  },
};
