import { Unit, Building } from '../../types';
import { COLLISION_DATA, getBuildingCollisionMask } from '../../constants';
import * as THREE from 'three';

const BUILDING_DEPENETRATION_PADDING = 0.12;
const MIN_PUSH_EPSILON = 0.2;
const CONTACT_MARGIN_MIN = 0.25;
const CONTACT_MARGIN_MULTIPLIER = 0.6;

export function getDepenetrationVector(unit: Unit, building: Building): { x: number, z: number } | null {
    const unitRadius = COLLISION_DATA.UNITS[unit.unitType].radius;
    const buildingSize = getBuildingCollisionMask(building.buildingType);

    const halfWidth = buildingSize.width / 2;
    const halfDepth = buildingSize.depth / 2;

    if (halfWidth <= 0 && halfDepth <= 0) {
        return null;
    }

    const clearanceX = halfWidth + unitRadius + BUILDING_DEPENETRATION_PADDING;
    const clearanceZ = halfDepth + unitRadius + BUILDING_DEPENETRATION_PADDING;

    const offsetX = unit.position.x - building.position.x;
    const offsetZ = unit.position.z - building.position.z;

    const dirX = offsetX >= 0 ? 1 : -1;
    const dirZ = offsetZ >= 0 ? 1 : -1;

    const insideX = Math.abs(offsetX) < clearanceX;
    const insideZ = Math.abs(offsetZ) < clearanceZ;

    const contactMargin = Math.max(CONTACT_MARGIN_MIN, unitRadius * CONTACT_MARGIN_MULTIPLIER);
    const nearX = Math.abs(offsetX) < clearanceX + contactMargin;
    const nearZ = Math.abs(offsetZ) < clearanceZ + contactMargin;

    if (insideX && insideZ) {
        const overlapX = clearanceX - Math.abs(offsetX);
        const overlapZ = clearanceZ - Math.abs(offsetZ);

        if (overlapX < overlapZ - 1e-3) {
            return { x: dirX * (overlapX + MIN_PUSH_EPSILON), z: 0 };
        }

        if (overlapZ < overlapX - 1e-3) {
            return { x: 0, z: dirZ * (overlapZ + MIN_PUSH_EPSILON) };
        }

        const length = Math.hypot(offsetX, offsetZ);
        if (length < 1e-4) {
            return {
                x: dirX * (clearanceX + MIN_PUSH_EPSILON),
                z: dirZ * (clearanceZ + MIN_PUSH_EPSILON),
            };
        }

        const penetration = Math.min(overlapX, overlapZ) + MIN_PUSH_EPSILON;
        const pushScale = penetration / length;
        return {
            x: offsetX * pushScale,
            z: offsetZ * pushScale,
        };
    }

    if (insideX && nearZ) {
        const penetration = (clearanceZ + contactMargin) - Math.abs(offsetZ);
        if (penetration > 0) {
            return { x: 0, z: dirZ * Math.max(penetration, MIN_PUSH_EPSILON) };
        }
    }

    if (insideZ && nearX) {
        const penetration = (clearanceX + contactMargin) - Math.abs(offsetX);
        if (penetration > 0) {
            return { x: dirX * Math.max(penetration, MIN_PUSH_EPSILON), z: 0 };
        }
    }

    if (nearX && nearZ) {
        const penetration = Math.min(
            (clearanceX + contactMargin) - Math.abs(offsetX),
            (clearanceZ + contactMargin) - Math.abs(offsetZ)
        );
        if (penetration > 0) {
            const length = Math.hypot(offsetX, offsetZ);
            const normalX = length < 1e-4 ? dirX : offsetX / length;
            const normalZ = length < 1e-4 ? dirZ : offsetZ / length;
            const impulse = penetration + MIN_PUSH_EPSILON * 0.5;
            return { x: normalX * impulse, z: normalZ * impulse };
        }
    }

    return null;
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
