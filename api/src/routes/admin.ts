import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { db, Timestamp, COL, tsToIso } from '../lib/firestore.js';
import {
  adminAuth,
  mintToken,
  safeCompare,
  setSessionCookie,
  clearSessionCookie,
} from '../middleware/adminAuth.js';
import { publicLimiter, aiHeavyLimiter } from '../middleware/rateLimiter.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = Router();

// 캐시 금지 (Cloud Run/CDN/브라우저 모두) — 로그인/로그아웃 포함 전 엔드포인트
router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

// ── 로그인 (인증 없음) ───────────────────────────────────────
const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

router.post(
  '/login',
  aiHeavyLimiter, // brute-force 방지 (IP당 분당 30회)
  asyncHandler(async (req: Request, res: Response) => {
    if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) {
      throw new AppError(503, 'ADMIN_NOT_CONFIGURED', '어드민이 설정되지 않았습니다.');
    }
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError(401, 'UNAUTHORIZED', '아이디 또는 비밀번호가 올바르지 않습니다.');
    }
    const userOk = safeCompare(parsed.data.username, env.ADMIN_USERNAME);
    const passOk = safeCompare(parsed.data.password, env.ADMIN_PASSWORD);
    if (!(userOk && passOk)) {
      throw new AppError(401, 'UNAUTHORIZED', '아이디 또는 비밀번호가 올바르지 않습니다.');
    }
    setSessionCookie(res, mintToken());
    res.json({ ok: true });
  }),
);

// ── 로그아웃 (인증 필요 없음 — 어차피 쿠키 지움) ──────────────
router.post('/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ── 이하 모든 엔드포인트는 쿠키 세션 인증 필요 ────────────────
router.use(adminAuth);
router.use(publicLimiter);

// ── KST 날짜 유틸 ─────────────────────────────────────────────
const KST_MS = 9 * 60 * 60 * 1000;

// Date → 'YYYY-MM-DD' (KST 기준)
function kstDateStr(d: Date): string {
  return new Date(d.getTime() + KST_MS).toISOString().slice(0, 10);
}
// 'YYYY-MM-DD' KST 자정의 UTC 순간
function kstMidnightUtc(dateStr: string): Date {
  return new Date(new Date(dateStr + 'T00:00:00Z').getTime() - KST_MS);
}
// dateStr 에서 n일 가감한 'YYYY-MM-DD'
function addDays(dateStr: string, n: number): string {
  return new Date(new Date(dateStr + 'T00:00:00Z').getTime() + n * 86400000)
    .toISOString()
    .slice(0, 10);
}

// GET /api/admin/stats — 전체 대시보드 집계 (Firestore 읽기 → Node 집계, KST 기준)
router.get(
  '/stats',
  asyncHandler(async (_req: Request, res: Response) => {
    const now = new Date();
    const today = kstDateStr(now);
    const yesterday = addDays(today, -1);
    const start30 = addDays(today, -29); // 30일 구간 시작 (오늘 포함 30일)
    const start7 = addDays(today, -6); // 7일 구간 시작 (오늘 포함 7일)
    const range30Utc = kstMidnightUtc(start30);
    const week7Utc = kstMidnightUtc(start7);
    const todayUtc = kstMidnightUtc(today);

    // ── 방문자 (page_views 최근 30일 로드 후 집계) ──
    const pvSnap = await db
      .collection(COL.pageViews)
      .where('created_at', '>=', Timestamp.fromDate(range30Utc))
      .get();

    // 일별 unique(ip) Set + view count
    const dayUniq = new Map<string, Set<string>>();
    const dayViews = new Map<string, number>();
    const weekIps = new Set<string>();
    const monthIps = new Set<string>();
    for (const doc of pvSnap.docs) {
      const pv = doc.data();
      const created = pv.created_at?.toDate?.() as Date | undefined;
      if (!created) continue;
      const d = kstDateStr(created);
      const ip = String(pv.ip_hash ?? '');
      if (!dayUniq.has(d)) dayUniq.set(d, new Set());
      if (ip) dayUniq.get(d)!.add(ip);
      dayViews.set(d, (dayViews.get(d) ?? 0) + 1);
      if (ip) {
        monthIps.add(ip);
        if (created.getTime() >= week7Utc.getTime()) weekIps.add(ip);
      }
    }

    // 30일 시계열 (빈 날 0 채움)
    const daily30d: Array<{ date: string; unique: number; views: number }> = [];
    for (let i = 0; i < 30; i++) {
      const d = addDays(start30, i);
      daily30d.push({
        date: d,
        unique: dayUniq.get(d)?.size ?? 0,
        views: dayViews.get(d) ?? 0,
      });
    }

    // ── 챗봇 ──
    const sessionsTodaySnap = await db
      .collection(COL.sessions)
      .where('created_at', '>=', Timestamp.fromDate(todayUtc))
      .count()
      .get();
    const sessionsWeekSnap = await db
      .collection(COL.sessions)
      .where('created_at', '>=', Timestamp.fromDate(week7Utc))
      .count()
      .get();
    const messagesTodaySnap = await db
      .collection(COL.messages)
      .where('created_at', '>=', Timestamp.fromDate(todayUtc))
      .count()
      .get();

    // 주간 analytics 로드 → 평균 응답시간 / fallback 비율 / 카테고리 분포
    const anSnap = await db
      .collection(COL.analytics)
      .where('created_at', '>=', Timestamp.fromDate(week7Utc))
      .get();
    let respSum = 0;
    let respCount = 0;
    let fbTotal = 0;
    let fbCount = 0;
    const catCount = new Map<string, number>();
    for (const doc of anSnap.docs) {
      const a = doc.data();
      if (typeof a.response_time_ms === 'number' && a.response_time_ms > 0) {
        respSum += a.response_time_ms;
        respCount++;
      }
      fbTotal++;
      if (a.is_fallback) fbCount++;
      const cat = a.category;
      if (cat && cat !== 'general') catCount.set(cat, (catCount.get(cat) ?? 0) + 1);
    }
    const categoryDistribution = Array.from(catCount.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);

    res.json({
      visitors: {
        today: dayUniq.get(today)?.size ?? 0,
        yesterday: dayUniq.get(yesterday)?.size ?? 0,
        this_week: weekIps.size,
        this_month: monthIps.size,
        daily_30d: daily30d,
      },
      chat: {
        sessions_today: sessionsTodaySnap.data().count,
        sessions_week: sessionsWeekSnap.data().count,
        messages_today: messagesTodaySnap.data().count,
        avg_response_ms: respCount > 0 ? Math.round(respSum / respCount) : 0,
        fallback_rate: fbTotal > 0 ? Math.round((fbCount / fbTotal) * 1000) / 1000 : 0,
        category_distribution: categoryDistribution,
      },
    });
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

    let q = db.collection(COL.sessions).orderBy('created_at', 'desc').limit(limit);
    if (before) {
      q = db
        .collection(COL.sessions)
        .orderBy('created_at', 'desc')
        .startAfter(Timestamp.fromDate(new Date(before)))
        .limit(limit);
    }

    const snap = await q.get();
    const items = snap.docs.map((doc) => {
      const s = doc.data();
      return {
        id: doc.id,
        created_at: tsToIso(s.created_at),
        last_seen_at: tsToIso(s.last_seen_at),
        ip_hash: String(s.ip_hash ?? ''),
      };
    });
    const ids = items.map((s) => s.id);

    // 세션별 메시지 수 + 첫 user 메시지 (in 쿼리 30개씩 청크)
    const summary = new Map<string, { count: number; first: { t: number; c: string } | null }>();
    for (let i = 0; i < ids.length; i += 30) {
      const chunk = ids.slice(i, i + 30);
      if (chunk.length === 0) continue;
      const msgSnap = await db.collection(COL.messages).where('session_id', 'in', chunk).get();
      for (const doc of msgSnap.docs) {
        const m = doc.data();
        const sid = String(m.session_id);
        const cur = summary.get(sid) ?? { count: 0, first: null };
        cur.count += 1;
        if (m.role === 'user') {
          const t = m.created_at?.toMillis?.() ?? 0;
          if (!cur.first || t < cur.first.t) {
            cur.first = { t, c: String(m.content ?? '').slice(0, 60) };
          }
        }
        summary.set(sid, cur);
      }
    }

    const result = items.map((s) => {
      const m = summary.get(s.id) ?? { count: 0, first: null };
      return {
        id: s.id,
        created_at: s.created_at,
        last_seen_at: s.last_seen_at,
        ip_hash_short: s.ip_hash.slice(0, 4),
        message_count: m.count,
        first_user_query: m.first?.c ?? null,
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

    const doc = await db.collection(COL.sessions).doc(id).get();
    if (!doc.exists) {
      throw new AppError(404, 'SESSION_NOT_FOUND', '세션을 찾을 수 없습니다.');
    }
    const session = doc.data()!;

    const msgSnap = await db
      .collection(COL.messages)
      .where('session_id', '==', id)
      .orderBy('created_at', 'asc')
      .get();
    const messages = msgSnap.docs.map((m) => {
      const data = m.data();
      return {
        role: data.role,
        content: data.content,
        category: data.category ?? null,
        metadata: data.metadata ?? {},
        created_at: tsToIso(data.created_at),
      };
    });

    res.json({
      session: {
        id,
        ip_hash_short: String(session.ip_hash ?? '').slice(0, 4),
        user_agent: session.user_agent ?? null,
        created_at: tsToIso(session.created_at),
        last_seen_at: tsToIso(session.last_seen_at),
      },
      messages,
    });
  }),
);

export default router;
