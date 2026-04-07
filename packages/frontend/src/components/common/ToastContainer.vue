<template>
  <div class="toast-container">
    <transition-group name="toast">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="toast-item"
        :class="toast.type"
        @click="dismiss(toast.id)"
      >
        {{ toast.message }}
      </div>
    </transition-group>
  </div>
</template>

<script setup lang="ts">
import { useToast } from '../../composables/useToast';
const { toasts, dismiss } = useToast();
</script>
