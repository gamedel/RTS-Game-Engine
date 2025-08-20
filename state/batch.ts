import { Action, Unit, Building, Projectile, BatchUpdatePayload } from '../types';

type UpdatePayload =
  | (Partial<Unit> & { id: string })
  | (Partial<Building> & { id: string })
  | (Partial<Projectile> & { id: string });

type UpdateType = 'units' | 'buildings' | 'projectiles';

export type BufferedDispatch = (action: Action) => void;

type Buffer = {
  units: Array<Partial<Unit> & { id: string }>;
  buildings: Array<Partial<Building> & { id: string }>;
  projectiles: Array<Partial<Projectile> & { id: string }>;
};

export function createBufferedDispatch(dispatch: React.Dispatch<Action>) {
  const buffer: Buffer = {
    units: [],
    buildings: [],
    projectiles: [],
  };

  const push = (type: UpdateType, patch: UpdatePayload) => {
    (buffer[type] as any[]).push(patch);
  };

  const bufferedDispatch = (action: Action) => {
    switch (action.type) {
      case 'UPDATE_UNIT':
        push('units', action.payload);
        break;
      case 'UPDATE_BUILDING':
        push('buildings', action.payload);
        break;
      case 'UPDATE_PROJECTILE':
        push('projectiles', action.payload);
        break;
      default:
        // For less frequent actions, dispatch immediately
        dispatch(action);
    }
  };

  const flush = () => {
    if (buffer.units.length > 0 || buffer.buildings.length > 0 || buffer.projectiles.length > 0) {
      const payload: BatchUpdatePayload = {};
      if (buffer.units.length > 0) payload.units = buffer.units;
      if (buffer.buildings.length > 0) payload.buildings = buffer.buildings;
      if (buffer.projectiles.length > 0) payload.projectiles = buffer.projectiles;
      
      dispatch({ type: 'BATCH_UPDATE', payload });
    }
    // Clear buffers for the next frame
    buffer.units = [];
    buffer.buildings = [];
    buffer.projectiles = [];
  };

  return { d: bufferedDispatch, flush };
}