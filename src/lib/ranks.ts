// ── Leaderboards ───────────────────────────────────────────────────────────
// Real rankings from Supabase: players ordered by elimination-match wins in
// the chosen period, across the world, the player's country, or their region.
import type { Period } from './account';
import { countryByCode, type Country } from './regions';
import { supabase } from './supabase';

export type Scope = 'world' | 'national' | 'state';
export type RankMode = 'elimination' | 'solo' | '1v1';

export interface RankEntry {
  id: string;
  name: string;
  hue: number;
  glyph: string;
  country: Country;
  region: string;
  /** Elimination: wins. Solo: best score. 1v1: wins. */
  wins: number;
  /** 1v1 only. */
  losses?: number;
  draws?: number;
  photo?: string | null;
  isYou?: boolean;
  rank: number;
}

export interface Leaderboard {
  entries: RankEntry[]; // top 50
  you: RankEntry | null; // null until you have a win in this period
  rankedPlayers: number;
}

/** A stable avatar colour per player. */
function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

interface Row {
  rank: number; user_id: string; name: string; photo_url: string | null;
  country: string; region: string | null; wins: number; is_me: boolean; ranked_players: number;
}

export async function fetchLeaderboard(scope: Scope, period: Period): Promise<Leaderboard> {
  const { data, error } = await supabase.rpc('leaderboard', { p_scope: scope, p_period: period, p_tz: timeZone() });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  const toEntry = (r: Row): RankEntry => ({
    id: r.user_id,
    name: r.name,
    hue: hueFor(r.user_id),
    glyph: (r.name[0] ?? '?').toUpperCase(),
    country: countryByCode(r.country),
    region: r.region ?? '',
    wins: Number(r.wins),
    photo: r.photo_url,
    isYou: r.is_me,
    rank: Number(r.rank),
  });
  const all = rows.map(toEntry);
  return {
    entries: all.filter((e) => e.rank <= 50),
    you: all.find((e) => e.isYou) ?? null,
    rankedPlayers: Number(rows[0]?.ranked_players ?? 0),
  };
}

interface RowV2 extends Omit<Row, 'wins'> { value: number; wins: number; losses: number; draws: number }

/** Rankings for one game mode (elimination wins, solo best score, or 1v1 wins). */
export async function fetchModeLeaderboard(mode: RankMode, scope: Scope, period: Period): Promise<Leaderboard> {
  const { data, error } = await supabase.rpc('leaderboard_v2', { p_mode: mode, p_scope: scope, p_period: period, p_tz: timeZone() });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as RowV2[];
  const all = rows.map((r): RankEntry => ({
    id: r.user_id, name: r.name, hue: hueFor(r.user_id), glyph: (r.name[0] ?? '?').toUpperCase(),
    country: countryByCode(r.country), region: r.region ?? '', wins: Number(r.value),
    losses: Number(r.losses), draws: Number(r.draws), photo: r.photo_url, isYou: r.is_me, rank: Number(r.rank),
  }));
  return { entries: all.filter((e) => e.rank <= 50), you: all.find((e) => e.isYou) ?? null, rankedPlayers: Number(rows[0]?.ranked_players ?? 0) };
}
