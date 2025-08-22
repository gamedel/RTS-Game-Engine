import { v4 as uuidv4 } from 'uuid';
import { GameState, Action, Building, GameObjectType, UnitType, UnitStatus, BuildingType } from '../../types';
import { BUILDING_CONFIG, UNIT_CONFIG, TOWER_UPGRADE_CONFIG, COLLISION_DATA } from '../../constants';
import { BUILDING_PADDING } from '../../hooks/utils/pathfinding';


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
            const buildingSize = COLLISION_DATA.BUILDINGS[type];
            const ring = Math.max(buildingSize.width / 2, buildingSize.depth / 2) + BUILDING_PADDING + 0.1;

            workerIds.forEach((workerId, index) => {
                const w = state.units[workerId];
                if(w) {
                    const angle = (index / workerIds.length) * 2 * Math.PI;
                    const targetPos = {
                        x: position.x + Math.cos(angle) * ring,
                        y: 0,
                        z: position.z + Math.sin(angle) * ring
                    };

                    updatedUnits[workerId] = {
                        ...w,
                        status: UnitStatus.MOVING,
                        pathTarget: targetPos,
                        targetId: newBuildingId,
                        buildTask: { buildingId: newBuildingId, position },
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

                const updatedUnits = { ...state.units };
                Object.keys(updatedUnits).forEach(unitId => {
                    const unit = updatedUnits[unitId];
                    if (unit.targetId === id || unit.buildTask?.buildingId === id) {
                        updatedUnits[unitId] = { ...unit, status: UnitStatus.IDLE, targetId: undefined, buildTask: undefined, pathTarget: undefined };
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