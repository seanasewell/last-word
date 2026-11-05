-- Last word, phase 2: real leaderboards.
-- Ranks players by elimination-match wins in a period (today, this week,
-- this month, this year, all time) across the world, the caller's country,
-- or the caller's region. Periods use the caller's time zone so "today"
-- matches what they see on screen. Returns the top 50 plus the caller's row,
-- exposing only public profile fields.
create or replace function public.leaderboard(p_scope text, p_period text, p_tz text default 'UTC')
returns table (
  rank bigint,
  user_id uuid,
  name text,
  photo_url text,
  country text,
  region text,
  wins bigint,
  is_me boolean,
  ranked_players bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_tz text;
  v_now timestamp;
  v_start timestamptz;
  v_country text;
  v_region text;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  if p_scope not in ('world', 'national', 'state') or p_period not in ('day', 'week', 'month', 'year', 'all') then
    raise exception 'Unknown scope or period';
  end if;

  select tz.name into v_tz from pg_catalog.pg_timezone_names tz where tz.name = p_tz limit 1;
  v_tz := coalesce(v_tz, 'UTC');
  v_now := now() at time zone v_tz;
  v_start := case p_period
    when 'day' then date_trunc('day', v_now) at time zone v_tz
    when 'week' then date_trunc('week', v_now) at time zone v_tz -- weeks start Monday
    when 'month' then date_trunc('month', v_now) at time zone v_tz
    when 'year' then date_trunc('year', v_now) at time zone v_tz
    else '-infinity'::timestamptz
  end;

  select pr.country, pr.region into v_country, v_region
  from public.profiles pr where pr.id = v_me;

  return query
  with tallies as (
    select m.user_id, count(*) as wins, max(m.played_at) as last_win
    from public.match_results m
    where m.won and m.played_at >= v_start
    group by m.user_id
  ),
  board as (
    select t.user_id, t.wins, t.last_win, p.name, p.photo_url, p.country, p.region
    from tallies t
    join public.profiles p on p.id = t.user_id
    where p.name is not null
      and (
        p_scope = 'world'
        or (p_scope = 'national' and p.country = v_country)
        or (p_scope = 'state' and p.country = v_country and p.region is not distinct from v_region)
      )
  ),
  ranked as (
    -- Ties: whoever reached their total first ranks higher.
    select row_number() over (order by b.wins desc, b.last_win asc, b.name asc) as rk,
           count(*) over () as total,
           b.*
    from board b
  )
  select r.rk, r.user_id, r.name, r.photo_url, r.country, r.region, r.wins, r.user_id = v_me, r.total
  from ranked r
  where r.rk <= 50 or r.user_id = v_me
  order by r.rk;
end;
$$;

revoke all on function public.leaderboard(text, text, text) from public, anon;
grant execute on function public.leaderboard(text, text, text) to authenticated;
