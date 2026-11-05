-- Last word, phase 4: moderation (needed for the app stores).
-- • Display names are checked against a profanity / slur filter (also in the app).
-- • Players can report another player's name or photo, and block players.
-- • A name or photo reported by 3 different players in 30 days is reset
--   automatically; every report is kept in public.reports for review.
-- • Blocked players are hidden from your leaderboards and you won't be put
--   in the same lobby.

-- ── Name filter ─────────────────────────────────────────────────────────────
-- Same lists as src/lib/nameFilter.ts. "Anywhere" terms are blocked even
-- inside other letters; "whole" terms only as a separate word (so names like
-- Cassie or Hancock are fine).
create or replace function game.name_allowed(p_name text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  anywhere text[] := array['nigg','niga','nigr','fagg','kike','cunt','fuck','fck','shit','bitch','whore','slut','retard','tranny','wetback','nazi','hitler','porn','penis','vagina','pussy','asshole','bastard','dildo','jizz','twat','wank','molest','paedo','chink','beaner','kkk','cocksuck','motherf','blowjob','handjob','clit','titties','genital','scrotum','testicle','orgasm','masturb','skank','heil'];
  whole text[] := array['ass','arse','dick','cock','cum','sex','anal','anus','spic','coon','gook','dyke','fag','fags','negro','hoe','hoes','thot','tit','tits','boob','boobs','piss','rape','raped','rapist','pedo','fuk','horny','boner','semen','nude','nudes','milf','nsfw','xxx'];
  v_spaced text;
  v_letters text;
  v_squashed text;
  t text;
  tok text;
begin
  if p_name is null then return true; end if;
  -- Split camelCase, lower-case, undo look-alike characters.
  v_spaced := translate(lower(regexp_replace(p_name, '([a-z])([A-Z])', '\1 \2', 'g')), '013457@$!|', 'oieastasii');
  v_spaced := regexp_replace(v_spaced, '[^a-z]+', ' ', 'g');
  v_letters := replace(v_spaced, ' ', '');
  v_squashed := regexp_replace(v_letters, '(.)\1+', '\1', 'g');
  foreach t in array anywhere loop
    if position(t in v_letters) > 0 or position(t in v_squashed) > 0 then return false; end if;
  end loop;
  foreach tok in array regexp_split_to_array(btrim(v_spaced), ' ') loop
    if tok = any (whole) or regexp_replace(tok, '(.)\1+', '\1', 'g') = any (whole) then return false; end if;
  end loop;
  return true;
end;
$$;

create or replace function game.check_profile_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.name is not null and not game.name_allowed(new.name) then
    raise exception 'name-not-allowed' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger profiles_name_filter
before insert or update of name on public.profiles
for each row execute function game.check_profile_name();

-- ── Reports ─────────────────────────────────────────────────────────────────
create table public.reports (
  id bigint generated always as identity primary key,
  reporter uuid not null references auth.users (id) on delete cascade,
  reported uuid not null references auth.users (id) on delete cascade,
  reason text not null check (reason in ('name', 'photo', 'cheating', 'other')),
  reported_name text,
  reported_photo text,
  created_at timestamptz not null default now(),
  action_taken text,
  unique (reporter, reported, reason)
);
alter table public.reports enable row level security; -- no policies: RPCs only, review in the dashboard

-- ── Blocks ──────────────────────────────────────────────────────────────────
create table public.blocks (
  blocker uuid not null references auth.users (id) on delete cascade,
  blocked uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
alter table public.blocks enable row level security;

-- Resolve a target: a user id (from the leaderboard) or a match seat (from a match).
create or replace function game.resolve_target(p_user uuid, p_match_player uuid)
returns uuid
language sql stable set search_path = ''
as $$
  select coalesce(p_user, (select user_id from public.match_players where id = p_match_player));
$$;

create or replace function public.report_player(p_reason text, p_user uuid default null, p_match_player uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_target uuid := game.resolve_target(p_user, p_match_player);
  v_count integer;
  p public.profiles%rowtype;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if v_target is null or v_target = v_me then raise exception 'Can''t report this player'; end if;
  if p_reason not in ('name', 'photo', 'cheating', 'other') then raise exception 'Unknown reason'; end if;
  select * into p from public.profiles where id = v_target;

  insert into public.reports (reporter, reported, reason, reported_name, reported_photo)
  values (v_me, v_target, p_reason, p.name, p.photo_url)
  on conflict (reporter, reported, reason) do update set created_at = now(), reported_name = excluded.reported_name, reported_photo = excluded.reported_photo;

  -- Three different players reporting the same thing within 30 days resets it.
  select count(distinct reporter) into v_count from public.reports
  where reported = v_target and reason = p_reason and action_taken is null and created_at > now() - interval '30 days';
  if v_count >= 3 then
    if p_reason = 'name' then
      update public.profiles set name = 'Player' || lpad((floor(random() * 10000))::int::text, 4, '0') where id = v_target;
      update public.reports set action_taken = 'name reset' where reported = v_target and reason = 'name' and action_taken is null;
    elsif p_reason = 'photo' then
      update public.profiles set photo_url = null where id = v_target;
      delete from storage.objects where bucket_id = 'avatars' and name like v_target::text || '/%';
      update public.reports set action_taken = 'photo removed' where reported = v_target and reason = 'photo' and action_taken is null;
    end if;
  end if;
end;
$$;

create or replace function public.block_player(p_user uuid default null, p_match_player uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_target uuid := game.resolve_target(p_user, p_match_player);
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if v_target is null or v_target = v_me then raise exception 'Can''t block this player'; end if;
  insert into public.blocks (blocker, blocked) values (v_me, v_target) on conflict do nothing;
end;
$$;

create or replace function public.unblock_player(p_user uuid)
returns void
language sql security definer set search_path = ''
as $$ delete from public.blocks where blocker = auth.uid() and blocked = p_user $$;

create or replace function public.my_blocks()
returns table (user_id uuid, name text, photo_url text, blocked_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select b.blocked, coalesce(p.name, 'Player'), p.photo_url, b.created_at
  from public.blocks b left join public.profiles p on p.id = b.blocked
  where b.blocker = auth.uid()
  order by b.created_at desc;
$$;

-- True when either player has blocked the other.
create or replace function game.blocked_between(a uuid, b uuid)
returns boolean
language sql stable set search_path = ''
as $$
  select exists (select 1 from public.blocks where (blocker = a and blocked = b) or (blocker = b and blocked = a));
$$;

-- ── Leaderboard: hide players you've blocked ───────────────────────────────
create or replace function public.leaderboard(p_scope text, p_period text, p_tz text default 'UTC')
returns table(rank bigint, user_id uuid, name text, photo_url text, country text, region text, wins bigint, is_me boolean, ranked_players bigint)
language plpgsql
stable security definer
set search_path to ''
as $function$
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
      and not exists (select 1 from public.blocks bl where bl.blocker = v_me and bl.blocked = t.user_id)
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
$function$;

-- ── Matchmaking: never seat blocked players together ───────────────────────
create or replace function public.mm_join()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_match uuid;
  v_seat smallint;
  v_profile public.profiles%rowtype;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select * into v_profile from public.profiles where id = v_me;
  if v_profile.name is null then raise exception 'Finish setting up your profile first'; end if;

  -- Rejoin a match you're still playing (or still waiting to start).
  select m.id into v_match
  from public.match_players p join public.matches m on m.id = p.match_id
  where p.user_id = v_me and m.created_at > now() - interval '15 minutes'
    and (m.status in ('lobby', 'prematch') or (m.status in ('round', 'between') and p.status = 'active'))
  order by m.created_at desc limit 1;
  if v_match is not null then
    perform game.advance(v_match);
    return v_match;
  end if;

  -- Join the oldest open lobby with a free seat and nobody you've blocked
  -- (or who has blocked you), or open a new one.
  select m.id into v_match from public.matches m
  where m.status = 'lobby' and m.lobby_closes_at > now() + interval '2 seconds'
    and (select count(*) from public.match_players p where p.match_id = m.id) < 6
    and not exists (
      select 1 from public.match_players p
      where p.match_id = m.id and p.user_id is not null and game.blocked_between(v_me, p.user_id)
    )
  order by m.created_at limit 1
  for update skip locked;
  if v_match is null then
    insert into public.matches default values returning id into v_match;
  end if;

  select s into v_seat from generate_series(0, 5) as s
  where not exists (select 1 from public.match_players p where p.match_id = v_match and p.seat = s)
  order by s limit 1;
  insert into public.match_players (match_id, user_id, name, photo_url, hue, seat)
  values (v_match, v_me, v_profile.name, v_profile.photo_url, game.hue_for(v_me), v_seat);

  perform game.advance(v_match);
  return v_match;
end;
$$;

revoke all on function public.report_player(text, uuid, uuid) from public, anon;
revoke all on function public.block_player(uuid, uuid) from public, anon;
revoke all on function public.unblock_player(uuid) from public, anon;
revoke all on function public.my_blocks() from public, anon;
grant execute on function public.report_player(text, uuid, uuid) to authenticated;
grant execute on function public.block_player(uuid, uuid) to authenticated;
grant execute on function public.unblock_player(uuid) to authenticated;
grant execute on function public.my_blocks() to authenticated;
