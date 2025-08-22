import * as THREE from 'three';
import { v4 as uuidv4 } from 'uuid';
import { GameState, Action, Unit, GameObjectType, UnitType, UnitStatus, Building, ResourceNode, FloatingText, UnitStance, BuildingType, ResourceType, Vector3, ResearchCategory } from '../../types';
import { UNIT_CONFIG, COLLISION_DATA, RESEARCH_CONFIG } from '../../constants';

export function unitReducer(state: GameState, action: Action): GameState {
    switch (action.type) {
        case 'COMMAND_UNIT': {
            const { unitId, targetPosition, targetId, finalDestination } = action.payload;
            const unit = state.units[unitId];
            if (!unit) return state;

            const targetObject = targetId ?
                state.units[targetId] || state.buildings[targetId] || state.resourcesNodes[targetId]
                : null;
            
            let newFinalDestination: Vector3 | undefined = unit.finalDestination;
            if (action.payload.finalDestination) {
                newFinalDestination = action.payload.finalDestination;
            }

            let taskAssignment: { isHarvesting: boolean; harvestingResourceType?: ResourceType } = {
                isHarvesting: unit.isHarvesting,
                harvestingResourceType: unit.harvestingResourceType,
            };
            
            if (unit.status === UnitStatus.FLEEING && targetObject?.type === GameObjectType.BUILDING) {
                 return { ...state, units: { ...state.units, [unitId]: { ...unit, targetPosition: targetPosition, targetId: targetId, path: undefined, pathIndex: undefined, pathTarget: undefined } }};
            }

            const isWorkerRepairing =
                unit.unitType === UnitType.WORKER &&
                targetObject?.type === GameObjectType.BUILDING &&
                targetObject.playerId === unit.playerId &&
                (targetObject as Building).hp < (targetObject as Building).maxHp &&
                (targetObject as Building).constructionProgress === undefined;

            const isWorkerConstructing = 
                unit.unitType === UnitType.WORKER && 
                targetObject?.type === GameObjectType.BUILDING && 
                (targetObject as Building).constructionProgress !== undefined;

            const isGatherCommand = unit.unitType === UnitType.WORKER && targetObject?.type === GameObjectType.RESOURCE;
            
            const isSpecialTask = isWorkerRepairing || isWorkerConstructing || isGatherCommand;
            if (isSpecialTask) {
                newFinalDestination = undefined;
                taskAssignment = { isHarvesting: isGatherCommand, harvestingResourceType: isGatherCommand ? (targetObject as ResourceNode).resourceType : undefined };
            } else if (!targetObject || targetObject.playerId === unit.playerId) {
                // This is a simple move command, not a persistent harvest task
                taskAssignment = { isHarvesting: false, harvestingResourceType: undefined };
            }


            if (isWorkerRepairing) {
                 return { ...state, units: { ...state.units, [unitId]: { ...unit, ...taskAssignment, status: UnitStatus.MOVING, pathTarget: targetPosition, targetId: targetId, repairTask: { buildingId: targetId! }, buildTask: undefined, resourcePayload: undefined, finalDestination: newFinalDestination, path: undefined, pathIndex: undefined, targetPosition: undefined } } };
            }
            if (isWorkerConstructing) {
                const building = targetObject as Building;
                return { ...state, units: { ...state.units, [unitId]: { ...unit, ...taskAssignment, status: UnitStatus.MOVING, pathTarget: building.position, targetId: building.id, buildTask: { buildingId: building.id, position: building.position }, finalDestination: newFinalDestination, path: undefined, pathIndex: undefined, targetPosition: undefined } } };
            }

            let finalTargetPosition = targetPosition;
            if (isGatherCommand) {
                const resource = targetObject as ResourceNode;
                const resourceConfig = COLLISION_DATA.RESOURCES[resource.resourceType];
                const unitConfig = COLLISION_DATA.UNITS[unit.unitType];
                const stoppingDistance = resourceConfig.radius + unitConfig.radius + 0.2;
                const numSlots = 8;
                const resourceCenter = new THREE.Vector3(resource.position.x, 0, resource.position.z);
                const otherWorkersAtResource = Object.values(state.units).filter(u => u.id !== unitId && u.unitType === UnitType.WORKER && (u.targetId === resource.id || u.gatherTargetId === resource.id));
                const occupiedPositions = otherWorkersAtResource.map(u => {
                    const target = u.pathTarget || u.targetPosition; // Use pathTarget first
                    return target ? new THREE.Vector3(target.x, target.y, target.z) : new THREE.Vector3(u.position.x, u.position.y, u.position.z)
                });
                let bestSlot: THREE.Vector3 | null = null;
                let minDistanceSq = Infinity;
                for (let i = 0; i < numSlots; i++) {
                    const angle = (i / numSlots) * Math.PI * 2;
                    const slotPosition = new THREE.Vector3(resourceCenter.x + stoppingDistance * Math.cos(angle), 0, resourceCenter.z + stoppingDistance * Math.sin(angle));
                    const isOccupied = occupiedPositions.some(p => p.distanceToSquared(slotPosition) < (unitConfig.radius * 2) ** 2);
                    if (!isOccupied) {
                        const distanceSqToUnit = slotPosition.distanceToSquared(new THREE.Vector3(unit.position.x, 0, unit.position.z));
                        if (distanceSqToUnit < minDistanceSq) {
                            minDistanceSq = distanceSqToUnit;
                            bestSlot = slotPosition;
                        }
                    }
                }
                finalTargetPosition = bestSlot ? { x: bestSlot.x, y: 0, z: bestSlot.z } : finalTargetPosition;
            }

            const updatedUnit: Unit = {
                ...unit,
                ...taskAssignment,
                status: UnitStatus.MOVING,
                pathTarget: finalTargetPosition,
                targetId,
                finalDestination: newFinalDestination,
                buildTask: undefined,
                repairTask: undefined,
                buildTimer: undefined,
                repairTimer: undefined,
                gatherTimer: 0,
                // Do not clear payload on move command, worker might be repositioning with resources
                resourcePayload: isGatherCommand ? undefined : unit.resourcePayload, 
                path: undefined,
                pathIndex: undefined,
                targetPosition: undefined,
            };

            return { ...state, units: { ...state.units, [unitId]: updatedUnit } };
        }
        case 'WORKER_FINISH_DROPOFF': {
            const { workerId } = action.payload;
            const worker = state.units[workerId];

            if (!worker || !worker.resourcePayload || worker.resourcePayload.amount === 0) {
                if (worker) {
                    // This case handles a worker commanded to a dropoff without resources. Just make it idle.
                    const updatedWorker = { ...worker, status: UnitStatus.IDLE, targetId: undefined, gatherTargetId: undefined, isHarvesting: false };
                    return { ...state, units: { ...state.units, [workerId]: updatedWorker } };
                }
                return state;
            }

            const { amount, type } = worker.resourcePayload;
            const playerId = worker.playerId;
            const player = state.players[playerId];
            
            let newState: GameState = { ...state };

            const currentResources = player.resources;
            const updatedResources = {
                gold: currentResources.gold + (type === 'GOLD' ? amount : 0),
                wood: currentResources.wood + (type === 'WOOD' ? amount : 0),
            };
            const newPlayers = [...state.players];
            newPlayers[playerId] = { ...player, resources: updatedResources };
            newState.players = newPlayers;


            const dropOffBuilding = Object.values(state.buildings).find(b => b.playerId === playerId && b.id === worker.targetId);
            if (dropOffBuilding && player.isHuman) {
                const newFloatingTextId = uuidv4();
                const newFloatingText: FloatingText = {
                    id: newFloatingTextId, text: `+${amount}`, resourceType: type,
                    position: { x: dropOffBuilding.position.x, y: 3, z: dropOffBuilding.position.z }, startTime: Date.now()
                };
                newState.floatingTexts = { ...state.floatingTexts, [newFloatingTextId]: newFloatingText };
            }

            const resourceToReturnTo = worker.gatherTargetId ? state.resourcesNodes[worker.gatherTargetId] : null;
            let updatedWorker: Unit;
            
            if (worker.isHarvesting && resourceToReturnTo && resourceToReturnTo.amount > 0 && !resourceToReturnTo.isFalling) {
                updatedWorker = {
                    ...worker,
                    resourcePayload: undefined,
                    gatherTimer: 0,
                    status: UnitStatus.MOVING,
                    targetId: resourceToReturnTo.id,
                    pathTarget: resourceToReturnTo.position,
                    path: undefined,
                    pathIndex: undefined,
                    targetPosition: undefined,
                };
            } else {
                updatedWorker = { 
                    ...worker, 
                    resourcePayload: undefined, 
                    gatherTimer: 0, 
                    targetId: undefined,
                    status: UnitStatus.IDLE,
                    isHarvesting: false,
                    harvestingResourceType: undefined,
                    gatherTargetId: undefined,
                 };
            }

            newState.units = { ...state.units, [workerId]: updatedWorker };
            return newState;
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
            };
            
            if (building.rallyPoint) {
                completeUnit.status = UnitStatus.MOVING;
                completeUnit.pathTarget = building.rallyPoint; // Use pathTarget for pathfinding
                if (isCombatUnit) {
                    completeUnit.finalDestination = building.rallyPoint;
                }
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