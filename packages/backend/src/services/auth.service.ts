import jwt, { type SignOptions } from 'jsonwebtoken';
import type { AuthenticatedUser, PublicUser } from '@agentic-gui/shared';
import { config } from '../config.js';
import { userService } from './user.service.js';
import type { AuthPayload } from '../middleware/auth.middleware.js';
import { roleService } from './role.service.js';

function toAuthenticatedUser(user: Pick<PublicUser, 'id' | 'username' | 'displayName' | 'role'>): AuthenticatedUser {
  return {
    userId: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    roleName: roleService.getRoleName(user.role),
    permissions: roleService.getPermissions(user.role),
    isAdmin: user.role === 'admin',
  };
}

export const authService = {
  async login(username: string, password: string): Promise<{ token: string; user: AuthenticatedUser }> {
    const user = await userService.getByUsername(username);
    if (!user) throw Object.assign(new Error('Invalid credentials'), { status: 401 });

    const valid = await userService.validatePassword(user, password);
    if (!valid) throw Object.assign(new Error('Invalid credentials'), { status: 401 });

    const payload: AuthPayload = {
      userId: user.id,
      username: user.username,
      role: user.role,
    };

    const token = jwt.sign(payload, config.jwtSecret, { expiresIn: '24h' } satisfies SignOptions);
    return { token, user: toAuthenticatedUser(user) };
  },

  async getAuthenticatedUser(userId: string): Promise<AuthenticatedUser | null> {
    const user = await userService.getById(userId);
    return user ? toAuthenticatedUser(user) : null;
  },

  /**
   * On first startup, create a default admin user if none exist.
   */
  async ensureAdminExists(): Promise<void> {
    const count = await userService.count();
    if (count === 0) {
      await userService.create(config.adminUsername, config.adminPassword, 'admin', 'Administrator');
      console.log(`Created default admin user from .env configuration (username: ${config.adminUsername})`);
      return;
    }

    const legacyAdmin = await userService.getByUsername('admin');
    if (!legacyAdmin) {
      return;
    }

    const usesLegacyPassword = await userService.validatePassword(legacyAdmin, 'admin');
    if (!usesLegacyPassword) {
      return;
    }

    await userService.updateLogin(legacyAdmin.id, config.adminUsername, config.adminPassword);
    console.warn(`Migrated legacy default admin account to .env configuration (username: ${config.adminUsername})`);
  },
};
