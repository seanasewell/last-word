import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, RefreshControl, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { accounts, weekRange, winsFor, type Account, type Period } from '@/lib/account';
import { engine, type GameState } from '@/lib/engine';
import { myBlocks, unblockPlayer, type BlockedPlayer } from '@/lib/moderation';
import { PRIVACY_URL, SHOW_DEV_TOOLS, SUPPORT_URL } from '@/lib/release';
import { fetchLeaderboard, type Leaderboard, type RankEntry, type Scope } from '@/lib/ranks';
import { COUNTRIES, countryByCode } from '@/lib/regions';
import { scoreWord } from '@/lib/words';
import { cleanName, DevControls, NAME_MAX, nameError } from './Auth';
import { Avatar, Button, Card, FadeUp, OptionSheet, ordinal, s, Screen, Sheet, TextField, TileLogo, Toggle, useNow } from './kit';
import { pickPhoto } from './photo';
import { DailyChallenges, LevelCard, LevelingGuide, RewardsTab, SweepBorder } from './Progress';
import { PlayerActions, type PlayerRef } from './PlayerActions';
import { PROVIDER_NAME, SaveProgressCard, SaveProgressNudge } from './SignIn';
import { onSoundChange, setSoundEnabled, soundEnabled } from './sound';
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

/** Player headshots shown on the Elimination match card. */
const MATCH_FACES = [
  require('@/assets/avatars/bot1.jpg'),
  require('@/assets/avatars/bot2.jpg'),
  require('@/assets/avatars/bot3.jpg'),
  require('@/assets/avatars/bot4.jpg'),
  require('@/assets/avatars/bot5.jpg'),
];

/** The tile logo sized to span the screen, with 12px on each side. */
function FullWidthLogo() {
  const { width } = useWindowDimensions();
  const avail = Math.min(width, 480) - 24;
  const gap = Math.max(2, Math.round((avail / 8.91) * 0.13));
  const size = Math.floor(((avail - 7 * gap) / 8) * 100) / 100;
  return <TileLogo size={size} />;
}

function PlayTab({ best, account }: { best: number; account: Account }) {
  return (
    <View>
      <View style={{ paddingTop: 36 }}><FullWidthLogo /></View>

      <FadeUp delay={60} style={{ marginTop: 24 }}><LevelCard /></FadeUp>
      <FadeUp delay={90} style={{ marginTop: 12 }}><SaveProgressNudge account={account} /></FadeUp>

      <FadeUp delay={120} style={{ marginTop: 12, gap: 12 }}>
        <Pressable onPress={() => engine.startMatch()} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <View style={{ borderRadius: 24, backgroundColor: C.card, padding: 22 }}>
            <SweepBorder radius={24} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontFamily: F.displayBold, fontSize: 24, color: C.white }}>Elimination match</Text>
              <View style={{ flexDirection: 'row' }}>
                {MATCH_FACES.map((src, i) => <Image key={i} source={src} style={{ width: 26, height: 26, borderRadius: 13, marginLeft: i ? -8 : 0, borderWidth: 2, borderColor: C.bg }} />)}
              </View>
            </View>
            <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.75), marginTop: 4 }}>6 players · 5 rounds · 60 seconds each. Lowest score each round is out.</Text>
            <View style={{ alignSelf: 'flex-start', marginTop: 16, backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 9 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.white }}>Find a match →</Text>
            </View>
          </View>
        </Pressable>

        <Pressable onPress={() => engine.startSingle()} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <Card style={{ borderRadius: 24, padding: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
              <Text style={{ fontFamily: F.displayBold, fontSize: 20, color: C.white }}>Solo challenge</Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Text style={s.eyebrow}>Best</Text>
                <Text style={[{ fontFamily: F.display, fontSize: 18, color: C.amber }, s.tabular]}>{best}</Text>
              </View>
            </View>
            <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.75), marginTop: 4 }}>60 second rounds. Try and beat your personal best.</Text>
          </Card>
        </Pressable>
      </FadeUp>

      <FadeUp delay={180} style={{ marginTop: 28 }}><DailyChallenges /></FadeUp>
    </View>
  );
}

/** Points for each word length, shown from Profile → How scoring works. */
function ScoringGuide() {
  return (
    <View>
      <Text style={[s.body, { fontSize: 14 }]}>Longer words score more points.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
        {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => (
          <View key={n} style={{ width: '18.4%', alignItems: 'center', paddingVertical: 6, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder }}>
            <Text style={{ fontFamily: F.body, fontSize: 10, color: w(0.65) }}>{n}{n === 11 ? '+' : ''} letters</Text>
            <Text style={{ fontFamily: F.displayBold, fontSize: 15, color: C.white }}>{scoreWord('x'.repeat(n))}</Text>
          </View>
        ))}
      </View>
      <Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.65), marginTop: 12, lineHeight: 17 }}>{"Each letter can be used as often as it appears in the source. The source word itself doesn't count. No proper nouns, abbreviations or hyphenated words."}</Text>
    </View>
  );
}

// ── Ranks ──────────────────────────────────────────────────────────────────
const PERIODS: { id: Period; label: string; phrase: string }[] = [
  { id: 'day', label: 'Today', phrase: 'today' },
  { id: 'week', label: 'Week', phrase: 'this week' },
  { id: 'month', label: 'Month', phrase: 'this month' },
  { id: 'year', label: 'Year', phrase: 'this year' },
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

function Segmented<T extends string>({ options, value, onChange, small = false }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; small?: boolean }) {
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 4, padding: 4, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder }}>
      {options.map((x) => {
        const on = value === x.id;
        return (
          <Pressable key={x.id} onPress={() => onChange(x.id)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={{ flex: 1, height: small ? 32 : 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.primary : 'transparent' }}>
            <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: small ? 12 : 13, color: on ? C.white : w(0.72) }}>{x.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function RankRow({ e, scope, onPress }: { e: RankEntry; scope: Scope; onPress?: () => void }) {
  const medal = e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : null;
  const where = scope === 'world' ? `${e.country.flag} ${e.country.name}` : scope === 'national' ? e.region : `${e.country.flag} ${e.region}`;
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityHint={onPress ? 'Report or block this player' : undefined}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16,
      backgroundColor: pressed ? 'rgba(61,139,255,0.12)' : e.isYou ? 'rgba(61,139,255,0.15)' : e.rank <= 3 ? 'rgba(255,181,71,0.06)' : w(0.03), borderWidth: e.isYou ? 1 : 0, borderColor: 'rgba(61,139,255,0.4)' })}>
      <View style={{ width: 30, alignItems: 'center' }}>
        {medal ? <Text style={{ fontSize: 20 }}>{medal}</Text> : <Text style={[{ fontFamily: F.displayBold, fontSize: 14, color: w(0.7) }, s.tabular]}>{e.rank}</Text>}
      </View>
      <Avatar player={{ glyph: e.glyph, hue: e.hue, photo: e.photo, isYou: e.isYou }} size={34} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.white }}>{e.name}</Text>
        <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: 11, color: w(0.65) }}>{where}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[{ fontFamily: F.display, fontSize: 18, color: C.white }, s.tabular]}>{e.wins}</Text>
        <Text style={{ fontFamily: F.body, fontSize: 10, color: w(0.6) }}>{e.wins === 1 ? 'win' : 'wins'}</Text>
      </View>
    </Pressable>
  );
}

function RanksTab({ account, refreshKey }: { account: Account; refreshKey: number }) {
  const [scope, setScope] = useState<Scope>('world');
  const [period, setPeriod] = useState<Period>('week');
  const [board, setBoard] = useState<{ key: string; data: Leaderboard } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const country = countryByCode(account.country);
  const now = useNow(true, 30_000);
  const key = `${scope}-${period}`;
  const [acting, setActing] = useState<PlayerRef | null>(null);
  const [blocks, setBlocks] = useState(0);
  const actOn = (e: RankEntry) => (e.isYou ? undefined : () => setActing({ name: e.name, glyph: e.glyph, hue: e.hue, photo: e.photo, target: { userId: e.id } }));

  // Load the board for the current scope and period (and on pull-to-refresh).
  const myWinsLocal = winsFor(account, period);
  useEffect(() => {
    let live = true;
    fetchLeaderboard(scope, period)
      .then((data) => { if (live) { setBoard({ key: `${scope}-${period}`, data }); setError(null); } })
      .catch(() => { if (live) setError("Couldn't load rankings. Pull down to try again."); });
    return () => { live = false; };
  }, [scope, period, refreshKey, myWinsLocal, blocks]);

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
  const myWins = you?.wins ?? myWinsLocal;

  return (
    <View>
      <Text style={s.h1}>Ranks</Text>
      <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.72), marginTop: 4 }}>Most elimination-match wins · {periodRange(period, new Date(now))}</Text>
      <View style={{ gap: 8, marginTop: 16 }}>
        <Segmented options={scopes} value={scope} onChange={setScope} />
        <Segmented options={PERIODS} value={period} onChange={setPeriod} small />
      </View>
      <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 20, borderWidth: 1, borderColor: C.cardBorder, backgroundColor: C.card, padding: 16 }}>
        <Avatar player={meAvatar(account)} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.72) }}>Your rank {scopeName}</Text>
          <Text style={{ fontFamily: F.display, fontSize: 24, color: C.white }}>{you ? ordinal(you.rank) : data ? 'Not ranked yet' : '…'}</Text>
        </View>
        <Text accessibilityLabel={`${myWins} ${myWins === 1 ? 'win' : 'wins'} ${p.phrase}`} style={[{ fontFamily: F.display, fontSize: 34, color: C.mint }, s.tabular]}>{myWins}</Text>
      </View>
      {reset && <Text style={{ alignSelf: 'flex-end', marginTop: 8, fontFamily: F.body, fontSize: 11, color: w(0.6) }}>{reset}</Text>}

      {error && !data && <Text style={{ marginTop: 24, textAlign: 'center', fontFamily: F.body, fontSize: 14, color: C.coral }}>{error}</Text>}
      {!error && !data && <ActivityIndicator color={C.primary} style={{ marginTop: 32 }} />}
      {data && data.entries.length === 0 && (
        <Card style={{ marginTop: 12, padding: 20, alignItems: 'center' }}>
          <Text style={{ fontSize: 32 }}>🏆</Text>
          <Text style={{ fontFamily: F.displayBold, fontSize: 18, color: C.white, marginTop: 8 }}>No winners yet</Text>
          <Text style={[s.body, { textAlign: 'center', marginTop: 4 }]}>Win an elimination match {p.phrase === 'all time' ? '' : p.phrase} to be first on this board.</Text>
        </Card>
      )}
      {data && data.entries.length > 0 && (
        <View style={{ gap: 6, marginTop: 8 }}>
          {data.entries.map((e) => <RankRow key={e.id} e={e} scope={scope} onPress={actOn(e)} />)}
          {you && you.rank > 50 && (
            <>
              <Text style={{ textAlign: 'center', color: w(0.5), paddingVertical: 2 }}>⋯</Text>
              <RankRow e={you} scope={scope} />
            </>
          )}
          <Text style={{ textAlign: 'center', marginTop: 12, fontFamily: F.body, fontSize: 11, color: w(0.55) }}>
            {data.rankedPlayers} {data.rankedPlayers === 1 ? 'player' : 'players'} ranked · pull down to refresh
          </Text>
        </View>
      )}
      <PlayerActions player={acting} onClose={() => setActing(null)} onBlocked={() => setBlocks((n) => n + 1)} />
    </View>
  );
}

// ── Profile ────────────────────────────────────────────────────────────────
function ProfileTab({ account, best }: { account: Account; best: number }) {
  const [name, setName] = useState(account.name);
  const [saved, setSaved] = useState(false);
  const [sheet, setSheet] = useState<null | 'photo' | 'country' | 'region' | 'delete' | 'signout' | 'dev' | 'blocked' | 'scoring' | 'leveling'>(null);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [sound, setSound] = useState(soundEnabled);
  useEffect(() => onSoundChange(() => setSound(soundEnabled())), []);
  const country = countryByCode(account.country);
  const err = nameError(name);
  const dirty = name.trim() !== account.name;

  const save = () => {
    if (err || !dirty) return;
    accounts.update({ name: name.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };
  const choose = async (source: 'library' | 'camera') => {
    setSheet(null);
    const r = await pickPhoto(source);
    if (!r) return;
    if ('error' in r) { setPhotoErr(r.error); return; }
    setPhotoErr(null);
    const err = await accounts.update({ photo: r.uri });
    if (err) setPhotoErr(err);
  };
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const remove = async () => {
    setDeleting(true);
    const err = await accounts.deleteAccount();
    setDeleting(false);
    if (err) setDeleteErr(err);
    else setSheet(null);
  };
  const wins = (p: Period) => winsFor(account, p);
  const row = { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.divider };

  return (
    <View>
      <Text style={s.h1}>Profile</Text>
      <View style={{ alignItems: 'center', marginTop: 18 }}>
        <Pressable onPress={() => setSheet('photo')} accessibilityLabel="Change photo">
          <Avatar player={meAvatar(account)} size={104} ring />
        </Pressable>
        <Pressable onPress={() => setSheet('photo')} hitSlop={8} style={{ marginTop: 10 }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.primary }}>{account.photo ? 'Change photo' : 'Add photo'}</Text>
        </Pressable>
        {photoErr && <Text style={{ marginTop: 6, fontFamily: F.body, fontSize: 13, color: C.coral }}>{photoErr}</Text>}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 20 }}>
        {([['Wins this week', wins('week'), C.mint], ['Total wins', account.totalWins, C.white], ['Matches played', account.matchesPlayed, C.white], ['Solo best', best, C.amber]] as const).map(([l, v, col]) => (
          <Card key={l} style={{ width: '48.5%', paddingHorizontal: 16, paddingVertical: 12 }}>
            <Text style={s.eyebrow}>{l}</Text>
            <Text style={[{ fontFamily: F.display, fontSize: 20, color: col }, s.tabular]}>{v}</Text>
          </Card>
        ))}
      </View>

      {!account.provider && <View style={{ marginTop: 20 }}><SaveProgressCard /></View>}

      <Text style={[s.eyebrow, { marginTop: 26, marginBottom: 8 }]}>Account</Text>
      <View style={{ borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, overflow: 'hidden' }}>
        {account.provider && (
          <View style={row}>
            <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.75) }}>Signed in with</Text>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.white }}>{PROVIDER_NAME[account.provider]}</Text>
          </View>
        )}
        <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.divider }}>
          <Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.7) }}>Display name</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
            <TextField value={name} onChangeText={(t) => setName(cleanName(t))} maxLength={NAME_MAX} autoCorrect={false}
              returnKeyType="done" onSubmitEditing={save} accessibilityLabel="Display name" style={{ flex: 1, height: 44, borderRadius: 12, fontSize: 16 }} />
            <Pressable onPress={save} disabled={!dirty || !!err} style={{ height: 44, paddingHorizontal: 16, borderRadius: 12, justifyContent: 'center', backgroundColor: dirty && !err ? C.primary : C.primaryDisabled }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: (dirty && !err) || saved ? C.white : w(0.5) }}>{saved ? 'Saved ✓' : 'Save'}</Text>
            </Pressable>
          </View>
          {dirty && err && <Text style={{ marginTop: 4, fontFamily: F.body, fontSize: 12, color: C.coral }}>{err}</Text>}
        </View>
        <Pressable onPress={() => setSheet('country')} style={row}>
          <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.75) }}>Country</Text>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.white }}>{country.flag} {country.name}  ›</Text>
        </Pressable>
        <Pressable onPress={() => setSheet('region')} style={[row, { borderBottomWidth: 0 }]}>
          <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.75) }}>{country.regionLabel}</Text>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.white }}>{account.region}  ›</Text>
        </Pressable>
      </View>

      <Text style={[s.eyebrow, { marginTop: 26, marginBottom: 8 }]}>Settings</Text>
      <View style={{ borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, overflow: 'hidden' }}>
        <View style={[row, { paddingVertical: 10 }]}>
          <MenuLabel emoji="🔊" text="Sound effects" />
          <Toggle on={sound} onChange={setSoundEnabled} label="Sound effects" />
        </View>
        <Pressable onPress={() => setSheet('blocked')} style={[row, { borderBottomWidth: 0 }]}>
          <MenuLabel emoji="🚫" text="Blocked players" />
          <Text style={{ color: w(0.55) }}>›</Text>
        </Pressable>
      </View>

      <Text style={[s.eyebrow, { marginTop: 26, marginBottom: 8 }]}>Help</Text>
      <View style={{ borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, overflow: 'hidden' }}>
        <Pressable onPress={() => setSheet('scoring')} style={row}>
          <MenuLabel emoji="🤔" text="How scoring works" />
          <Text style={{ color: w(0.55) }}>›</Text>
        </Pressable>
        <Pressable onPress={() => setSheet('leveling')} style={row}>
          <MenuLabel emoji="⭐" text="How leveling works" />
          <Text style={{ color: w(0.55) }}>›</Text>
        </Pressable>
        <Pressable onPress={() => { void Linking.openURL(SUPPORT_URL); }} style={row}>
          <MenuLabel emoji="💬" text="Help and support" />
          <Text style={{ color: w(0.55) }}>↗</Text>
        </Pressable>
        <Pressable onPress={() => { void Linking.openURL(PRIVACY_URL); }} style={[row, { borderBottomWidth: 0 }]}>
          <MenuLabel emoji="🔒" text="Privacy policy" />
          <Text style={{ color: w(0.55) }}>↗</Text>
        </Pressable>
      </View>

      {SHOW_DEV_TOOLS && (
        <>
          <Text style={[s.eyebrow, { marginTop: 26, marginBottom: 8 }]}>Developer</Text>
          <Pressable onPress={() => setSheet('dev')} style={{ flexDirection: 'row', justifyContent: 'space-between', borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, paddingHorizontal: 16, paddingVertical: 14 }}>
            <MenuLabel emoji="🛠" text="Developer controls" />
            <Text style={{ color: w(0.55) }}>›</Text>
          </Pressable>
        </>
      )}

      <View style={{ gap: 10, marginTop: 26 }}>
        {account.provider && (
          <Pressable onPress={() => setSheet('signout')} style={{ height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: C.white }}>Sign out</Text>
          </Pressable>
        )}
        <Pressable onPress={() => setSheet('delete')} style={{ height: 48, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: C.coral }}>Delete account</Text>
        </Pressable>
      </View>

      <Sheet open={sheet === 'scoring'} onClose={() => setSheet(null)} title="How scoring works">
        <ScoringGuide />
        <Button title="Close" variant="ghost" style={{ marginTop: 20 }} onPress={() => setSheet(null)} />
      </Sheet>
      <Sheet open={sheet === 'leveling'} onClose={() => setSheet(null)} title="How leveling works">
        <LevelingGuide />
        <Button title="Close" variant="ghost" style={{ marginTop: 12 }} onPress={() => setSheet(null)} />
      </Sheet>
      <Sheet open={sheet === 'photo'} onClose={() => setSheet(null)} title="Profile photo">
        <View style={{ gap: 10 }}>
          <Button title="Choose from library" onPress={() => choose('library')} />
          <Button title="Take a photo" variant="ghost" onPress={() => choose('camera')} />
          {account.photo && <Pressable onPress={() => { void accounts.update({ photo: null }); setSheet(null); }} style={{ alignItems: 'center', paddingVertical: 10 }}><Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.coral }}>Remove photo</Text></Pressable>}
        </View>
      </Sheet>
      <OptionSheet open={sheet === 'country'} onClose={() => setSheet(null)} title="Country" value={account.country}
        options={COUNTRIES.map((x) => ({ value: x.code, label: `${x.flag}  ${x.name}` }))}
        onPick={(v) => { const c = countryByCode(v); accounts.update({ country: c.code, region: c.regions[0] }); }} />
      <OptionSheet open={sheet === 'region'} onClose={() => setSheet(null)} title={country.regionLabel} value={account.region}
        options={country.regions.map((r) => ({ value: r, label: r }))} onPick={(v) => accounts.update({ region: v })} />
      <Sheet open={sheet === 'signout'} onClose={() => setSheet(null)} title="Sign out?">
        <Text style={s.body}>{`Your progress is saved. Sign in with ${account.provider ? PROVIDER_NAME[account.provider] : ''} to pick up where you left off.`}</Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
          <Button title="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => setSheet(null)} />
          <Button title="Sign out" style={{ flex: 1 }} onPress={() => { setSheet(null); void accounts.signOut(); }} />
        </View>
      </Sheet>
      <Sheet open={sheet === 'delete'} onClose={() => setSheet(null)} title="Delete your account?">
        <Text style={s.body}>{"This permanently removes your profile, photo, wins, level and achievements. This can't be undone."}</Text>
        {deleteErr && <Text style={{ marginTop: 10, fontFamily: F.body, fontSize: 13, color: C.coral }}>{deleteErr}</Text>}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
          <Button title="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => { setDeleteErr(null); setSheet(null); }} />
          <Button title={deleting ? 'Deleting…' : 'Delete account'} variant="danger" disabled={deleting} style={{ flex: 1 }} onPress={remove} />
        </View>
      </Sheet>
      {SHOW_DEV_TOOLS && <DevControls open={sheet === 'dev'} onClose={() => setSheet(null)} signedIn />}
      <BlockedPlayers open={sheet === 'blocked'} onClose={() => setSheet(null)} />
    </View>
  );
}

/** A menu row's emoji and label, 8px apart. */
const MenuLabel = ({ emoji, text }: { emoji: string; text: string }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
    <Text style={{ fontSize: 14 }}>{emoji}</Text>
    <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.white }}>{text}</Text>
  </View>
);

// ── Blocked players ────────────────────────────────────────────────────────
function BlockedPlayers({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [list, setList] = useState<BlockedPlayer[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    myBlocks().then((l) => { if (live) { setList(l); setErr(null); } }).catch(() => { if (live) setErr("Couldn't load your blocked players."); });
    return () => { live = false; };
  }, [open]);
  const unblock = async (id: string) => {
    const e = await unblockPlayer(id);
    if (e) setErr(e); else setList((l) => (l ?? []).filter((x) => x.userId !== id));
  };
  return (
    <Sheet open={open} onClose={onClose} title="Blocked players">
      {err && <Text style={{ fontFamily: F.body, fontSize: 13, color: C.coral, marginBottom: 8 }}>{err}</Text>}
      {!list && !err && <ActivityIndicator color={C.primary} style={{ marginVertical: 16 }} />}
      {list && list.length === 0 && <Text style={s.body}>{"You haven't blocked anyone. To block a player, tap them on the ranks or in a match's results."}</Text>}
      <ScrollView style={{ maxHeight: 380 }}>
        {(list ?? []).map((b) => (
          <View key={b.userId} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
            <Avatar player={{ glyph: b.name[0]?.toUpperCase() ?? '?', hue: 210, photo: b.photo }} size={36} />
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 15, color: C.white }}>{b.name}</Text>
            <Pressable onPress={() => void unblock(b.userId)} hitSlop={8}><Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.primary }}>Unblock</Text></Pressable>
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

export function Home({ s: g, account }: { s: GameState; account: Account }) {
  // Keep the tab when returning from a game; start on Play after each sign-in.
  const [tab, setTabState] = useState<Tab>(() => (rememberedFor === account.id ? rememberedTab : 'play'));
  const setTab = (t: Tab) => { rememberedTab = t; rememberedFor = account.id; setTabState(t); };
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await accounts.refresh().catch(() => {});
    setRefreshKey((k) => k + 1);
    setRefreshing(false);
  }, []);
  return (
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
      <TabBar tab={tab} onChange={setTab} account={account} />
    </Screen>
  );
}
