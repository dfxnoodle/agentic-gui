import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';

export function errorMiddleware(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation error', details: err.issues });
    return;
  }
  console.error('Unhandled error:', err);
  const status = (err as { status?: number }).status ?? 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
  });
}
