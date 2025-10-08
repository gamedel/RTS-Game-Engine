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
    isTouchDevice: boolean;
}> = ({ gameState, selectedObjects, dispatch, fps, camera, cameraControlsRef, isTouchDevice }) => (
    <>
        <ResourceBar gameState={gameState} dispatch={dispatch} fps={fps} isTouchDevice={isTouchDevice} />
        <Minimap gameState={gameState} camera={camera} cameraControlsRef={cameraControlsRef} isTouchDevice={isTouchDevice} />
        <ControlPanel gameState={gameState} selectedObjects={selectedObjects} dispatch={dispatch} isTouchDevice={isTouchDevice} />
    </>
);