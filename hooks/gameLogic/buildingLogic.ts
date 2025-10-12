import * as THREE from 'three';
import { GameState, Action, UnitStatus, Unit, GameObjectType, UnitStance, UnitType, Building, ResearchCategory } from '../../types';
import { BUILDING_CONFIG, TRAINING_TIME, UNIT_CONFIG, COLLISION_DATA, RESEARCH_CONFIG, TOWER_UPGRADE_CONFIG, arePlayersHostile } from '../../constants';
import { v4 as uuidv4 } from 'uuid';
import { BufferedDispatch } from '../../state/batch';

export const processBuildingLogic = (state: GameState, delta: number, dispatch: BufferedDispatch) => {
    const { buildings, units } = state;
    if (!buildings || !units) return;

    Object.values(buildings).forEach(building => {
      // A building can only perform actions if it's not under construction or collapsing.
      if (building.constructionProgress !== undefined || building.isCollapsing) return;
      
      const owner = state.players[building.playerId];

      // --- Building Upgrade Logic ---
      if (building.upgradeTimer !== undefined) {
          const newUpgradeTimer = building.upgradeTimer + delta;
          const upgradeTime = TOWER_UPGRADE_CONFIG.time;

          if (newUpgradeTimer >= upgradeTime) {
                dispatch({
                    type: 'UPDATE_BUILDING',
                    payload: {
                        id: building.id,
                        isUpgraded: true,
                        upgradeProgress: 1,
                        upgradeTimer: undefined,
                        attackDamage: TOWER_UPGRADE_CONFIG.upgradedDamage,
                        attackSpeed: TOWER_UPGRADE_CONFIG.upgradedAttackSpeed,
                        attackRange: TOWER_UPGRADE_CONFIG.upgradedAttackRange,
                    }
                });
          } else {
             const progress = newUpgradeTimer / upgradeTime;
             dispatch({ type: 'UPDATE_BUILDING', payload: { id: building.id, upgradeProgress: progress, upgradeTimer: newUpgradeTimer } });
          }
          return; // Can't do anything else while upgrading
      }


      // --- Building Training Queue Logic ---
      if (building.trainingQueue.length > 0) {
          const queue = building.trainingQueue;
          const currentItem = queue[0];
          const trainingTime = TRAINING_TIME[currentItem.unitType] * 1000;
          const population = owner.population;

          // If population is capped, pause training by not incrementing progress.
          if (population.current < population.cap) {
            const newProgress = currentItem.progress + (delta * 1000);
            
            if (newProgress >= trainingTime) {
                 dispatch({ 
                    type: 'SPAWN_UNIT_FROM_QUEUE', 
                    payload: { 
                        buildingId: building.id, 
                        unitType: currentItem.unitType, 
                        playerId: building.playerId 
                    }
                });
            } else {
                dispatch({
                    type: 'UPDATE_TRAINING_PROGRESS',
                    payload: { buildingId: building.id, progress: newProgress }
                });
            }
          }
      }


      // --- Building Research Queue Logic ---
      if (building.researchQueue && building.researchQueue.length > 0) {
        const researchItem = building.researchQueue[0];
        const researchTime = RESEARCH_CONFIG[researchItem.type].time;
        
        const newProgress = researchItem.progress + delta;

        if (newProgress >= researchTime) {
            dispatch({ type: 'UPDATE_RESEARCH', payload: { playerId: building.playerId, researchType: researchItem.type }});
            const newQueue = building.researchQueue.slice(1);
            dispatch({ type: 'UPDATE_BUILDING', payload: { id: building.id, researchQueue: newQueue }});
        } else {
            const newQueue = [...building.researchQueue];
            newQueue[0] = {...researchItem, progress: newProgress};
            dispatch({ type: 'UPDATE_BUILDING', payload: {id: building.id, researchQueue: newQueue}});
        }
      }

    // --- Defensive Building Attack Logic ---
        if (!building.attackRange || !building.attackSpeed || !building.attackDamage) {
            return;
        }

        if (building.attackCooldown && building.attackCooldown > 0) {
            const newCooldown = building.attackCooldown - delta;
            dispatch({ type: 'UPDATE_BUILDING', payload: { id: building.id, attackCooldown: newCooldown > 0 ? newCooldown : undefined } });
            return;
        }

        let currentTarget = building.targetId ? state.units[building.targetId] : null;

        if (currentTarget) {
            const buildingPos = new THREE.Vector3(building.position.x, 0, building.position.z);
            const targetPos = new THREE.Vector3(currentTarget.position.x, 0, currentTarget.position.z);
            if (currentTarget.hp <= 0 || currentTarget.isDying || buildingPos.distanceTo(targetPos) > building.attackRange) {
                currentTarget = null;
                dispatch({ type: 'UPDATE_BUILDING', payload: { id: building.id, targetId: undefined } });
            }
        }

        if (!currentTarget) {
            let closestEnemy: Unit | null = null;
            let minDistanceSq = building.attackRange * building.attackRange;
            const buildingPos = new THREE.Vector3(building.position.x, 0, building.position.z);

            for (const unit of Object.values(units)) {
                if (arePlayersHostile(owner, state.players[unit.playerId]) && unit.hp > 0 && !unit.isDying) {
                    const unitPos = new THREE.Vector3(unit.position.x, 0, unit.position.z);
                    const distanceSq = buildingPos.distanceToSquared(unitPos);
                    if (distanceSq < minDistanceSq) {
                        minDistanceSq = distanceSq;
                        closestEnemy = unit;
                    }
                }
            }
            if (closestEnemy) {
                dispatch({ type: 'UPDATE_BUILDING', payload: { id: building.id, targetId: closestEnemy.id } });
                currentTarget = closestEnemy;
            }
        }

        if (currentTarget && !building.attackCooldown) {
            const cooldownTime = 1 / building.attackSpeed;
            const buildingResearch = owner.research;
            const attackBonusConfig = RESEARCH_CONFIG[ResearchCategory.BUILDING_ATTACK];
            const attackBonus = building.attackDamage * (buildingResearch[ResearchCategory.BUILDING_ATTACK] * attackBonusConfig.bonus);
            const finalDamage = building.attackDamage + attackBonus;

            const isUpgradedTower = building.buildingType === 'DEFENSIVE_TOWER' && building.isUpgraded;

            dispatch({
                type: 'ADD_PROJECTILE',
                payload: {
                    id: uuidv4(),
                    type: GameObjectType.PROJECTILE,
                    sourceId: building.id,
                    position: { x: building.position.x, y: 3.5, z: building.position.z },
                    targetId: currentTarget.id,
                    targetLastPosition: isUpgradedTower ? currentTarget.position : undefined,
                    speed: isUpgradedTower ? 15 : 25,
                    damage: finalDamage,
                    playerId: building.playerId,
                    aoeRadius: isUpgradedTower ? 3 : undefined,
                    buildingDamageMultiplier: isUpgradedTower ? 1.5 : undefined, // Upgraded does more splash, less direct
                    isArcing: isUpgradedTower,
                    initialPosition: isUpgradedTower ? { x: building.position.x, y: 3.5, z: building.position.z } : undefined,
                }
            });
            dispatch({ type: 'UPDATE_BUILDING', payload: { id: building.id, attackCooldown: cooldownTime } });
        }
    });
};
