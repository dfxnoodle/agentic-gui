import type { Request, Response, NextFunction } from 'express';

export function errorMiddleware(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error('Unhandled error:', err);
  const status = (err as { status?: number }).status ?? 500;
  res.status(status).json({
    error: err.message || 'Internal server error',
  });
}
