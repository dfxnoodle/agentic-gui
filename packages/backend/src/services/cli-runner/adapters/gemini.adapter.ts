import type { CLIAdapter, SpawnCommand, CommandBuildOptions, GetEnvVarsOptions } from '../base-adapter.js';
import type { CLIConfig, UnifiedEvent } from '@agentic-gui/shared';

/**
 * Gemini CLI adapter.
 *
 * Spawns: gemini -p <prompt> --output-format stream-json
 * Or in non-TTY: gemini --prompt <prompt>
 *
 * Streaming JSONL event types:
 *   - { type: "init", ... }
 *   - { type: "message", role: "assistant", content: "...", delta: true }
 *   - { type: "tool_use", tool_name: "...", parameters: {...} }
 *   - { type: "tool_result", output: "..." }
 *   - { type: "result", status: "success", stats: {...} }
 *   - { type: "error", message: "..." }
 *
 * Exit codes:
 *   0  = success
 *   42 = input error
 *   53 = turn limit exceeded
 */
export class GeminiAdapter implements CLIAdapter {
  readonly provider = 'gemini' as const;

  buildCommand(prompt: string, config: CLIConfig, projectPath: string, options: CommandBuildOptions = {}): SpawnCommand {
    const args = [
      '-p', prompt,
    ];

    // Use streaming JSON for real-time events
    args.push('--output-format', 'stream-json');

    if (!options.readOnly && config.additionalFlags?.length) {
      args.push(...config.additionalFlags);
    }

    return {
      command: 'gemini',
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

    // Init event
    if (eventType === 'init') {
      return {
        type: 'progress',
        timestamp: now,
        content: 'Gemini session initialized',
        source: 'gemini',
      };
    }

    // Message content (streaming text)
    if (eventType === 'message') {
      const role = parsed.role as string | undefined;
      if (role !== 'assistant') {
        return null;
      }

      const content = parsed.content as string | undefined;
      if (content) {
        return {
          type: 'text',
          timestamp: now,
          content,
          source: 'gemini',
          metadata: parsed,
        };
      }
      return null;
    }

    // Partial/delta text
    if (eventType === 'text_delta' || eventType === 'content_delta') {
      const text = (parsed.text as string) ?? (parsed.delta as string);
      if (text) {
        return {
          type: 'text',
          timestamp: now,
          content: text,
          source: 'gemini',
        };
      }
      return null;
    }

    // Tool use
    if (eventType === 'tool_use') {
      const tool = (parsed.tool_name as string | undefined) ?? (parsed.tool as string | undefined);
      return {
        type: 'tool_use',
        timestamp: now,
        content: `Using tool: ${tool ?? 'unknown'}`,
        source: 'gemini',
        metadata: parsed,
      };
    }

    // Tool result
    if (eventType === 'tool_result') {
      return {
        type: 'tool_result',
        timestamp: now,
        content: String(parsed.output ?? ''),
        source: 'gemini',
        metadata: parsed,
      };
    }

    // Final result
    if (eventType === 'result') {
      return {
        type: 'progress',
        timestamp: now,
        content: 'Gemini response complete',
        source: 'gemini',
        metadata: { final: true, status: parsed.status, stats: parsed.stats },
      };
    }

    // Error
    if (eventType === 'error') {
      return {
        type: 'error',
        timestamp: now,
        content: String((parsed as { message?: string }).message ?? 'Unknown Gemini error'),
        source: 'gemini',
      };
    }

    return null;
  }

  getEnvVars(options: GetEnvVarsOptions): Record<string, string> {
    if (options.mode === 'local') {
      return {};
    }
    if (!options.apiKey) return {};
    return {
      GEMINI_API_KEY: options.apiKey,
    };
  }

  mapExitCode(code: number | null): string | null {
    if (code === 0 || code === null) return null;
    if (code === 42) return 'Gemini CLI: Input error. The request may be malformed.';
    if (code === 53) return 'Gemini CLI: Turn limit exceeded. The task may require more steps than allowed.';
    return `Gemini CLI exited with code ${code}.`;
  }
}
