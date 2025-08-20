import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Plane, Cylinder } from '@react-three/drei';
import * as THREE from 'three';
import { Vector3 } from '../../../types';

interface RallyPointMarkerProps {
    position: Vector3;
}

export const RallyPointMarker: React.FC<RallyPointMarkerProps> = ({ position }) => {
    const flagRef = useRef<THREE.Mesh>(null!);

    // Store initial positions for animation
    const flagGeometry = useMemo(() => {
        const geom = new THREE.PlaneGeometry(1.2, 0.8, 10, 5);
        // Clone the position attribute to have a non-modified reference for the animation calculation
        (geom as any).initialPositions = geom.attributes.position.clone();
        return geom;
    }, []);
    
    useFrame((state) => {
        if (flagRef.current) {
            const time = state.clock.elapsedTime;
            const positionAttribute = flagRef.current.geometry.attributes.position as THREE.BufferAttribute;
            const initialPositions = (flagRef.current.geometry as any).initialPositions;

            for (let i = 0; i < positionAttribute.count; i++) {
                const x = initialPositions.getX(i);
                // Apply a sine wave based on the x position and time to create a wave effect
                const zOffset = Math.sin(x * 2.5 + time * 4) * 0.1;
                positionAttribute.setZ(i, initialPositions.getZ(i) + zOffset);
            }
            positionAttribute.needsUpdate = true;
        }
    });

    return (
        <group position={[position.x, 0, position.z]}>
            <Cylinder args={[0.05, 0.05, 3]} position={[0, 1.5, 0]}>
                <meshStandardMaterial color="#6b7280" />
            </Cylinder>
            <mesh ref={flagRef} geometry={flagGeometry} position={[0, 2.6, 0.6]} rotation={[0, Math.PI / 2, 0]}>
                <meshStandardMaterial color="#38bdf8" side={THREE.DoubleSide} transparent opacity={0.8} />
            </mesh>
        </group>
    );
};