import { GameState, Unit, Vector3 } from '../../types';
import { UNIT_CONFIG } from '../../constants';
import { BufferedDispatch } from '../../state/batch';

type BehaviorProfile = {
    acquisitionRange: number;
    guardDistance: number;
    pursuitDistance: number;
    assistRadius: number;
    threatDecay: number;
};

export const AUTO_COMBAT_SQUAD_ID = '__AUTO_COMBAT__';

export const getBehaviorProfile = (unit: Unit): BehaviorProfile => {
    const rawConfig = UNIT_CONFIG[unit.unitType] as any;
    const acquisitionRange = rawConfig?.aggroRange ?? 0;
    const guardDistance = rawConfig?.guardDistance ?? Math.max(acquisitionRange, unit.attackRange + 2);
    const pursuitDistance = rawConfig?.pursuitDistance ?? guardDistance + 6;
    const assistRadius = rawConfig?.assistRadius ?? guardDistance + 4;
    const threatDecay = rawConfig?.threatDecay ?? 6;

    return {
        acquisitionRange,
        guardDistance,
        pursuitDistance,
        assistRadius,
        threatDecay,
    };
};

export const distanceSqXZ = (a: Vector3, b: Vector3): number => {
    const dx = a.x - b.x;
    const dz = a.z - b.z;
    return dx * dx + dz * dz;
};

export const registerThreat = (
    state: GameState,
    dispatch: BufferedDispatch,
    victim: Unit,
    attackerId: string,
    now: number,
) => {
    if (victim.isDying || victim.hp <= 0) return;

    const behavior = getBehaviorProfile(victim);
    const threatExpireAt = now + behavior.threatDecay * 1000;

    dispatch({
        type: 'UPDATE_UNIT',
        payload: {
            id: victim.id,
            threatTargetId: attackerId,
            recentAttackerId: attackerId,
            threatExpireAt,
            lastThreatTime: now,
            isReturningToGuard: false,
            acquisitionCooldown: 0,
        },
    });

    if (behavior.assistRadius <= 0) return;

    const assistRadiusSq = behavior.assistRadius * behavior.assistRadius;
    const allies = Object.values(state.units);
    for (const ally of allies) {
        if (ally.id === victim.id) continue;
        if (ally.playerId !== victim.playerId) continue;
        if (ally.isDying || ally.hp <= 0 || ally.attackDamage <= 0) continue;
        if (ally.workerOrder) continue;

        const guard = ally.guardPosition ?? ally.position;
        if (distanceSqXZ(guard, victim.position) > assistRadiusSq) continue;

        const allyBehavior = getBehaviorProfile(ally);
        dispatch({
            type: 'UPDATE_UNIT',
            payload: {
                id: ally.id,
                threatTargetId: attackerId,
                threatExpireAt: now + allyBehavior.threatDecay * 1000,
                lastThreatTime: now,
                acquisitionCooldown: 0,
            },
        });
    }
};

export const clearExpiredThreat = (unit: Unit, now: number, dispatch: BufferedDispatch) => {
    if (unit.threatExpireAt !== undefined && unit.threatExpireAt <= now) {
        dispatch({
            type: 'UPDATE_UNIT',
            payload: {
                id: unit.id,
                threatTargetId: undefined,
                threatExpireAt: undefined,
                recentAttackerId: undefined,
                lastThreatTime: undefined,
            },
        });
    }
};
