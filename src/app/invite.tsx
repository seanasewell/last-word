// Invite links (https://seanasewell.github.io/invite/?t=… or lastword://invite?t=…) land
// here. Queue the invite and go to the app; it opens once the player is signed in.
import { Redirect, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';

import { nav } from '@/ui/nav';

export default function InviteLink() {
  const { t } = useLocalSearchParams<{ t?: string }>();
  useEffect(() => { if (typeof t === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(t)) nav.openInvite(t); }, [t]);
  return <Redirect href="/" />;
}
