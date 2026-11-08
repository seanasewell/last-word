// ── Progression: XP, levels, achievements, challenges, streaks ─────────────
// Awarded by the Supabase server from games it played (elimination matches and
// server-timed solo challenges; see phase5_progression.sql), so progress
// follows the account to any phone and can't be edited here. This file keeps
// the display side: names, emoji, goals and level math (same ids and numbers
// as the server), and a cached copy of the player's progress.
import { kv } from './kv';
import { supabase } from './supabase';

// ── Levels ─────────────────────────────────────────────────────────────────
export const MAX_LEVEL = 100;
/** XP needed to go from level n to n + 1. */
export const xpForLevel = (n: number) => 500 + (n - 1) * 100;

/** Total XP needed to reach a level from level 1. */
export const totalXpFor = (level: number) => { let t = 0; for (let n = 1; n < level; n++) t += xpForLevel(n); return t; };
export interface LevelInfo { level: number; title: string; into: number; need: number; toNext: number; total: number }
export function levelFromXp(total: number): LevelInfo {
  let level = 1;
  let left = total;
  while (level < MAX_LEVEL && left >= xpForLevel(level)) { left -= xpForLevel(level); level++; }
  const need = level >= MAX_LEVEL ? 0 : xpForLevel(level);
  return { level, title: titleFor(level), into: level >= MAX_LEVEL ? 0 : left, need, toNext: Math.max(0, need - left), total };
}
const TITLES: [number, string][] = [[100, 'Last Word legend'], [75, 'Word elite'], [50, 'Word legend'], [40, 'Word champion'], [30, 'Word master'], [20, 'Word expert'], [15, 'Word specialist'], [10, 'Word hunter'], [5, 'Word explorer'], [1, 'Rookie']];
export const titleFor = (level: number) => TITLES.find(([l]) => level >= l)![1];

// ── Stats ──────────────────────────────────────────────────────────────────
export interface Stats {
  words: number;            // all valid words, solo and matches
  words6: number;           // 6+ letters
  words7: number;           // 7+ letters
  words8: number;           // 8+ letters
  words9: number;           // 9+ letters
  gamesCompleted: number;   // matches + solo challenges
  matchesCompleted: number; // elimination matches
  wins: number;
  roundsSurvived: number;
  championshipReached: number;
  closeCalls: number;
  comebacks: number;
  speedBursts: number;      // rounds with 5 words inside 15 seconds
  bigRounds: number;        // rounds scoring 1,000+
  soloCompleted: number;
}
export const emptyStats = (): Stats => ({ words: 0, words6: 0, words7: 0, words8: 0, words9: 0, gamesCompleted: 0, matchesCompleted: 0, wins: 0, roundsSurvived: 0, championshipReached: 0, closeCalls: 0, comebacks: 0, speedBursts: 0, bigRounds: 0, soloCompleted: 0 });

// ── Achievements ───────────────────────────────────────────────────────────
// Every milestone is its own achievement (no tiers). Each series below expands
// into one achievement per goal, e.g. "Find 100 words", "Find 250 words", …
const fmtN = (n: number) => n.toLocaleString('en-US');
const times = (n: number) => (n === 1 ? '' : ` ${fmtN(n)} times`);
interface Series { key: string; label: string; emoji: string; goals: number[]; value: (p: ProgressState) => number; title: (n: number) => string; desc?: (n: number) => string }
const longWords = (len: number, key: 'words6' | 'words7' | 'words8' | 'words9', emoji: string): Series => ({
  key: `long${len}`, label: `${len}-letter words`, emoji, goals: [1, 10, 50, 100], value: (p) => p.stats[key],
  title: (n) => (n === 1 ? `Find ${len === 8 ? 'an' : 'a'} ${len}-letter word` : `Find ${fmtN(n)} ${len}-letter words`),
  desc: (n) => (n === 1 ? `Find a word with ${len} or more letters` : `Find ${fmtN(n)} words with ${len} or more letters`),
});
const SERIES: Series[] = [
  { key: 'words', label: 'Find words', emoji: '🔤', goals: [1, 100, 250, 500, 1000, 2500, 5000, 10000], value: (p) => p.stats.words,
    title: (n) => (n === 1 ? 'First word' : `Find ${fmtN(n)} words`), desc: (n) => (n === 1 ? 'Find your first word' : `Find ${fmtN(n)} words in total`) },
  longWords(9, 'words9', '🧠'),
  longWords(8, 'words8', '📖'),
  longWords(7, 'words7', '📚'),
  longWords(6, 'words6', '✏️'),
  { key: 'speed', label: 'Quick fingers', emoji: '⚡', goals: [1, 5, 25, 100], value: (p) => p.stats.speedBursts,
    title: (n) => `5 words in 15 seconds${times(n)}`, desc: (n) => `Find 5 words within any 15 seconds of a round${times(n)}` },
  { key: 'big-round', label: 'Big rounds', emoji: '🎯', goals: [1, 5, 25, 100], value: (p) => p.stats.bigRounds,
    title: (n) => `Score 1,000 points in a round${times(n)}`, desc: (n) => `Score 1,000 or more points in a single round${times(n)}` },
  { key: 'wins', label: 'Wins', emoji: '🏆', goals: [1, 10, 25, 50, 75, 100, 250, 500, 1000], value: (p) => p.stats.wins,
    title: (n) => (n === 1 ? 'First win' : `Win ${fmtN(n)} matches`), desc: (n) => (n === 1 ? 'Win your first elimination match' : `Win ${fmtN(n)} elimination matches`) },
  { key: 'championship', label: 'Championship round', emoji: '👑', goals: [1, 5, 10, 25, 50, 75, 100, 250, 500, 1000], value: (p) => p.stats.championshipReached,
    title: (n) => `Reach the championship round${times(n)}`, desc: (n) => `Make it to the championship round${times(n)}` },
  { key: 'streak', label: 'Streaks', emoji: '🔥', goals: [3, 7, 30, 60, 90, 120, 180, 365], value: (p) => p.streak.best,
    title: (n) => `Play ${n} days in a row`, desc: (n) => `Play at least one game a day for ${n} days in a row` },
];
const STEP_XP = [100, 150, 200, 300, 400, 500, 500, 500, 500, 500];

export interface AchievementDef { id: string; series: string; emoji: string; name: string; desc: string; goal: number; xp: number; value: (p: ProgressState) => number }
export const ACHIEVEMENTS: AchievementDef[] = SERIES.flatMap((s) => s.goals.map((n, i) => ({
  id: `${s.key}-${n}`, series: s.key, emoji: s.emoji, name: s.title(n), desc: (s.desc ?? s.title)(n), goal: n, xp: STEP_XP[i], value: s.value,
})));
/** Achievements grouped by series (e.g. all the "Find N words" goals), in display order. */
export const ACHIEVEMENT_GROUPS = SERIES.map((s) => ({ key: s.key, label: s.label }));
export const achievementById = (id: string) => ACHIEVEMENTS.find((a) => a.id === id);

export interface AchievementView {
  def: AchievementDef; value: number; unlocked: boolean; pct: number;
}
export function viewAchievement(p: ProgressState, def: AchievementDef): AchievementView {
  const value = def.value(p);
  const unlocked = !!p.unlocked[def.id];
  return { def, value, unlocked, pct: unlocked ? 1 : Math.max(0, Math.min(1, value / def.goal)) };
}

// ── Challenges ─────────────────────────────────────────────────────────────
type Metric = 'games' | 'matches' | 'words' | 'roundsSurvived' | 'roundWords' | 'word7' | 'roundScore' | 'comeback' | 'earlyWords' | 'championship' | 'closeCall' | 'wins' | 'words7';
export interface ChallengeDef { id: string; emoji: string; name: string; desc: string; xp: number; goal: number; metric: Metric; best?: boolean; level?: 0 | 1 | 2 }
export const DAILY: ChallengeDef[] = [
  { id: 'warm-up', emoji: '🎮', name: 'Warm up', desc: 'Play 2 elimination matches', xp: 50, goal: 2, metric: 'matches', level: 0 },
  { id: 'quick-thinker', emoji: '⚡', name: 'Quick thinker', desc: 'Find 5 words in one round', xp: 50, goal: 5, metric: 'roundWords', best: true, level: 0 },
  { id: 'word-hunter', emoji: '🔤', name: 'Word hunter', desc: 'Find 20 words', xp: 75, goal: 20, metric: 'words', level: 0 },
  { id: 'long-shot', emoji: '📏', name: 'Long shot', desc: 'Find a word with 7 or more letters', xp: 75, goal: 1, metric: 'word7', level: 1 },
  { id: 'word-machine', emoji: '💯', name: 'Word machine', desc: 'Score 500 points in one round', xp: 75, goal: 500, metric: 'roundScore', best: true, level: 1 },
  { id: 'speed-demon-d', emoji: '🚀', name: 'Speed demon', desc: 'Find 3 words in the first 15 seconds', xp: 75, goal: 3, metric: 'earlyWords', best: true, level: 1 },
  { id: 'perfect-ten', emoji: '🔟', name: 'Perfect ten', desc: 'Find 10 words in one round', xp: 100, goal: 10, metric: 'roundWords', best: true, level: 1 },
  { id: 'daily-contender', emoji: '🎯', name: 'Daily contender', desc: 'Complete 3 elimination matches', xp: 75, goal: 3, metric: 'matches', level: 1 },
  { id: 'survivor-d', emoji: '🛡️', name: 'Survivor', desc: 'Survive 2 elimination rounds', xp: 100, goal: 2, metric: 'roundsSurvived', level: 2 },
  { id: 'comeback-d', emoji: '🔄', name: 'Comeback kid', desc: 'Advance after being in last place during a round', xp: 100, goal: 1, metric: 'comeback', level: 2 },
  { id: 'championship-d', emoji: '🏆', name: 'Championship bound', desc: 'Reach the championship round', xp: 125, goal: 1, metric: 'championship', level: 2 },
  { id: 'close-call-d', emoji: '😮‍💨', name: 'Close call', desc: 'Survive a round by 20 points or fewer', xp: 125, goal: 1, metric: 'closeCall', level: 2 },
];
export const WEEKLY: ChallengeDef[] = [
  { id: 'contender', emoji: '🎮', name: 'The contender', desc: 'Play 15 elimination matches', xp: 200, goal: 15, metric: 'matches' },
  { id: 'word-marathon', emoji: '🔤', name: 'Word marathon', desc: 'Find 200 words', xp: 250, goal: 200, metric: 'words' },
  { id: 'champions-path', emoji: '🏆', name: "Champion's path", desc: 'Win 5 elimination matches', xp: 300, goal: 5, metric: 'wins' },
  { id: 'the-survivor', emoji: '🛡️', name: 'The survivor', desc: 'Survive 10 elimination rounds', xp: 200, goal: 10, metric: 'roundsSurvived' },
  { id: 'long-word-legend', emoji: '📏', name: 'Long word legend', desc: 'Find 20 words with 7+ letters', xp: 250, goal: 20, metric: 'words7' },
  { id: 'championship-w', emoji: '👑', name: 'Championship bound', desc: 'Reach the championship round 5 times', xp: 300, goal: 5, metric: 'championship' },
];
export const DAILY_BONUS = 150;
export const WEEKLY_BONUS = 500;

export interface ChallengeSet { key: string; ids: string[]; progress: Record<string, number>; done: Record<string, boolean>; bonus: boolean }

/** The level-up / achievements pop-up waiting to be shown. */
export interface Celebration { achievements: string[]; levelFrom: number; levelTo: number }

export interface ProgressState {
  xp: number;
  stats: Stats;
  days: string[];                                       // days with a finished game (YYYY-MM-DD)
  streak: { current: number; best: number; last: string | null };
  unlocked: Record<string, string>;                     // achievement id → when
  daily: ChallengeSet;
  weekly: ChallengeSet;
  pending: Celebration | null;
  /** XP earned in the most recent game (match or solo id). */
  lastGame: { id: string; xp: number } | null;
  /** Today in the player's time zone, as the server sees it. */
  today: string;
  loaded: boolean;
}

// ── Dates (the player's local time) ────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Monday of the week containing `d`. */
export const weekStart = (d = new Date()) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
export const nextMidnight = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
export const nextMonday = (d = new Date()) => { const m = weekStart(d); m.setDate(m.getDate() + 7); return m.getTime(); };

const emptySet = (): ChallengeSet => ({ key: '', ids: [], progress: {}, done: {}, bonus: false });
const blank = (): ProgressState => ({
  xp: 0, stats: emptyStats(), days: [], streak: { current: 0, best: 0, last: null }, unlocked: {},
  daily: emptySet(), weekly: emptySet(), pending: null, lastGame: null, today: dayKey(), loaded: false,
});

/** The phone's time zone (for day and week boundaries). */
function timeZone(): string | null {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
}

interface ServerProgress {
  xp: number; stats: Partial<Stats>; days: string[]; streak: { current: number; best: number; last: string | null };
  unlocked: Record<string, string>; daily: Partial<ChallengeSet>; weekly: Partial<ChallengeSet>;
  pending: { achievements: string[]; level_from: number; level_to: number } | null;
  last_game: { id: string; xp: number } | null; today: string;
}
const toSet = (x: Partial<ChallengeSet> | undefined): ChallengeSet => ({ ...emptySet(), ...(x ?? {}) });
const toCelebration = (p: ServerProgress['pending']): Celebration | null =>
  p ? { achievements: p.achievements ?? [], levelFrom: p.level_from, levelTo: p.level_to } : null;

// ── Store ──────────────────────────────────────────────────────────────────
type Listener = () => void;
const cacheKey = (id: string) => `lw.progress2.${id}`;

class ProgressStore {
  private id = '';
  private state: ProgressState = blank();
  private listeners = new Set<Listener>();
  private inflight: Promise<void> | null = null;

  get = () => this.state;
  subscribe = (l: Listener) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  private emit() { this.listeners.forEach((l) => l()); }
  private commit(next: ProgressState) {
    this.state = next;
    if (this.id) kv.set(cacheKey(this.id), JSON.stringify(next));
    this.emit();
  }

  /** Switch to a player (shows the last copy saved on this phone, then refreshes from the server). */
  use(playerId: string) {
    if (playerId === this.id) return;
    this.id = playerId;
    this.inflight = null;
    this.again = false;
    let cached: ProgressState | null = null;
    try { cached = JSON.parse(kv.get(cacheKey(playerId)) || 'null'); } catch { cached = null; }
    this.state = cached ? { ...blank(), ...cached } : blank();
    this.emit();
    void this.refresh();
  }

  private again = false;
  private inflightAt = 0;

  /**
   * Fetch the latest progress from the server. A call made while a fetch is already
   * running fetches again once it finishes, so it never gets an answer from before it was made.
   */
  refresh(): Promise<void> {
    if (!this.id) return Promise.resolve();
    // A fetch that's been stuck for 5+ seconds (bad connection) doesn't block new ones.
    if (this.inflight && Date.now() - this.inflightAt < 5000) { this.again = true; return this.inflight; }
    this.inflightAt = Date.now();
    const forId = this.id;
    this.inflight = (async () => {
      try {
        const { data, error } = await supabase.rpc('my_progress', { p_tz: timeZone() });
        // Switched player while this was loading: the answer belongs to the old one.
        if (error || !data || forId !== this.id) return;
        const d = data as ServerProgress;
        this.commit({
          xp: d.xp ?? 0, stats: { ...emptyStats(), ...(d.stats ?? {}) }, days: d.days ?? [],
          streak: d.streak ?? { current: 0, best: 0, last: null }, unlocked: d.unlocked ?? {},
          daily: toSet(d.daily), weekly: toSet(d.weekly), pending: toCelebration(d.pending),
          lastGame: d.last_game ?? null, today: d.today ?? dayKey(), loaded: true,
        });
      } catch {
        // Offline: keep showing the saved copy.
      } finally {
        this.inflight = null;
      }
      if (this.again) { this.again = false; await this.refresh(); }
    })();
    return this.inflight;
  }

  /** Refresh a few times over the next seconds (the server may still be finishing a round). */
  refreshSoon() {
    void this.refresh();
    setTimeout(() => { void this.refresh(); }, 1500);
    setTimeout(() => { void this.refresh(); }, 4000);
  }

  currentStreak() { return this.state.streak.current; }

  /** Developer: set your XP (to review level tiers). Returns an error message, or null. */
  async devSetXp(xp: number): Promise<string | null> {
    try {
      const { error } = await supabase.rpc('dev_set_xp', { p_xp: Math.round(xp) });
      if (error) return error.message;
      await this.refresh();
      return null;
    } catch {
      return 'Couldn’t reach the server.';
    }
  }

  /** XP earned in a given game (0 until the server has scored it). */
  xpFor(gameId: string | null) {
    const g = this.state.lastGame;
    return gameId && g && g.id === gameId ? g.xp : 0;
  }

  /** Take (and clear) the waiting pop-up. Null when there's nothing to show. */
  async takeCelebration(): Promise<Celebration | null> {
    const forId = this.id;
    try {
      const { data, error } = await supabase.rpc('take_celebration');
      if (forId !== this.id) return null;
      this.commit({ ...this.state, pending: null });
      if (error || !data) return null;
      const c = toCelebration(data as ServerProgress['pending']);
      return c && (c.achievements.length > 0 || c.levelTo > c.levelFrom) ? c : null;
    } catch {
      return null;
    }
  }
}

export const progress = new ProgressStore();
