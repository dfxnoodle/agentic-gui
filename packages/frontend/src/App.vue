<template>
  <div id="app-root">
    <ErrorBoundary>
      <template v-if="authStore.isAuthenticated">
        <AppHeader />
        <div class="app-body">
          <AppSidebar />
          <main class="app-main">
            <router-view />
          </main>
        </div>
      </template>
      <router-view v-else />
    </ErrorBoundary>
    <ToastContainer />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useAuthStore } from './stores/auth.store';
import AppHeader from './components/layout/AppHeader.vue';
import AppSidebar from './components/layout/AppSidebar.vue';
import ErrorBoundary from './components/common/ErrorBoundary.vue';
import ToastContainer from './components/common/ToastContainer.vue';

const authStore = useAuthStore();

onMounted(async () => {
  authStore.loadFromStorage();

  if (authStore.isAuthenticated) {
    try {
      await authStore.refreshUser();
    } catch {
      authStore.logout();
    }
  }
});
</script>
