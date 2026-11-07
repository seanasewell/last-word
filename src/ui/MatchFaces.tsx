// ── Elimination match card: the five faces act out a match ─────────────────
// One by one the players dissolve away (2nd, 4th, 1st, 5th) until the middle player
// is left; her ring lights up gold, confetti pops around her, then everyone
// fades back in and it repeats.
import React, { useEffect, useState } from 'react';
import { Image, View, type ImageSourcePropType } from 'react-native';
import Animated, {
  interpolateColor, type SharedValue, useAnimatedStyle, useReducedMotion, useSharedValue,
  withDelay, withSequence, withTiming,
} from 'react-native-reanimated';

import { C } from './theme';

const SIZE = 40;
const OVERLAP = 11;
const SLOT = SIZE - OVERLAP;
/** Order the players are knocked out (indexes into the faces); the one left over wins. */
const OUT_ORDER = [1, 3, 0, 4];
/** How long each step lasts: all in, after 1st…4th knockout, winner glow. */
const STEP_MS = [1400, 850, 850, 850, 650, 1900];

const CONFETTI_COLORS = ['#FFB547', '#3D8BFF', '#2ED3A0', '#FF5D73', '#B57BFF'];
const BITS = Array.from({ length: 12 }, (_, i) => {
  const a = (i / 12) * Math.PI * 2 + (i % 2 ? 0.2 : -0.1);
  return { dx: Math.cos(a), dy: Math.sin(a), far: 14 + (i % 3) * 5, color: CONFETTI_COLORS[i % CONFETTI_COLORS.length], round: i % 3 === 0, spin: (i % 2 ? 1 : -1) * 220 };
});

/** A small burst of confetti flying out from the edge of the winner's avatar. */
function ConfettiBit({ bit, t }: { bit: (typeof BITS)[number]; t: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const p = t.get();
    const r = SIZE / 2 + bit.far * p;
    return {
      opacity: p === 0 ? 0 : 1 - p * p,
      transform: [{ translateX: bit.dx * r }, { translateY: bit.dy * r + 6 * p * p }, { rotate: `${bit.spin * p}deg` }],
    };
  });
  return <Animated.View style={[{ position: 'absolute', left: SIZE / 2 - 2, top: SIZE / 2 - 2, width: bit.round ? 4 : 5, height: bit.round ? 4 : 3, borderRadius: bit.round ? 2 : 1, backgroundColor: bit.color }, style]} />;
}

function Face({ src, out, winner, ring }: { src: ImageSourcePropType; out: boolean; winner: boolean; ring: string }) {
  const opacity = useSharedValue(1);
  const width = useSharedValue(SLOT);
  const glow = useSharedValue(0);
  const burst = useSharedValue(0);

  useEffect(() => {
    if (out) {
      opacity.set(withTiming(0, { duration: 450 }));
      width.set(withDelay(400, withTiming(0, { duration: 300 })));
    } else {
      width.set(withTiming(SLOT, { duration: 300 }));
      opacity.set(withDelay(150, withTiming(1, { duration: 250 })));
    }
  }, [out, opacity, width]);

  useEffect(() => {
    glow.set(winner ? withDelay(250, withTiming(1, { duration: 350 })) : withTiming(0, { duration: 250 }));
    burst.set(winner ? withSequence(withTiming(0, { duration: 0 }), withDelay(600, withTiming(1, { duration: 800 }))) : 0);
  }, [winner, glow, burst]);

  const slot = useAnimatedStyle(() => ({ width: width.get() }));
  const face = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    borderColor: interpolateColor(glow.get(), [0, 1], [ring, C.amber]),
    shadowOpacity: glow.get() * 0.9,
  }));

  return (
    <Animated.View style={slot}>
      <Animated.View style={[{ width: SIZE, height: SIZE, borderRadius: SIZE / 2, borderWidth: 2, alignItems: 'center', justifyContent: 'center', shadowColor: C.amber, shadowRadius: 6, shadowOffset: { width: 0, height: 0 }, backgroundColor: ring }, face]}>
        <Image source={src} style={{ width: SIZE - 4, height: SIZE - 4, borderRadius: (SIZE - 4) / 2 }} />
      </Animated.View>
      {winner && <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE }}>{BITS.map((b, i) => <ConfettiBit key={i} bit={b} t={burst} />)}</View>}
    </Animated.View>
  );
}

/** `ring` is the card's colour, so overlapping faces look cut out. */
export function MatchFaces({ faces, ring }: { faces: ImageSourcePropType[]; ring: string }) {
  const reduceMotion = useReducedMotion();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (reduceMotion) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % STEP_MS.length), STEP_MS[step]);
    return () => clearTimeout(t);
  }, [step, reduceMotion]);

  const knockedOut = reduceMotion ? 0 : Math.min(step, OUT_ORDER.length);
  const winnerIndex = faces.findIndex((_, i) => !OUT_ORDER.includes(i));
  return (
    <View style={{ flexDirection: 'row', paddingRight: OVERLAP }} accessible={false} importantForAccessibility="no-hide-descendants">
      {faces.map((src, i) => {
        const at = OUT_ORDER.indexOf(i);
        return <Face key={i} src={src} ring={ring} out={at !== -1 && at < knockedOut} winner={i === winnerIndex && knockedOut === OUT_ORDER.length} />;
      })}
    </View>
  );
}
