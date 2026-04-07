import type { CLIProvider } from '../types/cli-events.js';
import type { AuthModeDef } from '../types/project.js';

export const CLI_PROVIDERS: CLIProvider[] = ['claude', 'codex', 'gemini', 'cursor'];

export const CLI_DISPLAY_NAMES: Record<CLIProvider, string> = {
  claude: 'Claude Code',
  codex: 'OpenAI Codex',
  gemini: 'Gemini CLI',
  cursor: 'Cursor CLI',
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
};
