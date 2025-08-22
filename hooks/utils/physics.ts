import { Unit, Building } from '../../types';
import { COLLISION_DATA } from '../../constants';
import * as THREE from 'three';

export function getDepenetrationVector(unit: Unit, building: Building): { x: number, z: number } | null {
    const unitRadius = COLLISION_DATA.UNITS[unit.unitType].radius;
    const buildingSize = COLLISION_DATA.BUILDINGS[building.buildingType];

    const buildingBox = {
        minX: building.position.x - buildingSize.width / 2,
        maxX: building.position.x + buildingSize.width / 2,
        minZ: building.position.z - buildingSize.depth / 2,
        maxZ: building.position.z + buildingSize.depth / 2,
    };

    const closestX = Math.max(buildingBox.minX, Math.min(unit.position.x, buildingBox.maxX));
    const closestZ = Math.max(buildingBox.minZ, Math.min(unit.position.z, buildingBox.maxZ));

    const dx = unit.position.x - closestX;
    const dz = unit.position.z - closestZ;
    const distanceSq = dx * dx + dz * dz;

    if (distanceSq < unitRadius * unitRadius) {
        const distance = Math.sqrt(distanceSq);
        // Обработка случая, когда центр юнита находится внутри AABB здания
        if (distance < 0.001) {
            const p = unit.position;
            const b = buildingBox;
            const overlaps = {
                xMin: p.x - b.minX,
                xMax: b.maxX - p.x,
                zMin: p.z - b.minZ,
                zMax: b.maxZ - p.z,
            };
            const minOverlap = Math.min(overlaps.xMin, overlaps.xMax, overlaps.zMin, overlaps.zMax);
            
            // Выталкиваем в сторону наименьшего пересечения
            const pushOut = minOverlap + unitRadius;
            if (minOverlap === overlaps.xMin) return { x: -pushOut, z: 0 };
            if (minOverlap === overlaps.xMax) return { x:   pushOut, z: 0 };
            if (minOverlap === overlaps.zMin) return { x: 0, z: -pushOut };
            if (minOverlap === overlaps.zMax) return { x: 0, z:   pushOut };
            return null;
        }

        const penetration = unitRadius - distance;
        const pushX = (dx / distance) * penetration;
        const pushZ = (dz / distance) * penetration;
        
        return { x: pushX, z: pushZ };
    }
    
    return null;
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