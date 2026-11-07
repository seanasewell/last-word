// ── Sound effects ──────────────────────────────────────────────────────────
// Short pre-rendered WAVs (same notes as the web version's synthesized
// sounds), played with expo-audio. Respects the iPhone silent switch and
// mixes with music the player already has on.
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { AppState } from 'react-native';

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
  ensureMusic();
}

// ── Background music ──
// "Mechanical Activation" (assets/sounds/music.m4a) plays quietly during games so sound
// effects sit on top: it starts with a game's first round, plays straight through the whole match (looping) and on
// the results, and fades out back on the menu. Its own setting; paused in the background.
const MUSIC_KEY = 'lw.music';
const MUSIC_VOLUME = 0.12;
let music: AudioPlayer | null = null;
let musicHooked = false;
let inGame = false;
let fade: ReturnType<typeof setInterval> | null = null;

export const musicEnabled = () => kv.get(MUSIC_KEY) !== 'off';
export function setMusicEnabled(on: boolean) {
  kv.set(MUSIC_KEY, on ? 'on' : 'off');
  listeners.forEach((l) => l());
  if (on && inGame) resumeMusic(); else if (!on) music?.pause();
}

function ensureMusic(): AudioPlayer | null {
  try {
    if (!music) {
      music = createAudioPlayer(require('@/assets/sounds/music.m4a'));
      music.loop = true;
      music.volume = MUSIC_VOLUME;
    }
    if (!musicHooked) {
      musicHooked = true;
      AppState.addEventListener('change', (s) => {
        if (s === 'active') { if (inGame) resumeMusic(); } else music?.pause();
      });
    }
    return music;
  } catch { return null; }
}

function resumeMusic() {
  const m = ensureMusic();
  if (!m || !musicEnabled()) return;
  if (fade) { clearInterval(fade); fade = null; }
  m.volume = MUSIC_VOLUME;
  m.play();
}

let currentGame: string | null = null;

/** A game's round began: start the music from the top, unless this game is already playing it. */
export function startGameMusic(gameId: string) {
  if (inGame && currentGame === gameId) return;
  currentGame = gameId;
  inGame = true;
  const m = ensureMusic();
  if (!m || !musicEnabled()) return;
  m.seekTo(0).then(resumeMusic, resumeMusic);
}

/** Back on the menu: fade the music out over about a second. */
export function stopGameMusic() {
  inGame = false;
  currentGame = null;
  const m = music;
  if (!m || fade) return;
  let v = m.volume;
  fade = setInterval(() => {
    v -= MUSIC_VOLUME / 10;
    if (v <= 0) { m.pause(); m.volume = MUSIC_VOLUME; if (fade) clearInterval(fade); fade = null; }
    else m.volume = v;
  }, 100);
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
