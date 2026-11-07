// ── Friends, 1v1 challenges, invitations and notifications ─────────────────
// All of this lives on the server (see the phase9_social migration): the server
// times every attempt, checks and scores every word, settles each match once, and
// never sends a challenge's word or score before the player is allowed to see it.
import { useSyncExternalStore } from 'react';

import { supabase } from './supabase';

export const LINK_HOST = 'https://seanasewell.github.io';
export const inviteUrl = (token: string) => `${LINK_HOST}/invite/?t=${encodeURIComponent(token)}`;
export const INVITE_MESSAGE = "Think you can beat me? 🧠⚡ I'm playing Last Word, a competitive word game. Download it and challenge me!";

export interface Person { id: string | null; name: string; photo_url: string | null }
export type Relation = 'none' | 'sent' | 'received' | 'friends' | 'me';
export interface Record3 { wins: number; losses: number; draws: number }

export interface FriendRow { user_id: string; name: string; photo_url: string | null; relation: 'friends' | 'sent' | 'received'; wins: number; losses: number; draws: number; since: string }
export interface SearchRow { user_id: string; name: string; photo_url: string | null; country: string; region: string | null; relation: Relation }
export interface PlayerProfileData {
  id: string; name: string; photo_url: string | null; country: string; region: string | null; is_me: boolean;
  elimination_wins: number; solo_best: number; record: Record3;
  h2h: (Record3 & { streak: { holder: 'me' | 'them'; count: number } | null }) | null;
  relation: Relation; blocked: boolean;
}

export type ChallengeStatus = 'pending' | 'in_progress' | 'completed' | 'declined' | 'expired';
export interface ChallengeRow {
  id: string; role: 'challenger' | 'opponent'; other: Person | null; status: ChallengeStatus;
  created_at: string; expires_at: string; completed_at: string | null;
  my_score: number | null; their_score: number | null; outcome: 'win' | 'loss' | 'draw' | null;
  your_turn: boolean; invite_token: string | null; source: string | null;
}
export interface WordPoints { word: string; points: number }
export interface ChallengeDetail {
  id: string; status: ChallengeStatus; role: 'challenger' | 'opponent'; me: Person; other: Person | null;
  created_at: string; expires_at: string; completed_at: string | null; invite_token: string | null;
  source: string | null; my_score: number | null; their_score: number | null; outcome: 'win' | 'loss' | 'draw' | null;
  my_words: WordPoints[]; their_words: WordPoints[] | null; h2h: Record3 | null;
}
export type NotificationKind = 'friend_request' | 'friend_accepted' | 'challenge_received' | 'challenge_result' | 'challenge_declined' | 'challenge_expiring';
export interface NotificationRow { id: number; kind: NotificationKind; actor: Person; challenge_id: string | null; created_at: string; read: boolean }
export interface InviteInfo {
  kind: 'friend' | 'challenge' | 'unknown';
  state: 'ok' | 'own' | 'yours' | 'expired' | 'taken' | 'unavailable' | 'invalid';
  inviter?: Person; relation?: Relation; challenge_id?: string; expires_at?: string;
}
export interface SocialCounts {
  unread: number; your_turn: number; active: number; friends: number; requests: number;
  record: Record3; elimination_wins: number; solo_best: number;
}

/** Turn a server error into a short message for the player. */
export function friendlyError(e: unknown, fallback = 'Something went wrong. Try again.'): string {
  const m = (e as { message?: string })?.message ?? '';
  if (/network|fetch|timed? ?out/i.test(m)) return "Can't reach the server. Check your connection.";
  // Server messages written for players are passed straight through.
  if (/^(You|This|That|Player|Someone|Finish|Too many|Challenge not found)/.test(m)) return m;
  return fallback;
}

async function call<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args ?? {});
  if (error) throw new Error(error.message);
  return data as T;
}

const num = (x: unknown) => Number(x ?? 0);
const rec = (r: Partial<Record3> | null | undefined): Record3 => ({ wins: num(r?.wins), losses: num(r?.losses), draws: num(r?.draws) });

// ── Counts (badges) ──
let counts: SocialCounts | null = null;
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

export const social = {
  get: () => counts,
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  /** Refresh badge counts and stats (coalesces overlapping calls). */
  refresh(): Promise<void> {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        const c = await call<SocialCounts>('social_counts');
        counts = { ...c, unread: num(c.unread), your_turn: num(c.your_turn), active: num(c.active), friends: num(c.friends),
          requests: num(c.requests), record: rec(c.record), elimination_wins: num(c.elimination_wins), solo_best: num(c.solo_best) };
        listeners.forEach((l) => l());
      } catch { /* keep the last counts */ } finally { inflight = null; }
    })();
    return inflight;
  },
  reset() { counts = null; listeners.forEach((l) => l()); },
};
export function useSocial(): SocialCounts | null {
  return useSyncExternalStore(social.subscribe, social.get, social.get);
}

// ── Friends ──
export async function searchPlayers(q: string): Promise<SearchRow[]> {
  if (q.trim().length < 2) return [];
  return call<SearchRow[]>('search_players', { p_query: q.trim() });
}
export async function myFriends(): Promise<FriendRow[]> {
  const rows = await call<FriendRow[]>('my_friends');
  return rows.map((r) => ({ ...r, wins: num(r.wins), losses: num(r.losses), draws: num(r.draws) }));
}
export async function sendFriendRequest(userId: string): Promise<Relation> {
  const r = await call<Relation>('send_friend_request', { p_user: userId }); void social.refresh(); return r;
}
export async function respondFriendRequest(userId: string, accept: boolean): Promise<Relation> {
  const r = await call<Relation>('respond_friend_request', { p_user: userId, p_accept: accept }); void social.refresh(); return r;
}
/** Remove a friend, or cancel a request you sent. */
export async function removeFriend(userId: string): Promise<void> {
  await call('remove_friend', { p_user: userId }); void social.refresh();
}
export async function playerProfile(userId: string): Promise<PlayerProfileData> {
  const p = await call<PlayerProfileData>('player_profile', { p_user: userId });
  return { ...p, elimination_wins: num(p.elimination_wins), solo_best: num(p.solo_best), record: rec(p.record),
    h2h: p.h2h ? { ...rec(p.h2h), streak: p.h2h.streak ?? null } : null };
}

// ── Invitations ──
export const createFriendInvite = () => call<string>('create_friend_invite');
export const resolveInvite = (token: string) => call<InviteInfo>('resolve_invite', { p_token: token });
export async function acceptFriendInvite(token: string): Promise<string> {
  const r = await call<string>('accept_friend_invite', { p_token: token }); void social.refresh(); return r;
}
export const claimChallenge = (token: string) => call<string>('claim_challenge', { p_token: token });

// ── Challenges ──
export async function createChallenge(gameId: string, opponentId: string | null, rematchOf?: string | null): Promise<{ id: string; token: string }> {
  const r = await call<{ id: string; token: string }>('create_challenge', { p_game: gameId, p_opponent: opponentId, p_rematch_of: rematchOf ?? null });
  void social.refresh();
  return r;
}
export async function myChallenges(): Promise<ChallengeRow[]> {
  const rows = await call<ChallengeRow[]>('my_challenges');
  return rows.map((r) => ({ ...r, my_score: r.my_score == null ? null : num(r.my_score), their_score: r.their_score == null ? null : num(r.their_score) }));
}
export const challengeDetail = (id: string) => call<ChallengeDetail>('challenge_detail', { p_challenge: id });
export async function declineChallenge(id: string): Promise<void> { await call('decline_challenge', { p_challenge: id }); void social.refresh(); }

// ── Notifications ──
export const myNotifications = () => call<NotificationRow[]>('my_notifications');
export async function markNotificationsRead(ids?: number[]): Promise<void> {
  await call('mark_notifications_read', { p_ids: ids ?? null }); void social.refresh();
}
export const registerPushToken = (token: string, platform: string) => call('register_push_token', { p_token: token, p_platform: platform });

// ── Display helpers ──
export function timeLeft(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return 'Expired';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h left`;
  if (h >= 1) return `${h}h ${m}m left`;
  return `${Math.max(1, m)}m left`;
}
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return 'Just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
export const recordText = (r: Record3) => `${r.wins}W · ${r.losses}L · ${r.draws}D`;
export const hueFor = (id: string | null | undefined) => {
  let h = 0;
  for (const ch of id ?? 'x') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
};
export const personAvatar = (p: { id?: string | null; user_id?: string; name: string; photo_url?: string | null } | null) => ({
  glyph: (p?.name?.[0] ?? '?').toUpperCase(), hue: hueFor(p?.id ?? p?.user_id), photo: p?.photo_url ?? null,
});
