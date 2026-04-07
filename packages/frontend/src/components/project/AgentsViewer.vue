<template>
  <div class="agents-viewer">
    <div class="agents-viewer-header">
      <h3>AGENTS.md</h3>
      <button
        v-if="showInfo"
        type="button"
        class="agents-info-btn"
        title="AGENTS.md memory reminder"
        aria-label="Open AGENTS.md reminder"
        @click="emit('show-info')"
      >
        !
      </button>
    </div>
    <div v-if="loading" class="hint">Loading...</div>
    <div v-else-if="content" class="markdown-body" v-html="rendered"></div>
    <p v-else class="empty">No AGENTS.md found for this project.</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { projectsApi } from '../../api/projects.api';
import { renderMarkdown } from '../../composables/useMarkdown';

const props = defineProps<{ projectId: string; showInfo?: boolean }>();
const emit = defineEmits<{ (e: 'show-info'): void }>();
const showInfo = computed(() => Boolean(props.showInfo));

const content = ref<string | null>(null);
const loading = ref(false);
const rendered = computed(() => content.value ? renderMarkdown(content.value) : '');

async function load() {
  loading.value = true;
  try {
    content.value = await projectsApi.getAgents(props.projectId);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => props.projectId, load);
</script>

<style scoped>
.agents-viewer-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.agents-viewer-header h3 {
  margin: 0;
}

.agents-info-btn {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 12px;
  background: var(--color-warning);
  color: #111827;
  cursor: pointer;
}
</style>
