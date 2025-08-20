import { GameState, Action, Player, ResearchCategory } from '../../types';
import { RESEARCH_CONFIG } from '../../constants';

export function researchReducer(state: GameState, action: Action): GameState {
    switch (action.type) {
        case 'START_RESEARCH': {
            const { buildingId, researchType } = action.payload;
            const building = state.buildings[buildingId];
            const researchInfo = RESEARCH_CONFIG[researchType];

            if (!building || !building.researchQueue || building.researchQueue.length > 0 || building.constructionProgress !== undefined) {
                return state;
            }

            const playerId = building.playerId;
            const player = state.players[playerId];
            const currentLevel = player.research[researchType];
            
            if (currentLevel >= researchInfo.maxLevel) {
                return state;
            }

            const cost = researchInfo.cost(currentLevel);
            const resources = player.resources;

            if (resources.gold < cost.gold || resources.wood < cost.wood) {
                return state;
            }

            const newQueue = [...building.researchQueue, { type: researchType, level: currentLevel + 1, progress: 0 }];
            const updatedBuilding = { ...building, researchQueue: newQueue };

            const updatedResources = {
                gold: resources.gold - cost.gold,
                wood: resources.wood - cost.wood,
            };
            
            const newPlayers = [...state.players];
            newPlayers[playerId] = { ...player, resources: updatedResources };

            return {
                ...state,
                players: newPlayers,
                buildings: { ...state.buildings, [buildingId]: updatedBuilding },
            };
        }
        case 'UPDATE_RESEARCH': {
            const { playerId, researchType } = action.payload;
            const player = state.players[playerId];
            if (!player) return state;

            const currentLevel = player.research[researchType];
            const newLevel = currentLevel + 1;

            if (researchType === ResearchCategory.WORKER_CAPACITY && newLevel > RESEARCH_CONFIG[researchType].maxLevel) {
                return state;
            }

            const newPlayers = [...state.players];
            newPlayers[playerId] = {
                ...player,
                research: {
                    ...player.research,
                    [researchType]: newLevel,
                }
            };
            
            let updatedUnits = { ...state.units };

            if (researchType === ResearchCategory.WORKER_CAPACITY) {
                Object.values(state.units).forEach(unit => {
                    if (unit.playerId === playerId && unit.unitType === 'WORKER') {
                        const carryCapacityBonus = RESEARCH_CONFIG[ResearchCategory.WORKER_CAPACITY].bonus;
                        // This logic seems flawed. It should update a unit property, not maxHp.
                        // However, without a `carryCapacity` on the unit model, this is a placeholder.
                        // Let's assume there is no direct update to units, but the game logic will use the research state.
                    }
                });
            }


            return {
                ...state,
                players: newPlayers,
                units: updatedUnits,
            };
        }
        case 'CANCEL_RESEARCH': {
            const { buildingId } = action.payload;
            const building = state.buildings[buildingId];
            if (!building) return state;

            const player = state.players[building.playerId];
            if (!building.researchQueue || building.researchQueue.length === 0 || !player.isHuman) {
                return state;
            }
            
            const researchToCancel = building.researchQueue[0];
            const researchInfo = RESEARCH_CONFIG[researchToCancel.type];
            const researchLevel = researchToCancel.level - 1; // Level it was started at

            const cost = researchInfo.cost(researchLevel);
            
            // Refund resources
            const updatedResources = {
                ...player.resources,
                gold: player.resources.gold + cost.gold,
                wood: player.resources.wood + cost.wood,
            };
            
            const newPlayers = [...state.players];
            newPlayers[player.id] = { ...player, resources: updatedResources };

            // Clear the queue
            const updatedBuilding = { ...building, researchQueue: [] };

            return {
                ...state,
                players: newPlayers,
                buildings: { ...state.buildings, [buildingId]: updatedBuilding },
            };
        }
        default:
            return state;
    }
}