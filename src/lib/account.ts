// ── Account system (Supabase) ──────────────────────────────────────────────
// Phone sign-in with a one-time code sent by text, player profiles, photos,
// and match results, all stored in Supabase. The phone number lives only in
// Supabase Auth; the public `profiles` table never contains it.
import { decode } from 'base64-arraybuffer';

import { kv } from './kv';
import { countryByCode } from './regions';
import { DEV_TEST_CODE, DEV_TEST_PHONE, supabase } from './supabase';

export interface Account {
  id: string;
  phone: string; // E.164
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

interface PendingCode { phone: string; country: string; sentAt: number }

export interface AuthState {
  /** False until the saved session has been checked at launch. */
  ready: boolean;
  account: Account | null;
  /** Signed in but onboarding not finished. */
  onboarding: boolean;
  pending: PendingCode | null;
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

const isComplete = (a: Account) => !!a.name && !!a.region;

/** Turn Supabase errors into short, player-facing messages. */
function friendly(message: string | undefined): string {
  const m = (message ?? '').toLowerCase();
  if (m.includes('signups not allowed') || m.includes('user not found')) return 'No account uses this number yet.';
  if (m.includes('expired') || m.includes('invalid')) return "That code isn't right or has expired. Check the text and try again.";
  if (m.includes('rate') || m.includes('security purposes') || m.includes('too many')) return 'Too many attempts. Wait a minute and try again.';
  if (m.includes('sms') || m.includes('provider') || m.includes('twilio')) return "We couldn't send a text right now. Try again in a moment.";
  if (m.includes('network') || m.includes('fetch')) return "Can't reach the server. Check your connection.";
  return 'Something went wrong. Try again.';
}

type Listener = () => void;

class AccountStore {
  private state: AuthState = { ready: false, account: null, onboarding: false, pending: null };
  private listeners = new Set<Listener>();
  /** Country chosen at sign-up, used to seed a brand-new profile. */
  private signupCountry = 'US';

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
      const created = await supabase.from('profiles').insert({ id: user.id, country: this.signupCountry }).select('*').single();
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
      phone: user.phone ? `+${user.phone.replace(/^\+/, '')}` : '',
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

  /** Text a 6-digit code. `mode: 'login'` refuses unknown numbers. Returns an error message or null. */
  async requestCode(countryCode: string, nationalDigits: string, mode: 'create' | 'login'): Promise<string | null> {
    const c = countryByCode(countryCode);
    const phone = `${c.dial}${nationalDigits}`;
    const { error } = await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: mode === 'create', channel: 'sms' } });
    if (error) return friendly(error.message);
    this.signupCountry = c.code;
    this.set({ pending: { phone, country: c.code, sentAt: Date.now() } });
    return null;
  }

  /** Check the code; on success the player is signed in. Returns an error message or null. */
  async verifyCode(code: string): Promise<string | null> {
    const p = this.state.pending;
    if (!p) return 'Send a new code first.';
    const { error } = await supabase.auth.verifyOtp({ phone: p.phone, token: code, type: 'sms' });
    if (error) return friendly(error.message);
    await this.refresh();
    this.set({ pending: null });
    return null;
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
    if (error) { this.set({ account: a }); return "Couldn't save that change. Try again."; }
    return null;
  }

  finishOnboarding() {
    const a = this.state.account;
    if (a && isComplete(a)) this.set({ onboarding: false });
  }

  async logOut() {
    await supabase.auth.signOut().catch(() => {});
    this.set({ account: null, onboarding: false, pending: null });
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
    this.set({ account: null, onboarding: false, pending: null });
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
  /** Signs in with the Supabase test number and its fixed code (no text is sent). */
  async devSkipSignup(): Promise<string | null> {
    if (!DEV_TEST_PHONE || !DEV_TEST_CODE) return 'No developer test number is set in .env.';
    const { error } = await supabase.auth.signInWithOtp({ phone: DEV_TEST_PHONE, options: { shouldCreateUser: true } });
    if (error) return `Developer sign-in failed: ${friendly(error.message)} Make sure the test number is added in Supabase.`;
    this.state.pending = { phone: DEV_TEST_PHONE, country: 'US', sentAt: Date.now() };
    const err = await this.verifyCode(DEV_TEST_CODE);
    if (err) return err;
    const a = this.state.account;
    if (a && !isComplete(a)) {
      await this.update({ name: a.name || 'Dev tester', region: a.region || 'California', country: 'US' });
      this.finishOnboarding();
    }
    return null;
  }
  async devRestartOnboarding() {
    await this.update({ name: '', region: '', photo: null }).catch(() => null);
    this.set({ onboarding: true });
  }
  /** Signs out and clears this phone's local data (server data is untouched). */
  async devResetAll() {
    kv.keys().filter((k) => k.startsWith('lw.')).forEach((k) => kv.remove(k));
    await this.logOut();
  }
}

export const accounts = new AccountStore();
