// ── Interstitial ads after every 3 completed games ─────────────────────────
// One shared counter for elimination matches and solo challenges, saved on the
// phone. A game counts once, when the player's part in it is over (knocked out,
// won, or a solo round that ran its full time). When the count reaches 3, the next
// time the player leaves a results screen (after any celebrations) one interstitial
// shows, and the counter resets only once an ad has actually appeared. No ad is
// ever loaded or shown during play, and never for ad-free players.
//
// Providers behind one interface:
//   • admob: Google Mobile Ads (store and internal builds). Asks for consent first
//     where the law requires it (Google's UMP form) and serves non-personalized ads
//     unless consent allows more; no App Tracking Transparency prompt is used.
//   • simulated: Expo Go / development only; a full-screen placeholder labeled as a test.
import { useSyncExternalStore } from 'react';

import { kv } from './kv';
import { ALLOW_SIMULATION, GAMES_PER_AD, IN_EXPO_GO, NO_AD_AFTER_LAUNCH_MS, productionInterstitialUnit } from './monetizationConfig';
import { purchases } from './purchases';

interface AdProvider {
  kind: 'admob' | 'simulated' | 'none';
  /** Start loading an ad in the background (never blocks). */
  preload(): void;
  isReady(): boolean;
  /** Show the loaded ad; resolves true once it was shown and closed, false if it couldn't show. */
  show(): Promise<boolean>;
}

// ── Google Mobile Ads ──
function admobProvider(): AdProvider | null {
  if (IN_EXPO_GO) return null;
  let lib: typeof import('react-native-google-mobile-ads');
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    lib = require('react-native-google-mobile-ads') as typeof import('react-native-google-mobile-ads');
  } catch { return null; }
  const { default: mobileAds, AdsConsent, InterstitialAd, AdEventType, TestIds } = lib;
  // Test ads in development and internal builds; the store build needs its real unit ID.
  const unit = productionInterstitialUnit() || (ALLOW_SIMULATION ? TestIds.INTERSTITIAL : '');
  if (!unit) return null;

  let ready: Promise<boolean> | null = null;
  let personalized = false;
  let ad: ReturnType<typeof InterstitialAd.createForAdRequest> | null = null;
  let loaded = false;
  let loading = false;

  /**
   * Consent first (only asks where required, e.g. the EEA and UK), then start the SDK.
   * A failed attempt (e.g. offline) is tried again next time instead of turning ads off for the session.
   */
  const init = () => (ready ??= (async () => {
    try {
      const info = await AdsConsent.gatherConsent();
      if (!info.canRequestAds) return false;
      const choices = await AdsConsent.getUserChoices().catch(() => null);
      personalized = !!choices?.selectPersonalisedAds;
      await mobileAds().initialize();
      return true;
    } catch {
      ready = null;
      return false;
    }
  })());

  return {
    kind: 'admob',
    preload() {
      if (loaded || loading) return;
      loading = true;
      void init().then((ok) => {
        if (!ok) { loading = false; return; }
        ad = InterstitialAd.createForAdRequest(unit, { requestNonPersonalizedAdsOnly: !personalized });
        ad.addAdEventListener(AdEventType.LOADED, () => { loaded = true; loading = false; });
        ad.addAdEventListener(AdEventType.ERROR, () => { loaded = false; loading = false; });
        ad.load();
      });
    },
    isReady: () => loaded && !!ad,
    show() {
      const a = ad;
      if (!a || !loaded) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        let opened = false;
        const offs = [
          a.addAdEventListener(AdEventType.OPENED, () => { opened = true; }),
          a.addAdEventListener(AdEventType.CLOSED, () => { done(true); }),
          a.addAdEventListener(AdEventType.ERROR, () => { done(opened); }),
        ];
        const done = (shown: boolean) => { offs.forEach((off) => off()); loaded = false; ad = null; resolve(shown); };
        a.show().catch(() => done(false));
      });
    },
  };
}

// ── Simulated (development only) ──
let showSimulated: ((done: () => void) => void) | null = null;
/** The simulated ad's screen registers itself here (see ui/AdHost). */
export function registerSimulatedAdHost(fn: ((done: () => void) => void) | null) { showSimulated = fn; }
const SIM_FAIL_KEY = 'lw.sim.adFails';
export const simAdFails = () => kv.get(SIM_FAIL_KEY) === '1';
export function setSimAdFails(on: boolean) { kv.set(SIM_FAIL_KEY, on ? '1' : '0'); }

function simulatedProvider(): AdProvider {
  let loaded = false;
  return {
    kind: 'simulated',
    preload() { if (!simAdFails()) setTimeout(() => { loaded = true; }, 300); },
    isReady: () => loaded && !simAdFails() && !!showSimulated,
    show() {
      return new Promise<boolean>((resolve) => {
        if (!showSimulated) { resolve(false); return; }
        loaded = false;
        showSimulated(() => resolve(true));
      });
    },
  };
}

const provider: AdProvider = admobProvider() ?? (ALLOW_SIMULATION ? simulatedProvider() : { kind: 'none', preload() {}, isReady: () => false, show: async () => false });

// ── Counter ──
const COUNT_KEY = 'lw.ads.count';
const SEEN_KEY = 'lw.ads.counted';
const launchedAt = Date.now();
let showing: Promise<void> | null = null;
const listeners = new Set<() => void>();
let launchDelayOff = false;
let snapshot = { count: 0, provider: provider.kind };
/** Current counter (re-read from storage, which loads after this module). */
function read() {
  const count = Number(kv.get(COUNT_KEY) || 0);
  if (count !== snapshot.count) snapshot = { count, provider: provider.kind };
  return snapshot;
}
function emit() { read(); listeners.forEach((l) => l()); }

export const ads = {
  /** A game finished (call once per game; repeats with the same ID are ignored). */
  gameCompleted(gameId: string) {
    if (purchases.get().adFree) return;
    const seen: string[] = JSON.parse(kv.get(SEEN_KEY) || '[]');
    if (seen.includes(gameId)) return;
    kv.set(SEEN_KEY, JSON.stringify([...seen, gameId].slice(-20)));
    const count = Math.min(GAMES_PER_AD, Number(kv.get(COUNT_KEY) || 0) + 1);
    kv.set(COUNT_KEY, String(count));
    emit();
    if (count >= GAMES_PER_AD) provider.preload();
  },

  /**
   * Leaving a results screen: show an ad if one is due and ready. Never waits for an
   * ad to load; if none is ready the player carries on and the next exit tries again.
   */
  maybeShow(): Promise<void> {
    // An ad already on screen: wait for it to close rather than carrying on behind it.
    if (showing) return showing;
    if (purchases.get().adFree) return Promise.resolve();
    if (Number(kv.get(COUNT_KEY) || 0) < GAMES_PER_AD) return Promise.resolve();
    if (!launchDelayOff && Date.now() - launchedAt < NO_AD_AFTER_LAUNCH_MS) return Promise.resolve();
    if (!provider.isReady()) { provider.preload(); return Promise.resolve(); }
    showing = (async () => {
      try {
        if (await provider.show()) { kv.set(COUNT_KEY, '0'); emit(); }
      } finally {
        showing = null;
      }
    })();
    return showing;
  },

  /** Load early on launch if an ad is already due. */
  warmUp() {
    if (!purchases.get().adFree && Number(kv.get(COUNT_KEY) || 0) >= GAMES_PER_AD) provider.preload();
  },

  get: read,
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },

  /** Developer: put the counter at a value. */
  devSetCount(n: number) { kv.set(COUNT_KEY, String(Math.max(0, Math.min(GAMES_PER_AD, n)))); emit(); },
  /** Developer: skip the after-launch quiet period (for testing ads right away). */
  devIgnoreLaunchDelay() { launchDelayOff = true; },
};

export function useAdCounter() {
  return useSyncExternalStore(ads.subscribe, ads.get, ads.get);
}
