import type { CLIProvider, CLIConfig, UnifiedEvent } from '@agentic-gui/shared';

export interface SpawnCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  /** When set, used as the complete child environment instead of merging process.env with `env`. */
  explicitEnv?: NodeJS.ProcessEnv;
}

export interface CommandBuildOptions {
  readOnly?: boolean;
}

export interface GetEnvVarsOptions {
  mode: 'local' | 'platform';
  apiKey: string;
  isolationDir: string;
  projectPath: string;
}

export interface CLIAdapter {
  readonly provider: CLIProvider;

  /**
   * Build the command + args + env to spawn the CLI headlessly.
   */
  buildCommand(prompt: string, config: CLIConfig, projectPath: string, options?: CommandBuildOptions): SpawnCommand;

  /**
   * Parse a single raw JSONL line from the CLI's stdout into a UnifiedEvent.
   * Returns null if the line is not parseable or should be ignored.
   */
  parseEvent(rawLine: string): UnifiedEvent | null;

  /**
   * Return env vars for this CLI. Local mode must not inject platform keys or empty isolation config dirs.
   */
  getEnvVars(options: GetEnvVarsOptions): Record<string, string>;

  /**
   * Map a process exit code to a user-friendly error message, or null if the exit was normal.
   */
  mapExitCode(code: number | null): string | null;
}
