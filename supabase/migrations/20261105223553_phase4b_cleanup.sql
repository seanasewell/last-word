-- Last word, phase 4b: privacy cleanup.
-- • Deleting an account also removes the player's name and photo from any
--   match they were in.
-- • Finished matches (and their word lists) are deleted after 7 days; results
--   and wins live on in match_results.
create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  update public.match_players set name = 'Deleted player', photo_url = null where user_id = auth.uid();
  delete from auth.users where id = auth.uid();
end;
$$;

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
end;
$$;
