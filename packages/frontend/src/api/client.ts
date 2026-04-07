import axios from 'axios';
import { useAuthStore } from '../stores/auth.store';

const client = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use((config) => {
  const authStore = useAuthStore();
  if (authStore.token) {
    config.headers.Authorization = `Bearer ${authStore.token}`;
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/login')) {
      const authStore = useAuthStore();
      authStore.logout();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export { client };
