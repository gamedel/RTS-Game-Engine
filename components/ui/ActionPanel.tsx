import React, { useState, useEffect } from 'react';
import { GameState, Action, GameObject, GameObjectType, UnitType, BuildingType, Unit, Building, UnitStance, ResearchCategory, Player } from '../../types';
import { UNIT_CONFIG, BUILDING_CONFIG, TRAINING_TIME, RESEARCH_CONFIG, TOWER_UPGRADE_CONFIG, arePlayersHostile } from '../../constants';
import { MultiSelectPanel } from './MultiSelectPanel';
import { AggressiveIcon, HoldGroundIcon, UnitTypeIcon, CatapultIcon, PopulationIcon } from './Icons';
import { useLocalization } from '../../hooks/useLocalization';


const TrainActionButton: React.FC<{
    type: UnitType,
    player: Player,
    onClick: () => void,
    isDisabled?: boolean,
    tooltipOverride?: string,
    isTouchDevice: boolean,
}> = ({ type, player, onClick, isDisabled: extraDisabled, tooltipOverride, isTouchDevice }) => {
    const { t } = useLocalization();
    const config = UNIT_CONFIG[type];
    const canAfford = player.resources.gold >= config.cost.gold && player.resources.wood >= config.cost.wood;
    const popLimitReached = player.population.current >= player.population.cap;
    const isDisabled = !canAfford || popLimitReached || extraDisabled;
    const unitTypeName = t(`unit.${type}`);

    let tooltip = tooltipOverride || '';
    if (popLimitReached) tooltip = t('ui.popLimitReached');
    else if (!canAfford) tooltip = t('ui.notEnoughResources');

    const sizeClasses = isTouchDevice ? 'w-28 h-28 p-3 gap-1' : 'w-24 h-20 p-2';
    const textPrimary = isTouchDevice ? 'font-bold text-base' : 'font-bold text-sm';
    const textSecondary = isTouchDevice ? 'text-sm' : 'text-xs';
    const iconSize = isTouchDevice ? 40 : 32;

    return (
        <button
            onClick={onClick}
            disabled={isDisabled}
            title={tooltip}
            className={`${sizeClasses} rounded-md flex flex-col items-center justify-center text-center transition-all duration-150 ${!isDisabled ? 'bg-green-700/80 hover:bg-green-600/80 ring-1 ring-green-500' : 'bg-gray-700/80 text-gray-400 cursor-not-allowed ring-1 ring-gray-600'}`}
        >
            <UnitTypeIcon type={type} style={{ width: `${iconSize}px`, height: `${iconSize}px` }}/>
            <p className={`${textPrimary} mt-1`}>{t('ui.train', {unitType: unitTypeName})}</p>
            <p className={`${textSecondary} mt-1`}>G:{config.cost.gold} W:{config.cost.wood}</p>
        </button>
    );
};

const MultiBuildingActionPanel: React.FC<{ buildings: Building[], player: Player, dispatch: React.Dispatch<Action>, isTouchDevice: boolean }> = ({ buildings, player, dispatch, isTouchDevice }) => {
    const { t } = useLocalization();
    const buildingType = buildings[0].buildingType;

    const handleTrain = (unitType: UnitType) => {
        // Find building with the shortest queue
        const buildingWithShortestQueue = buildings.reduce((prev, curr) => 
            (curr.trainingQueue.length < prev.trainingQueue.length ? curr : prev)
        );
        
        // This check prevents adding to a full queue, although the button should be disabled.
        if (buildingWithShortestQueue.trainingQueue.length >= 5) {
            return;
        }

        dispatch({ type: 'TRAIN_UNIT', payload: { buildingId: buildingWithShortestQueue.id, unitType } });
    };

    // Combine all queues from selected buildings
    const combinedQueue = buildings.flatMap(b => b.trainingQueue);

    const isAnyQueueNotFull = buildings.some(b => b.trainingQueue.length < 5);

    const unitsToTrain = buildingType === BuildingType.TOWN_HALL 
        ? [UnitType.WORKER]
        : [UnitType.INFANTRY, UnitType.ARCHER, UnitType.CAVALRY, UnitType.CATAPULT];

    return (
        <div className="p-2">
            <div className={`flex items-start flex-wrap ${isTouchDevice ? 'gap-3' : 'gap-2'}`}>
                {unitsToTrain.map(unitType => (
                    <TrainActionButton
                        key={unitType}
                        type={unitType}
                        player={player}
                        onClick={() => handleTrain(unitType)}
                        isDisabled={!isAnyQueueNotFull}
                        isTouchDevice={isTouchDevice}
                    />
                ))}
            </div>
            {combinedQueue.length > 0 && (
                <div className="mt-2">
                    <h4 className={`${isTouchDevice ? 'text-base' : 'text-sm'} font-bold text-gray-300`}>{t('ui.combinedQueue')} ({combinedQueue.length})</h4>
                    <div className={`flex flex-wrap ${isTouchDevice ? 'gap-3 mt-2 p-2' : 'gap-2 mt-1 p-1'} bg-slate-800/50 rounded-md custom-scrollbar overflow-x-auto`}>
                        {combinedQueue.map((item, index) => {
                            const unitTypeName = t(`unit.${item.unitType}`);
                            return (
                                <div
                                    key={`train-${index}`}
                                    title={unitTypeName}
                                    className={`relative ${isTouchDevice ? 'w-14 h-14' : 'w-12 h-12'} bg-gray-700 rounded-md text-center flex items-center justify-center overflow-hidden ring-1 ring-slate-600`}
                                >
                                    <UnitTypeIcon type={item.unitType} style={{ width: isTouchDevice ? '32px' : '28px', height: isTouchDevice ? '32px' : '28px', color: 'white' }} />
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

const UpgradeTowerButton: React.FC<{ building: Building, player: Player, dispatch: React.Dispatch<Action>, isTouchDevice: boolean }> = ({ building, player, dispatch, isTouchDevice }) => {
    const { t } = useLocalization();
    const config = TOWER_UPGRADE_CONFIG;
    const canAfford = player.resources.gold >= config.cost.gold && player.resources.wood >= config.cost.wood;
    const isBusy = building.upgradeTimer !== undefined || building.isUpgraded;
    const isDisabled = !canAfford || isBusy || building.constructionProgress !== undefined;

    let tooltip = t('ui.upgradeTower');
    if (building.isUpgraded) tooltip = t('ui.towerUpgraded');
    else if (isBusy) tooltip = t('ui.upgradeInProgress');
    else if (!canAfford) tooltip = t('ui.notEnoughResources');

    const sizeClasses = isTouchDevice ? 'w-28 h-28 p-3 gap-1' : 'w-24 h-20 p-2';
    const textPrimary = isTouchDevice ? 'font-bold text-sm' : 'font-bold text-xs';
    const textSecondary = isTouchDevice ? 'text-sm' : 'text-xs';
    const iconSize = isTouchDevice ? 40 : 32;

    return (
        <button
            onClick={() => dispatch({ type: 'UPGRADE_TOWER', payload: { buildingId: building.id } })}
            disabled={isDisabled}
            title={tooltip}
            className={`${sizeClasses} rounded-md flex flex-col items-center justify-center text-center transition-all duration-150 ${!isDisabled ? 'bg-orange-700/80 hover:bg-orange-600/80 ring-1 ring-orange-500' : 'bg-gray-700/80 text-gray-400 cursor-not-allowed ring-1 ring-gray-600'}`}
        >
            <CatapultIcon style={{ width: `${iconSize}px`, height: `${iconSize}px` }}/>
            <p className={`${textPrimary} mt-1`}>{t('ui.installCatapult')}</p>
            <p className={`${textSecondary} mt-1`}>G:{config.cost.gold} W:{config.cost.wood}</p>
        </button>
    );
};

const ResearchActionButton: React.FC<{ category: ResearchCategory, player: Player, building: Building, dispatch: React.Dispatch<Action>, isTouchDevice: boolean }> = ({ category, player, building, dispatch, isTouchDevice }) => {
    const { t } = useLocalization();
    const researchInfo = RESEARCH_CONFIG[category];
    const currentLevel = player.research[category];
    const researchName = t(researchInfo.nameKey);

    if (currentLevel >= researchInfo.maxLevel) {
        return (
            <div className={`flex items-center justify-between rounded-md ring-1 shadow-inner bg-green-900 ring-green-600 text-green-300 ${isTouchDevice ? 'p-3 text-base' : 'p-2'}`}>
                <span className={`font-semibold ${isTouchDevice ? 'text-base' : 'text-sm'}`}>{researchName}</span>
                <div className="text-right">
                    <p className={`font-semibold ${isTouchDevice ? 'text-sm' : 'text-xs'}`}>{t('ui.maxLevel')}</p>
                    <p className={`${isTouchDevice ? 'text-sm' : 'text-xs'} text-green-400`}>({currentLevel}/{researchInfo.maxLevel})</p>
                </div>
            </div>
        );
    }

    const cost = researchInfo.cost(currentLevel);
    const canAfford = player.resources.gold >= cost.gold && player.resources.wood >= cost.wood;
    const isBusy = building.researchQueue && building.researchQueue.length > 0;
    const isDisabled = !canAfford || isBusy || building.constructionProgress !== undefined;

    let tooltip = t('ui.upgradeTo', { name: researchName, level: currentLevel + 1});
    if (isBusy) tooltip = t('ui.researchInProgress');
    else if (!canAfford) tooltip = t('ui.notEnoughResources');

    return (
         <button
            onClick={() => dispatch({ type: 'START_RESEARCH', payload: { buildingId: building.id, researchType: category } })}
            disabled={isDisabled}
            title={tooltip}
            className={`flex items-center justify-between rounded-md ring-1 shadow-inner transition-all duration-200 ${isTouchDevice ? 'p-3' : 'p-2'}
                ${!isDisabled ? 'bg-slate-800 hover:bg-slate-700 ring-slate-600 text-white' : 'bg-slate-700/80 text-gray-400 cursor-not-allowed ring-slate-600'}`}
        >
            <span className={`font-semibold ${isTouchDevice ? 'text-base' : 'text-sm'}`}>{researchName}</span>
            <div className="text-right">
                <p className={`font-semibold ${isTouchDevice ? 'text-sm' : 'text-xs'}`}>{t('ui.level', { level: currentLevel + 1 })}</p>
                <p className={`${isTouchDevice ? 'text-sm' : 'text-xs'} text-slate-300`}>G:{cost.gold} W:{cost.wood}</p>
            </div>
        </button>
    );
};

const BuildActionButton: React.FC<{ type: BuildingType, player: Player, dispatch: React.Dispatch<Action>, isTouchDevice: boolean }> = ({ type, player, dispatch, isTouchDevice }) => {
    const { t } = useLocalization();
    const config = BUILDING_CONFIG[type];
    const canAfford = player.resources.gold >= config.cost.gold && player.resources.wood >= config.cost.wood;
    const buildingTypeName = t(`building.${type}`);
    return (
        <button
            onClick={() => dispatch({ type: 'SET_BUILD_MODE', payload: type })}
            disabled={!canAfford}
            className={`${isTouchDevice ? 'w-28 h-28 p-3 gap-1' : 'w-24 h-20 p-2'} rounded-md flex flex-col items-center justify-center text-center transition-all duration-150 ${canAfford ? 'bg-blue-700/80 hover:bg-blue-600/80 ring-1 ring-blue-500' : 'bg-gray-700/80 text-gray-400 cursor-not-allowed ring-1 ring-gray-600'}`}
        >
            <p className={`font-bold ${isTouchDevice ? 'text-base' : 'text-sm'}`}>{t('ui.build', {buildingType: buildingTypeName})}</p>
            <p className={`${isTouchDevice ? 'text-sm' : 'text-xs'} mt-1`}>G:{config.cost.gold} W:{config.cost.wood}</p>
        </button>
    );
};

const TrainingQueue: React.FC<{ building: Building, player: Player, dispatch: React.Dispatch<Action>, isTouchDevice: boolean }> = ({ building, player, dispatch, isTouchDevice }) => {
    const { t } = useLocalization();
    const isPlayerBuilding = player.isHuman;

    const queue = building.trainingQueue || [];
    const researchQueue = building.researchQueue || [];

    if (queue.length === 0 && researchQueue.length === 0) return null;

    return (
        <div className="mt-2">
            <h4 className={`${isTouchDevice ? 'text-base' : 'text-sm'} font-bold text-gray-300`}>{t('ui.queue')}</h4>
            <div className={`flex ${isTouchDevice ? 'space-x-3 mt-2 p-2' : 'space-x-2 mt-1 p-1'} bg-slate-800/50 rounded-md`}>
                {queue.map((item, index) => {
                    const popCapReached = player.population.current >= player.population.cap;
                    const isPaused = index === 0 && popCapReached;
                    const trainingTime = TRAINING_TIME[item.unitType] * 1000;
                    const progress = Math.min(100, (item.progress / trainingTime) * 100);
                    const unitTypeName = t(`unit.${item.unitType}`);

                    return (
                        <button
                            key={`train-${index}`}
                            onClick={isPlayerBuilding ? () => dispatch({ type: 'CANCEL_TRAIN_UNIT', payload: { buildingId: building.id, queueIndex: index } }) : undefined}
                            title={isPlayerBuilding ? t('ui.cancelTrain', { unitType: unitTypeName }) : t('ui.inQueue', { unitType: unitTypeName })}
                            className={`relative ${isTouchDevice ? 'w-14 h-14 text-sm' : 'w-12 h-12 text-xs'} bg-gray-700 rounded-md text-center flex items-center justify-center overflow-hidden ring-1 ring-slate-600 transition-all ${isPlayerBuilding ? 'hover:ring-red-500 hover:ring-2' : ''}`}
                        >
                             <div className="absolute bottom-0 left-0 h-full bg-green-500/50" style={{ width: `${index === 0 ? progress : 0}%` }}></div>
                             {isPaused && (
                                <div className="absolute inset-0 bg-yellow-500/50 flex items-center justify-center">
                                    <PopulationIcon />
                                </div>
                             )}
                             <p className={`font-bold z-10 ${isTouchDevice ? 'text-sm' : 'text-xs'}`}>{item.unitType.slice(0, 4)}</p>
                        </button>
                    );
                })}
                {researchQueue.map((item, index) => {
                     const researchInfo = RESEARCH_CONFIG[item.type];
                     const researchName = t(researchInfo.nameKey);
                     const progress = Math.min(100, (item.progress / researchInfo.time) * 100);
                    return (
                        <button
                            key={`research-${index}`}
                            onClick={isPlayerBuilding ? () => dispatch({ type: 'CANCEL_RESEARCH', payload: { buildingId: building.id } }) : undefined}
                            title={isPlayerBuilding ? t('ui.cancelResearch') : t('ui.researching', { researchName })}
                            className={`relative ${isTouchDevice ? 'w-14 h-14 text-sm' : 'w-12 h-12 text-xs'} bg-gray-700 rounded-md text-center flex items-center justify-center overflow-hidden ring-1 ring-slate-600 transition-all ${isPlayerBuilding ? 'hover:ring-red-500 hover:ring-2' : ''}`}
                        >
                             <div className="absolute bottom-0 left-0 h-full bg-purple-500/50" style={{width: `${progress}%`}}></div>
                             <p className={`font-bold z-10 ${isTouchDevice ? 'text-sm' : 'text-xs'}`}>{t('ui.level', { level: item.level })}</p>
                        </button>
                    )
                })}
            </div>
        </div>
    );
};

const StanceButton: React.FC<{
    stance: UnitStance,
    label: string,
    Icon: React.FC<{className?: string}>,
    currentStances: UnitStance[],
    onClick: () => void,
    isTouchDevice: boolean,
}> = ({ stance, label, Icon, currentStances, onClick, isTouchDevice }) => {
    const isActive = currentStances.length > 0 && currentStances.every(s => s === stance);
    const sizeClasses = isTouchDevice ? 'w-28 h-24 p-3' : 'w-24 h-20 p-2';
    const iconClasses = isTouchDevice ? 'h-10 w-10' : 'h-8 w-8';
    const textClasses = isTouchDevice ? 'text-sm mt-1 font-semibold' : 'text-xs mt-1 font-semibold';

    return (
        <button
            onClick={onClick}
            title={label}
            className={`${sizeClasses} rounded-md flex flex-col items-center justify-center text-center transition-all duration-150 ring-1
                ${isActive ? 'bg-sky-600/80 ring-sky-400 text-sky-300' : 'bg-slate-700/80 hover:bg-slate-600/80 ring-slate-600 text-slate-300'}`
            }
        >
            <Icon className={iconClasses} />
            <p className={textClasses}>{label}</p>
        </button>
    );
};

const StanceControlPanel: React.FC<{ units: Unit[], dispatch: React.Dispatch<Action>, isTouchDevice: boolean }> = ({ units, dispatch, isTouchDevice }) => {
    const { t } = useLocalization();
    const combatUnits = units.filter(u => u.unitType !== UnitType.WORKER);
    if(combatUnits.length === 0) return null;

    const unitIds = combatUnits.map(u => u.id);
    const setStance = (stance: UnitStance) => {
        dispatch({ type: 'CHANGE_STANCE', payload: { unitIds, stance } });
    };
    const currentStances = combatUnits.map(u => u.stance);

    return (
        <div className={`flex ${isTouchDevice ? 'gap-3 p-3' : 'gap-2 p-2'} flex-wrap`}>
            <StanceButton stance={UnitStance.AGGRESSIVE} label={t('stance.AGGRESSIVE')} Icon={AggressiveIcon} currentStances={currentStances} onClick={() => setStance(UnitStance.AGGRESSIVE)} isTouchDevice={isTouchDevice} />
            <StanceButton stance={UnitStance.HOLD_GROUND} label={t('stance.HOLD_GROUND')} Icon={HoldGroundIcon} currentStances={currentStances} onClick={() => setStance(UnitStance.HOLD_GROUND)} isTouchDevice={isTouchDevice} />
        </div>
    );
};

const WorkerActions: React.FC<{ player: Player; dispatch: React.Dispatch<Action>; isTouchDevice: boolean }> = ({ player, dispatch, isTouchDevice }) => (
    <div className={`flex flex-wrap ${isTouchDevice ? 'gap-3 p-3' : 'gap-2 p-2'}`}>
        <BuildActionButton type={BuildingType.TOWN_HALL} player={player} dispatch={dispatch} isTouchDevice={isTouchDevice} />
        <BuildActionButton type={BuildingType.HOUSE} player={player} dispatch={dispatch} isTouchDevice={isTouchDevice} />
        <BuildActionButton type={BuildingType.BARRACKS} player={player} dispatch={dispatch} isTouchDevice={isTouchDevice} />
        <BuildActionButton type={BuildingType.WAREHOUSE} player={player} dispatch={dispatch} isTouchDevice={isTouchDevice} />
        <BuildActionButton type={BuildingType.DEFENSIVE_TOWER} player={player} dispatch={dispatch} isTouchDevice={isTouchDevice} />
        <BuildActionButton type={BuildingType.RESEARCH_CENTER} player={player} dispatch={dispatch} isTouchDevice={isTouchDevice} />
        <BuildActionButton type={BuildingType.MARKET} player={player} dispatch={dispatch} isTouchDevice={isTouchDevice} />
    </div>
);

const TradeActionButton: React.FC<{
    tradeType: 'buy' | 'sell',
    player: Player,
    dispatch: React.Dispatch<Action>,
    isTouchDevice: boolean,
}> = ({ tradeType, player, dispatch, isTouchDevice }) => {
    const { t } = useLocalization();
    const isBuy = tradeType === 'buy';
    const goldCost = 20;
    const woodAmount = 10;
    const goldGain = 5;

    const canAffordBuy = player.resources.gold >= goldCost;
    const canAffordSell = player.resources.wood >= woodAmount;
    const isDisabled = isBuy ? !canAffordBuy : !canAffordSell;

    const title = isBuy ? `Buy ${woodAmount} Wood for ${goldCost} Gold` : `Sell ${woodAmount} Wood for ${goldGain} Gold`;
    const label = isBuy ? 'Buy Wood' : 'Sell Wood';
    const costLabel = isBuy ? `G:${goldCost} → W:${woodAmount}` : `W:${woodAmount} → G:${goldGain}`;

    const sizeClasses = isTouchDevice ? 'w-28 h-28 p-3 gap-1' : 'w-24 h-20 p-2';
    const textPrimary = isTouchDevice ? 'font-bold text-base' : 'font-bold text-sm';
    const textSecondary = isTouchDevice ? 'text-sm' : 'text-xs';

    return (
        <button
            onClick={() => dispatch({ type: 'TRADE_RESOURCES', payload: { playerId: player.id, trade: isBuy ? 'buy_wood' : 'sell_wood' } })}
            disabled={isDisabled}
            title={title}
            className={`${sizeClasses} rounded-md flex flex-col items-center justify-center text-center transition-all duration-150 ${!isDisabled ? 'bg-emerald-700/80 hover:bg-emerald-600/80 ring-1 ring-emerald-500' : 'bg-gray-700/80 text-gray-400 cursor-not-allowed ring-1 ring-gray-600'}`}
        >
            <p className={textPrimary}>{label}</p>
            <p className={`${textSecondary} mt-1`}>{costLabel}</p>
        </button>
    );
};

export const ActionPanel: React.FC<{ gameState: GameState; selectedObjects: GameObject[]; dispatch: React.Dispatch<Action>; isTouchDevice: boolean }> = ({ gameState, selectedObjects, dispatch, isTouchDevice }) => {
    const { t } = useLocalization();
    const humanPlayer = gameState.players.find(p => p.isHuman);

    if (!humanPlayer) return null; // No human player, no actions
    if (gameState.buildMode) return null;
    
    // Handle multiple building selection
    const selectedPlayerBuildings = selectedObjects.filter(o => o.type === GameObjectType.BUILDING && o.playerId === humanPlayer.id) as Building[];
    if (selectedPlayerBuildings.length > 1 && selectedPlayerBuildings.length === selectedObjects.length) {
        const firstBuildingType = selectedPlayerBuildings[0].buildingType;
        const allSameType = selectedPlayerBuildings.every(b => b.buildingType === firstBuildingType);
        
        if (allSameType && (firstBuildingType === BuildingType.BARRACKS || firstBuildingType === BuildingType.TOWN_HALL)) {
            return <MultiBuildingActionPanel buildings={selectedPlayerBuildings} player={humanPlayer} dispatch={dispatch} isTouchDevice={isTouchDevice} />;
        }
    }


    const selectedPlayerUnits = selectedObjects.filter(o => o.type === GameObjectType.UNIT && o.playerId === humanPlayer.id) as Unit[];

    if (selectedObjects.length > 1) {
         const combatUnits = selectedPlayerUnits.filter(u => u.unitType !== UnitType.WORKER);
         const workerUnits = selectedPlayerUnits.filter(u => u.unitType === UnitType.WORKER);
        return (
            <div className="flex flex-col h-full">
                <div className="flex-shrink-0">
                    {combatUnits.length > 0 && <StanceControlPanel units={combatUnits} dispatch={dispatch} isTouchDevice={isTouchDevice} />}
                    {workerUnits.length > 0 && combatUnits.length === 0 && (
                        <WorkerActions player={humanPlayer} dispatch={dispatch} isTouchDevice={isTouchDevice} />
                    )}
                </div>
                <div className="flex-grow overflow-hidden">
                    <MultiSelectPanel units={selectedPlayerUnits} dispatch={dispatch} isTouchFriendly={isTouchDevice} />
                </div>
            </div>
        );
    }

    const selectedObject = selectedObjects.length === 1 ? selectedObjects[0] : null;

    if (!selectedObject) {
        return null;
    }
    
    const owner = selectedObject.playerId !== undefined ? gameState.players[selectedObject.playerId] : null;
    if (owner && !owner.isHuman) {
        const isHostile = arePlayersHostile(humanPlayer, owner);
        const messageKey = isHostile ? 'ui.cannotCommandEnemy' : 'ui.cannotCommandAlly';
        return <div className="p-4 text-gray-400 text-center self-center">{t(messageKey)}</div>;
    }

    switch (selectedObject.type) {
        case GameObjectType.UNIT:
            const unit = selectedObject as Unit;
             const combatUnits = unit.unitType !== UnitType.WORKER ? [unit] : [];
             const workerUnits = unit.unitType === UnitType.WORKER ? [unit] : [];
            return (
                <div className={isTouchDevice ? 'p-3 space-y-3' : 'p-2'}>
                    {combatUnits.length > 0 && <StanceControlPanel units={combatUnits} dispatch={dispatch} isTouchDevice={isTouchDevice} />}
                    {workerUnits.length > 0 && <WorkerActions player={humanPlayer} dispatch={dispatch} isTouchDevice={isTouchDevice} />}
                </div>
            );
        case GameObjectType.BUILDING:
            const building = selectedObject as Building;
            
            if (building.buildingType === BuildingType.RESEARCH_CENTER) {
                const allResearches: ResearchCategory[] = [
                    ResearchCategory.MELEE_ATTACK, 
                    ResearchCategory.MELEE_DEFENSE, 
                    ResearchCategory.RANGED_ATTACK, 
                    ResearchCategory.RANGED_DEFENSE,
                    ResearchCategory.SIEGE_ATTACK, 
                    ResearchCategory.BUILDING_ATTACK,
                ];

                return (
                    <div className={`${isTouchDevice ? 'p-3' : 'p-2'} flex flex-col h-full`}>
                        <div className={`flex-grow grid ${isTouchDevice ? 'grid-cols-1 sm:grid-cols-2 gap-3' : 'grid-cols-2 gap-2'} auto-rows-min overflow-y-auto pr-2 custom-scrollbar-vertical`}>
                            {allResearches.map(category => (
                                <ResearchActionButton key={category} category={category} player={humanPlayer} building={building} dispatch={dispatch} isTouchDevice={isTouchDevice} />
                            ))}
                        </div>

                        <div className={`flex-shrink-0 border-t border-slate-700 mt-auto ${isTouchDevice ? 'pt-3' : 'pt-2'}`}>
                            <TrainingQueue building={building} player={humanPlayer} dispatch={dispatch} isTouchDevice={isTouchDevice} />
                        </div>
                    </div>
                );
            }

            if (building.buildingType === BuildingType.MARKET) {
                return (
                    <div className={`${isTouchDevice ? 'p-3' : 'p-2'} flex flex-col h-full`}>
                        <div className={`flex items-start flex-wrap ${isTouchDevice ? 'gap-3 mb-3' : 'gap-2 mb-2'}`}>
                            <TradeActionButton tradeType="buy" player={humanPlayer} dispatch={dispatch} isTouchDevice={isTouchDevice} />
                            <TradeActionButton tradeType="sell" player={humanPlayer} dispatch={dispatch} isTouchDevice={isTouchDevice} />
                        </div>
                        <div className="flex-grow overflow-y-auto pr-2 custom-scrollbar-vertical">
                             <ResearchActionButton category={ResearchCategory.WORKER_CAPACITY} player={humanPlayer} building={building} dispatch={dispatch} isTouchDevice={isTouchDevice} />
                        </div>
                        <div className={`flex-shrink-0 border-t border-slate-700 mt-auto ${isTouchDevice ? 'pt-3' : 'pt-2'}`}>
                            <TrainingQueue building={building} player={humanPlayer} dispatch={dispatch} isTouchDevice={isTouchDevice} />
                        </div>
                    </div>
                );
            }

            return (
                <div className={isTouchDevice ? 'p-3 space-y-3' : 'p-2'}>
                    <div className={`flex items-start flex-wrap ${isTouchDevice ? 'gap-3' : 'gap-2'}`}>
                        {building.buildingType === BuildingType.TOWN_HALL &&
                            <TrainActionButton
                                type={UnitType.WORKER}
                                player={humanPlayer}
                                onClick={() => dispatch({ type: 'TRAIN_UNIT', payload: { buildingId: building.id, unitType: UnitType.WORKER } })}
                                isDisabled={building.constructionProgress !== undefined}
                                isTouchDevice={isTouchDevice}
                            />
                        }
                        {building.buildingType === BuildingType.BARRACKS && (
                            <>
                                <TrainActionButton type={UnitType.INFANTRY} player={humanPlayer} onClick={() => dispatch({ type: 'TRAIN_UNIT', payload: { buildingId: building.id, unitType: UnitType.INFANTRY }})} isDisabled={building.constructionProgress !== undefined} isTouchDevice={isTouchDevice} />
                                <TrainActionButton type={UnitType.ARCHER} player={humanPlayer} onClick={() => dispatch({ type: 'TRAIN_UNIT', payload: { buildingId: building.id, unitType: UnitType.ARCHER }})} isDisabled={building.constructionProgress !== undefined} isTouchDevice={isTouchDevice} />
                                <TrainActionButton type={UnitType.CAVALRY} player={humanPlayer} onClick={() => dispatch({ type: 'TRAIN_UNIT', payload: { buildingId: building.id, unitType: UnitType.CAVALRY }})} isDisabled={building.constructionProgress !== undefined} isTouchDevice={isTouchDevice} />
                                <TrainActionButton type={UnitType.CATAPULT} player={humanPlayer} onClick={() => dispatch({ type: 'TRAIN_UNIT', payload: { buildingId: building.id, unitType: UnitType.CATAPULT }})} isDisabled={building.constructionProgress !== undefined} isTouchDevice={isTouchDevice} />
                            </>
                        )}
                         {building.buildingType === BuildingType.DEFENSIVE_TOWER && !building.isUpgraded && (
                            <UpgradeTowerButton building={building} player={humanPlayer} dispatch={dispatch} isTouchDevice={isTouchDevice} />
                        )}
                    </div>
                    <TrainingQueue building={building} player={humanPlayer} dispatch={dispatch} isTouchDevice={isTouchDevice} />
                </div>
            );
        default:
             return <div className="text-gray-400 p-2">{t('ui.noActions')}</div>;
    }
};