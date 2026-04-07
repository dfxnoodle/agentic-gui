import path from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });

const frontendPort = parseInt(process.env.FRONTEND_PORT ?? '5173', 10);
const backendPort = parseInt(process.env.PORT ?? '3001', 10);

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: frontendPort,
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
    },
  },
});
