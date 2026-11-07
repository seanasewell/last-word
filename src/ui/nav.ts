// A small screen stack over the home tabs (Settings, Friends, Challenges, profiles…).
// Kept outside React so deep links, notifications and results screens can open a page.
import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'settings' }
  | { name: 'friends' }
  | { name: 'challenges'; tab?: 'active' | 'history' }
  | { name: 'challenge'; id: string }
  | { name: 'player'; id: string }
  | { name: 'notifications' }
  | { name: 'invite'; token: string };

let stack: Route[] = [];
/** An invite link opened before the player was signed in (or mid-game); shown once they're on the menu. */
let pendingInvite: string | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const same = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b);

export const nav = {
  get: () => stack,
  subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  push(r: Route) {
    const top = stack[stack.length - 1];
    if (top && same(top, r)) return;
    stack = [...stack, r];
    emit();
  },
  /** Replace the whole stack (e.g. "Back to challenges" from a game). */
  reset(rs: Route[] = []) { stack = rs; emit(); },
  pop() { if (stack.length) { stack = stack.slice(0, -1); emit(); } },
  /** An invite link arrived: queue it until the player is signed in and on the menu. */
  openInvite(token: string) { pendingInvite = token; emit(); },
  takeInvite(): string | null { const t = pendingInvite; pendingInvite = null; return t; },
  hasInvite: () => pendingInvite != null,
  /** Pop back to the nearest route with this name, or push it. */
  backTo(r: Route) {
    const i = stack.map((x) => x.name).lastIndexOf(r.name);
    stack = i >= 0 ? [...stack.slice(0, i), r] : [...stack, r];
    emit();
  },
};

export function useNav(): Route[] {
  return useSyncExternalStore(nav.subscribe, nav.get, nav.get);
}

/** Pull an invite token out of a link: https://seanasewell.github.io/invite/?t=… or lastword://invite?t=… */
export function inviteTokenFrom(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = /[/:]invite\/?\?(?:.*&)?t=([A-Za-z0-9_-]{8,64})/.exec(url);
  return m ? m[1] : null;
}
