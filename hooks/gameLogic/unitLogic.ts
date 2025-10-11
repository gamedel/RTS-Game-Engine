import { GameState, UnitStatus, UnitType, Unit, GameObjectType, BuildingType, Building, Vector3 } from '../../types';
import { UNIT_CONFIG, COLLISION_DATA, DEATH_ANIMATION_DURATION, arePlayersHostile } from '../../constants';
import { BufferedDispatch } from '../../state/batch';
import { NavMeshManager } from '../utils/navMeshManager';
import { Vec2, getDepenetrationVector, getSeparationVector } from '../utils/physics';
import { SpatialHash } from '../utils/spatial';
import { driveWorkerBehavior } from './workerBehavior';

const buildingGrid = new SpatialHash(10);
const unitGrid = new SpatialHash(5);
const buildingNeighbors: string[] = [];
const unitNeighbors: string[] = [];
const neighborUnits: Unit[] = [];
const separationVec: Vec2 = { x: 0, z: 0 };
const navFrom: Vector3 = { x: 0, y: 0, z: 0 };
const navTo: Vector3 = { x: 0, y: 0, z: 0 };

const distanceSqXZ = (ax: number, az: number, bx: number, bz: number) => {
    const dx = ax - bx;
    const dz = az - bz;
    return dx * dx + dz * dz;
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
        // --- Stuck Detection Logic ---
        if (unit.lastPositionCheck === undefined) {
            dispatch({
                type: 'UPDATE_UNIT',
                payload: { id: unit.id, lastPositionCheck: { pos: unit.position, time: frameNow } }
            });
        } else {
            if (frameNow - unit.lastPositionCheck.time > 500) {
                const dx = unit.position.x - unit.lastPositionCheck.pos.x;
                const dz = unit.position.z - unit.lastPositionCheck.pos.z;
                const movedSq = dx * dx + dz * dz;

                if (unit.status === UnitStatus.MOVING && unit.pathTarget && movedSq < 0.05 * 0.05) {
                    NavMeshManager.invalidateFlowField(unit.pathTarget);
                }

                dispatch({
                    type: 'UPDATE_UNIT',
                    payload: { id: unit.id, lastPositionCheck: { pos: unit.position, time: frameNow } }
                });
            }
        }
        
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

        const pathTarget = unit.pathTarget;
        if (unit.status === UnitStatus.MOVING && pathTarget && !unit.path && unit.pathIndex === undefined && !NavMeshManager.isRequestPending(unit.id)) {
            NavMeshManager.requestPath(unit.id, unit.position, pathTarget);
        }

        let handledMovement = false;

        if (unit.path && unit.pathIndex !== undefined && unit.pathIndex < unit.path.length) {
            const waypoint = unit.path[unit.pathIndex];
            const WAYPOINT_REACHED_DISTANCE_SQ = 4.0;
            if (distanceSqXZ(unitPosX, unitPosZ, waypoint.x, waypoint.z) < WAYPOINT_REACHED_DISTANCE_SQ) {
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
            handledMovement = true;
        }

        if (!handledMovement && unit.status === UnitStatus.MOVING && pathTarget) {
            let arrivalRadiusSq = 4.0;
            if (unit.interactionAnchor) {
                const tightRadius = Math.max(unitRadius + 0.25, 0.35);
                arrivalRadiusSq = Math.max(0.16, tightRadius * tightRadius);
            }

            if (unit.unitType === UnitType.WORKER && unit.targetId) {
                const gatherTarget = resourcesNodes[unit.targetId];
                if (gatherTarget) {
                    const anchorTolerance = Math.max(unitRadius + 0.12, 0.35);
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

        driveWorkerBehavior(state, unit, delta, dispatch, dropoffsByPlayer, frameNow);

        // --- "Attack-Move" Continuation Logic ---
        if (unit.status === UnitStatus.IDLE && unit.finalDestination) {
            if (distanceSqXZ(unitPosX, unitPosZ, unit.finalDestination.x, unit.finalDestination.z) > 9) {
                dispatch({ type: 'COMMAND_UNIT', payload: { unitId: unit.id, targetPosition: unit.finalDestination, finalDestination: unit.finalDestination } });
            } else {
                dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, finalDestination: undefined } });
            }
        }

        // --- Corrective Physics: Depenetration from buildings ---
        const nearbyBuildingIds = buildingGrid.queryNeighbors(unitPosX, unitPosZ, buildingNeighbors);
        let totalPushX = 0;
        let totalPushZ = 0;

        for (const buildingId of nearbyBuildingIds) {
            const building = buildings[buildingId];
            if (building) {
                const pushVector = getDepenetrationVector(unit, building);
                if (pushVector) {
                    totalPushX += pushVector.x;
                    totalPushZ += pushVector.z;
                }
            }
        }

        const nearbyUnitIds = unitGrid.queryNeighbors(unitPosX, unitPosZ, unitNeighbors);
        if (nearbyUnitIds.length > 1) {
            const neighbors = neighborUnits;
            neighbors.length = 0;
            for (const neighborId of nearbyUnitIds) {
                if (neighborId === unit.id) continue;
                const neighbor = units[neighborId];
                if (!neighbor || neighbor.isDying) continue;
                neighbors[neighbors.length] = neighbor;
            }

            if (neighbors.length) {
                const separation = getSeparationVector(unit, neighbors, separationVec);
                if (separation) {
                    const sepX = separation.x;
                    const sepZ = separation.z;
                    const sepLenSq = sepX * sepX + sepZ * sepZ;
                    if (sepLenSq > 1e-6) {
                        const maxPush = unitConfig.speed * delta * 0.6;
                        const sepLen = Math.sqrt(sepLenSq) || 1;
                        const scale = Math.min(maxPush, sepLen) / sepLen;
                        totalPushX += sepX * scale;
                        totalPushZ += sepZ * scale;
                    }
                }
            }
        }

        if (totalPushX !== 0 || totalPushZ !== 0) {
            const projected = NavMeshManager.projectMove(
                unit.position,
                {
                    x: unit.position.x + totalPushX,
                    y: unit.position.y,
                    z: unit.position.z + totalPushZ,
                }
            );

            dispatch({
                type: 'UPDATE_UNIT',
                payload: {
                    id: unit.id,
                    position: projected,
                }
            });
        }
    }
};



