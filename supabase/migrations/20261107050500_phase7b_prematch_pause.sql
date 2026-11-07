-- After the sixth player joins, wait 2.5 seconds before the 3-second countdown,
-- so the last join sound and the countdown beeps don't overlap.
-- (game.advance re-created with prematch_ends_at = now() + 5.5 seconds instead of 3.)
create or replace function game.advance(p_match uuid)
returns void language plpgsql set search_path to '' as $function$
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
      v_target := case when now() >= m.lobby_closes_at then 6
                       else least(6, v_count + greatest(0, floor((extract(epoch from now() - m.created_at) - 4) / 1.5)::integer - (v_count - v_humans))) end;
      while v_count < v_target loop
        perform game.add_bot(p_match);
        v_count := v_count + 1;
      end loop;
      if v_count >= 6 then
        update public.matches set status = 'prematch', prematch_ends_at = now() + interval '5.5 seconds' where id = p_match;
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
$function$;
