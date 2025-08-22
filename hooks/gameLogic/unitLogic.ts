import * as THREE from 'three';
import { GameState, Action, UnitStatus, ResourceType, UnitType, Unit, GameObjectType, UnitStance, BuildingType, Building, ResourceNode, Vector3, ResearchCategory, FloatingText } from '../../types';
import { UNIT_CONFIG, COLLISION_DATA, BUILDING_CONFIG, REPAIR_TICK_TIME, REPAIR_HP_PER_TICK, RESEARCH_CONFIG, getAttackBonus, getDefenseBonus, DEATH_ANIMATION_DURATION, arePlayersHostile } from '../../constants';
import { v4 as uuidv4 } from 'uuid';
import { BufferedDispatch } from '../../state/batch';
import { PathfindingManager, BUILDING_PADDING } from '../utils/pathfinding';

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

    for (const unit of Object.values(units)) {
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
        // This is the single source for initiating movement. If a unit needs to move,
        // it must have a `pathTarget` set. This logic will then request a path for it.
        if (unit.status === UnitStatus.MOVING && unit.pathTarget && !unit.path && !unit.pathIndex && !PathfindingManager.isRequestPending(unit.id)) {
            PathfindingManager.requestPath(unit.id, unit.position, unit.pathTarget);
        }
        
        // A. Path Following Logic
        // All movement is now driven by following a pre-calculated path.
        if (unit.path && unit.pathIndex !== undefined && unit.pathIndex < unit.path.length) {
            const waypoint = unit.path[unit.pathIndex];
            const currentPos = new THREE.Vector3(unit.position.x, 0, unit.position.z);
            const targetPos = new THREE.Vector3(waypoint.x, 0, waypoint.z);
            const WAYPOINT_REACHED_DISTANCE_SQ = 1.5 * 1.5;

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
                // Move towards current waypoint
                const speed = UNIT_CONFIG[unit.unitType].speed;
                const vectorToTarget = new THREE.Vector3().subVectors(targetPos, currentPos).normalize();
                const moveVector = vectorToTarget.multiplyScalar(speed * delta);
                let nextPos = currentPos.clone().add(moveVector);

                // Prevent units from walking through buildings. If a collision is detected,
                // attempt to slide along the building edge. If the unit still ends up inside
                // the building bounds, push it to the nearest edge and request a new path.
                const unitRadius = COLLISION_DATA.UNITS[unit.unitType].radius;
                let blocked = false;
                for (const building of Object.values(buildings)) {
                    const size = COLLISION_DATA.BUILDINGS[building.buildingType];
                    const halfW = size.width / 2 + unitRadius;
                    const halfD = size.depth / 2 + unitRadius;
                    const dx = nextPos.x - building.position.x;
                    const dz = nextPos.z - building.position.z;

                    if (Math.abs(dx) < halfW && Math.abs(dz) < halfD) {
                        const overlapX = halfW - Math.abs(dx);
                        const overlapZ = halfD - Math.abs(dz);

                        if (overlapX < overlapZ) {
                            nextPos.x = building.position.x + (dx > 0 ? halfW : -halfW);
                        } else {
                            nextPos.z = building.position.z + (dz > 0 ? halfD : -halfD);
                        }

                        const ndx = nextPos.x - building.position.x;
                        const ndz = nextPos.z - building.position.z;
                        if (Math.abs(ndx) < halfW && Math.abs(ndz) < halfD) {
                            blocked = true;
                            break;
                        }
                    }
                }

                if (blocked) {
                    const newPos = { x: nextPos.x, y: 0, z: nextPos.z };
                    const payload: Partial<Unit> & { id: string } = { id: unit.id, position: newPos, path: undefined, pathIndex: undefined, targetPosition: undefined };
                    dispatch({ type: 'UPDATE_UNIT', payload });
                    if (unit.pathTarget && !PathfindingManager.isRequestPending(unit.id)) {
                        PathfindingManager.requestPath(unit.id, newPos, unit.pathTarget);
                    }
                    continue;
                }

                dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, position: { x: nextPos.x, y: 0, z: nextPos.z } } });
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
                const buildingSize = COLLISION_DATA.BUILDINGS[building.buildingType];
                const requiredDistance = Math.max(buildingSize.width / 2, buildingSize.depth / 2) + BUILDING_PADDING + 0.05;
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
                const buildingSize = COLLISION_DATA.BUILDINGS[building.buildingType];
                const requiredDistance = Math.max(buildingSize.width / 2, buildingSize.depth / 2) + BUILDING_PADDING + 0.05;
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

        const now = performance.now();
        const last = unit.lastPositionCheck || { pos: unit.position, time: now };
        const dx = unit.position.x - last.pos.x;
        const dz = unit.position.z - last.pos.z;
        const movedSq = dx * dx + dz * dz;
        if (unit.status === UnitStatus.MOVING) {
            if (now - last.time > 1200) {
                if (movedSq < 0.02 * 0.02 && unit.pathTarget && !PathfindingManager.isRequestPending(unit.id)) {
                    PathfindingManager.requestPath(unit.id, unit.position, unit.pathTarget);
                }
                dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, lastPositionCheck: { pos: unit.position, time: now } } });
            }
        }
    }
};
