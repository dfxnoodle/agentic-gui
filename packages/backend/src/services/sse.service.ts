import { EventEmitter } from 'node:events';
import type { Response } from 'express';
import type { SSEEnvelope } from '@agentic-gui/shared';

class SSEService extends EventEmitter {
  private connections = new Map<string, Set<Response>>();

  addClient(conversationId: string, res: Response): void {
    if (!this.connections.has(conversationId)) {
      this.connections.set(conversationId, new Set());
    }
    this.connections.get(conversationId)!.add(res);

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // Send initial connected event
    res.write(`data: ${JSON.stringify({ type: 'connected', conversationId })}\n\n`);

    // Heartbeat every 30s
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 30000);

    // Cleanup on close
    res.on('close', () => {
      clearInterval(heartbeat);
      this.connections.get(conversationId)?.delete(res);
      if (this.connections.get(conversationId)?.size === 0) {
        this.connections.delete(conversationId);
      }
    });
  }

  send(conversationId: string, envelope: SSEEnvelope): void {
    const clients = this.connections.get(conversationId);
    if (!clients) return;

    const data = `data: ${JSON.stringify(envelope)}\n\n`;
    for (const client of clients) {
      client.write(data);
    }
  }

  broadcast(envelope: SSEEnvelope): void {
    this.send(envelope.conversationId, envelope);
  }
}

export const sseService = new SSEService();
