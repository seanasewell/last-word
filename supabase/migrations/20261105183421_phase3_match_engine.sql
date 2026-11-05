-- Last word, phase 3b: server-run elimination matches.
-- The server is the referee: it picks each round's source, keeps time,
-- validates and scores words, plays the bots, eliminates the lowest score,
-- and records results. Clients call mm_join / mm_tick / mm_submit / mm_leave.
-- Matches advance lazily: every mm_tick (each player calls it ~1/s) moves
-- the match forward to wherever the clock says it should be.

-- ── Tables ──────────────────────────────────────────────────────────────────
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'lobby' check (status in ('lobby', 'prematch', 'round', 'between', 'final')),
  created_at timestamptz not null default now(),
  lobby_closes_at timestamptz not null default now() + interval '15 seconds',
  prematch_ends_at timestamptz,
  round smallint not null default 0,
  source text,
  possible_words integer not null default 0,
  round_started_at timestamptz,
  round_ends_at timestamptz,
  next_round_at timestamptz,
  used_sources text[] not null default '{}',
  last_elimination jsonb,
  winner_id uuid
);
create index matches_open_lobby_idx on public.matches (created_at) where status = 'lobby';

create table public.match_players (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  is_bot boolean not null default false,
  bot_style text,
  name text not null,
  photo_url text,
  hue smallint not null,
  seat smallint not null check (seat between 0 and 5),
  joined_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'eliminated')),
  placement smallint,
  eliminated_round smallint,
  round_score integer not null default 0,
  total_score integer not null default 0,
  words_found integer not null default 0,
  longest_word text not null default '',
  reached_at timestamptz,
  tiebreak double precision not null default random(),
  unique (match_id, seat)
);
create unique index match_players_one_seat_per_user on public.match_players (match_id, user_id) where user_id is not null;
create index match_players_user_idx on public.match_players (user_id);

create table public.round_words (
  match_id uuid not null references public.matches (id) on delete cascade,
  round smallint not null,
  player_id uuid not null references public.match_players (id) on delete cascade,
  word text not null,
  points integer not null,
  at timestamptz not null default now(),
  primary key (match_id, round, player_id, word)
);

create table game.bot_plans (
  match_id uuid not null references public.matches (id) on delete cascade,
  round smallint not null,
  player_id uuid not null references public.match_players (id) on delete cascade,
  word text not null,
  due_at timestamptz not null,
  primary key (match_id, round, player_id, word)
);
create index bot_plans_due_idx on game.bot_plans (match_id, round, due_at);

-- Everything goes through the functions below; no direct table access.
alter table public.matches enable row level security;
alter table public.match_players enable row level security;
alter table public.round_words enable row level security;
alter table game.bot_plans enable row level security;

-- Results are now written only by the server.
drop policy if exists "Players can record their own results" on public.match_results;

-- ── Bots ────────────────────────────────────────────────────────────────────
-- Same five opponents and skill profiles as the app.
create or replace function game.bot_roster()
returns table (name text, hue smallint, style text, int_min real, int_max real, bias real,
               know0 real, know1 real, know2 real, long_pen real, warm_min real, warm_max real, stall real)
language sql
immutable
set search_path = ''
as $$
  values
    ('Pip',   168::smallint, 'speedy',     2.6::real,  4.4::real, -1.4::real, 0.75::real, 0.40::real, 0.06::real, 0.16::real, 1.0::real, 2.5::real, 0.06::real),
    ('Juno',  280::smallint, 'balanced',   3.8,  6.4,  0.5,  0.70, 0.42, 0.10, 0.09, 2.0, 4.0, 0.10),
    ('Atlas',  30::smallint, 'long-words', 8.0, 13.0,  3.0,  0.60, 0.45, 0.18, 0.02, 5.0, 8.0, 0.12),
    ('Mika',  340::smallint, 'streaky',    2.4, 10.0,  0.2,  0.65, 0.35, 0.08, 0.10, 1.5, 5.0, 0.22),
    ('Rook',  205::smallint, 'methodical', 5.0,  8.0,  1.1,  0.70, 0.50, 0.12, 0.06, 3.0, 6.0, 0.08)
$$;

create or replace function game.hue_for(id uuid)
returns smallint
language sql
immutable
set search_path = ''
as $$
  select (abs(hashtext(id::text)) % 360)::smallint;
$$;

create or replace function game.add_bot(p_match uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_bot record;
  v_seat smallint;
begin
  select s into v_seat from generate_series(0, 5) as s
  where not exists (select 1 from public.match_players p where p.match_id = p_match and p.seat = s)
  order by s limit 1;
  if v_seat is null then return; end if;
  select r.* into v_bot from game.bot_roster() r
  where not exists (select 1 from public.match_players p where p.match_id = p_match and p.is_bot and p.name = r.name)
  order by random() limit 1;
  if v_bot is null then return; end if;
  insert into public.match_players (match_id, is_bot, bot_style, name, hue, seat)
  values (p_match, true, v_bot.style, v_bot.name, v_bot.hue, v_seat);
end;
$$;

-- Plan each bot's words for a round: which real dictionary words it "knows"
-- for this source and when it will play them. Played later by apply_bot_words.
create or replace function game.plan_bots(p_match uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  m public.matches%rowtype;
  src game.sources%rowtype;
  b record;
  r record;
  v_t real;
  v_form real;
  v_pick record;
  v_delay real;
begin
  select * into m from public.matches where id = p_match;
  select * into src from game.sources where source = m.source;

  create temp table if not exists pg_temp.round_cands (word text, tier smallint, len smallint) on commit drop;
  truncate pg_temp.round_cands;
  insert into pg_temp.round_cands
  select w.word, w.tier, w.len from game.words w
  where w.len <= src.letters and (w.mask & ~src.mask) = 0 and game.fits(w.counts, src.counts) and not (w.word = any (src.banned));

  for b in
    select p.id, r2.* from public.match_players p
    join game.bot_roster() r2 on r2.name = p.name
    where p.match_id = p_match and p.is_bot and p.status = 'active'
  loop
    v_form := 0.78 + random() * 0.47;
    create temp table if not exists pg_temp.known (word text, len smallint, used boolean) on commit drop;
    truncate pg_temp.known;
    insert into pg_temp.known
    select c.word, c.len, false from pg_temp.round_cands c
    where random() < (case c.tier when 0 then b.know0 when 1 then b.know1 else b.know2 end)
                     * greatest(0.05, 1 - b.long_pen * greatest(0, c.len - 4));
    v_t := b.warm_min + random() * (b.warm_max - b.warm_min);
    while v_t < 59.6 loop
      -- Weighted random pick (longer words favoured by `bias`).
      select k.word, k.len into v_pick from pg_temp.known k
      where not k.used
      order by -ln(greatest(random(), 1e-9)) / (power(k.len, b.bias) * (0.6 + random() * 0.8)) limit 1;
      exit when v_pick.word is null;
      update pg_temp.known set used = true where word = v_pick.word;
      insert into game.bot_plans (match_id, round, player_id, word, due_at)
      values (p_match, m.round, b.id, v_pick.word, m.round_started_at + make_interval(secs => v_t))
      on conflict do nothing;
      v_delay := 1.22 * (b.int_min + random() * (b.int_max - b.int_min)) * (0.55 + 0.11 * v_pick.len) / v_form;
      if random() < b.stall then v_delay := v_delay + 2 + random() * 3; end if;
      v_t := v_t + v_delay;
    end loop;
  end loop;
end;
$$;

-- Play every planned bot word that is due by `p_upto`.
create or replace function game.apply_bot_words(p_match uuid, p_upto timestamptz)
returns void
language plpgsql
set search_path = ''
as $$
declare
  m public.matches%rowtype;
  bp record;
  v_points integer;
begin
  select * into m from public.matches where id = p_match;
  for bp in
    select b.* from game.bot_plans b
    join public.match_players p on p.id = b.player_id and p.status = 'active'
    where b.match_id = p_match and b.round = m.round and b.due_at <= p_upto
    order by b.due_at
  loop
    v_points := game.points(char_length(bp.word));
    insert into public.round_words (match_id, round, player_id, word, points, at)
    values (p_match, m.round, bp.player_id, bp.word, v_points, bp.due_at)
    on conflict do nothing;
    if found then
      update public.match_players set
        round_score = round_score + v_points,
        total_score = total_score + v_points,
        words_found = words_found + 1,
        longest_word = case when char_length(bp.word) > char_length(longest_word) then bp.word else longest_word end,
        reached_at = bp.due_at
      where id = bp.player_id;
    end if;
  end loop;
  delete from game.bot_plans b where b.match_id = p_match and b.round = m.round and b.due_at <= p_upto;
end;
$$;

-- ── Match progression ───────────────────────────────────────────────────────
create or replace function game.start_round(p_match uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  m public.matches%rowtype;
  v_source text;
  src game.sources%rowtype;
begin
  select * into m from public.matches where id = p_match;
  -- A brand-new source every round, never one already used in this match.
  select s.source into v_source from game.sources s
  where not (s.source = any (m.used_sources)) order by random() limit 1;
  select * into src from game.sources where source = v_source;

  update public.matches set
    status = 'round',
    round = m.round + 1,
    source = v_source,
    used_sources = m.used_sources || v_source,
    round_started_at = now(),
    round_ends_at = now() + interval '60 seconds',
    next_round_at = null,
    possible_words = (
      select count(*) from game.words w
      where w.len <= src.letters and (w.mask & ~src.mask) = 0 and game.fits(w.counts, src.counts) and not (w.word = any (src.banned))
    )
  where id = p_match;

  update public.match_players set round_score = 0, reached_at = null
  where match_id = p_match and status = 'active';

  perform game.plan_bots(p_match);
end;
$$;

create or replace function game.end_round(p_match uuid)
returns void
language plpgsql
set search_path = ''
as $$
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

  update public.match_players set status = 'eliminated', placement = v_active, eliminated_round = m.round
  where id = v_out.id;

  if v_out.user_id is not null then
    insert into public.match_results (user_id, won, placement, total_score, words_found, longest_word)
    values (v_out.user_id, false, v_active, v_out.total_score, v_out.words_found, nullif(v_out.longest_word, ''));
  end if;

  if v_active - 1 <= 1 then
    select * into v_winner from public.match_players where match_id = p_match and status = 'active' limit 1;
    update public.match_players set placement = 1 where id = v_winner.id;
    if v_winner.user_id is not null then
      insert into public.match_results (user_id, won, placement, total_score, words_found, longest_word)
      values (v_winner.user_id, true, 1, v_winner.total_score, v_winner.words_found, nullif(v_winner.longest_word, ''));
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
$$;

-- Move a match forward to wherever the clock says it should be.
create or replace function game.advance(p_match uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  m public.matches%rowtype;
  v_count integer;
  v_humans integer;
  v_target integer;
  i integer;
begin
  for i in 1..12 loop
    select * into m from public.matches where id = p_match for update;
    exit when not found;

    if m.status = 'lobby' then
      select count(*), count(*) filter (where not is_bot) into v_count, v_humans
      from public.match_players where match_id = p_match;
      -- Bots trickle in after a few seconds, then fill every empty seat at close.
      v_target := case when now() >= m.lobby_closes_at then 6
                       else least(6, v_count + greatest(0, floor((extract(epoch from now() - m.created_at) - 4) / 1.5)::integer - (v_count - v_humans))) end;
      while v_count < v_target loop
        perform game.add_bot(p_match);
        v_count := v_count + 1;
      end loop;
      if v_count >= 6 then
        update public.matches set status = 'prematch', prematch_ends_at = now() + interval '3 seconds' where id = p_match;
      end if;
      exit;
    elsif m.status = 'prematch' then
      exit when now() < m.prematch_ends_at;
      perform game.start_round(p_match);
    elsif m.status = 'round' then
      if now() < m.round_ends_at then
        perform game.apply_bot_words(p_match, now());
        exit;
      end if;
      perform game.end_round(p_match);
    elsif m.status = 'between' then
      exit when now() < m.next_round_at;
      perform game.start_round(p_match);
    else
      exit;
    end if;
  end loop;
end;
$$;

-- Snapshot of a match for one of its players.
create or replace function game.snapshot(p_match uuid, p_me uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'server_now', now(),
    'match', to_jsonb(m) - 'used_sources',
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'photo_url', p.photo_url, 'hue', p.hue, 'is_bot', p.is_bot, 'seat', p.seat,
        'status', p.status, 'placement', p.placement, 'eliminated_round', p.eliminated_round,
        'round_score', p.round_score, 'total_score', p.total_score, 'words_found', p.words_found,
        'longest_word', p.longest_word, 'reached_at', p.reached_at, 'tiebreak', p.tiebreak,
        'is_me', p.user_id = p_me) order by p.seat), '[]'::jsonb)
      from public.match_players p where p.match_id = m.id
    ),
    'my_words', (
      select coalesce(jsonb_agg(jsonb_build_object('word', w.word, 'points', w.points, 'at', w.at) order by w.at desc), '[]'::jsonb)
      from public.round_words w
      join public.match_players p on p.id = w.player_id and p.user_id = p_me
      where w.match_id = m.id and w.round = m.round
    )
  )
  from public.matches m where m.id = p_match;
$$;

-- ── Client API ──────────────────────────────────────────────────────────────
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

  -- Join the oldest open lobby with a free seat, or open a new one.
  select m.id into v_match from public.matches m
  where m.status = 'lobby' and m.lobby_closes_at > now() + interval '2 seconds'
    and (select count(*) from public.match_players p where p.match_id = m.id) < 6
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

create or replace function public.mm_tick(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null or not exists (select 1 from public.match_players where match_id = p_match and user_id = v_me) then
    raise exception 'Not in this match';
  end if;
  perform game.advance(p_match);
  return game.snapshot(p_match, v_me);
end;
$$;

-- Submit one or more words (comma-separated in the app) for the current round.
create or replace function public.mm_submit(p_match uuid, p_words text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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

  foreach v_raw in array coalesce(p_words[1:20], '{}') loop
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
$$;

-- Leave a match. In the lobby your seat is freed; once it has started you
-- stay in the standings (and will be eliminated) but stop playing.
create or replace function public.mm_leave(p_match uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.match_players p
  using public.matches m
  where p.match_id = p_match and p.user_id = auth.uid() and m.id = p.match_id and m.status = 'lobby';
end;
$$;

revoke all on function public.mm_join() from public, anon;
revoke all on function public.mm_tick(uuid) from public, anon;
revoke all on function public.mm_submit(uuid, text[]) from public, anon;
revoke all on function public.mm_leave(uuid) from public, anon;
grant execute on function public.mm_join() to authenticated;
grant execute on function public.mm_tick(uuid) to authenticated;
grant execute on function public.mm_submit(uuid, text[]) to authenticated;
grant execute on function public.mm_leave(uuid) to authenticated;
