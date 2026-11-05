-- Last word, phase 3a: server-side dictionary and source words.
-- Lives in a private "game" schema that the app's API can't read directly.
-- Data is loaded separately by supabase/seed_dictionary.sql.
create extension if not exists http with schema extensions;
create schema if not exists game;
revoke all on schema game from public, anon, authenticated;

-- Letter counts a..z for a word or phrase (spaces/punctuation ignored).
create or replace function game.letter_counts(w text)
returns smallint[]
language sql
immutable
set search_path = ''
as $$
  select array_agg(coalesce(c.n, 0)::smallint order by i)
  from generate_series(1, 26) as i
  left join (
    select ascii(ch) - 96 as k, count(*) as n
    from regexp_split_to_table(regexp_replace(lower(w), '[^a-z]', '', 'g'), '') as ch
    where ch <> ''
    group by 1
  ) c on c.k = i;
$$;

-- Bitmask of which letters appear (fast pre-filter before the exact count check).
create or replace function game.letter_mask(w text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select coalesce(bit_or(1 << (ascii(ch) - 97)), 0)
  from regexp_split_to_table(regexp_replace(lower(w), '[^a-z]', '', 'g'), '') as ch
  where ch <> '';
$$;

-- True when every letter count in `need` fits within `have`.
create or replace function game.fits(need smallint[], have smallint[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select bool_and(a <= b) from unnest(need, have) as t(a, b);
$$;

-- Points by word length (same table as the app).
create or replace function game.points(len integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when len < 2 then 0
    when len <= 9 then (array[0, 10, 20, 40, 70, 110, 160, 220, 300])[len]
    else 300 + 50 * (len - 9)
  end;
$$;

create table game.words (
  word text primary key,
  tier smallint not null,          -- 0 common, 1 everyday, 2 uncommon
  len smallint not null,
  mask integer not null,
  counts smallint[] not null
);
create index words_len_idx on game.words (len);

create table game.sources (
  source text primary key,         -- display form, e.g. 'Under the stars'
  letters integer not null,
  mask integer not null,
  counts smallint[] not null,
  banned text[] not null           -- the source itself and each word of a phrase
);

alter table game.words enable row level security;
alter table game.sources enable row level security;
