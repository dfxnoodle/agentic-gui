import fs from 'node:fs/promises';
import {
  DEFAULT_ROLE_DEFINITIONS,
  PERMISSIONS,
  buildRolePermissionsMap,
  hasPermission as hasSharedPermission,
  type Permission,
  type RoleDefinition,
  type UserRole,
} from '@agentic-gui/shared';
import { getRolesPath } from '../store/store-paths.js';
import { userService } from './user.service.js';

function cloneRole(role: RoleDefinition): RoleDefinition {
  return {
    ...role,
    permissions: [...role.permissions],
  };
}

function defaultRoles(): RoleDefinition[] {
  return DEFAULT_ROLE_DEFINITIONS.map(cloneRole);
}

function normalizeRoleName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

function normalizeRoleId(roleId: string): string {
  return roleId.trim().toLowerCase();
}

function normalizePermissions(permissions: readonly string[]): Permission[] {
  const validPermissions = new Set<string>(PERMISSIONS);
  return Array.from(
    new Set(permissions.filter((permission): permission is Permission => validPermissions.has(permission))),
  );
}

function sanitizeRoleDefinition(role: Partial<RoleDefinition>): RoleDefinition | null {
  if (typeof role.id !== 'string' || typeof role.name !== 'string' || !Array.isArray(role.permissions)) {
    return null;
  }

  const id = normalizeRoleId(role.id);
  const name = normalizeRoleName(role.name);
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    permissions: normalizePermissions(role.permissions),
    system: id === 'admin',
  };
}

function sortRoles(roles: RoleDefinition[]): RoleDefinition[] {
  return [...roles].sort((left, right) => {
    if (left.id === 'admin') return -1;
    if (right.id === 'admin') return 1;
    return left.name.localeCompare(right.name);
  });
}

function slugifyRoleName(name: string): string {
  return normalizeRoleName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export class RoleService {
  private roles: RoleDefinition[] = defaultRoles();
  private rolePermissions = buildRolePermissionsMap(this.roles);

  async init(): Promise<void> {
    this.roles = await this.readRoles();
    this.rolePermissions = buildRolePermissionsMap(this.roles);
  }

  list(): RoleDefinition[] {
    return this.roles.map(cloneRole);
  }

  getById(roleId: UserRole): RoleDefinition | null {
    const normalizedRoleId = normalizeRoleId(roleId);
    const role = this.roles.find((entry) => entry.id === normalizedRoleId);
    return role ? cloneRole(role) : null;
  }

  hasRole(roleId: UserRole): boolean {
    return this.roles.some((role) => role.id === normalizeRoleId(roleId));
  }

  getRoleName(roleId: UserRole): string {
    return this.getById(roleId)?.name ?? roleId;
  }

  getPermissions(roleId: UserRole): Permission[] {
    return [...(this.rolePermissions[normalizeRoleId(roleId)] ?? [])];
  }

  getRolesWithPermission(permission: Permission): UserRole[] {
    return this.roles
      .filter((role) => role.permissions.includes(permission))
      .map((role) => role.id);
  }

  hasPermission(roleId: UserRole, permission: Permission): boolean {
    return hasSharedPermission(normalizeRoleId(roleId), permission, this.rolePermissions);
  }

  async createRole(input: { name: string; permissions: Permission[] }): Promise<RoleDefinition> {
    const name = normalizeRoleName(input.name);
    if (!name) {
      throw Object.assign(new Error('Role name is required'), { status: 400 });
    }

    const baseId = slugifyRoleName(name) || 'role';
    let roleId = baseId;
    let suffix = 2;
    while (this.roles.some((role) => role.id === roleId)) {
      roleId = `${baseId}-${suffix}`;
      suffix += 1;
    }

    const role: RoleDefinition = {
      id: roleId,
      name,
      permissions: normalizePermissions(input.permissions),
    };

    this.roles = sortRoles([...this.roles, role]);
    await this.persistRoles();
    return cloneRole(role);
  }

  async updateRole(
    roleId: UserRole,
    updates: { name?: string; permissions?: Permission[] },
  ): Promise<RoleDefinition | null> {
    const normalizedRoleId = normalizeRoleId(roleId);
    const index = this.roles.findIndex((role) => role.id === normalizedRoleId);
    if (index === -1) {
      return null;
    }

    if (normalizedRoleId === 'admin') {
      throw Object.assign(new Error('Admin role cannot be edited'), { status: 400 });
    }

    const existing = this.roles[index];
    const updated: RoleDefinition = {
      ...existing,
      name: updates.name === undefined ? existing.name : normalizeRoleName(updates.name),
      permissions: updates.permissions === undefined
        ? [...existing.permissions]
        : normalizePermissions(updates.permissions),
    };

    if (!updated.name) {
      throw Object.assign(new Error('Role name is required'), { status: 400 });
    }

    this.roles = sortRoles(this.roles.map((role, roleIndex) => (roleIndex === index ? updated : role)));
    await this.persistRoles();
    return cloneRole(updated);
  }

  async deleteRole(roleId: UserRole): Promise<boolean> {
    const normalizedRoleId = normalizeRoleId(roleId);
    if (normalizedRoleId === 'admin') {
      throw Object.assign(new Error('Admin role cannot be deleted'), { status: 400 });
    }

    if (await userService.hasUsersWithRole(normalizedRoleId)) {
      throw Object.assign(new Error('Cannot delete a role that is assigned to users'), { status: 409 });
    }

    const remainingRoles = this.roles.filter((role) => role.id !== normalizedRoleId);
    if (remainingRoles.length === this.roles.length) {
      return false;
    }

    this.roles = sortRoles(remainingRoles);
    await this.persistRoles();
    return true;
  }

  async setPermissionAssignments(permission: Permission, roleIds: UserRole[]): Promise<UserRole[]> {
    const allowedRoleIds = new Set(roleIds.map(normalizeRoleId).filter((roleId) => this.hasRole(roleId)));
    const nextRoles = this.roles.map((role) => {
      if (role.id === 'admin') {
        return {
          ...role,
          permissions: [...PERMISSIONS],
        };
      }

      const permissions = new Set(role.permissions);
      if (allowedRoleIds.has(role.id)) {
        permissions.add(permission);
      } else {
        permissions.delete(permission);
      }

      return {
        ...role,
        permissions: Array.from(permissions),
      };
    });

    this.roles = sortRoles(nextRoles);
    await this.persistRoles();
    return this.getRolesWithPermission(permission);
  }

  private async readRoles(): Promise<RoleDefinition[]> {
    try {
      const raw = await fs.readFile(getRolesPath(), 'utf-8');
      const parsed = JSON.parse(raw) as Partial<RoleDefinition>[];
      const normalized = parsed.map(sanitizeRoleDefinition).filter((role): role is RoleDefinition => role !== null);
      if (normalized.length === 0) {
        const defaults = defaultRoles();
        await this.writeRoles(defaults);
        return defaults;
      }

      if (!normalized.some((role) => role.id === 'admin')) {
        normalized.unshift(cloneRole(DEFAULT_ROLE_DEFINITIONS[0]!));
      }

      const sorted = sortRoles(normalized.map((role) => (
        role.id === 'admin'
          ? {
              ...role,
              name: 'Admin',
              permissions: [...PERMISSIONS],
              system: true,
            }
          : role
      )));

      await this.writeRoles(sorted);
      return sorted;
    } catch {
      const defaults = defaultRoles();
      await this.writeRoles(defaults);
      return defaults;
    }
  }

  private async persistRoles(): Promise<void> {
    this.rolePermissions = buildRolePermissionsMap(this.roles);
    await this.writeRoles(this.roles);
  }

  private async writeRoles(roles: RoleDefinition[]): Promise<void> {
    await fs.writeFile(getRolesPath(), JSON.stringify(roles, null, 2), 'utf-8');
  }
}

export const roleService = new RoleService();