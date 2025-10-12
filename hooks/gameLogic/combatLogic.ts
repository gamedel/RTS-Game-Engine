import * as THREE from 'three';
import { GameState, UnitStatus, Unit, GameObjectType, UnitStance, Building, FloatingText, UnitType, Projectile, Vector3, UnitOrderType } from '../../types';
import { COLLISION_DATA, arePlayersHostile, getAttackBonus, getDefenseBonus, getBuildingCollisionMask } from '../../constants';
import { v4 as uuidv4 } from 'uuid';
import { BufferedDispatch } from '../../state/batch';
import { getBehaviorProfile, distanceSqXZ, registerThreat, clearExpiredThreat, AUTO_COMBAT_SQUAD_ID } from './threatSystem';
import { NavMeshManager } from '../utils/navMeshManager';

type WeaponProfile = {
    style: 'melee' | 'projectile';
    projectileSpeed?: number;
    arc?: boolean;
    aoeRadius?: number;
    buildingDamageMultiplier?: number;
    preferredRangeMultiplier?: number;
    minPreferredRange?: number;
};

const DEFAULT_WEAPON: WeaponProfile = { style: 'melee', preferredRangeMultiplier: 0.55 };

const UNIT_WEAPON_PROFILE: Record<UnitType, WeaponProfile> = {
    [UnitType.WORKER]: DEFAULT_WEAPON,
    [UnitType.INFANTRY]: { style: 'melee', preferredRangeMultiplier: 0.6 },
    [UnitType.CAVALRY]: { style: 'melee', preferredRangeMultiplier: 0.5 },
    [UnitType.ARCHER]: { style: 'projectile', projectileSpeed: 34, preferredRangeMultiplier: 0.85 },
    [UnitType.CATAPULT]: { style: 'projectile', projectileSpeed: 20, arc: true, aoeRadius: 3, buildingDamageMultiplier: 1.65, preferredRangeMultiplier: 0.92, minPreferredRange: 6 },
};

const scratchAuxVec = new THREE.Vector3();

const getWeaponProfile = (unit: Unit): WeaponProfile => UNIT_WEAPON_PROFILE[unit.unitType] ?? DEFAULT_WEAPON;

const getUnitRadius = (unit: Unit): number => COLLISION_DATA.UNITS[unit.unitType]?.radius ?? 0;

const getBuildingRadius = (building: Building): number => {
    const collision = COLLISION_DATA.BUILDINGS[building.buildingType];
    if (collision) {
        return Math.max(collision.width, collision.depth) / 2;
    }
    const mask = getBuildingCollisionMask(building.buildingType);
    return Math.max(mask.width, mask.depth) / 2;
};

const getTargetRadius = (target: Unit | Building): number => {
    if (target.type === GameObjectType.BUILDING) {
        return getBuildingRadius(target);
    }
    return COLLISION_DATA.UNITS[target.unitType]?.radius ?? 0;
};

const computeCombatRanges = (unit: Unit, target: Unit | Building, weapon: WeaponProfile) => {
    const attackerRadius = getUnitRadius(unit);
    const targetRadius = getTargetRadius(target);
    const baseRange = unit.attackRange;
    const effectiveRange = baseRange + attackerRadius + targetRadius;

    let preferredRange: number;
    if (weapon.style === 'projectile') {
        const multiplier = weapon.preferredRangeMultiplier ?? 0.85;
        preferredRange = targetRadius + Math.max(attackerRadius + 0.35, baseRange * multiplier);
        if (weapon.minPreferredRange) {
            preferredRange = Math.max(preferredRange, targetRadius + weapon.minPreferredRange);
        }
    } else {
        const multiplier = weapon.preferredRangeMultiplier ?? 0.55;
        preferredRange = targetRadius + Math.max(attackerRadius + 0.2, baseRange * multiplier);
    }

    preferredRange = Math.min(preferredRange, Math.max(targetRadius + attackerRadius + 0.2, effectiveRange - 0.1));
    preferredRange = Math.max(preferredRange, targetRadius + attackerRadius + 0.2);

    return { attackerRadius, targetRadius, effectiveRange, preferredRange };
};

const computeBuildingAnchor = (unit: Unit, building: Building, distance: number) => {
    scratchAuxVec.set(unit.position.x - building.position.x, 0, unit.position.z - building.position.z);
    if (scratchAuxVec.lengthSq() < 1e-4) {
        scratchAuxVec.set(1, 0, 0);
    } else {
        scratchAuxVec.normalize();
    }
    return {
        x: building.position.x + scratchAuxVec.x * distance,
        y: 0,
        z: building.position.z + scratchAuxVec.z * distance,
    };
};

const seededAngle = (id: string): number => {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
        hash = (hash * 31 + id.charCodeAt(i)) | 0;
    }
    return ((hash >>> 0) % 360) * (Math.PI / 180);
};

const computeProjectileAnchor = (
    unit: Unit,
    target: Unit | Building,
    desiredDistance: number,
    fallback?: Vector3,
): Vector3 => {
    const targetPos = target.position;
    let dirX = unit.position.x - targetPos.x;
    let dirZ = unit.position.z - targetPos.z;
    let lenSq = dirX * dirX + dirZ * dirZ;

    if (lenSq < 0.0004 && fallback) {
        dirX = fallback.x - targetPos.x;
        dirZ = fallback.z - targetPos.z;
        lenSq = dirX * dirX + dirZ * dirZ;
    }

    if (lenSq < 0.0004) {
        const angle = seededAngle(unit.id);
        dirX = Math.cos(angle);
        dirZ = Math.sin(angle);
        lenSq = 1;
    }

    const len = Math.sqrt(lenSq);
    const normX = dirX / len;
    const normZ = dirZ / len;

    return {
        x: targetPos.x + normX * desiredDistance,
        y: 0,
        z: targetPos.z + normZ * desiredDistance,
    };
};

const applyMeleeDamage = (
    state: GameState,
    attacker: Unit,
    target: Unit | Building,
    baseDamage: number,
    dispatch: BufferedDispatch,
    now: number,
) => {
    let damageMultiplier = 1.0;
    let damageType: FloatingText['resourceType'] = 'DAMAGE';

    if (attacker.type === GameObjectType.UNIT && target.type === GameObjectType.UNIT) {
        const attackerType = attacker.unitType;
        const defenderType = target.unitType;
        if (attackerType === UnitType.INFANTRY && defenderType === UnitType.CAVALRY) { damageMultiplier = 1.5; damageType = 'BONUS_DAMAGE'; }
        else if (attackerType === UnitType.CAVALRY && defenderType === UnitType.ARCHER) { damageMultiplier = 1.5; damageType = 'BONUS_DAMAGE'; }
        else if (attackerType === UnitType.ARCHER && defenderType === UnitType.INFANTRY) { damageMultiplier = 1.5; damageType = 'BONUS_DAMAGE'; }
        else if (defenderType === UnitType.CATAPULT) { damageMultiplier = 1.2; damageType = 'BONUS_DAMAGE'; }
    }

    const targetOwner = target.playerId !== undefined ? state.players[target.playerId] : undefined;
    const targetResearch = targetOwner?.research;
    const finalDamage = baseDamage * damageMultiplier;
    const defenseBonus = targetResearch ? getDefenseBonus(target, targetResearch) : 0;
    const finalDefense = target.defense + defenseBonus;
    const damageDealt = Math.max(1, finalDamage - finalDefense);

    if (target.type === GameObjectType.BUILDING) {
        dispatch({ type: 'UPDATE_BUILDING', payload: { id: target.id, hp: target.hp - damageDealt } });
    } else {
        dispatch({ type: 'UPDATE_UNIT', payload: { id: target.id, hp: target.hp - damageDealt } });
        registerThreat(state, dispatch, target, attacker.id, now);
    }

    dispatch({
        type: 'ADD_FLOATING_TEXT',
        payload: {
            id: uuidv4(),
            text: `-${Math.floor(damageDealt)}`,
            resourceType: damageType,
            position: { x: target.position.x, y: 2.5, z: target.position.z },
            startTime: Date.now()
        }
    });
};

const spawnProjectile = (
    attacker: Unit,
    target: Unit | Building,
    weapon: WeaponProfile,
    baseDamage: number,
    dispatch: BufferedDispatch
) => {
    const height = weapon.arc ? 0.6 : 1.4;
    const projectilePosition = { x: attacker.position.x, y: height, z: attacker.position.z };
    const projectile: Projectile = {
        id: uuidv4(),
        type: GameObjectType.PROJECTILE,
        sourceId: attacker.id,
        targetId: target.id,
        position: projectilePosition,
        playerId: attacker.playerId,
        speed: weapon.projectileSpeed ?? 25,
        damage: baseDamage,
    };

    if (weapon.arc) {
        projectile.isArcing = true;
        projectile.initialPosition = { ...projectilePosition };
        projectile.targetLastPosition = { x: target.position.x, y: target.position.y, z: target.position.z };
    }

    if (weapon.aoeRadius) projectile.aoeRadius = weapon.aoeRadius;
    if (weapon.buildingDamageMultiplier) projectile.buildingDamageMultiplier = weapon.buildingDamageMultiplier;

    dispatch({ type: 'ADD_PROJECTILE', payload: projectile });
};

export const processCombatLogic = (state: GameState, delta: number, dispatch: BufferedDispatch) => {
    const { units, buildings, players } = state;
    const now = performance.now();

    const unitList = Object.values(units);
    const buildingList = Object.values(buildings);

    for (const unit of unitList) {
        if (unit.isDying || unit.attackDamage <= 0) continue;

        const owner = players[unit.playerId];
        if (!owner) continue;

        const behavior = getBehaviorProfile(unit);

        clearExpiredThreat(unit, now, dispatch);

        if (unit.attackCooldown && unit.attackCooldown > 0) {
            const nextCooldown = unit.attackCooldown - delta;
            dispatch({
                type: 'UPDATE_UNIT',
                payload: { id: unit.id, attackCooldown: nextCooldown > 0 ? nextCooldown : undefined },
            });
        }

        if (unit.acquisitionCooldown && unit.acquisitionCooldown > 0) {
            const nextAcquisition = unit.acquisitionCooldown - delta;
            dispatch({
                type: 'UPDATE_UNIT',
                payload: { id: unit.id, acquisitionCooldown: nextAcquisition > 0 ? nextAcquisition : undefined },
            });
        }

        const guardPosition = unit.guardPosition ?? unit.position;
        const guardReturnRadius = unit.guardReturnRadius ?? behavior.guardDistance;
        const guardReturnRadiusSq = guardReturnRadius * guardReturnRadius;
        let pursuitDistance = unit.guardPursuitRadius ?? behavior.pursuitDistance;
        if (unit.currentOrder?.type === UnitOrderType.HOLD_POSITION) {
            pursuitDistance = Math.min(
                pursuitDistance,
                Math.max(preferredDistance, unit.attackRange + attackerRadius + targetRadius * 0.5),
            );
        } else if (unit.currentOrder?.type === UnitOrderType.ATTACK_MOVE || unit.patrolRoute) {
            pursuitDistance = Math.max(
                pursuitDistance,
                unit.attackRange + attackerRadius + targetRadius + 6,
            );
        }
        const pursuitDistanceSq = pursuitDistance * pursuitDistance;

        const distFromGuardSq = distanceSqXZ(unit.position, guardPosition);

        if (unit.isReturningToGuard) {
            if (distFromGuardSq <= Math.max(guardReturnRadiusSq * 0.36, 0.5)) {
                dispatch({
                    type: 'UPDATE_UNIT',
                    payload: {
                        id: unit.id,
                        isReturningToGuard: false,
                        status: UnitStatus.IDLE,
                        targetId: undefined,
                        targetPosition: undefined,
                        path: undefined,
                        pathIndex: undefined,
                        pathTarget: undefined,
                    },
                });
            } else {
                continue;
            }
        }

        let desiredTarget: Unit | Building | undefined;

        if (unit.threatTargetId) {
            const threatTarget = units[unit.threatTargetId] || buildings[unit.threatTargetId];
            if (
                threatTarget &&
                threatTarget.hp > 0 &&
                threatTarget.playerId !== undefined &&
                arePlayersHostile(owner, players[threatTarget.playerId])
            ) {
                desiredTarget = threatTarget;
            } else {
                dispatch({
                    type: 'UPDATE_UNIT',
                    payload: {
                        id: unit.id,
                        threatTargetId: undefined,
                        threatExpireAt: undefined,
                        recentAttackerId: undefined,
                    },
                });
            }
        }

        const acquisitionCooldown = unit.acquisitionCooldown ?? 0;
        const detectionRadius =
            unit.stance === UnitStance.HOLD_GROUND
                ? Math.max(unit.attackRange + 0.75, guardReturnRadius)
                : Math.max(behavior.acquisitionRange, guardReturnRadius);
        const detectionRadiusSq = detectionRadius * detectionRadius;

        if (!desiredTarget && acquisitionCooldown <= 0) {
            let closestEnemy: Unit | Building | undefined;
            let closestDistSq = Infinity;
            const preferredId = unit.recentAttackerId;

            for (const enemy of unitList) {
                if (enemy.playerId === unit.playerId) continue;
                if (!arePlayersHostile(owner, players[enemy.playerId])) continue;
                if (enemy.isDying || enemy.hp <= 0) continue;

                const distGuardSq = distanceSqXZ(guardPosition, enemy.position);
                if (distGuardSq > detectionRadiusSq) continue;

                if (preferredId && enemy.id === preferredId) {
                    closestEnemy = enemy;
                    break;
                }

                const distSq = distanceSqXZ(unit.position, enemy.position);
                if (distSq < closestDistSq) {
                    closestDistSq = distSq;
                    closestEnemy = enemy;
                }
            }

            if (!closestEnemy) {
                for (const building of buildingList) {
                    if (building.playerId === unit.playerId) continue;
                    if (!arePlayersHostile(owner, players[building.playerId])) continue;
                    if (building.hp <= 0 || building.constructionProgress !== undefined) continue;

                    const distGuardSq = distanceSqXZ(guardPosition, building.position);
                    if (distGuardSq > detectionRadiusSq) continue;

                    const distSq = distanceSqXZ(unit.position, building.position);
                    if (distSq < closestDistSq) {
                        closestDistSq = distSq;
                        closestEnemy = building;
                    }
                }
            }

            if (closestEnemy) {
                desiredTarget = closestEnemy;
                dispatch({
                    type: 'UPDATE_UNIT',
                    payload: {
                        id: unit.id,
                        threatTargetId: closestEnemy.id,
                        threatExpireAt: now + behavior.threatDecay * 1000,
                        lastThreatTime: now,
                    },
                });
            }
        }

        let activeTarget: Unit | Building | undefined;
        if (unit.targetId) {
            const current = units[unit.targetId] || buildings[unit.targetId];
            if (
                current &&
                current.hp > 0 &&
                current.playerId !== undefined &&
                arePlayersHostile(owner, players[current.playerId])
            ) {
                activeTarget = current;
            }
        }

        if (!activeTarget) {
            activeTarget = desiredTarget;
        }

        const finalDestination = unit.finalDestination;
        const hasPlayerDestination =
            finalDestination !== undefined &&
            (!activeTarget || distanceSqXZ(finalDestination, activeTarget.position) > 1);

        if (!activeTarget) {
            if (!hasPlayerDestination && distFromGuardSq > guardReturnRadiusSq * 0.81 && pursuitDistance > 0.01) {
                dispatch({
                    type: 'COMMAND_UNIT',
                    payload: {
                        unitId: unit.id,
                        orderType: UnitOrderType.MOVE,
                        targetPosition: guardPosition,
                        finalDestination: guardPosition,
                        squadId: AUTO_COMBAT_SQUAD_ID,
                    },
                });
                dispatch({
                    type: 'UPDATE_UNIT',
                    payload: {
                        id: unit.id,
                        isReturningToGuard: true,
                        threatTargetId: undefined,
                        threatExpireAt: undefined,
                        recentAttackerId: undefined,
                    },
                });
            }
            continue;
        }

        const weapon = getWeaponProfile(unit);
        const { attackerRadius, targetRadius, effectiveRange, preferredRange } = computeCombatRanges(unit, activeTarget, weapon);

        const targetPosition = activeTarget.position;
        const distanceToTargetSq = distanceSqXZ(unit.position, targetPosition);
        const preferredDistance = Math.max(
            preferredRange,
            targetRadius + attackerRadius + (weapon.style === 'projectile' ? 2.2 : 0.6),
        );
        const effectiveRangeSq = effectiveRange * effectiveRange;
        let inRange = distanceToTargetSq <= effectiveRangeSq;
        let needsSpacing = false;

        if (weapon.style === 'projectile') {
            const backOffDistance = Math.max(
                targetRadius + attackerRadius + 1.2,
                preferredDistance * 0.75,
            );
            const backOffDistanceSq = backOffDistance * backOffDistance;
            needsSpacing = distanceToTargetSq < backOffDistanceSq;
            if (needsSpacing) {
                inRange = false;
            }
        }

        const guardToTargetSq = distanceSqXZ(guardPosition, targetPosition);
        if (guardToTargetSq > pursuitDistanceSq && unit.stance !== UnitStance.HOLD_GROUND) {
            dispatch({
                type: 'UPDATE_UNIT',
                payload: {
                    id: unit.id,
                    threatTargetId: undefined,
                    threatExpireAt: undefined,
                    recentAttackerId: undefined,
                },
            });

            if (!hasPlayerDestination) {
                dispatch({
                    type: 'COMMAND_UNIT',
                    payload: {
                        unitId: unit.id,
                        orderType: UnitOrderType.MOVE,
                        targetPosition: guardPosition,
                        finalDestination: guardPosition,
                        squadId: AUTO_COMBAT_SQUAD_ID,
                    },
                });
                dispatch({
                    type: 'UPDATE_UNIT',
                    payload: {
                        id: unit.id,
                        isReturningToGuard: true,
                        targetId: undefined,
                        status: UnitStatus.MOVING,
                    },
                });
            }
            continue;
        }

        if (!inRange) {
            if (unit.stance === UnitStance.HOLD_GROUND) {
                continue;
            }

            const currentCommand = unit.pathTarget ?? unit.targetPosition ?? unit.interactionAnchor;
            const fallbackAnchor = unit.guardPosition ?? unit.finalDestination ?? undefined;
            let desiredAnchor: Vector3;

            if (activeTarget.type === GameObjectType.BUILDING) {
                if (weapon.style === 'projectile') {
                    const safeDistance = Math.max(
                        preferredDistance,
                        targetRadius + attackerRadius + 1.2,
                    );
                    desiredAnchor = computeProjectileAnchor(
                        unit,
                        activeTarget,
                        safeDistance,
                        fallbackAnchor,
                    );
                } else {
                    desiredAnchor = computeBuildingAnchor(unit, activeTarget as Building, preferredDistance);
                }
            } else if (weapon.style === 'projectile') {
                desiredAnchor = computeProjectileAnchor(unit, activeTarget, preferredDistance, fallbackAnchor);
            } else {
                desiredAnchor = targetPosition;
            }

            if (
                weapon.style === 'projectile' &&
                distanceSqXZ(desiredAnchor, targetPosition) <
                    Math.pow(targetRadius + attackerRadius + 0.8, 2)
            ) {
                desiredAnchor = computeProjectileAnchor(
                    unit,
                    activeTarget,
                    targetRadius + attackerRadius + 1.2,
                    fallbackAnchor,
                );
            }

            desiredAnchor = NavMeshManager.projectMove(unit.position, desiredAnchor);

            let shouldCommand = false;
            if (!currentCommand) {
                shouldCommand = true;
            } else {
                const dx = currentCommand.x - desiredAnchor.x;
                const dz = currentCommand.z - desiredAnchor.z;
                if (dx * dx + dz * dz > 0.8) {
                    shouldCommand = true;
                }
            }

            if (shouldCommand) {
                dispatch({
                    type: 'COMMAND_UNIT',
                    payload: {
                        unitId: unit.id,
                        orderType: UnitOrderType.ATTACK_TARGET,
                        targetId: activeTarget.id,
                        targetPosition: desiredAnchor,
                        finalDestination: desiredAnchor,
                        squadId: AUTO_COMBAT_SQUAD_ID,
                    },
                });
            }

            continue;
        }

        if (unit.targetPosition || unit.path) {
            dispatch({
                type: 'UPDATE_UNIT',
                payload: {
                    id: unit.id,
                    targetPosition: undefined,
                    path: undefined,
                    pathIndex: undefined,
                    pathTarget: undefined,
                },
            });
        }

        if (!unit.attackCooldown || unit.attackCooldown <= 0) {
            const baseDamage = unit.attackDamage + getAttackBonus(unit, owner.research);
            if (weapon.style === 'projectile') {
                spawnProjectile(unit, activeTarget, weapon, baseDamage, dispatch);
            } else {
                applyMeleeDamage(state, unit, activeTarget, baseDamage, dispatch, now);
            }

            const cooldownTime = 1 / Math.max(0.0001, unit.attackSpeed);
            dispatch({
                type: 'UPDATE_UNIT',
                payload: { id: unit.id, attackCooldown: cooldownTime },
            });
        }
    }
};
