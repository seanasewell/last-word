-- Last word, phase 5: XP, levels, achievements, challenges and streaks on the server.
--
-- Everything is awarded here, from results the server itself recorded, so it
-- can't be edited on the phone, follows the player to any device, and is still
-- counted if the app is closed mid-game (the sweeper finishes rounds and solo
-- games on its own). Only server-played games count: elimination matches
-- (end_round) and server-timed solo challenges (solo_*).
--
-- Days (streaks, daily challenges) use the player's own time zone, saved from
-- the phone; weekly challenges reset on Monday in that time zone.

-- ── Definitions (the app has the same ids for names and emoji) ─────────────
create table game.achievement_defs (
  id text primary key,
  series text not null,
  sort smallint not null,
  goal integer not null,
  xp integer not null,
  stat text not null
);
-- One achievement per goal; XP rises with each goal in a series.
insert into game.achievement_defs (id, series, sort, goal, xp, stat)
select s.series || '-' || g.goal, s.series, s.sort, g.goal,
       (array[100, 150, 200, 300, 400, 500, 500, 500, 500, 500])[g.n], s.stat
from (values
  ('words', 1, 'words', array[1, 100, 250, 500, 1000, 2500, 5000, 10000]),
  ('long9', 2, 'words9', array[1, 10, 50, 100]),
  ('long8', 3, 'words8', array[1, 10, 50, 100]),
  ('long7', 4, 'words7', array[1, 10, 50, 100]),
  ('long6', 5, 'words6', array[1, 10, 50, 100]),
  ('speed', 6, 'speedBursts', array[1, 5, 25, 100]),
  ('big-round', 7, 'bigRounds', array[1, 5, 25, 100]),
  ('wins', 8, 'wins', array[1, 10, 25, 50, 75, 100, 250, 500, 1000]),
  ('championship', 9, 'championshipReached', array[1, 5, 10, 25, 50, 75, 100, 250, 500, 1000]),
  ('streak', 10, 'streakBest', array[3, 7, 30, 60, 90, 120, 180, 365])
) as s(series, sort, stat, goals)
cross join lateral unnest(s.goals) with ordinality as g(goal, n);

create table game.challenge_defs (
  id text primary key,
  kind text not null check (kind in ('daily', 'weekly')),
  level smallint,             -- daily: 0 easy, 1 medium, 2 hard
  metric text not null,
  goal integer not null,
  xp integer not null,
  best boolean not null default false  -- "in one round" goals keep the best round, not a running total
);
insert into game.challenge_defs (id, kind, level, metric, goal, xp, best) values
  ('warm-up', 'daily', 0, 'games', 2, 50, false),
  ('quick-thinker', 'daily', 0, 'roundWords', 5, 50, true),
  ('word-hunter', 'daily', 0, 'words', 20, 75, false),
  ('long-shot', 'daily', 1, 'word7', 1, 75, true),
  ('word-machine', 'daily', 1, 'roundScore', 500, 75, true),
  ('speed-demon-d', 'daily', 1, 'earlyWords', 3, 75, true),
  ('perfect-ten', 'daily', 1, 'roundWords', 10, 100, true),
  ('daily-contender', 'daily', 1, 'matches', 3, 75, false),
  ('survivor-d', 'daily', 2, 'roundsSurvived', 2, 100, false),
  ('comeback-d', 'daily', 2, 'comeback', 1, 100, true),
  ('championship-d', 'daily', 2, 'championship', 1, 125, false),
  ('close-call-d', 'daily', 2, 'closeCall', 1, 125, true),
  ('contender', 'weekly', null, 'matches', 15, 200, false),
  ('word-marathon', 'weekly', null, 'words', 200, 250, false),
  ('champions-path', 'weekly', null, 'wins', 5, 300, false),
  ('the-survivor', 'weekly', null, 'roundsSurvived', 10, 200, false),
  ('long-word-legend', 'weekly', null, 'words7', 20, 250, false),
  ('championship-w', 'weekly', null, 'championship', 5, 300, false);

-- Developer-only server functions (simulate progress) check this switch.
-- Turn it off before launch: update game.config set value = 'false' where key = 'dev_tools';
create table game.config (key text primary key, value text not null);
insert into game.config values ('dev_tools', 'true');

-- ── Player progress ─────────────────────────────────────────────────────────
create table public.player_progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  xp integer not null default 0,
  stats jsonb not null default '{}'::jsonb,
  days date[] not null default '{}',           -- distinct days with a finished game
  streak_current integer not null default 0,
  streak_best integer not null default 0,
  streak_last date,
  unlocked jsonb not null default '{}'::jsonb,  -- achievement id → when
  daily jsonb not null default '{}'::jsonb,     -- {key, ids, progress, done, bonus}
  weekly jsonb not null default '{}'::jsonb,
  pending jsonb,                                -- {achievements: [ids], level_from, level_to} until shown
  last_game jsonb,                              -- {id, xp}: XP earned in the most recent game
  tz text not null default 'UTC',
  updated_at timestamptz not null default now()
);
alter table public.player_progress enable row level security;
create policy "read own progress" on public.player_progress for select using (user_id = auth.uid());

-- Each award happens once (round, match or solo game).
create table game.progress_events (
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id text not null,
  at timestamptz not null default now(),
  primary key (user_id, event_id)
);

-- ── Server-timed solo challenges ────────────────────────────────────────────
create table public.solo_games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null,
  possible_words integer not null default 0,
  started_at timestamptz not null default now(),
  ends_at timestamptz not null,
  finished boolean not null default false,
  score integer not null default 0
);
create index solo_games_open on public.solo_games (ends_at) where not finished;
create index solo_games_user on public.solo_games (user_id);
alter table public.solo_games enable row level security;
create policy "read own solo games" on public.solo_games for select using (user_id = auth.uid());

create table public.solo_words (
  game_id uuid not null references public.solo_games (id) on delete cascade,
  word text not null,
  points integer not null,
  at timestamptz not null default now(),
  primary key (game_id, word)
);
alter table public.solo_words enable row level security;

-- ── Helpers ─────────────────────────────────────────────────────────────────
create or replace function game.xp_for_level(n integer) returns integer
language sql immutable set search_path = '' as $$ select 500 + (n - 1) * 100 $$;

create or replace function game.level_for(p_xp integer) returns integer
language plpgsql immutable set search_path = '' as $$
declare lvl integer := 1; left_xp integer := p_xp;
begin
  while lvl < 100 and left_xp >= game.xp_for_level(lvl) loop
    left_xp := left_xp - game.xp_for_level(lvl);
    lvl := lvl + 1;
  end loop;
  return lvl;
end $$;

/** Today in the player's time zone. */
create or replace function game.local_day(p_tz text) returns date
language sql stable set search_path = '' as $$ select (now() at time zone coalesce(p_tz, 'UTC'))::date $$;

/** Same three daily challenges all day for a player: one easy, one medium, one hard, no repeated measure. */
create or replace function game.pick_daily(p_user uuid, p_day date) returns text[]
language plpgsql stable set search_path = '' as $$
declare
  v_ids text[] := '{}';
  v_metrics text[] := '{}';
  v_pick record;
  lvl integer;
begin
  for lvl in 0..2 loop
    select d.id, d.metric into v_pick from game.challenge_defs d
    where d.kind = 'daily' and d.level = lvl and not (d.metric = any (v_metrics))
    order by md5(p_user::text || p_day::text || d.id) limit 1;
    v_ids := v_ids || v_pick.id;
    v_metrics := v_metrics || v_pick.metric;
  end loop;
  return v_ids;
end $$;

/** Five of the six weekly challenges, the same all week. */
create or replace function game.pick_weekly(p_user uuid, p_week date) returns text[]
language sql stable set search_path = '' as $$
  select array_agg(d.id order by d.id) from game.challenge_defs d
  where d.kind = 'weekly' and d.id <> (
    select x.id from game.challenge_defs x where x.kind = 'weekly'
    order by md5(p_user::text || p_week::text || x.id) limit 1)
$$;

/** Load (creating if needed) a player's progress, starting new daily/weekly challenges when the day or week has changed. */
create or replace function game.progress_row(p_user uuid) returns public.player_progress
language plpgsql set search_path = '' as $$
declare
  r public.player_progress%rowtype;
  v_day date;
  v_week date;
begin
  insert into public.player_progress (user_id) values (p_user) on conflict do nothing;
  select * into r from public.player_progress where user_id = p_user for update;
  v_day := game.local_day(r.tz);
  v_week := v_day - (extract(isodow from v_day)::integer - 1);
  if coalesce(r.daily ->> 'key', '') <> v_day::text then
    r.daily := jsonb_build_object('key', v_day::text, 'ids', to_jsonb(game.pick_daily(p_user, v_day)), 'progress', '{}'::jsonb, 'done', '{}'::jsonb, 'bonus', false);
  end if;
  if coalesce(r.weekly ->> 'key', '') <> v_week::text then
    r.weekly := jsonb_build_object('key', v_week::text, 'ids', to_jsonb(game.pick_weekly(p_user, v_week)), 'progress', '{}'::jsonb, 'done', '{}'::jsonb, 'bonus', false);
  end if;
  return r;
end $$;

/** Add to (or, for "in one round" goals, raise) every unfinished challenge in a set that tracks this measure. */
create or replace function game.bump_set(p_set jsonb, p_metric text, p_by integer, p_force_best boolean default false) returns jsonb
language plpgsql stable set search_path = '' as $$
declare
  d record;
  cur integer;
begin
  if p_by <= 0 then return p_set; end if;
  for d in
    select c.* from game.challenge_defs c
    where c.id in (select jsonb_array_elements_text(p_set -> 'ids')) and c.metric = p_metric
  loop
    continue when coalesce((p_set -> 'done' ->> d.id)::boolean, false);
    cur := coalesce((p_set -> 'progress' ->> d.id)::integer, 0);
    p_set := jsonb_set(p_set, array['progress', d.id],
      to_jsonb(case when d.best or p_force_best then greatest(cur, p_by) else cur + p_by end));
  end loop;
  return p_set;
end $$;

create or replace function game.stat(r public.player_progress, k text) returns integer
language sql immutable set search_path = '' as $$ select coalesce((r.stats ->> k)::integer, 0) $$;

create or replace function game.add_stat(r public.player_progress, k text, p_by integer) returns jsonb
language sql immutable set search_path = '' as $$ select jsonb_set(r.stats, array[k], to_jsonb(game.stat(r, k) + p_by)) $$;

/** A finished game counts toward the streak (once per day). */
create or replace function game.played_today(inout r public.player_progress)
language plpgsql set search_path = '' as $$
declare v_day date := game.local_day(r.tz);
begin
  if not (v_day = any (r.days)) then r.days := r.days || v_day; end if;
  if r.streak_last = v_day then return; end if;
  r.streak_current := case when r.streak_last = v_day - 1 then r.streak_current + 1 else 1 end;
  r.streak_last := v_day;
  r.streak_best := greatest(r.streak_best, r.streak_current);
  r.stats := jsonb_set(r.stats, '{streakBest}', to_jsonb(r.streak_best));
end $$;

/** Finish an award: complete challenges, unlock achievements, note the level-up, save. */
create or replace function game.settle(r public.player_progress, p_game text, p_game_xp integer) returns void
language plpgsql set search_path = '' as $$
declare
  v_from integer;
  d record;
  v_new text[] := '{}';
  v_xp integer := p_game_xp;
  k text;
  v_set jsonb;
  v_bonus integer;
begin
  -- XP before this award (the game XP has already been added to r.xp).
  v_from := game.level_for(r.xp - p_game_xp);

  -- Challenges, then the "all done" bonus for each set.
  foreach k in array array['daily', 'weekly'] loop
    v_set := case k when 'daily' then r.daily else r.weekly end;
    for d in select c.* from game.challenge_defs c where c.id in (select jsonb_array_elements_text(v_set -> 'ids')) loop
      if not coalesce((v_set -> 'done' ->> d.id)::boolean, false) and coalesce((v_set -> 'progress' ->> d.id)::integer, 0) >= d.goal then
        v_set := jsonb_set(v_set, array['done', d.id], 'true'::jsonb);
        r.xp := r.xp + d.xp; v_xp := v_xp + d.xp;
      end if;
    end loop;
    if not coalesce((v_set ->> 'bonus')::boolean, false)
       and (select bool_and(coalesce((v_set -> 'done' ->> x)::boolean, false)) from jsonb_array_elements_text(v_set -> 'ids') x) then
      v_bonus := case k when 'daily' then 150 else 500 end;
      v_set := jsonb_set(v_set, '{bonus}', 'true'::jsonb);
      r.xp := r.xp + v_bonus; v_xp := v_xp + v_bonus;
    end if;
    if k = 'daily' then r.daily := v_set; else r.weekly := v_set; end if;
  end loop;

  -- Achievements.
  for d in select a.* from game.achievement_defs a order by a.sort, a.goal loop
    if not (r.unlocked ? d.id) and game.stat(r, d.stat) >= d.goal then
      r.unlocked := r.unlocked || jsonb_build_object(d.id, now());
      r.xp := r.xp + d.xp; v_xp := v_xp + d.xp;
      v_new := v_new || d.id;
    end if;
  end loop;

  -- The pop-up waits (and grows) until the app shows it.
  if cardinality(v_new) > 0 or game.level_for(r.xp) > v_from then
    r.pending := jsonb_build_object(
      'achievements', coalesce(r.pending -> 'achievements', '[]'::jsonb) || to_jsonb(v_new),
      'level_from', coalesce((r.pending ->> 'level_from')::integer, v_from),
      'level_to', game.level_for(r.xp));
  end if;
  r.last_game := jsonb_build_object('id', p_game,
    'xp', case when r.last_game ->> 'id' = p_game then coalesce((r.last_game ->> 'xp')::integer, 0) else 0 end + v_xp);

  update public.player_progress set
    xp = r.xp, stats = r.stats, days = r.days, streak_current = r.streak_current, streak_best = r.streak_best,
    streak_last = r.streak_last, unlocked = r.unlocked, daily = r.daily, weekly = r.weekly,
    pending = r.pending, last_game = r.last_game, updated_at = now()
  where user_id = r.user_id;
end $$;

/**
 * One finished 60-second round for a player (elimination or solo).
 * p_words: the player's words with their server times, [{word, at}]; p_started: when the round began.
 */
create or replace function game.progress_round(
  p_user uuid, p_game text, p_round integer, p_mode text, p_started timestamptz, p_score integer, p_words jsonb,
  p_survived boolean default null, p_margin integer default null, p_was_last boolean default false, p_reached_champ boolean default false
) returns void
language plpgsql set search_path = '' as $$
declare
  r public.player_progress%rowtype;
  v_words integer; v6 integer; v7 integer; v8 integer; v9 integer; v_early integer;
  v_burst boolean;
begin
  insert into game.progress_events (user_id, event_id) values (p_user, 'round:' || p_game || ':' || p_round) on conflict do nothing;
  if not found then return; end if;
  r := game.progress_row(p_user);

  select count(*), count(*) filter (where length(t.word) >= 6), count(*) filter (where length(t.word) >= 7),
         count(*) filter (where length(t.word) >= 8), count(*) filter (where length(t.word) >= 9),
         count(*) filter (where t.at <= p_started + interval '15 seconds')
  into v_words, v6, v7, v8, v9, v_early
  from jsonb_to_recordset(coalesce(p_words, '[]'::jsonb)) as t(word text, at timestamptz);
  -- Five words inside any 15 seconds of the round.
  select exists (
    select 1 from (select t.at, lead(t.at, 4) over (order by t.at) as fifth
                   from jsonb_to_recordset(coalesce(p_words, '[]'::jsonb)) as t(word text, at timestamptz)) x
    where x.fifth is not null and x.fifth - x.at <= interval '15 seconds') into v_burst;

  r.stats := game.add_stat(r, 'words', v_words);
  r.stats := game.add_stat(r, 'words6', v6);
  r.stats := game.add_stat(r, 'words7', v7);
  r.stats := game.add_stat(r, 'words8', v8);
  r.stats := game.add_stat(r, 'words9', v9);
  if v_burst then r.stats := game.add_stat(r, 'speedBursts', 1); end if;
  if p_score >= 1000 then r.stats := game.add_stat(r, 'bigRounds', 1); end if;

  r.daily := game.bump_set(r.daily, 'words', v_words);  r.weekly := game.bump_set(r.weekly, 'words', v_words);
  r.weekly := game.bump_set(r.weekly, 'words7', v7);
  r.daily := game.bump_set(r.daily, 'word7', least(v7, 1), true);
  r.daily := game.bump_set(r.daily, 'roundWords', v_words, true);
  r.daily := game.bump_set(r.daily, 'roundScore', p_score, true);
  r.daily := game.bump_set(r.daily, 'earlyWords', v_early, true);

  if p_mode = 'multi' and p_survived then
    r.stats := game.add_stat(r, 'roundsSurvived', 1);
    r.daily := game.bump_set(r.daily, 'roundsSurvived', 1); r.weekly := game.bump_set(r.weekly, 'roundsSurvived', 1);
    if p_margin is not null and p_margin <= 20 then r.stats := game.add_stat(r, 'closeCalls', 1); r.daily := game.bump_set(r.daily, 'closeCall', 1, true); end if;
    if p_was_last then r.stats := game.add_stat(r, 'comebacks', 1); r.daily := game.bump_set(r.daily, 'comeback', 1, true); end if;
    if p_reached_champ then
      r.stats := game.add_stat(r, 'championshipReached', 1);
      r.daily := game.bump_set(r.daily, 'championship', 1); r.weekly := game.bump_set(r.weekly, 'championship', 1);
    end if;
  end if;
  perform game.settle(r, p_game, 0);
end $$;

/** The player's elimination match is over (knocked out, or won/lost the championship round). */
create or replace function game.progress_match(p_user uuid, p_game text, p_won boolean) returns void
language plpgsql set search_path = '' as $$
declare
  r public.player_progress%rowtype;
  v_xp integer := 25 + case when p_won then 100 else 0 end;
begin
  insert into game.progress_events (user_id, event_id) values (p_user, 'match:' || p_game) on conflict do nothing;
  if not found then return; end if;
  r := game.progress_row(p_user);
  r.xp := r.xp + v_xp;
  r.stats := game.add_stat(r, 'matchesCompleted', 1);
  r.stats := game.add_stat(r, 'gamesCompleted', 1);
  r.daily := game.bump_set(r.daily, 'matches', 1); r.weekly := game.bump_set(r.weekly, 'matches', 1);
  r.daily := game.bump_set(r.daily, 'games', 1);
  if p_won then
    r.stats := game.add_stat(r, 'wins', 1);
    r.weekly := game.bump_set(r.weekly, 'wins', 1);
  end if;
  r := game.played_today(r);
  perform game.settle(r, p_game, v_xp);
end $$;

/** A finished solo challenge. */
create or replace function game.progress_solo(p_user uuid, p_game text) returns void
language plpgsql set search_path = '' as $$
declare r public.player_progress%rowtype;
begin
  insert into game.progress_events (user_id, event_id) values (p_user, 'solo:' || p_game) on conflict do nothing;
  if not found then return; end if;
  r := game.progress_row(p_user);
  r.xp := r.xp + 15;
  r.stats := game.add_stat(r, 'soloCompleted', 1);
  r.stats := game.add_stat(r, 'gamesCompleted', 1);
  r.daily := game.bump_set(r.daily, 'games', 1);
  r := game.played_today(r);
  perform game.settle(r, p_game, 15);
end $$;

/**
 * Was the player strictly in last place at some moment after the first 20
 * seconds of this round? Rebuilt from everyone's word times.
 */
create or replace function game.was_last(p_match uuid, p_round integer, p_player uuid, p_started timestamptz, p_ends timestamptz) returns boolean
language sql stable set search_path = '' as $$
  with players as (
    select distinct p.id from public.match_players p
    where p.match_id = p_match and (p.status = 'active' or p.eliminated_round = p_round)
  ),
  moments as (
    select p_started + interval '20 seconds' as t
    union select w.at from public.round_words w where w.match_id = p_match and w.round = p_round and w.at >= p_started + interval '20 seconds' and w.at <= p_ends
  ),
  scores as (
    select m.t, pl.id, coalesce((select sum(w.points) from public.round_words w where w.match_id = p_match and w.round = p_round and w.player_id = pl.id and w.at <= m.t), 0) as s
    from moments m cross join players pl
  )
  select coalesce(bool_or(x.mine < x.others_min), false) from (
    select sc.t, max(sc.s) filter (where sc.id = p_player) as mine, min(sc.s) filter (where sc.id <> p_player) as others_min
    from scores sc group by sc.t
  ) x where x.others_min is not null
$$;

/** Award progress for every person (not bot) who played the round that just ended. Called from end_round. */
create or replace function game.progress_after_round(p_match uuid, p_out uuid, p_active integer) returns void
language plpgsql set search_path = '' as $$
declare
  m public.matches%rowtype;
  pl record;
  v_out_score integer;
begin
  select * into m from public.matches where id = p_match;
  select round_score into v_out_score from public.match_players where id = p_out;
  for pl in
    select p.* from public.match_players p
    where p.match_id = p_match and p.user_id is not null and (p.status = 'active' or p.id = p_out)
  loop
    perform game.progress_round(
      pl.user_id, p_match::text, m.round, 'multi', m.round_started_at, pl.round_score,
      (select coalesce(jsonb_agg(jsonb_build_object('word', w.word, 'at', w.at)), '[]'::jsonb)
       from public.round_words w where w.match_id = p_match and w.round = m.round and w.player_id = pl.id),
      pl.id <> p_out, pl.round_score - v_out_score,
      game.was_last(p_match, m.round, pl.id, m.round_started_at, m.round_ends_at),
      pl.id <> p_out and p_active - 1 = 2);
  end loop;
end $$;

-- ── Elimination: award progress when each round ends ───────────────────────
create or replace function game.end_round(p_match uuid)
 returns void
 language plpgsql
 set search_path to ''
as $function$
declare
  m public.matches%rowtype;
  v_active integer;
  v_out public.match_players%rowtype;
  v_winner public.match_players%rowtype;
  v_standings jsonb;
begin
  select * into m from public.matches where id = p_match;
  perform game.apply_bot_words(p_match, m.round_ends_at);

  select count(*) into v_active from public.match_players where match_id = p_match and status = 'active';

  -- Rank by round score; ties go to whoever reached the score first, then the
  -- match's fixed random tie-break. Exactly one player (the last) is out.
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'round_score', p.round_score, 'total_score', p.total_score)
                            order by p.round_score desc, p.reached_at asc nulls last, p.tiebreak desc), '[]'::jsonb)
  into v_standings
  from public.match_players p where p.match_id = p_match and p.status = 'active';

  select * into v_out from public.match_players p
  where p.match_id = p_match and p.status = 'active'
  order by p.round_score asc, p.reached_at desc nulls first, p.tiebreak asc
  limit 1;

  -- XP and achievements for everyone who played this round (before statuses change).
  perform game.progress_after_round(p_match, v_out.id, v_active);

  update public.match_players set status = 'eliminated', placement = v_active, eliminated_round = m.round
  where id = v_out.id;

  if v_out.user_id is not null then
    insert into public.match_results (user_id, won, placement, total_score, words_found, longest_word)
    values (v_out.user_id, false, v_active, v_out.total_score, v_out.words_found, nullif(v_out.longest_word, ''));
    perform game.progress_match(v_out.user_id, p_match::text, false);
  end if;

  if v_active - 1 <= 1 then
    select * into v_winner from public.match_players where match_id = p_match and status = 'active' limit 1;
    update public.match_players set placement = 1 where id = v_winner.id;
    if v_winner.user_id is not null then
      insert into public.match_results (user_id, won, placement, total_score, words_found, longest_word)
      values (v_winner.user_id, true, 1, v_winner.total_score, v_winner.words_found, nullif(v_winner.longest_word, ''));
      perform game.progress_match(v_winner.user_id, p_match::text, true);
    end if;
    update public.matches set
      status = 'final', winner_id = v_winner.id,
      last_elimination = jsonb_build_object('round', m.round, 'player_id', v_out.id, 'round_score', v_out.round_score, 'standings', v_standings, 'remaining', 1)
    where id = p_match;
  else
    update public.matches set
      status = 'between', next_round_at = now() + interval '10 seconds',
      last_elimination = jsonb_build_object('round', m.round, 'player_id', v_out.id, 'round_score', v_out.round_score, 'standings', v_standings, 'remaining', v_active - 1)
    where id = p_match;
  end if;
  delete from game.bot_plans where match_id = p_match;
end;
$function$;

-- One word at a time: a single request carries at most 3 queued words.
create or replace function public.mm_submit(p_match uuid, p_words text[])
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_me uuid := auth.uid();
  m public.matches%rowtype;
  me public.match_players%rowtype;
  src game.sources%rowtype;
  v_raw text;
  v_word text;
  v_letters text;
  v_points integer;
  v_accepting boolean;
  v_results jsonb := '[]'::jsonb;
  v_reason text;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  perform game.advance(p_match);
  select * into m from public.matches where id = p_match;
  select * into me from public.match_players where match_id = p_match and user_id = v_me for update;
  if me.id is null then raise exception 'Not in this match'; end if;
  select * into src from game.sources where source = m.source;
  v_accepting := m.status = 'round' and now() < m.round_ends_at and me.status = 'active';

  foreach v_raw in array coalesce(p_words[1:3], '{}') loop
    v_word := lower(btrim(v_raw));
    v_letters := regexp_replace(v_word, '[^a-z]', '', 'g');
    v_reason := null;
    if not v_accepting then v_reason := 'closed';
    elsif v_word !~ '^[a-z]*$' then v_reason := case when char_length(v_letters) < 2 then 'too-short' else 'not-word' end;
    elsif char_length(v_word) < 2 then v_reason := 'too-short';
    elsif exists (select 1 from public.round_words w where w.match_id = p_match and w.round = m.round and w.player_id = me.id and w.word = v_word) then v_reason := 'duplicate';
    elsif v_word = any (src.banned) then v_reason := 'source-word';
    elsif not game.fits(game.letter_counts(v_word), src.counts) then v_reason := 'letters';
    elsif not exists (select 1 from game.words w where w.word = v_word) then v_reason := 'not-word';
    end if;

    if v_reason is null then
      v_points := game.points(char_length(v_word));
      insert into public.round_words (match_id, round, player_id, word, points) values (p_match, m.round, me.id, v_word, v_points);
      update public.match_players set
        round_score = round_score + v_points,
        total_score = total_score + v_points,
        words_found = words_found + 1,
        longest_word = case when char_length(v_word) > char_length(longest_word) then v_word else longest_word end,
        reached_at = now()
      where id = me.id;
      v_results := v_results || jsonb_build_object('raw', v_raw, 'ok', true, 'word', v_word, 'points', v_points);
    else
      v_results := v_results || jsonb_build_object('raw', v_raw, 'ok', false, 'word', v_word, 'reason', v_reason);
    end if;
  end loop;
  return v_results;
end;
$function$;

-- ── Solo challenge API ──────────────────────────────────────────────────────
create or replace function game.finish_solo(p_game uuid) returns void
language plpgsql set search_path = '' as $$
declare g public.solo_games%rowtype;
begin
  select * into g from public.solo_games where id = p_game for update;
  if g.id is null or g.finished then return; end if;
  update public.solo_games set finished = true, score = coalesce((select sum(points) from public.solo_words where game_id = p_game), 0) where id = p_game
  returning * into g;
  perform game.progress_round(g.user_id, p_game::text, 1, 'single', g.started_at, g.score,
    (select coalesce(jsonb_agg(jsonb_build_object('word', w.word, 'at', w.at)), '[]'::jsonb) from public.solo_words w where w.game_id = p_game));
  perform game.progress_solo(g.user_id, p_game::text);
  update public.profiles set solo_best = greatest(solo_best, g.score) where id = g.user_id;
end $$;

/** Start a 60-second solo round on the server. The 60 seconds start now. */
create or replace function public.solo_start(p_avoid text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  src game.sources%rowtype;
  g public.solo_games%rowtype;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  -- Close any earlier solo game still open.
  perform game.finish_solo(x.id) from public.solo_games x where x.user_id = v_me and not x.finished;
  select * into src from game.sources s where s.source is distinct from p_avoid order by random() limit 1;
  insert into public.solo_games (user_id, source, ends_at, possible_words)
  values (v_me, src.source, now() + interval '60 seconds', (
    select count(*) from game.words w
    where w.len <= src.letters and (w.mask & ~src.mask) = 0 and game.fits(w.counts, src.counts) and not (w.word = any (src.banned))))
  returning * into g;
  return jsonb_build_object('id', g.id, 'source', g.source, 'possible_words', g.possible_words,
    'started_at', g.started_at, 'ends_at', g.ends_at, 'server_now', now());
end $$;

create or replace function public.solo_submit(p_game uuid, p_word text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  g public.solo_games%rowtype;
  src game.sources%rowtype;
  v_word text := lower(btrim(p_word));
  v_reason text;
  v_points integer;
begin
  select * into g from public.solo_games where id = p_game and user_id = v_me;
  if g.id is null then raise exception 'Not your game'; end if;
  select * into src from game.sources where source = g.source;
  if g.finished or now() > g.ends_at + interval '1 second' then v_reason := 'closed';
  elsif v_word !~ '^[a-z]*$' then v_reason := 'not-word';
  elsif char_length(v_word) < 2 then v_reason := 'too-short';
  elsif exists (select 1 from public.solo_words w where w.game_id = p_game and w.word = v_word) then v_reason := 'duplicate';
  elsif v_word = any (src.banned) then v_reason := 'source-word';
  elsif not game.fits(game.letter_counts(v_word), src.counts) then v_reason := 'letters';
  elsif not exists (select 1 from game.words w where w.word = v_word) then v_reason := 'not-word';
  end if;
  if v_reason is not null then return jsonb_build_object('ok', false, 'word', v_word, 'reason', v_reason); end if;
  v_points := game.points(char_length(v_word));
  insert into public.solo_words (game_id, word, points) values (p_game, v_word, v_points);
  return jsonb_build_object('ok', true, 'word', v_word, 'points', v_points);
end $$;

/** Finish a solo game whose 60 seconds are up (the sweeper also does this if the app was closed). */
create or replace function public.solo_finish(p_game uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  g public.solo_games%rowtype;
begin
  select * into g from public.solo_games where id = p_game and user_id = v_me;
  if g.id is null then raise exception 'Not your game'; end if;
  if now() < g.ends_at - interval '2 seconds' then raise exception 'Not over yet'; end if;
  perform game.finish_solo(p_game);
  select * into g from public.solo_games where id = p_game;
  return jsonb_build_object('score', g.score, 'words', (select count(*) from public.solo_words where game_id = p_game));
end $$;

-- ── Progress API ────────────────────────────────────────────────────────────
/** The signed-in player's progress. p_tz: the phone's time zone (IANA name), saved for day boundaries. */
create or replace function public.my_progress(p_tz text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  r public.player_progress%rowtype;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  insert into public.player_progress (user_id, tz)
  values (v_me, case when p_tz is not null and exists (select 1 from pg_timezone_names where name = p_tz) then p_tz else 'UTC' end)
  on conflict do nothing;
  if p_tz is not null and exists (select 1 from pg_timezone_names where name = p_tz) then
    update public.player_progress set tz = p_tz where user_id = v_me and tz <> p_tz;
  end if;
  r := game.progress_row(v_me);
  update public.player_progress set daily = r.daily, weekly = r.weekly where user_id = v_me;
  -- A streak that has lapsed shows as 0.
  if r.streak_last is null or r.streak_last < game.local_day(r.tz) - 1 then r.streak_current := 0; end if;
  return jsonb_build_object(
    'xp', r.xp, 'stats', r.stats, 'days', to_jsonb(r.days),
    'streak', jsonb_build_object('current', r.streak_current, 'best', r.streak_best, 'last', r.streak_last),
    'unlocked', r.unlocked, 'daily', r.daily, 'weekly', r.weekly, 'pending', r.pending, 'last_game', r.last_game,
    'today', game.local_day(r.tz), 'server_now', now());
end $$;

/** Take (and clear) the waiting pop-up: newly unlocked achievements and any level-up. */
create or replace function public.take_celebration() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid(); v jsonb;
begin
  select pending into v from public.player_progress where user_id = v_me for update;
  update public.player_progress set pending = null where user_id = v_me and pending is not null;
  return v;
end $$;

/** Developer: start this player's progress over. */
create or replace function public.reset_my_progress() returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  delete from public.player_progress where user_id = v_me;
  delete from game.progress_events where user_id = v_me;
end $$;

/** Developer (only while game.config dev_tools is on): look like a regular player with about half of everything. */
create or replace function public.dev_simulate_progress() returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := auth.uid();
  r public.player_progress%rowtype;
  v_day date;
  d record;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if coalesce((select value from game.config where key = 'dev_tools'), 'false') <> 'true' then raise exception 'Developer tools are off'; end if;
  r := game.progress_row(v_me);
  v_day := game.local_day(r.tz);
  r.stats := jsonb_build_object('words', 1240, 'words6', 260, 'words7', 96, 'words8', 30, 'words9', 12, 'gamesCompleted', 84,
    'matchesCompleted', 61, 'wins', 55, 'roundsSurvived', 118, 'championshipReached', 55, 'comebacks', 6, 'closeCalls', 3,
    'speedBursts', 7, 'bigRounds', 2, 'soloCompleted', 23, 'streakBest', 7);
  r.days := array(select v_day - g from generate_series(0, 20) g order by 1);
  r.streak_current := 7; r.streak_best := 7; r.streak_last := v_day;
  r.unlocked := '{}'::jsonb;
  for d in select a.* from game.achievement_defs a loop
    if game.stat(r, d.stat) >= d.goal then r.unlocked := r.unlocked || jsonb_build_object(d.id, now()); end if;
  end loop;
  r.xp := 39600 + 1450;  -- level 25, part of the way to 26
  update public.player_progress set xp = r.xp, stats = r.stats, days = r.days, streak_current = 7, streak_best = 7, streak_last = v_day,
    unlocked = r.unlocked, daily = r.daily, weekly = r.weekly, pending = null, last_game = null, updated_at = now()
  where user_id = v_me;
end $$;

revoke all on function public.my_progress(text), public.take_celebration(), public.reset_my_progress(), public.dev_simulate_progress(),
  public.solo_start(text), public.solo_submit(uuid, text), public.solo_finish(uuid) from public, anon;
grant execute on function public.my_progress(text), public.take_celebration(), public.reset_my_progress(), public.dev_simulate_progress(),
  public.solo_start(text), public.solo_submit(uuid, text), public.solo_finish(uuid) to authenticated;

-- ── Sweeper: also finish solo games whose time ran out while the app was closed ──
create or replace function game.sweep()
 returns void
 language plpgsql
 set search_path to ''
as $function$
declare
  v_id uuid;
begin
  -- Lobbies everyone left before they started: just remove them.
  delete from public.matches m
  where m.status = 'lobby'
    and not exists (select 1 from public.match_players p where p.match_id = m.id and not p.is_bot);

  -- Finished matches older than a week.
  delete from public.matches m where m.status = 'final' and m.created_at < now() - interval '7 days';

  for v_id in
    select m.id from public.matches m
    where (m.status = 'lobby' and now() >= m.created_at + interval '4 seconds')
       or (m.status = 'prematch' and now() >= m.prematch_ends_at)
       or (m.status = 'round' and now() >= m.round_ends_at)
       or (m.status = 'between' and now() >= m.next_round_at)
    order by m.created_at
  loop
    perform 1 from public.matches where id = v_id for update skip locked;
    if found then
      perform game.advance(v_id);
    end if;
  end loop;

  -- Solo games: finish any that ran out, and clear old ones.
  for v_id in select s.id from public.solo_games s where not s.finished and now() >= s.ends_at + interval '5 seconds' loop
    perform game.finish_solo(v_id);
  end loop;
  delete from public.solo_games s where s.finished and s.started_at < now() - interval '7 days';
  delete from game.progress_events e where e.at < now() - interval '30 days';
end;
$function$;
