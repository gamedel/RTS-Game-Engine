import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box } from '@react-three/drei';
import * as THREE from 'three';
import { Building, GameState } from '../../../types';
import { BuildingProgressBar } from '../scene/BuildingProgressBar';
import { useBuildingCollapse } from './useBuildingCollapse';

export const Barracks: React.FC<{ object: Building; isSelected: boolean, gameState: GameState }> = ({ object, isSelected, gameState }) => {
    const modelRef = useRef<THREE.Mesh>(null!);
    const collapseGroupRef = useBuildingCollapse(object);
    
    // Default to 1 (fully built) if constructionProgress is not defined
    const progress = object.constructionProgress ?? 1;
    const modelHeight = 2; // From Box args y-dimension

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
    const baseColor = new THREE.Color(owner.color);
    const darkerColor = baseColor.clone().multiplyScalar(0.6);


    return (
        <group position={[object.position.x, 0, object.position.z]}>
            {!object.isCollapsing && <BuildingProgressBar building={object} />}
            <group ref={collapseGroupRef}>
                <Box
                    ref={modelRef}
                    args={[3.5, modelHeight, 5.5]}
                    scale-y={Math.max(0.001, progress)}
                    position-y={progress * (modelHeight / 2)}
                    castShadow
                    receiveShadow
                >
                    <meshStandardMaterial color={isSelected ? baseColor : darkerColor} metalness={0.2} roughness={0.6}/>
                </Box>

                {progress < 1 && (
                    <Box 
                        args={[3.5, modelHeight, 5.5]} 
                        position-y={modelHeight / 2} 
                        visible={false}
                    />
                )}
            </group>
        </group>
    );
}
