import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CLIAdapter, SpawnCommand, CommandBuildOptions, GetEnvVarsOptions } from '../base-adapter.js';
import type { CLIConfig, UnifiedEvent } from '@agentic-gui/shared';

interface OpenCodePartState {
  title?: string;
  status?: string;
  input?: Record<string, unknown>;
  output?: string;
}

interface OpenCodePart {
  text?: string;
  tool?: string;
  title?: string;
  name?: string;
  step?: number;
  reason?: string;
  usage?: Record<string, unknown>;
  state?: OpenCodePartState;
}

const READ_ONLY_PERMISSIONS = JSON.stringify({
  '*': 'allow',
  bash: 'deny',
  edit: 'deny',
  external_directory: 'deny',
});

export function resolveOpenCodeCommand(): string {
  return process.env.OPENCODE_BIN?.trim() || 'opencode';
}

export function getOpenCodeReadOnlyEnv(): Record<string, string> {
  return {
    OPENCODE_PERMISSION: READ_ONLY_PERMISSIONS,
  };
}

function getIsolationXdgEnv(isolationDir: string): Record<string, string> {
  return {
    XDG_CONFIG_HOME: path.join(isolationDir, '.config'),
    XDG_DATA_HOME: path.join(isolationDir, '.local', 'share'),
    XDG_STATE_HOME: path.join(isolationDir, '.local', 'state'),
    XDG_CACHE_HOME: path.join(isolationDir, '.cache'),
  };
}

function resolveHomeConfigPath(configHome: string, dataHome: string): string | null {
  const candidates = [
    path.join(configHome, 'opencode', 'opencode.json'),
    path.join(configHome, 'opencode', 'opencode.jsonc'),
    path.join(dataHome, 'opencode', 'opencode.json'),
    path.join(dataHome, 'opencode', 'opencode.jsonc'),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function getErrorMessage(raw: unknown): string {
  if (typeof raw === 'string') {
    return raw;
  }

  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    const data = record.data;

    if (data && typeof data === 'object') {
      const nested = data as Record<string, unknown>;
      if (typeof nested.message === 'string' && nested.message) {
        return nested.message;
      }
    }

    if (typeof record.message === 'string' && record.message) {
      return record.message;
    }

    if (typeof record.name === 'string' && record.name) {
      return record.name;
    }
  }

  return 'Unknown OpenCode error';
}

/**
 * OpenCode CLI adapter.
 *
 * Spawns: opencode run --format json [--attach <server>] "<prompt>"
 * Output: JSONL events on stdout.
 */
export class OpenCodeAdapter implements CLIAdapter {
  readonly provider = 'opencode' as const;

  buildCommand(prompt: string, config: CLIConfig, projectPath: string, options: CommandBuildOptions = {}): SpawnCommand {
    const command = resolveOpenCodeCommand();
    const args = [
      'run',
      '--format', 'json',
      '--dangerously-skip-permissions',
    ];

    if (options.attachUrl) {
      args.push('--attach', options.attachUrl);
    }

    if (!options.readOnly && config.additionalFlags?.length) {
      args.push(...config.additionalFlags);
    }

    args.push(prompt);

    return {
      command,
      args,
      env: options.readOnly ? getOpenCodeReadOnlyEnv() : {},
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
    const part = parsed.part as OpenCodePart | undefined;

    if (eventType === 'text') {
      const content = part?.text;
      if (!content) return null;

      return {
        type: 'text',
        timestamp: now,
        content,
        source: 'opencode',
        metadata: parsed,
      };
    }

    if (eventType === 'tool_use') {
      const tool = part?.tool ?? 'unknown';
      const title = part?.state?.title;

      return {
        type: 'tool_use',
        timestamp: now,
        content: title ? `Using tool: ${tool} (${title})` : `Using tool: ${tool}`,
        source: 'opencode',
        metadata: parsed,
      };
    }

    if (eventType === 'step_start') {
      const step = typeof part?.step === 'number' ? `step ${part.step}` : 'reasoning step';
      const name = part?.title ?? part?.name;

      return {
        type: 'thinking',
        timestamp: now,
        content: name ? `Starting ${step}: ${name}` : `Starting ${step}`,
        source: 'opencode',
        metadata: parsed,
      };
    }

    if (eventType === 'step_finish') {
      const reason = part?.reason ? ` (${part.reason})` : '';

      return {
        type: 'progress',
        timestamp: now,
        content: `OpenCode completed a reasoning step${reason}.`,
        source: 'opencode',
        metadata: parsed,
      };
    }

    if (eventType === 'error') {
      return {
        type: 'error',
        timestamp: now,
        content: getErrorMessage(parsed.error),
        source: 'opencode',
        metadata: parsed,
      };
    }

    return null;
  }

  getEnvVars(options: GetEnvVarsOptions): Record<string, string> {
    const baseEnv = {
      NO_COLOR: '1',
      OPENCODE_DISABLE_AUTOUPDATE: 'true',
    };

    const isolationXdg = getIsolationXdgEnv(options.isolationDir);

    if (options.mode === 'platform') {
      return {
        ...baseEnv,
        ...isolationXdg,
      };
    }

    const userHome = os.homedir();
    const configHome = path.join(userHome, '.config');
    const dataHome = path.join(userHome, '.local', 'share');
    const env: Record<string, string> = {
      ...baseEnv,
      XDG_STATE_HOME: isolationXdg.XDG_STATE_HOME,
      XDG_CACHE_HOME: isolationXdg.XDG_CACHE_HOME,
    };

    if (fs.existsSync(path.join(configHome, 'opencode'))) {
      env.XDG_CONFIG_HOME = configHome;
    }

    if (fs.existsSync(path.join(dataHome, 'opencode', 'auth.json'))) {
      env.XDG_DATA_HOME = dataHome;
    }

    const homeConfig = resolveHomeConfigPath(configHome, dataHome);
    if (homeConfig) {
      env.OPENCODE_CONFIG = homeConfig;
    }

    return env;
  }

  mapExitCode(code: number | null): string | null {
    if (code === 0 || code === null) return null;
    if (code === 1) return 'OpenCode exited with an error.';
    return `OpenCode exited with code ${code}.`;
  }
}
