import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box, Cylinder } from '@react-three/drei';
import * as THREE from 'three';
import { Building, GameState } from '../../../types';
import { BuildingProgressBar } from '../scene/BuildingProgressBar';
import { useBuildingCollapse } from './useBuildingCollapse';

export const Market: React.FC<{ object: Building; isSelected: boolean, gameState: GameState }> = ({ object, isSelected, gameState }) => {
    const modelRef = useRef<THREE.Group>(null!);
    const collapseGroupRef = useBuildingCollapse(object);

    const progress = object.constructionProgress ?? 1;
    const modelHeight = 2.5;

    useFrame(() => {
        if (modelRef.current) {
            const targetScaleY = Math.max(0.001, progress);
            modelRef.current.scale.y = targetScaleY;
            modelRef.current.position.y = progress * (modelHeight / 2);
        }
    });

    const owner = gameState.players[object.playerId];
    const baseColor = new THREE.Color(owner.color);
    const roofColor = baseColor.clone().multiplyScalar(0.7);

    return (
        <group position={[object.position.x, 0, object.position.z]}>
            {!object.isCollapsing && <BuildingProgressBar building={object} />}
            <group ref={collapseGroupRef}>
                <group
                    ref={modelRef}
                    scale-y={Math.max(0.001, progress)}
                    position-y={progress * (modelHeight / 2)}
                >
                    <Box args={[3.5, 1.5, 3.5]} position-y={-0.5} castShadow receiveShadow>
                        <meshStandardMaterial color={isSelected ? '#a16207' : '#854d0e'} />
                    </Box>
                    <Cylinder args={[0.3, 0.3, 2.5]} position={[-1.5, 0.25, -1.5]} castShadow>
                         <meshStandardMaterial color={'#78716c'} />
                    </Cylinder>
                     <Cylinder args={[0.3, 0.3, 2.5]} position={[1.5, 0.25, -1.5]} castShadow>
                         <meshStandardMaterial color={'#78716c'} />
                    </Cylinder>
                     <Cylinder args={[0.3, 0.3, 2.5]} position={[-1.5, 0.25, 1.5]} castShadow>
                         <meshStandardMaterial color={'#78716c'} />
                    </Cylinder>
                     <Cylinder args={[0.3, 0.3, 2.5]} position={[1.5, 0.25, 1.5]} castShadow>
                         <meshStandardMaterial color={'#78716c'} />
                    </Cylinder>
                     <Box args={[4, 0.8, 4]} position-y={1.5} rotation-y={Math.PI / 4} castShadow>
                        <meshStandardMaterial color={isSelected ? roofColor.clone().multiplyScalar(1.2) : roofColor} />
                    </Box>
                </group>

                {progress < 1 && (
                    <Box 
                        args={[3.5, modelHeight, 3.5]} 
                        position-y={modelHeight / 2} 
                        visible={false}
                    />
                )}
            </group>
        </group>
    );
};
