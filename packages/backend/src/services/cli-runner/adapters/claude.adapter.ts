import type { CLIAdapter, SpawnCommand, CommandBuildOptions, GetEnvVarsOptions } from '../base-adapter.js';
import type { CLIConfig, UnifiedEvent } from '@agentic-gui/shared';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

/**
 * Claude Code adapter.
 *
 * Spawns: claude --bare -p <prompt> --output-format stream-json [--allowedTools ...] [--max-turns N] --no-session-persistence
 * Output: JSONL on stdout, each line is a JSON object with various event types.
 *
 * stream-json events have a `type` field. Common types:
 *   - "assistant": { type: "assistant", message: { content: [{ type: "text", text: "..." }, ...] } }
 *   - "system": system messages
 *   - "result": final result
 */
export class ClaudeAdapter implements CLIAdapter {
  readonly provider = 'claude' as const;

  buildCommand(prompt: string, config: CLIConfig, projectPath: string, options: CommandBuildOptions = {}): SpawnCommand {
    const args = [
      '--bare',
      '-p', prompt,
      '--output-format', 'stream-json',
      '--no-session-persistence',
    ];

    if (config.maxTurns) {
      args.push('--max-turns', String(config.maxTurns));
    }

    if (config.maxBudgetUsd) {
      args.push('--max-budget-usd', String(config.maxBudgetUsd));
    }

    const allowedTools = options.readOnly ? ['Read'] : config.allowedTools;
    if (allowedTools?.length) {
      args.push('--allowedTools', allowedTools.join(','));
    }

    if (!options.readOnly && config.additionalFlags?.length) {
      args.push(...config.additionalFlags);
    }

    return {
      command: 'claude',
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

    // Claude stream-json emits objects with a `type` field
    const eventType = parsed.type as string | undefined;

    if (eventType === 'assistant') {
      // Assistant message with content blocks
      const message = parsed.message as { content?: Array<{ type: string; text?: string }> } | undefined;
      if (message?.content) {
        for (const block of message.content) {
          if (block.type === 'text' && block.text) {
            return {
              type: 'text',
              timestamp: now,
              content: block.text,
              source: 'claude',
              metadata: parsed,
            };
          }
          if (block.type === 'thinking') {
            return {
              type: 'thinking',
              timestamp: now,
              content: (block as { text?: string }).text ?? '',
              source: 'claude',
            };
          }
        }
      }
      return null;
    }

    if (eventType === 'content_block_delta') {
      const delta = parsed.delta as { type?: string; text?: string } | undefined;
      if (delta?.type === 'text_delta' && delta.text) {
        return {
          type: 'text',
          timestamp: now,
          content: delta.text,
          source: 'claude',
        };
      }
      if (delta?.type === 'thinking_delta') {
        return {
          type: 'thinking',
          timestamp: now,
          content: delta.text ?? '',
          source: 'claude',
        };
      }
      return null;
    }

    if (eventType === 'tool_use' || (parsed as { tool_name?: string }).tool_name) {
      return {
        type: 'tool_use',
        timestamp: now,
        content: `Using tool: ${(parsed as { tool_name?: string }).tool_name ?? 'unknown'}`,
        source: 'claude',
        metadata: parsed,
      };
    }

    if (eventType === 'tool_result') {
      return {
        type: 'tool_result',
        timestamp: now,
        content: String((parsed as { content?: string }).content ?? ''),
        source: 'claude',
        metadata: parsed,
      };
    }

    if (eventType === 'result') {
      const result = parsed.result as string | undefined;
      if (result) {
        return {
          type: 'text',
          timestamp: now,
          content: result,
          source: 'claude',
          metadata: { final: true },
        };
      }
    }

    if (eventType === 'error') {
      return {
        type: 'error',
        timestamp: now,
        content: String((parsed as { error?: string }).error ?? 'Unknown error'),
        source: 'claude',
      };
    }

    // Progress / status messages
    if (eventType === 'system' || eventType === 'status') {
      return {
        type: 'progress',
        timestamp: now,
        content: String((parsed as { message?: string }).message ?? JSON.stringify(parsed)),
        source: 'claude',
      };
    }

    return null;
  }

  getEnvVars(options: GetEnvVarsOptions): Record<string, string> {
    if (options.mode === 'local') {
      const out: Record<string, string> = {
        DISABLE_AUTOUPDATER: '1',
      };
      const projectClaude = path.join(options.projectPath, '.claude');
      try {
        if (fs.statSync(projectClaude).isDirectory()) {
          out.CLAUDE_CONFIG_DIR = projectClaude;
        }
      } catch {
        /* omit CLAUDE_CONFIG_DIR — CLI uses default user config */
      }
      return out;
    }
    return {
      ANTHROPIC_API_KEY: options.apiKey,
      CLAUDE_CONFIG_DIR: options.isolationDir || path.join(os.tmpdir(), `claude-${Date.now()}`),
      DISABLE_AUTOUPDATER: '1',
    };
  }

  mapExitCode(code: number | null): string | null {
    if (code === 0 || code === null) return null;
    if (code === 1) return 'Claude Code exited with an error.';
    return `Claude Code exited with code ${code}.`;
  }
}
