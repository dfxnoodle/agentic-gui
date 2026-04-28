import type { CLIAdapter, SpawnCommand, CommandBuildOptions, GetEnvVarsOptions } from '../base-adapter.js';
import type { CLIConfig, UnifiedEvent } from '@agentic-gui/shared';

/**
 * OpenAI Codex CLI adapter.
 *
 * Spawns: codex exec --json --ephemeral --sandbox read-only [-o path] -
 * The prompt is piped via stdin (the `-` positional arg reads from stdin).
 * Output: JSONL events on stdout, progress on stderr.
 *
 * Event types observed in codex exec --json output:
 *   - { type: "item.completed", item: { type: "agent_message", text: "..." } }
 *   - { type: "message", role: "assistant", content: "..." }
 *   - { type: "item.created", item: { type: "tool_call", ... } }
 *   - { type: "item.completed", item: { ... } }
 *   - { type: "turn.completed" }
 *   - { type: "error", message: "..." }
 */
export class CodexAdapter implements CLIAdapter {
  readonly provider = 'codex' as const;

  buildCommand(prompt: string, config: CLIConfig, projectPath: string, options: CommandBuildOptions = {}): SpawnCommand {
    const args = [
      'exec',
      '--json',
      '--ephemeral',
      '--skip-git-repo-check',
    ];

    if (!options.readOnly && config.additionalFlags?.includes('--full-auto')) {
      args.push('--full-auto');
    } else {
      args.push('--sandbox', 'read-only');
    }

    if (options.outputLastMessagePath) {
      args.push('--output-last-message', options.outputLastMessagePath);
    }

    // `-` tells codex to read the prompt from stdin
    args.push('-');

    return {
      command: 'codex',
      args,
      env: {},
      cwd: projectPath,
    };
  }

  parseEvent(rawLine: string): UnifiedEvent | null {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawLine);
    } catch {
      return null;
    }

    const now = new Date().toISOString();
    const eventType = parsed.type as string | undefined;

    // Assistant message content
    if (eventType === 'message' && parsed.role === 'assistant') {
      const content = parsed.content as string | undefined;
      if (content) {
        return {
          type: 'text',
          timestamp: now,
          content,
          source: 'codex',
          metadata: parsed,
        };
      }
      return null;
    }

    // Streaming content delta
    if (eventType === 'content_delta' || eventType === 'response.output_text.delta') {
      const delta = (parsed.delta as string) ?? (parsed.text as string);
      if (delta) {
        return {
          type: 'text',
          timestamp: now,
          content: delta,
          source: 'codex',
        };
      }
      return null;
    }

    // Tool call / command started
    if (eventType === 'item.created' || eventType === 'item.started') {
      const item = parsed.item as { type?: string; name?: string; command?: string; server?: string; tool?: string } | undefined;
      if (item?.type === 'tool_call' || item?.type === 'function_call') {
        return {
          type: 'tool_use',
          timestamp: now,
          content: `Using tool: ${item.name ?? 'unknown'}`,
          source: 'codex',
          metadata: parsed,
        };
      }
      if (item?.type === 'command_execution') {
        return {
          type: 'tool_use',
          timestamp: now,
          content: `Running command: ${item.command ?? 'unknown'}`,
          source: 'codex',
          metadata: parsed,
        };
      }
      if (item?.type === 'mcp_tool_call') {
        const toolName = item.server && item.tool ? `${item.server}.${item.tool}` : item.tool ?? 'unknown';
        return {
          type: 'tool_use',
          timestamp: now,
          content: `Using tool: ${toolName}`,
          source: 'codex',
          metadata: parsed,
        };
      }
      return null;
    }

    // Item completed
    if (eventType === 'item.completed') {
      const item = parsed.item as {
        type?: string;
        text?: string;
        output?: string;
        message?: string;
        aggregated_output?: string;
        command?: string;
        changes?: Array<{ path?: string; kind?: string }>;
        error?: { message?: string } | null;
        status?: string;
      } | undefined;
      if (item?.type === 'agent_message' && item.text) {
        return {
          type: 'text',
          timestamp: now,
          content: item.text,
          source: 'codex',
          metadata: parsed,
        };
      }
      if (item?.type === 'reasoning' && item.text) {
        return {
          type: 'thinking',
          timestamp: now,
          content: item.text,
          source: 'codex',
          metadata: parsed,
        };
      }
      if (item?.type === 'error') {
        return {
          type: 'error',
          timestamp: now,
          content: item.message ?? item.error?.message ?? 'Unknown Codex error',
          source: 'codex',
          metadata: parsed,
        };
      }
      if (item?.type === 'command_execution') {
        return {
          type: 'progress',
          timestamp: now,
          content: `Command ${item.status ?? 'completed'}: ${item.command ?? 'unknown'}`,
          source: 'codex',
          metadata: parsed,
        };
      }
      if (item?.type === 'file_change' && item.changes?.length) {
        const changed = item.changes
          .map((change) => `${change.kind ?? 'changed'} ${change.path ?? 'unknown'}`)
          .join(', ');
        return {
          type: 'progress',
          timestamp: now,
          content: `Files changed: ${changed}`,
          source: 'codex',
          metadata: parsed,
        };
      }
      if (item?.output) {
        return {
          type: 'tool_result',
          timestamp: now,
          content: item.output,
          source: 'codex',
          metadata: parsed,
        };
      }
      return null;
    }

    // Turn completed
    if (eventType === 'turn.completed') {
      return {
        type: 'progress',
        timestamp: now,
        content: 'Turn completed',
        source: 'codex',
      };
    }

    if (eventType === 'turn.failed') {
      const error = parsed.error as { message?: string } | undefined;
      return {
        type: 'error',
        timestamp: now,
        content: error?.message ?? 'Codex turn failed',
        source: 'codex',
        metadata: parsed,
      };
    }

    // Error
    if (eventType === 'error') {
      const message = String((parsed as { message?: string }).message ?? 'Unknown Codex error');
      if (/^reconnecting\.\.\./i.test(message)) {
        return {
          type: 'progress',
          timestamp: now,
          content: message,
          source: 'codex',
          metadata: parsed,
        };
      }

      return {
        type: 'error',
        timestamp: now,
        content: message,
        source: 'codex',
        metadata: parsed,
      };
    }

    return null;
  }

  getEnvVars(options: GetEnvVarsOptions): Record<string, string> {
    if (options.mode === 'local') {
      return {};
    }
    return {
      CODEX_API_KEY: options.apiKey,
    };
  }

  mapExitCode(code: number | null): string | null {
    if (code === 0 || code === null) return null;
    if (code === 1) return 'Codex exited with an error.';
    return `Codex exited with code ${code}.`;
  }
}
