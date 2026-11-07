// ── Sign in with Apple / Google ────────────────────────────────────────────
// Players start as guests (anonymous Supabase users). Linking Apple or Google
// keeps the same player — same ID, level, wins and achievements — so they can
// sign back in on another phone. Apple uses the native sheet (iOS only);
// Google uses a secure browser sheet (works on iOS and Android).
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { supabase } from './supabase';

export type Provider = 'apple' | 'google';

export type SocialResult =
  | { kind: 'ok' }
  | { kind: 'cancel' }
  /** This Apple ID or Google account already belongs to another player. */
  | { kind: 'conflict' }
  | { kind: 'error'; message: string };

const redirectTo = () => Linking.createURL('auth');

let appleAvailable: boolean | null = null;
/** True on iPhones that support Sign in with Apple. */
export async function canUseApple(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  if (appleAvailable == null) appleAvailable = await AppleAuthentication.isAvailableAsync().catch(() => false);
  return appleAvailable;
}

function isConflict(message: string | undefined, code?: string): boolean {
  const m = (message ?? '').toLowerCase();
  return code === 'identity_already_exists' || m.includes('already linked') || m.includes('identity_already_exists') || m.includes('already been registered');
}

function friendly(message: string | undefined): string {
  const m = (message ?? '').toLowerCase();
  if (m.includes('manual linking') || m.includes('provider is not enabled') || m.includes('unsupported provider')) return "That sign-in option isn't available yet. Try again later.";
  if (m.includes('network') || m.includes('fetch')) return "Can't reach the server. Check your connection.";
  if (m.includes('rate') || m.includes('too many')) return 'Too many attempts. Wait a minute and try again.';
  return "Couldn't sign in. Try again.";
}

const isGuestNow = async () => (await supabase.auth.getSession()).data.session?.user.is_anonymous === true;

// ── Apple ──
async function appleCredential(): Promise<{ token: string; nonce: string; code: string | null } | 'cancel' | { error: string }> {
  try {
    const nonce = Crypto.randomUUID() + Crypto.randomUUID();
    const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
    const cred = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce: hashed,
    });
    if (!cred.identityToken) return { error: "Couldn't sign in with Apple. Try again." };
    return { token: cred.identityToken, nonce, code: cred.authorizationCode ?? null };
  } catch (e) {
    if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') return 'cancel';
    return { error: "Couldn't sign in with Apple. Try again." };
  }
}

async function apple(mode: 'link' | 'signin', captchaToken?: string | null): Promise<SocialResult> {
  const c = await appleCredential();
  if (c === 'cancel') return { kind: 'cancel' };
  if ('error' in c) return { kind: 'error', message: c.error };
  if (mode === 'link') {
    const { error } = await supabase.auth.linkIdentity({ provider: 'apple', token: c.token, nonce: c.nonce });
    if (!error) { keepAppleToken(c.code); return { kind: 'ok' }; }
    if (isConflict(error.message, error.code)) return { kind: 'conflict' };
    return { kind: 'error', message: friendly(error.message) };
  }
  const { error } = await supabase.auth.signInWithIdToken({
    provider: 'apple', token: c.token, nonce: c.nonce,
    ...(captchaToken ? { options: { captchaToken } } : {}),
  });
  if (error) return { kind: 'error', message: friendly(error.message) };
  keepAppleToken(c.code);
  return { kind: 'ok' };
}

/**
 * Apple asks apps to revoke Sign in with Apple when an account is deleted. The server
 * swaps this one-time code for a token it can revoke later (see the apple-auth function).
 */
function keepAppleToken(code: string | null) {
  if (code) void supabase.functions.invoke('apple-auth', { body: { action: 'store', code } }).catch(() => {});
}

/** Revoke Sign in with Apple for the signed-in player (before deleting the account). */
export async function revokeApple(): Promise<void> {
  await supabase.functions.invoke('apple-auth', { body: { action: 'revoke' } }).catch(() => {});
}

// ── Google (browser sheet + PKCE) ──
async function google(mode: 'link' | 'signin'): Promise<SocialResult> {
  const options = { redirectTo: redirectTo(), skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } };
  const { data, error } = mode === 'link'
    ? await supabase.auth.linkIdentity({ provider: 'google', options })
    : await supabase.auth.signInWithOAuth({ provider: 'google', options });
  if (error || !data?.url) return { kind: 'error', message: friendly(error?.message) };

  const res = await WebBrowser.openAuthSessionAsync(data.url, options.redirectTo);
  if (res.type !== 'success') return { kind: 'cancel' };

  const parsed = Linking.parse(res.url.replace('#', '?'));
  const q = (parsed.queryParams ?? {}) as Record<string, string | undefined>;
  if (q.error || q.error_description) {
    const msg = decodeURIComponent((q.error_description ?? q.error ?? '').replace(/\+/g, ' '));
    if (isConflict(msg, q.error_code)) return { kind: 'conflict' };
    return { kind: 'error', message: friendly(msg) };
  }
  if (!q.code) return { kind: 'error', message: friendly('') };
  const ex = await supabase.auth.exchangeCodeForSession(q.code);
  return ex.error ? { kind: 'error', message: friendly(ex.error.message) } : { kind: 'ok' };
}

/**
 * Link Apple/Google to the current guest so their progress is saved.
 * Returns `conflict` if that account already belongs to another player.
 */
export async function linkProvider(p: Provider): Promise<SocialResult> {
  if (!(await isGuestNow())) return { kind: 'error', message: 'Already signed in.' };
  return p === 'apple' ? apple('link') : google('link');
}

/** Sign in to an existing player (or create one) with Apple/Google. Replaces any guest on this phone. */
export async function signInWithProvider(p: Provider, captchaToken?: string | null): Promise<SocialResult> {
  return p === 'apple' ? apple('signin', captchaToken) : google('signin');
}

WebBrowser.maybeCompleteAuthSession();
