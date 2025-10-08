import type { Dispatch } from 'react';
import { Building, ResourceNode, Vector3, Action, UnitStatus } from '../../types';
import { COLLISION_DATA } from '../../constants';

const WORLD_SIZE = 320;
const HALF_WORLD = WORLD_SIZE / 2;
const CELL_SIZE = 0.6; // finer granularity than the previous grid
const MAX_QUEUE_BATCH = 16;
const MAX_SEARCH_RADIUS = 64; // cells
const MAX_PATH_EXPANSIONS = 16000;

const EPSILON = 1e-4;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const clampToWorld = (p: Vector3): Vector3 => ({
  x: clamp(p.x, -HALF_WORLD + 0.25, HALF_WORLD - 0.25),
  y: 0,
  z: clamp(p.z, -HALF_WORLD + 0.25, HALF_WORLD - 0.25)
});

type PathRequest = { unitId: string; start: Vector3; goal: Vector3 };

type Cell = { cx: number; cz: number };

type NavigationGrid = {
  cellSize: number;
  width: number;
  height: number;
  originX: number;
  originZ: number;
  walkable: Uint8Array;
};

type NavState = {
  dispatch: Dispatch<Action> | null;
  ready: boolean;
  grid: NavigationGrid | null;
  occupancy: Uint16Array | null;
  obstacles: Map<string, number[]>;
  agentPadding: number;
};

const navState: NavState = {
  dispatch: null,
  ready: false,
  grid: null,
  occupancy: null,
  obstacles: new Map(),
  agentPadding: 0
};

const requestQueue: PathRequest[] = [];
const pendingRequests = new Set<string>();

const encodeCell = (cell: Cell) => `${cell.cx}|${cell.cz}`;

const equalVec = (a: Vector3, b: Vector3, eps = EPSILON) => {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz <= eps * eps;
};

const createGrid = (agentPadding: number): NavigationGrid => {
  const width = Math.ceil(WORLD_SIZE / CELL_SIZE);
  const height = Math.ceil(WORLD_SIZE / CELL_SIZE);
  const originX = -HALF_WORLD;
  const originZ = -HALF_WORLD;
  const walkable = new Uint8Array(width * height);
  walkable.fill(1);

  navState.occupancy = new Uint16Array(width * height);
  navState.occupancy.fill(0);
  navState.obstacles.clear();

  navState.agentPadding = agentPadding;

  return {
    cellSize: CELL_SIZE,
    width,
    height,
    originX,
    originZ,
    walkable
  };
};

const worldToCell = (x: number, z: number): Cell | null => {
  const grid = navState.grid;
  if (!grid) return null;
  const cx = Math.floor((x - grid.originX) / grid.cellSize);
  const cz = Math.floor((z - grid.originZ) / grid.cellSize);
  if (cx < 0 || cz < 0 || cx >= grid.width || cz >= grid.height) return null;
  return { cx, cz };
};

const cellToWorld = ({ cx, cz }: Cell): Vector3 => {
  const grid = navState.grid;
  if (!grid) return { x: 0, y: 0, z: 0 };
  const x = grid.originX + (cx + 0.5) * grid.cellSize;
  const z = grid.originZ + (cz + 0.5) * grid.cellSize;
  return { x, y: 0, z };
};

const indexForCell = ({ cx, cz }: Cell) => {
  const grid = navState.grid;
  if (!grid) return -1;
  return cz * grid.width + cx;
};

const isCellInside = (cell: Cell) => {
  const grid = navState.grid;
  if (!grid) return false;
  return cell.cx >= 0 && cell.cz >= 0 && cell.cx < grid.width && cell.cz < grid.height;
};

const isCellWalkable = (cell: Cell | null) => {
  const grid = navState.grid;
  const occupancy = navState.occupancy;
  if (!grid || !occupancy || !cell) return false;
  if (!isCellInside(cell)) return false;
  const idx = indexForCell(cell);
  return idx >= 0 ? occupancy[idx] === 0 : false;
};

const setOccupancy = (index: number, delta: number) => {
  const grid = navState.grid;
  const occupancy = navState.occupancy;
  if (!grid || !occupancy || index < 0 || index >= occupancy.length) return;
  const next = Math.max(0, occupancy[index] + delta);
  occupancy[index] = next;
  grid.walkable[index] = next === 0 ? 1 : 0;
};

const markCells = (id: string, cells: number[]) => {
  navState.obstacles.set(id, cells);
  cells.forEach(idx => setOccupancy(idx, +1));
};

const unmarkCells = (id: string) => {
  const cells = navState.obstacles.get(id);
  if (!cells) return;
  cells.forEach(idx => setOccupancy(idx, -1));
  navState.obstacles.delete(id);
};

const eachCellInRect = (minX: number, maxX: number, minZ: number, maxZ: number): number[] => {
  const grid = navState.grid;
  if (!grid) return [];

  const minCx = Math.floor((minX - grid.originX) / grid.cellSize);
  const maxCx = Math.floor((maxX - grid.originX) / grid.cellSize);
  const minCz = Math.floor((minZ - grid.originZ) / grid.cellSize);
  const maxCz = Math.floor((maxZ - grid.originZ) / grid.cellSize);

  const cells: number[] = [];
  for (let cz = minCz; cz <= maxCz; cz++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      if (cx < 0 || cz < 0 || cx >= grid.width || cz >= grid.height) continue;
      cells.push(cz * grid.width + cx);
    }
  }
  return cells;
};

const eachCellInCircle = (centerX: number, centerZ: number, radius: number): number[] => {
  const grid = navState.grid;
  if (!grid) return [];

  const minCx = Math.floor(((centerX - radius) - grid.originX) / grid.cellSize);
  const maxCx = Math.floor(((centerX + radius) - grid.originX) / grid.cellSize);
  const minCz = Math.floor(((centerZ - radius) - grid.originZ) / grid.cellSize);
  const maxCz = Math.floor(((centerZ + radius) - grid.originZ) / grid.cellSize);
  const radiusSq = radius * radius;

  const cells: number[] = [];
  for (let cz = minCz; cz <= maxCz; cz++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      if (cx < 0 || cz < 0 || cx >= grid.width || cz >= grid.height) continue;
      const world = cellToWorld({ cx, cz });
      const dx = world.x - centerX;
      const dz = world.z - centerZ;
      if (dx * dx + dz * dz <= radiusSq) {
        cells.push(cz * grid.width + cx);
      }
    }
  }
  return cells;
};

const registerBuildingObstacle = (building: Building) => {
  const size = COLLISION_DATA.BUILDINGS[building.buildingType];
  if (!size) return;
  const pad = navState.agentPadding + 0.35;
  const halfW = size.width / 2 + pad;
  const halfD = size.depth / 2 + pad;
  const minX = building.position.x - halfW;
  const maxX = building.position.x + halfW;
  const minZ = building.position.z - halfD;
  const maxZ = building.position.z + halfD;
  const id = `building:${building.id}`;
  unmarkCells(id);
  markCells(id, eachCellInRect(minX, maxX, minZ, maxZ));
};

const registerResourceObstacle = (resource: ResourceNode) => {
  const info = COLLISION_DATA.RESOURCES[resource.resourceType];
  if (!info) return;
  const pad = navState.agentPadding + 0.25;
  const radius = info.radius + pad;
  const id = `resource:${resource.id}`;
  unmarkCells(id);
  markCells(id, eachCellInCircle(resource.position.x, resource.position.z, radius));
};

const rebuildStaticObstacles = (buildings: Record<string, Building>, resources: Record<string, ResourceNode>) => {
  const grid = navState.grid;
  const occupancy = navState.occupancy;
  if (!grid || !occupancy) return;

  occupancy.fill(0);
  grid.walkable.fill(1);
  navState.obstacles.clear();

  Object.values(buildings).forEach(building => {
    if (building.constructionProgress !== undefined) return;
    registerBuildingObstacle(building);
  });

  Object.values(resources).forEach(registerResourceObstacle);
};

const neighborOffsets: Array<{ cx: number; cz: number; cost: number }> = [
  { cx: 1, cz: 0, cost: 1 },
  { cx: -1, cz: 0, cost: 1 },
  { cx: 0, cz: 1, cost: 1 },
  { cx: 0, cz: -1, cost: 1 },
  { cx: 1, cz: 1, cost: Math.SQRT2 },
  { cx: 1, cz: -1, cost: Math.SQRT2 },
  { cx: -1, cz: 1, cost: Math.SQRT2 },
  { cx: -1, cz: -1, cost: Math.SQRT2 }
];

const heuristic = (a: Cell, b: Cell) => {
  const dx = Math.abs(a.cx - b.cx);
  const dz = Math.abs(a.cz - b.cz);
  return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * CELL_SIZE;
};

const hasLineOfSight = (from: Cell, to: Cell) => {
  if (!navState.grid) return false;
  let x0 = from.cx;
  let z0 = from.cz;
  const x1 = to.cx;
  const z1 = to.cz;
  const dx = Math.abs(x1 - x0);
  const dz = Math.abs(z1 - z0);
  const sx = x0 < x1 ? 1 : -1;
  const sz = z0 < z1 ? 1 : -1;
  let err = dx - dz;

  while (true) {
    if (!isCellWalkable({ cx: x0, cz: z0 })) return false;
    if (x0 === x1 && z0 === z1) break;
    const e2 = err * 2;
    if (e2 > -dz) {
      err -= dz;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      z0 += sz;
    }
  }
  return true;
};

class MinHeap {
  private data: Array<{ key: string; cell: Cell; g: number; f: number; parent?: string }> = [];

  push(node: { key: string; cell: Cell; g: number; f: number; parent?: string }) {
    this.data.push(node);
    this.bubbleUp(this.data.length - 1);
  }

  pop() {
    if (this.data.length === 0) return undefined;
    const root = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.bubbleDown(0);
    }
    return root;
  }

  get size() {
    return this.data.length;
  }

  private bubbleUp(index: number) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.data[index].f >= this.data[parent].f) break;
      [this.data[index], this.data[parent]] = [this.data[parent], this.data[index]];
      index = parent;
    }
  }

  private bubbleDown(index: number) {
    const length = this.data.length;
    while (true) {
      let left = index * 2 + 1;
      let right = left + 1;
      let smallest = index;
      if (left < length && this.data[left].f < this.data[smallest].f) smallest = left;
      if (right < length && this.data[right].f < this.data[smallest].f) smallest = right;
      if (smallest === index) break;
      [this.data[index], this.data[smallest]] = [this.data[smallest], this.data[index]];
      index = smallest;
    }
  }
}

const reconstructPath = (records: Map<string, { key: string; cell: Cell; parent?: string }>, endKey: string) => {
  const path: Cell[] = [];
  let current: string | undefined = endKey;
  while (current) {
    const node = records.get(current);
    if (!node) break;
    path.push(node.cell);
    current = node.parent;
  }
  return path.reverse();
};

const findNearestWalkableCell = (origin: Cell | null, maxRadius: number): Cell | null => {
  if (!origin) return null;
  if (isCellWalkable(origin)) return origin;

  const visited = new Set<string>();
  const queue: Array<{ cell: Cell; dist: number }> = [{ cell: origin, dist: 0 }];
  visited.add(encodeCell(origin));

  let qi = 0;
  while (qi < queue.length) {
    const { cell, dist } = queue[qi++];
    if (dist > maxRadius) continue;

    for (const offset of neighborOffsets) {
      const next: Cell = { cx: cell.cx + offset.cx, cz: cell.cz + offset.cz };
      if (!isCellInside(next)) continue;
      const key = encodeCell(next);
      if (visited.has(key)) continue;
      visited.add(key);
      const nd = dist + 1;
      if (nd > maxRadius) continue;
      if (isCellWalkable(next)) {
        return next;
      }
      queue.push({ cell: next, dist: nd });
    }
  }
  return null;
};

const smoothCells = (cells: Cell[]): Cell[] => {
  if (cells.length <= 2) return cells;
  const smooth: Cell[] = [cells[0]];
  let anchor = cells[0];
  for (let i = 1; i < cells.length - 1; i++) {
    const candidate = cells[i + 1];
    if (!hasLineOfSight(anchor, candidate)) {
      smooth.push(cells[i]);
      anchor = cells[i];
    }
  }
  smooth.push(cells[cells.length - 1]);
  return smooth;
};

const runAStar = (start: Cell, goal: Cell): Cell[] => {
  const open = new MinHeap();
  const records = new Map<string, { key: string; cell: Cell; g: number; f: number; parent?: string }>();
  const gScore = new Map<string, number>();
  const closed = new Set<string>();

  const startKey = encodeCell(start);
  open.push({ key: startKey, cell: start, g: 0, f: heuristic(start, goal) });
  records.set(startKey, { key: startKey, cell: start });
  gScore.set(startKey, 0);

  let expansions = 0;

  while (open.size && expansions < MAX_PATH_EXPANSIONS) {
    const current = open.pop()!;
    const currentKey = current.key;

    if (currentKey === encodeCell(goal)) {
      return smoothCells(reconstructPath(records, currentKey));
    }

    if (closed.has(currentKey)) continue;
    closed.add(currentKey);
    expansions++;

    for (const offset of neighborOffsets) {
      const neighbor: Cell = { cx: current.cell.cx + offset.cx, cz: current.cell.cz + offset.cz };
      if (!isCellWalkable(neighbor)) continue;

      const neighborKey = encodeCell(neighbor);
      if (closed.has(neighborKey)) continue;

      const stepCost = offset.cost * CELL_SIZE;
      const tentativeG = current.g + stepCost;
      const prevBest = gScore.get(neighborKey);
      if (prevBest !== undefined && tentativeG >= prevBest) continue;

      const parentKey = current.parent && hasLineOfSight(records.get(current.parent)!.cell, neighbor)
        ? current.parent
        : currentKey;

      const f = tentativeG + heuristic(neighbor, goal);
      gScore.set(neighborKey, tentativeG);
      records.set(neighborKey, { key: neighborKey, cell: neighbor, parent: parentKey });
      open.push({ key: neighborKey, cell: neighbor, g: tentativeG, f, parent: parentKey });
    }
  }
  return [];
};

const computePath = (start: Vector3, goal: Vector3): Vector3[] => {
  const grid = navState.grid;
  if (!grid) return [];

  const startCell = findNearestWalkableCell(worldToCell(start.x, start.z), MAX_SEARCH_RADIUS);
  const goalCell = findNearestWalkableCell(worldToCell(goal.x, goal.z), MAX_SEARCH_RADIUS);

  if (!startCell || !goalCell) return [];

  if (encodeCell(startCell) === encodeCell(goalCell)) {
    const snappedGoal = cellToWorld(goalCell);
    return equalVec(snappedGoal, start) ? [] : [snappedGoal];
  }

  const cells = runAStar(startCell, goalCell);
  if (!cells.length) return [];

  const worldPoints = cells.map(cellToWorld);

  const filtered: Vector3[] = [];
  for (const point of worldPoints) {
    const last = filtered[filtered.length - 1];
    if (!last || !equalVec(last, point)) {
      filtered.push(point);
    }
  }

  const goalClamped = clampToWorld(goal);
  const lastPoint = filtered[filtered.length - 1];
  if (!lastPoint) {
    filtered.push(goalClamped);
  } else if (!equalVec(lastPoint, goalClamped)) {
    if (hasLineOfSight(cells[cells.length - 1], goalCell)) {
      filtered[filtered.length - 1] = goalClamped;
    } else {
      filtered.push(goalClamped);
    }
  }

  if (filtered.length && equalVec(filtered[0], start)) {
    filtered.shift();
  }

  return filtered.map(p => ({ x: p.x, y: 0, z: p.z }));
};

const binarySearchStep = (from: Vector3, to: Vector3): Vector3 => {
  const steps = 6;
  let lo = 0;
  let hi = 1;
  let best = 0;
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) * 0.5;
    const candidate = {
      x: from.x + (to.x - from.x) * mid,
      y: 0,
      z: from.z + (to.z - from.z) * mid
    };
    if (isCellWalkable(worldToCell(candidate.x, candidate.z))) {
      best = mid;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return {
    x: from.x + (to.x - from.x) * best,
    y: 0,
    z: from.z + (to.z - from.z) * best
  };
};

const trySideStep = (from: Vector3, dirX: number, dirZ: number, maxStep: number): Vector3 => {
  const magnitude = Math.sqrt(dirX * dirX + dirZ * dirZ);
  if (magnitude < EPSILON) return from;
  const normX = dirX / magnitude;
  const normZ = dirZ / magnitude;
  const desired = {
    x: from.x + normX * maxStep,
    y: 0,
    z: from.z + normZ * maxStep
  };
  if (isCellWalkable(worldToCell(desired.x, desired.z))) {
    return clampToWorld(desired);
  }
  return clampToWorld(binarySearchStep(from, desired));
};

const projectMoveInternal = (from: Vector3, to: Vector3): Vector3 => {
  const clampedTarget = clampToWorld(to);
  if (isCellWalkable(worldToCell(clampedTarget.x, clampedTarget.z))) {
    return clampedTarget;
  }
  const projected = binarySearchStep(from, clampedTarget);
  if (!equalVec(projected, from)) return clampToWorld(projected);

  // try to slide along perpendicular directions (left/right relative to travel direction)
  const dx = clampedTarget.x - from.x;
  const dz = clampedTarget.z - from.z;
  const left = trySideStep(from, -dz, dx, Math.hypot(dx, dz));
  if (!equalVec(left, from)) return left;
  const right = trySideStep(from, dz, -dx, Math.hypot(dx, dz));
  if (!equalVec(right, from)) return right;

  return clampToWorld(from);
};

const advanceOnNavInternal = (from: Vector3, to: Vector3, maxStep: number): Vector3 => {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < EPSILON) return clampToWorld(from);

  const step = Math.min(dist, Math.max(maxStep, 0.001));
  const desired = {
    x: from.x + (dx / dist) * step,
    y: 0,
    z: from.z + (dz / dist) * step
  };

  const projected = projectMove(from, desired);
  if (!equalVec(projected, from)) return projected;

  // Try slight detours forward-left / forward-right
  const angle = Math.PI / 8;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const forwardX = dx / dist;
  const forwardZ = dz / dist;

  const leftX = forwardX * cos - forwardZ * sin;
  const leftZ = forwardX * sin + forwardZ * cos;
  const leftStep = trySideStep(from, leftX, leftZ, step * 0.9);
  if (!equalVec(leftStep, from)) return leftStep;

  const rightX = forwardX * cos + forwardZ * sin;
  const rightZ = -forwardX * sin + forwardZ * cos;
  const rightStep = trySideStep(from, rightX, rightZ, step * 0.9);
  if (!equalVec(rightStep, from)) return rightStep;

  return clampToWorld(from);
};

const safeSnapInternal = (target: Vector3, maxSnapDistance: number): Vector3 => {
  const grid = navState.grid;
  if (!grid) return clampToWorld(target);

  const maxCells = Math.ceil(maxSnapDistance / grid.cellSize);
  const nearest = findNearestWalkableCell(worldToCell(target.x, target.z), maxCells);
  return nearest ? clampToWorld(cellToWorld(nearest)) : clampToWorld(target);
};

const snapToNavInternal = (point: Vector3): Vector3 => {
  const nearest = findNearestWalkableCell(worldToCell(point.x, point.z), MAX_SEARCH_RADIUS);
  return nearest ? clampToWorld(cellToWorld(nearest)) : clampToWorld(point);
};

const handlePathFailure = (unitId: string) => {
  if (!navState.dispatch) return;
  navState.dispatch({
    type: 'UPDATE_UNIT',
    payload: { id: unitId, pathTarget: undefined, status: UnitStatus.IDLE, path: undefined, pathIndex: undefined }
  });
};

const processNextRequest = () => {
  const req = requestQueue.shift();
  if (!req) return;

  const { unitId, start, goal } = req;
  try {
    const clampedStart = clampToWorld(start);
    const clampedGoal = clampToWorld(goal);
    const path = computePath(clampedStart, clampedGoal);

    if (!navState.dispatch) return;

    if (!path.length) {
      if (isCellWalkable(worldToCell(clampedGoal.x, clampedGoal.z))) {
        navState.dispatch({ type: 'UPDATE_UNIT', payload: { id: unitId, path: [clampedGoal], pathIndex: 0 } });
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

export const NavMeshManager = {
  async init(dispatch: Dispatch<Action>) {
    navState.dispatch = dispatch;
    navState.ready = false;
  },

  isReady() {
    return navState.ready;
  },

  async buildNavMesh(buildings: Record<string, Building>, resources: Record<string, ResourceNode>) {
    const maxUnitRadius = Math.max(...Object.values(COLLISION_DATA.UNITS).map(u => u.radius));
    navState.grid = createGrid(maxUnitRadius + 0.3);
    rebuildStaticObstacles(buildings, resources);
    navState.ready = true;
  },

  addObstacle(building: Building) {
    if (!navState.grid || building.constructionProgress !== undefined) return;
    registerBuildingObstacle(building);
  },

  removeObstacle(building: Building) {
    if (!navState.grid) return;
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
    navState.occupancy = null;
    navState.obstacles.clear();
    requestQueue.length = 0;
    pendingRequests.clear();
  }
};
