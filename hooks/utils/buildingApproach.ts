import { Building, Unit, Vector3, BuildingType } from '../../types';
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
    const buildingMask = getBuildingCollisionMask(building.buildingType);
    const fallbackCollision = COLLISION_DATA.BUILDINGS[building.buildingType];
    const unitCollision = COLLISION_DATA.UNITS[unit.unitType];

    if (!unitCollision) {
        return NavMeshManager.safeSnap(desired, 4);
    }

    const maskWidth = buildingMask?.width ?? 0;
    const maskDepth = buildingMask?.depth ?? 0;
    const fallbackWidth = fallbackCollision?.width ?? maskWidth;
    const fallbackDepth = fallbackCollision?.depth ?? maskDepth;

    const navHalfWidth = (maskWidth > 0 ? maskWidth : fallbackWidth) / 2;
    const navHalfDepth = (maskDepth > 0 ? maskDepth : fallbackDepth) / 2;
    const physicalHalfWidth = (fallbackWidth > 0 ? fallbackWidth : maskWidth) / 2;
    const physicalHalfDepth = (fallbackDepth > 0 ? fallbackDepth : maskDepth) / 2;

    if (navHalfWidth <= 0 || navHalfDepth <= 0) {
        return NavMeshManager.safeSnap(desired, 4);
    }

    const center = building.position;
    let clearance = unitCollision.radius + 0.35;
    if (building.buildingType === BuildingType.TOWN_HALL) {
        clearance = unitCollision.radius + 0.32;
    }
    let cornerPadding = clearance * 0.65;
    if (building.buildingType === BuildingType.TOWN_HALL) {
        cornerPadding = clearance * 0.55;
    }

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

    const isPointInsidePhysical = (point: Vector3) => {
        const epsilon = 0.05;
        return (
            Math.abs(point.x - center.x) <= physicalHalfWidth - epsilon &&
            Math.abs(point.z - center.z) <= physicalHalfDepth - epsilon
        );
    };

    const distanceToPhysicalBoundary = (x: number, z: number) => {
        const absX = Math.abs(x);
        const absZ = Math.abs(z);
        const alongX = absX > 1e-3 ? physicalHalfWidth / absX : Number.POSITIVE_INFINITY;
        const alongZ = absZ > 1e-3 ? physicalHalfDepth / absZ : Number.POSITIVE_INFINITY;
        const boundary = Math.min(alongX, alongZ);
        return Number.isFinite(boundary) ? boundary : Math.max(physicalHalfWidth, physicalHalfDepth);
    };

    const ensureOutside = (point: Vector3, dir: DirectionCandidate): Vector3 => {
        const baseDir = normalize(dir.x, dir.z);
        const boundary = distanceToPhysicalBoundary(baseDir.x, baseDir.z);
        const baseDistance = boundary + clearance + 0.05;
        const currentDistance = Math.hypot(point.x - center.x, point.z - center.z);
        const desiredDistance = Math.max(currentDistance, baseDistance);
        const outsidePoint = {
            x: center.x + baseDir.x * desiredDistance,
            y: 0,
            z: center.z + baseDir.z * desiredDistance,
        };
        const snappedOutside = NavMeshManager.safeSnap(outsidePoint, desiredDistance + clearance + 0.5);
        if (!isPointInsidePhysical(snappedOutside)) {
            return snappedOutside;
        }
        if (!isPointInsidePhysical(outsidePoint)) {
            return outsidePoint;
        }
        const fallbackDistance = boundary + clearance + 0.25;
        return {
            x: center.x + baseDir.x * fallbackDistance,
            y: 0,
            z: center.z + baseDir.z * fallbackDistance,
        };
    };

    let bestPoint: Vector3 | null = null;
    let bestDir: DirectionCandidate | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
        const edgeDistance = Math.min(
            candidate.x === 0 ? Number.POSITIVE_INFINITY : navHalfWidth / Math.abs(candidate.x),
            candidate.z === 0 ? Number.POSITIVE_INFINITY : navHalfDepth / Math.abs(candidate.z)
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
        const insidePenalty = isPointInsidePhysical(snapped) ? 50 : 0;

        const score =
            toDesired +
            candidate.bias * 2 +
            snapDelta * 1.5 +
            reachError * 3 +
            toUnit * 0.05 +
            insidePenalty;

        if (score < bestScore) {
            bestScore = score;
            bestPoint = snapped;
            bestDir = candidate;
        }
    }

    if (bestPoint && bestDir) {
        return ensureOutside(bestPoint, bestDir);
    }

    return NavMeshManager.safeSnap(desired, clearance + 4);
};
