import { Building, Unit, Vector3 } from '../../types';
import { COLLISION_DATA, getBuildingCollisionMask } from '../../constants';
import { NavMeshManager } from './navMeshManager';

const normalize = (x: number, z: number) => {
    const length = Math.hypot(x, z);
    if (length < 1e-3) {
        return { x: 0, z: 0 };
    }
    return { x: x / length, z: z / length };
};

export const computeBuildingApproachPoint = (unit: Unit, building: Building, desired: Vector3): Vector3 => {
    const buildingCollision = getBuildingCollisionMask(building.buildingType);
    const unitCollision = COLLISION_DATA.UNITS[unit.unitType];

    if (!buildingCollision || !unitCollision || buildingCollision.width <= 0 || buildingCollision.depth <= 0) {
        return NavMeshManager.safeSnap(desired, 4);
    }

    const center = building.position;
    const halfWidth = buildingCollision.width / 2;
    const halfDepth = buildingCollision.depth / 2;
    const clearance = unitCollision.radius + 0.3;
    const cornerPadding = clearance * 0.65;

    let dirX = desired.x - center.x;
    let dirZ = desired.z - center.z;
    let dirLength = Math.hypot(dirX, dirZ);

    if (dirLength < 1e-3) {
        dirX = unit.position.x - center.x;
        dirZ = unit.position.z - center.z;
        dirLength = Math.hypot(dirX, dirZ);
        if (dirLength < 1e-3) {
            dirX = 1;
            dirZ = 0;
            dirLength = 1;
        }
    }

    type DirectionCandidate = { x: number; z: number; bias: number };
    const candidates: DirectionCandidate[] = [];
    const seen = new Set<string>();
    const pushCandidate = (x: number, z: number, bias: number) => {
        if (!isFinite(x) || !isFinite(z)) return;
        const norm = normalize(x, z);
        if (Math.abs(norm.x) < 1e-3 && Math.abs(norm.z) < 1e-3) return;
        const key = `${norm.x.toFixed(3)}|${norm.z.toFixed(3)}`;
        if (seen.has(key)) return;
        seen.add(key);
        candidates.push({ x: norm.x, z: norm.z, bias });
    };

    pushCandidate(dirX, dirZ, 0);
    pushCandidate(Math.sign(dirX), 0, 0.35);
    pushCandidate(0, Math.sign(dirZ), 0.35);

    if (Math.abs(dirX) > 1e-3 && Math.abs(dirZ) > 1e-3) {
        pushCandidate(Math.sign(dirX), Math.sign(dirZ), 0.25);
    }

    // Always consider the four main faces for stability
    pushCandidate(1, 0, 0.6);
    pushCandidate(-1, 0, 0.6);
    pushCandidate(0, 1, 0.6);
    pushCandidate(0, -1, 0.6);

    let bestPoint: Vector3 | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
        const edgeDistance = Math.min(
            candidate.x === 0 ? Number.POSITIVE_INFINITY : halfWidth / Math.abs(candidate.x),
            candidate.z === 0 ? Number.POSITIVE_INFINITY : halfDepth / Math.abs(candidate.z)
        );
        if (!isFinite(edgeDistance)) {
            continue;
        }

        let offset = edgeDistance + clearance;
        if (Math.abs(candidate.x) > 0.5 && Math.abs(candidate.z) > 0.5) {
            offset += cornerPadding;
        } else {
            offset += clearance * 0.25;
        }

        const rawPoint = {
            x: center.x + candidate.x * offset,
            y: 0,
            z: center.z + candidate.z * offset,
        };

        const snapped = NavMeshManager.safeSnap(rawPoint, offset + clearance + 0.5);
        const toDesired = Math.hypot(snapped.x - desired.x, snapped.z - desired.z);
        const snapDelta = Math.hypot(snapped.x - rawPoint.x, snapped.z - rawPoint.z);
        const toUnit = Math.hypot(snapped.x - unit.position.x, snapped.z - unit.position.z);
        const reachTest = NavMeshManager.projectMove(snapped, desired);
        const reachError = Math.hypot(reachTest.x - desired.x, reachTest.z - desired.z);

        const score =
            toDesired +
            candidate.bias * 2 +
            snapDelta * 1.5 +
            reachError * 3 +
            toUnit * 0.05;

        if (score < bestScore) {
            bestScore = score;
            bestPoint = snapped;
        }
    }

    if (bestPoint) {
        return bestPoint;
    }

    return NavMeshManager.safeSnap(desired, clearance + 4);
};
