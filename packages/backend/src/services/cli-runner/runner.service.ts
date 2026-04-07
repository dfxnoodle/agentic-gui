import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { nanoid } from 'nanoid';
import type { CLIProvider, CLIConfig, UnifiedEvent, CredentialPreference } from '@agentic-gui/shared';
import type { CLIAdapter } from './base-adapter.js';
import { spawnCLIProcess, type ProcessHandle } from './process-manager.js';
import { ConcurrencyLimiter } from './concurrency-limiter.js';
import { ClaudeAdapter } from './adapters/claude.adapter.js';
import { CodexAdapter } from './adapters/codex.adapter.js';
import { GeminiAdapter } from './adapters/gemini.adapter.js';
import { CursorAdapter } from './adapters/cursor.adapter.js';
import { secretsService } from '../secrets.service.js';
import { buildPrompt, readProjectContext, type PromptContext } from '../prompt-builder.service.js';
import { config } from '../../config.js';
import { createReadOnlyCLIConfig, createReadOnlyWorkspaceSnapshot } from './read-only-workspace.js';
import {
  resolveCredentialAttempts,
  stripProviderSecretsFromEnv,
  classifyAuthFailure,
  type ResolvedCredentialPlan,
} from './credential-strategy.js';

const adapters = new Map<CLIProvider, CLIAdapter>([
  ['claude', new ClaudeAdapter()],
  ['codex', new CodexAdapter()],
  ['gemini', new GeminiAdapter()],
  ['cursor', new CursorAdapter()],
]);

const concurrencyLimiter = new ConcurrencyLimiter(
  config.maxConcurrentJobs,
  new Map([['cursor', 1]]),
);

const activeJobs = new Map<string, ProcessHandle>();

export interface RunJobRequest {
  conversationId: string;
  projectId: string;
  projectPath: string;
  cliProvider: CLIProvider;
  cliConfig: CLIConfig;
  userMessage: string;
  taskType: PromptContext['taskType'];
  /** When omitted, `config.defaultCredentialPreference` is used. */
  credentialPreference?: CredentialPreference;
}

export interface RunJobResult {
  jobId: string;
  events: EventEmitter;
  completed: Promise<{ exitCode: number | null; error?: string; fullText: string }>;
}

const CURSOR_HANG_MAX_RETRIES = 2;

export const runnerService = {
  async runJob(request: RunJobRequest): Promise<RunJobResult> {
    const adapter = adapters.get(request.cliProvider);
    if (!adapter) {
      throw Object.assign(
        new Error(`CLI provider '${request.cliProvider}' is not yet supported.`),
        { status: 400 },
      );
    }

    const apiKey = await secretsService.getApiKey(request.cliProvider);
    const providerConfig = await secretsService.getProviderConfig(request.cliProvider);
    const hasAltAuth = providerConfig !== null && providerConfig.authMode !== 'api_key';

    const credentialPreference = request.credentialPreference ?? config.defaultCredentialPreference;

    const plan = await resolveCredentialAttempts({
      provider: request.cliProvider,
      projectPath: request.projectPath,
      credentialPreference,
      apiKey,
      hasAltAuth,
    });

    if (plan.attempts.length === 0) {
      throw Object.assign(
        new Error(
          `No credentials available for ${request.cliProvider}. Configure an API key in Settings (or environment), ` +
            'set credential preference to local_first with CLI config under the project or home directory, or use Vertex AI for Gemini.',
        ),
        { status: 400 },
      );
    }

    const projectContext = await readProjectContext(request.projectPath);

    const fullPrompt = buildPrompt({
      agentsMd: projectContext.agentsMd,
      memoryMd: projectContext.memoryMd,
      taskType: request.taskType,
      userMessage: request.userMessage,
    });

    const effectiveConfig = { ...request.cliConfig };
    if (request.cliProvider === 'cursor') {
      effectiveConfig.watchdogTimeoutMs = Math.min(effectiveConfig.watchdogTimeoutMs, 30000);
    }

    const readOnlyConfig = createReadOnlyCLIConfig(effectiveConfig);

    const aggregatedEvents = new EventEmitter();
    const outerJobId = nanoid();

    const completed = runnerService._executeCredentialPlan(
      request,
      adapter,
      plan,
      fullPrompt,
      readOnlyConfig,
      aggregatedEvents,
    );

    return {
      jobId: outerJobId,
      events: aggregatedEvents,
      completed,
    };
  },

  async _executeCredentialPlan(
    request: RunJobRequest,
    adapter: CLIAdapter,
    plan: ResolvedCredentialPlan,
    fullPrompt: string,
    effectiveConfig: CLIConfig,
    aggregatedEvents: EventEmitter,
  ): Promise<{ exitCode: number | null; error?: string; fullText: string }> {
    let aggregateFullText = '';

    for (let i = 0; i < plan.attempts.length; i++) {
      const attempt = plan.attempts[i];
      const nextIsPlatform = i + 1 < plan.attempts.length && plan.attempts[i + 1].mode === 'platform';

      if (i > 0 && attempt.mode === 'platform') {
        aggregatedEvents.emit('event', {
          type: 'progress',
          timestamp: new Date().toISOString(),
          content: 'Local credentials failed authentication; retrying with platform API key.',
          source: request.cliProvider,
        } satisfies UnifiedEvent);
      }

      if (attempt.mode === 'platform' && request.cliProvider === 'cursor') {
        const r = await runnerService._runCursorPlatformAttempts(
          request,
          adapter,
          plan.platformApiKey,
          fullPrompt,
          effectiveConfig,
          aggregatedEvents,
        );
        aggregateFullText = r.fullText;
        if (r.exitCode === 0) {
          return { exitCode: 0, fullText: aggregateFullText };
        }
        return { exitCode: r.exitCode, error: r.error, fullText: aggregateFullText };
      }

      const r = await runnerService._runSingleSpawn(
        request,
        adapter,
        attempt.mode,
        plan.platformApiKey,
        fullPrompt,
        effectiveConfig,
        aggregatedEvents,
      );
      aggregateFullText = r.fullText;

      if (r.exitCode === 0) {
        return { exitCode: 0, fullText: aggregateFullText };
      }

      const canAuthFallback =
        attempt.mode === 'local' &&
        nextIsPlatform &&
        Boolean(plan.platformApiKey) &&
        classifyAuthFailure(request.cliProvider, r.exitCode, r.stderr, r.stdout);

      if (canAuthFallback) {
        continue;
      }

      return { exitCode: r.exitCode, error: r.error, fullText: aggregateFullText };
    }

    return {
      exitCode: 1,
      error: 'No credential attempts succeeded.',
      fullText: aggregateFullText,
    };
  },

  async _runCursorPlatformAttempts(
    request: RunJobRequest,
    adapter: CLIAdapter,
    platformApiKey: string,
    fullPrompt: string,
    effectiveConfig: CLIConfig,
    aggregatedEvents: EventEmitter,
  ): Promise<{ exitCode: number | null; error?: string; fullText: string; stderr: string; stdout: string }> {
    let last: Awaited<ReturnType<typeof runnerService._runSingleSpawn>> | undefined;

    for (let attempt = 0; attempt <= CURSOR_HANG_MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        aggregatedEvents.emit('event', {
          type: 'progress',
          timestamp: new Date().toISOString(),
          content: `Cursor CLI produced no output (attempt ${attempt + 1}/${CURSOR_HANG_MAX_RETRIES + 1}). Retrying...`,
          source: 'cursor',
        } satisfies UnifiedEvent);
      }

      last = await runnerService._runSingleSpawn(
        request,
        adapter,
        'platform',
        platformApiKey,
        fullPrompt,
        effectiveConfig,
        aggregatedEvents,
      );

      if (last.exitCode === 0 || last.fullText) {
        return last;
      }
    }

    return last!;
  },

  async _runSingleSpawn(
    request: RunJobRequest,
    adapter: CLIAdapter,
    credentialMode: 'local' | 'platform',
    platformApiKey: string,
    fullPrompt: string,
    effectiveConfig: CLIConfig,
    aggregatedEvents: EventEmitter,
  ): Promise<{
    exitCode: number | null;
    error?: string;
    fullText: string;
    stderr: string;
    stdout: string;
  }> {
    const jobId = nanoid();
    const isolationDir = path.join(os.tmpdir(), `agentic-gui-${jobId}`);
    await fs.mkdir(isolationDir, { recursive: true });
    const workspacePath = await createReadOnlyWorkspaceSnapshot(request.projectPath, isolationDir);

    const envVars = adapter.getEnvVars({
      mode: credentialMode,
      apiKey: platformApiKey,
      isolationDir,
      projectPath: request.projectPath,
    });

    const cmd = adapter.buildCommand(fullPrompt, effectiveConfig, workspacePath, { readOnly: true });

    // Local mode strips inherited API keys so workspace/home CLI login is used; avoid on untrusted shared hosts.
    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    if (credentialMode === 'local') {
      stripProviderSecretsFromEnv(childEnv, request.cliProvider);
    }
    Object.assign(childEnv, cmd.env, envVars);

    if (credentialMode === 'platform') {
      const providerEnvVars = await secretsService.getProviderEnvVars(request.cliProvider);
      Object.assign(childEnv, providerEnvVars);
    }

    cmd.explicitEnv = childEnv;

    await concurrencyLimiter.acquire(request.cliProvider);

    const isCodex = request.cliProvider === 'codex';
    const handle = spawnCLIProcess(jobId, adapter, cmd, {
      watchdogTimeoutMs: effectiveConfig.watchdogTimeoutMs,
      maxRuntimeMs: effectiveConfig.maxRuntimeMs,
      stdinPrompt: isCodex ? fullPrompt : undefined,
    });

    activeJobs.set(jobId, handle);

    let fullText = '';
    handle.events.on('event', (event: UnifiedEvent) => {
      if (event.type === 'text') {
        fullText += event.content;
      }
      aggregatedEvents.emit('event', event);
    });

    const result = await handle.completed;
    concurrencyLimiter.release(request.cliProvider);
    activeJobs.delete(jobId);

    try {
      await fs.rm(isolationDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }

    return {
      exitCode: result.exitCode,
      error: result.error,
      fullText,
      stderr: result.stderr ?? '',
      stdout: result.stdout ?? '',
    };
  },

  killJob(jobId: string): boolean {
    const handle = activeJobs.get(jobId);
    if (!handle) return false;
    handle.kill();
    return true;
  },

  getStats() {
    return {
      activeJobs: activeJobs.size,
      concurrency: concurrencyLimiter.getStats(),
    };
  },

  getSupportedProviders(): CLIProvider[] {
    return Array.from(adapters.keys());
  },
};

process.on('SIGTERM', () => {
  for (const handle of activeJobs.values()) {
    handle.kill();
  }
});

process.on('SIGINT', () => {
  for (const handle of activeJobs.values()) {
    handle.kill();
  }
});
