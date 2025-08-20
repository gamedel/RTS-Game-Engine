import * as PF from 'pathfinding';
import { Building, ResourceNode, Vector3, Action, UnitStatus } from '../../types';
import { COLLISION_DATA } from '../../constants';

// --- Pathfinding Constants ---
const WORLD_SIZE = 300;
const GRID_RESOLUTION = 2; // Each grid cell represents a 0.5x0.5 world unit area.
const GRID_SIZE = WORLD_SIZE * GRID_RESOLUTION;
const GRID_OFFSET = GRID_SIZE / 2;

const MAX_UNIT_RADIUS = Math.max(
    ...Object.values(COLLISION_DATA.UNITS).map((u: any) => u.radius)
);
const BUILDING_PADDING = MAX_UNIT_RADIUS + 0.5;

// --- Helper Functions ---
const toGridCoords = (pos: Vector3) => ({
    x: Math.round(pos.x * GRID_RESOLUTION + GRID_OFFSET),
    y: Math.round(pos.z * GRID_RESOLUTION + GRID_OFFSET)
});

const fromGridCoords = (node: { x: number, y: number }): Vector3 => ({
    x: (node.x - GRID_OFFSET) / GRID_RESOLUTION,
    y: 0,
    z: (node.y - GRID_OFFSET) / GRID_RESOLUTION,
});

const createGrid = (buildings: Record<string, Building>, resourcesNodes: Record<string, ResourceNode>): number[][] => {
    const grid = Array(GRID_SIZE).fill(0).map(() => Array(GRID_SIZE).fill(0));

    const fillGrid = (box: { minX: number, maxX: number, minZ: number, maxZ: number }) => {
        for (let x = Math.floor(box.minX); x <= Math.ceil(box.maxX); x++) {
            for (let z = Math.floor(box.minZ); z <= Math.ceil(box.maxZ); z++) {
                const gridX = Math.round(x * GRID_RESOLUTION + GRID_OFFSET);
                const gridZ = Math.round(z * GRID_RESOLUTION + GRID_OFFSET);
                if (gridX >= 0 && gridX < GRID_SIZE && gridZ >= 0 && gridZ < GRID_SIZE) {
                    grid[gridZ][gridX] = 1; // Mark as unwalkable
                }
            }
        }
    };

    Object.values(buildings).forEach(b => {
        const size = COLLISION_DATA.BUILDINGS[b.buildingType];
        if (!size) return;
        const padding = BUILDING_PADDING;
        const box = {
            minX: b.position.x - (size.width / 2) - padding,
            maxX: b.position.x + (size.width / 2) + padding,
            minZ: b.position.z - (size.depth / 2) - padding,
            maxZ: b.position.z + (size.depth / 2) + padding,
        };
        fillGrid(box);
    });

    Object.values(resourcesNodes).forEach(r => {
        const size = COLLISION_DATA.RESOURCES[r.resourceType];
        if (!size) return;
        const padding = 0.5;
        const box = {
            minX: r.position.x - size.radius - padding,
            maxX: r.position.x + size.radius + padding,
            minZ: r.position.z - size.radius - padding,
            maxZ: r.position.z + size.radius + padding,
        };
        fillGrid(box);
    });

    return grid;
};

// This function is no longer used but kept for potential future use with different pathfinders.
const simplifyPath = (path: Vector3[]): Vector3[] => {
    if (path.length < 3) return path;
    const newPath: Vector3[] = [path[0]];
    for (let i = 1; i < path.length - 1; i++) {
        const p1 = newPath[newPath.length - 1];
        const p2 = path[i];
        const p3 = path[i + 1];
        
        const dx1 = p2.x - p1.x;
        const dz1 = p2.z - p1.z;
        const dx2 = p3.x - p2.x;
        const dz2 = p3.z - p2.z;

        if (Math.abs(dx1 * dz2 - dx2 * dz1) > 0.01) {
            newPath.push(p2);
        }
    }
    newPath.push(path[path.length - 1]);
    return newPath;
};

function findPath(startPos: Vector3, endPos: Vector3, grid: number[][]): Vector3[] | null {
    const start = toGridCoords(startPos);
    let end = toGridCoords(endPos);
    const H = grid.length, W = grid[0]?.length || 0;

    if (start.x < 0 || start.x >= W || start.y < 0 || start.y >= H) {
        start.x = Math.max(0, Math.min(W - 1, start.x));
        start.y = Math.max(0, Math.min(H - 1, start.y));
    }
    if (end.x < 0 || end.x >= W || end.y < 0 || end.y >= H) {
        end.x = Math.max(0, Math.min(W - 1, end.x));
        end.y = Math.max(0, Math.min(H - 1, end.y));
    }

    if (grid[start.y]?.[start.x] === 1) {
        // Start point is on an obstacle, can't path
        return null;
    }

    if (grid[end.y]?.[end.x] === 1) {
        // End point is on an obstacle, find a nearby walkable tile.
        let best = null;
        let bestDist = Infinity;
        const searchRadius = 20; // Search up to 10 world units away (20 grid cells)
        for (let r = 1; r < searchRadius && !best; r++) {
            for (let dy = -r; dy <= r; dy++) {
                for (let dx = -r; dx <= r; dx++) {
                    if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                    const nx = end.x + dx, ny = end.y + dy;
                    if (ny >= 0 && ny < H && nx >= 0 && nx < W && grid[ny][nx] === 0) {
                        const d = Math.hypot(dx, dy);
                        if (d < bestDist) {
                            bestDist = d;
                            best = { x: nx, y: ny };
                        }
                    }
                }
            }
        }
        if (best) {
            end = best;
        } else {
            // No walkable tile found near destination
            return null;
        }
    }

    const pfGrid = new PF.Grid(grid);
    const finder = (PF.JumpPointFinder as any)({
        diagonalMovement: PF.DiagonalMovement.OnlyWhenNoObstacles,
    });
    const rawPath = finder.findPath(start.x, start.y, end.x, end.y, pfGrid);

    if (!rawPath || rawPath.length === 0) return null;

    const worldPath = rawPath.map(([x, y]) => fromGridCoords({ x, y }));
    // FIX: Path simplification is disabled. This provides a more detailed path
    // that prevents units from cutting corners and clipping through buildings.
    return worldPath;
}

// --- Manager Implementation ---
type PathRequest = {
    unitId: string;
    startPos: Vector3;
    endPos: Vector3;
};

let dispatchRef: React.Dispatch<Action> | null = null;
let pathfindingGrid: number[][] | null = null;
const requestQueue: PathRequest[] = [];
const pendingRequests = new Set<string>();

export const PathfindingManager = {
    init: (dispatch: React.Dispatch<Action>) => {
        dispatchRef = dispatch;
    },

    setGrid: (buildings: Record<string, Building>, resourcesNodes: Record<string, ResourceNode>) => {
        pathfindingGrid = createGrid(buildings, resourcesNodes);
    },

    requestPath: (unitId: string, startPos: Vector3, endPos: Vector3) => {
        if (pendingRequests.has(unitId)) return;
        pendingRequests.add(unitId);
        requestQueue.push({ unitId, startPos, endPos });
    },

    isRequestPending: (unitId: string): boolean => {
        return pendingRequests.has(unitId);
    },
    
    // This will be called on each game tick to process a part of the queue
    processQueue: () => {
        if (requestQueue.length === 0 || !pathfindingGrid || !dispatchRef) return;
        
        // Process one request per frame to distribute the load
        const request = requestQueue.shift();
        if (!request) return;

        const { unitId, startPos, endPos } = request;

        try {
            const path = findPath(startPos, endPos, pathfindingGrid);

            if (path && path.length > 0) {
                dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, path, pathIndex: 0, targetPosition: path[0] } });
            } else {
                dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, pathTarget: undefined, status: UnitStatus.IDLE } });
            }
        } catch (error) {
            console.error("Pathfinding error for unit:", unitId, error);
            // Ensure the unit doesn't get stuck waiting for a path
            dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, pathTarget: undefined, status: UnitStatus.IDLE } });
        } finally {
            // Remove from pending regardless of outcome
            pendingRequests.delete(unitId);
        }
    },

    terminate: () => {
        // Clear everything on cleanup
        dispatchRef = null;
        pathfindingGrid = null;
        requestQueue.length = 0;
        pendingRequests.clear();
    }
};