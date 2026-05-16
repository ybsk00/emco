# 엠코 어드민 콘솔 — 설계 문서

**작성일**: 2026-05-17
**범위**: 비공개 어드민 페이지 1개 — 홈페이지 방문자 통계 + 챗봇 대화 로그 조회

## 1. 목표와 비목표

**목표**

- 원장님이 외부에서 추측하기 어려운 URL로 어드민 페이지에 접근해, 홈페이지 방문 추이와 챗봇 대화 내역을 한 화면에서 확인할 수 있다.
- 기존 정적 페이지 + Cloud Run + Supabase 구조를 유지한다(새 인프라 도입 없음).
- 자격증명은 GCP Secret Manager에 보관하고 코드/Git에 노출하지 않는다.

**비목표**

- FAQ 편집, 세션 강제 종료, 응답 재학습 같은 어드민 운영 기능(추후 별도 spec).
- 다중 관리자 계정·역할·감사 로그.
- 실시간 푸시(WebSocket/SSE) — 새로고침 기반 폴링이면 충분.

## 2. URL · 인증 결정

| 항목 | 값 |
|---|---|
| 어드민 경로 | `/console-e7m3k9p2/` (8자 영숫자 랜덤 슬러그) |
| 어드민 API 프리픽스 | `/api/admin/*` (Basic Auth 적용) |
| 추적 비콘 | `/api/track` (인증 없음, rate limit 강함) |
| 인증 | HTTP Basic Auth — `WWW-Authenticate: Basic realm="emco-admin"` |
| 자격증명 | `ADMIN_USERNAME=emcoadmin`, `ADMIN_PASSWORD=admin1234` |

**보안 모델**: 랜덤 슬러그는 부차적인 모호화 계층. 실제 보안 경계는 Basic Auth. HTTPS 강제(emcokids.co.kr) 위에서만 자격증명이 평문 노출 없이 전송된다.

**슬러그 확정 절차**: 본 spec의 `e7m3k9p2`는 초기값. 구현 단계에서 사용자가 다른 값으로 교체 가능(파일/URL 일괄 치환).

## 3. 데이터 모델

### 신규 테이블: `emco_page_views`

```sql
create table emco_page_views (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  ip_hash text,
  ua_hash text,
  referrer text,
  created_at timestamptz not null default now()
);
create index emco_page_views_created_at_idx on emco_page_views (created_at desc);
create index emco_page_views_ip_day_idx on emco_page_views (ip_hash, created_at);
```

- `ip_hash`: 기존 `hashIP()` (sha256 + IP_HASH_SALT, 앞 16자) 재사용. 동일 방문자 식별.
- `ua_hash`: User-Agent 앞 200자 sha256 앞 16자. UA 원문 저장 안 함.
- `path`: 비콘이 보낸 `location.pathname` (어드민 경로 `/console-*`는 서버에서 무시).
- `referrer`: `document.referrer`, 없으면 null.

### 기존 테이블 (변경 없음, 조회만)

`emco_chat_sessions`, `emco_chat_messages`, `emco_chat_analytics` — 챗봇 라우트가 이미 채워주고 있음.

## 4. API 라우트

### 4.1 추적

| Method | Path | Auth | Rate Limit |
|---|---|---|---|
| POST | `/api/track` | 없음 | 전용 limiter — IP당 분당 30회 |

**요청 본문 (JSON, ≤512 bytes)**
```json
{ "path": "/", "ref": "https://google.com/..." }
```

**처리**
- `path`가 `/console-`로 시작하면 무시(어드민 자체 호출 카운트 방지).
- `req.ip` → `hashIP()` → `ip_hash`.
- `req.headers.user-agent` → 앞 200자 → sha256 앞 16자 → `ua_hash`.
- `emco_page_views`에 insert. 실패는 silently 무시(`then(undefined, noop)`).
- 응답: `204 No Content`. 비콘은 응답 본문을 보지 않음.

### 4.2 어드민 (`/api/admin/*`, 모두 Basic Auth)

| Method | Path | 응답 |
|---|---|---|
| GET | `/api/admin/stats` | 방문자 + 챗봇 요약 |
| GET | `/api/admin/sessions?limit=50&before=<iso>` | 챗봇 세션 목록 (커서 페이지네이션) |
| GET | `/api/admin/sessions/:id` | 특정 세션의 메시지 전체 |

**`/api/admin/stats` 응답**
```json
{
  "visitors": {
    "today": 42,
    "yesterday": 38,
    "this_week": 215,
    "this_month": 920,
    "daily_30d": [{ "date": "2026-04-17", "unique": 31, "views": 48 }, ...]
  },
  "chat": {
    "sessions_today": 7,
    "sessions_week": 41,
    "messages_today": 18,
    "avg_response_ms": 2350,
    "fallback_rate": 0.04,
    "category_distribution": [
      { "category": "vaccine", "count": 14 },
      { "category": "checkup", "count": 9 },
      ...
    ]
  }
}
```
- 모든 카운트는 KST(Asia/Seoul) 기준 일자 경계 (`date_trunc('day', created_at at time zone 'Asia/Seoul')`).
- `unique`: `count(distinct ip_hash)` per day; `views`: 총 row 수.
- `messages_today`: `emco_chat_messages` 행 수 (user + assistant 합산).
- `avg_response_ms`: 이번 주 `emco_chat_analytics.response_time_ms` 평균.
- `fallback_rate`: 이번 주 `is_fallback=true / total`.
- `category_distribution`: 이번 주 `emco_chat_analytics`에서 카테고리별 카운트(`null`/`general` 제외), 카운트 내림차순.

**`/api/admin/sessions` 응답**
```json
{
  "sessions": [
    {
      "id": "uuid",
      "created_at": "2026-05-17T10:23:00Z",
      "last_seen_at": "2026-05-17T10:28:00Z",
      "ip_hash_short": "a1b2",
      "message_count": 6,
      "first_user_query": "독감 예방접종 며칠 전부터..."
    }
  ],
  "next_before": "2026-05-17T08:00:00Z"
}
```
- 정렬: `created_at desc`. `before` 쿼리는 `created_at < before`로 페이지네이션.
- `limit` 기본 50, 최대 100.
- `ip_hash_short`: `ip_hash` 앞 4자만.
- `first_user_query`: 첫 user 메시지 앞 60자.
- `next_before`: 마지막 행의 `created_at` ISO 문자열. 결과가 `limit` 미만이면 null.

**`/api/admin/sessions/:id` 응답**
```json
{
  "session": { "id": "...", "ip_hash_short": "a1b2", "user_agent": "Mozilla/5.0...", "created_at": "..." },
  "messages": [
    { "role": "user", "content": "...", "created_at": "..." },
    { "role": "assistant", "content": "...", "category": "vaccine", "metadata": { ... }, "created_at": "..." }
  ]
}
```

### 4.3 미들웨어: `basicAuth`

`api/src/middleware/basicAuth.ts`:
```ts
// req.headers.authorization === "Basic " + base64("user:pass") 비교
// 불일치: 401 + WWW-Authenticate: Basic realm="emco-admin"
// 환경변수 미설정: 503 ADMIN_NOT_CONFIGURED
// 자격증명 비교는 timingSafeEqual로
```

## 5. 프론트엔드

### 5.1 경로 구조

```
public/
└── console-e7m3k9p2/
    ├── index.html      (단일 페이지 — 대시보드)
    ├── app.js          (vanilla JS, fetch 기반)
    └── styles.css      (기존 톤 차용 — Pretendard, 흰 배경)
```

### 5.2 페이지 섹션

1. **헤더**: "엠코 어드민" + 새로고침 버튼 + 마지막 갱신 시각.
2. **방문자 카드 4개**: 오늘 / 어제 / 이번 주 / 이번 달 (`unique` 큰 글자 + `views` 작게).
3. **30일 일별 차트**: SVG 자체 그리기 (라이브러리 X). 막대 또는 라인 — 라인 권장(추세 가독성).
4. **챗봇 요약 카드**: 오늘 세션 / 주간 세션 / 평균 응답시간 / fallback %.
5. **카테고리 분포 막대**: 7개 카테고리 가로 막대 + 카운트.
6. **최근 세션 테이블** (페이지네이션 — "더 보기" 버튼):
   - 컬럼: 시각 (`HH:mm`) · 메시지 수 · `ip_hash_short` · 첫 질문 발췌
   - 행 클릭 → 모달 열림 → `/api/admin/sessions/:id` 호출 → 전체 대화 표시 (user 우측, assistant 좌측)

### 5.3 인증 UX

- 페이지 로드 시 즉시 `/api/admin/stats` fetch → 브라우저가 Basic Auth 팝업 자동 노출
- 401 응답 시: "인증 실패" 빈 상태 메시지 + "다시 시도" 링크 (강제 401 후 재팝업)
- 정확한 자격증명 입력 후엔 브라우저가 세션 동안 자동 재사용

### 5.4 추적 비콘 (방문자 페이지)

`public/index.html` `<head>` 끝부분:
```html
<script>
  try {
    navigator.sendBeacon('/api/track', new Blob(
      [JSON.stringify({ path: location.pathname, ref: document.referrer || null })],
      { type: 'application/json' }
    ));
  } catch (e) {}
</script>
```
- `sendBeacon` 실패 시 fallback 없음(분석 정확도 < UX 영향).
- 어드민 페이지 자체에는 이 스크립트 미포함.

## 6. 인덱싱 차단

- `public/robots.txt`에 `Disallow: /console-` 추가
- `firebase.json` `headers`에 `/console-**` 매칭: `X-Robots-Tag: noindex, nofollow`
- `sitemap.xml`에 어드민 URL 미포함 (이미 그러함, 명시적 검토)

## 7. 비밀 관리

GCP Secret Manager에 신규 시크릿 2개:

| 시크릿 | 값 |
|---|---|
| `emco-admin-user` | `emcoadmin` |
| `emco-admin-pass` | `admin1234` |

Cloud Run 배포 시 주입:
```
--set-secrets ADMIN_USERNAME=emco-admin-user:latest,ADMIN_PASSWORD=emco-admin-pass:latest
```

`setup-gcp-secrets.ps1`에 두 항목 추가 (로컬 `.env`의 `ADMIN_USERNAME/ADMIN_PASSWORD` 읽어 등록).
`.env.example`에도 두 키 추가.

**약한 비밀번호 경고**: `admin1234`는 강도가 낮음 — 본 spec은 사용자 명시 요청을 따르되, CLAUDE.md 운영 정책에 "추후 강력한 비밀번호로 교체 권장" 메모를 남긴다.

## 8. 파일 변경 목록

**신규**

- `supabase/migrations/2026-05-17_emco_page_views.sql`
- `api/src/middleware/basicAuth.ts`
- `api/src/routes/track.ts`
- `api/src/routes/admin.ts`
- `public/console-e7m3k9p2/index.html`
- `public/console-e7m3k9p2/app.js`
- `public/console-e7m3k9p2/styles.css`

**수정**

- `api/src/server.ts` — 두 라우터 마운트
- `api/src/config/env.ts` — `ADMIN_USERNAME`, `ADMIN_PASSWORD` 추가 (필수 아닌 옵셔널, 미설정 시 어드민만 503)
- `api/setup-gcp-secrets.ps1` — 두 시크릿 추가
- `api/.env.example` — 두 키 추가
- `public/index.html` — 추적 비콘 1줄
- `public/robots.txt` — `Disallow: /console-`
- `firebase.json` — `/console-**`에 `X-Robots-Tag` 헤더
- `CLAUDE.md` — 운영 정책에 어드민 경로/시크릿 정책 기재

## 9. 테스트 / 검증 체크리스트

- 어드민 경로 `/console-e7m3k9p2/`에 접근 → Basic Auth 팝업
- 잘못된 자격증명 → 401 재팝업
- 정확한 자격증명 → 대시보드 렌더, 모든 카드/차트/테이블에 실데이터
- 임의 페이지(`/`) 방문 → `/api/track` 호출 → `emco_page_views`에 row 적재
- 어드민 페이지 자체 방문 → `emco_page_views`에 row 없음
- 세션 행 클릭 → 모달에 전체 메시지 표시
- 페이지 새로고침 → Basic Auth 자동 통과(세션 캐시)
- robots.txt에 `/console-` Disallow 확인
- 빈 데이터 상태(0 방문자/0 세션) UI 깨지지 않음

## 10. 위험 / 결정 메모

- **약한 비밀번호**: 사용자 요청대로 `admin1234` 사용. 단일 관리자 + Basic Auth + HTTPS 환경이라 우선은 수용 가능하나, 향후 교체 필요.
- **랜덤 슬러그 git 노출**: public GitHub repo이므로 슬러그 자체는 비밀 아님. Basic Auth가 실제 게이트.
- **방문자 시계열 정확도**: `sendBeacon`은 브라우저 unload 시 best-effort. 광고차단기 등으로 일부 누락 가능 — 절대치보다 추세를 본다.
- **봇 트래픽 포함**: 검색엔진 크롤러도 비콘을 실행하지 않으면 누락, 실행하면 카운트. 추후 UA 패턴 필터 필요 시 별도 spec.
- **KST 일자 경계**: SQL `date_trunc('day', created_at at time zone 'Asia/Seoul')`로 변환. 서버 타임존 무관.
