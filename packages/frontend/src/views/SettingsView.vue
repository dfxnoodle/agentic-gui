<template>
  <div class="settings">
    <h2>Settings</h2>

    <div class="settings-tabs">
      <button v-if="canManageUsers" :class="{ active: activeTab === 'users' }" @click="activeTab = 'users'">Users</button>
      <button v-if="canManageUsers" :class="{ active: activeTab === 'roles' }" @click="activeTab = 'roles'">Roles</button>
      <button v-if="canConfigureProjects" :class="{ active: activeTab === 'projects' }" @click="activeTab = 'projects'">Projects</button>
      <button v-if="canConfigureCli" :class="{ active: activeTab === 'cli' }" @click="activeTab = 'cli'">CLI Config</button>
    </div>

    <div v-if="activeTab === 'users' && canManageUsers" class="tab-content">
      <h3>User Management</h3>

      <form @submit.prevent="handleCreateUser" class="form-inline">
        <input v-model="newUser.username" placeholder="Username" required />
        <input v-model="newUser.password" type="password" placeholder="Password" required />
        <input v-model="newUser.displayName" placeholder="Display Name" required />
        <select v-model="newUser.role" :disabled="roles.length === 0">
          <option v-for="role in roles" :key="role.id" :value="role.id">{{ role.name }}</option>
        </select>
        <button type="submit" class="btn-primary" :disabled="roles.length === 0">Add User</button>
      </form>

      <table v-if="users.length" class="data-table">
        <thead>
          <tr><th>Username</th><th>Display Name</th><th>Role</th><th>Actions</th></tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>{{ u.username }}</td>
            <td>{{ u.displayName }}</td>
            <td>
              <span class="badge">{{ u.roleName }}</span>
              <div class="role-id">{{ u.role }}</div>
            </td>
            <td>
              <button
                v-if="u.id !== authStore.user?.userId"
                class="btn-small btn-danger-outline"
                @click="handleDeleteUser(u.id)"
              >Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="activeTab === 'roles' && canManageUsers" class="tab-content">
      <h3>Role Definitions</h3>
      <p class="hint">Define role names and permission sets. Role IDs stay stable so existing user assignments keep working.</p>

      <div class="role-card create-role-card">
        <div class="role-card-header">
          <div>
            <strong>Create Role</strong>
            <p class="hint">The backend generates a stable role ID from the name.</p>
          </div>
        </div>

        <div class="form-group">
          <label>Role Name</label>
          <input v-model="newRole.name" placeholder="Release Manager" />
        </div>

        <div class="permission-grid">
          <label v-for="permission in availablePermissions" :key="`new-${permission}`" class="permission-role-label">
            <input v-model="newRole.permissions" type="checkbox" :value="permission" />
            {{ permissionLabel(permission) }}
          </label>
        </div>

        <div class="role-card-actions">
          <button class="btn-primary" @click="handleCreateRole" :disabled="creatingRole || !newRole.name.trim()">
            {{ creatingRole ? 'Creating...' : 'Create Role' }}
          </button>
        </div>
      </div>

      <div class="role-card-grid">
        <div v-for="role in roles" :key="role.id" class="role-card">
          <div class="role-card-header">
            <div>
              <strong>{{ roleDrafts[role.id]?.name ?? role.name }}</strong>
              <div class="role-id">{{ role.id }}</div>
            </div>
            <span class="badge" :class="isLockedRole(role) ? 'approved' : ''">{{ isLockedRole(role) ? 'Locked' : 'Customizable' }}</span>
          </div>

          <div class="form-group">
            <label>Display Name</label>
            <input v-model="roleDrafts[role.id].name" :disabled="isLockedRole(role)" />
          </div>

          <div class="permission-grid">
            <label v-for="permission in availablePermissions" :key="`${role.id}-${permission}`" class="permission-role-label">
              <input v-model="roleDrafts[role.id].permissions" type="checkbox" :value="permission" :disabled="isLockedRole(role)" />
              {{ permissionLabel(permission) }}
            </label>
          </div>

          <div class="role-card-actions">
            <button class="btn-primary" @click="saveRole(role.id)" :disabled="savingRoleId === role.id || isLockedRole(role)">
              {{ savingRoleId === role.id ? 'Saving...' : 'Save Role' }}
            </button>
            <button class="btn-small btn-danger-outline" @click="handleDeleteRole(role.id)" :disabled="isLockedRole(role)">
              Delete Role
            </button>
          </div>
        </div>
      </div>

      <p v-if="rolesInfo" class="hint">{{ rolesInfo }}</p>
    </div>

    <div v-if="activeTab === 'projects' && canConfigureProjects" class="tab-content">
      <h3>Projects</h3>

      <form @submit.prevent="handleCreateProject" class="form-inline">
        <input :value="derivedProjectName" placeholder="Project name (auto)" readonly />
        <input v-model="newProject.rootPath" placeholder="/path/to/project" required />
        <select v-model="newProject.cliProvider">
          <option v-for="provider in providerList" :key="provider.id" :value="provider.id">
            {{ provider.displayName }}
          </option>
        </select>
        <button type="submit" class="btn-primary" :disabled="!derivedProjectName">Add Project</button>
      </form>

      <table v-if="projects.length" class="data-table">
        <thead>
          <tr><th>Name</th><th>Path</th><th>CLI</th><th>Actions</th></tr>
        </thead>
        <tbody>
          <tr v-for="p in projects" :key="p.id">
            <td>{{ p.name }}</td>
            <td><code>{{ p.rootPath }}</code></td>
            <td>{{ cliDisplayName(p.cliProvider) }}</td>
            <td>
              <router-link :to="`/projects/${p.id}/setup`" class="btn-small">Configure</router-link>
              <button class="btn-small btn-danger-outline" @click="handleDeleteProject(p.id)">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="activeTab === 'cli' && canConfigureCli" class="tab-content">
      <h3>CLI Credentials</h3>
      <p class="hint">Configure fallback credentials for each CLI provider when using local-first credentials on a project, or when no project-local CLI config is detected. Environment variables take precedence over stored values.</p>

      <div class="provider-config-list">
        <div v-for="provider in providerList" :key="provider.id" class="provider-config-card card">
          <div class="provider-header" @click="toggleProvider(provider.id)">
            <div class="provider-header-left">
              <strong>{{ provider.displayName }}</strong>
              <span v-if="providerConfigs[provider.id]" class="badge approved">
                {{ getAuthModeLabel(provider.id, providerConfigs[provider.id]!.authMode) }}
              </span>
              <span v-else class="badge">Not configured</span>
            </div>
            <span class="expand-icon">{{ expandedProvider === provider.id ? '−' : '+' }}</span>
          </div>

          <div v-if="expandedProvider === provider.id" class="provider-body">
            <div class="form-group">
              <label>Authentication Method</label>
              <select v-model="editState.authMode" @change="onAuthModeChange()">
                <option v-for="mode in provider.authModes" :key="mode.id" :value="mode.id">
                  {{ mode.label }}
                </option>
              </select>
            </div>

            <div v-if="currentModeDef" class="auth-fields">
              <div v-for="field in currentModeDef.fields" :key="field.key" class="form-group">
                <label>{{ field.label }} <span v-if="field.required" class="required">*</span></label>
                <input
                  v-model="editState.fields[field.key]"
                  :type="field.type === 'password' ? (showSecrets[field.key] ? 'text' : 'password') : 'text'"
                  :placeholder="field.placeholder || ''"
                  :required="field.required"
                />
                <button
                  v-if="field.type === 'password'"
                  type="button"
                  class="btn-small toggle-vis"
                  @click="showSecrets[field.key] = !showSecrets[field.key]"
                >{{ showSecrets[field.key] ? 'Hide' : 'Show' }}</button>
                <div class="hint">{{ field.helpText || `Env: ${field.envVar}` }}</div>
              </div>
            </div>

            <div class="provider-actions">
              <button class="btn-primary" @click="saveProviderConfig(provider.id)" :disabled="saving">
                {{ saving ? 'Saving...' : 'Save' }}
              </button>
              <button
                v-if="providerConfigs[provider.id]"
                class="btn-small btn-danger-outline"
                @click="removeProviderConfig(provider.id)"
              >Remove</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  CLI_AUTH_MODES,
  CLI_DISPLAY_NAMES,
  CLI_PROVIDERS,
  PERMISSIONS,
  type CLIProvider,
  type Permission,
  type RoleDefinition,
} from '@agentic-gui/shared';
import { adminApi, type AdminUser, type MaskedProviderConfig } from '../api/admin.api';
import { authApi } from '../api/auth.api';
import { useAuthStore } from '../stores/auth.store';
import { useProjectStore } from '../stores/project.store';

type SettingsTab = 'users' | 'roles' | 'projects' | 'cli';

const projectStore = useProjectStore();
const authStore = useAuthStore();

function preferredTab(): SettingsTab {
  if (authStore.hasPermission('manage_users')) return 'users';
  if (authStore.hasPermission('configure_projects')) return 'projects';
  return 'cli';
}

const activeTab = ref<SettingsTab>(preferredTab());
const canManageUsers = computed(() => authStore.hasPermission('manage_users'));
const canConfigureProjects = computed(() => authStore.hasPermission('configure_projects'));
const canConfigureCli = computed(() => authStore.hasPermission('configure_cli'));

const users = ref<AdminUser[]>([]);
const roles = ref<RoleDefinition[]>([]);
const roleDrafts = ref<Record<string, { name: string; permissions: Permission[] }>>({});
const projects = ref(projectStore.projects);

const newUser = ref({ username: '', password: '', displayName: '', role: '' });
const newRole = ref<{ name: string; permissions: Permission[] }>({ name: '', permissions: [] });
const newProject = ref<{ rootPath: string; cliProvider: CLIProvider }>({ rootPath: '', cliProvider: 'claude' });
const rolesInfo = ref('');
const creatingRole = ref(false);
const savingRoleId = ref<string | null>(null);

const providerConfigs = ref<Record<string, MaskedProviderConfig | null>>({});
const expandedProvider = ref<string | null>(null);
const editState = ref<{ authMode: string; fields: Record<string, string> }>({ authMode: '', fields: {} });
const showSecrets = ref<Record<string, boolean>>({});
const saving = ref(false);

const availablePermissions = [...PERMISSIONS];
const providerList = CLI_PROVIDERS.map((id) => ({
  id,
  displayName: CLI_DISPLAY_NAMES[id],
  authModes: CLI_AUTH_MODES[id],
}));

function sortRoles(nextRoles: RoleDefinition[]): RoleDefinition[] {
  return [...nextRoles].sort((left, right) => {
    if (left.id === 'admin') return -1;
    if (right.id === 'admin') return 1;
    return left.name.localeCompare(right.name);
  });
}

function syncRoleState(nextRoles: RoleDefinition[]) {
  roles.value = sortRoles(nextRoles);
  roleDrafts.value = Object.fromEntries(
    roles.value.map((role) => [
      role.id,
      {
        name: role.name,
        permissions: [...role.permissions],
      },
    ]),
  );

  if (!roles.value.some((role) => role.id === newUser.value.role)) {
    newUser.value.role = roles.value.find((role) => role.id !== 'admin')?.id ?? roles.value[0]?.id ?? '';
  }
}

function getProjectNameFromPath(rootPath: string): string {
  const normalizedPath = rootPath.trim().replace(/[\\/]+$/, '');
  if (!normalizedPath) return '';

  const parts = normalizedPath.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

const derivedProjectName = computed(() => getProjectNameFromPath(newProject.value.rootPath));

const currentModeDef = computed(() => {
  if (!expandedProvider.value) return null;
  const modes = CLI_AUTH_MODES[expandedProvider.value as CLIProvider];
  return modes?.find((mode) => mode.id === editState.value.authMode) ?? null;
});

function permissionLabel(permission: Permission): string {
  return permission
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function isLockedRole(role: RoleDefinition): boolean {
  return role.id === 'admin' || Boolean(role.system);
}

function getAuthModeLabel(providerId: string, authMode: string): string {
  const modes = CLI_AUTH_MODES[providerId as CLIProvider];
  return modes?.find((mode) => mode.id === authMode)?.label ?? authMode;
}

function toggleProvider(providerId: string) {
  if (expandedProvider.value === providerId) {
    expandedProvider.value = null;
    return;
  }

  expandedProvider.value = providerId;
  showSecrets.value = {};

  const existing = providerConfigs.value[providerId];
  const defaultMode = CLI_AUTH_MODES[providerId as CLIProvider]?.[0]?.id ?? 'api_key';

  editState.value = existing
    ? {
        authMode: existing.authMode,
        fields: Object.fromEntries(Object.entries(existing.maskedFields).map(([key, value]) => [key, value ?? ''])),
      }
    : { authMode: defaultMode, fields: {} };
}

function onAuthModeChange() {
  editState.value.fields = {};
  showSecrets.value = {};
}

function cliDisplayName(provider: string) {
  return CLI_DISPLAY_NAMES[provider as CLIProvider] ?? provider;
}

async function fetchUsers() {
  users.value = await adminApi.getUsers();
}

async function fetchRoles() {
  const nextRoles = await adminApi.getRoles();
  syncRoleState(nextRoles);
}

async function handleCreateUser() {
  await authApi.register(newUser.value);
  newUser.value = {
    username: '',
    password: '',
    displayName: '',
    role: roles.value.find((role) => role.id !== 'admin')?.id ?? roles.value[0]?.id ?? '',
  };
  await fetchUsers();
}

async function handleDeleteUser(id: string) {
  await adminApi.deleteUser(id);
  await fetchUsers();
}

async function handleCreateRole() {
  creatingRole.value = true;
  try {
    await adminApi.createRole({
      name: newRole.value.name,
      permissions: newRole.value.permissions,
    });
    newRole.value = { name: '', permissions: [] };
    rolesInfo.value = 'Role created.';
    await fetchRoles();
  } finally {
    creatingRole.value = false;
  }
}

async function saveRole(roleId: string) {
  const draft = roleDrafts.value[roleId];
  if (!draft) return;

  savingRoleId.value = roleId;
  try {
    await adminApi.updateRole(roleId, draft);
    rolesInfo.value = 'Role updated.';
    await Promise.all([fetchRoles(), fetchUsers()]);
  } finally {
    savingRoleId.value = null;
  }
}

async function handleDeleteRole(roleId: string) {
  if (!window.confirm('Delete this role? Users assigned to it must be reassigned first.')) return;
  await adminApi.deleteRole(roleId);
  rolesInfo.value = 'Role deleted.';
  await Promise.all([fetchRoles(), fetchUsers()]);
}

async function handleCreateProject() {
  if (!derivedProjectName.value) return;

  await projectStore.createProject({
    ...newProject.value,
    name: derivedProjectName.value,
  });
  newProject.value = { rootPath: '', cliProvider: 'claude' };
  projects.value = projectStore.projects;
}

async function handleDeleteProject(id: string) {
  if (!window.confirm('Delete this project?')) return;
  await projectStore.deleteProject(id);
  projects.value = projectStore.projects;
}

async function fetchProviderConfigs() {
  for (const provider of CLI_PROVIDERS) {
    providerConfigs.value[provider] = await adminApi.getProviderConfig(provider);
  }
}

async function saveProviderConfig(providerId: string) {
  saving.value = true;
  try {
    const result = await adminApi.setProviderConfig(providerId, editState.value);
    providerConfigs.value[providerId] = result;
    expandedProvider.value = null;
  } finally {
    saving.value = false;
  }
}

async function removeProviderConfig(providerId: string) {
  await adminApi.deleteProviderConfig(providerId);
  providerConfigs.value[providerId] = null;
  expandedProvider.value = null;
}

onMounted(async () => {
  const tasks: Promise<unknown>[] = [];

  if (canManageUsers.value) {
    tasks.push(fetchRoles(), fetchUsers());
  }

  if (canConfigureProjects.value) {
    tasks.push(projectStore.fetchProjects());
  }

  if (canConfigureCli.value) {
    tasks.push(fetchProviderConfigs());
  }

  await Promise.all(tasks);
  projects.value = projectStore.projects;
});
</script>
