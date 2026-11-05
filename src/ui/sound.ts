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
} as const;
type Name = keyof typeof SOURCES;

const KEY = 'lw.sound';
const players = new Map<Name, AudioPlayer>();
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
  (Object.keys(SOURCES) as Name[]).forEach(player);
}

function player(name: Name): AudioPlayer | null {
  try {
    let p = players.get(name);
    if (!p) {
      p = createAudioPlayer(SOURCES[name]);
      players.set(name, p);
    }
    return p;
  } catch {
    return null;
  }
}

function play(name: Name) {
  if (!soundEnabled()) return;
  const p = player(name);
  if (!p) return;
  try {
    p.seekTo(0).catch(() => {});
    p.play();
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
};
