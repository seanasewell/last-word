import * as Haptics from 'expo-haptics';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withDelay, withTiming, ZoomIn } from 'react-native-reanimated';

import { engine, HUMAN_ID, TOTAL_ROUNDS, type GameState } from '@/lib/engine';
import type { Player } from '@/lib/players';
import { Avatar, Button, Card, FadeUp, ordinal, s, Screen, Stat, Tile, useAnimatedNumber, useCountdown, BotBadge, isBot } from './kit';
import { PlayerActions, type PlayerRef } from './PlayerActions';
import { sfx } from './sound';
import { C, F, w } from './theme';

function PageScroll({ children, gold = false }: { children: React.ReactNode; gold?: boolean }) {
  return (
    <Screen gold={gold}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 }}>{children}</ScrollView>
    </Screen>
  );
}

/** Tap a real player (not a bot, not you) in an online match to report or block them. */
function usePlayerActions() {
  const [acting, setActing] = useState<PlayerRef | null>(null);
  const actOn = (p: Player) => (p.controller === 'remote'
    ? () => setActing({ name: p.name, glyph: p.glyph, hue: p.hue, photo: p.photo, target: { matchPlayerId: p.id } })
    : undefined);
  return { actOn, sheet: <PlayerActions player={acting} onClose={() => setActing(null)} /> };
}

const Row = ({ p, right, sub, highlight, out, rank, onPress }: { p: Player; right: React.ReactNode; sub?: string; highlight?: 'you' | 'gold'; out?: boolean; rank?: string; onPress?: () => void }) => (
  <Pressable onPress={onPress} disabled={!onPress} accessibilityHint={onPress ? 'Report or block this player' : undefined} style={{
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14,
    backgroundColor: out ? 'rgba(255,93,115,0.08)' : highlight === 'gold' ? 'rgba(255,181,71,0.12)' : highlight === 'you' ? 'rgba(61,139,255,0.14)' : w(0.03),
    borderWidth: highlight === 'gold' ? 1 : 0, borderColor: 'rgba(255,181,71,0.3)',
  }}>
    {rank != null && <Text style={{ width: 30, fontFamily: F.displayBold, fontSize: 14, color: out ? C.coral : rank === '1st' ? C.amber : w(0.65) }}>{rank}</Text>}
    <Avatar player={p} size={30} dim={out} />
    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: F.bodyBold, fontSize: 15, color: out ? w(0.6) : w(0.92), textDecorationLine: out ? 'line-through' : 'none' }}>{p.name}</Text>
      {isBot(p) && <BotBadge />}
    </View>
    {sub && <Text style={{ fontFamily: F.body, fontSize: 11, color: w(0.6) }}>{sub}</Text>}
    {right}
  </Pressable>
);

const num = (n: number | string, color = C.white) => <Text style={[{ fontFamily: F.display, fontSize: 16, color, minWidth: 44, textAlign: 'right' }, s.tabular]}>{n}</Text>;

// ── 3-2-1 countdown ────────────────────────────────────────────────────────
/** A big number that counts down to `endsAt`: full white, with a quick, smooth pop on each second. */
function BigCountdown({ endsAt, title, sub = 'Get your fingers ready' }: { endsAt: number; title: string; sub?: string }) {
  const count = Math.max(1, useCountdown(endsAt));
  const scale = useSharedValue(1);
  useEffect(() => {
    scale.set(1.35);
    scale.set(withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }));
    Haptics.selectionAsync().catch(() => {});
    sfx.tick();
  }, [count, scale]);
  const pop = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={[s.eyebrow, { fontSize: 13, letterSpacing: 2.4 }]}>{title}</Text>
      <Animated.Text accessibilityLabel={`${count}`} style={[{ fontFamily: F.display, fontSize: 120, color: C.white, opacity: 1 }, s.tabular, pop]}>{count}</Animated.Text>
      <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.8) }}>{sub}</Text>
    </View>
  );
}

// ── Solo challenge countdown ───────────────────────────────────────────────
export function SoloCountdown({ s: g }: { s: GameState }) {
  return (
    <Screen>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 40 }}>
        <BigCountdown endsAt={g.prematchEndsAt} title="Solo challenge" sub="60 seconds · find as many words as you can" />
      </View>
      <Button title="Cancel" variant="ghost" onPress={() => engine.goMenu()} />
    </Screen>
  );
}

// ── Lobby + pre-match countdown ────────────────────────────────────────────
export function Lobby({ s: g }: { s: GameState }) {
  const filled = g.lobbyFilled;
  const full = filled >= 6;
  // Each new player joining the lobby gets a small pop.
  useEffect(() => {
    if (filled > 1) {
      sfx.join();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }, [filled]);
  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {['LAST', 'WORD'].map((wd) => <View key={wd} style={{ flexDirection: 'row', gap: 2 }}>{wd.split('').map((c, i) => <Tile key={i} ch={c} size={18} animate={false} />)}</View>)}
          </View>
          <Pressable onPress={() => engine.goMenu()} hitSlop={10}><Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: w(0.72) }}>Leave</Text></Pressable>
        </View>
        <Text style={[s.eyebrow, { marginTop: 28 }]}>Match {g.matchId}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 4 }}>
          <Text style={s.h1}>{full ? 'Match found' : 'Finding players'}</Text>
          <Text style={[{ fontFamily: F.display, fontSize: 20 }, s.tabular]}>
            <Text style={{ color: full ? C.mint : C.primary }}>{filled}</Text><Text style={{ color: w(0.5) }}>/6 players</Text>
          </Text>
        </View>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: w(0.06), marginTop: 12, overflow: 'hidden' }}>
          <View style={{ height: 6, width: `${(filled / 6) * 100}%`, backgroundColor: full ? C.mint : C.primary, borderRadius: 3 }} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 22 }}>
          {g.players.map((p, i) => {
            const joined = i < filled;
            return (
              <Card key={p.id} style={{ width: '48%', flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderColor: p.id === HUMAN_ID ? C.primary : C.cardBorder }}>
                {joined ? (
                  <Animated.View entering={ZoomIn.duration(280)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <Avatar player={p} size={40} />
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: F.bodyBold, fontSize: 14, color: C.white }}>{p.name}</Text>
                        {isBot(p) && <BotBadge />}
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.mint }} />
                        <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: C.mint }}>Ready</Text>
                      </View>
                    </View>
                  </Animated.View>
                ) : (
                  <>
                    <View style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 2, borderStyle: 'dashed', borderColor: w(0.15) }} />
                    <Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.6) }}>Waiting…</Text>
                  </>
                )}
              </Card>
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 22 }}>
          {[['5', 'rounds'], ['60s', 'per round'], ['1', 'out each round']].map(([a, b]) => (
            <View key={b} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 16, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder }}>
              <Text style={{ fontFamily: F.display, fontSize: 20, color: C.white }}>{a}</Text>
              <Text style={{ fontFamily: F.body, fontSize: 11, color: w(0.7) }}>{b}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
      {g.phase === 'prematch' && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(4,10,22,0.88)', alignItems: 'center', justifyContent: 'center' }]}>
          <BigCountdown endsAt={g.prematchEndsAt} title="Round 1 starts in" />
        </View>
      )}
    </Screen>
  );
}

// ── Between rounds ─────────────────────────────────────────────────────────
export function EliminationScreen({ s: g }: { s: GameState }) {
  const { actOn, sheet } = usePlayerActions();
  const e = g.lastElimination!;
  const byId = new Map(g.players.map((p) => [p.id, p]));
  const out = byId.get(e.playerId)!;
  const me = byId.get(HUMAN_ID)!;
  const secs = useCountdown(g.nextRoundAt, g.nextRoundAt > 0);
  const tickPop = useSharedValue(1);
  useEffect(() => {
    if (secs <= 0) return;
    tickPop.set(1.18);
    tickPop.set(withTiming(1, { duration: 260, easing: Easing.out(Easing.cubic) }));
  }, [secs, tickPop]);
  const tickStyle = useAnimatedStyle(() => ({ transform: [{ scale: tickPop.value }] }));
  const nextRound = e.round + 1;
  const youOut = e.playerId === HUMAN_ID && g.awaitingChoice;

  useEffect(() => {
    if (e.playerId === HUMAN_ID) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      sfx.eliminated();
    } else if (me.status === 'active') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      sfx.survive();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g.matchId, e.round]);

  if (youOut) {
    const remaining = g.players.filter((p) => p.status === 'active');
    return (
      <PageScroll>
        <View style={{ alignItems: 'center', paddingTop: 24 }}>
          <Avatar player={me} size={84} dim />
          <Text style={[s.h1, { fontSize: 34, textAlign: 'center', marginTop: 18 }]}>{"You've been eliminated"}</Text>
          <Text style={{ marginTop: 10 }}>
            <Text style={{ fontFamily: F.display, fontSize: 36, color: C.coral }}>{ordinal(me.placement!)}</Text>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 18, color: w(0.7) }}>  of 6</Text>
          </Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 22 }}>
          <Stat label="Match score" value={me.totalScore} color={C.amber} />
          <Stat label="Words" value={me.stats.wordsFound} />
        </View>
        <View style={{ marginTop: 8, flexDirection: 'row' }}>
          <Stat label="Longest word" value={me.stats.longestWord ? me.stats.longestWord.toUpperCase() : '—'} />
        </View>
        <Text style={[s.eyebrow, { marginTop: 22, marginBottom: 8 }]}>Still in · {remaining.length} players</Text>
        <View style={{ gap: 6 }}>
          {remaining.map((p) => <Row key={p.id} p={p} onPress={actOn(p)} right={<Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.65) }}>{p.totalScore} total</Text>} />)}
        </View>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 'auto', paddingTop: 24 }}>
          <Button title="Back to lobby" variant="ghost" style={{ flex: 1 }} onPress={() => engine.goMenu()} />
          <Button title="Play again" style={{ flex: 1 }} onPress={() => engine.startMatch()} />
        </View>
        {sheet}
      </PageScroll>
    );
  }

  return (
    <PageScroll gold={nextRound === TOTAL_ROUNDS}>
      <Text style={[s.eyebrow, { textAlign: 'center' }]}>Round {e.round} results</Text>
      <View style={{ alignItems: 'center', marginTop: 18 }}>
        <Avatar player={out} size={72} dim />
        <Text style={{ marginTop: 14, fontFamily: F.bodyBold, fontSize: 13, letterSpacing: 2.6, textTransform: 'uppercase', color: C.coral }}>Eliminated</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 }}>
          <Text style={s.h1}>{out.name}</Text>
          {isBot(out) && <BotBadge size="lg" />}
        </View>
      </View>
      <View style={{ marginTop: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, backgroundColor: C.card, paddingHorizontal: 16, paddingVertical: 12 }}>
        <Text style={{ fontFamily: F.displayBold, fontSize: 18, color: C.white }}>{nextRound === TOTAL_ROUNDS ? 'Championship round' : `Round ${nextRound}`}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.7) }}>starts in</Text>
          <View style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: 'rgba(61,139,255,0.55)', alignItems: 'center', justifyContent: 'center' }}>
            <Animated.Text style={[{ fontFamily: F.display, fontSize: 20, color: C.white }, s.tabular, tickStyle]}>{secs}</Animated.Text>
          </View>
        </View>
      </View>
      <View style={{ gap: 6, marginTop: 16 }}>
        {e.standings.map((row, i) => {
          const p = byId.get(row.id)!;
          return <Row key={row.id} p={p} rank={String(i + 1)} out={row.id === e.playerId} highlight={p.id === HUMAN_ID ? 'you' : undefined} right={num(row.roundScore)} onPress={actOn(p)} />;
        })}
      </View>
      {sheet}
    </PageScroll>
  );
}

// ── Confetti ───────────────────────────────────────────────────────────────
interface PieceSpec { x: number; w: number; h: number; round: boolean; color: string; dur: number; delay: number; drift: number; spin: number }

function Piece({ p, fall }: { p: PieceSpec; fall: number }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.set(withDelay(p.delay, withTiming(1, { duration: p.dur, easing: Easing.linear })));
  }, [p, v]);
  const st = useAnimatedStyle(() => ({
    opacity: interpolate(v.value, [0, 0.05, 1], [0, 1, 0.9]),
    transform: [
      { translateY: v.value * fall },
      { translateX: v.value * p.drift },
      { rotate: `${v.value * 360 * p.spin}deg` },
    ],
  }));
  return <Animated.View style={[{ position: 'absolute', left: p.x, top: -20, width: p.w, height: p.round ? p.w : p.h, borderRadius: p.round ? p.w : 2, backgroundColor: p.color }, st]} />;
}

function Confetti({ big }: { big: boolean }) {
  const { width, height } = useWindowDimensions();
  const pieces = useMemo<PieceSpec[]>(() => {
    const colors = [C.amber, C.primary, C.mint, C.coral, C.sky, '#FFFFFF'];
    return Array.from({ length: big ? 140 : 24 }, (_, i) => {
      const r = (n: number) => { const x = Math.sin(i * 9301 + n * 49297) * 233280; return x - Math.floor(x); };
      return {
        x: r(1) * width, w: 5 + r(2) * 6, h: 8 + r(3) * 10, round: r(4) < 0.25, color: colors[Math.floor(r(5) * colors.length)],
        dur: (big ? 2800 : 3200) + r(6) * 3000, delay: big ? Math.floor(r(7) * 3) * 550 + r(8) * 500 : (i % 7) * 180,
        drift: (r(9) - 0.5) * 160, spin: 1 + r(10) * 2,
      };
    });
  }, [big, width]);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden', zIndex: 30 }]}>
      {pieces.map((p, i) => <Piece key={i} p={p} fall={height + 40} />)}
    </View>
  );
}

// ── Winner + final standings ───────────────────────────────────────────────
export function FinalResults({ s: g }: { s: GameState }) {
  const { actOn, sheet } = usePlayerActions();
  const byId = new Map(g.players.map((p) => [p.id, p]));
  const winner = byId.get(g.winnerId!)!;
  const me = byId.get(HUMAN_ID)!;
  const youWon = winner.id === HUMAN_ID;
  const placed = g.players.slice().sort((a, b) => (a.placement ?? 9) - (b.placement ?? 9));
  const total = useAnimatedNumber(winner.totalScore, 1200);
  useEffect(() => {
    if (youWon) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      sfx.win();
    }
  }, [youWon, g.matchId]);
  return (
    <View style={{ flex: 1 }}>
      <PageScroll gold>
        <FadeUp style={{ alignItems: 'center', paddingTop: 20 }}>
          <Text style={{ fontSize: 32, marginBottom: -6, zIndex: 2 }}>👑</Text>
          <Avatar player={winner} size={104} ring />
          <Text style={[s.h1, { fontSize: 34, textAlign: 'center', marginTop: 18 }]}>{youWon ? 'You have the last word 🎉' : `${winner.name} wins the match`}</Text>
          {!youWon && isBot(winner) && <View style={{ marginTop: 8 }}><BotBadge size="lg" /></View>}
          {youWon && <Text style={[s.body, { marginTop: 4 }]}>Five rounds, five survivals. Champion.</Text>}
        </FadeUp>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 22 }}>
          <Stat label="Match score" value={total} color={C.amber} />
          <Stat label="Words discovered" value={winner.stats.wordsFound} />
        </View>
        <View style={{ marginTop: 8, flexDirection: 'row' }}>
          <Stat label="Longest word" value={winner.stats.longestWord ? winner.stats.longestWord.toUpperCase() : '—'} />
        </View>
        {!youWon && (
          <View style={{ marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(61,139,255,0.35)', backgroundColor: 'rgba(61,139,255,0.1)', padding: 14 }}>
            <Avatar player={me} size={36} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.white }}>Your results</Text>
              <Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.72) }}>{ordinal(me.placement ?? 0)} place · {me.stats.wordsFound} words · longest {me.stats.longestWord ? me.stats.longestWord.toUpperCase() : '—'}</Text>
            </View>
            <Text style={[{ fontFamily: F.display, fontSize: 22, color: C.amber }, s.tabular]}>{me.totalScore}</Text>
          </View>
        )}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 20, marginBottom: 8, paddingHorizontal: 4 }}>
          <Text style={s.eyebrow}>Final standings</Text><Text style={s.eyebrow}>Match score</Text>
        </View>
        <View style={{ gap: 6 }}>
          {placed.map((p) => (
            <Row key={p.id} p={p} rank={ordinal(p.placement ?? 0)} highlight={p.id === winner.id ? 'gold' : p.id === HUMAN_ID ? 'you' : undefined}
              sub={p.placement === 1 ? 'Winner' : `Out round ${p.eliminatedInRound}`} right={num(p.totalScore)} onPress={actOn(p)} />
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 'auto', paddingTop: 24 }}>
          <Button title="Back to lobby" variant="ghost" style={{ flex: 1 }} onPress={() => engine.goMenu()} />
          <Button title="Play again" variant="gold" style={{ flex: 1 }} onPress={() => engine.startMatch()} />
        </View>
        {sheet}
      </PageScroll>
      <Confetti big={youWon} />
    </View>
  );
}

// ── Solo results ───────────────────────────────────────────────────────────
export function SoloResults({ s: g }: { s: GameState }) {
  const me = g.players[0];
  const score = useAnimatedNumber(me.roundScore, 1100);
  return (
    <PageScroll>
      <FadeUp style={{ alignItems: 'center', paddingTop: 16 }}>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: w(0.7) }}>{`Time's up · ${g.source}`}</Text>
        <Text style={[{ fontFamily: F.display, fontSize: 72, color: C.amber }, s.tabular]}>{score}</Text>
        {g.newBest ? (
          <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.mint, backgroundColor: 'rgba(62,230,184,0.15)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, overflow: 'hidden' }}>New personal best</Text>
        ) : (
          <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.7) }}>Personal best <Text style={{ fontFamily: F.bodyBold, color: C.white }}>{g.personalBest}</Text></Text>
        )}
      </FadeUp>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 22 }}>
        <Stat label="Words found" value={`${me.roundWords.length} / ${g.possibleWords}`} />
        <Stat label="Personal best" value={g.personalBest} color={C.amber} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <Stat label="Longest word" value={me.stats.longestWord ? me.stats.longestWord.toUpperCase() : '—'} />
        <Stat label="Highest scoring" value={me.stats.bestWord ? `${me.stats.bestWord.word.toUpperCase()} +${me.stats.bestWord.points}` : '—'} />
      </View>
      <Text style={[s.eyebrow, { marginTop: 22, marginBottom: 8 }]}>All your words</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {me.roundWords.length === 0 && <Text style={{ fontFamily: F.body, color: w(0.65) }}>No words this time.</Text>}
        {me.roundWords.slice().reverse().map((x) => (
          <Text key={x.word} style={{ fontFamily: F.displayBold, fontSize: 14, color: C.white, backgroundColor: w(0.05), paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, overflow: 'hidden' }}>
            {x.word.toUpperCase()} <Text style={{ fontFamily: F.body, color: w(0.65) }}>+{x.points}</Text>
          </Text>
        ))}
      </View>
      {g.missedLongest.length > 0 && (
        <>
          <Text style={[s.eyebrow, { marginTop: 18, marginBottom: 8 }]}>Long ones you missed</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {g.missedLongest.map((x) => (
              <Text key={x} style={{ fontFamily: F.displayBold, fontSize: 14, color: w(0.72), borderWidth: 1, borderColor: w(0.12), paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12 }}>{x.toUpperCase()}</Text>
            ))}
          </View>
        </>
      )}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 'auto', paddingTop: 24 }}>
        <Button title="Main menu" variant="ghost" style={{ flex: 1 }} onPress={() => engine.goMenu()} />
        <Button title="Play again" style={{ flex: 1 }} onPress={() => engine.startSingle()} />
      </View>
    </PageScroll>
  );
}
