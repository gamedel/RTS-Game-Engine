import type { Dispatch } from 'react';
import { Building, ResourceNode, Vector3, Action, UnitStatus, UnitType } from '../../types';
import { COLLISION_DATA } from '../../constants';
import * as THREE from 'three';

// --- Pathfinding Constants ---
const WORLD_SIZE = 300;
const GRID_RESOLUTION = 1; // 1 grid cell = 1 world unit area.
const GRID_SIZE = WORLD_SIZE * GRID_RESOLUTION;
const GRID_OFFSET = GRID_SIZE / 2;

const MAX_UNIT_RADIUS = Math.max(
    ...Object.values(COLLISION_DATA.UNITS).map((u: any) => u.radius)
);
// Exported so other modules can use the same obstacle padding
export const BUILDING_PADDING = MAX_UNIT_RADIUS + 0.5;

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
        const minGX = Math.max(0, Math.floor(box.minX * GRID_RESOLUTION + GRID_OFFSET));
        const maxGX = Math.min(GRID_SIZE - 1, Math.ceil(box.maxX * GRID_RESOLUTION + GRID_OFFSET));
        const minGZ = Math.max(0, Math.floor(box.minZ * GRID_RESOLUTION + GRID_OFFSET));
        const maxGZ = Math.min(GRID_SIZE - 1, Math.ceil(box.maxZ * GRID_RESOLUTION + GRID_OFFSET));
        for (let gz = minGZ; gz <= maxGZ; gz++) {
            const row = grid[gz];
            for (let gx = minGX; gx <= maxGX; gx++) row[gx] = 1;
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
        if (r.isFalling || r.isDepleting) return;
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

export function getBuildingApproachPoint(
    building: Building,
    from: Vector3,
    unitType: UnitType
): Vector3 {
    const size = COLLISION_DATA.BUILDINGS[building.buildingType];
    const halfW = size.width * 0.5 + BUILDING_PADDING;
    const halfD = size.depth * 0.5 + BUILDING_PADDING;
    const eps = 0.08; // ensure the point lies just outside the blocked band

    const c = new THREE.Vector3(building.position.x, 0, building.position.z);
    const d = new THREE.Vector3(from.x, 0, from.z).sub(c);
    if (d.lengthSq() < 1e-6) d.set(1, 0, 0);

    const k = Math.max(Math.abs(d.x) / halfW, Math.abs(d.z) / halfD);
    const edge = c.clone().add(d.divideScalar(k));

    edge.x += Math.sign(edge.x - c.x) * eps;
    edge.z += Math.sign(edge.z - c.z) * eps;

    return { x: edge.x, y: 0, z: edge.z };
}

// --- Manager Implementation ---
type PathRequest = {
    unitId: string;
    startPos: Vector3;
    endPos: Vector3;
};

let dispatchRef: Dispatch<Action> | null = null;
let gridMatrix: number[][] | null = null;
let lastSignature: string | null = null;
let gridReady = false;
const requestQueue: PathRequest[] = [];
const pendingRequests = new Set<string>();
let worker: Worker | null = null;

export const PathfindingManager = {
    init: (dispatch: Dispatch<Action>) => {
        dispatchRef = dispatch;
        worker = new Worker(new URL('./pathWorker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e: MessageEvent) => {
            const msg = e.data as any;
            if (msg.type === 'gridReady') {
                gridReady = true;
                return;
            }
            if (msg.type !== 'path' || !dispatchRef) return;
            const { id, path } = msg as { id: string; path: number[][] };
            pendingRequests.delete(id);
            if (path && path.length > 0) {
                const worldPath = path.map(([x, y]) => fromGridCoords({ x, y }));
                dispatchRef({ type: 'UPDATE_UNIT', payload: { id, path: worldPath, pathIndex: 0, targetPosition: worldPath[0] } });
            } else {
                dispatchRef({ type: 'UPDATE_UNIT', payload: { id, pathTarget: undefined, status: UnitStatus.IDLE } });
            }
        };
    },

    setGrid: (
        buildings: Record<string, Building>,
        resourcesNodes: Record<string, ResourceNode>,
        signature?: string
    ) => {
        if (signature && signature === lastSignature) return;
        lastSignature = signature || null;
        gridReady = false;
        gridMatrix = createGrid(buildings, resourcesNodes);
        worker?.postMessage({ type: 'setGrid', grid: gridMatrix });
    },

    requestPath: (unitId: string, startPos: Vector3, endPos: Vector3) => {
        if (!worker) return;
        if (pendingRequests.has(unitId)) return;
        if (requestQueue.some(r => r.unitId === unitId)) return;
        requestQueue.push({ unitId, startPos, endPos });
    },

    isRequestPending: (unitId: string): boolean => pendingRequests.has(unitId),

    processQueue: () => {
        if (!worker || !gridReady) return;
        for (let i = 0; i < 2; i++) {
            const request = requestQueue.shift();
            if (!request) break;
            const start = toGridCoords(request.startPos);
            const end = toGridCoords(request.endPos);
            pendingRequests.add(request.unitId);
            worker.postMessage({ type: 'findPath', id: request.unitId, start, end });
        }
    },

    terminate: () => {
        dispatchRef = null;
        worker?.terminate();
        worker = null;
        requestQueue.length = 0;
        pendingRequests.clear();
        gridReady = false;
        lastSignature = null;
        gridMatrix = null;
    }
};
