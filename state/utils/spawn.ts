import { Building, GameState, Unit, UnitType, Vector3 } from '../../types';
import { COLLISION_DATA } from '../../constants';
import { NavMeshManager } from '../../hooks/utils/navMeshManager';

type Vec2 = { x: number; z: number };

const DEFAULT_FORWARD: Vec2 = { x: 0, z: 1 };

const normalize2 = (vec: Vec2): Vec2 => {
  const length = Math.hypot(vec.x, vec.z);
  if (length < 1e-5) {
    return { ...DEFAULT_FORWARD };
  }
  return { x: vec.x / length, z: vec.z / length };
};

const getSpawnBasis = (building: Building): { forward: Vec2; right: Vec2 } => {
  if (building.rallyPoint) {
    const dx = building.rallyPoint.x - building.position.x;
    const dz = building.rallyPoint.z - building.position.z;
    const forward = normalize2({ x: dx, z: dz });
    const right = { x: forward.z, z: -forward.x };
    return { forward, right };
  }
  return { forward: { ...DEFAULT_FORWARD }, right: { x: 1, z: 0 } };
};

export const getUnitRadius = (unitType: UnitType): number =>
  COLLISION_DATA.UNITS[unitType]?.radius ?? 0.5;

export const getBuildingHalfExtents = (building: Building) => {
  const size = COLLISION_DATA.BUILDINGS[building.buildingType];
  const width = size?.width ?? 4;
  const depth = size?.depth ?? 4;
  return { halfWidth: width / 2, halfDepth: depth / 2 };
};

export const isPointInsideBuilding = (point: Vector3, building: Building, padding = 0): boolean => {
  const { halfWidth, halfDepth } = getBuildingHalfExtents(building);
  const dx = Math.abs(point.x - building.position.x);
  const dz = Math.abs(point.z - building.position.z);
  return dx <= halfWidth + padding && dz <= halfDepth + padding;
};

const isPositionInsideBlockingBuilding = (
  buildings: Record<string, Building>,
  buildingId: string,
  point: Vector3,
  padding: number,
): boolean => {
  for (const other of Object.values(buildings)) {
    if (!other || other.id === buildingId || other.constructionProgress !== undefined || other.isCollapsing) {
      continue;
    }
    if (isPointInsideBuilding(point, other, padding)) {
      return true;
    }
  }
  return false;
};

const isPositionOccupiedByUnit = (
  units: Record<string, Unit>,
  excludeId: string | undefined,
  point: Vector3,
  radius: number,
): boolean => {
  for (const other of Object.values(units)) {
    if (!other || other.id === excludeId || other.isDying || other.hp <= 0) continue;
    const otherRadius = getUnitRadius(other.unitType);
    const dx = other.position.x - point.x;
    const dz = other.position.z - point.z;
    const combined = radius + otherRadius;
    if (dx * dx + dz * dz < combined * combined * 0.9) {
      return true;
    }
  }
  return false;
};

export const computeSpawnPosition = (
  state: GameState,
  building: Building,
  unitType: UnitType,
): Vector3 => {
  const unitRadius = getUnitRadius(unitType);
  const { forward, right } = getSpawnBasis(building);
  const { halfWidth, halfDepth } = getBuildingHalfExtents(building);
  const baseDistance = Math.max(halfWidth, halfDepth) + unitRadius + 0.85;
  const forwardSpacing = Math.max(0.9, unitRadius * 1.8);
  const lateralSpacing = Math.max(0.9, unitRadius * 2.0);

  const candidates: Vector3[] = [];

  for (let ring = 0; ring < 4; ring++) {
    const forwardOffset = baseDistance + ring * forwardSpacing;
    const lateralExtent = ring === 0 ? 0 : ring * 2;
    for (let lateral = -lateralExtent; lateral <= lateralExtent; lateral++) {
      if (ring === 0 && lateral !== 0) continue;
      const lateralOffset = lateral * lateralSpacing;
      candidates.push({
        x: building.position.x + forward.x * forwardOffset + right.x * lateralOffset,
        y: 0,
        z: building.position.z + forward.z * forwardOffset + right.z * lateralOffset,
      });
    }
  }

  const circleRadius = baseDistance + forwardSpacing;
  for (let i = 0; i < 12; i++) {
    const angle = (Math.PI * 2 * i) / 12;
    candidates.push({
      x: building.position.x + Math.cos(angle) * circleRadius,
      y: 0,
      z: building.position.z + Math.sin(angle) * circleRadius,
    });
  }

  const selectionOrder =
    candidates.length <= 1
      ? candidates
      : (() => {
          const ordered: Vector3[] = [];
          const startRange = Math.min(candidates.length, 6);
          const startIndex = Math.floor(Math.random() * startRange);
          for (let i = 0; i < candidates.length; i++) {
            const idx = (startIndex + i) % candidates.length;
            ordered.push(candidates[idx]);
          }
          return ordered;
        })();

  for (const candidate of selectionOrder) {
    const snapped = NavMeshManager.safeSnap(candidate, 3);
    const testPos = { x: snapped.x, y: 0, z: snapped.z };
    if (isPointInsideBuilding(testPos, building, unitRadius * 0.6)) continue;
    if (isPositionInsideBlockingBuilding(state.buildings, building.id, testPos, unitRadius * 0.6)) continue;
    if (isPositionOccupiedByUnit(state.units, undefined, testPos, unitRadius * 1.05)) continue;
    return testPos;
  }

  const fallback = NavMeshManager.safeSnap(
    {
      x: building.position.x + forward.x * (baseDistance + forwardSpacing),
      y: 0,
      z: building.position.z + forward.z * (baseDistance + forwardSpacing),
    },
    4,
  );
  return { x: fallback.x, y: 0, z: fallback.z };
};

export const computeRadialMoveOutPosition = (
  building: Building,
  spawnPosition: Vector3,
  extraDistance = 2,
): Vector3 => {
  const dirX = spawnPosition.x - building.position.x;
  const dirZ = spawnPosition.z - building.position.z;
  const length = Math.hypot(dirX, dirZ);
  if (length < 1e-4) {
    return {
      x: spawnPosition.x,
      y: spawnPosition.y,
      z: spawnPosition.z + extraDistance,
    };
  }
  const scale = extraDistance / length;
  return {
    x: spawnPosition.x + dirX * scale,
    y: spawnPosition.y,
    z: spawnPosition.z + dirZ * scale,
  };
};

export const findEjectionPosition = (
  units: Record<string, Unit>,
  buildings: Record<string, Building>,
  building: Building,
  unit: Unit,
): Vector3 => {
  const { halfWidth, halfDepth } = getBuildingHalfExtents(building);
  const unitRadius = getUnitRadius(unit.unitType);
  const baseDistance = Math.max(halfWidth, halfDepth) + unitRadius + 0.75;
  let baseAngle = Math.atan2(unit.position.z - building.position.z, unit.position.x - building.position.x);
  if (!Number.isFinite(baseAngle)) {
    baseAngle = Math.random() * Math.PI * 2;
  }

  const offsets = [0, Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2, Math.PI];
  for (let i = 0; i < offsets.length; i++) {
    const angle = baseAngle + offsets[i];
    const distance = baseDistance + (i >= 4 ? 0.75 : 0);
    const testPoint = {
      x: building.position.x + Math.cos(angle) * distance,
      y: 0,
      z: building.position.z + Math.sin(angle) * distance,
    };
    const snapped = NavMeshManager.safeSnap(testPoint, distance + 2);
    const candidate = { x: snapped.x, y: 0, z: snapped.z };

    if (
      isPointInsideBuilding(candidate, building, unitRadius * 0.4) ||
      isPositionInsideBlockingBuilding(buildings, building.id, candidate, unitRadius * 0.4) ||
      isPositionOccupiedByUnit(units, unit.id, candidate, unitRadius * 1.05)
    ) {
      continue;
    }
    return candidate;
  }

  return {
    x: building.position.x + Math.cos(baseAngle) * baseDistance,
    y: 0,
    z: building.position.z + Math.sin(baseAngle) * baseDistance,
  };
};

export const collectEjectionPatches = (
  units: Record<string, Unit>,
  buildings: Record<string, Building>,
  building: Building,
): Array<Partial<Unit> & { id: string }> => {
  const patches: Array<Partial<Unit> & { id: string }> = [];
  const { halfWidth, halfDepth } = getBuildingHalfExtents(building);

  Object.values(units).forEach(unit => {
    if (!unit || unit.isDying || unit.hp <= 0) return;
    const unitRadius = getUnitRadius(unit.unitType);
    const dx = Math.abs(unit.position.x - building.position.x);
    const dz = Math.abs(unit.position.z - building.position.z);

    if (dx <= halfWidth + unitRadius && dz <= halfDepth + unitRadius) {
      const destination = findEjectionPosition(units, buildings, building, unit);
      const patch: Partial<Unit> & { id: string } = {
        id: unit.id,
        position: destination,
        path: undefined,
        pathIndex: undefined,
        pathTarget: undefined,
        targetPosition: undefined,
        finalDestination: undefined,
        interactionAnchor: undefined,
        interactionRadius: undefined,
      };

      if (unit.guardPosition) {
        patch.guardPosition = { x: destination.x, y: destination.y ?? 0, z: destination.z };
      }

      patches.push(patch);
    }
  });

  return patches;
};

export const findContainingBuilding = (
  buildings: Record<string, Building>,
  position: Vector3,
  padding = 0,
): Building | undefined => {
  for (const building of Object.values(buildings)) {
    if (!building || building.constructionProgress !== undefined || building.isCollapsing) continue;
    if (isPointInsideBuilding(position, building, padding)) {
      return building;
    }
  }
  return undefined;
};
