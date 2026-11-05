import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View, type TextInputInstance } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { accounts } from '@/lib/account';
import { COUNTRIES, countryByCode, formatPhone } from '@/lib/regions';
import { AnimatedTileLogo } from './AnimatedLogo';
import { Avatar, Button, FadeUp, inputStyle, OptionSheet, s, Screen, SelectRow, Sheet, Toggle, useAuth, useNow } from './kit';
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
        <Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.55), marginTop: 2 }}>{sub}</Text>
      </View>
      {right}
    </Pressable>
  );
}

export function DevControls({ open, onClose, signedIn }: { open: boolean; onClose: () => void; signedIn: boolean }) {
  const auth = useAuth();
  const [confirmReset, setConfirmReset] = useState(false);
  const close = () => { setConfirmReset(false); onClose(); };
  return (
    <Sheet open={open} onClose={close} title="Developer controls">
      <View style={{ gap: 8 }}>
        {!signedIn && <DevRow title="Skip sign-up and onboarding" sub="Signs in as “Dev tester” · +1 555-555-0100 · California" onPress={() => { accounts.devSkipSignup(); close(); }} right={<Text style={{ color: w(0.4) }}>→</Text>} />}
        {signedIn && (
          <>
            <DevRow title="Add a win this week" sub="Test how you move up the ranks" onPress={() => { accounts.devAddWin(); Haptics.selectionAsync().catch(() => {}); }} right={<Text style={{ fontFamily: F.display, color: C.mint }}>+1</Text>} />
            <DevRow title="Restart onboarding" sub="Clears name, photo and region for this account" onPress={() => { accounts.devRestartOnboarding(); close(); }} right={<Text style={{ color: w(0.4) }}>→</Text>} />
          </>
        )}
        <DevRow title="Auto-fill verification codes" sub="Enters the code for you after it's “sent”" right={<Toggle on={auth.autofillCode} onChange={(v) => accounts.devSetAutofill(v)} label="Auto-fill verification codes" />} />
        <DevRow danger armed={confirmReset} title={confirmReset ? 'Tap again to erase everything' : 'Reset all app data'} sub="Removes every account, stat and setting on this phone"
          onPress={() => { if (confirmReset) { accounts.devResetAll(); close(); } else setConfirmReset(true); }} />
      </View>
    </Sheet>
  );
}

// ── Simulated text-message banner ──────────────────────────────────────────
function SmsBanner({ onUse }: { onUse: (code: string) => void }) {
  const { sms } = useAuth();
  const y = useSharedValue(-160);
  useEffect(() => {
    if (!sms) return;
    y.set(withSpring(0, { damping: 16 }));
    const t = setTimeout(() => accounts.dismissSms(), 9000);
    return () => clearTimeout(t);
  }, [sms, y]);
  const st = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));
  if (!sms) return null;
  return (
    <Animated.View style={[{ position: 'absolute', left: 10, right: 10, top: 6, zIndex: 40 }, st]}>
      <Pressable onPress={() => { onUse(sms.code); accounts.dismissSms(); }} accessibilityLabel="Message with your code. Tap to fill it in."
        style={{ flexDirection: 'row', gap: 12, borderRadius: 22, borderWidth: 1, borderColor: w(0.1), backgroundColor: 'rgba(35,38,58,0.97)', padding: 12, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 12 } }}>
        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#29C64B', alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: 18 }}>💬</Text></View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 13, color: C.white }}>Messages</Text>
            <Text style={{ fontFamily: F.body, fontSize: 13, color: w(0.45) }}>now</Text>
          </View>
          <Text style={{ fontFamily: F.body, fontSize: 13, lineHeight: 18, color: w(0.88) }}>{sms.text}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ── Sign-up / log-in ───────────────────────────────────────────────────────
type AuthStep = 'welcome' | 'phone' | 'code';

export function AuthFlow() {
  const [step, setStep] = useState<AuthStep>('welcome');
  const [mode, setMode] = useState<'create' | 'login'>('create');
  const [country, setCountry] = useState('US');
  const [digits, setDigits] = useState('');
  const [error, setError] = useState<{ text: string; action?: boolean } | null>(null);
  const [dev, setDev] = useState(false);
  const [pickCountry, setPickCountry] = useState(false);
  const c = countryByCode(country);
  const valid = c.digits.includes(digits.length);

  const sendCode = () => {
    if (!valid) return;
    if (mode === 'login' && !accounts.exists(`${c.dial}${digits}`)) {
      setError({ text: 'No account uses this number yet.', action: true });
      return;
    }
    accounts.requestCode(country, digits);
    setError(null);
    setStep('code');
  };

  if (step === 'welcome') {
    return (
      <Screen>
        <View style={{ flex: 1, paddingHorizontal: 24 }}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 40 }}>
            <AnimatedTileLogo size={38} />
            <FadeUp delay={450}><Text style={[s.body, { textAlign: 'center', marginTop: 14, maxWidth: 260 }]}>The word game where only the last one standing wins.</Text></FadeUp>
          </View>
          <View style={{ gap: 10, paddingBottom: 8 }}>
            <Button title="Create account" onPress={() => { setMode('create'); setStep('phone'); }} />
            <Button title="Log in" variant="ghost" onPress={() => { setMode('login'); setStep('phone'); }} />
            <Pressable onPress={() => setDev(true)} hitSlop={10} style={{ alignSelf: 'center', paddingTop: 10 }}>
              <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: w(0.45) }}>🛠 Developer controls</Text>
            </Pressable>
          </View>
        </View>
        <DevControls open={dev} onClose={() => setDev(false)} signedIn={false} />
      </Screen>
    );
  }

  if (step === 'phone') {
    return (
      <Step footer={<>
        <Button title="Send code" onPress={sendCode} disabled={!valid} />
        <Text style={{ textAlign: 'center', fontFamily: F.body, fontSize: 12, color: w(0.45) }}>{"We'll send a 6-digit verification code by text."}</Text>
      </>}>
        <BackButton onPress={() => { setStep('welcome'); setError(null); }} />
        <Text style={[s.h1, { marginTop: 12 }]}>{mode === 'create' ? 'Create your account' : 'Welcome back'}</Text>
        <Text style={[s.body, { marginTop: 8 }]}>{mode === 'create' ? "Enter your phone number. We'll text you a code to make sure it's you." : 'Enter the phone number on your account to get a sign-in code.'}</Text>
        <Text style={{ fontFamily: F.bodySemi, fontSize: 12, color: w(0.55), marginTop: 28, marginBottom: 6 }}>Phone number</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Pressable onPress={() => setPickCountry(true)} accessibilityLabel="Country code"
            style={[inputStyle, { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14 }]}>
            <Text style={{ fontSize: 18 }}>{c.flag}</Text>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 16, color: C.white }}>{c.dial}</Text>
            <Text style={{ color: w(0.45), fontSize: 12 }}>▾</Text>
          </Pressable>
          <TextInput
            autoFocus value={formatPhone(c, digits)} onChangeText={(t) => { setDigits(t.replace(/\D/g, '').replace(/^0/, '').slice(0, Math.max(...c.digits))); setError(null); }}
            keyboardType="number-pad" textContentType="telephoneNumber" autoComplete="tel-national" keyboardAppearance="dark"
            placeholder={c.dial === '+1' ? '(555) 123-4567' : 'Phone number'} placeholderTextColor={w(0.3)} accessibilityLabel="Phone number"
            onSubmitEditing={sendCode} style={[inputStyle, { flex: 1, letterSpacing: 0.5 }]} />
        </View>
        {error && (
          <View style={{ marginTop: 12, borderRadius: 12, backgroundColor: 'rgba(255,93,115,0.1)', padding: 12 }}>
            <Text style={{ fontFamily: F.body, fontSize: 14, color: C.coral }}>{error.text}</Text>
            {error.action && <Pressable onPress={() => { setMode('create'); setError(null); }}><Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.white, marginTop: 4, textDecorationLine: 'underline' }}>Create an account instead</Text></Pressable>}
          </View>
        )}
        <OptionSheet open={pickCountry} onClose={() => setPickCountry(false)} title="Country"
          options={COUNTRIES.map((x) => ({ value: x.code, label: `${x.flag}  ${x.name}  ${x.dial}` }))} value={country}
          onPick={(v) => { setCountry(v); setDigits(''); setError(null); }} />
      </Step>
    );
  }

  return <CodeStep phoneLabel={`${c.dial} ${formatPhone(c, digits)}`} onBack={() => setStep('phone')} onResend={() => accounts.requestCode(country, digits)} />;
}

function CodeStep({ phoneLabel, onBack, onResend }: { phoneLabel: string; onBack: () => void; onResend: () => void }) {
  const auth = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInputInstance>(null);
  const shake = useSharedValue(0);
  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.get() }] }));
  const now = useNow(true, 500);
  const wait = Math.max(0, Math.ceil(((auth.pending?.sentAt ?? 0) + 30_000 - now) / 1000));

  const onChange = (v: string) => {
    const d = v.replace(/\D/g, '').slice(0, 6);
    setCode(d);
    setError(null);
    if (d.length < 6) return;
    const r = accounts.verifyCode(d);
    if (r === 'ok') { Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); return; }
    setError(r === 'wrong' ? "That code isn't right. Check the text and try again." : 'That code expired. Send a new one.');
    setCode('');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    shake.set(withSequence(...[-8, 8, -6, 5, 0].map((x) => withTiming(x, { duration: 60 }))));
  };

  const pendingCode = auth.pending?.code;
  useEffect(() => {
    if (!auth.autofillCode || !pendingCode) return;
    const t = setTimeout(() => onChange(pendingCode), 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.autofillCode, pendingCode]);

  return (
    <View style={{ flex: 1 }}>
      <Step>
        <BackButton onPress={onBack} />
        <Text style={[s.h1, { marginTop: 12 }]}>Enter your code</Text>
        <Text style={[s.body, { marginTop: 8 }]}>We texted a 6-digit code to <Text style={{ fontFamily: F.bodyBold, color: C.white }}>{phoneLabel}</Text>.</Text>
        <Pressable onPress={() => inputRef.current?.focus()} style={{ marginTop: 28 }}>
          <Animated.View style={[{ flexDirection: 'row', gap: 8 }, shakeStyle]}>
            {Array.from({ length: 6 }, (_, i) => {
              const active = i === code.length;
              return (
                <View key={i} style={{ flex: 1, height: 58, borderRadius: 16, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(4,10,22,0.7)', borderColor: error ? 'rgba(255,93,115,0.6)' : active ? 'rgba(61,139,255,0.8)' : w(0.1) }}>
                  <Text style={{ fontFamily: F.display, fontSize: 26, color: C.white }}>{code[i] ?? ''}</Text>
                </View>
              );
            })}
          </Animated.View>
          <TextInput ref={inputRef} autoFocus value={code} onChangeText={onChange} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="sms-otp"
            maxLength={6} caretHidden keyboardAppearance="dark" accessibilityLabel="Verification code" style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
        </Pressable>
        <Text style={{ minHeight: 20, marginTop: 12, fontFamily: F.body, fontSize: 14, color: C.coral }}>{error ?? ''}</Text>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
          <Pressable onPress={onBack} hitSlop={8}><Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: w(0.65) }}>Change number</Text></Pressable>
          <Pressable disabled={wait > 0} onPress={() => { onResend(); setCode(''); setError(null); }} hitSlop={8}>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: wait > 0 ? w(0.35) : C.primary }}>{wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}</Text>
          </Pressable>
        </View>
      </Step>
      <SmsBanner onUse={onChange} />
    </View>
  );
}

// ── Onboarding ─────────────────────────────────────────────────────────────
const NAME_MAX = 14;
export const cleanName = (n: string) => n.replace(/[^\p{L}\p{N} _.'-]/gu, '').replace(/\s+/g, ' ').slice(0, NAME_MAX);
export const nameError = (n: string) => (n.trim().length < 2 ? 'Use at least 2 characters.' : null);
export { NAME_MAX };

export function Onboarding() {
  const { account } = useAuth();
  const [step, setStep] = useState(0);
  const [name, setName] = useState(account?.name ?? '');
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | 'country' | 'region'>(null);
  if (!account) return null;
  const country = countryByCode(account.country);
  const nErr = nameError(name);

  const choose = async (source: 'library' | 'camera') => {
    const r = await pickPhoto(source);
    if (!r) return;
    if ('error' in r) setPhotoErr(r.error);
    else { setPhotoErr(null); accounts.update({ photo: r.uri }); }
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
        <TextInput autoFocus value={name} onChangeText={(t) => setName(cleanName(t))} maxLength={NAME_MAX} placeholder="Display name" placeholderTextColor={w(0.3)}
          autoCorrect={false} keyboardAppearance="dark" returnKeyType="next" accessibilityLabel="Display name"
          onSubmitEditing={() => { if (!nErr) { accounts.update({ name: name.trim() }); setStep(1); } }} style={[inputStyle, { marginTop: 24 }]} />
        <Text style={{ alignSelf: 'flex-end', marginTop: 6, fontFamily: F.body, fontSize: 12, color: w(0.45) }}>{name.length}/{NAME_MAX}</Text>
      </Step>
    );
  }

  if (step === 1) {
    return (
      <Step footer={account.photo ? <>
        <Button title="Continue" onPress={() => setStep(2)} />
        <Button title="Choose a different photo" variant="ghost" onPress={() => choose('library')} />
      </> : <>
        <Button title="Choose a photo" onPress={() => choose('library')} />
        <Button title="Take a photo" variant="ghost" onPress={() => choose('camera')} />
        <Pressable onPress={() => setStep(2)} hitSlop={8} style={{ alignSelf: 'center', paddingTop: 4 }}><Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: w(0.6) }}>Skip for now</Text></Pressable>
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
        <SelectRow label="Country" value={`${country.flag}  ${country.name}`} placeholder="Country" onPress={() => setSheet('country')} />
        <SelectRow label={country.regionLabel} value={account.region} placeholder={`Choose your ${country.regionLabel.toLowerCase()}`} onPress={() => setSheet('region')} />
      </View>
      <OptionSheet open={sheet === 'country'} onClose={() => setSheet(null)} title="Country" value={account.country}
        options={COUNTRIES.map((x) => ({ value: x.code, label: `${x.flag}  ${x.name}` }))} onPick={(v) => accounts.update({ country: v, region: '' })} />
      <OptionSheet open={sheet === 'region'} onClose={() => setSheet(null)} title={country.regionLabel} value={account.region}
        options={country.regions.map((r) => ({ value: r, label: r }))} onPick={(v) => accounts.update({ region: v })} />
    </Step>
  );
}
