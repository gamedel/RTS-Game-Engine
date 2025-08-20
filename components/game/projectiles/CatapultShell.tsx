import React, { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Sphere } from '@react-three/drei';
import * as THREE from 'three';
import { Projectile } from '../../../types';

export const CatapultShell: React.FC<{ projectile: Projectile }> = ({ projectile }) => {
    const groupRef = useRef<THREE.Group>(null!);
    
    useFrame(() => {
        if (!groupRef.current) return;
        // The projectile's position, including the arcing Y-coordinate,
        // is calculated in projectileLogic. Here, we just smoothly
        // lerp to that target position for a non-jittery animation.
        const targetPos = new THREE.Vector3(projectile.position.x, projectile.position.y, projectile.position.z);
        groupRef.current.position.lerp(targetPos, 0.8);
    });

    return (
        <group ref={groupRef}>
            <Sphere args={[0.4, 8, 8]}>
                <meshStandardMaterial color="black" emissive="orange" emissiveIntensity={0.6}/>
            </Sphere>
        </group>
    );
};