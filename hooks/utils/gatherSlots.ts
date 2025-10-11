import { GameState, ResourceNode, Unit, UnitType, Vector3 } from '../../types';
import { COLLISION_DATA, RESOURCE_NODE_INTERACTION_RADIUS } from '../../constants';

export type GatherAssignment = {
    anchor: Vector3;
    radius: number;
    slotIndex: number;
};

const WORKERS_PER_RING = 8;
const MIN_RING_SPACING = 0.75;
const ANGLE_CACHE = new Map<string, number>();

const getBaseAngle = (resourceId: string): number => {
    let cached = ANGLE_CACHE.get(resourceId);
    if (cached !== undefined) {
        return cached;
    }
    let hash = 0;
    for (let i = 0; i < resourceId.length; i++) {
        hash = (hash * 31 + resourceId.charCodeAt(i)) >>> 0;
    }
    const angle = ((hash % 360) * Math.PI) / 180;
    ANGLE_CACHE.set(resourceId, angle);
    return angle;
};

const getWorkerRadius = (unit: Unit): number => {
    const collision = COLLISION_DATA.UNITS[unit.unitType];
    return collision?.radius ?? COLLISION_DATA.UNITS[UnitType.WORKER].radius;
};

const collectGatherers = (state: GameState, resourceId: string, worker: Unit): Unit[] => {
    const gatherers = Object.values(state.units).filter(other =>
        other.unitType === UnitType.WORKER &&
        !other.isDying &&
        (other.gatherTargetId === resourceId || other.targetId === resourceId || other.id === worker.id)
    );
    if (!gatherers.some(u => u.id === worker.id)) {
        gatherers.push(worker);
    }
    gatherers.sort((a, b) => a.id.localeCompare(b.id));
    return gatherers;
};

/**
 * Determines a deterministic anchor point and distance for a worker harvesting a resource.
 * Workers are distributed on concentric rings to avoid crowding and emulate Warcraft-style gathering.
 */
export const computeGatherAssignment = (state: GameState, worker: Unit, resource: ResourceNode): GatherAssignment => {
    const gatherers = collectGatherers(state, resource.id, worker);
    const slotIndex = gatherers.findIndex(u => u.id === worker.id);
    const ringIndex = Math.floor(slotIndex / WORKERS_PER_RING);
    const slotInRing = slotIndex % WORKERS_PER_RING;

    const workerRadius = getWorkerRadius(worker);
    const resourceRadius = RESOURCE_NODE_INTERACTION_RADIUS[resource.resourceType] ?? 1;
    const baseRadius = resourceRadius + workerRadius + 0.3;
    const ringSpacing = Math.max(MIN_RING_SPACING, workerRadius * 1.7);
    const radius = baseRadius + ringIndex * ringSpacing;

    const baseAngle = getBaseAngle(resource.id);
    const angleStep = (Math.PI * 2) / WORKERS_PER_RING;
    const angle = baseAngle + slotInRing * angleStep + ringIndex * (angleStep * 0.5);

    const anchor: Vector3 = {
        x: resource.position.x + Math.cos(angle) * radius,
        y: resource.position.y,
        z: resource.position.z + Math.sin(angle) * radius,
    };

    return { anchor, radius, slotIndex };
};
