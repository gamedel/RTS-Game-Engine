import React, { useReducer, useMemo, useState, useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { GameState, GameObject, MapType, Vector3, PlayerSetupConfig } from './types';
import { createInitialGameState } from './constants';
import { UI } from './components/UI';
import { GameScene } from './components/GameScene';
import { gameReducer } from './state/reducer';
import { LocalizationProvider, useLocalization } from './hooks/useLocalization';
import { MainMenu } from './components/ui/MainMenu';
import { PauseMenu } from './components/ui/PauseMenu';
import * as THREE from 'three';
import { NavMeshManager } from './hooks/utils/navMeshManager';
import { useIsTouchDevice } from './hooks/useIsTouchDevice';

const GameStatusOverlay: React.FC<{ status: GameState['gameStatus'], onBackToMenu: () => void }> = ({ status, onBackToMenu }) => {
    const { t } = useLocalization();
    if (status !== 'won' && status !== 'lost') return null;

    const message = status === 'won' ? t('ui.youWin') : t('ui.youLose');
    const messageColor = status === 'won' ? 'text-green-400' : 'text-red-400';

    return (
        <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center z-50">
            <h1 className={`text-7xl font-bold ${messageColor} mb-8`}>{message}</h1>
            <button
                onClick={onBackToMenu}
                className="px-8 py-4 bg-slate-700 hover:bg-slate-600 text-white font-bold text-2xl rounded-lg ring-2 ring-slate-500 transition-transform transform hover:scale-105"
            >
                {t('ui.backToMenu')}
            </button>
        </div>
    );
};

const LoadingOverlay: React.FC<{ loadingMessage: string | null }> = ({ loadingMessage }) => {
    if (!loadingMessage) return null;
    return (
        <div className="absolute inset-0 bg-slate-900/90 flex flex-col items-center justify-center z-50">
            <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-sky-400 mb-6"></div>
            <h2 className="text-3xl font-bold text-slate-200">{loadingMessage}...</h2>
        </div>
    );
};


const StatusBar: React.FC<{ message: string | null }> = ({ message }) => {
  if (!message) return null;
  return (
    <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-50 flex justify-center pb-3">
      <div className="pointer-events-auto max-w-full rounded-md bg-slate-900/80 px-4 py-2 text-sm text-slate-200 shadow-lg ring-1 ring-slate-700">
        {message}
      </div>
    </div>
  );
};

type CanvasErrorBoundaryProps = {
  children: React.ReactNode;
  onError?: (error: Error) => void;
  resetKey: string;
};

class CanvasErrorBoundary extends React.Component<CanvasErrorBoundaryProps, { hasError: boolean }> {
  constructor(props: CanvasErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error);
  }

  componentDidUpdate(prevProps: CanvasErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}

const CanvasErrorOverlay: React.FC<{ message: string; onBackToMenu: () => void }> = ({ message, onBackToMenu }) => (
  <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/80 px-6 text-center text-slate-100">
    <h2 className="mb-4 text-2xl font-bold text-red-300">Rendering Error</h2>
    <p className="mb-6 max-w-xl text-base text-slate-200">{message}</p>
    <button
      onClick={onBackToMenu}
      className="rounded-lg bg-slate-700 px-6 py-3 text-lg font-semibold text-white shadow ring-2 ring-slate-500 transition hover:bg-slate-600"
    >
      Return to Main Menu
    </button>
  </div>
);


export type CameraControlsRef = {
  setTarget: (target: Vector3) => void;
};

const defaultPlayers: PlayerSetupConfig[] = [
    { isHuman: true, teamId: '1' },
    { isHuman: false, teamId: '2', difficulty: 'normal' }
];

function AppContent() {
  const [gameState, dispatch] = useReducer(gameReducer, createInitialGameState('default', defaultPlayers));
  const [selectionBox, setSelectionBox] = useState<{ start: { x: number, y: number }, end: { x: number, y: number } } | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [fps, setFps] = useState(0);
  const [gamePhase, setGamePhase] = useState<'menu' | 'playing'>('menu');
  const [camera, setCamera] = useState<THREE.Camera | null>(null);
  const cameraControlsRef = useRef<CameraControlsRef>(null);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>('Ready');
  const [canvasError, setCanvasError] = useState<string | null>(null);
  const navMeshInitialized = useRef(false);
  const isTouchDevice = useIsTouchDevice();

  useEffect(() => {
    if (gamePhase !== 'playing' || navMeshInitialized.current) {
      return;
    }

    let isMounted = true;
    const initializeNavMesh = async () => {
      try {
        setLoadingMessage('Initializing Pathfinding');
        setStatusMessage('Initializing pathfinding...');
        await NavMeshManager.init(dispatch);
        if (!isMounted) return;

        setLoadingMessage('Building Navigation Mesh');
        setStatusMessage('Building navigation mesh...');
        await NavMeshManager.buildNavMesh(gameState.buildings, gameState.resourcesNodes);
        if (!isMounted) return;

        navMeshInitialized.current = true;
        setLoadingMessage(null);
        setStatusMessage('Navigation mesh ready');
      } catch (error) {
        console.error("Failed to initialize NavMeshManager:", error);
        if (isMounted) {
          const message = error instanceof Error ? error.message : String(error);
          setLoadingMessage("Error: Pathfinding failed to load");
          setStatusMessage(`NavMesh error: ${message}`);
        }
      }
    };

    initializeNavMesh();

    return () => {
      isMounted = false;
    };
  }, [gamePhase, dispatch, gameState.buildings, gameState.resourcesNodes]);

  useEffect(() => {
    if (gamePhase !== 'playing') {
      setStatusMessage('Ready');
      return;
    }

    const updateStatus = () => {
      const diag = NavMeshManager.getDiagnostics();
      const base = `Nav queue: ${diag.queueDepth} queued / ${diag.pending} pending`;
      if (!diag.lastSearchResult) {
        setStatusMessage(prev => (prev === base ? prev : base));
        return;
      }
      const detail = `${diag.lastSearchResult} in ${diag.lastSearchMs.toFixed(2)}ms (expanded ${diag.lastSearchExpanded})`;
      const reason = diag.lastFailureReason ? ` – last error: ${diag.lastFailureReason}` : '';
      const summary = `${base} — ${detail}${reason}`;
      setStatusMessage(prev => (prev === summary ? prev : summary));
    };

    updateStatus();
    const interval = window.setInterval(updateStatus, 750);
    return () => {
      window.clearInterval(interval);
    };
  }, [gamePhase]);

  const selectedObjects = useMemo(() => {
    const allObjects = { ...gameState.units, ...gameState.buildings, ...gameState.resourcesNodes };
    return gameState.selectedIds.map(id => allObjects[id]).filter(Boolean) as GameObject[];
  }, [gameState.selectedIds, gameState.units, gameState.buildings, gameState.resourcesNodes]);

  const selectionBoxStyle: React.CSSProperties = useMemo(() => {
    if (!selectionBox) return { display: 'none' };
    const { start, end } = selectionBox;
    const left = Math.min(start.x, end.x);
    const top = Math.min(start.y, end.y);
    const width = Math.abs(start.x - end.x);
    const height = Math.abs(start.y - end.y);
    return {
      position: 'absolute',
      left,
      top,
      width,
      height,
      border: '1px solid #22c55e',
      backgroundColor: 'rgba(34, 197, 94, 0.22)',
      pointerEvents: 'none',
      zIndex: 20,
    };
  }, [selectionBox]);

  const handleStartGame = (mapType: MapType, players: PlayerSetupConfig[]) => {
    navMeshInitialized.current = false;
    dispatch({ type: 'START_NEW_GAME', payload: { mapType, players } });
    setGamePhase('playing');
    setStatusMessage('Starting new game...');
    setCanvasError(null);
  };

  const handleBackToMenu = () => {
    setGamePhase('menu');
    navMeshInitialized.current = false;
    NavMeshManager.terminate();
    setLoadingMessage(null);
    setCanvasError(null);
    setStatusMessage('Returned to main menu');
  };

  const handleCanvasError = (error: Error) => {
    const message = error.message || 'Unknown rendering error';
    setCanvasError(message);
    setStatusMessage(`Canvas error: ${message}`);
    setLoadingMessage(null);
  };

  const initialCameraPos: [number, number, number] = [0, 60, 70];

  useEffect(() => {
    if (gamePhase !== 'playing') {
      return;
    }

    const preventContextMenu = (event: Event) => {
      event.preventDefault();
    };

    document.addEventListener('contextmenu', preventContextMenu, true);
    return () => {
      document.removeEventListener('contextmenu', preventContextMenu, true);
    };
  }, [gamePhase]);

  return (
    <div className="w-screen h-screen flex flex-col bg-black text-white font-sans">
      {gamePhase === 'menu' && <MainMenu onStartGame={handleStartGame} />}
      {gamePhase === 'playing' && <LoadingOverlay loadingMessage={loadingMessage} />}
      {gamePhase === 'playing' && !loadingMessage && <GameStatusOverlay status={gameState.gameStatus} onBackToMenu={handleBackToMenu} />}
      {gamePhase === 'playing' && !loadingMessage && gameState.gameStatus === 'paused' && <PauseMenu dispatch={dispatch} onBackToMenu={handleBackToMenu} />}
      {gamePhase === 'playing' && !loadingMessage && (
        <UI
          gameState={gameState}
          selectedObjects={selectedObjects}
          dispatch={dispatch}
          fps={fps}
          camera={camera}
          cameraControlsRef={cameraControlsRef}
          isTouchDevice={isTouchDevice}
        />
      )}
      <div className="flex-grow relative">
        {gamePhase === 'playing' && isSelecting && <div style={selectionBoxStyle} />}
        <CanvasErrorBoundary onError={handleCanvasError} resetKey={gamePhase}>
          {!canvasError && (
            <Canvas
              camera={{ position: initialCameraPos, fov: 35 }}
              shadows={false}
              dpr={isTouchDevice ? 1 : [1, 1.25]}
              gl={{ antialias: false, powerPreference: 'high-performance' }}
              onContextMenu={(e) => {
                if (typeof e.preventDefault === 'function') {
                  e.preventDefault();
                } else if (e?.nativeEvent && typeof e.nativeEvent.preventDefault === 'function') {
                  e.nativeEvent.preventDefault();
                }
              }}
            >
                <GameScene
                  gamePhase={gamePhase}
                  gameState={gameState}
                  dispatch={dispatch}
                  setSelectionBox={setSelectionBox}
                  setIsSelecting={setIsSelecting}
                  setFps={setFps}
                  setCamera={setCamera}
                  cameraControlsRef={cameraControlsRef}
                />
            </Canvas>
          )}
        </CanvasErrorBoundary>
        {canvasError && <CanvasErrorOverlay message={canvasError} onBackToMenu={handleBackToMenu} />}
        <StatusBar message={statusMessage} />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <LocalizationProvider>
      <AppContent />
    </LocalizationProvider>
  );
}
