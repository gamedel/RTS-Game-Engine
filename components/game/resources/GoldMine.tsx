import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Icosahedron } from '@react-three/drei';
import * as THREE from 'three';
import { ResourceNode } from '../../../types';
import { GOLD_MINE_DEPLETE_DURATION } from '../../../constants';

export const GoldMine: React.FC<{ object: ResourceNode }> = ({ object }) => {
  const groupRef = useRef<THREE.Group>(null!);
  const initialY = 0; // The group's initial Y position

  useFrame(() => {
    if (!groupRef.current || !object.isDepleting) return;

    const elapsedTime = Date.now() - (object.depletionStartTime || 0);
    const progress = Math.min(elapsedTime / GOLD_MINE_DEPLETE_DURATION, 1);
    const easeInQuad = (t: number) => t * t;
    const sinkProgress = easeInQuad(progress);

    // Sink into the ground
    groupRef.current.position.y = initialY - (2.5 * sinkProgress); // Sinks by 2.5 units
    
    // Shrink
    const scale = 1 - sinkProgress;
    groupRef.current.scale.set(scale, scale, scale);
  });


  return (
    <group ref={groupRef} position={[object.position.x, initialY, object.position.z]}>
      <Icosahedron args={[1.2]} position={[0, 0.8, 0]} castShadow>
        <meshStandardMaterial color="#FFD700" metalness={0.8} roughness={0.3} emissive="#443300" />
      </Icosahedron>
    </group>
  );
};