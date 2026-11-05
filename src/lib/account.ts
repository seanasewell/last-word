// ── Account system (Supabase) ──────────────────────────────────────────────
// Anonymous accounts: tapping Play creates a Supabase anonymous user, kept
// signed in on this phone. Profiles, photos and match results live in
// Supabase. There's no phone or email, so an account can't be recovered on
// another phone — deleting the app loses it.
import { decode } from 'base64-arraybuffer';

import { kv } from './kv';
import { COUNTRIES } from './regions';
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

/** Best guess at the player's country from the phone's region setting. */
function deviceCountry(): string {
  try {
    const region = new Intl.Locale(Intl.DateTimeFormat().resolvedOptions().locale).maximize().region;
    if (region && COUNTRIES.some((c) => c.code === region)) return region;
  } catch {
    // Fall back below.
  }
  return 'US';
}

const isComplete = (a: Account) => !!a.name && !!a.region;

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

  /** Restore the saved session at launch. */
  async load(): Promise<void> {
    try {
      const { data } = await supabase.auth.getSession();
      if (data.session) await this.refresh();
    } catch {
      // Offline or misconfigured: fall through to the sign-in screens.
    }
    this.set({ ready: true });
  }

  /** Re-read the signed-in player's profile and results from the server. */
  async refresh(): Promise<void> {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData.user;
    if (!user) { this.set({ account: null, onboarding: false }); return; }

    let { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (!profile) {
      const created = await supabase.from('profiles').insert({ id: user.id, country: deviceCountry() }).select('*').single();
      profile = created.data;
    }
    const { data: results } = await supabase.from('match_results').select('won, played_at').eq('user_id', user.id);

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
    };
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
    const { error } = await supabase.from('profiles').update(row).eq('id', a.id);
    if (error) {
      this.set({ account: a });
      return error.message.includes('name-not-allowed') ? "That name isn't allowed. Try another." : "Couldn't save that change. Try again.";
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
    const { error } = await supabase.rpc('delete_account');
    if (error) return "Couldn't delete the account. Try again.";
    kv.remove(`lw.best.${a.id}`);
    await supabase.auth.signOut().catch(() => {});
    this.set({ account: null, onboarding: false });
    return null;
  }

  /** Match results are written by the server; re-read them after a match. */
  async afterMatch() {
    await this.refresh().catch(() => {});
  }

  /** Save a new solo personal best to the profile. */
  async saveSoloBest(score: number) {
    const a = this.state.account;
    if (!a || score <= a.soloBest) return;
    this.set({ account: { ...a, soloBest: score } });
    await supabase.from('profiles').update({ solo_best: score }).eq('id', a.id);
  }

  // ── developer controls ──
  /** Creates a new player and fills in onboarding with test values. */
  async devSkipSignup(captchaToken: string): Promise<string | null> {
    const err = await this.start(captchaToken);
    if (err) return err;
    await this.update({ name: 'Dev tester', region: 'California', country: 'US' });
    this.finishOnboarding();
    return null;
  }
  /** This player's hidden bot-difficulty level (1 = normal). */
  async devBotSkill(): Promise<number | null> {
    const { data, error } = await supabase.rpc('my_bot_skill');
    return error ? null : Number(data);
  }
  async devResetBotSkill(): Promise<string | null> {
    const { error } = await supabase.rpc('reset_my_bot_skill');
    return error ? "Couldn't reset it. Try again." : null;
  }
  async devRestartOnboarding() {
    await this.update({ name: '', region: '', photo: null }).catch(() => null);
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
