import React from 'react';
import { GameState, Action, GameObject, GameObjectType, Unit, Building, ResourceNode, UnitStatus, BuildingType } from '../../types';
import { BUILDING_CONFIG, UNIT_CONFIG, getAttackBonus, getDefenseBonus } from '../../constants';
import { GoldIcon, WoodIcon } from './Icons';
import { useLocalization } from '../../hooks/useLocalization';

const renderUnitStatusInfo = (unit: Unit, gameState: GameState, t: (key: string, replacements?: { [key: string]: string | number }) => string) => {
    let statusText = t(`status.${unit.status}`);
    let extraInfo = null;
    
    const payload = unit.resourcePayload;
    if (payload && payload.amount > 0) {
         extraInfo = (
            <div className="flex items-center justify-center space-x-2 mt-2 bg-slate-700/50 p-2 rounded-md ring-1 ring-slate-600">
                {payload.type === 'GOLD' ? <GoldIcon /> : <WoodIcon />}
                <span className={`font-bold text-lg ${payload.type === 'GOLD' ? 'text-yellow-300' : 'text-amber-500'}`}>
                   {payload.amount} / {UNIT_CONFIG.WORKER.carryCapacity}
                </span>
            </div>
        );
    }

    if (unit.status === UnitStatus.GATHERING && unit.targetId) {
        const resource = gameState.resourcesNodes[unit.targetId];
        statusText = t('ui.status.GATHERING_RESOURCE', { resource: resource ? t(`resource.${resource.resourceType}`) : '' });
    }
    
    if (unit.status === UnitStatus.ATTACKING && unit.targetId) {
        const target = gameState.units[unit.targetId] || gameState.buildings[unit.targetId];
        const targetName = target ? (target.type === GameObjectType.UNIT ? t(`unit.${target.unitType}`) : t(`building.${target.buildingType}`)) : 'target';
        statusText = t('ui.status.ATTACKING_TARGET', { target: targetName });
    }

    if (unit.status === UnitStatus.BUILDING && unit.buildTask) {
        const building = gameState.buildings[unit.buildTask.buildingId];
        statusText = t('ui.status.BUILDING_TARGET', { target: t(`building.${building.buildingType}`) });
        const progress = (building.constructionProgress || 0) * 100;
        extraInfo = (
            <div className="w-full mt-2">
                <span className="text-sm font-semibold text-center block">Progress: {Math.floor(progress)}%</span>
                <div className="w-full bg-gray-600 rounded-full h-2 mt-1 ring-1 ring-cyan-500/50">
                    <div className="bg-cyan-400 h-full rounded-full" style={{ width: `${progress}%` }}></div>
                </div>
            </div>
        )
    }

    return (
        <div className="text-center">
            <p className="mt-2 text-cyan-400 capitalize font-semibold text-lg">{statusText}</p>
            {extraInfo}
        </div>
    )
};

export const InfoPanel: React.FC<{ gameState: GameState; selectedObjects: GameObject[]; dispatch: React.Dispatch<Action> }> = ({ gameState, selectedObjects, dispatch }) => {
    const { t } = useLocalization();
    const humanPlayer = gameState.players.find(p => p.isHuman);

    if (gameState.buildMode) {
        const config = BUILDING_CONFIG[gameState.buildMode.type];
        const buildingTypeName = t(`building.${gameState.buildMode.type}`);
        return (
            <div className="p-2 text-center">
                <h3 className="font-bold text-lg">{t('ui.buildModeTitle', { buildingType: buildingTypeName })}</h3>
                <p>{t('ui.buildCost', {gold: config.cost.gold, wood: config.cost.wood})}</p>
                <p className={`mt-2 font-semibold ${gameState.buildMode.canPlace ? 'text-green-400' : 'text-red-400'}`}>
                    {gameState.buildMode.canPlace ? t('ui.buildCanPlace') : t('ui.buildCannotPlace')}
                </p>
                <button onClick={() => dispatch({ type: 'SET_BUILD_MODE', payload: null })} className="p-2 bg-red-600 rounded mt-4 font-bold">{t('ui.cancelBuild')}</button>
            </div>
        );
    }
    
    if (selectedObjects.length > 1) {
        const selectedPlayerBuildings = selectedObjects.filter(o => o.type === GameObjectType.BUILDING && o.playerId === humanPlayer?.id) as Building[];
        if (selectedPlayerBuildings.length > 1 && selectedPlayerBuildings.length === selectedObjects.length) {
            const firstBuildingType = selectedPlayerBuildings[0].buildingType;
            if (selectedPlayerBuildings.every(b => b.buildingType === firstBuildingType)) {
                 const buildingName = t(`building.${firstBuildingType}`);
                 return (
                    <>
                        <h2 className="text-lg font-bold text-center capitalize text-cyan-300">
                             {t('ui.multipleBuildingsSelected', { count: selectedPlayerBuildings.length, buildingType: buildingName })}
                        </h2>
                    </>
                );
            }
        }

        const playerUnitsSelected = selectedObjects.filter(o => o.playerId === humanPlayer?.id);
        if (playerUnitsSelected.length !== selectedObjects.length) {
             return (
                <>
                    <h2 className="text-lg font-bold text-center capitalize text-cyan-300">
                        {t('ui.multipleSelected', { count: selectedObjects.length })}
                    </h2>
                    <p className="text-gray-400 text-center text-sm">{t('ui.multipleSelectedMixed')}</p>
                </>
            );
        }

        return (
            <>
                <h2 className="text-lg font-bold text-center capitalize text-cyan-300">
                    {t('ui.multipleSelected', { count: selectedObjects.length })}
                </h2>
                <p className="text-gray-400 text-center text-sm">{t('ui.multipleSelectedUnits')}</p>
            </>
        );
    }

    const selectedObject = selectedObjects.length === 1 ? selectedObjects[0] : null;

    if (selectedObject) {
         const maxHp = selectedObject.type === GameObjectType.RESOURCE ? 0 : selectedObject.maxHp;
         const name = t(
            selectedObject.type === GameObjectType.UNIT ? `unit.${(selectedObject as Unit).unitType}` :
            selectedObject.type === GameObjectType.BUILDING ? `building.${(selectedObject as Building).buildingType}` :
            `resource.${(selectedObject as ResourceNode).resourceType}`
        );
        const owner = selectedObject.playerId !== undefined ? gameState.players[selectedObject.playerId] : null;
        const teamText = owner ? `(Player ${owner.id + 1})` : '';
        const research = owner ? owner.research : gameState.players[0].research;

        const attackBonus = (selectedObject.type === GameObjectType.UNIT || selectedObject.type === GameObjectType.BUILDING) ? getAttackBonus(selectedObject, research) : 0;
        const defenseBonus = (selectedObject.type === GameObjectType.UNIT || selectedObject.type === GameObjectType.BUILDING) ? getDefenseBonus(selectedObject, research) : 0;

         return (
                <>
                    <h2 className="text-lg font-bold text-center capitalize" style={{color: owner?.color}}>
                        {name} { (selectedObject as Building).isUpgraded && <span className="text-orange-400">{t('ui.upgraded')}</span>} <span className="text-sm text-gray-400">{teamText}</span>
                    </h2>
                     
                    {(selectedObject.type === GameObjectType.UNIT || selectedObject.type === GameObjectType.BUILDING) && 'hp' in selectedObject && !(selectedObject as Unit).isDying && (
                        <div className="w-full mt-2">
                             <span className="text-sm font-semibold text-center block">
                                {Math.floor(selectedObject.hp)} / {maxHp} HP
                             </span>
                            <div className="w-full bg-red-900/80 rounded-full h-2.5 mt-1 ring-1 ring-red-500/50">
                                <div className="bg-red-500 h-full rounded-full" style={{ width: `${(selectedObject.hp / maxHp) * 100}%` }}></div>
                            </div>
                        </div>
                    )}
                     
                    {(selectedObject.type === GameObjectType.UNIT || selectedObject.type === GameObjectType.BUILDING) && (
                        <div className="flex justify-center items-center space-x-4 mt-2">
                            {(selectedObject as Unit | Building).attackDamage !== undefined && (selectedObject as Unit | Building).attackDamage > 0 && (
                                <div className="flex items-center space-x-1 text-red-400" title="Attack Damage">
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                                    <span className="font-semibold text-sm">
                                        {(selectedObject as Unit | Building).attackDamage || 0}
                                        {attackBonus > 0 && <span className="text-green-400"> +{attackBonus.toFixed(1)}</span>}
                                    </span>
                                </div>
                            )}
                            <div className="flex items-center space-x-1 text-blue-400" title="Defense">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 1.05c-1.12 0-2.18.3-3.1.85A9.94 9.94 0 001.27 10.5a1 1 0 00.43 1.25l.09.05c.98.5 2.03.8 3.11.85A9.94 9.94 0 0010 18.95c1.12 0 2.18-.3 3.1-.85a9.94 9.94 0 005.62-8.65 1 1 0 00-.52-1.3l-.09-.05a9.94 9.94 0 00-3.11-.85A9.94 9.94 0 0010 1.05zM3.5 10a6.5 6.5 0 1113 0 6.5 6.5 0 01-13 0z" clipRule="evenodd" /></svg>
                                <span className="font-semibold text-sm">
                                    {(selectedObject as Unit | Building).defense}
                                     {defenseBonus > 0 && <span className="text-green-400"> +{defenseBonus}</span>}
                                </span>
                            </div>
                        </div>
                    )}
                    
                    {(selectedObject as Building).constructionProgress !== undefined && (
                         <div className="w-full mt-2">
                            <span className="text-sm font-semibold text-center block">
                                Construction: {Math.floor(((selectedObject as Building).constructionProgress || 0) * 100)}%
                            </span>
                            <div className="w-full bg-gray-600 rounded-full h-2 mt-1 ring-1 ring-cyan-500/50">
                                <div className="bg-cyan-400 h-full rounded-full" style={{ width: `${((selectedObject as Building).constructionProgress || 0) * 100}%` }}></div>
                            </div>
                        </div>
                    )}
                    
                    {(selectedObject as Building).upgradeProgress !== undefined && (
                         <div className="w-full mt-2">
                            <span className="text-sm font-semibold text-center block text-orange-400">
                                Upgrading: {Math.floor(((selectedObject as Building).upgradeProgress || 0) * 100)}%
                            </span>
                            <div className="w-full bg-gray-600 rounded-full h-2 mt-1 ring-1 ring-orange-500/50">
                                <div className="bg-orange-400 h-full rounded-full" style={{ width: `${((selectedObject as Building).upgradeProgress || 0) * 100}%` }}></div>
                            </div>
                        </div>
                    )}

                    {selectedObject.type === GameObjectType.UNIT && !(selectedObject as Unit).isDying && renderUnitStatusInfo(selectedObject as Unit, gameState, t)}

                    {selectedObject.type === GameObjectType.RESOURCE && (
                         <p className="mt-2 text-yellow-400 font-semibold text-lg">Amount: {(selectedObject as ResourceNode).amount}</p>
                    )}
                </>
            );
    }
    
    return (
        <div className="flex flex-col items-center justify-center h-full text-center text-slate-400">
            <svg className="w-16 h-16 mb-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                <circle cx="12" cy="11" r="1"></circle>
                <path d="M12 8v1"></path>
                <path d="M12 13v1"></path>
                <path d="m14.6 9.4-.8.8"></path>
                <path d="m9.2 13.2-.8.8"></path>
                <path d="m14.6 12.6-.8-.8"></path>
                <path d="m9.2 8.8-.8-.8"></path>
            </svg>
            <h3 className="font-bold text-lg text-slate-300">{t('ui.commandCenter')}</h3>
            <p className="text-sm mt-1">{t('ui.commandCenterDesc')}</p>
        </div>
    );
}