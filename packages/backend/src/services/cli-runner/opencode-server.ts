import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { formatSpawnFailure, withCommonCliBinPaths } from './process-manager.js';
import { createReadOnlyWorkspaceSnapshot, getWorkspaceFingerprint } from './read-only-workspace.js';

interface OpenCodeServerState {
  key: string;
  baseUrl: string;
  isolationDir: string;
  workspacePath: string;
  fingerprint: string;
  process: ChildProcess;
  ready: Promise<void>;
  exited: boolean;
  cleanedUp: boolean;
  startupError: string | null;
  stdout: string;
  stderr: string;
}

const OPEN_CODE_SERVER_HOSTNAME = '127.0.0.1';
const OPEN_CODE_SERVER_STARTUP_TIMEOUT_MS = 30000;
const OUTPUT_BUFFER_LIMIT = 16000;
const servers = new Map<string, OpenCodeServerState>();

function appendOutput(current: string, chunk: Buffer): string {
  const next = current + chunk.toString();
  return next.length > OUTPUT_BUFFER_LIMIT ? next.slice(-OUTPUT_BUFFER_LIMIT) : next;
}

function trimOutput(output: string): string {
  return output.trim().slice(-4000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, OPEN_CODE_SERVER_HOSTNAME, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate a port for OpenCode server.')));
        return;
      }

      const { port } = address;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

function buildStartupErrorMessage(state: OpenCodeServerState, prefix: string): string {
  const output = [trimOutput(state.stderr), trimOutput(state.stdout)].filter(Boolean).join('\n');
  return output ? `${prefix}\n${output}` : prefix;
}

async function waitForServerReady(state: OpenCodeServerState): Promise<void> {
  const deadline = Date.now() + OPEN_CODE_SERVER_STARTUP_TIMEOUT_MS;
  let lastError: unknown;

  while (Date.now() < deadline) {
    if (state.startupError) {
      throw new Error(state.startupError);
    }

    if (state.exited) {
      throw new Error(buildStartupErrorMessage(state, 'OpenCode server exited before becoming ready.'));
    }

    try {
      const response = await fetch(`${state.baseUrl}/global/health`);
      if (response.ok) {
        const payload = await response.json().catch(() => null);
        if (!payload || payload.healthy !== false) {
          return;
        }
      }
    } catch (error) {
      lastError = error;
    }

    await sleep(250);
  }

  const reason = lastError instanceof Error ? ` ${lastError.message}` : '';
  throw new Error(buildStartupErrorMessage(
    state,
    `Timed out waiting for OpenCode server to become ready at ${state.baseUrl}.${reason}`,
  ));
}

async function cleanupServerState(state: OpenCodeServerState): Promise<void> {
  if (state.cleanedUp) {
    return;
  }

  state.cleanedUp = true;
  try {
    await fs.rm(state.isolationDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
}

async function stopServer(state: OpenCodeServerState): Promise<void> {
  if (!state.exited) {
    state.process.kill('SIGTERM');
    await Promise.race([
      new Promise<void>((resolve) => state.process.once('close', () => resolve())),
      sleep(5000),
    ]);

    if (!state.exited) {
      state.process.kill('SIGKILL');
      await Promise.race([
        new Promise<void>((resolve) => state.process.once('close', () => resolve())),
        sleep(1000),
      ]);
    }
  }

  await cleanupServerState(state);
}

export async function ensureOpenCodeServer(options: {
  projectPath: string;
  serverSignature: string;
  command: string;
  getChildEnv(isolationDir: string): Promise<NodeJS.ProcessEnv> | NodeJS.ProcessEnv;
}): Promise<{ baseUrl: string; workspacePath: string; isolationDir: string }> {
  const key = `${options.projectPath}::${options.serverSignature}`;
  const fingerprint = await getWorkspaceFingerprint(options.projectPath);
  const existing = servers.get(key);

  if (existing) {
    if (!existing.exited && existing.fingerprint === fingerprint) {
      await existing.ready;
      return {
        baseUrl: existing.baseUrl,
        workspacePath: existing.workspacePath,
        isolationDir: existing.isolationDir,
      };
    }

    servers.delete(key);
    await stopServer(existing);
  }

  const isolationDir = path.join(os.tmpdir(), `agentic-gui-opencode-${nanoid()}`);
  await fs.mkdir(isolationDir, { recursive: true });

  const workspacePath = await createReadOnlyWorkspaceSnapshot(options.projectPath, isolationDir);
  const port = await getAvailablePort();
  const baseUrl = `http://${OPEN_CODE_SERVER_HOSTNAME}:${port}`;
  const childEnv = await options.getChildEnv(isolationDir);
  const child = spawn(
    options.command,
    ['serve', '--hostname', OPEN_CODE_SERVER_HOSTNAME, '--port', String(port)],
    {
      cwd: workspacePath,
      env: withCommonCliBinPaths(childEnv),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    },
  );

  const state: OpenCodeServerState = {
    key,
    baseUrl,
    isolationDir,
    workspacePath,
    fingerprint,
    process: child,
    ready: Promise.resolve(),
    exited: false,
    cleanedUp: false,
    startupError: null,
    stdout: '',
    stderr: '',
  };

  child.stdout?.on('data', (chunk: Buffer) => {
    state.stdout = appendOutput(state.stdout, chunk);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    state.stderr = appendOutput(state.stderr, chunk);
  });
  child.once('error', (error) => {
    const spawnError = error as NodeJS.ErrnoException;
    state.startupError = formatSpawnFailure('opencode', options.command, spawnError);
    state.stderr = appendOutput(state.stderr, Buffer.from(state.startupError));
    state.exited = true;
  });
  child.once('close', () => {
    state.exited = true;
    if (servers.get(state.key) === state) {
      servers.delete(state.key);
    }
    void cleanupServerState(state);
  });

  state.ready = waitForServerReady(state);
  servers.set(key, state);

  try {
    await state.ready;
    return { baseUrl, workspacePath, isolationDir };
  } catch (error) {
    servers.delete(key);
    await stopServer(state);
    throw error;
  }
}

export async function disposeAllOpenCodeServers(): Promise<void> {
  const states = Array.from(servers.values());
  servers.clear();
  await Promise.all(states.map((state) => stopServer(state)));
}
