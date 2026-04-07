import type { UserRole } from '../types/user.js';

export const PERMISSIONS = [
  'create_conversation',
  'send_message',
  'view_conversations',
  'view_plans',
  'approve_plan',
  'reject_plan',
  'request_changes',
  'manage_users',
  'configure_cli',
  'configure_projects',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export interface RoleDefinition {
  id: UserRole;
  name: string;
  permissions: Permission[];
  system?: boolean;
}

function uniquePermissions(permissions: readonly Permission[]): Permission[] {
  return Array.from(new Set(permissions));
}

export const DEFAULT_ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    id: 'admin',
    name: 'Admin',
    permissions: [...PERMISSIONS],
    system: true,
  },
  {
    id: 'project_manager',
    name: 'Project Manager',
    permissions: [
      'create_conversation',
      'send_message',
      'view_conversations',
      'view_plans',
      'approve_plan',
      'reject_plan',
      'request_changes',
      'configure_projects',
    ],
  },
  {
    id: 'operations',
    name: 'Operations',
    permissions: [
      'view_conversations',
      'send_message',
      'view_plans',
      'approve_plan',
      'reject_plan',
    ],
  },
];

export function buildRolePermissionsMap(
  roleDefinitions: ReadonlyArray<Pick<RoleDefinition, 'id' | 'permissions'>>,
): Record<UserRole, Permission[]> {
  return Object.fromEntries(
    roleDefinitions.map((role) => [role.id, uniquePermissions(role.permissions)]),
  );
}

export const ROLE_PERMISSIONS = buildRolePermissionsMap(DEFAULT_ROLE_DEFINITIONS);

export function hasPermission(
  role: UserRole,
  permission: Permission,
  rolePermissions: Partial<Record<UserRole, readonly Permission[]>> = ROLE_PERMISSIONS,
): boolean {
  return rolePermissions[role]?.includes(permission) ?? false;
}
