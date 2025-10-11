import { v4 as uuidv4 } from 'uuid';
import * as THREE from 'three';
import { GameState, Action, Building, GameObjectType, UnitType, UnitStatus, BuildingType, WorkerOrder } from '../../types';
import { BUILDING_CONFIG, UNIT_CONFIG, TOWER_UPGRADE_CONFIG, COLLISION_DATA } from '../../constants';
import { NavMeshManager } from '../../hooks/utils/navMeshManager';
import { computeBuildingApproachPoint } from '../../hooks/utils/buildingApproach';


export function buildingReducer(state: GameState, action: Action): GameState {
    switch (action.type) {
        case 'COMMAND_BUILD': {
            const { workerIds, type, position } = action.payload;
            if (workerIds.length === 0) return state;

            const worker = state.units[workerIds[0]];
            if (!worker) return state;

            const playerId = worker.playerId;
            const player = state.players[playerId];
            const resources = player.resources;
            const config = BUILDING_CONFIG[type];

            if (resources.gold < config.cost.gold || resources.wood < config.cost.wood) {
                return state;
            }

            if (type === BuildingType.HOUSE) {
                const houseCount = Object.values(state.buildings).filter(b => b.playerId === playerId && b.buildingType === BuildingType.HOUSE).length;
                if (houseCount >= 10) {
                    return state;
                }
            }


            const newBuildingId = uuidv4();
            const newBuilding: Building = {
                id: newBuildingId,
                type: GameObjectType.BUILDING,
                buildingType: type,
                playerId: playerId,
                position,
                hp: 1,
                maxHp: config.hp,
                trainingQueue: [],
                researchQueue: (type === BuildingType.RESEARCH_CENTER || type === BuildingType.MARKET) ? [] : undefined,
                constructionProgress: 0,
                defense: config.defense,
                attackDamage: (config as any).attackDamage,
                attackRange: (config as any).attackRange,
                attackSpeed: (config as any).attackSpeed,
            };

            const updatedUnits = { ...state.units };
            const now = Date.now();
            const buildingSize = COLLISION_DATA.BUILDINGS[type];

            // --- Eject any units trapped by the new building foundation ---
            const buildingBox = {
                minX: position.x - buildingSize.width / 2,
                maxX: position.x + buildingSize.width / 2,
                minZ: position.z - buildingSize.depth / 2,
                maxZ: position.z + buildingSize.depth / 2,
            };

            Object.values(state.units).forEach(unit => {
                if (
                    !unit.isDying &&
                    unit.position.x > buildingBox.minX && unit.position.x < buildingBox.maxX &&
                    unit.position.z > buildingBox.minZ && unit.position.z < buildingBox.maxZ
                ) {
                    // This unit is trapped. Find an escape position.
                    const buildingCenter = new THREE.Vector3(position.x, 0, position.z);
                    const unitPos = new THREE.Vector3(unit.position.x, 0, unit.position.z);
                    const ejectVector = new THREE.Vector3().subVectors(unitPos, buildingCenter);
            
                    // If vector is zero (unit is at the center), pick a random direction
                    if (ejectVector.lengthSq() < 0.01) {
                        ejectVector.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
                    } else {
                        ejectVector.normalize();
                    }
            
                    const unitRadius = COLLISION_DATA.UNITS[unit.unitType].radius;
                    const ejectDistance = Math.max(buildingSize.width / 2, buildingSize.depth / 2) + unitRadius + 0.5;
                    const escapePos = buildingCenter.clone().add(ejectVector.multiplyScalar(ejectDistance));
            
                    // Update the unit to move it out of the way. This is a high-priority command.
                    // If this unit is a builder, its build task will be correctly reassigned below.
                    updatedUnits[unit.id] = {
                        ...unit,
                        status: UnitStatus.MOVING,
                        pathTarget: { x: escapePos.x, y: 0, z: escapePos.z },
                        targetId: undefined,
                        buildTask: undefined,
                        repairTask: undefined,
                        workerOrder: undefined,
                        gatherTargetId: undefined,
                        isHarvesting: false,
                        harvestingResourceType: undefined,
                        gatherTimer: undefined,
                        buildTimer: undefined,
                        repairTimer: undefined,
                        interactionAnchor: undefined,
                        interactionRadius: undefined,
                        path: undefined,
                        pathIndex: undefined,
                        targetPosition: undefined,
                        finalDestination: undefined,
                    };
                }
            });


            const requiredDistance = Math.max(buildingSize.width / 2, buildingSize.depth / 2) + 1.5;

            workerIds.forEach((workerId, index) => {
                const w = updatedUnits[workerId] || state.units[workerId];
                if (w) {
                    const angle = (index / workerIds.length) * 2 * Math.PI;
                    const desired = {
                        x: position.x + Math.cos(angle) * requiredDistance,
                        y: 0,
                        z: position.z + Math.sin(angle) * requiredDistance,
                    };
                    const approach = computeBuildingApproachPoint(w, newBuilding, desired);
                    const interactionRadius = Math.hypot(approach.x - position.x, approach.z - position.z);
                    const buildOrder: WorkerOrder = {
                        kind: 'build',
                        buildingId: newBuildingId,
                        phase: 'travelToSite',
                        anchor: approach,
                        radius: interactionRadius,
                        issuedAt: now,
                        lastProgressAt: now,
                        retries: 0,
                    };

                    updatedUnits[workerId] = {
                        ...w,
                        status: UnitStatus.MOVING,
                        pathTarget: approach,
                        targetId: newBuildingId,
                        buildTask: { buildingId: newBuildingId, position },
                        repairTask: undefined,
                        workerOrder: buildOrder,
                        interactionAnchor: approach,
                        interactionRadius,
                        gatherTargetId: undefined,
                        isHarvesting: false,
                        harvestingResourceType: undefined,
                        gatherTimer: undefined,
                        buildTimer: 0,
                        repairTimer: undefined,
                        finalDestination: undefined,
                        path: undefined,
                        pathIndex: undefined,
                        targetPosition: undefined,
                    };
                }
            });

            const updatedResources = {
                ...resources,
                gold: resources.gold - config.cost.gold,
                wood: resources.wood - config.cost.wood,
            };
            
            const newPlayers = [...state.players];
            newPlayers[playerId] = { ...player, resources: updatedResources };

            const newState: GameState = {
                ...state,
                players: newPlayers,
                units: updatedUnits,
                buildings: { ...state.buildings, [newBuildingId]: newBuilding },
                buildMode: player.isHuman ? null : state.buildMode,
            };

            return newState;
        }
        case 'ADD_BUILDING': {
            const { building } = action.payload;
            return { ...state, buildings: { ...state.buildings, [building.id]: building } };
        }
        case 'UPDATE_BUILDING': {
            const { id, ...rest } = action.payload;
            const originalBuilding = state.buildings[id];
            if (!originalBuilding) return state;
            
            const updatedBuilding = { ...originalBuilding, ...rest };

            if (rest.hp !== undefined && rest.hp <= 0) {
                const newBuildings = { ...state.buildings };
                delete newBuildings[id];

                // If the building was fully constructed, remove its navmesh obstacle
                if (originalBuilding.constructionProgress === undefined) {
                    NavMeshManager.removeObstacle(originalBuilding);
                }

                const updatedUnits = { ...state.units };
                Object.keys(updatedUnits).forEach(unitId => {
                    const unit = updatedUnits[unitId];
                    if (unit.targetId === id || unit.buildTask?.buildingId === id) {
                        updatedUnits[unitId] = {
                            ...unit,
                            status: UnitStatus.IDLE,
                            targetId: undefined,
                            buildTask: undefined,
                            repairTask: undefined,
                            workerOrder: undefined,
                            gatherTargetId: undefined,
                            isHarvesting: false,
                            harvestingResourceType: undefined,
                            pathTarget: undefined,
                            interactionAnchor: undefined,
                            interactionRadius: undefined,
                        };
                    }
                });

                const updatedBuildingState = { ...newBuildings };
                 Object.keys(updatedBuildingState).forEach(bId => {
                    const b = updatedBuildingState[bId];
                    if (b.targetId === id) {
                        updatedBuildingState[bId] = { ...b, targetId: undefined };
                    }
                });
                
                let nextState: GameState = {
                    ...state,
                    buildings: updatedBuildingState,
                    units: updatedUnits,
                    selectedIds: state.selectedIds.filter(sid => sid !== id),
                };

                if (originalBuilding.buildingType === BuildingType.HOUSE && originalBuilding.constructionProgress === undefined) {
                     const playerId = originalBuilding.playerId;
                     const player = state.players[playerId];
                     const newPlayers = [...state.players];
                     newPlayers[playerId] = {
                         ...player,
                         population: {
                            ...player.population,
                            cap: Math.max(10, player.population.cap - 10)
                         }
                     };
                     nextState.players = newPlayers;
                }
                
                return nextState;

            } else {
                 return { ...state, buildings: { ...state.buildings, [id]: updatedBuilding } };
            }
        }
        case 'CONTRIBUTE_TO_BUILDING': {
            const { buildingId, contribution } = action.payload;
            const building = state.buildings[buildingId];
            if (!building || building.constructionProgress === undefined) return state;

            const newProgress = (building.constructionProgress || 0) + contribution;

            if (newProgress >= 1) {
                const finalBuilding = { ...building, hp: building.maxHp, constructionProgress: undefined };
                
                // Add navmesh obstacle for the completed building
                NavMeshManager.addObstacle(finalBuilding);
                
                let nextState: GameState = { ...state };

                if (finalBuilding.buildingType === BuildingType.HOUSE) {
                    const playerId = finalBuilding.playerId;
                    const player = state.players[playerId];
                    const newCap = Math.min(100, player.population.cap + 10);
                    const newPlayers = [...state.players];
                    newPlayers[playerId] = {
                        ...player,
                        population: {
                           ...player.population,
                           cap: newCap
                        }
                    };
                    nextState.players = newPlayers;
                }

                const updatedUnits = { ...state.units };
                Object.values(state.units).forEach(u => {
                    if (u.buildTask?.buildingId === buildingId) {
                        updatedUnits[u.id] = { ...u, status: UnitStatus.IDLE, buildTask: undefined, buildTimer: undefined };
                    }
                });
                
                nextState.buildings = { ...state.buildings, [buildingId]: finalBuilding };
                nextState.units = updatedUnits;
                return nextState;

            } else {
                const newHp = Math.max(1, Math.floor(newProgress * building.maxHp));
                const updatedBuilding = { ...building, constructionProgress: newProgress, hp: newHp };
                return { ...state, buildings: { ...state.buildings, [buildingId]: updatedBuilding } };
            }
        }
        case 'TRAIN_UNIT': {
            const { buildingId, unitType } = action.payload;
            const building = state.buildings[buildingId];
            if (!building) return state;

            const playerId = building.playerId;
            const player = state.players[playerId];
            const population = player.population;

            if(population.current >= population.cap) {
                return state;
            }

            const resources = player.resources;
            const config = UNIT_CONFIG[unitType];

            if (resources.gold < config.cost.gold || resources.wood < config.cost.wood) {
                return state;
            }

            const newQueue = [...building.trainingQueue, { unitType, progress: 0 }];
            const updatedResources = {
                gold: resources.gold - config.cost.gold,
                wood: resources.wood - config.cost.wood,
            };
            
            const newPlayers = [...state.players];
            newPlayers[playerId] = { ...player, resources: updatedResources };

            const newState: GameState = { 
                ...state,
                players: newPlayers,
                buildings: { ...state.buildings, [buildingId]: { ...building, trainingQueue: newQueue } } 
            };
            
            return newState;
        }
        case 'CANCEL_TRAIN_UNIT': {
            const { buildingId, queueIndex } = action.payload;
            const building = state.buildings[buildingId];

            if (!building || !building.trainingQueue[queueIndex]) {
                return state;
            }
            
            const player = state.players[building.playerId];
            if (!player.isHuman) return state; // Only human can cancel

            const unitToCancel = building.trainingQueue[queueIndex];
            const config = UNIT_CONFIG[unitToCancel.unitType];
            
            const updatedResources = {
                ...player.resources,
                gold: player.resources.gold + config.cost.gold,
                wood: player.resources.wood + config.cost.wood,
            };
            
            const newPlayers = [...state.players];
            newPlayers[player.id] = { ...player, resources: updatedResources };

            const newQueue = building.trainingQueue.filter((_, i) => i !== queueIndex);

            return {
                ...state,
                players: newPlayers,
                buildings: {
                    ...state.buildings,
                    [buildingId]: { ...building, trainingQueue: newQueue }
                }
            };
        }
        case 'SPAWN_UNIT_FROM_QUEUE': {
            const { buildingId } = action.payload;
            const building = state.buildings[buildingId];

            if (!building || building.trainingQueue.length === 0) {
                return state;
            }

            const newQueue = building.trainingQueue.slice(1);

            return {
                ...state,
                buildings: {
                    ...state.buildings,
                    [buildingId]: { ...building, trainingQueue: newQueue }
                }
            };
        }
        case 'UPGRADE_TOWER': {
            const { buildingId } = action.payload;
            const building = state.buildings[buildingId];
            if (!building || building.buildingType !== BuildingType.DEFENSIVE_TOWER || building.isUpgraded || building.upgradeTimer !== undefined || building.constructionProgress !== undefined) {
                return state;
            }

            const playerId = building.playerId;
            const player = state.players[playerId];
            const resources = player.resources;
            const config = TOWER_UPGRADE_CONFIG;
            if (resources.gold < config.cost.gold || resources.wood < config.cost.wood) {
                return state;
            }

            const updatedResources = {
                gold: resources.gold - config.cost.gold,
                wood: resources.wood - config.cost.wood,
            };
            
            const newPlayers = [...state.players];
            newPlayers[playerId] = { ...player, resources: updatedResources };

            const updatedBuilding = {
                ...building,
                upgradeProgress: 0.001,
                upgradeTimer: 0,
            };
            
            const newState: GameState = {
                ...state,
                players: newPlayers,
                buildings: { ...state.buildings, [buildingId]: updatedBuilding },
            };

            return newState;
        }
        case 'SET_RALLY_POINT': {
            const { buildingId, position } = action.payload;
            const building = state.buildings[buildingId];
            if (!building) {
                return state;
            }
            const player = state.players[building.playerId];
            if (!player.isHuman) return state;


            return {
                ...state,
                buildings: {
                    ...state.buildings,
                    [buildingId]: { ...building, rallyPoint: position },
                },
            };
        }
        case 'UPDATE_TRAINING_PROGRESS': {
            const { buildingId, progress } = action.payload;
            const building = state.buildings[buildingId];
            if (!building || building.trainingQueue.length === 0) {
                return state;
            }

            // Create a new queue with the updated progress for the first item
            const newQueue = [...building.trainingQueue];
            newQueue[0] = { ...newQueue[0], progress };

            const updatedBuilding = { ...building, trainingQueue: newQueue };

            return {
                ...state,
                buildings: {
                    ...state.buildings,
                    [buildingId]: updatedBuilding,
                },
            };
        }
        default:
            return state;
    }
}
