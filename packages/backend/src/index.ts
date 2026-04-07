import express from 'express';
import cors from 'cors';
import type { Server } from 'node:http';
import { config } from './config.js';
import { errorMiddleware } from './middleware/error.middleware.js';
import { authRoutes } from './routes/auth.routes.js';
import { conversationRoutes } from './routes/conversations.routes.js';
import { planRoutes } from './routes/plans.routes.js';
import { projectRoutes } from './routes/projects.routes.js';
import { sseRoutes } from './routes/sse.routes.js';
import { adminRoutes } from './routes/admin.routes.js';
import { initDataDir } from './store/store-paths.js';
import { authService } from './services/auth.service.js';
import { permissionService } from './services/permission.service.js';
import { roleService } from './services/role.service.js';
import { validateRuntimeEnvironment } from './env.js';

const app = express();

app.use(cors({ origin: config.corsOrigin, credentials: true }));
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/events', sseRoutes);
app.use('/api/admin', adminRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Error handler (must be after routes)
app.use(errorMiddleware);

let server: Server;

async function start() {
  validateRuntimeEnvironment();
  await initDataDir();
  await roleService.init();
  await authService.ensureAdminExists();
  await permissionService.init();

  server = app.listen(config.port, () => {
    console.log(`Agentic GUI backend running on http://localhost:${config.port}`);
  });
}

function shutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  if (server) {
    server.close(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
    // Force exit after 10s if connections don't drain
    setTimeout(() => {
      console.warn('Forcing exit after timeout.');
      process.exit(1);
    }, 10000).unref();
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

export { app };
