import React from 'react';
import * as THREE from 'three';
import { GameState, Action, GameObject } from '../types';
import { ResourceBar } from './ui/ResourceBar';
import { ControlPanel } from './ui/ControlPanel';
import { Minimap } from './ui/Minimap';
import { CameraControlsRef } from '../../App';

export const UI: React.FC<{
    gameState: GameState;
    selectedObjects: GameObject[];
    dispatch: React.Dispatch<Action>;
    fps: number;
    camera: THREE.Camera | null;
    cameraControlsRef: React.RefObject<CameraControlsRef>;
}> = ({ gameState, selectedObjects, dispatch, fps, camera, cameraControlsRef }) => (
    <>
        <ResourceBar gameState={gameState} dispatch={dispatch} fps={fps} />
        <Minimap gameState={gameState} camera={camera} cameraControlsRef={cameraControlsRef} />
        <ControlPanel gameState={gameState} selectedObjects={selectedObjects} dispatch={dispatch} />
    </>
);