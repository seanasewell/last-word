-- Last word, phase 3c: 50 bot names, rotated at random.
-- Bots now get a random name (never repeated within a match) and one of the
-- five skill styles, spreading the styles out so every match has a mix.
create or replace function game.bot_names()
returns setof text
language sql
immutable
set search_path = ''
as $$
  select unnest(array[
    'Pip','Juno','Atlas','Mika','Rook','Nova','Ziggy','Bramble','Echo','Fable',
    'Indigo','Kit','Lumen','Maple','Nimbus','Orbit','Pixel','Quill','Rune','Sable',
    'Tango','Umber','Vesper','Wren','Yuki','Zephyr','Basil','Clover','Dash','Ember',
    'Fern','Gizmo','Halo','Iris','Jinx','Koda','Moss','Nico','Olive','Pepper',
    'Quinn','Remy','Sage','Tully','Vale','Willow','Yara','Zuri','Biscuit','Cosmo'
  ]);
$$;

-- Skill styles (unchanged numbers); `name` is now just the style's label.
create or replace function game.add_bot(p_match uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_seat smallint;
  v_style text;
  v_name text;
begin
  select s into v_seat from generate_series(0, 5) as s
  where not exists (select 1 from public.match_players p where p.match_id = p_match and p.seat = s)
  order by s limit 1;
  if v_seat is null then return; end if;

  -- The least-used style in this match so far (random among ties).
  select r.style into v_style from game.bot_roster() r
  order by (select count(*) from public.match_players p where p.match_id = p_match and p.is_bot and p.bot_style = r.style), random()
  limit 1;

  -- A random name nobody in this match is using.
  select n into v_name from game.bot_names() as n
  where not exists (select 1 from public.match_players p where p.match_id = p_match and lower(p.name) = lower(n))
  order by random() limit 1;
  if v_name is null then return; end if;

  insert into public.match_players (match_id, is_bot, bot_style, name, hue, seat)
  values (p_match, true, v_style, v_name, (random() * 359)::smallint, v_seat);
end;
$$;

-- Plan bot words by style rather than by name.
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
    where random() < (case c.tier when 0 then b.know0 when 1 then b.know1 else b.know2 end)
                     * greatest(0.05, 1 - b.long_pen * greatest(0, c.len - 4));
    v_t := b.warm_min + random() * (b.warm_max - b.warm_min);
    while v_t < 59.6 loop
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
