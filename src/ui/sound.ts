// ── Sound effects ──────────────────────────────────────────────────────────
// Short pre-rendered WAVs (same notes as the web version's synthesized
// sounds), played with expo-audio. Respects the iPhone silent switch and
// mixes with music the player already has on.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

import { kv } from '@/lib/kv';

const SOURCES = {
  word2: require('@/assets/sounds/word2.wav'),
  word3: require('@/assets/sounds/word3.wav'),
  word4: require('@/assets/sounds/word4.wav'),
  word5: require('@/assets/sounds/word5.wav'),
  word6: require('@/assets/sounds/word6.wav'),
  word7: require('@/assets/sounds/word7.wav'),
  word8: require('@/assets/sounds/word8.wav'),
  word9: require('@/assets/sounds/word9.wav'),
  word10: require('@/assets/sounds/word10.wav'),
  wrong: require('@/assets/sounds/wrong.wav'),
  survive: require('@/assets/sounds/survive.wav'),
  eliminated: require('@/assets/sounds/eliminated.wav'),
  win: require('@/assets/sounds/win.wav'),
  tick: require('@/assets/sounds/tick.wav'),
  join: require('@/assets/sounds/join.wav'),
  go: require('@/assets/sounds/go.wav'),
} as const;
type Name = keyof typeof SOURCES;

const KEY = 'lw.sound';
const players = new Map<string, AudioPlayer>();
const listeners = new Set<() => void>();

export const soundEnabled = () => kv.get(KEY) !== 'off';
export function setSoundEnabled(on: boolean) {
  kv.set(KEY, on ? 'on' : 'off');
  listeners.forEach((l) => l());
  if (on) sfx.word(4);
}
export function onSoundChange(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Set the audio mode and load every sound up front so the first play is instant. */
export function initSound() {
  setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => {});
  (Object.keys(SOURCES) as Name[]).forEach((n) => { for (let i = 0; i < (POOLED[n] ?? 1); i++) player(n, i); });
}

/** Sounds that can fire in quick succession get a few players each, so a new play never cuts off or races the last. */
const POOLED: Partial<Record<Name, number>> = { tick: 3, join: 4, go: 2 };
const next = new Map<Name, number>();

function player(name: Name, slot = 0): AudioPlayer | null {
  const key = `${name}#${slot}`;
  try {
    let p = players.get(key);
    if (!p) {
      p = createAudioPlayer(SOURCES[name]);
      players.set(key, p);
    }
    return p;
  } catch {
    return null;
  }
}

function play(name: Name) {
  if (!soundEnabled()) return;
  const size = POOLED[name] ?? 1;
  const slot = (next.get(name) ?? 0) % size;
  next.set(name, slot + 1);
  const p = player(name, slot);
  if (!p) return;
  try {
    p.seekTo(0).then(() => p.play(), () => p.play());
  } catch { /* audio unavailable */ }
}

export const sfx = {
  /** Correct word: a two-note chime that climbs with word length. */
  word: (len: number) => play(`word${Math.min(10, Math.max(2, len))}` as Name),
  wrong: () => play('wrong'),
  survive: () => play('survive'),
  eliminated: () => play('eliminated'),
  win: () => play('win'),
  tick: () => play('tick'),
  join: () => play('join'),
  /** The round starts. */
  go: () => play('go'),
};
