import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box } from '@react-three/drei';
import * as THREE from 'three';
import { Building, GameState } from '../../../types';
import { BuildingProgressBar } from '../scene/BuildingProgressBar';
import { useBuildingCollapse } from './useBuildingCollapse';

export const TownHall: React.FC<{ object: Building; isSelected: boolean, gameState: GameState }> = ({ object, isSelected, gameState }) => {
    const modelGroupRef = useRef<THREE.Group>(null!);
    const collapseGroupRef = useBuildingCollapse(object);
    
    const progress = object.constructionProgress ?? 1;
    const modelHeight = 3.5; // The total height of the model from base to roof tip

    useFrame(() => {
        if (modelGroupRef.current) {
            // Scale the model on the Y-axis. Since the model's base is at y=0,
            // this will make it look like it's growing upwards from the ground.
            const targetScaleY = Math.max(0.001, progress);
            modelGroupRef.current.scale.y = targetScaleY;
        }
    });
    
    const owner = gameState.players[object.playerId];
    const baseColor = new THREE.Color(owner.color);
    const lighterColor = baseColor.clone().multiplyScalar(1.2);

    return (
        <group position={[object.position.x, 0, object.position.z]}>
            {!object.isCollapsing && <BuildingProgressBar building={object} />}
            <group ref={collapseGroupRef}>
                <group
                    ref={modelGroupRef}
                    scale-y={Math.max(0.001, progress)}
                >
                    <Box args={[4, 3, 4]} position={[0, 1.5, 0]} castShadow receiveShadow>
                        <meshStandardMaterial color={isSelected ? '#d1d5db' : '#9ca3af'} />
                    </Box>
                    <Box args={[5, 1, 5]} position={[0, 3, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
                        <meshStandardMaterial color={isSelected ? lighterColor : baseColor} />
                    </Box>
                </group>

                {progress < 1 && (
                    <Box 
                        args={[5, modelHeight, 5]}
                        position-y={modelHeight / 2} 
                        visible={false}
                    />
                )}
            </group>
        </group>
    );
};
