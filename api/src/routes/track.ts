import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import { z } from 'zod';
import { env } from '../config/env.js';
import { supabase } from '../lib/supabase.js';
import { trackLimiter } from '../middleware/trackLimiter.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

const trackSchema = z.object({
  path: z.string().min(1).max(500),
  ref: z.string().max(500).nullable().optional(),
});

function hashIP(ip: string): string {
  return crypto.createHash('sha256').update(ip + env.IP_HASH_SALT).digest('hex').slice(0, 16);
}

function hashUA(ua: string): string {
  return crypto.createHash('sha256').update(ua.slice(0, 200)).digest('hex').slice(0, 16);
}

router.post(
  '/',
  trackLimiter,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = trackSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(204).end();
      return;
    }
    const { path, ref } = parsed.data;

    // 어드민 자체 방문은 카운트 제외
    if (path.startsWith('/console-')) {
      res.status(204).end();
      return;
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const ua = String(req.headers['user-agent'] || '');

    await supabase
      .from('emco_page_views')
      .insert({
        path,
        ip_hash: hashIP(ip),
        ua_hash: ua ? hashUA(ua) : null,
        referrer: ref ?? null,
      })
      .then(undefined, (e) => console.error('[/track] insert error:', e));

    res.status(204).end();
  }),
);

export default router;
