import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import type { UserRole } from '@agentic-gui/shared';

export interface AuthPayload {
  userId: string;
  username: string;
  role: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid authorization header' });
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret) as AuthPayload;
    req.auth = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
