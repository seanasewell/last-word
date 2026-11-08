// ── Account system (Supabase) ──────────────────────────────────────────────
// Players start as guests (anonymous Supabase users) and can link Apple or
// Google at any time to save their progress, keeping the same player ID.
// Profiles, photos, results and progress live in Supabase.
import { decode } from 'base64-arraybuffer';

import { kv } from './kv';
import { purchases } from './purchases';
import { unregisterPush } from './push';
import { linkProvider, revokeApple, signInWithProvider, type Provider, type SocialResult } from './social';
import { supabase } from './supabase';

export interface Account {
  id: string;
  country: string; // ISO code
  region: string;
  name: string;
  photo: string | null; // public URL
  createdAt: number;
  winsByWeek: Record<string, number>;
  /** Wins per local calendar day, "YYYY-MM-DD". */
  winsByDay: Record<string, number>;
  totalWins: number;
  matchesPlayed: number;
  soloBest: number;
  /** How this player signs in; null for a guest whose progress lives only on this phone. */
  provider: Provider | null;
}

export interface AuthState {
  /** False until the saved session has been checked at launch. */
  ready: boolean;
  account: Account | null;
  /** Signed in but onboarding not finished. */
  onboarding: boolean;
}

export type Period = 'day' | 'week' | 'month' | 'year' | 'all';

const pad = (n: number) => String(n).padStart(2, '0');
/** Local calendar day key, e.g. "2026-11-05". */
export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** Monday-based week key in local time, e.g. "2026-11-02". */
export function weekKey(d = new Date()): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return dayKey(x);
}
export function weekRange(d = new Date()): { start: Date; end: Date } {
  const [y, m, dd] = weekKey(d).split('-').map(Number);
  return { start: new Date(y, m - 1, dd), end: new Date(y, m - 1, dd + 7) };
}

/** Wins in the current day / week / month / year, or all time. */
export function winsFor(a: Account, period: Period, now = new Date()): number {
  if (period === 'all') return a.totalWins;
  if (period === 'week') return a.winsByWeek[weekKey(now)] ?? 0;
  const prefix = period === 'day' ? dayKey(now) : period === 'month' ? dayKey(now).slice(0, 7) : String(now.getFullYear());
  let n = 0;
  for (const k in a.winsByDay) if (k.startsWith(prefix)) n += a.winsByDay[k];
  return n;
}

function providerOf(user: { identities?: { provider: string }[]; app_metadata?: { provider?: string; providers?: string[] } }): Provider | null {
  const all = [...(user.identities ?? []).map((i) => i.provider), ...(user.app_metadata?.providers ?? []), user.app_metadata?.provider ?? ''];
  return all.includes('apple') ? 'apple' : all.includes('google') ? 'google' : null;
}

// Onboarding is done once there's a name (location isn't asked for).
const isComplete = (a: Account) => !!a.name;

/** The last copy of the signed-in player, for launching without a connection. */
const ACCOUNT_CACHE = 'lw.account.cache';
function readCachedAccount(id: string): Account | null {
  try {
    const a = JSON.parse(kv.get(ACCOUNT_CACHE) || 'null') as Account | null;
    return a && a.id === id ? a : null;
  } catch {
    return null;
  }
}
/**
 * Forget a player on this phone after sign-out or deletion: the cached copy, Remove ads
 * answer and per-player keys. A signed-out (saved) player keeps their best score cached.
 */
function clearLocalPlayer(id: string, opts: { keepBest?: boolean } = {}) {
  kv.remove(ACCOUNT_CACHE);
  purchases.forget();
  kv.keys().filter((k) => k.endsWith(`.${id}`) && !(opts.keepBest && k === `lw.best.${id}`)).forEach((k) => kv.remove(k));
}

/** True only when the session is really gone (not a network failure). */
function isSignedOutError(e: { name?: string; status?: number }): boolean {
  return e.name === 'AuthSessionMissingError' || e.status === 401 || e.status === 403;
}
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Turn Supabase errors into short, player-facing messages. */
function friendly(message: string | undefined): string {
  const m = (message ?? '').toLowerCase();
  if (m.includes('captcha')) return "Couldn't confirm you're a person. Try again.";
  if (m.includes('anonymous sign-ins are disabled')) return "New players can't join right now. Try again later.";
  if (m.includes('rate') || m.includes('security purposes') || m.includes('too many')) return 'Too many attempts. Wait a minute and try again.';
  if (m.includes('network') || m.includes('fetch')) return "Can't reach the server. Check your connection.";
  return 'Something went wrong. Try again.';
}

type Listener = () => void;

class AccountStore {
  private state: AuthState = { ready: false, account: null, onboarding: false };
  private listeners = new Set<Listener>();

  subscribe = (fn: Listener) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getState = () => this.state;
  private set(p: Partial<AuthState>) { this.state = { ...this.state, ...p }; this.listeners.forEach((l) => l()); }

  /**
   * Restore the saved session at launch. If the server can't be reached (or takes over
   * 8 seconds), the last copy of the player saved on this phone is shown instead, so a
   * bad connection never looks like being signed out.
   */
  async load(): Promise<void> {
    try {
      const { data } = await supabase.auth.getSession();
      const user = data.session?.user;
      if (user) {
        try {
          await withTimeout(this.refresh(), 8000);
        } catch {
          const cached = readCachedAccount(user.id);
          if (cached) this.set({ account: cached, onboarding: !isComplete(cached) });
        }
      }
    } catch {
      // Storage unreadable: fall through to the sign-in screens.
    }
    this.set({ ready: true });
  }

  /**
   * Re-read the signed-in player's profile and results from the server. Only a real
   * sign-out clears the player; any other failure throws and leaves things as they were.
   */
  async refresh(): Promise<void> {
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr && !isSignedOutError(userErr)) throw userErr;
    const user = userData.user;
    if (!user) { this.set({ account: null, onboarding: false }); return; }

    const found = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (found.error) throw found.error;
    let profile = found.data;
    if (!profile) {
      const created = await supabase.from('profiles').insert({ id: user.id }).select('*').single();
      if (created.error) throw created.error;
      profile = created.data;
    }
    const { data: results, error: resultsErr } = await supabase.from('match_results').select('won, played_at').eq('user_id', user.id);
    if (resultsErr) throw resultsErr;

    const winsByDay: Record<string, number> = {};
    const winsByWeek: Record<string, number> = {};
    let totalWins = 0;
    for (const r of results ?? []) {
      if (!r.won) continue;
      const d = new Date(r.played_at);
      winsByDay[dayKey(d)] = (winsByDay[dayKey(d)] ?? 0) + 1;
      winsByWeek[weekKey(d)] = (winsByWeek[weekKey(d)] ?? 0) + 1;
      totalWins++;
    }
    // Keep the solo personal best in step between this phone and the server.
    const localBest = Number(kv.get(`lw.best.${user.id}`) || 0) || 0;
    const soloBest = Math.max(localBest, profile?.solo_best ?? 0);
    if (soloBest > localBest) kv.set(`lw.best.${user.id}`, String(soloBest));

    const account: Account = {
      id: user.id,
      country: profile?.country ?? 'US',
      region: profile?.region ?? '',
      name: profile?.name ?? '',
      photo: profile?.photo_url ?? null,
      createdAt: new Date(user.created_at).getTime(),
      winsByDay, winsByWeek, totalWins,
      matchesPlayed: results?.length ?? 0,
      soloBest,
      provider: user.is_anonymous ? null : providerOf(user),
    };
    kv.set(ACCOUNT_CACHE, JSON.stringify(account));
    this.set({ account, onboarding: !isComplete(account) });
  }

  /** Create a new anonymous player on this phone. `captchaToken` comes from the human check. Returns an error message or null. */
  async start(captchaToken: string): Promise<string | null> {
    try {
      const { error } = await supabase.auth.signInAnonymously({ options: { captchaToken } });
      if (error) return friendly(error.message);
      await this.refresh();
      return null;
    } catch (e) {
      return friendly(e instanceof Error ? e.message : '');
    }
  }

  /** Save profile changes. A `photo` given as a data: URI is uploaded first. */
  async update(patch: Partial<Pick<Account, 'name' | 'photo' | 'region' | 'country'>>): Promise<string | null> {
    const a = this.state.account;
    if (!a) return null;
    const row: Record<string, string | null> = {};
    if (patch.name !== undefined) row.name = patch.name.trim() || null;
    if (patch.region !== undefined) row.region = patch.region || null;
    if (patch.country !== undefined) row.country = patch.country;
    if (patch.photo !== undefined) {
      if (patch.photo === null) {
        await supabase.storage.from('avatars').remove([`${a.id}/avatar.jpg`]);
        row.photo_url = null;
      } else if (patch.photo.startsWith('data:')) {
        const [, mime, b64] = patch.photo.match(/^data:([^;]+);base64,(.*)$/) ?? [];
        if (!b64) return "That photo couldn't be read.";
        const { error } = await supabase.storage.from('avatars').upload(`${a.id}/avatar.jpg`, decode(b64), { contentType: mime || 'image/jpeg', upsert: true });
        if (error) return "Couldn't upload that photo. Try again.";
        const { data } = supabase.storage.from('avatars').getPublicUrl(`${a.id}/avatar.jpg`);
        row.photo_url = `${data.publicUrl}?v=${Date.now()}`; // bust image caches after a change
      } else {
        row.photo_url = patch.photo;
      }
    }
    // Show the change right away, then save it.
    const next: Account = {
      ...a,
      ...(row.name !== undefined ? { name: row.name ?? '' } : {}),
      ...(row.region !== undefined ? { region: row.region ?? '' } : {}),
      ...(row.country !== undefined ? { country: row.country ?? 'US' } : {}),
      ...(row.photo_url !== undefined ? { photo: row.photo_url } : {}),
    };
    this.set({ account: next });
    const { data: saved, error } = await supabase.from('profiles').update(row).eq('id', a.id).select('id');
    if (error || !saved?.length) {
      this.set({ account: a });
      return error?.message.includes('name-not-allowed') ? "That name isn't allowed. Try another." : "Couldn't save that change. Try again.";
    }
    return null;
  }

  finishOnboarding() {
    const a = this.state.account;
    if (a && isComplete(a)) this.set({ onboarding: false });
  }

  /** Permanently delete the account, photo, profile and results. */
  async deleteAccount(): Promise<string | null> {
    const a = this.state.account;
    if (!a) return null;
    await supabase.storage.from('avatars').remove([`${a.id}/avatar.jpg`]).catch(() => {});
    if (a.provider === 'apple') await revokeApple();
    const { error } = await supabase.rpc('delete_account');
    if (error) return "Couldn't delete the account. Try again.";
    await supabase.auth.signOut().catch(() => {});
    clearLocalPlayer(a.id);
    this.set({ account: null, onboarding: false });
    return null;
  }

  /** Match results are written by the server; re-read them after a match. */
  async afterMatch() {
    await this.refresh().catch(() => {});
  }

  /** Show a new solo personal best right away. The server records it when the game ends. */
  async saveSoloBest(score: number) {
    const a = this.state.account;
    if (!a || score <= a.soloBest) return;
    this.set({ account: { ...a, soloBest: score } });
  }

  // ── Apple / Google ──
  /** Save this guest's progress to Apple or Google. Same player, same progress. */
  async link(p: Provider): Promise<SocialResult> {
    const r = await linkProvider(p);
    if (r.kind === 'ok') await this.refresh().catch(() => {});
    return r;
  }

  /** Sign in with Apple or Google, replacing any guest on this phone. */
  async signIn(p: Provider, captchaToken?: string | null): Promise<SocialResult> {
    const r = await signInWithProvider(p, captchaToken);
    if (r.kind === 'ok') await this.refresh().catch(() => {});
    return r;
  }

  /**
   * A guest picked an Apple/Google account that already has a player: switch to that
   * player and bring this guest's progress, results, friends and challenges along.
   * `merged` is false if the switch worked but the guest couldn't be merged.
   */
  async switchAndMerge(p: Provider): Promise<SocialResult & { merged?: boolean }> {
    // While still the guest: a one-time ticket that proves this phone owned it.
    let ticket: string | null = null;
    try {
      const { data } = await supabase.rpc('guest_merge_ticket');
      ticket = typeof data === 'string' ? data : null;
    } catch {
      ticket = null;
    }
    const r = await signInWithProvider(p);
    if (r.kind !== 'ok') return r;
    let merged = false;
    if (ticket) {
      try {
        const { error } = await supabase.rpc('merge_guest', { p_token: ticket });
        merged = !error;
      } catch {
        merged = false;
      }
    }
    await this.refresh().catch(() => {});
    return { ...r, merged };
  }

  /** Sign out of a saved (Apple/Google) player. Guests can't sign out: they'd lose everything. */
  async signOut(): Promise<void> {
    const a = this.state.account;
    if (!a?.provider) return;
    await unregisterPush();
    await supabase.auth.signOut().catch(() => {});
    clearLocalPlayer(a.id, { keepBest: true });
    this.set({ account: null, onboarding: false });
  }

  // ── developer controls ──
  /** Creates a new player and fills in onboarding with test values. */
  async devSkipSignup(captchaToken: string): Promise<string | null> {
    const err = await this.start(captchaToken);
    if (err) return err;
    await this.update({ name: 'Dev tester' });
    this.finishOnboarding();
    return null;
  }
  /** This player's hidden bot-difficulty level (1 = normal). */
  async devBotSkill(): Promise<number | null> {
    const { data, error } = await supabase.rpc('my_bot_skill');
    return error ? null : Number(data);
  }
  async devRestartOnboarding() {
    await this.update({ name: '', photo: null }).catch(() => null);
    this.set({ onboarding: true });
  }
  /** Signs out and clears this phone's local data. The old player stays on the server but can't be reached again. */
  async devResetAll() {
    kv.keys().filter((k) => k.startsWith('lw.')).forEach((k) => kv.remove(k));
    await supabase.auth.signOut().catch(() => {});
    this.set({ account: null, onboarding: false });
  }
}

export const accounts = new AccountStore();
