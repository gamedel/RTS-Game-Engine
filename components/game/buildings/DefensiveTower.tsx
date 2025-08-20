import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box, Cylinder } from '@react-three/drei';
import * as THREE from 'three';
import { Building, GameState } from '../../../types';
import { BuildingProgressBar } from '../scene/BuildingProgressBar';

export const DefensiveTower: React.FC<{ object: Building; isSelected: boolean, gameState: GameState }> = ({ object, isSelected, gameState }) => {
    const groupRef = useRef<THREE.Group>(null!);
    
    const progress = object.constructionProgress ?? 1;
    const modelHeight = 4; // Total height of the tower

    useFrame(() => {
        if (groupRef.current) {
            const targetScaleY = Math.max(0.001, progress);
            const targetPosY = progress * (modelHeight / 2) - modelHeight / 2; // Start from the ground up

            groupRef.current.scale.y = targetScaleY;
            groupRef.current.position.y = progress * (modelHeight / 2);
        }
    });

    const owner = gameState.players[object.playerId];
    const color = owner.isHuman ? '#a8a29e' : '#78716c';
    const selectedColor = owner.isHuman ? '#e7e5e4' : '#a1a1aa';

    return (
        <group position={[object.position.x, 0, object.position.z]}>
            <BuildingProgressBar building={object} />
            {/* Main structure that scales during construction */}
            <group
                ref={groupRef}
                scale-y={Math.max(0.001, progress)}
                position-y={progress * (modelHeight / 2)}
            >
                <Cylinder args={[1.2, 1.5, 3, 8]} castShadow receiveShadow>
                     <meshStandardMaterial color={isSelected ? selectedColor : color} />
                </Cylinder>
                <Cylinder args={[1.8, 1.8, 1, 8]} position-y={1.5} castShadow receiveShadow>
                     <meshStandardMaterial color={isSelected ? selectedColor : color} />
                </Cylinder>
                 <Box args={[2.2, 0.8, 2.2]} position-y={2.2} castShadow>
                     <meshStandardMaterial color={isSelected ? '#b91c1c' : '#7f1d1d'} />
                 </Box>
            </group>

            {/* Invisible clickbox to ensure the building is always selectable during construction */}
            {progress < 1 && (
                <Box 
                    args={[2.5, modelHeight, 2.5]}
                    position-y={modelHeight / 2} 
                    visible={false}
                >
                </Box>
            )}
        </group>
    );
}