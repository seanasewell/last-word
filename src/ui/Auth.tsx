import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { accounts } from '@/lib/account';
import { nameAllowed } from '@/lib/nameFilter';
import { SHOW_DEV_TOOLS } from '@/lib/release';
import { COUNTRIES, countryByCode } from '@/lib/regions';
import { AnimatedTileLogo } from './AnimatedLogo';
import { Captcha, type CaptchaHandle } from './Captcha';
import { Avatar, Button, FadeUp, OptionSheet, s, Screen, SelectRow, Sheet, TextField, useAuth } from './kit';
import { pickPhoto } from './photo';
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
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16 }}>{children}</ScrollView>
        {footer && <View style={{ paddingHorizontal: 24, paddingBottom: 12, gap: 10 }}>{footer}</View>}
      </KeyboardAvoidingView>
    </Screen>
  );
}

// ── Developer controls ─────────────────────────────────────────────────────
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
    <Sheet open={open} onClose={close} title="Developer controls">
      <View style={{ gap: 8 }}>
        {!signedIn && <DevRow title={busy ? 'Starting…' : captchaToken ? 'Skip onboarding' : 'Skip onboarding (checking…)'} sub="Creates a new player named Dev tester in California"
          onPress={busy || !captchaToken ? undefined : () => run(async () => { const err = await accounts.devSkipSignup(captchaToken); onTokenUsed?.(); return err; })} right={<Text style={{ color: w(0.55) }}>→</Text>} />}
        {signedIn && (
          <>
            <DevRow title="Bot difficulty" sub={skill == null ? 'Loading…' : `${skill.toFixed(2)}× · goes up when you win, down when you're knocked out early. Tap to reset`}
              onPress={() => run(async () => { const err = await accounts.devResetBotSkill(); if (!err) setSkill(1); return err; }, false)}
              right={<Text style={{ fontFamily: F.display, color: C.mint }}>{skill == null ? '' : `${skill.toFixed(2)}×`}</Text>} />
            <DevRow title="Restart onboarding" sub="Clears name, photo and region for this account" onPress={() => run(() => accounts.devRestartOnboarding())} right={<Text style={{ color: w(0.55) }}>→</Text>} />
          </>
        )}
        <DevRow danger armed={confirmReset} title={confirmReset ? 'Tap again to sign out and clear' : 'Reset this phone'} sub="Starts over as a brand-new player. The current one can't be recovered"
          onPress={() => { if (confirmReset) run(() => accounts.devResetAll()); else setConfirmReset(true); }} />
        {msg && <Text style={{ fontFamily: F.body, fontSize: 13, color: C.coral, marginTop: 4 }}>{msg}</Text>}
      </View>
    </Sheet>
  );
}

// ── Welcome ────────────────────────────────────────────────────────────────
export function AuthFlow() {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dev, setDev] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false); // tapped Play before the check finished
  const captcha = useRef<CaptchaHandle>(null);

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
  const play = () => {
    if (starting) return;
    setError(null);
    if (token) { void begin(token); return; }
    setWaiting(true);
    captcha.current?.reset();
  };
  const onToken = (t: string | null) => {
    setToken(t);
    if (t && waiting) { setWaiting(false); void begin(t); }
  };
  const onCaptchaError = (m: string) => { setWaiting(false); setError(m); };

  return (
    <Screen>
      <View style={{ flex: 1, paddingHorizontal: 24 }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 40 }}>
          <AnimatedTileLogo size={38} />
          <FadeUp delay={450}><Text style={[s.body, { textAlign: 'center', marginTop: 14, maxWidth: 300 }]}>{"The addicting word game where you find words within a word. It's really that easy."}</Text></FadeUp>
        </View>
        <View style={{ gap: 10, paddingBottom: 8 }}>
          <Captcha ref={captcha} onToken={onToken} onError={onCaptchaError} />
          {error && <Text style={{ textAlign: 'center', fontFamily: F.body, fontSize: 14, color: C.coral }}>{error}</Text>}
          <Button title={starting || waiting ? 'Starting…' : 'Play'} disabled={starting || waiting} onPress={play} />
{SHOW_DEV_TOOLS && (
          <Pressable onPress={() => setDev(true)} hitSlop={10} style={{ alignSelf: 'center', paddingTop: 10 }}>
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
  const [sheet, setSheet] = useState<null | 'country' | 'region'>(null);
  const [uploading, setUploading] = useState(false);
  if (!account) return null;
  const country = countryByCode(account.country);
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
      {[0, 1, 2].map((i) => <View key={i} style={{ height: 6, width: i === step ? 24 : 6, borderRadius: 3, backgroundColor: i === step ? C.primary : i < step ? 'rgba(61,139,255,0.6)' : w(0.15) }} />)}
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

  if (step === 1) {
    return (
      <Step footer={account.photo ? <>
        <Button title={uploading ? 'Uploading…' : 'Continue'} disabled={uploading} onPress={() => setStep(2)} />
        <Button title="Choose a different photo" variant="ghost" onPress={() => choose('library')} />
      </> : <>
        <Button title="Choose a photo" onPress={() => choose('library')} />
        <Button title="Take a photo" variant="ghost" onPress={() => choose('camera')} />
        <Pressable onPress={() => setStep(2)} hitSlop={8} style={{ alignSelf: 'center', paddingTop: 4 }}><Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: w(0.72) }}>Skip for now</Text></Pressable>
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

  return (
    <Step footer={<Button title="Start playing" disabled={!account.region} onPress={() => accounts.finishOnboarding()} />}>
      {header}
      <Text style={[s.h1, { marginTop: 20 }]}>Where do you play from?</Text>
      <Text style={[s.body, { marginTop: 8 }]}>Used for your national and {country.regionLabel.toLowerCase()} rankings.</Text>
      <View style={{ gap: 10, marginTop: 24 }}>
        <SelectRow label="Country" value={`${country.flag}  ${country.name}`} placeholder="Country" active={sheet === 'country'} onPress={() => setSheet('country')} />
        <SelectRow label={country.regionLabel} value={account.region} placeholder={`Choose your ${country.regionLabel.toLowerCase()}`} active={sheet === 'region'} onPress={() => setSheet('region')} />
      </View>
      <OptionSheet open={sheet === 'country'} onClose={() => setSheet(null)} title="Country" value={account.country}
        options={COUNTRIES.map((x) => ({ value: x.code, label: `${x.flag}  ${x.name}` }))} onPick={(v) => accounts.update({ country: v, region: '' })} />
      <OptionSheet open={sheet === 'region'} onClose={() => setSheet(null)} title={country.regionLabel} value={account.region}
        options={country.regions.map((r) => ({ value: r, label: r }))} onPick={(v) => accounts.update({ region: v })} />
    </Step>
  );
}
