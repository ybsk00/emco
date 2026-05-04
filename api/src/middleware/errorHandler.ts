import type { ErrorRequestHandler, Request, Response, NextFunction, RequestHandler } from 'express';

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.code, message: err.message });
    return;
  }
  console.error('[errorHandler] unhandled:', err);
  res.status(500).json({ error: 'INTERNAL_ERROR', message: '서버 오류가 발생했습니다.' });
};
