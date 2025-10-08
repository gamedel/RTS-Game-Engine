import type { Dispatch } from 'react';
import { Building, ResourceNode, Vector3, Action, UnitStatus } from '../../types';
import { COLLISION_DATA } from '../../constants';

type PathRequest = { unitId: string; startPos: Vector3; endPos: Vector3 };

type Grid = {
  cellSize: number;
  width: number;
  height: number;
  originX: number;
  originZ: number;
  walkable: Uint8Array;
  agentPadding: number;
};

type Cell = { cx: number; cz: number };

const WORLD_SIZE = 320;
const CELL_SIZE = 0.75;
const HALF_WORLD = WORLD_SIZE / 2;
const MAX_FINDER_EXPANSION = 48; // cells (~36m)
const MAX_QUEUE_BATCH = 12;

const MAX_UNIT_RADIUS = Math.max(
  ...Object.values(COLLISION_DATA.UNITS).map(u => u.radius)
);

const requestQueue: PathRequest[] = [];
const pendingRequests = new Set<string>();
let dispatchRef: Dispatch<Action> | null = null;
let ready = false;
let grid: Grid | null = null;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const d2 = (a: Vector3, b: Vector3) => {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
};

const equalVec = (a: Vector3, b: Vector3, eps = 1e-4) => d2(a, b) <= eps * eps;

const makeGrid = (agentPadding: number): Grid => {
  const width = Math.ceil(WORLD_SIZE / CELL_SIZE);
  const height = Math.ceil(WORLD_SIZE / CELL_SIZE);
  const originX = -HALF_WORLD;
  const originZ = -HALF_WORLD;
  const walkable = new Uint8Array(width * height);
  walkable.fill(1);
  return { cellSize: CELL_SIZE, width, height, originX, originZ, walkable, agentPadding };
};

const worldToCell = (x: number, z: number): Cell | null => {
  if (!grid) return null;
  const cx = Math.floor((x - grid.originX) / grid.cellSize);
  const cz = Math.floor((z - grid.originZ) / grid.cellSize);
  if (cx < 0 || cz < 0 || cx >= grid.width || cz >= grid.height) return null;
  return { cx, cz };
};

const cellToWorld = ({ cx, cz }: Cell): Vector3 => {
  if (!grid) return { x: 0, y: 0, z: 0 };
  const x = grid.originX + (cx + 0.5) * grid.cellSize;
  const z = grid.originZ + (cz + 0.5) * grid.cellSize;
  return { x, y: 0, z };
};

const indexForCell = ({ cx, cz }: Cell) => cz * (grid?.width ?? 0) + cx;

const isCellWalkable = (cell: Cell | null): boolean => {
  if (!grid || !cell) return false;
  if (cell.cx < 0 || cell.cz < 0 || cell.cx >= grid.width || cell.cz >= grid.height) return false;
  return grid.walkable[indexForCell(cell)] === 1;
};

const setCellBlocked = (cell: Cell) => {
  if (!grid) return;
  if (cell.cx < 0 || cell.cz < 0 || cell.cx >= grid.width || cell.cz >= grid.height) return;
  grid.walkable[indexForCell(cell)] = 0;
};

const setRectBlocked = (minX: number, maxX: number, minZ: number, maxZ: number, padding: number) => {
  if (!grid) return;
  const pad = padding + grid.agentPadding;
  const minCx = Math.floor(((minX - pad) - grid.originX) / grid.cellSize);
  const maxCx = Math.floor(((maxX + pad) - grid.originX) / grid.cellSize);
  const minCz = Math.floor(((minZ - pad) - grid.originZ) / grid.cellSize);
  const maxCz = Math.floor(((maxZ + pad) - grid.originZ) / grid.cellSize);

  for (let cz = minCz; cz <= maxCz; cz++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      setCellBlocked({ cx, cz });
    }
  }
};

const setCircleBlocked = (centerX: number, centerZ: number, radius: number, padding: number) => {
  if (!grid) return;
  const pad = radius + padding + grid.agentPadding;
  const minCx = Math.floor(((centerX - pad) - grid.originX) / grid.cellSize);
  const maxCx = Math.floor(((centerX + pad) - grid.originX) / grid.cellSize);
  const minCz = Math.floor(((centerZ - pad) - grid.originZ) / grid.cellSize);
  const maxCz = Math.floor(((centerZ + pad) - grid.originZ) / grid.cellSize);
  const radSq = pad * pad;

  for (let cz = minCz; cz <= maxCz; cz++) {
    for (let cx = minCx; cx <= maxCx; cx++) {
      const world = cellToWorld({ cx, cz });
      const dx = world.x - centerX;
      const dz = world.z - centerZ;
      if (dx * dx + dz * dz <= radSq) {
        setCellBlocked({ cx, cz });
      }
    }
  }
};

const clampToWorld = (p: Vector3): Vector3 => ({
  x: clamp(p.x, -HALF_WORLD + 0.25, HALF_WORLD - 0.25),
  y: 0,
  z: clamp(p.z, -HALF_WORLD + 0.25, HALF_WORLD - 0.25),
});

type HeapNode = { cell: Cell; g: number; f: number; parent?: string };

const encodeCell = (cell: Cell) => `${cell.cx}|${cell.cz}`;
const decodeCell = (key: string): Cell => {
  const [x, z] = key.split('|');
  return { cx: Number(x), cz: Number(z) };
};

class MinHeap {
  private data: HeapNode[] = [];

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

const neighborsOffsets: Cell[] = [
  { cx: -1, cz: 0 },
  { cx: 1, cz: 0 },
  { cx: 0, cz: -1 },
  { cx: 0, cz: 1 },
  { cx: -1, cz: -1 },
  { cx: -1, cz: 1 },
  { cx: 1, cz: -1 },
  { cx: 1, cz: 1 },
];

const heuristic = (a: Cell, b: Cell) => {
  const dx = Math.abs(a.cx - b.cx);
  const dz = Math.abs(a.cz - b.cz);
  return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * (grid?.cellSize ?? 1);
};

const reconstructPath = (came: Map<string, HeapNode>, endKey: string): Cell[] => {
  const out: Cell[] = [];
  let currentKey: string | undefined = endKey;
  while (currentKey) {
    const node = came.get(currentKey);
    if (!node) break;
    out.push(node.cell);
    currentKey = node.parent;
  }
  return out.reverse();
};

const canTraverseDiagonal = (base: Cell, offset: Cell): boolean => {
  if (!grid) return false;
  if (offset.cx === 0 || offset.cz === 0) return true;
  const a: Cell = { cx: base.cx + offset.cx, cz: base.cz };
  const b: Cell = { cx: base.cx, cz: base.cz + offset.cz };
  return isCellWalkable(a) && isCellWalkable(b);
};

const runAStar = (start: Cell, goal: Cell): Cell[] => {
  if (!grid) return [];
  const startKey = encodeCell(start);
  const goalKey = encodeCell(goal);
  const open = new MinHeap();
  const came = new Map<string, HeapNode>();
  const gScore = new Map<string, number>();
  const closed = new Set<string>();

  const startNode: HeapNode = { cell: start, g: 0, f: heuristic(start, goal), parent: undefined };
  open.push(startNode);
  came.set(startKey, startNode);
  gScore.set(startKey, 0);

  while (open.size) {
    const current = open.pop()!;
    const currentKey = encodeCell(current.cell);
    if (currentKey === goalKey) {
      return reconstructPath(came, currentKey);
    }

    closed.add(currentKey);

    for (const offset of neighborsOffsets) {
      const neighbor: Cell = { cx: current.cell.cx + offset.cx, cz: current.cell.cz + offset.cz };
      const neighborKey = encodeCell(neighbor);

      if (!isCellWalkable(neighbor) || closed.has(neighborKey)) continue;
      if (!canTraverseDiagonal(current.cell, offset)) continue;

      const cost = (offset.cx === 0 || offset.cz === 0 ? grid.cellSize : grid.cellSize * Math.SQRT2);
      const tentativeG = current.g + cost;
      const existingG = gScore.get(neighborKey);
      if (existingG !== undefined && tentativeG >= existingG) continue;

      const node: HeapNode = {
        cell: neighbor,
        g: tentativeG,
        f: tentativeG + heuristic(neighbor, goal),
        parent: currentKey,
      };
      came.set(neighborKey, node);
      gScore.set(neighborKey, tentativeG);
      open.push(node);
    }
  }

  return [];
};

const isWorldWalkable = (x: number, z: number) => isCellWalkable(worldToCell(x, z));

const traceLine = (from: Vector3, to: Vector3): Vector3 => {
  if (!grid) return to;
  const clampedTo = clampToWorld(to);
  const dx = clampedTo.x - from.x;
  const dz = clampedTo.z - from.z;
  const distance = Math.sqrt(dx * dx + dz * dz);
  if (distance < 1e-6) return clampToWorld(from);

  const step = grid.cellSize * 0.4;
  const iterations = Math.max(1, Math.ceil(distance / step));
  let last = clampToWorld(from);

  for (let i = 1; i <= iterations; i++) {
    const t = i / iterations;
    const x = from.x + dx * t;
    const z = from.z + dz * t;
    if (isWorldWalkable(x, z)) {
      last = { x, y: 0, z };
    } else {
      break;
    }
  }

  return clampToWorld(last);
};

const hasLineOfSight = (from: Vector3, to: Vector3) => equalVec(traceLine(from, to), clampToWorld(to));

const findNearestWalkableWorld = (target: Vector3, maxDistance: number): Vector3 | null => {
  if (!grid) return null;
  const startCell = worldToCell(target.x, target.z);
  const maxCells = Math.max(1, Math.ceil(maxDistance / grid.cellSize));
  const visited = new Set<string>();
  const queue: { cell: Cell; dist: number }[] = [];

  if (startCell) {
    const key = encodeCell(startCell);
    queue.push({ cell: startCell, dist: 0 });
    visited.add(key);
    if (isCellWalkable(startCell)) {
      return cellToWorld(startCell);
    }
  }

  let qi = 0;
  while (qi < queue.length) {
    const { cell, dist } = queue[qi++];
    if (dist > maxCells) continue;

    for (const offset of neighborsOffsets) {
      const next: Cell = { cx: cell.cx + offset.cx, cz: cell.cz + offset.cz };
      const key = encodeCell(next);
      if (visited.has(key)) continue;
      visited.add(key);
      const nd = dist + 1;
      if (nd > maxCells) continue;
      if (isCellWalkable(next)) {
        return cellToWorld(next);
      }
      queue.push({ cell: next, dist: nd });
    }
  }

  return null;
};

const sanitizePath = (points: Vector3[], start: Vector3, goal: Vector3): Vector3[] => {
  const clean = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.z));
  if (!clean.length) return clean;

  const simplified: Vector3[] = [clean[0]];
  let anchor = clean[0];
  for (let i = 1; i < clean.length; i++) {
    const candidate = clean[i];
    if (!hasLineOfSight(anchor, candidate)) {
      simplified.push(clean[i - 1]);
      anchor = clean[i - 1];
    }
  }
  const last = clean[clean.length - 1];
  if (!equalVec(simplified[simplified.length - 1], last)) {
    simplified.push(last);
  }

  if (!hasLineOfSight(simplified[simplified.length - 1], goal)) {
    simplified.push(goal);
  } else if (!equalVec(simplified[simplified.length - 1], goal)) {
    simplified[simplified.length - 1] = goal;
  }

  if (simplified.length && equalVec(simplified[0], start)) {
    simplified.shift();
  }

  const dedup: Vector3[] = [];
  for (const p of simplified) {
    if (!dedup.length || !equalVec(dedup[dedup.length - 1], p)) {
      dedup.push({ x: p.x, y: 0, z: p.z });
    }
  }
  return dedup;
};

export const NavMeshManager = {
  init: async (dispatch: Dispatch<Action>) => {
    dispatchRef = dispatch;
    ready = false;
  },

  isReady: () => ready,

  buildNavMesh: async (buildings: Record<string, Building>, resourcesNodes: Record<string, ResourceNode>) => {
    const agentPadding = MAX_UNIT_RADIUS + 0.3;
    grid = makeGrid(agentPadding);

    Object.values(buildings).forEach(building => {
      if (building.constructionProgress !== undefined) return;
      const size = COLLISION_DATA.BUILDINGS[building.buildingType];
      if (!size) return;
      const halfW = size.width * 0.5;
      const halfD = size.depth * 0.5;
      setRectBlocked(
        building.position.x - halfW,
        building.position.x + halfW,
        building.position.z - halfD,
        building.position.z + halfD,
        0
      );
    });

    Object.values(resourcesNodes).forEach(resource => {
      const info = COLLISION_DATA.RESOURCES[resource.resourceType];
      if (!info) return;
      setCircleBlocked(resource.position.x, resource.position.z, info.radius, 0.2);
    });

    ready = true;
  },

  addObstacle: (_b: Building) => {},
  removeObstacle: (_b: Building) => {},

  requestPath: (unitId: string, startPos: Vector3, endPos: Vector3) => {
    if (!ready || pendingRequests.has(unitId)) return;
    pendingRequests.add(unitId);
    requestQueue.push({ unitId, startPos, endPos });
  },

  isRequestPending: (unitId: string) => pendingRequests.has(unitId),

  projectMove: (from: Vector3, to: Vector3): Vector3 => {
    if (!grid) return clampToWorld(to);

    const attempt = traceLine(from, to);
    if (!equalVec(attempt, from)) return attempt;

    const horizontal = traceLine(from, { x: to.x, y: 0, z: from.z });
    if (!equalVec(horizontal, from)) return horizontal;

    const vertical = traceLine(from, { x: from.x, y: 0, z: to.z });
    if (!equalVec(vertical, from)) return vertical;

    return clampToWorld(from);
  },

  snapToNav: (p: Vector3): Vector3 => {
    if (!grid) return clampToWorld(p);
    if (isWorldWalkable(p.x, p.z)) return clampToWorld(p);
    const nearest = findNearestWalkableWorld(p, grid.cellSize * MAX_FINDER_EXPANSION);
    return nearest ? clampToWorld(nearest) : clampToWorld(p);
  },

  safeSnap(to: Vector3, maxSnapDist: number): Vector3 {
    if (!grid) return clampToWorld(to);
    const nearest = findNearestWalkableWorld(to, maxSnapDist);
    return nearest ? clampToWorld(nearest) : clampToWorld(to);
  },

  advanceOnNav(from: Vector3, to: Vector3, maxStep: number): Vector3 {
    const stepSize = Math.max(maxStep, 0.001);
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 1e-9) return clampToWorld(from);

    const scale = Math.min(1, stepSize / dist);
    const desired = { x: from.x + dx * scale, y: 0, z: from.z + dz * scale };
    const projected = this.projectMove(from, desired);

    if (!equalVec(projected, from)) {
      return clampToWorld(projected);
    }

    const safe = this.safeSnap(desired, Math.max(stepSize * 2, grid ? grid.cellSize * 2 : 1));
    if (!equalVec(safe, from)) {
      return clampToWorld(safe);
    }

    return clampToWorld(from);
  },

  processQueue: () => {
    if (!ready || !dispatchRef || !grid) return;

    for (let n = 0; n < MAX_QUEUE_BATCH; n++) {
      const req = requestQueue.shift();
      if (!req) break;

      const { unitId, startPos, endPos } = req;

      try {
        const startSnapped = this.snapToNav(clampToWorld(startPos));
        const goalSnapped = this.snapToNav(clampToWorld(endPos));

        const startCell = worldToCell(startSnapped.x, startSnapped.z);
        const goalCell = worldToCell(goalSnapped.x, goalSnapped.z);

        if (!startCell || !goalCell) {
          dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, pathTarget: undefined, status: UnitStatus.IDLE } });
          continue;
        }

        if (encodeCell(startCell) === encodeCell(goalCell)) {
          dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, path: [goalSnapped], pathIndex: 0 } });
          continue;
        }

        let cells = runAStar(startCell, goalCell);
        if (!cells.length) {
          if (hasLineOfSight(startSnapped, goalSnapped)) {
            dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, path: [goalSnapped], pathIndex: 0 } });
          } else {
            dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, pathTarget: undefined, status: UnitStatus.IDLE } });
          }
          continue;
        }

        const worldPoints = cells.map(cellToWorld);
        const sanitized = sanitizePath(worldPoints, startSnapped, goalSnapped);

        if (!sanitized.length) {
          if (hasLineOfSight(startSnapped, goalSnapped)) {
            dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, path: [goalSnapped], pathIndex: 0 } });
          } else {
            dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, pathTarget: undefined, status: UnitStatus.IDLE } });
          }
          continue;
        }

        dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, path: sanitized, pathIndex: 0 } });
      } catch (err) {
        console.error('[NavMeshManager] Failed to create path for', unitId, err);
        dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, pathTarget: undefined, status: UnitStatus.IDLE } });
      } finally {
        pendingRequests.delete(unitId);
      }
    }
  },

  terminate: () => {
    dispatchRef = null;
    requestQueue.length = 0;
    pendingRequests.clear();
    ready = false;
    grid = null;
  }
};
