import type { Permission, UserRole } from '@agentic-gui/shared';
import { roleService } from './role.service.js';

export class PermissionService {
  async init(): Promise<void> {
    await roleService.init();
  }

  hasPermission(role: UserRole, permission: Permission): boolean {
    return roleService.hasPermission(role, permission);
  }

  getApprovePlanRoles(): UserRole[] {
    return roleService.getRolesWithPermission('approve_plan');
  }

  async setApprovePlanRoles(roles: UserRole[]): Promise<UserRole[]> {
    return roleService.setPermissionAssignments('approve_plan', roles);
  }
}

export const permissionService = new PermissionService();
