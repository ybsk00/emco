-- 엠코 어드민 콘솔 — emco_page_views RLS 활성화 (기존 테이블 패턴과 일관성)
-- 서비스 롤 클라이언트는 RLS 우회하므로 백엔드 동작 영향 없음.
-- anon 키로 접근 시 행 접근 불가 → defense-in-depth.

alter table public.emco_page_views enable row level security;
