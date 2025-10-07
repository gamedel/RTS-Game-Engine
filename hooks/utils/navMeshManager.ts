import { init, NavMeshQuery } from 'recast-navigation';
import { generateSoloNavMesh, generateTiledNavMesh, GenerateSoloNavMeshResult, GenerateTiledNavMeshResult } from 'recast-navigation/generators';
import { Building, ResourceNode, Vector3, Action, UnitStatus } from '../../types';
import { COLLISION_DATA } from '../../constants';

const d2 = (a: Vector3, b: Vector3) => {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return dx * dx + dz * dz;
};

const looksZero = (p: Vector3) => Math.abs(p.x) < 1e-6 && Math.abs(p.z) < 1e-6;

function extractPoints(sp: any): Vector3[] {
  const out: Vector3[] = [];
  if (!sp) return out;

  // Прямой Float32Array [x,y,z,x,y,z,...]
  if (ArrayBuffer.isView(sp) && 'length' in sp) {
    const a = sp as Float32Array | number[];
    for (let i = 0; i + 2 < a.length; i += 3) out.push({ x: +a[i], y: 0, z: +a[i + 2] });
    return out;
  }

  if (Array.isArray(sp) && sp.length) {
    // [ [x,y,z], ... ]
    if (Array.isArray(sp[0])) {
      for (const v of sp as number[][]) out.push({ x: +v[0], y: 0, z: +v[2] });
      return out;
    }
    // [{x,y,z} ...] или [{pos: Float32Array|number[]}, ...]
    if (typeof sp[0] === 'object') {
      for (const p of sp as any[]) {
        if (p) {
          if (ArrayBuffer.isView(p.pos) || Array.isArray(p.pos)) {
            out.push({ x: +p.pos[0], y: 0, z: +p.pos[2] });
          } else if (Number.isFinite(p.x) && Number.isFinite(p.z)) {
            out.push({ x: +p.x, y: 0, z: +p.z });
          }
        }
      }
      return out;
    }
    // [x,y,z,x,y,z,...] как number[]
    if (typeof sp[0] === 'number') {
      const a = sp as number[];
      for (let i = 0; i + 2 < a.length; i += 3) out.push({ x: +a[i], y: 0, z: +a[i + 2] });
      return out;
    }
  }
  return out;
}

let navMesh: any;
let navMeshQuery: NavMeshQuery | null = null;
let dispatchRef: React.Dispatch<Action> | null = null;
const requestQueue: PathRequest[] = [];
const pendingRequests = new Set<string>();
let ready = false;

type PathRequest = { unitId: string; startPos: Vector3; endPos: Vector3; };
type Mode = 'recast' | 'fallback-line';
let mode: Mode = 'recast';


const rcConfig = {
  cs: 0.35,
  ch: 0.25,
  walkableSlopeAngle: 60,
  walkableHeight: 1.8,
  walkableClimb: 0.6,
  walkableRadius: 0.6,
  maxEdgeLen: 16,
  maxSimplificationError: 1.0,
  minRegionArea: 2,
  mergeRegionArea: 10,
  maxVertsPerPoly: 6,
  detailSampleDist: 0,
  detailSampleMaxError: 1.0,
};

const getSourceGeometries = (
  buildings: Record<string, Building>,
  resourcesNodes: Record<string, ResourceNode>
) => {
  const positions: number[] = [];
  const indices: number[] = [];

  // ---------------- helpers ----------------
  const pushQuad = (
    ax:number, ay:number, az:number,
    bx:number, by:number, bz:number,
    cx:number, cy:number, cz:number,
    dx:number, dy:number, dz:number
  ) => {
    const base = positions.length / 3;
    positions.push(
      ax, ay, az,  bx, by, bz,  cx, cy, cz,
      ax, ay, az,  cx, cy, cz,  dx, dy, dz
    );
    indices.push(base+0, base+1, base+2, base+3, base+4, base+5);
  };

  type Box = { minX:number; maxX:number; minZ:number; maxZ:number };

  const expandAABB = (minX:number, maxX:number, minZ:number, maxZ:number, e:number): Box => ({
    minX: minX - e, maxX: maxX + e, minZ: minZ - e, maxZ: maxZ + e
  });

  const boxOverlap = (a:Box, b:Box) =>
    a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;

  // ---------------- collect obstacle AABBs ----------------
  // Расширяем под радиус агента, чтобы путь не прилипал к стене.
  const agentExpand = rcConfig.walkableRadius + 0.2; // = 0.6 + 0.2 = 0.8

  const obstacles: Box[] = [];

  // здания (только построенные)
  Object.values(buildings).forEach(b => {
    if (b.constructionProgress !== undefined) return;
    const sz = COLLISION_DATA.BUILDINGS[b.buildingType];
    if (!sz) return;
    const halfW = sz.width * 0.5;
    const halfD = sz.depth * 0.5;
    obstacles.push(
      expandAABB(
        b.position.x - halfW, b.position.x + halfW,
        b.position.z - halfD, b.position.z + halfD,
        agentExpand
      )
    );
  });

  // ресурсы
  Object.values(resourcesNodes).forEach(r => {
    const sz = COLLISION_DATA.RESOURCES[r.resourceType];
    if (!sz) return;
    const half = sz.radius;
    obstacles.push(
      expandAABB(
        r.position.x - half, r.position.x + half,
        r.position.z - half, r.position.z + half,
        agentExpand
      )
    );
  });

  // ---------------- ground with holes ----------------
  const groundSize = 300;
  const s = groundSize / 2;

  // Размер «плитки» земли. 2.0 — хорошее соотношение между качеством и числом треугольников.
  // Можно поставить 1.0 для ещё более точного края дыр (но будет больше треугольников).
  const CELL = 2.0;

  for (let x = -s; x < s; x += CELL) {
    for (let z = -s; z < s; z += CELL) {
      const cell: Box = { minX: x, maxX: x + CELL, minZ: z, maxZ: z + CELL };

      // если клетка пересекается с любым препятствием — пропускаем (вырезаем дыру)
      let blocked = false;
      for (let i = 0; i < obstacles.length; i++) {
        if (boxOverlap(cell, obstacles[i])) { blocked = true; break; }
      }
      if (blocked) continue;

      // иначе кладём два треугольника плоскости на y=0
      pushQuad(
        x, 0, z,
        x + CELL, 0, z,
        x + CELL, 0, z + CELL,
        x, 0, z + CELL
      );
    }
  }

  return {
    positions: new Float32Array(positions),
    indices:   new Uint32Array(indices),
  };
};

export const NavMeshManager = {
  init: async (dispatch: React.Dispatch<Action>) => {
    dispatchRef = dispatch;
    ready = false;
    await init();
  },

  isReady: () => ready,

  buildNavMesh: async (buildings: Record<string, Building>, resourcesNodes: Record<string, ResourceNode>) => {
    mode = 'recast';
    const { positions, indices } = getSourceGeometries(buildings, resourcesNodes);
    console.log('[NavGen] verts:', positions.length / 3, 'tris:', indices.length / 3);
  
    const cfg = { ...rcConfig };
    const cfgVoxelized = {
      ...cfg,
      walkableHeight: Math.max(1, Math.ceil(cfg.walkableHeight / cfg.ch)),
      walkableClimb:  Math.max(0, Math.floor(cfg.walkableClimb  / cfg.ch)),
      walkableRadius: Math.max(0, Math.ceil (cfg.walkableRadius / cfg.cs)),
    };
  
    // 1. Tiled generator - primary method
    const tiledResult: GenerateTiledNavMeshResult = generateTiledNavMesh(positions, indices, {
      ...cfgVoxelized,
      tileSize: 48,
      borderSize: 8,
      maxTiles: 2048,
      maxPolys: 65536,
    } as any);
  
    if (!tiledResult.success) {
      console.warn('[NavGen] Tiled navmesh failed, trying coarse solo.');
    } else {
      navMesh = tiledResult.navMesh;
      navMeshQuery = new NavMeshQuery(navMesh);
      ready = true;
      console.log('[NavGen] Tiled navmesh built successfully.');
      return;
    }
  
    // 2. Coarse solo generator - fallback
    const coarseResult: GenerateSoloNavMeshResult = generateSoloNavMesh(
      positions,
      indices,
      { ...cfgVoxelized, cs: 0.5, ch: 0.3, detailSampleDist: 0, detailSampleMaxError: 1.5 } as any
    );
  
    if (!coarseResult.success) {
      console.warn('[NavGen] Coarse solo navmesh also failed.');
    } else {
      navMesh = coarseResult.navMesh;
      navMeshQuery = new NavMeshQuery(navMesh);
      ready = true;
      console.log('[NavGen] Coarse solo navmesh built successfully.');
      return;
    }
  
    // 3. Line mode - final fallback
    mode = 'fallback-line';
    navMesh = null;
    navMeshQuery = null;
    ready = true;
    console.error('[NavGen] All navmesh generation failed. Enabling line fallback mode.');
  },
  

  addObstacle: (_b: Building) => {},
  removeObstacle: (_b: Building) => {},

  requestPath: (unitId: string, startPos: Vector3, endPos: Vector3) => {
    if (pendingRequests.has(unitId) || !ready) return;
    pendingRequests.add(unitId);
    requestQueue.push({ unitId, startPos, endPos });
  },

  isRequestPending: (unitId: string) => pendingRequests.has(unitId),

  projectMove: (from: Vector3, to: Vector3): Vector3 => {
    if (!navMeshQuery) return to;
  
    const halfExtents = {
      x: rcConfig.walkableRadius + 0.1,
      y: rcConfig.walkableHeight,
      z: rcConfig.walkableRadius + 0.1,
    };
  
    // 1) Всегда сначала "пришпиливаем" старт к мешу
    const sRes: any = navMeshQuery.findClosestPoint(from, { halfExtents });
    if (!sRes?.point) return from;
    const s = { x: sRes.point.x, y: 0, z: sRes.point.z };
  
    // 2) Пробуем пройти вдоль поверхности от s к to
    try {
      const q: any = (navMeshQuery as any).moveAlongSurface
        ? (navMeshQuery as any).moveAlongSurface(s, to, { halfExtents })
        : null;
  
      const p = q?.result || q?.point || q?.position || q;
      if (p && Number.isFinite(p.x) && Number.isFinite(p.z)) {
        return { x: p.x, y: 0, z: p.z };
      }
    } catch { /* no-op */ }
  
    // 3) Фолбэк: ищем ближайшую к to, но вокруг текущего шага (to близко к s)
    const tRes: any = navMeshQuery.findClosestPoint(to, { halfExtents });
    if (tRes?.point) return { x: tRes.point.x, y: 0, z: tRes.point.z };
  
    // Если совсем ничего — остаёмся на месте
    return s;
  },

  snapToNav: (p: Vector3): Vector3 => {
    if (!navMeshQuery) return p;
    const halfExtents = {
      x: rcConfig.walkableRadius + 0.1,
      y: rcConfig.walkableHeight,
      z: rcConfig.walkableRadius + 0.1,
    };
    const r: any = navMeshQuery.findClosestPoint(p, { halfExtents });
    return r?.point ? { x: r.point.x, y: 0, z: r.point.z } : p;
  },

  safeSnap(to: Vector3, maxSnapDist: number): Vector3 {
    if (!navMeshQuery) return to;
  
    const halfExtents = {
      x: rcConfig.walkableRadius + 0.1,
      y: rcConfig.walkableHeight,
      z: rcConfig.walkableRadius + 0.1,
    };
  
    const r: any = navMeshQuery.findClosestPoint(to, { halfExtents });
    const q = r?.point;
    if (!q || !Number.isFinite(q.x) || !Number.isFinite(q.z)) return to;
  
    const dx = q.x - to.x, dz = q.z - to.z;
    const corr2 = dx*dx + dz*dz;
  
    // 1) Do not accept a clamp that is too large
    if (corr2 > maxSnapDist * maxSnapDist) return to;
  
    // 2) Discard a suspicious zero if the candidate step is far away
    if (Math.abs(q.x) < 1e-6 && Math.abs(q.z) < 1e-6) {
      const d02 = to.x*to.x + to.z*to.z;
      if (d02 > (maxSnapDist * maxSnapDist * 25)) return to;
    }
  
    return { x: q.x, y: 0, z: q.z };
  },

  advanceOnNav(from: Vector3, to: Vector3, maxStep: number): Vector3 {
    const stepSize = Math.max(maxStep, 0.001);

    const capToStep = (a: Vector3, b: Vector3, step: number): Vector3 => {
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      if (d2 <= step * step) {
        return { x: b.x, y: 0, z: b.z };
      }
      const inv = 1 / Math.sqrt(Math.max(d2, 1e-12));
      return { x: a.x + dx * inv * step, y: 0, z: a.z + dz * inv * step };
    };

    const linearStep = capToStep(from, to, stepSize);
    if (!navMeshQuery) {
      return linearStep;
    }

    const he = {
      x: rcConfig.walkableRadius + 0.1,
      y: rcConfig.walkableHeight,
      z: rcConfig.walkableRadius + 0.1,
    };

    let start = from;
    try {
      const sRes: any = navMeshQuery.findClosestPoint(from, { halfExtents: he });
      if (sRes?.point) {
        start = { x: sRes.point.x, y: 0, z: sRes.point.z };
      }
    } catch {
      // Ignore clamp errors and fall back to the original start point
    }

    const projected = capToStep(start, to, stepSize);
    const snapped = this.safeSnap(projected, Math.max(stepSize * 2, 0.5));

    const dx = snapped.x - start.x;
    const dz = snapped.z - start.z;
    const movedSq = dx * dx + dz * dz;
    const looksZero = (v: Vector3) => Math.abs(v.x) < 1e-6 && Math.abs(v.z) < 1e-6;

    if (movedSq < 1e-6) {
      const alt = this.safeSnap(linearStep, Math.max(stepSize * 2, 0.5));
      const altDx = alt.x - from.x;
      const altDz = alt.z - from.z;
      if (altDx * altDx + altDz * altDz >= 1e-6) {
        return alt;
      }
      return linearStep;
    }

    const farTarget2 = to.x * to.x + to.z * to.z;
    if (looksZero(snapped) && farTarget2 > 25 * 25) {
      const alt = this.safeSnap(linearStep, Math.max(stepSize * 2, 0.5));
      if (!looksZero(alt)) {
        return alt;
      }
      return linearStep;
    }

    return snapped;
  },

  processQueue: () => {
    if (!ready || !dispatchRef) return;

    for (let n = 0; n < 8; n++) {
      const req = requestQueue.shift();
      if (!req) break;
  
      const { unitId, startPos, endPos } = req;
  
      try {
        if (mode === 'fallback-line' || !navMeshQuery) {
          dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, path: [startPos, endPos], pathIndex: 0 } });
          pendingRequests.delete(unitId);
          continue;
        }

        const halfExtents = { x: rcConfig.walkableRadius + 0.1, y: rcConfig.walkableHeight, z: rcConfig.walkableRadius + 0.1 };

        // 1) Safely clamp START point
        const sRes: any = navMeshQuery.findClosestPoint(startPos, { halfExtents });
        if (!sRes?.point) {
            dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, pathTarget: undefined, status: UnitStatus.IDLE }});
            pendingRequests.delete(unitId);
            continue;
        }
        const s = { x: sRes.point.x, y: 0, z: sRes.point.z };
        // If clamp is too far from real start, or a suspicious zero, consider it a bad case
        if (d2(s, startPos) > 2*2 || (looksZero(s) && d2(startPos, {x:0,y:0,z:0} as any) > 25*25)) {
            dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, pathTarget: undefined, status: UnitStatus.IDLE }});
            pendingRequests.delete(unitId);
            continue;
        }

        // 2) Safely clamp END point
        const eRes: any = navMeshQuery.findClosestPoint(endPos, { halfExtents });
        if (!eRes?.point) {
            dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, pathTarget: undefined, status: UnitStatus.IDLE }});
            pendingRequests.delete(unitId);
            continue;
        }
        const e = { x: eRes.point.x, y: 0, z: eRes.point.z };
        // If clamp is too far from target or is a suspicious zero, don't path there
        if (d2(e, endPos) > 6*6 || (looksZero(e) && d2(endPos, {x:0,y:0,z:0} as any) > 25*25)) {
            dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, pathTarget: undefined, status: UnitStatus.IDLE }});
            pendingRequests.delete(unitId);
            continue;
        }
  
        let points: Vector3[] = [];
        try {
            const res: any = navMeshQuery.computePath(s, e, { halfExtents });
            points = extractPoints(res?.straightPath);
            if (!points.length) points = extractPoints(res?.path);
        } catch (err) {
            console.warn(`[NavMesh] Path computation failed for unit ${unitId}, trying to recover...`);
        }

        // --- Path Sanitization ---
        points = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.z));
        if (points.length) {
          // Discard (0,0) if the target is far away
          points = points.filter(p => !(looksZero(p) && d2(endPos, {x:0,y:0,z:0} as any) > 25*25));
          // Discard final points that are further than 6m from the desired target
          const MAX_END_ERR2 = 6*6;
          while (points.length && d2(points[points.length - 1], endPos) > MAX_END_ERR2) points.pop();
        }

        if (!points.length) {
            dispatchRef({ type:'UPDATE_UNIT', payload:{ id: unitId, pathTarget: undefined, status: UnitStatus.IDLE }});
            pendingRequests.delete(unitId);
            continue;
        }

        // --- Path Normalization ---
        const START_EPS = 0.50;
        if (points.length && d2(points[0], startPos) < START_EPS * START_EPS) {
          points.shift();
        }
    
        const SEG_EPS = 0.25;
        if(points.length > 1) {
            const compact: Vector3[] = [points[0]];
            for (let i = 1; i < points.length; i++) {
                const p = points[i];
                if (d2(compact[compact.length - 1], p) > SEG_EPS * SEG_EPS) {
                    compact.push(p);
                }
            }
            points = compact;
        }
        
        if (points.length >= 1) {
            dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, path: points, pathIndex: 0 } });
        } else {
            dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, pathTarget: undefined, status: UnitStatus.IDLE } });
        }
      } catch (e) {
        console.error('NavMesh pathfinding error for unit:', unitId, e);
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
    if (navMeshQuery) {
      navMeshQuery.destroy();
      navMeshQuery = null;
    }
    navMesh = null;
    ready = false;
  }
};