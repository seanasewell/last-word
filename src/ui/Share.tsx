// ── Share a result ─────────────────────────────────────────────────────────
// A shareable image card (1080 × 1350) for a match win or a solo score, drawn
// with regular views (the same layout as the web prototype's canvas) and
// captured to a PNG, then shared through the phone's share sheet or saved to
// Photos.
import { LinearGradient } from 'expo-linear-gradient';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as Sharing from 'expo-sharing';
import React, { useRef, useState } from 'react';
import { Platform, Share, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';

import { Button, Sheet, Tile } from './kit';
import { C, F, w } from './theme';

export interface ShareData {
  kind: 'match' | 'solo';
  name: string;
  points: number;
  bestWord: { word: string; points: number } | null;
  wordsFound: number;
  source?: string;
  newBest?: boolean;
}

const W = 1080;
const H = 1350;
const fmt = (n: number) => n.toLocaleString('en-US');

function TileRow({ text, cy, maxW, maxSize, k, gold = false }: { text: string; cy: number; maxW: number; maxSize: number; k: number; gold?: boolean }) {
  const letters = text.toUpperCase().split('');
  const size = Math.min(maxSize, maxW / (letters.length + (letters.length - 1) * 0.13));
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: (cy - size * 0.56) * k, flexDirection: 'row', justifyContent: 'center', gap: size * 0.13 * k }}>
      {letters.map((ch, i) => <Tile key={i} ch={ch} size={size * k} gold={gold} animate={false} />)}
    </View>
  );
}

/** Text placed by its baseline (in card units), centered across the card. */
function Line({ y, size, k, font, color, children, fit = false, spacing = 0 }: { y: number; size: number; k: number; font: string; color: string; children: React.ReactNode; fit?: boolean; spacing?: number }) {
  return (
    <Text numberOfLines={fit ? 1 : 2} adjustsFontSizeToFit={fit} minimumFontScale={0.4}
      style={{ position: 'absolute', left: 60 * k, right: 60 * k, top: (y - size * 0.95) * k, textAlign: 'center', fontFamily: font, fontSize: size * k, lineHeight: size * 1.15 * k, letterSpacing: spacing * k, color, includeFontPadding: false }}>
      {children}
    </Text>
  );
}

export function ShareCard({ d, width }: { d: ShareData; width: number }) {
  const k = width / W;
  const match = d.kind === 'match';
  const scoreY = match ? 590 : 660;
  const gy = match ? 510 : 540;
  const pb = !match && !!d.newBest;
  const cardY = match ? 790 : pb ? 830 : 770;
  const cardH = 336;
  return (
    <View style={{ width, height: H * k, overflow: 'hidden', backgroundColor: C.bg }}>
      <LinearGradient colors={['#2A5FB8', '#122C5C', '#081428']} locations={[0, 0.5, 1]} style={StyleSheet.absoluteFill} />
      <Svg width={width} height={H * k} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="glow" cx={(W / 2) * k} cy={gy * k} r={520 * k} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={match ? '#FFB547' : '#5C9EFF'} stopOpacity={match ? 0.3 : 0.35} />
            <Stop offset="1" stopColor="#000000" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={(W / 2) * k} cy={gy * k} r={520 * k} fill="url(#glow)" />
      </Svg>

      <TileRow text="LASTWORD" cy={150} maxW={760} maxSize={84} k={k} />

      {match ? (
        <Line y={315} size={84} k={k} font={F.display} color={C.white} fit>{`${d.name} got the last word!`}</Line>
      ) : (
        <>
          <Line y={330} size={34} k={k} font={F.bodyBold} color="#9CC3FF" spacing={8}>SOLO CHALLENGE</Line>
          <Line y={430} size={76} k={k} font={F.display} color={C.white}>{`${d.name}'s score`}</Line>
        </>
      )}

      <Line y={scoreY} size={220} k={k} font={F.display} color={C.amber} fit>{fmt(d.points)}</Line>
      {match && <Line y={scoreY + 92} size={40} k={k} font={F.bodySemi} color={w(0.8)}>match points</Line>}
      {pb && (
        // New personal best: a green badge right under the score.
        <View style={{ position: 'absolute', left: 0, right: 0, top: 706 * k, alignItems: 'center' }}>
          <View style={{ height: 76 * k, paddingHorizontal: 36 * k, borderRadius: 38 * k, backgroundColor: '#22A06B', justifyContent: 'center' }}>
            <Text style={{ fontFamily: F.bodyBold, fontSize: 36 * k, color: C.white, includeFontPadding: false }}>New personal best 🎉</Text>
          </View>
        </View>
      )}

      {d.bestWord && (
        <View style={{ position: 'absolute', left: 90 * k, top: cardY * k, width: (W - 180) * k, height: cardH * k, borderRadius: 40 * k, borderWidth: 3 * k, borderColor: 'rgba(61,139,255,0.5)', backgroundColor: 'rgba(61,139,255,0.14)' }} />
      )}
      {d.bestWord && <Line y={cardY + 109} size={32} k={k} font={F.bodyBold} color={w(0.75)} spacing={8}>LONGEST WORD</Line>}
      {d.bestWord && <TileRow text={d.bestWord.word} cy={cardY + 203} maxW={W - 300} maxSize={92} k={k} gold={match} />}

      <Line y={pb ? 1262 : 1240} size={60} k={k} font={F.display} color={C.white}>Can you beat it?</Line>
    </View>
  );
}

export function ShareButton({ data, title, variant = 'ghost' }: { data: ShareData; title: string; variant?: 'primary' | 'ghost' | 'gold' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button title={title} variant={variant} onPress={() => setOpen(true)} />
      <ShareSheet open={open} onClose={() => setOpen(false)} data={data} />
    </>
  );
}

function ShareSheet({ open, onClose, data }: { open: boolean; onClose: () => void; data: ShareData }) {
  const { width } = useWindowDimensions();
  const cardW = Math.round(Math.min(width, 480) * 0.62);
  const ref = useRef<React.ComponentRef<typeof View>>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const close = () => { setNote(null); onClose(); };

  const snapshot = () => captureRef(ref, { format: 'png', quality: 1, width: W, height: H, result: 'tmpfile' });
  const share = async () => {
    setBusy(true); setNote(null);
    try {
      const uri = await snapshot();
      if (Platform.OS === 'ios') await Share.share({ url: uri });
      else if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Share your result' });
      else setNote("Sharing isn't available on this device. Try saving the image instead.");
    } catch {
      setNote("Couldn't share the image. Try again.");
    }
    setBusy(false);
  };
  const save = async () => {
    setBusy(true); setNote(null);
    try {
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm.granted) { setNote('Allow photo access in Settings to save the image.'); setBusy(false); return; }
      const uri = await snapshot();
      await MediaLibrary.saveToLibraryAsync(uri);
      setNote('Saved to your photos.');
    } catch {
      setNote("Couldn't save the image. Try again.");
    }
    setBusy(false);
  };

  return (
    <Sheet open={open} onClose={close}>
      <Text style={{ textAlign: 'center', fontFamily: F.displayBold, fontSize: 20, color: C.white, marginBottom: 12 }}>{data.kind === 'match' ? 'Share your win' : 'Share your score'}</Text>
      <View style={{ alignSelf: 'center', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: C.cardBorder }}>
        <View ref={ref} collapsable={false}>
          <ShareCard d={data} width={cardW} />
        </View>
      </View>
      <View style={{ gap: 8, marginTop: 16 }}>
        <Button title="Share" disabled={busy} onPress={() => void share()} />
        <Button title="Save image" variant="ghost" disabled={busy} onPress={() => void save()} />
        {note && <Text style={{ textAlign: 'center', fontFamily: F.body, fontSize: 12, color: w(0.7) }}>{note}</Text>}
      </View>
    </Sheet>
  );
}
