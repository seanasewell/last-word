// ── Game engine ─────────────────────────────────────────────────────────────
// Centralized, authoritative game state: timers, phases, source selection,
// score tracking, match progression, elimination and winner determination.
//
// The UI only reads state and calls intents (submit, startMatch, …). All
// submissions — human or bot — go through `submit()`, which validates with
// the word engine.
//
// XP, achievements and challenges are awarded by the server, only for games
// it played: online elimination matches and server-timed solo challenges.
// Local fallbacks (no connection) are playable but earn nothing.
//
// Elimination matches are played online when signed in: the Supabase server
// is the referee (it picks sources, keeps time, checks and scores words, plays
// the bots, eliminates and records results). The app checks in about once a
// second, maps the server's snapshot onto GameState, and checks words locally
// first only so feedback is instant — the server's answer is final. Without a
// session (or if the server can't be reached) the match runs locally and is
// not counted.
import { nextSource } from './sources';
import { supabase } from './supabase';
import { kv } from './kv';
import {
  bannedWords, findAllWords, letterCounts, sourceLetters, validateSubmission,
  type Counts, type Validation,
} from './words';
import {
  makePlayer, pickBots, rankByRound, resetForRound, type Player, type WordEntry,
} from './players';
import { planBotRound, type PlannedSubmission } from './bots';
import { progress } from './progress';

export type Mode = 'single' | 'multi';
export type Phase =
  | 'menu' | 'sp-countdown' | 'sp-playing' | 'sp-results'
  | 'lobby' | 'prematch' | 'round' | 'elimination' | 'final';

export const SINGLE_DURATION = 60_000;
export const ROUND_DURATION = 60_000;
export const TOTAL_ROUNDS = 5;
export const BETWEEN_ROUNDS = 10_000;
export const PREMATCH = 3_000;
export const HUMAN_ID = 'you';

export interface MatchResult {
  won: boolean;
  placement: number;
  totalScore: number;
  wordsFound: number;
  longestWord: string;
}

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
  /** The server's id for this game (online match or server-timed solo); null when played locally. */
  serverId: string | null;
}

// ── Server snapshot (see mm_tick) ──
interface SnapPlayer {
  id: string; name: string; photo_url: string | null; hue: number; is_bot: boolean; seat: number;
  status: 'active' | 'eliminated'; placement: number | null; eliminated_round: number | null;
  round_score: number; total_score: number; words_found: number; longest_word: string;
  reached_at: string | null; tiebreak: number; is_me: boolean;
}
interface SnapMatch {
  id: string; status: 'lobby' | 'prematch' | 'round' | 'between' | 'final'; round: number;
  source: string | null; possible_words: number;
  prematch_ends_at: string | null; round_started_at: string | null; round_ends_at: string | null; next_round_at: string | null;
  last_elimination: { round: number; player_id: string; round_score: number; remaining: number;
    standings: { id: string; round_score: number; total_score: number }[] } | null;
  winner_id: string | null;
}
interface Snapshot { server_now: string; match: SnapMatch; players: SnapPlayer[]; my_words: { word: string; points: number; at: string }[] }
type SubmitReply = { raw: string; ok: true; word: string; points: number } | { raw: string; ok: false; word: string; reason: string };

interface Online {
  matchId: string;
  myPid: string;
  /** server clock − local clock, in ms. */
  offset: number;
  bestRtt: number;
  snap: Snapshot | null;
  round: number;
  /** My accepted words the latest snapshot doesn't include yet. */
  extras: Map<string, WordEntry>;
  queue: string[];
  flushScheduled: boolean;
  choice: 'none' | 'spectate';
  done: boolean;
  /** Last round whose XP has been loaded. */
  scoredRound?: number;
}

/** Postgres timestamps carry microseconds; trim to milliseconds before parsing. */
const parseTs = (t: string | null) => (t ? Date.parse(t.replace(/(\.\d{3})\d+/, '$1')) : 0);

const storage = {
  get: (k: string) => kv.get(k),
  set: (k: string, v: string) => kv.set(k, v),
};

/** Lobby seats not yet taken show as "Waiting…". */
const padSlots = (players: Player[]) => {
  const out = players.slice(0, 6);
  for (let i = out.length; i < 6; i++) out.push(makePlayer(`slot${i}`, '', '', 0, 'remote'));
  return out;
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
  private matchListeners = new Set<(r: MatchResult) => void>();
  private matchCounted = false;
  private online: Online | null = null;
  /** The server-timed solo game in progress. */
  private solo: { id: string; offset: number; pending: Set<Promise<void>> } | null = null;

  /** Called once per finished elimination match for the human player. */
  onMatchEnd(fn: (r: MatchResult) => void) { this.matchListeners.add(fn); return () => { this.matchListeners.delete(fn); }; }

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
      newBest: false, missedLongest: [], serverId: null,
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
    this.solo = null;
    const o = this.online;
    if (o && !o.done && o.snap?.match.status === 'lobby') void supabase.rpc('mm_leave', { p_match: o.matchId });
    this.online = null;
    this.clearTimers();
    this.set({ phase: 'menu', mode: null, accepting: false, spectating: false, awaitingChoice: false });
  }

  startSingle() {
    this.online = null;
    this.clearTimers();
    const human = this.makeHuman();
    this.set({
      mode: 'single', matchId: newId(), round: 1, usedSources: this.lastSingleSource ? [this.lastSingleSource] : [],
      players: [human], winnerId: null, lastElimination: null, spectating: false,
      awaitingChoice: false, newBest: false, missedLongest: [], serverId: null,
      // A short 3-2-1 before the word appears, so the player can get ready.
      phase: 'sp-countdown', source: '', accepting: false, prematchEndsAt: Date.now() + PREMATCH,
    });
    this.solo = null;
    const t = this.token;
    this.after(PREMATCH, () => { void this.beginSoloOnline(t); });
  }

  /** Solo on the server when possible (so it earns XP); a local round otherwise. */
  private async beginSoloOnline(t: number) {
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (t !== this.token) return;
      if (!sess.session) { this.beginRound(); return; }
      const t0 = Date.now();
      const { data, error } = await supabase.rpc('solo_start', { p_avoid: this.lastSingleSource || null });
      const t1 = Date.now();
      if (t !== this.token) return;
      if (error || !data) { this.beginRound(); return; }
      const g = data as { id: string; source: string; possible_words: number; started_at: string; ends_at: string; server_now: string };
      const offset = parseTs(g.server_now) - (t0 + t1) / 2;
      this.solo = { id: g.id, offset, pending: new Set() };
      this.beginRound({ source: g.source, possible: g.possible_words, startedAt: parseTs(g.started_at) - offset, endsAt: parseTs(g.ends_at) - offset, serverId: g.id });
    } catch {
      if (t === this.token) this.beginRound();
    }
  }

  /** Find an online match; falls back to a local one when that isn't possible. */
  startMatch() {
    this.online = null;
    this.clearTimers();
    this.matchCounted = false;
    const human = this.makeHuman();
    this.set({
      mode: 'multi', matchId: newId(), phase: 'lobby', round: 0, source: '', usedSources: [],
      players: padSlots([human]), lobbyFilled: 1, winnerId: null, lastElimination: null,
      spectating: false, awaitingChoice: false, accepting: false, serverId: null,
    });
    this.solo = null;
    void this.joinOnline(this.token);
  }

  private startLocalMatch() {
    this.online = null;
    this.clearTimers();
    this.matchCounted = false;
    const human = this.makeHuman();
    const bots = pickBots(5, human.name);
    this.set({
      mode: 'multi', matchId: newId(), phase: 'lobby', round: 0, source: '', usedSources: [],
      players: [human, ...bots], lobbyFilled: 1, winnerId: null, lastElimination: null,
      spectating: false, awaitingChoice: false, accepting: false, serverId: null,
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

  /**
   * Developer shortcut: straight into a championship round (1v1 against a
   * bot) with rounds 1–4 already played out. Runs on this phone only and is
   * never recorded (no ranks, no XP).
   */
  devStartChampionship() {
    this.online = null;
    this.clearTimers();
    this.matchCounted = true; // never counted
    const human = this.makeHuman();
    const bots = pickBots(5, human.name);
    const used: string[] = [];
    for (let i = 0; i < TOTAL_ROUNDS - 1; i++) used.push(nextSource(used));
    const total = () => 900 + Math.floor(Math.random() * 1200);
    const players: Player[] = [
      { ...human, totalScore: total() },
      { ...bots[0], totalScore: total() },
      // Knocked out in rounds 1–4 (6th to 3rd place).
      ...bots.slice(1).map((b, i) => ({ ...b, status: 'eliminated' as const, eliminatedInRound: i + 1, placement: 6 - i, totalScore: 150 + 220 * i + Math.floor(Math.random() * 120) })),
    ];
    this.set({
      mode: 'multi', matchId: newId(), round: TOTAL_ROUNDS - 1, source: '', usedSources: used,
      players, lobbyFilled: 6, winnerId: null, lastElimination: null,
      spectating: false, awaitingChoice: false, accepting: false, serverId: null,
    });
    this.solo = null;
    this.beginRound();
  }

  spectate() {
    if (!this.state.awaitingChoice) return;
    const o = this.online;
    if (o) {
      o.choice = 'spectate';
      this.set({ spectating: true, awaitingChoice: false });
      this.render(o);
      return;
    }
    this.set({ spectating: true, awaitingChoice: false, nextRoundAt: Date.now() + 4000 });
    this.after(4000, () => this.beginRound());
  }

  /** The single entry point for every submission, human or bot. */
  submit(playerId: string, raw: string): Validation {
    if (this.online) return this.submitOnline(this.online, raw);
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
    if (this.solo && playerId === HUMAN_ID) this.sendSoloWord(this.solo, result.word);
    return result;
  }

  /** Send a solo word to the server; if the server turns it down, take it back. */
  private sendSoloWord(solo: NonNullable<GameEngine['solo']>, word: string) {
    const job = (async () => {
      let ok = true;
      try {
        const { data, error } = await supabase.rpc('solo_submit', { p_game: solo.id, p_word: word });
        ok = !error && !!data && (data as { ok: boolean }).ok;
      } catch {
        ok = true; // network hiccup: keep it on screen; the server's score is final at the end
      }
      if (ok || this.solo !== solo) return;
      const s = this.state;
      const me = s.players[0];
      const hit = me?.roundWords.find((x) => x.word === word);
      if (!me || !hit) return;
      const roundWords = me.roundWords.filter((x) => x.word !== word);
      this.set({ players: [{ ...me, roundWords, roundScore: me.roundScore - hit.points, totalScore: me.totalScore - hit.points, stats: { ...me.stats, wordsFound: me.stats.wordsFound - 1 } }] });
    })();
    solo.pending.add(job);
    void job.finally(() => solo.pending.delete(job));
  }

  // ── round lifecycle ──
  private beginRound(server?: { source: string; possible: number; startedAt: number; endsAt: number; serverId: string }) {
    this.clearTimers();
    const s = this.state;
    const single = s.mode === 'single';
    const round = single ? 1 : s.round + 1;
    // A brand-new source every round, never one already used in this match.
    const source = server?.source ?? nextSource(s.usedSources);
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
    const startedAt = server?.startedAt ?? now;
    const endsAt = server?.endsAt ?? now + duration;
    this.set({
      phase: single ? 'sp-playing' : 'round', round, source,
      usedSources: [...s.usedSources, source], players,
      roundStartedAt: startedAt, roundEndsAt: endsAt, accepting: true,
      possibleWords: server?.possible ?? candidates.length, lastElimination: s.lastElimination,
      serverId: server?.serverId ?? (single ? null : s.serverId),
    });

    if (this.plans.size) {
      this.tick = setInterval(() => this.runBots(), 100);
    }
    this.after(Math.max(0, endsAt - Date.now()), () => this.endRound());
  }

  /** Count the match for the human once: when they're knocked out or the match ends. */
  private countMatch(won: boolean, placement: number) {
    if (this.matchCounted) return;
    this.matchCounted = true;
    const me = this.state.players.find((p) => p.id === HUMAN_ID);
    const result: MatchResult = {
      won, placement,
      totalScore: me?.totalScore ?? 0,
      wordsFound: me?.stats.wordsFound ?? 0,
      longestWord: me?.stats.longestWord ?? '',
    };
    this.matchListeners.forEach((l) => l(result));
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
      const solo = this.solo;
      if (solo) void this.finishSolo(solo);
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
      this.countMatch(winner.id === HUMAN_ID, winner.id === HUMAN_ID ? 1 : 2);
      this.set({ accepting: false, players: final, lastElimination: elimination, winnerId: winner.id, phase: 'final', nextRoundAt: 0, awaitingChoice: false });
      return;
    }

    const humanOut = out.id === HUMAN_ID;
    if (humanOut) this.countMatch(false, placement);
    if (humanOut) {
      this.set({ accepting: false, players, lastElimination: elimination, phase: 'elimination', awaitingChoice: true, nextRoundAt: 0 });
      return;
    }
    this.set({ accepting: false, players, lastElimination: elimination, phase: 'elimination', awaitingChoice: false, nextRoundAt: Date.now() + BETWEEN_ROUNDS });
    this.after(BETWEEN_ROUNDS, () => this.beginRound());
  }

  /** Tell the server the solo round is over (after its last words land), then load the XP it awarded. */
  private async finishSolo(solo: NonNullable<GameEngine['solo']>) {
    await Promise.allSettled([...solo.pending]);
    try { await supabase.rpc('solo_finish', { p_game: solo.id }); } catch { /* the sweeper finishes it anyway */ }
    progress.refreshSoon();
  }

  // ── online play ──────────────────────────────────────────────────────────

  /** If this player is still in an unfinished online match (e.g. the app was closed mid-round), go back into it. */
  async resumeIfInMatch() {
    if (this.online || this.state.phase !== 'menu') return;
    const t = this.token;
    try {
      const { data } = await supabase.rpc('mm_current');
      if (!data || t !== this.token || this.online || this.state.phase !== 'menu') return;
      this.clearTimers();
      this.matchCounted = false;
      this.set({ mode: 'multi', matchId: newId(), round: 0, source: '', usedSources: [], players: [], winnerId: null, lastElimination: null, spectating: false, awaitingChoice: false, accepting: false, serverId: data as string });
      this.online = {
        matchId: data as string, myPid: '', offset: 0, bestRtt: Infinity, snap: null, round: 0,
        extras: new Map(), queue: [], flushScheduled: false, choice: 'none', done: false,
      };
      this.set({ serverId: data as string });
      void this.poll(this.token, this.online);
    } catch {
      // Offline: stay on the menu.
    }
  }

  private async joinOnline(t: number) {
    try {
      const { data: sess } = await supabase.auth.getSession();
      if (t !== this.token) return;
      if (!sess.session) { this.startLocalMatch(); return; }
      const { data, error } = await supabase.rpc('mm_join');
      if (t !== this.token) {
        // Left while joining: give the seat back.
        if (data) void supabase.rpc('mm_leave', { p_match: data });
        return;
      }
      if (error || !data) { this.startLocalMatch(); return; }
      this.online = {
        matchId: data as string, myPid: '', offset: 0, bestRtt: Infinity, snap: null, round: 0,
        extras: new Map(), queue: [], flushScheduled: false, choice: 'none', done: false,
      };
      this.set({ serverId: data as string });
      void this.poll(t, this.online);
    } catch {
      if (t === this.token) this.startLocalMatch();
    }
  }

  private async poll(t: number, o: Online) {
    if (t !== this.token || this.online !== o || o.done) return;
    const t0 = Date.now();
    let delay = 2000;
    try {
      const { data, error } = await supabase.rpc('mm_tick', { p_match: o.matchId });
      const t1 = Date.now();
      if (t !== this.token || this.online !== o) return;
      if (!error && data) {
        const snap = data as Snapshot;
        // Estimate the server clock from the quickest round trips.
        const rtt = t1 - t0;
        if (rtt <= o.bestRtt + 40) o.offset = parseTs(snap.server_now) - (t0 + t1) / 2;
        o.bestRtt = Math.min(o.bestRtt * 1.05, rtt);
        o.snap = snap;
        delay = this.render(o);
      }
    } catch {
      // Network hiccup: try again shortly.
    }
    if (!o.done) this.after(delay, () => { void this.poll(t, o); });
  }

  /** Map the latest server snapshot (plus my not-yet-confirmed words) onto GameState. Returns ms until the next check-in. */
  private render(o: Online): number {
    const snap = o.snap;
    if (!snap) return 1000;
    const m = snap.match;
    const toLocal = (ts: string | null) => (ts ? parseTs(ts) - o.offset : 0);
    const mine = snap.players.find((p) => p.is_me);
    if (mine) o.myPid = mine.id;
    const mapId = (id: string) => (id === o.myPid ? HUMAN_ID : id);

    // New round: new source, fresh word history.
    if (m.round !== o.round) {
      o.round = m.round;
      o.extras.clear();
      o.queue = [];
      if (m.source) {
        this.srcCounts = letterCounts(sourceLetters(m.source));
        this.banned = bannedWords(m.source);
      }
    }
    const roundStart = toLocal(m.round_started_at);
    const serverWords: WordEntry[] = snap.my_words.map((x) => ({ word: x.word, points: x.points, at: toLocal(x.at) - roundStart }));
    const seen = new Set(serverWords.map((x) => x.word));
    o.extras.forEach((_, k) => { if (seen.has(k)) o.extras.delete(k); });
    const extra = [...o.extras.values()];
    const extraPts = extra.reduce((n, x) => n + x.points, 0);
    const myWords = [...extra, ...serverWords].sort((a, b) => b.at - a.at);

    const prev = new Map(this.state.players.map((p) => [p.id, p]));
    const players: Player[] = snap.players
      .slice()
      .sort((a, b) => Number(b.is_me) - Number(a.is_me) || a.seat - b.seat)
      .map((sp) => {
        const id = mapId(sp.id);
        const me = sp.is_me;
        const base = prev.get(id) ?? makePlayer(id, sp.name, sp.name[0]?.toUpperCase() ?? '?', sp.hue, me ? 'human' : sp.is_bot ? 'bot' : 'remote');
        let longest = sp.longest_word;
        if (me) for (const x of extra) if (x.word.length > longest.length) longest = x.word;
        let best: { word: string; points: number } | null = null;
        if (me) for (const x of myWords) if (!best || x.points > best.points) best = { word: x.word, points: x.points };
        return {
          ...base,
          name: sp.name,
          photo: me ? this.photo ?? sp.photo_url : sp.photo_url,
          hue: sp.hue,
          roundScore: sp.round_score + (me ? extraPts : 0),
          totalScore: sp.total_score + (me ? extraPts : 0),
          roundWords: me ? myWords : [],
          reachedAt: me && extra.length ? Math.max(...extra.map((x) => x.at)) : sp.reached_at ? toLocal(sp.reached_at) - roundStart : 1e9,
          stats: { wordsFound: sp.words_found + (me ? extra.length : 0), longestWord: longest, bestWord: me ? best ?? base.stats.bestWord : null },
          status: sp.status,
          eliminatedInRound: sp.eliminated_round,
          placement: sp.placement,
          tiebreak: sp.tiebreak,
        };
      });

    const le = m.last_elimination;
    const lastElimination: Elimination | null = le ? {
      round: le.round, playerId: mapId(le.player_id), roundScore: le.round_score, remaining: le.remaining,
      standings: le.standings.map((r) => ({ id: mapId(r.id), roundScore: r.round_score, totalScore: r.total_score })),
    } : null;

    const meP = players.find((p) => p.id === HUMAN_ID);
    const imOut = meP?.status === 'eliminated';
    const now = Date.now();
    const base = {
      round: m.round, source: m.source ?? '', possibleWords: m.possible_words, lastElimination,
      roundStartedAt: roundStart, roundEndsAt: toLocal(m.round_ends_at),
    };
    let next = 1000;
    const until = (ts: string | null) => Math.min(1000, Math.max(150, toLocal(ts) - now + 120));

    // A round just ended: the server has awarded its XP and achievements.
    if (m.status !== 'round' && m.status !== 'lobby' && m.status !== 'prematch' && o.scoredRound !== m.round) {
      o.scoredRound = m.round;
      progress.refreshSoon();
    }

    if (m.status === 'lobby' || m.status === 'prematch') {
      this.set({
        ...base, phase: m.status, players: m.status === 'lobby' ? padSlots(players) : players,
        lobbyFilled: players.length, prematchEndsAt: toLocal(m.prematch_ends_at), accepting: false,
      });
      if (m.status === 'prematch') next = until(m.prematch_ends_at);
    } else if (m.status === 'final') {
      o.done = true;
      this.set({ ...base, phase: 'final', players, winnerId: m.winner_id ? mapId(m.winner_id) : null, accepting: false, awaitingChoice: false, nextRoundAt: 0 });
      this.countMatch(m.winner_id === o.myPid, meP?.placement ?? 0);
      return 0;
    } else if (imOut && o.choice === 'none') {
      // Just knocked out: stay on the result until the player chooses.
      this.set({ ...base, phase: 'elimination', players, awaitingChoice: true, accepting: false, nextRoundAt: 0 });
      this.countMatch(false, meP?.placement ?? 0);
    } else if (m.status === 'round') {
      this.set({ ...base, phase: 'round', players, accepting: !imOut && now < base.roundEndsAt, awaitingChoice: false });
      next = until(m.round_ends_at);
    } else {
      this.set({ ...base, phase: 'elimination', players, accepting: false, awaitingChoice: false, nextRoundAt: toLocal(m.next_round_at) });
      next = until(m.next_round_at);
    }
    return next;
  }

  private submitOnline(o: Online, raw: string): Validation {
    const s = this.state;
    const me = s.players.find((p) => p.id === HUMAN_ID);
    const accepting = s.phase === 'round' && !!me && me.status === 'active' && Date.now() < s.roundEndsAt;
    const used = new Set(me?.roundWords.map((x) => x.word));
    const result = validateSubmission(raw, this.srcCounts, used, accepting, this.banned);
    if (!result.ok) return result;
    // Count it right away; the server confirms (or takes it back) a moment later.
    o.extras.set(result.word, { word: result.word, points: result.points, at: Date.now() - s.roundStartedAt });
    o.queue.push(result.word);
    this.render(o);
    if (!o.flushScheduled) {
      o.flushScheduled = true;
      setTimeout(() => { o.flushScheduled = false; void this.flush(o); }, 0);
    }
    return result;
  }

  /** Send queued words (comma batches go together in one request). */
  private async flush(o: Online, attempt = 0) {
    if (!o.queue.length || this.online !== o) return;
    const round = o.round;
    const words = o.queue.splice(0, 20);
    const { data, error } = await supabase.rpc('mm_submit', { p_match: o.matchId, p_words: words }).then((r) => r, () => ({ data: null, error: true }));
    if (this.online !== o || o.round !== round) return;
    if (error || !Array.isArray(data)) {
      if (attempt < 2) { o.queue.unshift(...words); setTimeout(() => { void this.flush(o, attempt + 1); }, 400); return; }
      words.forEach((wd) => o.extras.delete(wd));
    } else {
      for (const r of data as SubmitReply[]) if (!r.ok) o.extras.delete(r.word);
    }
    this.render(o);
    if (o.queue.length) void this.flush(o);
  }
}

export const engine = new GameEngine();
