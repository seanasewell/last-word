// ── Word engine ─────────────────────────────────────────────────────────────
// Dictionary validation, letter-frequency validation, scoring and
// round-scoped duplicate detection. Pure functions: a future server can run
// this exact module to validate submissions authoritatively.
import data from './dict.json';

/** 0 = common, 1 = everyday, 2 = uncommon (SCOWL size tiers). */
export type Tier = 0 | 1 | 2;

const DICT = new Map<string, Tier>();
let built = false;

export function ensureDictionary(): void {
  if (built) return;
  const parts = [(data as any).c, (data as any).m, (data as any).r] as string[];
  parts.forEach((block, tier) => {
    for (const w of block.split(' ')) if (w) DICT.set(w, tier as Tier);
  });
  built = true;
}

export function dictionarySize(): number {
  ensureDictionary();
  return DICT.size;
}

export function isWord(w: string): boolean {
  ensureDictionary();
  return DICT.has(w);
}

/** Strip spaces/punctuation from a source phrase. */
export function sourceLetters(source: string): string {
  return source.toLowerCase().replace(/[^a-z]/g, '');
}

export type Counts = Uint8Array;

export function letterCounts(s: string): Counts {
  const c = new Uint8Array(26);
  for (let i = 0; i < s.length; i++) {
    const k = s.charCodeAt(i) - 97;
    if (k >= 0 && k < 26) c[k]++;
  }
  return c;
}

/** Character-frequency check: each letter used no more often than the source allows. */
export function canForm(word: string, src: Counts): boolean {
  const need = new Uint8Array(26);
  for (let i = 0; i < word.length; i++) {
    const k = word.charCodeAt(i) - 97;
    if (k < 0 || k >= 26) return false;
    if (++need[k] > src[k]) return false;
  }
  return true;
}

const TABLE = [0, 0, 10, 20, 40, 70, 110, 160, 220, 300];
export function scoreWord(word: string): number {
  const n = word.length;
  if (n < 2) return 0;
  if (n <= 9) return TABLE[n];
  return 300 + 50 * (n - 9);
}

export type Rejection = 'closed' | 'too-short' | 'duplicate' | 'source-word' | 'letters' | 'not-word';

export const REJECTION_TEXT: Record<Rejection, string> = {
  closed: 'Round is over.',
  'too-short': 'Use at least 2 letters.',
  duplicate: 'Already found.',
  'source-word': "Can't use the source word.",
  letters: "Those letters aren't available.",
  'not-word': 'Not a recognized word.',
};

/**
 * Words that may never be submitted for a source: the source itself and, for
 * phrases, each word of the phrase ("under", "the", "stars").
 */
export function bannedWords(source: string): Set<string> {
  const set = new Set<string>([sourceLetters(source)]);
  for (const w of source.toLowerCase().split(/[^a-z]+/)) if (w) set.add(w);
  return set;
}

export type Validation =
  | { ok: true; word: string; points: number }
  | { ok: false; reason: Rejection; word: string };

/**
 * Validate a raw submission for one player in the current round.
 * `used` is that player's submitted-word set for the current round only.
 */
export function validateSubmission(
  raw: string,
  src: Counts,
  used: ReadonlySet<string>,
  accepting: boolean,
  banned: ReadonlySet<string> = new Set(),
): Validation {
  const trimmed = raw.trim().toLowerCase();
  if (!accepting) return { ok: false, reason: 'closed', word: trimmed };
  // Hyphens, spaces, apostrophes, digits → not a single dictionary word.
  if (!/^[a-z]*$/.test(trimmed)) {
    const letters = trimmed.replace(/[^a-z]/g, '');
    if (letters.length < 2) return { ok: false, reason: 'too-short', word: trimmed };
    return { ok: false, reason: 'not-word', word: trimmed };
  }
  if (trimmed.length < 2) return { ok: false, reason: 'too-short', word: trimmed };
  if (used.has(trimmed)) return { ok: false, reason: 'duplicate', word: trimmed };
  if (banned.has(trimmed)) return { ok: false, reason: 'source-word', word: trimmed };
  if (!canForm(trimmed, src)) return { ok: false, reason: 'letters', word: trimmed };
  if (!isWord(trimmed)) return { ok: false, reason: 'not-word', word: trimmed };
  return { ok: true, word: trimmed, points: scoreWord(trimmed) };
}

export interface Candidate {
  word: string;
  tier: Tier;
  points: number;
}

/** Every dictionary word that can be built from the source. Used by bots and analytics. */
export function findAllWords(source: string): Candidate[] {
  ensureDictionary();
  const letters = sourceLetters(source);
  const src = letterCounts(letters);
  const banned = bannedWords(source);
  const out: Candidate[] = [];
  DICT.forEach((tier, word) => {
    if (word.length <= letters.length && !banned.has(word) && canForm(word, src)) {
      out.push({ word, tier, points: scoreWord(word) });
    }
  });
  return out;
}
