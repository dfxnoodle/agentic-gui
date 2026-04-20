import type { CLIProvider } from '../types/cli-events.js';
import type { AuthModeDef } from '../types/project.js';

export const CLI_PROVIDERS: CLIProvider[] = ['claude', 'codex', 'gemini', 'cursor', 'opencode'];

export const CLI_DISPLAY_NAMES: Record<CLIProvider, string> = {
  claude: 'Claude Code',
  codex: 'OpenAI Codex',
  gemini: 'Gemini CLI',
  cursor: 'Cursor CLI',
  opencode: 'OpenCode',
};

export const CLI_AUTH_MODES: Record<CLIProvider, AuthModeDef[]> = {
  claude: [
    {
      id: 'api_key',
      label: 'API Key',
      fields: [
        { key: 'apiKey', label: 'Anthropic API Key', type: 'password', envVar: 'ANTHROPIC_API_KEY', required: true, placeholder: 'sk-ant-...' },
      ],
    },
  ],
  codex: [
    {
      id: 'api_key',
      label: 'API Key',
      fields: [
        { key: 'apiKey', label: 'OpenAI API Key', type: 'password', envVar: 'CODEX_API_KEY', required: true, placeholder: 'sk-...' },
      ],
    },
  ],
  gemini: [
    {
      id: 'api_key',
      label: 'API Key',
      fields: [
        { key: 'apiKey', label: 'Gemini API Key', type: 'password', envVar: 'GEMINI_API_KEY', required: true, placeholder: 'AIza...' },
      ],
    },
    {
      id: 'vertex_ai',
      label: 'Vertex AI (Google Cloud)',
      fields: [
        { key: 'gcpProject', label: 'GCP Project ID', type: 'text', envVar: 'GOOGLE_CLOUD_PROJECT', required: true, placeholder: 'my-gcp-project' },
        { key: 'gcpLocation', label: 'GCP Location', type: 'text', envVar: 'GOOGLE_CLOUD_LOCATION', required: true, placeholder: 'us-central1' },
        { key: 'gcpCredentials', label: 'Service Account Key Path', type: 'text', envVar: 'GOOGLE_APPLICATION_CREDENTIALS', placeholder: '/path/to/service-account.json (blank for ADC)' },
      ],
    },
  ],
  cursor: [
    {
      id: 'api_key',
      label: 'API Key',
      fields: [
        { key: 'apiKey', label: 'Cursor API Key', type: 'password', envVar: 'CURSOR_API_KEY', required: true, placeholder: 'cur-...' },
      ],
    },
  ],
  opencode: [
    {
      id: 'api_key',
      label: 'OpenAI',
      fields: [
        { key: 'apiKey', label: 'OpenAI API Key', type: 'password', envVar: 'OPENAI_API_KEY', required: true, placeholder: 'sk-...' },
      ],
    },
    {
      id: 'anthropic_api_key',
      label: 'Anthropic',
      fields: [
        { key: 'apiKey', label: 'Anthropic API Key', type: 'password', envVar: 'ANTHROPIC_API_KEY', required: true, placeholder: 'sk-ant-...' },
      ],
    },
    {
      id: 'gemini_api_key',
      label: 'Google Gemini',
      fields: [
        { key: 'apiKey', label: 'Google Gemini API Key', type: 'password', envVar: 'GOOGLE_GENERATIVE_AI_API_KEY', required: true, placeholder: 'AIza...' },
      ],
    },
    {
      id: 'openrouter_api_key',
      label: 'OpenRouter',
      fields: [
        { key: 'apiKey', label: 'OpenRouter API Key', type: 'password', envVar: 'OPENROUTER_API_KEY', required: true, placeholder: 'sk-or-...' },
      ],
    },
    {
      id: 'ollama_local',
      label: 'Ollama Local Model',
      fields: [
        {
          key: 'baseUrl',
          label: 'Ollama Base URL',
          type: 'text',
          envVar: 'OPENCODE_CONFIG_CONTENT',
          required: true,
          placeholder: 'http://localhost:11434/v1',
          helpText: 'OpenCode inline config: provider.ollama.options.baseURL',
        },
        {
          key: 'modelId',
          label: 'Model ID',
          type: 'text',
          envVar: 'OPENCODE_CONFIG_CONTENT',
          required: true,
          placeholder: 'qwen2.5-coder:7b',
          helpText: 'OpenCode inline config: model and provider.ollama.models',
        },
        {
          key: 'modelName',
          label: 'Display Name',
          type: 'text',
          envVar: 'OPENCODE_CONFIG_CONTENT',
          placeholder: 'Qwen 2.5 Coder 7B',
          helpText: 'Optional label shown in OpenCode model selection.',
        },
      ],
    },
  ],
};
