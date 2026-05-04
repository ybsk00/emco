-- 엠코소아과 챗봇 스키마
-- pgvector 기반 RAG + 세션/메시지/분석 로그
--
-- Categories: general | vaccine | checkup | cold | emergency | growth | teen
--   general   — 진료시간, 위치, 비용, 주차 등 운영 안내
--   vaccine   — 예방접종 (국가필수 + 선택)
--   checkup   — 영유아 검진 + 청소년 검진
--   cold      — 감기, 독감, 신속검사
--   emergency — 화상, 발열, 응급 처치
--   growth    — 키 성장, BMI, 성장곡선
--   teen      — 청소년 진료 (성장기, 사춘기)

-- 1) FAQ / 지식 베이스
create table if not exists public.emco_faq (
  id           uuid primary key default gen_random_uuid(),
  question     text not null,
  answer       text not null,
  category     text not null check (category in ('general','vaccine','checkup','cold','emergency','growth','teen')),
  source_type  text not null default 'faq' check (source_type in ('faq','pubmed','script')),
  source_url   text,
  source_title text,
  pmid         text unique,                       -- PubMed ID (idempotent seeding)
  language     text not null default 'ko',
  embedding    vector(768),                       -- Gemini text-embedding-004
  metadata     jsonb not null default '{}'::jsonb,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);

create index if not exists emco_faq_category_idx
  on public.emco_faq (category) where is_active = true and deleted_at is null;

create index if not exists emco_faq_source_type_idx
  on public.emco_faq (source_type) where is_active = true and deleted_at is null;

-- ivfflat for cosine distance — lists tuned for ~5–50K rows
create index if not exists emco_faq_embedding_idx
  on public.emco_faq using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- 키워드 검색용 (PostgreSQL trigram)
create index if not exists emco_faq_question_trgm_idx
  on public.emco_faq using gin (question gin_trgm_ops);
create index if not exists emco_faq_answer_trgm_idx
  on public.emco_faq using gin (answer gin_trgm_ops);

-- 2) 세션
create table if not exists public.emco_chat_sessions (
  id          uuid primary key default gen_random_uuid(),
  ip_hash     text,
  user_agent  text,
  metadata    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists emco_chat_sessions_created_at_idx
  on public.emco_chat_sessions (created_at desc);

-- 3) 메시지
create table if not exists public.emco_chat_messages (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.emco_chat_sessions(id) on delete cascade,
  role       text not null check (role in ('user','assistant','system')),
  content    text not null,
  category   text check (category in ('general','vaccine','checkup','cold','emergency','growth','teen')),
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists emco_chat_messages_session_idx
  on public.emco_chat_messages (session_id, created_at);

-- 4) 분석 로그
create table if not exists public.emco_chat_analytics (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid references public.emco_chat_sessions(id) on delete set null,
  query           text not null,
  intent          text,                            -- greeting | general | consultation | medical
  category        text,
  response_time_ms integer,
  had_sources     boolean default false,
  is_booking      boolean default false,
  is_fallback     boolean default false,
  retrieved_count integer default 0,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists emco_chat_analytics_created_at_idx
  on public.emco_chat_analytics (created_at desc);
create index if not exists emco_chat_analytics_intent_idx
  on public.emco_chat_analytics (intent, created_at desc);

-- 5) 벡터 검색 RPC (서비스 롤에서만 호출)
create or replace function public.emco_match_faq(
  query_embedding vector(768),
  match_threshold float default 0.30,
  match_count     int   default 10,
  filter_category text  default null
)
returns table (
  id           uuid,
  question     text,
  answer       text,
  category     text,
  source_type  text,
  source_url   text,
  source_title text,
  similarity   float,
  metadata     jsonb
)
language sql stable
as $$
  select
    f.id,
    f.question,
    f.answer,
    f.category,
    f.source_type,
    f.source_url,
    f.source_title,
    1 - (f.embedding <=> query_embedding) as similarity,
    f.metadata
  from public.emco_faq f
  where f.is_active = true
    and f.deleted_at is null
    and f.embedding is not null
    and (filter_category is null or f.category = filter_category)
    and 1 - (f.embedding <=> query_embedding) > match_threshold
  order by f.embedding <=> query_embedding
  limit match_count;
$$;

-- 6) RLS — 외부 anon 키로 직접 접근 차단, 서비스 롤만 read/write
alter table public.emco_faq             enable row level security;
alter table public.emco_chat_sessions   enable row level security;
alter table public.emco_chat_messages   enable row level security;
alter table public.emco_chat_analytics  enable row level security;

-- 정책 미생성 = 모든 anon/authenticated 접근 차단.
-- 서비스 롤(SUPABASE_SERVICE_ROLE_KEY)은 RLS 우회.
