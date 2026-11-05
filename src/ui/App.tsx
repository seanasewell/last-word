import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { accounts } from '@/lib/account';
import { engine } from '@/lib/engine';
import { AuthFlow, Onboarding } from './Auth';
import { GameScreen } from './GameScreen';
import { Home } from './Home';
import { useAuth, useGame } from './kit';
import { EliminationScreen, FinalResults, Lobby, SoloResults } from './Screens';

/** Screen flow for the whole app: sign-in, onboarding, then the game's phases. */
export function LastWordApp() {
  const auth = useAuth();
  const g = useGame();
  const a = auth.account;

  // The server records each match; refresh wins and stats once it's decided for this player.
  useEffect(() => engine.onMatchEnd(() => { void accounts.afterMatch(); }), []);

  // Save a new solo personal best to the profile.
  useEffect(() => {
    if (g.phase === 'sp-results' && g.newBest) void accounts.saveSoloBest(g.personalBest);
  }, [g.phase, g.newBest, g.personalBest]);

  // Keep the game's player identity in step with the account.
  const id = a?.id;
  const name = a?.name;
  const photo = a?.photo ?? null;
  useEffect(() => {
    if (id) engine.setProfile(id, name || 'You', photo);
    else engine.goMenu();
  }, [id, name, photo]);

  // Back into an unfinished match after the app was closed (on launch and when it returns to the foreground).
  const ready = !!id && !auth.onboarding;
  useEffect(() => {
    if (!ready) return;
    void engine.resumeIfInMatch();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void engine.resumeIfInMatch(); });
    return () => sub.remove();
  }, [ready, id]);

  let key: string;
  let screen: React.ReactNode;
  if (!a) { key = 'auth'; screen = <AuthFlow />; }
  else if (auth.onboarding) { key = 'onboarding'; screen = <Onboarding />; }
  else {
    switch (g.phase) {
      case 'menu': key = 'home'; screen = <Home s={g} account={a} />; break;
      case 'sp-playing':
      case 'round': key = `game-${g.matchId}-${g.round}`; screen = <GameScreen s={g} />; break;
      case 'sp-results': key = 'sp-results'; screen = <SoloResults s={g} />; break;
      case 'lobby':
      case 'prematch': key = `lobby-${g.matchId}`; screen = <Lobby s={g} />; break;
      case 'elimination': key = `elim-${g.matchId}-${g.round}`; screen = <EliminationScreen s={g} />; break;
      case 'final': key = `final-${g.matchId}`; screen = <FinalResults s={g} />; break;
    }
  }
  // A quick cross-fade whenever the screen changes.
  return (
    <Animated.View key={key} entering={FadeIn.duration(220)} style={{ flex: 1 }}>
      {screen}
    </Animated.View>
  );
}
