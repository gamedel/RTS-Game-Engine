import type { Dispatch } from 'react';
import PF, { Grid } from 'pathfinding';
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

// --- External Pathfinder ---
const finder = new PF.AStarFinder({
    allowDiagonal: true,
    dontCrossCorners: true,
});

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

function clampToGrid(node: { x: number; y: number }, W: number, H: number) {
    if (node.x < 0 || node.x >= W) node.x = Math.max(0, Math.min(W - 1, node.x));
    if (node.y < 0 || node.y >= H) node.y = Math.max(0, Math.min(H - 1, node.y));
}

function findNearestWalkable(grid: number[][], start: { x: number; y: number }): { x: number; y: number } | null {
    const H = grid.length;
    const W = grid[0]?.length || 0;
    const visited = new Set<string>();
    const queue: Array<{ x: number; y: number; d: number }> = [{ ...start, d: 0 }];
    const directions = [
        [1, 0], [-1, 0], [0, 1], [0, -1],
        [1, 1], [1, -1], [-1, 1], [-1, -1]
    ];
    const MAX_DISTANCE = 10;

    while (queue.length > 0) {
        const { x, y, d } = queue.shift()!;
        if (x < 0 || x >= W || y < 0 || y >= H) continue;
        const key = `${x},${y}`;
        if (visited.has(key)) continue;
        visited.add(key);
        if (grid[y][x] === 0) return { x, y };
        if (d >= MAX_DISTANCE) continue;
        for (const [dx, dy] of directions) {
            queue.push({ x: x + dx, y: y + dy, d: d + 1 });
        }
    }
    return null;
}

// --- Manager Implementation ---
type PathRequest = {
    unitId: string;
    startPos: Vector3;
    endPos: Vector3;
};

let dispatchRef: Dispatch<Action> | null = null;
let gridMatrix: number[][] | null = null;
let pathfindingGrid: Grid | null = null;
const requestQueue: PathRequest[] = [];
const pendingRequests = new Set<string>();

export const PathfindingManager = {
    init: (dispatch: Dispatch<Action>) => {
        dispatchRef = dispatch;
    },

    setGrid: (buildings: Record<string, Building>, resourcesNodes: Record<string, ResourceNode>) => {
        gridMatrix = createGrid(buildings, resourcesNodes);
        pathfindingGrid = new PF.Grid(gridMatrix);
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
        if (!pathfindingGrid || !gridMatrix || !dispatchRef) return;

        // Kick off one request per frame and process existing ones
        const request = requestQueue.shift();
        if (request) {
            const { unitId, startPos, endPos } = request;
            const H = gridMatrix.length,
                W = gridMatrix[0]?.length || 0;
            let start = toGridCoords(startPos);
            const end = toGridCoords(endPos);
            clampToGrid(start, W, H);
            clampToGrid(end, W, H);

            if (gridMatrix[start.y]?.[start.x] === 1) {
                const alt = findNearestWalkable(gridMatrix, start);
                if (alt) {
                    start = alt;
                } else {
                    pendingRequests.delete(unitId);
                    dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, pathTarget: undefined, status: UnitStatus.IDLE } });
                    return;
                }
            }

            const grid = pathfindingGrid.clone();
            const rawPath = finder.findPath(start.x, start.y, end.x, end.y, grid);
            pendingRequests.delete(unitId);
            if (rawPath && rawPath.length > 0) {
                const worldPath = rawPath.map(([x, y]) => fromGridCoords({ x, y }));
                dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, path: worldPath, pathIndex: 0, targetPosition: worldPath[0] } });
            } else {
                dispatchRef({ type: 'UPDATE_UNIT', payload: { id: unitId, pathTarget: undefined, status: UnitStatus.IDLE } });
            }
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
