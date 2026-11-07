// ── Friends, player profiles, 1v1 challenges, notifications, invitations ───
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, ScrollView, Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import {
  acceptChallenge, acceptFriendInvite, ago, cancelChallenge, challengeDetail, createChallenge, createFriendInvite, declineChallenge,
  friendlyError, INVITE_MESSAGE, inviteUrl, markNotificationsRead, myChallenges, myFriends, myNotifications,
  personAvatar, playerProfile, recordText, removeFriend, resolveInvite, respondFriendRequest, searchPlayers,
  sendFriendRequest, social, timeLeft, useSocial,
  type ChallengeDetail, type ChallengeRow, type FriendRow, type InviteInfo, type NotificationRow, type Person,
  type PlayerProfileData, type Record3, type Relation, type SearchRow,
} from '@/lib/challenges';
import { engine } from '@/lib/engine';
import { kv } from '@/lib/kv';
import { Avatar, Button, Card, s, Sheet, TextField, toast, useNow } from './kit';
import { nav, inviteTokenFrom } from './nav';
import { PlayerActions, type PlayerRef } from './PlayerActions';
import { sfx } from './sound';
import { C, F, w } from './theme';

// ── Shared bits ────────────────────────────────────────────────────────────
const row = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 };
const sub = { fontFamily: F.body, fontSize: 12, color: w(0.65) };

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    load().then((d) => { if (live) { setData(d); setError(null); } }).catch((e) => { if (live) setError(friendlyError(e, "Couldn't load this. Pull down or try again.")); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: useCallback(() => setTick((n) => n + 1), []), setData };
}

function Loading() { return <ActivityIndicator color={C.primary} style={{ marginVertical: 32 }} />; }

function ErrorText({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <View style={{ alignItems: 'center', marginVertical: 24, gap: 10 }}>
      <Text style={{ fontFamily: F.body, fontSize: 14, color: C.coral, textAlign: 'center' }}>{text}</Text>
      {onRetry && <Pressable onPress={onRetry} hitSlop={8}><Text style={{ fontFamily: F.bodyBold, color: C.primary }}>Try again</Text></Pressable>}
    </View>
  );
}

export function Empty({ emoji, title, body, children }: { emoji: string; title: string; body?: string; children?: React.ReactNode }) {
  return (
    <Card style={{ padding: 20, alignItems: 'center', marginTop: 8 }}>
      <Text style={{ fontSize: 30 }}>{emoji}</Text>
      <Text style={{ fontFamily: F.displayBold, fontSize: 17, color: C.white, marginTop: 6, textAlign: 'center' }}>{title}</Text>
      {body && <Text style={[s.body, { textAlign: 'center', marginTop: 4, fontSize: 14 }]}>{body}</Text>}
      {children}
    </Card>
  );
}

const Eyebrow = ({ children, right }: { children: string; right?: string }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: 24, marginBottom: 8 }}>
    <Text style={s.eyebrow}>{children}</Text>
    {right ? <Text style={sub}>{right}</Text> : null}
  </View>
);

function SmallButton({ title, onPress, variant = 'primary', disabled = false }: { title: string; onPress: () => void; variant?: 'primary' | 'ghost' | 'danger'; disabled?: boolean }) {
  const bg = variant === 'primary' ? C.primary : variant === 'danger' ? 'rgba(255,93,115,0.15)' : w(0.06);
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" hitSlop={4}
      style={({ pressed }) => ({ height: 34, paddingHorizontal: 14, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: bg, opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.96 : 1 }] })}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: variant === 'danger' ? C.coral : C.white }}>{title}</Text>
    </Pressable>
  );
}

/** Three big numbers with small labels: wins, losses, draws. */
export function RecordStats({ r, size = 26 }: { r: Record3; size?: number }) {
  const cell = (label: string, v: number, color: string) => (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={[{ fontFamily: F.display, fontSize: size, color }, s.tabular]}>{v}</Text>
      <Text style={[s.eyebrow, { marginTop: 2 }]}>{label}</Text>
    </View>
  );
  return (
    <View style={{ flexDirection: 'row' }}>
      {cell('Wins', r.wins, C.mint)}
      <View style={{ width: 1, backgroundColor: C.divider, marginVertical: 4 }} />
      {cell('Losses', r.losses, C.white)}
      <View style={{ width: 1, backgroundColor: C.divider, marginVertical: 4 }} />
      {cell('Draws', r.draws, C.white)}
    </View>
  );
}

function PersonAvatar({ p, size = 40 }: { p: { id?: string | null; user_id?: string; name: string; photo_url?: string | null } | null; size?: number }) {
  return <Avatar player={personAvatar(p)} size={size} />;
}

async function shareText(message: string) {
  try { await Share.share({ message }); } catch { /* dismissed */ }
}

/** Share a friend invitation through the phone's share sheet (one button, any app). */
export async function shareFriendInvite(): Promise<string | null> {
  try {
    const token = await createFriendInvite();
    await shareText(`${INVITE_MESSAGE}\n${inviteUrl(token)}`);
    return null;
  } catch (e) { return friendlyError(e, "Couldn't create an invite link. Try again."); }
}

// ── Friends ────────────────────────────────────────────────────────────────
export function FriendsScreen() {
  const list = useLoad(myFriends, []);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchRow[] | null>(null);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const term = q.trim();
  useEffect(() => {
    if (term.length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      searchPlayers(term).then((r) => { if (live) { setResults(r); setSearchErr(null); } })
        .catch((e) => { if (live) setSearchErr(friendlyError(e, "Couldn't search right now.")); });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [term]);
  const shown = term.length >= 2 ? results : null;

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    try { await fn(); list.reload(); if (results) setResults(await searchPlayers(q.trim())); }
    catch (e) { setNote(friendlyError(e)); }
    finally { setBusy(null); }
  };
  const invite = async () => { const e = await shareFriendInvite(); if (e) setNote(e); };
  const pasteInvite = async () => {
    const text = (await Clipboard.getUrlAsync().catch(() => null)) ?? (await Clipboard.getStringAsync().catch(() => ''));
    const token = inviteTokenFrom(text);
    if (token) nav.push({ name: 'invite', token });
    else setNote('Copy the invite link your friend sent you, then tap Paste invite link again.');
  };

  const all = list.data ?? [];
  const incoming = all.filter((f) => f.relation === 'received');
  const outgoing = all.filter((f) => f.relation === 'sent');
  const friends = all.filter((f) => f.relation === 'friends');

  return (
    <View>
      <Card style={{ padding: 20, borderColor: 'rgba(61,139,255,0.45)', backgroundColor: 'rgba(61,139,255,0.12)' }}>
        <Text style={{ fontSize: 28 }}>👋</Text>
        <Text style={{ fontFamily: F.displayBold, fontSize: 20, color: C.white, marginTop: 6 }}>Invite friends to play</Text>
        <Text style={[s.body, { marginTop: 4, fontSize: 14 }]}>Bring your friends to Last Word and challenge them to beat your score.</Text>
        <Button title="Invite friends" style={{ marginTop: 14 }} onPress={() => void invite()} />
      </Card>
      {note && <Text style={{ marginTop: 10, fontFamily: F.body, fontSize: 13, color: C.coral, textAlign: 'center' }} onPress={() => setNote(null)}>{note}</Text>}

      <Eyebrow>Find players</Eyebrow>
      <TextField value={q} onChangeText={setQ} placeholder="Search by name" autoCorrect={false} autoCapitalize="none"
        returnKeyType="search" accessibilityLabel="Search players by name" style={{ height: 46, borderRadius: 14, fontSize: 16 }} />
      {searchErr && <ErrorText text={searchErr} />}
      {shown && shown.length === 0 && <Text style={[sub, { marginTop: 10, textAlign: 'center' }]}>No players found.</Text>}
      {shown && shown.length > 0 && (
        <View style={{ gap: 6, marginTop: 8 }}>
          {shown.map((r) => (
            <PlayerRow key={r.user_id} p={{ id: r.user_id, name: r.name, photo_url: r.photo_url }} subtitle={r.region ?? undefined}
              right={<RelationButton rel={r.relation} busy={busy === r.user_id}
                onAdd={() => void act(r.user_id, () => sendFriendRequest(r.user_id))}
                onAccept={() => void act(r.user_id, () => respondFriendRequest(r.user_id, true))} />} />
          ))}
        </View>
      )}

      {list.error && <ErrorText text={list.error} onRetry={list.reload} />}
      {!list.data && !list.error && <Loading />}

      {incoming.length > 0 && (
        <>
          <Eyebrow right={`${incoming.length}`}>Friend requests</Eyebrow>
          <View style={{ gap: 6 }}>
            {incoming.map((f) => (
              <PlayerRow key={f.user_id} p={{ id: f.user_id, name: f.name, photo_url: f.photo_url }} subtitle="Wants to be friends"
                right={(
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <SmallButton title="Accept" disabled={busy === f.user_id} onPress={() => void act(f.user_id, () => respondFriendRequest(f.user_id, true))} />
                    <SmallButton title="Decline" variant="ghost" disabled={busy === f.user_id} onPress={() => void act(f.user_id, () => respondFriendRequest(f.user_id, false))} />
                  </View>
                )} />
            ))}
          </View>
        </>
      )}

      {list.data && (
        <>
          <Eyebrow right={friends.length ? `${friends.length}` : undefined}>Your friends</Eyebrow>
          {friends.length === 0 ? (
            <Empty emoji="🤝" title="No friends yet" body="Invite friends, or search for players by name to add them." />
          ) : (
            <View style={{ gap: 6 }}>
              {friends.map((f) => <FriendRowView key={f.user_id} f={f} />)}
            </View>
          )}
        </>
      )}

      {outgoing.length > 0 && (
        <>
          <Eyebrow>Sent requests</Eyebrow>
          <View style={{ gap: 6 }}>
            {outgoing.map((f) => (
              <PlayerRow key={f.user_id} p={{ id: f.user_id, name: f.name, photo_url: f.photo_url }} subtitle="Request sent"
                right={<SmallButton title="Cancel" variant="ghost" disabled={busy === f.user_id} onPress={() => void act(f.user_id, () => removeFriend(f.user_id))} />} />
            ))}
          </View>
        </>
      )}

      <Pressable onPress={() => void pasteInvite()} hitSlop={8} style={{ alignSelf: 'center', marginTop: 24 }}>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: w(0.7), textDecorationLine: 'underline' }}>Have an invite link? Paste invite link</Text>
      </Pressable>
    </View>
  );
}

function RelationButton({ rel, busy, onAdd, onAccept }: { rel: Relation; busy: boolean; onAdd: () => void; onAccept: () => void }) {
  if (rel === 'friends') return <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.mint }}>Friends ✓</Text>;
  if (rel === 'sent') return <Text style={sub}>Requested</Text>;
  if (rel === 'received') return <SmallButton title="Accept" disabled={busy} onPress={onAccept} />;
  return <SmallButton title="Add friend" disabled={busy} onPress={onAdd} />;
}

function PlayerRow({ p, subtitle, right, onPress }: { p: Person; subtitle?: string; right?: React.ReactNode; onPress?: () => void }) {
  const open = onPress ?? (p.id ? () => nav.push({ name: 'player', id: p.id! }) : undefined);
  return (
    <Pressable onPress={open} disabled={!open}
      style={({ pressed }) => [row, { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16, backgroundColor: pressed ? 'rgba(61,139,255,0.12)' : w(0.04) }]}>
      <PersonAvatar p={p} size={38} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.white }}>{p.name}</Text>
        {subtitle ? <Text numberOfLines={1} style={sub}>{subtitle}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}

function FriendRowView({ f }: { f: FriendRow }) {
  const played = f.wins + f.losses + f.draws;
  const action = useChallengeAction();
  return (
    <PlayerRow p={{ id: f.user_id, name: f.name, photo_url: f.photo_url }}
      subtitle={played ? `You ${recordText(f)}` : 'No 1v1s yet'}
      right={<SmallButton title={action.busy ? 'Sending…' : 'Challenge'} disabled={action.busy} onPress={() => void action.run(() => sendChallenge({ id: f.user_id, name: f.name }))} />} />
  );
}

// ── Player profile ─────────────────────────────────────────────────────────
export function PlayerScreen({ id }: { id: string }) {
  const { data: p, error, reload, setData } = useLoad<PlayerProfileData>(() => playerProfile(id), [id]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [acting, setActing] = useState<PlayerRef | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const challenge = useChallengeAction();
  if (error) return <Empty emoji="🙈" title="Player unavailable" body="This player can't be shown right now." />;
  if (!p) return <Loading />;

  const act = async (fn: () => Promise<Relation | void>) => {
    setBusy(true); setNote(null);
    try { const rel = await fn(); if (rel) setData({ ...p, relation: rel }); else reload(); }
    catch (e) { setNote(friendlyError(e)); } finally { setBusy(false); }
  };
  const h = p.h2h;
  const streak = h?.streak ? (h.streak.holder === 'me' ? `You've won the last ${h.streak.count}` : `${p.name} has won the last ${h.streak.count}`) : null;

  return (
    <View>
      <View style={{ alignItems: 'center' }}>
        <PersonAvatar p={p} size={96} />
        <Text style={[s.h1, { marginTop: 12, textAlign: 'center' }]}>{p.name}</Text>
        {p.region ? <Text style={sub}>{p.region}</Text> : null}
      </View>

      {!p.is_me && !p.blocked && (
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
          <View style={{ flex: 1 }}>
            {p.relation === 'friends' ? (
              <Button title="Friends ✓" variant="ghost" onPress={() => setConfirmRemove(true)} />
            ) : p.relation === 'sent' ? (
              <Button title="Request sent" variant="ghost" disabled={busy} onPress={() => void act(async () => { await removeFriend(p.id); return 'none'; })} />
            ) : p.relation === 'received' ? (
              <Button title="Accept request" disabled={busy} onPress={() => void act(() => respondFriendRequest(p.id, true))} />
            ) : (
              <Button title="Add friend" variant="ghost" disabled={busy} onPress={() => void act(() => sendFriendRequest(p.id))} />
            )}
          </View>
          <View style={{ flex: 1 }}><Button title={challenge.busy ? 'Sending…' : 'Challenge ⚔️'} disabled={challenge.busy} onPress={() => void challenge.run(() => sendChallenge({ id: p.id, name: p.name }))} /></View>
        </View>
      )}
      {note && <Text style={{ marginTop: 10, fontFamily: F.body, fontSize: 13, color: C.coral, textAlign: 'center' }}>{note}</Text>}
      {p.blocked && <Text style={[s.body, { textAlign: 'center', marginTop: 14 }]}>{"You've blocked this player. Unblock them in Settings → Blocked players."}</Text>}

      <View style={{ flexDirection: 'row', gap: 8, marginTop: 20 }}>
        <Card style={{ flex: 1, paddingHorizontal: 16, paddingVertical: 12 }}>
          <Text style={s.eyebrow}>Elimination wins</Text>
          <Text style={[{ fontFamily: F.display, fontSize: 22, color: C.white }, s.tabular]}>{p.elimination_wins}</Text>
        </Card>
        <Card style={{ flex: 1, paddingHorizontal: 16, paddingVertical: 12 }}>
          <Text style={s.eyebrow}>Solo best</Text>
          <Text style={[{ fontFamily: F.display, fontSize: 22, color: C.amber }, s.tabular]}>{p.solo_best}</Text>
        </Card>
      </View>
      <Card style={{ marginTop: 8, paddingVertical: 14 }}>
        <Text style={[s.eyebrow, { textAlign: 'center', marginBottom: 8 }]}>1v1 record</Text>
        <RecordStats r={p.record} />
      </Card>
      {h && (
        <Card style={{ marginTop: 8, paddingVertical: 14, borderColor: 'rgba(61,139,255,0.4)' }}>
          <Text style={[s.eyebrow, { textAlign: 'center', marginBottom: 8 }]}>You vs {p.name}</Text>
          <RecordStats r={h} />
          {streak && <Text style={{ textAlign: 'center', marginTop: 10, fontFamily: F.bodySemi, fontSize: 13, color: h.streak?.holder === 'me' ? C.mint : C.amber }}>🔥 {streak}</Text>}
        </Card>
      )}

      {!p.is_me && (
        <Pressable onPress={() => setActing({ name: p.name, glyph: p.name[0]?.toUpperCase() ?? '?', hue: personAvatar(p).hue, photo: p.photo_url, target: { userId: p.id } })}
          hitSlop={8} style={{ alignSelf: 'center', marginTop: 24 }}>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: w(0.6) }}>Report or block</Text>
        </Pressable>
      )}

      <PlayerActions player={acting} onClose={() => setActing(null)} onBlocked={() => { void social.refresh(); reload(); }} />
      <Sheet open={confirmRemove} onClose={() => setConfirmRemove(false)} title={`Remove ${p.name}?`}>
        <Text style={s.body}>{"You'll stop being friends. Your 1v1 history stays."}</Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
          <Button title="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => setConfirmRemove(false)} />
          <Button title="Remove friend" variant="danger" style={{ flex: 1 }} onPress={() => { setConfirmRemove(false); void act(async () => { await removeFriend(p.id); return 'none'; }); }} />
        </View>
      </Sheet>
    </View>
  );
}

// ── Challenges ─────────────────────────────────────────────────────────────
// A challenge starts as an invitation. Nobody sees the word or can play until the
// opponent accepts; then both play the same word once each, in any order.

/** Send a challenge, then show the challenges list. Throws a server message (e.g. an open one already exists). */
export async function sendChallenge(to: { id: string; name: string }, rematchOf?: string | null): Promise<void> {
  await createChallenge(to.id, rematchOf ?? null);
  // Back to the list, where it shows under "Sent challenges".
  nav.backTo({ name: 'challenges' });
}

/** Play your round of an accepted challenge (the word is revealed and the timer starts only now). */
export function playChallenge(challengeId: string, opponentName: string) {
  nav.reset();
  engine.startSingle({ kind: 'play', challengeId, opponentName });
}

/** A button that sends a challenge, with its own busy state and error line. */
/** Errors (e.g. "You already have an open challenge…") show in the banner at the top; the player stays where they are. */
const challengeError = (e: unknown) => toast.show(friendlyError(e, "Couldn't send the challenge. Try again."));
function useChallengeAction() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    try { await fn(); } catch (e) { challengeError(e); } finally { setBusy(false); }
  }, []);
  return { busy, run };
}

function statusLabel(c: ChallengeRow): string {
  if (c.status === 'completed') {
    const r = c.outcome === 'win' ? 'You won' : c.outcome === 'loss' ? 'You lost' : 'Draw';
    return c.forfeit ? `${r} · no-show` : r;
  }
  if (c.status === 'expired') return 'Expired';
  if (c.status === 'declined') return 'Declined';
  if (c.status === 'cancelled') return 'Cancelled';
  if (c.status === 'pending') return 'Pending';
  if (c.your_turn) return 'Your turn';
  return 'Waiting for them to play';
}

export function ChallengesScreen({ tab: initial = 'active' }: { tab?: 'active' | 'history' }) {
  const [tab, setTab] = useState<'active' | 'history'>(initial);
  const list = useLoad(myChallenges, []);
  const counts = useSocial();
  const now = useNow(true, 30_000);
  const [picking, setPicking] = useState(false);
  const action = useChallengeAction();
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { void social.refresh(); }, []);

  const all = list.data ?? [];
  const isActive = (c: ChallengeRow) => c.status === 'pending' || c.status === 'accepted';
  const invites = all.filter((c) => isActive(c) && c.needs_response);
  const ready = all.filter((c) => isActive(c) && c.your_turn);
  const waiting = all.filter((c) => isActive(c) && !c.needs_response && !c.your_turn);
  const history = all.filter((c) => !isActive(c));
  const cancel = async (c: ChallengeRow) => {
    setNote(null);
    try { await cancelChallenge(c.id); } catch (e) { setNote(friendlyError(e)); }
    list.reload();
  };
  const respond = async (c: ChallengeRow, accept: boolean) => {
    setNote(null);
    try {
      // Accepting moves it to "Ready to play" on this list.
      if (accept) await acceptChallenge(c.id); else await declineChallenge(c.id);
      list.reload();
    } catch (e) { setNote(friendlyError(e)); list.reload(); }
  };
  const record = counts?.record ?? { wins: 0, losses: 0, draws: 0 };
  const played = record.wins + record.losses + record.draws;
  const activeCount = invites.length + ready.length + waiting.length;

  return (
    <View>
      <Card style={{ paddingVertical: 14 }}>
        <Text style={[s.eyebrow, { textAlign: 'center', marginBottom: 8 }]}>Your 1v1 record</Text>
        <RecordStats r={record} />
        {played > 0 && <Text style={[sub, { textAlign: 'center', marginTop: 8 }]}>{played} {played === 1 ? 'match' : 'matches'} · {Math.round((record.wins / played) * 100)}% win rate</Text>}
      </Card>
      <Button title={action.busy ? 'Sending…' : 'New challenge ⚔️'} disabled={action.busy} style={{ marginTop: 12 }} onPress={() => setPicking(true)} />

      <View style={{ flexDirection: 'row', gap: 4, padding: 4, marginTop: 18, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder }}>
        {(['active', 'history'] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}
            style={{ flex: 1, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: tab === t ? C.primary : 'transparent' }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: tab === t ? C.white : w(0.72) }}>
              {t === 'active' ? `Active${activeCount ? ` · ${activeCount}` : ''}` : 'History'}
            </Text>
          </Pressable>
        ))}
      </View>
      {note && <Text style={{ marginTop: 10, fontFamily: F.body, fontSize: 13, color: C.coral, textAlign: 'center' }}>{note}</Text>}
      {list.error && <ErrorText text={list.error} onRetry={list.reload} />}
      {!list.data && !list.error && <Loading />}

      {list.data && tab === 'active' && (
        activeCount === 0 ? (
          <View style={{ marginTop: 12 }}><Empty emoji="⚔️" title="No active challenges" body="Challenge a friend. The round unlocks once they accept." /></View>
        ) : (
          <>
            {invites.length > 0 && (
              <>
                <Eyebrow right={`${invites.length}`}>Challenges</Eyebrow>
                <View style={{ gap: 6 }}>
                  {invites.map((c) => (
                    <ChallengeRowView key={c.id} c={c} now={now}
                      right={(
                        <View style={{ flexDirection: 'row', gap: 6 }}>
                          <SmallButton title="Decline" variant="ghost" onPress={() => void respond(c, false)} />
                          <SmallButton title="Accept" onPress={() => void respond(c, true)} />
                        </View>
                      )} />
                  ))}
                </View>
              </>
            )}
            {ready.length > 0 && (
              <>
                <Eyebrow right={`${ready.length}`}>Ready to play</Eyebrow>
                <View style={{ gap: 6 }}>
                  {ready.map((c) => (
                    <ChallengeRowView key={c.id} c={c} now={now}
                      right={<SmallButton title="Play" onPress={() => playChallenge(c.id, c.other?.name ?? 'Player')} />} />
                  ))}
                </View>
              </>
            )}
            {waiting.length > 0 && (
              <>
                <Eyebrow>Sent challenges</Eyebrow>
                <View style={{ gap: 6 }}>
                  {waiting.map((c) => (
                    <ChallengeRowView key={c.id} c={c} now={now}
                      right={c.status === 'pending'
                        ? <SmallButton title="Cancel" variant="ghost" onPress={() => void cancel(c)} />
                        : <SmallButton title="View" variant="ghost" onPress={() => nav.push({ name: 'challenge', id: c.id })} />} />
                  ))}
                </View>
              </>
            )}
          </>
        )
      )}

      {list.data && tab === 'history' && (
        history.length === 0 ? (
          <View style={{ marginTop: 12 }}><Empty emoji="📜" title="No challenge history" body="Finished, declined and expired challenges show up here." /></View>
        ) : (
          <View style={{ gap: 6, marginTop: 12 }}>
            {history.map((c) => (
              <ChallengeRowView key={c.id} c={c} now={now} pressable
                right={c.status === 'completed' && c.other?.id
                  ? <SmallButton title="Rematch" disabled={action.busy} onPress={() => void action.run(async () => { await sendChallenge({ id: c.other!.id!, name: c.other!.name }, c.id); setTab('active'); list.reload(); })} />
                  : undefined} />
            ))}
          </View>
        )
      )}

      <ChallengePicker open={picking} onClose={() => setPicking(false)}
        onPick={async (to) => { await sendChallenge(to); setPicking(false); setTab('active'); list.reload(); }} />
    </View>
  );
}

/** `pressable`: the whole card opens the challenge (History). Active cards act only through their buttons. */
function ChallengeRowView({ c, now, right, pressable = false }: { c: ChallengeRow; now: number; right?: React.ReactNode; pressable?: boolean }) {
  const other: Person = c.other ?? { id: null, name: 'Deleted player', photo_url: null };
  const done = c.status === 'completed';
  const color = done ? (c.outcome === 'win' ? C.mint : c.outcome === 'loss' ? C.coral : C.amber)
    : c.needs_response || c.your_turn ? C.amber : w(0.65);
  const when = done
    ? `${c.my_score ?? '–'} – ${c.their_score ?? '–'} · ${new Date(c.completed_at ?? c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : c.status === 'pending' || c.status === 'accepted' ? timeLeft(c.expires_at, now)
    : new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <Pressable disabled={!pressable} onPress={() => nav.push({ name: 'challenge', id: c.id })}
      style={({ pressed }) => [row, { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16, backgroundColor: pressed ? 'rgba(61,139,255,0.12)' : w(0.04) }]}>
      <PersonAvatar p={other} size={38} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.white }}>{other.name}</Text>
        {c.needs_response
          ? <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 12, color }}>{when}</Text>
          : <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 12, color }}>{statusLabel(c)}<Text style={sub}>{`  ·  ${when}`}</Text></Text>}
      </View>
      {right}
    </Pressable>
  );
}

/** One challenge: the invitation, the ready-to-play state, waiting, or the full results. */
export function ChallengeScreen({ id }: { id: string }) {
  const { data: d, error, reload } = useLoad<ChallengeDetail>(() => challengeDetail(id), [id]);
  const now = useNow(true, 30_000);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const rematch = useChallengeAction();
  if (error) return <ErrorText text={error} onRetry={reload} />;
  if (!d) return <Loading />;
  const other: Person = d.other ?? { id: null, name: 'Deleted player', photo_url: null };
  const done = d.status === 'completed';
  const open = d.status === 'pending' || d.status === 'accepted';
  const act = async (fn: () => Promise<void>) => {
    setBusy(true); setNote(null);
    try { await fn(); } catch (e) { setNote(friendlyError(e)); } finally { setBusy(false); reload(); }
  };

  let title: string; let body: string;
  if (d.status === 'expired') { title = 'This challenge expired'; body = 'No win or loss for either player.'; }
  else if (d.status === 'declined') { title = d.role === 'challenger' ? `${other.name} declined` : 'You declined'; body = 'No win or loss for either player.'; }
  else if (d.status === 'cancelled') { title = 'Challenge cancelled'; body = 'No win or loss for either player.'; }
  else if (d.needs_response) { title = `${other.name} challenged you`; body = 'Accept to unlock the round. You both get the same word, 60 seconds and one try.'; }
  else if (d.status === 'pending') {
    title = `Waiting for ${other.name} to accept`;
    body = 'The round unlocks for both of you once they accept.';
  } else if (d.your_turn) {
    title = 'Your round is ready';
    body = d.they_played ? `${other.name} has played. Their score stays hidden until you finish.` : '';
  } else { title = `Waiting for ${other.name} to play`; body = `Your score: ${d.my_score ?? 0}. They can't see it until they play.`; }

  return (
    <View>
      {done ? <ResultHeader d={d} /> : (
        <Card style={{ padding: 20, alignItems: 'center' }}>
          <View style={[row, { gap: 18 }]}>
            <PersonAvatar p={d.me} size={56} />
            <Text style={{ fontFamily: F.display, fontSize: 20, color: w(0.6) }}>vs</Text>
            <PersonAvatar p={other} size={56} />
          </View>
          <Text style={{ fontFamily: F.displayBold, fontSize: 18, color: C.white, marginTop: 12, textAlign: 'center' }}>{title}</Text>
          {body ? <Text style={[s.body, { textAlign: 'center', marginTop: 4, fontSize: 14 }]}>{body}</Text> : null}
          {open && <Text style={{ marginTop: 8, fontFamily: F.bodySemi, fontSize: 13, color: C.amber }}>{timeLeft(d.expires_at, now)}</Text>}

          <View style={{ alignSelf: 'stretch', gap: 8, marginTop: 16 }}>
            {d.needs_response && (
              <>
                <Button title={busy ? 'Accepting…' : 'Accept challenge'} disabled={busy} onPress={() => void act(async () => { await acceptChallenge(d.id); nav.backTo({ name: 'challenges' }); })} />
                <Button title="Decline" variant="ghost" disabled={busy} onPress={() => void act(() => declineChallenge(d.id))} />
              </>
            )}
            {d.your_turn && <Button title="Play now" onPress={() => playChallenge(d.id, other.name)} />}
            {d.role === 'challenger' && d.status === 'pending' && (
              <>
                <Button title="Cancel challenge" variant="ghost" disabled={busy} onPress={() => void act(() => cancelChallenge(d.id))} />
              </>
            )}
          </View>
          {note && <Text style={{ marginTop: 10, fontFamily: F.body, fontSize: 13, color: C.coral, textAlign: 'center' }}>{note}</Text>}
        </Card>
      )}

      {d.source && <Text style={[sub, { textAlign: 'center', marginTop: 12 }]}>Word: <Text style={{ fontFamily: F.bodyBold, color: C.white }}>{d.source}</Text></Text>}

      {done && <WordCompare mine={d.my_words} theirs={d.their_words ?? []} otherName={other.name} />}
      {!done && d.my_words.length > 0 && (
        <>
          <Eyebrow>Your words</Eyebrow>
          <WordChips words={d.my_words.map((x) => x.word)} />
        </>
      )}

      {(done || !open) && (
        <View style={{ gap: 10, marginTop: 24 }}>
          {d.other?.id && (
            <Button title={rematch.busy ? 'Sending…' : done ? 'Rematch' : 'Challenge again'} disabled={rematch.busy}
              onPress={() => void rematch.run(() => sendChallenge({ id: d.other!.id!, name: d.other!.name }, done ? d.id : null))} />
          )}
          <Button title="Back to challenges" variant="ghost" onPress={() => nav.backTo({ name: 'challenges' })} />
        </View>
      )}
    </View>
  );
}

function ResultHeader({ d }: { d: ChallengeDetail }) {
  const other: Person = d.other ?? { id: null, name: 'Deleted player', photo_url: null };
  const win = d.outcome === 'win';
  const title = d.outcome === 'draw' ? "It's a draw" : win ? 'You win! 🏆' : `${other.name} wins`;
  const side = (p: Person, score: number | null, lead: boolean) => (
    <View style={{ flex: 1, alignItems: 'center', gap: 6 }}>
      <PersonAvatar p={p} size={64} />
      <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.white }}>{p.name}</Text>
      <Text style={[{ fontFamily: F.display, fontSize: 34, color: lead ? C.amber : w(0.85) }, s.tabular]}>{score ?? 0}</Text>
    </View>
  );
  return (
    <Card style={{ padding: 20, borderColor: win ? 'rgba(255,181,71,0.45)' : C.cardBorder, backgroundColor: win ? 'rgba(255,181,71,0.08)' : C.card }}>
      <Text style={{ fontFamily: F.displayBold, fontSize: 26, color: win ? C.amber : C.white, textAlign: 'center' }}>{title}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 }}>
        {side(d.me, d.my_score, d.outcome === 'win')}
        {side(other, d.their_score, d.outcome === 'loss')}
      </View>
      {d.forfeit && (
        <Text style={[sub, { textAlign: 'center', marginTop: 12 }]}>
          {d.outcome === 'win' ? `${other.name} didn't play in time.` : "You didn't play in time."}
        </Text>
      )}
      {d.h2h && <Text style={[sub, { textAlign: 'center', marginTop: 12 }]}>Head to head: {recordText(d.h2h)}</Text>}
    </Card>
  );
}

function WordChips({ words, highlight }: { words: string[]; highlight?: Set<string> }) {
  if (!words.length) return <Text style={sub}>No words.</Text>;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {words.map((x) => (
        <Text key={x} style={{ fontFamily: F.displayBold, fontSize: 13, color: highlight?.has(x) ? C.mint : C.white, backgroundColor: highlight?.has(x) ? 'rgba(62,230,184,0.12)' : w(0.05), paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, overflow: 'hidden' }}>{x.toUpperCase()}</Text>
      ))}
    </View>
  );
}

function WordCompare({ mine, theirs, otherName }: { mine: { word: string; points: number }[]; theirs: { word: string; points: number }[]; otherName: string }) {
  const a = new Set(mine.map((x) => x.word));
  const b = new Set(theirs.map((x) => x.word));
  const onlyMine = new Set([...a].filter((x) => !b.has(x)));
  const onlyTheirs = new Set([...b].filter((x) => !a.has(x)));
  const both = [...a].filter((x) => b.has(x));
  return (
    <>
      <Eyebrow right={`${mine.length} words`}>Your words</Eyebrow>
      <WordChips words={mine.map((x) => x.word)} highlight={onlyMine} />
      <Eyebrow right={`${theirs.length} words`}>{`${otherName}'s words`}</Eyebrow>
      <WordChips words={theirs.map((x) => x.word)} highlight={onlyTheirs} />
      <Text style={[sub, { marginTop: 10 }]}>{both.length} {both.length === 1 ? 'word' : 'words'} found by both. Green words only one of you found.</Text>
    </>
  );
}

// ── After a 1v1 round (the game's results screen) ─────────────────────────
/** Wait for the server to score the round; settles once both played, or once ours is recorded. */
export function useChallengeOutcome(challengeId: string): { d: ChallengeDetail | null; err: boolean } {
  const [d, setD] = useState<ChallengeDetail | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      await engine.soloFinished;
      for (let i = 0; i < 6 && live; i++) {
        try {
          const x = await challengeDetail(challengeId);
          if (!live) return;
          if (x.status === 'completed' || (x.i_played && !x.they_played) || i === 5) {
            setD(x);
            if (x.outcome === 'win') sfx.win(); else if (x.outcome === 'loss') sfx.eliminated();
            void social.refresh();
            return;
          }
        } catch { if (i === 5 && live) setErr(true); }
        await new Promise((r) => setTimeout(r, 800));
      }
    })();
    return () => { live = false; };
  }, [challengeId]);
  return { d, err };
}

/** The result (or "locked in" while the other player hasn't played), then both players' words. */
export function ChallengeOutcome({ d, err, myWords }: { d: ChallengeDetail | null; err: boolean; myWords: { word: string; points: number }[] }) {
  if (err) return <Text style={[sub, { textAlign: 'center' }]}>{"Couldn't load the result yet. Open it from 1v1 challenges."}</Text>;
  if (!d) return <Loading />;
  if (d.status !== 'completed') {
    return (
      <>
        <Card style={{ padding: 16, alignItems: 'center' }}>
          <Text style={{ fontFamily: F.displayBold, fontSize: 17, color: C.white, textAlign: 'center' }}>Your score is locked in ⚔️</Text>
          <Text style={[sub, { textAlign: 'center', marginTop: 4 }]}>{`We'll let you know when ${d.other?.name ?? 'your opponent'} plays.`}</Text>
        </Card>
        <Eyebrow right={`${myWords.length} words`}>Your words</Eyebrow>
        <WordChips words={myWords.map((x) => x.word)} />
      </>
    );
  }
  return (
    <>
      <ResultHeader d={d} />
      <WordCompare mine={d.my_words} theirs={d.their_words ?? []} otherName={d.other?.name ?? 'Opponent'} />
    </>
  );
}

/** Rematch from the results screen: send it, then show the challenges list. */
export async function rematchFromResults(d: ChallengeDetail): Promise<void> {
  if (!d.other?.id) return;
  try {
    await createChallenge(d.other.id, d.id);
    engine.goMenu();
    nav.reset([{ name: 'challenges' }]);
  } catch (e) { challengeError(e); }
}

/** On solo results: a way into 1v1s. The challenge uses a fresh word, not this round. */
export function ChallengeCta() {
  const [picking, setPicking] = useState(false);
  return (
    <Card style={{ padding: 16, borderColor: 'rgba(61,139,255,0.45)', backgroundColor: 'rgba(61,139,255,0.10)' }}>
      <Text style={{ fontFamily: F.displayBold, fontSize: 17, color: C.white, textAlign: 'center' }}>Think a friend can beat you?</Text>
      <Text style={[sub, { textAlign: 'center', marginTop: 4 }]}>Challenge them to a 1v1. Once they accept, you both play the same new word.</Text>
      <Button title="Challenge a friend ⚔️" style={{ marginTop: 12 }} onPress={() => setPicking(true)} />
      <ChallengePicker open={picking} onClose={() => setPicking(false)}
        onPick={async (to) => {
          await createChallenge(to.id);
          setPicking(false);
          engine.goMenu();
          nav.reset([{ name: 'challenges' }]);
        }} />
    </Card>
  );
}

/**
 * Choose a friend to challenge (searchable). Only existing players can be challenged, so
 * the other option invites people to the app; once they've joined, they can be challenged.
 */
export function ChallengePicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (to: { id: string; name: string }) => Promise<void> }) {
  const [friends, setFriends] = useState<FriendRow[] | null>(null);
  // The sheet stays open while sending; on an error the banner shows and the list stays put.
  const [sending, setSending] = useState<string | null>(null);
  const pick = async (f: FriendRow) => {
    if (sending) return;
    setSending(f.user_id);
    try { await onPick({ id: f.user_id, name: f.name }); setQ(''); } catch (e) { challengeError(e); } finally { setSending(null); }
  };
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!open) return;
    let live = true;
    myFriends().then((f) => { if (live) setFriends(f.filter((x) => x.relation === 'friends')); }).catch((e) => { if (live) setErr(friendlyError(e)); });
    return () => { live = false; };
  }, [open]);
  const query = q.trim().toLowerCase();
  const shown = friends && query ? friends.filter((f) => f.name.toLowerCase().includes(query)) : friends;
  const invite = async () => { const e = await shareFriendInvite(); if (e) setErr(e); };
  // While the keyboard is up, pad the list so its last rows can scroll above it.
  const [kb, setKb] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKb(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKb(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return (
    <Sheet open={open} onClose={() => { setQ(''); onClose(); }} title="Challenge a friend" tall>
      {friends && friends.length > 0 && (
        <TextField value={q} onChangeText={setQ} placeholder="Search friends" autoCorrect={false} autoCapitalize="none"
          returnKeyType="search" accessibilityLabel="Search friends" style={{ height: 44, borderRadius: 12, fontSize: 16 }} />
      )}
      {err && <Text style={{ marginTop: 10, fontFamily: F.body, fontSize: 13, color: C.coral }}>{err}</Text>}
      {!friends && !err && <Loading />}
      {friends && friends.length === 0 && <Text style={[s.body, { marginTop: 4, textAlign: 'center' }]}>No friends yet. Invite friends to Last Word, then challenge them here.</Text>}
      {shown && friends && friends.length > 0 && (
        shown.length === 0 ? (
          <Text style={[sub, { marginTop: 14, textAlign: 'center', fontSize: 13 }]}>{`No friends match "${q.trim()}".`}</Text>
        ) : (
          // The list scrolls; the invite button below stays put.
          <ScrollView style={{ flex: 1, marginTop: 12 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 6, paddingBottom: 4 + kb }}>
            {shown.map((f) => (
              <PlayerRow key={f.user_id} p={{ id: f.user_id, name: f.name, photo_url: f.photo_url }}
                subtitle={f.wins + f.losses + f.draws ? `You ${recordText(f)}` : undefined}
                onPress={() => void pick(f)}
                right={<Text style={{ fontFamily: F.bodyBold, color: sending === f.user_id ? w(0.5) : C.primary }}>{sending === f.user_id ? 'Sending…' : 'Challenge'}</Text>} />
            ))}
          </ScrollView>
        )
      )}
      {/* Fills the space when the list is short, so the button stays pinned to the bottom. */}
      {!(shown && shown.length > 0) && <View style={{ flex: 1 }} />}
      <View style={{ marginTop: 12, marginHorizontal: -12, paddingHorizontal: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.divider, backgroundColor: C.ink850 }}>
        <Button title="Invite friends to challenge" variant="ghost" onPress={() => void invite()} />
      </View>
    </Sheet>
  );
}

// ── Notifications ──────────────────────────────────────────────────────────
function notificationText(n: NotificationRow): string {
  const who = n.actor?.name ?? 'A player';
  switch (n.kind) {
    case 'friend_request': return `${who} sent you a friend request.`;
    case 'friend_accepted': return `${who} is now your friend.`;
    case 'challenge_received': return `${who} challenged you to a 1v1. Accept to play.`;
    case 'challenge_accepted': return `${who} accepted your challenge. Your round is ready.`;
    case 'challenge_played': return `${who} played their round. Now it's your turn.`;
    case 'challenge_result': return `Your 1v1 with ${who} is finished. See who won.`;
    case 'challenge_declined': return `${who} declined your challenge.`;
    case 'challenge_expiring': return `Your 1v1 with ${who} expires soon.`;
    default: return 'You have a new notification.';
  }
}
export function openNotification(n: { kind: string; challenge_id?: string | null; challengeId?: string | null; actor?: Person | null }) {
  const cid = n.challenge_id ?? n.challengeId ?? null;
  // Challenges waiting on you open the list (Accept / Play are there); results open the challenge.
  if (cid && (n.kind === 'challenge_received' || n.kind === 'challenge_accepted' || n.kind === 'challenge_played' || n.kind === 'challenge_expiring')) nav.push({ name: 'challenges' });
  else if (cid) nav.push({ name: 'challenge', id: cid });
  else if (n.kind === 'friend_request') nav.push({ name: 'friends' });
  else if (n.actor?.id) nav.push({ name: 'player', id: n.actor.id });
  else nav.push({ name: 'friends' });
}

export function NotificationsScreen() {
  const list = useLoad(myNotifications, []);
  const now = useNow(true, 60_000);
  // Opening the list marks everything read.
  useEffect(() => { if (list.data?.some((n) => !n.read)) void markNotificationsRead(); }, [list.data]);
  if (list.error) return <ErrorText text={list.error} onRetry={list.reload} />;
  if (!list.data) return <Loading />;
  if (list.data.length === 0) return <Empty emoji="🔔" title="No notifications" body="Friend requests and 1v1 challenges will show up here." />;
  return (
    <View style={{ gap: 6 }}>
      {list.data.map((n) => (
        <Pressable key={n.id} onPress={() => openNotification(n)}
          style={({ pressed }) => [row, { paddingHorizontal: 12, paddingVertical: 12, borderRadius: 16, backgroundColor: pressed ? 'rgba(61,139,255,0.12)' : n.read ? w(0.03) : 'rgba(61,139,255,0.10)' }]}>
          <PersonAvatar p={n.actor} size={38} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: n.read ? F.body : F.bodySemi, fontSize: 14, color: C.white }}>{notificationText(n)}</Text>
            <Text style={sub}>{ago(n.created_at, now)}</Text>
          </View>
          {!n.read && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary }} />}
        </Pressable>
      ))}
    </View>
  );
}

// ── Invitation links ───────────────────────────────────────────────────────
export function InviteScreen({ token }: { token: string }) {
  const { data: inv, error, reload } = useLoad<InviteInfo>(() => resolveInvite(token), [token]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const inviter = inv?.inviter ?? null;
  if (error) return <ErrorText text={error} onRetry={reload} />;
  if (!inv) return <Loading />;

  const bad: Record<string, [string, string]> = {
    expired: ['This invite has expired', 'Ask your friend to send a new one.'],
    unavailable: ['Player unavailable', "This invite can't be used."],
    invalid: ['Invite link not found', 'Check the link and try again.'],
    own: ['This is your own invite', 'Share it with a friend instead.'],
  };
  if (bad[inv.state]) return <Empty emoji="🔗" title={bad[inv.state][0]} body={bad[inv.state][1]} />;

  const acceptFriend = async () => {
    setBusy(true); setMsg(null);
    try { await acceptFriendInvite(token); setDone(true); } catch (e) { setMsg(friendlyError(e)); } finally { setBusy(false); }
  };
  const challengeBack = async () => {
    if (!inviter?.id) return;
    setBusy(true); setMsg(null);
    try { await sendChallenge({ id: inviter.id, name: inviter.name }); } catch (e) { setMsg(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <Card style={{ padding: 22, alignItems: 'center' }}>
      <PersonAvatar p={inviter} size={84} />
      <Text style={{ fontFamily: F.displayBold, fontSize: 22, color: C.white, marginTop: 12, textAlign: 'center' }}>{done || inv.relation === 'friends' ? `You and ${inviter?.name} are friends` : `${inviter?.name} invited you`}</Text>
      <Text style={[s.body, { textAlign: 'center', marginTop: 6, fontSize: 14 }]}>Add them as a friend to challenge each other to 1v1s.</Text>
      <View style={{ alignSelf: 'stretch', gap: 8, marginTop: 16 }}>
        {done || inv.relation === 'friends'
          ? <Button title={busy ? 'Sending…' : `Challenge ${inviter?.name} ⚔️`} disabled={busy} onPress={() => void challengeBack()} />
          : <Button title={busy ? 'Adding…' : 'Add friend'} disabled={busy} onPress={() => void acceptFriend()} />}
        {inviter?.id && <Button title="View profile" variant="ghost" onPress={() => nav.push({ name: 'player', id: inviter.id! })} />}
      </View>
      {msg && <Text style={{ marginTop: 10, fontFamily: F.body, fontSize: 13, color: C.coral, textAlign: 'center' }}>{msg}</Text>}
    </Card>
  );
}

/**
 * After installing from an invite: the invite page copied the link before sending the
 * player to the store, so on first open we offer to pick it up. Reading the clipboard
 * only happens when the player taps, so iOS never shows an unexpected paste prompt.
 */
export function InviteRecoveryBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (kv.get(RECOVERY_KEY) === '1') return;
    let live = true;
    const check = async () => (await Clipboard.hasUrlAsync().catch(() => false)) || (await Clipboard.hasStringAsync().catch(() => false));
    void check().then((has) => {
      if (!live) return;
      if (has) setShow(true); else kv.set(RECOVERY_KEY, '1');
    });
    return () => { live = false; };
  }, []);
  if (!show) return null;
  const done = () => { kv.set(RECOVERY_KEY, '1'); setShow(false); };
  const paste = async () => {
    const text = (await Clipboard.getUrlAsync().catch(() => null)) ?? (await Clipboard.getStringAsync().catch(() => ''));
    const token = inviteTokenFrom(text);
    done();
    if (token) nav.push({ name: 'invite', token });
  };
  return (
    <Card style={{ marginTop: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderColor: 'rgba(61,139,255,0.45)' }}>
      <Text style={{ fontSize: 22 }}>📨</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.white }}>Did a friend invite you?</Text>
        <Pressable onPress={() => void paste()} hitSlop={6}><Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: C.primary, marginTop: 2 }}>Paste invite link</Text></Pressable>
      </View>
      <Pressable onPress={done} hitSlop={10} accessibilityLabel="Dismiss"><Text style={{ fontSize: 16, color: w(0.6) }}>✕</Text></Pressable>
    </Card>
  );
}
const RECOVERY_KEY = 'lw.invite.recoveryChecked';
