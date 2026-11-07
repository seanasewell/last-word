import * as Haptics from 'expo-haptics';
import React, { memo, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View, type TextInputInstance } from 'react-native';
import Animated, { cancelAnimation, Easing, interpolate, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { engine, HUMAN_ID, TOTAL_ROUNDS, type GameState } from '@/lib/engine';
import { rankByRound, type Player, type WordEntry } from '@/lib/players';
import { REJECTION_TEXT } from '@/lib/words';
import { sfx } from './sound';
import { Avatar, Card, ordinal, s, Screen, Tile, useAnimatedNumber, useNow, BotBadge, isBot } from './kit';
import { C, F, w } from './theme';

const haptic = {
  ok: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {}); },
  bad: () => { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {}); },
};

// ── Header ─────────────────────────────────────────────────────────────────
function Timer({ endsAt, total, final }: { endsAt: number; total: number; final: boolean }) {
  const now = useNow(true, 200);
  const ms = Math.max(0, endsAt - now);
  const secs = Math.ceil(ms / 1000);
  const urgent = secs <= 10 && secs > 0;
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (urgent) pulse.set(withRepeat(withSequence(withTiming(1.1, { duration: 300 }), withTiming(1, { duration: 700 })), -1));
    else { cancelAnimation(pulse); pulse.set(1); }
  }, [urgent, pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  // Last five seconds: a tick and a tap each second.
  useEffect(() => {
    if (secs > 0 && secs <= 5) {
      sfx.tick();
      Haptics.selectionAsync().catch(() => {});
    }
  }, [secs]);
  const color = urgent ? C.coral : final ? C.amber : C.mint;
  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      <Animated.Text accessibilityLabel={`${secs} seconds left`} style={[{ fontFamily: F.display, fontSize: 26, color: urgent ? C.coral : C.white }, s.tabular, pulseStyle]}>
        {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')}
      </Animated.Text>
      <View style={{ width: 92, height: 4, borderRadius: 2, backgroundColor: w(0.1), overflow: 'hidden' }}>
        <View style={{ width: `${(ms / total) * 100}%`, height: 4, backgroundColor: color, borderRadius: 2 }} />
      </View>
    </View>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const shown = useAnimatedNumber(score);
  const bump = useSharedValue(1);
  const prev = useRef(score);
  useEffect(() => {
    if (score > prev.current) bump.set(withSequence(withTiming(1.22, { duration: 80 }), withSpring(1, { damping: 7 })));
    prev.current = score;
  }, [score, bump]);
  const bumpStyle = useAnimatedStyle(() => ({ transform: [{ scale: bump.value }] }));
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <Text style={s.eyebrow}>Score</Text>
      <Animated.Text style={[{ fontFamily: F.display, fontSize: 24, color: C.amber }, s.tabular, bumpStyle]}>{shown}</Animated.Text>
    </View>
  );
}

// ── Source ─────────────────────────────────────────────────────────────────
const SourceTiles = memo(function SourceTiles({ source, final }: { source: string; final: boolean }) {
  const { width } = useWindowDimensions();
  const words = source.toUpperCase().split(/\s+/);
  const longest = Math.max(...words.map((x) => x.length), 6);
  const size = Math.min(44, Math.floor((Math.min(width, 480) - 32) / longest - 4));
  let i = 0;
  return (
    <View accessibilityLabel={`Source: ${source}`} style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 12, rowGap: 6, paddingHorizontal: 12 }}>
      {words.map((word, wi) => (
        <View key={wi} style={{ flexDirection: 'row', gap: 4 }}>
          {word.split('').map((ch) => {
            const d = i++;
            return <Tile key={d} ch={ch} size={size} gold={final} delay={d * 35} />;
          })}
        </View>
      ))}
    </View>
  );
});

// ── Word entry ─────────────────────────────────────────────────────────────
function Floater({ text, onDone }: { text: string; onDone: () => void }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.set(withTiming(1, { duration: 950, easing: Easing.out(Easing.quad) }, (finished) => {
      if (finished) scheduleOnRN(onDone);
    }));
  }, [v, onDone]);
  const st = useAnimatedStyle(() => ({
    opacity: interpolate(v.value, [0, 0.15, 1], [0, 1, 0]),
    transform: [{ translateY: interpolate(v.value, [0, 1], [6, -46]) }],
  }));
  return <Animated.Text style={[{ position: 'absolute', right: 12, top: -6, fontFamily: F.display, fontSize: 24, color: C.amber }, st]}>{text}</Animated.Text>;
}

function WordInput({ final }: { final: boolean }) {
  const [value, setValue] = useState('');
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'bad' | 'mixed'; id: number } | null>(null);
  const [ghost, setGhost] = useState<{ text: string; id: number } | null>(null);
  const [floaters, setFloaters] = useState<{ id: number; text: string }[]>([]);
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<TextInputInstance>(null);
  const shake = useSharedValue(0);
  const ghostFade = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));
  const ghostStyle = useAnimatedStyle(() => ({ opacity: ghostFade.value }));
  const seq = useRef(0);

  // Fresh state each round (the parent re-keys this component); just grab focus.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg((m) => (m && m.id === msg.id ? null : m)), msg.tone === 'ok' ? 1100 : 2400);
    return () => clearTimeout(t);
  }, [msg]);

  const submit = () => {
    // One word at a time.
    const raw = value.trim();
    if (!raw) return;
    const id = ++seq.current;
    const r = engine.submit(HUMAN_ID, raw);
    setValue(''); // always clear; a rejected word flashes red and fades
    if (r.ok) {
      haptic.ok();
      sfx.word(r.word.length);
      setFloaters((f) => [...f.slice(-3), { id, text: `+${r.points}` }]);
      setMsg({ tone: 'ok', id, text: `${r.word.toUpperCase()}  +${r.points}` });
      return;
    }
    haptic.bad();
    sfx.wrong();
    setGhost({ id, text: raw });
    ghostFade.set(1);
    ghostFade.set(withDelay(250, withTiming(0, { duration: 700 })));
    setMsg({ tone: 'bad', id, text: REJECTION_TEXT[r.reason] });
    shake.set(withSequence(...[-6, 6, -5, 4, 0].map((x) => withTiming(x, { duration: 60 }))));
  };

  const border = ghost && !value ? 'rgba(255,93,115,0.7)' : focused ? (final ? 'rgba(255,181,71,0.7)' : C.primary) : C.cardBorder;
  return (
    <View style={{ paddingHorizontal: 12 }}>
      <Animated.View style={shakeStyle}>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={(t) => { setValue(t.replace(/[^a-zA-Z]/g, '').slice(0, 40)); if (ghost) setGhost(null); }}
          onSubmitEditing={submit}
          submitBehavior="submit"
          returnKeyType="go"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          textContentType="none"
          keyboardAppearance="dark"
          placeholder={ghost ? '' : 'Type a word'}
          placeholderTextColor={w(0.45)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          accessibilityLabel="Word entry"
          style={{ height: 56, borderRadius: 18, borderWidth: 1.5, borderColor: border, backgroundColor: 'rgba(4,10,22,0.7)', paddingHorizontal: 16, color: C.white, fontFamily: F.display, fontSize: 20, letterSpacing: 2, textTransform: 'uppercase' }}
        />
        {ghost && !value && (
          <Animated.Text pointerEvents="none" numberOfLines={1}
            style={[{ position: 'absolute', left: 17, right: 16, top: 15, fontFamily: F.display, fontSize: 20, letterSpacing: 2, color: C.coral }, ghostStyle]}>
            {ghost.text.toUpperCase()}
          </Animated.Text>
        )}
        {floaters.map((f) => (
          <Floater key={f.id} text={f.text} onDone={() => setFloaters((x) => x.filter((y) => y.id !== f.id))} />
        ))}
      </Animated.View>
      <View style={{ height: 26, alignItems: 'center', justifyContent: 'center' }} accessibilityLiveRegion="polite">
        {msg && (
          <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: msg.tone === 'ok' ? C.mint : msg.tone === 'mixed' ? C.amber : C.coral }} numberOfLines={1}>{msg.text}</Text>
        )}
      </View>
    </View>
  );
}

// ── Leaderboard ────────────────────────────────────────────────────────────
const ROW = 54;

function LeaderRow({ p, rank, last, showDanger }: { p: Player; rank: number; last: boolean; showDanger: boolean }) {
  const isYou = p.id === HUMAN_ID;
  const y = useSharedValue(rank * ROW);
  useEffect(() => {
    y.set(withSpring(rank * ROW, { damping: 18, stiffness: 140 }));
  }, [rank, y]);
  const slide = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const prev = useRef(p.roundScore);
  const [gain, setGain] = useState<{ n: number; k: number } | null>(null);
  useEffect(() => {
    const d = p.roundScore - prev.current;
    prev.current = p.roundScore;
    if (d > 0) {
      const k = Date.now();
      setGain({ n: d, k });
      const t = setTimeout(() => setGain((g) => (g && g.k === k ? null : g)), 900);
      return () => clearTimeout(t);
    }
  }, [p.roundScore]);
  const score = useAnimatedNumber(p.roundScore, 350);
  const danger = last && showDanger;
  return (
    <Animated.View style={[slide, {
      position: 'absolute', left: 0, right: 0, height: ROW - 6,
      flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1,
      backgroundColor: isYou ? 'rgba(61,139,255,0.15)' : danger ? 'rgba(255,93,115,0.08)' : w(0.03),
      borderColor: isYou ? 'rgba(61,139,255,0.45)' : danger ? 'rgba(255,93,115,0.3)' : 'transparent',
    }]}>
      <Text style={[{ width: 16, textAlign: 'center', fontFamily: F.displayBold, fontSize: 14, color: danger ? C.coral : w(0.65) }, s.tabular]}>{rank + 1}</Text>
      <Avatar player={p} size={34} />
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: F.bodyBold, fontSize: 15, color: w(0.92) }}>{p.name}</Text>
        {isBot(p) && <BotBadge />}
        {danger && <Text style={{ fontFamily: F.bodyBold, fontSize: 10, color: C.coral, backgroundColor: 'rgba(255,93,115,0.15)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: 'hidden' }}>Elimination zone</Text>}
      </View>
      {gain && <Text style={{ fontFamily: F.bodyBold, fontSize: 12, color: C.mint }}>+{gain.n}</Text>}
      <Text style={[{ width: 56, textAlign: 'right', fontFamily: F.display, fontSize: 18, color: isYou ? C.amber : C.white }, s.tabular]}>{score}</Text>
    </Animated.View>
  );
}

function Leaderboard({ players, started }: { players: Player[]; started: boolean }) {
  const ranked = rankByRound(players);
  const rankOf = new Map(ranked.map((p, i) => [p.id, i]));
  return (
    <Card style={{ padding: 8 }}>
      <View style={{ height: players.length * ROW - 6 }}>
        {players.map((p) => (
          <LeaderRow key={p.id} p={p} rank={rankOf.get(p.id)!} last={rankOf.get(p.id) === players.length - 1} showDanger={started} />
        ))}
      </View>
    </Card>
  );
}

// ── Final 1v1 ──────────────────────────────────────────────────────────────
function VersusSide({ p, leading }: { p: Player; leading: boolean }) {
  const score = useAnimatedNumber(p.roundScore, 400);
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 6 }}>
      <Avatar player={p} size={52} ring={leading} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%', marginTop: 8 }}>
        <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: F.bodySemi, fontSize: 14, color: w(0.92) }}>{p.name}</Text>
        {isBot(p) && <BotBadge />}
      </View>
      <Text style={[{ fontFamily: F.display, fontSize: 36, color: leading ? C.amber : C.white }, s.tabular]}>{score}</Text>
    </View>
  );
}

function Versus({ players }: { players: Player[] }) {
  const [a, b] = players;
  const lead = a.roundScore === b.roundScore ? null : a.roundScore > b.roundScore ? a.id : b.id;
  return (
    <View>
      <Text style={{ textAlign: 'center', marginBottom: 16, fontFamily: F.bodyBold, fontSize: 11, letterSpacing: 2.2, textTransform: 'uppercase', color: 'rgba(255,181,71,0.9)' }}>Championship round</Text>
      <View style={{ flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 16, borderRadius: 18, borderWidth: 1.5, borderColor: 'rgba(255,181,71,0.55)', backgroundColor: 'rgba(4,10,22,0.85)' }}>
        <VersusSide p={a} leading={lead === a.id} />
        <VersusSide p={b} leading={lead === b.id} />
      </View>
    </View>
  );
}

// ── Word list ──────────────────────────────────────────────────────────────
function Chip({ entry }: { entry: WordEntry }) {
  const v = useSharedValue(0);
  useEffect(() => { v.set(withSpring(1, { damping: 12 })); }, [v]);
  const pop = useAnimatedStyle(() => ({ opacity: Math.min(1, v.value), transform: [{ scale: 0.6 + 0.4 * v.value }] }));
  const color = entry.points >= 110 ? C.amber : entry.points >= 40 ? C.mint : w(0.55);
  return (
    <Animated.View style={[pop, { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 10, paddingRight: 8, paddingVertical: 6, borderRadius: 12, backgroundColor: w(0.05), borderWidth: 1, borderColor: w(0.06) }]}>
      <Text style={{ fontFamily: F.displayBold, fontSize: 14, letterSpacing: 0.6, color: w(0.92) }}>{entry.word.toUpperCase()}</Text>
      <Text style={[{ fontFamily: F.bodyBold, fontSize: 11, color }, s.tabular]}>+{entry.points}</Text>
    </Animated.View>
  );
}

function WordList({ words }: { words: WordEntry[] }) {
  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, marginBottom: 8 }}>
        <Text style={s.eyebrow}>Your words</Text>
        <Text style={[s.eyebrow, { letterSpacing: 0, textTransform: 'none' }]}>{words.length} found</Text>
      </View>
      {words.length === 0 ? (
        <View style={{ borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: w(0.12), padding: 18 }}>
          <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.6), textAlign: 'center' }}>Words you find appear here. Longer words score more points.</Text>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {words.map((e) => <Chip key={e.word} entry={e} />)}
        </View>
      )}
    </View>
  );
}

// ── Screen ─────────────────────────────────────────────────────────────────
export function GameScreen({ s: g }: { s: GameState }) {
  const insets = useSafeAreaInsets();
  const single = g.mode === 'single';
  const me = g.players.find((p) => p.id === HUMAN_ID)!;
  const active = g.players.filter((p) => p.status === 'active');
  const spectating = me.status === 'eliminated';
  const final = !single && active.length === 2;
  const now = useNow(!single, 1000);
  const started = now - g.roundStartedAt > 4000;
  const roundKey = `${g.matchId}-${g.round}`;
  // The word is revealed: a start chime and a firm tap (once per round, not when spectating).
  useEffect(() => {
    if (spectating) return;
    sfx.go();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [roundKey, spectating]);

  return (
    <Screen gold={final} padBottom={false}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10 }}>
          <View style={{ minWidth: 84 }}>
            <Text style={s.eyebrow}>{single ? 'Solo' : final ? 'Final' : 'Round'}</Text>
            <Text style={{ fontFamily: F.displayBold, fontSize: 18, color: C.white }}>{single ? 'Challenge' : `${g.round} of ${TOTAL_ROUNDS}`}</Text>
          </View>
          <Timer endsAt={g.roundEndsAt} total={g.roundEndsAt - g.roundStartedAt} final={final} />
          <View style={{ minWidth: 84 }}>{!spectating && <ScoreBadge score={me.roundScore} />}</View>
        </View>

        <View key={`source-${roundKey}`} style={{ paddingBottom: 14 }}>
          <SourceTiles source={g.source} final={final} />
        </View>

        {spectating ? (
          <View style={{ marginHorizontal: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 18, borderWidth: 1, borderColor: C.cardBorder, backgroundColor: C.card, paddingHorizontal: 16, paddingVertical: 12 }}>
            <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.75) }}>You placed <Text style={{ fontFamily: F.bodyBold, color: C.white }}>{ordinal(me.placement || 0)}</Text> · watching the rest</Text>
            <Pressable onPress={() => engine.goMenu()} hitSlop={10}><Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.primary }}>Leave</Text></Pressable>
          </View>
        ) : (
          <WordInput key={`input-${roundKey}`} final={final} />
        )}

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 4, paddingBottom: insets.bottom + 24, gap: 14 }}>
          {!single && (final ? <Versus players={active} /> : <Leaderboard players={active} started={started} />)}
          {!spectating && <WordList words={me.roundWords} />}
          {single && <Text style={{ textAlign: 'center', fontFamily: F.body, fontSize: 11, color: w(0.55) }}>{g.possibleWords} words are hiding in this one.</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
