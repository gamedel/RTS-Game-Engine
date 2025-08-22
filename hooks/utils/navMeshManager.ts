import Recast from 'recast-navigation';
import { Building, ResourceNode, Vector3, Action, UnitStatus } from '../../types';
import { COLLISION_DATA } from '../../constants';

type RecastInstance = Awaited<ReturnType<typeof Recast>>;
type NavMesh = Recast['NavMesh'];
type NavMeshQuery = Recast['NavMeshQuery'];

type PathRequest = {
    unitId: string;
    startPos: Vector3;
    endPos: Vector3;
};

// --- Recast Configuration ---
const rcConfig = {
  cs: 0.3, // cell size
  ch: 0.2, // cell height
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

let recast: RecastInstance;
let navMesh: NavMesh;
let navMeshQuery: NavMeshQuery;
let dispatchRef: React.Dispatch<Action> | null = null;
const requestQueue: PathRequest[] = [];
const pendingRequests = new Set<string>();
let ready = false;

// Geometry collection for navmesh generation
const getSourceGeometries = (buildings: Record<string, Building>, resourcesNodes: Record<string, ResourceNode>) => {
    const positions: number[] = [];
    const indices: number[] = [];

    const addBox = (pos: Vector3, size: {width: number, depth: number}, height: number) => {
        const x = pos.x;
        const y = pos.y;
        const z = pos.z;
        const w = size.width / 2;
        const d = size.depth / 2;
        const h = height;

        const baseIndex = positions.length / 3;
        
        positions.push(
            x - w, y, z - d,
            x + w, y, z - d,
            x + w, y, z + d,
            x - w, y, z + d,
            x - w, y + h, z - d,
            x + w, y + h, z - d,
            x + w, y + h, z + d,
            x - w, y + h, z + d,
        );
        
        indices.push(
            baseIndex + 0, baseIndex + 1, baseIndex + 2,
            baseIndex + 0, baseIndex + 2, baseIndex + 3,
            baseIndex + 4, baseIndex + 5, baseIndex + 6,
            baseIndex + 4, baseIndex + 6, baseIndex + 7,
            baseIndex + 0, baseIndex + 4, baseIndex + 7,
            baseIndex + 0, baseIndex + 7, baseIndex + 3,
            baseIndex + 1, baseIndex + 5, baseIndex + 6,
            baseIndex + 1, baseIndex + 6, baseIndex + 2,
            baseIndex + 3, baseIndex + 2, baseIndex + 6,
            baseIndex + 3, baseIndex + 6, baseIndex + 7,
            baseIndex + 0, baseIndex + 1, baseIndex + 5,
            baseIndex + 0, baseIndex + 5, baseIndex + 4
        );
    };
    
    // Add ground plane
    const groundSize = 300;
    addBox({x: 0, y: -0.2, z: 0}, {width: groundSize, depth: groundSize}, 0.2);
    
    // Add buildings as obstacles
    Object.values(buildings).forEach(b => {
        // Only add fully constructed buildings to the initial mesh
        if (b.constructionProgress === undefined) {
            const size = COLLISION_DATA.BUILDINGS[b.buildingType];
            if (!size) return;
            addBox(b.position, size, 10); // Use a tall box to ensure it's an obstacle
        }
    });

    // Add resources as obstacles
    Object.values(resourcesNodes).forEach(r => {
        const size = COLLISION_DATA.RESOURCES[r.resourceType];
        if (!size) return;
        addBox(r.position, { width: size.radius * 2, depth: size.radius * 2 }, 10);
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
        recast = await Recast();
    },

    isReady: () => ready,

    buildNavMesh: async (buildings: Record<string, Building>, resourcesNodes: Record<string, ResourceNode>) => {
        const { positions, indices } = getSourceGeometries(buildings, resourcesNodes);
        
        const result = recast.buildSolo(positions, indices, rcConfig);

        if (!result.success) {
            console.error("Failed to build NavMesh", result);
            return;
        }

        navMesh = result.navMesh;
        navMeshQuery = new recast.NavMeshQuery(navMesh, 2048);
        ready = true;
    },
    
    addObstacle: (building: Building) => {
        if (!recast || !navMeshQuery) return;
        // In a full TileCache implementation, this would add a temporary obstacle.
        // For simplicity, we will rebuild the navmesh on building completion.
        // This is a placeholder for a more advanced dynamic obstacle system.
    },

    removeObstacle: (building: Building) => {
        if (!recast || !navMeshQuery) return;
        // Placeholder for removing a dynamic obstacle.
    },
    
    requestPath: (unitId: string, startPos: Vector3, endPos: Vector3) => {
        if (pendingRequests.has(unitId) || !ready) return;
        pendingRequests.add(unitId);
        requestQueue.push({ unitId, startPos, endPos });
    },

    isRequestPending: (unitId: string): boolean => {
        return pendingRequests.has(unitId);
    },
    
    processQueue: () => {
        if (requestQueue.length === 0 || !ready || !dispatchRef) return;
        
        const request = requestQueue.shift();
        if (!request) return;

        const { unitId, startPos, endPos } = request;

        try {
            const start = navMeshQuery.findNearestPoly(startPos, { halfExtents: { x: 2, y: 4, z: 2 } });
            const end = navMeshQuery.findNearestPoly(endPos, { halfExtents: { x: 2, y: 4, z: 2 } });

            if (!start.polyRef || !end.polyRef) {
                // Cannot find a start or end point on the navmesh
                 dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, pathTarget: undefined, status: UnitStatus.IDLE } });
            } else {
                const path = navMeshQuery.findPath(start.pos, end.pos, { halfExtents: { x: 0.5, y: 0.5, z: 0.5 } });

                if (path.success && path.path) {
                    const worldPath = path.path.map(p => ({ x: p.x, y: p.y, z: p.z }));
                    dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, path: worldPath, pathIndex: 0 } });
                } else {
                    // Pathfinding failed
                    dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, pathTarget: undefined, status: UnitStatus.IDLE } });
                }
            }
        } catch (error) {
            console.error("NavMesh pathfinding error for unit:", unitId, error);
            dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, pathTarget: undefined, status: UnitStatus.IDLE } });
        } finally {
            pendingRequests.delete(unitId);
        }
    },

    terminate: () => {
        dispatchRef = null;
        requestQueue.length = 0;
        pendingRequests.clear();
        if (navMesh) navMesh.destroy();
        if (navMeshQuery) navMeshQuery.destroy();
        ready = false;
    }
};