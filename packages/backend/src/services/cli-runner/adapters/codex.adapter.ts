import type { CLIAdapter, SpawnCommand, CommandBuildOptions, GetEnvVarsOptions } from '../base-adapter.js';
import type { CLIConfig, UnifiedEvent } from '@agentic-gui/shared';

/**
 * OpenAI Codex CLI adapter.
 *
 * Spawns: codex exec --json [--full-auto] [--ephemeral] -
 * The prompt is piped via stdin (the `-` positional arg reads from stdin).
 * Output: JSONL events on stdout, progress on stderr.
 *
 * Event types observed in codex exec --json output:
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
    ];

    if (!options.readOnly && config.additionalFlags?.includes('--full-auto')) {
      args.push('--full-auto');
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

    // Tool call created
    if (eventType === 'item.created') {
      const item = parsed.item as { type?: string; name?: string } | undefined;
      if (item?.type === 'tool_call' || item?.type === 'function_call') {
        return {
          type: 'tool_use',
          timestamp: now,
          content: `Using tool: ${item.name ?? 'unknown'}`,
          source: 'codex',
          metadata: parsed,
        };
      }
      return null;
    }

    // Tool call completed
    if (eventType === 'item.completed') {
      const item = parsed.item as { type?: string; output?: string } | undefined;
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

    // Error
    if (eventType === 'error') {
      return {
        type: 'error',
        timestamp: now,
        content: String((parsed as { message?: string }).message ?? 'Unknown Codex error'),
        source: 'codex',
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
