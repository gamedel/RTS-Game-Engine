import React from 'react';
import { Action } from '../../types';
import { useLocalization } from '../../hooks/useLocalization';

interface PauseMenuProps {
    dispatch: React.Dispatch<Action>;
    onBackToMenu: () => void;
}

export const PauseMenu: React.FC<PauseMenuProps> = ({ dispatch, onBackToMenu }) => {
    const { t } = useLocalization();

    return (
        <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center z-50">
            <h1 className="text-7xl font-bold text-slate-300 mb-8">{t('ui.paused')}</h1>
            <div className="flex flex-col gap-6">
                <button
                    onClick={() => dispatch({ type: 'RESUME_GAME' })}
                    className="px-8 py-4 bg-slate-700 hover:bg-slate-600 text-white font-bold text-2xl rounded-lg ring-2 ring-slate-500 transition-transform transform hover:scale-105"
                >
                    {t('ui.resume')}
                </button>
                <button
                    onClick={onBackToMenu}
                    className="px-8 py-4 bg-slate-800 hover:bg-slate-700 text-white font-bold text-2xl rounded-lg ring-2 ring-slate-600 transition-transform transform hover:scale-105"
                >
                    {t('ui.backToMenu')}
                </button>
            </div>
        </div>
    );
};
