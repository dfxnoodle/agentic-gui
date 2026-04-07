<template>
  <div class="memory-viewer">
    <h3>MEMORY.md</h3>
    <div v-if="loading" class="hint">Loading...</div>
    <div v-else-if="content" class="markdown-body" v-html="rendered"></div>
    <p v-else class="empty">No MEMORY.md found for this project.</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { projectsApi } from '../../api/projects.api';
import { renderMarkdown } from '../../composables/useMarkdown';

const props = defineProps<{ projectId: string }>();

const content = ref<string | null>(null);
const loading = ref(false);
const rendered = computed(() => content.value ? renderMarkdown(content.value) : '');

async function load() {
  loading.value = true;
  try {
    content.value = await projectsApi.getMemory(props.projectId);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => props.projectId, load);
</script>
