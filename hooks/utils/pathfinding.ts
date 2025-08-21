import type { Dispatch } from 'react';
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
const BUILDING_PADDING = MAX_UNIT_RADIUS + 1;

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

// --- Manager Implementation ---
type PathRequest = {
    unitId: string;
    startPos: Vector3;
    endPos: Vector3;
};

let dispatchRef: Dispatch<Action> | null = null;
let gridMatrix: number[][] | null = null;
const requestQueue: PathRequest[] = [];
const pendingRequests = new Set<string>();
let worker: Worker | null = null;

export const PathfindingManager = {
    init: (dispatch: Dispatch<Action>) => {
        dispatchRef = dispatch;
        worker = new Worker(new URL('./pathWorker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e: MessageEvent) => {
            const { type, id, path } = e.data as { type: string; id: string; path: number[][] };
            if (type !== 'path' || !dispatchRef) return;
            pendingRequests.delete(id);
            if (path && path.length > 0) {
                const worldPath = path.map(([x, y]) => fromGridCoords({ x, y }));
                dispatchRef({ type: 'UPDATE_UNIT', payload: { id, path: worldPath, pathIndex: 0, targetPosition: worldPath[0] } });
            } else {
                dispatchRef({ type: 'UPDATE_UNIT', payload: { id, pathTarget: undefined, status: UnitStatus.IDLE } });
            }
        };
    },

    setGrid: (buildings: Record<string, Building>, resourcesNodes: Record<string, ResourceNode>) => {
        gridMatrix = createGrid(buildings, resourcesNodes);
        worker?.postMessage({ type: 'setGrid', grid: gridMatrix });
    },

    requestPath: (unitId: string, startPos: Vector3, endPos: Vector3) => {
        if (pendingRequests.has(unitId) || !worker) return;
        pendingRequests.add(unitId);
        requestQueue.push({ unitId, startPos, endPos });
    },

    isRequestPending: (unitId: string): boolean => pendingRequests.has(unitId),

    processQueue: () => {
        if (!worker) return;
        const request = requestQueue.shift();
        if (request) {
            const start = toGridCoords(request.startPos);
            const end = toGridCoords(request.endPos);
            worker.postMessage({ type: 'findPath', id: request.unitId, start, end });
        }
    },

    terminate: () => {
        dispatchRef = null;
        worker?.terminate();
        worker = null;
        requestQueue.length = 0;
        pendingRequests.clear();
    }
};
