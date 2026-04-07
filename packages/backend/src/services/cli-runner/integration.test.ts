import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeAdapter } from './adapters/claude.adapter.js';
import type { UnifiedEvent } from '@agentic-gui/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_CLI = path.join(__dirname, '__fixtures__', 'mock-cli.mjs');

function runMockCLI(args: string[] = []): Promise<{ events: UnifiedEvent[]; exitCode: number | null }> {
  return new Promise((resolve) => {
    const adapter = new ClaudeAdapter();
    const events: UnifiedEvent[] = [];

    const child = spawn('node', [MOCK_CLI, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (child.stdout) {
      const rl = createInterface({ input: child.stdout });
      rl.on('line', (line) => {
        const event = adapter.parseEvent(line.trim());
        if (event) events.push(event);
      });
    }

    child.on('close', (code) => {
      resolve({ events, exitCode: code });
    });
  });
}

describe('Mock CLI integration', () => {
  it('produces expected event sequence for normal run', async () => {
    const { events, exitCode } = await runMockCLI();

    expect(exitCode).toBe(0);

    // Should have: progress, text, tool_use, text, text (result)
    const types = events.map((e) => e.type);
    expect(types).toContain('progress');
    expect(types).toContain('text');
    expect(types).toContain('tool_use');

    // Check text content was captured
    const textEvents = events.filter((e) => e.type === 'text');
    const fullText = textEvents.map((e) => e.content).join('');
    expect(fullText).toContain('analysis');
    expect(fullText).toContain('TypeScript');
  });

  it('produces error event for --fail run', async () => {
    const { events, exitCode } = await runMockCLI(['--fail']);

    expect(exitCode).toBe(1);
    const errorEvents = events.filter((e) => e.type === 'error');
    expect(errorEvents.length).toBeGreaterThanOrEqual(1);
    expect(errorEvents[0].content).toContain('Simulated failure');
  });

  it('produces plan content for --plan run', async () => {
    const { events, exitCode } = await runMockCLI(['--plan']);

    expect(exitCode).toBe(0);
    const textEvents = events.filter((e) => e.type === 'text');
    const fullText = textEvents.map((e) => e.content).join('');
    expect(fullText).toContain('## Summary');
    expect(fullText).toContain('## Steps');
    expect(fullText).toContain('JWT');
  });

  it('all events have required fields', async () => {
    const { events } = await runMockCLI();

    for (const event of events) {
      expect(event.type).toBeDefined();
      expect(event.timestamp).toBeDefined();
      expect(event.content).toBeDefined();
      expect(event.source).toBe('claude');
    }
  });
});
