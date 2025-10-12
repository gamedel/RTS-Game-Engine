import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Plane } from '@react-three/drei';
import * as THREE from 'three';
import { Building, BuildingType } from '../../../types';
import { TRAINING_TIME, RESEARCH_CONFIG, TOWER_UPGRADE_CONFIG } from '../../../constants';

const BAR_WIDTH = 2.5;
const BAR_HEIGHT = 0.2;

const getBuildingHeight = (type: BuildingType) => {
    switch (type) {
        case BuildingType.TOWN_HALL: return 4.0;
        case BuildingType.BARRACKS: return 3.0;
        case BuildingType.DEFENSIVE_TOWER: return 5.0;
        case BuildingType.RESEARCH_CENTER: return 4.0;
        default: return 3.0;
    }
}

interface BuildingProgressBarProps {
    building: Building;
}

export const BuildingProgressBar: React.FC<BuildingProgressBarProps> = ({ building }) => {
    const groupRef = useRef<THREE.Group>(null!);

    useFrame(({ camera }) => {
        if (groupRef.current) {
            groupRef.current.quaternion.copy(camera.quaternion);
        }
    });

    let progress = 0;
    let color = '';

    if (building.upgradeProgress && building.upgradeProgress > 0) {
        progress = building.upgradeProgress;
        color = '#f97316'; // orange-500
    } else if (building.researchQueue && building.researchQueue.length > 0) {
        const item = building.researchQueue[0];
        const config = RESEARCH_CONFIG[item.type];
        progress = Math.min(1, item.progress / config.time);
        color = '#a855f7'; // purple-500
    } else if (building.trainingQueue && building.trainingQueue.length > 0) {
        const item = building.trainingQueue[0];
        const config = TRAINING_TIME[item.unitType];
        progress = Math.min(1, item.progress / (config * 1000));
        color = '#3b82f6'; // blue-500
    }

    if (building.isCollapsing) {
        return null;
    }

    if (progress <= 0 || progress >= 1 || building.constructionProgress !== undefined) {
        return null;
    }

    const yOffset = getBuildingHeight(building.buildingType);

    return (
        <group ref={groupRef} position={[0, yOffset, 0]}>
            <Plane args={[BAR_WIDTH, BAR_HEIGHT]}>
                <meshBasicMaterial color="#3f3f46" toneMapped={false} />
            </Plane>
            <Plane
                args={[progress * BAR_WIDTH, BAR_HEIGHT]}
                position={[-(1 - progress) * BAR_WIDTH / 2, 0, 0.01]}
            >
                <meshBasicMaterial color={color} toneMapped={false} />
            </Plane>
        </group>
    );
};
