import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { authApi } from '../api/auth.api';
import {
  DEFAULT_ROLE_DEFINITIONS,
  ROLE_PERMISSIONS,
  type AuthenticatedUser,
  type Permission,
} from '@agentic-gui/shared';

const DEFAULT_ROLE_NAMES = new Map(DEFAULT_ROLE_DEFINITIONS.map((role) => [role.id, role.name]));
const SETTINGS_PERMISSIONS: Permission[] = ['manage_users', 'configure_projects', 'configure_cli'];

function titleizeRole(role: string): string {
  return role
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeStoredUser(raw: unknown): AuthenticatedUser | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const candidate = raw as Partial<AuthenticatedUser> & { role?: string; permissions?: Permission[] };
  if (typeof candidate.userId !== 'string' || typeof candidate.username !== 'string' || typeof candidate.role !== 'string') {
    return null;
  }

  return {
    userId: candidate.userId,
    username: candidate.username,
    displayName: typeof candidate.displayName === 'string' ? candidate.displayName : candidate.username,
    role: candidate.role,
    roleName: typeof candidate.roleName === 'string'
      ? candidate.roleName
      : DEFAULT_ROLE_NAMES.get(candidate.role) ?? titleizeRole(candidate.role),
    permissions: Array.isArray(candidate.permissions)
      ? [...candidate.permissions]
      : [...(ROLE_PERMISSIONS[candidate.role] ?? [])],
    isAdmin: typeof candidate.isAdmin === 'boolean' ? candidate.isAdmin : candidate.role === 'admin',
  };
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(null);
  const user = ref<AuthenticatedUser | null>(null);

  const isAuthenticated = computed(() => !!token.value);
  const permissions = computed(() => user.value?.permissions ?? []);
  const isAdmin = computed(() => user.value?.isAdmin ?? user.value?.role === 'admin');
  const canAccessSettings = computed(() => SETTINGS_PERMISSIONS.some((permission) => hasPermission(permission)));

  function persistSession(nextToken: string, nextUser: AuthenticatedUser) {
    token.value = nextToken;
    user.value = nextUser;
    localStorage.setItem('agentic-gui-token', nextToken);
    localStorage.setItem('agentic-gui-user', JSON.stringify(nextUser));
  }

  function loadFromStorage() {
    if (token.value && user.value) {
      return;
    }

    const savedToken = localStorage.getItem('agentic-gui-token');
    const savedUser = localStorage.getItem('agentic-gui-user');
    if (savedToken && savedUser) {
      const parsedUser = normalizeStoredUser(JSON.parse(savedUser));
      if (!parsedUser) {
        logout();
        return;
      }
      token.value = savedToken;
      user.value = parsedUser;
    }
  }

  function hasPermission(permission: Permission): boolean {
    return isAdmin.value || permissions.value.includes(permission);
  }

  function hasAnyPermission(requiredPermissions: Permission[]): boolean {
    return requiredPermissions.some((permission) => hasPermission(permission));
  }

  async function login(username: string, password: string) {
    const result = await authApi.login(username, password);
    persistSession(result.token, result.user);
  }

  async function refreshUser() {
    if (!token.value) {
      return;
    }

    const currentUser = await authApi.me();
    user.value = currentUser;
    localStorage.setItem('agentic-gui-user', JSON.stringify(currentUser));
  }

  function logout() {
    token.value = null;
    user.value = null;
    localStorage.removeItem('agentic-gui-token');
    localStorage.removeItem('agentic-gui-user');
  }

  return {
    token,
    user,
    permissions,
    isAuthenticated,
    isAdmin,
    canAccessSettings,
    hasPermission,
    hasAnyPermission,
    loadFromStorage,
    refreshUser,
    login,
    logout,
  };
});
