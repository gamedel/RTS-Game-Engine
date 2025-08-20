import React from 'react';
import { UnitType } from '../../types';

export const GoldIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-yellow-300" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 5.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l2-2a1 1 0 00-1.414-1.414L11 6.586V4a1 1 0 10-2 0v2.586l-.293-.293zM10 15a1 1 0 001-1v-2.586l.293.293a1 1 0 001.414-1.414l-2-2a1 1 0 00-1.414 0l-2 2a1 1 0 101.414 1.414L9 11.414V14a1 1 0 001 1z" clipRule="evenodd" />
    </svg>
);

export const WoodIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-amber-500" viewBox="0 0 20 20" fill="currentColor">
        <path d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7a1 1 0 011.414-1.414L10 14.586l6.293-6.293a1 1 0 011.414 0z" />
        <path d="M10.293 3.293a1 1 0 011.414 0l7 7a1 1 0 010 1.414l-1.586 1.586a1 1 0 01-1.414 0L10 8.414l-5.707 5.707a1 1 0 01-1.414 0L1.293 11.707a1 1 0 010-1.414l7-7a1 1 0 011.414 0z" />
    </svg>
);

export const PopulationIcon = () => (
     <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-sky-300" viewBox="0 0 20 20" fill="currentColor">
        <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0110 9c-1.55 0-2.958.68-3.93 1.67a6.97 6.97 0 00-1.5 4.33c0 .34.024.673.07 1h7.73zM12 12a5 5 0 015 5v1a1 1 0 01-1 1H4a1 1 0 01-1-1v-1a5 5 0 015-5h4z" />
    </svg>
);

export const DebugIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.096 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
);


export const AggressiveIcon: React.FC<{className?: string}> = ({className}) => (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.21 15.89-1.42-1.42m-2.82 2.82-1.42-1.42m-4.24 0-1.42 1.42m-2.82-2.82 1.42 1.42M4 12c0-4.4 3.6-8 8-8s8 3.6 8 8-3.6 8-8 8-8-3.6-8-8z"/><path d="m14 14-4-4"/><path d="m10 14 4-4"/></svg>
);

export const HoldGroundIcon: React.FC<{className?: string}> = ({className}) => (
     <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 12H9.5a2.5 2.5 0 0 1 0-5H12Z"/><path d="M12 12h2.5a2.5 2.5 0 0 0 0-5H12Z"/></svg>
);

const WorkerIcon = ({ style }: { style?: React.CSSProperties }) => (
    <svg style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
);

const InfantryIcon = ({ style }: { style?: React.CSSProperties }) => (
    <svg style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 17.5 3 6V3h3l11.5 11.5" />
        <path d="M13 19v-5l5-5" />
        <path d="m16 16 3.5-3.5" />
        <path d="m19 13 3.5-3.5" />
        <path d="m22 10-3-3" />
    </svg>
);

const ArcherIcon = ({ style }: { style?: React.CSSProperties }) => (
    <svg style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m21 21-6-6" />
        <path d="m6 6 6 6" />
        <path d="M12 22A10 10 0 0 0 22 12" />
        <path d="M2 12A10 10 0 0 0 12 2" />
    </svg>
);

const CavalryIcon = ({ style }: { style?: React.CSSProperties }) => (
    <svg style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3.5 21 5 17c.2-1.2.8-2.3 1.5-3.3" />
        <path d="m19 21-1-4c-.2-1.2-.8-2.3-1.5-3.3" />
        <path d="M11 22 12 19" />
        <path d="M7 16c.3-.3.6-.5.9-.7l2.1-1.3c.4-.3.9-.3 1.3 0l2.1 1.3c.3.2.6.4.9.7" />
        <path d="M12 12.8V9.5a2.5 2.5 0 0 1 5 0V11" />
        <path d="M8 11.2V9.5a2.5 2.5 0 0 0-5 0V11" />
        <path d="M4 14.5c1.5 2 4.5 3.5 8 3.5s6.5-1.5 8-3.5" />
        <path d="M12 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
    </svg>
);

export const CatapultIcon = ({ style }: { style?: React.CSSProperties }) => (
    <svg style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 10.5V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-1.5" />
        <path d="m2 13 1.1-2.2a1 1 0 0 1 .9-.6h16a1 1 0 0 1 .9.6L22 13" />
        <path d="M15 10a3 3 0 1 1-6 0" />
        <path d="M12 10V3" />
        <path d="m5 10 3 3" />
        <path d="m19 10-3 3" />
    </svg>
);

export const UnitTypeIcon: React.FC<{ type: UnitType, style?: React.CSSProperties }> = ({ type, style }) => {
    switch(type) {
        case UnitType.WORKER: return <WorkerIcon style={style} />;
        case UnitType.INFANTRY: return <InfantryIcon style={style} />;
        case UnitType.ARCHER: return <ArcherIcon style={style} />;
        case UnitType.CAVALRY: return <CavalryIcon style={style} />;
        case UnitType.CATAPULT: return <CatapultIcon style={style} />;
        default: return null;
    }
};

export const AttackingStatusIcon: React.FC<{className?: string}> = ({className}) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9.5 7.5 3 14" /><path d="M3 3l11 11" /><path d="M14 3.5 16.5 6" /><path d="M15 4.5 17.5 7" /><path d="m18 11 2.5 2.5" /><path d="m19 12 2.5 2.5" />
    </svg>
);

export const MovingStatusIcon: React.FC<{className?: string}> = ({className}) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="m6 9 6-6 6 6"/><path d="m6 17 6-6 6 6"/>
    </svg>
);

export const GatheringStatusIcon: React.FC<{className?: string}> = ({className}) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.5 13.5 6 22l-4-4 8.5-8.5" /><path d="M18 11.5 22 7.5l-4-4-4 4" /><path d="m2 18 4 4" /><path d="M12 2 8.5 5.5" /><path d="M16 6.5 13 9.5" />
    </svg>
);

export const BuildingStatusIcon: React.FC<{className?: string}> = ({className}) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="m15.2 3.8-3.4 3.4" /><path d="M13 2H9" /><path d="M15 5v3" /><path d="M9.4 12.6 2 20l4-4 6.6-6.6" /><path d="M18 22l-6-6" />
    </svg>
);

export const IdleStatusIcon: React.FC<{className?: string}> = ({className}) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 17v-2" /><path d="M20 19v-2" /><path d="M18 17v-2" />
    </svg>
);