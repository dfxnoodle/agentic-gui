import { describe, it, expect } from 'vitest';
import { ClaudeAdapter } from './adapters/claude.adapter.js';
import { CodexAdapter } from './adapters/codex.adapter.js';
import { GeminiAdapter } from './adapters/gemini.adapter.js';
import { CursorAdapter } from './adapters/cursor.adapter.js';
import { OpenCodeAdapter } from './adapters/opencode.adapter.js';
import type { CLIConfig } from '@agentic-gui/shared';

const baseConfig: CLIConfig = {
  maxTurns: 5,
  maxRuntimeMs: 60000,
  watchdogTimeoutMs: 30000,
};

const writableConfig: CLIConfig = {
  ...baseConfig,
  additionalFlags: ['--full-auto', '--unsafe-flag'],
  allowedTools: ['Read', 'Edit'],
  envOverrides: { DEMO: '1' },
};

describe('ClaudeAdapter', () => {
  const adapter = new ClaudeAdapter();

  it('builds correct command', () => {
    const cmd = adapter.buildCommand('hello', baseConfig, '/tmp/project');
    expect(cmd.command).toBe('claude');
    expect(cmd.args).toContain('--bare');
    expect(cmd.args).toContain('--output-format');
    expect(cmd.args).toContain('stream-json');
    expect(cmd.args).toContain('--max-turns');
    expect(cmd.args).toContain('5');
    expect(cmd.cwd).toBe('/tmp/project');
  });

  it('forces read-only tools in read-only mode', () => {
    const cmd = adapter.buildCommand('hello', writableConfig, '/tmp/project', { readOnly: true });
    const allowedToolsIndex = cmd.args.indexOf('--allowedTools');

    expect(allowedToolsIndex).toBeGreaterThan(-1);
    expect(cmd.args[allowedToolsIndex + 1]).toBe('Read');
    expect(cmd.args).not.toContain('--unsafe-flag');
  });

  it('parses assistant text event', () => {
    const event = adapter.parseEvent(JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Hello world' }] },
    }));
    expect(event).not.toBeNull();
    expect(event!.type).toBe('text');
    expect(event!.content).toBe('Hello world');
    expect(event!.source).toBe('claude');
  });

  it('parses thinking event', () => {
    const event = adapter.parseEvent(JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'thinking', text: 'Let me think...' }] },
    }));
    expect(event!.type).toBe('thinking');
    expect(event!.content).toBe('Let me think...');
  });

  it('parses content_block_delta text', () => {
    const event = adapter.parseEvent(JSON.stringify({
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'chunk' },
    }));
    expect(event!.type).toBe('text');
    expect(event!.content).toBe('chunk');
  });

  it('parses tool_use event', () => {
    const event = adapter.parseEvent(JSON.stringify({
      type: 'tool_use',
      tool_name: 'Read',
    }));
    expect(event!.type).toBe('tool_use');
    expect(event!.content).toContain('Read');
  });

  it('parses error event', () => {
    const event = adapter.parseEvent(JSON.stringify({
      type: 'error',
      error: 'Something broke',
    }));
    expect(event!.type).toBe('error');
    expect(event!.content).toBe('Something broke');
  });

  it('parses result event', () => {
    const event = adapter.parseEvent(JSON.stringify({
      type: 'result',
      result: 'Final answer',
    }));
    expect(event!.type).toBe('text');
    expect(event!.content).toBe('Final answer');
  });

  it('returns null for invalid JSON', () => {
    expect(adapter.parseEvent('not json')).toBeNull();
  });

  it('returns null for unknown event type', () => {
    expect(adapter.parseEvent(JSON.stringify({ type: 'unknown_type' }))).toBeNull();
  });

  it('getEnvVars platform mode sets ANTHROPIC_API_KEY and isolation CLAUDE_CONFIG_DIR', () => {
    const env = adapter.getEnvVars({
      mode: 'platform',
      apiKey: 'sk-test',
      isolationDir: '/tmp/iso',
      projectPath: '/tmp/project',
    });
    expect(env.ANTHROPIC_API_KEY).toBe('sk-test');
    expect(env.CLAUDE_CONFIG_DIR).toBe('/tmp/iso');
  });

  it('getEnvVars local mode does not set API key', () => {
    const env = adapter.getEnvVars({
      mode: 'local',
      apiKey: '',
      isolationDir: '/tmp/iso',
      projectPath: '/tmp/project',
    });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.DISABLE_AUTOUPDATER).toBe('1');
  });

  it('mapExitCode returns null for 0', () => {
    expect(adapter.mapExitCode(0)).toBeNull();
    expect(adapter.mapExitCode(null)).toBeNull();
  });

  it('mapExitCode returns message for non-zero', () => {
    expect(adapter.mapExitCode(1)).toContain('error');
  });
});

describe('CodexAdapter', () => {
  const adapter = new CodexAdapter();

  it('builds correct command', () => {
    const cmd = adapter.buildCommand('hello', baseConfig, '/tmp/project');
    expect(cmd.command).toBe('codex');
    expect(cmd.args).toContain('exec');
    expect(cmd.args).toContain('--json');
    expect(cmd.args).toContain('-');
  });

  it('does not enable write mode in read-only mode', () => {
    const cmd = adapter.buildCommand('hello', writableConfig, '/tmp/project', { readOnly: true });
    expect(cmd.args).not.toContain('--full-auto');
    expect(cmd.args).not.toContain('--unsafe-flag');
  });

  it('parses message event', () => {
    const event = adapter.parseEvent(JSON.stringify({
      type: 'message',
      role: 'assistant',
      content: 'test reply',
    }));
    expect(event!.type).toBe('text');
    expect(event!.content).toBe('test reply');
  });

  it('parses item.created tool call', () => {
    const event = adapter.parseEvent(JSON.stringify({
      type: 'item.created',
      item: { type: 'tool_call', name: 'shell' },
    }));
    expect(event!.type).toBe('tool_use');
    expect(event!.content).toContain('shell');
  });

  it('parses error event', () => {
    const event = adapter.parseEvent(JSON.stringify({
      type: 'error',
      message: 'API error',
    }));
    expect(event!.type).toBe('error');
  });

  it('getEnvVars sets CODEX_API_KEY in platform mode', () => {
    const env = adapter.getEnvVars({
      mode: 'platform',
      apiKey: 'codex-key',
      isolationDir: '/tmp',
      projectPath: '/p',
    });
    expect(env.CODEX_API_KEY).toBe('codex-key');
  });
});

describe('GeminiAdapter', () => {
  const adapter = new GeminiAdapter();

  it('builds correct command', () => {
    const cmd = adapter.buildCommand('hello', baseConfig, '/tmp/project');
    expect(cmd.command).toBe('gemini');
    expect(cmd.args).toContain('-p');
    expect(cmd.args).toContain('--output-format');
    expect(cmd.args).toContain('stream-json');
  });

  it('drops ad-hoc flags in read-only mode', () => {
    const cmd = adapter.buildCommand('hello', writableConfig, '/tmp/project', { readOnly: true });
    expect(cmd.args).not.toContain('--full-auto');
    expect(cmd.args).not.toContain('--unsafe-flag');
  });

  it('parses message event', () => {
    const event = adapter.parseEvent(JSON.stringify({
      type: 'message',
      role: 'assistant',
      content: 'Gemini says hi',
    }));
    expect(event!.type).toBe('text');
    expect(event!.content).toBe('Gemini says hi');
  });

  it('ignores user message events so prompts are not echoed back', () => {
    const event = adapter.parseEvent(JSON.stringify({
      type: 'message',
      role: 'user',
      content: 'system instructions and user prompt',
    }));
    expect(event).toBeNull();
  });

  it('parses init event', () => {
    const event = adapter.parseEvent(JSON.stringify({ type: 'init' }));
    expect(event!.type).toBe('progress');
  });

  it('parses result event', () => {
    const event = adapter.parseEvent(JSON.stringify({
      type: 'result',
      status: 'success',
      stats: {},
    }));
    expect(event!.type).toBe('progress');
    expect(event!.content).toContain('complete');
  });

  it('parses tool use event with Gemini tool_name field', () => {
    const event = adapter.parseEvent(JSON.stringify({
      type: 'tool_use',
      tool_name: 'read_file',
      parameters: { path: 'README.md' },
    }));
    expect(event!.type).toBe('tool_use');
    expect(event!.content).toContain('read_file');
  });

  it('maps exit code 42 to input error', () => {
    expect(adapter.mapExitCode(42)).toContain('Input error');
  });

  it('maps exit code 53 to turn limit', () => {
    expect(adapter.mapExitCode(53)).toContain('Turn limit');
  });

  it('getEnvVars sets GEMINI_API_KEY in platform mode', () => {
    const env = adapter.getEnvVars({
      mode: 'platform',
      apiKey: 'gem-key',
      isolationDir: '/tmp',
      projectPath: '/p',
    });
    expect(env.GEMINI_API_KEY).toBe('gem-key');
  });
});

describe('CursorAdapter', () => {
  const adapter = new CursorAdapter();

  it('builds correct command', () => {
    const cmd = adapter.buildCommand('hello', baseConfig, '/tmp/project');
    expect(cmd.command).toBe('cursor');
    expect(cmd.args).toContain('agent');
    expect(cmd.args).toContain('--trust');
    expect(cmd.args).toContain('--output-format');
  });

  it('drops ad-hoc flags in read-only mode', () => {
    const cmd = adapter.buildCommand('hello', writableConfig, '/tmp/project', { readOnly: true });
    expect(cmd.args).toContain('--trust');
    expect(cmd.args).not.toContain('--unsafe-flag');
    expect(cmd.args).not.toContain('--full-auto');
  });

  it('parses assistant text event', () => {
    const event = adapter.parseEvent(JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'Cursor reply' }] },
    }));
    expect(event!.type).toBe('text');
    expect(event!.content).toBe('Cursor reply');
  });

  it('shouldRetry is true initially', () => {
    const a = new CursorAdapter();
    expect(a.shouldRetry()).toBe(true);
  });

  it('shouldRetry becomes false after max retries', () => {
    const a = new CursorAdapter();
    a.incrementRetry();
    a.incrementRetry();
    expect(a.shouldRetry()).toBe(false);
  });

  it('resetRetries resets counter', () => {
    const a = new CursorAdapter();
    a.incrementRetry();
    a.incrementRetry();
    a.resetRetries();
    expect(a.shouldRetry()).toBe(true);
  });

  it('maps exit code 1 to beta issue message', () => {
    expect(adapter.mapExitCode(1)).toContain('beta');
  });

  it('getEnvVars sets CURSOR_API_KEY in platform mode', () => {
    const env = adapter.getEnvVars({
      mode: 'platform',
      apiKey: 'cursor-key',
      isolationDir: '/tmp',
      projectPath: '/p',
    });
    expect(env.CURSOR_API_KEY).toBe('cursor-key');
  });
});

describe('OpenCodeAdapter', () => {
  const adapter = new OpenCodeAdapter();

  it('builds correct command', () => {
    const cmd = adapter.buildCommand('hello', baseConfig, '/tmp/project', { readOnly: true });
    expect(cmd.command).toBe('opencode');
    expect(cmd.args).toContain('run');
    expect(cmd.args).toContain('--format');
    expect(cmd.args).toContain('json');
    expect(cmd.args).toContain('hello');
    expect(cmd.env.OPENCODE_PERMISSION).toContain('"bash":"deny"');
  });

  it('drops ad-hoc flags in read-only mode', () => {
    const cmd = adapter.buildCommand('hello', writableConfig, '/tmp/project', { readOnly: true });
    expect(cmd.args).not.toContain('--unsafe-flag');
    expect(cmd.args).not.toContain('--full-auto');
  });

  it('parses text event', () => {
    const event = adapter.parseEvent(JSON.stringify({
      type: 'text',
      part: { text: 'OpenCode reply' },
    }));
    expect(event!.type).toBe('text');
    expect(event!.content).toBe('OpenCode reply');
    expect(event!.source).toBe('opencode');
  });

  it('parses tool event', () => {
    const event = adapter.parseEvent(JSON.stringify({
      type: 'tool_use',
      part: { tool: 'bash', state: { title: 'ls -la' } },
    }));
    expect(event!.type).toBe('tool_use');
    expect(event!.content).toContain('bash');
    expect(event!.content).toContain('ls -la');
  });

  it('parses step_start event as thinking', () => {
    const event = adapter.parseEvent(JSON.stringify({
      type: 'step_start',
      part: { step: 2, title: 'Plan implementation' },
    }));
    expect(event!.type).toBe('thinking');
    expect(event!.content).toContain('step 2');
  });

  it('parses error event', () => {
    const event = adapter.parseEvent(JSON.stringify({
      type: 'error',
      error: { data: { message: 'Missing API key' } },
    }));
    expect(event!.type).toBe('error');
    expect(event!.content).toBe('Missing API key');
  });

  it('getEnvVars sets isolation env in platform mode', () => {
    const env = adapter.getEnvVars({
      mode: 'platform',
      apiKey: 'openai-key',
      isolationDir: '/tmp',
      projectPath: '/p',
    });
    expect(env.OPENCODE_DISABLE_AUTOUPDATE).toBe('true');
    expect(env.XDG_CONFIG_HOME).toBe('/tmp/.config');
  });
});
