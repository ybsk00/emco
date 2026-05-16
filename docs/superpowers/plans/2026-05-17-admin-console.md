# 엠코 어드민 콘솔 — 구현 plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 외부 추측이 어려운 URL(`/console-e7m3k9p2/`)에서 Basic Auth로 보호되는 어드민 페이지를 띄워 홈페이지 방문자 추이와 챗봇 대화 로그를 한 화면에서 확인할 수 있게 한다.

**Architecture:** 기존 Cloud Run(Express+TS) + Firebase Hosting(정적) + Supabase 스택 유지. 신규 테이블 `emco_page_views` + 집계 RPC 1개. 백엔드는 `POST /api/track`(공개, rate-limited)과 Basic Auth로 보호된 `GET /api/admin/*` 추가. 프론트는 단일 페이지 SPA-스타일 어드민(vanilla JS, 차트는 SVG 자체 그리기).

**Tech Stack:** Express 4 + zod + Supabase JS + TypeScript ESM (TLA `dist/*.js` 임포트 패턴), Firebase Hosting rewrites, Postgres timestamptz + KST 일자 경계. 테스트 프레임워크 없음 → curl + 브라우저 수동 검증.

**Spec reference:** `docs/superpowers/specs/2026-05-17-admin-console-design.md`

---

## File Structure

**Create:**
- `supabase/migrations/20260517_002_emco_page_views.sql` — 테이블 + 집계 RPC
- `api/src/middleware/basicAuth.ts` — Basic Auth 미들웨어 (timingSafeEqual)
- `api/src/middleware/trackLimiter.ts` — `/api/track` 전용 rate limiter
- `api/src/routes/track.ts` — `POST /api/track` 라우터
- `api/src/routes/admin.ts` — `GET /api/admin/*` 라우터 (Basic Auth 적용)
- `public/console-e7m3k9p2/index.html` — 어드민 HTML 셸
- `public/console-e7m3k9p2/styles.css` — 어드민 전용 스타일
- `public/console-e7m3k9p2/app.js` — fetch + 차트 + 테이블 렌더

**Modify:**
- `api/src/config/env.ts` — `ADMIN_USERNAME`, `ADMIN_PASSWORD` 옵셔널 추가
- `api/src/server.ts` — track + admin 라우터 마운트
- `api/.env.example` — 두 키 추가
- `api/setup-gcp-secrets.ps1` — `emco-admin-user`, `emco-admin-pass` 추가
- `public/index.html` — `<head>` 끝에 추적 비콘
- `public/robots.txt` — `Disallow: /console-`
- `firebase.json` — `/console-**`에 `X-Robots-Tag: noindex, nofollow` 헤더
- `CLAUDE.md` — 어드민 정책 섹션 추가

---

## Task 1: DB 마이그레이션 — `emco_page_views` + 집계 RPC

**Files:**
- Create: `supabase/migrations/20260517_002_emco_page_views.sql`

- [ ] **Step 1: 마이그레이션 SQL 작성**

`supabase/migrations/20260517_002_emco_page_views.sql`:
```sql
-- 엠코 어드민 콘솔용 — 방문자 추적 테이블 + 집계 RPC

-- 1) 방문자 페이지뷰
create table if not exists public.emco_page_views (
  id         uuid primary key default gen_random_uuid(),
  path       text not null,
  ip_hash    text,
  ua_hash    text,
  referrer   text,
  created_at timestamptz not null default now()
);

create index if not exists emco_page_views_created_at_idx
  on public.emco_page_views (created_at desc);

create index if not exists emco_page_views_ip_day_idx
  on public.emco_page_views (ip_hash, created_at);

-- 2) 어드민 대시보드 집계 RPC — 한 호출로 모든 지표 반환 (KST 기준)
create or replace function public.emco_admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today_kst date;
  result    jsonb;
begin
  today_kst := (now() at time zone 'Asia/Seoul')::date;

  with daily as (
    select
      ((created_at at time zone 'Asia/Seoul')::date) as d,
      count(distinct ip_hash)                         as uniq,
      count(*)                                        as views
    from emco_page_views
    where created_at >= ((today_kst - interval '29 days')::timestamp at time zone 'Asia/Seoul')
    group by 1
  ),
  daily_series as (
    select to_char(generate_series(today_kst - 29, today_kst, interval '1 day')::date, 'YYYY-MM-DD') as date_str,
           generate_series(today_kst - 29, today_kst, interval '1 day')::date                         as d
  ),
  daily_full as (
    select s.date_str,
           coalesce(d.uniq,  0) as uniq,
           coalesce(d.views, 0) as views
    from daily_series s
    left join daily d on d.d = s.d
  ),
  weekly_unique as (
    select count(distinct ip_hash) as cnt
    from emco_page_views
    where created_at >= ((today_kst - 6)::timestamp at time zone 'Asia/Seoul')
  ),
  monthly_unique as (
    select count(distinct ip_hash) as cnt
    from emco_page_views
    where created_at >= ((today_kst - 29)::timestamp at time zone 'Asia/Seoul')
  ),
  week_analytics as (
    select * from emco_chat_analytics
    where (created_at at time zone 'Asia/Seoul')::date >= today_kst - 6
  ),
  category as (
    select category, count(*) as cnt
    from week_analytics
    where category is not null and category <> 'general'
    group by 1
    order by 2 desc
  )
  select jsonb_build_object(
    'visitors', jsonb_build_object(
      'today',      (select uniq from daily_full where date_str = to_char(today_kst, 'YYYY-MM-DD')),
      'yesterday',  (select uniq from daily_full where date_str = to_char(today_kst - 1, 'YYYY-MM-DD')),
      'this_week',  (select cnt from weekly_unique),
      'this_month', (select cnt from monthly_unique),
      'daily_30d',  (select coalesce(jsonb_agg(jsonb_build_object('date', date_str, 'unique', uniq, 'views', views) order by date_str), '[]'::jsonb) from daily_full)
    ),
    'chat', jsonb_build_object(
      'sessions_today',  (select count(*) from emco_chat_sessions where (created_at at time zone 'Asia/Seoul')::date = today_kst),
      'sessions_week',   (select count(*) from emco_chat_sessions where (created_at at time zone 'Asia/Seoul')::date >= today_kst - 6),
      'messages_today',  (select count(*) from emco_chat_messages where (created_at at time zone 'Asia/Seoul')::date = today_kst),
      'avg_response_ms', (select coalesce(round(avg(response_time_ms))::int, 0) from week_analytics),
      'fallback_rate',   (
        select case when count(*) = 0 then 0
                    else round((count(*) filter (where is_fallback))::numeric / count(*)::numeric * 1000) / 1000.0
               end
        from week_analytics
      ),
      'category_distribution', (
        select coalesce(jsonb_agg(jsonb_build_object('category', category, 'count', cnt)), '[]'::jsonb)
        from category
      )
    )
  ) into result;

  return result;
end;
$$;
```

- [ ] **Step 2: Supabase MCP로 마이그레이션 적용**

`mcp__supabase__apply_migration` 호출:
- `project_id`: `wltqkxesvtfwotcngzjj`
- `name`: `emco_page_views`
- `query`: 위 SQL 전체

또는 Supabase 대시보드 SQL Editor에서 직접 실행.

- [ ] **Step 3: 적용 확인**

`mcp__supabase__list_tables` 호출 → `emco_page_views` 존재 확인.

또는:
```
mcp__supabase__execute_sql with query: "select count(*) from emco_page_views"
```
Expected: `0` (빈 테이블)

```
mcp__supabase__execute_sql with query: "select emco_admin_stats()"
```
Expected: `visitors`/`chat` 키를 가진 JSON 객체. `today=0`, `daily_30d`는 30개 항목.

- [ ] **Step 4: Commit**

```
git add supabase/migrations/20260517_002_emco_page_views.sql
git commit -m "feat(db): add emco_page_views + emco_admin_stats RPC"
```

---

## Task 2: env.ts — 어드민 자격증명 추가

**Files:**
- Modify: `api/src/config/env.ts`

- [ ] **Step 1: 스키마에 두 옵셔널 필드 추가**

`api/src/config/env.ts` 의 `schema` 객체에 추가 (마지막 필드 뒤):
```ts
  ADMIN_USERNAME: z.string().min(1).optional(),
  ADMIN_PASSWORD: z.string().min(1).optional(),
```

전체 schema는 이렇게 됨:
```ts
const schema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),

  GEMINI_API_KEY: z.string().min(10),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),

  CORS_ORIGIN: z.string().default(''),
  IP_HASH_SALT: z.string().min(16).default('emco-default-salt-change-me'),

  ADMIN_USERNAME: z.string().min(1).optional(),
  ADMIN_PASSWORD: z.string().min(1).optional(),
});
```

- [ ] **Step 2: typecheck 확인**

```
cd api && npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 3: .env.example 업데이트**

`api/.env.example` 마지막 줄 뒤에 추가:
```
# Admin console (Basic Auth — /console-e7m3k9p2/)
ADMIN_USERNAME=emcoadmin
ADMIN_PASSWORD=admin1234
```

- [ ] **Step 4: 로컬 .env에도 동일 키 추가**

`api/.env` (gitignored) 에 추가:
```
ADMIN_USERNAME=emcoadmin
ADMIN_PASSWORD=admin1234
```

- [ ] **Step 5: Commit**

```
git add api/src/config/env.ts api/.env.example
git commit -m "feat(api): add ADMIN_USERNAME/PASSWORD env vars"
```

---

## Task 3: Basic Auth 미들웨어

**Files:**
- Create: `api/src/middleware/basicAuth.ts`

- [ ] **Step 1: 미들웨어 작성**

`api/src/middleware/basicAuth.ts`:
```ts
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
```

- [ ] **Step 2: typecheck**

```
cd api && npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```
git add api/src/middleware/basicAuth.ts
git commit -m "feat(api): add basicAuth middleware with timing-safe compare"
```

---

## Task 4: `/api/track` 라우터 + 전용 rate limiter

**Files:**
- Create: `api/src/middleware/trackLimiter.ts`
- Create: `api/src/routes/track.ts`

- [ ] **Step 1: 전용 limiter 작성**

`api/src/middleware/trackLimiter.ts`:
```ts
import rateLimit from 'express-rate-limit';

// 방문자 비콘 — IP당 1분에 30회 (광고차단/봇 막기보다는 폭주 방지 목적)
export const trackLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  // 비콘은 응답을 보지 않으므로 메시지 무의미하지만 일관성 위해 둠
  message: { error: 'RATE_LIMIT_EXCEEDED' },
});
```

- [ ] **Step 2: track 라우터 작성**

`api/src/routes/track.ts`:
```ts
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
```

- [ ] **Step 3: typecheck**

```
cd api && npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 4: Commit**

```
git add api/src/middleware/trackLimiter.ts api/src/routes/track.ts
git commit -m "feat(api): add POST /api/track visitor beacon"
```

---

## Task 5: `/api/admin/stats` 라우터

**Files:**
- Create: `api/src/routes/admin.ts`

- [ ] **Step 1: admin 라우터 초기 버전 — stats만**

`api/src/routes/admin.ts`:
```ts
import { Router, type Request, type Response } from 'express';
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

export default router;
```

- [ ] **Step 2: typecheck**

```
cd api && npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```
git add api/src/routes/admin.ts
git commit -m "feat(api): add GET /api/admin/stats"
```

---

## Task 6: `/api/admin/sessions` 목록

**Files:**
- Modify: `api/src/routes/admin.ts`

- [ ] **Step 1: sessions 목록 엔드포인트 추가**

`api/src/routes/admin.ts` 의 stats 핸들러 아래에 추가 (`export default` 위):
```ts
import { z } from 'zod';

// 위 import 들에 z 가 이미 없으면 상단에 추가

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
```

만약 `z`가 파일 상단에 없으면 import에 추가:
```ts
import { z } from 'zod';
```

- [ ] **Step 2: typecheck**

```
cd api && npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```
git add api/src/routes/admin.ts
git commit -m "feat(api): add GET /api/admin/sessions with cursor pagination"
```

---

## Task 7: `/api/admin/sessions/:id` 상세

**Files:**
- Modify: `api/src/routes/admin.ts`

- [ ] **Step 1: 세션 상세 엔드포인트 추가**

`api/src/routes/admin.ts` 의 sessions 핸들러 아래에 추가:
```ts
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
```

- [ ] **Step 2: typecheck**

```
cd api && npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 3: Commit**

```
git add api/src/routes/admin.ts
git commit -m "feat(api): add GET /api/admin/sessions/:id detail"
```

---

## Task 8: server.ts에 두 라우터 마운트

**Files:**
- Modify: `api/src/server.ts`

- [ ] **Step 1: 라우터 import + mount 추가**

`api/src/server.ts` 의 import 블록에 추가:
```ts
import trackRouter from './routes/track.js';
import adminRouter from './routes/admin.js';
```

`patientChatbotRouter` 마운트 아래에 추가:
```ts
app.use('/api/track', trackRouter);
app.use('/api/admin', adminRouter);
```

수정 후 server.ts 전체:
```ts
import express from 'express';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import patientChatbotRouter from './routes/patientChatbot.js';
import trackRouter from './routes/track.js';
import adminRouter from './routes/admin.js';

const app = express();

app.use(express.json({ limit: '256kb' }));
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'emco-chatbot-api', ts: new Date().toISOString() });
});

app.use('/api/patient-chatbot', patientChatbotRouter);
app.use('/api/track', trackRouter);
app.use('/api/admin', adminRouter);

app.use(errorHandler);

const port = env.PORT;
app.listen(port, '0.0.0.0', () => {
  console.log(`[emco-chatbot-api] listening on :${port} (${env.NODE_ENV})`);
});
```

- [ ] **Step 2: typecheck**

```
cd api && npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 3: 로컬 dev 서버 기동 + 라우트 확인**

터미널 A:
```
cd api && npm run dev
```
Expected: `[emco-chatbot-api] listening on :8080 (development)` (또는 production)

터미널 B:
```powershell
curl.exe -i http://localhost:8080/health
```
Expected: 200 + `{"status":"ok",...}`

```powershell
curl.exe -i -X POST -H "Content-Type: application/json" -d '{"path":"/"}' http://localhost:8080/api/track
```
Expected: `204 No Content`. dev 서버 로그에 에러 없음.

```powershell
curl.exe -i http://localhost:8080/api/admin/stats
```
Expected: `401 Unauthorized` + 헤더 `WWW-Authenticate: Basic realm="emco-admin", charset="UTF-8"`.

```powershell
curl.exe -i -u "emcoadmin:admin1234" http://localhost:8080/api/admin/stats
```
Expected: `200` + JSON: `{"visitors":{"today":...,"daily_30d":[...]},"chat":{...}}`.

```powershell
curl.exe -i -u "wrong:bad" http://localhost:8080/api/admin/stats
```
Expected: `401`.

- [ ] **Step 4: Commit**

dev 서버 종료(Ctrl+C). 커밋:
```
git add api/src/server.ts
git commit -m "feat(api): mount /api/track and /api/admin routers"
```

---

## Task 9: 방문자 비콘 — `public/index.html`

**Files:**
- Modify: `public/index.html`

- [ ] **Step 1: `<head>` 끝부분에 비콘 스크립트 추가**

기존 `<head>` 안 적당한 위치 (다른 인라인 스크립트 근처, `</head>` 직전)에 추가:
```html
<!-- 방문자 추적 비콘 — /console-* 경로는 서버에서 무시됨 -->
<script>
  (function () {
    try {
      var body = JSON.stringify({
        path: location.pathname,
        ref: document.referrer || null,
      });
      var blob = new Blob([body], { type: 'application/json' });
      navigator.sendBeacon('/api/track', blob);
    } catch (e) {}
  })();
</script>
```

위치 결정 팁: 기존 `<meta>` 태그들이 끝나는 지점, 다른 `<script>` 블록 옆. 이 스크립트는 실패해도 페이지 동작에 영향 없으므로 `defer` 불필요.

- [ ] **Step 2: 로컬에서 검증 (선택사항 — dev API가 떠있을 때만)**

`public/index.html`을 브라우저로 직접 열어도 `sendBeacon('/api/track')`은 `file://` 컨텍스트라 작동하지 않음. 검증은 Task 16 배포 후 진행.

여기서는 HTML 문법만 확인 — Firefox/Chrome에서 파일 열어 콘솔 에러 없음 확인.

- [ ] **Step 3: Commit**

```
git add public/index.html
git commit -m "feat(web): add visitor beacon to /api/track"
```

---

## Task 10: 어드민 콘솔 HTML 셸

**Files:**
- Create: `public/console-e7m3k9p2/index.html`

- [ ] **Step 1: HTML 작성**

`public/console-e7m3k9p2/index.html`:
```html
<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>엠코 어드민</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <header class="adm-header">
    <h1>엠코 어드민</h1>
    <div class="adm-header-right">
      <span id="last-updated" class="adm-muted">—</span>
      <button id="refresh-btn" class="adm-btn">새로고침</button>
    </div>
  </header>

  <main class="adm-main">
    <section class="adm-section">
      <h2>방문자</h2>
      <div class="adm-card-row" id="visitor-cards">
        <div class="adm-card" data-key="today"><div class="adm-card-label">오늘</div><div class="adm-card-value">—</div><div class="adm-card-sub"></div></div>
        <div class="adm-card" data-key="yesterday"><div class="adm-card-label">어제</div><div class="adm-card-value">—</div><div class="adm-card-sub"></div></div>
        <div class="adm-card" data-key="this_week"><div class="adm-card-label">이번 주</div><div class="adm-card-value">—</div><div class="adm-card-sub"></div></div>
        <div class="adm-card" data-key="this_month"><div class="adm-card-label">이번 달</div><div class="adm-card-value">—</div><div class="adm-card-sub"></div></div>
      </div>
      <div class="adm-chart-wrap">
        <div class="adm-chart-title">최근 30일 일별 방문자 (유니크)</div>
        <svg id="daily-chart" viewBox="0 0 800 200" preserveAspectRatio="none" role="img" aria-label="30일 방문자 차트"></svg>
      </div>
    </section>

    <section class="adm-section">
      <h2>챗봇</h2>
      <div class="adm-card-row" id="chat-cards">
        <div class="adm-card"><div class="adm-card-label">오늘 세션</div><div class="adm-card-value" data-key="sessions_today">—</div></div>
        <div class="adm-card"><div class="adm-card-label">주간 세션</div><div class="adm-card-value" data-key="sessions_week">—</div></div>
        <div class="adm-card"><div class="adm-card-label">평균 응답시간</div><div class="adm-card-value" data-key="avg_response_ms">—</div></div>
        <div class="adm-card"><div class="adm-card-label">Fallback 비율</div><div class="adm-card-value" data-key="fallback_rate">—</div></div>
      </div>
      <div class="adm-chart-wrap">
        <div class="adm-chart-title">카테고리 분포 (주간)</div>
        <div id="category-bars" class="adm-bars"></div>
      </div>
    </section>

    <section class="adm-section">
      <h2>최근 챗봇 세션</h2>
      <div class="adm-table-wrap">
        <table class="adm-table" id="sessions-table">
          <thead>
            <tr><th>시각</th><th>메시지 수</th><th>IP</th><th>첫 질문</th></tr>
          </thead>
          <tbody id="sessions-tbody"></tbody>
        </table>
        <button id="load-more-btn" class="adm-btn adm-btn-secondary" hidden>더 보기</button>
      </div>
    </section>
  </main>

  <div id="session-modal" class="adm-modal" hidden>
    <div class="adm-modal-backdrop" data-close></div>
    <div class="adm-modal-panel">
      <header class="adm-modal-header">
        <h3 id="modal-title">세션</h3>
        <button class="adm-btn" data-close>닫기</button>
      </header>
      <div id="modal-meta" class="adm-modal-meta"></div>
      <div id="modal-messages" class="adm-modal-messages"></div>
    </div>
  </div>

  <script src="./app.js" defer></script>
</body>
</html>
```

- [ ] **Step 2: 브라우저에서 셸만 확인**

`public/console-e7m3k9p2/index.html`을 파일로 직접 열어 (styles.css/app.js 없음 → 스타일 없는 상태) 구조 확인. 모든 섹션 헤더가 보이고 콘솔 에러 없으면 OK (404 styles.css/app.js 는 다음 Task에서 채움).

- [ ] **Step 3: Commit**

```
git add public/console-e7m3k9p2/index.html
git commit -m "feat(admin): add admin console HTML shell"
```

---

## Task 11: 어드민 콘솔 CSS

**Files:**
- Create: `public/console-e7m3k9p2/styles.css`

- [ ] **Step 1: CSS 작성**

`public/console-e7m3k9p2/styles.css`:
```css
:root {
  --bg: #ffffff;
  --surface: #f7f8fa;
  --border: #e5e7eb;
  --text: #111827;
  --muted: #6b7280;
  --accent: #2563eb;
  --accent-soft: #dbeafe;
  --danger: #dc2626;
  --shadow: 0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04);
  --radius: 10px;
  --font: 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--surface); color: var(--text); font-family: var(--font); font-size: 14px; }

.adm-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 16px 24px; background: var(--bg); border-bottom: 1px solid var(--border);
}
.adm-header h1 { margin: 0; font-size: 18px; font-weight: 700; }
.adm-header-right { display: flex; align-items: center; gap: 12px; }
.adm-muted { color: var(--muted); font-size: 12px; }

.adm-btn {
  border: 1px solid var(--border); background: var(--bg); color: var(--text);
  padding: 6px 12px; border-radius: 6px; cursor: pointer; font-family: inherit; font-size: 13px;
}
.adm-btn:hover { background: var(--accent-soft); border-color: var(--accent); }
.adm-btn-secondary { margin-top: 12px; }

.adm-main { max-width: 1100px; margin: 0 auto; padding: 24px; display: flex; flex-direction: column; gap: 24px; }

.adm-section { background: var(--bg); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); padding: 20px; }
.adm-section h2 { margin: 0 0 16px; font-size: 15px; font-weight: 700; color: var(--text); }

.adm-card-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
.adm-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; }
.adm-card-label { color: var(--muted); font-size: 12px; margin-bottom: 6px; }
.adm-card-value { font-size: 24px; font-weight: 700; color: var(--text); }
.adm-card-sub { font-size: 11px; color: var(--muted); margin-top: 2px; min-height: 14px; }

.adm-chart-wrap { margin-top: 8px; }
.adm-chart-title { font-size: 12px; color: var(--muted); margin-bottom: 8px; }
#daily-chart { width: 100%; height: 200px; background: var(--surface); border-radius: 6px; }

.adm-bars { display: flex; flex-direction: column; gap: 6px; }
.adm-bar-row { display: grid; grid-template-columns: 90px 1fr 40px; align-items: center; gap: 8px; font-size: 12px; }
.adm-bar-track { background: var(--surface); border-radius: 4px; height: 16px; overflow: hidden; }
.adm-bar-fill { background: var(--accent); height: 100%; }
.adm-bar-row .adm-bar-count { text-align: right; color: var(--muted); }

.adm-table-wrap { overflow-x: auto; }
.adm-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.adm-table th, .adm-table td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); }
.adm-table th { font-weight: 600; color: var(--muted); font-size: 12px; background: var(--surface); }
.adm-table tbody tr { cursor: pointer; }
.adm-table tbody tr:hover { background: var(--accent-soft); }
.adm-table td.adm-q { color: var(--muted); max-width: 480px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.adm-modal { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 50; }
.adm-modal[hidden] { display: none !important; }
.adm-modal-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.4); }
.adm-modal-panel { position: relative; background: var(--bg); border-radius: var(--radius); width: min(720px, 92vw); max-height: 84vh; display: flex; flex-direction: column; box-shadow: 0 20px 40px rgba(0,0,0,0.2); }
.adm-modal-header { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--border); }
.adm-modal-header h3 { margin: 0; font-size: 15px; }
.adm-modal-meta { padding: 12px 18px; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--border); display: flex; flex-wrap: wrap; gap: 14px; }
.adm-modal-messages { padding: 16px 18px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
.adm-msg { max-width: 80%; padding: 10px 14px; border-radius: 12px; font-size: 13px; line-height: 1.5; white-space: pre-wrap; word-break: break-word; }
.adm-msg.user { align-self: flex-end; background: var(--accent-soft); }
.adm-msg.assistant { align-self: flex-start; background: var(--surface); border: 1px solid var(--border); }
.adm-msg-meta { font-size: 10px; color: var(--muted); margin-top: 4px; }

@media (max-width: 720px) {
  .adm-card-row { grid-template-columns: repeat(2, 1fr); }
  .adm-table th:nth-child(3), .adm-table td:nth-child(3) { display: none; }
}
```

- [ ] **Step 2: 브라우저에서 셸 + 스타일 확인**

`public/console-e7m3k9p2/index.html` 파일을 브라우저로 직접 열기. 카드와 섹션이 회색 배경 위에 흰 카드로 정렬되어 보이는지 확인. 폰트는 Pretendard 미설치 시 시스템 폰트 fallback.

- [ ] **Step 3: Commit**

```
git add public/console-e7m3k9p2/styles.css
git commit -m "feat(admin): add admin console styles"
```

---

## Task 12: 어드민 콘솔 JS — 데이터 fetch + 방문자 섹션 렌더

**Files:**
- Create: `public/console-e7m3k9p2/app.js`

- [ ] **Step 1: app.js 작성 — fetch + 방문자 렌더**

`public/console-e7m3k9p2/app.js`:
```js
(function () {
  'use strict';

  const fmtInt = (n) => (typeof n === 'number' ? n.toLocaleString('ko-KR') : '—');
  const fmtPct = (r) => (typeof r === 'number' ? (r * 100).toFixed(1) + '%' : '—');
  const fmtMs = (ms) => (typeof ms === 'number' && ms > 0 ? (ms / 1000).toFixed(2) + 's' : '—');
  const fmtTime = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso);
    const pad = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  async function fetchJson(url) {
    const r = await fetch(url, { credentials: 'same-origin' });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      throw new Error(`${r.status} ${url}: ${t.slice(0, 200)}`);
    }
    return r.json();
  }

  function renderVisitors(v) {
    const cards = document.querySelectorAll('#visitor-cards .adm-card');
    const keys = ['today', 'yesterday', 'this_week', 'this_month'];
    cards.forEach((card) => {
      const key = card.dataset.key;
      if (!keys.includes(key)) return;
      const value = v && typeof v[key] === 'number' ? v[key] : 0;
      card.querySelector('.adm-card-value').textContent = fmtInt(value);
    });
    drawDailyChart(v && Array.isArray(v.daily_30d) ? v.daily_30d : []);
  }

  function drawDailyChart(series) {
    const svg = document.getElementById('daily-chart');
    if (!svg) return;
    svg.innerHTML = '';
    if (!series.length) return;

    const W = 800, H = 200, pad = { l: 30, r: 10, t: 10, b: 24 };
    const maxU = Math.max(1, ...series.map((d) => d.unique || 0));
    const stepX = (W - pad.l - pad.r) / Math.max(1, series.length - 1);
    const yFor = (u) => H - pad.b - ((u / maxU) * (H - pad.t - pad.b));

    // 축선
    const axis = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    axis.setAttribute('x1', pad.l); axis.setAttribute('y1', H - pad.b);
    axis.setAttribute('x2', W - pad.r); axis.setAttribute('y2', H - pad.b);
    axis.setAttribute('stroke', '#e5e7eb'); axis.setAttribute('stroke-width', '1');
    svg.appendChild(axis);

    // y축 max 라벨
    const ymax = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    ymax.setAttribute('x', 4); ymax.setAttribute('y', pad.t + 10);
    ymax.setAttribute('font-size', '10'); ymax.setAttribute('fill', '#6b7280');
    ymax.textContent = String(maxU);
    svg.appendChild(ymax);

    // 라인
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    const points = series.map((d, i) => `${pad.l + i * stepX},${yFor(d.unique || 0)}`).join(' ');
    path.setAttribute('points', points);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#2563eb');
    path.setAttribute('stroke-width', '2');
    svg.appendChild(path);

    // 점 + 툴팁용 title
    series.forEach((d, i) => {
      const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', pad.l + i * stepX);
      c.setAttribute('cy', yFor(d.unique || 0));
      c.setAttribute('r', '2.5');
      c.setAttribute('fill', '#2563eb');
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      t.textContent = `${d.date} · 유니크 ${d.unique || 0} · 뷰 ${d.views || 0}`;
      c.appendChild(t);
      svg.appendChild(c);
    });

    // x축 라벨 — 첫/중간/마지막 3개만
    [0, Math.floor(series.length / 2), series.length - 1].forEach((i) => {
      if (i < 0 || i >= series.length) return;
      const lbl = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      lbl.setAttribute('x', pad.l + i * stepX);
      lbl.setAttribute('y', H - 6);
      lbl.setAttribute('font-size', '10');
      lbl.setAttribute('fill', '#6b7280');
      lbl.setAttribute('text-anchor', i === 0 ? 'start' : i === series.length - 1 ? 'end' : 'middle');
      lbl.textContent = (series[i].date || '').slice(5);
      svg.appendChild(lbl);
    });
  }

  function renderLastUpdated() {
    const el = document.getElementById('last-updated');
    if (el) el.textContent = '갱신: ' + fmtTime(new Date().toISOString());
  }

  // 이후 Task 13에서 chat/sessions 추가
  async function loadStats() {
    try {
      const data = await fetchJson('/api/admin/stats');
      renderVisitors(data && data.visitors);
      renderLastUpdated();
      // chat 섹션은 Task 13에서 채움
      window.__adminStats = data;
    } catch (e) {
      console.error('[admin] stats load failed:', e);
    }
  }

  document.getElementById('refresh-btn').addEventListener('click', loadStats);
  loadStats();
})();
```

- [ ] **Step 2: 로컬 dev 서버 + Firebase emulator 띄워 검증**

터미널 A:
```
cd api && npm run dev
```

터미널 B:
```
firebase emulators:start --only hosting
```
Expected: `Hosting Emulator at http://localhost:5000` (또는 :5002).

브라우저에서 `http://localhost:5000/console-e7m3k9p2/` 열기. Basic Auth 팝업 → `emcoadmin` / `admin1234` 입력. 방문자 카드 4개에 `0` (또는 적재된 만큼) 표시되고, 30일 차트 영역에 0 라인이 그려져야 함.

만약 Firebase emulator의 `run:` rewrite가 로컬 Cloud Run을 모르면 별도 설정 필요. 그 경우 emulator 대신 `firebase deploy --only hosting` 후 prod에서 검증 (Task 16에서 진행).

대안: `public/console-e7m3k9p2/app.js`의 fetch URL을 임시로 `http://localhost:8080/api/admin/stats`로 수정 후 CORS 허용은 chatbotCors가 처리(`*` allow) — 검증 후 원복.

- [ ] **Step 3: Commit**

```
git add public/console-e7m3k9p2/app.js
git commit -m "feat(admin): wire admin console — stats fetch and visitor chart"
```

---

## Task 13: 어드민 콘솔 JS — 챗봇 섹션 + 세션 목록 + 모달

**Files:**
- Modify: `public/console-e7m3k9p2/app.js`

- [ ] **Step 1: 챗봇 섹션 렌더 함수 추가**

`app.js` 의 `renderVisitors` 함수 아래(또는 `loadStats` 위)에 추가:
```js
  function renderChat(c) {
    if (!c) c = {};
    document.querySelectorAll('#chat-cards .adm-card-value').forEach((el) => {
      const key = el.dataset.key;
      if (key === 'avg_response_ms') {
        el.textContent = fmtMs(c.avg_response_ms);
      } else if (key === 'fallback_rate') {
        el.textContent = fmtPct(c.fallback_rate);
      } else {
        el.textContent = fmtInt(c[key]);
      }
    });

    const bars = document.getElementById('category-bars');
    bars.innerHTML = '';
    const cats = Array.isArray(c.category_distribution) ? c.category_distribution : [];
    const maxC = Math.max(1, ...cats.map((x) => x.count || 0));
    if (cats.length === 0) {
      bars.innerHTML = '<div class="adm-muted">데이터 없음</div>';
      return;
    }
    cats.forEach((x) => {
      const row = document.createElement('div');
      row.className = 'adm-bar-row';
      row.innerHTML = `
        <div>${x.category}</div>
        <div class="adm-bar-track"><div class="adm-bar-fill" style="width: ${((x.count || 0) / maxC * 100).toFixed(1)}%"></div></div>
        <div class="adm-bar-count">${fmtInt(x.count || 0)}</div>
      `;
      bars.appendChild(row);
    });
  }
```

`loadStats` 함수 안 `renderVisitors` 호출 다음 줄에 추가:
```js
      renderChat(data && data.chat);
```

- [ ] **Step 2: 세션 목록 + "더 보기" + 행 클릭 모달**

`app.js` 마지막의 IIFE 닫는 `})();` 직전(또는 `loadStats` 호출 전)에 추가:
```js
  let sessionsCursor = null;

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function appendSessionRows(items) {
    const tbody = document.getElementById('sessions-tbody');
    items.forEach((s) => {
      const tr = document.createElement('tr');
      tr.dataset.id = s.id;
      tr.innerHTML = `
        <td>${escapeHtml(fmtTime(s.created_at))}</td>
        <td>${fmtInt(s.message_count)}</td>
        <td>${escapeHtml(s.ip_hash_short || '—')}</td>
        <td class="adm-q">${escapeHtml(s.first_user_query || '—')}</td>
      `;
      tr.addEventListener('click', () => openSessionModal(s.id));
      tbody.appendChild(tr);
    });
  }

  async function loadSessions(initial) {
    try {
      const url = '/api/admin/sessions?limit=50' + (sessionsCursor && !initial ? '&before=' + encodeURIComponent(sessionsCursor) : '');
      const data = await fetchJson(url);
      if (initial) document.getElementById('sessions-tbody').innerHTML = '';
      appendSessionRows(data.sessions || []);
      sessionsCursor = data.next_before;
      const btn = document.getElementById('load-more-btn');
      btn.hidden = !sessionsCursor;
    } catch (e) {
      console.error('[admin] sessions load failed:', e);
    }
  }

  async function openSessionModal(id) {
    try {
      const data = await fetchJson('/api/admin/sessions/' + encodeURIComponent(id));
      document.getElementById('modal-title').textContent = '세션 ' + id.slice(0, 8);
      const meta = document.getElementById('modal-meta');
      meta.innerHTML = `
        <div>시작: ${escapeHtml(fmtTime(data.session.created_at))}</div>
        <div>마지막: ${escapeHtml(fmtTime(data.session.last_seen_at))}</div>
        <div>IP: ${escapeHtml(data.session.ip_hash_short || '—')}</div>
        <div>UA: ${escapeHtml((data.session.user_agent || '').slice(0, 80))}</div>
      `;
      const wrap = document.getElementById('modal-messages');
      wrap.innerHTML = '';
      (data.messages || []).forEach((m) => {
        const div = document.createElement('div');
        div.className = 'adm-msg ' + (m.role === 'user' ? 'user' : 'assistant');
        div.innerHTML = `
          ${escapeHtml(m.content || '')}
          <div class="adm-msg-meta">${escapeHtml(fmtTime(m.created_at))}${m.category ? ' · ' + escapeHtml(m.category) : ''}</div>
        `;
        wrap.appendChild(div);
      });
      document.getElementById('session-modal').hidden = false;
    } catch (e) {
      console.error('[admin] session detail failed:', e);
    }
  }

  document.querySelectorAll('#session-modal [data-close]').forEach((el) => {
    el.addEventListener('click', () => { document.getElementById('session-modal').hidden = true; });
  });

  document.getElementById('load-more-btn').addEventListener('click', () => loadSessions(false));

  // refresh-btn 핸들러 보강 — sessions도 함께 리로드
  document.getElementById('refresh-btn').addEventListener('click', () => {
    sessionsCursor = null;
    loadSessions(true);
  });

  // 초기 로드
  loadSessions(true);
```

주의: `refresh-btn` 핸들러는 Task 12에서 이미 `loadStats` 호출하도록 등록됨. 위 코드를 추가하면 두 번째 리스너로 sessions도 리로드 → 둘 다 실행되어 OK.

- [ ] **Step 3: 로컬에서 전체 페이지 검증**

Task 12에서 만들어둔 dev 서버 + emulator(또는 prod 임시 fetch) 환경에서 페이지 재로딩. 챗봇 카드 4개와 카테고리 바, 최근 세션 테이블이 모두 채워지고, 세션 행 클릭 시 모달이 열려 메시지가 보이는지 확인. ESC/배경 클릭으로 닫히는지(여기선 닫기 버튼/배경만 지원) 확인.

- [ ] **Step 4: Commit**

```
git add public/console-e7m3k9p2/app.js
git commit -m "feat(admin): chat metrics, session list with pagination and detail modal"
```

---

## Task 14: robots.txt + firebase.json noindex 헤더

**Files:**
- Modify: `public/robots.txt`
- Modify: `firebase.json`

- [ ] **Step 1: robots.txt 에 Disallow 추가**

`public/robots.txt` 의 첫 `User-agent: *` 블록 안 `Disallow: /api/` 줄 아래에 추가:
```
Disallow: /console-
```

(다른 User-agent 블록은 어차피 `/console-*` 명시 안 되어 있으므로 와일드카드 `*`만으로 충분. 명시적이려면 Yeti/Daum/Googlebot/Bingbot 블록에도 동일 추가.)

수정 후 일부 발췌:
```
User-agent: *
Allow: /
Disallow: /api/
Disallow: /console-
```

- [ ] **Step 2: firebase.json 에 X-Robots-Tag 헤더 추가**

`firebase.json` 의 `headers` 배열에 항목 추가 (다른 헤더들 옆):
```json
{
  "source": "/console-**",
  "headers": [
    { "key": "X-Robots-Tag", "value": "noindex, nofollow" },
    { "key": "Cache-Control", "value": "no-store, no-cache, must-revalidate, private" }
  ]
}
```

- [ ] **Step 3: JSON 문법 확인**

PowerShell:
```
Get-Content firebase.json -Raw | ConvertFrom-Json | Out-Null; "OK"
```
Expected: `OK` 출력. 에러 시 위 추가 JSON 위치/콤마 점검.

- [ ] **Step 4: Commit**

```
git add public/robots.txt firebase.json
git commit -m "chore(seo): block /console-* from indexing (robots.txt + X-Robots-Tag)"
```

---

## Task 15: setup-gcp-secrets.ps1 + 시크릿 등록

**Files:**
- Modify: `api/setup-gcp-secrets.ps1`

- [ ] **Step 1: 스크립트의 secretMap 에 두 항목 추가**

`api/setup-gcp-secrets.ps1` 의 `$secretMap` 배열을:
```powershell
$secretMap = @(
  [PSCustomObject]@{ Name = "emco-supabase-key"; Key = "SUPABASE_SERVICE_ROLE_KEY" }
  [PSCustomObject]@{ Name = "emco-gemini-key";   Key = "GEMINI_API_KEY" }
  [PSCustomObject]@{ Name = "emco-ip-salt";      Key = "IP_HASH_SALT" }
  [PSCustomObject]@{ Name = "emco-admin-user";   Key = "ADMIN_USERNAME" }
  [PSCustomObject]@{ Name = "emco-admin-pass";   Key = "ADMIN_PASSWORD" }
)
```

스크립트 상단 주석도 갱신:
```powershell
<#
  엠코 챗봇 — GCP Secret Manager 등록 헬퍼

  api/.env 에서 키를 읽어 다음 시크릿을 생성합니다 (이미 있으면 새 버전 추가):
    - emco-supabase-key  ← SUPABASE_SERVICE_ROLE_KEY
    - emco-gemini-key    ← GEMINI_API_KEY
    - emco-ip-salt       ← IP_HASH_SALT
    - emco-admin-user    ← ADMIN_USERNAME
    - emco-admin-pass    ← ADMIN_PASSWORD
#>
```

- [ ] **Step 2: 스크립트 실행 → 시크릿 등록**

```powershell
cd api
.\setup-gcp-secrets.ps1 -Project emco-8a3b5
```
Expected: `[emco-admin-user] create new ... OK (9 chars)` 및 `[emco-admin-pass] create new ... OK (9 chars)` 출력. 마지막에 `emco-` 시크릿 목록 표 출력 (5개 항목).

- [ ] **Step 3: Cloud Run에 시크릿 주입 (배포는 아직 — Task 16에서)**

이번 step에서는 **명령만 메모**해두고 실행은 Task 16에서. 메모 명령:
```
gcloud run services update emco-chatbot-api `
  --region=asia-northeast3 `
  --update-secrets=ADMIN_USERNAME=emco-admin-user:latest,ADMIN_PASSWORD=emco-admin-pass:latest
```

- [ ] **Step 4: Commit**

```
git add api/setup-gcp-secrets.ps1
git commit -m "chore(secrets): register emco-admin-user/pass to GCP Secret Manager"
```

---

## Task 16: 빌드 + 배포 + 운영 검증

**Files:** (변경 없음)

- [ ] **Step 1: 백엔드 로컬 빌드**

```
cd api
npm run build
```
Expected: 에러 없이 `dist/` 갱신. (CLAUDE.md 함정 #2 — Cloud Build TS 컴파일 우회 위해 로컬 빌드 필수.)

- [ ] **Step 2: 백엔드 Cloud Run 배포**

```
cd api
gcloud builds submit --config cloudbuild.yaml .
```
Expected: `SUCCESS`. Cloud Run 새 revision 활성화.

- [ ] **Step 3: Cloud Run에 어드민 시크릿 주입**

```
gcloud run services update emco-chatbot-api `
  --region=asia-northeast3 `
  --update-secrets=ADMIN_USERNAME=emco-admin-user:latest,ADMIN_PASSWORD=emco-admin-pass:latest
```
Expected: revision 업데이트 + `Service [emco-chatbot-api] revision ... has been deployed`.

- [ ] **Step 4: 프론트 배포**

```
firebase deploy --only hosting
```
Expected: `Deploy complete!` + 라이브 URL 출력.

- [ ] **Step 5: 프로덕션 검증 — 비콘**

브라우저로 `https://emcokids.co.kr/` 새 시크릿 탭에서 열기 (캐시 영향 제거). DevTools Network 탭에서 `track` 요청이 보이고 상태가 204 인지 확인.

Supabase MCP:
```
mcp__supabase__execute_sql with query: "select count(*) from emco_page_views where created_at > now() - interval '5 minutes'"
```
Expected: `>= 1`.

```
mcp__supabase__execute_sql with query: "select path, count(*) from emco_page_views group by 1 order by 2 desc limit 5"
```
Expected: `path='/'`(또는 비콘이 보낸 경로). `/console-*` 행 **없음** 확인 (어드민 자체는 카운트 안 됨).

- [ ] **Step 6: 프로덕션 검증 — 어드민 페이지**

브라우저로 `https://emcokids.co.kr/console-e7m3k9p2/` 열기. Basic Auth 팝업 → `emcoadmin` / `admin1234` 입력. 페이지가 채워져 보이는지 확인:
- 방문자 카드: 오늘 ≥ 1 (위 비콘 호출 반영)
- 30일 차트: 라인 그려짐
- 챗봇 카드: 기존 누적 수치 반영
- 세션 테이블: 최근 챗봇 세션 목록
- 세션 행 클릭 → 모달에 메시지 표시

- [ ] **Step 7: 프로덕션 검증 — 인증 실패 케이스**

DevTools 콘솔에서:
```js
fetch('/api/admin/stats', { headers: { Authorization: 'Basic ' + btoa('wrong:bad') } }).then(r => r.status)
```
Expected: `401`.

```js
fetch('/api/admin/stats').then(r => r.status)
```
(브라우저가 Basic 자격증명 캐시했으면 200, 시크릿 창에서 캐시 없으면 401)

- [ ] **Step 8: 프로덕션 검증 — robots/SEO 차단**

```powershell
curl.exe -sI https://emcokids.co.kr/robots.txt | Select-String "Console"
curl.exe -sI https://emcokids.co.kr/console-e7m3k9p2/ | Select-String "X-Robots-Tag"
```
Expected: 두 번째 명령에서 `X-Robots-Tag: noindex, nofollow` 헤더 보임.

- [ ] **Step 9: Cloud Run 로그 점검**

```
gcloud run services logs read emco-chatbot-api --region=asia-northeast3 --limit=30
```
Expected: `/track insert error` 없음. `/admin` 핸들러 정상 응답 로그.

---

## Task 17: CLAUDE.md 업데이트

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: "운영 정책" 섹션 또는 새 "어드민 콘솔" 섹션 추가**

`CLAUDE.md` 의 "다음에 할 만한 것" 섹션 위에 새 섹션 추가:
```markdown
## 어드민 콘솔

- 경로: `https://emcokids.co.kr/console-e7m3k9p2/` (외부 노출 금지, sitemap/robots 차단)
- 인증: HTTP Basic Auth — `emcoadmin` / `admin1234` (약한 비밀번호 → 추후 강한 값으로 교체 권장)
- 시크릿: GCP Secret Manager `emco-admin-user`, `emco-admin-pass` → Cloud Run env `ADMIN_USERNAME`, `ADMIN_PASSWORD`
- 데이터: `emco_page_views` (방문자 비콘) + 기존 `emco_chat_*` (챗봇 로그)
- 집계 RPC: `emco_admin_stats()` — KST 일자 경계, 단일 호출로 모든 지표 반환
- 비밀번호 회전 시: `.env` 갱신 → `setup-gcp-secrets.ps1` 재실행 → `gcloud run services update ... --update-secrets ADMIN_USERNAME=emco-admin-user:latest,ADMIN_PASSWORD=emco-admin-pass:latest`
```

또한 "다음에 할 만한 것" 목록에서 "어드민 페이지" 항목 삭제 (있다면).

- [ ] **Step 2: Commit**

```
git add CLAUDE.md
git commit -m "docs: add admin console section to CLAUDE.md"
```

- [ ] **Step 3: 최종 push**

```
git push origin main
```

---

## Self-Review

**1. Spec coverage**
- §2 URL/인증 → Task 1(자격증명 env), 3(Basic Auth), 8(마운트), 10(HTML 경로)
- §3 데이터 모델 → Task 1
- §4 API → Task 4 (/track), 5/6/7 (/admin/*)
- §5 Frontend → Task 9 (비콘), 10/11/12/13 (콘솔)
- §6 인덱싱 차단 → Task 14
- §7 비밀 관리 → Task 2 (env), 15 (시크릿 등록), 16 (Cloud Run 주입)
- §9 검증 체크리스트 → Task 16 Step 5~8
- §10 위험 메모 (약한 비번 권장 노트) → Task 17

**2. Placeholder scan** — TBD/TODO/"적절한 에러 처리" 같은 표현 없음. 모든 step에 구체적 코드/명령/기대 결과 포함.

**3. Type consistency**
- `emco_admin_stats()` RPC 응답 구조와 `app.js` 의 `renderVisitors`/`renderChat` 키 일치 (`today/yesterday/this_week/this_month/daily_30d`, `sessions_today/sessions_week/messages_today/avg_response_ms/fallback_rate/category_distribution`)
- `/api/admin/sessions` 응답 필드와 `appendSessionRows` 사용 키 일치 (`id/created_at/message_count/ip_hash_short/first_user_query/next_before`)
- `/api/admin/sessions/:id` 응답과 모달 렌더 키 일치 (`session.{created_at,last_seen_at,ip_hash_short,user_agent}`, `messages[].{role,content,category,created_at}`)
- env 키 `ADMIN_USERNAME`/`ADMIN_PASSWORD` 가 env.ts, basicAuth.ts, .env.example, setup-gcp-secrets.ps1, deploy 명령에서 모두 동일

**4. 알려진 한계**
- 로컬 firebase emulator 와 Cloud Run 통합은 환경별로 다름 — plan 은 Task 12에서 두 가지 대안(fetch URL 임시 변경) 제시
- Basic Auth 캐시 클리어는 브라우저별로 다름 — 시크릿 창 사용 권장
