import * as Recast from 'recast-navigation';
import { Building, ResourceNode, Vector3, Action, UnitStatus } from '../../types';
import { COLLISION_DATA } from '../../constants';

// esm.sh can wrap modules in a `default` export. This handles that case,
// falling back to the direct namespace if `default` doesn't exist.
const RecastModule = (Recast as any).default ?? Recast;

type RecastInstance = Awaited<ReturnType<typeof RecastModule.init>>;

let recast: RecastInstance;
let navMesh: Recast.NavMesh;
let navMeshQuery: Recast.NavMeshQuery;
let dispatchRef: React.Dispatch<Action> | null = null;
const requestQueue: PathRequest[] = [];
const pendingRequests = new Set<string>();
let ready = false;

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
        recast = await RecastModule.init();
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
        navMeshQuery = new RecastModule.NavMeshQuery({ navMesh, maxNodes: 2048 });
        ready = true;
    },
    
    addObstacle: (building: Building) => {
        if (!navMeshQuery) return;
        // In a full TileCache implementation, this would add a temporary obstacle.
        // For simplicity, we will rebuild the navmesh on building completion.
        // This is a placeholder for a more advanced dynamic obstacle system.
    },

    removeObstacle: (building: Building) => {
        if (!navMeshQuery) return;
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
            const queryHalfExtents = { x: 2, y: 4, z: 2 };
            const start = navMeshQuery.findNearestPoly(startPos, { halfExtents: queryHalfExtents });
            const end = navMeshQuery.findNearestPoly(endPos, { halfExtents: queryHalfExtents });

            if (!start.nearestRef || !end.nearestRef) {
                // Cannot find a start or end point on the navmesh
                 dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, pathTarget: undefined, status: UnitStatus.IDLE } });
            } else {
                const filter = new RecastModule.QueryFilter();
                const findPathResult = navMeshQuery.findPath(start.nearestRef, start.nearestPoint, end.nearestRef, end.nearestPoint, filter);

                if (findPathResult.success && findPathResult.polys.size > 0) {
                     const findStraightPathResult = navMeshQuery.findStraightPath(start.nearestPoint, end.nearestPoint, findPathResult.polys, { maxStraightPathPoints: 256, straightPathOptions: 0 });
                    
                    if (findStraightPathResult.success && findStraightPathResult.straightPathCount > 0) {
                        const worldPath: Vector3[] = [];
                        for (let i = 0; i < findStraightPathResult.straightPathCount; i++) {
                            worldPath.push({
                                x: findStraightPathResult.straightPath.get(i * 3),
                                y: findStraightPathResult.straightPath.get(i * 3 + 1),
                                z: findStraightPathResult.straightPath.get(i * 3 + 2),
                            });
                        }
                        dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, path: worldPath, pathIndex: 0 } });
                    } else {
                         // Pathfinding failed
                        dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, pathTarget: undefined, status: UnitStatus.IDLE } });
                    }
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