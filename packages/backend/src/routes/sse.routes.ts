import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { sseService } from '../services/sse.service.js';
import { conversationService } from '../services/conversation.service.js';
import type { AuthPayload } from '../middleware/auth.middleware.js';

export const sseRoutes = Router();

/**
 * SSE endpoint. Supports auth via:
 *   - Authorization: Bearer <token> header
 *   - ?token=<token> query parameter (for EventSource which doesn't support headers)
 */
sseRoutes.get('/:conversationId', async (req, res) => {
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

  const conversationId = req.params.conversationId as string;
  sseService.addClient(conversationId, res);

  // Send a catch-up state_change event so the client can sync isStreaming after a
  // reconnect. Without this, if the SSE connection drops between the last text event
  // and the state_change:active event, the frontend stays frozen with isStreaming=true.
  try {
    const conversation = await conversationService.getById(conversationId);
    if (conversation && (conversation.state === 'active' || conversation.state === 'awaiting_approval')) {
      sseService.send(conversationId, {
        type: 'state_change',
        conversationId,
        payload: { state: conversation.state },
      });
    }
  } catch (err) {
    console.error('[SSE] Failed to send catch-up state_change for conversation', conversationId, err);
  }
});
