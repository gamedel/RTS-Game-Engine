import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import * as THREE from 'three';
import { Building } from '../../../types';
import { BUILDING_COLLAPSE_DURATION, BUILDING_COLLAPSE_SINK_DEPTH } from '../../../constants';

const tiltRadians = THREE.MathUtils.degToRad(15);
const rollRadians = THREE.MathUtils.degToRad(8);

export const useBuildingCollapse = (building: Building) => {
    const collapseGroupRef = useRef<THREE.Group>(null!);

    useFrame(() => {
        const group = collapseGroupRef.current;
        if (!group) return;

        if (building.isCollapsing && building.collapseStartedAt) {
            const elapsed = Date.now() - building.collapseStartedAt;
            const progress = Math.min(Math.max(elapsed / BUILDING_COLLAPSE_DURATION, 0), 1);
            const eased = 1 - Math.pow(1 - progress, 2);
            group.position.y = -BUILDING_COLLAPSE_SINK_DEPTH * eased;
            group.rotation.x = -tiltRadians * eased;
            group.rotation.z = rollRadians * eased;
        } else {
            group.position.y = 0;
            group.rotation.x = 0;
            group.rotation.z = 0;
        }
    });

    return collapseGroupRef;
};
