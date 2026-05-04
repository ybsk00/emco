# 엠코소아청소년과의원 — 홈페이지 + 환자용 챗봇

따뜻한 동네 소아과 홈페이지와 24시간 RAG 챗봇 코코.

```
┌────────────────────────┐    fetch (text/plain stream)   ┌─────────────────────────────┐
│ Firebase Hosting       │ ──────────────────────────────▶ │ Cloud Run (asia-northeast3) │
│  /                     │                                 │  POST /api/patient-chatbot  │
│  /index.html           │ ◀────────────────────────────── │       /chat (streaming)     │
│  styles.css · app.js   │     X-Session-Id, sources       │                             │
└────────────────────────┘                                 │  Gemini 2.0 Flash + RAG     │
                                                           │  ↓ pgvector                  │
                                                           │  Supabase (Tokyo)           │
                                                           │   emco_faq (5,000+)          │
                                                           │   emco_chat_sessions/msgs    │
                                                           │   emco_chat_analytics        │
                                                           └─────────────────────────────┘
```

## 디렉터리 구조

```
엠코소아과/
├── public/                      Firebase Hosting (정적 사이트)
│   ├── index.html               홈페이지 + 챗봇 모달
│   ├── styles.css
│   └── app.js                   스트리밍 챗봇 클라이언트
├── api/                         Cloud Run 백엔드 (Express + TS)
│   ├── src/
│   │   ├── server.ts
│   │   ├── routes/patientChatbot.ts
│   │   ├── services/
│   │   │   ├── orchestrator.ts          4-에이전트 디스패처
│   │   │   ├── retriever.ts             하이브리드 RAG (벡터+키워드)
│   │   │   └── agents/
│   │   │       ├── intentRouter.ts      greeting/general/consultation/medical 분류
│   │   │       ├── greeting.ts          하드코딩 (LLM 0회)
│   │   │       ├── general.ts           자유발화 (LLM 1회)
│   │   │       ├── consultation.ts      운영 정보 RAG
│   │   │       ├── medical.ts           의학 RAG + 카테고리 분류
│   │   │       ├── safety.ts            진단·처방 차단
│   │   │       ├── prompts.ts
│   │   │       └── utils.ts
│   │   ├── lib/
│   │   │   ├── supabase.ts
│   │   │   ├── embedding.ts             Gemini text-embedding-004 (768d)
│   │   │   └── gemini.ts
│   │   ├── middleware/
│   │   ├── types/
│   │   └── config/env.ts
│   ├── Dockerfile
│   └── cloudbuild.yaml
├── scripts/                     시딩 스크립트
│   ├── seed-hospital-faq.ts     엠코 운영 FAQ ~30개 (Korean)
│   └── seed-pubmed.ts           PubMed 소아과 abstract 5,000+개 (English)
├── supabase/
│   └── migrations/
│       └── 20260504_001_emco_chatbot_schema.sql
├── firebase.json                Hosting 설정 + /api → Cloud Run rewrite
└── .firebaserc
```

## 챗봇 아키텍처

서울온케어 환자 챗봇 패턴 차용. 4단계 멀티 에이전트:

| Intent          | LLM 호출  | RAG | 용도                                            |
|-----------------|-----------|-----|------------------------------------------------|
| greeting        | 0회       | ✗   | 인사·작별. 하드코딩 즉시 응답.                    |
| general         | 1회 stream| ✗   | 잡담, 챗봇 정체 질문.                             |
| consultation    | 1회 stream| ✓   | 진료시간·위치·비용·주차 등 운영 안내.              |
| medical         | 1~2회 stream | ✓ | 예방접종·검진·증상·응급·키 성장 등 의학 질문.       |

**카테고리 (medical)**: `vaccine` · `checkup` · `cold` · `emergency` · `growth` · `teen` · `general`

**Intent 라우팅 순서**
1. 키워드 프리필터 (greeting → consultation → medical)
2. 위 모두 미해당이면 Gemini LLM 분류
3. LLM 실패 시 키워드 결과로 폴백

**스트리밍 프로토콜** — `text/plain` 단일 응답.
- 본문이 흘러나오다가 끝에 마커 `\n__SOURCES__[...]` (JSON) 추가.
- 클라이언트는 마커 이전까지만 화면에 표시, 마커 이후는 source chip 으로 렌더.

**안전 가드**
- 진단·처방 직접 요청 패턴은 즉시 차단 + 응급실 안내 답변.
- 응급 키워드 (호흡곤란·경련 등) 자동 119 안내.

## GCP / Firebase 프로젝트

| 역할 | ID |
|---|---|
| Firebase Hosting + Cloud Run + Secret Manager (통합) | `emco-8a3b5` |
| Supabase (RAG DB) | `wltqkxesvtfwotcngzjj` (med-rag-chatbot, Tokyo) |

> Firebase Hosting `rewrites.run` 옵션은 같은 GCP 프로젝트 내 Cloud Run 만 가리킬 수 있어, Cloud Run 도 `emco-8a3b5` 안에 배포합니다.

## 셋업 / 배포 단계

### 0) 사전 준비 (한 번만)

```bash
# 1. gcloud CLI 인증 + 프로젝트 지정
gcloud auth login
gcloud config set project emco-8a3b5

# 2. 필요한 API 활성화
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com

# 3. Artifact Registry 저장소 (cloudbuild.yaml 의 --image 경로용)
gcloud artifacts repositories create cloudrun \
  --repository-format=docker \
  --location=asia-northeast3 \
  --description="emco Cloud Run images"

# 4. Cloud Build 가 Cloud Run 배포 + Secret 접근하도록 권한 부여
PROJECT_NUMBER=$(gcloud projects describe emco-8a3b5 --format='value(projectNumber)')
gcloud projects add-iam-policy-binding emco-8a3b5 \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/run.admin"
gcloud projects add-iam-policy-binding emco-8a3b5 \
  --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
  --role="roles/iam.serviceAccountUser"
gcloud projects add-iam-policy-binding emco-8a3b5 \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

### 1) Supabase 마이그레이션

이미 생성된 프로젝트 `wltqkxesvtfwotcngzjj` 에 다음 SQL 실행 (Supabase MCP 또는 SQL Editor):
```
supabase/migrations/20260504_001_emco_chatbot_schema.sql
```

확인: `emco_faq` · `emco_chat_sessions` · `emco_chat_messages` · `emco_chat_analytics` 4개 테이블 + `emco_match_faq()` RPC.

> Supabase service role key 는 Project Settings → API → `service_role` 키 복사. **anon 키 아님!**

### 2) 로컬 시크릿 셋업 (.env — gitignored)

> ⚠️ **절대 commit 하지 마세요.** `.gitignore` 에서 차단됩니다.

```bash
# api/.env  — 로컬 개발용
cd api
cp .env.example .env
# 편집기로 .env 열어서 다음 값 채우기:
#   SUPABASE_SERVICE_ROLE_KEY=  ← Supabase 대시보드에서 복사
#   GEMINI_API_KEY=             ← Google AI Studio에서 발급
#   IP_HASH_SALT=               ← openssl rand -hex 32 결과
```

```bash
# scripts/.env — 시딩용
cd scripts
cp .env.example .env
# 같은 SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY 채우기
```

### 3) 시드 실행

```bash
cd scripts
npm install

# 엠코 운영 FAQ (~30개, 약 1분)
npm run seed:hospital-faq

# PubMed 소아과 abstract (목표 5,000+개, 30~60분)
# (선택) NCBI_API_KEY 발급 시 3배 빠름
npm run seed:pubmed

# 카테고리별 부분 시드
npm run seed:pubmed:vaccine

# 동작 확인용 dry-run (토픽당 5개만)
npm run seed:pubmed:dryrun
```

### 4) Cloud Run 시크릿 등록 (1회)

```bash
echo -n "<SUPABASE_SERVICE_ROLE_KEY>" | gcloud secrets create emco-supabase-key --data-file=-
echo -n "<GEMINI_API_KEY>"            | gcloud secrets create emco-gemini-key   --data-file=-
openssl rand -hex 32                  | gcloud secrets create emco-ip-salt      --data-file=-
```

이후 키를 교체할 땐 새 버전 추가:
```bash
echo -n "<NEW_KEY>" | gcloud secrets versions add emco-gemini-key --data-file=-
```

### 5) 백엔드 배포 (Cloud Run)

```bash
cd api
gcloud builds submit --config cloudbuild.yaml .
```

처음 배포 후 부여된 Cloud Run URL 확인:
```bash
gcloud run services describe emco-chatbot-api --region=asia-northeast3 --format='value(status.url)'
```

헬스체크:
```bash
curl https://emco-chatbot-api-XXXX.a.run.app/health
```

### 6) 프론트 배포 (Firebase Hosting)

```bash
# 프로젝트 루트에서
firebase login
firebase use emco-8a3b5
firebase deploy --only hosting
```

배포 후 https://emco-8a3b5.web.app 으로 접근. Hosting 의 `/api/**` 는 `firebase.json` rewrite 로 같은 프로젝트의 Cloud Run `emco-chatbot-api` 로 자동 라우팅됩니다.

### 로컬 개발

**백엔드**
```bash
cd api
npm install
npm run dev   # http://localhost:8080/api/patient-chatbot/chat
```

**프론트 (백엔드 직접 호출)**
`public/index.html` 끝(`</body>` 직전)에 임시로:
```html
<script>window.EMCO_API_BASE = "http://localhost:8080/api";</script>
```
그 후 `public/index.html` 을 브라우저로 열면 챗봇이 로컬 API 로 붙습니다.

**프론트 (Firebase 에뮬레이터)**
```bash
firebase emulators:start --only hosting
# http://localhost:5000 — /api/* 는 운영 Cloud Run 으로 rewrite
```

## 챗봇 UI 결정사항

- **모달 스타일** (요구사항: "중앙·크게") — 우하단 widget 대신 화면 중앙 620×820 모달.
- **백드롭** 클릭 + ESC 로 닫힘. body 스크롤 잠금.
- **헤더** 살구 그라디언트 + 떠다니는 구름·별·하트 + 마스코트 아바타 + 온라인 점.
- **Quick Action Bar** — 전화·진료시간·오시는길·예방접종·영유아 검진 단축.
- **추천 질문** 2열 카드 (5색).
- **버블** 손그림 꼬리 + 그림자, 출처 chip.
- **타이핑** 살구·민트·옐로우 3색 점 바운스.

## 향후 (v2)

- 어드민 페이지 (대화 모니터링, FAQ 추가/편집).
- 내원 의도 감지 (booking marker) + 예약 카드.
- TTS/STT (서울온케어 패턴 차용).
- 아바타 커스터마이징.
