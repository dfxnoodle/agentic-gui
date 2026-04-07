import type { Request, Response, NextFunction } from 'express';
import type { Permission } from '@agentic-gui/shared';
import { permissionService } from '../services/permission.service.js';

export function requirePermission(...permissions: Permission[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.auth) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const allowed = permissions.every((p) => permissionService.hasPermission(req.auth!.role, p));
    if (!allowed) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}
