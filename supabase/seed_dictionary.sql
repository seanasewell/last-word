-- Loads the dictionary (76,481 words) and source words (884) into the game
-- schema from the repo's `dictionary-data` branch. Run once after the
-- phase3_dictionary migration, or again after updating those files.
truncate game.words;
insert into game.words (word, tier, len, mask, counts)
select w, t::smallint, char_length(w), game.letter_mask(w), game.letter_counts(w)
from (
  select split_part(line, E'\t', 1) as w, split_part(line, E'\t', 2) as t
  from regexp_split_to_table(
    (select content from extensions.http_get('https://raw.githubusercontent.com/seanasewell/last-word/dictionary-data/data/words.tsv')),
    E'\n') as line
  where line <> ''
) x
on conflict do nothing;

truncate game.sources;
insert into game.sources (source, letters, mask, counts, banned)
select s,
  char_length(regexp_replace(lower(s), '[^a-z]', '', 'g')),
  game.letter_mask(s), game.letter_counts(s),
  array(select distinct b from (
    select regexp_replace(lower(s), '[^a-z]', '', 'g') as b
    union all
    select regexp_replace(lower(p), '[^a-z]', '', 'g') from regexp_split_to_table(s, '\s+') as p
  ) y where char_length(b) >= 2)
from (
  select btrim(line) as s
  from regexp_split_to_table(
    (select content from extensions.http_get('https://raw.githubusercontent.com/seanasewell/last-word/dictionary-data/data/sources.txt')),
    E'\n') as line
  where btrim(line) <> ''
) x
on conflict do nothing;
