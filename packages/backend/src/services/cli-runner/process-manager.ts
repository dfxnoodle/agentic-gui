import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CLIAdapter, SpawnCommand } from './base-adapter.js';
import { CLI_DISPLAY_NAMES, type UnifiedEvent, type CLIProvider } from '@agentic-gui/shared';

export interface ProcessManagerOptions {
  /** Kill process if no output for this many ms */
  watchdogTimeoutMs: number;
  /** Kill process after this many ms total */
  maxRuntimeMs: number;
  /** Optional: pipe prompt to stdin (for Codex) */
  stdinPrompt?: string;
}

export interface ProcessHandle {
  /** Unique job ID */
  jobId: string;
  /** EventEmitter that emits 'event' (UnifiedEvent) and 'done' ({ jobId, exitCode, error? }) */
  events: EventEmitter;
  /** Kill the process */
  kill(): void;
  /** Promise that resolves when the process exits */
  completed: Promise<{ exitCode: number | null; error?: string; stderr?: string; stdout?: string }>;
}

const COMMON_CLI_BIN_DIRS = [
  path.join(os.homedir(), '.local', 'bin'),
  path.join(os.homedir(), 'bin'),
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/home/linuxbrew/.linuxbrew/bin',
];

export function withCommonCliBinPaths(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const currentPath = env.PATH ?? '';
  const pathParts = currentPath.split(path.delimiter).filter(Boolean);
  const merged = [...COMMON_CLI_BIN_DIRS, ...pathParts];
  const unique = merged.filter((part, index) => merged.indexOf(part) === index);

  return {
    ...env,
    PATH: unique.join(path.delimiter),
  };
}

export function formatSpawnFailure(provider: CLIProvider, command: string, err: NodeJS.ErrnoException): string {
  const providerName = CLI_DISPLAY_NAMES[provider] ?? provider;

  if (err.code === 'ENOENT') {
    const pathHint = provider === 'opencode'
      ? ' Install OpenCode and ensure the binary is on PATH, or set OPENCODE_BIN to the absolute binary path before starting the backend.'
      : ' Install the CLI and ensure the backend PATH includes its install directory.';
    return `${providerName} executable "${command}" was not found.${pathHint}`;
  }

  if (err.code === 'EACCES') {
    try {
      const stats = fs.statSync(command);
      if (stats.isDirectory()) {
        return `${providerName} could not start because "${command}" is a directory, not an executable. Point OPENCODE_BIN at the actual binary file (for example, ".../opencode"), then restart the backend.`;
      }

      fs.accessSync(command, fs.constants.X_OK);
    } catch (accessErr) {
      if ((accessErr as NodeJS.ErrnoException).code === 'EACCES') {
        return `${providerName} could not start because "${command}" is not marked executable. Fix the file permissions or point OPENCODE_BIN at an executable binary, then restart the backend.`;
      }
    }

    return `${providerName} could not start "${command}" due to a permissions error. If you set OPENCODE_BIN, make sure it points to the executable file itself, not its containing directory.`;
  }

  return `Failed to start CLI process: ${err.message}`;
}

export function spawnCLIProcess(
  jobId: string,
  adapter: CLIAdapter,
  cmd: SpawnCommand,
  options: ProcessManagerOptions,
): ProcessHandle {
  const events = new EventEmitter();
  let killed = false;
  let emittedErrorEvent = false;

  const childEnv: NodeJS.ProcessEnv = withCommonCliBinPaths(
    cmd.explicitEnv ?? { ...process.env, ...cmd.env },
  );

  const child: ChildProcess = spawn(cmd.command, cmd.args, {
    cwd: cmd.cwd,
    env: childEnv,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });

  // Send prompt via stdin if needed (Codex)
  if (options.stdinPrompt && child.stdin) {
    child.stdin.write(options.stdinPrompt);
    child.stdin.end();
  }

  // Watchdog: kill if no output for N ms
  let watchdogTimer: ReturnType<typeof setTimeout> | null = null;

  function resetWatchdog() {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(() => {
      if (!killed) {
        killed = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 5000);
      }
    }, options.watchdogTimeoutMs);
  }

  // Max runtime timer
  const runtimeTimer = setTimeout(() => {
    if (!killed) {
      killed = true;
      events.emit('event', {
        type: 'error',
        timestamp: new Date().toISOString(),
        content: 'Process exceeded maximum runtime limit.',
        source: adapter.provider,
      } satisfies UnifiedEvent);
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 5000);
    }
  }, options.maxRuntimeMs);

  let stdoutBuffer = '';
  // Parse stdout line by line (JSONL); also retain tail for auth-error classification
  if (child.stdout) {
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      if (stdoutBuffer.length > 16000) {
        stdoutBuffer = stdoutBuffer.slice(-16000);
      }
    });
    const rl = createInterface({ input: child.stdout });
    resetWatchdog();

    rl.on('line', (line) => {
      resetWatchdog();
      const trimmed = line.trim();
      if (!trimmed) return;

      const event = adapter.parseEvent(trimmed);
      if (event) {
        if (event.type === 'error') {
          emittedErrorEvent = true;
        }
        events.emit('event', event);
      }
    });
  }

  // Collect stderr for logging / progress
  let stderrBuffer = '';
  if (child.stderr) {
    child.stderr.on('data', (chunk: Buffer) => {
      resetWatchdog();
      stderrBuffer += chunk.toString();
    });
  }

  // Completion promise
  const completed = new Promise<{
    exitCode: number | null;
    error?: string;
    stderr: string;
    stdout: string;
  }>((resolve) => {
    child.on('close', (code) => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      clearTimeout(runtimeTimer);

      const baseErrorMsg = adapter.mapExitCode(code);
      const stderrSummary = stderrBuffer.trim().split(/\r?\n/).filter(Boolean).slice(-5).join('\n');
      const errorMsg = baseErrorMsg && stderrSummary && !emittedErrorEvent
        ? `${baseErrorMsg}\n${stderrSummary}`
        : baseErrorMsg;

      // Emit done event
      events.emit('event', {
        type: 'done',
        timestamp: new Date().toISOString(),
        content: errorMsg ?? 'Process completed.',
        source: adapter.provider,
        metadata: { exitCode: code, stderr: stderrBuffer.slice(-2000) },
      } satisfies UnifiedEvent);

      resolve({
        exitCode: code,
        error: errorMsg ?? undefined,
        stderr: stderrBuffer,
        stdout: stdoutBuffer,
      });
    });

    child.on('error', (err) => {
      if (watchdogTimer) clearTimeout(watchdogTimer);
      clearTimeout(runtimeTimer);

      const spawnError = err as NodeJS.ErrnoException;
      const errorContent = formatSpawnFailure(adapter.provider, cmd.command, spawnError);

      events.emit('event', {
        type: 'error',
        timestamp: new Date().toISOString(),
        content: errorContent,
        source: adapter.provider,
      } satisfies UnifiedEvent);

      resolve({ exitCode: null, error: errorContent, stderr: stderrBuffer, stdout: stdoutBuffer });
    });
  });

  return {
    jobId,
    events,
    kill() {
      if (!killed) {
        killed = true;
        child.kill('SIGTERM');
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL');
        }, 5000);
      }
    },
    completed,
  };
}
