<template>
  <div class="chat-view">
    <aside class="conversation-sidebar">
      <div class="sidebar-header">
        <div class="sidebar-header-text">
          <h3>Conversations</h3>
          <p v-if="projectStore.activeProject" class="sidebar-project-hint">
            {{ projectStore.activeProject.name }}
          </p>
        </div>
        <button @click="startNewConversation" class="btn-small" :disabled="!projectStore.activeProject">
          + New
        </button>
      </div>
      <ul class="conversation-list">
        <li
          v-for="conv in conversations"
          :key="conv.id"
          :class="{ active: conv.id === activeId }"
          @click="selectConversation(conv.id)"
        >
          <div class="conv-info">
            <span class="conv-title">{{ conv.title }}</span>
            <span class="badge" :class="conv.state">{{ conversationStateLabel(conv.state) }}</span>
          </div>
          <button
            class="conv-delete"
            title="Delete conversation"
            @click.stop="handleDelete(conv.id)"
          >&times;</button>
        </li>
      </ul>
      <p v-if="!conversations.length" class="empty sidebar-empty">No conversations yet</p>
    </aside>

    <div class="chat-main">
      <template v-if="activeConversation">
        <div class="chat-active-bar" :title="chatContextTitle">
          <span class="chat-active-bar-group">
            <span class="chat-active-bar-label">Project</span>
            <span class="chat-active-bar-value">{{ conversationProjectName }}</span>
          </span>
          <span class="chat-active-bar-sep" aria-hidden="true">·</span>
          <span class="chat-active-bar-group">
            <span class="chat-active-bar-label">Assistant</span>
            <span class="chat-active-bar-engine">{{ assistantEngineLabel }}</span>
          </span>
        </div>
        <div class="chat-messages" ref="messagesContainer">
          <div
            v-for="msg in activeConversation.messages"
            :key="msg.id"
            class="message"
            :class="[msg.role, { 'second-opinion': msg.role === 'assistant' && msg.metadata?.secondOpinion }]"
          >
            <div class="message-role">
              {{ msg.role === 'assistant' ? assistantHeading(msg) : roleLabel(msg.role) }}
            </div>
            <div class="message-content" v-html="renderMarkdown(msg.content)"></div>

            <div
              v-if="msg.role === 'assistant' && !msg.metadata?.planId"
              class="message-actions"
            >
              <button
                class="btn-small btn-primary"
                :disabled="isStreaming || creatingPlanMessageId === msg.id"
                @click="handleCreatePlanFromMessage(msg)"
              >
                {{ creatingPlanMessageId === msg.id ? 'Asking AI to plan...' : 'Plan & Save' }}
              </button>
            </div>

            <!-- Inline plan card if this message generated a plan -->
            <div v-if="msg.metadata?.planId" class="inline-plan-card">
              <div class="plan-card-icon">📋</div>
              <div class="plan-card-body">
                <strong>Plan generated</strong>
                <p>A structured plan has been created from this response.</p>
              </div>
              <router-link :to="`/plans/${msg.metadata.planId}`" class="btn-small btn-primary">
                Review Plan
              </router-link>
            </div>
          </div>

          <!-- Pending plan notification from SSE -->
          <div v-if="pendingPlanId && !isStreaming" class="inline-plan-card standalone">
            <div class="plan-card-icon">📋</div>
            <div class="plan-card-body">
              <strong>New plan ready for review</strong>
              <p>The AI has generated an implementation plan. Review and approve it.</p>
            </div>
            <router-link :to="`/plans/${pendingPlanId}`" class="btn-small btn-primary">
              Review Plan
            </router-link>
          </div>

          <!-- Thinking / tool use indicator -->
          <div v-if="thinkingText && isStreaming" class="thinking-bar">
            <span class="thinking-dot"></span>
            <span class="thinking-label">{{ thinkingText }}</span>
          </div>

          <!-- Streaming response -->
          <div v-if="streamingContent" class="message assistant streaming">
            <div class="message-role">AI</div>
            <div class="message-content" v-html="renderMarkdown(streamingContent)"></div>
            <span class="typing-indicator"></span>
          </div>

          <!-- Waiting for AI with no content yet -->
          <div v-if="isStreaming && !streamingContent && !thinkingText" class="thinking-bar">
            <span class="thinking-dot"></span>
            <span class="thinking-label">Starting analysis...</span>
          </div>
        </div>

        <form @submit.prevent="handleSend" class="chat-input">
          <div class="chat-input-row">
            <textarea
              v-model="messageInput"
              placeholder="Describe your requirement, question, or idea..."
              rows="3"
              @keydown.enter.ctrl="handleSend"
              :disabled="isSending || isStreaming"
            ></textarea>
            <button type="submit" :disabled="!messageInput.trim() || isSending || isStreaming" class="btn-primary">
              {{ buttonLabel }}
            </button>
          </div>
          <div v-if="secondOpinionChoices.length" class="chat-second-opinion-row">
            <label class="chat-second-opinion-label">
              Second opinion
              <select
                v-model="secondOpinionCliProvider"
                class="chat-second-opinion-select"
                :disabled="isSending || isStreaming"
              >
                <option value="">None</option>
                <option v-for="p in secondOpinionChoices" :key="p" :value="p">
                  {{ CLI_DISPLAY_NAMES[p] }}
                </option>
              </select>
            </label>
            <span class="chat-second-opinion-hint">
              Runs after the primary assistant. Not used when the reply creates a plan awaiting approval.
            </span>
          </div>
        </form>
      </template>

      <div v-else class="no-conversation">
        <h3>Welcome to Agentic GUI</h3>
        <p>Select a conversation or start a new one to begin talking to your codebase.</p>
        <button
          @click="startNewConversation"
          class="btn-primary"
          :disabled="!projectStore.activeProject"
        >
          Start Conversation
        </button>
        <p v-if="!projectStore.activeProject" class="hint">
          Set up a project first in Settings.
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useConversationStore } from '../stores/conversation.store';
import { useProjectStore } from '../stores/project.store';
import { usePlanStore } from '../stores/plan.store';
import { useSSE } from '../composables/useSSE';
import { CLI_DISPLAY_NAMES, CLI_PROVIDERS } from '@agentic-gui/shared';
import type { CLIProvider, Message } from '@agentic-gui/shared';
import { marked } from 'marked';

const route = useRoute();
const router = useRouter();
const conversationStore = useConversationStore();
const projectStore = useProjectStore();
const planStore = usePlanStore();
const { isStreaming, thinkingText, pendingPlanId, connect, disconnect } = useSSE();

const messageInput = ref('');
const isSending = ref(false);
const messagesContainer = ref<HTMLElement | null>(null);
const secondOpinionCliProvider = ref<CLIProvider | ''>('');
const creatingPlanMessageId = ref<string | null>(null);

const conversations = computed(() => conversationStore.conversations);
const activeConversation = computed(() => conversationStore.activeConversation);
const activeId = computed(() => activeConversation.value?.id);
const streamingContent = computed(() => conversationStore.streamingContent);

const effectivePrimaryProvider = computed((): CLIProvider | undefined => {
  const pid = activeConversation.value?.projectId;
  const proj = projectStore.projects.find((p) => p.id === pid);
  return (proj?.cliProvider ?? activeConversation.value?.cliProvider) as CLIProvider | undefined;
});

const assistantEngineLabel = computed(() => {
  const p = effectivePrimaryProvider.value;
  if (!p) return '';
  return CLI_DISPLAY_NAMES[p] ?? p;
});

const secondOpinionChoices = computed(() => {
  const p = effectivePrimaryProvider.value;
  if (!p) return [] as CLIProvider[];
  return CLI_PROVIDERS.filter((x) => x !== p);
});

const conversationProjectName = computed(() => {
  const pid = activeConversation.value?.projectId;
  if (!pid) return '—';
  const match = projectStore.projects.find((p) => p.id === pid);
  return match?.name ?? pid;
});

const chatContextTitle = computed(() => {
  const engine = assistantEngineLabel.value || 'assistant';
  const proj = conversationProjectName.value;
  return `Conversation in project “${proj}”. ${engine} is the CLI for this thread; the exact model comes from that tool’s configuration.`;
});

const buttonLabel = computed(() => {
  if (isSending.value) return 'Sending...';
  if (isStreaming.value) return 'AI thinking...';
  return 'Send';
});

function roleLabel(role: string): string {
  if (role === 'user') return 'You';
  if (role === 'assistant') return 'AI';
  return 'System';
}

function assistantHeading(msg: Message): string {
  const meta = msg.metadata;
  const name = meta?.cliProvider ? CLI_DISPLAY_NAMES[meta.cliProvider] ?? meta.cliProvider : 'AI';
  if (meta?.secondOpinion) return `Second opinion · ${name}`;
  return name;
}

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

function renderMarkdown(content: string): string {
  return marked.parse(content, { async: false }) as string;
}

async function selectConversation(id: string) {
  router.push(`/chat/${id}`);
}

async function startNewConversation() {
  if (!projectStore.activeProject) return;
  const conv = await conversationStore.createConversation(
    projectStore.activeProject.id,
    projectStore.activeProject.cliProvider,
  );
  router.push(`/chat/${conv.id}`);
}

async function handleDelete(id: string) {
  await conversationStore.deleteConversation(id);
  if (activeId.value === id) {
    router.push('/chat');
  }
}

async function handleSend() {
  if (!messageInput.value.trim() || !activeConversation.value || isSending.value || isStreaming.value) return;

  const content = messageInput.value.trim();
  messageInput.value = '';
  isSending.value = true;

  try {
    const opt =
      secondOpinionCliProvider.value && secondOpinionCliProvider.value !== effectivePrimaryProvider.value
        ? { secondOpinionCliProvider: secondOpinionCliProvider.value }
        : undefined;
    await conversationStore.sendMessage(activeConversation.value.id, content, opt);
  } finally {
    isSending.value = false;
  }
}

async function handleCreatePlanFromMessage(msg: Message) {
  if (!activeConversation.value || msg.role !== 'assistant' || creatingPlanMessageId.value) return;
  creatingPlanMessageId.value = msg.id;

  try {
    await planStore.createFromMessage(activeConversation.value.id, msg.id);
  } catch (err) {
    console.error('Failed to create plan from message:', err);
  } finally {
    creatingPlanMessageId.value = null;
  }
}

function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
  });
}

// Load conversation when route changes; align header project with thread; refresh sidebar for that project
watch(
  () => route.params.id,
  async (id) => {
    if (id && typeof id === 'string') {
      if (!projectStore.projects.length) {
        await projectStore.fetchProjects();
      }
      await conversationStore.fetchConversation(id);
      const conv = conversationStore.activeConversation;
      if (conv) {
        const proj = projectStore.projects.find((p) => p.id === conv.projectId);
        if (proj && projectStore.activeProject?.id !== proj.id) {
          projectStore.setActiveProject(proj);
        }
        await conversationStore.fetchConversations(conv.projectId);
      }
      connect(id);
      scrollToBottom();
    } else {
      disconnect();
      conversationStore.clearActiveConversation();
    }
  },
  { immediate: true },
);

// Changing project in the header leaves an open thread from another project — return to chat home
watch(
  () => projectStore.activeProject?.id,
  (newId, oldId) => {
    if (!newId || !oldId || newId === oldId) return;
    const conv = conversationStore.activeConversation;
    if (conv && conv.projectId !== newId) {
      disconnect();
      conversationStore.clearActiveConversation();
      void router.push('/chat');
    }
  },
);

// Auto-scroll on new messages and streaming
watch(() => activeConversation.value?.messages.length, () => scrollToBottom());
watch(streamingContent, () => scrollToBottom());
watch(thinkingText, () => scrollToBottom());

watch(activeId, () => {
  secondOpinionCliProvider.value = '';
});

onMounted(async () => {
  await projectStore.fetchProjects();
  await conversationStore.fetchConversations(projectStore.activeProject?.id);
});

onUnmounted(() => disconnect());
</script>
