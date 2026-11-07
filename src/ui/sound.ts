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
// Sound effects sit on top of the music without pushing the phone's speaker into its limiter,
// which would briefly turn everything (music included) down. The WAVs peak near 0 dB.
const SFX_VOLUME = 0.5;
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
  trackPlayer('rounds');
  trackPlayer('championship');
  (Object.keys(RESULTS) as ResultMusic[]).forEach((k) => {
    try { const p = createAudioPlayer(RESULTS[k], SONG); p.volume = MUSIC_VOLUME; resultPlayers.set(k, p); } catch { /* audio unavailable */ }
  });
}

// ── Background music ──
// Two tracks play quietly during games so sound effects sit on top: "rounds" for solo and
// elimination rounds 1–4, "championship" for the final 1v1. A track starts when its round
// begins and keeps looping through the breaks between rounds and on the results; moving to the
// championship crossfades to its track, and back on the menu the music fades out.
// Between rounds and after the championship, the track pauses and a 10-second result song
// plays instead: "win" if you got through (or won), "loss" if you were knocked out.
// Its own setting; paused in the background.
export type MusicTrack = 'rounds' | 'championship';
const MUSIC_KEY = 'lw.music';
const MUSIC_VOLUME = 0.12;
const TRACKS: Record<MusicTrack, number> = {
  rounds: require('@/assets/sounds/rounds.m4a'),
  championship: require('@/assets/sounds/championship.m4a'),
};
const musicPlayers = new Map<MusicTrack, AudioPlayer>();
export type ResultMusic = 'win' | 'loss';
const RESULTS: Record<ResultMusic, number> = {
  win: require('@/assets/sounds/win.m4a'),
  loss: require('@/assets/sounds/loss.m4a'),
};
const resultPlayers = new Map<ResultMusic, AudioPlayer>();
// expo-audio switches the phone's audio session off 0.1 s after any pause() if nothing is playing
// yet, which silences a song that's still loading. Song players keep the session on instead.
const SONG = { keepAudioSessionActive: true } as const;
let resultOn = false;
// Tracked from AppState changes: AppState.currentState can read 'unknown' until the first change.
let appActive = true;
const fades = new Map<MusicTrack, ReturnType<typeof setInterval>>();
let musicHooked = false;
let inGame = false;
let currentGame: string | null = null;
let currentTrack: MusicTrack | null = null;

export const musicEnabled = () => kv.get(MUSIC_KEY) !== 'off';
export function setMusicEnabled(on: boolean) {
  kv.set(MUSIC_KEY, on ? 'on' : 'off');
  listeners.forEach((l) => l());
  if (on && inGame && !resultOn) resumeMusic();
  else if (!on) { musicPlayers.forEach((m) => m.pause()); stopResultMusic(); }
}

function trackPlayer(track: MusicTrack): AudioPlayer | null {
  try {
    let m = musicPlayers.get(track);
    if (!m) {
      m = createAudioPlayer(TRACKS[track], SONG);
      m.loop = true;
      m.volume = MUSIC_VOLUME;
      musicPlayers.set(track, m);
    }
    if (!musicHooked) {
      musicHooked = true;
      AppState.addEventListener('change', (s) => {
        appActive = s === 'active';
        if (s === 'active') { if (inGame && !resultOn) resumeMusic(); }
        else { musicPlayers.forEach((p) => p.pause()); stopResultMusic(); }
      });
    }
    return m;
  } catch { return null; }
}

function cancelFade(track: MusicTrack) {
  const f = fades.get(track);
  if (f) { clearInterval(f); fades.delete(track); }
}

/** Fade a track out over about a second, then pause it. */
function fadeOut(track: MusicTrack) {
  const m = musicPlayers.get(track);
  if (!m || fades.has(track)) return;
  if (!m.playing) return; // never pause an idle player (see SONG above)
  let v = m.volume;
  fades.set(track, setInterval(() => {
    v -= MUSIC_VOLUME / 10;
    if (v <= 0) {
      cancelFade(track);
      if (!(inGame && currentTrack === track && !resultOn)) m.pause();
      m.volume = MUSIC_VOLUME;
    }
    else m.volume = v;
  }, 100));
}

function resumeMusic() {
  if (!currentTrack || !musicEnabled()) return;
  const m = trackPlayer(currentTrack);
  if (!m) return;
  cancelFade(currentTrack);
  m.volume = MUSIC_VOLUME;
  m.play();
}

/**
 * A round began. Starts `track` from the top, unless this game is already playing it (so the
 * music runs straight through rounds 1–4); switching track fades the other one out.
 */
export function startGameMusic(gameId: string, track: MusicTrack) {
  stopResultMusic();
  // Same game and track (the next round): carry on from where it paused.
  if (inGame && currentGame === gameId && currentTrack === track) { resumeMusic(); return; }
  currentGame = gameId;
  inGame = true;
  musicPlayers.forEach((_, t) => { if (t !== track) fadeOut(t); });
  currentTrack = track;
  const m = trackPlayer(track);
  if (!m || !musicEnabled()) return;
  cancelFade(track);
  // Start right away; never wait on the seek (on some devices its promise never settles).
  m.seekTo(0).catch(() => {});
  resumeMusic();
}

function stopResultMusic() {
  resultOn = false;
  resultPlayers.forEach((p) => { if (p.playing) p.pause(); });
}

/** A round's result: pause the game track (it picks up again next round) and play the result song once. */
export function playResultMusic(kind: ResultMusic) {
  if (currentTrack) fadeOut(currentTrack);
  stopResultMusic();
  if (!musicEnabled() || !appActive) return;
  try {
    let p = resultPlayers.get(kind);
    if (!p) { p = createAudioPlayer(RESULTS[kind], SONG); p.volume = MUSIC_VOLUME; resultPlayers.set(kind, p); }
    resultOn = true;
    p.seekTo(0).catch(() => {});
    p.volume = MUSIC_VOLUME;
    p.play();
  } catch { /* audio unavailable */ }
}

/** Back on the menu: fade the music out. */
export function stopGameMusic() {
  stopResultMusic();
  inGame = false;
  currentGame = null;
  if (currentTrack) fadeOut(currentTrack);
  currentTrack = null;
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
      p.volume = SFX_VOLUME;
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
