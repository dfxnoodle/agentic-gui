import type { Permission } from '../constants/roles.js';

export type UserRole = string;

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  displayName: string;
  createdAt: string;
}

export type PublicUser = Omit<User, 'passwordHash'>;

export interface AuthenticatedUser {
  userId: string;
  username: string;
  displayName: string;
  role: UserRole;
  roleName: string;
  permissions: Permission[];
  isAdmin: boolean;
}
