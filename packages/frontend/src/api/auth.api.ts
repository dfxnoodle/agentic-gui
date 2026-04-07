import type { AuthenticatedUser } from '@agentic-gui/shared';
import { client } from './client';

export const authApi = {
  async login(username: string, password: string) {
    const { data } = await client.post('/auth/login', { username, password });
    return data as { token: string; user: AuthenticatedUser };
  },

  async me() {
    const { data } = await client.get('/auth/me');
    return data as AuthenticatedUser;
  },

  async register(payload: { username: string; password: string; role: string; displayName: string }) {
    const { data } = await client.post('/auth/register', payload);
    return data;
  },
};
