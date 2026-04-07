import path from 'node:path';
import './env.js';

export const config = {
  port: parseInt(process.env.PORT ?? '3001', 10),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-in-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '24h',
  corsOrigin: process.env.CORS_ORIGIN ?? `http://localhost:${process.env.FRONTEND_PORT ?? '5173'}`,
  dataDir: process.env.DATA_DIR ?? path.resolve(import.meta.dirname, '..', 'data'),
  secretKey: process.env.AGENTIC_GUI_SECRET_KEY ?? 'dev-encryption-key',
  adminUsername: process.env.ADMIN_USERNAME ?? '',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',

  // CLI defaults
  defaultMaxTurns: parseInt(process.env.DEFAULT_MAX_TURNS ?? '10', 10),
  defaultMaxRuntimeMs: parseInt(process.env.DEFAULT_MAX_RUNTIME_MS ?? '300000', 10),
  defaultWatchdogTimeoutMs: parseInt(process.env.DEFAULT_WATCHDOG_TIMEOUT_MS ?? '60000', 10),
  maxConcurrentJobs: parseInt(process.env.MAX_CONCURRENT_JOBS ?? '3', 10),

  /** When a project has no `credentialPreference`, use this (platform_only preserves legacy behavior). */
  defaultCredentialPreference:
    (process.env.DEFAULT_CREDENTIAL_PREFERENCE === 'local_first' ? 'local_first' : 'platform_only') as
      | 'local_first'
      | 'platform_only',
};
