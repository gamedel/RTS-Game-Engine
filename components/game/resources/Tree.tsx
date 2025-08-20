import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Cylinder, Sphere } from '@react-three/drei';
import * as THREE from 'three';
import { ResourceNode, Unit, UnitType } from '../../../types';
import { UNIT_CONFIG } from '../../../constants';

const FALL_ANIMATION_DURATION = 800; // ms
const SINK_DURATION = 1200; // ms

export const Tree: React.FC<{ object: ResourceNode, gatheringWorker?: Unit }> = ({ object, gatheringWorker }) => {
    const groupRef = useRef<THREE.Group>(null!);
    const lastGatherProgress = useRef(0);
    const shake = useRef(0);

    useFrame((state, delta) => {
        if (!groupRef.current) return;
        
        if (object.isFalling) {
            const elapsedTime = Date.now() - (object.fallStartTime || 0);
            
            // Fall animation
            const fallProgress = Math.min(elapsedTime / FALL_ANIMATION_DURATION, 1);
            const easeOutQuad = (t: number) => t * (2 - t);
            groupRef.current.rotation.x = - (Math.PI / 2) * easeOutQuad(fallProgress);

            // Sink animation
            if (elapsedTime >= FALL_ANIMATION_DURATION) {
                const sinkElapsedTime = elapsedTime - FALL_ANIMATION_DURATION;
                const sinkProgress = Math.min(sinkElapsedTime / SINK_DURATION, 1);
                groupRef.current.position.y = -2.5 * sinkProgress;
            }
            
            // Stop any shaking
            shake.current = 0;
            return; // Don't process other animations
        }


        if (gatheringWorker) {
            const gatherTime = UNIT_CONFIG[UnitType.WORKER].gatherTime;
            const progress = (gatheringWorker.gatherTimer || 0) / gatherTime;

            const lastSin = Math.sin(lastGatherProgress.current * Math.PI * 2);
            const currentSin = Math.sin(progress * Math.PI * 2);

            if (lastSin < 0.5 && currentSin >= 0.5) {
                shake.current = 1.5;
            }
            lastGatherProgress.current = progress;
        } else {
             lastGatherProgress.current = 0;
        }

        if (shake.current > 0.01) {
            shake.current = THREE.MathUtils.lerp(shake.current, 0, 0.2); // Faster decay for a "sharper" feel
            groupRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 100) * shake.current * 0.15;
            groupRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 90) * shake.current * 0.15;
        } else {
            shake.current = 0;
            groupRef.current.rotation.z = 0;
            groupRef.current.rotation.x = 0;
        }
    });

    return (
        <group ref={groupRef} position={[object.position.x, 0, object.position.z]}>
            <Cylinder args={[0.2, 0.25, 1.5]} position={[0, 0.75, 0]} castShadow>
                <meshStandardMaterial color="#654321" />
            </Cylinder>
            <Sphere args={[1.2]} position={[0, 2.2, 0]} castShadow>
                <meshStandardMaterial color="#2E8B57" roughness={0.8} />
            </Sphere>
        </group>
    );
};