// ── Account system (local mock of an auth server) ──────────────────────────
// Phone-number sign-in with a one-time code, onboarding profile, and weekly
// match-win tracking. Everything here is stored on this device.
//
// In production these calls map onto a real backend:
//   requestCode(phone)   → POST /auth/sms (server sends SMS via e.g. Twilio Verify)
//   verifyCode(code)     → POST /auth/verify → session token
//   saveProfile / delete → authenticated profile endpoints
// Nothing in this prototype sends a real text message: the code is delivered
// to the screen as a clearly labelled simulated SMS.
import { kv } from './kv';
import { countryByCode } from './regions';

export interface Account {
  id: string;
  phone: string; // E.164
  country: string; // ISO code
  region: string;
  name: string;
  photo: string | null; // data: URI of a square-cropped photo
  createdAt: number;
  winsByWeek: Record<string, number>;
  /** Wins per local calendar day, "YYYY-MM-DD". */
  winsByDay?: Record<string, number>;
  totalWins: number;
  matchesPlayed: number;
  dev?: boolean;
}

interface PendingCode { phone: string; country: string; code: string; expires: number; sentAt: number }

export interface AuthState {
  account: Account | null;
  /** Signed in but onboarding not finished. */
  onboarding: boolean;
  pending: PendingCode | null;
  /** Most recent simulated SMS, for the on-screen banner. */
  sms: { id: number; text: string; code: string } | null;
  autofillCode: boolean;
}

const KEY_ACCOUNTS = 'lw.accounts';
const KEY_SESSION = 'lw.session';
const KEY_DEV = 'lw.dev.autofill';

function read<T>(k: string, fallback: T): T {
  try { const v = kv.get(k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function write(k: string, v: unknown) {
  kv.set(k, JSON.stringify(v));
}
function remove(k: string) {
  kv.remove(k);
}

const pad = (n: number) => String(n).padStart(2, '0');
/** Local calendar day key, e.g. "2026-11-05". */
export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export type Period = 'day' | 'week' | 'month' | 'year' | 'all';

/** Wins in the current day / week / month / year, or all time. */
export function winsFor(a: Account, period: Period, now = new Date()): number {
  if (period === 'all') return a.totalWins;
  if (period === 'week') return a.winsByWeek[weekKey(now)] ?? 0;
  const days = a.winsByDay ?? {};
  const prefix = period === 'day' ? dayKey(now) : period === 'month' ? dayKey(now).slice(0, 7) : String(now.getFullYear());
  let n = 0;
  for (const k in days) if (k.startsWith(prefix)) n += days[k];
  return n;
}

/** Older accounts only tracked weekly wins: credit them to that week's Monday. */
function migrate(a: Account): Account {
  if (a.winsByDay) return a;
  const winsByDay: Record<string, number> = {};
  for (const wk in a.winsByWeek) if (a.winsByWeek[wk]) winsByDay[wk] = (winsByDay[wk] ?? 0) + a.winsByWeek[wk];
  return { ...a, winsByDay };
}

const addWin = (a: Account): Account => {
  const wk = weekKey();
  const dk = dayKey();
  const days = a.winsByDay ?? {};
  return {
    ...a,
    totalWins: a.totalWins + 1,
    winsByWeek: { ...a.winsByWeek, [wk]: (a.winsByWeek[wk] ?? 0) + 1 },
    winsByDay: { ...days, [dk]: (days[dk] ?? 0) + 1 },
  };
};

/** Monday-based week key in local time, e.g. "2026-11-02". */
export function weekKey(d = new Date()): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7; // Mon = 0
  x.setDate(x.getDate() - day);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
export function weekRange(d = new Date()): { start: Date; end: Date } {
  const [y, m, dd] = weekKey(d).split('-').map(Number);
  const start = new Date(y, m - 1, dd);
  const end = new Date(y, m - 1, dd + 7);
  return { start, end };
}

const isComplete = (a: Account) => !!a.name && !!a.region;

class AccountStore {
  private state!: AuthState;
  private listeners = new Set<() => void>();
  private smsSeq = 0;

  constructor() {
    this.load();
  }

  /** (Re)read the session from storage. Call after storage hydrates. */
  load() {
    const accounts = read<Record<string, Account>>(KEY_ACCOUNTS, {});
    const session = read<string | null>(KEY_SESSION, null);
    const stored = session ? accounts[session] ?? null : null;
    const account = stored ? migrate(stored) : null;
    this.state = {
      account,
      onboarding: !!account && !isComplete(account),
      pending: null,
      sms: null,
      autofillCode: read<boolean>(KEY_DEV, false),
    };
    this.listeners.forEach((l) => l());
  }

  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getState = () => this.state;
  private set(p: Partial<AuthState>) { this.state = { ...this.state, ...p }; this.listeners.forEach((l) => l()); }

  private accounts() { return read<Record<string, Account>>(KEY_ACCOUNTS, {}); }
  private persist(a: Account) {
    const all = this.accounts();
    all[a.id] = a;
    write(KEY_ACCOUNTS, all);
  }

  exists(phone: string) { return Object.values(this.accounts()).some((a) => a.phone === phone); }

  /** "Send" a 6-digit code. Returns the E.164 number. */
  requestCode(countryCode: string, nationalDigits: string): string {
    const c = countryByCode(countryCode);
    const phone = `${c.dial}${nationalDigits}`;
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const id = ++this.smsSeq;
    this.set({
      pending: { phone, country: c.code, code, expires: Date.now() + 5 * 60_000, sentAt: Date.now() },
      sms: { id, code, text: `Your Last word verification code is ${code}. It expires in 5 minutes.` },
    });
    return phone;
  }

  dismissSms() { this.set({ sms: null }); }

  /** Returns 'ok' | 'wrong' | 'expired'. On success the user is signed in. */
  verifyCode(code: string): 'ok' | 'wrong' | 'expired' {
    const p = this.state.pending;
    if (!p) return 'expired';
    if (Date.now() > p.expires) return 'expired';
    if (code !== p.code) return 'wrong';
    let account = Object.values(this.accounts()).find((a) => a.phone === p.phone) ?? null;
    if (!account) {
      account = {
        id: `u_${Math.random().toString(36).slice(2, 10)}`, phone: p.phone, country: p.country, region: '',
        name: '', photo: null, createdAt: Date.now(), winsByWeek: {}, winsByDay: {}, totalWins: 0, matchesPlayed: 0,
      };
      this.persist(account);
    }
    write(KEY_SESSION, account.id);
    account = migrate(account);
    this.set({ account, pending: null, sms: null, onboarding: !isComplete(account) });
    return 'ok';
  }

  update(patch: Partial<Pick<Account, 'name' | 'photo' | 'region' | 'country'>>) {
    const a = this.state.account;
    if (!a) return;
    const next = { ...a, ...patch };
    this.persist(next);
    this.set({ account: next });
  }

  finishOnboarding() {
    const a = this.state.account;
    if (a && isComplete(a)) this.set({ onboarding: false });
  }

  logOut() {
    remove(KEY_SESSION);
    this.set({ account: null, onboarding: false, pending: null, sms: null });
  }

  deleteAccount() {
    const a = this.state.account;
    if (!a) return;
    const all = this.accounts();
    delete all[a.id];
    write(KEY_ACCOUNTS, all);
    remove(`lw.best.${a.id}`);
    this.logOut();
  }

  recordMatch(won: boolean) {
    const a = this.state.account;
    if (!a) return;
    const played = { ...a, matchesPlayed: a.matchesPlayed + 1 };
    const next: Account = won ? addWin(played) : played;
    this.persist(next);
    this.set({ account: next });
  }

  winsThisWeek(): number {
    return this.state.account?.winsByWeek[weekKey()] ?? 0;
  }

  // ── developer controls ──
  devSkipSignup() {
    const phone = '+15555550100';
    let account = Object.values(this.accounts()).find((a) => a.phone === phone) ?? null;
    if (!account) {
      account = {
        id: 'u_devtester', phone, country: 'US', region: 'California', name: 'Dev tester', photo: null,
        createdAt: Date.now(), winsByWeek: {}, winsByDay: {}, totalWins: 0, matchesPlayed: 0, dev: true,
      };
      this.persist(account);
    }
    write(KEY_SESSION, account.id);
    account = migrate(account);
    this.set({ account, onboarding: false, pending: null, sms: null });
  }
  devRestartOnboarding() {
    const a = this.state.account;
    if (!a) return;
    const next = { ...a, name: '', region: '', photo: null };
    this.persist(next);
    this.set({ account: next, onboarding: true });
  }
  devAddWin() {
    const a = this.state.account;
    if (!a) return;
    const next = addWin({ ...a, matchesPlayed: a.matchesPlayed + 1 });
    this.persist(next);
    this.set({ account: next });
  }
  devSetAutofill(on: boolean) { write(KEY_DEV, on); this.set({ autofillCode: on }); }
  devResetAll() {
    kv.keys().filter((k) => k.startsWith('lw.')).forEach((k) => kv.remove(k));
    this.set({ account: null, onboarding: false, pending: null, sms: null, autofillCode: false });
  }
}

export const accounts = new AccountStore();
