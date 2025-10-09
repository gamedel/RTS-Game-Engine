import type { Dispatch } from 'react';
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

type NavState = {
  dispatch: Dispatch<Action> | null;
  ready: boolean;
  grid: NavigationGrid | null;
  walkable: Uint8Array | null;
  occupancy: Uint16Array | null;
  matrix: number[][] | null;
  obstacles: Map<string, number[]>;
  agentPadding: number;
  maxSearchRadius: number;
  diagnostics: {
    lastSearchMs: number;
    lastSearchExpanded: number;
    lastSearchResult: 'success' | 'partial' | 'failed' | null;
    lastFailureReason: string | null;
    queueDepth: number;
    pending: number;
  };
};

const WORLD_SIZE = 320;
const HALF_WORLD = WORLD_SIZE / 2;
const CELL_SIZE = 0.5;
const SAMPLE_STEP = CELL_SIZE * 0.5;
const MAX_QUEUE_BATCH = 24;
const EPSILON = 1e-4;

const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();

const navState: NavState = {
  dispatch: null,
  ready: false,
  grid: null,
  walkable: null,
  occupancy: null,
  matrix: null,
  obstacles: new Map(),
  agentPadding: 0,
  maxSearchRadius: 0,
  diagnostics: {
    lastSearchMs: 0,
    lastSearchExpanded: 0,
    lastSearchResult: null,
    lastFailureReason: null,
    queueDepth: 0,
    pending: 0
  }
};

const requestQueue: PathRequest[] = [];
const pendingRequests = new Set<string>();

const PATH_CACHE_CLUSTER = 3;
const PATH_CACHE_TTL = 2000;
const PATH_CACHE_MAX = 256;

type CachedPath = { cells: Cell[]; timestamp: number; reachedGoal: boolean };

const pathCache = new Map<string, CachedPath>();

const clusterKeyForCell = (cell: Cell) =>
  `${Math.floor(cell.cx / PATH_CACHE_CLUSTER)}|${Math.floor(cell.cz / PATH_CACHE_CLUSTER)}`;
const cacheKeyFor = (start: Cell, goal: Cell) => `${clusterKeyForCell(start)}->${encodeCell(goal)}`;

const invalidatePathCache = () => {
  pathCache.clear();
};

type HeapNode = {
  idx: number;
  cell: Cell;
  g: number;
  f: number;
};

class MinHeap {
  private data: HeapNode[] = [];

  get size() {
    return this.data.length;
  }

  push(node: HeapNode) {
    this.data.push(node);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): HeapNode | undefined {
    if (this.data.length === 0) return undefined;
    const root = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.bubbleDown(0);
    }
    return root;
  }

  private bubbleUp(index: number) {
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.data[parent].f <= this.data[index].f) break;
      [this.data[parent], this.data[index]] = [this.data[index], this.data[parent]];
      index = parent;
    }
  }

  private bubbleDown(index: number) {
    const length = this.data.length;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;

      if (left < length && this.data[left].f < this.data[smallest].f) {
        smallest = left;
      }
      if (right < length && this.data[right].f < this.data[smallest].f) {
        smallest = right;
      }

      if (smallest === index) break;
      [this.data[index], this.data[smallest]] = [this.data[smallest], this.data[index]];
      index = smallest;
    }
  }
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const clampToWorld = (p: Vector3): Vector3 => ({
  x: clamp(p.x, -HALF_WORLD + CELL_SIZE, HALF_WORLD - CELL_SIZE),
  y: 0,
  z: clamp(p.z, -HALF_WORLD + CELL_SIZE, HALF_WORLD - CELL_SIZE)
});

const encodeCell = (cell: Cell) => `${cell.cx}|${cell.cz}`;

type ReadyNavState = NavState & {
  grid: NavigationGrid;
  walkable: Uint8Array;
  occupancy: Uint16Array;
  matrix: number[][];
};

const isGridReady = (): navState is ReadyNavState => {
  return !!(navState.grid && navState.walkable && navState.occupancy && navState.matrix);
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
  navState.walkable[index] = blocked ? 0 : 1;
  navState.matrix[cell.cz][cell.cx] = blocked ? 1 : 0;
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

const rebuildStaticObstacles = (buildings: Record<string, Building>, _resources: Record<string, ResourceNode>) => {
  if (!isGridReady()) return;
  invalidatePathCache();
  navState.obstacles.clear();
  navState.occupancy.fill(0);
  navState.walkable.fill(1);
  for (let cz = 0; cz < navState.grid.height; cz++) {
    for (let cx = 0; cx < navState.grid.width; cx++) {
      navState.matrix[cz][cx] = 0;
    }
  }

  Object.values(buildings).forEach(registerBuildingObstacle);
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

const getMaxSearchRadius = () => {
  if (!navState.grid) return 0;
  return navState.maxSearchRadius || Math.ceil(Math.hypot(navState.grid.width, navState.grid.height));
};

const findNearestWalkableCell = (start: Cell | null, maxDistance = getMaxSearchRadius()): Cell | null => {
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

type PathSolution = {
  cells: Cell[];
  reachedGoal: boolean;
  expanded: number;
  elapsedMs: number;
  failureReason?: string;
};

const pruneCache = () => {
  if (pathCache.size <= PATH_CACHE_MAX) return;
  const entries = [...pathCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
  const toRemove = entries.length - PATH_CACHE_MAX;
  for (let i = 0; i < toRemove; i++) {
    pathCache.delete(entries[i][0]);
  }
};

const storePathInCache = (start: Cell, goal: Cell, solution: PathSolution) => {
  if (!solution.cells.length) return;
  const key = cacheKeyFor(start, goal);
  pathCache.set(key, { cells: solution.cells, timestamp: now(), reachedGoal: solution.reachedGoal });
  pruneCache();
};

const reuseCachedPath = (start: Cell, goal: Cell): PathSolution | null => {
  const key = cacheKeyFor(start, goal);
  const cached = pathCache.get(key);
  if (!cached) return null;
  if (now() - cached.timestamp > PATH_CACHE_TTL) {
    pathCache.delete(key);
    return null;
  }

  for (let i = 0; i < cached.cells.length; i++) {
    const candidate = cached.cells[i];
    if (!isCellInside(candidate)) continue;
    if (!isCellWalkable(candidate)) continue;
    if (!lineIsClear(start, candidate)) continue;

    const remainder = cached.cells.slice(i);
    let cells: Cell[];
    if (remainder.length && remainder[0].cx === start.cx && remainder[0].cz === start.cz) {
      cells = remainder;
    } else {
      cells = [start, ...remainder];
    }
    cached.timestamp = now();
    return { cells, reachedGoal: cached.reachedGoal, expanded: 0, elapsedMs: 0 };
  }

  return null;
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

const heuristic = (a: Cell, b: Cell) => {
  const dx = Math.abs(a.cx - b.cx);
  const dz = Math.abs(a.cz - b.cz);
  const min = Math.min(dx, dz);
  const max = Math.max(dx, dz);
  return min * Math.SQRT2 + (max - min);
};

const reconstructPath = (parents: Map<number, number>, startIdx: number, endIdx: number): Cell[] | null => {
  if (!navState.grid) return null;
  const path: Cell[] = [];
  let current = endIdx;
  const guard = new Set<number>();
  while (true) {
    const cell = cellFromIndex(current);
    if (!cell) return null;
    path.push(cell);
    if (current === startIdx) break;
    const parent = parents.get(current);
    if (parent === undefined) return null;
    if (guard.has(parent)) return null;
    guard.add(parent);
    current = parent;
  }
  path.reverse();
  return path;
};

const solvePath = (start: Cell, goal: Cell): PathSolution => {
  if (!isGridReady()) {
    return { cells: [], reachedGoal: false, expanded: 0, elapsedMs: 0, failureReason: 'nav-grid-not-ready' };
  }

  const startIdx = indexForCell(start);
  const goalIdx = indexForCell(goal);
  if (startIdx < 0 || goalIdx < 0) {
    return { cells: [], reachedGoal: false, expanded: 0, elapsedMs: 0, failureReason: 'invalid-indices' };
  }

  const open = new MinHeap();
  const gScores = new Map<number, number>();
  const parents = new Map<number, number>();
  const closed = new Set<number>();

  const startTime = now();

  open.push({ idx: startIdx, cell: start, g: 0, f: heuristic(start, goal) });
  gScores.set(startIdx, 0);
  parents.set(startIdx, startIdx);

  let bestIdx = startIdx;
  let bestHeuristic = heuristic(start, goal);
  let expanded = 0;

  while (open.size > 0) {
    const current = open.pop()!;
    if (closed.has(current.idx)) continue;
    closed.add(current.idx);
    expanded++;

    const currentHeuristic = heuristic(current.cell, goal);
    if (currentHeuristic < bestHeuristic) {
      bestHeuristic = currentHeuristic;
      bestIdx = current.idx;
    }

    if (current.idx === goalIdx) {
      const path = reconstructPath(parents, startIdx, current.idx) ?? [];
      return { cells: path, reachedGoal: true, expanded, elapsedMs: now() - startTime };
    }

    for (const neighbor of getNeighbors(current.cell)) {
      const neighborIdx = indexForCell(neighbor);
      if (neighborIdx < 0) continue;
      if (closed.has(neighborIdx)) continue;
      if (!isCellWalkable(neighbor)) continue;

      const dx = neighbor.cx - current.cell.cx;
      const dz = neighbor.cz - current.cell.cz;
      const diagonal = dx !== 0 && dz !== 0;
      if (diagonal) {
        const gateA = { cx: current.cell.cx + dx, cz: current.cell.cz };
        const gateB = { cx: current.cell.cx, cz: current.cell.cz + dz };
        if (!isCellWalkable(gateA) || !isCellWalkable(gateB)) {
          continue;
        }
      }

      const stepCost = diagonal ? Math.SQRT2 : 1;
      const tentativeG = current.g + stepCost;

      const existing = gScores.get(neighborIdx);
      if (existing !== undefined && tentativeG >= existing - EPSILON) {
        continue;
      }

      gScores.set(neighborIdx, tentativeG);
      parents.set(neighborIdx, current.idx);
      const fScore = tentativeG + heuristic(neighbor, goal);
      open.push({ idx: neighborIdx, cell: neighbor, g: tentativeG, f: fScore });
    }
  }

  const fallback = reconstructPath(parents, startIdx, bestIdx) ?? [];
  const elapsedMs = now() - startTime;
  if (fallback.length > 1) {
    return { cells: fallback, reachedGoal: false, expanded, elapsedMs };
  }

  return {
    cells: [],
    reachedGoal: false,
    expanded,
    elapsedMs,
    failureReason: 'no-path-found'
  };
};

const updateDiagnostics = (updates: Partial<NavState['diagnostics']>) => {
  navState.diagnostics = { ...navState.diagnostics, ...updates };
};

const handlePathFailure = (unitId: string, reason: string) => {
  pendingRequests.delete(unitId);
  updateDiagnostics({
    lastSearchResult: 'failed',
    lastFailureReason: reason,
    pending: pendingRequests.size,
    queueDepth: requestQueue.length
  });
  if (typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
    console.warn(`[NavMesh] Path request for ${unitId} failed: ${reason}`);
  }
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

const applySolution = (
  unitId: string,
  goal: Vector3,
  startCell: Cell,
  solution: PathSolution
) => {
  pendingRequests.delete(unitId);
  updateDiagnostics({
    lastSearchMs: solution.elapsedMs,
    lastSearchExpanded: solution.expanded,
    lastSearchResult: solution.reachedGoal ? 'success' : solution.cells.length > 0 ? 'partial' : 'failed',
    lastFailureReason: solution.failureReason ?? null,
    pending: pendingRequests.size,
    queueDepth: requestQueue.length
  });

  if (!navState.dispatch || !isGridReady()) return;

  if (!solution.cells.length) {
    handlePathFailure(unitId, solution.failureReason ?? 'no-path');
    return;
  }

  const simplified = simplifyCells(solution.cells);
  const trimmed = simplified.filter((cell, index) => !(index === 0 && cell.cx === startCell.cx && cell.cz === startCell.cz));
  const waypoints = trimmed.map(cell => clampToWorld(cellToWorld(cell)));

  if (!waypoints.length && isWorldWalkable(goal)) {
    waypoints.push(clampToWorld(goal));
  }

  if (!waypoints.length) {
    handlePathFailure(unitId, 'empty-waypoints');
    return;
  }

  const last = waypoints[waypoints.length - 1];
  const dx = goal.x - last.x;
  const dz = goal.z - last.z;
  const distSq = dx * dx + dz * dz;

  if (solution.reachedGoal) {
    if (distSq > 1e-3) {
      waypoints.push(clampToWorld(goal));
    }
  } else if (distSq > 1e-3 && isWorldWalkable(goal)) {
    waypoints.push(clampToWorld(goal));
  }

  navState.dispatch({ type: 'UPDATE_UNIT', payload: { id: unitId, path: waypoints, pathIndex: 0, pathTarget: clampToWorld(goal) } });
};

const processNextRequest = () => {
  if (!isGridReady()) return;
  const req = requestQueue.shift();
  if (!req) return;

  const unitId = req.unitId;
  const clampedStart = clampToWorld(req.start);
  const clampedGoal = clampToWorld(req.goal);

  const startCell = findNearestWalkableCell(worldToCell(clampedStart.x, clampedStart.z));
  const goalCell = findNearestWalkableCell(worldToCell(clampedGoal.x, clampedGoal.z));

  if (!startCell || !goalCell) {
    handlePathFailure(unitId, 'missing-start-or-goal');
    return;
  }

  if (startCell.cx === goalCell.cx && startCell.cz === goalCell.cz) {
    if (isWorldWalkable(clampedGoal)) {
      if (navState.dispatch) {
        pendingRequests.delete(unitId);
        updateDiagnostics({
          lastSearchMs: 0,
          lastSearchExpanded: 0,
          lastSearchResult: 'success',
          lastFailureReason: null,
          pending: pendingRequests.size,
          queueDepth: requestQueue.length
        });
        navState.dispatch({ type: 'UPDATE_UNIT', payload: { id: unitId, path: [clampedGoal], pathIndex: 0, pathTarget: clampedGoal } });
      }
    } else {
      handlePathFailure(unitId, 'goal-not-walkable');
    }
    return;
  }

  const cached = reuseCachedPath(startCell, goalCell);
  if (cached) {
    applySolution(unitId, clampedGoal, startCell, cached);
    return;
  }

  const solution = solvePath(startCell, goalCell);
  storePathInCache(startCell, goalCell, solution);
  applySolution(unitId, clampedGoal, startCell, solution);
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
    navState.walkable = null;
    navState.occupancy = null;
    navState.matrix = null;
    navState.obstacles.clear();
    requestQueue.length = 0;
    pendingRequests.clear();
    navState.maxSearchRadius = 0;
    invalidatePathCache();
    updateDiagnostics({
      lastSearchMs: 0,
      lastSearchExpanded: 0,
      lastSearchResult: null,
      lastFailureReason: null,
      queueDepth: 0,
      pending: 0
    });
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

    navState.walkable = new Uint8Array(width * height);
    navState.walkable.fill(1);
    navState.occupancy = new Uint16Array(width * height);
    navState.occupancy.fill(0);
    navState.matrix = Array.from({ length: height }, () => new Array(width).fill(0));
    navState.obstacles.clear();
    navState.maxSearchRadius = Math.ceil(Math.hypot(width, height));

    const unitRadii = Object.values(COLLISION_DATA.UNITS).map(u => u.radius);
    const maxUnitRadius = unitRadii.length ? Math.max(...unitRadii) : 0.5;
    navState.agentPadding = maxUnitRadius + 0.25;

    rebuildStaticObstacles(buildings, resources);
    navState.ready = true;
  },

  addObstacle(building: Building) {
    if (!isGridReady()) return;
    invalidatePathCache();
    registerBuildingObstacle(building);
  },

  removeObstacle(building: Building) {
    if (!isGridReady()) return;
    invalidatePathCache();
    unmarkCells(`building:${building.id}`);
  },

  requestPath(unitId: string, startPos: Vector3, endPos: Vector3) {
    if (!navState.ready || pendingRequests.has(unitId)) return;
    pendingRequests.add(unitId);
    requestQueue.push({ unitId, start: { ...startPos, y: 0 }, goal: { ...endPos, y: 0 } });
    updateDiagnostics({ queueDepth: requestQueue.length, pending: pendingRequests.size });
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
    updateDiagnostics({ queueDepth: requestQueue.length, pending: pendingRequests.size });
    for (let i = 0; i < MAX_QUEUE_BATCH; i++) {
      if (!requestQueue.length) break;
      processNextRequest();
    }
  },

  terminate() {
    navState.dispatch = null;
    navState.ready = false;
    navState.grid = null;
    navState.walkable = null;
    navState.occupancy = null;
    navState.matrix = null;
    navState.obstacles.clear();
    requestQueue.length = 0;
    pendingRequests.clear();
    invalidatePathCache();
    updateDiagnostics({
      lastSearchMs: 0,
      lastSearchExpanded: 0,
      lastSearchResult: null,
      lastFailureReason: null,
      queueDepth: 0,
      pending: 0
    });
  },

  getDiagnostics() {
    return { ...navState.diagnostics };
  }
};
