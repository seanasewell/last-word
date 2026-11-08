// Settings (Profile → gear): account, ads, preferences, help, developer tools,
// sign out and delete account. Moved here unchanged from the Profile tab.
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { accounts, type Account } from '@/lib/account';
import { sendFeedback, type FeedbackKind } from '@/lib/feedback';
import { myBlocks, unblockPlayer, type BlockedPlayer } from '@/lib/moderation';
import { PRIVACY_URL, SHOW_DEV_TOOLS, SUPPORT_URL, TERMS_URL } from '@/lib/release';
import { scoreWord } from '@/lib/words';
import { cleanName, DevControls, NAME_MAX, nameError } from './Auth';
import { Avatar, Button, s, Segmented, Sheet, TextField, toast, Toggle } from './kit';
import { nav } from './nav';
import { pickPhoto } from './photo';
import { LevelingGuide } from './Progress';
import { AdvertisementsSection } from './RemoveAds';
import { PROVIDER_NAME, SaveProgressCard } from './SignIn';
import { musicEnabled, onSoundChange, setMusicEnabled, setSoundEnabled, soundEnabled } from './sound';
import { C, F, w } from './theme';

/** Points for each word length (Settings → How scoring works). */
function ScoringGuide() {
  return (
    <View>
      <Text style={[s.body, { fontSize: 14 }]}>Longer words score more points.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
        {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => (
          <View key={n} style={{ width: '18.4%', alignItems: 'center', paddingVertical: 6, borderRadius: 12, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder }}>
            <Text style={{ fontFamily: F.body, fontSize: 10, color: w(0.65) }}>{n}{n === 11 ? '+' : ''} letters</Text>
            <Text style={{ fontFamily: F.displayBold, fontSize: 15, color: C.white }}>{scoreWord('x'.repeat(n))}</Text>
          </View>
        ))}
      </View>
      <Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.65), marginTop: 12, lineHeight: 17 }}>{"Each letter can be used as often as it appears in the source. The source word itself doesn't count. No proper nouns, abbreviations or hyphenated words."}</Text>
    </View>
  );
}

/** A menu row's emoji and label, 8px apart. */
export const MenuLabel = ({ emoji, text }: { emoji: string; text: string }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
    <Text style={{ fontSize: 14 }}>{emoji}</Text>
    <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.white }}>{text}</Text>
  </View>
);

export function SettingsScreen({ account }: { account: Account }) {
  const [name, setName] = useState(account.name);
  const [saved, setSaved] = useState(false);
  const [sheet, setSheet] = useState<null | 'photo' | 'delete' | 'signout' | 'dev' | 'blocked' | 'scoring' | 'leveling'>(null);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const choosePhoto = async (source: 'library' | 'camera') => {
    setSheet(null);
    const r = await pickPhoto(source);
    if (!r) return;
    if ('error' in r) { setPhotoErr(r.error); return; }
    setPhotoErr(null);
    const e = await accounts.update({ photo: r.uri });
    if (e) setPhotoErr(e);
  };
  const [sound, setSound] = useState(soundEnabled);
  const [musicOn, setMusicOn] = useState(musicEnabled);
  useEffect(() => onSoundChange(() => { setSound(soundEnabled()); setMusicOn(musicEnabled()); }), []);
  const err = nameError(name);
  const dirty = name.trim() !== account.name;

  const save = () => {
    if (err || !dirty) return;
    accounts.update({ name: name.trim() });
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const remove = async () => {
    setDeleting(true);
    const e = await accounts.deleteAccount();
    setDeleting(false);
    if (e) setDeleteErr(e);
    else setSheet(null);
  };
  const row = { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'space-between' as const, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.divider };
  const group = { borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, overflow: 'hidden' as const };

  return (
    <View>
      {!account.provider && <View style={{ marginTop: 4 }}><SaveProgressCard /></View>}

      <Text style={[s.eyebrow, { marginTop: account.provider ? 4 : 26, marginBottom: 8 }]}>Account</Text>
      <View style={group}>
        {account.provider && (
          <View style={row}>
            <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.75) }}>Signed in with</Text>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: C.white }}>{PROVIDER_NAME[account.provider]}</Text>
          </View>
        )}
        <Pressable onPress={() => setSheet('photo')} accessibilityRole="button" accessibilityLabel={account.photo ? 'Change profile photo' : 'Add profile photo'}
          style={({ pressed }) => [row, { backgroundColor: pressed ? w(0.04) : 'transparent' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar player={{ glyph: account.name[0]?.toUpperCase() ?? 'Y', hue: 210, isYou: true, photo: account.photo }} size={40} />
            <View>
              <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.75) }}>Profile photo</Text>
              {photoErr && <Text style={{ fontFamily: F.body, fontSize: 12, color: C.coral, marginTop: 2 }}>{photoErr}</Text>}
            </View>
          </View>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.primary }}>{account.photo ? 'Change' : 'Add photo'}</Text>
        </Pressable>
        <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
          <Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.7) }}>Display name</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
            <TextField value={name} onChangeText={(t) => setName(cleanName(t))} maxLength={NAME_MAX} autoCorrect={false}
              returnKeyType="done" onSubmitEditing={save} accessibilityLabel="Display name" style={{ flex: 1, height: 44, borderRadius: 12, fontSize: 16 }} />
            <Pressable onPress={save} disabled={!dirty || !!err} style={{ height: 44, paddingHorizontal: 16, borderRadius: 12, justifyContent: 'center', backgroundColor: dirty && !err ? C.primary : C.primaryDisabled }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: (dirty && !err) || saved ? C.white : w(0.5) }}>{saved ? 'Saved ✓' : 'Save'}</Text>
            </Pressable>
          </View>
          {dirty && err && <Text style={{ marginTop: 4, fontFamily: F.body, fontSize: 12, color: C.coral }}>{err}</Text>}
        </View>
      </View>

      <AdvertisementsSection />

      <Text style={[s.eyebrow, { marginTop: 26, marginBottom: 8 }]}>Settings</Text>
      <View style={group}>
        <View style={[row, { paddingVertical: 10 }]}>
          <MenuLabel emoji="🔊" text="Sound effects" />
          <Toggle on={sound} onChange={setSoundEnabled} label="Sound effects" />
        </View>
        <View style={[row, { paddingVertical: 10 }]}>
          <MenuLabel emoji="🎵" text="Music" />
          <Toggle on={musicOn} onChange={setMusicEnabled} label="Music" />
        </View>
        <Pressable onPress={() => setSheet('blocked')} style={[row, { borderBottomWidth: 0 }]}>
          <MenuLabel emoji="🚫" text="Blocked players" />
          <Text style={{ color: w(0.55) }}>›</Text>
        </Pressable>
      </View>

      <Text style={[s.eyebrow, { marginTop: 26, marginBottom: 8 }]}>Help</Text>
      <View style={group}>
        <Pressable onPress={() => setSheet('scoring')} style={row}>
          <MenuLabel emoji="🤔" text="How scoring works" />
          <Text style={{ color: w(0.55) }}>›</Text>
        </Pressable>
        <Pressable onPress={() => setSheet('leveling')} style={row}>
          <MenuLabel emoji="⭐" text="How leveling works" />
          <Text style={{ color: w(0.55) }}>›</Text>
        </Pressable>
        <Pressable onPress={() => nav.push({ name: 'feedback' })} style={row}>
          <MenuLabel emoji="💡" text="Send feedback" />
          <Text style={{ color: w(0.55) }}>›</Text>
        </Pressable>
        <Pressable onPress={() => { void Linking.openURL(SUPPORT_URL); }} style={row}>
          <MenuLabel emoji="💬" text="Help and support" />
          <Text style={{ color: w(0.55) }}>↗</Text>
        </Pressable>
        <Pressable onPress={() => { void Linking.openURL(PRIVACY_URL); }} style={row}>
          <MenuLabel emoji="🔒" text="Privacy policy" />
          <Text style={{ color: w(0.55) }}>↗</Text>
        </Pressable>
        <Pressable onPress={() => { void Linking.openURL(TERMS_URL); }} style={[row, { borderBottomWidth: 0 }]}>
          <MenuLabel emoji="📄" text="Terms of use" />
          <Text style={{ color: w(0.55) }}>↗</Text>
        </Pressable>
      </View>

      {SHOW_DEV_TOOLS && (
        <>
          <Text style={[s.eyebrow, { marginTop: 26, marginBottom: 8 }]}>Developer</Text>
          <Pressable onPress={() => setSheet('dev')} style={{ flexDirection: 'row', justifyContent: 'space-between', borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder, paddingHorizontal: 16, paddingVertical: 14 }}>
            <MenuLabel emoji="🛠" text="Developer controls" />
            <Text style={{ color: w(0.55) }}>›</Text>
          </Pressable>
        </>
      )}

      <View style={{ gap: 10, marginTop: 26 }}>
        {account.provider && (
          <Pressable onPress={() => setSheet('signout')} style={{ height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: C.card, borderWidth: 1, borderColor: C.cardBorder }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: C.white }}>Sign out</Text>
          </Pressable>
        )}
        <Pressable onPress={() => setSheet('delete')} style={{ height: 48, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: F.bodyBold, fontSize: 16, color: C.coral }}>Delete account</Text>
        </Pressable>
      </View>

      <Sheet open={sheet === 'photo'} onClose={() => setSheet(null)} title="Profile photo">
        <View style={{ gap: 10 }}>
          <Button title="Choose from library" onPress={() => void choosePhoto('library')} />
          <Button title="Take a photo" variant="ghost" onPress={() => void choosePhoto('camera')} />
          {account.photo && (
            <Pressable onPress={() => { void accounts.update({ photo: null }); setSheet(null); }} style={{ alignItems: 'center', paddingVertical: 10 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.coral }}>Remove photo</Text>
            </Pressable>
          )}
        </View>
      </Sheet>
      <Sheet open={sheet === 'scoring'} onClose={() => setSheet(null)} title="How scoring works">
        <ScoringGuide />
        <Button title="Close" variant="ghost" style={{ marginTop: 20 }} onPress={() => setSheet(null)} />
      </Sheet>
      <Sheet open={sheet === 'leveling'} onClose={() => setSheet(null)} title="How leveling works">
        <LevelingGuide />
        <Button title="Close" variant="ghost" style={{ marginTop: 12 }} onPress={() => setSheet(null)} />
      </Sheet>
      <Sheet open={sheet === 'signout'} onClose={() => setSheet(null)} title="Sign out?">
        <Text style={s.body}>{`Your progress is saved. Sign in with ${account.provider ? PROVIDER_NAME[account.provider] : ''} to pick up where you left off.`}</Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
          <Button title="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => setSheet(null)} />
          <Button title="Sign out" style={{ flex: 1 }} onPress={() => { setSheet(null); void accounts.signOut(); }} />
        </View>
      </Sheet>
      <Sheet open={sheet === 'delete'} onClose={() => setSheet(null)} title="Delete your account?">
        <Text style={s.body}>{"This permanently removes your profile, photo, wins, level, achievements, friends and challenges. This can't be undone."}</Text>
        {deleteErr && <Text style={{ marginTop: 10, fontFamily: F.body, fontSize: 13, color: C.coral }}>{deleteErr}</Text>}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
          <Button title="Cancel" variant="ghost" style={{ flex: 1 }} onPress={() => { setDeleteErr(null); setSheet(null); }} />
          <Button title={deleting ? 'Deleting…' : 'Delete account'} variant="danger" disabled={deleting} style={{ flex: 1 }} onPress={remove} />
        </View>
      </Sheet>
      {SHOW_DEV_TOOLS && <DevControls open={sheet === 'dev'} onClose={() => setSheet(null)} signedIn />}
      <BlockedPlayers open={sheet === 'blocked'} onClose={() => setSheet(null)} />
    </View>
  );
}

// ── Blocked players ────────────────────────────────────────────────────────
function BlockedPlayers({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [list, setList] = useState<BlockedPlayer[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    myBlocks().then((l) => { if (live) { setList(l); setErr(null); } }).catch(() => { if (live) setErr("Couldn't load your blocked players."); });
    return () => { live = false; };
  }, [open]);
  const unblock = async (id: string) => {
    const e = await unblockPlayer(id);
    if (e) setErr(e); else setList((l) => (l ?? []).filter((x) => x.userId !== id));
  };
  return (
    <Sheet open={open} onClose={onClose} title="Blocked players">
      {err && <Text style={{ fontFamily: F.body, fontSize: 13, color: C.coral, marginBottom: 8 }}>{err}</Text>}
      {!list && !err && <ActivityIndicator color={C.primary} style={{ marginVertical: 16 }} />}
      {list && list.length === 0 && <Text style={s.body}>{"You haven't blocked anyone. To block a player, open their profile from the ranks, your friends or a match's results."}</Text>}
      <ScrollView style={{ maxHeight: 380 }}>
        {(list ?? []).map((b) => (
          <View key={b.userId} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
            <Avatar player={{ glyph: b.name[0]?.toUpperCase() ?? '?', hue: 210, photo: b.photo }} size={36} />
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 15, color: C.white }}>{b.name}</Text>
            <Pressable onPress={() => void unblock(b.userId)} hitSlop={8}><Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.primary }}>Unblock</Text></Pressable>
          </View>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const FEEDBACK_MAX = 2000;
const FEEDBACK_KINDS: { id: FeedbackKind; label: string }[] = [
  { id: 'idea', label: '💡 Idea' },
  { id: 'problem', label: '🐞 Problem' },
  { id: 'other', label: '💬 Other' },
];
const FEEDBACK_HINT: Record<FeedbackKind, string> = {
  idea: 'What would make Last Word better?',
  problem: 'What happened? What did you expect instead?',
  other: 'What’s on your mind?',
};

/** Settings → Send feedback: a short note to the developer. */
export function FeedbackScreen() {
  const [kind, setKind] = useState<FeedbackKind>('idea');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = text.trim().length > 0 && !busy;
  const send = async () => {
    if (!ready) return;
    setBusy(true);
    const e = await sendFeedback(kind, text);
    setBusy(false);
    if (e) { toast.show(e); return; }
    nav.pop();
    toast.success('Thanks! Your feedback was sent.');
  };
  return (
    <View style={{ gap: 14 }}>
      <Text style={{ fontFamily: F.body, fontSize: 14, lineHeight: 20, color: w(0.75) }}>Ideas, bugs, anything. Every note is read.</Text>
      <Segmented options={FEEDBACK_KINDS} value={kind} onChange={setKind} />
      <View>
        <TextField value={text} onChangeText={(t) => setText(t.slice(0, FEEDBACK_MAX))} multiline textAlignVertical="top"
          placeholder={FEEDBACK_HINT[kind]} accessibilityLabel="Your feedback" autoFocus
          style={{ height: 180, borderRadius: 16, fontSize: 16, lineHeight: 22, paddingTop: 14, paddingBottom: 14, letterSpacing: 0 }} />
        <Text style={[{ alignSelf: 'flex-end', marginTop: 6, fontFamily: F.body, fontSize: 12, color: w(0.5) }, s.tabular]}>{text.length} / {FEEDBACK_MAX}</Text>
      </View>
      <Button title={busy ? 'Sending…' : 'Send feedback'} disabled={!ready} onPress={() => void send()} />
    </View>
  );
}
