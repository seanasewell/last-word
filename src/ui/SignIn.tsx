// ── Apple / Google sign-in UI ──────────────────────────────────────────────
import * as AppleAuthentication from 'expo-apple-authentication';
import React, { useEffect, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import { accounts, type Account } from '@/lib/account';
import { kv } from '@/lib/kv';
import { canUseApple, type Provider, type SocialResult } from '@/lib/social';
import { Button, Card, s, Sheet } from './kit';
import { C, F, w } from './theme';

export const PROVIDER_NAME: Record<Provider, string> = { apple: 'Apple', google: 'Google' };
// Google's own "G" from its Sign in with Google brand kit.
const GOOGLE_G = require('../../assets/images/google-g.png');
const BTN_HEIGHT = 50;
const BTN_RADIUS = 18;

export function useAppleAvailable(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => { let live = true; void canUseApple().then((v) => { if (live) setOk(v); }); return () => { live = false; }; }, []);
  return ok;
}

/** Apple's own button, as Apple's guidelines require. */
export function AppleButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  return (
    <View style={{ opacity: disabled ? 0.6 : 1 }} pointerEvents={disabled ? 'none' : 'auto'}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
        cornerRadius={BTN_RADIUS}
        style={{ height: BTN_HEIGHT, width: '100%' }}
        onPress={onPress}
      />
    </View>
  );
}

export function GoogleButton({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel="Continue with Google"
      style={({ pressed }) => ({ height: BTN_HEIGHT, borderRadius: BTN_RADIUS, backgroundColor: C.white, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.6 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] })}>
      <Image source={GOOGLE_G} style={{ width: 20, height: 20 }} accessibilityIgnoresInvertColors />
      <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: '#1F1F1F' }}>Continue with Google</Text>
    </Pressable>
  );
}

/** Both sign-in buttons, Apple first on iPhone. */
export function ProviderButtons({ onPick, busy }: { onPick: (p: Provider) => void; busy?: boolean }) {
  const apple = useAppleAvailable();
  return (
    <View style={{ gap: 10 }}>
      {apple && <AppleButton disabled={busy} onPress={() => onPick('apple')} />}
      <GoogleButton disabled={busy} onPress={() => onPick('google')} />
    </View>
  );
}

/**
 * Link flow for guests, with the "that account already has a player" case:
 * offer to switch to the saved player (this phone's guest is left behind).
 */
export function useLinkFlow() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Provider | null>(null);

  const handle = (r: SocialResult, p: Provider) => {
    if (r.kind === 'conflict') setConflict(p);
    else if (r.kind === 'error') setError(r.message);
  };
  const link = async (p: Provider) => {
    if (busy) return;
    setBusy(true); setError(null);
    handle(await accounts.link(p), p);
    setBusy(false);
  };
  const switchTo = async () => {
    const p = conflict;
    if (!p) return;
    setBusy(true); setError(null);
    const r = await accounts.signIn(p);
    setBusy(false);
    if (r.kind === 'ok') setConflict(null);
    else if (r.kind === 'error') setError(r.message);
  };

  const sheet = (
    <Sheet open={!!conflict} onClose={() => { if (!busy) setConflict(null); }} title="You already have a player">
      <Text style={s.body}>{`That ${conflict ? PROVIDER_NAME[conflict] : ''} account is already saved to another Last Word player. Switch to that player? This phone's guest progress will be lost.`}</Text>
      {error && conflict && <Text style={{ marginTop: 10, fontFamily: F.body, fontSize: 13, color: C.coral }}>{error}</Text>}
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
        <Button title="Cancel" variant="ghost" style={{ flex: 1 }} disabled={busy} onPress={() => setConflict(null)} />
        <Button title={busy ? 'Switching…' : 'Switch'} style={{ flex: 1 }} disabled={busy} onPress={switchTo} />
      </View>
    </Sheet>
  );
  return { busy, error: conflict ? null : error, link, sheet };
}

/** Card asking a guest to save their progress. */
export function SaveProgressCard({ onDismiss }: { onDismiss?: () => void }) {
  const flow = useLinkFlow();
  return (
    <Card style={{ borderRadius: 24, padding: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <Text style={{ flex: 1, fontFamily: F.displayBold, fontSize: 20, color: C.white }}>Save your progress</Text>
        {onDismiss && (
          <Pressable onPress={onDismiss} hitSlop={12} accessibilityLabel="Not now">
            <Text style={{ fontSize: 18, color: w(0.55) }}>✕</Text>
          </Pressable>
        )}
      </View>
      <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.75), marginTop: 4, marginBottom: 16 }}>
        {"You're playing as a guest. Sign in to keep your level, wins and achievements if you change or lose your phone."}
      </Text>
      <ProviderButtons busy={flow.busy} onPick={(p) => { void flow.link(p); }} />
      {flow.error && <Text style={{ marginTop: 10, fontFamily: F.body, fontSize: 13, color: C.coral }}>{flow.error}</Text>}
      {flow.sheet}
    </Card>
  );
}

const NUDGE_DAYS = 3;
/** On the Play tab: nudge guests who have played at least once. "✕" hides it for a few days. */
export function SaveProgressNudge({ account }: { account: Account }) {
  const key = `lw.saveNudge.${account.id}`;
  const [hiddenAt, setHiddenAt] = useState(() => Number(kv.get(key) || 0));
  const [openedAt] = useState(() => Date.now());
  if (account.provider || account.matchesPlayed < 1) return null;
  if (openedAt - hiddenAt < NUDGE_DAYS * 864e5) return null;
  return <SaveProgressCard onDismiss={() => { const t = Date.now(); kv.set(key, String(t)); setHiddenAt(t); }} />;
}

