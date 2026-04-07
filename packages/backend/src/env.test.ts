import { describe, expect, it } from 'vitest';
import { getEnvironmentValidationError } from './env.js';

describe('getEnvironmentValidationError', () => {
  it('requires the root .env file to exist', () => {
    const error = getEnvironmentValidationError(false, {
      ADMIN_USERNAME: 'localadmin',
      ADMIN_PASSWORD: 'local-admin-pass-2026',
    });

    expect(error).toContain('Missing required environment file');
  });

  it('requires admin bootstrap credentials to be present', () => {
    const error = getEnvironmentValidationError(true, {
      ADMIN_USERNAME: 'localadmin',
      ADMIN_PASSWORD: '',
    });

    expect(error).toContain('Missing required environment variables');
    expect(error).toContain('ADMIN_PASSWORD');
  });

  it('rejects unchanged sample credentials', () => {
    const error = getEnvironmentValidationError(true, {
      ADMIN_USERNAME: 'replace-admin-username',
      ADMIN_PASSWORD: 'replace-admin-password',
    });

    expect(error).toContain('Update the sample values');
  });

  it('accepts explicit admin bootstrap credentials', () => {
    const error = getEnvironmentValidationError(true, {
      ADMIN_USERNAME: 'localadmin',
      ADMIN_PASSWORD: 'local-admin-pass-2026',
    });

    expect(error).toBeNull();
  });
});