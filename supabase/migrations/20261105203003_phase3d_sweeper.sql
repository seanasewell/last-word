-- Last word, phase 3d: matches finish on their own.
-- A background job moves every unfinished match forward every few seconds,
-- so matches end on time even when nobody has the app open, and players who
-- leave get their placement recorded. Also lets the app find the match it
-- should rejoin when it reopens.
create extension if not exists pg_cron;

-- Advance every match whose clock says something is due.
create or replace function game.sweep()
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- Lobbies everyone left before they started: just remove them.
  delete from public.matches m
  where m.status = 'lobby'
    and not exists (select 1 from public.match_players p where p.match_id = m.id and not p.is_bot);

  for v_id in
    select m.id from public.matches m
    where (m.status = 'lobby' and now() >= m.created_at + interval '4 seconds')
       or (m.status = 'prematch' and now() >= m.prematch_ends_at)
       or (m.status = 'round' and now() >= m.round_ends_at)
       or (m.status = 'between' and now() >= m.next_round_at)
    order by m.created_at
  loop
    -- Skip a match a player's check-in is advancing right now.
    perform 1 from public.matches where id = v_id for update skip locked;
    if found then
      perform game.advance(v_id);
    end if;
  end loop;
end;
$$;

select cron.schedule('last-word-sweep', '5 seconds', 'select game.sweep()');

-- The unfinished match this player is still playing in, if any.
create or replace function public.mm_current()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.id
  from public.match_players p join public.matches m on m.id = p.match_id
  where p.user_id = auth.uid() and p.status = 'active' and m.status in ('prematch', 'round', 'between')
  order by m.created_at desc
  limit 1;
$$;

revoke all on function public.mm_current() from public, anon;
grant execute on function public.mm_current() to authenticated;
