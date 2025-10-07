import React, { useMemo, useCallback, useRef, useState, useEffect, forwardRef, useImperativeHandle } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { GameState, Action, GameObject, GameObjectType, UnitType, BuildingType, ResourceType, Unit, Building, ResourceNode, UnitStatus, Vector3, CommandMarker as CommandMarkerType, Projectile, UnitStance } from '../types';
import { useGameEngine } from '../hooks/useGameEngine';
import { TownHall, Barracks, House, DefensiveTower, Warehouse, ResearchCenter, Market } from './game/buildings';
import { Tree, GoldMine } from './game/resources';
import { Arrow, CatapultShell } from './game/projectiles';
import { BuildingPlaceholder } from './game/scene/BuildingPlaceholder';
import { Ground } from './game/scene/Ground';
import { FloatingResourceText } from './game/scene/FloatingResourceText';
import { CommandMarker } from './game/scene/CommandMarker';
import { ExplosionMarker } from './game/scene/ExplosionMarker';
import { RallyPointMarker } from './game/scene/RallyPointMarker';
import { CameraControlsRef } from '../../App';
import { v4 as uuidv4 } from 'uuid';
import { InstancedRenderer } from './game/InstancedRenderer';
import { useIsTouchDevice } from '../hooks/useIsTouchDevice';

// This component exists solely to host the useGameEngine hook within the Canvas context.
const GameEngineComponent: React.FC<{ gameState: GameState, dispatch: React.Dispatch<Action>, setFps: (fps: number) => void }> = ({ gameState, dispatch, setFps }) => {
  useGameEngine(gameState, dispatch, setFps);
  return null; // It does not render anything to the scene.
};

// --- Helper Functions ---
const getDistanceSimple = (p1: { x:number, z:number }, p2: { x:number, z:number }) => {
    const dx = p1.x - p2.x;
    const dz = p1.z - p2.z;
    return Math.sqrt(dx*dx + dz*dz);
}

// Generates positions for units in a circular/spread-out formation
const getFormationPositions = (center: Vector3, count: number): Vector3[] => {
    if (count <= 1) {
        return [center];
    }
    const positions: Vector3[] = [];
    const spacing = 2.5;
    let placedCount = 0;
    
    // Find how many rings are needed. This is a loose approximation.
    let rings = 0;
    let capacity = 0;
    while(capacity < count) {
        capacity += (rings === 0 ? 1 : Math.floor(2 * Math.PI * rings));
        rings++;
    }

    positions.push(center);
    placedCount++;

    for (let ring = 1; ring < rings && placedCount < count; ring++) {
        const numInRing = Math.min(count - placedCount, Math.floor(2 * Math.PI * ring * 1.5));
        const angleStep = (2 * Math.PI) / numInRing;
        for (let i = 0; i < numInRing && placedCount < count; i++) {
            const angle = angleStep * i + (ring % 2) * (angleStep / 2);
            positions.push({
                x: center.x + ring * spacing * Math.cos(angle),
                y: center.y,
                z: center.z + ring * spacing * Math.sin(angle),
            });
            placedCount++;
        }
    }
    return positions;
};

// This component renders an expensive element once and makes it invisible.
// This forces the shaders to compile on load, preventing stutter later.
const PrewarmScene = () => (
    <group visible={false}>
      <FloatingResourceText textData={{
        id: 'prewarm',
        text: '+0',
        position: {x: 0, y: 0, z: 0},
        resourceType: 'GOLD',
        startTime: 0,
      }} />
      <Arrow projectile={{ id: 'prewarm-arrow', type: GameObjectType.PROJECTILE, position: {x:0,y:0,z:0}, sourceId: '', targetId: '', speed: 0, damage: 0, playerId: 0 } as Projectile} />
      <CatapultShell projectile={{ id: 'prewarm-catapult', type: GameObjectType.PROJECTILE, position: {x:0,y:0,z:0}, sourceId: '', targetId: '', speed: 0, damage: 0, playerId: 0 } as Projectile} />
    </group>
);


type GameSceneProps = {
    gamePhase: 'menu' | 'playing';
    gameState: GameState;
    dispatch: React.Dispatch<Action>;
    setSelectionBox: (box: { start: { x: number; y: number }; end: { x: number; y: number } } | null) => void;
    setIsSelecting: (isSelecting: boolean) => void;
    setFps: (fps: number) => void;
    setCamera: (camera: THREE.Camera) => void;
    cameraControlsRef: React.RefObject<CameraControlsRef>;
};

type ActivePointerState = {
    target: 'ground' | 'object';
    objectId?: string;
    pointerType: string;
    start: { x: number; y: number };
    startPoint?: THREE.Vector3;
    startTime: number;
    hasMoved: boolean;
};

const LONG_PRESS_THRESHOLD = 400;
const TOUCH_DRAG_THRESHOLD = 18;

const getPointerType = (event: any): string => {
    return event.pointerType || event?.nativeEvent?.pointerType || 'mouse';
};

// --- Camera Control Components ---

// Renders only during the 'menu' phase to provide a cinematic camera sweep.
const MenuCameraAnimator: React.FC<{ target: THREE.Vector3 }> = ({ target }) => {
    useFrame((state) => {
        const time = state.clock.getElapsedTime();
        // A slow sweep around the new rotated view point.
        const baseAngle = Math.PI / 2; // Corresponds to an offset of (x:70, z:0)
        const sweep = Math.PI / 12; // 15 degrees sweep
        const angle = baseAngle + Math.sin(time * 0.15) * sweep;
        const distance = 70;
        state.camera.position.x = target.x + distance * Math.sin(angle);
        state.camera.position.z = target.z + distance * Math.cos(angle);
        state.camera.lookAt(target);
    });
    return null;
};

// Renders only during the 'playing' phase to enable player camera controls.
const GameCameraControls = forwardRef<CameraControlsRef, { initialTarget: Vector3 }>(({ initialTarget }, ref) => {
    const { camera } = useThree();
    const controlsRef = useRef<any>(null!);

    useImperativeHandle(ref, () => ({
        setTarget: (target: Vector3) => {
            if (controlsRef.current) {
                const controls = controlsRef.current;
                const currentTarget = controls.target.clone();
                const newTarget = new THREE.Vector3(target.x, target.y, target.z);
                const offset = new THREE.Vector3().subVectors(camera.position, currentTarget);
                camera.position.copy(newTarget.clone().add(offset));
                controls.target.copy(newTarget);
                controls.update();
            }
        },
    }));

    // This effect runs once when the game starts (forced by key prop) to set the initial position.
    useEffect(() => {
        if (controlsRef.current) {
            const controls = controlsRef.current;
            const targetPos = new THREE.Vector3(initialTarget.x, initialTarget.y, initialTarget.z);
            
            // Set camera to a default offset (e.g., looking from the South)
            camera.position.set(targetPos.x, targetPos.y + 60, targetPos.z + 70);
            
            // Update the controls' target to look at the new position
            controls.target.copy(targetPos);
            controls.update();
        }
    }, [camera, initialTarget]);

    return (
        <OrbitControls
            ref={controlsRef}
            enablePan={true}
            enableZoom={true}
            enableRotate={false}
            screenSpacePanning={false}
            minPolarAngle={Math.PI / 6}
            maxPolarAngle={Math.PI / 4.5}
            minDistance={15}
            maxDistance={120}
            mouseButtons={{
                LEFT: undefined,
                MIDDLE: THREE.MOUSE.PAN,
                RIGHT: undefined,
            }}
        />
    );
});


const GameScene: React.FC<GameSceneProps> = ({ gamePhase, gameState, dispatch, setSelectionBox, setIsSelecting, setFps, setCamera, cameraControlsRef }) => {
  const isTouchDevice = useIsTouchDevice();
  const allBuildingsAndResources = useMemo(() => [
    ...Object.values(gameState.buildings),
    ...Object.values(gameState.resourcesNodes)
  ], [gameState.buildings, gameState.resourcesNodes]);

  const allObjectsMap = useMemo(() => {
      const map = new Map<string, GameObject>();
      Object.values(gameState.units).forEach(u => map.set(u.id, u));
      Object.values(gameState.buildings).forEach(b => map.set(b.id, b));
      Object.values(gameState.resourcesNodes).forEach(r => map.set(r.id, r));
      return map;
  }, [gameState.units, gameState.buildings, gameState.resourcesNodes]);
  
  const gatheringWorkersMap = useMemo(() => {
    const map = new Map<string, Unit>();
    for (const unit of Object.values(gameState.units)) {
        if (unit.unitType === UnitType.WORKER && unit.status === UnitStatus.GATHERING && unit.targetId) {
            map.set(unit.targetId, unit);
        }
    }
    return map;
  }, [gameState.units]);

  const { camera: R3FCamera, size } = useThree();
  const selectionStartPoint = useRef<{x: number, y: number} | null>(null);
  const activePointerRef = useRef<ActivePointerState | null>(null);
  const lastClickRef = useRef<{ id: string, time: number } | null>(null);
  const DOUBLE_CLICK_TIMEOUT = isTouchDevice ? 400 : 300; // ms
  const humanPlayer = gameState.players.find(p => p.isHuman);

  const selectedIdsSet = useMemo(() => new Set(gameState.selectedIds), [gameState.selectedIds]);


  useEffect(() => {
    setCamera(R3FCamera);
  }, [R3FCamera, setCamera]);

  const playerTownHall = useMemo(() => {
    if (!humanPlayer) return null;
    return Object.values(gameState.buildings).find(
        b => b.playerId === humanPlayer.id && b.buildingType === BuildingType.TOWN_HALL
    );
  }, [gameState.buildings, humanPlayer]);

  const playerTownHallPosition = useMemo(() => {
    if (playerTownHall) {
        return new THREE.Vector3(playerTownHall.position.x, playerTownHall.position.y, playerTownHall.position.z);
    }
    // Fallback for initial render before gameState is fully populated
    return new THREE.Vector3(-70, 0, 65);
  }, [playerTownHall]);

  const handleObjectClick = useCallback((e: any, id:string) => {
    if (gamePhase !== 'playing' || !humanPlayer) return;
    e.stopPropagation();
    if (gameState.buildMode) return;
    
    const clickedObject = allObjectsMap.get(id);
    if (!clickedObject) return;

    // --- Double Click Logic ---
    const now = Date.now();
    if (lastClickRef.current && lastClickRef.current.id === id && (now - lastClickRef.current.time) < DOUBLE_CLICK_TIMEOUT) {
        
        if (clickedObject.playerId === humanPlayer.id && (clickedObject.type === GameObjectType.UNIT || clickedObject.type === GameObjectType.BUILDING)) {
            const objectType = clickedObject.type === GameObjectType.UNIT ? (clickedObject as Unit).unitType : (clickedObject as Building).buildingType;

            const allPlayerObjects = [...Object.values(gameState.units), ...Object.values(gameState.buildings)].filter(obj => obj.playerId === humanPlayer.id);

            const matchingVisibleIds = allPlayerObjects.filter(obj => {
                // Check for type match
                const typeMatch = (obj.type === GameObjectType.UNIT && (obj as Unit).unitType === objectType) || (obj.type === GameObjectType.BUILDING && (obj as Building).buildingType === objectType);
                if (!typeMatch) return false;

                // Check if on screen
                const posVec = new THREE.Vector3(obj.position.x, obj.position.y, obj.position.z);
                posVec.project(R3FCamera);
                const screenX = (posVec.x * 0.5 + 0.5) * size.width;
                const screenY = (posVec.y * -0.5 + 0.5) * size.height;
                return screenX >= 0 && screenX <= size.width && screenY >= 0 && screenY <= size.height;
            }).map(obj => obj.id);
            
            dispatch({ type: 'SET_SELECTION', payload: matchingVisibleIds });
        }
        
        lastClickRef.current = null; // Reset after double click
        return;
    }
    
    lastClickRef.current = { id, time: now };


    // --- Single Click Logic ---
    if (clickedObject.playerId !== humanPlayer.id) {
        dispatch({ type: 'SELECT_OBJECT', payload: { id, isShift: false } });
    } else {
        dispatch({ type: 'SELECT_OBJECT', payload: { id, isShift: e.shiftKey } });
    }
  }, [dispatch, gameState.buildMode, allObjectsMap, R3FCamera, size, gameState.units, gameState.buildings, gamePhase, humanPlayer]);
  
  const handleObjectContextMenu = useCallback((e: any, targetId: string) => {
    if (gamePhase !== 'playing' || !humanPlayer) return;
    e.stopPropagation();
    if (gameState.buildMode) {
        dispatch({ type: 'SET_BUILD_MODE', payload: null });
        return;
    }
    const target = allObjectsMap.get(targetId);
    if (!target) return;
    
    const selectedUnits = gameState.selectedIds
        .map(id => gameState.units[id])
        .filter(u => u && u.type === GameObjectType.UNIT && u.playerId === humanPlayer.id);
    
    if (selectedUnits.length > 0) {
        selectedUnits.forEach(unit => {
           dispatch({ type: 'COMMAND_UNIT', payload: { unitId: unit.id, targetPosition: target.position, targetId, finalDestination: target.position } });
        });

        // Add a single marker on the target
        const marker: CommandMarkerType = {
            id: uuidv4(),
            position: target.position,
            startTime: Date.now(),
        };
        dispatch({ type: 'ADD_COMMAND_MARKER', payload: marker });
    }
  }, [dispatch, gameState.selectedIds, gameState.units, gameState.buildMode, allObjectsMap, gamePhase, humanPlayer]);

  const processGroundSimpleClick = useCallback((e: any) => {
    if (gamePhase !== 'playing' || !humanPlayer) return;

    if (gameState.buildMode && gameState.buildMode.canPlace) {
       const selectedWorkers = gameState.selectedIds
          .map(id => gameState.units[id])
          .filter(u => u && u.type === GameObjectType.UNIT && u.unitType === UnitType.WORKER) as Unit[];

       let builders = selectedWorkers;

       if (builders.length === 0) {
          const idleWorker = Object.values(gameState.units).find(u => u.unitType === UnitType.WORKER && u.status === UnitStatus.IDLE && u.playerId === humanPlayer.id);
          if (idleWorker) builders = [idleWorker];
       }

       if (builders.length > 0) {
           dispatch({
               type: 'COMMAND_BUILD',
               payload: {
                  workerIds: builders.map(b => b.id),
                  type: gameState.buildMode.type,
                  position: { x: e.point.x, y: 0, z: e.point.z },
              }
           });
       } else {
           dispatch({ type: 'SET_BUILD_MODE', payload: null });
       }
       return;
    }

    const clickPoint = new THREE.Vector3(e.point.x, 0, e.point.z);
    let clickedUnit: Unit | null = null;
    let minDistanceSq = 1.5 * 1.5;

    for (const unit of Object.values(gameState.units)) {
        if (unit.isDying) continue;
        const unitPos = new THREE.Vector3(unit.position.x, 0, unit.position.z);
        const distanceSq = clickPoint.distanceToSquared(unitPos);
        if (distanceSq < minDistanceSq) {
            minDistanceSq = distanceSq;
            clickedUnit = unit;
        }
    }

    if (clickedUnit) {
        handleObjectClick(e, clickedUnit.id);
    } else {
        dispatch({ type: 'SELECT_OBJECT', payload: { id: null } });
    }
  }, [dispatch, gamePhase, gameState.buildMode, gameState.selectedIds, gameState.units, handleObjectClick, humanPlayer]);

  const handleGroundContextMenu = useCallback((e: any) => {
    if (gamePhase !== 'playing' || !humanPlayer) return;
    e.stopPropagation();
    if (gameState.buildMode) {
        dispatch({ type: 'SET_BUILD_MODE', payload: null });
        return;
    }

    const selectedPlayerBuildings = gameState.selectedIds
        .map(id => gameState.buildings[id])
        .filter(b => b && b.playerId === humanPlayer.id && (b.buildingType === BuildingType.TOWN_HALL || b.buildingType === BuildingType.BARRACKS)) as Building[];

    if (selectedPlayerBuildings.length > 0) {
        const firstType = selectedPlayerBuildings[0].buildingType;
        const allSameType = selectedPlayerBuildings.every(b => b.buildingType === firstType);

        if (allSameType) {
            const rallyPosition = { x: e.point.x, y: 0, z: e.point.z };
            selectedPlayerBuildings.forEach(building => {
                dispatch({ type: 'SET_RALLY_POINT', payload: { buildingId: building.id, position: rallyPosition } });
            });

            const marker: CommandMarkerType = {
                id: uuidv4(),
                position: rallyPosition,
                startTime: Date.now(),
            };
            dispatch({ type: 'ADD_COMMAND_MARKER', payload: marker });
            return;
        }
    }

    const selectedUnits = gameState.selectedIds
        .map(id => gameState.units[id])
        .filter(u => u && u.type === GameObjectType.UNIT && u.playerId === humanPlayer.id) as Unit[];

    if (selectedUnits.length > 0) {
        const targetCenter = { x: e.point.x, y: 0, z: e.point.z };
        const formationPositions = getFormationPositions(targetCenter, selectedUnits.length);
        const squadId = uuidv4();

        // Distribute positions to units
        selectedUnits.forEach((unit, index) => {
            const targetPosition = formationPositions[index] || targetCenter;
            dispatch({ type: 'COMMAND_UNIT', payload: { unitId: unit.id, targetPosition, finalDestination: targetPosition, targetId: undefined, squadId } });
        });

        // Show a reduced number of markers for performance
        formationPositions.forEach((pos, i) => {
            // Show one marker for every 6 units, plus the very last one to mark the formation's end
            if (i % 6 !== 0 && i !== formationPositions.length - 1) return;
            const marker: CommandMarkerType = {
                id: uuidv4(),
                position: pos,
                startTime: Date.now(),
            };
            dispatch({ type: 'ADD_COMMAND_MARKER', payload: marker });
        });
    }
  }, [dispatch, gameState.selectedIds, gameState.units, gameState.buildings, gameState.buildMode, gamePhase, humanPlayer]);

  const handleGroundPointerDown = useCallback((e: any) => {
    if (gamePhase !== 'playing') return;
    const pointerType = getPointerType(e);

    if (pointerType === 'touch') {
      activePointerRef.current = {
        target: 'ground',
        pointerType,
        start: { x: e.nativeEvent?.offsetX ?? 0, y: e.nativeEvent?.offsetY ?? 0 },
        startPoint: new THREE.Vector3(e.point.x, 0, e.point.z),
        startTime: Date.now(),
        hasMoved: false,
      };
      return;
    }

    if (e.button === 0) { // Left click
      selectionStartPoint.current = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
      setIsSelecting(true);
    }
  }, [setIsSelecting, gamePhase]);

  const handleGroundPointerMove = useCallback((e: any) => {
    if (gamePhase !== 'playing') return;
    const pointerType = getPointerType(e);

    if (pointerType === 'touch') {
      if (activePointerRef.current && activePointerRef.current.target === 'ground') {
        const offsetX = e.nativeEvent?.offsetX ?? activePointerRef.current.start.x;
        const offsetY = e.nativeEvent?.offsetY ?? activePointerRef.current.start.y;
        const dragDistance = Math.hypot(offsetX - activePointerRef.current.start.x, offsetY - activePointerRef.current.start.y);
        if (dragDistance > TOUCH_DRAG_THRESHOLD) {
          activePointerRef.current.hasMoved = true;
        }
      }
      return;
    }

    if (selectionStartPoint.current) {
      setSelectionBox({ start: selectionStartPoint.current, end: { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY } });
    } else if (gameState.buildMode) {
       dispatch({ type: 'UPDATE_BUILD_PLACEHOLDER', payload: { position: {x: e.point.x, y: 0, z: e.point.z}, canPlace: true } });
    }
  }, [gameState.buildMode, setSelectionBox, dispatch, gamePhase]);

  const handleGroundPointerUp = useCallback((e: any) => {
    if (gamePhase !== 'playing' || !humanPlayer) return;
    const pointerType = getPointerType(e);

    if (pointerType === 'touch') {
      const pointer = activePointerRef.current;
      activePointerRef.current = null;

      selectionStartPoint.current = null;
      setIsSelecting(false);
      setSelectionBox(null);

      if (!pointer || pointer.target !== 'ground') {
        return;
      }

      const endX = e.nativeEvent?.offsetX ?? pointer.start.x;
      const endY = e.nativeEvent?.offsetY ?? pointer.start.y;
      const dragDistance = Math.hypot(endX - pointer.start.x, endY - pointer.start.y);
      const moved = pointer.hasMoved || dragDistance > TOUCH_DRAG_THRESHOLD;

      if (moved) {
        return;
      }

      const pressDuration = Date.now() - pointer.startTime;

      if (pressDuration >= LONG_PRESS_THRESHOLD) {
        e.stopPropagation();
        handleGroundContextMenu(e);
      } else {
        processGroundSimpleClick(e);
      }
      return;
    }

    if (e.button === 0 && selectionStartPoint.current) { // Left click release
      const start = selectionStartPoint.current;
      const end = { x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY };
      const dragDistance = Math.hypot(end.x - start.x, end.y - start.y);

      if (dragDistance < 10) {
        processGroundSimpleClick(e);
      } else {
        const box = {
          minX: Math.min(start.x, end.x),
          maxX: Math.max(start.x, end.x),
          minY: Math.min(start.y, end.y),
          maxY: Math.max(start.y, end.y),
        };

        const allPlayerObjects = [...Object.values(gameState.units), ...Object.values(gameState.buildings)]
          .filter(obj => obj.playerId === humanPlayer.id);

        const objectsInBox = allPlayerObjects.filter(obj => {
          const objPos = new THREE.Vector3(obj.position.x, obj.position.y, obj.position.z);
          objPos.project(R3FCamera);
          const screenX = (objPos.x * 0.5 + 0.5) * size.width;
          const screenY = (objPos.y * -0.5 + 0.5) * size.height;
          return screenX >= box.minX && screenX <= box.maxX && screenY >= box.minY && screenY <= box.maxY;
        });

        const unitsInBox = objectsInBox.filter(o => o.type === GameObjectType.UNIT) as Unit[];
        const buildingsInBox = objectsInBox.filter(o => o.type === GameObjectType.BUILDING);

        let finalSelection: (Unit | Building)[] = [];

        if (unitsInBox.length > 0) {
          finalSelection = unitsInBox;
          const combatUnits = unitsInBox.filter(u => u.unitType !== UnitType.WORKER);
          if (combatUnits.length > 0) {
              finalSelection = combatUnits;
          }
        } else if (buildingsInBox.length > 0) {
          finalSelection = buildingsInBox;
        }

        const finalSelectionIds = finalSelection.map(o => o.id);

        if (e.shiftKey) {
          const currentSelection = new Set(gameState.selectedIds.filter(id => {
              const obj = gameState.units[id] || gameState.buildings[id];
              return obj && obj.playerId === humanPlayer.id;
          }));
          finalSelectionIds.forEach(id => currentSelection.add(id));
          dispatch({ type: 'SET_SELECTION', payload: Array.from(currentSelection) });
        } else {
          dispatch({ type: 'SET_SELECTION', payload: finalSelectionIds });
        }
      }
      selectionStartPoint.current = null;
      setIsSelecting(false);
      setSelectionBox(null);
    }
  }, [R3FCamera, size, gameState, dispatch, setIsSelecting, setSelectionBox, gamePhase, humanPlayer, handleGroundContextMenu, processGroundSimpleClick]);

  const handleGroundPointerCancel = useCallback(() => {
    activePointerRef.current = null;
    selectionStartPoint.current = null;
    setIsSelecting(false);
    setSelectionBox(null);
  }, [setIsSelecting, setSelectionBox]);

  const handleObjectPointerDown = useCallback((e: any, id: string) => {
    e.stopPropagation();
    const pointerType = getPointerType(e);

    if (pointerType === 'touch') {
      activePointerRef.current = {
        target: 'object',
        objectId: id,
        pointerType,
        start: { x: e.nativeEvent?.offsetX ?? 0, y: e.nativeEvent?.offsetY ?? 0 },
        startTime: Date.now(),
        hasMoved: false,
      };
    }
  }, []);

  const handleObjectPointerMove = useCallback((e: any, id: string) => {
    e.stopPropagation();
    const pointerType = getPointerType(e);
    if (pointerType === 'touch' && activePointerRef.current && activePointerRef.current.target === 'object' && activePointerRef.current.objectId === id) {
      const offsetX = e.nativeEvent?.offsetX ?? activePointerRef.current.start.x;
      const offsetY = e.nativeEvent?.offsetY ?? activePointerRef.current.start.y;
      const dragDistance = Math.hypot(offsetX - activePointerRef.current.start.x, offsetY - activePointerRef.current.start.y);
      if (dragDistance > TOUCH_DRAG_THRESHOLD) {
        activePointerRef.current.hasMoved = true;
      }
    }
  }, []);

  const handleObjectPointerUp = useCallback((e: any, id: string) => {
    e.stopPropagation();
    const pointerType = getPointerType(e);

    if (pointerType === 'touch') {
      const pointer = activePointerRef.current;
      activePointerRef.current = null;

      if (!pointer || pointer.target !== 'object' || pointer.objectId !== id) {
        handleObjectClick(e, id);
        return;
      }

      const endX = e.nativeEvent?.offsetX ?? pointer.start.x;
      const endY = e.nativeEvent?.offsetY ?? pointer.start.y;
      const dragDistance = Math.hypot(endX - pointer.start.x, endY - pointer.start.y);
      const moved = pointer.hasMoved || dragDistance > TOUCH_DRAG_THRESHOLD;

      if (moved) {
        return;
      }

      const pressDuration = Date.now() - pointer.startTime;

      if (pressDuration >= LONG_PRESS_THRESHOLD) {
        handleObjectContextMenu(e, id);
      } else {
        handleObjectClick(e, id);
      }
      return;
    }

    if (e.button === 2) {
      return;
    }

    if (e.button === 0) {
      handleObjectClick(e, id);
    }
  }, [handleObjectClick, handleObjectContextMenu]);

  const handleObjectPointerCancel = useCallback(() => {
    if (activePointerRef.current?.target === 'object') {
      activePointerRef.current = null;
    }
  }, []);

  return (
    <>
      <PrewarmScene />
      <fog attach="fog" args={['#171720', 150, 300]} />
      {gamePhase === 'playing' && <GameEngineComponent gameState={gameState} dispatch={dispatch} setFps={setFps} />}

      {/* Conditionally render the correct camera controller based on game phase */}
      {gamePhase === 'menu' && <MenuCameraAnimator target={playerTownHallPosition} />}
      {gamePhase === 'playing' && playerTownHall && (
        <GameCameraControls ref={cameraControlsRef} key={playerTownHall.id} initialTarget={playerTownHall.position} />
      )}

      <hemisphereLight intensity={0.4} groundColor="brown" color="lightblue" />
      <directionalLight
        position={[20, 30, 10]}
        intensity={1.8}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
        shadow-bias={-0.0001}
      />
      <ambientLight intensity={0.2} />
      
      <InstancedRenderer gameState={gameState} selectedIds={selectedIdsSet} />

      {allBuildingsAndResources.map(obj => (
        <group
          key={obj.id}
          onPointerDown={(e) => handleObjectPointerDown(e, obj.id)}
          onPointerUp={(e) => handleObjectPointerUp(e, obj.id)}
          onPointerMove={(e) => handleObjectPointerMove(e, obj.id)}
          onPointerCancel={handleObjectPointerCancel}
          onContextMenu={(e) => {
            e.preventDefault();
            handleObjectContextMenu(e, obj.id);
          }}
        >
          {obj.type === GameObjectType.BUILDING && obj.buildingType === BuildingType.TOWN_HALL && <TownHall object={obj as Building} isSelected={gameState.selectedIds.includes(obj.id)} gameState={gameState} />}
          {obj.type === GameObjectType.BUILDING && obj.buildingType === BuildingType.BARRACKS && <Barracks object={obj as Building} isSelected={gameState.selectedIds.includes(obj.id)} gameState={gameState} />}
          {obj.type === GameObjectType.BUILDING && obj.buildingType === BuildingType.HOUSE && <House object={obj as Building} isSelected={gameState.selectedIds.includes(obj.id)} gameState={gameState} />}
          {obj.type === GameObjectType.BUILDING && obj.buildingType === BuildingType.DEFENSIVE_TOWER && <DefensiveTower object={obj as Building} isSelected={gameState.selectedIds.includes(obj.id)} gameState={gameState} />}
          {obj.type === GameObjectType.BUILDING && obj.buildingType === BuildingType.WAREHOUSE && <Warehouse object={obj as Building} isSelected={gameState.selectedIds.includes(obj.id)} gameState={gameState} />}
          {obj.type === GameObjectType.BUILDING && obj.buildingType === BuildingType.RESEARCH_CENTER && <ResearchCenter object={obj as Building} isSelected={gameState.selectedIds.includes(obj.id)} gameState={gameState} />}
          {obj.type === GameObjectType.BUILDING && obj.buildingType === BuildingType.MARKET && <Market object={obj as Building} isSelected={gameState.selectedIds.includes(obj.id)} gameState={gameState} />}

          {obj.type === GameObjectType.RESOURCE && obj.resourceType === ResourceType.TREE && (
             <Tree object={obj as ResourceNode} gatheringWorker={gatheringWorkersMap.get(obj.id)} />
          )}
          {obj.type === GameObjectType.RESOURCE && obj.resourceType === ResourceType.GOLD_MINE && <GoldMine object={obj as ResourceNode} />}
        </group>
      ))}

      {Object.values(gameState.projectiles).map(p => (
        p.isArcing
            ? <CatapultShell key={p.id} projectile={p} />
            : <Arrow key={p.id} projectile={p} />
      ))}

      {Object.values(gameState.floatingTexts).map(textData => (
        <FloatingResourceText key={textData.id} textData={textData} />
      ))}

      {Object.values(gameState.commandMarkers).map(markerData => (
        <CommandMarker key={markerData.id} markerData={markerData} />
      ))}

      {gameState.selectedIds.map(id => {
          const building = gameState.buildings[id];
          if (building && building.rallyPoint && building.playerId === humanPlayer?.id) {
              return <RallyPointMarker key={`rally-${id}`} position={building.rallyPoint} />;
          }
          return null;
      })}

      {Object.values(gameState.explosionMarkers).map(markerData => (
        <ExplosionMarker key={markerData.id} markerData={markerData} />
      ))}

      <BuildingPlaceholder buildMode={gameState.buildMode} />
      <Ground
        dispatch={dispatch}
        gameState={gameState}
        onPointerDown={handleGroundPointerDown}
        onPointerMove={handleGroundPointerMove}
        onPointerUp={handleGroundPointerUp}
        onContextMenu={handleGroundContextMenu}
        onPointerCancel={handleGroundPointerCancel}
        />
    </>
  );
};

export { GameScene };