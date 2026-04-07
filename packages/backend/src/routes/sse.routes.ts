import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { sseService } from '../services/sse.service.js';
import type { AuthPayload } from '../middleware/auth.middleware.js';

export const sseRoutes = Router();

/**
 * SSE endpoint. Supports auth via:
 *   - Authorization: Bearer <token> header
 *   - ?token=<token> query parameter (for EventSource which doesn't support headers)
 */
sseRoutes.get('/:conversationId', (req, res) => {
  // Try header first, then query param
  let token: string | undefined;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    token = header.slice(7);
  } else if (typeof req.query.token === 'string') {
    token = req.query.token;
  }

  if (!token) {
    res.status(401).json({ error: 'Missing authentication token' });
    return;
  }

  try {
    jwt.verify(token, config.jwtSecret) as AuthPayload;
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  sseService.addClient(req.params.conversationId as string, res);
});
