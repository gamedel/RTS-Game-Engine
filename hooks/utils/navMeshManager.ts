import type { Dispatch } from 'react';
import PF from 'pathfinding';
import { Building, ResourceNode, Vector3, Action, UnitStatus } from '../../types';
import { COLLISION_DATA } from '../../constants';

type PathRequest = { unitId: string; start: Vector3; goal: Vector3 };

type Cell = { cx: number; cz: number };

type NavigationGrid = {
  cellSize: number;
  width: number;
  height: number;
  originX: number;
  originZ: number;
};

type Finder = { findPath: (sx: number, sy: number, ex: number, ey: number, grid: any) => number[][] };

type NavState = {
  dispatch: Dispatch<Action> | null;
  ready: boolean;
  grid: NavigationGrid | null;
  baseGrid: any | null;
  walkable: Uint8Array | null;
  occupancy: Uint16Array | null;
  obstacles: Map<string, number[]>;
  agentPadding: number;
  finder: Finder | null;
};

const WORLD_SIZE = 320;
const HALF_WORLD = WORLD_SIZE / 2;
const CELL_SIZE = 0.5;
const SAMPLE_STEP = CELL_SIZE * 0.5;
const MAX_QUEUE_BATCH = 24;
const MAX_SEARCH_RADIUS_CELLS = 96;
const EPSILON = 1e-4;

const navState: NavState = {
  dispatch: null,
  ready: false,
  grid: null,
  baseGrid: null,
  walkable: null,
  occupancy: null,
  obstacles: new Map(),
  agentPadding: 0,
  finder: null
};

const requestQueue: PathRequest[] = [];
const pendingRequests = new Set<string>();

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const clampToWorld = (p: Vector3): Vector3 => ({
  x: clamp(p.x, -HALF_WORLD + CELL_SIZE, HALF_WORLD - CELL_SIZE),
  y: 0,
  z: clamp(p.z, -HALF_WORLD + CELL_SIZE, HALF_WORLD - CELL_SIZE)
});

const encodeCell = (cell: Cell) => `${cell.cx}|${cell.cz}`;

const isGridReady = (): navState is NavState & { grid: NavigationGrid; baseGrid: any; walkable: Uint8Array; occupancy: Uint16Array; finder: Finder } => {
  return !!(navState.grid && navState.baseGrid && navState.walkable && navState.occupancy && navState.finder);
};

const worldToCell = (x: number, z: number): Cell | null => {
  if (!navState.grid) return null;
  const cx = Math.floor((x - navState.grid.originX) / navState.grid.cellSize);
  const cz = Math.floor((z - navState.grid.originZ) / navState.grid.cellSize);
  if (cx < 0 || cz < 0 || cx >= navState.grid.width || cz >= navState.grid.height) return null;
  return { cx, cz };
};

const cellToWorld = ({ cx, cz }: Cell): Vector3 => {
  if (!navState.grid) return { x: 0, y: 0, z: 0 };
  const x = navState.grid.originX + (cx + 0.5) * navState.grid.cellSize;
  const z = navState.grid.originZ + (cz + 0.5) * navState.grid.cellSize;
  return { x, y: 0, z };
};

const indexForCell = ({ cx, cz }: Cell): number => {
  if (!navState.grid) return -1;
  return cz * navState.grid.width + cx;
};

const cellFromIndex = (index: number): Cell | null => {
  if (!navState.grid) return null;
  const cx = index % navState.grid.width;
  const cz = Math.floor(index / navState.grid.width);
  return { cx, cz };
};

const isCellInside = (cell: Cell) => {
  if (!navState.grid) return false;
  return cell.cx >= 0 && cell.cz >= 0 && cell.cx < navState.grid.width && cell.cz < navState.grid.height;
};

const isCellWalkable = (cell: Cell | null) => {
  if (!cell || !navState.occupancy) return false;
  if (!isCellInside(cell)) return false;
  const idx = indexForCell(cell);
  return idx >= 0 ? navState.occupancy[idx] === 0 : false;
};

const isWorldWalkable = (point: Vector3) => isCellWalkable(worldToCell(point.x, point.z));

const adjustCellOccupancy = (index: number, delta: number) => {
  if (!isGridReady()) return;
  if (index < 0 || index >= navState.occupancy.length) return;
  const next = Math.max(0, navState.occupancy[index] + delta);
  navState.occupancy[index] = next;
  const blocked = next > 0;
  const cell = cellFromIndex(index);
  if (!cell) return;
  navState.baseGrid.setWalkableAt(cell.cx, cell.cz, !blocked);
  navState.walkable[index] = blocked ? 0 : 1;
};

const markCells = (id: string, indices: number[]) => {
  if (!isGridReady()) return;
  const existing = navState.obstacles.get(id);
  if (existing) {
    existing.forEach(idx => adjustCellOccupancy(idx, -1));
  }
  navState.obstacles.set(id, indices);
  indices.forEach(idx => adjustCellOccupancy(idx, +1));
};

const unmarkCells = (id: string) => {
  if (!isGridReady()) return;
  const indices = navState.obstacles.get(id);
  if (!indices) return;
  indices.forEach(idx => adjustCellOccupancy(idx, -1));
  navState.obstacles.delete(id);
};

const eachCellInRect = (minX: number, maxX: number, minZ: number, maxZ: number): number[] => {
  if (!navState.grid) return [];

  const minCx = Math.floor((minX - navState.grid.originX) / navState.grid.cellSize);
  const maxCx = Math.floor((maxX - navState.grid.originX) / navState.grid.cellSize);
  const minCz = Math.floor((minZ - navState.grid.originZ) / navState.grid.cellSize);
  const maxCz = Math.floor((maxZ - navState.grid.originZ) / navState.grid.cellSize);

  const cells: number[] = [];
  for (let cz = minCz; cz <= maxCz; cz++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const cell = { cx, cz };
      if (!isCellInside(cell)) continue;
      const idx = indexForCell(cell);
      if (idx >= 0) cells.push(idx);
    }
  }
  return cells;
};

const eachCellInDisc = (center: Vector3, radius: number): number[] => {
  if (!navState.grid) return [];
  const cells: number[] = [];
  const totalRadius = radius + navState.agentPadding;
  const minX = center.x - totalRadius;
  const maxX = center.x + totalRadius;
  const minZ = center.z - totalRadius;
  const maxZ = center.z + totalRadius;

  const minCx = Math.floor((minX - navState.grid.originX) / navState.grid.cellSize);
  const maxCx = Math.floor((maxX - navState.grid.originX) / navState.grid.cellSize);
  const minCz = Math.floor((minZ - navState.grid.originZ) / navState.grid.cellSize);
  const maxCz = Math.floor((maxZ - navState.grid.originZ) / navState.grid.cellSize);

  const radiusSq = totalRadius * totalRadius;

  for (let cz = minCz; cz <= maxCz; cz++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const cell = { cx, cz };
      if (!isCellInside(cell)) continue;
      const worldPos = cellToWorld(cell);
      const dx = worldPos.x - center.x;
      const dz = worldPos.z - center.z;
      if (dx * dx + dz * dz <= radiusSq) {
        const idx = indexForCell(cell);
        if (idx >= 0) cells.push(idx);
      }
    }
  }

  return cells;
};

const registerBuildingObstacle = (building: Building) => {
  if (!navState.grid) return;
  if (building.constructionProgress !== undefined) return;
  const size = COLLISION_DATA.BUILDINGS[building.buildingType];
  if (!size) return;
  const pad = navState.agentPadding;
  const halfWidth = size.width / 2 + pad;
  const halfDepth = size.depth / 2 + pad;
  const minX = building.position.x - halfWidth;
  const maxX = building.position.x + halfWidth;
  const minZ = building.position.z - halfDepth;
  const maxZ = building.position.z + halfDepth;
  const cells = eachCellInRect(minX, maxX, minZ, maxZ);
  markCells(`building:${building.id}`, cells);
};

const registerResourceObstacle = (resource: ResourceNode) => {
  if (!navState.grid) return;
  if (resource.amount <= 0 || resource.isFalling) return;
  const collision = COLLISION_DATA.RESOURCES[resource.resourceType];
  if (!collision) return;
  const cells = eachCellInDisc(resource.position, collision.radius);
  markCells(`resource:${resource.id}`, cells);
};

const rebuildStaticObstacles = (buildings: Record<string, Building>, resources: Record<string, ResourceNode>) => {
  if (!isGridReady()) return;
  navState.obstacles.clear();
  navState.occupancy.fill(0);
  navState.walkable.fill(1);
  for (let cz = 0; cz < navState.grid.height; cz++) {
    for (let cx = 0; cx < navState.grid.width; cx++) {
      navState.baseGrid.setWalkableAt(cx, cz, true);
    }
  }

  Object.values(buildings).forEach(registerBuildingObstacle);
  Object.values(resources).forEach(registerResourceObstacle);
};

const getNeighbors = (cell: Cell): Cell[] => {
  const neighbors: Cell[] = [];
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dz === 0) continue;
      const candidate = { cx: cell.cx + dx, cz: cell.cz + dz };
      if (isCellInside(candidate)) neighbors.push(candidate);
    }
  }
  return neighbors;
};

const findNearestWalkableCell = (start: Cell | null, maxDistance = MAX_SEARCH_RADIUS_CELLS): Cell | null => {
  if (!start) return null;
  if (!navState.grid) return null;

  const visited = new Set<string>();
  const queue: { cell: Cell; distance: number }[] = [{ cell: start, distance: 0 }];
  visited.add(encodeCell(start));

  while (queue.length) {
    const current = queue.shift()!;
    if (isCellWalkable(current.cell)) {
      return current.cell;
    }
    if (current.distance >= maxDistance) continue;
    const nextDistance = current.distance + 1;
    for (const neighbor of getNeighbors(current.cell)) {
      const key = encodeCell(neighbor);
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push({ cell: neighbor, distance: nextDistance });
    }
  }

  return null;
};

const traverseLine = (start: Cell, end: Cell): Cell[] => {
  const points: Cell[] = [];
  let x0 = start.cx;
  let z0 = start.cz;
  const x1 = end.cx;
  const z1 = end.cz;
  const dx = Math.abs(x1 - x0);
  const dz = Math.abs(z1 - z0);
  const sx = x0 < x1 ? 1 : -1;
  const sz = z0 < z1 ? 1 : -1;
  let err = dx - dz;

  while (true) {
    points.push({ cx: x0, cz: z0 });
    if (x0 === x1 && z0 === z1) break;
    const e2 = 2 * err;
    if (e2 > -dz) {
      err -= dz;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      z0 += sz;
    }
  }

  return points;
};

const lineIsClear = (start: Cell, end: Cell) => {
  const samples = traverseLine(start, end);
  for (const cell of samples) {
    if (!isCellWalkable(cell)) {
      return false;
    }
  }
  return true;
};

const simplifyCells = (cells: Cell[]): Cell[] => {
  if (cells.length <= 2) return cells;
  const result: Cell[] = [cells[0]];
  let anchorIndex = 0;

  for (let i = 2; i < cells.length; i++) {
    const anchor = cells[anchorIndex];
    const candidate = cells[i];
    if (!lineIsClear(anchor, candidate)) {
      result.push(cells[i - 1]);
      anchorIndex = i - 1;
    }
  }

  result.push(cells[cells.length - 1]);
  return result;
};

const computePath = (start: Vector3, goal: Vector3): Vector3[] => {
  if (!isGridReady()) return [];

  const clampedStart = clampToWorld(start);
  const clampedGoal = clampToWorld(goal);

  const startCell = findNearestWalkableCell(worldToCell(clampedStart.x, clampedStart.z));
  const goalCell = findNearestWalkableCell(worldToCell(clampedGoal.x, clampedGoal.z));

  if (!startCell || !goalCell) return [];

  const grid = navState.baseGrid.clone();
  const rawPath = navState.finder.findPath(startCell.cx, startCell.cz, goalCell.cx, goalCell.cz, grid);

  if (!rawPath.length) {
    if (isCellWalkable(goalCell)) {
      return [clampedGoal];
    }
    return [];
  }

  const cells = rawPath.map(([cx, cz]) => ({ cx, cz }));
  const simplified = simplifyCells(cells);
  const waypoints: Vector3[] = simplified.map(cell => clampToWorld(cellToWorld(cell)));

  if (!waypoints.length) {
    return [clampedGoal];
  }

  // Ensure the final waypoint is as close as possible to the requested goal.
  const last = waypoints[waypoints.length - 1];
  const dx = clampedGoal.x - last.x;
  const dz = clampedGoal.z - last.z;
  if (dx * dx + dz * dz > 1e-3) {
    if (isWorldWalkable(clampedGoal)) {
      waypoints.push(clampedGoal);
    }
  }

  return waypoints;
};

const handlePathFailure = (unitId: string) => {
  if (!navState.dispatch) return;
  navState.dispatch({
    type: 'UPDATE_UNIT',
    payload: {
      id: unitId,
      pathTarget: undefined,
      path: undefined,
      pathIndex: undefined,
      status: UnitStatus.IDLE
    }
  });
};

const processNextRequest = () => {
  const req = requestQueue.shift();
  if (!req) return;

  const { unitId, start, goal } = req;
  try {
    const path = computePath(start, goal);
    if (!navState.dispatch) return;

    if (!path.length) {
      if (isWorldWalkable(goal)) {
        navState.dispatch({ type: 'UPDATE_UNIT', payload: { id: unitId, path: [clampToWorld(goal)], pathIndex: 0 } });
      } else {
        handlePathFailure(unitId);
      }
      return;
    }

    navState.dispatch({ type: 'UPDATE_UNIT', payload: { id: unitId, path, pathIndex: 0 } });
  } catch (err) {
    console.error('[NavMeshManager] Failed to compute path', err);
    handlePathFailure(unitId);
  } finally {
    pendingRequests.delete(unitId);
  }
};

const projectMoveInternal = (from: Vector3, to: Vector3): Vector3 => {
  if (!isGridReady()) return clampToWorld(to);
  const direction = {
    x: to.x - from.x,
    z: to.z - from.z
  };
  const distance = Math.hypot(direction.x, direction.z);
  if (distance < EPSILON) return clampToWorld(to);
  const samples = Math.max(1, Math.ceil(distance / SAMPLE_STEP));
  let lastValid = { ...from };
  for (let i = 1; i <= samples; i++) {
    const t = Math.min(1, (i * SAMPLE_STEP) / distance);
    const candidate = clampToWorld({
      x: from.x + direction.x * t,
      y: 0,
      z: from.z + direction.z * t
    });
    if (!isWorldWalkable(candidate)) {
      break;
    }
    lastValid = candidate;
  }
  return lastValid;
};

const advanceOnNavInternal = (from: Vector3, to: Vector3, maxStep: number): Vector3 => {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  if (distance < EPSILON) return clampToWorld(to);
  const clampedStep = Math.min(maxStep, distance);
  const direction = { x: (to.x - from.x) / distance, z: (to.z - from.z) / distance };
  const target = {
    x: from.x + direction.x * clampedStep,
    y: 0,
    z: from.z + direction.z * clampedStep
  };
  return projectMoveInternal(from, target);
};

const snapToNavInternal = (point: Vector3): Vector3 => {
  if (!isGridReady()) return clampToWorld(point);
  const nearest = findNearestWalkableCell(worldToCell(point.x, point.z));
  return nearest ? clampToWorld(cellToWorld(nearest)) : clampToWorld(point);
};

const safeSnapInternal = (target: Vector3, maxSnapDistance: number): Vector3 => {
  if (!isGridReady()) return clampToWorld(target);
  const maxCells = Math.max(1, Math.ceil(maxSnapDistance / navState.grid.cellSize));
  const nearest = findNearestWalkableCell(worldToCell(target.x, target.z), maxCells);
  return nearest ? clampToWorld(cellToWorld(nearest)) : clampToWorld(target);
};

export const NavMeshManager = {
  async init(dispatch: Dispatch<Action>) {
    navState.dispatch = dispatch;
    navState.ready = false;
    navState.grid = null;
    navState.baseGrid = null;
    navState.walkable = null;
    navState.occupancy = null;
    navState.obstacles.clear();
    navState.finder = null;
    requestQueue.length = 0;
    pendingRequests.clear();
  },

  isReady() {
    return navState.ready;
  },

  async buildNavMesh(buildings: Record<string, Building>, resources: Record<string, ResourceNode>) {
    const width = Math.ceil(WORLD_SIZE / CELL_SIZE);
    const height = Math.ceil(WORLD_SIZE / CELL_SIZE);
    const originX = -HALF_WORLD;
    const originZ = -HALF_WORLD;

    navState.grid = {
      cellSize: CELL_SIZE,
      width,
      height,
      originX,
      originZ
    };

    navState.baseGrid = new PF.Grid(width, height);
    navState.walkable = new Uint8Array(width * height);
    navState.walkable.fill(1);
    navState.occupancy = new Uint16Array(width * height);
    navState.occupancy.fill(0);
    navState.obstacles.clear();

    const unitRadii = Object.values(COLLISION_DATA.UNITS).map(u => u.radius);
    const maxUnitRadius = unitRadii.length ? Math.max(...unitRadii) : 0.5;
    navState.agentPadding = maxUnitRadius + 0.25;

    navState.finder = new PF.JumpPointFinder({
      diagonalMovement: PF.DiagonalMovement.IfAtMostOneObstacle,
      heuristic: PF.Heuristic.euclidean
    }) as Finder;

    rebuildStaticObstacles(buildings, resources);
    navState.ready = true;
  },

  addObstacle(building: Building) {
    if (!isGridReady()) return;
    registerBuildingObstacle(building);
  },

  removeObstacle(building: Building) {
    if (!isGridReady()) return;
    unmarkCells(`building:${building.id}`);
  },

  requestPath(unitId: string, startPos: Vector3, endPos: Vector3) {
    if (!navState.ready || pendingRequests.has(unitId)) return;
    pendingRequests.add(unitId);
    requestQueue.push({ unitId, start: { ...startPos, y: 0 }, goal: { ...endPos, y: 0 } });
  },

  isRequestPending(unitId: string) {
    return pendingRequests.has(unitId);
  },

  projectMove(from: Vector3, to: Vector3) {
    return projectMoveInternal(from, to);
  },

  snapToNav(point: Vector3) {
    return snapToNavInternal(point);
  },

  safeSnap(point: Vector3, maxSnapDistance: number) {
    return safeSnapInternal(point, maxSnapDistance);
  },

  advanceOnNav(from: Vector3, to: Vector3, maxStep: number) {
    return advanceOnNavInternal(from, to, maxStep);
  },

  processQueue() {
    if (!navState.ready) return;
    for (let i = 0; i < MAX_QUEUE_BATCH; i++) {
      if (!requestQueue.length) break;
      processNextRequest();
    }
  },

  terminate() {
    navState.dispatch = null;
    navState.ready = false;
    navState.grid = null;
    navState.baseGrid = null;
    navState.walkable = null;
    navState.occupancy = null;
    navState.obstacles.clear();
    navState.finder = null;
    requestQueue.length = 0;
    pendingRequests.clear();
  }
};
