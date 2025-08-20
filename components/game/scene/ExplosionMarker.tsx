import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Ring } from '@react-three/drei';
import * as THREE from 'three';
import { ExplosionMarker as ExplosionMarkerType } from '../../../types';
import { EXPLOSION_MARKER_DURATION } from '../../../constants';

export const ExplosionMarker: React.FC<{ markerData: ExplosionMarkerType }> = ({ markerData }) => {
    const ringRef = useRef<THREE.Mesh>(null!);

    useFrame(() => {
        if (!ringRef.current) return;
        const elapsedTime = Date.now() - markerData.startTime;
        const progress = Math.min(elapsedTime / EXPLOSION_MARKER_DURATION, 1);
        
        const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);
        const currentRadius = markerData.radius * easeOutQuint(progress);

        ringRef.current.scale.set(currentRadius, currentRadius, currentRadius);

        const material = ringRef.current.material as THREE.MeshBasicMaterial;
        if (material) {
            material.opacity = 1.0 - progress * progress;
        }
    });

    return (
        <group position={[markerData.position.x, 0.1, markerData.position.z]}>
             <Ring ref={ringRef} args={[0.95, 1, 64]} rotation={[-Math.PI / 2, 0, 0]} >
                <meshBasicMaterial color="#ff9900" transparent toneMapped={false} />
            </Ring>
        </group>
    );
};