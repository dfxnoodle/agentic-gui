<template>
  <div class="plan-review" v-if="plan">
    <div class="plan-header">
      <div>
        <h2>{{ plan.title }}</h2>
        <p class="plan-meta">
          Version {{ plan.version }}
          <span class="badge" :class="plan.status">{{ statusLabel }}</span>
        </p>
      </div>
      <router-link v-if="plan.conversationId" :to="`/chat/${plan.conversationId}`" class="btn-small">
        Back to Chat
      </router-link>
    </div>

    <p v-if="actionError" class="error action-error">{{ actionError }}</p>

    <!-- Contradiction Alert -->
    <div v-if="plan.contradictions?.verdict === 'conflicts_found'" class="contradiction-alert">
      <h3>Conflicts Detected</h3>
      <p>The following conflicts were found with existing project decisions:</p>
      <div v-for="(conflict, i) in plan.contradictions.conflicts" :key="i" class="conflict-item">
        <div class="conflict-row">
          <div class="conflict-side">
            <strong>Existing Decision</strong>
            <p>{{ conflict.existingMemory }}</p>
          </div>
          <div class="conflict-arrow">vs</div>
          <div class="conflict-side">
            <strong>Proposed Change</strong>
            <p>{{ conflict.proposedChange }}</p>
          </div>
        </div>
        <p class="conflict-explanation">{{ conflict.explanation }}</p>
      </div>
      <div class="conflict-actions">
        <button @click="handleForceCommit" class="btn-primary btn-warning" :disabled="acting">
          Override and Commit Anyway
        </button>
        <button @click="handleDeleteChange" class="btn-small btn-danger" :disabled="acting">
          Delete Plan
        </button>
      </div>
    </div>

    <!-- Plan Summary -->
    <div class="plan-summary card">
      <h3>Summary</h3>
      <p>{{ plan.summary }}</p>
    </div>

    <!-- Plan Sections -->
    <div v-for="section in plan.sections" :key="section.heading" class="plan-section card">
      <h3>{{ section.heading }}</h3>
      <div class="section-body" v-html="renderMarkdown(section.body)"></div>
      <p v-if="section.estimatedEffort" class="effort-tag">
        Estimated effort: <strong>{{ section.estimatedEffort }}</strong>
      </p>
    </div>

    <!-- Version History -->
    <div v-if="allVersions.length > 1" class="plan-history card">
      <h3>Version History</h3>
      <ul>
        <li v-for="v in allVersions" :key="v.id" :class="{ current: v.id === plan.id }">
          <router-link :to="`/plans/${v.id}`">
            v{{ v.version }} — <span class="badge" :class="v.status">{{ v.status }}</span>
            <small>{{ formatDate(v.createdAt) }}</small>
          </router-link>
        </li>
      </ul>
    </div>

    <!-- Approval Bar -->
    <div v-if="plan.status === 'pending_review'" class="approval-bar">
      <button @click="handleApprove" class="btn-primary btn-success" :disabled="acting">
        {{ acting ? 'Processing...' : 'Approve Plan' }}
      </button>
      <button @click="handleReject" class="btn-primary btn-danger" :disabled="acting">
        Reject
      </button>
      <button @click="handleDeleteChange" class="btn-small btn-danger" :disabled="acting">
        Delete Plan
      </button>
    </div>

    <div v-if="plan.status === 'approved' && plan.contradictions?.verdict !== 'conflicts_found'" class="approved-recovery card">
      <p>This plan is approved but has not been committed to project memory yet.</p>
      <button @click="handleForceCommit" class="btn-primary btn-success" :disabled="acting">
        {{ acting ? 'Processing...' : 'Commit to MEMORY.md' }}
      </button>
    </div>

    <!-- Committed confirmation -->
    <div v-if="plan.status === 'committed'" class="committed-banner">
      Plan has been approved and committed to project memory (MEMORY.md).
    </div>
  </div>

  <div v-else-if="loading" class="plan-review">
    <p class="empty">Loading plan...</p>
  </div>

  <div v-else class="plan-review">
    <p class="empty">Plan not found.</p>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePlanStore } from '../stores/plan.store';
import { marked } from 'marked';

const route = useRoute();
const router = useRouter();
const planStore = usePlanStore();

const acting = ref(false);
const actionError = ref('');
const allVersions = ref<Array<{ id: string; version: number; status: string; createdAt: string }>>([]);

const plan = computed(() => planStore.activePlan);
const loading = computed(() => planStore.loading);

const statusLabel = computed(() => {
  const labels: Record<string, string> = {
    draft: 'Draft',
    pending_review: 'Pending Review',
    approved: 'Approved',
    rejected: 'Rejected',
    revision_requested: 'Changes Requested',
    committed: 'Committed',
  };
  return labels[plan.value?.status ?? ''] ?? plan.value?.status;
});

function renderMarkdown(content: string): string {
  return marked.parse(content, { async: false }) as string;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function handleApprove() {
  if (!plan.value) return;
  actionError.value = '';
  acting.value = true;
  try {
    await planStore.approve(plan.value.id);
  } catch (err) {
    actionError.value = getActionErrorMessage(err);
  } finally {
    acting.value = false;
  }
}

async function handleReject() {
  if (!plan.value) return;
  actionError.value = '';
  acting.value = true;
  try {
    await planStore.reject(plan.value.id);
  } catch (err) {
    actionError.value = getActionErrorMessage(err);
  } finally {
    acting.value = false;
  }
}

async function handleDeleteChange() {
  if (!plan.value) return;
  actionError.value = '';
  acting.value = true;
  const conversationId = plan.value.conversationId;
  try {
    await planStore.remove(plan.value.id);
    await router.push(conversationId ? `/chat/${conversationId}` : '/chat');
  } catch (err) {
    actionError.value = getActionErrorMessage(err);
  } finally {
    acting.value = false;
  }
}

async function handleForceCommit() {
  if (!plan.value) return;
  actionError.value = '';
  acting.value = true;
  try {
    await planStore.forceCommit(plan.value.id);
  } catch (err) {
    actionError.value = getActionErrorMessage(err);
  } finally {
    acting.value = false;
  }
}

function getActionErrorMessage(err: unknown): string {
  const responseError = err as { response?: { data?: { error?: string } }; message?: string };
  return responseError.response?.data?.error ?? responseError.message ?? 'Action failed.';
}

async function loadPlan(id: string) {
  await planStore.fetchPlan(id);
  if (plan.value) {
    const versions = await planStore.fetchByConversation(plan.value.conversationId);
    allVersions.value = versions
      .sort((a, b) => b.version - a.version)
      .map((v) => ({ id: v.id, version: v.version, status: v.status, createdAt: v.createdAt }));
  }
}

watch(() => route.params.id, (id) => {
  if (id && typeof id === 'string') loadPlan(id);
}, { immediate: true });
</script>
