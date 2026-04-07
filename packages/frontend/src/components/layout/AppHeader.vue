<template>
  <header class="app-header">
    <div class="header-left">
      <router-link to="/" class="logo">
        <img src="/logo.png" alt="Logo" class="logo-img" />
        <span class="logo-text">Agentic GUI</span>
      </router-link>
    </div>
    <div class="header-center">
      <select
        v-if="projectStore.projects.length > 1"
        :value="projectStore.activeProject?.id"
        @change="switchProject"
        class="project-selector"
      >
        <option v-for="p in projectStore.projects" :key="p.id" :value="p.id">
          {{ p.name }}
        </option>
      </select>
      <span v-else-if="projectStore.activeProject" class="project-name">
        {{ projectStore.activeProject.name }}
      </span>
    </div>
    <div class="header-right">
      <button @click="toggleTheme" class="btn-small btn-ghost theme-toggle" title="Toggle Theme">
        {{ isDark ? '🌙 Dark' : '☀️ Light' }}
      </button>
      <span class="badge role-badge">{{ authStore.user?.roleName ?? authStore.user?.role }}</span>
      <span class="username">{{ authStore.user?.username }}</span>
      <button @click="authStore.logout(); $router.push('/login')" class="btn-small btn-ghost">
        Logout
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuthStore } from '../../stores/auth.store';
import { useProjectStore } from '../../stores/project.store';
import { useConversationStore } from '../../stores/conversation.store';

const authStore = useAuthStore();
const projectStore = useProjectStore();
const conversationStore = useConversationStore();

const isDark = ref(false);

onMounted(() => {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    isDark.value = true;
    document.body.classList.add('dark-mode');
  }
});

function toggleTheme() {
  isDark.value = !isDark.value;
  if (isDark.value) {
    document.body.classList.add('dark-mode');
    localStorage.setItem('theme', 'dark');
  } else {
    document.body.classList.remove('dark-mode');
    localStorage.setItem('theme', 'light');
  }
}

function switchProject(event: Event) {
  const id = (event.target as HTMLSelectElement).value;
  const project = projectStore.projects.find((p) => p.id === id);
  if (project) {
    projectStore.setActiveProject(project);
    void conversationStore.fetchConversations(project.id);
  }
}
</script>
