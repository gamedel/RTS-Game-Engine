import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GameState, Vector3, GameObjectType, ResourceType } from '../../types';
import { CameraControlsRef } from '../../../App';

const DEFAULT_MAP_SIZE = 200;
const TOUCH_MAP_SIZE = 240;
const WORLD_SIZE = 300; // From Ground plane args

const worldToMap = (pos: Vector3, mapSize: number) => {
    const mapX = (pos.x / WORLD_SIZE + 0.5) * mapSize;
    const mapY = (pos.z / WORLD_SIZE + 0.5) * mapSize;
    return { x: mapX, y: mapY };
};

const mapToWorld = (mapPos: { x: number, y: number }, mapSize: number) => {
    const worldX = (mapPos.x / mapSize - 0.5) * WORLD_SIZE;
    const worldZ = (mapPos.y / mapSize - 0.5) * WORLD_SIZE;
    return { x: worldX, y: 0, z: worldZ };
};

interface MinimapProps {
    gameState: GameState;
    camera: THREE.Camera | null;
    cameraControlsRef: React.RefObject<CameraControlsRef>;
    isTouchDevice: boolean;
}

export const Minimap: React.FC<MinimapProps> = ({ gameState, camera, cameraControlsRef, isTouchDevice }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const activePointerId = useRef<number | null>(null);

    const mapSize = isTouchDevice ? TOUCH_MAP_SIZE : DEFAULT_MAP_SIZE;

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear canvas
        ctx.fillStyle = '#4A6A44'; // Ground color from Ground.tsx
        ctx.fillRect(0, 0, mapSize, mapSize);

        // Draw resources
        Object.values(gameState.resourcesNodes).forEach(node => {
            const { x, y } = worldToMap(node.position, mapSize);
            ctx.fillStyle = node.resourceType === ResourceType.TREE ? '#22c55e' : '#facc15';
            ctx.fillRect(x - 1, y - 1, 3, 3);
        });

        // Draw buildings
        Object.values(gameState.buildings).forEach(building => {
            const { x, y } = worldToMap(building.position, mapSize);
            const owner = gameState.players[building.playerId];
            ctx.fillStyle = owner ? owner.color : '#ffffff';
            ctx.fillRect(x - 2, y - 2, 4, 4);
        });

        // Draw units
        Object.values(gameState.units).forEach(unit => {
            if (unit.isDying) return;
            const { x, y } = worldToMap(unit.position, mapSize);
            const owner = gameState.players[unit.playerId];
            ctx.fillStyle = owner ? owner.color : '#ffffff';
            ctx.fillRect(x - 1, y - 1, 2, 2);
        });

        // Draw camera frustum
        if (camera) {
            const frustumCorners = [
                new THREE.Vector3(-1, 1, -1), // top-left
                new THREE.Vector3(1, 1, -1), // top-right
                new THREE.Vector3(1, -1, -1), // bottom-right
                new THREE.Vector3(-1, -1, -1), // bottom-left
            ];
            
            const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
            const worldCorners: Vector3[] = [];

            frustumCorners.forEach(corner => {
                const ray = new THREE.Ray();
                ray.origin.setFromMatrixPosition(camera.matrixWorld);
                ray.direction.copy(corner).unproject(camera).sub(ray.origin).normalize();
                
                const intersectionPoint = new THREE.Vector3();
                ray.intersectPlane(groundPlane, intersectionPoint);
                if (intersectionPoint) {
                    worldCorners.push({ x: intersectionPoint.x, y: 0, z: intersectionPoint.z });
                }
            });

            if (worldCorners.length === 4) {
                const mapCorners = worldCorners.map(corner => worldToMap(corner, mapSize));
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(mapCorners[0].x, mapCorners[0].y);
                ctx.lineTo(mapCorners[1].x, mapCorners[1].y);
                ctx.lineTo(mapCorners[2].x, mapCorners[2].y);
                ctx.lineTo(mapCorners[3].x, mapCorners[3].y);
                ctx.closePath();
                ctx.stroke();
            }
        }

    }, [gameState, camera, mapSize]);

    useEffect(() => {
        const animationFrameId = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(animationFrameId);
    }, [draw]);

    const interactWithMap = (clientX: number, clientY: number, target: HTMLCanvasElement) => {
        if (!cameraControlsRef.current) return;
        const rect = target.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        const worldPos = mapToWorld({ x, y }, mapSize);
        cameraControlsRef.current.setTarget(worldPos);
    };

    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        e.preventDefault();
        activePointerId.current = e.pointerId;
        canvas.setPointerCapture(e.pointerId);
        setIsDragging(true);
        interactWithMap(e.clientX, e.clientY, canvas);
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas || !isDragging || activePointerId.current !== e.pointerId) return;
        e.preventDefault();
        interactWithMap(e.clientX, e.clientY, canvas);
    };

    const endInteraction = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (canvas && activePointerId.current === e.pointerId) {
            canvas.releasePointerCapture(e.pointerId);
        }
        activePointerId.current = null;
        setIsDragging(false);
    };

    return (
        <canvas
            ref={canvasRef}
            width={mapSize}
            height={mapSize}
            className={`absolute top-12 left-4 bg-gray-800 border-2 border-slate-600 rounded-sm shadow-lg z-20 ${isTouchDevice ? 'touch-none' : ''}`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endInteraction}
            onPointerCancel={endInteraction}
            onPointerLeave={endInteraction}
        />
    );
};