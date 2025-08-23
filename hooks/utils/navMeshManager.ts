import { init, NavMeshQuery } from 'recast-navigation';
import { generateSoloNavMesh, generateTiledNavMesh, GenerateSoloNavMeshResult, GenerateTiledNavMeshResult } from 'recast-navigation/generators';
import { Building, ResourceNode, Vector3, Action, UnitStatus } from '../../types';
import { COLLISION_DATA } from '../../constants';

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

const getSourceGeometries = (buildings: Record<string, Building>, resourcesNodes: Record<string, ResourceNode>) => {
  const positions: number[] = [];
  const indices: number[] = [];

  const addBox = (pos: Vector3, size: { width: number; depth: number }, height: number) => {
    const x = pos.x, y = pos.y, z = pos.z;
    const w = size.width / 2, d = size.depth / 2, h = height;
    const base = positions.length / 3;

    positions.push(
      x - w, y, z - d,  x + w, y, z - d,  x + w, y, z + d,  x - w, y, z + d,
      x - w, y + h, z - d,  x + w, y + h, z - d,  x + w, y + h, z + d,  x - w, y + h, z + d
    );
    indices.push(
      base+0, base+1, base+2,  base+0, base+2, base+3,
      base+4, base+5, base+6,  base+4, base+6, base+7,
      base+0, base+4, base+7,  base+0, base+7, base+3,
      base+1, base+5, base+6,  base+1, base+6, base+2,
      base+3, base+2, base+6,  base+3, base+6, base+7,
      base+0, base+1, base+5,  base+0, base+5, base+4
    );
  };

  const addGroundSlab = (size: number, height = 2) => {
    addBox({ x: 0, y: -height / 2, z: 0 }, { width: size, depth: size }, height);
  };

  const groundSize = 300;
  addGroundSlab(groundSize, 2);


  // buildings
  Object.values(buildings).forEach(b => {
    if (b.constructionProgress === undefined) {
      const sz = COLLISION_DATA.BUILDINGS[b.buildingType];
      if (sz) addBox(b.position, sz, 10);
    }
  });

  // resources
  Object.values(resourcesNodes).forEach(r => {
    const sz = COLLISION_DATA.RESOURCES[r.resourceType];
    if (sz) addBox(r.position, { width: sz.radius * 2, depth: sz.radius * 2 }, 10);
  });

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
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

  processQueue: () => {
    if (!ready || !dispatchRef) return;

    for (let n = 0; n < 8; n++) {
      const req = requestQueue.shift();
      if (!req) break;
  
      const { unitId, startPos, endPos } = req;
  
      try {
        if (mode === 'fallback-line') {
          dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, path: [startPos, endPos], pathIndex: 0 } });
          continue;
        }
        if (!navMeshQuery) {
          dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, pathTarget: undefined, status: UnitStatus.IDLE } });
          continue;
        }
  
        const lift = (p: Vector3): Vector3 => ({ x: p.x, y: 0.5, z: p.z });
  
        const halfExtents = { x: 2, y: 4, z: 2 };
        const res: any = navMeshQuery.computePath(lift(startPos), lift(endPos), { halfExtents });
  
        let points: Vector3[] = [];
  
        // 1) Try straightPath (most reliable source of coordinates)
        const sp = res?.straightPath;
        if (sp && sp.length) {
          if (Array.isArray(sp)) {
            // Either an array of arrays or an array of objects
            if (Array.isArray(sp[0])) {
              // [[x,y,z],...]
              points = (sp as number[][]).map(([x, _y, z]) => ({ x, y: 0, z }));
            } else if (typeof sp[0] === 'number') {
              // Flat Float32Array/number[]: [x,y,z,x,y,z,...]
              const arr = sp as number[];
              for (let i = 0; i + 2 < arr.length; i += 3) {
                points.push({ x: arr[i], y: 0, z: arr[i + 2] });
              }
            } else if (typeof sp[0] === 'object' && sp[0] !== null) {
              // [{x,y,z}, ...]
              points = (sp as any[]).map(p => ({ x: p.x, y: 0, z: p.z }));
            }
          }
        }
  
        // 2) If straightPath is missing, the library might put coordinates in res.path
        if (!points.length && res?.path && res.path.length) {
          const p0 = res.path[0];
          if (typeof p0 === 'number') {
            // These are polyRefs, not coordinates - skip.
          } else if (Array.isArray(p0)) {
            points = (res.path as number[][]).map(([x, _y, z]) => ({ x, y: 0, z }));
          } else if (typeof p0 === 'object' && p0 !== null) {
            points = (res.path as any[]).map(p => ({ x: p.x, y: 0, z: p.z }));
          }
        }
  
        // 3) If still no coordinates, use a direct line as a fallback.
        if (points.length < 2) {
          points = [startPos, endPos];
        }
  
        // Sanity-check: remove NaN / infinity
        points = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.z));
  
        if (points.length >= 2) {
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