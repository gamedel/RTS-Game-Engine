import * as THREE from 'three';
import { GameState, Action, UnitStatus, ResourceType, UnitType, Unit, GameObjectType, UnitStance, BuildingType, Building, ResourceNode, Vector3, ResearchCategory, FloatingText } from '../../types';
import { UNIT_CONFIG, COLLISION_DATA, BUILDING_CONFIG, REPAIR_TICK_TIME, REPAIR_HP_PER_TICK, RESEARCH_CONFIG, getAttackBonus, getDefenseBonus, DEATH_ANIMATION_DURATION, arePlayersHostile, getBuildingCollisionMask } from '../../constants';
import { v4 as uuidv4 } from 'uuid';
import { BufferedDispatch } from '../../state/batch';
import { NavMeshManager } from '../utils/navMeshManager';
import { getDepenetrationVector, getSeparationVector } from '../utils/physics';
import { SpatialHash } from '../utils/spatial';

// Helper to find the nearest object from a list to a given unit
const findClosest = <T extends Unit | Building | ResourceNode>(unit: Unit, objects: T[]): T | null => {
    if (objects.length === 0) return null;
    const unitPos = new THREE.Vector3(unit.position.x, 0, unit.position.z);
    let closest: T | null = null;
    let minDistanceSq = Infinity;

    for (const obj of objects) {
        if ((obj as Unit).isDying) continue;
        const objPos = new THREE.Vector3(obj.position.x, 0, obj.position.z);
        const distanceSq = unitPos.distanceToSquared(objPos);
        if (distanceSq < minDistanceSq) {
            minDistanceSq = distanceSq;
            closest = obj;
        }
    }
    return closest;
};

// Helper to find the closest resource drop-off point (Town Hall or Warehouse) for a unit
const findClosestDropOffPoint = (unit: Unit, buildings: Record<string, Building>): Building | null => {
    const unitPos = new THREE.Vector3(unit.position.x, 0, unit.position.z);
    let closest: Building | null = null;
    let minDistanceSq = Infinity;
    const friendlyDropOffs = Object.values(buildings).filter(b => 
        b.playerId === unit.playerId && 
        (b.buildingType === BuildingType.TOWN_HALL || b.buildingType === BuildingType.WAREHOUSE) && 
        b.constructionProgress === undefined // only fully built
    );
    
    for (const dropOff of friendlyDropOffs) {
        const dropOffPos = new THREE.Vector3(dropOff.position.x, 0, dropOff.position.z);
        const distanceSq = unitPos.distanceToSquared(dropOffPos);
        if (distanceSq < minDistanceSq) {
            minDistanceSq = distanceSq;
            closest = dropOff;
        }
    }
    return closest;
};


// New function to find and assign a new resource gathering task to a worker
const findAndAssignNewResource = (unit: Unit, originalResourceType: ResourceType | undefined, state: GameState, dispatch: BufferedDispatch) => {
    if (originalResourceType) {
        const sameTypeResources = Object.values(state.resourcesNodes).filter(
            r => r.amount > 0 && !r.isFalling && r.resourceType === originalResourceType
        );
        const targetResource = findClosest(unit, sameTypeResources);

        if (targetResource) {
            dispatch({ type: 'COMMAND_UNIT', payload: { unitId: unit.id, targetPosition: targetResource.position, targetId: targetResource.id } });
            return;
        }
    }
    
    dispatch({ type: 'UPDATE_UNIT', payload: { 
        id: unit.id, 
        status: UnitStatus.IDLE, 
        gatherTargetId: undefined, 
        targetId: undefined,
        targetPosition: undefined,
        harvestingResourceType: undefined
    }});
};

// --- Main Unit Logic ---

export const processUnitLogic = (state: GameState, delta: number, dispatch: BufferedDispatch) => {
    const { units, resourcesNodes, buildings, players } = state;

    const buildingGrid = new SpatialHash(10);
    Object.values(buildings).forEach(b => buildingGrid.insert(b.id, b.position.x, b.position.z));
    const unitGrid = new SpatialHash(5);
    Object.values(units).forEach(u => unitGrid.insert(u.id, u.position.x, u.position.z));


    for (const unit of Object.values(units)) {
        // --- Stuck Detection Logic ---
        const now = performance.now();
        if (unit.lastPositionCheck === undefined) {
            dispatch({
                type: 'UPDATE_UNIT',
                payload: { id: unit.id, lastPositionCheck: { pos: unit.position, time: now } }
            });
        } else {
            if (now - unit.lastPositionCheck.time > 700) {
                const dx = unit.position.x - unit.lastPositionCheck.pos.x;
                const dz = unit.position.z - unit.lastPositionCheck.pos.z;
                const movedSq = dx * dx + dz * dz;

                if ((unit.status === UnitStatus.MOVING || !!unit.path) && unit.pathTarget && movedSq < 0.1 * 0.1) {
                    NavMeshManager.requestPath(unit.id, unit.position, unit.pathTarget);
                }

                dispatch({
                    type: 'UPDATE_UNIT',
                    payload: { id: unit.id, lastPositionCheck: { pos: unit.position, time: now } }
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
        const unitVec = new THREE.Vector3(unit.position.x, unit.position.y, unit.position.z);

        // --- Pathfinding Request ---
        if (unit.status === UnitStatus.MOVING && unit.pathTarget && !unit.path && !unit.pathIndex && !NavMeshManager.isRequestPending(unit.id)) {
            NavMeshManager.requestPath(unit.id, unit.position, unit.pathTarget);
        }
        
        // A. Path Following Logic
        if (unit.path && unit.pathIndex !== undefined && unit.pathIndex < unit.path.length) {
            const waypoint = unit.path[unit.pathIndex];
            const currentPos = new THREE.Vector3(unit.position.x, 0, unit.position.z);
            const targetPos = new THREE.Vector3(waypoint.x, 0, waypoint.z);
            const WAYPOINT_REACHED_DISTANCE_SQ = 2.0 * 2.0;

            if (currentPos.distanceToSquared(targetPos) < WAYPOINT_REACHED_DISTANCE_SQ) {
                const newPathIndex = unit.pathIndex + 1;
                if (newPathIndex >= unit.path.length) {
                    // Reached end of path.
                    const targetBuilding = unit.targetId ? buildings[unit.targetId] : null;
                    const isWorkerArrivingAtDropoff = unit.unitType === UnitType.WORKER && targetBuilding && unit.playerId === targetBuilding.playerId &&
                        (targetBuilding.buildingType === BuildingType.TOWN_HALL || targetBuilding.buildingType === BuildingType.WAREHOUSE) &&
                        unit.resourcePayload && unit.resourcePayload.amount > 0;

                    if (isWorkerArrivingAtDropoff) {
                        dispatch({ type: 'WORKER_FINISH_DROPOFF', payload: { workerId: unit.id } });
                    } else {
                        let newFinalDestination = unit.finalDestination;
                        if (unit.finalDestination) {
                            const finalDestVec = new THREE.Vector3(unit.finalDestination.x, 0, unit.finalDestination.z);
                            const lastWaypoint = unit.path[unit.path.length - 1];
                            const lastWaypointVec = new THREE.Vector3(lastWaypoint.x, 0, lastWaypoint.z);
                            if (lastWaypointVec.distanceToSquared(finalDestVec) < 4 * 4) {
                                newFinalDestination = undefined;
                            }
                        }

                        const payload: Partial<Unit> & { id: string } = {
                            id: unit.id, path: undefined, pathIndex: undefined, pathTarget: undefined, targetPosition: undefined,
                            finalDestination: newFinalDestination,
                            status: UnitStatus.IDLE
                        };

                        const target = unit.targetId ? (units[unit.targetId] || buildings[unit.targetId] || resourcesNodes[unit.targetId]) : null;
                        if (unit.buildTask) payload.status = UnitStatus.BUILDING;
                        else if (unit.repairTask) payload.status = UnitStatus.REPAIRING;
                        else if (target && target.type === GameObjectType.RESOURCE && unit.unitType === UnitType.WORKER) payload.status = UnitStatus.GATHERING;
                        else if (target && arePlayersHostile(owner, players[target.playerId!])) payload.status = UnitStatus.ATTACKING;

                        dispatch({ type: 'UPDATE_UNIT', payload });
                    }
                } else {
                    // Move to next waypoint
                    dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, pathIndex: newPathIndex } });
                }
            } else {
                const step = Math.max(UNIT_CONFIG[unit.unitType].speed * delta, 0.01);
                const next = NavMeshManager.advanceOnNav(
                  { x: unit.position.x, y: 0, z: unit.position.z },
                  { x: waypoint.x,      y: 0, z: waypoint.z },
                  step
                );
                dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, position: next } });
            }
        } 

        // --- Non-Movement & Timer Logic (when not following a path) ---
        if (!unit.path) {
            if (unit.status === UnitStatus.GATHERING) {
                const gatherTarget = unit.targetId ? resourcesNodes[unit.targetId] : null;
                if (!gatherTarget || gatherTarget.amount <= 0 || gatherTarget.isFalling) {
                    findAndAssignNewResource(unit, unit.harvestingResourceType, state, dispatch);
                    continue;
                }
                const config = UNIT_CONFIG[UnitType.WORKER];
                const gatherTime = config.gatherTime;
                const newTimer = (unit.gatherTimer || 0) + delta;

                if (newTimer >= gatherTime) {
                    const resourceType = gatherTarget.resourceType === ResourceType.TREE ? 'WOOD' : 'GOLD';
                    const amountToGather = 1;

                    const newAmount = gatherTarget.amount - amountToGather;

                    dispatch({ type: 'UPDATE_RESOURCE_NODE', payload: { id: gatherTarget.id, amount: newAmount } });

                    if (newAmount <= 0) {
                        if (gatherTarget.resourceType === ResourceType.TREE) {
                            dispatch({ type: 'UPDATE_RESOURCE_NODE', payload: { id: gatherTarget.id, isFalling: true, fallStartTime: Date.now() } });
                        } else { // Gold mine
                            dispatch({ type: 'UPDATE_RESOURCE_NODE', payload: { id: gatherTarget.id, isDepleting: true, depletionStartTime: Date.now() } });
                        }
                    }
                    
                    const currentPayload = unit.resourcePayload || { type: resourceType, amount: 0 };
                    const newPayloadAmount = currentPayload.amount + amountToGather;

                    const carryCapacity = config.carryCapacity + (owner.research[ResearchCategory.WORKER_CAPACITY] * RESEARCH_CONFIG[ResearchCategory.WORKER_CAPACITY].bonus);

                    if (newPayloadAmount >= carryCapacity) {
                        const dropOff = findClosestDropOffPoint(unit, buildings);
                        if (dropOff) {
                            dispatch({ 
                                type: 'UPDATE_UNIT', 
                                payload: { 
                                    id: unit.id, 
                                    gatherTimer: 0, 
                                    resourcePayload: { type: resourceType, amount: newPayloadAmount },
                                    status: UnitStatus.MOVING,
                                    targetId: dropOff.id,
                                    pathTarget: dropOff.position,
                                    gatherTargetId: gatherTarget.id,
                                    path: undefined,
                                    pathIndex: undefined,
                                    targetPosition: undefined,
                                } 
                            });
                        } else {
                             dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, status: UnitStatus.IDLE, gatherTimer: 0, resourcePayload: undefined } });
                        }
                    } else {
                        dispatch({
                            type: 'UPDATE_UNIT',
                            payload: {
                                id: unit.id,
                                gatherTimer: 0,
                                resourcePayload: { type: resourceType, amount: newPayloadAmount }
                            }
                        });
                    }
                } else {
                    dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, gatherTimer: newTimer } });
                }
            }

            if (unit.status === UnitStatus.BUILDING) {
                const buildTask = unit.buildTask;
                if (!buildTask) {
                    dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, status: UnitStatus.IDLE } });
                    continue;
                }

                const building = buildings[buildTask.buildingId];
                if (!building || building.constructionProgress === undefined) {
                    dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, status: UnitStatus.IDLE, buildTask: undefined, buildTimer: undefined } });
                    continue;
                }
                
                const dx = unit.position.x - building.position.x;
                const dz = unit.position.z - building.position.z;
                const distanceSq = dx * dx + dz * dz;
                const buildingSize = getBuildingCollisionMask(building.buildingType);
                const buildingRadius = Math.max(buildingSize.width, buildingSize.depth) / 2;
                const workerInteractionRange = UNIT_CONFIG[UnitType.WORKER].attackRange;
                const requiredDistance = buildingRadius + workerInteractionRange;

                if (distanceSq > requiredDistance * requiredDistance) {
                    dispatch({ type: 'COMMAND_UNIT', payload: { unitId: unit.id, targetPosition: building.position, targetId: building.id } });
                    continue;
                }

                const BUILD_TICK_TIME = 0.5;
                const newTimer = (unit.buildTimer || 0) + delta;

                if (newTimer >= BUILD_TICK_TIME) {
                    const buildTime = BUILDING_CONFIG[building.buildingType].buildTime;
                    const contribution = BUILD_TICK_TIME / buildTime;
                    
                    dispatch({ type: 'CONTRIBUTE_TO_BUILDING', payload: { buildingId: building.id, contribution } });
                    dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, buildTimer: 0 } });
                } else {
                    dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, buildTimer: newTimer } });
                }
            }

            if (unit.status === UnitStatus.REPAIRING) {
                const repairTask = unit.repairTask;
                if (!repairTask) {
                    dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, status: UnitStatus.IDLE } });
                    continue;
                }

                const building = buildings[repairTask.buildingId];
                if (!building || building.hp >= building.maxHp || building.constructionProgress !== undefined) {
                    dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, status: UnitStatus.IDLE, repairTask: undefined, repairTimer: undefined } });
                    continue;
                }

                const dx = unit.position.x - building.position.x;
                const dz = unit.position.z - building.position.z;
                const distanceSq = dx * dx + dz * dz;
                const buildingSize = getBuildingCollisionMask(building.buildingType);
                const buildingRadius = Math.max(buildingSize.width, buildingSize.depth) / 2;
                const workerInteractionRange = UNIT_CONFIG[UnitType.WORKER].attackRange;
                const requiredDistance = buildingRadius + workerInteractionRange;
                
                if (distanceSq > requiredDistance * requiredDistance) {
                    dispatch({ type: 'COMMAND_UNIT', payload: { unitId: unit.id, targetPosition: building.position, targetId: building.id } });
                    continue;
                }
                
                const newTimer = (unit.repairTimer || 0) + delta;
                if (newTimer >= REPAIR_TICK_TIME) {
                    const newHp = Math.min(building.maxHp, building.hp + REPAIR_HP_PER_TICK);
                    dispatch({ type: 'UPDATE_BUILDING', payload: { id: building.id, hp: newHp } });
                    dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, repairTimer: 0 } });
                } else {
                    dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, repairTimer: newTimer } });
                }
            }
            
            // --- "Attack-Move" Continuation Logic ---
            if (unit.status === UnitStatus.IDLE && unit.finalDestination) {
                const destVec = new THREE.Vector3(unit.finalDestination.x, 0, unit.finalDestination.z);
                if (unitVec.distanceToSquared(destVec) > 3 * 3) {
                    dispatch({ type: 'COMMAND_UNIT', payload: { unitId: unit.id, targetPosition: unit.finalDestination, finalDestination: unit.finalDestination } });
                } else {
                    dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, finalDestination: undefined } });
                }
            }
        }

        // --- Corrective Physics: Depenetration from buildings ---
        const nearbyBuildingIds = buildingGrid.queryNeighbors(unit.position.x, unit.position.z);
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

        const nearbyUnitIds = unitGrid.queryNeighbors(unit.position.x, unit.position.z);
        if (nearbyUnitIds.length > 1) {
            const neighbors: Unit[] = [];
            for (const neighborId of nearbyUnitIds) {
                if (neighborId === unit.id) continue;
                const neighbor = units[neighborId];
                if (!neighbor || neighbor.isDying) continue;
                neighbors.push(neighbor);
            }

            if (neighbors.length) {
                const separation = getSeparationVector(unit, neighbors);
                if (separation.lengthSq() > 1e-6) {
                    const maxPush = UNIT_CONFIG[unit.unitType].speed * delta * 0.6;
                    const separationLength = separation.length();
                    separation.setLength(Math.min(maxPush, separationLength));
                    totalPushX += separation.x;
                    totalPushZ += separation.z;
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