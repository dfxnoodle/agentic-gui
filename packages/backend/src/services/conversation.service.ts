import type { Conversation, Message, ConversationState, CLIProvider } from '@agentic-gui/shared';
import { FileStore } from '../store/file-store.js';
import { getConversationsDir } from '../store/store-paths.js';
import { nanoid } from 'nanoid';

const store = new FileStore<Conversation>(getConversationsDir(), 'directory');

export const conversationService = {
  async getAll(userId?: string, projectId?: string): Promise<Conversation[]> {
    let all = await store.readAll();
    if (userId) all = all.filter((c) => c.userId === userId);
    if (projectId) all = all.filter((c) => c.projectId === projectId);
    return all;
  },

  async getById(id: string): Promise<Conversation | null> {
    return store.read(id);
  },

  async create(projectId: string, userId: string, cliProvider: CLIProvider, title?: string): Promise<Conversation> {
    const conversation: Conversation = {
      id: nanoid(),
      projectId,
      userId,
      title: title ?? 'New Conversation',
      state: 'active',
      cliProvider,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.write(conversation);
    return conversation;
  },

  async addMessage(conversationId: string, role: Message['role'], content: string, metadata?: Message['metadata']): Promise<Message> {
    const conversation = await store.read(conversationId);
    if (!conversation) throw Object.assign(new Error('Conversation not found'), { status: 404 });

    const message: Message = {
      id: nanoid(),
      role,
      content,
      metadata,
      timestamp: new Date().toISOString(),
    };

    conversation.messages.push(message);
    conversation.updatedAt = new Date().toISOString();

    // Auto-set title from first user message
    if (conversation.messages.filter((m) => m.role === 'user').length === 1 && role === 'user') {
      conversation.title = content.slice(0, 80) + (content.length > 80 ? '...' : '');
    }

    await store.write(conversation);
    return message;
  },

  async updateState(conversationId: string, state: ConversationState): Promise<void> {
    const conversation = await store.read(conversationId);
    if (!conversation) throw Object.assign(new Error('Conversation not found'), { status: 404 });

    conversation.state = state;
    conversation.updatedAt = new Date().toISOString();
    await store.write(conversation);
  },

  async updateMessageMetadata(
    conversationId: string,
    messageId: string,
    metadata: Message['metadata'],
  ): Promise<Message> {
    const conversation = await store.read(conversationId);
    if (!conversation) throw Object.assign(new Error('Conversation not found'), { status: 404 });

    const message = conversation.messages.find((m) => m.id === messageId);
    if (!message) throw Object.assign(new Error('Message not found'), { status: 404 });

    message.metadata = { ...(message.metadata ?? {}), ...(metadata ?? {}) };
    conversation.updatedAt = new Date().toISOString();
    await store.write(conversation);
    return message;
  },

  async delete(conversationId: string): Promise<boolean> {
    return store.delete(conversationId);
  },
};
