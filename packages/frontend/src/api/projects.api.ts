import { client } from './client';
import type { Project } from '@agentic-gui/shared';

export const projectsApi = {
  async list() {
    const { data } = await client.get<Project[]>('/projects');
    return data;
  },

  async get(id: string) {
    const { data } = await client.get<Project>(`/projects/${id}`);
    return data;
  },

  async create(payload: { name: string; rootPath: string; cliProvider: string }) {
    const { data } = await client.post<Project>('/projects', payload);
    return data;
  },

  async update(
    id: string,
    payload: Partial<Pick<Project, 'name' | 'rootPath' | 'cliProvider' | 'cliConfig' | 'credentialPreference'>>,
  ) {
    const { data } = await client.put<Project>(`/projects/${id}`, payload);
    return data;
  },

  async remove(id: string) {
    await client.delete(`/projects/${id}`);
  },

  async getMemory(id: string) {
    const { data } = await client.get<{ content: string | null }>(`/projects/${id}/memory`);
    return data.content;
  },

  async getAgents(id: string) {
    const { data } = await client.get<{ content: string | null }>(`/projects/${id}/agents`);
    return data.content;
  },
};
