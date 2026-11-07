// ── Friends, player profiles, 1v1 challenges, notifications, invitations ───
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Share, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import {
  acceptFriendInvite, ago, challengeDetail, claimChallenge, createChallenge, createFriendInvite, declineChallenge,
  friendlyError, INVITE_MESSAGE, inviteUrl, markNotificationsRead, myChallenges, myFriends, myNotifications,
  personAvatar, playerProfile, recordText, removeFriend, resolveInvite, respondFriendRequest, searchPlayers,
  sendFriendRequest, social, timeLeft, useSocial,
  type ChallengeDetail, type ChallengeRow, type FriendRow, type InviteInfo, type NotificationRow, type Person,
  type PlayerProfileData, type Record3, type Relation, type SearchRow,
} from '@/lib/challenges';
import { engine } from '@/lib/engine';
import { kv } from '@/lib/kv';
import { Avatar, Button, Card, s, Sheet, TextField, useNow } from './kit';
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

const challengeMessage = (token: string) =>
  `I challenge you to a 1v1 in Last Word ⚔️ Same word, 60 seconds. Think you can beat me?\n${inviteUrl(token)}`;

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
  return (
    <PlayerRow p={{ id: f.user_id, name: f.name, photo_url: f.photo_url }}
      subtitle={played ? `You ${recordText(f)}` : 'No 1v1s yet'}
      right={<SmallButton title="Challenge" onPress={() => startChallenge({ id: f.user_id, name: f.name })} />} />
  );
}

/** Play a 60-second round, then send it to this player. */
export function startChallenge(opponent: { id: string; name: string } | null, rematchOf?: string | null) {
  nav.reset();
  engine.startSingle({ kind: 'new', opponent, rematchOf: rematchOf ?? null });
}

/** Play someone's challenge (the word is revealed and the timer starts only now). */
export function playChallenge(challengeId: string, opponentName: string) {
  nav.reset();
  engine.startSingle({ kind: 'reply', challengeId, opponentName });
}

// ── Player profile ─────────────────────────────────────────────────────────
export function PlayerScreen({ id }: { id: string }) {
  const { data: p, error, reload, setData } = useLoad<PlayerProfileData>(() => playerProfile(id), [id]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [acting, setActing] = useState<PlayerRef | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
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
          <View style={{ flex: 1 }}><Button title="Challenge ⚔️" onPress={() => startChallenge({ id: p.id, name: p.name })} /></View>
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
function statusLabel(c: ChallengeRow): string {
  if (c.status === 'completed') return c.outcome === 'win' ? 'You won' : c.outcome === 'loss' ? 'You lost' : 'Draw';
  if (c.status === 'expired') return 'Expired';
  if (c.status === 'declined') return 'Declined';
  if (c.your_turn) return 'Your turn';
  if (c.role === 'challenger' && !c.other) return 'Waiting for someone to accept your link';
  if (c.status === 'in_progress' && c.role === 'challenger') return 'They’re playing now';
  if (c.role === 'opponent') return 'Waiting for results';
  return 'Waiting for them to play';
}

export function ChallengesScreen({ tab: initial = 'active' }: { tab?: 'active' | 'history' }) {
  const [tab, setTab] = useState<'active' | 'history'>(initial);
  const list = useLoad(myChallenges, []);
  const counts = useSocial();
  const now = useNow(true, 30_000);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => { void social.refresh(); }, []);

  const all = list.data ?? [];
  const isActive = (c: ChallengeRow) => c.status === 'pending' || c.status === 'in_progress';
  const incoming = all.filter((c) => isActive(c) && c.your_turn);
  const outgoing = all.filter((c) => isActive(c) && !c.your_turn);
  const history = all.filter((c) => !isActive(c));
  const decline = async (c: ChallengeRow) => {
    try { await declineChallenge(c.id); list.reload(); } catch (e) { setNote(friendlyError(e)); }
  };
  const record = counts?.record ?? { wins: 0, losses: 0, draws: 0 };
  const played = record.wins + record.losses + record.draws;

  return (
    <View>
      <Card style={{ paddingVertical: 14 }}>
        <Text style={[s.eyebrow, { textAlign: 'center', marginBottom: 8 }]}>Your 1v1 record</Text>
        <RecordStats r={record} />
        {played > 0 && <Text style={[sub, { textAlign: 'center', marginTop: 8 }]}>{played} {played === 1 ? 'match' : 'matches'} · {Math.round((record.wins / played) * 100)}% win rate</Text>}
      </Card>
      <Button title="New challenge ⚔️" style={{ marginTop: 12 }} onPress={() => startChallenge(null)} />
      <Text style={[sub, { textAlign: 'center', marginTop: 6 }]}>Play 60 seconds, then choose who to challenge.</Text>

      <View style={{ flexDirection: 'row', gap: 4, padding: 4, marginTop: 18, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder }}>
        {(['active', 'history'] as const).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} accessibilityRole="tab" accessibilityState={{ selected: tab === t }}
            style={{ flex: 1, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: tab === t ? C.primary : 'transparent' }}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 13, color: tab === t ? C.white : w(0.72) }}>
              {t === 'active' ? `Active${incoming.length + outgoing.length ? ` · ${incoming.length + outgoing.length}` : ''}` : 'History'}
            </Text>
          </Pressable>
        ))}
      </View>
      {note && <Text style={{ marginTop: 10, fontFamily: F.body, fontSize: 13, color: C.coral, textAlign: 'center' }}>{note}</Text>}
      {list.error && <ErrorText text={list.error} onRetry={list.reload} />}
      {!list.data && !list.error && <Loading />}

      {list.data && tab === 'active' && (
        <>
          <Eyebrow right={incoming.length ? `${incoming.length}` : undefined}>Your turn</Eyebrow>
          {incoming.length === 0 ? <Text style={[sub, { fontSize: 13 }]}>No challenges waiting for you.</Text> : (
            <View style={{ gap: 6 }}>
              {incoming.map((c) => (
                <ChallengeRowView key={c.id} c={c} now={now}
                  right={(
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      {c.status === 'pending' && <SmallButton title="Decline" variant="ghost" onPress={() => void decline(c)} />}
                      <SmallButton title={c.status === 'in_progress' ? 'Resume' : 'Play now'} onPress={() => playChallenge(c.id, c.other?.name ?? 'Player')} />
                    </View>
                  )} />
              ))}
            </View>
          )}
          <Eyebrow>Waiting on them</Eyebrow>
          {outgoing.length === 0 ? (
            <Empty emoji="⚔️" title="No active challenges" body="Start a new challenge, or challenge a friend from their profile." />
          ) : (
            <View style={{ gap: 6 }}>
              {outgoing.map((c) => <ChallengeRowView key={c.id} c={c} now={now} right={<SmallButton title="View" variant="ghost" onPress={() => nav.push({ name: 'challenge', id: c.id })} />} />)}
            </View>
          )}
        </>
      )}

      {list.data && tab === 'history' && (
        history.length === 0 ? (
          <View style={{ marginTop: 12 }}><Empty emoji="📜" title="No challenge history" body="Finished, declined and expired challenges show up here." /></View>
        ) : (
          <View style={{ gap: 6, marginTop: 12 }}>
            {history.map((c) => (
              <ChallengeRowView key={c.id} c={c} now={now}
                right={c.status === 'completed' && c.other?.id ? <SmallButton title="Rematch" onPress={() => startChallenge({ id: c.other!.id!, name: c.other!.name }, c.id)} /> : undefined} />
            ))}
          </View>
        )
      )}
    </View>
  );
}

function ChallengeRowView({ c, now, right }: { c: ChallengeRow; now: number; right?: React.ReactNode }) {
  const other: Person = c.other ?? { id: null, name: 'Anyone with your link', photo_url: null };
  const done = c.status === 'completed';
  const color = done ? (c.outcome === 'win' ? C.mint : c.outcome === 'loss' ? C.coral : C.amber) : c.your_turn ? C.amber : w(0.65);
  const when = done
    ? `${c.my_score} – ${c.their_score} · ${new Date(c.completed_at ?? c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : c.status === 'pending' ? timeLeft(c.expires_at, now)
    : c.status === 'in_progress' ? 'In progress'
    : new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <Pressable onPress={() => nav.push({ name: 'challenge', id: c.id })}
      style={({ pressed }) => [row, { paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16, backgroundColor: pressed ? 'rgba(61,139,255,0.12)' : w(0.04) }]}>
      <PersonAvatar p={other} size={38} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.white }}>{other.name}</Text>
        <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: 12, color }}>{statusLabel(c)}<Text style={sub}>{`  ·  ${when}`}</Text></Text>
      </View>
      {right}
    </Pressable>
  );
}

/** One challenge: waiting, your turn, or the full results with both players' words. */
export function ChallengeScreen({ id }: { id: string }) {
  const { data: d, error, reload } = useLoad<ChallengeDetail>(() => challengeDetail(id), [id]);
  const now = useNow(true, 30_000);
  const [note, setNote] = useState<string | null>(null);
  if (error) return <ErrorText text={error} onRetry={reload} />;
  if (!d) return <Loading />;
  const other: Person = d.other ?? { id: null, name: 'Anyone with your link', photo_url: null };
  const done = d.status === 'completed';
  const yourTurn = d.role === 'opponent' && (d.status === 'pending' || d.status === 'in_progress') && d.my_score == null;

  return (
    <View>
      {done ? <ResultHeader d={d} /> : (
        <Card style={{ padding: 20, alignItems: 'center' }}>
          <View style={[row, { gap: 18 }]}>
            <PersonAvatar p={d.me} size={56} />
            <Text style={{ fontFamily: F.display, fontSize: 20, color: w(0.6) }}>vs</Text>
            <PersonAvatar p={other} size={56} />
          </View>
          <Text style={{ fontFamily: F.displayBold, fontSize: 18, color: C.white, marginTop: 12, textAlign: 'center' }}>
            {d.status === 'expired' ? 'This challenge expired' : d.status === 'declined' ? `${other.name} declined`
              : yourTurn ? `${other.name} challenged you` : d.role === 'challenger' ? (d.other ? `Waiting for ${other.name}` : 'Waiting for someone to accept') : 'Waiting for results'}
          </Text>
          <Text style={[s.body, { textAlign: 'center', marginTop: 4, fontSize: 14 }]}>
            {d.status === 'expired' || d.status === 'declined' ? 'No win or loss for either player.'
              : yourTurn ? 'Same word, 60 seconds. The word is revealed when you start, and you only get one try.'
              : d.role === 'challenger' ? `Your score: ${d.my_score}. They can't see it until they play.` : 'Results will appear here.'}
          </Text>
          {(d.status === 'pending') && <Text style={[sub, { marginTop: 8 }]}>{timeLeft(d.expires_at, now)}</Text>}
          {yourTurn && (
            <View style={{ alignSelf: 'stretch', gap: 8, marginTop: 16 }}>
              <Button title={d.status === 'in_progress' ? 'Resume' : 'Play now'} onPress={() => playChallenge(d.id, other.name)} />
              {d.status === 'pending' && <Button title="Decline" variant="ghost" onPress={() => { void declineChallenge(d.id).then(reload).catch((e) => setNote(friendlyError(e))); }} />}
            </View>
          )}
          {d.role === 'challenger' && d.status === 'pending' && d.invite_token && (
            <Button title={d.other ? 'Share challenge link' : 'Share invite link'} variant="ghost" style={{ alignSelf: 'stretch', marginTop: 16 }} onPress={() => void shareText(challengeMessage(d.invite_token!))} />
          )}
          {note && <Text style={{ marginTop: 10, fontFamily: F.body, fontSize: 13, color: C.coral }}>{note}</Text>}
        </Card>
      )}

      {d.source && (done || d.role === 'challenger') && <Text style={[sub, { textAlign: 'center', marginTop: 12 }]}>Word: <Text style={{ fontFamily: F.bodyBold, color: C.white }}>{d.source}</Text></Text>}

      {done && <WordCompare mine={d.my_words} theirs={d.their_words ?? []} otherName={other.name} />}
      {!done && d.my_words.length > 0 && (
        <>
          <Eyebrow>Your words</Eyebrow>
          <WordChips words={d.my_words.map((x) => x.word)} />
        </>
      )}

      {done && (
        <View style={{ gap: 10, marginTop: 24 }}>
          {d.other?.id && <Button title="Rematch" onPress={() => startChallenge({ id: d.other!.id!, name: d.other!.name }, d.id)} />}
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
  const diff = Math.abs((d.my_score ?? 0) - (d.their_score ?? 0));
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
      {diff > 0 && <Text style={[sub, { textAlign: 'center', marginTop: 2 }]}>by {diff} {diff === 1 ? 'point' : 'points'}</Text>}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16 }}>
        {side(d.me, d.my_score, d.outcome === 'win')}
        <Text style={{ fontFamily: F.display, fontSize: 18, color: w(0.5) }}>vs</Text>
        {side(other, d.their_score, d.outcome === 'loss')}
      </View>
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

// ── After a 1v1 attempt (shown on the solo results screen) ─────────────────
/** A challenge reply: wait for the server to settle it, then show who won. */
export function ChallengeOutcome({ challengeId }: { challengeId: string }) {
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
          if (x.status === 'completed' || i === 5) {
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
  if (err) return <Text style={[sub, { textAlign: 'center' }]}>{"Couldn't load the result yet. Open it from 1v1 challenges."}</Text>;
  if (!d) return <Loading />;
  if (d.status !== 'completed') return <Text style={[sub, { textAlign: 'center' }]}>Your score is in. Results are on their way.</Text>;
  return <ResultHeader d={d} />;
}

/** A new challenge's round is over: send it to the chosen player (rematch) or let the player pick. */
type SendState = { kind: 'idle' | 'sending' | 'sent' | 'error'; text?: string; token?: string };
/** Remembers what happened to each round's challenge, so leaving and coming back never sends twice. */
const sentFor = new Map<string, SendState>();

export function ChallengeSend({ gameId, score, opponent, rematchOf }: { gameId: string | null; score: number; opponent: { id: string; name: string } | null; rematchOf?: string | null }) {
  const [state, setStateRaw] = useState<SendState>(() => (gameId && sentFor.get(gameId)) || { kind: 'idle' });
  const setState = useCallback((x: SendState) => { if (gameId) sentFor.set(gameId, x); setStateRaw(x); }, [gameId]);
  const [picking, setPicking] = useState(false);
  const send = useCallback(async (to: { id: string; name: string } | null) => {
    if (!gameId) return;
    const prev = sentFor.get(gameId)?.kind;
    if (prev === 'sending' || prev === 'sent') return;
    setState({ kind: 'sending' });
    try {
      await engine.soloFinished;
      const r = await createChallenge(gameId, to?.id ?? null, rematchOf);
      if (!to) await shareText(challengeMessage(r.token));
      setState({ kind: 'sent', text: to ? `Challenge sent to ${to.name}` : 'Challenge link created', token: r.token });
    } catch (e) { setState({ kind: 'error', text: friendlyError(e, "Couldn't send the challenge. Try again.") }); }
  }, [gameId, rematchOf, setState]);
  // A rematch or a challenge from a profile goes out as soon as the round is scored.
  useEffect(() => {
    if (!opponent) return;
    const t = setTimeout(() => { void send(opponent); }, 0);
    return () => clearTimeout(t);
  }, [opponent, send]);

  if (!gameId) return null;
  return (
    <Card style={{ padding: 16, borderColor: 'rgba(61,139,255,0.45)', backgroundColor: 'rgba(61,139,255,0.10)' }}>
      {state.kind === 'sent' ? (
        <>
          <Text style={{ fontFamily: F.displayBold, fontSize: 17, color: C.white, textAlign: 'center' }}>{state.text} ⚔️</Text>
          <Text style={[sub, { textAlign: 'center', marginTop: 4 }]}>{"They have 72 hours to play. You'll be notified when results are in."}</Text>
          {!opponent && state.token && <Button title="Share link again" variant="ghost" style={{ marginTop: 12 }} onPress={() => void shareText(challengeMessage(state.token!))} />}
        </>
      ) : state.kind === 'sending' ? (
        <Loading />
      ) : (
        <>
          <Text style={{ fontFamily: F.displayBold, fontSize: 17, color: C.white, textAlign: 'center' }}>Challenge a friend to beat {score}</Text>
          <Text style={[sub, { textAlign: 'center', marginTop: 4 }]}>They get the same word and 60 seconds. They won’t see your score until they play.</Text>
          {state.kind === 'error' && <Text style={{ marginTop: 8, fontFamily: F.body, fontSize: 13, color: C.coral, textAlign: 'center' }}>{state.text}</Text>}
          <Button title={opponent ? `Try again` : 'Challenge a friend ⚔️'} style={{ marginTop: 12 }} onPress={() => (opponent ? void send(opponent) : setPicking(true))} />
        </>
      )}
      <ChallengePicker open={picking} onClose={() => setPicking(false)} onPick={(to) => { setPicking(false); void send(to); }} />
    </Card>
  );
}

/** Choose a friend, or share a link anyone can accept. */
export function ChallengePicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (to: { id: string; name: string } | null) => void }) {
  const [friends, setFriends] = useState<FriendRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    myFriends().then((f) => { if (live) setFriends(f.filter((x) => x.relation === 'friends')); }).catch((e) => { if (live) setErr(friendlyError(e)); });
    return () => { live = false; };
  }, [open]);
  return (
    <Sheet open={open} onClose={onClose} title="Challenge a friend">
      <Button title="Share a challenge link" variant="ghost" onPress={() => onPick(null)} />
      <Text style={[sub, { textAlign: 'center', marginTop: 6 }]}>Anyone can accept it, even if they don’t have Last Word yet.</Text>
      {err && <Text style={{ marginTop: 10, fontFamily: F.body, fontSize: 13, color: C.coral }}>{err}</Text>}
      {!friends && !err && <Loading />}
      {friends && friends.length === 0 && <Text style={[s.body, { marginTop: 14, textAlign: 'center' }]}>Add friends from Profile → Friends to challenge them directly.</Text>}
      {friends && friends.length > 0 && (
        <View style={{ gap: 6, marginTop: 14 }}>
          {friends.map((f) => (
            <PlayerRow key={f.user_id} p={{ id: f.user_id, name: f.name, photo_url: f.photo_url }}
              subtitle={f.wins + f.losses + f.draws ? `You ${recordText(f)}` : undefined}
              onPress={() => onPick({ id: f.user_id, name: f.name })}
              right={<Text style={{ fontFamily: F.bodyBold, color: C.primary }}>Challenge</Text>} />
          ))}
        </View>
      )}
    </Sheet>
  );
}

// ── Notifications ──────────────────────────────────────────────────────────
function notificationText(n: NotificationRow): string {
  const who = n.actor?.name ?? 'A player';
  switch (n.kind) {
    case 'friend_request': return `${who} sent you a friend request.`;
    case 'friend_accepted': return `${who} is now your friend.`;
    case 'challenge_received': return `${who} challenged you to a 1v1.`;
    case 'challenge_result': return `${who} played your challenge. See who won.`;
    case 'challenge_declined': return `${who} declined your challenge.`;
    case 'challenge_expiring': return `Your challenge from ${who} expires soon.`;
    default: return 'You have a new notification.';
  }
}
export function openNotification(n: { kind: string; challenge_id?: string | null; challengeId?: string | null; actor?: Person | null }) {
  const cid = n.challenge_id ?? n.challengeId ?? null;
  if (cid) nav.push({ name: 'challenge', id: cid });
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
  const expires = useMemo(() => (inv?.expires_at ? timeLeft(inv.expires_at) : null), [inv]);
  if (error) return <ErrorText text={error} onRetry={reload} />;
  if (!inv) return <Loading />;

  const bad: Record<string, [string, string]> = {
    expired: ['This invite has expired', 'Ask your friend to send a new one.'],
    taken: ['This challenge was already taken', 'Someone else accepted it first. Ask your friend for a new challenge.'],
    unavailable: ['Player unavailable', "This invite can't be used."],
    invalid: ['Invite link not found', 'Check the link and try again.'],
    own: ['This is your own invite', 'Share it with a friend instead.'],
  };
  if (bad[inv.state]) return <Empty emoji="🔗" title={bad[inv.state][0]} body={bad[inv.state][1]} />;

  const acceptFriend = async () => {
    setBusy(true); setMsg(null);
    try { await acceptFriendInvite(token); setDone(true); } catch (e) { setMsg(friendlyError(e)); } finally { setBusy(false); }
  };
  const accept1v1 = async () => {
    setBusy(true); setMsg(null);
    try { const id = await claimChallenge(token); playChallenge(id, inviter?.name ?? 'Player'); } catch (e) { setMsg(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <Card style={{ padding: 22, alignItems: 'center' }}>
      <PersonAvatar p={inviter} size={84} />
      {inv.kind === 'friend' ? (
        <>
          <Text style={{ fontFamily: F.displayBold, fontSize: 22, color: C.white, marginTop: 12, textAlign: 'center' }}>{done || inv.relation === 'friends' ? `You and ${inviter?.name} are friends` : `${inviter?.name} invited you`}</Text>
          <Text style={[s.body, { textAlign: 'center', marginTop: 6, fontSize: 14 }]}>Add them as a friend to challenge each other to 1v1s.</Text>
          <View style={{ alignSelf: 'stretch', gap: 8, marginTop: 16 }}>
            {done || inv.relation === 'friends'
              ? <Button title={`Challenge ${inviter?.name} ⚔️`} onPress={() => inviter?.id && startChallenge({ id: inviter.id, name: inviter.name })} />
              : <Button title={busy ? 'Adding…' : 'Add friend'} disabled={busy} onPress={() => void acceptFriend()} />}
            {inviter?.id && <Button title="View profile" variant="ghost" onPress={() => nav.push({ name: 'player', id: inviter.id! })} />}
          </View>
        </>
      ) : (
        <>
          <Text style={{ fontFamily: F.displayBold, fontSize: 22, color: C.white, marginTop: 12, textAlign: 'center' }}>{inviter?.name} challenged you</Text>
          <Text style={[s.body, { textAlign: 'center', marginTop: 6, fontSize: 14 }]}>Same word, 60 seconds, one try. The word is revealed when you start.</Text>
          {expires && <Text style={[sub, { marginTop: 6 }]}>{expires}</Text>}
          <Button title={busy ? 'Starting…' : 'Play now'} disabled={busy} style={{ alignSelf: 'stretch', marginTop: 16 }} onPress={() => void accept1v1()} />
        </>
      )}
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
