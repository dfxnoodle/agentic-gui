import { Router } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service.js';
import { userService } from '../services/user.service.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { requirePermission } from '../middleware/role.middleware.js';
import { roleService } from '../services/role.service.js';

export const authRoutes = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const registerSchema = z.object({
  username: z.string().min(3).max(30),
  password: z.string().min(6),
  role: z.string().min(1),
  displayName: z.string().min(1).max(100),
});

authRoutes.post('/login', async (req, res, next) => {
  try {
    const { username, password } = loginSchema.parse(req.body);
    const result = await authService.login(username, password);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

authRoutes.post('/register', authMiddleware, requirePermission('manage_users'), async (req, res, next) => {
  try {
    const { username, password, role, displayName } = registerSchema.parse(req.body);
    if (!roleService.hasRole(role)) {
      res.status(400).json({ error: 'Role not found' });
      return;
    }
    const user = await userService.create(username, password, role, displayName);
    res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

authRoutes.get('/me', authMiddleware, async (req, res) => {
  const user = await authService.getAuthenticatedUser(req.auth!.userId);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(user);
});
