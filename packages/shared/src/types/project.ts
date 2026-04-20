import type { CLIProvider } from './cli-events.js';

/** How to resolve CLI credentials for runs against a project. */
export type CredentialPreference = 'local_first' | 'platform_only';

export interface CLIConfig {
  maxTurns: number;
  maxBudgetUsd?: number;
  maxRuntimeMs: number;
  watchdogTimeoutMs: number;
  allowedTools?: string[];
  additionalFlags?: string[];
  envOverrides?: Record<string, string>;
}

export interface AuthFieldDef {
  key: string;
  label: string;
  type: 'text' | 'password';
  envVar: string;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
}

export interface AuthModeDef {
  id: string;
  label: string;
  fields: AuthFieldDef[];
}

export interface ProviderConfig {
  authMode: string;
  fields: Record<string, string>;
}

export interface Project {
  id: string;
  name: string;
  rootPath: string;
  cliProvider: CLIProvider;
  cliConfig: CLIConfig;
  /** When omitted, the backend default applies (see server config). */
  credentialPreference?: CredentialPreference;
  agentsMdContent?: string;
  memoryMdContent?: string;
  createdAt: string;
}
