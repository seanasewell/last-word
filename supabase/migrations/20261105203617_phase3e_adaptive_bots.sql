-- Last word, phase 3e: bots adapt to each player.
-- Every player has a hidden bot-difficulty level (1.0 = normal). Winning
-- matches nudges it up; getting knocked out early nudges it down. Bots in a
-- match play at the average level of the real people in it: at higher levels
-- they spot more words and play faster, at lower levels fewer and slower.
-- Stored in the private game schema so players can't change it.

create table game.player_skill (
  user_id uuid primary key references auth.users (id) on delete cascade,
  skill real not null default 1.0,
  matches integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table game.player_skill enable row level security;

-- Easiest and hardest the bots can get.
create or replace function game.skill_bounds(out lo real, out hi real)
language sql immutable set search_path = ''
as $$ select 0.55::real, 1.5::real $$;

-- After each recorded result, move the player's level by placement:
-- 1st +0.08, 2nd +0.04, 3rd +0.01, 4th -0.01, 5th -0.04, 6th -0.07.
create or replace function game.on_match_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delta real := case new.placement when 1 then 0.08 when 2 then 0.04 when 3 then 0.01
                                     when 4 then -0.01 when 5 then -0.04 else -0.07 end;
  b record;
begin
  select * into b from game.skill_bounds();
  insert into game.player_skill as s (user_id, skill, matches, updated_at)
  values (new.user_id, least(b.hi, greatest(b.lo, 1.0 + v_delta)), 1, now())
  on conflict (user_id) do update
    set skill = least(b.hi, greatest(b.lo, s.skill + v_delta)), matches = s.matches + 1, updated_at = now();
  return new;
end;
$$;

create trigger match_results_adjust_skill
after insert on public.match_results
for each row execute function game.on_match_result();

-- Bot difficulty for a match: the average level of its real players.
create or replace function game.match_skill(p_match uuid)
returns real
language sql stable set search_path = ''
as $$
  select coalesce(avg(coalesce(s.skill, 1.0)), 1.0)::real
  from public.match_players p left join game.player_skill s on s.user_id = p.user_id
  where p.match_id = p_match and not p.is_bot;
$$;

-- Plan bot words, scaled by the match's difficulty: how many words each bot
-- knows (× level) and how quickly it plays them (gaps ÷ level).
create or replace function game.plan_bots(p_match uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  m public.matches%rowtype;
  src game.sources%rowtype;
  b record;
  v_t real;
  v_form real;
  v_pick record;
  v_delay real;
  v_skill real := game.match_skill(p_match);
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
    join game.bot_roster() r2 on r2.style = p.bot_style
    where p.match_id = p_match and p.is_bot and p.status = 'active'
  loop
    v_form := 0.78 + random() * 0.47;
    create temp table if not exists pg_temp.known (word text, len smallint, used boolean) on commit drop;
    truncate pg_temp.known;
    insert into pg_temp.known
    select c.word, c.len, false from pg_temp.round_cands c
    where random() < least(0.95, (case c.tier when 0 then b.know0 when 1 then b.know1 else b.know2 end) * v_skill)
                     * greatest(0.05, 1 - b.long_pen * greatest(0, c.len - 4));
    v_t := (b.warm_min + random() * (b.warm_max - b.warm_min)) / v_skill;
    while v_t < 59.6 loop
      select k.word, k.len into v_pick from pg_temp.known k
      where not k.used
      order by -ln(greatest(random(), 1e-9)) / (power(k.len, b.bias) * (0.6 + random() * 0.8)) limit 1;
      exit when v_pick.word is null;
      update pg_temp.known set used = true where word = v_pick.word;
      insert into game.bot_plans (match_id, round, player_id, word, due_at)
      values (p_match, m.round, b.id, v_pick.word, m.round_started_at + make_interval(secs => v_t))
      on conflict do nothing;
      v_delay := 1.22 * (b.int_min + random() * (b.int_max - b.int_min)) * (0.55 + 0.11 * v_pick.len) / v_form / v_skill;
      if random() < b.stall then v_delay := v_delay + 2 + random() * 3; end if;
      v_t := v_t + v_delay;
    end loop;
  end loop;
end;
$$;

-- The signed-in player's current level (for developer controls).
create or replace function public.my_bot_skill()
returns real
language sql stable security definer set search_path = ''
as $$ select coalesce((select skill from game.player_skill where user_id = auth.uid()), 1.0)::real $$;

-- Developer reset of the signed-in player's level back to normal.
create or replace function public.reset_my_bot_skill()
returns void
language sql security definer set search_path = ''
as $$ delete from game.player_skill where user_id = auth.uid() $$;

revoke all on function public.my_bot_skill() from public, anon;
revoke all on function public.reset_my_bot_skill() from public, anon;
grant execute on function public.my_bot_skill() to authenticated;
grant execute on function public.reset_my_bot_skill() to authenticated;
