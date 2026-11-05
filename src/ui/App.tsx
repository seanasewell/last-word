import React from 'react';

import { GameScreen } from './GameScreen';
import { Home } from './Home';
import { useGame } from './kit';
import { EliminationScreen, FinalResults, Lobby, SoloResults } from './Screens';

/** Screen flow for the whole game, driven by the engine's phase. */
export function LastWordApp() {
  const g = useGame();
  switch (g.phase) {
    case 'menu': return <Home s={g} />;
    case 'sp-playing':
    case 'round': return <GameScreen s={g} />;
    case 'sp-results': return <SoloResults s={g} />;
    case 'lobby':
    case 'prematch': return <Lobby s={g} />;
    case 'elimination': return <EliminationScreen s={g} />;
    case 'final': return <FinalResults s={g} />;
  }
}
