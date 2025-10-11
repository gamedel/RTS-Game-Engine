import { GameState, Action } from '../../types';

export function uiReducer(state: GameState, action: Action): GameState {
    switch (action.type) {
        case 'SELECT_OBJECT': {
            const { id, isShift } = action.payload;
            if (id === null) {
                if (state.selectedIds.length === 0 && !state.buildMode) {
                    return state;
                }
                return { ...state, selectedIds: [], buildMode: null };
            }
            if (isShift) {
                const newSelection = state.selectedIds.includes(id)
                    ? state.selectedIds.filter(sid => sid !== id)
                    : [...state.selectedIds, id];
                if (newSelection.length === state.selectedIds.length && state.selectedIds.every((sid, idx) => sid === newSelection[idx]) && !state.buildMode) {
                    return state;
                }
                return { ...state, selectedIds: newSelection, buildMode: null };
            }
            if (state.selectedIds.length === 1 && state.selectedIds[0] === id) {
                if (!state.buildMode) {
                    return state;
                }
                return { ...state, buildMode: null };
            }
            return { ...state, selectedIds: [id], buildMode: null };
        }
        case 'SET_SELECTION': {
            return { ...state, selectedIds: action.payload, buildMode: null };
        }
        case 'SET_BUILD_MODE':
            if (!action.payload) {
                return { ...state, buildMode: null };
            }
            // This preserves the current selection, so the selected worker can be used.
            return { ...state, buildMode: { type: action.payload, canPlace: false, position: { x: 0, y: 0, z: 0 } } };
        case 'UPDATE_BUILD_PLACEHOLDER':
            if (!state.buildMode) return state;
            return { ...state, buildMode: { ...state.buildMode, ...action.payload } };
        default:
            return state;
    }
}
