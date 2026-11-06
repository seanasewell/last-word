-- Last word, phase 4c: report reasons with an optional written explanation,
-- and no automatic name/photo resets (reports are reviewed by hand).
alter table public.reports add column if not exists details text check (char_length(details) <= 500);

drop function if exists public.report_player(text, uuid, uuid);

create or replace function public.report_player(p_reason text, p_user uuid default null, p_match_player uuid default null, p_details text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_target uuid := game.resolve_target(p_user, p_match_player);
  v_details text := nullif(left(btrim(coalesce(p_details, '')), 500), '');
  p public.profiles%rowtype;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if v_target is null or v_target = v_me then raise exception 'Can''t report this player'; end if;
  if p_reason not in ('name', 'photo', 'cheating', 'other') then raise exception 'Unknown reason'; end if;
  select * into p from public.profiles where id = v_target;

  insert into public.reports (reporter, reported, reason, details, reported_name, reported_photo)
  values (v_me, v_target, p_reason, v_details, p.name, p.photo_url)
  on conflict (reporter, reported, reason) do update
    set created_at = now(), details = excluded.details, reported_name = excluded.reported_name, reported_photo = excluded.reported_photo;
  -- Reports are only stored. Nothing changes automatically: every report is reviewed by hand.
end;
$$;

revoke all on function public.report_player(text, uuid, uuid, text) from public, anon;
grant execute on function public.report_player(text, uuid, uuid, text) to authenticated;

-- "Warm up" daily challenge: play 2 elimination matches (not solo games).
update game.challenge_defs set metric = 'matches' where id = 'warm-up';
