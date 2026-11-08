import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { accounts } from '@/lib/account';
import { engine } from '@/lib/engine';
import { nameAllowed } from '@/lib/nameFilter';
import { ads, setSimAdFails, simAdFails, useAdCounter } from '@/lib/ads';
import { GAMES_PER_AD } from '@/lib/monetizationConfig';
import { purchases, setSimOutcome, simOutcome, useAdFree, type SimOutcome } from '@/lib/purchases';
import { PRIVACY_URL, SHOW_DEV_TOOLS, TERMS_URL } from '@/lib/release';
import type { Provider } from '@/lib/social';
import { AnimatedTileLogo } from './AnimatedLogo';
import { Captcha, type CaptchaHandle } from './Captcha';
import { Avatar, Button, FadeUp, s, Screen, Sheet, TextField, useAuth } from './kit';
import { pickPhoto } from './photo';
import { DevLevelTiers } from './Progress';
import { ProviderButtons } from './SignIn';
import { C, F, w } from './theme';

const BackButton = ({ onPress }: { onPress: () => void }) => (
  <Pressable onPress={onPress} accessibilityLabel="Back" hitSlop={12} style={{ width: 40, height: 40, justifyContent: 'center' }}>
    <Text style={{ fontSize: 30, color: w(0.75), marginTop: -4 }}>‹</Text>
  </Pressable>
);

/** Keyboard-aware page with a scrolling body and a footer pinned above the keyboard. */
function Step({ children, footer }: { children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 16 }}>{children}</ScrollView>
        {footer && <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 10 }}>{footer}</View>}
      </KeyboardAvoidingView>
    </Screen>
  );
}

// ── Developer controls ─────────────────────────────────────────────────────
/** Testing ads and the Remove ads purchase (simulated in Expo Go; test ads in internal builds). */
function AdDevRows() {
  const counter = useAdCounter();
  const st = useAdFree();
  const [outcome, setOutcome] = useState(simOutcome);
  const [adFails, setAdFails] = useState(simAdFails);
  const next: Record<SimOutcome, SimOutcome> = { success: 'fail', fail: 'cancel', cancel: 'success' };
  const label: Record<SimOutcome, string> = { success: 'Succeeds', fail: 'Fails', cancel: 'Is cancelled' };
  return (
    <>
      <DevRow title={`Ad counter: ${counter.count} / ${GAMES_PER_AD}`} sub={`Ads: ${counter.provider} · ${st.adFree ? 'ad-free, no ads' : 'tap to make an ad due now (also skips the 1-minute launch wait)'}`}
        onPress={() => { ads.devSetCount(GAMES_PER_AD); ads.devIgnoreLaunchDelay(); ads.warmUp(); }} right={<Text style={{ color: w(0.55) }}>→</Text>} />
      {counter.provider === 'simulated' && (
        <DevRow title={`Test ad: ${adFails ? 'fails to load' : 'loads'}`} sub="Tap to switch; a failing ad lets play continue without one"
          onPress={() => { setSimAdFails(!adFails); setAdFails(!adFails); }} />
      )}
      {st.provider === 'simulated' && (
        <>
          <DevRow title={`Test purchase: ${label[outcome]}`} sub="Tap to switch what the next simulated Remove ads purchase does"
            onPress={() => { const o = next[outcome]; setSimOutcome(o); setOutcome(o); }} />
          <DevRow title="Undo test purchase" sub={st.adFree ? 'Brings ads back on this phone' : 'No test purchase yet'} onPress={() => purchases.devResetSimulated()} />
        </>
      )}
    </>
  );
}

function DevRow({ title, sub, onPress, right, danger, armed }: { title: string; sub: string; onPress?: () => void; right?: React.ReactNode; danger?: boolean; armed?: boolean }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, backgroundColor: armed ? 'rgba(255,93,115,0.15)' : w(0.05), paddingHorizontal: 16, paddingVertical: 14 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: danger ? C.coral : C.white }}>{title}</Text>
        <Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.7), marginTop: 2 }}>{sub}</Text>
      </View>
      {right}
    </Pressable>
  );
}

export function DevControls({ open, onClose, signedIn, captchaToken, onTokenUsed }: {
  open: boolean; onClose: () => void; signedIn: boolean;
  /** Needed to create a player while signed out. */
  captchaToken?: string | null; onTokenUsed?: () => void;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const close = () => { setConfirmReset(false); setMsg(null); onClose(); };
  const [skill, setSkill] = useState<number | null>(null);
  useEffect(() => {
    if (!open || !signedIn) return;
    let live = true;
    void accounts.devBotSkill().then((v) => { if (live) setSkill(v); });
    return () => { live = false; };
  }, [open, signedIn]);
  const run = async (fn: () => Promise<string | null | void>, closeAfter = true) => {
    setBusy(true); setMsg(null);
    const err = await fn();
    setBusy(false);
    if (err) setMsg(err);
    else if (closeAfter) close();
  };
  return (
    <Sheet open={open} onClose={close} title="Developer controls" tall={signedIn}>
      {/* Scrolls: there are more controls than fit on a small phone. */}
      <ScrollView style={signedIn ? { flex: 1 } : undefined} contentContainerStyle={{ gap: 8, paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
        {!signedIn && <DevRow title={busy ? 'Starting…' : captchaToken ? 'Skip onboarding' : 'Skip onboarding (checking…)'} sub="Creates a new player named Dev tester"
          onPress={busy || !captchaToken ? undefined : () => run(async () => { const err = await accounts.devSkipSignup(captchaToken); onTokenUsed?.(); return err; })} right={<Text style={{ color: w(0.55) }}>→</Text>} />}
        {signedIn && (
          <>
            <DevRow title="Bot difficulty" sub={skill == null ? 'Loading…' : `${skill.toFixed(2)}× · goes up when you win, down when you're knocked out early`}
              right={<Text style={{ fontFamily: F.display, color: C.mint }}>{skill == null ? '' : `${skill.toFixed(2)}×`}</Text>} />
            <DevRow title="Jump to the championship round" sub="A 1v1 against a bot, as if you'd survived rounds 1–4. Played on this phone only; not counted toward ranks or XP"
              onPress={() => { onClose(); engine.devStartChampionship(); }} right={<Text style={{ color: w(0.55) }}>→</Text>} />
            <DevRow title="Restart onboarding" sub="Clears name and photo for this account" onPress={() => run(() => accounts.devRestartOnboarding())} right={<Text style={{ color: w(0.55) }}>→</Text>} />
            <DevLevelTiers />
            <AdDevRows />
          </>
        )}
        <DevRow danger armed={confirmReset} title={confirmReset ? 'Tap again to sign out and clear' : 'Reset this phone'} sub="Signs out and clears this phone. A guest player can't be recovered"
          onPress={() => { if (confirmReset) run(() => accounts.devResetAll()); else setConfirmReset(true); }} />
        {msg && <Text style={{ fontFamily: F.body, fontSize: 13, color: C.coral, marginTop: 4 }}>{msg}</Text>}
      </ScrollView>
    </Sheet>
  );
}

// ── Welcome ────────────────────────────────────────────────────────────────
export function AuthFlow() {
  const [starting, setStarting] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dev, setDev] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false); // tapped Play before the check finished
  const captcha = useRef<CaptchaHandle>(null);
  const busy = starting || waiting || signingIn;

  const begin = async (t: string) => {
    setStarting(true);
    setError(null);
    const err = await accounts.start(t);
    setStarting(false);
    if (err) {
      setError(err);
      captcha.current?.reset(); // tokens work once; get a new one
    }
  };
  const guest = () => {
    if (busy) return;
    setError(null);
    if (token) { void begin(token); return; }
    setWaiting(true);
    captcha.current?.reset();
  };
  const signIn = async (p: Provider) => {
    if (busy) return;
    setSigningIn(true);
    setError(null);
    const r = await accounts.signIn(p, token);
    setSigningIn(false);
    if (r.kind === 'error') setError(r.message);
    if (token) captcha.current?.reset();
  };
  const onToken = (t: string | null) => {
    setToken(t);
    if (t && waiting) { setWaiting(false); void begin(t); }
  };
  const onCaptchaError = (m: string) => { setWaiting(false); setError(m); };

  return (
    <Screen>
      <View style={{ flex: 1, paddingHorizontal: 12 }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 40 }}>
          <AnimatedTileLogo size={38} />
          <FadeUp delay={450}><Text style={[s.body, { textAlign: 'center', marginTop: 14, maxWidth: 300 }]}>{'The simple but addicting game where you find words within a word.'}</Text></FadeUp>
        </View>
        <View style={{ gap: 10, paddingBottom: 8 }}>
          <Captcha ref={captcha} onToken={onToken} onError={onCaptchaError} />
          {error && <Text style={{ textAlign: 'center', fontFamily: F.body, fontSize: 14, color: C.coral }}>{error}</Text>}
          <ProviderButtons busy={busy} onPick={(p) => { void signIn(p); }} />
          <Button title={starting || waiting ? 'Starting…' : 'Play as a guest'} variant="ghost" disabled={busy} onPress={guest} />
          <Text style={{ textAlign: 'center', fontFamily: F.body, fontSize: 12, lineHeight: 17, color: w(0.6) }}>
            {'Played before? Sign in with the same account to pick up where you left off.\n'}
            By continuing, you agree to our{' '}
            <Text onPress={() => { void Linking.openURL(TERMS_URL); }} style={{ color: w(0.85), textDecorationLine: 'underline' }}>Terms of use</Text> and{' '}
            <Text onPress={() => { void Linking.openURL(PRIVACY_URL); }} style={{ color: w(0.85), textDecorationLine: 'underline' }}>Privacy policy</Text>.
          </Text>
          {SHOW_DEV_TOOLS && (
            <Pressable onPress={() => setDev(true)} hitSlop={10} style={{ alignSelf: 'center', paddingTop: 6 }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: w(0.6) }}>🛠 Developer controls</Text>
            </Pressable>
          )}
        </View>
      </View>
      {SHOW_DEV_TOOLS && <DevControls open={dev} onClose={() => setDev(false)} signedIn={false} captchaToken={token} onTokenUsed={() => captcha.current?.reset()} />}
    </Screen>
  );
}

// ── Onboarding ─────────────────────────────────────────────────────────────
const NAME_MAX = 14;
export const cleanName = (n: string) => n.replace(/[^\p{L}\p{N} _.'-]/gu, '').replace(/\s+/g, ' ').slice(0, NAME_MAX);
export const nameError = (n: string) => (n.trim().length < 2 ? 'Use at least 2 characters.' : !nameAllowed(n) ? "That name isn't allowed. Try another." : null);
export { NAME_MAX };

export function Onboarding() {
  const { account } = useAuth();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(account?.name ?? '');
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  if (!account) return null;
  const nErr = nameError(name);

  const choose = async (source: 'library' | 'camera') => {
    const r = await pickPhoto(source);
    if (!r) return;
    if ('error' in r) { setPhotoErr(r.error); return; }
    setPhotoErr(null);
    setUploading(true);
    const err = await accounts.update({ photo: r.uri });
    setUploading(false);
    if (err) setPhotoErr(err);
  };

  const dots = (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {[0, 1].map((i) => <View key={i} style={{ height: 6, width: i === step ? 24 : 6, borderRadius: 3, backgroundColor: i === step ? C.primary : i < step ? 'rgba(61,139,255,0.6)' : w(0.15) }} />)}
    </View>
  );
  const header = (
    <View style={{ height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      {step > 0 ? <BackButton onPress={() => setStep(step - 1)} /> : <View style={{ width: 40 }} />}
      {dots}
      <View style={{ width: 40 }} />
    </View>
  );

  if (step === 0) {
    return (
      <Step footer={<Button title="Continue" disabled={!!nErr} onPress={() => { accounts.update({ name: name.trim() }); setStep(1); }} />}>
        {header}
        <Text style={[s.h1, { marginTop: 20 }]}>Pick a display name</Text>
        <Text style={[s.body, { marginTop: 8 }]}>This is how other players see you in matches and on the ranks.</Text>
        <TextField autoFocus value={name} onChangeText={(t) => setName(cleanName(t))} maxLength={NAME_MAX} placeholder="Display name"
          autoCorrect={false} keyboardAppearance="dark" returnKeyType="next" accessibilityLabel="Display name"
          onSubmitEditing={() => { if (!nErr) { accounts.update({ name: name.trim() }); setStep(1); } }} style={{ marginTop: 24 }} />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
          <Text style={{ fontFamily: F.body, fontSize: 12, color: C.coral }}>{name.trim().length >= 2 && nErr ? nErr : ''}</Text>
          <Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.6) }}>{name.length}/{NAME_MAX}</Text>
        </View>
      </Step>
    );
  }

  return (
    <Step footer={account.photo ? <>
      <Button title={uploading ? 'Uploading…' : 'Start playing'} disabled={uploading} onPress={() => accounts.finishOnboarding()} />
      <Button title="Choose a different photo" variant="ghost" onPress={() => choose('library')} />
    </> : <>
      <Button title="Choose a photo" onPress={() => choose('library')} />
      <Button title="Take a photo" variant="ghost" onPress={() => choose('camera')} />
      <Pressable onPress={() => accounts.finishOnboarding()} hitSlop={8} style={{ alignSelf: 'center', paddingTop: 4 }}><Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: w(0.72) }}>Skip for now</Text></Pressable>
    </>}>
      {header}
      <Text style={[s.h1, { marginTop: 20 }]}>Add a photo</Text>
      <Text style={[s.body, { marginTop: 8 }]}>Add a picture of yourself. It appears next to your name in matches and ranks.</Text>
      <View style={{ alignItems: 'center', marginTop: 36 }}>
        <Avatar player={{ glyph: account.name[0]?.toUpperCase() ?? '?', hue: 210, isYou: true, photo: account.photo }} size={148} ring />
      </View>
      {photoErr && <Text style={{ textAlign: 'center', marginTop: 14, fontFamily: F.body, fontSize: 14, color: C.coral }}>{photoErr}</Text>}
    </Step>
  );
}
