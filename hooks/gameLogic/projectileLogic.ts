import * as THREE from 'three';
import { GameState, Action, GameObjectType, Unit, Building, Vector3, FloatingText, UnitType } from '../../types';
import { v4 as uuidv4 } from 'uuid';
import { getDefenseBonus, arePlayersHostile, getBuildingCollisionMask } from '../../constants';
import { SpatialHash } from '../utils/spatial';
import { BufferedDispatch } from '../../state/batch';
import { registerThreat } from './threatSystem';

export const processProjectileLogic = (state: GameState, delta: number, dispatch: BufferedDispatch) => {
    const { projectiles, units, buildings } = state;
    if (!projectiles) return;

    const now = performance.now();

    const targetGrid = new SpatialHash(5); // Cell size of 5 for efficient querying
    Object.values(units).forEach(u => targetGrid.insert(u.id, u.position.x, u.position.z));
    Object.values(buildings).forEach(b => targetGrid.insert(b.id, b.position.x, b.position.z));


    Object.values(projectiles).forEach(p => {
        const owner = state.players[p.playerId];
        let target: Unit | Building | null = units[p.targetId] || buildings[p.targetId];
        let targetPosition: Vector3;

        // For catapult shells, if the target is dead or gone, aim for its last known position.
        if (p.isArcing && (!target || target.hp <= 0)) {
            if (!p.targetLastPosition) {
                // This shouldn't happen if created correctly, but as a fallback:
                dispatch({ type: 'REMOVE_PROJECTILE', payload: p.id });
                return;
            }
            targetPosition = p.targetLastPosition;
            target = null; // Clear the target reference so we don't try to damage it directly
        } else {
            // For other projectiles or live targets:
            if (!target || target.hp <= 0 || !arePlayersHostile(owner, state.players[target.playerId])) {
                dispatch({ type: 'REMOVE_PROJECTILE', payload: p.id });
                return;
            }
            targetPosition = target.position;
        }

        const projectileVec = new THREE.Vector3(p.position.x, p.position.y, p.position.z);
        const targetVec = new THREE.Vector3(targetPosition.x, (target?.type === GameObjectType.UNIT ? 1 : 1.5) + targetPosition.y, targetPosition.z);


        const direction = new THREE.Vector3().subVectors(targetVec, projectileVec);
        const distanceToTarget = direction.length();
        const moveDistance = p.speed * delta;

        if (distanceToTarget <= moveDistance) { // Impact
            const impactPosition = targetPosition; // The place where the projectile lands
            const source = state.units[p.sourceId] || state.buildings[p.sourceId];

            // If target is still alive and it's a direct hit
            if (target) {
                let damageMultiplier = 1.0;
                let damageType: FloatingText['resourceType'] = 'DAMAGE';

                if (source && source.type === GameObjectType.UNIT && target.type === GameObjectType.UNIT) {
                    const attackerType = (source as Unit).unitType;
                    const defenderType = (target as Unit).unitType;

                    // Archer
                    if (attackerType === UnitType.ARCHER) {
                        if (defenderType === UnitType.CATAPULT) {
                            damageMultiplier = 1.5; damageType = 'BONUS_DAMAGE';
                        } else if (defenderType === UnitType.INFANTRY || defenderType === UnitType.CAVALRY) {
                            damageMultiplier = 0.75; damageType = 'RESIST_DAMAGE';
                        }
                    } 
                    // Catapult
                    else if (attackerType === UnitType.CATAPULT) {
                        if (defenderType === UnitType.INFANTRY) {
                            damageMultiplier = 1.5; damageType = 'BONUS_DAMAGE';
                        } else if (defenderType === UnitType.ARCHER || defenderType === UnitType.CAVALRY) {
                            damageMultiplier = 0.75; damageType = 'RESIST_DAMAGE';
                        }
                    }
                }

                const targetOwner = state.players[target.playerId];
                let finalDamage = p.damage * damageMultiplier;

                if (target.type === GameObjectType.BUILDING && p.buildingDamageMultiplier) {
                    finalDamage *= p.buildingDamageMultiplier;
                }
                const finalDefense = target.defense + getDefenseBonus(target, targetOwner.research);
                const damageDealt = Math.max(1, finalDamage - finalDefense);

                if (target.type === GameObjectType.BUILDING) {
                    dispatch({ type: 'UPDATE_BUILDING', payload: { id: target.id, hp: target.hp - damageDealt } });
                } else {
                    dispatch({ type: 'UPDATE_UNIT', payload: { id: target.id, hp: target.hp - damageDealt } });
                    registerThreat(state, dispatch, target as Unit, p.sourceId, now);
                }
                dispatch({ type: 'ADD_FLOATING_TEXT', payload: {
                    id: uuidv4(), text: `-${Math.floor(damageDealt)}`, resourceType: damageType,
                    position: { x: target.position.x, y: 2.5, z: target.position.z }, startTime: Date.now()
                }});
            }

            // Handle Area of Effect (AoE) damage
            if (p.aoeRadius && p.aoeRadius > 0) {
                dispatch({ type: 'ADD_EXPLOSION_MARKER', payload: {
                    id: uuidv4(), position: impactPosition, startTime: Date.now(), radius: p.aoeRadius
                }});

                const splashDamage = p.damage * 0.5; // Splash damage is 50% of main damage
                
                const potentialTargets = targetGrid.queryNeighbors(impactPosition.x, impactPosition.z);

                for(const targetId of potentialTargets) {
                    const unit = units[targetId];
                    if (unit) {
                        const unitOwner = state.players[unit.playerId];
                        if (unit.id !== p.targetId && arePlayersHostile(owner, unitOwner) && unit.hp > 0) {
                            const unitPos = new THREE.Vector3(unit.position.x, 0, unit.position.z);
                            const distanceSq = unitPos.distanceToSquared(new THREE.Vector3(impactPosition.x, 0, impactPosition.z));
                            if (distanceSq < p.aoeRadius! * p.aoeRadius!) {
                                let splashMultiplier = 1.0;
                                let damageType: FloatingText['resourceType'] = 'DAMAGE';
                                if (source && source.type === GameObjectType.UNIT && (source as Unit).unitType === UnitType.CATAPULT) {
                                    const defenderType = unit.unitType;
                                    if (defenderType === UnitType.INFANTRY) {
                                        splashMultiplier = 1.5; damageType = 'BONUS_DAMAGE';
                                    } else if (defenderType === UnitType.ARCHER || defenderType === UnitType.CAVALRY) {
                                        splashMultiplier = 0.75; damageType = 'RESIST_DAMAGE';
                                    }
                                }
    
                                const finalSplashDamage = splashDamage * splashMultiplier;
                                const finalDefense = unit.defense + getDefenseBonus(unit, unitOwner.research);
                                const aoeDamage = Math.max(1, finalSplashDamage - finalDefense);
                                dispatch({ type: 'UPDATE_UNIT', payload: { id: unit.id, hp: unit.hp - aoeDamage } });
                                registerThreat(state, dispatch, unit, p.sourceId, now);
                                dispatch({ type: 'ADD_FLOATING_TEXT', payload: {
                                    id: uuidv4(), text: `-${Math.floor(aoeDamage)}`, resourceType: damageType,
                                    position: { x: unit.position.x, y: 2.5, z: unit.position.z }, startTime: Date.now()
                                }});
                            }
                        }
                    } else {
                        const building = buildings[targetId];
                        if (building) {
                             const buildingOwner = state.players[building.playerId];
                            if (building.id !== p.targetId && arePlayersHostile(owner, buildingOwner) && building.hp > 0 && building.constructionProgress === undefined) {
                                const buildingSize = getBuildingCollisionMask(building.buildingType);
                                const buildingBox = { minX: building.position.x - buildingSize.width / 2, maxX: building.position.x + buildingSize.width / 2, minZ: building.position.z - buildingSize.depth / 2, maxZ: building.position.z + buildingSize.depth / 2 };
                                const circle = { x: impactPosition.x, z: impactPosition.z, radius: p.aoeRadius! };
                                
                                const closestX = Math.max(buildingBox.minX, Math.min(circle.x, buildingBox.maxX));
                                const closestZ = Math.max(buildingBox.minZ, Math.min(circle.z, buildingBox.maxZ));
                                const aoeDistX = circle.x - closestX;
                                const aoeDistZ = circle.z - closestZ;
        
                                if ((aoeDistX * aoeDistX + aoeDistZ * aoeDistZ) < (circle.radius * circle.radius)) {
                                     const splashWithBuildingMultiplier = (p.buildingDamageMultiplier || 1) * splashDamage;
                                     const finalDefense = building.defense + getDefenseBonus(building, buildingOwner.research);
                                     const aoeDamage = Math.max(1, splashWithBuildingMultiplier - finalDefense);
                                     dispatch({ type: 'UPDATE_BUILDING', payload: { id: building.id, hp: building.hp - aoeDamage } });
                                }
                            }
                        }
                    }
                }
            }
            
            dispatch({ type: 'REMOVE_PROJECTILE', payload: p.id });

        } else { // Move projectile
            let newPosition: THREE.Vector3;
            if (p.isArcing && p.initialPosition) {
                const initialPos = new THREE.Vector3(p.initialPosition.x, p.initialPosition.y, p.initialPosition.z);
                const totalDistVec = new THREE.Vector3().subVectors(targetVec, initialPos);
                totalDistVec.y = 0; // Project to 2D plane for progress calculation
                const totalDistance = totalDistVec.length();

                const currentDistVec = new THREE.Vector3().subVectors(projectileVec, initialPos);
                currentDistVec.y = 0;
                const currentDistance = currentDistVec.length();

                const progress = totalDistance > 0.1 ? Math.min(1.0, (currentDistance + moveDistance) / totalDistance) : 1.0;
                const maxHeight = totalDistance * 0.3; // Arc height is 30% of travel distance
                const arcHeight = 4 * maxHeight * progress * (1 - progress);
                
                const moveVec = direction.normalize().multiplyScalar(moveDistance);
                newPosition = projectileVec.clone().add(moveVec);
                
                newPosition.y = initialPos.y + (targetVec.y - initialPos.y) * progress + arcHeight;

            } else {
                const moveVec = direction.normalize().multiplyScalar(moveDistance);
                newPosition = projectileVec.clone().add(moveVec);
            }
            dispatch({ type: 'UPDATE_PROJECTILE', payload: { id: p.id, position: { x: newPosition.x, y: newPosition.y, z: newPosition.z } } });
        }
    });
};
