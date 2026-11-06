// Report or block another (real) player. Opened by tapping them on the ranks
// or in a match's results. Reporting: pick a reason, or "Other" to write one.
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native';

import { blockPlayer, reportPlayer, type ReportReason, type Target } from '@/lib/moderation';
import { Avatar, Button, s, Sheet, TextField } from './kit';
import { C, F, w } from './theme';

export interface PlayerRef { name: string; glyph: string; hue: number; photo?: string | null; target: Target }

type Page = 'menu' | 'reasons' | 'other' | 'done';
const OTHER_MAX = 300;

export function PlayerActions({ player, onClose, onBlocked }: { player: PlayerRef | null; onClose: () => void; onBlocked?: () => void }) {
  const [page, setPage] = useState<Page>('menu');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [other, setOther] = useState('');
  const close = () => { setPage('menu'); setDone(''); setErr(null); setOther(''); onClose(); };
  if (!player) return null;

  const report = async (reason: ReportReason, details?: string) => {
    setBusy(true); setErr(null);
    const e = await reportPlayer(player.target, reason, details);
    setBusy(false);
    if (e) { setErr(e); return; }
    setDone("Thanks for the report. We'll take a look.");
    setPage('done');
  };
  const block = async () => {
    setBusy(true); setErr(null);
    const e = await blockPlayer(player.target);
    setBusy(false);
    if (e) { setErr(e); return; }
    setDone("Blocked. You won't see them on the ranks or be matched with them. You can unblock them in Profile.");
    setPage('done');
    onBlocked?.();
  };
  const row = (label: string, onPress: () => void, opts: { danger?: boolean; chevron?: boolean } = {}) => (
    <Pressable key={label} disabled={busy} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 16, borderWidth: 1, borderColor: C.cardBorder, backgroundColor: pressed ? 'rgba(61,139,255,0.18)' : C.card, paddingHorizontal: 16, paddingVertical: 14, opacity: busy ? 0.6 : 1 })}>
      <Text style={{ flex: 1, fontFamily: F.bodyBold, fontSize: 15, color: opts.danger ? C.coral : C.white }}>{label}</Text>
      {opts.chevron && <Text style={{ color: w(0.55), fontSize: 16 }}>›</Text>}
    </Pressable>
  );
  const back = (to: Page) => (
    <Pressable onPress={() => { setErr(null); setPage(to); }} hitSlop={10} accessibilityRole="button" style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 18, color: C.primary }}>←</Text>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 17, color: C.primary }}>Back</Text>
    </Pressable>
  );
  const error = err ? <Text style={{ fontFamily: F.body, fontSize: 13, color: C.coral, marginTop: 4 }}>{err}</Text> : null;

  return (
    <Sheet open onClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {page !== 'menu' && page !== 'done' && back(page === 'other' ? 'reasons' : 'menu')}
        {page === 'menu' && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <Avatar player={{ glyph: player.glyph, hue: player.hue, photo: player.photo }} size={44} />
            <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.displayBold, fontSize: 20, color: C.white }}>{player.name}</Text>
          </View>
        )}
        {(page === 'reasons' || page === 'other') && (
          <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.75), marginBottom: 12 }}>{page === 'reasons' ? 'Why are you reporting this player?' : 'Tell us what happened'}</Text>
        )}

        {page === 'menu' && (
          <View style={{ gap: 8 }}>
            {row('Report player', () => { setErr(null); setPage('reasons'); }, { chevron: true })}
            {row('Block player', () => void block(), { danger: true })}
            {error}
          </View>
        )}

        {page === 'reasons' && (
          <View style={{ gap: 8 }}>
            {row('Offensive or inappropriate name', () => void report('name'))}
            {player.photo ? row('Offensive or inappropriate photo', () => void report('photo')) : null}
            {row('I believe this player is cheating', () => void report('cheating'))}
            {row('Other', () => { setErr(null); setPage('other'); }, { chevron: true })}
            {error}
          </View>
        )}

        {page === 'other' && (
          <View style={{ gap: 10 }}>
            <TextField value={other} onChangeText={(t) => setOther(t.slice(0, OTHER_MAX))} placeholder="Describe the problem" multiline autoFocus
              style={{ height: 120, paddingTop: 14, textAlignVertical: 'top', fontSize: 16 }} accessibilityLabel="Reason for the report" />
            <Text style={{ alignSelf: 'flex-end', fontFamily: F.body, fontSize: 12, color: w(0.6) }}>{other.length}/{OTHER_MAX}</Text>
            {error}
            <Button title={busy ? 'Sending…' : 'Send report'} disabled={busy || other.trim().length < 3} onPress={() => void report('other', other.trim())} />
          </View>
        )}

        {page === 'done' && (
          <>
            <Text style={[s.body, { fontSize: 16, textAlign: 'center', paddingVertical: 20 }]}>{done}</Text>
            <Pressable onPress={close} style={{ alignItems: 'center', paddingVertical: 12 }}><Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.primary }}>Done</Text></Pressable>
          </>
        )}
      </KeyboardAvoidingView>
    </Sheet>
  );
}
