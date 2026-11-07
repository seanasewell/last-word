// ── Push notifications (friend requests, challenges, results) ──────────────
// The server sends pushes through Expo when a notification is created. This file
// asks for permission, registers this phone's token, and opens the right screen when
// a notification is tapped. Pushes need a development or store build: Expo Go can't
// receive them, so there the in-app bell is the only place notifications appear.
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

import { registerPushToken, social } from './challenges';

type N = typeof import('expo-notifications');
let mod: N | null | undefined;
function notifications(): N | null {
  if (mod !== undefined) return mod;
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) { mod = null; return mod; }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require('expo-notifications') as N;
    mod.setNotificationHandler({
      // While the app is open: show the banner, never a sound (no surprise sounds).
      handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
    });
  } catch { mod = null; }
  return mod;
}

let registeredFor: string | null = null;

/** Ask once (after sign-in) and register this phone for the signed-in player. */
export async function registerForPush(userId: string): Promise<void> {
  const n = notifications();
  if (!n || registeredFor === userId) return;
  try {
    if (Platform.OS === 'android') {
      await n.setNotificationChannelAsync('default', { name: 'Friends and challenges', importance: n.AndroidImportance.DEFAULT, sound: null });
    }
    let { status } = await n.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await n.requestPermissionsAsync());
    if (status !== 'granted') return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    const { data } = await n.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    await registerPushToken(data, Platform.OS);
    registeredFor = userId;
  } catch { /* push stays off; the in-app bell still works */ }
}

export interface PushData { kind?: string; challengeId?: string | null }

/** Call `open` for a tapped notification (including the one that launched the app). */
export function onPushOpened(open: (d: PushData) => void): () => void {
  const n = notifications();
  if (!n) return () => {};
  const handle = (r: { notification: { request: { content: { data?: unknown } } } } | null) => {
    const d = r?.notification.request.content.data as PushData | undefined;
    if (d) { void social.refresh(); open(d); }
  };
  void n.getLastNotificationResponseAsync().then((r) => handle(r)).catch(() => {});
  const sub = n.addNotificationResponseReceivedListener(handle);
  // New pushes while the app is open: refresh the bell.
  const sub2 = n.addNotificationReceivedListener(() => { void social.refresh(); });
  return () => { sub.remove(); sub2.remove(); };
}
