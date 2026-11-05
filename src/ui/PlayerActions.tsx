// Report or block another (real) player. Opened by tapping them on the ranks
// or in a match's lobby and results.
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { blockPlayer, reportPlayer, type ReportReason, type Target } from '@/lib/moderation';
import { Avatar, s, Sheet } from './kit';
import { C, F, w } from './theme';

export interface PlayerRef { name: string; glyph: string; hue: number; photo?: string | null; target: Target }

export function PlayerActions({ player, onClose, onBlocked }: { player: PlayerRef | null; onClose: () => void; onBlocked?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const close = () => { setDone(null); setErr(null); onClose(); };
  if (!player) return null;

  const report = async (reason: ReportReason) => {
    setBusy(true); setErr(null);
    const e = await reportPlayer(player.target, reason);
    setBusy(false);
    if (e) setErr(e); else setDone("Thanks for the report. We'll take a look.");
  };
  const block = async () => {
    setBusy(true); setErr(null);
    const e = await blockPlayer(player.target);
    setBusy(false);
    if (e) { setErr(e); return; }
    setDone("Blocked. You won't see them on the ranks or be matched with them. You can unblock them in Profile.");
    onBlocked?.();
  };
  const row = (label: string, onPress: () => void, danger = false) => (
    <Pressable key={label} disabled={busy} onPress={onPress}
      style={({ pressed }) => ({ borderRadius: 16, borderWidth: 1, borderColor: C.cardBorder, backgroundColor: pressed ? 'rgba(61,139,255,0.18)' : C.card, paddingHorizontal: 16, paddingVertical: 14, opacity: busy ? 0.6 : 1 })}>
      <Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: danger ? C.coral : C.white }}>{label}</Text>
    </Pressable>
  );

  return (
    <Sheet open onClose={close}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Avatar player={{ glyph: player.glyph, hue: player.hue, photo: player.photo }} size={44} />
        <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.displayBold, fontSize: 20, color: C.white }}>{player.name}</Text>
      </View>
      {done ? (
        <>
          <Text style={s.body}>{done}</Text>
          <Pressable onPress={close} style={{ marginTop: 18, alignItems: 'center', paddingVertical: 12 }}><Text style={{ fontFamily: F.bodyBold, fontSize: 15, color: C.primary }}>Done</Text></Pressable>
        </>
      ) : (
        <View style={{ gap: 8 }}>
          {row('Report name', () => void report('name'))}
          {player.photo ? row('Report photo', () => void report('photo')) : null}
          {row('Report something else', () => void report('other'))}
          {row('Block player', () => void block(), true)}
          {err && <Text style={{ fontFamily: F.body, fontSize: 13, color: C.coral, marginTop: 4 }}>{err}</Text>}
          <Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.6), marginTop: 6 }}>Reports are anonymous. Names or photos reported by several players are removed automatically.</Text>
        </View>
      )}
    </Sheet>
  );
}
