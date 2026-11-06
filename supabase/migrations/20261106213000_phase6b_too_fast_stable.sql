-- game.too_fast reads now(), so it must be stable, not immutable.
alter function game.too_fast(timestamptz[]) stable;
