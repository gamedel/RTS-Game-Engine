import * as THREE from 'three';
import { GameState, UnitStatus, Unit, GameObjectType, UnitStance, Building, FloatingText, UnitType, Projectile, ResearchState } from '../../types';
import { UNIT_CONFIG, COLLISION_DATA, arePlayersHostile, getAttackBonus, getDefenseBonus, getBuildingCollisionMask } from '../../constants';
import { v4 as uuidv4 } from 'uuid';
import { BufferedDispatch } from '../../state/batch';

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

const scratchUnitVec = new THREE.Vector3();
const scratchTargetVec = new THREE.Vector3();
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

const applyMeleeDamage = (
    attacker: Unit,
    target: Unit | Building,
    baseDamage: number,
    targetOwnerResearch: ResearchState,
    dispatch: BufferedDispatch,
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

    const finalDamage = baseDamage * damageMultiplier;
    const defenseBonus = getDefenseBonus(target, targetOwnerResearch);
    const finalDefense = target.defense + defenseBonus;
    const damageDealt = Math.max(1, finalDamage - finalDefense);

    if (target.type === GameObjectType.BUILDING) {
        dispatch({ type: 'UPDATE_BUILDING', payload: { id: target.id, hp: target.hp - damageDealt } });
    } else {
        dispatch({ type: 'UPDATE_UNIT', payload: { id: target.id, hp: target.hp - damageDealt } });
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

    for (const unit of Object.values(units)) {
        if (unit.isDying || unit.attackDamage === 0) continue;

        const owner = players[unit.playerId];
        if (!owner) continue;

        const aggroRangeSq = (UNIT_CONFIG[unit.unitType].aggroRange || 5) ** 2;
        scratchUnitVec.set(unit.position.x, 0, unit.position.z);

        if (unit.attackCooldown && unit.attackCooldown > 0) {
            const newCooldown = unit.attackCooldown - delta;
            dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, attackCooldown: newCooldown > 0 ? newCooldown : undefined } });
        }

        if (unit.status === UnitStatus.IDLE && unit.stance === UnitStance.AGGRESSIVE && aggroRangeSq > 0.01) {
            let closestEnemy: Unit | Building | null = null;
            let minDistanceSq = aggroRangeSq;

            const potentialTargets = [...Object.values(units), ...Object.values(buildings)];
            for (const target of potentialTargets) {
                if (target.id === unit.id || (target as Unit).isDying) continue;
                if (target.playerId === undefined) continue;
                if (!arePlayersHostile(owner, players[target.playerId])) continue;
                if (target.hp <= 0) continue;

                scratchTargetVec.set(target.position.x, 0, target.position.z);
                const distanceSq = scratchUnitVec.distanceToSquared(scratchTargetVec);
                if (distanceSq < minDistanceSq) {
                    minDistanceSq = distanceSq;
                    closestEnemy = target;
                }
            }

            if (closestEnemy) {
                dispatch({
                    type: 'COMMAND_UNIT',
                    payload: {
                        unitId: unit.id,
                        targetPosition: closestEnemy.position,
                        targetId: closestEnemy.id,
                        finalDestination: closestEnemy.position
                    }
                });
            }
        }

        if (unit.status !== UnitStatus.ATTACKING || !unit.targetId) continue;

        const target = units[unit.targetId] || buildings[unit.targetId];
        if (!target || target.hp <= 0 || (target as Unit).isDying) {
            dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, status: UnitStatus.IDLE, targetId: undefined, targetPosition: undefined } });
            continue;
        }
        if (target.playerId === undefined || !arePlayersHostile(owner, players[target.playerId])) {
            dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, status: UnitStatus.IDLE, targetId: undefined, targetPosition: undefined } });
            continue;
        }

        const weapon = getWeaponProfile(unit);
        const { attackerRadius, targetRadius, effectiveRange, preferredRange } = computeCombatRanges(unit, target, weapon);
        const effectiveRangeSq = effectiveRange * effectiveRange;

        scratchTargetVec.set(target.position.x, 0, target.position.z);
        scratchAuxVec.copy(scratchUnitVec).sub(scratchTargetVec);
        const distanceSq = scratchAuxVec.lengthSq();

        let inRange = distanceSq <= effectiveRangeSq;
        if (!inRange && unit.interactionAnchor) {
            const anchorDx = unit.position.x - unit.interactionAnchor.x;
            const anchorDz = unit.position.z - unit.interactionAnchor.z;
            const anchorTolerance = attackerRadius + 0.9;
            if ((anchorDx * anchorDx + anchorDz * anchorDz) <= anchorTolerance * anchorTolerance) {
                inRange = true;
            }
        }

        if (inRange) {
            if (unit.targetPosition || unit.path) {
                dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, targetPosition: undefined, path: undefined, pathIndex: undefined, pathTarget: undefined } });
            }

            if (!unit.attackCooldown || unit.attackCooldown <= 0) {
                const baseDamage = unit.attackDamage + getAttackBonus(unit, owner.research);
                if (weapon.style === 'projectile') {
                    spawnProjectile(unit, target, weapon, baseDamage, dispatch);
                } else {
                    const targetOwner = players[target.playerId];
                    if (targetOwner) {
                        applyMeleeDamage(unit, target, baseDamage, targetOwner.research, dispatch);
                    }
                }

                const cooldownTime = 1 / Math.max(0.0001, unit.attackSpeed);
                dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, attackCooldown: cooldownTime } });
            }

            continue;
        }

        const currentCommandPos = unit.pathTarget || unit.targetPosition || unit.interactionAnchor;
        let shouldReissue = false;

        if (target.type === GameObjectType.BUILDING) {
            const desiredAnchor = computeBuildingAnchor(unit, target as Building, preferredRange);
            if (!currentCommandPos) {
                shouldReissue = true;
            } else {
                const dx = currentCommandPos.x - desiredAnchor.x;
                const dz = currentCommandPos.z - desiredAnchor.z;
                if ((dx * dx + dz * dz) > 1.5 * 1.5) {
                    shouldReissue = true;
                }
            }

            if (shouldReissue) {
                dispatch({
                    type: 'COMMAND_UNIT',
                    payload: {
                        unitId: unit.id,
                        targetId: target.id,
                        targetPosition: desiredAnchor,
                        finalDestination: target.position
                    }
                });
            }
        } else {
            if (!currentCommandPos) {
                shouldReissue = true;
            } else {
                const dx = currentCommandPos.x - target.position.x;
                const dz = currentCommandPos.z - target.position.z;
                if ((dx * dx + dz * dz) > 4) {
                    shouldReissue = true;
                }
            }

            if (shouldReissue) {
                dispatch({
                    type: 'COMMAND_UNIT',
                    payload: {
                        unitId: unit.id,
                        targetId: target.id,
                        targetPosition: target.position,
                        finalDestination: target.position
                    }
                });
            }
        }
    }
};
