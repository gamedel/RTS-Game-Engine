import React, { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Cone, Cylinder, Box } from '@react-three/drei';
import * as THREE from 'three';
import { Projectile } from '../../../types';

export const Arrow: React.FC<{ projectile: Projectile }> = ({ projectile }) => {
    const groupRef = useRef<THREE.Group>(null!);
    const lastPosition = useRef<THREE.Vector3 | null>(null);

    useEffect(() => {
        if (groupRef.current) {
            groupRef.current.position.set(projectile.position.x, projectile.position.y, projectile.position.z);
            lastPosition.current = groupRef.current.position.clone();
        }
    }, [projectile.id]);

    useFrame(() => {
        if (!groupRef.current || !lastPosition.current) return;

        const targetPos = new THREE.Vector3(projectile.position.x, projectile.position.y, projectile.position.z);
        
        groupRef.current.position.lerp(targetPos, 0.6);

        const direction = new THREE.Vector3().subVectors(groupRef.current.position, lastPosition.current);

        if (direction.lengthSq() > 0.0001) {
            // Point the arrow (+Z) in the direction of movement
            groupRef.current.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.normalize());
        }

        lastPosition.current.copy(groupRef.current.position);
    });

    // Arrow model is built along the +Z axis
    return (
        <group ref={groupRef}>
            {/* Shaft */}
            <Cylinder args={[0.025, 0.025, 0.8, 6]} rotation-x={Math.PI / 2}>
                <meshStandardMaterial color="#8B4513" />
            </Cylinder>
            
            {/* Head */}
            <Cone args={[0.06, 0.2, 8]} rotation-x={Math.PI / 2} position-z={0.4}>
                <meshStandardMaterial color="#4A5568" />
            </Cone>

            {/* Fletching (Tail feathers) */}
            <group position-z={-0.35}>
                 {/* Fletching 1 */}
                <Box args={[0.01, 0.15, 0.18]}>
                    <meshStandardMaterial color="black" />
                </Box>
                 {/* Fletching 2 */}
                <Box args={[0.01, 0.15, 0.18]} rotation-z={Math.PI * 2 / 3}>
                     <meshStandardMaterial color="black" />
                </Box>
                 {/* Fletching 3 */}
                <Box args={[0.01, 0.15, 0.18]} rotation-z={Math.PI * 4 / 3}>
                     <meshStandardMaterial color="black" />
                </Box>
            </group>
        </group>
    );
};