import React from 'react';
import { GameState, Action, UnitType, BuildingType } from '../../types';
import { GoldIcon, WoodIcon, PopulationIcon, DebugIcon, CavalryIcon } from './Icons';
import { useLocalization } from '../../hooks/useLocalization';

export const ResourceBar: React.FC<{ gameState: GameState, dispatch: React.Dispatch<Action>, fps: number }> = ({ gameState, dispatch, fps }) => {
    const { language, setLanguage, t } = useLocalization();
    const humanPlayer = gameState.players.find(p => p.isHuman);
    const humanTownHall = humanPlayer ? Object.values(gameState.buildings).find(b => b.playerId === humanPlayer.id && b.buildingType === BuildingType.TOWN_HALL) : null;

    if (!humanPlayer) {
        return null; // Don't render if there's no human player
    }

    const toggleLanguage = () => {
        setLanguage(language === 'en' ? 'ru' : 'en');
    };

    return (
        <div className="relative top-0 left-0 w-full bg-slate-900/50 backdrop-blur-sm p-2 flex justify-between items-center z-10 border-b border-white/10">
            {/* Player resources on the left */}
            <div className="flex items-center space-x-2">
                <div className="flex items-center space-x-2">
                    <GoldIcon />
                    <span className="font-bold text-lg text-yellow-300">{Math.floor(humanPlayer.resources.gold)}</span>
                </div>
                <div className="flex items-center space-x-2">
                    <WoodIcon />
                    <span className="font-bold text-lg text-amber-500">{Math.floor(humanPlayer.resources.wood)}</span>
                </div>
                <div className="flex items-center space-x-2">
                    <PopulationIcon />
                    <span className={`font-bold text-lg ${humanPlayer.population.current >= humanPlayer.population.cap ? 'text-red-400' : 'text-sky-300'}`}>
                        {humanPlayer.population.current} / {humanPlayer.population.cap}
                    </span>
                </div>
                <div className="flex items-center space-x-2 pl-4">
                    <button 
                        onClick={() => dispatch({ type: 'ADD_RESOURCES', payload: { wood: 500, gold: 500, playerId: humanPlayer.id } })}
                        className="p-1.5 bg-slate-700/80 hover:bg-slate-600/80 rounded-full text-slate-300 hover:text-white transition-colors ring-1 ring-slate-600"
                        title={t('ui.addResourcesDebug')}
                    >
                        <DebugIcon />
                    </button>
                    <button
                        onClick={() => {
                            if (humanTownHall) {
                                dispatch({
                                    type: 'DEBUG_SPAWN_UNITS',
                                    payload: {
                                        playerId: humanPlayer.id,
                                        unitType: UnitType.CAVALRY,
                                        count: 20,
                                        position: humanTownHall.position,
                                    }
                                });
                            }
                        }}
                        disabled={!humanTownHall}
                        className="p-1.5 bg-slate-700/80 hover:bg-slate-600/80 rounded-full text-slate-300 hover:text-white transition-colors ring-1 ring-slate-600 disabled:bg-slate-800 disabled:cursor-not-allowed"
                        title="Debug: Spawn 20 Cavalry"
                    >
                        <CavalryIcon style={{ width: '20px', height: '20px' }} />
                    </button>
                </div>
            </div>
            
            <div className="absolute left-1/2 -translate-x-1/2 text-sm text-gray-400" title="Frames Per Second">
                FPS: {fps}
            </div>

            <div className="flex items-center space-x-4">
                <button
                    onClick={() => dispatch({ type: 'PAUSE_GAME' })}
                    className="px-4 h-8 bg-slate-700/80 hover:bg-slate-600/80 rounded-md text-white font-bold text-sm ring-1 ring-slate-500 transition-all"
                >
                    {t('ui.menu')}
                </button>
                 <button
                    onClick={toggleLanguage}
                    className="w-10 h-8 bg-slate-700/80 hover:bg-slate-600/80 rounded-md text-white font-bold text-sm ring-1 ring-slate-500 transition-all"
                >
                    {language.toUpperCase()}
                </button>
            </div>
        </div>
    );
}