import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { supabase } from '../lib/supabase.js';
import { basicAuth } from '../middleware/basicAuth.js';
import { publicLimiter } from '../middleware/rateLimiter.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = Router();

// 모든 어드민 엔드포인트는 Basic Auth + 일반 rate limit
router.use(basicAuth);
router.use(publicLimiter);

// 캐시 금지 (Cloud Run/CDN/브라우저 모두)
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

// GET /api/admin/stats — 전체 대시보드 집계
router.get(
  '/stats',
  asyncHandler(async (_req: Request, res: Response) => {
    const { data, error } = await supabase.rpc('emco_admin_stats');
    if (error) {
      console.error('[admin/stats] rpc error:', error);
      throw new AppError(500, 'STATS_FAILED', '통계 조회 실패');
    }
    res.json(data ?? {});
  }),
);

// GET /api/admin/sessions?limit=50&before=<iso>
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().datetime().optional(),
});

router.get(
  '/sessions',
  asyncHandler(async (req: Request, res: Response) => {
    const { limit, before } = listQuery.parse(req.query);

    let query = supabase
      .from('emco_chat_sessions')
      .select('id, created_at, last_seen_at, ip_hash')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (before) {
      query = query.lt('created_at', before);
    }

    const { data: sessions, error } = await query;
    if (error) {
      console.error('[admin/sessions] sessions query:', error);
      throw new AppError(500, 'SESSIONS_FAILED', '세션 목록 조회 실패');
    }

    const items = sessions ?? [];
    const ids = items.map((s) => s.id);

    // 세션별 메시지 수 + 첫 user 메시지 (한 번에 가져와서 메모리에서 그룹화)
    type MsgRow = { session_id: string; role: string; content: string; created_at: string };
    const msgMap = new Map<string, { count: number; firstUserQuery: string | null }>();

    if (ids.length > 0) {
      const { data: msgs, error: msgErr } = await supabase
        .from('emco_chat_messages')
        .select('session_id, role, content, created_at')
        .in('session_id', ids)
        .order('created_at', { ascending: true });
      if (msgErr) {
        console.error('[admin/sessions] messages query:', msgErr);
      } else {
        for (const m of (msgs ?? []) as MsgRow[]) {
          const cur = msgMap.get(m.session_id) ?? { count: 0, firstUserQuery: null };
          cur.count += 1;
          if (cur.firstUserQuery === null && m.role === 'user') {
            cur.firstUserQuery = m.content.slice(0, 60);
          }
          msgMap.set(m.session_id, cur);
        }
      }
    }

    const result = items.map((s) => {
      const m = msgMap.get(s.id) ?? { count: 0, firstUserQuery: null };
      return {
        id: s.id,
        created_at: s.created_at,
        last_seen_at: s.last_seen_at,
        ip_hash_short: (s.ip_hash ?? '').slice(0, 4),
        message_count: m.count,
        first_user_query: m.firstUserQuery,
      };
    });

    const nextBefore = result.length === limit ? result[result.length - 1].created_at : null;

    res.json({ sessions: result, next_before: nextBefore });
  }),
);

// GET /api/admin/sessions/:id
router.get(
  '/sessions/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const id = z.string().uuid().parse(req.params.id);

    const { data: session, error: sErr } = await supabase
      .from('emco_chat_sessions')
      .select('id, ip_hash, user_agent, created_at, last_seen_at')
      .eq('id', id)
      .single();
    if (sErr || !session) {
      throw new AppError(404, 'SESSION_NOT_FOUND', '세션을 찾을 수 없습니다.');
    }

    const { data: messages, error: mErr } = await supabase
      .from('emco_chat_messages')
      .select('role, content, category, metadata, created_at')
      .eq('session_id', id)
      .order('created_at', { ascending: true });
    if (mErr) {
      throw new AppError(500, 'MESSAGES_FAILED', '메시지 조회 실패');
    }

    res.json({
      session: {
        id: session.id,
        ip_hash_short: (session.ip_hash ?? '').slice(0, 4),
        user_agent: session.user_agent,
        created_at: session.created_at,
        last_seen_at: session.last_seen_at,
      },
      messages: messages ?? [],
    });
  }),
);

export default router;
