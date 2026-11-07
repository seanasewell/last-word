import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { accounts } from '@/lib/account';
import { ads } from '@/lib/ads';
import { purchases } from '@/lib/purchases';
import { engine } from '@/lib/engine';
import { progress } from '@/lib/progress';
import { AuthFlow, Onboarding } from './Auth';
import { GameScreen } from './GameScreen';
import { Home } from './Home';
import { useAuth, useGame } from './kit';
import { startGameMusic, stopGameMusic } from './sound';
import { CelebrationHost } from './Progress';
import { SimulatedAdHost } from './RemoveAds';
import { EliminationScreen, FinalResults, Lobby, SoloCountdown, SoloResults } from './Screens';

/** Screen flow for the whole app: sign-in, onboarding, then the game's phases. */
export function LastWordApp() {
  const auth = useAuth();
  const g = useGame();
  const a = auth.account;

  // The server records each match; refresh wins and stats once it's decided for this player.
  useEffect(() => engine.onMatchEnd(() => { void accounts.afterMatch(); }), []);

  // Every finished game (elimination or solo) counts toward the next ad.
  useEffect(() => engine.onGameComplete((gameId) => ads.gameCompleted(gameId)), []);

  // Save a new solo personal best to the profile.
  useEffect(() => {
    if (g.phase === 'sp-results' && g.newBest) void accounts.saveSoloBest(g.personalBest);
  }, [g.phase, g.newBest, g.personalBest]);

  // Keep the game's player identity in step with the account.
  const id = a?.id;
  const name = a?.name;
  const photo = a?.photo ?? null;
  useEffect(() => {
    if (id) { progress.use(id); engine.setProfile(id, name || 'You', photo); }
    else engine.goMenu();
  }, [id, name, photo]);

  // Ad-free purchase: verified with the store for this account; load an ad early if one is due.
  useEffect(() => {
    if (!id) return;
    void purchases.start(id).then(() => ads.warmUp());
  }, [id]);

  // Back into an unfinished match after the app was closed (on launch and when it returns to the foreground).
  const ready = !!id && !auth.onboarding;
  useEffect(() => {
    if (!ready) return;
    void engine.resumeIfInMatch();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') { void engine.resumeIfInMatch(); void progress.refresh(); } });
    return () => sub.remove();
  }, [ready, id]);

  // Back on the home screen: pick up any XP the server awarded.
  useEffect(() => { if (g.phase === 'menu') void progress.refresh(); }, [g.phase]);

  // Music: starts when a game begins, keeps going through rounds and results, fades out on the menu.
  const gameKey = g.phase === 'sp-playing' || g.phase === 'round' ? g.matchId : null;
  useEffect(() => { if (gameKey) startGameMusic(gameKey); }, [gameKey]);
  useEffect(() => { if (g.phase === 'menu' || g.phase === 'lobby' || g.phase === 'sp-countdown') stopGameMusic(); }, [g.phase]);

  let key: string;
  let screen: React.ReactNode;
  if (!a) { key = 'auth'; screen = <AuthFlow />; }
  else if (auth.onboarding) { key = 'onboarding'; screen = <Onboarding />; }
  else {
    switch (g.phase) {
      case 'menu': key = 'home'; screen = <Home s={g} account={a} />; break;
      case 'sp-countdown': key = `sp-count-${g.matchId}`; screen = <SoloCountdown s={g} />; break;
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
    <>
      <Animated.View key={key} entering={FadeIn.duration(220)} style={{ flex: 1 }}>
        {screen}
      </Animated.View>
      <CelebrationHost />
      <SimulatedAdHost />
    </>
  );
}
