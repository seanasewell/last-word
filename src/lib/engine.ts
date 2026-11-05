// ── Game engine ─────────────────────────────────────────────────────────────
// Centralized, authoritative game state: timers, phases, source selection,
// score tracking, match progression, elimination and winner determination.
//
// The UI only reads state and calls intents (submit, startMatch, …). All
// submissions — human or bot — go through `submit()`, which validates with
// the word engine. In a real multiplayer build this class is what moves to
// the server: clients would send `submit` intents over a socket and receive
// state snapshots back; bot controllers would simply be replaced by remote
// ones. This prototype runs everything locally — there is no network play.
import { nextSource } from './sources';
import { kv } from './kv';
import {
  bannedWords, findAllWords, letterCounts, sourceLetters, validateSubmission,
  type Counts, type Validation,
} from './words';
import {
  BOT_ROSTER, makePlayer, rankByRound, resetForRound, type Player,
} from './players';
import { planBotRound, type PlannedSubmission } from './bots';

export type Mode = 'single' | 'multi';
export type Phase =
  | 'menu' | 'sp-playing' | 'sp-results'
  | 'lobby' | 'prematch' | 'round' | 'elimination' | 'final';

export const SINGLE_DURATION = 60_000;
export const ROUND_DURATION = 60_000;
export const TOTAL_ROUNDS = 5;
export const BETWEEN_ROUNDS = 10_000;
export const PREMATCH = 3_000;
export const HUMAN_ID = 'you';

export interface Elimination {
  round: number;
  playerId: string;
  roundScore: number;
  standings: { id: string; roundScore: number; totalScore: number }[];
  remaining: number;
}

export interface GameState {
  mode: Mode | null;
  matchId: string;
  phase: Phase;
  round: number;
  source: string;
  usedSources: string[];
  roundStartedAt: number;
  roundEndsAt: number;
  accepting: boolean;
  possibleWords: number;
  players: Player[];
  lobbyFilled: number;
  prematchEndsAt: number;
  nextRoundAt: number;
  lastElimination: Elimination | null;
  winnerId: string | null;
  spectating: boolean;
  awaitingChoice: boolean;
  humanName: string;
  personalBest: number;
  newBest: boolean;
  missedLongest: string[];
}

const storage = {
  get: (k: string) => kv.get(k),
  set: (k: string, v: string) => kv.set(k, v),
};

const newId = () => Math.random().toString(36).slice(2, 8).toUpperCase();

export class GameEngine {
  private state: GameState;
  private listeners = new Set<() => void>();
  private token = 0;
  private timeouts = new Set<ReturnType<typeof setTimeout>>();
  private tick: ReturnType<typeof setInterval> | null = null;
  private srcCounts: Counts = new Uint8Array(26);
  private banned = new Set<string>();
  private used = new Map<string, Set<string>>();
  private plans = new Map<string, PlannedSubmission[]>();
  private lastSingleSource = '';
  private profileId = 'guest';
  private photo: string | null = null;
  private matchListeners = new Set<(won: boolean) => void>();
  private matchCounted = false;

  /** Called once per finished elimination match (won = the human won). */
  onMatchEnd(fn: (won: boolean) => void) { this.matchListeners.add(fn); return () => { this.matchListeners.delete(fn); }; }

  /** Bind the signed-in player's identity. */
  setProfile(id: string, name: string, photo: string | null) {
    this.profileId = id;
    this.photo = photo;
    this.set({ humanName: name || 'You', personalBest: Number(storage.get(`lw.best.${id}`) || 0) || 0 });
  }
  private makeHuman() {
    const name = this.state.humanName;
    const p = makePlayer(HUMAN_ID, name, name[0]?.toUpperCase() || 'Y', 255, 'human');
    p.photo = this.photo;
    return p;
  }

  constructor() {
    this.state = {
      mode: null, matchId: '', phase: 'menu', round: 0, source: '', usedSources: [],
      roundStartedAt: 0, roundEndsAt: 0, accepting: false, possibleWords: 0,
      players: [], lobbyFilled: 0, prematchEndsAt: 0, nextRoundAt: 0,
      lastElimination: null, winnerId: null, spectating: false, awaitingChoice: false,
      humanName: 'You',
      personalBest: 0,
      newBest: false, missedLongest: [],
    };
  }

  // ── store plumbing ──
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getState = () => this.state;
  private set(patch: Partial<GameState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  // ── timer hygiene: every callback is bound to the current token ──
  private clearTimers() {
    this.token++;
    this.timeouts.forEach(clearTimeout);
    this.timeouts.clear();
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
  }
  private after(ms: number, fn: () => void) {
    const t = this.token;
    const id = setTimeout(() => { this.timeouts.delete(id); if (t === this.token) fn(); }, ms);
    this.timeouts.add(id);
  }

  // ── intents ──

  goMenu() {
    this.clearTimers();
    this.set({ phase: 'menu', mode: null, accepting: false, spectating: false, awaitingChoice: false });
  }

  startSingle() {
    this.clearTimers();
    const human = this.makeHuman();
    this.set({
      mode: 'single', matchId: newId(), round: 1, usedSources: this.lastSingleSource ? [this.lastSingleSource] : [],
      players: [human], winnerId: null, lastElimination: null, spectating: false,
      awaitingChoice: false, newBest: false, missedLongest: [],
    });
    this.beginRound();
  }

  startMatch() {
    this.clearTimers();
    this.matchCounted = false;
    const human = this.makeHuman();
    const bots = BOT_ROSTER.map((b, i) => makePlayer(`bot${i}`, b.name, b.glyph, b.hue, 'bot', b.bot));
    // Bots join in a shuffled order.
    for (let i = bots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [bots[i], bots[j]] = [bots[j], bots[i]];
    }
    this.set({
      mode: 'multi', matchId: newId(), phase: 'lobby', round: 0, source: '', usedSources: [],
      players: [human, ...bots], lobbyFilled: 1, winnerId: null, lastElimination: null,
      spectating: false, awaitingChoice: false, accepting: false,
    });
    let delay = 700;
    for (let n = 2; n <= 6; n++) {
      delay += 450 + Math.random() * 900;
      this.after(delay, () => this.set({ lobbyFilled: n }));
    }
    this.after(delay + 1100, () => {
      this.set({ phase: 'prematch', prematchEndsAt: Date.now() + PREMATCH });
      this.after(PREMATCH, () => this.beginRound());
    });
  }

  spectate() {
    if (!this.state.awaitingChoice) return;
    this.set({ spectating: true, awaitingChoice: false, nextRoundAt: Date.now() + 4000 });
    this.after(4000, () => this.beginRound());
  }

  /** The single entry point for every submission, human or bot. */
  submit(playerId: string, raw: string): Validation {
    const s = this.state;
    const idx = s.players.findIndex((p) => p.id === playerId);
    const player = s.players[idx];
    const used = this.used.get(playerId) ?? new Set<string>();
    const accepting = s.accepting && !!player && player.status === 'active' && Date.now() < s.roundEndsAt;
    const result = validateSubmission(raw, this.srcCounts, used, accepting, this.banned);
    if (!result.ok) return result;

    used.add(result.word); // synchronous → rapid repeats can't double-score
    this.used.set(playerId, used);
    const at = Date.now() - s.roundStartedAt;
    const stats = { ...player.stats };
    stats.wordsFound++;
    if (result.word.length > stats.longestWord.length) stats.longestWord = result.word;
    if (!stats.bestWord || result.points > stats.bestWord.points) stats.bestWord = { word: result.word, points: result.points };
    const next: Player = {
      ...player,
      roundScore: player.roundScore + result.points,
      totalScore: player.totalScore + result.points,
      roundWords: [{ word: result.word, points: result.points, at }, ...player.roundWords],
      reachedAt: at,
      stats,
    };
    const players = s.players.slice();
    players[idx] = next;
    this.set({ players });
    return result;
  }

  // ── round lifecycle ──
  private beginRound() {
    this.clearTimers();
    const s = this.state;
    const single = s.mode === 'single';
    const round = single ? 1 : s.round + 1;
    // A brand-new source every round, never one already used in this match.
    const source = nextSource(s.usedSources);
    if (single) this.lastSingleSource = source;
    const duration = single ? SINGLE_DURATION : ROUND_DURATION;

    this.srcCounts = letterCounts(sourceLetters(source));
    this.banned = bannedWords(source);
    this.used = new Map();
    this.plans = new Map();
    const players = s.players.map((p) => (p.status === 'active' ? resetForRound(p) : p));
    players.forEach((p) => this.used.set(p.id, new Set()));

    const candidates = findAllWords(source);
    players.forEach((p) => {
      if (p.status === 'active' && p.controller === 'bot' && p.bot) {
        this.plans.set(p.id, planBotRound(p.bot, candidates, duration));
      }
    });

    const now = Date.now();
    this.set({
      phase: single ? 'sp-playing' : 'round', round, source,
      usedSources: [...s.usedSources, source], players,
      roundStartedAt: now, roundEndsAt: now + duration, accepting: true,
      possibleWords: candidates.length, lastElimination: s.lastElimination,
    });

    if (this.plans.size) {
      this.tick = setInterval(() => this.runBots(), 100);
    }
    this.after(duration, () => this.endRound());
  }

  /** Count the match for the human once: when they're knocked out or the match ends. */
  private countMatch(won: boolean) {
    if (this.matchCounted) return;
    this.matchCounted = true;
    this.matchListeners.forEach((l) => l(won));
  }

  private runBots() {
    const elapsed = Date.now() - this.state.roundStartedAt;
    this.plans.forEach((plan, id) => {
      while (plan.length && plan[0].at <= elapsed) {
        const next = plan.shift()!;
        this.submit(id, next.word);
      }
    });
  }

  private endRound() {
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
    const s = this.state;

    if (s.mode === 'single') {
      const me = s.players[0];
      const newBest = me.roundScore > s.personalBest;
      const best = Math.max(me.roundScore, s.personalBest);
      if (newBest) storage.set(`lw.best.${this.profileId}`, String(best));
      const found = new Set(me.roundWords.map((w) => w.word));
      const missed = findAllWords(s.source)
        .filter((c) => !found.has(c.word) && c.tier < 2)
        .sort((a, b) => b.word.length - a.word.length)
        .slice(0, 6)
        .map((c) => c.word);
      this.set({ accepting: false, phase: 'sp-results', personalBest: best, newBest, missedLongest: missed });
      return;
    }

    // 1. stop accepting  2. finalize  3. rank  4. lowest  5. eliminate exactly one
    const active = s.players.filter((p) => p.status === 'active');
    const ranked = rankByRound(active);
    const out = ranked[ranked.length - 1];
    const placement = active.length;
    const players = s.players.map((p) =>
      p.id === out.id ? { ...p, status: 'eliminated' as const, eliminatedInRound: s.round, placement } : p,
    );
    const elimination: Elimination = {
      round: s.round, playerId: out.id, roundScore: out.roundScore,
      standings: ranked.map((p) => ({ id: p.id, roundScore: p.roundScore, totalScore: p.totalScore })),
      remaining: active.length - 1,
    };

    if (active.length - 1 <= 1) {
      const winner = ranked[0];
      const final = players.map((p) => (p.id === winner.id ? { ...p, placement: 1 } : p));
      // Match decided: go straight to the winner screen.
      this.countMatch(winner.id === HUMAN_ID);
      this.set({ accepting: false, players: final, lastElimination: elimination, winnerId: winner.id, phase: 'final', nextRoundAt: 0, awaitingChoice: false });
      return;
    }

    const humanOut = out.id === HUMAN_ID;
    if (humanOut) this.countMatch(false);
    if (humanOut) {
      this.set({ accepting: false, players, lastElimination: elimination, phase: 'elimination', awaitingChoice: true, nextRoundAt: 0 });
      return;
    }
    this.set({ accepting: false, players, lastElimination: elimination, phase: 'elimination', awaitingChoice: false, nextRoundAt: Date.now() + BETWEEN_ROUNDS });
    this.after(BETWEEN_ROUNDS, () => this.beginRound());
  }
}

export const engine = new GameEngine();
