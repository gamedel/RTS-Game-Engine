import { useRef, useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { GameState, Action } from '../types';
import { processUnitLogic } from './gameLogic/unitLogic';
import { processBuildingLogic } from './gameLogic/buildingLogic';
import { processWorldLogic } from './gameLogic/worldLogic';
import { processProjectileLogic } from './gameLogic/projectileLogic';
import { processCombatLogic } from './gameLogic/combatLogic';
import { processAiLogic } from './gameLogic/aiLogic';
import { createBufferedDispatch } from '../state/batch';
import { PathfindingManager } from './utils/pathfinding';


const FIXED_TIME_STEP = 1 / 60.0;
const MAX_STEPS_PER_FRAME = 3;

export const useGameEngine = (gameState: GameState, dispatch: React.Dispatch<Action>, setFps: (fps: number) => void) => {
  const gameStateRef = useRef(gameState);
  const frames = useRef(0);
  const lastTime = useRef(performance.now());
  const accumulator = useRef(0);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  
  const { d: bufferedDispatch, flush } = useMemo(() => createBufferedDispatch(dispatch), [dispatch]);

  // Init pathfinding manager
  useEffect(() => {
    PathfindingManager.init(dispatch);
    return () => PathfindingManager.terminate();
  }, [dispatch]);

  useFrame((_, delta) => {
    // FPS calculation
    frames.current++;
    const now = performance.now();
    if (now - lastTime.current >= 1000) {
        setFps(frames.current);
        frames.current = 0;
        lastTime.current = now;
    }

    const state = gameStateRef.current;
    if (state.gameStatus !== 'playing') return;

    // --- Pathfinding Grid Update & Queue Processing ---
    PathfindingManager.setGrid(state.buildings, state.resourcesNodes);
    PathfindingManager.processQueue();

    // --- Fixed Time Step Logic ---
    const clampedDelta = Math.min(delta, 0.1); 
    accumulator.current += clampedDelta;
    
    let steps = 0;
    while (accumulator.current >= FIXED_TIME_STEP && steps < MAX_STEPS_PER_FRAME) {
        
        const currentState = gameStateRef.current;

        processUnitLogic(currentState, FIXED_TIME_STEP, bufferedDispatch);
        processCombatLogic(currentState, FIXED_TIME_STEP, bufferedDispatch);
        processBuildingLogic(currentState, FIXED_TIME_STEP, bufferedDispatch);
        processProjectileLogic(currentState, FIXED_TIME_STEP, bufferedDispatch);
        processWorldLogic(currentState, FIXED_TIME_STEP, bufferedDispatch);
        processAiLogic(currentState, [], FIXED_TIME_STEP, bufferedDispatch);

        accumulator.current -= FIXED_TIME_STEP;
        steps++;
    }

    // Flush all buffered state updates at the end of the frame
    flush();
  });
};