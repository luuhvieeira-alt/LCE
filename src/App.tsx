import { ErrorBoundary } from './components/common/ErrorBoundary';
import { GameProvider, useGame } from './context/GameContext';
import { SplashScreen } from './components/splash/SplashScreen';
import { AuthScreen } from './components/auth/AuthScreen';
import { CharacterCreator } from './components/character/CharacterCreator';
import { GameShell } from './components/layout/GameShell';

function AppRouter() {
  const { stage } = useGame();

  switch (stage) {
    case 'splash':
      return <SplashScreen />;
    case 'auth':
      return <AuthScreen />;
    case 'creator':
      return <CharacterCreator />;
    case 'game':
      return <GameShell />;
    default:
      return <SplashScreen />;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <GameProvider>
        <AppRouter />
      </GameProvider>
    </ErrorBoundary>
  );
}
