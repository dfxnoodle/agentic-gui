import { client } from './client';
import type { Permission, RoleDefinition, UserRole } from '@agentic-gui/shared';

export interface MaskedProviderConfig {
  authMode: string;
  maskedFields: Record<string, string | null>;
}

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
  roleName: string;
}

export interface ApprovePlanPermissionConfig {
  roles: UserRole[];
}

export const adminApi = {
  async getUsers() {
    const { data } = await client.get<AdminUser[]>('/admin/users');
    return data;
  },

  async updateUser(id: string, updates: { role?: string; displayName?: string }) {
    const { data } = await client.put(`/admin/users/${id}`, updates);
    return data;
  },

  async deleteUser(id: string) {
    await client.delete(`/admin/users/${id}`);
  },

  async getRoles() {
    const { data } = await client.get<RoleDefinition[]>('/admin/roles');
    return data;
  },

  async createRole(payload: { name: string; permissions: Permission[] }) {
    const { data } = await client.post<RoleDefinition>('/admin/roles', payload);
    return data;
  },

  async updateRole(id: string, updates: { name?: string; permissions?: Permission[] }) {
    const { data } = await client.put<RoleDefinition>(`/admin/roles/${id}`, updates);
    return data;
  },

  async deleteRole(id: string) {
    await client.delete(`/admin/roles/${id}`);
  },

  async getMaskedKeys() {
    const { data } = await client.get<Record<string, string | null>>('/admin/cli-config/keys');
    return data;
  },

  async setApiKey(provider: string, apiKey: string) {
    const { data } = await client.put<Record<string, string | null>>('/admin/cli-config/keys', { provider, apiKey });
    return data;
  },

  async deleteApiKey(provider: string) {
    const { data } = await client.delete<Record<string, string | null>>(`/admin/cli-config/keys/${provider}`);
    return data;
  },

  async getProviderConfig(provider: string) {
    const { data } = await client.get<MaskedProviderConfig | null>(`/admin/cli-config/providers/${provider}`);
    return data;
  },

  async setProviderConfig(provider: string, config: { authMode: string; fields: Record<string, string> }) {
    const { data } = await client.put<MaskedProviderConfig>(`/admin/cli-config/providers/${provider}`, config);
    return data;
  },

  async deleteProviderConfig(provider: string) {
    await client.delete(`/admin/cli-config/providers/${provider}`);
  },

  async getApprovePlanPermissions() {
    const { data } = await client.get<ApprovePlanPermissionConfig>('/admin/permissions/approve-plan');
    return data;
  },

  async setApprovePlanPermissions(roles: UserRole[]) {
    const { data } = await client.put<ApprovePlanPermissionConfig>('/admin/permissions/approve-plan', { roles });
    return data;
  },
};
