import { defineStore } from 'pinia';
import { ref } from 'vue';
import { conversationsApi } from '../api/conversations.api';
import type { Conversation, ConversationState, Message } from '@agentic-gui/shared';

export const useConversationStore = defineStore('conversation', () => {
  const conversations = ref<Conversation[]>([]);
  const activeConversation = ref<Conversation | null>(null);
  const loading = ref(false);
  const streamingContent = ref('');

  async function fetchConversations(projectId?: string) {
    loading.value = true;
    try {
      conversations.value = await conversationsApi.list(projectId);
    } finally {
      loading.value = false;
    }
  }

  function clearActiveConversation() {
    activeConversation.value = null;
  }

  async function fetchConversation(id: string) {
    loading.value = true;
    try {
      activeConversation.value = await conversationsApi.get(id);
    } finally {
      loading.value = false;
    }
  }

  async function sendMessage(
    conversationId: string,
    content: string,
    options?: { secondOpinionCliProvider?: string },
  ) {
    const message = await conversationsApi.sendMessage(conversationId, content, options);
    if (activeConversation.value?.id === conversationId) {
      activeConversation.value.messages.push(message as Message);
    }
    return message;
  }

  async function createConversation(projectId: string, cliProvider: string, title?: string) {
    const conversation = await conversationsApi.create(projectId, cliProvider, title);
    conversations.value.unshift(conversation);
    activeConversation.value = conversation;
    return conversation;
  }

  function appendStreamingContent(content: string) {
    streamingContent.value += content;
  }

  function clearStreamingContent() {
    streamingContent.value = '';
  }

  function addAssistantMessage(content: string, metadata?: Message['metadata']) {
    if (!activeConversation.value) return;
    const msg: Message = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content,
      metadata,
      timestamp: new Date().toISOString(),
    };
    activeConversation.value.messages.push(msg);
  }

  function updateConversationState(conversationId: string, state: ConversationState) {
    const conversation = conversations.value.find((item) => item.id === conversationId);
    if (conversation) {
      conversation.state = state;
      conversation.updatedAt = new Date().toISOString();
    }

    if (activeConversation.value?.id === conversationId) {
      activeConversation.value.state = state;
      activeConversation.value.updatedAt = new Date().toISOString();
    }
  }

  async function deleteConversation(id: string) {
    await conversationsApi.remove(id);
    conversations.value = conversations.value.filter((c) => c.id !== id);
    if (activeConversation.value?.id === id) {
      activeConversation.value = null;
    }
  }

  return {
    conversations,
    activeConversation,
    loading,
    streamingContent,
    fetchConversations,
    clearActiveConversation,
    fetchConversation,
    sendMessage,
    createConversation,
    deleteConversation,
    appendStreamingContent,
    clearStreamingContent,
    addAssistantMessage,
    updateConversationState,
  };
});
