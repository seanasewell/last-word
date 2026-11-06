-- Launch hardening (applied 2026-11-06). Followed by 20261106213000_phase6b_too_fast_stable.

-- 1. Developer tools off.
update game.config set value = 'false' where key = 'dev_tools';

-- 2. Players may only change their name, photo, country and region.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant insert (id, name, country, region, photo_url) on public.profiles to authenticated;
grant update (name, country, region, photo_url) on public.profiles to authenticated;
-- No client writes to server-owned tables at all (RLS already blocks them; this is belt and braces).
revoke insert, update, delete on public.match_results, public.player_progress, public.solo_games, public.solo_words,
  public.matches, public.match_players, public.round_words, public.reports, public.blocks from anon, authenticated;

-- 6. Reports survive account deletion.
alter table public.reports alter column reporter drop not null, alter column reported drop not null;
alter table public.reports add column if not exists reported_deleted_at timestamptz;
alter table public.reports drop constraint reports_reporter_fkey, drop constraint reports_reported_fkey;
alter table public.reports
  add constraint reports_reporter_fkey foreign key (reporter) references auth.users(id) on delete set null,
  add constraint reports_reported_fkey foreign key (reported) references auth.users(id) on delete set null;

create or replace function public.delete_account()
returns void language plpgsql security definer set search_path to '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  update public.match_players set name = 'Deleted player', photo_url = null where user_id = auth.uid();
  update public.reports set reported_deleted_at = now() where reported = auth.uid();
  delete from auth.users where id = auth.uid();
end $$;

-- Speed: indexes for foreign keys and faster access rules.
create index if not exists bot_plans_player_idx on game.bot_plans (player_id);
create index if not exists blocks_blocked_idx on public.blocks (blocked);
create index if not exists reports_reported_idx on public.reports (reported);
create index if not exists round_words_player_idx on public.round_words (player_id);
create index if not exists solo_words_game_at_idx on public.solo_words (game_id, at);
drop policy "read own progress" on public.player_progress;
create policy "read own progress" on public.player_progress for select to authenticated using (user_id = (select auth.uid()));
drop policy "read own solo games" on public.solo_games;
create policy "read own solo games" on public.solo_games for select to authenticated using (user_id = (select auth.uid()));

-- 8. Typing-speed limit: at most 4 accepted words in any 2 seconds and 20 in any 15 seconds.
create or replace function game.too_fast(p_times timestamptz[])
returns boolean language sql stable set search_path to '' as $$
  select coalesce((select count(*) from unnest(p_times) t where t > now() - interval '2 seconds'), 0) >= 4
      or coalesce((select count(*) from unnest(p_times) t where t > now() - interval '15 seconds'), 0) >= 20
$$;

create or replace function public.mm_submit(p_match uuid, p_words text[])
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_me uuid := auth.uid();
  m public.matches%rowtype;
  me public.match_players%rowtype;
  src game.sources%rowtype;
  v_raw text; v_word text; v_letters text; v_points integer; v_accepting boolean;
  v_results jsonb := '[]'::jsonb; v_reason text;
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
    elsif game.too_fast(array(select w.at from public.round_words w where w.match_id = p_match and w.round = m.round and w.player_id = me.id and w.at > now() - interval '15 seconds')) then v_reason := 'too-fast';
    end if;

    if v_reason is null then
      v_points := game.points(char_length(v_word));
      insert into public.round_words (match_id, round, player_id, word, points) values (p_match, m.round, me.id, v_word, v_points);
      update public.match_players set
        round_score = round_score + v_points, total_score = total_score + v_points, words_found = words_found + 1,
        longest_word = case when char_length(v_word) > char_length(longest_word) then v_word else longest_word end,
        reached_at = now()
      where id = me.id;
      v_results := v_results || jsonb_build_object('raw', v_raw, 'ok', true, 'word', v_word, 'points', v_points);
    else
      v_results := v_results || jsonb_build_object('raw', v_raw, 'ok', false, 'word', v_word, 'reason', v_reason);
    end if;
  end loop;
  return v_results;
end $function$;

create or replace function public.solo_submit(p_game uuid, p_word text)
returns jsonb language plpgsql security definer set search_path to '' as $function$
declare
  v_me uuid := auth.uid();
  g public.solo_games%rowtype;
  src game.sources%rowtype;
  v_word text := lower(btrim(p_word));
  v_reason text; v_points integer;
begin
  select * into g from public.solo_games where id = p_game and user_id = v_me for update;
  if g.id is null then raise exception 'Not your game'; end if;
  select * into src from game.sources where source = g.source;
  if g.finished or now() > g.ends_at + interval '1 second' then v_reason := 'closed';
  elsif v_word !~ '^[a-z]*$' then v_reason := 'not-word';
  elsif char_length(v_word) < 2 then v_reason := 'too-short';
  elsif exists (select 1 from public.solo_words w where w.game_id = p_game and w.word = v_word) then v_reason := 'duplicate';
  elsif v_word = any (src.banned) then v_reason := 'source-word';
  elsif not game.fits(game.letter_counts(v_word), src.counts) then v_reason := 'letters';
  elsif not exists (select 1 from game.words w where w.word = v_word) then v_reason := 'not-word';
  elsif game.too_fast(array(select w.at from public.solo_words w where w.game_id = p_game and w.at > now() - interval '15 seconds')) then v_reason := 'too-fast';
  end if;
  if v_reason is not null then return jsonb_build_object('ok', false, 'word', v_word, 'reason', v_reason); end if;
  v_points := game.points(char_length(v_word));
  insert into public.solo_words (game_id, word, points) values (p_game, v_word, v_points);
  return jsonb_build_object('ok', true, 'word', v_word, 'points', v_points);
end $function$;
