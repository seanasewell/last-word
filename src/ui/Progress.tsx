// ── Progression UI: level, challenges, streak, achievements ────────────────
// Same design as the web prototype: a Rewards tab with the level card, streak,
// daily and weekly challenges and the achievement grid; a level badge drawn as
// a turning sphere; a level-up pop-up after a game; "How leveling works".
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming, ZoomIn,
} from 'react-native-reanimated';
import MaskedViewBase from '@react-native-masked-view/masked-view';
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg';

import {
  ACHIEVEMENT_GROUPS, ACHIEVEMENTS, DAILY, DAILY_BONUS, WEEKLY, WEEKLY_BONUS,
  achievementById, dayKey, levelFromXp, nextMidnight, nextMonday, progress, titleFor, totalXpFor, viewAchievement, weekStart,
  type AchievementView, type Celebration, type ChallengeDef, type ProgressState,
} from '@/lib/progress';
import { ads } from '@/lib/ads';
import { Button, s, Segmented, useNow } from './kit';
import { C, F, w } from './theme';

export function useProgress(): ProgressState {
  return useSyncExternalStore(progress.subscribe, progress.get, progress.get);
}

/** Icons are emoji for now, behind one component so they can become custom art later. */
export function Icon({ e, size = 22, dim = false }: { e: string; size?: number; dim?: boolean }) {
  return <Text accessibilityElementsHidden importantForAccessibility="no" style={{ fontSize: size, lineHeight: size * 1.2, opacity: dim ? 0.35 : 1 }}>{e}</Text>;
}

const fmt = (n: number) => n.toLocaleString('en-US');
const DONE = '#18B78B';

function Bar({ pct, color = C.primary, h = 6 }: { pct: number; color?: string; h?: number }) {
  return (
    <View style={{ height: h, borderRadius: h / 2, backgroundColor: w(0.1), overflow: 'hidden' }}>
      <View style={{ height: h, borderRadius: h / 2, backgroundColor: color, width: `${Math.round(Math.max(0, Math.min(1, pct)) * 100)}%` }} />
    </View>
  );
}

function resetIn(at: number, now: number) {
  const m = Math.max(1, Math.ceil((at - now) / 60000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${mm}m` : `${mm}m`;
}

// ── Level badge ────────────────────────────────────────────────────────────
/** Each title gets its own mesh color: Rookie (1), 5, 10, 15, 20, 30, 40, 50, 75, 100. */
export const TIER_STARTS = [1, 5, 10, 15, 20, 30, 40, 50, 75, 100];
const tierFor = (level: number) => TIER_STARTS.filter((t) => level >= t).length - 1;
// [base, top-left, top-right, bottom-right, bottom-left, glow]
const TIER_COLORS: [string, string, string, string, string, string][] = [
  ['#3D8BFF', '#9CC8FF', '#5CC8FF', '#1A3FA8', '#2457D6', '#3D8BFF'],
  ['#E5383B', '#FFB3B3', '#FF6B6B', '#7A0F1A', '#B01E2A', '#E5383B'],
  ['#22B573', '#B8F5C8', '#3EE6B8', '#0E6B3E', '#168A50', '#22B573'],
  ['#7B5CFF', '#D2C6FF', '#9D8CFF', '#3A1FA8', '#5634D6', '#7B5CFF'],
  ['#E0479E', '#FFC2E4', '#FF7AC0', '#8A1A5C', '#B42A7C', '#E0479E'],
  ['#FF7A3D', '#FFD2B0', '#FFA060', '#A83A12', '#D6531E', '#FF7A3D'],
  ['#14B8C8', '#A6F4FF', '#3EE6E0', '#0B6E86', '#0E8FA8', '#14B8C8'],
  ['#C08418', '#F2C45A', '#D99A22', '#6E3F05', '#93580B', '#D99A22'],
  ['#161A24', '#5A6478', '#3B2F6B', '#05060A', '#1E3A4F', '#786EC8'],
  ['#2A7FA0', '#C2409A', '#6A4FE0', '#129E86', '#C98A12', '#6A4FE0'],
];
const SPOTS: [string, string, string][] = [['22%', '18%', '55%'], ['85%', '25%', '50%'], ['78%', '88%', '60%'], ['12%', '85%', '55%']];

/** The level circle: a flat circle filled with the title's mesh colors and a white level number. */
export function LevelBadge({ level, size }: { level: number; size: number }) {
  const tier = tierFor(level);
  const col = TIER_COLORS[tier];
  const id = `lb${tier}`;
  return (
    <View accessibilityLabel={`Level ${level}`} style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', borderWidth: tier === 8 ? 1.5 : 0, borderColor: w(0.16) }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          {SPOTS.map(([cx, cy, r], i) => (
            <RadialGradient key={i} id={`${id}-${i}`} cx={cx} cy={cy} r={r} fx={cx} fy={cy}>
              <Stop offset="0" stopColor={col[i + 1]} stopOpacity={1} />
              <Stop offset="1" stopColor={col[i + 1]} stopOpacity={0} />
            </RadialGradient>
          ))}
        </Defs>
        <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={col[0]} />
        {SPOTS.map((_, i) => <Circle key={i} cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#${id}-${i})`} />)}
      </Svg>
      <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={[{ fontFamily: F.display, fontSize: size * (level >= 100 ? 0.34 : 0.4), color: C.white, textShadowColor: 'rgba(0,0,0,0.3)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 }, includeFontPadding: false }, s.tabular]}>{level}</Text>
      </View>
    </View>
  );
}

// ── Level card ─────────────────────────────────────────────────────────────
/** Your level, or another player's when `xp` is given. */
export function LevelCard({ large = false, xp }: { large?: boolean; xp?: number }) {
  const p = useProgress();
  const total = xp ?? p.xp;
  const l = levelFromXp(total);
  const max = l.need === 0;
  return (
    <View style={[s.card, { borderRadius: 24, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
      <LevelBadge level={l.level} size={large ? 64 : 48} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: F.displayBold, fontSize: large ? 20 : 16, color: C.white }}>{l.title}</Text>
          {!max && <Text style={[{ fontFamily: F.bodySemi, fontSize: 12, color: w(0.7) }, s.tabular]}>{fmt(l.into)} / {fmt(l.need)} XP</Text>}
        </View>
        <View style={{ marginTop: 8 }}><Bar pct={max ? 1 : l.into / l.need} h={large ? 8 : 6} /></View>
        <Text style={{ marginTop: 6, fontFamily: F.body, fontSize: 12, color: w(0.7) }}>{max ? `Max level · ${fmt(total)} XP` : `${fmt(l.toNext)} XP to level ${l.level + 1}`}</Text>
      </View>
    </View>
  );
}

// ── Challenges ─────────────────────────────────────────────────────────────
function ChallengeCard({ def, value, done }: { def: ChallengeDef; value: number; done: boolean }) {
  const shown = Math.min(value, def.goal);
  return (
    <View style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18 }, done && { borderColor: 'rgba(62,230,184,0.4)', backgroundColor: 'rgba(62,230,184,0.07)' }]}>
      <View style={{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? 'rgba(62,230,184,0.15)' : w(0.06) }}>
        {done ? <Text style={{ fontFamily: F.bodyBold, fontSize: 22, lineHeight: 26, color: C.mint }}>✓</Text> : <Icon e={def.emoji} size={22} />}
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: F.bodyBold, fontSize: 15, color: done ? w(0.8) : C.white }}>{def.name}</Text>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: done ? C.mint : C.amber }}>+{def.xp} XP</Text>
        </View>
        <Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.7), marginTop: 2 }}>{def.desc}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <View style={{ flex: 1 }}><Bar pct={shown / def.goal} color={done ? C.mint : C.primary} /></View>
          <Text style={[{ fontFamily: F.bodySemi, fontSize: 11, color: w(0.65) }, s.tabular]}>{done ? 'Done' : `${fmt(shown)} / ${fmt(def.goal)}`}</Text>
        </View>
      </View>
    </View>
  );
}

/** A section title (Games, Daily challenges…) with optional text on the right. */
export const SectionHead = ({ title, right }: { title: string; right?: string }) => (
  <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
    <Text style={{ fontFamily: F.displayBold, fontSize: 18, color: C.white }}>{title}</Text>
    {right ? <Text style={[{ fontFamily: F.bodySemi, fontSize: 12, color: w(0.7) }, s.tabular]}>{right}</Text> : null}
  </View>
);

export function DailyChallenges() {
  const p = useProgress();
  const now = useNow(true, 30_000);
  const today = dayKey(new Date(now));
  // A new day: load the new challenges.
  useEffect(() => { void progress.refresh(); }, [today]);
  const set = p.daily;
  const done = set.ids.filter((id) => set.done[id]).length;
  const reset = resetIn(nextMidnight(), now);
  if (set.bonus) {
    return (
      <View>
        <SectionHead title="Daily challenges" />
        <View style={[s.card, { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 18, borderColor: 'rgba(62,230,184,0.4)', backgroundColor: 'rgba(62,230,184,0.07)' }]}>
          <Icon e="🎉" size={28} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.white }}>Daily challenges complete!</Text>
            <Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.7) }}>+{DAILY_BONUS} bonus XP earned</Text>
            <Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.55), marginTop: 2 }}>New challenges in {reset}</Text>
          </View>
        </View>
      </View>
    );
  }
  return (
    <View>
      <SectionHead title="Daily challenges" right={`${done} of 3 completed`} />
      <View style={{ gap: 8, marginTop: 8 }}>
        {set.ids.map((id) => <ChallengeCard key={id} def={DAILY.find((d) => d.id === id)!} value={set.progress[id] ?? 0} done={!!set.done[id]} />)}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingHorizontal: 4 }}>
        <Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.7) }}>Complete all 3 for <Text style={{ fontFamily: F.bodyBold, color: C.amber }}>+{DAILY_BONUS} bonus XP</Text></Text>
        <Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.55) }}>Resets in {reset}</Text>
      </View>
    </View>
  );
}

function WeeklyChallenges() {
  const p = useProgress();
  const now = useNow(true, 60_000);
  const set = p.weekly;
  const done = set.ids.filter((id) => set.done[id]).length;
  return (
    <View>
      <SectionHead title="Weekly challenges" right={`${done} of ${set.ids.length} completed`} />
      <View style={{ gap: 8, marginTop: 8 }}>
        {set.ids.map((id) => <ChallengeCard key={id} def={WEEKLY.find((d) => d.id === id)!} value={set.progress[id] ?? 0} done={!!set.done[id]} />)}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, paddingHorizontal: 4, gap: 8 }}>
        {set.bonus
          ? <Text style={{ flexShrink: 1, fontFamily: F.body, fontSize: 12, color: w(0.7) }}>All completed · <Text style={{ fontFamily: F.bodyBold, color: C.mint }}>+{WEEKLY_BONUS} bonus XP earned</Text></Text>
          : <Text style={{ flexShrink: 1, fontFamily: F.body, fontSize: 12, color: w(0.7) }}>Complete all {set.ids.length} for <Text style={{ fontFamily: F.bodyBold, color: C.amber }}>+{WEEKLY_BONUS} bonus XP</Text></Text>}
        <Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.55) }}>Resets in {resetIn(nextMonday(), now)}</Text>
      </View>
    </View>
  );
}

// ── Streak ─────────────────────────────────────────────────────────────────
/** Your streak, or another player's when `data` is given. */
export function StreakCard({ data }: { data?: { current: number; best: number; days: string[] } }) {
  const mine = useProgress();
  const p = data ? { streak: { current: data.current, best: data.best }, days: data.days, today: '' } : mine;
  const current = p.streak.current;
  const today = p.today || dayKey();
  const [ty, tm, td] = today.split('-').map(Number);
  const monday = weekStart(new Date(ty, tm - 1, td));
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((label, i) => {
    const d = new Date(monday); d.setDate(d.getDate() + i);
    const key = dayKey(d);
    return { label, key, played: p.days.includes(key), today: key === today };
  });
  return (
    <View style={[s.card, { borderRadius: 24, padding: 16 }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View>
          <Text style={s.eyebrow}>Current streak</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
            <Icon e="🔥" size={24} />
            <Text style={[{ fontFamily: F.displayBold, fontSize: 24, color: C.white }, s.tabular]}>{current} {current === 1 ? 'day' : 'days'}</Text>
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={s.eyebrow}>Personal best</Text>
          <Text style={[{ fontFamily: F.displayBold, fontSize: 24, color: C.amber, marginTop: 4 }, s.tabular]}>{p.streak.best} {p.streak.best === 1 ? 'day' : 'days'}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 }}>
        {days.map((d) => (
          <View key={d.key} style={{ alignItems: 'center', gap: 6 }}>
            <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: !d.played && d.today ? 2 : 1, borderColor: !d.played && d.today ? C.primary : w(0.15) }}>
              {d.played && <Text style={{ fontSize: 16, lineHeight: 20 }}>🔥</Text>}
            </View>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: d.today ? C.white : w(0.55) }}>{d.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Achievements ───────────────────────────────────────────────────────────
/** Rounded-square path starting at the top center and running clockwise. */
function ringPath(sz: number, r: number, inset: number) {
  const a = inset, b = sz - inset, rr = r - inset, m = sz / 2;
  return `M ${m} ${a} H ${b - rr} A ${rr} ${rr} 0 0 1 ${b} ${a + rr} V ${b - rr} A ${rr} ${rr} 0 0 1 ${b - rr} ${b} H ${a + rr} A ${rr} ${rr} 0 0 1 ${a} ${b - rr} V ${a + rr} A ${rr} ${rr} 0 0 1 ${a + rr} ${a} Z`;
}

/** Achievement badge whose border is its progress bar: it fills clockwise from the top. */
function Badge({ v, size = 60 }: { v: AchievementView; size?: number }) {
  const sw = Math.max(2.5, size / 20);
  const r = size * 0.3;
  const side = size - sw;
  const rr = r - sw / 2;
  const len = 4 * (side - 2 * rr) + 2 * Math.PI * rr;
  const d = ringPath(size, r, sw / 2);
  return (
    <View style={{ width: size, height: size }}>
      <View style={{ position: 'absolute', top: sw, left: sw, right: sw, bottom: sw, borderRadius: r - sw, alignItems: 'center', justifyContent: 'center',
        backgroundColor: v.unlocked ? 'rgba(24,183,139,0.12)' : w(0.04), shadowColor: DONE, shadowOpacity: v.unlocked ? 0.8 : 0, shadowRadius: 10 }}>
        <Text style={{ fontSize: size * 0.44, opacity: v.unlocked ? 1 : 0.35 }}>{v.def.emoji}</Text>
      </View>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Path d={d} fill="none" stroke={w(0.14)} strokeWidth={sw} />
        {v.pct > 0 && <Path d={d} fill="none" stroke={v.unlocked ? DONE : C.primary} strokeWidth={sw} strokeLinecap="round" strokeDasharray={[v.pct * len, len]} />}
      </Svg>
    </View>
  );
}

/** The same check as "Friends ✓". */
function Check() {
  return <Text style={{ position: 'absolute', right: 10, top: 6, fontFamily: F.bodyBold, fontSize: 18, lineHeight: 22, color: C.mint }}>✓</Text>;
}

function AchievementTile({ v }: { v: AchievementView }) {
  return (
    <View accessibilityLabel={`${v.def.name}, ${v.def.xp} XP${v.unlocked ? ', unlocked' : ''}`} style={[s.card, { width: '48.8%', alignItems: 'center', padding: 12, borderRadius: 18 }]}>
      {v.unlocked && <Check />}
      <Badge v={v} size={60} />
      <Text style={{ marginTop: 8, textAlign: 'center', fontFamily: F.bodyBold, fontSize: 14, lineHeight: 18, color: v.unlocked ? C.white : w(0.7) }}>{v.def.name}</Text>
      <Text style={[{ marginTop: 4, fontFamily: F.bodyBold, fontSize: 12, color: C.amber, opacity: v.unlocked ? 1 : 0.7 }, s.tabular]}>{v.def.xp} XP</Text>
    </View>
  );
}

function AchievementCollection() {
  const p = useProgress();
  const [filter, setFilter] = useState('all');
  const chips = [{ key: 'all', label: 'All' }, ...ACHIEVEMENT_GROUPS];
  const shown = ACHIEVEMENTS.filter((a) => filter === 'all' || a.series === filter);
  const earned = ACHIEVEMENTS.filter((a) => p.unlocked[a.id]).length;
  return (
    <View>
      <SectionHead title="Your achievements" right={`${earned} / ${ACHIEVEMENTS.length} earned`} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -12, marginTop: 12 }} contentContainerStyle={{ paddingHorizontal: 12, gap: 8 }}>
        {chips.map((c) => {
          const on = filter === c.key;
          return (
            <Pressable key={c.key} onPress={() => setFilter(c.key)} accessibilityRole="button" accessibilityState={{ selected: on }}
              style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 999, backgroundColor: on ? C.primary : C.card, borderWidth: 1, borderColor: on ? C.primary : C.cardBorder }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: on ? C.white : w(0.8) }}>{c.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8, marginTop: 12 }}>
        {shown.map((a) => <AchievementTile key={a.id} v={viewAchievement(p, a)} />)}
      </View>
    </View>
  );
}

/** The Rewards tab. */
type RewardsView = 'challenges' | 'achievements';
let rememberedRewards: RewardsView = 'challenges';

export function RewardsTab() {
  useEffect(() => { void progress.refresh(); }, []);
  const [view, setViewState] = useState<RewardsView>(rememberedRewards);
  const setView = (v: RewardsView) => { rememberedRewards = v; setViewState(v); };
  return (
    <View style={{ gap: 24 }}>
      <View style={{ gap: 16 }}>
        <Text style={s.h1}>Rewards</Text>
        <Segmented options={[{ id: 'challenges' as RewardsView, label: 'Challenges' }, { id: 'achievements' as RewardsView, label: 'Achievements' }]} value={view} onChange={setView} />
      </View>
      {view === 'challenges' ? (
        <>
          <DailyChallenges />
          <WeeklyChallenges />
        </>
      ) : <AchievementCollection />}
    </View>
  );
}

// ── After a game ───────────────────────────────────────────────────────────
/** Small "+N XP" chip on result screens (once the server has scored the game). */
export function XpChip({ gameId, align = 'center' }: { gameId: string | null; align?: 'center' | 'start' }) {
  const gained = usePendingXp(gameId);
  if (gained <= 0) return null;
  return (
    <Animated.View entering={ZoomIn.duration(320)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: align === 'start' ? 'flex-start' : 'center', borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,181,71,0.4)', backgroundColor: 'rgba(255,181,71,0.1)', paddingHorizontal: 12, paddingVertical: 4 }}>
      <Text style={{ fontSize: 13 }}>⭐</Text>
      <Text style={[{ fontFamily: F.bodyBold, fontSize: 14, color: C.amber }, s.tabular]}>+{fmt(gained)} XP</Text>
    </Animated.View>
  );
}

/** XP earned in a game (0 until the server has scored it, or for games played offline). */
export function usePendingXp(gameId: string | null) {
  useProgress();
  const xp = progress.xpFor(gameId);
  // The server scores the game as it ends; check quickly until its XP shows up (up to ~10 seconds).
  const waiting = !!gameId && xp <= 0;
  useEffect(() => {
    if (!waiting) return;
    void progress.refresh();
    let tries = 0;
    const t = setInterval(() => { if (++tries > 20) clearInterval(t); else void progress.refresh(); }, 500);
    return () => clearInterval(t);
  }, [waiting, gameId]);
  return xp;
}

/** Closest achievement, shown between rounds. */
export function ProgressHint() {
  const p = useProgress();
  const best = ACHIEVEMENTS.map((a) => viewAchievement(p, a))
    .filter((v) => !v.unlocked && v.value > 0)
    .sort((a, b) => b.pct - a.pct)[0];
  if (!best) return null;
  return (
    <View style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 999, backgroundColor: w(0.06), paddingHorizontal: 12, paddingVertical: 6 }}>
      <Text style={{ fontSize: 13 }}>{best.def.emoji}</Text>
      <Text style={[{ fontFamily: F.bodySemi, fontSize: 12, color: w(0.75) }, s.tabular]}>{best.def.name} · {fmt(best.value)} / {fmt(best.def.goal)}</Text>
    </View>
  );
}

// After a game: one pop-up with any level-up and every achievement unlocked.
let showCelebration: ((c: Celebration, then: () => void) => void) | null = null;

/** Run `action`, first showing the pop-up if the game that just ended raised the level or unlocked achievements. */
/**
 * Leaving a finished game's results: celebrations first, then an interstitial if one is
 * due (every 3 completed games, never for ad-free players), then the action.
 */
export function afterGame(action: () => void) {
  afterCelebration(() => { void ads.maybeShow().finally(action); });
}

export function afterCelebration(action: () => void) {
  void progress.takeCelebration().then((c) => {
    if (c && showCelebration) showCelebration(c, action);
    else action();
  });
}

/** Unlocked achievements, one per page: swipe sideways, with "1 / 8" underneath. */
function AchievementCarousel({ children }: { children: React.ReactNode[] }) {
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(0);
  const count = children.length;
  const onScroll = (x: number) => { if (width) setPage(Math.max(0, Math.min(count - 1, Math.round(x / width)))); };
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} decelerationRate="fast" scrollEventThrottle={32}
          onScroll={(e) => onScroll(e.nativeEvent.contentOffset.x)}>
          {children.map((child, i) => <View key={i} style={{ width }}>{child}</View>)}
        </ScrollView>
      )}
      {count > 1 && (
        <Text accessibilityLabel={`Achievement ${page + 1} of ${count}`} style={[{ marginTop: 10, textAlign: 'center', fontFamily: F.bodySemi, fontSize: 13, color: w(0.7) }, s.tabular]}>
          {page + 1} / {count}
        </Text>
      )}
    </View>
  );
}

export function CelebrationHost() {
  const [state, setState] = useState<{ c: Celebration; then: () => void } | null>(null);
  useEffect(() => { showCelebration = (c, then) => setState({ c, then }); return () => { showCelebration = null; }; }, []);
  const p = useProgress();
  const c = state?.c;
  const levelUp = !!c && c.levelTo > c.levelFrom;
  const items = (c?.achievements ?? []).map((id) => achievementById(id)).filter((a) => !!a);
  const close = () => { const then = state?.then; setState(null); then?.(); };
  return (
    <Modal visible={!!state} transparent animationType="fade" onRequestClose={close}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 48, backgroundColor: 'rgba(0,0,0,0.7)' }}>
        {c && (
          <Animated.View entering={ZoomIn.duration(320)} style={{ width: '100%', maxWidth: 420, maxHeight: '100%', borderRadius: 28, borderWidth: 1, borderColor: w(0.1), backgroundColor: C.ink850, overflow: 'hidden' }}>
            <ScrollView contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 16, paddingTop: 28, paddingBottom: 8 }}>
              <Text style={{ fontFamily: F.displayBold, fontSize: 24, color: C.white, textAlign: 'center' }}>{levelUp ? 'Level up! 🎉' : 'Achievements unlocked! 🏅'}</Text>
              {levelUp && (
                <>
                  <View style={{ marginTop: 20 }}><LevelBadge level={c.levelTo} size={80} /></View>
                  <Text style={{ marginTop: 14, fontFamily: F.displayBold, fontSize: 18, color: C.white }}>Level {c.levelTo} reached</Text>
                  <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.7) }}>{titleFor(c.levelTo)}</Text>
                </>
              )}
              {items.length > 0 && (
                <View style={{ alignSelf: 'stretch', marginTop: levelUp ? 24 : 12 }}>
                  {levelUp && <Text style={[s.eyebrow, { marginBottom: 8 }]}>{items.length === 1 ? 'Achievement unlocked' : `${items.length} achievements unlocked`}</Text>}
                  {!levelUp && <Text style={{ textAlign: 'center', fontFamily: F.body, fontSize: 14, color: w(0.7), marginBottom: 12 }}>{items.length === 1 ? '1 new achievement earned' : `${items.length} new achievements earned`}</Text>}
                  <AchievementCarousel>
                    {items.map((a) => (
                      <View key={a.id} style={[s.card, { alignItems: 'center', gap: 6, paddingVertical: 20, paddingHorizontal: 16, borderRadius: 20 }]}>
                        <Badge v={viewAchievement(p, a)} size={72} />
                        <Text style={{ marginTop: 6, fontFamily: F.bodyBold, fontSize: 16, color: C.white, textAlign: 'center' }}>{a.name}</Text>
                        <Text style={{ marginTop: 2, fontFamily: F.bodyBold, fontSize: 14, color: C.amber }}>+{a.xp} XP</Text>
                      </View>
                    ))}
                  </AchievementCarousel>
                </View>
              )}
            </ScrollView>
            <View style={{ padding: 16, paddingTop: 12 }}><Button title="Continue" onPress={close} /></View>
          </Animated.View>
        )}
      </View>
    </Modal>
  );
}

// ── How leveling works ─────────────────────────────────────────────────────
export function LevelingGuide() {
  const sources: [string, string][] = [
    ['Finish an elimination match', '+25 XP'], ['Win an elimination match', '+100 XP bonus'], ['Finish a solo challenge', '+15 XP'],
    ['Daily challenges', '+50 to +125 XP each'], ['All 3 daily challenges', '+150 XP bonus'], ['Weekly challenges', '+200 to +300 XP each'],
    ['All weekly challenges', '+500 XP bonus'], ['Achievements', '+100 to +500 XP each'],
  ];
  return (
    <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator={false}>
      <Text style={[s.body, { fontSize: 14 }]}>Earn XP every time you play. Each level takes 100 XP more than the one before it, up to level 100.</Text>
      <Text style={[s.eyebrow, { marginTop: 16, marginBottom: 8 }]}>Ways to earn XP</Text>
      <View style={{ borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, overflow: 'hidden' }}>
        {sources.map(([what, xp], i) => (
          <View key={what} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: i < sources.length - 1 ? 1 : 0, borderBottomColor: C.divider }}>
            <Text style={{ flexShrink: 1, fontFamily: F.body, fontSize: 14, color: w(0.85) }}>{what}</Text>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.amber }}>{xp}</Text>
          </View>
        ))}
      </View>
      <Text style={[s.eyebrow, { marginTop: 20, marginBottom: 8 }]}>Titles</Text>
      <View style={{ gap: 8, paddingBottom: 8 }}>
        {TIER_STARTS.map((lvl) => (
          <View key={lvl} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18 }]}>
            <LevelBadge level={lvl} size={48} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.displayBold, fontSize: 16, color: C.white }}>{titleFor(lvl)}</Text>
              <Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.65) }}>Level {lvl}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={[{ fontFamily: F.bodyBold, fontSize: 14, color: C.white }, s.tabular]}>{lvl === 1 ? 'Start' : `${fmt(totalXpFor(lvl))} XP`}</Text>
              {lvl > 1 && <Text style={{ fontFamily: F.body, fontSize: 11, color: w(0.55) }}>total</Text>}
            </View>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ── Elimination match card border ──────────────────────────────────────────
// Same look as the web version: a color sweep (blue → sky → white → mint)
// turns slowly behind the card and only shows through the 2px border ring.
const SWEEP_STOPS: [number, [number, number, number, number]][] = [
  [0, [61, 139, 255, 0.45]], [200, [61, 139, 255, 0.45]], [270, [92, 200, 255, 1]],
  [312, [255, 255, 255, 1]], [334, [62, 230, 184, 1]], [360, [61, 139, 255, 0.45]],
];
function sweepColor(deg: number) {
  for (let i = 1; i < SWEEP_STOPS.length; i++) {
    const [a, ca] = SWEEP_STOPS[i - 1];
    const [b, cb] = SWEEP_STOPS[i];
    if (deg <= b) {
      const k = (deg - a) / (b - a);
      const m = (x: number, y: number) => x + (y - x) * k;
      return `rgba(${Math.round(m(ca[0], cb[0]))},${Math.round(m(ca[1], cb[1]))},${Math.round(m(ca[2], cb[2]))},${m(ca[3], cb[3]).toFixed(3)})`;
    }
  }
  return 'rgba(61,139,255,0.45)';
}

/** A conic gradient drawn as thin wedges (SVG has no conic gradient). */
function ConicDisc({ size }: { size: number }) {
  const r = size / 2;
  const n = 120;
  const wedges = Array.from({ length: n }, (_, i) => {
    const a0 = (i / n) * 2 * Math.PI - Math.PI / 2;
    const a1 = ((i + 1.15) / n) * 2 * Math.PI - Math.PI / 2; // slight overlap hides seams
    const p = (a: number) => `${r + r * Math.cos(a)} ${r + r * Math.sin(a)}`;
    return { d: `M ${r} ${r} L ${p(a0)} A ${r} ${r} 0 0 1 ${p(a1)} Z`, fill: sweepColor(((i + 0.5) / n) * 360) };
  });
  return (
    <Svg width={size} height={size}>
      {wedges.map((x, i) => <Path key={i} d={x.d} fill={x.fill} />)}
    </Svg>
  );
}

const ConicMemo = React.memo(ConicDisc);
// The package's class typings predate React 19's JSX types; the component itself works as usual.
const MaskedView = MaskedViewBase as unknown as React.ComponentType<{ style?: StyleProp<ViewStyle>; maskElement: React.ReactElement; children?: React.ReactNode }>;

export function SweepBorder({ radius = 24, width = 2 }: { radius?: number; width?: number }) {
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  const reduce = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    t.set(withRepeat(withTiming(1, { duration: 4500, easing: Easing.linear }), -1, false));
  }, [reduce, t]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${t.value * 360}deg` }] }));
  const onLayout = (e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });
  const disc = box ? Math.ceil(Math.hypot(box.w, box.h)) + 4 : 0;
  const ring = box
    ? `${roundedRect(0, 0, box.w, box.h, radius)} ${roundedRect(width, width, box.w - width * 2, box.h - width * 2, radius - width)}`
    : '';
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} onLayout={onLayout}>
      {box && (
        <MaskedView style={StyleSheet.absoluteFill} maskElement={
          <Svg width={box.w} height={box.h}><Path d={ring} fill="#000" fillRule="evenodd" /></Svg>
        }>
          <Animated.View style={[{ position: 'absolute', width: disc, height: disc, left: (box.w - disc) / 2, top: (box.h - disc) / 2 }, spin]}>
            <ConicMemo size={disc} />
          </Animated.View>
        </MaskedView>
      )}
    </View>
  );
}

function roundedRect(x: number, y: number, wd: number, ht: number, r: number) {
  return `M ${x + r} ${y} H ${x + wd - r} A ${r} ${r} 0 0 1 ${x + wd} ${y + r} V ${y + ht - r} A ${r} ${r} 0 0 1 ${x + wd - r} ${y + ht} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + ht - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`;
}
