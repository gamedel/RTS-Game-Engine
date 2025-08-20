import { GameState, Action } from '../../types';

export function gameStatusReducer(state: GameState, action: Action): GameState {
    switch (action.type) {
        case 'SET_GAME_STATUS':
            if (state.gameStatus !== 'playing') return state; // Prevent changing status once game is over
            return {
                ...state,
                gameStatus: action.payload,
            };
        case 'PAUSE_GAME':
            if (state.gameStatus === 'playing') {
                return { ...state, gameStatus: 'paused' };
            }
            return state;
        case 'RESUME_GAME':
            if (state.gameStatus === 'paused') {
                return { ...state, gameStatus: 'playing' };
            }
            return state;
        default:
            return state;
    }
}