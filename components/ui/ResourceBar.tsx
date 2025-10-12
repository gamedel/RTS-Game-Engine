import React from 'react';
import { GameState, Action, UnitType, BuildingType } from '../../types';
import { GoldIcon, WoodIcon, PopulationIcon, DebugIcon, UnitTypeIcon } from './Icons';
import { useLocalization } from '../../hooks/useLocalization';

export const ResourceBar: React.FC<{ gameState: GameState, dispatch: React.Dispatch<Action>, fps: number, isTouchDevice: boolean }> = ({ gameState, dispatch, fps, isTouchDevice }) => {
    const { language, setLanguage, t } = useLocalization();
    const humanPlayer = gameState.players.find(p => p.isHuman);
    const humanTownHall = humanPlayer ? Object.values(gameState.buildings).find(b => b.playerId === humanPlayer.id && b.buildingType === BuildingType.TOWN_HALL) : null;

    if (!humanPlayer) {
        return null; // Don't render if there's no human player
    }

    const toggleLanguage = () => {
        setLanguage(language === 'en' ? 'ru' : 'en');
    };

    const containerClasses = isTouchDevice
        ? 'relative top-0 left-0 w-full bg-slate-900/70 backdrop-blur-md px-3 py-3 flex flex-col gap-3 items-stretch z-10 border-b border-white/10'
        : 'relative top-0 left-0 w-full bg-slate-900/50 backdrop-blur-sm p-2 flex justify-between items-center z-10 border-b border-white/10';

    const resourceLayoutClasses = isTouchDevice
        ? 'flex flex-wrap justify-center gap-x-4 gap-y-2 text-base'
        : 'flex items-center space-x-4';

    const valueTextClass = isTouchDevice ? 'font-bold text-xl' : 'font-bold text-lg';

    const buttonBaseClass = isTouchDevice
        ? 'px-4 h-11 bg-slate-700/80 hover:bg-slate-600/80 rounded-lg text-white font-semibold text-base ring-1 ring-slate-500 transition-all active:scale-95'
        : 'px-4 h-8 bg-slate-700/80 hover:bg-slate-600/80 rounded-md text-white font-bold text-sm ring-1 ring-slate-500 transition-all';

    const debugSpawnOptions: Array<{ type: UnitType; count: number; title: string }> = [
        { type: UnitType.WORKER, count: 6, title: 'Debug: Spawn 6 Workers' },
        { type: UnitType.INFANTRY, count: 12, title: 'Debug: Spawn 12 Infantry' },
        { type: UnitType.ARCHER, count: 12, title: 'Debug: Spawn 12 Archers' },
        { type: UnitType.CAVALRY, count: 12, title: 'Debug: Spawn 12 Cavalry' },
        { type: UnitType.CATAPULT, count: 4, title: 'Debug: Spawn 4 Catapults' },
    ];

    const handleDebugSpawn = (unitType: UnitType, count: number) => {
        if (!humanTownHall) return;
        dispatch({
            type: 'DEBUG_SPAWN_UNITS',
            payload: {
                playerId: humanPlayer.id,
                unitType,
                count,
                position: humanTownHall.position,
            }
        });
    };

    return (
        <div className={containerClasses}>
            <div className={resourceLayoutClasses}>
                <div className="flex items-center gap-2">
                    <GoldIcon />
                    <span className={`${valueTextClass} text-yellow-300`}>{Math.floor(humanPlayer.resources.gold)}</span>
                </div>
                <div className="flex items-center gap-2">
                    <WoodIcon />
                    <span className={`${valueTextClass} text-amber-500`}>{Math.floor(humanPlayer.resources.wood)}</span>
                </div>
                <div className="flex items-center gap-2">
                    <PopulationIcon />
                    <span className={`${valueTextClass} ${humanPlayer.population.current >= humanPlayer.population.cap ? 'text-red-400' : 'text-sky-300'}`}>
                        {humanPlayer.population.current} / {humanPlayer.population.cap}
                    </span>
                </div>
                {!isTouchDevice && (
                    <div className="flex items-center gap-2 pl-4">
                        <button
                            onClick={() => dispatch({ type: 'ADD_RESOURCES', payload: { wood: 500, gold: 500, playerId: humanPlayer.id } })}
                            className="p-1.5 bg-slate-700/80 hover:bg-slate-600/80 rounded-full text-slate-300 hover:text-white transition-colors ring-1 ring-slate-600"
                            title={t('ui.addResourcesDebug')}
                        >
                            <DebugIcon />
                        </button>
                        <div className="flex items-center gap-1">
                            {debugSpawnOptions.map(option => (
                                <button
                                    key={option.type}
                                    onClick={() => handleDebugSpawn(option.type, option.count)}
                                    disabled={!humanTownHall}
                                    className="p-1.5 bg-slate-700/80 hover:bg-slate-600/80 rounded-full text-slate-300 hover:text-white transition-colors ring-1 ring-slate-600 disabled:bg-slate-800 disabled:cursor-not-allowed"
                                    title={option.title}
                                >
                                    <UnitTypeIcon type={option.type} style={{ width: '20px', height: '20px' }} />
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {isTouchDevice ? (
                <div className="flex justify-between items-center">
                    <button
                        onClick={() => dispatch({ type: 'PAUSE_GAME' })}
                        className={`${buttonBaseClass} flex-1 mr-2`}
                    >
                        {t('ui.menu')}
                    </button>
                    <div className="text-sm text-gray-300 font-semibold px-3">
                        FPS: {fps}
                    </div>
                    <button
                        onClick={toggleLanguage}
                        className={`${buttonBaseClass} flex-1 ml-2`}
                    >
                        {language.toUpperCase()}
                    </button>
                </div>
            ) : (
                <>
                    <div className="absolute left-1/2 -translate-x-1/2 text-sm text-gray-400" title="Frames Per Second">
                        FPS: {fps}
                    </div>

                    <div className="flex items-center space-x-4">
                        <button
                            onClick={() => dispatch({ type: 'PAUSE_GAME' })}
                            className={buttonBaseClass}
                        >
                            {t('ui.menu')}
                        </button>
                        <button
                            onClick={toggleLanguage}
                            className={`w-10 ${buttonBaseClass.replace('px-4 ', '')}`}
                        >
                            {language.toUpperCase()}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}
