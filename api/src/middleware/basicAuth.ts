import type { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

function safeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    // 동일 길이로 만들어 timing leak 방지 후 비교 — 결과는 false
    const pad = Buffer.alloc(Math.max(ab.length, bb.length));
    return timingSafeEqual(pad, pad) && false;
  }
  return timingSafeEqual(ab, bb);
}

export function basicAuth(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) {
    res.status(503).json({ error: 'ADMIN_NOT_CONFIGURED', message: '어드민이 설정되지 않았습니다.' });
    return;
  }

  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="emco-admin", charset="UTF-8"');
    res.status(401).json({ error: 'UNAUTHORIZED', message: '인증이 필요합니다.' });
    return;
  }

  let decoded = '';
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    decoded = '';
  }
  const idx = decoded.indexOf(':');
  const user = idx >= 0 ? decoded.slice(0, idx) : '';
  const pass = idx >= 0 ? decoded.slice(idx + 1) : '';

  const userOk = safeCompare(user, env.ADMIN_USERNAME);
  const passOk = safeCompare(pass, env.ADMIN_PASSWORD);

  if (!(userOk && passOk)) {
    res.setHeader('WWW-Authenticate', 'Basic realm="emco-admin", charset="UTF-8"');
    res.status(401).json({ error: 'UNAUTHORIZED', message: '인증 실패' });
    return;
  }

  next();
}
