import React from 'react';
import { GameState, Action, GameObject } from '../../types';
import { InfoPanel } from './InfoPanel';
import { ActionPanel } from './ActionPanel';

export const ControlPanel: React.FC<{ gameState: GameState; selectedObjects: GameObject[]; dispatch: React.Dispatch<Action>; isTouchDevice: boolean }> = ({ gameState, selectedObjects, dispatch, isTouchDevice }) => {
    const containerClasses = isTouchDevice
        ? 'absolute bottom-0 left-0 w-full bg-slate-900/85 backdrop-blur-xl border-t border-slate-700 p-3 pb-4 flex flex-col z-10 gap-3'
        : 'absolute bottom-0 left-0 w-full h-52 bg-slate-900/80 backdrop-blur-md border-t-2 border-slate-700 p-4 flex z-10 gap-4';

    const infoPanelClasses = isTouchDevice
        ? 'w-full max-h-44 bg-slate-800/60 rounded-lg p-3 ring-1 ring-slate-600 overflow-y-auto custom-scrollbar'
        : 'w-56 h-full bg-slate-800/50 rounded flex items-center justify-start p-3 flex-col ring-1 ring-slate-600';

    const actionWrapperClasses = isTouchDevice
        ? 'w-full max-h-64 overflow-y-auto pr-1 custom-scrollbar'
        : 'flex-1';

    return (
        <div className={containerClasses}>
            <div className={infoPanelClasses}>
                <InfoPanel gameState={gameState} selectedObjects={selectedObjects} dispatch={dispatch} />
            </div>
            <div className={actionWrapperClasses}>
                <ActionPanel gameState={gameState} selectedObjects={selectedObjects} dispatch={dispatch} isTouchDevice={isTouchDevice} />
            </div>
        </div>
    );
};
