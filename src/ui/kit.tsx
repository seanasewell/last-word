import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Image, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, useWindowDimensions, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { Easing, FadeOutUp, SlideInDown, SlideInUp, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { accounts, type AuthState } from '@/lib/account';
import { engine, HUMAN_ID, type GameState } from '@/lib/engine';
import { C, F, w } from './theme';

export function useGame(): GameState {
  return useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
}

export function useAuth(): AuthState {
  return useSyncExternalStore(accounts.subscribe, accounts.getState, accounts.getState);
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

/**
 * Whole seconds left until `endsAt`, updated exactly as each second ticks
 * over (not on a polling interval, which made the numbers step unevenly).
 * Never jumps back up by one when an online match's clock estimate shifts.
 */
export function useCountdown(endsAt: number, active = true): number {
  const [secs, setSecs] = useState(() => Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
  useEffect(() => {
    if (!active || !endsAt) return;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      const left = endsAt - Date.now();
      const next = Math.max(0, Math.ceil(left / 1000));
      setSecs((prev) => (prev > 0 && next === prev + 1 ? prev : next));
      if (left > 0) t = setTimeout(tick, (left % 1000 || 1000) + 10);
    };
    t = setTimeout(tick, 0);
    return () => clearTimeout(t);
  }, [endsAt, active]);
  return secs;
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
/** Width kept free beside the header logo (the Play tab's bell, the lobby's Leave button). */
export const HEADER_SIDE = 52;
/** The tile logo at its header size: the same on the Play tab and in the match lobby. */
export function HeaderLogo({ animate = true }: { animate?: boolean }) {
  const { width } = useWindowDimensions();
  // About 80% of the row beside the side control, left-aligned.
  const avail = (Math.min(width, 480) - 24 - HEADER_SIDE) * 0.8;
  const gap = Math.max(2, Math.round((avail / 8.91) * 0.13));
  const size = Math.floor(((avail - 7 * gap) / 8) * 100) / 100;
  return <TileLogo size={size} animate={animate} />;
}

export function TileLogo({ size = 36, animate = true }: { size?: number; animate?: boolean }) {
  let i = 0;
  return (
    // One even gap between all eight tiles (no wider space between the words).
    <View accessibilityRole="image" accessibilityLabel="Last word" style={{ flexDirection: 'row', justifyContent: 'center', gap: Math.max(2, Math.round(size * 0.13)) }}>
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
export interface AvatarLike { glyph: string; hue: number; id?: string; isYou?: boolean; photo?: string | null }

export function Avatar({ player, size = 36, dim = false, ring = false }: { player: AvatarLike; size?: number; dim?: boolean; ring?: boolean }) {
  const isYou = player.isYou || player.id === HUMAN_ID;
  const h = player.hue;
  const colors: [string, string, ...string[]] = dim
    ? ['#6B7280', '#4B5563']
    : isYou ? [C.primaryTop, C.sky, C.mint] : [`hsl(${h}, 85%, 62%)`, `hsl(${(h + 40) % 360}, 75%, 42%)`];
  const inner = (
    <LinearGradient colors={colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', opacity: dim ? 0.6 : 1, overflow: 'hidden' }}>
      {player.photo ? (
        <Image source={{ uri: player.photo }} style={{ width: size, height: size, opacity: dim ? 0.5 : 1 }} />
      ) : (
        <Text style={{ fontFamily: F.display, fontSize: size * 0.42, color: C.white, includeFontPadding: false }}>{player.glyph}</Text>
      )}
    </LinearGradient>
  );
  if (!ring) return inner;
  return (
    <View style={{ padding: 3, borderRadius: size, borderWidth: 2, borderColor: isYou ? C.primary : `hsl(${h}, 85%, 62%)` }}>{inner}</View>
  );
}

/** Small "Bot" tag shown next to computer players' names. */
export function BotBadge({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const lg = size === 'lg';
  return (
    <View accessibilityLabel="Bot" style={{ paddingHorizontal: lg ? 8 : 6, paddingVertical: lg ? 3 : 1, borderRadius: lg ? 8 : 6, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: lg ? 12 : 10, color: w(0.75) }}>Bot</Text>
    </View>
  );
}
export const isBot = (p: { controller?: string }) => p.controller === 'bot';

// ── Buttons & cards ────────────────────────────────────────────────────────
export function Button({ title, onPress, variant = 'primary', style, disabled }: { title: string; onPress: () => void; variant?: 'primary' | 'ghost' | 'gold' | 'danger'; style?: StyleProp<ViewStyle>; disabled?: boolean }) {
  const text: TextStyle = { fontFamily: F.bodyBold, fontSize: 16, color: variant === 'gold' ? C.goldText : variant === 'ghost' ? w(0.9) : C.white };
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" style={({ pressed }) => [{ opacity: disabled && variant !== 'primary' ? 0.5 : 1, transform: [{ scale: pressed && !disabled ? 0.97 : 1 }] }, style]}>
      {variant === 'ghost' || variant === 'danger' ? (
        <View style={[s.btn, variant === 'ghost' ? { backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder } : { backgroundColor: C.coral }]}>
          <Text style={text}>{title}</Text>
        </View>
      ) : variant === 'primary' && disabled ? (
        <View style={[s.btn, { backgroundColor: C.primaryDisabled }]}>
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

export function Stat({ label, value, color = C.white, compact = false }: { label: string; value: React.ReactNode; color?: string; compact?: boolean }) {
  return (
    <Card style={{ flex: 1, paddingHorizontal: compact ? 12 : 16, paddingVertical: 12 }}>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={[s.eyebrow, compact && { letterSpacing: 0.8 }]}>{label}</Text>
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
  eyebrow: { fontFamily: F.bodyBold, fontSize: 10, letterSpacing: 1.4, textTransform: 'uppercase', color: w(0.65) },
  h1: { fontFamily: F.displayBold, fontSize: 30, color: C.white },
  body: { fontFamily: F.body, fontSize: 15, color: w(0.8), lineHeight: 22 },
  tabular: { fontVariant: ['tabular-nums'] },
});

// ── Sheets & controls ──────────────────────────────────────────────────────
/** Bottom sheet over a dimmed backdrop. */
// ── Top error banner ───────────────────────────────────────────────────────
// toast.show('…') drops a short message in from the top of the screen without moving
// the player anywhere. It also shows over open sheets.
let toastState: { text: string; id: number } | null = null;
let toastSeq = 0;
const toastSubs = new Set<() => void>();
export const toast = {
  show(text: string) { toastState = { text, id: ++toastSeq }; toastSubs.forEach((f) => f()); },
  clear() { toastState = null; toastSubs.forEach((f) => f()); },
};
const subscribeToast = (f: () => void) => { toastSubs.add(f); return () => { toastSubs.delete(f); }; };

export function TopToast() {
  const cur = useSyncExternalStore(subscribeToast, () => toastState, () => toastState);
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!cur) return;
    const t = setTimeout(() => { if (toastState?.id === cur.id) toast.clear(); }, 3500);
    return () => clearTimeout(t);
  }, [cur]);
  if (!cur) return null;
  return (
    <Animated.View key={cur.id} entering={SlideInUp.duration(220).easing(Easing.out(Easing.cubic))} exiting={FadeOutUp.duration(160)}
      pointerEvents="box-none" style={{ position: 'absolute', left: 12, right: 12, top: insets.top + 8, zIndex: 100 }}>
      <Pressable onPress={() => toast.clear()} accessibilityRole="alert" accessibilityLiveRegion="polite"
        style={{ borderRadius: 16, backgroundColor: '#3A1820', borderWidth: 1, borderColor: 'rgba(255,93,115,0.5)', paddingHorizontal: 16, paddingVertical: 12,
          shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 }}>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.white, textAlign: 'center' }}>{cur.text}</Text>
      </Pressable>
    </Animated.View>
  );
}

/** `tall`: a fixed near-full-height sheet, so it keeps its size (e.g. while a search filters its list behind the keyboard). */
export function Sheet({ open, onClose, title, children, tall = false }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode; tall?: boolean }) {
  // Drag the handle (or title) down to dismiss; a short drag springs back.
  const drag = useSharedValue(0);
  useEffect(() => { if (open) drag.set(0); }, [open, drag]);
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 3,
    onPanResponderMove: (_, g) => { drag.set(g.dy > 0 ? g.dy : g.dy * 0.15); },
    onPanResponderRelease: (_, g) => {
      if (g.dy > 90 || g.vy > 0.8) {
        drag.set(withTiming(700, { duration: 220, easing: Easing.in(Easing.quad) }));
        setTimeout(onClose, 200);
      } else {
        drag.set(withSpring(0, { damping: 20, stiffness: 260 }));
      }
    },
    onPanResponderTerminate: () => { drag.set(withSpring(0, { damping: 20, stiffness: 260 })); },
  }), [drag, onClose]);
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drag.get() }] }));
  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable accessibilityLabel="Close" onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.55)' }]} />
        <Animated.View entering={SlideInDown.duration(260).easing(Easing.out(Easing.cubic))} style={tall ? { height: '92%' } : { maxHeight: '85%' }}>
          <Animated.View style={[{ backgroundColor: C.ink850, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 12, paddingBottom: 36 }, tall && { flex: 1 }, dragStyle]}>
            <View {...pan.panHandlers} style={{ paddingTop: 10 }}>
              <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: w(0.2), marginBottom: 16 }} />
              {title && <Text style={{ fontFamily: F.displayBold, fontSize: 20, color: C.white, marginBottom: 12 }}>{title}</Text>}
            </View>
            {children}
          </Animated.View>
        </Animated.View>
        <TopToast />
      </View>
    </Modal>
  );
}

/** A tappable list of options in a sheet (stands in for a web <select>). */
export function OptionSheet<T extends string>({ open, onClose, title, options, value, onPick }: { open: boolean; onClose: () => void; title: string; options: { value: T; label: string }[]; value?: T; onPick: (v: T) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <ScrollView style={{ maxHeight: 460 }}>
        {options.map((o) => (
          <Pressable key={o.value} onPress={() => { onPick(o.value); onClose(); }}
            style={({ pressed }) => ({ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 12, borderRadius: 12, backgroundColor: pressed ? w(0.06) : 'transparent' })}>
            <Text style={{ fontFamily: o.value === value ? F.bodyBold : F.body, fontSize: 16, color: C.white }}>{o.label}</Text>
            {o.value === value && <Text style={{ fontFamily: F.bodyBold, color: C.primary }}>✓</Text>}
          </Pressable>
        ))}
      </ScrollView>
    </Sheet>
  );
}

/** Downward chevron for drop-down fields. */
const Chevron = () => (
  <View style={{ width: 9, height: 9, marginTop: -5, marginRight: 2, borderRightWidth: 2, borderBottomWidth: 2, borderColor: w(0.6), transform: [{ rotate: '45deg' }] }} />
);

/** A row that looks like a form field and opens a picker. */
export function SelectRow({ label, value, placeholder, onPress, active = false }: { label?: string; value?: string; placeholder: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label ?? placeholder}
      style={{ height: 52, borderRadius: 16, borderWidth: 1.5, borderColor: active ? C.primary : C.cardBorder, backgroundColor: 'rgba(4,10,22,0.7)', paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Text style={{ fontFamily: F.bodySemi, fontSize: 16, color: !value ? w(0.55) : active ? C.white : FIELD_IDLE_TEXT }}>{value || placeholder}</Text>
      <Chevron />
    </Pressable>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <Switch value={on} onValueChange={onChange} accessibilityLabel={label} trackColor={{ true: C.mint, false: w(0.2) }} />;
}

export const inputStyle: TextStyle = {
  height: 56, borderRadius: 18, borderWidth: 1.5, borderColor: C.cardBorder, backgroundColor: 'rgba(4,10,22,0.7)',
  paddingHorizontal: 16, color: C.white, fontFamily: F.bodySemi, fontSize: 18,
};

/** Field text when the field isn't selected (softer than the white used while typing). */
const FIELD_IDLE_TEXT = w(0.75);

/** Text input with the app's field styling: blue border and white text while selected. */
export function TextField({ style, onFocus, onBlur, ...props }: TextInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={w(0.45)}
      keyboardAppearance="dark"
      {...props}
      onFocus={(e) => { setFocused(true); onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); onBlur?.(e); }}
      style={[inputStyle, style, { borderColor: focused ? C.primary : C.cardBorder, color: focused ? C.white : FIELD_IDLE_TEXT }]}
    />
  );
}

/** A row of tabs (one selected), used on Ranks and Rewards. */
export function Segmented<T extends string>({ options, value, onChange, small = false }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; small?: boolean }) {
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
