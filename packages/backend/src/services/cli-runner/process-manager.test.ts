import { describe, it, expect } from 'vitest';
import { formatSpawnFailure, withCommonCliBinPaths } from './process-manager.js';

describe('withCommonCliBinPaths', () => {
  it('prepends common CLI bin directories to PATH', () => {
    const env = withCommonCliBinPaths({ PATH: '/usr/bin' });
    expect(env.PATH).toContain('/usr/bin');
    expect(env.PATH).toContain('/usr/local/bin');
  });
});

describe('formatSpawnFailure', () => {
  it('returns a friendly OpenCode missing-binary message', () => {
    const error = Object.assign(new Error('spawn opencode ENOENT'), { code: 'ENOENT' }) as NodeJS.ErrnoException;
    const message = formatSpawnFailure('opencode', 'opencode', error);

    expect(message).toContain('OpenCode');
    expect(message).toContain('OPENCODE_BIN');
  });

  it('falls back to the raw spawn message for non-ENOENT errors', () => {
    const error = Object.assign(new Error('permission denied'), { code: 'EACCES' }) as NodeJS.ErrnoException;
    const message = formatSpawnFailure('opencode', 'opencode', error);

    expect(message).toBe('Failed to start CLI process: permission denied');
  });
});
