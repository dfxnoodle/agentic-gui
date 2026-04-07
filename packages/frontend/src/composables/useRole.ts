import { computed } from 'vue';
import { useAuthStore } from '../stores/auth.store';
import type { Permission } from '@agentic-gui/shared';

export function useRole() {
  const authStore = useAuthStore();

  const role = computed(() => authStore.user?.role ?? '');

  function can(permission: Permission): boolean {
    return authStore.hasPermission(permission);
  }

  const canCreateConversation = computed(() => can('create_conversation'));
  const canManageUsers = computed(() => can('manage_users'));
  const canConfigureCli = computed(() => can('configure_cli'));
  const canConfigureProjects = computed(() => can('configure_projects'));
  const canApprovePlan = computed(() => can('approve_plan'));
  const canRequestChanges = computed(() => can('request_changes'));

  return {
    role,
    can,
    canCreateConversation,
    canManageUsers,
    canConfigureCli,
    canConfigureProjects,
    canApprovePlan,
    canRequestChanges,
  };
}
