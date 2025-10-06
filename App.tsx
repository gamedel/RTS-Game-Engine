import React, { useReducer, useMemo, useState, useRef, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { GameState, GameObject, AIDifficulty, MapType, Vector3, PlayerSetupConfig } from './types';
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
        await NavMeshManager.init(dispatch);
        if (!isMounted) return;

        setLoadingMessage('Building Navigation Mesh');
        await NavMeshManager.buildNavMesh(gameState.buildings, gameState.resourcesNodes);
        if (!isMounted) return;
        
        navMeshInitialized.current = true;
        setLoadingMessage(null);
      } catch (error) {
        console.error("Failed to initialize NavMeshManager:", error);
        if (isMounted) {
          setLoadingMessage("Error: Pathfinding failed to load");
        }
      }
    };

    initializeNavMesh();

    return () => {
      isMounted = false;
    };
  }, [gamePhase, dispatch, gameState.buildings, gameState.resourcesNodes]);

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
      border: '1px solid #0ea5e9',
      backgroundColor: 'rgba(14, 165, 233, 0.2)',
      pointerEvents: 'none',
      zIndex: 20,
    };
  }, [selectionBox]);

  const handleStartGame = (mapType: MapType, players: PlayerSetupConfig[]) => {
    navMeshInitialized.current = false;
    dispatch({ type: 'START_NEW_GAME', payload: { mapType, players } });
    setGamePhase('playing');
  };

  const handleBackToMenu = () => {
    setGamePhase('menu');
    navMeshInitialized.current = false;
    NavMeshManager.terminate();
  };
  
  const initialCameraPos: [number, number, number] = [0, 60, 70];

  return (
    <div className="w-screen h-screen flex flex-col bg-black text-white font-sans">
      {gamePhase === 'menu' && <MainMenu onStartGame={handleStartGame} />}
      {gamePhase === 'playing' && <LoadingOverlay loadingMessage={loadingMessage} />}
      {gamePhase === 'playing' && !loadingMessage && <GameStatusOverlay status={gameState.gameStatus} onBackToMenu={handleBackToMenu} />}
      {gamePhase === 'playing' && !loadingMessage && gameState.gameStatus === 'paused' && <PauseMenu dispatch={dispatch} onBackToMenu={handleBackToMenu} />}
      {gamePhase === 'playing' && !loadingMessage && <UI gameState={gameState} selectedObjects={selectedObjects} dispatch={dispatch} fps={fps} camera={camera} cameraControlsRef={cameraControlsRef} />}
      <div className="flex-grow relative">
        {gamePhase === 'playing' && isSelecting && <div style={selectionBoxStyle} />}
        <Canvas
          camera={{ position: initialCameraPos, fov: 35 }}
          shadows={false}
          dpr={isTouchDevice ? 1 : [1, 1.25]}
          gl={{ antialias: false, powerPreference: 'high-performance' }}
          onContextMenu={(e) => e.preventDefault()}
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