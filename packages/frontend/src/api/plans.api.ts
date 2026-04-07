import { client } from './client';
import type { Plan } from '@agentic-gui/shared';

export const plansApi = {
  async list(projectId?: string) {
    const params = projectId ? { projectId } : {};
    const { data } = await client.get<Plan[]>('/plans', { params });
    return data;
  },

  async get(id: string) {
    const { data } = await client.get<Plan>(`/plans/${id}`);
    return data;
  },

  async getByConversation(conversationId: string) {
    const { data } = await client.get<Plan[]>(`/plans/conversation/${conversationId}`);
    return data;
  },

  async createFromMessage(conversationId: string, messageId: string) {
    const { data } = await client.post<{ accepted: boolean }>('/plans/from-message', { conversationId, messageId });
    return data;
  },

  async approve(id: string) {
    const { data } = await client.post<Plan>(`/plans/${id}/approve`);
    return data;
  },

  async reject(id: string) {
    const { data } = await client.post<Plan>(`/plans/${id}/reject`);
    return data;
  },

  async requestChanges(id: string) {
    const { data } = await client.post<Plan>(`/plans/${id}/request-changes`);
    return data;
  },

  async forceCommit(id: string) {
    const { data } = await client.post<Plan>(`/plans/${id}/force-commit`);
    return data;
  },

  async remove(id: string) {
    await client.delete(`/plans/${id}`);
  },
};
