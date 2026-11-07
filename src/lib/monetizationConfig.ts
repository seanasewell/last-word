// ── Ads and the Remove ads purchase: configuration ─────────────────────────
// Everything store- or network-specific lives here, away from the UI.
// Production values come from EXPO_PUBLIC_* variables (public by design: ad unit
// IDs and RevenueCat's public SDK keys ship inside every app). Nothing here is a secret.
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

import { SHOW_DEV_TOOLS } from './release';

/** Show one interstitial after this many completed games (elimination and solo share the count). */
export const GAMES_PER_AD = 3;
/** Never show an ad this soon after the app starts. */
export const NO_AD_AFTER_LAUNCH_MS = 60_000;

/** Store product (non-consumable on iOS, one-time product on Android). Price is set in each store ($4.99 US). */
export const REMOVE_ADS_PRODUCT_ID = 'com.lastword.removeads';
/** RevenueCat entitlement unlocked by that product. */
export const AD_FREE_ENTITLEMENT = 'ad_free';

// Expo only inlines EXPO_PUBLIC_* values written out in full, so each is read by name.
const ADMOB_IOS = (process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_IOS ?? '').trim();
const ADMOB_ANDROID = (process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_ANDROID ?? '').trim();
const RC_IOS = (process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? '').trim();
const RC_ANDROID = (process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY ?? '').trim();

/** Expo Go can't load the AdMob or store SDKs; it uses the simulated services (development only). */
export const IN_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** Simulated ads and purchases are allowed only in development and internal test builds, never in the store build. */
export const ALLOW_SIMULATION = SHOW_DEV_TOOLS;

/** Production interstitial unit for this platform, or '' when not configured yet. */
export function productionInterstitialUnit(): string {
  return Platform.OS === 'ios' ? ADMOB_IOS : ADMOB_ANDROID;
}

/** RevenueCat public SDK key for this platform, or '' when not configured yet. */
export function revenueCatKey(): string {
  return Platform.OS === 'ios' ? RC_IOS : RC_ANDROID;
}
