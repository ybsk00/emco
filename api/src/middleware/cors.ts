import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';

// 챗봇 전용 CORS — 화이트리스트 + iframe(Origin 없음) 허용
export function chatbotCors(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  if (origin && env.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  } else if (!origin) {
    res.setHeader('Access-Control-Allow-Origin', '*');
  } else if (!env.isProd) {
    // dev: 모든 origin 허용
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Session-Id');
  res.setHeader('Access-Control-Expose-Headers', 'X-Session-Id');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
}
