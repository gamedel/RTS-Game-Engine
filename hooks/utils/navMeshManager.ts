import type { Dispatch } from 'react';
import { Building, ResourceNode, Vector3, Action, UnitStatus, BuildingType } from '../../types';
import { COLLISION_DATA, getBuildingCollisionMask } from '../../constants';
import PathFinding = require('@screeps/pathfinding');

type PathRequest = {
  unitId: string;
  start: Vector3;
  goal: Vector3;
  startCell: Cell | null;
  goalCell: Cell | null;
  key: string | null;
  requiredClearance: number;
};

type PathFollower = {
  unitId: string;
  start: Vector3;
  goal: Vector3;
  startCell: Cell | null;
  goalCell: Cell | null;
  requiredClearance: number;
};

type Cell = { cx: number; cz: number };

export type LocalAdjustmentOptions = {
  agentRadius?: number;
  maxOffset?: number;
  angularSteps?: number;
  radialIterations?: number;
};

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
  clearance: Float32Array | null;
  clearanceDirty: boolean;
  obstacles: Map<string, number[]>;
  agentPadding: number;
  maxSearchRadius: number;
  requiredClearance: number;
  minAgentClearance: number;
  diagnostics: {
    lastSearchMs: number;
    lastSearchExpanded: number;
    lastSearchResult: 'success' | 'partial' | 'failed' | null;
    lastFailureReason: string | null;
    queueDepth: number;
    pending: number;
  };
  directionFields: Map<string, DirectionField>;
  directionFieldOrder: string[];
  flowQueueCx: Int32Array | null;
  flowQueueCz: Int32Array | null;
  flowCostScratch: Uint32Array | null;
  flowBuildQueue: FlowBuildRequest[];
  flowBuildPending: Set<string>;
  flowBuildState: FlowBuildState | null;
  pathGrid: any | null;
  pathFinder: any | null;
  worker: Worker | null;
  workerReady: boolean;
  workerBusy: boolean;
  workerCounter: number;
  workerPending: Map<number, WorkerRequestEntry>;
  workerFailed: boolean;
};

const WORLD_SIZE = 320;
const HALF_WORLD = WORLD_SIZE / 2;
const CELL_SIZE = 1;
const SAMPLE_STEP = CELL_SIZE * 0.35;
const MAX_QUEUE_BATCH = 24;
const MAX_QUEUE_TIME_MS = 2.5;
const EPSILON = 1e-4;
const CACHE_BRIDGE_RADIUS_CELLS = 20;
const BUILDING_EXTRA_PADDING = 0.06;
const CLEARANCE_MARGIN = 0.12;
const MIN_CLEARANCE_THRESHOLD = 0.18;
const BUILDING_AGENT_PADDING_CAP = 0.3;
const FLOW_FIELD_TTL = 4500;
const FLOW_FIELD_CACHE_MAX = 64;
const REPULSION_MARGIN = 0.85;
const REPULSION_STRENGTH = 1.25;
const REPULSION_MIN_THRESHOLD = 0.1;
const STRAIGHT_COST = 10;
const DIAGONAL_COST = 14;

const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();

const navState: NavState = {
  dispatch: null,
  ready: false,
  grid: null,
  walkable: null,
  occupancy: null,
  matrix: null,
  clearance: null,
  clearanceDirty: false,
  obstacles: new Map(),
  agentPadding: 0,
  maxSearchRadius: 0,
  requiredClearance: 0,
  minAgentClearance: 0,
  diagnostics: {
    lastSearchMs: 0,
    lastSearchExpanded: 0,
    lastSearchResult: null,
    lastFailureReason: null,
    queueDepth: 0,
    pending: 0
  },
  directionFields: new Map(),
  directionFieldOrder: [],
  flowQueueCx: null,
  flowQueueCz: null,
  flowCostScratch: null,
  flowBuildQueue: [],
  flowBuildPending: new Set<string>(),
  flowBuildState: null,
  pathGrid: null,
  pathFinder: null,
  worker: null,
  workerReady: false,
  workerBusy: false,
  workerCounter: 0,
  workerPending: new Map<number, WorkerRequestEntry>(),
  workerFailed: false
};

const requestQueue: PathRequest[] = [];
const pendingRequests = new Map<string, string | null>();
const queuedRequestsByKey = new Map<string, PathRequest>();
const followersByKey = new Map<string, PathFollower[]>();

const PATH_CACHE_CLUSTER = 3;
const PATH_CACHE_TTL = 2000;
const PATH_CACHE_MAX = 256;

type CachedPath = { cells: Cell[]; timestamp: number; reachedGoal: boolean };

const pathCache = new Map<string, CachedPath>();
type FlowField = { goalIdx: number; parents: Int32Array; timestamp: number };
const flowFieldCache = new Map<string, FlowField>();

type DirectionField = {
  key: string;
  goal: Cell;
  timestamp: number;
  dirX: Float32Array;
  dirZ: Float32Array;
};

type FlowBuildRequest = {
  key: string;
  goal: Cell;
  timestamp: number;
};

type FlowBuildState = {
  key: string;
  goal: Cell;
  goalIdx: number;
  dirX: Float32Array;
  dirZ: Float32Array;
  head: number;
  tail: number;
  finalizeIndex: number;
  stage: 'expanding' | 'finalizing';
};

type WorkerRequestEntry = {
  request: PathRequest;
  followers: PathFollower[];
  startCell: Cell;
  goalCell: Cell;
  goal: Vector3;
};

const DIRECTION_FIELD_TTL = 6000;
const DIRECTION_FIELD_MAX = 48;
const FLOW_BUILD_MAX_EXPANSIONS = 6000;
const FLOW_BUILD_MAX_FINALIZE = 8000;

const clusterKeyForCell = (cell: Cell) =>
  `${Math.floor(cell.cx / PATH_CACHE_CLUSTER)}|${Math.floor(cell.cz / PATH_CACHE_CLUSTER)}`;
const cacheKeyFor = (start: Cell, goal: Cell) => `${clusterKeyForCell(start)}->${encodeCell(goal)}`;

const invalidatePathCache = () => {
  pathCache.clear();
};

const invalidateFlowFields = () => {
  flowFieldCache.clear();
};

const invalidateNavigationCaches = () => {
  invalidatePathCache();
  invalidateFlowFields();
  navState.clearanceDirty = true;
  navState.directionFields.clear();
  navState.directionFieldOrder.length = 0;
  navState.flowBuildQueue.length = 0;
  navState.flowBuildPending.clear();
  navState.workerReady = false;
  navState.workerBusy = false;
  navState.workerPending.clear();
  navState.flowBuildState = null;
  navState.pathGrid = null;
  navState.pathFinder = null;
};

const ensurePathGridReady = () => {
  if (!isGridReady() || !navState.grid || !navState.matrix) return;
  if (navState.pathGrid && navState.pathFinder) return;
  const matrixCopy = navState.matrix.map(row => row.slice());
  navState.pathGrid = new PathFinding.Grid(navState.grid.width, navState.grid.height, matrixCopy);
  navState.pathFinder = new PathFinding.JumpPointFinder({
    diagonalMovement: PathFinding.DiagonalMovement.OnlyWhenNoObstacle
  });
};

const resetPathGridState = () => {
  if (!navState.pathGrid || !navState.grid) return;
  const nodes = navState.pathGrid.nodes;
  const height = navState.grid.height;
  const width = navState.grid.width;
  for (let z = 0; z < height; z++) {
    const row = nodes[z];
    for (let x = 0; x < width; x++) {
      const node = row[x];
      if (node.opened || node.closed || node.parent) {
        node.opened = false;
        node.closed = false;
        node.parent = null;
        node.g = 0;
        node.h = 0;
        node.f = 0;
      }
    }
  }
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

const FLOW_NEIGHBORS: Array<{ dx: number; dz: number; cost: number }> = [
  { dx: 1, dz: 0, cost: STRAIGHT_COST },
  { dx: -1, dz: 0, cost: STRAIGHT_COST },
  { dx: 0, dz: 1, cost: STRAIGHT_COST },
  { dx: 0, dz: -1, cost: STRAIGHT_COST },
  { dx: 1, dz: 1, cost: DIAGONAL_COST },
  { dx: -1, dz: 1, cost: DIAGONAL_COST },
  { dx: 1, dz: -1, cost: DIAGONAL_COST },
  { dx: -1, dz: -1, cost: DIAGONAL_COST }
];

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

const clearanceForRadius = (radius: number) => {
  return Math.max(radius + CLEARANCE_MARGIN, MIN_CLEARANCE_THRESHOLD);
};

const radiusFromClearance = (clearance: number) => {
  return Math.max(0.2, clearance - CLEARANCE_MARGIN);
};

const ensureClearance = () => {
  if (!navState.clearanceDirty) return;
  if (!isGridReady() || !navState.clearance || !navState.occupancy) return;

  const { width, height, cellSize } = navState.grid;
  const total = width * height;
  const clearance = navState.clearance;
  clearance.fill(Number.POSITIVE_INFINITY);

  const open = new MinHeap();
  let seeded = false;

  for (let idx = 0; idx < total; idx++) {
    if (navState.occupancy[idx] > 0) {
      const cell = cellFromIndex(idx);
      if (!cell) continue;
      clearance[idx] = 0;
      open.push({ idx, cell, g: 0, f: 0 });
      seeded = true;
    }
  }

  if (!seeded) {
    clearance.fill(Number.POSITIVE_INFINITY);
    navState.clearanceDirty = false;
    return;
  }

  const neighbors = [
    { dx: 1, dz: 0, cost: cellSize },
    { dx: -1, dz: 0, cost: cellSize },
    { dx: 0, dz: 1, cost: cellSize },
    { dx: 0, dz: -1, cost: cellSize },
    { dx: 1, dz: 1, cost: cellSize * Math.SQRT2 },
    { dx: -1, dz: 1, cost: cellSize * Math.SQRT2 },
    { dx: 1, dz: -1, cost: cellSize * Math.SQRT2 },
    { dx: -1, dz: -1, cost: cellSize * Math.SQRT2 }
  ];

  while (open.size) {
    const current = open.pop()!;
    const currentClearance = clearance[current.idx];
    if (current.g - currentClearance > EPSILON) continue;
    const cx = current.idx % width;
    const cz = Math.floor(current.idx / width);

    for (const neighbor of neighbors) {
      const nx = cx + neighbor.dx;
      const nz = cz + neighbor.dz;
      if (nx < 0 || nz < 0 || nx >= width || nz >= height) continue;
      const neighborIdx = nz * width + nx;
      const tentative = currentClearance + neighbor.cost;
      if (tentative + EPSILON < clearance[neighborIdx]) {
        clearance[neighborIdx] = tentative;
        const cell = { cx: nx, cz: nz };
        open.push({ idx: neighborIdx, cell, g: tentative, f: tentative });
      }
    }
  }

  navState.clearanceDirty = false;
};

const canStep = (from: Cell, to: Cell, requiredClearance?: number) => {
  if (!isCellTraversable(to, requiredClearance)) return false;
  const dx = to.cx - from.cx;
  const dz = to.cz - from.cz;
  if (dx !== 0 && dz !== 0) {
    const gateA = { cx: from.cx + dx, cz: from.cz };
    const gateB = { cx: from.cx, cz: from.cz + dz };
    if (!isCellTraversable(gateA, requiredClearance) || !isCellTraversable(gateB, requiredClearance)) {
      return false;
    }
  }
  return true;
};

function isCellTraversable(cell: Cell | null, requiredClearance?: number): boolean {
  if (!cell) return false;
  if (!isCellWalkable(cell)) return false;
  if (!navState.grid || !navState.clearance) return false;
  ensureClearance();
  const idx = indexForCell(cell);
  if (idx < 0) return false;
  if (!navState.clearance) return false;
  if (navState.occupancy && navState.occupancy[idx] > 0) return false;
  const clearanceRequirement = requiredClearance ?? navState.requiredClearance;
  return navState.clearance[idx] >= clearanceRequirement - EPSILON;
}

const isWorldWalkable = (point: Vector3, requiredClearance?: number) =>
  isCellTraversable(worldToCell(point.x, point.z), requiredClearance);

const adjustCellOccupancy = (index: number, delta: number) => {
  if (!isGridReady()) return;
  if (index < 0 || index >= navState.occupancy.length) return;
  const next = Math.max(0, navState.occupancy[index] + delta);
  navState.occupancy[index] = next;
  const blocked = next > 0;
  const cell = cellFromIndex(index);
  if (!cell) return;
  navState.walkable[index] = blocked ? 0 : 1;
  navState.matrix[cell.cz][cell.cx] = blocked ? 0 : 1;
  if (navState.pathGrid && navState.pathGrid.nodes) {
    navState.pathGrid.nodes[cell.cz][cell.cx].weight = blocked ? 0 : 1;
  }
  navState.clearanceDirty = true;
  sendWorkerCellUpdate(cell, !blocked);
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
  const scaled = getBuildingCollisionMask(building.buildingType);
  const fallback = COLLISION_DATA.BUILDINGS[building.buildingType];
  const width = scaled.width > 0 ? scaled.width : fallback?.width ?? 0;
  const depth = scaled.depth > 0 ? scaled.depth : fallback?.depth ?? 0;
  if (width <= 0 || depth <= 0) return;
  // Adaptive padding: keep obstacle inflation reasonable for small masks
  const basePad = Math.min(navState.agentPadding * 0.5, BUILDING_AGENT_PADDING_CAP) + BUILDING_EXTRA_PADDING;
  const padScale = building.buildingType === BuildingType.TOWN_HALL ? 0.55 : 1;
  const directionalPad = basePad * padScale;
  const halfGeomW = width / 2;
  const halfGeomD = depth / 2;
  const padX = Math.min(directionalPad, halfGeomW * 0.35);
  const padZ = Math.min(directionalPad, halfGeomD * 0.35);
  const halfWidth = halfGeomW + padX;
  const halfDepth = halfGeomD + padZ;
  const minX = building.position.x - halfWidth;
  const maxX = building.position.x + halfWidth;
  const minZ = building.position.z - halfDepth;
  const maxZ = building.position.z + halfDepth;
  const cells = eachCellInRect(minX, maxX, minZ, maxZ);
  markCells(`building:${building.id}`, cells);
};

const rebuildStaticObstacles = (buildings: Record<string, Building>, _resources: Record<string, ResourceNode>) => {
  if (!isGridReady()) return;
  invalidateNavigationCaches();
  navState.obstacles.clear();
  navState.occupancy.fill(0);
  navState.walkable.fill(1);
  for (let cz = 0; cz < navState.grid.height; cz++) {
    for (let cx = 0; cx < navState.grid.width; cx++) {
      navState.matrix[cz][cx] = 1;
    }
  }

  Object.values(buildings).forEach(registerBuildingObstacle);
  ensureClearance();
  ensurePathGridReady();
  sendWorkerInit();
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

const findNearestWalkableCell = (
  start: Cell | null,
  maxDistance = getMaxSearchRadius(),
  requiredClearance?: number
): Cell | null => {
  if (!start) return null;
  if (!navState.grid) return null;

  const visited = new Set<string>();
  const queue: { cell: Cell; distance: number }[] = [{ cell: start, distance: 0 }];
  visited.add(encodeCell(start));

  while (queue.length) {
    const current = queue.shift()!;
    if (isCellTraversable(current.cell, requiredClearance)) {
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

const lineIsClear = (start: Cell, end: Cell, requiredClearance?: number) => {
  if (!navState.grid) return false;
  const samples = traverseLine(start, end);
  let prev: Cell | null = null;
  for (const cell of samples) {
    if (!isCellTraversable(cell, requiredClearance)) {
      return false;
    }
    if (prev && !canStep(prev, cell, requiredClearance)) {
      return false;
    }
    prev = cell;
  }
  return true;
};

const findLocalAdjustmentInternal = (
  from: Vector3,
  goal: Vector3,
  options: LocalAdjustmentOptions = {}
): Vector3 | null => {
  if (!isGridReady() || !navState.grid) return null;
  const {
    agentRadius = navState.agentPadding || 0.5,
    maxOffset = 4,
    angularSteps = 4,
    radialIterations = 4
  } = options;

  const requiredClearance = clearanceForRadius(agentRadius);
  const startCell = worldToCell(from.x, from.z);
  const desiredCell = worldToCell(goal.x, goal.z);

  const clampCandidate = (cell: Cell | null) => {
    if (!cell) return null;
    return clampToWorld(cellToWorld(cell));
  };

  let initialTarget = desiredCell;
  if (!initialTarget || !isCellTraversable(initialTarget, requiredClearance)) {
    const maxCells = navState.grid ? Math.max(1, Math.ceil(maxOffset / navState.grid.cellSize)) : 1;
    initialTarget = findNearestWalkableCell(desiredCell, maxCells, requiredClearance);
  }

  if (startCell && initialTarget && lineIsClear(startCell, initialTarget, requiredClearance)) {
    return clampCandidate(initialTarget);
  }

  const direction = Math.atan2(goal.z - from.z, goal.x - from.x);
  const angleSpread = Math.PI * 0.75;
  const stepAngle = angularSteps > 0 ? angleSpread / (angularSteps + 1) : angleSpread;
  const cellSize = navState.grid?.cellSize ?? 1;

  let bestCandidate: { point: Vector3; penalty: number } | null = null;

  for (let ring = 1; ring <= radialIterations; ring++) {
    const radius = Math.min(maxOffset, ring * cellSize + agentRadius);
    const baseAngles: number[] = [direction];
    for (let step = 1; step <= angularSteps; step++) {
      const offset = step * stepAngle;
      baseAngles.push(direction + offset);
      baseAngles.push(direction - offset);
    }

    for (const angle of baseAngles) {
      const candidatePoint = {
        x: goal.x + Math.cos(angle) * radius,
        y: 0,
        z: goal.z + Math.sin(angle) * radius
      };
      const candidateCell = worldToCell(candidatePoint.x, candidatePoint.z);
      if (!candidateCell) continue;
      if (!isCellTraversable(candidateCell, requiredClearance)) continue;
      if (startCell && !lineIsClear(startCell, candidateCell, requiredClearance)) continue;
      const clamped = clampCandidate(candidateCell);
      if (!clamped) continue;
      const toGoal = Math.hypot(clamped.x - goal.x, clamped.z - goal.z);
      const toCurrent = Math.hypot(clamped.x - from.x, clamped.z - from.z);
      const penalty = toGoal + toCurrent * 0.25 + radius * 0.05;
      if (!bestCandidate || penalty < bestCandidate.penalty) {
        bestCandidate = { point: clamped, penalty };
      }
    }

    if (bestCandidate) break;
  }

  if (bestCandidate) {
    return bestCandidate.point;
  }

  if (initialTarget) {
    return clampCandidate(initialTarget);
  }

  return safeSnapInternal(goal, maxOffset);
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

const bridgeCachedPath = (start: Cell, cached: CachedPath, requiredClearance: number): PathSolution | null => {
  if (!isGridReady()) return null;
  const startKey = encodeCell(start);
  const targetIndices = new Map<string, number>();
  cached.cells.forEach((cell, index) => {
    targetIndices.set(encodeCell(cell), index);
  });

  const queue: Cell[] = [start];
  const parents = new Map<string, string>();
  const cellsByKey = new Map<string, Cell>([[startKey, start]]);
  const distances = new Map<string, number>([[startKey, 0]]);
  const visited = new Set<string>([startKey]);

  while (queue.length) {
    const current = queue.shift()!;
    const currentKey = encodeCell(current);
    const distance = distances.get(currentKey) ?? 0;

    const hitIndex = targetIndices.get(currentKey);
    if (hitIndex !== undefined) {
      const prefix: Cell[] = [];
      let key: string | undefined = currentKey;
      while (key) {
        const cell = cellsByKey.get(key);
        if (!cell) break;
        prefix.push(cell);
        if (key === startKey) break;
        key = parents.get(key);
      }
      prefix.reverse();

      const remainder = cached.cells.slice(hitIndex);
      const prefixTrimmed = prefix.length ? prefix.slice(0, -1) : [];
      const cells = prefixTrimmed.length ? [...prefixTrimmed, ...remainder] : remainder;
      if (!cells.length) return null;
      return { cells, reachedGoal: cached.reachedGoal, expanded: visited.size, elapsedMs: 0 };
    }

    if (distance >= CACHE_BRIDGE_RADIUS_CELLS) {
      continue;
    }

    for (const neighbor of getNeighbors(current)) {
      if (!canStep(current, neighbor, requiredClearance)) continue;
      const key = encodeCell(neighbor);
      if (visited.has(key)) continue;
      visited.add(key);
      parents.set(key, currentKey);
      cellsByKey.set(key, neighbor);
      distances.set(key, distance + 1);
      queue.push(neighbor);
    }
  }

  return null;
};

const reuseCachedPath = (start: Cell, goal: Cell, requiredClearance: number): PathSolution | null => {
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
    if (!isCellTraversable(candidate, requiredClearance)) continue;
    if (!lineIsClear(start, candidate, requiredClearance)) continue;

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

  const bridged = bridgeCachedPath(start, cached, requiredClearance);
  if (bridged) {
    cached.timestamp = now();
    return bridged;
  }

  return null;
};

const pruneFlowFields = () => {
  if (flowFieldCache.size <= FLOW_FIELD_CACHE_MAX) return;
  const entries = [...flowFieldCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
  const remove = entries.length - FLOW_FIELD_CACHE_MAX;
  for (let i = 0; i < remove; i++) {
    flowFieldCache.delete(entries[i][0]);
  }
};

const buildFlowField = (goal: Cell): FlowField | null => {
  if (!isGridReady()) return null;
  ensureClearance();
  const goalIdx = indexForCell(goal);
  if (goalIdx < 0) return null;

  const { width, height, cellSize } = navState.grid;
  const size = width * height;
  const parents = new Int32Array(size).fill(-1);
  const costs = new Float32Array(size);
  costs.fill(Number.POSITIVE_INFINITY);

  const open = new MinHeap();
  parents[goalIdx] = goalIdx;
  costs[goalIdx] = 0;
  open.push({ idx: goalIdx, cell: goal, g: 0, f: 0 });

  while (open.size) {
    const current = open.pop()!;
    if (current.g - costs[current.idx] > EPSILON) continue;
    const cx = current.idx % width;
    const cz = Math.floor(current.idx / width);
    const currentCell = { cx, cz };

    const neighbors = getNeighbors(currentCell);
    for (const neighbor of neighbors) {
      if (!canStep(currentCell, neighbor)) continue;
      const neighborIdx = indexForCell(neighbor);
      if (neighborIdx < 0) continue;
      const stepCost =
        neighbor.cx === cx || neighbor.cz === cz ? cellSize : cellSize * Math.SQRT2;
      const tentative = current.g + stepCost;
      if (tentative + EPSILON < costs[neighborIdx]) {
        costs[neighborIdx] = tentative;
        parents[neighborIdx] = current.idx;
        open.push({ idx: neighborIdx, cell: neighbor, g: tentative, f: tentative });
      }
    }
  }

  const field: FlowField = { goalIdx, parents, timestamp: now() };
  return field;
};

const getFlowField = (_goal: Cell): FlowField | null => {
  return null;
};

const solveWithFlowField = (_start: Cell, _goal: Cell): PathSolution | null => {
  return null;
};

const pathFromFlowField = (_start: Cell, _field: FlowField): PathSolution | null => {
  return null;
};

const simplifyCells = (cells: Cell[], requiredClearance: number): Cell[] => {
  if (cells.length <= 2) return cells;
  const result: Cell[] = [cells[0]];
  let anchorIndex = 0;

  for (let i = 2; i < cells.length; i++) {
    const anchor = cells[anchorIndex];
    const candidate = cells[i];
    if (!lineIsClear(anchor, candidate, requiredClearance)) {
      result.push(cells[i - 1]);
      anchorIndex = i - 1;
    }
  }

  result.push(cells[cells.length - 1]);
  return result;
};


const solvePath = (start: Cell, goal: Cell): PathSolution => {
  ensurePathGridReady();
  if (!isGridReady() || !navState.pathGrid || !navState.pathFinder) {
    return { cells: [], reachedGoal: false, expanded: 0, elapsedMs: 0, failureReason: 'nav-grid-not-ready' };
  }

  const startIdx = indexForCell(start);
  const goalIdx = indexForCell(goal);
  if (startIdx < 0 || goalIdx < 0) {
    return { cells: [], reachedGoal: false, expanded: 0, elapsedMs: 0, failureReason: 'invalid-indices' };
  }

  const startTime = now();
  resetPathGridState();
  const rawPath: number[][] = navState.pathFinder.findPath(
    start.cx,
    start.cz,
    goal.cx,
    goal.cz,
    navState.pathGrid
  );
  const elapsedMs = now() - startTime;

  if (!rawPath || rawPath.length === 0) {
    return {
      cells: [],
      reachedGoal: false,
      expanded: 0,
      elapsedMs,
      failureReason: 'no-path-found'
    };
  }

  const cells: Cell[] = rawPath.map(([cx, cz]) => ({ cx, cz }));
  const last = rawPath[rawPath.length - 1];
  const reachedGoal = last && last[0] === goal.cx && last[1] === goal.cz;

  return {
    cells,
    reachedGoal,
    expanded: rawPath.length,
    elapsedMs
  };
};

const computePathSolution = (start: Cell, goal: Cell, requiredClearance: number): PathSolution => {
  const cached = reuseCachedPath(start, goal, requiredClearance);
  if (cached) {
    return cached;
  }

  const flowSolution = solveWithFlowField(start, goal);
  if (flowSolution && flowSolution.cells.length) {
    storePathInCache(start, goal, flowSolution);
    return flowSolution;
  }

  const solution = solvePath(start, goal);
  storePathInCache(start, goal, solution);
  return solution;
};

const updateDiagnostics = (updates: Partial<NavState['diagnostics']>) => {
  navState.diagnostics = { ...navState.diagnostics, ...updates };
};

const completeDirectSuccess = (unitId: string, goal: Vector3, suppressDiagnostics = false) => {
  const clampedGoal = clampToWorld(goal);
  pendingRequests.delete(unitId);
  if (!navState.dispatch) return;
  if (!suppressDiagnostics) {
    updateDiagnostics({
      lastSearchMs: 0,
      lastSearchExpanded: 0,
      lastSearchResult: 'success',
      lastFailureReason: null,
      pending: pendingRequests.size,
      queueDepth: requestQueue.length
    });
  } else {
    updateDiagnostics({ pending: pendingRequests.size, queueDepth: requestQueue.length });
  }
  navState.dispatch({
    type: 'UPDATE_UNIT',
    payload: { id: unitId, path: [clampedGoal], pathIndex: 0, pathTarget: clampedGoal }
  });
};

const handlePathFailure = (unitId: string, reason: string, suppressDiagnostics = false) => {
  pendingRequests.delete(unitId);
  if (!suppressDiagnostics) {
    updateDiagnostics({
      lastSearchResult: 'failed',
      lastFailureReason: reason,
      pending: pendingRequests.size,
      queueDepth: requestQueue.length
    });
  } else {
    updateDiagnostics({ pending: pendingRequests.size, queueDepth: requestQueue.length });
  }
  if (!suppressDiagnostics && typeof process !== 'undefined' && process.env && process.env.NODE_ENV !== 'production') {
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
  solution: PathSolution,
  requiredClearance: number,
  suppressDiagnostics = false
) => {
  pendingRequests.delete(unitId);

  if (!solution.cells.length) {
    handlePathFailure(unitId, solution.failureReason ?? 'no-path', suppressDiagnostics);
    return;
  }

  if (!navState.dispatch || !isGridReady()) return;

  if (!suppressDiagnostics) {
    updateDiagnostics({
      lastSearchMs: solution.elapsedMs,
      lastSearchExpanded: solution.expanded,
      lastSearchResult: solution.reachedGoal ? 'success' : solution.cells.length > 0 ? 'partial' : 'failed',
      lastFailureReason: solution.failureReason ?? null,
      pending: pendingRequests.size,
      queueDepth: requestQueue.length
    });
  } else {
    updateDiagnostics({ pending: pendingRequests.size, queueDepth: requestQueue.length });
  }

  const simplified = simplifyCells(solution.cells, requiredClearance);
  const trimmed = simplified.filter((cell, index) => !(index === 0 && cell.cx === startCell.cx && cell.cz === startCell.cz));
  const waypoints = trimmed.map(cell => clampToWorld(cellToWorld(cell)));

  if (!waypoints.length && isWorldWalkable(goal, requiredClearance)) {
    waypoints.push(clampToWorld(goal));
  }

  if (!waypoints.length) {
    handlePathFailure(unitId, 'empty-waypoints', suppressDiagnostics);
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
  } else if (distSq > 1e-3 && isWorldWalkable(goal, requiredClearance)) {
    waypoints.push(clampToWorld(goal));
  }

  navState.dispatch({ type: 'UPDATE_UNIT', payload: { id: unitId, path: waypoints, pathIndex: 0, pathTarget: clampToWorld(goal) } });
};

const deliverFollowers = (
  followers: PathFollower[],
  _referenceGoalCell: Cell,
  _referenceSolution: PathSolution
) => {
  if (!followers.length) return;

  for (const follower of followers) {
    const followerGoal = clampToWorld(follower.goal);
    if (!isWorldWalkable(followerGoal, follower.requiredClearance)) {
      handlePathFailure(follower.unitId, 'goal-not-walkable', true);
      continue;
    }

    pendingRequests.delete(follower.unitId);
    const followerRadius = radiusFromClearance(follower.requiredClearance);
    NavMeshManager.requestPath(follower.unitId, follower.start, follower.goal, followerRadius);
  }
};

const processNextRequest = () => {
  if (!isGridReady()) return false;
  const req = requestQueue.shift();
  if (!req) return false;

  const unitId = req.unitId;
  if (req.key) {
    queuedRequestsByKey.delete(req.key);
  }
  const followers = req.key ? followersByKey.get(req.key) ?? [] : [];
  if (req.key) {
    followersByKey.delete(req.key);
  }

  const clampedStart = clampToWorld(req.start);
  const clampedGoal = clampToWorld(req.goal);

  const startCell =
    req.startCell ?? findNearestWalkableCell(worldToCell(clampedStart.x, clampedStart.z), undefined, req.requiredClearance);
  const goalCell =
    req.goalCell ?? findNearestWalkableCell(worldToCell(clampedGoal.x, clampedGoal.z), undefined, req.requiredClearance);

  if (!startCell || !goalCell) {
    handlePathFailure(unitId, 'missing-start-or-goal');
    for (const follower of followers) {
      handlePathFailure(follower.unitId, 'missing-start-or-goal', true);
    }
    return true;
  }

  if (startCell.cx === goalCell.cx && startCell.cz === goalCell.cz) {
    if (isWorldWalkable(clampedGoal, req.requiredClearance)) {
      completeDirectSuccess(unitId, clampedGoal);
      for (const follower of followers) {
        const followerGoal = clampToWorld(follower.goal);
        if (isWorldWalkable(followerGoal, follower.requiredClearance)) {
          completeDirectSuccess(follower.unitId, followerGoal, true);
        } else {
          handlePathFailure(follower.unitId, 'goal-not-walkable', true);
        }
      }
    } else {
      handlePathFailure(unitId, 'goal-not-walkable');
      for (const follower of followers) {
        handlePathFailure(follower.unitId, 'goal-not-walkable', true);
      }
    }
    return true;
  }

  ensureWorker();
  if (!navState.worker || !navState.workerReady) {
    const solution = computePathSolution(startCell, goalCell, req.requiredClearance);
    applySolution(req.unitId, clampedGoal, startCell, solution, req.requiredClearance);
    deliverFollowers(followers, goalCell, solution);
    return true;
  }

  if (navState.workerBusy) {
    requestQueue.unshift(req);
    return false;
  }

  const requestId = ++navState.workerCounter;
  navState.workerBusy = true;
  navState.workerPending.set(requestId, {
    request: req,
    followers,
    startCell,
    goalCell,
    goal: clampedGoal
  });

  navState.worker.postMessage({
    type: 'path',
    id: requestId,
    start: [startCell.cx, startCell.cz],
    goal: [goalCell.cx, goalCell.cz],
    requiredClearance: req.requiredClearance
  });

  return true;
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

const sampleClearanceAt = (point: Vector3): number => {
  if (!isGridReady() || !navState.clearance) return Number.POSITIVE_INFINITY;
  ensureClearance();
  const clamped = clampToWorld(point);
  const cell = worldToCell(clamped.x, clamped.z);
  if (!cell) return Number.POSITIVE_INFINITY;
  const idx = indexForCell(cell);
  if (idx < 0) return Number.POSITIVE_INFINITY;
  const value = navState.clearance[idx];
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
};

const sampleClearanceAtOffset = (point: Vector3, dx: number, dz: number): number => {
  return sampleClearanceAt({ x: point.x + dx, y: 0, z: point.z + dz });
};

const clearanceGradient = (point: Vector3): { x: number; z: number } => {
  if (!isGridReady() || !navState.grid) {
    return { x: 0, z: 0 };
  }
  const step = navState.grid.cellSize;
  const right = sampleClearanceAtOffset(point, step, 0);
  const left = sampleClearanceAtOffset(point, -step, 0);
  const forward = sampleClearanceAtOffset(point, 0, step);
  const backward = sampleClearanceAtOffset(point, 0, -step);
  const denom = step * 2 || 1;
  const gradX = (right - left) / denom;
  const gradZ = (forward - backward) / denom;
  return {
    x: Number.isFinite(gradX) ? gradX : 0,
    z: Number.isFinite(gradZ) ? gradZ : 0
  };
};

const computeRepulsionVector = (point: Vector3): { x: number; z: number } | null => {
  if (!isGridReady() || !navState.grid) return null;
  const clearance = sampleClearanceAt(point);
  if (!isFinite(clearance)) return null;
  const desiredClearance = navState.requiredClearance + navState.agentPadding * REPULSION_MARGIN;
  if (clearance >= desiredClearance - EPSILON) return null;
  const gradient = clearanceGradient(point);
  const magnitude = Math.hypot(gradient.x, gradient.z);
  if (magnitude < EPSILON) return null;
  const normalized = { x: gradient.x / magnitude, z: gradient.z / magnitude };
  const deficit = Math.max(0, desiredClearance - clearance);
  const strength = Math.min(
    REPULSION_STRENGTH,
    Math.max(deficit / (desiredClearance + EPSILON), REPULSION_MIN_THRESHOLD)
  );
  return {
    x: normalized.x * strength,
    z: normalized.z * strength
  };
};

const advanceOnNavInternal = (from: Vector3, to: Vector3, maxStep: number): Vector3 => {
  const distance = Math.hypot(to.x - from.x, to.z - from.z);
  if (distance < EPSILON) return clampToWorld(to);
  const clampedStep = Math.min(maxStep, distance);
  const direction = { x: (to.x - from.x) / distance, z: (to.z - from.z) / distance };
  const baseTarget = {
    x: from.x + direction.x * clampedStep,
    y: 0,
    z: from.z + direction.z * clampedStep
  };

  const projected = projectMoveInternal(from, baseTarget);
  if (!navState.ready) {
    return projected;
  }

  const repulsion = computeRepulsionVector(projected);
  if (!repulsion) {
    return projected;
  }

  let repulsionX = repulsion.x;
  let repulsionZ = repulsion.z;
  if (navState.ready) {
    const distanceToGoal = Math.hypot(to.x - projected.x, to.z - projected.z);
    const relaxationRadius = (navState.agentPadding || 0) + CLEARANCE_MARGIN + 0.1;
    if (distanceToGoal < relaxationRadius && relaxationRadius > EPSILON) {
      const factor = Math.max(0, Math.min(1, distanceToGoal / relaxationRadius));
      repulsionX *= factor;
      repulsionZ *= factor;
    }
  }

  const combined = {
    x: direction.x + repulsionX,
    z: direction.z + repulsionZ
  };
  const combinedLength = Math.hypot(combined.x, combined.z);
  if (combinedLength < EPSILON) {
    return projected;
  }

  const adjustedDirection = { x: combined.x / combinedLength, z: combined.z / combinedLength };
  const adjustedTarget = {
    x: from.x + adjustedDirection.x * clampedStep,
    y: 0,
    z: from.z + adjustedDirection.z * clampedStep
  };
  return projectMoveInternal(from, adjustedTarget);
};

const pruneDirectionFields = (timestamp: number) => {
  const order = navState.directionFieldOrder;
  let index = 0;
  while (index < order.length) {
    const key = order[index];
    const field = navState.directionFields.get(key);
    if (!field || timestamp - field.timestamp > DIRECTION_FIELD_TTL) {
      navState.directionFields.delete(key);
      order.splice(index, 1);
    } else {
      index++;
    }
  }

  while (order.length > DIRECTION_FIELD_MAX) {
    const oldest = order.shift();
    if (!oldest) break;
    navState.directionFields.delete(oldest);
  }
};

const touchDirectionField = (key: string, timestamp: number) => {
  const order = navState.directionFieldOrder;
  const existingIndex = order.indexOf(key);
  if (existingIndex >= 0) {
    order.splice(existingIndex, 1);
  }
  order.push(key);
  pruneDirectionFields(timestamp);
};

const normalizeFlowGoalCell = (cell: Cell | null): Cell | null => {
  if (!cell) return null;
  if (isCellTraversable(cell)) return cell;
  return findNearestWalkableCell(cell);
};

const handleWorkerMessage = (event: MessageEvent<any>) => {
  const data = event.data;
  if (!data) return;

  if (data.type === 'init-complete') {
    navState.workerReady = true;
    navState.workerBusy = false;
    navState.workerPending.clear();
    processNextRequest();
    return;
  }

  if (data.type === 'path-result') {
    const entry = navState.workerPending.get(data.id);
    if (!entry) {
      navState.workerBusy = false;
      processNextRequest();
      return;
    }

    navState.workerPending.delete(data.id);
    navState.workerBusy = false;

    if (data.error) {
      handlePathFailure(entry.request.unitId, data.error);
      for (const follower of entry.followers) {
        handlePathFailure(follower.unitId, data.error, true);
      }
    } else {
      const cells: Cell[] = data.path.map(([cx, cz]: [number, number]) => ({ cx, cz }));
      const solution: PathSolution = {
        cells,
        reachedGoal: data.reachedGoal ?? false,
        expanded: data.path.length,
        elapsedMs: data.elapsedMs ?? 0
      };

      applySolution(
        entry.request.unitId,
        entry.goal,
        entry.startCell,
        solution,
        entry.request.requiredClearance
      );
      deliverFollowers(entry.followers, entry.goalCell, solution);
    }

    processNextRequest();
  }
};

const ensureWorker = () => {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return;
  if (navState.worker || navState.workerFailed) return;

  const urlCandidates = [
    '../../workers/pathWorker.ts',
    '../../workers/pathWorker.js',
    './workers/pathWorker.ts',
    './workers/pathWorker.js',
    'workers/pathWorker.ts',
    'workers/pathWorker.js'
  ];

  const tryResolve = (candidate: string, base?: string | URL): string | undefined => {
    try {
      const resolved = base ? new URL(candidate, base) : new URL(candidate, import.meta.url);
      return resolved.toString();
    } catch {
      return undefined;
    }
  };

  const resolveWorkerUrl = (): string | undefined => {
    for (const candidate of urlCandidates) {
      const direct = tryResolve(candidate);
      if (direct) return direct;
    }

    const bundleBase = (window as any)?.__rtsBundleBaseUrl as string | undefined;
    if (bundleBase) {
      for (const candidate of urlCandidates) {
        const normalized = candidate.replace(/^(\.\.\/)+/, '');
        const viaBase = tryResolve(normalized, bundleBase);
        if (viaBase) return viaBase;
      }
    }

    const origin = window?.location?.origin;
    if (origin) {
      for (const candidate of urlCandidates) {
        const normalized = candidate.replace(/^(\.\.\/)+/, '');
        const viaOrigin = tryResolve(normalized, origin + '/');
        if (viaOrigin) return viaOrigin;
      }
    }

    return undefined;
  };

  try {
    const workerUrl = resolveWorkerUrl();
    if (!workerUrl) {
      throw new Error('Unable to resolve navmesh worker url');
    }

    const worker = new Worker(workerUrl, { type: 'module' });
    worker.onmessage = handleWorkerMessage;
    worker.onerror = event => {
      console.error('[NavMeshWorker] error', event);
    };

    navState.worker = worker;
    navState.workerReady = false;
    navState.workerBusy = false;
    navState.workerCounter = 0;
    navState.workerPending.clear();
    navState.workerFailed = false;

    if (navState.grid && navState.matrix) {
      sendWorkerInit();
    }
  } catch (error) {
    console.error('[NavMeshWorker] failed to create worker', error);
    navState.worker = null;
    navState.workerReady = false;
    navState.workerBusy = false;
    navState.workerCounter = 0;
    navState.workerPending.clear();
    navState.workerFailed = true;
  }
};

const sendWorkerInit = () => {
  if (!navState.worker || !navState.grid || !navState.matrix) return;
  const { width, height } = navState.grid;
  const flattened = new Uint8Array(width * height);
  let index = 0;
  for (let z = 0; z < height; z++) {
    for (let x = 0; x < width; x++, index++) {
      flattened[index] = navState.matrix[z][x] ? 1 : 0;
    }
  }
  navState.workerReady = false;
  navState.workerBusy = false;
  navState.workerCounter = 0;
  navState.workerPending.clear();
  navState.worker.postMessage(
    {
      type: 'init',
      width,
      height,
      matrix: flattened
    },
    [flattened.buffer]
  );
};

const sendWorkerCellUpdate = (cell: Cell, walkable: boolean) => {
  if (!navState.worker || !navState.workerReady) return;
  navState.worker.postMessage({
    type: 'update',
    x: cell.cx,
    y: cell.cz,
    weight: walkable ? 1 : 0
  });
};

const scheduleDirectionFieldBuild = (_goal: Cell, _key: string) => {
  return;
};

const startNextFlowFieldBuild = () => {
  return;
};

const processDirectionFieldBuild = () => {
  return;
};

const ensureDirectionField = (_goal: Cell): DirectionField | null => {
  return null;
};

const sampleDirectionField = (_goal: Vector3, _position: Vector3): { x: number; z: number } | null => {
  return null;
};

const invalidateDirectionField = (_goal: Vector3) => {
  return;
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
    navState.clearance = null;
    navState.clearanceDirty = false;
    navState.obstacles.clear();
    requestQueue.length = 0;
    pendingRequests.clear();
    queuedRequestsByKey.clear();
    followersByKey.clear();
    navState.maxSearchRadius = 0;
    navState.requiredClearance = 0;
    navState.minAgentClearance = 0;
    invalidateNavigationCaches();
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
    navState.clearance = new Float32Array(width * height);
    navState.clearance.fill(0);
    navState.clearanceDirty = true;
    navState.obstacles.clear();
    navState.directionFields.clear();
    navState.directionFieldOrder.length = 0;
    navState.flowBuildQueue.length = 0;
    navState.flowBuildPending.clear();
    navState.flowBuildState = null;
    navState.pathGrid = new PathFinding.Grid(width, height);
    navState.pathFinder = new PathFinding.JumpPointFinder({
      diagonalMovement: PathFinding.DiagonalMovement.OnlyWhenNoObstacle
    });
    requestQueue.length = 0;
    pendingRequests.clear();
    queuedRequestsByKey.clear();
    followersByKey.clear();
    navState.maxSearchRadius = Math.ceil(Math.hypot(width, height));
    updateDiagnostics({ queueDepth: 0, pending: 0 });

    const unitRadii = Object.values(COLLISION_DATA.UNITS).map(u => u.radius);
    const maxUnitRadius = unitRadii.length ? Math.max(...unitRadii) : 0.5;
    const minUnitRadius = unitRadii.length ? Math.max(Math.min(...unitRadii), 0.25) : 0.25;
    const adjustedRadius = Math.min(maxUnitRadius, 0.6);
    navState.agentPadding = adjustedRadius;
    navState.requiredClearance = clearanceForRadius(adjustedRadius);
    navState.minAgentClearance = clearanceForRadius(minUnitRadius);
    navState.flowQueueCx = new Int32Array(width * height);
    navState.flowQueueCz = new Int32Array(width * height);
    navState.flowCostScratch = new Uint32Array(width * height);

    rebuildStaticObstacles(buildings, resources);
    ensureWorker();
    navState.ready = true;
  },

  addObstacle(building: Building) {
    if (!isGridReady()) return;
    invalidateNavigationCaches();
    registerBuildingObstacle(building);
    ensureClearance();
    ensurePathGridReady();
  },

  removeObstacle(building: Building) {
    if (!isGridReady()) return;
    invalidateNavigationCaches();
    unmarkCells(`building:${building.id}`);
    ensureClearance();
    ensurePathGridReady();
  },

  requestPath(unitId: string, startPos: Vector3, endPos: Vector3, agentRadius?: number) {
    if (!navState.ready || pendingRequests.has(unitId)) return;
    ensureWorker();

    const start = clampToWorld(startPos);
    const goal = clampToWorld(endPos);
    const effectiveRadius = Math.max(0.2, Math.min(agentRadius ?? navState.agentPadding ?? 0.5, 1.25));
    const requiredClearance = clearanceForRadius(effectiveRadius);
    const startCell = findNearestWalkableCell(worldToCell(start.x, start.z), undefined, requiredClearance);
    const goalCell = findNearestWalkableCell(worldToCell(goal.x, goal.z), undefined, requiredClearance);
    const key = goalCell ? encodeCell(goalCell) : null;

    if (startCell && goalCell && startCell.cx === goalCell.cx && startCell.cz === goalCell.cz) {
      if (isWorldWalkable(goal, requiredClearance)) {
        completeDirectSuccess(unitId, goal);
      } else {
        handlePathFailure(unitId, 'goal-not-walkable');
      }
      return;
    }

    if (key) {
      const existing = queuedRequestsByKey.get(key);
      if (existing) {
        const follower: PathFollower = {
          unitId,
          start,
          goal,
          startCell,
          goalCell,
          requiredClearance
        };
        const group = followersByKey.get(key);
        if (group) {
          group.push(follower);
        } else {
          followersByKey.set(key, [follower]);
        }
        pendingRequests.set(unitId, key);
        updateDiagnostics({ queueDepth: requestQueue.length, pending: pendingRequests.size });
        return;
      }
    }

    const request: PathRequest = {
      unitId,
      start,
      goal,
      startCell,
      goalCell,
      key,
      requiredClearance
    };

    requestQueue.push(request);
    pendingRequests.set(unitId, key);
    if (key) {
      queuedRequestsByKey.set(key, request);
    }
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

  findLocalAdjustment(from: Vector3, goal: Vector3, options?: LocalAdjustmentOptions) {
    return findLocalAdjustmentInternal(from, goal, options);
  },

  sampleFlowDirection(goal: Vector3, position: Vector3) {
    return sampleDirectionField(goal, position);
  },

  invalidateFlowField(goal: Vector3) {
    invalidateDirectionField(goal);
  },

  processQueue() {
    if (!navState.ready) return;
    updateDiagnostics({ queueDepth: requestQueue.length, pending: pendingRequests.size });
    const frameStart = now();
    for (let i = 0; i < MAX_QUEUE_BATCH; i++) {
      if (!requestQueue.length) break;
      const dispatched = processNextRequest();
      if (!dispatched) break;
      if (now() - frameStart >= MAX_QUEUE_TIME_MS) {
        break;
      }
    }
  },

  terminate() {
    navState.dispatch = null;
    navState.ready = false;
    navState.grid = null;
    navState.walkable = null;
    navState.occupancy = null;
    navState.matrix = null;
    navState.clearance = null;
    navState.clearanceDirty = false;
    navState.obstacles.clear();
    navState.directionFields.clear();
    navState.directionFieldOrder.length = 0;
    navState.flowQueueCx = null;
    navState.flowQueueCz = null;
    navState.flowCostScratch = null;
    requestQueue.length = 0;
    pendingRequests.clear();
    queuedRequestsByKey.clear();
    followersByKey.clear();
    navState.requiredClearance = 0;
    navState.minAgentClearance = 0;
    navState.worker?.terminate();
    navState.worker = null;
    navState.workerReady = false;
    navState.workerBusy = false;
    navState.workerCounter = 0;
    navState.workerPending.clear();
    navState.workerFailed = false;
    invalidateNavigationCaches();
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
