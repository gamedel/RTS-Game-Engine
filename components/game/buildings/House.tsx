import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box } from '@react-three/drei';
import * as THREE from 'three';
import { Building, GameState } from '../../../types';

export const House: React.FC<{ object: Building; isSelected: boolean, gameState: GameState }> = ({ object, isSelected, gameState }) => {
    const modelRef = useRef<THREE.Mesh>(null!);
    
    const progress = object.constructionProgress ?? 1;
    const modelHeight = 2.5;

    useFrame(() => {
        if (modelRef.current) {
            // The `progress` value is already smoothly interpolated by the game logic.
            // We should directly set the scale and position to match the progress,
            // avoiding `lerp` which would cause a "chasing" or lagging animation.
            const targetScaleY = Math.max(0.001, progress);
            const targetPosY = progress * (modelHeight / 2);

            modelRef.current.scale.y = targetScaleY;
            modelRef.current.position.y = targetPosY;
        }
    });

    const owner = gameState.players[object.playerId];
    const color = owner.isHuman ? '#3b82f6' : '#a16207';
    const selectedColor = owner.isHuman ? '#60a5fa' : '#ca8a04';


    return (
        <group position={[object.position.x, 0, object.position.z]}>
            <Box
                ref={modelRef}
                args={[3, modelHeight, 3]}
                scale-y={Math.max(0.001, progress)}
                position-y={progress * (modelHeight / 2)}
                castShadow
                receiveShadow
            >
                <meshStandardMaterial color={isSelected ? selectedColor : color} metalness={0.1} roughness={0.7}/>
            </Box>

            {progress < 1 && (
                <Box 
                    args={[3, modelHeight, 3]} 
                    position-y={modelHeight / 2} 
                    visible={false}
                />
            )}
        </group>
    );
}