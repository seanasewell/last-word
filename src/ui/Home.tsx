import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { accounts, weekRange, winsFor, type Account, type Period } from '@/lib/account';
import { engine, type GameState } from '@/lib/engine';
import { buildRanking, type RankEntry, type Scope } from '@/lib/ranks';
import { COUNTRIES, countryByCode, maskPhone } from '@/lib/regions';
import { scoreWord } from '@/lib/words';
import { cleanName, DevControls, NAME_MAX, nameError } from './Auth';
import { Avatar, Button, Card, FadeUp, inputStyle, OptionSheet, ordinal, s, Screen, Sheet, TileLogo, Toggle, useNow } from './kit';
import { pickPhoto } from './photo';
import { onSoundChange, setSoundEnabled, soundEnabled } from './sound';
import { C, F, w } from './theme';

type Tab = 'play' | 'ranks' | 'profile';
let rememberedTab: Tab = 'play';
let rememberedFor = '';

const meAvatar = (a: Account) => ({ glyph: a.name[0]?.toUpperCase() ?? 'Y', hue: 210, isYou: true, photo: a.photo });

function TabBar({ tab, onChange, account }: { tab: Tab; onChange: (t: Tab) => void; account: Account }) {
  const insets = useSafeAreaInsets();
  const items: { id: Tab; label: string; emoji?: string }[] = [
    { id: 'play', label: 'Play', emoji: '🔤' },
    { id: 'ranks', label: 'Ranks', emoji: '🏆' },
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
            <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: active ? C.white : w(0.6) }}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function PlayTab({ best }: { best: number }) {
  const [showScoring, setShowScoring] = useState(false);
  return (
    <View>
      <View style={{ alignItems: 'center', paddingTop: 8 }}>
        <TileLogo size={36} />
        <FadeUp delay={400}><Text style={{ marginTop: 12, fontFamily: F.bodySemi, fontSize: 12, letterSpacing: 0.4, color: w(0.5) }}>towards · world · salt</Text></FadeUp>
        <FadeUp delay={480}><Text style={[s.body, { marginTop: 14, textAlign: 'center', maxWidth: 320 }]}>Rearrange the letters of one big word into as many small words as you can. Longer words score more points.</Text></FadeUp>
      </View>

      <FadeUp delay={120} style={{ marginTop: 32, gap: 12 }}>
        <Pressable onPress={() => engine.startMatch()} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <View style={{ borderRadius: 24, borderWidth: 1.5, borderColor: 'rgba(92,158,255,0.7)', backgroundColor: 'rgba(8,20,40,0.92)', padding: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontFamily: F.displayBold, fontSize: 24, color: C.white }}>Elimination match</Text>
              <View style={{ flexDirection: 'row' }}>
                {[168, 280, 30, 340, 205].map((h, i) => <View key={h} style={{ width: 22, height: 22, borderRadius: 11, marginLeft: i ? -7 : 0, borderWidth: 2, borderColor: C.bg, backgroundColor: `hsl(${h}, 80%, 58%)` }} />)}
              </View>
            </View>
            <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.65), marginTop: 4 }}>6 players · 5 rounds · 60 seconds each. Lowest score each round is out.</Text>
            <View style={{ alignSelf: 'flex-start', marginTop: 16, backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 9 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.white }}>Find a match →</Text>
            </View>
          </View>
        </Pressable>

        <Pressable onPress={() => engine.startSingle()} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <Card style={{ borderRadius: 24, padding: 20 }}>
            <Text style={{ fontFamily: F.displayBold, fontSize: 20, color: C.white }}>Solo challenge</Text>
            <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.65), marginTop: 4 }}>One word, 60 seconds. Beat your personal best.</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 12 }}>
              <Text style={s.eyebrow}>Best</Text>
              <Text style={[{ fontFamily: F.display, fontSize: 18, color: C.amber }, s.tabular]}>{best}</Text>
            </View>
          </Card>
        </Pressable>

        <Pressable onPress={() => setShowScoring((x) => !x)} hitSlop={8}>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: w(0.55), paddingTop: 4 }}>{showScoring ? '▾' : '▸'} How scoring works</Text>
        </Pressable>
        {showScoring && (
          <View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => (
                <View key={n} style={{ width: '18.4%', alignItems: 'center', paddingVertical: 6, borderRadius: 12, backgroundColor: w(0.04) }}>
                  <Text style={{ fontFamily: F.body, fontSize: 10, color: w(0.5) }}>{n}{n === 11 ? '+' : ''} letters</Text>
                  <Text style={{ fontFamily: F.displayBold, fontSize: 15, color: C.white }}>{scoreWord('x'.repeat(n))}</Text>
                </View>
              ))}
            </View>
            <Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.5), marginTop: 8, lineHeight: 17 }}>{"Each letter can be used as often as it appears in the source. The source word itself doesn't count. No proper nouns, abbreviations or hyphenated words."}</Text>
          </View>
        )}
      </FadeUp>
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
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 4, padding: 4, borderRadius: 16, backgroundColor: w(0.05) }}>
      {options.map((x) => {
        const on = value === x.id;
        return (
          <Pressable key={x.id} onPress={() => onChange(x.id)} accessibilityRole="tab" accessibilityState={{ selected: on }}
            style={{ flex: 1, height: small ? 32 : 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.ink700 : 'transparent' }}>
            <Text numberOfLines={1} style={{ fontFamily: F.bodySemi, fontSize: small ? 12 : 13, color: on ? C.white : w(0.6) }}>{x.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function RankRow({ e, scope }: { e: RankEntry; scope: Scope }) {
  const medal = e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : null;
  const where = scope === 'world' ? `${e.country.flag} ${e.country.name}` : scope === 'national' ? e.region : `${e.country.flag} ${e.region}`;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16,
      backgroundColor: e.isYou ? 'rgba(61,139,255,0.15)' : e.rank <= 3 ? 'rgba(255,181,71,0.06)' : w(0.03), borderWidth: e.isYou ? 1 : 0, borderColor: 'rgba(61,139,255,0.4)' }}>
      <View style={{ width: 30, alignItems: 'center' }}>
        {medal ? <Text style={{ fontSize: 20 }}>{medal}</Text> : <Text style={[{ fontFamily: F.displayBold, fontSize: 14, color: w(0.55) }, s.tabular]}>{e.rank}</Text>}
      </View>
      <Avatar player={{ glyph: e.glyph, hue: e.hue, photo: e.photo, isYou: e.isYou }} size={34} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.white }}>{e.name}</Text>
        <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: 11, color: w(0.5) }}>{where}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[{ fontFamily: F.display, fontSize: 18, color: C.white }, s.tabular]}>{e.wins}</Text>
        <Text style={{ fontFamily: F.body, fontSize: 10, color: w(0.45) }}>{e.wins === 1 ? 'win' : 'wins'}</Text>
      </View>
    </View>
  );
}

function RanksTab({ account }: { account: Account }) {
  const [scope, setScope] = useState<Scope>('world');
  const [period, setPeriod] = useState<Period>('week');
  const country = countryByCode(account.country);
  const myWins = winsFor(account, period);
  const now = useNow(true, 30_000);
  const day = new Date(now).toDateString();
  const { entries, you } = useMemo(() => buildRanking(scope, account, myWins, period), [scope, account, myWins, period, day]); // eslint-disable-line react-hooks/exhaustive-deps
  const scopes: { id: Scope; label: string }[] = [
    { id: 'world', label: '🌍 World' },
    { id: 'national', label: `${country.flag} National` },
    { id: 'state', label: `📍 ${country.regionLabel}` },
  ];
  const p = PERIODS.find((x) => x.id === period)!;
  const scopeName = scope === 'world' ? 'in the world' : scope === 'national' ? `in ${country.name}` : `in ${account.region}`;
  const reset = resetText(period, now);
  return (
    <View>
      <Text style={s.h1}>Ranks</Text>
      <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.6), marginTop: 4 }}>Most elimination-match wins · {periodRange(period, new Date(now))}</Text>
      <View style={{ gap: 8, marginTop: 16 }}>
        <Segmented options={scopes} value={scope} onChange={setScope} />
        <Segmented options={PERIODS} value={period} onChange={setPeriod} small />
      </View>
      <View style={{ marginTop: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(61,139,255,0.35)', backgroundColor: 'rgba(61,139,255,0.1)', padding: 16 }}>
        <Avatar player={meAvatar(account)} size={44} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.6) }}>Your rank {scopeName}</Text>
          <Text style={{ fontFamily: F.display, fontSize: 24, color: C.white }}>{ordinal(you.rank)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[{ fontFamily: F.display, fontSize: 24, color: C.mint }, s.tabular]}>{myWins}</Text>
          <Text style={{ fontFamily: F.body, fontSize: 11, color: w(0.55) }}>{myWins === 1 ? 'win' : 'wins'} {p.phrase}</Text>
        </View>
      </View>
      {reset && <Text style={{ alignSelf: 'flex-end', marginTop: 8, fontFamily: F.body, fontSize: 11, color: w(0.45) }}>{reset}</Text>}
      <View style={{ gap: 6, marginTop: 8 }}>
        {entries.map((e) => <RankRow key={e.id} e={e} scope={scope} />)}
        {!entries.some((e) => e.isYou) && (
          <>
            <Text style={{ textAlign: 'center', color: w(0.35), paddingVertical: 2 }}>⋯</Text>
            <RankRow e={you} scope={scope} />
          </>
        )}
      </View>
      <Text style={{ textAlign: 'center', marginTop: 20, fontFamily: F.body, fontSize: 11, lineHeight: 16, color: w(0.4) }}>Other players shown are sample entries until online play launches. Your wins are counted from matches on this phone.</Text>
    </View>
  );
}

// ── Profile ────────────────────────────────────────────────────────────────
function ProfileTab({ account, best }: { account: Account; best: number }) {
  const [name, setName] = useState(account.name);
  const [saved, setSaved] = useState(false);
  const [sheet, setSheet] = useState<null | 'photo' | 'country' | 'region' | 'logout' | 'delete' | 'dev'>(null);
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
    if ('error' in r) setPhotoErr(r.error);
    else { setPhotoErr(null); accounts.update({ photo: r.uri }); }
  };
  const wins = (p: Period) => winsFor(account, p);
  const row = { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: w(0.06) };

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

      <Text style={[s.eyebrow, { marginTop: 26, marginBottom: 8 }]}>Account</Text>
      <View style={{ borderRadius: 18, backgroundColor: w(0.04), overflow: 'hidden' }}>
        <View style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: w(0.06) }}>
          <Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.55) }}>Display name</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
            <TextInput value={name} onChangeText={(t) => setName(cleanName(t))} maxLength={NAME_MAX} autoCorrect={false} keyboardAppearance="dark"
              returnKeyType="done" onSubmitEditing={save} accessibilityLabel="Display name" style={[inputStyle, { flex: 1, height: 44, borderRadius: 12, fontSize: 16 }]} />
            <Pressable onPress={save} disabled={!dirty || !!err} style={{ height: 44, paddingHorizontal: 16, borderRadius: 12, justifyContent: 'center', backgroundColor: dirty && !err ? C.primary : w(0.1) }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: dirty && !err ? C.white : w(0.4) }}>{saved ? 'Saved ✓' : 'Save'}</Text>
            </Pressable>
          </View>
          {dirty && err && <Text style={{ marginTop: 4, fontFamily: F.body, fontSize: 12, color: C.coral }}>{err}</Text>}
        </View>
        <View style={row}>
          <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.75) }}>Phone</Text>
          <Text style={[{ fontFamily: F.bodySemi, fontSize: 14, color: C.white }, s.tabular]}>{maskPhone(account.phone)}</Text>
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
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 18, backgroundColor: w(0.04), paddingHorizontal: 16, paddingVertical: 10 }}>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.white }}>🔊 Sound effects</Text>
        <Toggle on={sound} onChange={setSoundEnabled} label="Sound effects" />
      </View>

      <Text style={[s.eyebrow, { marginTop: 26, marginBottom: 8 }]}>Developer</Text>
      <Pressable onPress={() => setSheet('dev')} style={{ flexDirection: 'row', justifyContent: 'space-between', borderRadius: 18, backgroundColor: w(0.04), paddingHorizontal: 16, paddingVertical: 14 }}>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.white }}>🛠 Developer controls</Text>
        <Text style={{ color: w(0.4) }}>›</Text>
      </Pressable>

      <View style={{ gap: 10, marginTop: 26 }}>
        <Button title="Log out" variant="ghost" onPress={() => setSheet('logout')} />
        <Pressable onPress={() => setSheet('delete')} style={{ height: 48, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: C.coral }}>Delete account</Text>
        </Pressable>
      </View>

      <Sheet open={sheet === 'photo'} onClose={() => setSheet(null)} title="Profile photo">
        <View style={{ gap: 10 }}>
          <Button title="Choose from library" onPress={() => choose('library')} />
          <Button title="Take a photo" variant="ghost" onPress={() => choose('camera')} />
          {account.photo && <Pressable onPress={() => { accounts.update({ photo: null }); setSheet(null); }} style={{ alignItems: 'center', paddingVertical: 10 }}><Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.coral }}>Remove photo</Text></Pressable>}
        </View>
      </Sheet>
      <OptionSheet open={sheet === 'country'} onClose={() => setSheet(null)} title="Country" value={account.country}
        options={COUNTRIES.map((x) => ({ value: x.code, label: `${x.flag}  ${x.name}` }))}
        onPick={(v) => { const c = countryByCode(v); accounts.update({ country: c.code, region: c.regions[0] }); }} />
      <OptionSheet open={sheet === 'region'} onClose={() => setSheet(null)} title={country.regionLabel} value={account.region}
        options={country.regions.map((r) => ({ value: r, label: r }))} onPick={(v) => accounts.update({ region: v })} />
      <Sheet open={sheet === 'logout'} onClose={() => setSheet(null)} title="Log out?">
        <Text style={s.body}>You can log back in any time with {maskPhone(account.phone)}.</Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
          <Button title="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => setSheet(null)} />
          <Button title="Log out" style={{ flex: 1 }} onPress={() => { setSheet(null); accounts.logOut(); }} />
        </View>
      </Sheet>
      <Sheet open={sheet === 'delete'} onClose={() => setSheet(null)} title="Delete your account?">
        <Text style={s.body}>{"This permanently removes your profile, photo, wins and stats. This can't be undone."}</Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
          <Button title="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => setSheet(null)} />
          <Button title="Delete account" variant="danger" style={{ flex: 1 }} onPress={() => { setSheet(null); accounts.deleteAccount(); }} />
        </View>
      </Sheet>
      <DevControls open={sheet === 'dev'} onClose={() => setSheet(null)} signedIn />
    </View>
  );
}

export function Home({ s: g, account }: { s: GameState; account: Account }) {
  // Keep the tab when returning from a game; start on Play after each sign-in.
  const [tab, setTabState] = useState<Tab>(() => (rememberedFor === account.id ? rememberedTab : 'play'));
  const setTab = (t: Tab) => { rememberedTab = t; rememberedFor = account.id; setTabState(t); };
  return (
    <Screen padBottom={false}>
      <ScrollView key={tab} style={{ flex: 1 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 }}>
        <Animated.View entering={FadeIn.duration(200)}>
          {tab === 'play' && <PlayTab best={g.personalBest} />}
          {tab === 'ranks' && <RanksTab account={account} />}
          {tab === 'profile' && <ProfileTab account={account} best={g.personalBest} />}
        </Animated.View>
      </ScrollView>
      <TabBar tab={tab} onChange={setTab} account={account} />
    </Screen>
  );
}
