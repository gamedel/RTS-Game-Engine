import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Ring } from '@react-three/drei';
import * as THREE from 'three';
import { CommandMarker as CommandMarkerType } from '../../../types';
import { COMMAND_MARKER_DURATION } from '../../../constants';

export const CommandMarker: React.FC<{ markerData: CommandMarkerType }> = ({ markerData }) => {
    const ringRef = useRef<THREE.Mesh>(null!);
    const initialScale = 1.5;
    const ringColor = markerData.color ?? '#38bdf8';
    const innerRadius = markerData.radius ?? 0.9;
    const outerRadius = innerRadius + 0.12;

    useFrame(() => {
        if (!ringRef.current) return;
        const elapsedTime = Date.now() - markerData.startTime;
        const progress = Math.min(elapsedTime / COMMAND_MARKER_DURATION, 1);

        const scale = initialScale * (1 - progress * 0.5); // End scale is 0.5 of initial
        ringRef.current.scale.set(scale, scale, scale);

        const material = ringRef.current.material as THREE.MeshBasicMaterial;
        if (material) {
            material.opacity = 1.0 - progress;
        }
    });

    return (
        <group position={[markerData.position.x, 0.1, markerData.position.z]}>
             <Ring ref={ringRef} args={[innerRadius, outerRadius, 32]} rotation={[-Math.PI / 2, 0, 0]} >
                <meshBasicMaterial color={ringColor} transparent toneMapped={false} />
            </Ring>
        </group>
    );
};
