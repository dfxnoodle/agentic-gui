import { client } from './client';
import type { Conversation } from '@agentic-gui/shared';

export const conversationsApi = {
  async list(projectId?: string) {
    const { data } = await client.get<Conversation[]>('/conversations', {
      params: projectId ? { projectId } : undefined,
    });
    return data;
  },

  async get(id: string) {
    const { data } = await client.get<Conversation>(`/conversations/${id}`);
    return data;
  },

  async create(projectId: string, cliProvider: string, title?: string) {
    const { data } = await client.post<Conversation>('/conversations', { projectId, cliProvider, title });
    return data;
  },

  async sendMessage(
    conversationId: string,
    content: string,
    options?: { secondOpinionCliProvider?: string },
  ) {
    const { data } = await client.post(`/conversations/${conversationId}/messages`, {
      content,
      ...(options?.secondOpinionCliProvider
        ? { secondOpinionCliProvider: options.secondOpinionCliProvider }
        : {}),
    });
    return data;
  },

  async remove(id: string) {
    await client.delete(`/conversations/${id}`);
  },
};
