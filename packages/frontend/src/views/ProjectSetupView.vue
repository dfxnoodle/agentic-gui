<template>
  <div class="project-setup" v-if="project">
    <h2>{{ project.name }}</h2>
    <p class="subtitle">{{ project.rootPath }}</p>

    <div class="settings-tabs">
      <button :class="{ active: tab === 'overview' }" @click="tab = 'overview'">Overview</button>
      <button :class="{ active: tab === 'memory' }" @click="tab = 'memory'">MEMORY.md</button>
      <button :class="{ active: tab === 'agents' }" @click="tab = 'agents'">AGENTS.md</button>
      <button :class="{ active: tab === 'config' }" @click="tab = 'config'">Configuration</button>
    </div>

    <!-- Overview -->
    <div v-if="tab === 'overview'" class="tab-content">
      <div class="form-group">
        <label>Project Name</label>
        <input v-model="editName" />
      </div>
      <div class="form-group">
        <label>Root Path</label>
        <input v-model="editPath" />
      </div>
      <div class="form-group">
        <label>CLI Provider</label>
        <select v-model="editProvider">
          <option v-for="provider in providerOptions" :key="provider.id" :value="provider.id">
            {{ provider.displayName }}
          </option>
        </select>
      </div>
      <div class="form-group">
        <label>Credentials</label>
        <select v-model="editCredentialPreference">
          <option value="platform_only">Platform API keys only (default)</option>
          <option value="local_first">Local / project first, platform key as fallback</option>
        </select>
        <p class="hint">Local-first uses CLI config under the project or home directory when detected; the API key from Settings is used if authentication fails.</p>
      </div>
      <button class="btn-primary" @click="saveProject" :disabled="saving">Save Changes</button>
      <span v-if="saved" class="hint" style="margin-left: 12px;">Saved!</span>
    </div>

    <!-- MEMORY.md viewer -->
    <div v-if="tab === 'memory'" class="tab-content">
      <MemoryViewer :project-id="project.id" />
    </div>

    <!-- AGENTS.md viewer -->
    <div v-if="tab === 'agents'" class="tab-content">
      <AgentsViewer :project-id="project.id" />
    </div>

    <!-- Configuration -->
    <div v-if="tab === 'config'" class="tab-content">
      <h3>CLI Configuration Overrides</h3>
      <div class="form-group">
        <label>Max Turns</label>
        <input v-model.number="editConfig.maxTurns" type="number" min="1" max="50" />
      </div>
      <div class="form-group">
        <label>Max Runtime (seconds)</label>
        <input v-model.number="editRuntimeSec" type="number" min="10" max="600" />
      </div>
      <div class="form-group">
        <label>Watchdog Timeout (seconds)</label>
        <input v-model.number="editWatchdogSec" type="number" min="10" max="120" />
      </div>
      <button class="btn-primary" @click="saveProject" :disabled="saving">Save Changes</button>
      <span v-if="saved" class="hint" style="margin-left: 12px;">Saved!</span>
    </div>
  </div>
  <div v-else class="empty">
    <p>Loading project...</p>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { projectsApi } from '../api/projects.api';
import { CLI_DISPLAY_NAMES, CLI_PROVIDERS } from '@agentic-gui/shared';
import type { Project, CLIProvider, CredentialPreference } from '@agentic-gui/shared';
import MemoryViewer from '../components/project/MemoryViewer.vue';
import AgentsViewer from '../components/project/AgentsViewer.vue';

const route = useRoute();
const project = ref<Project | null>(null);
const tab = ref('overview');
const saving = ref(false);
const saved = ref(false);

const editName = ref('');
const editPath = ref('');
const editProvider = ref<CLIProvider>('claude');
const editCredentialPreference = ref<CredentialPreference>('platform_only');
const editConfig = ref({ maxTurns: 10 });
const editRuntimeSec = ref(300);
const editWatchdogSec = ref(60);
const providerOptions = CLI_PROVIDERS.map((id) => ({ id, displayName: CLI_DISPLAY_NAMES[id] }));

function loadFromProject(p: Project) {
  editName.value = p.name;
  editPath.value = p.rootPath;
  editProvider.value = p.cliProvider;
  editCredentialPreference.value = p.credentialPreference ?? 'platform_only';
  editConfig.value = { maxTurns: p.cliConfig.maxTurns };
  editRuntimeSec.value = Math.round(p.cliConfig.maxRuntimeMs / 1000);
  editWatchdogSec.value = Math.round(p.cliConfig.watchdogTimeoutMs / 1000);
}

async function fetchProject() {
  const id = route.params.id as string;
  project.value = await projectsApi.get(id);
  if (project.value) loadFromProject(project.value);
}

async function saveProject() {
  if (!project.value) return;
  saving.value = true;
  saved.value = false;
  try {
    const updated = await projectsApi.update(project.value.id, {
      name: editName.value,
      rootPath: editPath.value,
      cliProvider: editProvider.value,
      credentialPreference: editCredentialPreference.value,
      cliConfig: {
        maxTurns: editConfig.value.maxTurns,
        maxRuntimeMs: editRuntimeSec.value * 1000,
        watchdogTimeoutMs: editWatchdogSec.value * 1000,
      },
    });
    project.value = updated;
    saved.value = true;
    setTimeout(() => { saved.value = false; }, 2000);
  } finally {
    saving.value = false;
  }
}

onMounted(fetchProject);
watch(() => route.params.id, fetchProject);
</script>
