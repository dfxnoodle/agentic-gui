import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { nanoid } from 'nanoid';
import type { CLIProvider, CLIConfig, UnifiedEvent, CredentialPreference, ProviderConfig } from '@agentic-gui/shared';
import type { CLIAdapter } from './base-adapter.js';
import { spawnCLIProcess, type ProcessHandle } from './process-manager.js';
import { ConcurrencyLimiter } from './concurrency-limiter.js';
import { ClaudeAdapter } from './adapters/claude.adapter.js';
import { CodexAdapter } from './adapters/codex.adapter.js';
import { GeminiAdapter } from './adapters/gemini.adapter.js';
import { CursorAdapter } from './adapters/cursor.adapter.js';
import { OpenCodeAdapter, getOpenCodeReadOnlyEnv, resolveOpenCodeCommand } from './adapters/opencode.adapter.js';
import {
  buildCodexAzureOpenAIConfigToml,
  getCodexAzureOpenAIFieldsFromEnv,
  secretsService,
} from '../secrets.service.js';
import { buildPrompt, readProjectContext, type PromptContext } from '../prompt-builder.service.js';
import { config } from '../../config.js';
import { createReadOnlyCLIConfig, createReadOnlyWorkspaceSnapshot } from './read-only-workspace.js';
import { ensureOpenCodeServer, disposeAllOpenCodeServers } from './opencode-server.js';
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
  ['opencode', new OpenCodeAdapter()],
]);

const concurrencyLimiter = new ConcurrencyLimiter(
  config.maxConcurrentJobs,
  new Map([
    ['cursor', 1],
    ['opencode', 1],
  ]),
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
const DEFAULT_INTERACTIVE_CLI_WATCHDOG_MS = 180000;

export function applyProviderRuntimeDefaults(
  provider: CLIProvider,
  cliConfig: CLIConfig,
  providerConfig: ProviderConfig | null,
): CLIConfig {
  const effectiveConfig = { ...cliConfig };

  if (provider === 'cursor') {
    effectiveConfig.watchdogTimeoutMs = Math.min(effectiveConfig.watchdogTimeoutMs, 30000);
  }

  if (provider === 'claude' || provider === 'codex' || provider === 'gemini') {
    effectiveConfig.watchdogTimeoutMs = Math.min(
      effectiveConfig.maxRuntimeMs,
      Math.max(effectiveConfig.watchdogTimeoutMs, DEFAULT_INTERACTIVE_CLI_WATCHDOG_MS),
    );
  }

  if (provider === 'opencode') {
    if (providerConfig?.authMode === 'ollama_local') {
      effectiveConfig.watchdogTimeoutMs = effectiveConfig.maxRuntimeMs;
    } else {
      effectiveConfig.watchdogTimeoutMs = Math.min(
        effectiveConfig.maxRuntimeMs,
        Math.max(effectiveConfig.watchdogTimeoutMs, 120000),
      );
    }
  }

  return effectiveConfig;
}

async function prepareCodexPlatformConfig(isolationDir: string, childEnv: NodeJS.ProcessEnv): Promise<void> {
  const providerConfig = await secretsService.getProviderConfig('codex');
  const azureFields = providerConfig?.authMode === 'azure_openai'
    ? providerConfig.fields
    : getCodexAzureOpenAIFieldsFromEnv(childEnv);

  if (!azureFields) return;

  const codexConfigDir = path.join(isolationDir, '.codex');
  await fs.mkdir(codexConfigDir, { recursive: true });
  await fs.writeFile(
    path.join(codexConfigDir, 'config.toml'),
    buildCodexAzureOpenAIConfigToml(azureFields),
    'utf-8',
  );
}

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
            'set credential preference to local_first with CLI config under the project or home directory, or use any supported alternative auth mode.',
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

    const effectiveConfig = applyProviderRuntimeDefaults(
      request.cliProvider,
      request.cliConfig,
      providerConfig,
    );

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

  async _buildChildEnv(
    request: RunJobRequest,
    adapter: CLIAdapter,
    credentialMode: 'local' | 'platform',
    platformApiKey: string,
    isolationDir: string,
    commandEnv: Record<string, string> = {},
    providerEnvVars?: Record<string, string>,
  ): Promise<NodeJS.ProcessEnv> {
    const envVars = adapter.getEnvVars({
      mode: credentialMode,
      apiKey: platformApiKey,
      isolationDir,
      projectPath: request.projectPath,
    });

    const childEnv: NodeJS.ProcessEnv = { ...process.env };
    if (credentialMode === 'platform') {
      childEnv.HOME = isolationDir;
    }

    if (credentialMode === 'local') {
      stripProviderSecretsFromEnv(childEnv, request.cliProvider);
    }

    Object.assign(childEnv, commandEnv, envVars);

    if (credentialMode === 'platform') {
      Object.assign(
        childEnv,
        providerEnvVars ?? await secretsService.getProviderEnvVars(request.cliProvider),
      );

      if (request.cliProvider === 'codex') {
        await prepareCodexPlatformConfig(isolationDir, childEnv);
      }
    }

    return childEnv;
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

    if (request.cliProvider === 'opencode') {
      const platformProviderEnvVars = credentialMode === 'platform'
        ? await secretsService.getProviderEnvVars(request.cliProvider)
        : undefined;
      const localEnvSignature = credentialMode === 'local'
        ? (() => {
          const localEnvVars = adapter.getEnvVars({
          mode: credentialMode,
          apiKey: platformApiKey,
          isolationDir: '__signature__',
          projectPath: request.projectPath,
          });
          return {
            XDG_CONFIG_HOME: localEnvVars.XDG_CONFIG_HOME ?? null,
            XDG_DATA_HOME: localEnvVars.XDG_DATA_HOME ?? null,
            OPENCODE_CONFIG: localEnvVars.OPENCODE_CONFIG ?? null,
          };
        })()
        : null;
      const serverSignature = JSON.stringify({
        credentialMode,
        command: resolveOpenCodeCommand(),
        providerEnvVars: platformProviderEnvVars ?? null,
        localEnvSignature,
      });

      await concurrencyLimiter.acquire(request.cliProvider);

      try {
        const server = await ensureOpenCodeServer({
          projectPath: request.projectPath,
          serverSignature,
          command: resolveOpenCodeCommand(),
          getChildEnv: async (isolationDir) => runnerService._buildChildEnv(
            request,
            adapter,
            credentialMode,
            platformApiKey,
            isolationDir,
            getOpenCodeReadOnlyEnv(),
            platformProviderEnvVars,
          ),
        });

        const cmd = adapter.buildCommand(fullPrompt, effectiveConfig, server.workspacePath, {
          readOnly: true,
          attachUrl: server.baseUrl,
        });
        cmd.explicitEnv = await runnerService._buildChildEnv(
          request,
          adapter,
          credentialMode,
          platformApiKey,
          server.isolationDir,
          cmd.env,
          platformProviderEnvVars,
        );

        const handle = spawnCLIProcess(jobId, adapter, cmd, {
          watchdogTimeoutMs: effectiveConfig.watchdogTimeoutMs,
          maxRuntimeMs: effectiveConfig.maxRuntimeMs,
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
        activeJobs.delete(jobId);

        return {
          exitCode: result.exitCode,
          error: result.error,
          fullText,
          stderr: result.stderr ?? '',
          stdout: result.stdout ?? '',
        };
      } finally {
        concurrencyLimiter.release(request.cliProvider);
      }
    }

    const isolationDir = path.join(os.tmpdir(), `agentic-gui-${jobId}`);
    await fs.mkdir(isolationDir, { recursive: true });
    const workspacePath = await createReadOnlyWorkspaceSnapshot(request.projectPath, isolationDir);
    const codexOutputLastMessagePath = request.cliProvider === 'codex'
      ? path.join(isolationDir, 'codex-last-message.txt')
      : undefined;
    const cmd = adapter.buildCommand(fullPrompt, effectiveConfig, workspacePath, {
      readOnly: true,
      outputLastMessagePath: codexOutputLastMessagePath,
    });
    cmd.explicitEnv = await runnerService._buildChildEnv(
      request,
      adapter,
      credentialMode,
      platformApiKey,
      isolationDir,
      cmd.env,
    );

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

    if (!fullText && codexOutputLastMessagePath) {
      try {
        fullText = (await fs.readFile(codexOutputLastMessagePath, 'utf-8')).trim();
      } catch {
        /* best effort fallback */
      }
    }

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
  void disposeAllOpenCodeServers();
});

process.on('SIGINT', () => {
  for (const handle of activeJobs.values()) {
    handle.kill();
  }
  void disposeAllOpenCodeServers();
});
