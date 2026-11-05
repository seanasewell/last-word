// The eight LAST WORD tiles slide around to spell other words, show each
// word's points, then settle back into the logo. Repeats with a rest on LAST WORD.
import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, { Easing, interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';

import { scoreWord } from '@/lib/words';
import { C, F } from './theme';

const TILES = ['L', 'A', 'S', 'T', 'W', 'O', 'R', 'D'];
const SEQUENCE: { groups: string[]; hold: number }[] = [
  { groups: ['LAST', 'WORD'], hold: 1500 },
  { groups: ['STOW'], hold: 2000 },
  { groups: ['LORD'], hold: 2000 },
  { groups: ['TOWARDS'], hold: 2200 },
  { groups: ['LAST', 'WORD'], hold: 3500 },
];
const MOVE = Easing.bezier(0.65, 0, 0.25, 1);

interface Target { x: number; y: number; s: number; o: number }

function MovingTile({ ch, target, size, index }: { ch: string; target: Target; size: number; index: number }) {
  const x = useSharedValue(target.x);
  const y = useSharedValue(target.y);
  const sc = useSharedValue(target.s);
  const op = useSharedValue(target.o);
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.set(withDelay(index * 55, withSpring(1, { damping: 11, stiffness: 170 })));
  }, [enter, index]);
  useEffect(() => {
    const cfg = { duration: 700, easing: MOVE };
    const d = index * 25;
    x.set(withDelay(d, withTiming(target.x, cfg)));
    y.set(withDelay(d, withTiming(target.y, cfg)));
    sc.set(withDelay(d, withTiming(target.s, cfg)));
    op.set(withDelay(d, withTiming(target.o, { duration: 500 })));
  }, [target.x, target.y, target.s, target.o, index, x, y, sc, op]);
  const st = useAnimatedStyle(() => ({
    opacity: op.get() * Math.min(1, enter.get()),
    // RN scales around the centre, so offset by half the shrink to keep the top-left on target.
    transform: [
      { translateX: x.get() - (size * (1 - sc.get())) / 2 },
      { translateY: y.get() - (size * 1.12 * (1 - sc.get())) / 2 + (1 - enter.get()) * 14 },
      { scale: sc.get() * (0.8 + 0.2 * Math.min(1, enter.get())) },
    ],
  }));
  const h = size * 1.12;
  const r = size * 0.26;
  return (
    <Animated.View style={[{ position: 'absolute', left: 0, top: 0, width: size, height: h + 3, shadowColor: C.primary, shadowOpacity: 0.45, shadowRadius: 8, shadowOffset: { width: 0, height: 6 } }, st]}>
      <View style={{ position: 'absolute', top: 3, left: 0, right: 0, height: h, borderRadius: r, backgroundColor: C.tileEdge }} />
      <LinearGradient colors={[C.tileTop, C.tileBottom]} style={{ width: size, height: h, borderRadius: r, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: F.display, fontSize: size * 0.56, color: C.tileText }}>{ch}</Text>
      </LinearGradient>
    </Animated.View>
  );
}

function Points({ text, top }: { text: string; top: number }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.set(withDelay(850, withTiming(1, { duration: 1100, easing: Easing.out(Easing.quad) })));
  }, [v]);
  const st = useAnimatedStyle(() => ({
    opacity: interpolate(v.get(), [0, 0.15, 1], [0, 1, 0]),
    transform: [{ translateY: interpolate(v.get(), [0, 1], [6, -30]) }, { scale: interpolate(v.get(), [0, 0.15, 1], [0.9, 1.08, 1]) }],
  }));
  // Centred above the tiles.
  return <Animated.Text style={[{ position: 'absolute', left: 0, right: 0, top, textAlign: 'center', fontFamily: F.display, fontSize: 18, color: C.amber, zIndex: 3 }, st]}>{text}</Animated.Text>;
}

export function AnimatedTileLogo({ size = 38 }: { size?: number }) {
  const reduce = useReducedMotion();
  const gap = Math.max(2, Math.round(size * 0.13));
  const wordGap = Math.round(size * 0.32);
  const tileH = size * 1.12;
  const width = 8 * size + 6 * gap + wordGap;
  const rackScale = 0.46;
  const rackY = tileH + 12;
  const height = rackY + tileH * rackScale + 2;
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (reduce) return;
    let i = 0;
    let first = true;
    let t: ReturnType<typeof setTimeout>;
    const next = () => {
      const last = i === SEQUENCE.length - 1;
      t = setTimeout(() => {
        // The final LAST WORD and the opening one share a layout, so wrap to step 1.
        i = last ? 1 : i + 1;
        first = false;
        setStep(i);
        next();
      }, SEQUENCE[i].hold + (first && i === 0 ? 500 : 0));
    };
    next();
    return () => clearTimeout(t);
  }, [reduce]);

  const { groups } = SEQUENCE[reduce ? 0 : step];
  const used = new Set(groups.join(''));
  const pos: Record<string, Target> = {};
  const total = groups.reduce((n, g) => n + g.length * size + (g.length - 1) * gap, 0) + (groups.length - 1) * wordGap;
  let x = (width - total) / 2;
  groups.forEach((g) => {
    for (const ch of g) { pos[ch] = { x, y: 0, s: 1, o: 1 }; x += size + gap; }
    x += wordGap - gap;
  });
  const isLogo = groups.length === 2;
  const spare = TILES.filter((c) => !used.has(c));
  const rs = size * rackScale;
  let rx = (width - (spare.length * rs + (spare.length - 1) * 4)) / 2;
  for (const ch of spare) { pos[ch] = { x: rx, y: rackY, s: rackScale, o: 0.35 }; rx += rs + 4; }

  return (
    <View accessibilityRole="image" accessibilityLabel="Last word" style={{ width, height, alignSelf: 'center' }}>
      {TILES.map((ch, i) => <MovingTile key={ch} ch={ch} target={pos[ch]} size={size} index={i} />)}
      {!isLogo && <Points key={step} text={`+${scoreWord(groups[0].toLowerCase())}`} top={-28} />}
    </View>
  );
}
