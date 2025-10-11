import { BufferedDispatch } from '../../state/batch';
import {
    GameState,
    Unit,
    UnitType,
    UnitStatus,
    Building,
    ResourceNode,
    ResourceType,
    WorkerOrder,
    ResearchCategory,
} from '../../types';
import {
    UNIT_CONFIG,
    BUILDING_CONFIG,
    REPAIR_HP_PER_TICK,
    REPAIR_TICK_TIME,
    RESEARCH_CONFIG,
} from '../../constants';
import { computeGatherAssignment } from '../utils/gatherSlots';
import { computeBuildingApproachPoint } from '../utils/buildingApproach';

type GatherOrder = Extract<WorkerOrder, { kind: 'gather' }>;
type BuildOrder = Extract<WorkerOrder, { kind: 'build' }>;
type RepairOrder = Extract<WorkerOrder, { kind: 'repair' }>;
type DropoffMap = Map<number, Building[]>;

const ARRIVAL_EPS = 0.25;
const GATHER_REPATH_INTERVAL_MS = 900;
const DROPOFF_REPATH_INTERVAL_MS = 900;
const BUILD_REPATH_INTERVAL_MS = 900;
const MAX_ORDER_RETRIES = 3;
const BUILD_TICK_TIME = 0.5;

const distanceSq = (ax: number, az: number, bx: number, bz: number) => {
    const dx = ax - bx;
    const dz = az - bz;
    return dx * dx + dz * dz;
};

const issueUnitUpdate = (dispatch: BufferedDispatch, unitId: string, payload: Partial<Unit>) => {
    dispatch({ type: 'UPDATE_UNIT', payload: { id: unitId, ...payload } });
};

const setWorkerIdle = (dispatch: BufferedDispatch, unit: Unit) => {
    issueUnitUpdate(dispatch, unit.id, {
        status: UnitStatus.IDLE,
        workerOrder: undefined,
        gatherTargetId: undefined,
        isHarvesting: false,
        harvestingResourceType: undefined,
        pathTarget: undefined,
        targetId: undefined,
        interactionAnchor: undefined,
        interactionRadius: undefined,
        gatherTimer: undefined,
        buildTimer: undefined,
        repairTimer: undefined,
    });
};

const getWorkerCapacity = (state: GameState, unit: Unit): number => {
    const base = UNIT_CONFIG[UnitType.WORKER].carryCapacity;
    const researchLevel = state.players[unit.playerId].research[ResearchCategory.WORKER_CAPACITY];
    if (!researchLevel) return base;
    const bonus = RESEARCH_CONFIG[ResearchCategory.WORKER_CAPACITY].bonus;
    return base + bonus * researchLevel;
};

const getDropoffsForPlayer = (dropoffMap: DropoffMap, playerId: number): Building[] =>
    dropoffMap.get(playerId) ?? [];

const findClosestDropoff = (unit: Unit, dropoffMap: DropoffMap): Building | null => {
    let best: Building | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const candidate of getDropoffsForPlayer(dropoffMap, unit.playerId)) {
        if (candidate.constructionProgress !== undefined) continue;
        const dist = distanceSq(unit.position.x, unit.position.z, candidate.position.x, candidate.position.z);
        if (dist < bestDist) {
            bestDist = dist;
            best = candidate;
        }
    }
    return best;
};

const reassignToNewResource = (state: GameState, unit: Unit, dispatch: BufferedDispatch): boolean => {
    const desiredType =
        unit.harvestingResourceType ||
        (unit.workerOrder && unit.workerOrder.kind === 'gather' ? unit.workerOrder.resourceType : undefined);
    if (!desiredType) return false;

    let best: ResourceNode | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const resource of Object.values(state.resourcesNodes)) {
        if (resource.resourceType !== desiredType) continue;
        if (resource.amount <= 0 || resource.isFalling) continue;
        const dist = distanceSq(unit.position.x, unit.position.z, resource.position.x, resource.position.z);
        if (dist < bestDist) {
            bestDist = dist;
            best = resource;
        }
    }

    if (!best) return false;

    dispatch({
        type: 'COMMAND_UNIT',
        payload: { unitId: unit.id, targetPosition: best.position, targetId: best.id },
    });
    return true;
};

const ensureMovingToAnchor = (
    dispatch: BufferedDispatch,
    unit: Unit,
    order: WorkerOrder,
    status: UnitStatus,
    targetId: string | undefined,
) => {
    const needsUpdate =
        unit.status !== status ||
        unit.targetId !== targetId ||
        !unit.pathTarget ||
        distanceSq(unit.pathTarget.x, unit.pathTarget.z, order.anchor.x, order.anchor.z) > 0.01;

    if (needsUpdate) {
        issueUnitUpdate(dispatch, unit.id, {
            status,
            targetId,
            pathTarget: order.anchor,
            interactionAnchor: order.anchor,
            interactionRadius: order.radius,
            path: undefined,
            pathIndex: undefined,
        });
    }
};

const refreshGatherAnchor = (
    state: GameState,
    unit: Unit,
    resource: ResourceNode,
    now: number,
    dispatch: BufferedDispatch,
    order: GatherOrder,
): GatherOrder | null => {
    const { anchor, radius } = computeGatherAssignment(state, unit, resource);
    const updatedOrder: GatherOrder = {
        ...order,
        anchor,
        radius,
        issuedAt: now,
        lastProgressAt: now,
        retries: order.retries + 1,
    };
    if (updatedOrder.retries > MAX_ORDER_RETRIES) {
        setWorkerIdle(dispatch, unit);
        return null;
    }

    issueUnitUpdate(dispatch, unit.id, {
        workerOrder: updatedOrder,
        status: UnitStatus.MOVING,
        targetId: resource.id,
        pathTarget: anchor,
        interactionAnchor: anchor,
        interactionRadius: radius,
        path: undefined,
        pathIndex: undefined,
    });
    return updatedOrder;
};

const refreshDropoffAnchor = (
    unit: Unit,
    dropoff: Building,
    now: number,
    dispatch: BufferedDispatch,
    order: GatherOrder,
): GatherOrder => {
    const approach = computeBuildingApproachPoint(unit, dropoff, dropoff.position);
    const radius = Math.hypot(approach.x - dropoff.position.x, approach.z - dropoff.position.z);
    const updatedOrder: GatherOrder = {
        ...order,
        dropoffId: dropoff.id,
        anchor: approach,
        radius,
        issuedAt: now,
        lastProgressAt: now,
        retries: order.retries + 1,
    };

    issueUnitUpdate(dispatch, unit.id, {
        workerOrder: updatedOrder,
        status: UnitStatus.MOVING,
        targetId: dropoff.id,
        pathTarget: approach,
        interactionAnchor: approach,
        interactionRadius: radius,
        path: undefined,
        pathIndex: undefined,
    });
    return updatedOrder;
};

const refreshBuildOrderAnchor = (
    unit: Unit,
    building: Building,
    now: number,
    dispatch: BufferedDispatch,
    order: BuildOrder,
): BuildOrder | null => {
    const approach = computeBuildingApproachPoint(unit, building, building.position);
    const radius = Math.hypot(approach.x - building.position.x, approach.z - building.position.z);
    const updatedOrder: BuildOrder = {
        ...order,
        anchor: approach,
        radius,
        issuedAt: now,
        lastProgressAt: now,
        retries: order.retries + 1,
    };

    if (updatedOrder.retries > MAX_ORDER_RETRIES) {
        setWorkerIdle(dispatch, unit);
        return null;
    }

    issueUnitUpdate(dispatch, unit.id, {
        workerOrder: updatedOrder,
        status: UnitStatus.MOVING,
        targetId: building.id,
        pathTarget: approach,
        interactionAnchor: approach,
        interactionRadius: radius,
        path: undefined,
        pathIndex: undefined,
    });
    return updatedOrder;
};

const refreshRepairOrderAnchor = (
    unit: Unit,
    building: Building,
    now: number,
    dispatch: BufferedDispatch,
    order: RepairOrder,
): RepairOrder | null => {
    const approach = computeBuildingApproachPoint(unit, building, building.position);
    const radius = Math.hypot(approach.x - building.position.x, approach.z - building.position.z);
    const updatedOrder: RepairOrder = {
        ...order,
        anchor: approach,
        radius,
        issuedAt: now,
        lastProgressAt: now,
        retries: order.retries + 1,
    };

    if (updatedOrder.retries > MAX_ORDER_RETRIES) {
        setWorkerIdle(dispatch, unit);
        return null;
    }

    issueUnitUpdate(dispatch, unit.id, {
        workerOrder: updatedOrder,
        status: UnitStatus.MOVING,
        targetId: building.id,
        pathTarget: approach,
        interactionAnchor: approach,
        interactionRadius: radius,
        path: undefined,
        pathIndex: undefined,
    });
    return updatedOrder;
};

const handleGatherOrder = (
    state: GameState,
    unit: Unit,
    order: GatherOrder,
    delta: number,
    dispatch: BufferedDispatch,
    dropoffMap: DropoffMap,
    now: number,
) => {
    let currentOrder = order;
    const resource = state.resourcesNodes[currentOrder.resourceId];

    if (!resource || resource.amount <= 0 || resource.isFalling) {
        if (!reassignToNewResource(state, unit, dispatch)) {
            setWorkerIdle(dispatch, unit);
        }
        return;
    }

    if (currentOrder.phase === 'travelToResource') {
        const distSq = distanceSq(unit.position.x, unit.position.z, currentOrder.anchor.x, currentOrder.anchor.z);
        if (distSq <= Math.pow(currentOrder.radius + ARRIVAL_EPS, 2)) {
            currentOrder = {
                ...currentOrder,
                phase: 'harvesting',
                issuedAt: now,
                lastProgressAt: now,
                retries: 0,
            };
            issueUnitUpdate(dispatch, unit.id, {
                status: UnitStatus.GATHERING,
                gatherTimer: 0,
                workerOrder: currentOrder,
                pathTarget: undefined,
            });
            return;
        }

        ensureMovingToAnchor(dispatch, unit, currentOrder, UnitStatus.MOVING, resource.id);

        if (now - currentOrder.issuedAt > GATHER_REPATH_INTERVAL_MS) {
            const refreshed = refreshGatherAnchor(state, unit, resource, now, dispatch, currentOrder);
            if (!refreshed) return;
            currentOrder = refreshed;
        }
        return;
    }

    if (currentOrder.phase === 'harvesting') {
        const gatherConfig = UNIT_CONFIG[UnitType.WORKER];
        const newTimer = (unit.gatherTimer ?? 0) + delta;
        if (newTimer < gatherConfig.gatherTime) {
            issueUnitUpdate(dispatch, unit.id, { gatherTimer: newTimer });
            return;
        }

        const remaining = Math.max(0, resource.amount - 1);
        dispatch({ type: 'UPDATE_RESOURCE_NODE', payload: { id: resource.id, amount: remaining } });
        if (remaining <= 0) {
            if (resource.resourceType === ResourceType.TREE) {
                dispatch({
                    type: 'UPDATE_RESOURCE_NODE',
                    payload: { id: resource.id, isFalling: true, fallStartTime: now },
                });
            } else {
                dispatch({
                    type: 'UPDATE_RESOURCE_NODE',
                    payload: { id: resource.id, isDepleting: true, depletionStartTime: now },
                });
            }
        }

        const resourceLabel = resource.resourceType === ResourceType.TREE ? 'WOOD' : 'GOLD';
        const currentPayloadAmount =
            unit.resourcePayload && unit.resourcePayload.type === resourceLabel ? unit.resourcePayload.amount : 0;
        const newPayloadAmount = currentPayloadAmount + 1;
        const payload = { type: resourceLabel as 'WOOD' | 'GOLD', amount: newPayloadAmount };
        const capacity = getWorkerCapacity(state, unit);

        if (newPayloadAmount >= capacity) {
            const dropoff = findClosestDropoff(unit, dropoffMap);
            if (!dropoff) {
                setWorkerIdle(dispatch, unit);
                return;
            }
            const approach = computeBuildingApproachPoint(unit, dropoff, dropoff.position);
            const dropRadius = Math.hypot(approach.x - dropoff.position.x, approach.z - dropoff.position.z);
            currentOrder = {
                ...currentOrder,
                phase: 'travelToDropoff',
                dropoffId: dropoff.id,
                anchor: approach,
                radius: dropRadius,
                issuedAt: now,
                lastProgressAt: now,
                retries: 0,
            };
            issueUnitUpdate(dispatch, unit.id, {
                status: UnitStatus.MOVING,
                targetId: dropoff.id,
                pathTarget: approach,
                interactionAnchor: approach,
                interactionRadius: dropRadius,
                gatherTimer: 0,
                resourcePayload: payload,
                workerOrder: currentOrder,
                path: undefined,
                pathIndex: undefined,
            });
            return;
        }

        issueUnitUpdate(dispatch, unit.id, {
            gatherTimer: 0,
            resourcePayload: payload,
            workerOrder: { ...currentOrder, lastProgressAt: now },
        });
        return;
    }

    if (currentOrder.phase === 'travelToDropoff') {
        let dropoff = currentOrder.dropoffId ? state.buildings[currentOrder.dropoffId] : undefined;
        if (!dropoff || dropoff.playerId !== unit.playerId || dropoff.constructionProgress !== undefined) {
            dropoff = findClosestDropoff(unit, dropoffMap);
            if (!dropoff) {
                setWorkerIdle(dispatch, unit);
                return;
            }
            currentOrder = refreshDropoffAnchor(unit, dropoff, now, dispatch, currentOrder);
            return;
        }

        ensureMovingToAnchor(dispatch, unit, currentOrder, UnitStatus.MOVING, dropoff.id);

        const distSq = distanceSq(unit.position.x, unit.position.z, currentOrder.anchor.x, currentOrder.anchor.z);
        if (distSq <= Math.pow(currentOrder.radius + ARRIVAL_EPS, 2)) {
            return; // Drop-off completion handled by unitLogic via WORKER_FINISH_DROPOFF
        }

        if (now - currentOrder.issuedAt > DROPOFF_REPATH_INTERVAL_MS) {
            currentOrder = refreshDropoffAnchor(unit, dropoff, now, dispatch, currentOrder);
        }
    }
};

const handleBuildOrder = (
    state: GameState,
    unit: Unit,
    order: BuildOrder,
    delta: number,
    dispatch: BufferedDispatch,
    now: number,
) => {
    let currentOrder = order;
    const building = state.buildings[currentOrder.buildingId];
    if (!building || building.constructionProgress === undefined) {
        setWorkerIdle(dispatch, unit);
        return;
    }

    if (currentOrder.phase === 'travelToSite') {
        const distSq = distanceSq(unit.position.x, unit.position.z, currentOrder.anchor.x, currentOrder.anchor.z);
        if (distSq <= Math.pow(currentOrder.radius + ARRIVAL_EPS, 2)) {
            currentOrder = {
                ...currentOrder,
                phase: 'building',
                issuedAt: now,
                lastProgressAt: now,
                retries: 0,
            };
            issueUnitUpdate(dispatch, unit.id, {
                status: UnitStatus.BUILDING,
                buildTimer: 0,
                workerOrder: currentOrder,
                pathTarget: undefined,
            });
            return;
        }

        ensureMovingToAnchor(dispatch, unit, currentOrder, UnitStatus.MOVING, building.id);

        if (now - currentOrder.issuedAt > BUILD_REPATH_INTERVAL_MS) {
            const refreshed = refreshBuildOrderAnchor(unit, building, now, dispatch, currentOrder);
            if (!refreshed) return;
            currentOrder = refreshed;
        }
        return;
    }

    const distSq = distanceSq(unit.position.x, unit.position.z, currentOrder.anchor.x, currentOrder.anchor.z);
    if (distSq > Math.pow(currentOrder.radius + ARRIVAL_EPS, 2)) {
        const travelOrder: BuildOrder = { ...currentOrder, phase: 'travelToSite' };
        const refreshed = refreshBuildOrderAnchor(unit, building, now, dispatch, travelOrder);
        if (!refreshed) return;
        return;
    }

    const newTimer = (unit.buildTimer ?? 0) + delta;
    if (newTimer >= BUILD_TICK_TIME) {
        const buildTime = BUILDING_CONFIG[building.buildingType].buildTime;
        const contribution = BUILD_TICK_TIME / buildTime;
        dispatch({ type: 'CONTRIBUTE_TO_BUILDING', payload: { buildingId: building.id, contribution } });
        issueUnitUpdate(dispatch, unit.id, {
            buildTimer: 0,
            workerOrder: { ...currentOrder, lastProgressAt: now },
        });
    } else {
        issueUnitUpdate(dispatch, unit.id, { buildTimer: newTimer });
    }
};

const handleRepairOrder = (
    state: GameState,
    unit: Unit,
    order: RepairOrder,
    delta: number,
    dispatch: BufferedDispatch,
    now: number,
) => {
    let currentOrder = order;
    const building = state.buildings[currentOrder.buildingId];
    if (!building || building.hp >= building.maxHp) {
        setWorkerIdle(dispatch, unit);
        return;
    }

    if (currentOrder.phase === 'travelToTarget') {
        const distSq = distanceSq(unit.position.x, unit.position.z, currentOrder.anchor.x, currentOrder.anchor.z);
        if (distSq <= Math.pow(currentOrder.radius + ARRIVAL_EPS, 2)) {
            currentOrder = {
                ...currentOrder,
                phase: 'repairing',
                issuedAt: now,
                lastProgressAt: now,
                retries: 0,
            };
            issueUnitUpdate(dispatch, unit.id, {
                status: UnitStatus.REPAIRING,
                repairTimer: 0,
                workerOrder: currentOrder,
                pathTarget: undefined,
            });
            return;
        }

        ensureMovingToAnchor(dispatch, unit, currentOrder, UnitStatus.MOVING, building.id);

        if (now - currentOrder.issuedAt > BUILD_REPATH_INTERVAL_MS) {
            const refreshed = refreshRepairOrderAnchor(unit, building, now, dispatch, currentOrder);
            if (!refreshed) return;
            currentOrder = refreshed;
        }
        return;
    }

    const distSq = distanceSq(unit.position.x, unit.position.z, currentOrder.anchor.x, currentOrder.anchor.z);
    if (distSq > Math.pow(currentOrder.radius + ARRIVAL_EPS, 2)) {
        const travelOrder: RepairOrder = { ...currentOrder, phase: 'travelToTarget' };
        const refreshed = refreshRepairOrderAnchor(unit, building, now, dispatch, travelOrder);
        if (!refreshed) return;
        return;
    }

    const newTimer = (unit.repairTimer ?? 0) + delta;
    if (newTimer >= REPAIR_TICK_TIME) {
        const newHp = Math.min(building.maxHp, building.hp + REPAIR_HP_PER_TICK);
        dispatch({ type: 'UPDATE_BUILDING', payload: { id: building.id, hp: newHp } });
        issueUnitUpdate(dispatch, unit.id, {
            repairTimer: 0,
            workerOrder: { ...currentOrder, lastProgressAt: now },
        });

        if (newHp >= building.maxHp) {
            setWorkerIdle(dispatch, unit);
        }
    } else {
        issueUnitUpdate(dispatch, unit.id, { repairTimer: newTimer });
    }
};

export const driveWorkerBehavior = (
    state: GameState,
    unit: Unit,
    delta: number,
    dispatch: BufferedDispatch,
    dropoffMap: DropoffMap,
    now: number,
) => {
    if (unit.unitType !== UnitType.WORKER || unit.isDying) return;
    const order = unit.workerOrder;
    if (!order) return;

    switch (order.kind) {
        case 'gather':
            handleGatherOrder(state, unit, order, delta, dispatch, dropoffMap, now);
            break;
        case 'build':
            handleBuildOrder(state, unit, order, delta, dispatch, now);
            break;
        case 'repair':
            handleRepairOrder(state, unit, order, delta, dispatch, now);
            break;
        default:
            break;
    }
};
