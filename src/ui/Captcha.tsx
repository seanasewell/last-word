// ── Human check (Cloudflare Turnstile) ─────────────────────────────────────
// Turnstile only runs in a browser, so a small WebView loads our check page
// (hosted on GitHub Pages) and passes back a one-time token for sign-in.
// Most players never see it; if Cloudflare wants a click, the box appears.
import React, { useImperativeHandle, useState } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

export const CAPTCHA_URL = 'https://seanasewell.github.io/last-word/turnstile.html';

export interface CaptchaHandle {
  /** Get a fresh token (each token works for one sign-in). */
  reset: () => void;
}

type Msg = { type: 'token'; token: string } | { type: 'expired' } | { type: 'error'; code: string } | { type: 'interactive' } | { type: 'done-interactive' } | { type: 'ready' };

export function Captcha({ onToken, onError, ref }: {
  onToken: (token: string | null) => void;
  onError: (message: string) => void;
  ref?: React.Ref<CaptchaHandle>;
}) {
  const [interactive, setInteractive] = useState(false);
  const [reloads, setReloads] = useState(0);

  useImperativeHandle(ref, () => ({
    reset: () => {
      onToken(null);
      setReloads((n) => n + 1); // a fresh page is the most reliable reset
    },
  }), [onToken]);

  const onMessage = (e: WebViewMessageEvent) => {
    let m: Msg;
    try { m = JSON.parse(e.nativeEvent.data) as Msg; } catch { return; }
    if (m.type === 'token') { setInteractive(false); onToken(m.token); }
    else if (m.type === 'expired') onToken(null);
    else if (m.type === 'interactive') setInteractive(true);
    else if (m.type === 'done-interactive') setInteractive(false);
    else if (m.type === 'error') { onToken(null); onError("Couldn't check your connection. Tap Play to try again."); }
  };

  return (
    <View style={{ height: interactive ? 72 : 1, opacity: interactive ? 1 : 0, overflow: 'hidden' }}>
      <WebView
        key={reloads}
        source={{ uri: CAPTCHA_URL }}
        onMessage={onMessage}
        onError={() => { onToken(null); onError("Can't reach the server. Check your connection and tap Play."); }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        scrollEnabled={false}
        style={{ backgroundColor: 'transparent' }}
        containerStyle={{ backgroundColor: 'transparent' }}
      />
    </View>
  );
}
