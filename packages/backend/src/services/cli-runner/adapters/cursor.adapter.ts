import type { CLIAdapter, SpawnCommand, CommandBuildOptions, GetEnvVarsOptions } from '../base-adapter.js';
import type { CLIConfig, UnifiedEvent } from '@agentic-gui/shared';

/**
 * Cursor CLI adapter.
 *
 * Spawns: cursor agent -p --output-format stream-json <prompt>
 *
 * IMPORTANT caveats (from research report):
 *   - Beta: headless mode can hang indefinitely with no output.
 *   - Concurrent headless processes can race and cause exit code 1 with no output.
 *   - Workaround: serial execution (concurrency=1 enforced in ConcurrencyLimiter) +
 *     aggressive watchdog timeout (30s default instead of 60s).
 *
 * Output: NDJSON events on stdout (similar format to Claude stream-json).
 *   --output-format only works with --print/-p.
 *
 * Auth: CURSOR_API_KEY env var or --api-key flag.
 */
export class CursorAdapter implements CLIAdapter {
  readonly provider = 'cursor' as const;

  /** Max retries on hang/crash */
  private static readonly MAX_RETRIES = 2;
  /** Track retry counts per job externally (set by runner) */
  retryCount = 0;

  buildCommand(prompt: string, config: CLIConfig, projectPath: string, options: CommandBuildOptions = {}): SpawnCommand {
    const args = [
      'agent',
      '-p',
      '--output-format', 'stream-json',
      '--trust',
    ];

    if (!options.readOnly && config.additionalFlags?.length) {
      args.push(...config.additionalFlags);
    }

    // Prompt as final positional arg
    args.push(prompt);

    return {
      command: 'cursor',
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

    // Assistant text content (same structure as Claude stream-json)
    if (eventType === 'assistant') {
      const message = parsed.message as { content?: Array<{ type: string; text?: string }> } | undefined;
      if (message?.content) {
        for (const block of message.content) {
          if (block.type === 'text' && block.text) {
            return {
              type: 'text',
              timestamp: now,
              content: block.text,
              source: 'cursor',
              metadata: parsed,
            };
          }
        }
      }
      return null;
    }

    // Content block delta
    if (eventType === 'content_block_delta') {
      const delta = parsed.delta as { type?: string; text?: string } | undefined;
      if (delta?.type === 'text_delta' && delta.text) {
        return {
          type: 'text',
          timestamp: now,
          content: delta.text,
          source: 'cursor',
        };
      }
      return null;
    }

    // Tool use
    if (eventType === 'tool_use' || (parsed as { tool_name?: string }).tool_name) {
      return {
        type: 'tool_use',
        timestamp: now,
        content: `Using tool: ${(parsed as { tool_name?: string }).tool_name ?? 'unknown'}`,
        source: 'cursor',
        metadata: parsed,
      };
    }

    // Tool result
    if (eventType === 'tool_result') {
      return {
        type: 'tool_result',
        timestamp: now,
        content: String((parsed as { content?: string }).content ?? ''),
        source: 'cursor',
        metadata: parsed,
      };
    }

    // Result / final
    if (eventType === 'result') {
      const result = parsed.result as string | undefined;
      if (result) {
        return {
          type: 'text',
          timestamp: now,
          content: result,
          source: 'cursor',
          metadata: { final: true },
        };
      }
    }

    // Error
    if (eventType === 'error') {
      return {
        type: 'error',
        timestamp: now,
        content: String((parsed as { error?: string }).error ?? (parsed as { message?: string }).message ?? 'Unknown Cursor error'),
        source: 'cursor',
      };
    }

    // Status / progress
    if (eventType === 'status' || eventType === 'system') {
      return {
        type: 'progress',
        timestamp: now,
        content: String((parsed as { message?: string }).message ?? JSON.stringify(parsed)),
        source: 'cursor',
      };
    }

    return null;
  }

  getEnvVars(options: GetEnvVarsOptions): Record<string, string> {
    if (options.mode === 'local') {
      return {};
    }
    return {
      CURSOR_API_KEY: options.apiKey,
    };
  }

  mapExitCode(code: number | null): string | null {
    if (code === 0 || code === null) return null;
    if (code === 1) return 'Cursor CLI exited with an error (this may be a known beta issue with headless mode).';
    return `Cursor CLI exited with code ${code}.`;
  }

  /**
   * Whether this job should be retried (hang detection).
   * Called by runner when the process exits with no text output.
   */
  shouldRetry(): boolean {
    return this.retryCount < CursorAdapter.MAX_RETRIES;
  }

  incrementRetry(): void {
    this.retryCount++;
  }

  resetRetries(): void {
    this.retryCount = 0;
  }
}
