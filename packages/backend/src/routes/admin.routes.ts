import { Router } from 'express';
import { z } from 'zod';
import { PERMISSIONS } from '@agentic-gui/shared';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/role.middleware.js';
import { userService } from '../services/user.service.js';
import { secretsService } from '../services/secrets.service.js';
import { permissionService } from '../services/permission.service.js';
import { roleService } from '../services/role.service.js';

export const adminRoutes = Router();
adminRoutes.use(authMiddleware);

adminRoutes.get('/users', requirePermission('manage_users'), async (_req, res, next) => {
  try {
    const users = await userService.getAll();
    res.json(users.map((user) => ({
      ...user,
      roleName: roleService.getRoleName(user.role),
    })));
  } catch (err) {
    next(err);
  }
});

const updateUserSchema = z.object({
  role: z.string().min(1).optional(),
  displayName: z.string().min(1).max(100).optional(),
});

adminRoutes.put('/users/:id', requirePermission('manage_users'), async (req, res, next) => {
  try {
    const updates = updateUserSchema.parse(req.body);
    if (updates.role && !roleService.hasRole(updates.role)) {
      res.status(400).json({ error: 'Role not found' });
      return;
    }
    const user = await userService.update(req.params.id as string, updates);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({
      ...user,
      roleName: roleService.getRoleName(user.role),
    });
  } catch (err) {
    next(err);
  }
});

adminRoutes.delete('/users/:id', requirePermission('manage_users'), async (req, res, next) => {
  try {
    if ((req.params.id as string) === req.auth!.userId) {
      res.status(400).json({ error: 'Cannot delete your own account' });
      return;
    }
    const deleted = await userService.delete(req.params.id as string);
    if (!deleted) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

const permissionSchema = z.enum(PERMISSIONS);

const createRoleSchema = z.object({
  name: z.string().min(1).max(100),
  permissions: z.array(permissionSchema),
});

const updateRoleSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  permissions: z.array(permissionSchema).optional(),
});

adminRoutes.get('/roles', requirePermission('manage_users'), async (_req, res, next) => {
  try {
    res.json(roleService.list());
  } catch (err) {
    next(err);
  }
});

adminRoutes.post('/roles', requirePermission('manage_users'), async (req, res, next) => {
  try {
    const payload = createRoleSchema.parse(req.body);
    const role = await roleService.createRole(payload);
    res.status(201).json(role);
  } catch (err) {
    next(err);
  }
});

adminRoutes.put('/roles/:id', requirePermission('manage_users'), async (req, res, next) => {
  try {
    const payload = updateRoleSchema.parse(req.body);
    const role = await roleService.updateRole(req.params.id as string, payload);
    if (!role) {
      res.status(404).json({ error: 'Role not found' });
      return;
    }
    res.json(role);
  } catch (err) {
    next(err);
  }
});

adminRoutes.delete('/roles/:id', requirePermission('manage_users'), async (req, res, next) => {
  try {
    const deleted = await roleService.deleteRole(req.params.id as string);
    if (!deleted) {
      res.status(404).json({ error: 'Role not found' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// --- CLI Config (API keys) ---

adminRoutes.get('/cli-config/keys', requirePermission('configure_cli'), async (_req, res, next) => {
  try {
    const masked = await secretsService.getMaskedKeys();
    res.json(masked);
  } catch (err) {
    next(err);
  }
});

const setKeySchema = z.object({
  provider: z.enum(['claude', 'codex', 'gemini', 'cursor']),
  apiKey: z.string().min(1),
});

adminRoutes.put('/cli-config/keys', requirePermission('configure_cli'), async (req, res, next) => {
  try {
    const { provider, apiKey } = setKeySchema.parse(req.body);
    await secretsService.setApiKey(provider, apiKey);
    const masked = await secretsService.getMaskedKeys();
    res.json(masked);
  } catch (err) {
    next(err);
  }
});

adminRoutes.delete('/cli-config/keys/:provider', requirePermission('configure_cli'), async (req, res, next) => {
  try {
    const provider = req.params.provider as string;
    await secretsService.deleteApiKey(provider);
    const masked = await secretsService.getMaskedKeys();
    res.json(masked);
  } catch (err) {
    next(err);
  }
});

// --- Provider Config (auth mode + fields) ---

adminRoutes.get('/cli-config/providers/:provider', requirePermission('configure_cli'), async (req, res, next) => {
  try {
    const provider = req.params.provider as string;
    const config = await secretsService.getProviderConfig(provider);
    if (!config) {
      res.json(null);
      return;
    }
    res.json(secretsService.getMaskedProviderConfig(config, provider));
  } catch (err) {
    next(err);
  }
});

const providerConfigSchema = z.object({
  authMode: z.string().min(1),
  fields: z.record(z.string(), z.string()),
});

adminRoutes.put('/cli-config/providers/:provider', requirePermission('configure_cli'), async (req, res, next) => {
  try {
    const provider = req.params.provider as string;
    const config = providerConfigSchema.parse(req.body);
    await secretsService.setProviderConfig(provider, config);
    const stored = await secretsService.getProviderConfig(provider);
    res.json(stored ? secretsService.getMaskedProviderConfig(stored, provider) : null);
  } catch (err) {
    next(err);
  }
});

adminRoutes.delete('/cli-config/providers/:provider', requirePermission('configure_cli'), async (req, res, next) => {
  try {
    const provider = req.params.provider as string;
    await secretsService.deleteApiKey(provider);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

const approvePlanPermissionsSchema = z.object({
  roles: z.array(z.string().min(1)),
});

adminRoutes.get('/permissions/approve-plan', requirePermission('manage_users'), async (_req, res, next) => {
  try {
    res.json({ roles: permissionService.getApprovePlanRoles() });
  } catch (err) {
    next(err);
  }
});

adminRoutes.put('/permissions/approve-plan', requirePermission('manage_users'), async (req, res, next) => {
  try {
    const { roles } = approvePlanPermissionsSchema.parse(req.body);
    const updatedRoles = await permissionService.setApprovePlanRoles(roles);
    res.json({ roles: updatedRoles });
  } catch (err) {
    next(err);
  }
});
