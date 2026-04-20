export type CLIProvider = 'claude' | 'codex' | 'gemini' | 'cursor' | 'opencode';

export interface UnifiedEvent {
  type: 'thinking' | 'text' | 'tool_use' | 'tool_result' | 'error' | 'done' | 'progress';
  timestamp: string;
  content: string;
  source: CLIProvider;
  metadata?: Record<string, unknown>;
}

export interface SSEEnvelope {
  type: 'cli_event' | 'state_change' | 'plan_update';
  conversationId: string;
  payload: UnifiedEvent | Record<string, unknown>;
}
