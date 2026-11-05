import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { engine, HUMAN_ID, type GameState } from '@/lib/engine';
import { C, F, w } from './theme';

export function useGame(): GameState {
  return useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
}

/** Re-renders every `ms` while active; returns Date.now(). */
export function useNow(active: boolean, ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

/** Counts smoothly toward `value`. */
export function useAnimatedNumber(value: number, duration = 450): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const a = from.current;
    if (a === value) return;
    const start = Date.now();
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (Date.now() - start) / duration);
      const v = Math.round(a + (value - a) * (1 - Math.pow(1 - k, 3)));
      from.current = v;
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return shown;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ── Background ─────────────────────────────────────────────────────────────
/** Full-screen page: dark blue with a lighter blue fade from the top, safe-area aware. */
export function Screen({ children, gold = false, padBottom = true, style }: { children: React.ReactNode; gold?: boolean; padBottom?: boolean; style?: StyleProp<ViewStyle> }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <LinearGradient
        colors={gold ? ['#3A2E18', '#141826', C.bg] : [C.bgTop, C.bgMid, C.bg]}
        locations={[0, 0.32, 0.62]}
        style={StyleSheet.absoluteFill}
      />
      <View style={[{ flex: 1, paddingTop: insets.top, paddingBottom: padBottom ? insets.bottom : 0 }, style]}>{children}</View>
    </View>
  );
}

// ── Letter tile ────────────────────────────────────────────────────────────
export function Tile({ ch, size, gold = false, delay = 0, animate = true }: { ch: string; size: number; gold?: boolean; delay?: number; animate?: boolean }) {
  const v = useSharedValue(animate ? 0 : 1);
  useEffect(() => {
    if (animate) v.set(withDelay(delay, withSpring(1, { damping: 11, stiffness: 170 })));
  }, [animate, delay, v]);
  const pop = useAnimatedStyle(() => ({
    opacity: Math.min(1, v.value),
    transform: [{ translateY: (1 - v.value) * 14 }, { scale: 0.8 + 0.2 * v.value }],
  }));
  const h = size * 1.12;
  const r = size * 0.26;
  return (
    <Animated.View
      style={[{
        width: size, height: h + 3,
        shadowColor: gold ? C.amber : C.primary, shadowOpacity: 0.45, shadowRadius: 8, shadowOffset: { width: 0, height: 6 },
      }, pop]}>
      <View style={{ position: 'absolute', top: 3, left: 0, right: 0, height: h, borderRadius: r, backgroundColor: gold ? C.goldEdge : C.tileEdge }} />
      <LinearGradient colors={gold ? [C.goldTop, C.goldBottom] : [C.tileTop, C.tileBottom]} style={{ width: size, height: h, borderRadius: r, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: F.display, fontSize: size * 0.56, color: gold ? C.goldText : C.tileText, includeFontPadding: false }}>{ch}</Text>
      </LinearGradient>
    </Animated.View>
  );
}

/** The Last word logo: letter tiles. */
export function TileLogo({ size = 36, animate = true }: { size?: number; animate?: boolean }) {
  let i = 0;
  return (
    <View accessibilityRole="image" accessibilityLabel="Last word" style={{ flexDirection: 'row', justifyContent: 'center', gap: size * 0.32 }}>
      {['LAST', 'WORD'].map((word) => (
        <View key={word} style={{ flexDirection: 'row', gap: Math.max(2, Math.round(size * 0.13)) }}>
          {word.split('').map((ch) => {
            const d = i++;
            return <Tile key={d} ch={ch} size={size} delay={d * 55} animate={animate} />;
          })}
        </View>
      ))}
    </View>
  );
}

// ── Avatar ─────────────────────────────────────────────────────────────────
export interface AvatarLike { glyph: string; hue: number; id?: string; isYou?: boolean }

export function Avatar({ player, size = 36, dim = false, ring = false }: { player: AvatarLike; size?: number; dim?: boolean; ring?: boolean }) {
  const isYou = player.isYou || player.id === HUMAN_ID;
  const h = player.hue;
  const colors: [string, string, ...string[]] = dim
    ? ['#6B7280', '#4B5563']
    : isYou ? [C.primaryTop, C.sky, C.mint] : [`hsl(${h}, 85%, 62%)`, `hsl(${(h + 40) % 360}, 75%, 42%)`];
  const inner = (
    <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', opacity: dim ? 0.6 : 1 }}>
      <Text style={{ fontFamily: F.display, fontSize: size * 0.42, color: C.white, includeFontPadding: false }}>{player.glyph}</Text>
    </LinearGradient>
  );
  if (!ring) return inner;
  return (
    <View style={{ padding: 3, borderRadius: size, borderWidth: 2, borderColor: isYou ? C.primary : `hsl(${h}, 85%, 62%)` }}>{inner}</View>
  );
}

// ── Buttons & cards ────────────────────────────────────────────────────────
export function Button({ title, onPress, variant = 'primary', style, disabled }: { title: string; onPress: () => void; variant?: 'primary' | 'ghost' | 'gold' | 'danger'; style?: StyleProp<ViewStyle>; disabled?: boolean }) {
  const text: TextStyle = { fontFamily: F.bodyBold, fontSize: 16, color: variant === 'gold' ? C.goldText : variant === 'ghost' ? w(0.9) : C.white };
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={({ pressed }) => [{ opacity: disabled ? 0.4 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] }, style]}>
      {variant === 'ghost' || variant === 'danger' ? (
        <View style={[s.btn, variant === 'ghost' ? { backgroundColor: w(0.06), borderWidth: 1, borderColor: w(0.1) } : { backgroundColor: C.coral }]}>
          <Text style={text}>{title}</Text>
        </View>
      ) : (
        <LinearGradient colors={variant === 'gold' ? ['#FFC870', '#F4A23A'] : [C.primaryTop, C.primaryBottom]} style={[s.btn, { shadowColor: variant === 'gold' ? C.amber : C.primary, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } }]}>
          <Text style={text}>{title}</Text>
        </LinearGradient>
      )}
    </Pressable>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Stat({ label, value, color = C.white }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <Card style={{ flex: 1, paddingHorizontal: 16, paddingVertical: 12 }}>
      <Text style={s.eyebrow}>{label}</Text>
      <Text style={{ fontFamily: F.displayBold, fontSize: 20, color, marginTop: 2 }}>{value}</Text>
    </Card>
  );
}

/** Fades in from below (one-shot). */
export function FadeUp({ children, delay = 0, style }: { children: React.ReactNode; delay?: number; style?: StyleProp<ViewStyle> }) {
  const v = useSharedValue(0);
  useEffect(() => {
    v.set(withDelay(delay, withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) })));
  }, [delay, v]);
  const st = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ translateY: (1 - v.value) * 12 }] }));
  return <Animated.View style={[st, style]}>{children}</Animated.View>;
}

export const s = StyleSheet.create({
  btn: { height: 50, borderRadius: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  card: { backgroundColor: C.card, borderColor: C.cardBorder, borderWidth: 1, borderRadius: 20 },
  eyebrow: { fontFamily: F.bodyBold, fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: w(0.5) },
  h1: { fontFamily: F.displayBold, fontSize: 30, color: C.white },
  body: { fontFamily: F.body, fontSize: 15, color: w(0.7), lineHeight: 22 },
  tabular: { fontVariant: ['tabular-nums'] },
});
