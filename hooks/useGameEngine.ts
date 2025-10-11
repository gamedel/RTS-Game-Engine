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
import { NavMeshManager } from './utils/navMeshManager';
import { updateSquadFormations } from './utils/formations';

const BUILD_IDENTIFIER = 'RTS build 2025-02-14T12:00Z - movement-opt logging';

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

  useEffect(() => {
    // Emit once per fresh bundle so it is easy to validate the build.
    console.info(BUILD_IDENTIFIER);
  }, []);

  
  const { d: bufferedDispatch, flush } = useMemo(() => createBufferedDispatch(dispatch), [dispatch]);

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
    if (!NavMeshManager.isReady()) return; // Don't run game logic until navmesh is built

    const frameStart = performance.now();

    // --- Pathfinding Queue Processing ---
    NavMeshManager.processQueue();
    const afterQueue = performance.now();

    // --- Fixed Time Step Logic ---
    const clampedDelta = Math.min(delta, 0.1); 
    accumulator.current += clampedDelta;
    
    let steps = 0;
    while (accumulator.current >= FIXED_TIME_STEP && steps < MAX_STEPS_PER_FRAME) {
        
        const currentState = gameStateRef.current;

        const tFormStart = performance.now();
        updateSquadFormations(currentState, bufferedDispatch);
        const tUnitsStart = performance.now();
        processUnitLogic(currentState, FIXED_TIME_STEP, bufferedDispatch);
        const tCombatStart = performance.now();
        processCombatLogic(currentState, FIXED_TIME_STEP, bufferedDispatch);
        const tBuildStart = performance.now();
        processBuildingLogic(currentState, FIXED_TIME_STEP, bufferedDispatch);
        const tProjStart = performance.now();
        processProjectileLogic(currentState, FIXED_TIME_STEP, bufferedDispatch);
        const tWorldStart = performance.now();
        processWorldLogic(currentState, FIXED_TIME_STEP, bufferedDispatch);
        const tAiStart = performance.now();
        processAiLogic(currentState, [], FIXED_TIME_STEP, bufferedDispatch);
        const tLoopEnd = performance.now();

        accumulator.current -= FIXED_TIME_STEP;
        steps++;

        const frameBudget = tLoopEnd - frameStart;
        if (frameBudget > 8) {
          console.info('[EngineFrame]', {
            steps,
            pathQueueMs: afterQueue - frameStart,
            formationsMs: tUnitsStart - tFormStart,
            unitsMs: tCombatStart - tUnitsStart,
            combatMs: tBuildStart - tCombatStart,
            buildingsMs: tProjStart - tBuildStart,
            projectilesMs: tWorldStart - tProjStart,
            worldMs: tAiStart - tWorldStart,
            aiMs: tLoopEnd - tAiStart,
            frameTotalMs: frameBudget
          });
        }
    }

    // Flush all buffered state updates at the end of the frame
    flush();
  });
};
