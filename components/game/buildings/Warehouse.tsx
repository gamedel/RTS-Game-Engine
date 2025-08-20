import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box } from '@react-three/drei';
import * as THREE from 'three';
import { Building, GameState } from '../../../types';

export const Warehouse: React.FC<{ object: Building; isSelected: boolean, gameState: GameState }> = ({ object, isSelected, gameState }) => {
    const modelRef = useRef<THREE.Mesh>(null!);
    
    const progress = object.constructionProgress ?? 1;
    const modelHeight = 1.8;

    useFrame(() => {
        if (modelRef.current) {
            const targetScaleY = Math.max(0.001, progress);
            const targetPosY = progress * (modelHeight / 2);

            modelRef.current.scale.y = targetScaleY;
            modelRef.current.position.y = targetPosY;
        }
    });

    const owner = gameState.players[object.playerId];
    const color = owner.isHuman ? '#a16207' : '#713f12'; // Brownish colors
    const selectedColor = owner.isHuman ? '#ca8a04' : '#854d0e';

    return (
        <group position={[object.position.x, 0, object.position.z]}>
            <Box
                ref={modelRef}
                args={[3.5, modelHeight, 3.5]}
                scale-y={Math.max(0.001, progress)}
                position-y={progress * (modelHeight / 2)}
                castShadow
                receiveShadow
            >
                <meshStandardMaterial color={isSelected ? selectedColor : color} metalness={0.1} roughness={0.8}/>
            </Box>

            {progress < 1 && (
                <Box 
                    args={[3.5, modelHeight, 3.5]} 
                    position-y={modelHeight / 2} 
                    visible={false}
                />
            )}
        </group>
    );
}