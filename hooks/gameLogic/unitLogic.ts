import { GameState, UnitStatus, UnitType, Unit, GameObjectType, BuildingType, Building, ResourceNode, Vector3, UnitOrderType, UnitOrder, WorkerOrder } from '../../types';
import { UNIT_CONFIG, COLLISION_DATA, DEATH_ANIMATION_DURATION, arePlayersHostile } from '../../constants';
import { BufferedDispatch } from '../../state/batch';
import { NavMeshManager } from '../utils/navMeshManager';
import { SpatialHash } from '../utils/spatial';
import { driveWorkerBehavior } from './workerBehavior';
import { AUTO_COMBAT_SQUAD_ID } from './threatSystem';
import { findContainingBuilding, findEjectionPosition } from '../../state/utils/spawn';

const buildingGrid = new SpatialHash(10);
const unitGrid = new SpatialHash(5);
const unitNeighbors: string[] = [];
const neighborUnits: Unit[] = [];
const navFrom: Vector3 = { x: 0, y: 0, z: 0 };
const navTo: Vector3 = { x: 0, y: 0, z: 0 };

const STUCK_SAMPLE_THRESHOLD = 0.045;
const STUCK_TIME_BEFORE_REPATH = 0.65;
const STUCK_REPATH_COOLDOWN = 0.75;
const STUCK_LOCAL_MAX_OFFSET = 4.5;
const STUCK_FORCE_RELOCATE = 5.0;

type PathingState = {
    lastX: number;
    lastZ: number;
    stillTime: number;
    cooldown: number;
    lastSeen: number;
};

const pathingDiagnostics = new Map<string, PathingState>();

const distanceSqXZ = (ax: number, az: number, bx: number, bz: number) => {
    const dx = ax - bx;
    const dz = az - bz;
    return dx * dx + dz * dz;
};

const copyVector = (vec: Vector3): Vector3 => ({ x: vec.x, y: vec.y, z: vec.z });

const cloneWorkerOrder = (order: WorkerOrder): WorkerOrder => ({
    ...order,
    anchor: copyVector(order.anchor),
});

const prepareWorkerOrderForResume = (order: WorkerOrder, now: number): WorkerOrder => {
    const base = cloneWorkerOrder(order);
    switch (base.kind) {
        case 'gather':
            return {
                ...base,
                phase: 'travelToResource',
                issuedAt: now,
                lastProgressAt: now,
                retries: 0,
            };
        case 'build':
            return {
                ...base,
                phase: 'travelToSite',
                issuedAt: now,
                lastProgressAt: now,
                retries: 0,
            };
        case 'repair':
            return {
                ...base,
                phase: 'travelToTarget',
                issuedAt: now,
                lastProgressAt: now,
                retries: 0,
            };
        default:
            return base;
    }
};

const hasReachedPoint = (unit: Unit, point: Vector3 | undefined, threshold = 1.5): boolean => {
    if (!point) return false;
    const dx = unit.position.x - point.x;
    const dz = unit.position.z - point.z;
    return dx * dx + dz * dz <= threshold * threshold;
};

const resolveOrderTarget = (
    state: GameState,
    order: UnitOrder,
): Unit | Building | ResourceNode | undefined => {
    if (!order.targetId) return undefined;
    return (
        state.units[order.targetId] ||
        state.buildings[order.targetId] ||
        state.resourcesNodes[order.targetId]
    );
};

const getOrderAnchor = (state: GameState, order: UnitOrder): Vector3 | undefined => {
    if (order.point) return order.point;
    const target = resolveOrderTarget(state, order);
    return target ? target.position : undefined;
};

const isOrderFulfilled = (state: GameState, unit: Unit): boolean => {
    const order = unit.currentOrder;
    if (!order) return false;

    switch (order.type) {
        case UnitOrderType.MOVE:
            if (hasReachedPoint(unit, getOrderAnchor(state, order))) return true;
            return unit.status === UnitStatus.IDLE && !unit.path && !unit.pathTarget;
        case UnitOrderType.ATTACK_MOVE:
            if (unit.finalDestination) {
                if (hasReachedPoint(unit, unit.finalDestination, 2.25)) {
                    return !unit.threatTargetId;
                }
                return false;
            }
            return unit.status === UnitStatus.IDLE && !unit.threatTargetId;
        case UnitOrderType.ATTACK_TARGET: {
            if (!order.targetId) return true;
            const target = resolveOrderTarget(state, order);
            if (!target) return true;
            if ('hp' in target && target.hp <= 0) return true;
            return false;
        }
        case UnitOrderType.HOLD_POSITION:
            return true;
        case UnitOrderType.PATROL:
            return false;
        case UnitOrderType.STOP:
            return true;
        default:
            return false;
    }
};

// --- Main Unit Logic ---

export const processUnitLogic = (state: GameState, delta: number, dispatch: BufferedDispatch) => {
    const { units, resourcesNodes, buildings, players } = state;

    buildingGrid.clear();
    const dropoffsByPlayer = new Map<number, Building[]>();
    for (const building of Object.values(buildings)) {
        buildingGrid.insert(building.id, building.position.x, building.position.z);
        if (
            building.constructionProgress === undefined &&
            !building.isCollapsing &&
            (building.buildingType === BuildingType.TOWN_HALL || building.buildingType === BuildingType.WAREHOUSE)
        ) {
            const list = dropoffsByPlayer.get(building.playerId) ?? [];
            list.push(building);
            dropoffsByPlayer.set(building.playerId, list);
        }
    }

    unitGrid.clear();
    const unitList = Object.values(units);
    for (const entry of unitList) {
        unitGrid.insert(entry.id, entry.position.x, entry.position.z);
    }

    const frameNow = performance.now();

    for (const unit of unitList) {
        // --- Death Logic ---
        if (unit.isDying) {
            if (Date.now() - (unit.deathTime || 0) > DEATH_ANIMATION_DURATION) {
                dispatch({ type: 'REMOVE_UNIT', payload: { id: unit.id } });
            }
            continue; // Dead units do nothing else
        }

        if (unit.hp <= 0 && !unit.isDying) {
            dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, hp: 0, isDying: true, deathTime: Date.now(), status: UnitStatus.IDLE, targetId: undefined, targetPosition: undefined, path: undefined, pathIndex: undefined, pathTarget: undefined } });
            continue; // Unit is now dying, logic for this frame is done
        }
        
        const owner = players[unit.playerId];
        const unitConfig = UNIT_CONFIG[unit.unitType];
        const unitCollision = COLLISION_DATA.UNITS[unit.unitType];
        const unitRadius = unitCollision?.radius ?? 0;
        const unitPos = unit.position;
        const unitPosX = unitPos.x;
        const unitPosZ = unitPos.z;

        const diag = pathingDiagnostics.get(unit.id) ?? {
            lastX: unitPosX,
            lastZ: unitPosZ,
            stillTime: 0,
            cooldown: 0,
            lastSeen: frameNow,
        };
        const moved = Math.hypot(unitPosX - diag.lastX, unitPosZ - diag.lastZ);
        if (moved < STUCK_SAMPLE_THRESHOLD) {
            diag.stillTime += delta;
        } else {
            diag.stillTime = 0;
        }
        diag.lastX = unitPosX;
        diag.lastZ = unitPosZ;
        diag.lastSeen = frameNow;
        if (unit.status !== UnitStatus.MOVING) {
            diag.stillTime = 0;
        }
        if (diag.cooldown > 0) {
            diag.cooldown = Math.max(0, diag.cooldown - delta);
        }
        pathingDiagnostics.set(unit.id, diag);

        if (unit.orderQueue && unit.orderQueue.length) {
            const workingOnWorkerJob = unit.unitType === UnitType.WORKER && !!unit.workerOrder;
            if (!workingOnWorkerJob) {
                const shouldAdvance = !unit.currentOrder || isOrderFulfilled(state, unit);
                if (shouldAdvance) {
                    const [nextOrder, ...rest] = unit.orderQueue;
                    if (nextOrder) {
                        const anchor = getOrderAnchor(state, nextOrder);
                        const finalDest = nextOrder.guardPoint ?? anchor;
                        dispatch({
                            type: 'COMMAND_UNIT',
                            payload: {
                                unitId: unit.id,
                                orderType: nextOrder.type,
                                targetPosition: anchor ? copyVector(anchor) : undefined,
                                targetId: nextOrder.targetId,
                                finalDestination: finalDest ? copyVector(finalDest) : undefined,
                                squadId: unit.squadId,
                                source: nextOrder.source,
                            },
                        });
                        dispatch({
                            type: 'UPDATE_UNIT',
                            payload: {
                                id: unit.id,
                                orderQueue: rest.length ? rest : undefined,
                            },
                        });
                        continue;
                    }
                }
            }
        }

        if (unit.patrolRoute) {
            const { origin, destination, stage } = unit.patrolRoute;
            const patrolTarget = stage === 'outbound' ? destination : origin;
            if (hasReachedPoint(unit, patrolTarget, 1.2)) {
                const nextStage = stage === 'outbound' ? 'return' : 'outbound';
                const nextTarget = nextStage === 'outbound' ? destination : origin;
                dispatch({
                    type: 'UPDATE_UNIT',
                    payload: {
                        id: unit.id,
                        patrolRoute: {
                            origin,
                            destination,
                            stage: nextStage,
                        },
                    },
                });
                dispatch({
                    type: 'COMMAND_UNIT',
                    payload: {
                        unitId: unit.id,
                        orderType: UnitOrderType.ATTACK_MOVE,
                        targetPosition: copyVector(nextTarget),
                        finalDestination: copyVector(nextTarget),
                        squadId: AUTO_COMBAT_SQUAD_ID,
                        source: 'auto',
                    },
                });
                continue;
            }
        }

        const pathTarget = unit.pathTarget;
        const hasPathArray =
            Array.isArray(unit.path) &&
            unit.pathIndex !== undefined &&
            unit.pathIndex < unit.path.length;
        const currentWaypoint = hasPathArray ? unit.path![unit.pathIndex!] : undefined;
        const localGoal = currentWaypoint ?? pathTarget;

        if (unit.status === UnitStatus.MOVING && pathTarget && !unit.path && unit.pathIndex === undefined && !NavMeshManager.isRequestPending(unit.id)) {
            NavMeshManager.requestPath(unit.id, unit.position, pathTarget, unitRadius);
        }

        let handledMovement = false;

        const isStuck = diag.stillTime > STUCK_TIME_BEFORE_REPATH;
        if (
            unit.status === UnitStatus.MOVING &&
            localGoal &&
            isStuck &&
            diag.cooldown <= 0 &&
            !NavMeshManager.isRequestPending(unit.id)
        ) {
            const detour = NavMeshManager.findLocalAdjustment(unit.position, localGoal, {
                agentRadius: unitRadius,
                maxOffset: STUCK_LOCAL_MAX_OFFSET,
                angularSteps: 4,
                radialIterations: 4,
            });

            if (detour && distanceSqXZ(detour.x, detour.z, localGoal.x, localGoal.z) > 0.09) {
                dispatch({
                    type: 'UPDATE_UNIT',
                    payload: {
                        id: unit.id,
                        pathTarget: detour,
                        targetPosition: detour,
                        path: undefined,
                        pathIndex: undefined,
                    },
                });
                NavMeshManager.requestPath(unit.id, unit.position, detour, unitRadius);
                diag.cooldown = STUCK_REPATH_COOLDOWN;
                diag.stillTime = 0;
                pathingDiagnostics.set(unit.id, diag);
                handledMovement = true;
            } else if (pathTarget) {
                dispatch({
                    type: 'UPDATE_UNIT',
                    payload: {
                        id: unit.id,
                        path: undefined,
                        pathIndex: undefined,
                    },
                });
                NavMeshManager.requestPath(unit.id, unit.position, pathTarget, unitRadius);
                diag.cooldown = STUCK_REPATH_COOLDOWN;
                pathingDiagnostics.set(unit.id, diag);
            }
        }

        if (
            unit.status === UnitStatus.MOVING &&
            !handledMovement &&
            diag.stillTime > STUCK_FORCE_RELOCATE
        ) {
            const containingBuilding = findContainingBuilding(state.buildings, unit.position, unitRadius * 0.75);
            if (containingBuilding) {
                const exitPosition = findEjectionPosition(state.units, state.buildings, containingBuilding, unit);
                dispatch({
                    type: 'UPDATE_UNIT',
                    payload: {
                        id: unit.id,
                        position: exitPosition,
                        path: undefined,
                        pathIndex: undefined,
                        pathTarget: undefined,
                        targetPosition: undefined,
                        finalDestination: unit.finalDestination,
                    },
                });
                diag.stillTime = 0;
                diag.cooldown = STUCK_REPATH_COOLDOWN;
                pathingDiagnostics.set(unit.id, diag);
                continue;
            }

            const targetHint =
                unit.finalDestination ??
                unit.pathTarget ??
                unit.guardPosition ??
                unit.position;
            const safeSnap = NavMeshManager.safeSnap(targetHint, Math.max(6, unitRadius * 6));
            if (safeSnap) {
                const snapDistSq = distanceSqXZ(safeSnap.x, safeSnap.z, unitPosX, unitPosZ);
                if (snapDistSq > Math.max(0.64, unitRadius * unitRadius * 4)) {
                    dispatch({
                        type: 'UPDATE_UNIT',
                        payload: {
                            id: unit.id,
                            position: { x: safeSnap.x, y: unit.position.y, z: safeSnap.z },
                            path: undefined,
                            pathIndex: undefined,
                            pathTarget: undefined,
                            targetPosition: undefined,
                        },
                    });
                    diag.stillTime = 0;
                    diag.cooldown = STUCK_REPATH_COOLDOWN;
                    pathingDiagnostics.set(unit.id, diag);
                    continue;
                }
            }
        }

        if (hasPathArray && !handledMovement) {
            const waypoint = currentWaypoint!;
            const waypointRadius = Math.max(unitRadius + 0.1, 0.6);
            const waypointRadiusSq = waypointRadius * waypointRadius;
            if (distanceSqXZ(unitPosX, unitPosZ, waypoint.x, waypoint.z) < waypointRadiusSq) {
                const newIndex = unit.pathIndex + 1;
                if (newIndex >= unit.path.length) {
                    dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, path: undefined, pathIndex: undefined } });
                } else {
                    dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, pathIndex: newIndex } });
                }
            } else {
                const step = Math.max(unitConfig.speed * delta, 0.01);
                navFrom.x = unitPosX;
                navFrom.y = 0;
                navFrom.z = unitPosZ;
                navTo.x = waypoint.x;
                navTo.y = 0;
                navTo.z = waypoint.z;
                const next = NavMeshManager.advanceOnNav(navFrom, navTo, step);
                const deltaX = next.x - unitPosX;
                const deltaZ = next.z - unitPosZ;
                if (Math.abs(deltaX) > 1e-5 || Math.abs(deltaZ) > 1e-5) {
                    dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, position: next } });
                }
            }
            handledMovement = true;
        }

        if (!handledMovement && unit.status === UnitStatus.MOVING && pathTarget) {
            let arrivalRadiusSq = 4.0;
            if (unit.interactionAnchor) {
                const tightRadius = Math.max(unitRadius + 0.12, 0.32);
                arrivalRadiusSq = Math.max(0.12, tightRadius * tightRadius);
            }

            if (unit.unitType === UnitType.WORKER && unit.targetId) {
                const gatherTarget = resourcesNodes[unit.targetId];
                if (gatherTarget) {
                    const anchorTolerance = Math.max(unitRadius + 0.08, 0.26);
                    const anchorToleranceSq = anchorTolerance * anchorTolerance;
                    arrivalRadiusSq = Math.max(0.16, Math.min(arrivalRadiusSq, anchorToleranceSq));
                }
            }

            const targetDistSq = distanceSqXZ(unitPosX, unitPosZ, pathTarget.x, pathTarget.z);
            if (targetDistSq <= arrivalRadiusSq) {
                const targetBuilding = unit.targetId ? buildings[unit.targetId] : null;
                const isWorkerArrivingAtDropoff = unit.unitType === UnitType.WORKER && targetBuilding && unit.playerId === targetBuilding.playerId &&
                    (targetBuilding.buildingType === BuildingType.TOWN_HALL || targetBuilding.buildingType === BuildingType.WAREHOUSE) &&
                    unit.resourcePayload && unit.resourcePayload.amount > 0;

                if (isWorkerArrivingAtDropoff) {
                    dispatch({ type: 'WORKER_FINISH_DROPOFF', payload: { workerId: unit.id } });
                } else {
                    let newFinalDestination = unit.finalDestination;
                    if (unit.finalDestination) {
                        if (distanceSqXZ(pathTarget.x, pathTarget.z, unit.finalDestination.x, unit.finalDestination.z) < 16) {
                            newFinalDestination = undefined;
                        }
                    }

                    const target = unit.targetId ? (units[unit.targetId] || buildings[unit.targetId] || resourcesNodes[unit.targetId]) : null;
                    const payload: Partial<Unit> & { id: string } = {
                        id: unit.id,
                        path: undefined,
                        pathIndex: undefined,
                        pathTarget: undefined,
                        targetPosition: undefined,
                        finalDestination: newFinalDestination,
                        status: UnitStatus.IDLE
                    };

                    if (unit.buildTask) payload.status = UnitStatus.BUILDING;
                    else if (unit.repairTask) payload.status = UnitStatus.REPAIRING;
                    else if (target && target.type === GameObjectType.RESOURCE && unit.unitType === UnitType.WORKER) payload.status = UnitStatus.GATHERING;
                    else if (target && arePlayersHostile(owner, players[target.playerId!])) payload.status = UnitStatus.ATTACKING;

                    let nextAnchor = unit.interactionAnchor;
                    let nextRadius = unit.interactionRadius;
                    if (!target && payload.status === UnitStatus.IDLE) {
                        nextAnchor = undefined;
                        nextRadius = undefined;
                    } else if (target) {
                        if (payload.status === UnitStatus.IDLE && target.type !== GameObjectType.RESOURCE) {
                            nextAnchor = undefined;
                            nextRadius = undefined;
                        }
                    }
                    payload.interactionAnchor = nextAnchor;
                    payload.interactionRadius = nextRadius;

                    dispatch({ type: 'UPDATE_UNIT', payload });
                }
            } else {
                const step = Math.max(unitConfig.speed * delta, 0.01);
                navFrom.x = unitPosX;
                navFrom.y = 0;
                navFrom.z = unitPosZ;
                navTo.x = pathTarget.x;
                navTo.y = 0;
                navTo.z = pathTarget.z;
                const next = NavMeshManager.advanceOnNav(navFrom, navTo, step);
                const deltaX = next.x - unitPosX;
                const deltaZ = next.z - unitPosZ;
                if (Math.abs(deltaX) > 1e-5 || Math.abs(deltaZ) > 1e-5) {
                    dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, position: next } });
                }
            }
        }

        const nearbyUnitIds = unitGrid.queryNeighbors(unitPosX, unitPosZ, unitNeighbors);

        if (unit.unitType === UnitType.WORKER && !unit.isDying) {
            const fleeRadius = UNIT_CONFIG[UnitType.WORKER]?.fleeRadius ?? 0;
            if (fleeRadius > 0) {
                const fleeRadiusSq = fleeRadius * fleeRadius;
                let threatCount = 0;
                let avgThreatX = 0;
                let avgThreatZ = 0;
                let nearestThreat: Unit | undefined;
                let nearestThreatDistSq = Infinity;

                for (const neighborId of nearbyUnitIds) {
                    if (neighborId === unit.id) continue;
                    const neighbor = units[neighborId];
                    if (!neighbor || neighbor.isDying) continue;
                    if (!arePlayersHostile(owner, players[neighbor.playerId])) continue;
                    const threatDistSq = distanceSqXZ(unitPosX, unitPosZ, neighbor.position.x, neighbor.position.z);
                    if (threatDistSq > fleeRadiusSq) continue;
                    threatCount++;
                    avgThreatX += neighbor.position.x;
                    avgThreatZ += neighbor.position.z;
                    if (threatDistSq < nearestThreatDistSq) {
                        nearestThreatDistSq = threatDistSq;
                        nearestThreat = neighbor;
                    }
                }

                if (threatCount > 0) {
                    const centerX = avgThreatX / threatCount;
                    const centerZ = avgThreatZ / threatCount;
                    let dirX = unitPosX - centerX;
                    let dirZ = unitPosZ - centerZ;
                    let dirLen = Math.hypot(dirX, dirZ);
                    if (dirLen < 1e-3 && nearestThreat) {
                        dirX = unitPosX - nearestThreat.position.x;
                        dirZ = unitPosZ - nearestThreat.position.z;
                        dirLen = Math.hypot(dirX, dirZ);
                    }
                    if (dirLen < 1e-3) {
                        const angle = Math.random() * Math.PI * 2;
                        dirX = Math.cos(angle);
                        dirZ = Math.sin(angle);
                        dirLen = 1;
                    }

                    const retreatDistance = fleeRadius * 1.6;
                    let fleeTarget: Vector3 | undefined;

                    const guardPosition = unit.guardPosition;
                    if (guardPosition) {
                        const guardThreatDistSq = distanceSqXZ(guardPosition.x, guardPosition.z, centerX, centerZ);
                        if (guardThreatDistSq > fleeRadiusSq * 1.25) {
                            fleeTarget = { x: guardPosition.x, y: guardPosition.y ?? 0, z: guardPosition.z };
                        }
                    }

                    if (!fleeTarget) {
                        const dropoffs = dropoffsByPlayer.get(unit.playerId) ?? [];
                        if (dropoffs.length) {
                            let bestDropoff: Building | undefined;
                            let bestScore = -Infinity;
                            for (const dropoff of dropoffs) {
                                const distToThreatSq = distanceSqXZ(dropoff.position.x, dropoff.position.z, centerX, centerZ);
                                const distToUnitSq = distanceSqXZ(dropoff.position.x, dropoff.position.z, unitPosX, unitPosZ);
                                const score = distToThreatSq - distToUnitSq * 0.3;
                                if (distToThreatSq > fleeRadiusSq * 0.8 && score > bestScore) {
                                    bestScore = score;
                                    bestDropoff = dropoff;
                                }
                            }
                            if (bestDropoff) {
                                fleeTarget = { x: bestDropoff.position.x, y: 0, z: bestDropoff.position.z };
                            }
                        }
                    }

                    if (!fleeTarget) {
                        fleeTarget = {
                            x: unitPosX + (dirX / dirLen) * retreatDistance,
                            y: 0,
                            z: unitPosZ + (dirZ / dirLen) * retreatDistance,
                        };
                    }

                    const existingTarget = unit.pathTarget ?? unit.targetPosition;
                    const alreadyFleeing =
                        unit.status === UnitStatus.FLEEING &&
                        existingTarget &&
                        distanceSqXZ(existingTarget.x, existingTarget.z, fleeTarget.x, fleeTarget.z) < 4;

                    if (!alreadyFleeing) {
                        const nowMs = Date.now();
                        const preservedOrder = unit.workerOrder
                            ? prepareWorkerOrderForResume(unit.workerOrder, nowMs)
                            : unit.suspendedWorkerOrder
                            ? prepareWorkerOrderForResume(unit.suspendedWorkerOrder, nowMs)
                            : undefined;

                        const updatePayload: Partial<Unit> & { id: string } = {
                            id: unit.id,
                            status: UnitStatus.FLEEING,
                            workerOrder: undefined,
                            gatherTargetId: undefined,
                            isHarvesting: false,
                            harvestingResourceType: undefined,
                            buildTask: undefined,
                            repairTask: undefined,
                            acquisitionCooldown: 1.5,
                            gatherTimer: undefined,
                            buildTimer: undefined,
                            repairTimer: undefined,
                        };

                        if (preservedOrder) {
                            updatePayload.suspendedWorkerOrder = preservedOrder;
                        }

                        dispatch({
                            type: 'UPDATE_UNIT',
                            payload: updatePayload,
                        });

                        dispatch({
                            type: 'COMMAND_UNIT',
                            payload: {
                                unitId: unit.id,
                                orderType: UnitOrderType.MOVE,
                                targetPosition: fleeTarget,
                                finalDestination: fleeTarget,
                                squadId: AUTO_COMBAT_SQUAD_ID,
                            },
                        });
                    }

                    continue;
                } else if (
                    unit.status === UnitStatus.FLEEING &&
                    (!unit.acquisitionCooldown || unit.acquisitionCooldown <= 0) &&
                    !unit.threatTargetId
                ) {
                    const nowMs = Date.now();
                    const suspendedOrder = unit.suspendedWorkerOrder
                        ? prepareWorkerOrderForResume(unit.suspendedWorkerOrder, nowMs)
                        : undefined;

                    const resumePayload: Partial<Unit> & { id: string } = {
                        id: unit.id,
                        status: UnitStatus.IDLE,
                        acquisitionCooldown: undefined,
                        suspendedWorkerOrder: undefined,
                        pathTarget: undefined,
                        path: undefined,
                        pathIndex: undefined,
                        targetPosition: undefined,
                        finalDestination: undefined,
                    };

                    if (suspendedOrder) {
                        resumePayload.workerOrder = suspendedOrder;
                        resumePayload.finalDestination = undefined;
                        switch (suspendedOrder.kind) {
                            case 'gather':
                                resumePayload.gatherTargetId = suspendedOrder.resourceId;
                                resumePayload.isHarvesting = true;
                                resumePayload.harvestingResourceType = suspendedOrder.resourceType;
                                resumePayload.buildTask = undefined;
                                resumePayload.repairTask = undefined;
                                resumePayload.gatherTimer = 0;
                                resumePayload.buildTimer = undefined;
                                resumePayload.repairTimer = undefined;
                                break;
                            case 'build':
                                resumePayload.buildTask = { buildingId: suspendedOrder.buildingId, position: copyVector(suspendedOrder.anchor) };
                                resumePayload.repairTask = undefined;
                                resumePayload.isHarvesting = false;
                                resumePayload.harvestingResourceType = undefined;
                                resumePayload.buildTimer = 0;
                                resumePayload.gatherTimer = undefined;
                                resumePayload.repairTimer = undefined;
                                break;
                            case 'repair':
                                resumePayload.repairTask = { buildingId: suspendedOrder.buildingId };
                                resumePayload.buildTask = undefined;
                                resumePayload.isHarvesting = false;
                                resumePayload.harvestingResourceType = undefined;
                                resumePayload.repairTimer = 0;
                                resumePayload.buildTimer = undefined;
                                resumePayload.gatherTimer = undefined;
                                break;
                        }
                    } else {
                        resumePayload.buildTask = undefined;
                        resumePayload.repairTask = undefined;
                        resumePayload.isHarvesting = false;
                        resumePayload.harvestingResourceType = undefined;
                        resumePayload.gatherTargetId = undefined;
                        resumePayload.gatherTimer = undefined;
                        resumePayload.buildTimer = undefined;
                        resumePayload.repairTimer = undefined;
                    }

                    dispatch({
                        type: 'UPDATE_UNIT',
                        payload: resumePayload,
                    });
                    continue;
                }
            }
        }

        driveWorkerBehavior(state, unit, delta, dispatch, dropoffsByPlayer, frameNow);

        // --- "Attack-Move" Continuation Logic ---
        if (unit.status === UnitStatus.IDLE && unit.finalDestination) {
            if (distanceSqXZ(unitPosX, unitPosZ, unit.finalDestination.x, unit.finalDestination.z) > 9) {
                const resumeOrderType =
                    unit.currentOrder?.type === UnitOrderType.ATTACK_MOVE ? UnitOrderType.ATTACK_MOVE : UnitOrderType.MOVE;
                dispatch({
                    type: 'COMMAND_UNIT',
                    payload: {
                        unitId: unit.id,
                        orderType: resumeOrderType,
                        targetPosition: unit.finalDestination,
                        finalDestination: unit.finalDestination,
                        squadId: AUTO_COMBAT_SQUAD_ID,
                    },
                });
            } else {
                dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, finalDestination: undefined } });
            }
        }

        // --- Corrective Physics: Depenetration from buildings ---
        const totalPushX = 0;
        const totalPushZ = 0;
    }
    for (const [id, info] of pathingDiagnostics) {
        if (frameNow - info.lastSeen > 1500) {
            pathingDiagnostics.delete(id);
        }
    }

};



