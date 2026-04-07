import type { User, PublicUser } from '@agentic-gui/shared';
import { FileStore } from '../store/file-store.js';
import { getUsersPath } from '../store/store-paths.js';
import { nanoid } from 'nanoid';
import bcrypt from 'bcrypt';

const store = new FileStore<User>(getUsersPath(), 'single-file');

export const userService = {
  async getAll(): Promise<PublicUser[]> {
    const users = await store.readAll();
    return users.map(stripPassword);
  },

  async getById(id: string): Promise<PublicUser | null> {
    const user = await store.read(id);
    return user ? stripPassword(user) : null;
  },

  async getByUsername(username: string): Promise<User | null> {
    const users = await store.readAll();
    return users.find((u) => u.username === username) ?? null;
  },

  async create(username: string, password: string, role: User['role'], displayName: string): Promise<PublicUser> {
    const existing = await this.getByUsername(username);
    if (existing) throw Object.assign(new Error('Username already exists'), { status: 409 });

    const user: User = {
      id: nanoid(),
      username,
      passwordHash: await bcrypt.hash(password, 12),
      role,
      displayName,
      createdAt: new Date().toISOString(),
    };

    await store.write(user);
    return stripPassword(user);
  },

  async update(id: string, updates: Partial<Pick<User, 'role' | 'displayName'>>): Promise<PublicUser | null> {
    const user = await store.read(id);
    if (!user) return null;

    const updated = { ...user, ...updates };
    await store.write(updated);
    return stripPassword(updated);
  },

  async updateLogin(id: string, username: string, password: string): Promise<PublicUser | null> {
    const user = await store.read(id);
    if (!user) return null;

    const existing = await this.getByUsername(username);
    if (existing && existing.id !== id) {
      throw Object.assign(new Error('Username already exists'), { status: 409 });
    }

    const updated: User = {
      ...user,
      username,
      passwordHash: await bcrypt.hash(password, 12),
    };

    await store.write(updated);
    return stripPassword(updated);
  },

  async delete(id: string): Promise<boolean> {
    return store.delete(id);
  },

  async hasUsersWithRole(role: User['role']): Promise<boolean> {
    const users = await store.readAll();
    return users.some((user) => user.role === role);
  },

  async validatePassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  },

  async count(): Promise<number> {
    const users = await store.readAll();
    return users.length;
  },
};

function stripPassword(user: User): PublicUser {
  const { passwordHash: _, ...publicUser } = user;
  return publicUser;
}
