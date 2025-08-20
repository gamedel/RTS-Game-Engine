import { GameState, Action } from '../types';
import { buildingReducer } from './reducers/buildingReducer';
import { projectileReducer } from './reducers/projectileReducer';
import { resourceReducer } from './reducers/resourceReducer';
import { uiReducer } from './reducers/uiReducer';
import { unitReducer } from './reducers/unitReducer';
import { worldReducer } from './reducers/worldReducer';
import { gameStatusReducer } from './reducers/gameStatusReducer';
import { researchReducer } from './reducers/researchReducer';
import { createInitialGameState } from '../constants';
import { tradeReducer } from './reducers/tradeReducer';


export function gameReducer(state: GameState, action: Action): GameState {
  if (action.type === 'START_NEW_GAME') {
    return createInitialGameState(action.payload.mapType, action.payload.players);
  }
  
  if (action.type === 'BATCH_UPDATE') {
    const { units, buildings, projectiles } = action.payload;
    let nextState = { ...state };
    
    if (units && units.length > 0) {
        const updatedUnits = { ...nextState.units };
        units.forEach(patch => {
            if (updatedUnits[patch.id]) {
                updatedUnits[patch.id] = { ...updatedUnits[patch.id], ...patch };
            }
        });
        nextState.units = updatedUnits;
    }

    if (buildings && buildings.length > 0) {
        const updatedBuildings = { ...nextState.buildings };
        buildings.forEach(patch => {
            if (updatedBuildings[patch.id]) {
                updatedBuildings[patch.id] = { ...updatedBuildings[patch.id], ...patch };
            }
        });
        nextState.buildings = updatedBuildings;
    }
    
    if (projectiles && projectiles.length > 0) {
        const updatedProjectiles = { ...nextState.projectiles };
        projectiles.forEach(patch => {
            if (updatedProjectiles[patch.id]) {
                updatedProjectiles[patch.id] = { ...updatedProjectiles[patch.id], ...patch };
            }
        });
        nextState.projectiles = updatedProjectiles;
    }
    
    return nextState;
  }

  let newState = uiReducer(state, action);
  newState = unitReducer(newState, action);
  newState = buildingReducer(newState, action);
  newState = resourceReducer(newState, action);
  newState = projectileReducer(newState, action);
  newState = worldReducer(newState, action);
  newState = gameStatusReducer(newState, action);
  newState = researchReducer(newState, action);
  newState = tradeReducer(newState, action);
  
  return newState;
}