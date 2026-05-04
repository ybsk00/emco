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

## 셋업

### 1) Supabase

이미 생성된 프로젝트 `wltqkxesvtfwotcngzjj` (med-rag-chatbot, Tokyo) 사용.

마이그레이션은 Supabase MCP 또는 다음 SQL 파일을 SQL Editor 에서 실행:
```
supabase/migrations/20260504_001_emco_chatbot_schema.sql
```

확인: `emco_faq` `emco_chat_sessions` `emco_chat_messages` `emco_chat_analytics` 4개 테이블 + `emco_match_faq` RPC.

### 2) 시드

```bash
cd scripts
cp .env.example .env
# .env 에 SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY 입력
npm i

# 엠코 운영 FAQ (~30개)
npm run seed:hospital-faq

# PubMed 소아과 abstract (5,000+개) — 30~60분 소요
# (선택) NCBI_API_KEY 있으면 3배 빠름
npm run seed:pubmed

# 카테고리별 부분 시드
npm run seed:pubmed:vaccine
# 또는 dry-run
npm run seed:pubmed:dryrun
```

### 3) 백엔드 (Cloud Run)

**시크릿 등록**
```bash
echo -n "$SUPABASE_SERVICE_ROLE_KEY" | gcloud secrets create emco-supabase-key --data-file=-
echo -n "$GEMINI_API_KEY"            | gcloud secrets create emco-gemini-key   --data-file=-
echo -n "$(openssl rand -hex 32)"     | gcloud secrets create emco-ip-salt      --data-file=-
```

**배포**
```bash
cd api
gcloud builds submit --config cloudbuild.yaml .
```

**로컬 개발**
```bash
cd api
cp .env.example .env   # 키 채우기
npm i
npm run dev            # http://localhost:8080/api/patient-chatbot/chat
```

### 4) 프론트엔드 (Firebase Hosting)

```bash
firebase login
firebase use --add               # emco-pediatrics 선택
firebase deploy --only hosting
```

로컬:
```bash
firebase emulators:start --only hosting
# http://localhost:5000
# /api/* 요청은 firebase.json rewrite 로 Cloud Run 으로 자동 라우팅됨
```

**개발 중 다른 호스트로 API 보내기** — `public/index.html` 끝에 추가:
```html
<script>window.EMCO_API_BASE = "http://localhost:8080/api";</script>
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
