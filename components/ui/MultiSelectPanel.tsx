import React from 'react';
import { Unit, UnitType, UnitStatus, Action } from '../../types';
import { UnitTypeIcon, AttackingStatusIcon, MovingStatusIcon, GatheringStatusIcon, BuildingStatusIcon, IdleStatusIcon } from './Icons';

const VISIBLE_LIMIT = 24;

const StatusIcon: React.FC<{ status: UnitStatus }> = ({ status }) => {
    let IconComponent: React.FC<{className?: string}> | null = null;
    let color = 'text-slate-400';
    let title = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();

    switch (status) {
        case UnitStatus.ATTACKING: IconComponent = AttackingStatusIcon; color = 'text-red-400'; break;
        case UnitStatus.MOVING:
        case UnitStatus.RETURNING:
        case UnitStatus.FLEEING: IconComponent = MovingStatusIcon; color = 'text-blue-400'; title="Moving"; break;
        case UnitStatus.GATHERING: IconComponent = GatheringStatusIcon; color = 'text-yellow-400'; break;
        case UnitStatus.BUILDING:
        case UnitStatus.REPAIRING: IconComponent = BuildingStatusIcon; color = 'text-cyan-400'; title="Building"; break;
        case UnitStatus.IDLE: IconComponent = IdleStatusIcon; color = 'text-slate-500'; break;
    }

    if (!IconComponent) return null;

    return (
        <div className="absolute top-0.5 right-0.5 bg-slate-900/60 backdrop-blur-sm rounded-full p-0.5" title={title}>
            <IconComponent className={`w-4 h-4 ${color}`} />
        </div>
    );
};

export const MultiSelectPanel: React.FC<{ units: Unit[], dispatch: React.Dispatch<Action> }> = ({ units, dispatch }) => {
    
    const sortedUnits = [...units].sort((a, b) => {
        const order = { [UnitType.WORKER]: 0, [UnitType.INFANTRY]: 1, [UnitType.ARCHER]: 2, [UnitType.CAVALRY]: 3, [UnitType.CATAPULT]: 4 };
        return order[a.unitType] - order[b.unitType];
    });

    const extra = sortedUnits.length - VISIBLE_LIMIT;

    return (
        <div className="flex h-full w-full overflow-hidden">
            <div className="flex items-center gap-1.5 h-full w-full overflow-x-auto overflow-y-hidden p-2 custom-scrollbar">
                {sortedUnits.slice(0, VISIBLE_LIMIT).map(unit => {
                    const hpPercentage = (unit.hp / unit.maxHp) * 100;
                    const healthColor = hpPercentage > 60 ? 'bg-green-500' : hpPercentage > 30 ? 'bg-yellow-500' : 'bg-red-500';
                    
                    return (
                        <button
                            key={unit.id}
                            className="relative bg-gradient-to-b from-slate-700/60 to-slate-900/60 backdrop-blur-sm rounded-lg p-1 flex-shrink-0 flex flex-col items-center justify-between ring-1 ring-slate-600/80 hover:ring-cyan-400 transition-all duration-150 transform hover:-translate-y-1 focus:outline-none focus:ring-2 focus:ring-cyan-300 w-16 h-full"
                            onClick={(e) => {
                                e.stopPropagation();
                                dispatch({ type: 'SELECT_OBJECT', payload: { id: unit.id, isShift: false } });
                            }}
                            title={`${unit.unitType} (${Math.floor(unit.hp)}/${unit.maxHp} HP)`}
                        >
                            <StatusIcon status={unit.status} />
                            <div className="flex-grow flex items-center justify-center w-full text-slate-300">
                                <UnitTypeIcon type={unit.unitType} style={{ width: '36px', height: '36px' }} />
                            </div>

                            <div className="w-full relative h-4 text-center">
                                <div className="w-full bg-slate-900/50 rounded-full h-2 absolute bottom-2 left-0">
                                    <div className={`${healthColor} h-full rounded-full transition-all duration-300 ease-in-out`} style={{ width: `${hpPercentage}%` }}></div>
                                </div>
                                <p className="absolute bottom-0 left-0 right-0 text-xs font-bold text-white" style={{ textShadow: '0 0 3px black' }}>
                                    {Math.floor(unit.hp)}
                                </p>
                            </div>
                        </button>
                    )
                })}
                 {extra > 0 && (
                    <div className="relative bg-gradient-to-b from-slate-700/60 to-slate-900/60 backdrop-blur-sm rounded-lg p-1 flex-shrink-0 flex flex-col items-center justify-center ring-1 ring-slate-600/80 w-16 h-full text-slate-300 font-bold text-lg">
                        +{extra}
                    </div>
                )}
            </div>
        </div>
    );
};