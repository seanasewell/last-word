import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, BackHandler, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { accounts, weekRange, winsFor, type Account, type Period } from '@/lib/account';
import { social, useSocial } from '@/lib/challenges';
import { engine, type GameState } from '@/lib/engine';
import { fetchModeLeaderboard, type Leaderboard, type RankEntry, type RankMode, type Scope } from '@/lib/ranks';
import { countryByCode } from '@/lib/regions';
import { Avatar, Card, FadeUp, HEADER_SIDE, HeaderLogo, ordinal, s, Screen, Segmented, TopToast, useNow } from './kit';
import { nav, useNav, type Route } from './nav';
import { DailyChallenges, LevelCard, RewardsTab, SweepBorder } from './Progress';
import { FeedbackScreen, SettingsScreen } from './Settings';
import { SaveProgressNudge } from './SignIn';
import { ChallengeScreen, ChallengesScreen, FriendsScreen, InviteRecoveryBanner, InviteScreen, NotificationsScreen, PlayerScreen, PlayerSearchScreen, ProfileBody } from './Social';
import { C, F, w } from './theme';

type Tab = 'play' | 'ranks' | 'rewards' | 'profile';
let rememberedTab: Tab = 'play';
let rememberedFor = '';

const meAvatar = (a: Account) => ({ glyph: a.name[0]?.toUpperCase() ?? 'Y', hue: 210, isYou: true, photo: a.photo });

function TabBar({ tab, onChange, account }: { tab: Tab; onChange: (t: Tab) => void; account: Account }) {
  const insets = useSafeAreaInsets();
  const items: { id: Tab; label: string; emoji?: string }[] = [
    { id: 'play', label: 'Play', emoji: '🔤' },
    { id: 'ranks', label: 'Ranks', emoji: '🏆' },
    { id: 'rewards', label: 'Rewards', emoji: '🏅' },
    { id: 'profile', label: 'Profile' },
  ];
  return (
    <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: w(0.07), backgroundColor: C.bg, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 12) + 4 }}>
      {items.map((t) => {
        const active = t.id === tab;
        return (
          <Pressable key={t.id} onPress={() => onChange(t.id)} accessibilityRole="tab" accessibilityState={{ selected: active }}
            style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: 4, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
            <View style={{ height: 26, justifyContent: 'center', opacity: active ? 1 : 0.6 }}>
              {t.emoji ? <Text style={{ fontSize: 23 }}>{t.emoji}</Text> : <Avatar player={meAvatar(account)} size={26} />}
            </View>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: active ? C.white : w(0.72) }}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const BELL_SIZE = 40;
const BELL_GAP = HEADER_SIDE - BELL_SIZE;

/** The elimination card's see-through blue as it looks over the screen's background, for the avatar rings. */
const MATCH_FACTS = [['👨', '6 players'], ['🕐', '5 rounds · 60 seconds each']] as const;

/** Notification bell with an unread dot (Play tab, top right). */
function Bell() {
  const c = useSocial();
  const unread = c?.unread ?? 0;
  return (
    <Pressable onPress={() => nav.push({ name: 'notifications' })} hitSlop={10} accessibilityRole="button"
      accessibilityLabel={unread ? `Notifications, ${unread} unread` : 'Notifications'}
      style={({ pressed }) => ({ width: BELL_SIZE, height: BELL_SIZE, borderRadius: BELL_SIZE / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? w(0.08) : 'transparent' })}>
      <Text style={{ fontSize: 21 }}>🔔</Text>
      {/* Just a dot: there's something new. */}
      {unread > 0 && (
        <View style={{ position: 'absolute', top: 7, right: 8, width: 10, height: 10, borderRadius: 5, backgroundColor: C.coral, borderWidth: 2, borderColor: C.bgTop }} />
      )}
    </Pressable>
  );
}

function PlayTab({ best, account }: { best: number; account: Account }) {
  const c = useSocial();
  const yourTurn = c?.your_turn ?? 0;
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: BELL_GAP, paddingTop: 8 }}>
        <HeaderLogo />
        <Bell />
      </View>

      <FadeUp delay={60} style={{ marginTop: 24 }}><LevelCard /></FadeUp>
      <SaveProgressNudge account={account} />
      <InviteRecoveryBanner />

      <FadeUp delay={120} style={{ marginTop: 12, gap: 12 }}>
        <Pressable onPress={() => engine.startMatch()} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <View style={{ borderRadius: 24, backgroundColor: C.card, padding: 22 }}>
            <SweepBorder radius={24} />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={{ fontFamily: F.displayBold, fontSize: 22, color: C.white }}>Elimination</Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 6, rowGap: 2, marginTop: 6 }}>
              {MATCH_FACTS.map(([e, t]) => (
                <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={{ fontSize: 13 }}>{e}</Text>
                  <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.75) }}>{t}</Text>
                </View>
              ))}
            </View>
            <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.75), marginTop: 4 }}>Lowest score of each round is out.</Text>
            <View style={{ alignSelf: 'flex-start', marginTop: 16, backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 9 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.white }}>Find a match →</Text>
            </View>
          </View>
        </Pressable>

        <Pressable onPress={() => engine.startSingle()} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <Card style={{ borderRadius: 24, padding: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
              <Text style={{ fontFamily: F.displayBold, fontSize: 20, color: C.white }}>Solo challenge</Text>
              {/* Best sits on the right edge of the card. */}
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginLeft: 'auto' }}>
                <Text style={s.eyebrow}>Best</Text>
                <Text style={[{ fontFamily: F.display, fontSize: 18, color: C.amber }, s.tabular]}>{best}</Text>
              </View>
            </View>
            <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.75), marginTop: 4 }}>60 second rounds. Try and beat your personal best.</Text>
          </Card>
        </Pressable>

        <Pressable onPress={() => nav.push({ name: 'challenges' })} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <Card style={{ borderRadius: 24, padding: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text style={{ fontFamily: F.displayBold, fontSize: 20, color: C.white }}>1v1 challenge</Text>
              <Text style={{ fontSize: 18 }}>⚔️</Text>
              {yourTurn > 0 && (
                <View style={{ marginLeft: 'auto', borderRadius: 999, backgroundColor: 'rgba(255,181,71,0.15)', borderWidth: 1, borderColor: 'rgba(255,181,71,0.4)', paddingHorizontal: 10, paddingVertical: 3 }}>
                  <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.amber }}>{yourTurn} your turn</Text>
                </View>
              )}
            </View>
            <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.75), marginTop: 4 }}>Challenge friends to beat your score.</Text>
          </Card>
        </Pressable>
      </FadeUp>

      <FadeUp delay={180} style={{ marginTop: 28 }}><DailyChallenges /></FadeUp>
    </View>
  );
}

// ── Ranks ──────────────────────────────────────────────────────────────────
const PERIODS: { id: Period; label: string; phrase: string }[] = [
  { id: 'week', label: 'Week', phrase: 'this week' },
  { id: 'month', label: 'Month', phrase: 'this month' },
  { id: 'all', label: 'All time', phrase: 'all time' },
];
const fmtDay = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function periodRange(period: Period, now: Date): string {
  if (period === 'day') return now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  if (period === 'week') {
    const { start, end } = weekRange(now);
    return `${fmtDay(start)} – ${fmtDay(new Date(end.getTime() - 86_400_000))}`;
  }
  if (period === 'month') return now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  if (period === 'year') return String(now.getFullYear());
  return 'Since launch';
}

function resetText(period: Period, now: number): string | null {
  const d = new Date(now);
  let end: Date;
  if (period === 'day') end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  else if (period === 'week') end = weekRange(d).end;
  else if (period === 'month') end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  else if (period === 'year') end = new Date(d.getFullYear() + 1, 0, 1);
  else return null;
  const left = end.getTime() - now;
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);
  const mins = Math.floor((left % 3_600_000) / 60_000);
  const when = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  const label = { day: 'Resets at midnight', week: 'Resets Monday', month: 'Resets on the 1st', year: 'Resets January 1' }[period];
  return `${label} · ${when} left`;
}

const MODES: { id: RankMode; label: string }[] = [
  { id: 'elimination', label: 'Elimination' },
  { id: 'solo', label: 'Solo' },
  { id: '1v1', label: '1v1' },
];
const MODE_TEXT: Record<RankMode, { sub: string; empty: string; emptyBody: (phrase: string) => string; unit: (n: number) => string }> = {
  elimination: { sub: 'Most elimination-match wins', empty: 'No winners yet', emptyBody: (p) => `Win an elimination match ${p === 'all time' ? '' : p} to be first on this board.`, unit: (n) => (n === 1 ? 'win' : 'wins') },
  solo: { sub: 'Best single solo score', empty: 'No scores yet', emptyBody: (p) => `Play a solo challenge ${p === 'all time' ? '' : p} to be first on this board.`, unit: () => 'best' },
  '1v1': { sub: 'Best 1v1 records', empty: 'No 1v1 results yet', emptyBody: (p) => `Win a 1v1 challenge ${p === 'all time' ? '' : p} to be first on this board.`, unit: (n) => (n === 1 ? 'win' : 'wins') },
};

const MEDAL_TINT: Record<number, { bg: string; border: string }> = {
  1: { bg: 'rgba(255,194,74,0.24)', border: 'rgba(255,194,74,0.65)' }, // gold
  2: { bg: 'rgba(201,211,224,0.2)', border: 'rgba(201,211,224,0.6)' }, // silver
  3: { bg: 'rgba(217,138,78,0.24)', border: 'rgba(217,138,78,0.65)' }, // bronze
};

function RankRow({ e, scope, mode, onPress }: { e: RankEntry; scope: Scope; mode: RankMode; onPress?: () => void }) {
  const medal = e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : null;
  const tint = MEDAL_TINT[e.rank];
  const where = scope === 'world' ? `${e.country.flag} ${e.country.name}` : scope === 'national' ? e.region : `${e.country.flag} ${e.region}`;
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityHint={onPress ? 'Open this player’s profile' : undefined}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16,
      // Top 3 take their medal's color (gold, silver, bronze); your own row keeps its blue outline.
      backgroundColor: pressed ? 'rgba(61,139,255,0.12)' : tint ? tint.bg : e.isYou ? 'rgba(61,139,255,0.15)' : w(0.03),
      borderWidth: e.isYou || tint ? 1 : 0, borderColor: e.isYou ? 'rgba(61,139,255,0.6)' : tint ? tint.border : 'transparent' })}>
      <View style={{ width: 30, alignItems: 'center' }}>
        {medal ? <Text style={{ fontSize: 20 }}>{medal}</Text> : <Text style={[{ fontFamily: F.displayBold, fontSize: 14, color: w(0.7) }, s.tabular]}>{e.rank}</Text>}
      </View>
      <Avatar player={{ glyph: e.glyph, hue: e.hue, photo: e.photo, isYou: e.isYou }} size={34} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.white }}>{e.name}</Text>
        <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: 11, color: w(0.65) }}>{where}</Text>
      </View>
      {mode === '1v1' ? (
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[{ fontFamily: F.display, fontSize: 16, color: C.white }, s.tabular]}>
            {e.wins}<Text style={{ color: w(0.45) }}> / </Text>{e.losses ?? 0}<Text style={{ color: w(0.45) }}> / </Text>{e.draws ?? 0}
          </Text>
          <Text style={{ fontFamily: F.body, fontSize: 10, color: w(0.6) }}>W / L / D</Text>
        </View>
      ) : (
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[{ fontFamily: F.display, fontSize: 18, color: mode === 'solo' ? C.amber : C.white }, s.tabular]}>{e.wins}</Text>
          <Text style={{ fontFamily: F.body, fontSize: 10, color: w(0.6) }}>{MODE_TEXT[mode].unit(e.wins)}</Text>
        </View>
      )}
    </Pressable>
  );
}

let rememberedMode: RankMode = 'elimination';

function RanksTab({ account, refreshKey }: { account: Account; refreshKey: number }) {
  const [mode, setModeState] = useState<RankMode>(rememberedMode);
  const setMode = (m: RankMode) => { rememberedMode = m; setModeState(m); };
  const [scope, setScope] = useState<Scope>('world');
  const [period, setPeriod] = useState<Period>('week');
  const [board, setBoard] = useState<{ key: string; data: Leaderboard } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const country = countryByCode(account.country);
  const now = useNow(true, 30_000);
  const key = `${mode}-${scope}-${period}`;

  // Load the board for the current mode, scope and period (and on pull-to-refresh).
  const myWinsLocal = winsFor(account, period);
  useEffect(() => {
    let live = true;
    fetchModeLeaderboard(mode, scope, period)
      .then((data) => { if (live) { setBoard({ key: `${mode}-${scope}-${period}`, data }); setError(null); } })
      .catch(() => { if (live) setError("Couldn't load rankings. Pull down to try again."); });
    return () => { live = false; };
  }, [mode, scope, period, refreshKey, myWinsLocal]);

  const scopes: { id: Scope; label: string }[] = [
    { id: 'world', label: '🌍 World' },
    { id: 'national', label: `${country.flag} National` },
    { id: 'state', label: `📍 ${country.regionLabel}` },
  ];
  const p = PERIODS.find((x) => x.id === period)!;
  const scopeName = scope === 'world' ? 'in the world' : scope === 'national' ? `in ${country.name}` : `in ${account.region}`;
  const reset = resetText(period, now);
  const data = board?.key === key ? board.data : null;
  const you = data?.you ?? null;
  const t = MODE_TEXT[mode];
  const myValue = you ? (mode === '1v1' ? `${you.wins}-${you.losses ?? 0}-${you.draws ?? 0}` : String(you.wins)) : mode === 'elimination' ? String(myWinsLocal) : '—';

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={s.h1}>Ranks</Text>
        <Pressable onPress={() => nav.push({ name: 'search' })} hitSlop={10} accessibilityRole="button" accessibilityLabel="Find players"
          style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? w(0.08) : 'transparent' })}>
          <Text style={{ fontSize: 21 }}>🔍</Text>
        </Pressable>
      </View>
      <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.72), marginTop: 4 }}>{`${t.sub} · ${periodRange(period, new Date(now))}`}</Text>
      <View style={{ gap: 8, marginTop: 16 }}>
        <Segmented options={MODES} value={mode} onChange={setMode} />
        <Segmented options={scopes} value={scope} onChange={setScope} />
        <Segmented options={PERIODS} value={period} onChange={setPeriod} />
      </View>
      <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 20, borderWidth: 1, borderColor: C.cardBorder, backgroundColor: C.card, padding: 16 }}>
        <Avatar player={meAvatar(account)} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.72) }}>Your rank {scopeName}</Text>
          <Text style={{ fontFamily: F.display, fontSize: 24, color: C.white }}>{you ? ordinal(you.rank) : data ? 'Not ranked yet' : '…'}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[{ fontFamily: F.display, fontSize: mode === '1v1' ? 24 : 34, color: mode === 'solo' ? C.amber : C.mint }, s.tabular]}>{myValue}</Text>
          {mode === '1v1' && <Text style={{ fontFamily: F.body, fontSize: 10, color: w(0.6) }}>W / L / D</Text>}
        </View>
      </View>
      {reset && <Text style={{ alignSelf: 'flex-end', marginTop: 8, fontFamily: F.body, fontSize: 11, color: w(0.6) }}>{reset}</Text>}

      {error && !data && <Text style={{ marginTop: 24, textAlign: 'center', fontFamily: F.body, fontSize: 14, color: C.coral }}>{error}</Text>}
      {!error && !data && <ActivityIndicator color={C.primary} style={{ marginTop: 32 }} />}
      {data && data.entries.length === 0 && (
        <Card style={{ marginTop: 12, padding: 20, alignItems: 'center' }}>
          <Text style={{ fontSize: 32 }}>{mode === '1v1' ? '⚔️' : mode === 'solo' ? '⏱️' : '🏆'}</Text>
          <Text style={{ fontFamily: F.displayBold, fontSize: 18, color: C.white, marginTop: 8 }}>{t.empty}</Text>
          <Text style={[s.body, { textAlign: 'center', marginTop: 4 }]}>{t.emptyBody(p.phrase)}</Text>
        </Card>
      )}
      {data && data.entries.length > 0 && (
        <View style={{ gap: 6, marginTop: 8 }}>
          {data.entries.map((e) => <RankRow key={e.id} e={e} scope={scope} mode={mode} onPress={e.isYou ? undefined : () => nav.push({ name: 'player', id: e.id })} />)}
          {you && you.rank > 50 && (
            <>
              <Text style={{ textAlign: 'center', color: w(0.5), paddingVertical: 2 }}>⋯</Text>
              <RankRow e={you} scope={scope} mode={mode} />
            </>
          )}
          <Text style={{ textAlign: 'center', marginTop: 12, fontFamily: F.body, fontSize: 11, color: w(0.55) }}>
            {data.rankedPlayers} {data.rankedPlayers === 1 ? 'player' : 'players'} ranked · pull down to refresh
          </Text>
        </View>
      )}
    </View>
  );
}

// ── Profile ────────────────────────────────────────────────────────────────

function ProfileTab({ account, best }: { account: Account; best: number }) {
  const c = useSocial();
  const country = countryByCode(account.country);
  const eliminationWins = Math.max(c?.elimination_wins ?? 0, account.totalWins);
  const soloBest = Math.max(c?.solo_best ?? 0, best);
  const record = c?.record ?? { wins: 0, losses: 0, draws: 0 };
  const friends = c?.friends ?? 0;

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={s.h1}>Profile</Text>
        <Pressable onPress={() => nav.push({ name: 'settings' })} hitSlop={10} accessibilityRole="button" accessibilityLabel="Settings"
          style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? w(0.08) : 'transparent' })}>
          <Text style={{ fontSize: 22 }}>⚙️</Text>
        </Pressable>
      </View>
      <View style={{ marginTop: 10 }}>
        <ProfileBody avatar={meAvatar(account)} name={account.name} place={`${country.flag} ${account.region}`}
          friends={friends} onFriends={() => nav.push({ name: 'friends' })}
          eliminationWins={eliminationWins} soloBest={soloBest} record={record} onRecord={() => nav.push({ name: 'challenges', tab: 'history' })} />
      </View>

    </View>
  );
}

/** A short message above the tab bar (e.g. "Couldn't connect"); tap or wait to dismiss. */
function NoticeToast({ text }: { text: string }) {
  useEffect(() => {
    const t = setTimeout(() => engine.clearNotice(), 5000);
    return () => clearTimeout(t);
  }, [text]);
  return (
    <Animated.View entering={FadeIn.duration(200)} style={{ position: 'absolute', left: 12, right: 12, bottom: 96 }}>
      <Pressable onPress={() => engine.clearNotice()} accessibilityRole="alert"
        style={{ borderRadius: 16, backgroundColor: '#3A1820', borderWidth: 1, borderColor: 'rgba(255,93,115,0.5)', paddingHorizontal: 16, paddingVertical: 12 }}>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.white, textAlign: 'center' }}>{text}</Text>
      </Pressable>
    </Animated.View>
  );
}

// ── Pages over the tabs (Settings, Friends, Challenges…) ───────────────────
const ROUTE_TITLE: Record<Route['name'], string> = {
  settings: 'Settings', friends: 'Friends', challenges: '1v1 challenges', challenge: '1v1 challenge',
  player: 'Player', notifications: 'Notifications', invite: 'Invite', search: 'Find players', feedback: 'Send feedback',
};

function RoutePage({ route, account }: { route: Route; account: Account }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await social.refresh();
    setRefreshKey((k) => k + 1);
    setRefreshing(false);
  }, []);
  const key = `${JSON.stringify(route)}-${refreshKey}`;
  return (
    <Screen style={{ paddingBottom: 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingTop: 8, paddingBottom: 4 }}>
        <Pressable onPress={() => nav.pop()} accessibilityRole="button" accessibilityLabel="Back" hitSlop={8}
          style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? w(0.08) : 'transparent' })}>
          <Text style={{ fontSize: 30, color: C.white, marginTop: -4 }}>‹</Text>
        </Pressable>
        <Text style={[s.h1, { fontSize: 24 }]}>{ROUTE_TITLE[route.name]}</Text>
      </View>
      {/* A challenge page has its own scroll and pinned buttons. */}
      {route.name === 'challenge' ? (
        <Animated.View key={key} entering={FadeIn.duration(180)} style={{ flex: 1 }}>
          <ChallengeScreen id={route.id} />
        </Animated.View>
      ) : (
      <ScrollView key={key} style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 40 }}
        refreshControl={route.name === 'settings' || route.name === 'feedback' ? undefined : <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}>
        <Animated.View key={key} entering={FadeIn.duration(180)}>
          {route.name === 'settings' && <SettingsScreen account={account} />}
          {route.name === 'friends' && <FriendsScreen tab={route.tab} />}
          {route.name === 'challenges' && <ChallengesScreen tab={route.tab} />}
          {route.name === 'player' && <PlayerScreen id={route.id} />}
          {route.name === 'notifications' && <NotificationsScreen />}
          {route.name === 'search' && <PlayerSearchScreen />}
          {route.name === 'feedback' && <FeedbackScreen />}
          {route.name === 'invite' && <InviteScreen token={route.token} />}
        </Animated.View>
      </ScrollView>
      )}
    </Screen>
  );
}

export function Home({ s: g, account }: { s: GameState; account: Account }) {
  // Keep the tab when returning from a game; start on Play after each sign-in.
  const [tab, setTabState] = useState<Tab>(() => (rememberedFor === account.id ? rememberedTab : 'play'));
  const setTab = (t: Tab) => { rememberedTab = t; rememberedFor = account.id; setTabState(t); };
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const stack = useNav();
  const top = stack[stack.length - 1];
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([accounts.refresh().catch(() => {}), social.refresh()]);
    setRefreshKey((k) => k + 1);
    setRefreshing(false);
  }, []);
  // Badge counts: on open, on each tab change, and when the app comes back.
  useEffect(() => { void social.refresh(); }, [tab, top?.name]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') void social.refresh(); });
    return () => sub.remove();
  }, []);
  // Android back button closes the top page.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { if (nav.get().length) { nav.pop(); return true; } return false; });
    return () => sub.remove();
  }, []);
  return (
    <View style={{ flex: 1 }}>
      <Screen padBottom={false}>
        <ScrollView key={tab} style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 16, paddingBottom: 32 }}
          refreshControl={tab === 'play' || tab === 'rewards' ? undefined : <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} />}>
          <Animated.View entering={FadeIn.duration(200)}>
            {tab === 'play' && <PlayTab best={g.personalBest} account={account} />}
            {tab === 'ranks' && <RanksTab account={account} refreshKey={refreshKey} />}
            {tab === 'rewards' && <RewardsTab />}
            {tab === 'profile' && <ProfileTab account={account} best={g.personalBest} />}
          </Animated.View>
        </ScrollView>
        {g.notice && <NoticeToast text={g.notice} />}
        <TabBar tab={tab} onChange={setTab} account={account} />
      </Screen>
      {top && (
        <Animated.View key={stack.length} entering={FadeIn.duration(160)} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }}>
          <RoutePage route={top} account={account} />
        </Animated.View>
      )}
      <TopToast />
    </View>
  );
}
