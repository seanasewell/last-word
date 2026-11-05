import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { engine, HUMAN_ID, type GameState } from '@/lib/engine';
import { scoreWord } from '@/lib/words';
import { Avatar, Card, FadeUp, s, Screen, TileLogo } from './kit';
import { C, F, w } from './theme';

type Tab = 'play' | 'ranks' | 'profile';
let rememberedTab: Tab = 'play';

const ME = { glyph: 'Y', hue: 210, id: HUMAN_ID };

function TabBar({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const insets = useSafeAreaInsets();
  const items: { id: Tab; label: string; emoji?: string }[] = [
    { id: 'play', label: 'Play', emoji: '🔤' },
    { id: 'ranks', label: 'Ranks', emoji: '🏆' },
    { id: 'profile', label: 'Profile' },
  ];
  return (
    <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: w(0.07), backgroundColor: C.bg, paddingTop: 10, paddingBottom: Math.max(insets.bottom, 12) + 4 }}>
      {items.map((t) => {
        const active = t.id === tab;
        return (
          <Pressable key={t.id} onPress={() => onChange(t.id)} accessibilityRole="tab" accessibilityState={{ selected: active }}
            style={({ pressed }) => ({ flex: 1, alignItems: 'center', gap: 4, transform: [{ scale: pressed ? 0.94 : 1 }] })}>
            <View style={{ height: 26, justifyContent: 'center', opacity: active ? 1 : 0.6 }}>
              {t.emoji ? <Text style={{ fontSize: 23 }}>{t.emoji}</Text> : <Avatar player={ME} size={26} />}
            </View>
            <Text style={{ fontFamily: F.bodySemi, fontSize: 11, color: active ? C.white : w(0.6) }}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function PlayTab({ best }: { best: number }) {
  const [showScoring, setShowScoring] = useState(false);
  return (
    <View>
      <View style={{ alignItems: 'center', paddingTop: 8 }}>
        <TileLogo size={36} />
        <FadeUp delay={400}><Text style={{ marginTop: 12, fontFamily: F.bodySemi, fontSize: 12, letterSpacing: 0.4, color: w(0.5) }}>towards · world · salt</Text></FadeUp>
        <FadeUp delay={480}><Text style={[s.body, { marginTop: 14, textAlign: 'center', maxWidth: 320 }]}>Rearrange the letters of one big word into as many small words as you can. Longer words score more points.</Text></FadeUp>
      </View>

      <FadeUp delay={120} style={{ marginTop: 32, gap: 12 }}>
        <Pressable onPress={() => engine.startMatch()} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <View style={{ borderRadius: 24, borderWidth: 1.5, borderColor: 'rgba(92,158,255,0.7)', backgroundColor: 'rgba(8,20,40,0.92)', padding: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontFamily: F.displayBold, fontSize: 24, color: C.white }}>Elimination match</Text>
              <View style={{ flexDirection: 'row' }}>
                {[168, 280, 30, 340, 205].map((h, i) => <View key={h} style={{ width: 22, height: 22, borderRadius: 11, marginLeft: i ? -7 : 0, borderWidth: 2, borderColor: C.bg, backgroundColor: `hsl(${h}, 80%, 58%)` }} />)}
              </View>
            </View>
            <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.65), marginTop: 4 }}>6 players · 5 rounds · 60 seconds each. Lowest score each round is out.</Text>
            <View style={{ alignSelf: 'flex-start', marginTop: 16, backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 9 }}>
              <Text style={{ fontFamily: F.bodyBold, fontSize: 14, color: C.white }}>Find a match →</Text>
            </View>
          </View>
        </Pressable>

        <Pressable onPress={() => engine.startSingle()} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.98 : 1 }] })}>
          <Card style={{ borderRadius: 24, padding: 20 }}>
            <Text style={{ fontFamily: F.displayBold, fontSize: 20, color: C.white }}>Solo challenge</Text>
            <Text style={{ fontFamily: F.body, fontSize: 14, color: w(0.65), marginTop: 4 }}>One word, 60 seconds. Beat your personal best.</Text>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 12 }}>
              <Text style={s.eyebrow}>Best</Text>
              <Text style={[{ fontFamily: F.display, fontSize: 18, color: C.amber }, s.tabular]}>{best}</Text>
            </View>
          </Card>
        </Pressable>

        <Pressable onPress={() => setShowScoring((x) => !x)} hitSlop={8}>
          <Text style={{ fontFamily: F.bodySemi, fontSize: 14, color: w(0.55), paddingTop: 4 }}>{showScoring ? '▾' : '▸'} How scoring works</Text>
        </Pressable>
        {showScoring && (
          <View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((n) => (
                <View key={n} style={{ width: '18.4%', alignItems: 'center', paddingVertical: 6, borderRadius: 12, backgroundColor: w(0.04) }}>
                  <Text style={{ fontFamily: F.body, fontSize: 10, color: w(0.5) }}>{n}{n === 11 ? '+' : ''} letters</Text>
                  <Text style={{ fontFamily: F.displayBold, fontSize: 15, color: C.white }}>{scoreWord('x'.repeat(n))}</Text>
                </View>
              ))}
            </View>
            <Text style={{ fontFamily: F.body, fontSize: 12, color: w(0.5), marginTop: 8, lineHeight: 17 }}>{"Each letter can be used as often as it appears in the source. The source word itself doesn't count. No proper nouns, abbreviations or hyphenated words."}</Text>
          </View>
        )}
      </FadeUp>
    </View>
  );
}

function ComingNext({ title, text }: { title: string; text: string }) {
  return (
    <View>
      <Text style={s.h1}>{title}</Text>
      <Card style={{ marginTop: 16, padding: 20 }}>
        <Text style={s.body}>{text}</Text>
      </Card>
    </View>
  );
}

export function Home({ s: g }: { s: GameState }) {
  const [tab, setTabState] = useState<Tab>(rememberedTab);
  const setTab = (t: Tab) => { rememberedTab = t; setTabState(t); };
  return (
    <Screen padBottom={false}>
      <ScrollView key={tab} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32 }}>
        {tab === 'play' && <PlayTab best={g.personalBest} />}
        {tab === 'ranks' && <ComingNext title="Ranks" text="World, national and state rankings by weekly wins arrive in the next build, together with accounts." />}
        {tab === 'profile' && <ComingNext title="Profile" text="Phone sign-in, your photo, display name and stats arrive in the next build." />}
      </ScrollView>
      <TabBar tab={tab} onChange={setTab} />
    </Screen>
  );
}
