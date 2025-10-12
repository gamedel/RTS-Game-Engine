import { v4 as uuidv4 } from 'uuid';
import { GameState, Action, Unit, GameObjectType, UnitType, UnitStatus, Building, ResourceNode, FloatingText, UnitStance, BuildingType, ResourceType, Vector3, ResearchCategory, WorkerOrder, UnitOrderType, UnitOrder, UnitCommandSource } from '../../types';
import { UNIT_CONFIG, COLLISION_DATA, RESEARCH_CONFIG } from '../../constants';
import { AUTO_COMBAT_SQUAD_ID } from '../../hooks/gameLogic/threatSystem';
import { computeBuildingApproachPoint } from '../../hooks/utils/buildingApproach';
import { computeGatherAssignment } from '../../hooks/utils/gatherSlots';

type CommandTarget = Unit | Building | ResourceNode;

const DROP_OFF_BUILDING_TYPES = new Set<BuildingType>([
    BuildingType.TOWN_HALL,
    BuildingType.WAREHOUSE,
]);

const isDropoffBuilding = (building: Building): boolean =>
    DROP_OFF_BUILDING_TYPES.has(building.buildingType);

const getBuildingApproach = (unit: Unit, building: Building, desired: Vector3 | undefined) => {
    const approach = computeBuildingApproachPoint(unit, building, desired ?? building.position);
    const radius = Math.hypot(approach.x - building.position.x, approach.z - building.position.z);
    return { approach, radius };
};

const cloneVector = (vec: Vector3): Vector3 => ({ x: vec.x, y: vec.y, z: vec.z });

const resetWorkerState = (worker: Unit) => ({
    workerOrder: undefined,
    isHarvesting: false,
    harvestingResourceType: undefined,
    gatherTargetId: undefined,
    buildTask: undefined,
    repairTask: undefined,
    gatherTimer: undefined,
    buildTimer: undefined,
    repairTimer: undefined,
});

const createGatherOrder = (
    state: GameState,
    worker: Unit,
    resource: ResourceNode,
    now: number,
    anchor: Vector3,
    radius: number,
): WorkerOrder => ({
    kind: 'gather',
    resourceId: resource.id,
    resourceType: resource.resourceType,
    phase: 'travelToResource',
    anchor,
    radius,
    dropoffId: undefined,
    issuedAt: now,
    lastProgressAt: now,
    retries: 0,
});

const createBuildOrder = (
    building: Building,
    anchor: Vector3,
    radius: number,
    now: number,
): WorkerOrder => ({
    kind: 'build',
    buildingId: building.id,
    phase: 'travelToSite',
    anchor,
    radius,
    issuedAt: now,
    lastProgressAt: now,
    retries: 0,
});

const createRepairOrder = (
    building: Building,
    anchor: Vector3,
    radius: number,
    now: number,
): WorkerOrder => ({
    kind: 'repair',
    buildingId: building.id,
    phase: 'travelToTarget',
    anchor,
    radius,
    issuedAt: now,
    lastProgressAt: now,
    retries: 0,
});

const stripWorkerOrders = (unit: Unit): Unit => {
    const cleared = resetWorkerState(unit);
    return {
        ...unit,
        ...cleared,
        finalDestination: undefined,
    };
};

const applyGenericUnitCommand = (
    state: GameState,
    unit: Unit,
    target: CommandTarget | null,
    targetPosition: Vector3 | undefined,
    requestedFinalDestination: Vector3 | undefined,
): Unit => {
    let nextTargetId: string | undefined = target ? target.id : undefined;
    let nextPathTarget: Vector3 | undefined = targetPosition;
    let interactionAnchor: Vector3 | undefined;
    let interactionRadius: number | undefined;

    if (target) {
        if (target.type === GameObjectType.BUILDING) {
            const building = target as Building;
            const isFriendlyStructure = building.playerId === unit.playerId;
            const shouldApproachStructure = isFriendlyStructure || unit.unitType === UnitType.WORKER;

            if (shouldApproachStructure) {
                const { approach, radius } = getBuildingApproach(unit, building, targetPosition);
                nextPathTarget = approach;
                interactionAnchor = approach;
                interactionRadius = radius;
            } else {
                const aimPoint = targetPosition ?? building.position;
                nextPathTarget = aimPoint;
                interactionAnchor = aimPoint;
                interactionRadius = undefined;
            }
        } else {
            if (targetPosition) {
                nextPathTarget = targetPosition;
                interactionAnchor = targetPosition;
            } else {
                nextPathTarget = target.position;
            }
        }
    }

    let nextFinalDestination = unit.finalDestination;
    if (requestedFinalDestination) {
        nextFinalDestination = requestedFinalDestination;
    } else if (!target) {
        nextFinalDestination = undefined;
    }

    return {
        ...unit,
        status: UnitStatus.MOVING,
        targetId: nextTargetId,
        pathTarget: nextPathTarget ?? targetPosition,
        finalDestination: nextFinalDestination,
        path: undefined,
        pathIndex: undefined,
        targetPosition: undefined,
        interactionAnchor,
        interactionRadius,
    };
};

const resolveWorkerSpecialCommand = (
    state: GameState,
    worker: Unit,
    target: CommandTarget | null,
    targetPosition: Vector3 | undefined,
    now: number,
): Unit | null => {
    if (!target) return null;

    if (target.type === GameObjectType.RESOURCE) {
        const resource = target as ResourceNode;
        if (resource.amount <= 0 || resource.isFalling) {
            return {
                ...worker,
                ...resetWorkerState(worker),
                status: UnitStatus.IDLE,
                targetId: undefined,
                pathTarget: undefined,
                interactionAnchor: undefined,
                interactionRadius: undefined,
                finalDestination: undefined,
            };
        }
        const { anchor, radius } = computeGatherAssignment(state, worker, resource);
        const order = createGatherOrder(state, worker, resource, now, anchor, radius);
        return {
            ...worker,
            status: UnitStatus.MOVING,
            targetId: resource.id,
            gatherTargetId: resource.id,
            pathTarget: anchor,
            interactionAnchor: anchor,
            interactionRadius: radius,
            finalDestination: undefined,
            workerOrder: order,
            isHarvesting: true,
            harvestingResourceType: resource.resourceType,
            buildTask: undefined,
            repairTask: undefined,
            buildTimer: undefined,
            repairTimer: undefined,
            gatherTimer: 0,
            path: undefined,
            pathIndex: undefined,
            targetPosition: undefined,
        };
    }

    if (target.type === GameObjectType.BUILDING && target.playerId === worker.playerId) {
        const building = target as Building;
        const { approach, radius } = getBuildingApproach(worker, building, targetPosition);

        if (building.constructionProgress !== undefined && building.constructionProgress < 1) {
            const order = createBuildOrder(building, approach, radius, now);
            return {
                ...worker,
                status: UnitStatus.MOVING,
                targetId: building.id,
                gatherTargetId: undefined,
                pathTarget: approach,
                interactionAnchor: approach,
                interactionRadius: radius,
                finalDestination: undefined,
                workerOrder: order,
                buildTask: { buildingId: building.id, position: building.position },
                repairTask: undefined,
                isHarvesting: false,
                harvestingResourceType: undefined,
                buildTimer: 0,
                repairTimer: undefined,
                gatherTimer: undefined,
                path: undefined,
                pathIndex: undefined,
                targetPosition: undefined,
            };
        }

        if (building.hp < building.maxHp) {
            const order = createRepairOrder(building, approach, radius, now);
            return {
                ...worker,
                status: UnitStatus.MOVING,
                targetId: building.id,
                gatherTargetId: undefined,
                pathTarget: approach,
                interactionAnchor: approach,
                interactionRadius: radius,
                finalDestination: undefined,
                workerOrder: order,
                buildTask: undefined,
                repairTask: { buildingId: building.id },
                isHarvesting: false,
                harvestingResourceType: undefined,
                buildTimer: undefined,
                repairTimer: 0,
                gatherTimer: undefined,
                path: undefined,
                pathIndex: undefined,
                targetPosition: undefined,
            };
        }

        if (
            isDropoffBuilding(building) &&
            worker.resourcePayload &&
            worker.resourcePayload.amount > 0 &&
            worker.workerOrder &&
            worker.workerOrder.kind === 'gather'
        ) {
            const order: WorkerOrder = {
                ...worker.workerOrder,
                phase: 'travelToDropoff',
                dropoffId: building.id,
                anchor: approach,
                radius,
                issuedAt: now,
                lastProgressAt: now,
                retries: 0,
            };
            return {
                ...worker,
                status: UnitStatus.MOVING,
                targetId: building.id,
                pathTarget: approach,
                interactionAnchor: approach,
                interactionRadius: radius,
                finalDestination: undefined,
                workerOrder: order,
                buildTask: undefined,
                repairTask: undefined,
                path: undefined,
                pathIndex: undefined,
                targetPosition: undefined,
            };
        }
    }

    return null;
};
export function unitReducer(state: GameState, action: Action): GameState {
    switch (action.type) {
        case 'COMMAND_UNIT': {
            const {
                unitId,
                orderType,
                targetPosition,
                targetId,
                finalDestination,
                squadId,
                queue,
                source,
            } = action.payload;
            const unit = state.units[unitId];
            if (!unit) return state;
            const behaviorConfig = UNIT_CONFIG[unit.unitType] as any;
            const commandSource: UnitCommandSource = source ?? 'player';
            const isAutoCommand = squadId === AUTO_COMBAT_SQUAD_ID || commandSource === 'auto';

            let targetObject: CommandTarget | null = null;
            if (targetId) {
                targetObject =
                    (state.units[targetId] as CommandTarget | undefined) ??
                    (state.buildings[targetId] as CommandTarget | undefined) ??
                    (state.resourcesNodes[targetId] as CommandTarget | undefined) ??
                    null;
            }

            if (unit.status === UnitStatus.FLEEING && targetObject?.type === GameObjectType.BUILDING) {
                return {
                    ...state,
                    units: {
                        ...state.units,
                        [unitId]: {
                            ...unit,
                            targetPosition,
                            targetId,
                            path: undefined,
                            pathIndex: undefined,
                            pathTarget: undefined,
                        },
                    },
                };
            }

            let effectiveType = orderType;
            if (orderType === UnitOrderType.SMART) {
                if (targetObject && (targetObject.type === GameObjectType.UNIT || targetObject.type === GameObjectType.BUILDING)) {
                    if (targetObject.playerId !== undefined && targetObject.playerId !== unit.playerId) {
                        effectiveType = UnitOrderType.ATTACK_TARGET;
                    } else {
                        effectiveType = UnitOrderType.MOVE;
                    }
                } else {
                    effectiveType = UnitOrderType.MOVE;
                }
            }

            const now = Date.now();
            const order: UnitOrder = {
                id: uuidv4(),
                type: effectiveType,
                source: commandSource,
                issuedAt: now,
                targetId,
                point: targetPosition,
                guardPoint: finalDestination,
                queue: !!queue,
                metadata: squadId ? { squadId } : undefined,
            };

            if (effectiveType === UnitOrderType.PATROL) {
                order.guardPoint = cloneVector(unit.guardPosition ?? unit.position);
                order.point =
                    order.point ??
                    (targetPosition ? cloneVector(targetPosition) : finalDestination ? cloneVector(finalDestination) : undefined);
                order.metadata = {
                    ...(order.metadata ?? {}),
                    patrolStage: 'outbound',
                };
            }

            const computePatrolRoute = (): Unit['patrolRoute'] | undefined => {
                if (effectiveType === UnitOrderType.PATROL) {
                    const originBase = order.guardPoint ?? cloneVector(unit.guardPosition ?? unit.position);
                    const destinationBase =
                        order.point ??
                        (targetPosition
                            ? cloneVector(targetPosition)
                            : finalDestination
                                ? cloneVector(finalDestination)
                                : cloneVector(unit.position));
                    return {
                        origin: cloneVector(originBase),
                        destination: cloneVector(destinationBase),
                        stage: 'outbound',
                    };
                }
                if (!isAutoCommand) {
                    return undefined;
                }
                return unit.patrolRoute;
            };

            const nextPatrolRoute = computePatrolRoute();

            if (queue && unit.currentOrder && effectiveType !== UnitOrderType.STOP) {
                const existingQueue = unit.orderQueue ? [...unit.orderQueue, order] : [order];
                return {
                    ...state,
                    units: {
                        ...state.units,
                        [unitId]: {
                            ...unit,
                            orderQueue: existingQueue,
                            lastOrderIssuedAt: now,
                        },
                    },
                };
            }

            const updatedUnits = { ...state.units };

            const clearThreatFields = isAutoCommand
                ? {}
                : {
                    threatTargetId: undefined,
                    threatExpireAt: undefined,
                    recentAttackerId: undefined,
                    lastThreatTime: undefined,
                };

            if (effectiveType === UnitOrderType.STOP) {
                const cleared = unit.unitType === UnitType.WORKER ? stripWorkerOrders(unit) : unit;
                updatedUnits[unitId] = {
                    ...cleared,
                    ...clearThreatFields,
                    status: UnitStatus.IDLE,
                    targetId: undefined,
                    targetPosition: undefined,
                    path: undefined,
                    pathIndex: undefined,
                    pathTarget: undefined,
                    finalDestination: undefined,
                    squadId: squadId ?? cleared.squadId,
                    currentOrder: undefined,
                    orderQueue: undefined,
                    lastOrderIssuedAt: now,
                    guardPosition: cloneVector(cleared.position),
                    guardReturnRadius: behaviorConfig?.guardDistance ?? Math.max(cleared.attackRange + 2, 4),
                    guardPursuitRadius: behaviorConfig?.guardDistance ?? Math.max(cleared.attackRange + 2, 4),
                    isReturningToGuard: false,
                    acquisitionCooldown: isAutoCommand ? cleared.acquisitionCooldown : undefined,
                    patrolRoute: undefined,
                };
                return { ...state, units: updatedUnits };
            }

            if (effectiveType === UnitOrderType.HOLD_POSITION) {
                const cleared = unit.unitType === UnitType.WORKER ? stripWorkerOrders(unit) : unit;
                const holdUnit: Unit = {
                    ...cleared,
                    status: UnitStatus.IDLE,
                    targetId: undefined,
                    targetPosition: undefined,
                    path: undefined,
                    pathIndex: undefined,
                    pathTarget: undefined,
                    finalDestination: undefined,
                    stance: UnitStance.HOLD_GROUND,
                };
                updatedUnits[unitId] = {
                    ...holdUnit,
                    ...clearThreatFields,
                    squadId: squadId ?? holdUnit.squadId,
                    guardPosition: cloneVector(holdUnit.position),
                    guardReturnRadius: behaviorConfig?.guardDistance ?? Math.max(holdUnit.attackRange + 2, 4),
                    guardPursuitRadius: behaviorConfig?.guardDistance ?? Math.max(holdUnit.attackRange + 2, 4),
                    isReturningToGuard: false,
                    acquisitionCooldown: isAutoCommand ? holdUnit.acquisitionCooldown : undefined,
                    currentOrder: order,
                    orderQueue: undefined,
                    lastOrderIssuedAt: now,
                    patrolRoute: isAutoCommand ? unit.patrolRoute : undefined,
                };
                return { ...state, units: updatedUnits };
            }

            let workerOverride: Unit | null = null;
            let workingUnit: Unit = unit;

            if (unit.unitType === UnitType.WORKER) {
                const workerEligible =
                    effectiveType === UnitOrderType.MOVE ||
                    effectiveType === UnitOrderType.SMART ||
                    effectiveType === UnitOrderType.ATTACK_MOVE ||
                    effectiveType === UnitOrderType.PATROL;
                if (workerEligible) {
                    const handled = resolveWorkerSpecialCommand(state, unit, targetObject, targetPosition, now);
                    if (handled) {
                        workerOverride = handled;
                    } else {
                        workingUnit = stripWorkerOrders(unit);
                    }
                } else {
                    workingUnit = stripWorkerOrders(unit);
                }
            }

            const finalizeUnit = (base: Unit): GameState => {
                const baseGuardPosition = base.guardPosition ?? unit.guardPosition ?? unit.position;
                const guardReturnRadius =
                    base.guardReturnRadius ??
                    unit.guardReturnRadius ??
                    behaviorConfig?.guardDistance ??
                    Math.max(unit.attackRange + 2, 4);
                const guardPursuitRadius =
                    base.guardPursuitRadius ??
                    unit.guardPursuitRadius ??
                    behaviorConfig?.pursuitDistance ??
                    guardReturnRadius + 6;

                let nextGuardPosition = baseGuardPosition;
                if (!isAutoCommand) {
                    if (effectiveType === UnitOrderType.PATROL && order.guardPoint) {
                        nextGuardPosition = order.guardPoint;
                    } else if (finalDestination) {
                        nextGuardPosition = finalDestination;
                    } else if (!targetId && targetPosition && effectiveType !== UnitOrderType.PATROL) {
                        nextGuardPosition = targetPosition;
                    }
                }

                updatedUnits[unitId] = {
                    ...base,
                    ...clearThreatFields,
                    squadId: squadId ?? base.squadId ?? unit.squadId,
                    guardPosition: cloneVector(nextGuardPosition),
                    guardReturnRadius,
                    guardPursuitRadius,
                    isReturningToGuard: false,
                    acquisitionCooldown: isAutoCommand ? base.acquisitionCooldown : undefined,
                    currentOrder: order,
                    orderQueue: undefined,
                    lastOrderIssuedAt: now,
                    patrolRoute: nextPatrolRoute,
                };

                return { ...state, units: updatedUnits };
            };

            if (workerOverride) {
                return finalizeUnit(workerOverride);
            }

            let destination = targetPosition ?? finalDestination;
            if (
                (effectiveType === UnitOrderType.MOVE ||
                    effectiveType === UnitOrderType.ATTACK_MOVE ||
                    effectiveType === UnitOrderType.PATROL) &&
                !destination &&
                targetObject &&
                targetObject.type !== GameObjectType.RESOURCE
            ) {
                destination = cloneVector(targetObject.position);
            }

            if (
                (effectiveType === UnitOrderType.MOVE ||
                    effectiveType === UnitOrderType.ATTACK_MOVE ||
                    effectiveType === UnitOrderType.PATROL) &&
                !destination
            ) {
                return state;
            }

            let commandTarget: CommandTarget | null = targetObject;
            let requestedFinal = finalDestination;

            if (effectiveType === UnitOrderType.ATTACK_MOVE || effectiveType === UnitOrderType.PATROL) {
                commandTarget = null;
                if (!requestedFinal && destination) {
                    requestedFinal = destination;
                }
            }

            if (!requestedFinal && destination && effectiveType === UnitOrderType.MOVE) {
                requestedFinal = destination;
            }

            const computedUnit = applyGenericUnitCommand(
                state,
                workingUnit,
                commandTarget,
                destination,
                requestedFinal,
            );

            if (effectiveType === UnitOrderType.PATROL && order.guardPoint) {
                computedUnit.guardPosition = cloneVector(order.guardPoint);
            }

            return finalizeUnit(computedUnit);
        }
        case 'WORKER_FINISH_DROPOFF': {
            const { workerId } = action.payload;
            const worker = state.units[workerId];
            if (!worker) return state;

            const payload = worker.resourcePayload;
            let players = state.players;
            let floatingTexts = state.floatingTexts;

            if (payload && payload.amount > 0) {
                const player = state.players[worker.playerId];
                const updatedPlayerResources = {
                    gold: player.resources.gold + (payload.type === 'GOLD' ? payload.amount : 0),
                    wood: player.resources.wood + (payload.type === 'WOOD' ? payload.amount : 0),
                };
                const newPlayers = [...state.players];
                newPlayers[worker.playerId] = { ...player, resources: updatedPlayerResources };
                players = newPlayers;

                const dropOffBuilding = worker.targetId ? state.buildings[worker.targetId] : undefined;
                if (dropOffBuilding && player.isHuman) {
                    const floatingId = uuidv4();
                    const floatingText: FloatingText = {
                        id: floatingId,
                        text: `+${payload.amount}`,
                        resourceType: payload.type,
                        position: { x: dropOffBuilding.position.x, y: 3, z: dropOffBuilding.position.z },
                        startTime: Date.now(),
                    };
                    floatingTexts = { ...floatingTexts, [floatingId]: floatingText };
                }
            }

            const now = Date.now();
            let nextWorker: Unit;

            if (worker.workerOrder && worker.workerOrder.kind === 'gather') {
                const resource = state.resourcesNodes[worker.workerOrder.resourceId];
                if (resource && resource.amount > 0 && !resource.isFalling) {
                    const { anchor, radius } = computeGatherAssignment(state, worker, resource);
                    const nextOrder: WorkerOrder = {
                        ...worker.workerOrder,
                        phase: 'travelToResource',
                        dropoffId: undefined,
                        anchor,
                        radius,
                        issuedAt: now,
                        lastProgressAt: now,
                        retries: 0,
                    };
                    nextWorker = {
                        ...worker,
                        resourcePayload: undefined,
                        status: UnitStatus.MOVING,
                        targetId: resource.id,
                        gatherTargetId: resource.id,
                        workerOrder: nextOrder,
                        pathTarget: anchor,
                        interactionAnchor: anchor,
                        interactionRadius: radius,
                        gatherTimer: 0,
                        finalDestination: undefined,
                        path: undefined,
                        pathIndex: undefined,
                        targetPosition: undefined,
                        isHarvesting: true,
                        harvestingResourceType: resource.resourceType,
                    };
                } else {
                    nextWorker = {
                        ...worker,
                        ...resetWorkerState(worker),
                        resourcePayload: undefined,
                        status: UnitStatus.IDLE,
                        targetId: undefined,
                        gatherTargetId: undefined,
                        interactionAnchor: undefined,
                        interactionRadius: undefined,
                    };
                }
            } else {
                nextWorker = {
                    ...worker,
                    ...resetWorkerState(worker),
                    resourcePayload: undefined,
                    status: UnitStatus.IDLE,
                    targetId: undefined,
                    gatherTargetId: undefined,
                    interactionAnchor: undefined,
                    interactionRadius: undefined,
                };
            }

            const units = { ...state.units, [workerId]: nextWorker };

            return {
                ...state,
                players,
                units,
                floatingTexts,
            };
        }
        case 'UPDATE_UNIT': {
            const { id, ...rest } = action.payload;
            const unit = state.units[id];
            if (!unit) return state;

            if (rest.hp !== undefined && rest.hp <= 0 && !unit.isDying) {
                return {
                    ...state,
                    units: {
                        ...state.units,
                        [id]: {
                            ...unit,
                            hp: 0,
                            isDying: true,
                            deathTime: Date.now(),
                            status: UnitStatus.IDLE,
                            targetId: undefined,
                            targetPosition: undefined,
                        }
                    },
                    selectedIds: state.selectedIds.filter(sid => sid !== id)
                };
            }

            return { ...state, units: { ...state.units, [id]: { ...unit, ...rest } } };
        }
        case 'REMOVE_UNIT': {
            const { id } = action.payload;
            const unit = state.units[id];
            if (!unit) return state;

            const playerId = unit.playerId;
            const player = state.players[playerId];
            const updatedPopulation = { ...player.population, current: Math.max(0, player.population.current - 1) };

            const newPlayers = [...state.players];
            newPlayers[playerId] = { ...player, population: updatedPopulation };

            const newUnits = { ...state.units };
            delete newUnits[id];
            
            const updatedUnitsAfterDeath = { ...newUnits };
            Object.keys(updatedUnitsAfterDeath).forEach(otherUnitId => {
                const otherUnit = updatedUnitsAfterDeath[otherUnitId];
                if (otherUnit.targetId === id) {
                    updatedUnitsAfterDeath[otherUnitId] = { ...otherUnit, status: UnitStatus.IDLE, targetId: undefined, targetPosition: undefined };
                }
            });

            const newState = { ...state, units: updatedUnitsAfterDeath, players: newPlayers, selectedIds: state.selectedIds.filter(sid => sid !== id) };
            return newState;
        }
        case 'ADD_UNIT': {
            const { unit, playerId } = action.payload;
            if (!unit.id || !unit.unitType) return state;
            
            const config = UNIT_CONFIG[unit.unitType];
            const isCombatUnit = unit.unitType !== UnitType.WORKER;
            const defaultGuardReturn = config.guardDistance ?? Math.max(config.attackRange + 2, 4);
            const defaultGuardPursuit = config.pursuitDistance ?? (defaultGuardReturn + 6);
            const spawnPosition = unit.position ?? { x: 0, y: 0, z: 0 };

            const completeUnit: Unit = {
                ...(unit as Unit),
                playerId: playerId,
                maxHp: config.hp,
                attackDamage: config.attackDamage,
                attackSpeed: config.attackSpeed,
                attackRange: config.attackRange,
                defense: config.defense,
                stance: isCombatUnit ? UnitStance.AGGRESSIVE : UnitStance.HOLD_GROUND,
                isHarvesting: false,
                harvestingResourceType: undefined,
                guardPosition: unit.guardPosition ?? spawnPosition,
                guardReturnRadius: unit.guardReturnRadius ?? defaultGuardReturn,
                guardPursuitRadius: unit.guardPursuitRadius ?? defaultGuardPursuit,
                isReturningToGuard: unit.isReturningToGuard ?? false,
            };
            
            const player = state.players[playerId];
            const population = player.population;
            const updatedPopulation = { ...population, current: population.current + 1 };

            const newPlayers = [...state.players];
            newPlayers[playerId] = { ...player, population: updatedPopulation };

            const newState: GameState = { ...state, players: newPlayers, units: { ...state.units, [unit.id]: completeUnit } };

            return newState;
        }
        case 'SPAWN_UNIT_FROM_QUEUE': {
            const { unitType, playerId, buildingId } = action.payload;
            const building = state.buildings[buildingId];
            if(!building) return state;

            const config = UNIT_CONFIG[unitType];
            const isCombatUnit = unitType !== UnitType.WORKER;
            const newUnitId = uuidv4();

            const buildingSize = COLLISION_DATA.BUILDINGS[building.buildingType];
            const unitRadius = COLLISION_DATA.UNITS[unitType].radius;
            const spawnZOffset = (buildingSize.depth / 2) + unitRadius + 1.0;
            const spawnXRange = Math.max(0, buildingSize.width / 2 - unitRadius);

            const spawnPosition = {
                x: building.position.x + (Math.random() - 0.5) * spawnXRange,
                y: 0,
                z: building.position.z + spawnZOffset,
            };
            const spawnGuardReturn = config.guardDistance ?? Math.max(config.attackRange + 2, 4);
            const spawnGuardPursuit = config.pursuitDistance ?? (spawnGuardReturn + 6);

            const completeUnit: Unit = {
                id: newUnitId,
                type: GameObjectType.UNIT,
                unitType: unitType,
                position: spawnPosition,
                status: UnitStatus.IDLE, 
                hp: config.hp,
                playerId: playerId,
                maxHp: config.hp,
                attackDamage: config.attackDamage,
                attackSpeed: config.attackSpeed,
                attackRange: config.attackRange,
                defense: config.defense,
                stance: isCombatUnit ? UnitStance.AGGRESSIVE : UnitStance.HOLD_GROUND,
                isHarvesting: false,
                harvestingResourceType: undefined,
                guardPosition: spawnPosition,
                guardReturnRadius: spawnGuardReturn,
                guardPursuitRadius: spawnGuardPursuit,
                isReturningToGuard: false,
            };
            
            if (building.rallyPoint) {
                completeUnit.status = UnitStatus.MOVING;
                completeUnit.pathTarget = building.rallyPoint; // Use pathTarget for pathfinding
                if (isCombatUnit) {
                    completeUnit.finalDestination = building.rallyPoint;
                }
                completeUnit.guardPosition = { ...building.rallyPoint };
            } else {
                // No rally point, give a small move-out command to clear the spawn area
                completeUnit.status = UnitStatus.MOVING;
                const moveOutPosition = { ...spawnPosition, z: spawnPosition.z + 3 };
                completeUnit.pathTarget = moveOutPosition;
            }
            
            const player = state.players[playerId];
            const population = player.population;
            const updatedPopulation = { ...population, current: population.current + 1 };
            
            const newPlayers = [...state.players];
            newPlayers[playerId] = { ...player, population: updatedPopulation };

            const newState: GameState = { ...state, players: newPlayers, units: { ...state.units, [newUnitId]: completeUnit } };

            return newState;
        }
        case 'CHANGE_STANCE': {
            const { unitIds, stance } = action.payload;
            const updatedUnits = { ...state.units };
            unitIds.forEach(id => {
                if (updatedUnits[id]) {
                    updatedUnits[id] = { ...updatedUnits[id], stance };
                }
            });
            return { ...state, units: updatedUnits };
        }
        case 'DEBUG_SPAWN_UNITS': {
            const { playerId, unitType, count, position } = action.payload;
            const player = state.players[playerId];
            if (!player) return state;

            const config = UNIT_CONFIG[unitType];
            const isCombatUnit = unitType !== UnitType.WORKER;
            
            const newUnits = { ...state.units };
            const spawnRadius = 8; // Radius around the given position

            for (let i = 0; i < count; i++) {
                const angle = Math.random() * Math.PI * 2;
                const radius = spawnRadius + Math.random() * 5;
                const spawnPosition = {
                    x: position.x + Math.cos(angle) * radius,
                    y: 0,
                    z: position.z + Math.sin(angle) * radius,
                };
                const debugGuardReturn = config.guardDistance ?? Math.max(config.attackRange + 2, 4);
                const debugGuardPursuit = config.pursuitDistance ?? (debugGuardReturn + 6);

                const newUnitId = uuidv4();
                const completeUnit: Unit = {
                    id: newUnitId,
                    type: GameObjectType.UNIT,
                    unitType: unitType,
                    position: spawnPosition,
                    status: UnitStatus.IDLE,
                    hp: config.hp,
                    playerId: playerId,
                    maxHp: config.hp,
                    attackDamage: config.attackDamage,
                    attackSpeed: config.attackSpeed,
                    attackRange: config.attackRange,
                    defense: config.defense,
                    stance: isCombatUnit ? UnitStance.AGGRESSIVE : UnitStance.HOLD_GROUND,
                    isHarvesting: false,
                    harvestingResourceType: undefined,
                    guardPosition: spawnPosition,
                    guardReturnRadius: debugGuardReturn,
                    guardPursuitRadius: debugGuardPursuit,
                    isReturningToGuard: false,
                };
                newUnits[newUnitId] = completeUnit;
            }
            
            const updatedPopulation = { ...player.population, current: player.population.current + count };
            
            const newPlayers = [...state.players];
            newPlayers[playerId] = { ...player, population: updatedPopulation };

            return { ...state, units: newUnits, players: newPlayers };
        }
        default:
            return state;
    }
}
