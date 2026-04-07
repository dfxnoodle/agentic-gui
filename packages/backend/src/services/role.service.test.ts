import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempDirs: string[] = [];

afterEach(async () => {
  delete process.env.DATA_DIR;
  vi.resetModules();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function createTempDataDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentic-gui-roles-'));
  tempDirs.push(dir);
  process.env.DATA_DIR = dir;
  return dir;
}

describe('roleService', () => {
  it('seeds default roles and can create custom roles', async () => {
    await createTempDataDir();
    const { roleService } = await import('./role.service.js');

    await roleService.init();

    expect(roleService.list().map((role) => role.id)).toEqual(['admin', 'project_manager', 'operations']);

    const createdRole = await roleService.createRole({
      name: 'Release Manager',
      permissions: ['approve_plan', 'configure_projects'],
    });

    expect(createdRole.id).toBe('release-manager');
    expect(roleService.hasPermission(createdRole.id, 'approve_plan')).toBe(true);
    expect(roleService.hasPermission(createdRole.id, 'manage_users')).toBe(false);
  });

  it('blocks deleting roles that are still assigned to users', async () => {
    await createTempDataDir();
    const { roleService } = await import('./role.service.js');
    const { userService } = await import('./user.service.js');

    await roleService.init();
    const customRole = await roleService.createRole({
      name: 'Delivery Lead',
      permissions: ['send_message'],
    });
    await userService.create('maya', 'hunter22', customRole.id, 'Maya');

    await expect(roleService.deleteRole(customRole.id)).rejects.toMatchObject({ status: 409 });
  });
});