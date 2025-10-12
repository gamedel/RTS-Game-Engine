import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box, Cylinder, Icosahedron } from '@react-three/drei';
import * as THREE from 'three';
import { Building, GameState } from '../../../types';
import { BuildingProgressBar } from '../scene/BuildingProgressBar';
import { useBuildingCollapse } from './useBuildingCollapse';

export const ResearchCenter: React.FC<{ object: Building; isSelected: boolean, gameState: GameState }> = ({ object, isSelected, gameState }) => {
    const groupRef = useRef<THREE.Group>(null!);
    const crystalRef = useRef<THREE.Mesh>(null!);
    const collapseGroupRef = useBuildingCollapse(object);
    
    const progress = object.constructionProgress ?? 1;
    const modelHeight = 2;

    useFrame((state, delta) => {
        if (groupRef.current) {
            const targetScaleY = Math.max(0.001, progress);
            groupRef.current.scale.y = targetScaleY;
            groupRef.current.position.y = progress * (modelHeight / 2);
        }
        if (crystalRef.current) {
            crystalRef.current.rotation.y += delta * 0.5;
        }
    });

    const owner = gameState.players[object.playerId];
    const color = owner.isHuman ? '#5b21b6' : '#7c3aed';
    const selectedColor = owner.isHuman ? '#7c3aed' : '#a78bfa';

    return (
        <group position={[object.position.x, 0, object.position.z]}>
            {!object.isCollapsing && <BuildingProgressBar building={object} />}
             <group ref={collapseGroupRef}>
                <group
                    ref={groupRef}
                    scale-y={Math.max(0.001, progress)}
                    position-y={progress * (modelHeight / 2)}
                >
                    <Cylinder args={[2, 2.2, modelHeight, 6]} castShadow receiveShadow>
                         <meshStandardMaterial color={isSelected ? selectedColor : color} metalness={0.2} roughness={0.6}/>
                    </Cylinder>
                    <Icosahedron ref={crystalRef} args={[0.8]} position-y={modelHeight + 0.5} castShadow>
                        <meshStandardMaterial color="#a78bfa" emissive="#6d28d9" emissiveIntensity={0.5} roughness={0.1} metalness={0.9} transparent opacity={0.8}/>
                    </Icosahedron>
                </group>
                
                {progress < 1 && (
                    <Box 
                        args={[4, modelHeight, 4]} 
                        position-y={modelHeight / 2} 
                        visible={false}
                    />
                )}
            </group>
        </group>
    );
}
