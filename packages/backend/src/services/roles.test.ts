import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ROLE_DEFINITIONS,
  PERMISSIONS,
  buildRolePermissionsMap,
  hasPermission,
  type Permission,
} from '@agentic-gui/shared';

describe('hasPermission', () => {
  it('admin has all permissions', () => {
    const perms: Permission[] = [...PERMISSIONS];
    for (const p of perms) {
      expect(hasPermission('admin', p)).toBe(true);
    }
  });

  it('uses the default role registry for legacy roles', () => {
    expect(hasPermission('project_manager', 'configure_projects')).toBe(true);
    expect(hasPermission('project_manager', 'manage_users')).toBe(false);
    expect(hasPermission('operations', 'approve_plan')).toBe(true);
    expect(hasPermission('operations', 'configure_cli')).toBe(false);
  });

  it('supports admin-defined roles through a provided permission map', () => {
    const rolePermissions = buildRolePermissionsMap([
      ...DEFAULT_ROLE_DEFINITIONS,
      {
        id: 'release_manager',
        permissions: ['view_plans', 'approve_plan', 'configure_projects'],
      },
    ]);

    expect(hasPermission('release_manager', 'approve_plan', rolePermissions)).toBe(true);
    expect(hasPermission('release_manager', 'configure_projects', rolePermissions)).toBe(true);
    expect(hasPermission('release_manager', 'manage_users', rolePermissions)).toBe(false);
  });

  it('returns false for unknown roles', () => {
    expect(hasPermission('unknown-role', 'view_plans')).toBe(false);
  });
});
