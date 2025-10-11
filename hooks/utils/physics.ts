import { Unit, Building } from '../../types';
import { COLLISION_DATA, getBuildingCollisionMask } from '../../constants';
import * as THREE from 'three';

const BUILDING_DEPENETRATION_PADDING = 0.12;
const MIN_PUSH_EPSILON = 0.12;

export function getDepenetrationVector(unit: Unit, building: Building): { x: number, z: number } | null {
    const unitRadius = COLLISION_DATA.UNITS[unit.unitType].radius;
    const buildingSize = getBuildingCollisionMask(building.buildingType);

    const halfWidth = buildingSize.width / 2;
    const halfDepth = buildingSize.depth / 2;

    if (halfWidth <= 0 || halfDepth <= 0) {
        return null;
    }
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
  const desiredSq = desiredSeparation * desiredSeparation;

  const ux = unit.position.x;
  const uz = unit.position.z;

  for (const other of otherUnits) {
    if (!other || unit.id === other.id) continue;

    const dx = ux - other.position.x;
    const dz = uz - other.position.z;
    const distSq = dx * dx + dz * dz;
    if (distSq <= 0 || distSq >= desiredSq) continue;

    const dist = Math.sqrt(distSq);
    if (dist <= 0) continue;

    const inv = 1 / dist;
    separationVector.x += dx * inv;
    separationVector.z += dz * inv;
    neighbors++;
  }

  if (neighbors > 0) {
    separationVector.multiplyScalar(1 / neighbors);
  }

  return separationVector;
}
