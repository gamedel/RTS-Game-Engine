import { GameState, Action } from '../../types';

export function projectileReducer(state: GameState, action: Action): GameState {
    switch (action.type) {
        case 'ADD_PROJECTILE': {
            return { ...state, projectiles: { ...state.projectiles, [action.payload.id]: action.payload } };
        }
        case 'UPDATE_PROJECTILE': {
            const { id, ...rest } = action.payload;
            const projectile = state.projectiles[id];
            if (!projectile) return state;
            return { ...state, projectiles: { ...state.projectiles, [id]: { ...projectile, ...rest } } };
        }
        case 'REMOVE_PROJECTILE': {
            const newProjectiles = { ...state.projectiles };
            delete newProjectiles[action.payload];
            return { ...state, projectiles: newProjectiles };
        }
        default:
            return state;
    }
}