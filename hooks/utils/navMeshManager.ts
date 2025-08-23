import { init, NavMeshQuery } from 'recast-navigation';
import { generateSoloNavMesh, GenerateSoloNavMeshResult } from 'recast-navigation/generators';
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
  cs: 0.3,
  ch: 0.2,
  walkableSlopeAngle: 60,
  walkableHeight: 1.8,
  walkableClimb: 0.6,
  walkableRadius: 0.6,
  maxEdgeLen: 20,
  maxSimplificationError: 1.0,
  minRegionArea: 2,
  mergeRegionArea: 10,
  maxVertsPerPoly: 6,
  detailSampleDist: 3,
  detailSampleMaxError: 0.5,
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
    indices: new Int32Array(indices),
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
        walkableClimb: Math.max(0, Math.floor(cfg.walkableClimb / cfg.ch)),
        walkableRadius: Math.max(0, Math.ceil(cfg.walkableRadius / cfg.cs)),
    };
  
    const res: GenerateSoloNavMeshResult = generateSoloNavMesh(positions, indices, cfgVoxelized as any);
  
    if (res.success) {
      navMesh = res.navMesh;
      navMeshQuery = new NavMeshQuery(navMesh);
      ready = true;
      return;
    }
  
    console.error('Failed to build NavMesh', res.error);
  
    // Fallback to "line mode" to unblock the game
    mode = 'fallback-line';
    navMesh = null;
    navMeshQuery = null;
    ready = true;
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
    const req = requestQueue.shift();
    if (!req) return;

    const { unitId, startPos, endPos } = req;

    try {
      if (mode === 'fallback-line') {
        // Simple straight line path
        dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, path: [startPos, endPos], pathIndex: 0 } });
        return;
      }
      
      if (!navMeshQuery) {
        dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, pathTarget: undefined, status: UnitStatus.IDLE } });
        return;
      };

      const halfExtents = { x: 2, y: 4, z: 2 };
      const { success, path } = navMeshQuery.computePath(startPos, endPos, { halfExtents });

      if (success && path.length > 0) {
        dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, path, pathIndex: 0 } });
      } else {
        dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, pathTarget: undefined, status: UnitStatus.IDLE } });
      }
    } catch (e) {
      console.error('NavMesh pathfinding error for unit:', unitId, e);
      dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, pathTarget: undefined, status: UnitStatus.IDLE } });
    } finally {
      pendingRequests.delete(unitId);
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