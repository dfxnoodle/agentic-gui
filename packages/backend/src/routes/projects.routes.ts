import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/role.middleware.js';
import type { Project, CLIConfig } from '@agentic-gui/shared';
import { FileStore } from '../store/file-store.js';
import { getProjectsDir } from '../store/store-paths.js';
import { nanoid } from 'nanoid';
import { readProjectFile } from '../services/project-files.service.js';

const store = new FileStore<Project>(getProjectsDir(), 'directory');

export const projectRoutes = Router();
projectRoutes.use(authMiddleware);

const createSchema = z.object({
  name: z.string().min(1),
  rootPath: z.string().min(1),
  cliProvider: z.enum(['claude', 'codex', 'gemini', 'cursor', 'opencode']),
  credentialPreference: z.enum(['local_first', 'platform_only']).optional(),
});

projectRoutes.get('/', async (_req, res, next) => {
  try {
    const projects = await store.readAll();
    res.json(projects);
  } catch (err) {
    next(err);
  }
});

projectRoutes.get('/:id', async (req, res, next) => {
  try {
    const project = await store.read(req.params.id as string);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json(project);
  } catch (err) {
    next(err);
  }
});

projectRoutes.post('/', requirePermission('configure_projects'), async (req, res, next) => {
  try {
    const { name, rootPath, cliProvider, credentialPreference } = createSchema.parse(req.body);

    const defaultConfig: CLIConfig = {
      maxTurns: 10,
      maxRuntimeMs: 300000,
      watchdogTimeoutMs: 180000,
    };

    const project: Project = {
      id: nanoid(),
      name,
      rootPath,
      cliProvider,
      cliConfig: defaultConfig,
      createdAt: new Date().toISOString(),
      ...(credentialPreference !== undefined ? { credentialPreference } : {}),
    };

    await store.write(project);
    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  rootPath: z.string().min(1).optional(),
  cliProvider: z.enum(['claude', 'codex', 'gemini', 'cursor', 'opencode']).optional(),
  credentialPreference: z.enum(['local_first', 'platform_only']).optional(),
  cliConfig: z.object({
    maxTurns: z.number().min(1).max(50).optional(),
    maxRuntimeMs: z.number().min(10000).max(600000).optional(),
    watchdogTimeoutMs: z.number().min(10000).max(600000).optional(),
  }).optional(),
});

projectRoutes.put('/:id', requirePermission('configure_projects'), async (req, res, next) => {
  try {
    const project = await store.read(req.params.id as string);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    const updates = updateSchema.parse(req.body);
    if (updates.name) project.name = updates.name;
    if (updates.rootPath) project.rootPath = updates.rootPath;
    if (updates.cliProvider) project.cliProvider = updates.cliProvider;
    if (updates.credentialPreference !== undefined) {
      project.credentialPreference = updates.credentialPreference;
    }
    if (updates.cliConfig) {
      project.cliConfig = { ...project.cliConfig, ...updates.cliConfig };
    }

    await store.write(project);
    res.json(project);
  } catch (err) {
    next(err);
  }
});

projectRoutes.delete('/:id', requirePermission('configure_projects'), async (req, res, next) => {
  try {
    const id = req.params.id as string;
    const project = await store.read(id);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    await store.delete(id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

projectRoutes.get('/:id/memory', async (req, res, next) => {
  try {
    const project = await store.read(req.params.id as string);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const content = await readProjectFile(project.rootPath, 'MEMORY.md');
    res.json({ content });
  } catch (err) {
    next(err);
  }
});

projectRoutes.get('/:id/agents', async (req, res, next) => {
  try {
    const project = await store.read(req.params.id as string);
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    const content = await readProjectFile(project.rootPath, 'agents.md');
    res.json({ content });
  } catch (err) {
    next(err);
  }
});
