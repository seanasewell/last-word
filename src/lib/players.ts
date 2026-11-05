// ── Player system ───────────────────────────────────────────────────────────
// Identities, round scores, cumulative match scores, round-scoped word
// histories and active/eliminated status. A Player is transport-agnostic:
// `controller` says who drives it (local human, local bot, or later a remote
// connection), so bots can be swapped for real players without engine changes.

export type Controller = 'human' | 'bot' | 'remote';

export interface BotProfile {
  style: string;
  /** Seconds between submissions [min, max] before length adjustment. */
  interval: [number, number];
  /** Exponent applied to word length when choosing what to play. */
  lengthBias: number;
  /** Probability of "knowing" a word, by dictionary tier. */
  know: [number, number, number];
  /** How much harder long words are to spot (0 = not at all). */
  longPenalty: number;
  /** Seconds before first submission. */
  warmup: [number, number];
  /** Chance of a short pause after each submission (mimics thinking). */
  stall: number;
}

export interface WordEntry {
  word: string;
  points: number;
  at: number; // ms since round start
}

export interface PlayerStats {
  wordsFound: number;
  longestWord: string;
  bestWord: { word: string; points: number } | null;
}

export interface Player {
  id: string;
  name: string;
  glyph: string;
  hue: number;
  controller: Controller;
  bot?: BotProfile;
  photo?: string | null;
  // round state
  roundScore: number;
  roundWords: WordEntry[];
  /** ms since round start when the current round score was reached. */
  reachedAt: number;
  // match state
  totalScore: number;
  stats: PlayerStats;
  status: 'active' | 'eliminated';
  eliminatedInRound: number | null;
  placement: number | null;
  /** Predetermined random tie-break assigned at match creation. Higher survives. */
  tiebreak: number;
}

export const BOT_ROSTER: { name: string; glyph: string; hue: number; bot: BotProfile }[] = [
  {
    name: 'Pip', glyph: 'P', hue: 168,
    bot: { style: 'Speedy', interval: [2.6, 4.4], lengthBias: -1.4, know: [0.75, 0.4, 0.06], longPenalty: 0.16, warmup: [1, 2.5], stall: 0.06 },
  },
  {
    name: 'Juno', glyph: 'J', hue: 280,
    bot: { style: 'Balanced', interval: [3.8, 6.4], lengthBias: 0.5, know: [0.7, 0.42, 0.1], longPenalty: 0.09, warmup: [2, 4], stall: 0.1 },
  },
  {
    name: 'Atlas', glyph: 'A', hue: 30,
    bot: { style: 'Long-word hunter', interval: [8, 13], lengthBias: 3, know: [0.6, 0.45, 0.18], longPenalty: 0.02, warmup: [5, 8], stall: 0.12 },
  },
  {
    name: 'Mika', glyph: 'M', hue: 340,
    bot: { style: 'Streaky', interval: [2.4, 10], lengthBias: 0.2, know: [0.65, 0.35, 0.08], longPenalty: 0.1, warmup: [1.5, 5], stall: 0.22 },
  },
  {
    name: 'Rook', glyph: 'R', hue: 205,
    bot: { style: 'Methodical', interval: [5, 8], lengthBias: 1.1, know: [0.7, 0.5, 0.12], longPenalty: 0.06, warmup: [3, 6], stall: 0.08 },
  },
];

export function makePlayer(
  id: string,
  name: string,
  glyph: string,
  hue: number,
  controller: Controller,
  bot?: BotProfile,
): Player {
  return {
    id, name, glyph, hue, controller, bot,
    roundScore: 0, roundWords: [], reachedAt: 0,
    totalScore: 0,
    stats: { wordsFound: 0, longestWord: '', bestWord: null },
    status: 'active', eliminatedInRound: null, placement: null,
    tiebreak: Math.random(),
  };
}

/** Clear every round-specific field. Match totals and stats are untouched. */
export function resetForRound(p: Player): Player {
  return { ...p, roundScore: 0, roundWords: [], reachedAt: 0 };
}

/** Rank by round score desc; ties → earlier reachedAt first; then higher tiebreak. */
export function rankByRound(players: Player[]): Player[] {
  return players.slice().sort(
    (a, b) => b.roundScore - a.roundScore || a.reachedAt - b.reachedAt || b.tiebreak - a.tiebreak,
  );
}
