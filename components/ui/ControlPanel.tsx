import React from 'react';
import { GameState, Action, GameObject } from '../../types';
import { InfoPanel } from './InfoPanel';
import { ActionPanel } from './ActionPanel';

export const ControlPanel: React.FC<{ gameState: GameState; selectedObjects: GameObject[]; dispatch: React.Dispatch<Action> }> = ({ gameState, selectedObjects, dispatch }) => {
    return (
        <div className="absolute bottom-0 left-0 w-full h-52 bg-slate-900/80 backdrop-blur-md border-t-2 border-slate-700 p-4 flex z-10 gap-4">
            <div className="w-56 h-full bg-slate-800/50 rounded flex items-center justify-start p-3 flex-col ring-1 ring-slate-600">
                <InfoPanel gameState={gameState} selectedObjects={selectedObjects} dispatch={dispatch} />
            </div>
            <div className="flex-1">{<ActionPanel gameState={gameState} selectedObjects={selectedObjects} dispatch={dispatch} />}</div>
        </div>
    );
};
