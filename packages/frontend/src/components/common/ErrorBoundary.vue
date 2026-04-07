<template>
  <slot v-if="!error" />
  <div v-else class="error-boundary">
    <h3>Something went wrong</h3>
    <p>{{ error.message }}</p>
    <button class="btn-primary" @click="reset">Try Again</button>
  </div>
</template>

<script setup lang="ts">
import { ref, onErrorCaptured } from 'vue';

const error = ref<Error | null>(null);

onErrorCaptured((err: Error) => {
  error.value = err;
  console.error('Vue error boundary caught:', err);
  return false; // prevent propagation
});

function reset() {
  error.value = null;
}
</script>
