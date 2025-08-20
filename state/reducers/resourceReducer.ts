import { GameState, Action } from '../../types';

export function resourceReducer(state: GameState, action: Action): GameState {
    switch (action.type) {
        case 'ADD_RESOURCES': {
            const { playerId, gold, wood } = action.payload;
            const player = state.players[playerId];
            if (!player) return state;
            
            const newPlayers = [...state.players];
            newPlayers[playerId] = {
                ...player,
                resources: {
                    gold: player.resources.gold + (gold || 0),
                    wood: player.resources.wood + (wood || 0),
                }
            };
            return { ...state, players: newPlayers };
        }
        case 'UPDATE_RESOURCE_NODE': {
            const { id, ...rest } = action.payload;
            if (!state.resourcesNodes[id]) return state;
            return { ...state, resourcesNodes: { ...state.resourcesNodes, [id]: { ...state.resourcesNodes[id], ...rest } } };
        }
        case 'REMOVE_RESOURCE_NODE': {
            const { id } = action.payload;
            const newResourcesNodes = { ...state.resourcesNodes };
            if (newResourcesNodes[id]) {
                delete newResourcesNodes[id];
            }
            return { ...state, resourcesNodes: newResourcesNodes };
        }
        default:
            return state;
    }
}