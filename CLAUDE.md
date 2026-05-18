# 엠코소아청소년과의원 — Claude 가이드

## 한 줄 요약

서울 중랑구 상봉동 동네 소아청소년과 홈페이지 + RAG 챗봇 코코.
**Live**: https://emcokids.co.kr · GitHub: https://github.com/ybsk00/emco

## 스택

| 레이어 | 기술 |
|---|---|
| 프론트 | Firebase Hosting (정적 HTML/CSS/JS, `public/`) |
| 백엔드 | Google Cloud Run, Express + TypeScript (`api/`) |
| DB | Supabase pgvector (프로젝트 ref `wltqkxesvtfwotcngzjj`, Tokyo) |
| LLM | Gemini 2.5 Flash (thinking OFF, maxOutputTokens 4096) |
| 임베딩 | gemini-embedding-001 (Matryoshka 768d) |
| 도메인 | emcokids.co.kr (가비아 → Firebase Custom Domain) |

## GCP / Firebase

- 통합 프로젝트 ID: **`emco-8a3b5`**
- 리전: **asia-northeast3** (서울)
- Cloud Run 서비스: `emco-chatbot-api`
- Artifact Registry: `cloudrun` repo
- 시크릿 (Secret Manager): `emco-supabase-key`, `emco-gemini-key`, `emco-ip-salt`, `emco-admin-user`, `emco-admin-pass`

## 디렉토리

```
emco/
├── public/                    Firebase Hosting (정적)
│   ├── index.html             홈페이지 + 챗봇 모달 + JSON-LD + 방문자 비콘
│   ├── styles.css
│   ├── app.js                 챗봇 vanilla JS (window.emcoChat 글로벌)
│   ├── console-e7m3k9p2/      어드민 콘솔 (비공개 슬러그)
│   │   ├── login.html / login.css / login.js   로그인 페이지
│   │   ├── index.html         대시보드 (방문자 + 챗봇 로그)
│   │   ├── styles.css         어드민 전용 CSS
│   │   └── app.js             fetch + SVG 차트 + 세션 모달
│   ├── sitemap.xml / feed.xml / robots.txt
│   ├── og-image.{svg,png} + favicon.svg + favicon-{16,32,48}.png
│   ├── apple-touch-icon.png + android-chrome-{192,512}.png
│   ├── manifest.webmanifest
│   └── googlec189...html      Google verification
├── api/                       Cloud Run 백엔드
│   ├── src/
│   │   ├── setup.ts                       dotenv.config() — 로컬 dev .env 로드용
│   │   ├── server.ts
│   │   ├── routes/{patientChatbot,track,admin}.ts
│   │   ├── services/
│   │   │   ├── orchestrator.ts          (4-에이전트 디스패처)
│   │   │   ├── retriever.ts             (하이브리드 RAG)
│   │   │   └── agents/{intentRouter,greeting,general,consultation,medical,safety,prompts,utils}.ts
│   │   ├── lib/{supabase,embedding,gemini}.ts
│   │   ├── middleware/{cors,errorHandler,rateLimiter,trackLimiter,adminAuth}.ts
│   │   └── types/chatbot.ts
│   ├── Dockerfile             pre-built dist 사용 (Cloud Build TS 컴파일 우회)
│   ├── cloudbuild.yaml
│   └── setup-gcp-secrets.ps1  Secret Manager 등록 헬퍼
├── scripts/                   시딩 + 자산 생성
│   ├── seed-hospital-faq.ts   엠코 운영 FAQ 31개 (Korean)
│   ├── seed-pubmed.ts         PubMed → 6,800+ abstract (--batch core | extra)
│   └── gen-assets.mjs         SVG → PNG (sharp)
├── supabase/migrations/
└── firebase.json + .firebaserc
```

## 운영 정책 (도메인 사실들)

| 항목 | 값 |
|---|---|
| 진료시간 (월·화·목·금) | **10:00 ~ 20:00** (평일 야간) |
| 토·일·공휴일 | 10:00 ~ 18:00 |
| **수요일** | **정기휴무** ("휴진"이 아닌 "정기휴무") |
| 점심시간 | 13:00 ~ 14:00 휴진 |
| 전화 | 02-433-5275 |
| 위치 | 서울 중랑구 망우로 353 현대프리미어스엠코 C동 308호 (상봉동) |
| 원장 | 유신 **원장님** (존칭 통일) |
| **화상** | **직접 진료 안 함** — 화상 전문병원(베스티안·한림대 한강성심·한일병원) 안내 |

진료 항목 6개: 감기·독감 신속검사 · 예방접종 · 영유아 검진 · 키 성장 평가 · **아토피·알레르기 진료** · 청소년 검진

## 챗봇 아키텍처

4-에이전트 멀티 에이전트 (서울온케어 패턴 차용 + 단순화):

| Intent | LLM | RAG | 용도 |
|---|---|---|---|
| greeting | 0회 | ✗ | 인사·작별 (하드코딩) |
| general | 1회 stream | ✗ | 잡담 |
| consultation | 1회 stream | ✓ | 진료시간·위치·비용·주차 |
| medical | 1~2회 stream | ✓ | 예방접종·검진·증상·키 성장 등 |

**Intent 라우팅** (`api/src/services/agents/intentRouter.ts`):
1. 키워드 prefilter (greeting → consultation → medical)
   - 한국어 키워드 array + `String.includes()` (정규식 사용 금지 — 한글 unicode 처리 호환성 문제)
2. 미해당 시 Gemini LLM 분류

**스트리밍 프로토콜**: `text/plain` 응답 끝에 `\n__SOURCES__[JSON]` 마커. 프론트가 마커 이전만 화면에 표시, 마커 이후를 source chip으로 렌더.

**카테고리** (medical만): general / vaccine / checkup / cold / emergency / growth / teen

**화상 정책**: SYSTEM_TONE 에 명시. 챗봇이 화상 질문에 응급 처치 후 전문병원 안내.

## DB 스키마 (Supabase public)

| 테이블 | rows | 용도 |
|---|---:|---|
| `emco_faq` | 6,802 | RAG 베이스 (FAQ 31 + PubMed 6,771) |
| `emco_chat_sessions` | — | 세션 (ip_hash) |
| `emco_chat_messages` | — | 메시지 이력 |
| `emco_chat_analytics` | — | 응답 시간/카테고리/fallback 통계 |
| `emco_page_views` | — | 방문자 비콘 (path, ip_hash, ua_hash, referrer) |

RPC: `emco_match_faq()` — 코사인 거리 벡터 검색. `emco_admin_stats()` — 어드민 대시보드 집계 (KST 기준).

모든 `emco_*` 테이블에 RLS 활성화. 백엔드는 service-role 키로 우회.

## 자주 쓰는 명령

```powershell
# 백엔드 로컬 개발
cd api; npm run dev

# 백엔드 배포 (Dockerfile 이 npm run build 안 함 — 로컬 빌드 dist 그대로 deploy)
cd api; npm run build; gcloud builds submit --config cloudbuild.yaml .

# 환경변수만 빠르게 변경
gcloud run services update emco-chatbot-api --region=asia-northeast3 --update-env-vars="K=V"

# 프론트 배포
firebase deploy --only hosting

# Cloud Run 로그
gcloud run services logs read emco-chatbot-api --region=asia-northeast3 --limit=30

# 시드 (텍스트 변경 후 DB 재시딩 패턴: row DELETE → seed:hospital-faq 재실행)
cd scripts; npm run seed:hospital-faq
cd scripts; npm run seed:pubmed:extra

# OG 이미지/favicon 재생성 (SVG 수정 후)
cd scripts; node gen-assets.mjs
```

## 검색엔진 등록 상태 (2026-05-04)

- ✅ **Google Search Console**: HTML 파일 인증 (`/googlec189ed635fa1310c.html`) + sitemap 제출
- ✅ **Naver Search Advisor**: meta 태그 인증 (`naver-site-verification`) + sitemap + RSS 제출
- ⏸ Bing Webmaster: 미등록 (Google Search Console import 가능)

## 시크릿 정책 (절대 위반 금지)

- API 키·토큰은 **로컬 `.env` 파일에만**, **never commit**
- `.gitignore` 패턴: `.env`, `.env.*`, `*.local`, `*.secret`, `service-account*.json`, `firebase-adminsdk*.json`
- 클라우드 배포: GCP Secret Manager (`gcloud secrets create`) → Cloud Run `--set-secrets`로 주입
- 응답·로그·commit 메시지에 키 값 인용 금지 (마스킹)
- `api/setup-gcp-secrets.ps1`이 .env에서 자동으로 읽어 Secret Manager 등록 (값 노출 없음)

## 자주 만나는 함정 (debugging shortcuts)

### 1. PowerShell stdin이 한국어 body를 cp949로 변환
- 증상: `$body | curl.exe -d "@-"` 로 보낸 한국어 JSON이 서버에서 깨진 codepoint로 도착 → prefilter false 반환
- 해결: 임시 파일에 UTF-8 BOM 없이 작성 후 `curl.exe -d "@$tmp"`
  ```powershell
  [System.IO.File]::WriteAllText($tmp, $body, [System.Text.UTF8Encoding]::new($false))
  ```
- **브라우저 fetch는 항상 UTF-8** — 운영에서는 문제 없음. 디버깅 도구만의 함정.
- 디버깅 시 코드 의심 전에 도구 인코딩 먼저 의심.

### 2. Cloud Build TS 컴파일에서 한국어 정규식이 깨질 수 있음
- 증상: `dist/*.js`의 정규식 안 한국어가 잘못된 byte sequence로 컴파일
- 해결: **로컬 `npm run build`로 빌드 후 dist/ 를 그대로 deploy**. Dockerfile이 `RUN npm run build` 하지 않고 `COPY dist ./dist`만.
- `.dockerignore`/`.gcloudignore`에서 `dist/` 제외 금지

### 3. Cloud Build user substitution이 built-in vars 못 풀어줌
- `_IMAGE: asia-northeast3-docker.pkg.dev/$PROJECT_ID/...` ← `$PROJECT_ID` 치환 안 됨
- 해결: `_IMAGE: asia-northeast3-docker.pkg.dev/emco-8a3b5/...` 직접 박기

### 4. `--set-env-vars`의 콤마 충돌
- `CORS_ORIGIN=a.com,b.com`을 dict separator(콤마)에 그대로 박으면 추가 KEY=VALUE로 오인
- 해결: `--set-env-vars=^|^KEY1=val|KEY2=val|CORS_ORIGIN=a.com,b.com` (^|^ separator override)

### 5. Gemini 2.5 Flash thinking mode 기본 ON
- 증상: 응답이 중간에 잘림 (thinking에 토큰 소진)
- 해결: `generationConfig: { thinkingConfig: { thinkingBudget: 0 } }`
- `lib/gemini.ts`의 `getModel()`에서 처리됨. maxOutputTokens 4096 default.

### 6. Firebase Hosting `cleanUrls`가 .html redirect → Google verification 실패
- 해결: `cleanUrls: false`. 단일 페이지라 SEO 영향 없음.

### 7. Firebase Hosting rewrite `**` 패턴이 정적 자산 가로챔
- 증상: `/sitemap.xml`, `/foo.html` 같은 정적 파일 요청에 `index.html`이 응답
- 원인: 옛 Firebase 동작 또는 deploy 시점 캐시 — `**` 패턴이 정적보다 우선될 수 있음
- 해결: `firebase.json` rewrites source 를 `/`만 명시. 다른 경로는 정적 파일로 직접 매칭됨.
- 이게 단일 페이지 사이트의 sitemap/feed/verification 파일 라우팅을 보장.

### 8. 네이버 RSS는 동일 도메인 URL만 인정
- 증상: `<item><link>https://emco.lumiaeo.com/...</link>`을 거부 ("형식이 올바르지 않음")
- 해결: link를 `https://emcokids.co.kr/blog/{slug}`로, firebase.json `redirects`로 외부 원문에 301 redirect

### 9. Gemini 임베딩 모델
- `text-embedding-004`는 신규 키에 deprecated. **`gemini-embedding-001`** 사용 + outputDimensionality=768 (Matryoshka 절단). REST API 직접 호출 (SDK는 outputDimensionality 옵션 없음).

### 10. 모달 토글 — single source of truth
- 옛 inline `style.display='none'`이 stuck 되어 다시 안 열리는 버그가 있었음
- 패턴: `setChatOpen(open)` 함수 단일 진입점. 안에서 `hidden` + `style.display` **둘 다** 명시.
- 모든 진입점(FAB/X/배경/ESC/위임 핸들러/inline onclick)은 `setChatOpen()` 또는 `window.emcoChat.{open,close,toggle}()` 경유.
- 페이지 로드 시 `setChatOpen(false)` 명시 호출로 캐시된 옛 inline style 초기화.

### 11. Firebase Hosting cache-control
- 옛 설정: `*.@(js|css)` immutable max-age 31536000 — 변경 사항 사용자 브라우저에 안 들어감
- 현 설정: `*.@(js|css|html)` max-age=0, must-revalidate — 매 요청 ETag 검증, 변경 즉시 반영
- 이미지(png/svg/woff2)만 max-age=86400

### 12. Firebase Hosting은 `__session` 외 모든 Cookie 헤더를 strip
- 증상: 어드민 로그인 200 + Set-Cookie 정상 → 다음 요청은 항상 401. 서버 로그엔 `req.headers.cookie === undefined`
- 원인: Firebase Hosting이 dynamic backend(Cloud Run) 프록시 시 보안상 모든 Cookie 헤더를 제거. **예외는 이름이 정확히 `__session`인 쿠키 하나뿐**.
- 해결: 어드민 세션 쿠키 이름을 `__session`으로 고정 (`api/src/middleware/adminAuth.ts` 의 `COOKIE_NAME`). Path는 `/` (Firebase 호환).
- 참고: https://firebase.google.com/docs/hosting/manage-cache#using_cookies

### 13. `cloudbuild.yaml --set-secrets`가 모든 secret 바인딩을 replace
- 증상: `gcloud builds submit` 직후 어드민 endpoints 503 ADMIN_NOT_CONFIGURED.
- 원인: `cloudbuild.yaml`의 `--set-secrets=...` 는 기존 바인딩을 **완전히 덮어씀**. 거기 명시 안 된 ADMIN_USERNAME/PASSWORD는 사라짐.
- 해결: 매 배포 후 `gcloud run services update emco-chatbot-api --region=asia-northeast3 --update-secrets=ADMIN_USERNAME=emco-admin-user:latest,ADMIN_PASSWORD=emco-admin-pass:latest` 로 재주입. 또는 cloudbuild.yaml `--set-secrets`에 두 항목 추가 (권장).

### 14. Firebase `trailingSlash: false` + 서브디렉토리 정적 페이지 = 상대경로 깨짐
- 증상: `/console-xxx/` 접근 → 301 → `/console-xxx` (슬래시 제거). `index.html` 안의 `<link href="./styles.css">`가 `/styles.css`로 해석 → 404 → 스타일 없음 + JS 미실행.
- 해결: 서브디렉토리 페이지 자산은 **절대 경로** 사용 — `<link href="/console-xxx/styles.css">`, `<script src="/console-xxx/app.js">`.
- 홈페이지(`/`)는 영향 없음 (루트라 상대경로도 OK).

## 도메인 / DNS

가비아에서 관리. A 레코드 두 개:

| 호스트 | 값 |
|---|---|
| @ | 199.36.158.100 |
| www | 199.36.158.100 |

Firebase에 `www.emcokids.co.kr`은 apex로 영구 redirect 등록.

## 카카오톡/페이스북 OG 캐시 갱신

OG 이미지나 description 변경 후 카톡 미리보기는 자동 갱신 안 됨:
- 카카오: https://developers.kakao.com/tool/clear/og → URL 입력 → 삭제
- 페이스북: https://developers.facebook.com/tools/debug/ → 다시 스크랩

## 어드민 콘솔

- 진입: `https://emcokids.co.kr/console-e7m3k9p2/login.html` (외부 노출 금지, sitemap/robots/X-Robots-Tag 차단)
- 미인증 상태로 대시보드 접근 시 자동으로 login.html 로 리다이렉트
- 자격증명: `emcoadmin` / `admin1234` (약한 비밀번호 → 추후 강한 값으로 교체 권장)
- 시크릿: GCP Secret Manager `emco-admin-user`, `emco-admin-pass` → Cloud Run env `ADMIN_USERNAME`, `ADMIN_PASSWORD`
- 인증 방식: 커스텀 로그인 폼 → `POST /api/admin/login` 검증 성공 시 HMAC-서명 세션 쿠키 발급 (24h TTL)
  - **쿠키 이름은 `__session` 고정** — Firebase Hosting이 그 외 이름의 Cookie 헤더를 strip 함 (함정 #12 참조)
  - `HttpOnly; Secure; SameSite=Strict; Path=/`
  - HMAC 비밀키는 기존 `IP_HASH_SALT` 재사용 (별도 secret 추가 없음)
- 데이터: `emco_page_views` (방문자 비콘) + 기존 `emco_chat_*` (챗봇 로그)
- 집계 RPC: `emco_admin_stats()` — KST 일자 경계, 단일 호출로 모든 지표 반환
- 방문자 비콘은 `<head>` 끝에서 `sendBeacon('/api/track')` 호출 — `/console-*` 경로는 서버에서 카운트 제외
- 어드민 대시보드 정적 자산은 **절대 경로** (`/console-e7m3k9p2/styles.css`) — Firebase `trailingSlash: false` 때문 (함정 #14)
- 비밀번호 회전 시: `.env` 갱신 → `setup-gcp-secrets.ps1` 재실행 → `gcloud run services update emco-chatbot-api --region=asia-northeast3 --update-secrets=ADMIN_USERNAME=emco-admin-user:latest,ADMIN_PASSWORD=emco-admin-pass:latest`
- 로컬 dev: `tsx watch`가 `.env`를 자동 로드하지 않아 `api/src/setup.ts`에서 `dotenv.config()` 호출 (prod에선 `.env` 부재이므로 no-op)
- `gcloud` 기본 프로젝트가 다른 경우 — 항상 `--project=emco-8a3b5` 명시

## 다음에 할 만한 것
- 내원 의도 감지 (`__BOOKING__` marker) + 예약 카드
- TTS/STT (서울온케어 패턴 차용)
- Bing Webmaster 등록
- emcokids.co.kr 자체 블로그 페이지 (현재는 emco.lumiaeo.com으로 redirect)
