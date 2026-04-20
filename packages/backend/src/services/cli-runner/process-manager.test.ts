import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

    expect(message).toContain('permissions error');
  });

  it('explains when OPENCODE_BIN points to a directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-dir-'));
    const error = Object.assign(new Error(`spawn ${tmpDir} EACCES`), { code: 'EACCES' }) as NodeJS.ErrnoException;

    const message = formatSpawnFailure('opencode', tmpDir, error);

    expect(message).toContain('is a directory');
  });

  it('explains when OPENCODE_BIN is not executable', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-file-'));
    const tmpFile = path.join(tmpDir, 'opencode');
    fs.writeFileSync(tmpFile, '#!/bin/sh\necho test\n', 'utf8');
    fs.chmodSync(tmpFile, 0o644);

    const error = Object.assign(new Error(`spawn ${tmpFile} EACCES`), { code: 'EACCES' }) as NodeJS.ErrnoException;
    const message = formatSpawnFailure('opencode', tmpFile, error);

    expect(message).toContain('not marked executable');
  });
});
