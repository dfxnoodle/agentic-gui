import { createRouter, createWebHistory } from 'vue-router';
import type { Permission } from '@agentic-gui/shared';
import { useAuthStore } from '../stores/auth.store';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      name: 'dashboard',
      component: () => import('../views/DashboardView.vue'),
    },
    {
      path: '/chat/:id?',
      name: 'chat',
      component: () => import('../views/ChatView.vue'),
    },
    {
      path: '/plans/:id',
      name: 'plan-review',
      component: () => import('../views/PlanReviewView.vue'),
    },
    {
      path: '/projects/:id/setup',
      name: 'project-setup',
      component: () => import('../views/ProjectSetupView.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/SettingsView.vue'),
      meta: { requiredPermissions: ['manage_users', 'configure_projects', 'configure_cli'] satisfies Permission[] },
    },
  ],
});

router.beforeEach((to) => {
  const authStore = useAuthStore();
  authStore.loadFromStorage();

  if (to.meta.public) return true;

  if (!authStore.isAuthenticated) {
    return { name: 'login' };
  }

  const requiredPermissions = Array.isArray(to.meta.requiredPermissions)
    ? (to.meta.requiredPermissions as Permission[])
    : [];

  if (requiredPermissions.length > 0 && !authStore.hasAnyPermission(requiredPermissions)) {
    return { name: 'dashboard' };
  }

  return true;
});

export { router };
