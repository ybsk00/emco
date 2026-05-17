import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { env } from '../config/env.js';

const COOKIE_NAME = 'emco_admin';
const TTL_SECONDS = 24 * 60 * 60;

function hmacHex(payload: string): string {
  return crypto.createHmac('sha256', env.IP_HASH_SALT).update(payload).digest('hex');
}

export function safeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) {
    const pad = Buffer.alloc(Math.max(ab.length, bb.length));
    return crypto.timingSafeEqual(pad, pad) && false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

export function mintToken(): string {
  const exp = Date.now() + TTL_SECONDS * 1000;
  const payload = `v1.${exp}`;
  return `${payload}.${hmacHex(payload)}`;
}

function verifyToken(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expected = hmacHex(`v1.${parts[1]}`);
  if (expected.length !== parts[2].length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(parts[2], 'hex'));
  } catch {
    return false;
  }
}

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const p of header.split(';')) {
    const idx = p.indexOf('=');
    if (idx < 0) continue;
    const k = p.slice(0, idx).trim();
    if (k === name) return p.slice(idx + 1).trim();
  }
  return null;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const SESSION_TTL_SECONDS = TTL_SECONDS;

export function setSessionCookie(res: Response, token: string): void {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${TTL_SECONDS}`,
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0`,
  );
}

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) {
    res.status(503).json({ error: 'ADMIN_NOT_CONFIGURED', message: '어드민이 설정되지 않았습니다.' });
    return;
  }
  const token = parseCookie(req.headers.cookie, COOKIE_NAME);
  if (!token || !verifyToken(token)) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: '로그인이 필요합니다.' });
    return;
  }
  next();
}
