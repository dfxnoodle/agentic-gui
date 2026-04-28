import { ref } from 'vue';
import { useAuthStore } from '../stores/auth.store';
import { useConversationStore } from '../stores/conversation.store';
import { usePlanStore } from '../stores/plan.store';
import type { ConversationState, Message, SSEEnvelope, UnifiedEvent } from '@agentic-gui/shared';

const MAX_RECONNECT_DELAY = 30000;
const BASE_RECONNECT_DELAY = 1000;

export function useSSE() {
  const connected = ref(false);
  const isStreaming = ref(false);
  const thinkingText = ref('');
  const pendingPlanId = ref<string | null>(null);
  let eventSource: EventSource | null = null;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let currentConversationId: string | null = null;

  function connect(conversationId: string) {
    disconnect();
    currentConversationId = conversationId;
    reconnectAttempts = 0;
    _connect(conversationId);
  }

  function _connect(conversationId: string) {
    const authStore = useAuthStore();
    const url = `/api/events/${conversationId}?token=${encodeURIComponent(authStore.token ?? '')}`;
    eventSource = new EventSource(url);

    eventSource.onopen = () => {
      connected.value = true;
      reconnectAttempts = 0;
    };

    eventSource.onmessage = (event) => {
      try {
        const envelope = JSON.parse(event.data) as SSEEnvelope | { type: 'connected' };
        if ('type' in envelope && envelope.type === 'connected') return;
        handleEnvelope(envelope as SSEEnvelope);
      } catch {
        // Ignore non-JSON (heartbeats)
      }
    };

    eventSource.onerror = () => {
      connected.value = false;
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (!currentConversationId) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);

    const delay = Math.min(
      BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts),
      MAX_RECONNECT_DELAY,
    );
    reconnectAttempts++;

    reconnectTimer = setTimeout(() => {
      if (currentConversationId) {
        _connect(currentConversationId);
      }
    }, delay);
  }

  function handleEnvelope(envelope: SSEEnvelope) {
    const conversationStore = useConversationStore();
    const planStore = usePlanStore();

    if (envelope.type === 'cli_event') {
      const event = envelope.payload as UnifiedEvent;
      handleCLIEvent(event, conversationStore);
    } else if (envelope.type === 'state_change') {
      const payload = envelope.payload as {
        state: string;
        assistantMetadata?: Message['metadata'];
        message?: Message;
      };
      conversationStore.updateConversationState(envelope.conversationId, payload.state as ConversationState);
      if (payload.state === 'researching') {
        isStreaming.value = true;
        thinkingText.value = '';
        conversationStore.clearStreamingContent();
      } else if (payload.state === 'active' || payload.state === 'awaiting_approval') {
        if (conversationStore.streamingContent) {
          conversationStore.addAssistantMessage(
            conversationStore.streamingContent,
            payload.assistantMetadata,
          );
          conversationStore.clearStreamingContent();
        } else if (payload.message) {
          conversationStore.addMessage(payload.message);
        }
        isStreaming.value = false;
        thinkingText.value = '';
      }
    } else if (envelope.type === 'plan_update') {
      const payload = envelope.payload as Record<string, unknown>;
      planStore.handlePlanUpdate(payload);
      pendingPlanId.value = payload.status === 'pending_review'
        ? ((payload.planId as string) ?? null)
        : null;
    }
  }

  function handleCLIEvent(event: UnifiedEvent, conversationStore: ReturnType<typeof useConversationStore>) {
    switch (event.type) {
      case 'text':
        conversationStore.appendStreamingContent(event.content);
        thinkingText.value = '';
        break;

      case 'thinking':
        thinkingText.value = event.content;
        break;

      case 'tool_use':
        thinkingText.value = event.content;
        break;

      case 'tool_result':
        // Tool results are internal — don't show to non-tech users
        break;

      case 'progress':
        // Some providers emit "response complete" before persistence/state updates finish.
        thinkingText.value = /response complete/i.test(event.content)
          ? 'Finalizing response...'
          : event.content;
        break;

      case 'error':
        conversationStore.appendStreamingContent(`\n\n**Error:** ${event.content}`);
        isStreaming.value = false;
        break;

      case 'done':
        // Unblock input even if final state_change arrives late or gets dropped.
        isStreaming.value = false;
        thinkingText.value = '';
        break;
    }
  }

  function disconnect() {
    currentConversationId = null;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (eventSource) {
      eventSource.close();
      eventSource = null;
      connected.value = false;
      isStreaming.value = false;
      thinkingText.value = '';
    }
  }

  return { connected, isStreaming, thinkingText, pendingPlanId, connect, disconnect };
}
