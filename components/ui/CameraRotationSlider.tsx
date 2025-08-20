import React from 'react';

interface CameraRotationSliderProps {
    rotation: number; // in degrees
    setRotation: (rotation: number) => void;
}

export const CameraRotationSlider: React.FC<CameraRotationSliderProps> = ({ rotation, setRotation }) => {
    return (
        <div className="absolute top-12 left-[224px] w-48 h-10 bg-slate-900/50 backdrop-blur-sm p-2 flex items-center z-20 border border-white/10 rounded-md shadow-lg">
            <label htmlFor="rotation-slider" className="text-xl font-semibold mr-2 text-slate-300 select-none" title="Camera Rotation">⟳</label>
            <input
                id="rotation-slider"
                type="range"
                min="-180"
                max="180"
                value={rotation}
                onChange={(e) => setRotation(parseInt(e.target.value, 10))}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-sky-500"
            />
        </div>
    );
};
