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
