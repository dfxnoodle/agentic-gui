<template>
  <nav class="app-sidebar">
    <ul>
      <li>
        <router-link to="/" exact-active-class="active">Dashboard</router-link>
      </li>
      <li>
        <router-link to="/chat" active-class="active">Chat</router-link>
      </li>
      <li v-if="authStore.canAccessSettings">
        <router-link to="/settings" active-class="active">Settings</router-link>
      </li>
    </ul>
  </nav>
</template>

<script setup lang="ts">
import { useAuthStore } from '../../stores/auth.store';
const authStore = useAuthStore();
</script>
