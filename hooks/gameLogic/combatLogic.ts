import * as THREE from 'three';
import { GameState, UnitStatus, Unit, GameObjectType, UnitStance, Building, FloatingText, UnitType } from '../../types';
import { UNIT_CONFIG, arePlayersHostile, getAttackBonus, getDefenseBonus, getBuildingCollisionMask } from '../../constants';
import { v4 as uuidv4 } from 'uuid';
import { BufferedDispatch } from '../../state/batch';

export const processCombatLogic = (state: GameState, delta: number, dispatch: BufferedDispatch) => {
    const { units, buildings, players } = state;

    for (const unit of Object.values(units)) {
        if (unit.isDying) continue;
        if (unit.attackDamage === 0) continue; // Workers don't fight.

        const owner = players[unit.playerId];
        const unitVec = new THREE.Vector3(unit.position.x, 0, unit.position.z);
        const aggroRangeSq = (UNIT_CONFIG[unit.unitType].aggroRange || 5) ** 2;

        // --- Attack Cooldown ---
        if (unit.attackCooldown && unit.attackCooldown > 0) {
            const newCooldown = unit.attackCooldown - delta;
            dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, attackCooldown: newCooldown > 0 ? newCooldown : undefined } });
        }

        // --- Target Acquisition (for idle aggressive units) ---
        if (unit.status === UnitStatus.IDLE && unit.stance === UnitStance.AGGRESSIVE) {
            let closestEnemy: Unit | Building | null = null;
            let minDistanceSq = aggroRangeSq;

            const potentialTargets = [...Object.values(units), ...Object.values(buildings)];
            for (const target of potentialTargets) {
                if (target.id === unit.id || (target as Unit).isDying) continue;
                if (target.playerId !== undefined && arePlayersHostile(owner, players[target.playerId])) {
                    if (target.hp > 0) {
                        const targetVec = new THREE.Vector3(target.position.x, 0, target.position.z);
                        const distanceSq = unitVec.distanceToSquared(targetVec);
                        if (distanceSq < minDistanceSq) {
                            minDistanceSq = distanceSq;
                            closestEnemy = target;
                        }
                    }
                }
            }
            if (closestEnemy) {
                // Use COMMAND_UNIT to trigger pathfinding
                dispatch({ type: 'COMMAND_UNIT', payload: { unitId: unit.id, targetPosition: closestEnemy.position, targetId: closestEnemy.id, finalDestination: closestEnemy.position } });
            }
        }
        
        // --- Attacking Logic ---
        if (unit.status === UnitStatus.ATTACKING && unit.targetId) {
            const target = units[unit.targetId] || buildings[unit.targetId];

            // Validate target
            if (!target || target.hp <= 0 || (target as Unit).isDying || !arePlayersHostile(owner, players[target.playerId!])) {
                dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, status: UnitStatus.IDLE, targetId: undefined, targetPosition: undefined } });
                continue;
            }

            const targetVec = new THREE.Vector3(target.position.x, 0, target.position.z);
            const distanceSq = unitVec.distanceToSquared(targetVec);
            
            let effectiveAttackRange = unit.attackRange;
            if (target.type === GameObjectType.BUILDING) {
                const buildingSize = getBuildingCollisionMask(target.buildingType);
                // Use half of the largest dimension as a pseudo-radius
                const buildingRadius = Math.max(buildingSize.width, buildingSize.depth) / 2;
                effectiveAttackRange += buildingRadius;
            }
            const attackRangeSq = effectiveAttackRange ** 2;


            if (distanceSq <= attackRangeSq) {
                // In range, stop moving
                if (unit.targetPosition || unit.path) {
                    dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, targetPosition: undefined, path: undefined, pathIndex: undefined, pathTarget: undefined } });
                }

                // Attack if cooldown is ready
                if (!unit.attackCooldown || unit.attackCooldown <= 0) {
                    const targetOwner = players[target.playerId!];
                    let damageMultiplier = 1.0;
                    let damageType: FloatingText['resourceType'] = 'DAMAGE';

                    // Simplified type advantage logic
                    if (unit.type === GameObjectType.UNIT && target.type === GameObjectType.UNIT) {
                        const attackerType = unit.unitType;
                        const defenderType = target.unitType;
                        if (attackerType === UnitType.INFANTRY && defenderType === UnitType.CAVALRY) { damageMultiplier = 1.5; damageType = 'BONUS_DAMAGE'; }
                        if (attackerType === UnitType.CAVALRY && defenderType === UnitType.ARCHER) { damageMultiplier = 1.5; damageType = 'BONUS_DAMAGE'; }
                        if (attackerType === UnitType.ARCHER && defenderType === UnitType.INFANTRY) { damageMultiplier = 1.5; damageType = 'BONUS_DAMAGE'; }
                    }

                    const attackBonus = getAttackBonus(unit, owner.research);
                    const finalDamage = (unit.attackDamage + attackBonus) * damageMultiplier;
                    const defenseBonus = getDefenseBonus(target, targetOwner.research);
                    const finalDefense = target.defense + defenseBonus;
                    const damageDealt = Math.max(1, finalDamage - finalDefense);

                    if (target.type === GameObjectType.BUILDING) {
                        dispatch({ type: 'UPDATE_BUILDING', payload: { id: target.id, hp: target.hp - damageDealt } });
                    } else {
                        dispatch({ type: 'UPDATE_UNIT', payload: { id: target.id, hp: target.hp - damageDealt } });
                    }
                    
                    dispatch({ type: 'ADD_FLOATING_TEXT', payload: {
                        id: uuidv4(), text: `-${Math.floor(damageDealt)}`, resourceType: damageType,
                        position: { x: target.position.x, y: 2.5, z: target.position.z }, startTime: Date.now()
                    }});
                    
                    // Reset cooldown
                    const cooldownTime = 1 / unit.attackSpeed;
                    dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, attackCooldown: cooldownTime } });
                }
            } else {
                // Out of range, chase target
                // We must use COMMAND_UNIT to pathfind.
                // Re-issue the command only if the target has moved significantly to prevent spamming path requests.
                const currentTargetPos = unit.pathTarget || unit.targetPosition;
                if (!currentTargetPos || new THREE.Vector3(currentTargetPos.x, 0, currentTargetPos.z).distanceToSquared(targetVec) > 2*2) {
                     dispatch({ type: 'COMMAND_UNIT', payload: { unitId: unit.id, targetPosition: target.position, targetId: target.id } });
                }
            }
        }
    }
};