<template>
  <div class="dashboard">
    <h2>{{ projectStore.activeProject?.name ?? 'No Project Selected' }}</h2>

    <div class="dashboard-grid">
      <div class="card">
        <h3>Conversations</h3>
        <p class="stat">{{ conversations.length }}</p>
        <router-link to="/chat" class="card-link">View all</router-link>
      </div>

      <div class="card">
        <h3>Projects</h3>
        <p class="stat">{{ projects.length }}</p>
        <router-link v-if="authStore.canAccessSettings" to="/settings" class="card-link">Manage</router-link>
      </div>

      <div class="card">
        <h3>Pending Plans</h3>
        <p class="stat">{{ pendingPlans.length }}</p>
        <ul class="activity-list" v-if="pendingPlans.length">
          <li v-for="plan in pendingPlans.slice(0, 3)" :key="plan.id">
            <router-link :to="`/plans/${plan.id}`">{{ plan.title }}</router-link>
            <span class="badge pending_review">{{ planStatusLabel(plan.status) }}</span>
          </li>
        </ul>
        <p v-else class="empty">No plans awaiting review.</p>
      </div>

      <div class="card">
        <h3>Recent Activity</h3>
        <ul class="activity-list" v-if="recentConversations.length">
          <li v-for="conv in recentConversations" :key="conv.id">
            <router-link :to="`/chat/${conv.id}`">
              {{ conv.title }}
            </router-link>
            <span class="badge" :class="conv.state">{{ conversationStateLabel(conv.state) }}</span>
          </li>
        </ul>
        <p v-else class="empty">No activity yet. Start a conversation!</p>
      </div>
    </div>

    <!-- Active project context -->
    <div v-if="projectStore.activeProject" class="project-context">
      <div class="project-context-grid">
        <div class="card">
          <MemoryViewer :project-id="projectStore.activeProject.id" />
        </div>
        <div class="card">
          <AgentsViewer :project-id="projectStore.activeProject.id" :show-info="true" @show-info="showAgentsReminder = true" />
        </div>
      </div>
    </div>

    <div
      v-if="showAgentsReminder"
      class="agents-reminder-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="AGENTS.md reminder"
      @click.self="showAgentsReminder = false"
    >
      <div class="agents-reminder-modal">
        <div class="agents-reminder-modal-header">
          <h3>Reminder for AGENTS.md</h3>
          <button class="btn-small" type="button" @click="showAgentsReminder = false">Close</button>
        </div>
        <p>
          Add guidance that <code>MEMORY.md</code> is the project memory and must be checked before work.
        </p>
        <ul>
          <li>Always look for potential issues or contradictions in <code>MEMORY.md</code> before implementation.</li>
          <li>After implementation is complete, remove the related Implementation Plan from <code>MEMORY.md</code>.</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useConversationStore } from '../stores/conversation.store';
import { useProjectStore } from '../stores/project.store';
import { useAuthStore } from '../stores/auth.store';
import { usePlanStore } from '../stores/plan.store';
import MemoryViewer from '../components/project/MemoryViewer.vue';
import AgentsViewer from '../components/project/AgentsViewer.vue';

const conversationStore = useConversationStore();
const projectStore = useProjectStore();
const authStore = useAuthStore();
const planStore = usePlanStore();
const showAgentsReminder = ref(false);

const conversations = computed(() => conversationStore.conversations);
const projects = computed(() => projectStore.projects);

const pendingPlans = computed(() =>
  planStore.plans.filter((p) => p.status === 'pending_review'),
);

function conversationStateLabel(state: string): string {
  const labels: Record<string, string> = {
    active: 'Active',
    researching: 'Researching',
    planning: 'Planning',
    awaiting_approval: 'Awaiting Approval',
    closed: 'Closed',
  };

  return labels[state] ?? state;
}

function planStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: 'Draft',
    pending_review: 'Pending Review',
    approved: 'Approved',
    rejected: 'Rejected',
    revision_requested: 'Changes Requested',
    committed: 'Committed',
  };

  return labels[status] ?? status;
}

const recentConversations = computed(() =>
  [...conversationStore.conversations]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5),
);

onMounted(async () => {
  await projectStore.fetchProjects();
  await conversationStore.fetchConversations(projectStore.activeProject?.id);
  await planStore.fetchPlans(projectStore.activeProject?.id);
});
</script>
