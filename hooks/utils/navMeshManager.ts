import { init, NavMeshQuery } from 'recast-navigation';
import { generateSoloNavMesh } from 'recast-navigation/generators';
import { Building, ResourceNode, Vector3, Action, UnitStatus } from '../../types';
import { COLLISION_DATA } from '../../constants';

let navMesh: any;
let navMeshQuery: NavMeshQuery | null = null;
let dispatchRef: React.Dispatch<Action> | null = null;
const requestQueue: PathRequest[] = [];
const pendingRequests = new Set<string>();
let ready = false;

type PathRequest = { unitId: string; startPos: Vector3; endPos: Vector3; };

const rcConfig = {
  cs: 0.3,
  ch: 0.2,
  walkableSlopeAngle: 60,
  walkableHeight: 2,
  walkableClimb: 1,
  walkableRadius: 1,
  maxEdgeLen: 20,
  maxSimplificationError: 1.3,
  minRegionArea: 8,
  mergeRegionArea: 20,
  maxVertsPerPoly: 6,
  detailSampleDist: 6,
  detailSampleMaxError: 1,
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

  // ground
  const groundSize = 300;
  addBox({ x: 0, y: -0.2, z: 0 }, { width: groundSize, depth: groundSize }, 0.2);

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
    indices: new Uint16Array(indices),
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
    const { positions, indices } = getSourceGeometries(buildings, resourcesNodes);

    const { success, navMesh: builtNavMesh } = generateSoloNavMesh(
      positions, indices, rcConfig as any
    );

    if (!success || !builtNavMesh) {
      console.error('Failed to build NavMesh');
      return;
    }

    navMesh = builtNavMesh;
    navMeshQuery = new NavMeshQuery(navMesh);
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
    if (!ready || !dispatchRef || !navMeshQuery) return;
    const req = requestQueue.shift();
    if (!req) return;

    const { unitId, startPos, endPos } = req;

    try {
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