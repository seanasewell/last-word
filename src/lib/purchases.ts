// ── Remove ads: one-time purchase and the ad-free entitlement ──────────────
// Two providers behind one interface:
//   • store: RevenueCat (StoreKit on iOS, Google Play Billing on Android). RevenueCat
//     verifies every receipt server-side and keeps the entitlement on the player's
//     account (its app user ID is the Supabase user ID), so restoring works on a new
//     phone. The price shown always comes from the store.
//   • simulated: Expo Go and internal test builds only. Purchases are clearly labeled
//     as tests, cost nothing, and are ignored by the store build.
// When neither is available (e.g. a store build before the RevenueCat keys are set),
// the purchase is shown as unavailable and ads stay as they are.
import { useSyncExternalStore } from 'react';

import { kv } from './kv';
import { AD_FREE_ENTITLEMENT, ALLOW_SIMULATION, IN_EXPO_GO, REMOVE_ADS_PRODUCT_ID, revenueCatKey } from './monetizationConfig';

export type PurchaseResult = { kind: 'ok' } | { kind: 'cancel' } | { kind: 'error'; message: string };
export type SimOutcome = 'success' | 'fail' | 'cancel';

export interface AdFreeState {
  /** Ads are off: a verified purchase (or a simulated one in development). */
  adFree: boolean;
  /** Store price string, e.g. "$4.99"; null until the store answers. */
  price: string | null;
  /** Which service handles purchases here. */
  provider: 'store' | 'simulated' | 'none';
  busy: boolean;
}

interface Provider {
  kind: AdFreeState['provider'];
  start(userId: string | null): Promise<{ adFree: boolean; price: string | null }>;
  purchase(): Promise<PurchaseResult>;
  restore(): Promise<PurchaseResult & { adFree?: boolean }>;
}

const FRIENDLY = "The purchase didn't go through. Check your connection and try again.";

// ── RevenueCat ──
type RC = typeof import('react-native-purchases').default;
function loadRevenueCat(): RC | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('react-native-purchases') as typeof import('react-native-purchases')).default;
  } catch { return null; }
}

function storeProvider(): Provider | null {
  const key = revenueCatKey();
  const P = key && !IN_EXPO_GO ? loadRevenueCat() : null;
  if (!P) return null;
  let configured = false;
  let product: Awaited<ReturnType<RC['getProducts']>>[number] | null = null;
  const owns = (info: { entitlements: { active: Record<string, unknown> } }) => !!info.entitlements.active[AD_FREE_ENTITLEMENT];
  return {
    kind: 'store',
    async start(userId) {
      if (!configured) { P.configure({ apiKey: key, appUserID: userId ?? undefined }); configured = true; }
      else if (userId) await P.logIn(userId).catch(() => {});
      const [info, products] = await Promise.all([
        P.getCustomerInfo(),
        P.getProducts([REMOVE_ADS_PRODUCT_ID], P.PRODUCT_CATEGORY.NON_SUBSCRIPTION).catch(() => []),
      ]);
      product = products[0] ?? null;
      return { adFree: owns(info), price: product?.priceString ?? null };
    },
    async purchase() {
      try {
        if (!product) {
          product = (await P.getProducts([REMOVE_ADS_PRODUCT_ID], P.PRODUCT_CATEGORY.NON_SUBSCRIPTION))[0] ?? null;
          if (!product) return { kind: 'error', message: "Remove ads isn't available right now. Try again later." };
        }
        const { customerInfo } = await P.purchaseStoreProduct(product);
        return owns(customerInfo) ? { kind: 'ok' } : { kind: 'error', message: FRIENDLY };
      } catch (e) {
        if ((e as { userCancelled?: boolean | null }).userCancelled) return { kind: 'cancel' };
        return { kind: 'error', message: FRIENDLY };
      }
    },
    async restore() {
      try {
        const info = await P.restorePurchases();
        return { kind: 'ok', adFree: owns(info) };
      } catch {
        return { kind: 'error', message: "Couldn't reach the store to restore purchases. Try again." };
      }
    },
  };
}

// ── Simulated (development only) ──
const SIM_KEY = 'lw.sim.adfree';
const SIM_OUTCOME_KEY = 'lw.sim.purchaseOutcome';
export const simOutcome = (): SimOutcome => (kv.get(SIM_OUTCOME_KEY) as SimOutcome) || 'success';
export function setSimOutcome(o: SimOutcome) { kv.set(SIM_OUTCOME_KEY, o); }
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function simulatedProvider(): Provider {
  return {
    kind: 'simulated',
    async start() { return { adFree: kv.get(SIM_KEY) === '1', price: '$4.99' }; },
    async purchase() {
      await wait(700);
      const o = simOutcome();
      if (o === 'cancel') return { kind: 'cancel' };
      if (o === 'fail') return { kind: 'error', message: FRIENDLY };
      kv.set(SIM_KEY, '1');
      return { kind: 'ok' };
    },
    async restore() { await wait(500); return { kind: 'ok', adFree: kv.get(SIM_KEY) === '1' }; },
  };
}

// ── Store of the current state ──
const provider: Provider | null = storeProvider() ?? (ALLOW_SIMULATION ? simulatedProvider() : null);
const CACHE_KEY = 'lw.adfree.cache';

let state: AdFreeState = { adFree: false, price: null, provider: provider?.kind ?? 'none', busy: false };
const listeners = new Set<() => void>();
function set(patch: Partial<AdFreeState>) { state = { ...state, ...patch }; listeners.forEach((l) => l()); }

export const purchases = {
  get: () => state,
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },

  /** Load the entitlement and price for this player (call on sign-in and when the account changes). */
  async start(userId: string | null) {
    if (!provider) return;
    // Show the last verified answer straight away (store provider only), then ask the store again.
    if (provider.kind === 'store' && kv.get(CACHE_KEY) === '1') set({ adFree: true });
    try {
      const r = await provider.start(userId);
      set({ adFree: r.adFree, price: r.price ?? state.price });
      if (provider.kind === 'store') kv.set(CACHE_KEY, r.adFree ? '1' : '0');
    } catch { /* offline: keep the cached answer */ }
  },

  async buy(): Promise<PurchaseResult> {
    if (!provider) return { kind: 'error', message: "Remove ads isn't available yet." };
    set({ busy: true });
    const r = await provider.purchase();
    set({ busy: false, ...(r.kind === 'ok' ? { adFree: true } : {}) });
    if (r.kind === 'ok' && provider.kind === 'store') kv.set(CACHE_KEY, '1');
    return r;
  },

  async restore(): Promise<PurchaseResult & { adFree?: boolean }> {
    if (!provider) return { kind: 'error', message: "Restoring isn't available yet." };
    set({ busy: true });
    const r = await provider.restore();
    set({ busy: false, ...(r.kind === 'ok' && r.adFree ? { adFree: true } : {}) });
    if (r.kind === 'ok' && provider.kind === 'store') kv.set(CACHE_KEY, r.adFree ? '1' : '0');
    return r;
  },

  /** Developer: forget a simulated purchase. */
  devResetSimulated() {
    if (provider?.kind !== 'simulated') return;
    kv.set(SIM_KEY, '0');
    set({ adFree: false });
  },
};

export function useAdFree(): AdFreeState {
  return useSyncExternalStore(purchases.subscribe, purchases.get, purchases.get);
}
