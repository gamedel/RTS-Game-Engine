import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';
import { GameState, Vector3, GameObjectType, ResourceType } from '../../types';
import { CameraControlsRef } from '../../../App';

const MAP_SIZE = 200;
const WORLD_SIZE = 300; // From Ground plane args

const worldToMap = (pos: Vector3) => {
    const mapX = (pos.x / WORLD_SIZE + 0.5) * MAP_SIZE;
    const mapY = (pos.z / WORLD_SIZE + 0.5) * MAP_SIZE;
    return { x: mapX, y: mapY };
};

const mapToWorld = (mapPos: { x: number, y: number }) => {
    const worldX = (mapPos.x / MAP_SIZE - 0.5) * WORLD_SIZE;
    const worldZ = (mapPos.y / MAP_SIZE - 0.5) * WORLD_SIZE;
    return { x: worldX, y: 0, z: worldZ };
};

interface MinimapProps {
    gameState: GameState;
    camera: THREE.Camera | null;
    cameraControlsRef: React.RefObject<CameraControlsRef>;
}

export const Minimap: React.FC<MinimapProps> = ({ gameState, camera, cameraControlsRef }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Clear canvas
        ctx.fillStyle = '#4A6A44'; // Ground color from Ground.tsx
        ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

        // Draw resources
        Object.values(gameState.resourcesNodes).forEach(node => {
            const { x, y } = worldToMap(node.position);
            ctx.fillStyle = node.resourceType === ResourceType.TREE ? '#22c55e' : '#facc15';
            ctx.fillRect(x - 1, y - 1, 3, 3);
        });

        // Draw buildings
        Object.values(gameState.buildings).forEach(building => {
            const { x, y } = worldToMap(building.position);
            const owner = gameState.players[building.playerId];
            ctx.fillStyle = owner ? owner.color : '#ffffff';
            ctx.fillRect(x - 2, y - 2, 4, 4);
        });

        // Draw units
        Object.values(gameState.units).forEach(unit => {
            if (unit.isDying) return;
            const { x, y } = worldToMap(unit.position);
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
                const mapCorners = worldCorners.map(worldToMap);
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

    }, [gameState, camera]);

    useEffect(() => {
        const animationFrameId = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(animationFrameId);
    }, [draw]);

    const handleMapInteraction = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas || !cameraControlsRef.current) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const worldPos = mapToWorld({ x, y });
        cameraControlsRef.current.setTarget(worldPos);
    };

    const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
        setIsDragging(true);
        handleMapInteraction(e);
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };
    
    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (isDragging) {
            handleMapInteraction(e);
        }
    };
    
    const handleMouseLeave = () => {
        setIsDragging(false);
    };


    return (
        <canvas
            ref={canvasRef}
            width={MAP_SIZE}
            height={MAP_SIZE}
            className="absolute top-12 left-4 bg-gray-800 border-2 border-slate-600 rounded-sm shadow-lg z-20"
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
        />
    );
};