import path from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from '@playwright/test';

dotenv.config({ path: path.resolve(process.cwd(), '.env'), quiet: true });

const adminUsername = process.env.ADMIN_USERNAME ?? '';
const adminPassword = process.env.ADMIN_PASSWORD ?? '';
const backendPort = parseInt(process.env.PORT ?? '3001', 10);
const frontendPort = parseInt(process.env.FRONTEND_PORT ?? '5173', 10);

if (!adminUsername || !adminPassword) {
  throw new Error('Playwright requires ADMIN_USERNAME and ADMIN_PASSWORD in the root .env file.');
}

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${frontendPort}`,
    headless: true,
  },
  webServer: [
    {
      command: `DATA_DIR=/tmp/agentic-gui-e2e PORT=${backendPort} FRONTEND_PORT=${frontendPort} npx tsx packages/backend/src/index.ts`,
      port: backendPort,
      reuseExistingServer: false,
      timeout: 15000,
    },
    {
      command: 'npm run dev:frontend',
      port: frontendPort,
      reuseExistingServer: false,
      timeout: 15000,
    },
  ],
});
