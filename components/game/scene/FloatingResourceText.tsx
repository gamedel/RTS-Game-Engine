import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text, Icosahedron, Cylinder } from '@react-three/drei';
import * as THREE from 'three';
import { FloatingText } from '../../../types';


export const FloatingResourceText: React.FC<{ textData: FloatingText }> = ({ textData }) => {
    const textRef = useRef<any>(null);
    const groupRef = useRef<THREE.Group>(null!);
    const iconGroupRef = useRef<THREE.Group>(null!);
    const initialY = textData.position.y;
    const duration = 2000; // ms

    useFrame((state, delta) => {
        if (!groupRef.current) return;
        const elapsedTime = Date.now() - textData.startTime;
        const progress = Math.min(elapsedTime / duration, 1);
        
        groupRef.current.position.y = initialY + progress * 4;
        const opacity = 1.0 - progress;

        if (textRef.current?.material) {
            textRef.current.material.opacity = opacity;
        }
        if (iconGroupRef.current) {
            iconGroupRef.current.children.forEach(child => {
                if (child instanceof THREE.Mesh && child.material instanceof THREE.Material) {
                    child.material.opacity = opacity;
                }
            });
        }
    });

    const isGold = textData.resourceType === 'GOLD';
    const isWood = textData.resourceType === 'WOOD';
    const isDamage = textData.resourceType === 'DAMAGE';
    const isBonusDamage = textData.resourceType === 'BONUS_DAMAGE';
    const isResistDamage = textData.resourceType === 'RESIST_DAMAGE';

    const color = isBonusDamage ? '#f97316' // orange-500
                : isResistDamage ? '#a1a1aa' // zinc-400
                : isDamage ? '#ef4444' // red-500
                : isGold ? '#FFD700' : '#CD853F';

    const fontSize = isBonusDamage ? 1.7 : isResistDamage ? 1.0 : isDamage ? 1.4 : 1.2;

    const hasIcon = isGold || isWood;

    return (
        <group ref={groupRef} position={[textData.position.x, initialY, textData.position.z]}>
             <Text
                ref={textRef}
                color={color}
                fontSize={fontSize}
                anchorX="center"
                anchorY="middle"
                outlineWidth={0.05}
                outlineColor="#000000"
                position-x={hasIcon ? -0.5 : 0}
            >
                {textData.text}
            </Text>
            <group ref={iconGroupRef} position={[hasIcon ? 0.7 : 1.2, 0.1, 0]}>
              {isGold && (
                <Icosahedron args={[0.3]}>
                    <meshStandardMaterial color="#FFD700" metalness={0.8} roughness={0.3} transparent />
                </Icosahedron>
              )}
              {isWood && (
                <Cylinder args={[0.15, 0.15, 0.4]} rotation={[0, 0, Math.PI / 2]}>
                    <meshStandardMaterial color="#8B4513" transparent />
                </Cylinder>
              )}
            </group>
        </group>
    )
}