// ── Remove ads: Play tab and Settings cards, purchase sheet, confirmation; simulated ad screen ──
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { registerSimulatedAdHost } from '@/lib/ads';
import { purchases, useAdFree } from '@/lib/purchases';
import { Button, Card, s, Sheet } from './kit';
import { C, F, w } from './theme';

const GREEN = '#22A06B';

function GreenCheck() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" accessibilityLabel="Active">
      <Circle cx={12} cy={12} r={12} fill={GREEN} />
      <Path d="M7.4 12.3 10.6 15.4 16.6 9" fill="none" stroke="#FFFFFF" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function IconBox({ emoji }: { emoji: string }) {
  return (
    <View style={{ width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: w(0.08) }}>
      <Text style={{ fontSize: 20 }}>{emoji}</Text>
    </View>
  );
}

/** The purchase sheet plus its "You're ad-free!" confirmation. `open()` starts the flow. */
function useRemoveAdsFlow() {
  const [sheet, setSheet] = useState<'buy' | 'done' | null>(null);
  const [doneTitle, setDoneTitle] = useState("You're ad-free!");
  const sheets = (
    <>
      <PurchaseSheet open={sheet === 'buy'} onClose={() => setSheet(null)}
        onSuccess={(restored) => { setDoneTitle(restored ? 'Purchase restored' : "You're ad-free!"); setSheet('done'); }} />
      <Sheet open={sheet === 'done'} onClose={() => setSheet(null)}>
        <View style={{ alignItems: 'center', paddingTop: 4 }}>
          <Text style={{ fontSize: 44 }}>🎉</Text>
          <Text style={{ marginTop: 8, fontFamily: F.displayBold, fontSize: 22, color: C.white, textAlign: 'center' }}>{doneTitle}</Text>
          <Text style={[s.body, { textAlign: 'center', marginTop: 6 }]}>All advertisements have been removed. Enjoy uninterrupted gameplay.</Text>
        </View>
        <View style={{ marginTop: 20 }}><Button title="Continue" onPress={() => setSheet(null)} /></View>
      </Sheet>
    </>
  );
  return { open: () => setSheet('buy'), sheets };
}

/** Profile → Advertisements. Hidden where purchases aren't available at all. */
export function AdvertisementsSection() {
  const st = useAdFree();
  const flow = useRemoveAdsFlow();
  if (st.provider === 'none' && !st.adFree) return null;

  const cardStyle = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, padding: 14, borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder };
  return (
    <>
      <Text style={[s.eyebrow, { marginTop: 26, marginBottom: 8 }]}>Advertisements</Text>
      {st.adFree ? (
        <View style={cardStyle} accessibilityLabel="Ad-free experience. Ads are permanently disabled.">
          <IconBox emoji="🚫" />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.white }}>Ad-free experience</Text>
            <Text style={{ fontFamily: F.body, fontSize: 13, color: w(0.7), marginTop: 2 }}>Ads are permanently disabled.</Text>
          </View>
          <GreenCheck />
        </View>
      ) : (
        <Pressable onPress={flow.open} accessibilityRole="button" style={({ pressed }) => [cardStyle, { opacity: pressed ? 0.85 : 1 }]}>
          <IconBox emoji="🚫" />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.white }}>Remove ads</Text>
            <Text style={{ fontFamily: F.body, fontSize: 13, color: w(0.7), marginTop: 2 }}>Enjoy Last Word without interruptions.</Text>
          </View>
          <Text style={{ fontSize: 20, color: w(0.55) }}>›</Text>
        </Pressable>
      )}
      {flow.sheets}
    </>
  );
}

/** Play tab: a "Remove ads" card that opens the purchase sheet. Gone once the player is ad-free. */
export function RemoveAdsCard() {
  const st = useAdFree();
  const flow = useRemoveAdsFlow();
  if (st.adFree || st.provider === 'none') return <>{flow.sheets}</>;
  return (
    <>
      <Pressable onPress={flow.open} accessibilityRole="button" accessibilityLabel="Remove ads"
        style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}>
        <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 24, padding: 20 }}>
          <IconBox emoji="🚫" />
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: F.displayBold, fontSize: 20, color: C.white }}>Remove ads</Text>
            <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.75), marginTop: 4 }}>One-time purchase. Play without interruptions.</Text>
          </View>
          <Text style={{ fontSize: 22, color: w(0.55) }}>›</Text>
        </Card>
      </Pressable>
      {flow.sheets}
    </>
  );
}

function PurchaseSheet({ open, onClose, onSuccess }: { open: boolean; onClose: () => void; onSuccess: (restored: boolean) => void }) {
  const st = useAdFree();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Clear any old message when the sheet closes, so it opens clean next time.
  const close = () => { setError(null); setNote(null); onClose(); };

  const buy = async () => {
    setError(null); setNote(null);
    const r = await purchases.buy();
    if (r.kind === 'ok') { close(); setTimeout(() => onSuccess(false), 350); }
    else if (r.kind === 'error') setError(r.message);
    // Cancelled: stay on the sheet, no error.
  };
  const restore = async () => {
    setError(null); setNote(null);
    const r = await purchases.restore();
    if (r.kind === 'error') setError(r.message);
    else if (r.adFree) { close(); setTimeout(() => onSuccess(true), 350); }
    else setNote('No previous Remove ads purchase was found for this account.');
  };

  return (
    <Sheet open={open} onClose={close}>
      <View style={{ alignItems: 'center' }}>
        <Text style={{ fontSize: 48 }}>🚫</Text>
        <Text style={{ marginTop: 8, fontFamily: F.displayBold, fontSize: 22, color: C.white, textAlign: 'center' }}>Play without ads</Text>
        <Text style={[s.body, { textAlign: 'center', marginTop: 6 }]}>Remove all advertisements from Last Word with a one-time purchase.</Text>
      </View>
      <View style={{ gap: 8, marginTop: 16, alignSelf: 'center' }}>
        {['No more interstitial ads', 'One-time payment', 'No subscription', 'Permanent access'].map((t) => (
          <View key={t} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <GreenCheck />
            <Text style={{ fontFamily: F.bodySemi, fontSize: 15, color: C.white }}>{t}</Text>
          </View>
        ))}
      </View>
      {st.provider === 'simulated' && (
        <Text style={{ marginTop: 14, textAlign: 'center', fontFamily: F.bodySemi, fontSize: 12, color: C.amber }}>Test purchase: nothing is charged. Real purchases need a store build.</Text>
      )}
      {error && <Text style={{ marginTop: 12, textAlign: 'center', fontFamily: F.body, fontSize: 13, color: C.coral }}>{error}</Text>}
      {note && <Text style={{ marginTop: 12, textAlign: 'center', fontFamily: F.body, fontSize: 13, color: w(0.75) }}>{note}</Text>}
      <View style={{ gap: 10, marginTop: 18 }}>
        <Button title={st.busy ? 'Please wait…' : st.price ? `Remove ads · ${st.price}` : 'Remove ads'} disabled={st.busy} onPress={() => { void buy(); }} />
        <Button title="Not now" variant="ghost" disabled={st.busy} onPress={close} />
      </View>
      <Pressable onPress={() => { void restore(); }} disabled={st.busy} hitSlop={10} style={{ alignSelf: 'center', marginTop: 14 }}>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: w(0.75), textDecorationLine: 'underline' }}>Restore purchases</Text>
      </Pressable>
    </Sheet>
  );
}

/** Development stand-in for an interstitial (Expo Go and test builds only). */
export function SimulatedAdHost() {
  const [done, setDone] = useState<(() => void) | null>(null);
  const [left, setLeft] = useState(0);
  useEffect(() => {
    registerSimulatedAdHost((d) => { setLeft(3); setDone(() => d); });
    return () => registerSimulatedAdHost(null);
  }, []);
  useEffect(() => {
    if (!done || left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [done, left]);
  const close = () => { const d = done; setDone(null); d?.(); };
  return (
    <Modal visible={!!done} animationType="fade" onRequestClose={() => { if (left <= 0) close(); }}>
      <Animated.View entering={FadeIn} style={{ flex: 1, backgroundColor: '#0B0F1A', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <View style={{ position: 'absolute', top: 60, right: 20 }}>
          {left > 0
            ? <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: w(0.6) }}>Close in {left}</Text>
            : <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close ad" hitSlop={12}
                style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: w(0.15) }}>
                <Text style={{ fontSize: 18, color: C.white }}>✕</Text>
              </Pressable>}
        </View>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 12, letterSpacing: 2, color: w(0.5) }}>ADVERTISEMENT</Text>
        <Text style={{ marginTop: 12, fontFamily: F.displayBold, fontSize: 26, color: C.white, textAlign: 'center' }}>Test ad</Text>
        <Text style={{ marginTop: 8, fontFamily: F.body, fontSize: 15, color: w(0.7), textAlign: 'center' }}>Simulated for development. Real ads from Google AdMob appear only in app builds.</Text>
      </Animated.View>
    </Modal>
  );
}
