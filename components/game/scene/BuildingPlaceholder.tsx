import React from 'react';
import { useFrame } from '@react-three/fiber';
import { Box } from '@react-three/drei';
import { GameState, BuildingType } from '../../../types';

export const BuildingPlaceholder: React.FC<{ buildMode: GameState['buildMode'] }> = ({ buildMode }) => {
    // Empty useFrame to ensure R3F module is loaded for JSX augmentation
    useFrame(() => {});
    
    if (!buildMode) return null;
    const size: [number, number, number] = buildMode.type === BuildingType.BARRACKS ? [3.5, 2, 5.5] : [4, 3, 4];
    return (
        <Box args={size} position={[buildMode.position.x, size[1]/2, buildMode.position.z]}>
            <meshStandardMaterial color={buildMode.canPlace ? 'green' : 'red'} transparent opacity={0.5} />
        </Box>
    );
};