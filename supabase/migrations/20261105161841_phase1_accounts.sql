-- Last word, phase 1: player profiles, match results, avatar storage, account deletion.

-- ── Profiles ────────────────────────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text check (name is null or char_length(btrim(name)) between 2 and 14),
  country text not null default 'US' check (char_length(country) = 2),
  region text check (region is null or char_length(region) <= 60),
  photo_url text check (photo_url is null or char_length(photo_url) <= 500),
  solo_best integer not null default 0 check (solo_best >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.profiles is 'Public player profile. Phone numbers stay in auth.users and are never exposed here.';

alter table public.profiles enable row level security;

create policy "Signed-in players can read profiles"
  on public.profiles for select to authenticated
  using (true);

create policy "Players can create their own profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

create policy "Players can update their own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- ── Match results ───────────────────────────────────────────────────────────
-- Until online multiplayer (phase 3) runs matches on the server, results are
-- reported by the app; phase 3 moves this to a server-written record.
create table public.match_results (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  won boolean not null,
  placement smallint not null check (placement between 1 and 6),
  total_score integer not null default 0 check (total_score between 0 and 1000000),
  words_found integer not null default 0 check (words_found between 0 and 10000),
  longest_word text check (longest_word is null or char_length(longest_word) <= 30),
  played_at timestamptz not null default now(),
  constraint match_results_win_is_first check (won = (placement = 1))
);

create index match_results_user_played_idx on public.match_results (user_id, played_at desc);
create index match_results_wins_played_idx on public.match_results (played_at) where won;

alter table public.match_results enable row level security;

create policy "Players can read their own results"
  on public.match_results for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Players can record their own results"
  on public.match_results for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- ── Avatar storage ──────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/heic', 'image/webp'])
on conflict (id) do nothing;

-- Files live under avatars/<user id>/...; each player manages only their folder.
create policy "Players can upload their own avatar"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Players can replace their own avatar"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Players can delete their own avatar"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ── Account deletion ────────────────────────────────────────────────────────
-- Removes the caller's auth user; profiles and match results cascade.
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
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
