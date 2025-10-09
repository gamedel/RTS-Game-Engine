import { Unit, Building } from '../../types';
import { COLLISION_DATA } from '../../constants';
import * as THREE from 'three';

const BUILDING_DEPENETRATION_PADDING = 0.8;
const MIN_PUSH_EPSILON = 0.05;

export function getDepenetrationVector(unit: Unit, building: Building): { x: number, z: number } | null {
    const unitRadius = COLLISION_DATA.UNITS[unit.unitType].radius;
    const buildingSize = COLLISION_DATA.BUILDINGS[building.buildingType];

    const halfWidth = buildingSize.width / 2;
    const halfDepth = buildingSize.depth / 2;
    const clearanceX = halfWidth + unitRadius + BUILDING_DEPENETRATION_PADDING;
    const clearanceZ = halfDepth + unitRadius + BUILDING_DEPENETRATION_PADDING;

    const offsetX = unit.position.x - building.position.x;
    const offsetZ = unit.position.z - building.position.z;

    const insideX = Math.abs(offsetX) < clearanceX;
    const insideZ = Math.abs(offsetZ) < clearanceZ;

    if (!insideX || !insideZ) {
        return null;
    }

    const overlapX = clearanceX - Math.abs(offsetX);
    const overlapZ = clearanceZ - Math.abs(offsetZ);

    const dirX = offsetX >= 0 ? 1 : -1;
    const dirZ = offsetZ >= 0 ? 1 : -1;

    if (overlapX < overlapZ - 1e-3) {
        return { x: dirX * (overlapX + MIN_PUSH_EPSILON), z: 0 };
    }

    if (overlapZ < overlapX - 1e-3) {
        return { x: 0, z: dirZ * (overlapZ + MIN_PUSH_EPSILON) };
    }

    const length = Math.hypot(offsetX, offsetZ);
    if (length < 1e-4) {
        return { x: clearanceX + MIN_PUSH_EPSILON, z: 0 };
    }

    const penetration = Math.min(overlapX, overlapZ) + MIN_PUSH_EPSILON;
    const scale = penetration / length;
    const pushX = offsetX * scale;
    const pushZ = offsetZ * scale;

    return { x: pushX, z: pushZ };
}

export function getSeparationVector(unit: Unit, otherUnits: Unit[]): THREE.Vector3 {
    const separationVector = new THREE.Vector3();
    let neighbors = 0;
    const desiredSeparation = (COLLISION_DATA.UNITS[unit.unitType].radius * 2) + 0.5;

    const unitPos = new THREE.Vector3(unit.position.x, 0, unit.position.z);

    for (const other of otherUnits) {
        if (unit.id === other.id) continue;

        const otherPos = new THREE.Vector3(other.position.x, 0, other.position.z);
        const distance = unitPos.distanceTo(otherPos);

        if (distance > 0 && distance < desiredSeparation) {
            const diff = new THREE.Vector3().subVectors(unitPos, otherPos);
            diff.normalize();
            diff.divideScalar(distance); // weight by distance
            separationVector.add(diff);
            neighbors++;
        }
    }

    if (neighbors > 0) {
        separationVector.divideScalar(neighbors);
    }
    
    return separationVector;
}