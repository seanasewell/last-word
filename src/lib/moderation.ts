// ── Report and block ────────────────────────────────────────────────────────
// Players can report another player's name or photo, and block players.
// Blocked players are hidden from your leaderboards and never put in your
// lobby. Reports are stored for review; a name or photo reported by three
// different players is reset automatically (see the phase4 migration).
import { supabase } from './supabase';

/** Who to act on: a user id (from the ranks) or a seat in a match. */
export type Target = { userId: string } | { matchPlayerId: string };

const args = (t: Target) => ('userId' in t ? { p_user: t.userId } : { p_match_player: t.matchPlayerId });

export type ReportReason = 'name' | 'photo' | 'cheating' | 'other';

/** Report a player. `details` is the player's own words, for "Other". */
export async function reportPlayer(t: Target, reason: ReportReason, details?: string): Promise<string | null> {
  const { error } = await supabase.rpc('report_player', { p_reason: reason, ...args(t), ...(details ? { p_details: details } : {}) });
  return error ? "Couldn't send the report. Try again." : null;
}

export async function blockPlayer(t: Target): Promise<string | null> {
  const { error } = await supabase.rpc('block_player', args(t));
  return error ? "Couldn't block this player. Try again." : null;
}

export async function unblockPlayer(userId: string): Promise<string | null> {
  const { error } = await supabase.rpc('unblock_player', { p_user: userId });
  return error ? "Couldn't unblock. Try again." : null;
}

export interface BlockedPlayer { userId: string; name: string; photo: string | null }

export async function myBlocks(): Promise<BlockedPlayer[]> {
  const { data, error } = await supabase.rpc('my_blocks');
  if (error) throw new Error(error.message);
  return ((data ?? []) as { user_id: string; name: string; photo_url: string | null }[]).map((r) => ({ userId: r.user_id, name: r.name, photo: r.photo_url }));
}
