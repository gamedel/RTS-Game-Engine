import React, { useState } from 'react';
import { useLocalization } from '../../hooks/useLocalization';
import { AIDifficulty, MapType, PlayerSetupConfig } from '../../types';
import { PLAYER_COLORS } from '../../constants';

interface MainMenuProps {
    onStartGame: (mapType: MapType, players: PlayerSetupConfig[]) => void;
}

const MenuButton: React.FC<{
    id: string;
    label: string;
    current: string;
    onClick: (id: string) => void;
}> = ({ id, label, current, onClick }) => {
    const isActive = id === current;
    const baseClasses = "px-6 py-2 rounded-lg font-bold text-lg ring-2 transition-all duration-200";
    const activeClasses = "bg-sky-600 ring-sky-400 text-white transform scale-105 shadow-lg";
    const inactiveClasses = "bg-slate-700 hover:bg-slate-600 ring-slate-500 text-slate-300";

    return (
        <button onClick={() => onClick(id)} className={`${baseClasses} ${isActive ? activeClasses : inactiveClasses}`}>
            {label}
        </button>
    );
};

const initialPlayers: PlayerSetupConfig[] = [
    { isHuman: true, teamId: '1' },
    { isHuman: false, teamId: '2', difficulty: 'normal' }
];

export const MainMenu: React.FC<MainMenuProps> = ({ onStartGame }) => {
    const { t } = useLocalization();
    const [mapType, setMapType] = useState<MapType>('default');
    const [players, setPlayers] = useState<PlayerSetupConfig[]>(initialPlayers);

    const mapTypes: MapType[] = ['default', 'forest', 'gold_rush', 'open_plains'];
    const difficulties: AIDifficulty[] = ['easy', 'normal', 'hard', 'very_hard'];

    const handleAddPlayer = () => {
        if (players.length < 4) {
            const newPlayer: PlayerSetupConfig = {
                isHuman: false,
                difficulty: 'normal',
                teamId: (players.length + 1).toString(),
            };
            setPlayers([...players, newPlayer]);
        }
    };

    const handleRemovePlayer = (indexToRemove: number) => {
        if (players.length > 2) {
            setPlayers(players.filter((_, index) => index !== indexToRemove));
        }
    };

    const handleTeamChange = (index: number, teamId: string) => {
        const newPlayers = [...players];
        newPlayers[index].teamId = teamId;
        setPlayers(newPlayers);
    };

    const handleDifficultyChange = (index: number, difficulty: AIDifficulty) => {
        const newPlayers = [...players];
        if (!newPlayers[index].isHuman) {
            newPlayers[index].difficulty = difficulty;
        }
        setPlayers(newPlayers);
    };

    return (
        <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center z-40 p-4">
            <h1 className="text-6xl md:text-8xl font-bold text-slate-200 mb-6 text-center" style={{ textShadow: '0 0 15px rgba(100, 116, 139, 0.8)' }}>
                RTS Game Engine
            </h1>

            <div className="flex flex-col items-center gap-6 mb-6 w-full max-w-4xl">
                 <div className="text-center">
                    <h2 className="text-2xl font-semibold text-slate-300 mb-4">{t('ui.mapType')}</h2>
                    <div className="flex gap-4 flex-wrap justify-center">
                        {mapTypes.map(type => (
                             <MenuButton key={type} id={type} label={t(`map.${type}`)} current={mapType} onClick={(id) => setMapType(id as MapType)} />
                        ))}
                    </div>
                </div>
                
                <div className="p-4 bg-slate-800/50 rounded-lg ring-1 ring-slate-600 w-full">
                    <h2 className="text-2xl font-semibold text-slate-300 mb-4 text-center">Players & Teams</h2>
                    <div className="space-y-3">
                        {players.map((player, index) => (
                            <div key={index} className="flex flex-wrap items-center justify-between w-full bg-slate-700/50 p-3 rounded-lg ring-1 ring-slate-600 gap-4">
                                <div className="flex items-center gap-4">
                                    <div className="w-6 h-6 rounded-full" style={{ backgroundColor: PLAYER_COLORS[index] }}></div>
                                    <span className="font-semibold text-lg w-36" style={{color: player.isHuman ? '#38bdf8' : undefined}}>
                                        Player {index + 1} {player.isHuman ? '(You)' : '(AI)'}
                                    </span>
                                </div>
                                <div className="flex items-center flex-wrap gap-x-6 gap-y-2">
                                    {!player.isHuman && (
                                        <div className="flex items-center gap-2">
                                            <label htmlFor={`difficulty-${index}`} className="text-sm font-medium text-slate-300">{t('ui.difficulty')}:</label>
                                            <select
                                                id={`difficulty-${index}`}
                                                value={player.difficulty}
                                                onChange={(e) => handleDifficultyChange(index, e.target.value as AIDifficulty)}
                                                className="p-1 bg-slate-800 border border-slate-600 rounded-md text-center font-bold text-white"
                                            >
                                                {difficulties.map(d => <option key={d} value={d}>{t(`ui.${d}`)}</option>)}
                                            </select>
                                        </div>
                                    )}
                                    <div className="flex items-center gap-2">
                                        <label htmlFor={`team-${index}`} className="text-sm font-medium text-slate-300">Team:</label>
                                        <select
                                            id={`team-${index}`}
                                            value={player.teamId}
                                            onChange={(e) => handleTeamChange(index, e.target.value)}
                                            className="w-24 p-1 bg-slate-800 border border-slate-600 rounded-md text-center font-bold text-white"
                                        >
                                            <option value="1">Team 1</option>
                                            <option value="2">Team 2</option>
                                            <option value="3">Team 3</option>
                                            <option value="4">Team 4</option>
                                            <option value="-">FFA</option>
                                        </select>
                                    </div>
                                    <div className="w-10">
                                        {!player.isHuman && (
                                            <button 
                                                onClick={() => handleRemovePlayer(index)} 
                                                disabled={players.length <= 2}
                                                className="w-8 h-8 rounded-full bg-red-700 hover:bg-red-600 disabled:bg-slate-600 disabled:cursor-not-allowed text-white font-bold text-xl flex items-center justify-center ring-1 ring-red-500 disabled:ring-slate-500 transition-all"
                                                title="Remove Player"
                                            >
                                                -
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                     <div className="mt-4 flex justify-center">
                        <button 
                            onClick={handleAddPlayer} 
                            disabled={players.length >= 4}
                            className="px-6 py-2 rounded-lg font-bold text-lg bg-green-700 hover:bg-green-600 disabled:bg-slate-600 disabled:cursor-not-allowed text-white ring-2 ring-green-500 disabled:ring-slate-500 transition-all"
                        >
                            Add AI Player
                        </button>
                    </div>
                </div>
            </div>

            <button
                onClick={() => onStartGame(mapType, players)}
                className="px-8 py-4 bg-slate-800 hover:bg-slate-700 text-white font-bold text-2xl rounded-lg ring-2 ring-slate-500 transition-transform transform hover:scale-105"
            >
                {t('ui.startGame')}
            </button>
        </div>
    );
};