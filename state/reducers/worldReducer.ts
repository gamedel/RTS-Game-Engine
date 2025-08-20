import { GameState, Action } from '../../types';

export function worldReducer(state: GameState, action: Action): GameState {
    switch (action.type) {
        case 'ADD_FLOATING_TEXT': {
            return { ...state, floatingTexts: { ...state.floatingTexts, [action.payload.id]: action.payload } };
        }
        case 'REMOVE_FLOATING_TEXT': {
            const newFloatingTexts = { ...state.floatingTexts };
            delete newFloatingTexts[action.payload];
            return { ...state, floatingTexts: newFloatingTexts };
        }
        case 'ADD_COMMAND_MARKER': {
            return { ...state, commandMarkers: { ...state.commandMarkers, [action.payload.id]: action.payload } };
        }
        case 'REMOVE_COMMAND_MARKER': {
            const newMarkers = { ...state.commandMarkers };
            delete newMarkers[action.payload];
            return { ...state, commandMarkers: newMarkers };
        }
        case 'ADD_EXPLOSION_MARKER': {
            return { ...state, explosionMarkers: { ...state.explosionMarkers, [action.payload.id]: action.payload } };
        }
        case 'REMOVE_EXPLOSION_MARKER': {
            const newMarkers = { ...state.explosionMarkers };
            delete newMarkers[action.payload];
            return { ...state, explosionMarkers: newMarkers };
        }
        default:
            return state;
    }
}