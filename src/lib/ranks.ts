// ── Weekly rankings ────────────────────────────────────────────────────────
// Ranking = most elimination-match wins in the chosen period (today, this
// week, this month, this year, or all time).
// There is no server yet, so the other players on the board are sample
// entries generated deterministically per week (the same for everyone on a
// given period). The signed-in player's own wins are real, counted locally.
import { COUNTRIES, type Country } from './regions';
import { dayKey, weekKey, type Account, type Period } from './account';

export type Scope = 'world' | 'national' | 'state';

export interface RankEntry {
  id: string;
  name: string;
  hue: number;
  glyph: string;
  country: Country;
  region: string;
  wins: number;
  photo?: string | null;
  isYou?: boolean;
  rank: number;
}

function mulberry(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const FIRST = ['Ava', 'Leo', 'Maya', 'Noah', 'Zara', 'Eli', 'Ivy', 'Kai', 'Luna', 'Omar', 'Nia', 'Theo', 'Ruby', 'Jude', 'Aria', 'Finn', 'Sana', 'Milo', 'Isla', 'Arjun', 'Chloe', 'Mateo', 'Hana', 'Ezra', 'Priya', 'Owen', 'Lila', 'Rafa', 'Tess', 'Kofi', 'June', 'Sami', 'Wren', 'Dev', 'Nora', 'Cole', 'Mina', 'Jack', 'Esme', 'Ravi'];
const HANDLES = ['wordsmith', 'lexi', 'anagram', 'vowel', 'scribe', 'quill', 'syntax', 'glyph', 'tiles', 'riddle', 'prose', 'serif', 'ink', 'letters', 'cipher', 'verse'];

function makeName(r: () => number): string {
  const style = r();
  const f = FIRST[Math.floor(r() * FIRST.length)];
  if (style < 0.45) return `${f}${String.fromCharCode(65 + Math.floor(r() * 26))}.`.replace(/(\w+)(\w\.)$/, '$1 $2');
  if (style < 0.75) return `${HANDLES[Math.floor(r() * HANDLES.length)]}_${f.toLowerCase()}`;
  return `${f}${Math.floor(r() * 90 + 10)}`;
}

function samplePlayers(count: number, pick: (r: () => number) => { country: Country; region: string }, salt: string, top: number, periodSeed: string): Omit<RankEntry, 'rank'>[] {
  // Identities and skill are stable per scope; only the period's luck changes.
  const r = mulberry(hash(salt));
  const luck = mulberry(hash(`${salt}|${periodSeed}`));
  const out: Omit<RankEntry, 'rank'>[] = [];
  for (let i = 0; i < count; i++) {
    const { country, region } = pick(r);
    const name = makeName(r);
    const hue = Math.floor(r() * 360);
    const skill = Math.pow(r(), 2.2);
    const wins = Math.max(0, Math.round(top * skill * (0.8 + luck() * 0.4)));
    out.push({ id: `${salt}-${i}`, name, hue, glyph: name[0].toUpperCase(), country, region, wins });
  }
  return out;
}

/** How far through the current period we are (0–1), so totals grow over time. */
function progress(period: Period, now = new Date()): number {
  const day = (now.getHours() + now.getMinutes() / 60) / 24;
  switch (period) {
    case 'day': return Math.max(0.25, day);
    case 'week': return Math.min(1, (((now.getDay() + 6) % 7) + day + 0.5) / 7);
    case 'month': {
      const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      return Math.min(1, (now.getDate() - 1 + day + 0.5) / dim);
    }
    case 'year': {
      const start = new Date(now.getFullYear(), 0, 1).getTime();
      return Math.min(1, Math.max(0.02, (now.getTime() - start) / (365 * 86_400_000)));
    }
    default: return 1;
  }
}

/** Typical top totals for a full period, by scope. */
const TOPS: Record<Period, [number, number, number]> = {
  day: [7, 5, 3],
  week: [48, 32, 18],
  month: [190, 130, 70],
  year: [1900, 1300, 650],
  all: [5200, 3500, 1700],
};

export function periodSeed(period: Period, now = new Date()): string {
  if (period === 'day') return dayKey(now);
  if (period === 'week') return weekKey(now);
  if (period === 'month') return dayKey(now).slice(0, 7);
  if (period === 'year') return String(now.getFullYear());
  return 'all';
}

export function buildRanking(scope: Scope, me: Account, myWins: number, period: Period): { entries: RankEntry[]; you: RankEntry } {
  const myCountry = COUNTRIES.find((c) => c.code === me.country) ?? COUNTRIES[0];
  const prog = progress(period);
  const seed = periodSeed(period);
  const [tw, tn, ts] = TOPS[period];
  let pool: Omit<RankEntry, 'rank'>[];
  if (scope === 'world') {
    pool = samplePlayers(160, (r) => {
      const c = COUNTRIES[Math.floor(r() * COUNTRIES.length)];
      return { country: c, region: c.regions[Math.floor(r() * c.regions.length)] };
    }, 'world', Math.round(tw * prog) + 2, seed);
  } else if (scope === 'national') {
    pool = samplePlayers(120, (r) => ({ country: myCountry, region: myCountry.regions[Math.floor(r() * myCountry.regions.length)] }), `nat-${myCountry.code}`, Math.round(tn * prog) + 1, seed);
  } else {
    pool = samplePlayers(60, () => ({ country: myCountry, region: me.region }), `st-${myCountry.code}-${me.region}`, Math.round(ts * prog) + 1, seed);
  }
  const youBase = { id: me.id, name: me.name, hue: 255, glyph: me.name[0]?.toUpperCase() ?? 'Y', country: myCountry, region: me.region, wins: myWins, photo: me.photo, isYou: true };
  // Unique positions: ties are listed alphabetically, and you're placed after
  // anyone you're tied with (they reached that total first).
  const all = [...pool, youBase].sort((a, b) => b.wins - a.wins || (a.isYou ? 1 : b.isYou ? -1 : a.name.localeCompare(b.name)));
  const ranked = all.map((e, i) => ({ ...e, rank: i + 1 }));
  return { entries: ranked.slice(0, 50), you: ranked.find((e) => e.isYou)! };
}
