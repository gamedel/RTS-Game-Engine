import * as THREE from 'three';
import { GameState, Action, UnitStatus, UnitType, BuildingType, Unit, Vector3, Building, ResourceNode, ResourceType, ResearchCategory, Player, AIState, UnitOrderType } from '../../types';
import { BUILDING_CONFIG, UNIT_CONFIG, RESEARCH_CONFIG, arePlayersHostile } from '../../constants';
import { checkPlacementCollision } from '../../components/game/scene/Ground';
import { BufferedDispatch } from '../../state/batch';

const AI_CHECK_INTERVAL = 2000;
const BUILD_PLACEMENT_RADIUS = 15;
const BUILD_PLACEMENT_ATTEMPTS = 20;
const AI_DEFENSE_RADIUS_SQ = 50 * 50;
const WORKER_BOOM_TARGET = 15;
const ARMY_STRENGTH_MULTIPLIER_RETREAT = 1.5;

const WAREHOUSE_EVAL_DISTANCE_SQ = 35 * 35;
const MIN_WORKERS_FOR_WAREHOUSE_CLUSTER = 3;
const WAREHOUSE_PROXIMITY_CHECK_SQ = 30 * 30;
const WORKER_FLEE_RANGE_SQ = 12 * 12;

// Copied from GameScene.tsx to be used by AI logic
const getFormationPositions = (center: Vector3, count: number): Vector3[] => {
    if (count <= 1) {
        return [center];
    }
    const positions: Vector3[] = [];
    const spacing = 2.5;
    let placedCount = 0;
    
    let rings = 0;
    let capacity = 0;
    while(capacity < count) {
        capacity += (rings === 0 ? 1 : Math.floor(2 * Math.PI * rings));
        rings++;
    }

    positions.push(center);
    placedCount++;

    for (let ring = 1; ring < rings && placedCount < count; ring++) {
        const numInRing = Math.min(count - placedCount, Math.floor(2 * Math.PI * ring * 1.5));
        const angleStep = (2 * Math.PI) / numInRing;
        for (let i = 0; i < numInRing && placedCount < count; i++) {
            const angle = angleStep * i + (ring % 2) * (angleStep / 2);
            positions.push({
                x: center.x + ring * spacing * Math.cos(angle),
                y: center.y,
                z: center.z + ring * spacing * Math.sin(angle),
            });
            placedCount++;
        }
    }
    return positions;
};

const findClosestTarget = <T extends Unit | Building | ResourceNode>(position: Vector3, targets: T[]): T | null => {
    let closestTarget: T | null = null;
    let minDistanceSq = Infinity;
    const sourcePos = new THREE.Vector3(position.x, 0, position.z);

    for (const target of targets) {
        if (!target) continue;
        const targetPos = new THREE.Vector3(target.position.x, 0, target.position.z);
        const distanceSq = sourcePos.distanceToSquared(targetPos);
        if (distanceSq < minDistanceSq) {
            minDistanceSq = distanceSq;
            closestTarget = target;
        }
    }
    return closestTarget;
};

const findBuildPlacement = (
    buildingType: BuildingType,
    center: Vector3,
    state: GameState,
    overrideRadius?: number
): Vector3 | null => {
    for (let i = 0; i < BUILD_PLACEMENT_ATTEMPTS; i++) {
        const angle = Math.random() * Math.PI * 2;
        const radius = overrideRadius
            ? overrideRadius / 2 + Math.random() * (overrideRadius / 2)
            : 5 + Math.random() * BUILD_PLACEMENT_RADIUS;

        const position = {
            x: center.x + Math.cos(angle) * radius,
            y: 0,
            z: center.z + Math.sin(angle) * radius,
        };

        const isColliding = checkPlacementCollision(
            position,
            buildingType,
            state.buildings,
            state.resourcesNodes,
            state.units
        );

        if (!isColliding) {
            return position;
        }
    }
    return null;
};


const calculateArmyStrength = (units: Unit[], research: GameState['players'][0]['research']) => {
    return units.reduce((strength, unit) => {
        let unitStrength = 0;
        let attackBonusFactor = 0;
        
        switch(unit.unitType) {
            case UnitType.INFANTRY:
                unitStrength = 1.2;
                attackBonusFactor = research[ResearchCategory.MELEE_ATTACK] * RESEARCH_CONFIG[ResearchCategory.MELEE_ATTACK].bonus;
                break;
            case UnitType.ARCHER:
                unitStrength = 1;
                attackBonusFactor = research[ResearchCategory.RANGED_ATTACK] * RESEARCH_CONFIG[ResearchCategory.RANGED_ATTACK].bonus;
                break;
            case UnitType.CAVALRY:
                unitStrength = 2.0;
                attackBonusFactor = research[ResearchCategory.MELEE_ATTACK] * RESEARCH_CONFIG[ResearchCategory.MELEE_ATTACK].bonus;
                break;
            case UnitType.CATAPULT:
                unitStrength = 3;
                attackBonusFactor = research[ResearchCategory.SIEGE_ATTACK] * RESEARCH_CONFIG[ResearchCategory.SIEGE_ATTACK].bonus;
                break;
        }
        
        return strength + (unitStrength * (1 + attackBonusFactor));
    }, 0);
};

const processSingleAiLogic = (
    state: GameState,
    delta: number,
    dispatch: BufferedDispatch,
    player: Player,
    aiState: AIState
) => {
    const now = Date.now();
    if (now - aiState.lastCheckTime < AI_CHECK_INTERVAL) {
        return;
    }
    aiState.lastCheckTime = now;

    // --- Difficulty-based parameters ---
    let armyStrengthMultiplierAttack: number;
    let resourceTickGold = 0;
    let resourceTickWood = 0;

    switch (aiState.difficulty) {
        case 'easy':
            armyStrengthMultiplierAttack = 2.0;
            break;
        case 'normal':
            armyStrengthMultiplierAttack = 1.3;
            break;
        case 'hard':
            armyStrengthMultiplierAttack = 1.0;
            resourceTickGold = 2; // per check interval (1/sec)
            resourceTickWood = 1; // per check interval (0.5/sec)
            break;
        case 'very_hard':
            armyStrengthMultiplierAttack = 0.8;
            resourceTickGold = 4;
            resourceTickWood = 2;
            break;
    }

    if (resourceTickGold > 0 || resourceTickWood > 0) {
        dispatch({ type: 'ADD_RESOURCES', payload: { playerId: player.id, gold: resourceTickGold, wood: resourceTickWood } });
    }

    const myUnits = Object.values(state.units).filter(u => u.playerId === player.id);
    const myBuildings = Object.values(state.buildings).filter(b => b.playerId === player.id);
    const myTownHall = myBuildings.find(b => b.buildingType === BuildingType.TOWN_HALL);
    
    // --- AI RECOVERY: Rebuild Town Hall ---
    if (!myTownHall) {
        const thConfig = BUILDING_CONFIG[BuildingType.TOWN_HALL];
        if (player.resources.gold >= thConfig.cost.gold && player.resources.wood >= thConfig.cost.wood) {
            const workers = myUnits.filter(u => u.unitType === UnitType.WORKER);
            const availableWorker = workers.find(w => w.status === UnitStatus.IDLE || w.status === UnitStatus.GATHERING);
            
            if (availableWorker) {
                // Find a safe spot, maybe near other buildings or a fallback position
                const buildCenter = myBuildings.length > 0 ? myBuildings[0].position : availableWorker.position;
                const placement = findBuildPlacement(BuildingType.TOWN_HALL, buildCenter, state);

                if (placement) {
                    dispatch({
                        type: 'COMMAND_BUILD',
                        payload: { workerIds: [availableWorker.id], type: BuildingType.TOWN_HALL, position: placement },
                    });
                    return; // This is the most important action for this cycle.
                }
            }
        }
    }

    const hostileUnits = Object.values(state.units).filter(u => arePlayersHostile(player, state.players[u.playerId]));
    const hostileBuildings = Object.values(state.buildings).filter(b => arePlayersHostile(player, state.players[b.playerId]));
    

    // --- 0. WORKER DEFENSE (Optimized) ---
    const hostileMilitary = hostileUnits.filter(u => u.unitType !== UnitType.WORKER);
    // Pre-filter threats to a manageable list. If there's no Town Hall, we can't define a "base", 
    // so we check against all threats, but this is a rare edge case.
    const threatsInBase = myTownHall 
        ? hostileMilitary.filter(u => 
            new THREE.Vector3(u.position.x, 0, u.position.z).distanceToSquared(new THREE.Vector3(myTownHall.position.x, 0, myTownHall.position.z)) < AI_DEFENSE_RADIUS_SQ
          ) 
        : hostileMilitary;

    if (threatsInBase.length > 0) {
        const workers = myUnits.filter(u => u.unitType === UnitType.WORKER && u.status !== UnitStatus.FLEEING);
        const myDropOffs = myBuildings.filter(b => b.buildingType === BuildingType.TOWN_HALL || b.buildingType === BuildingType.WAREHOUSE);
        
        if (myDropOffs.length > 0) {
            for (const worker of workers) {
                // Check only against the pre-filtered list of threats, which is much smaller.
                const closestThreat = findClosestTarget(worker.position, threatsInBase); 
                if (closestThreat && new THREE.Vector3(worker.position.x, 0, worker.position.z).distanceToSquared(new THREE.Vector3(closestThreat.position.x, 0, closestThreat.position.z)) < WORKER_FLEE_RANGE_SQ) {
                    const fleeTarget = findClosestTarget(worker.position, myDropOffs);
                    if (fleeTarget) {
                        dispatch({
                            type: 'COMMAND_UNIT',
                            payload: {
                                unitId: worker.id,
                                orderType: UnitOrderType.SMART,
                                targetPosition: fleeTarget.position,
                                targetId: fleeTarget.id,
                                finalDestination: fleeTarget.position,
                                source: 'ai',
                            },
                        });
                        dispatch({ type: 'UPDATE_UNIT', payload: { id: worker.id, status: UnitStatus.FLEEING } });
                    }
                }
            }
        }
    }

    // --- WORKER HARASSMENT RESPONSE ---
    const workersBeingAttacked = myUnits.filter(u => u.unitType === UnitType.WORKER && u.hp < u.maxHp);
    if (workersBeingAttacked.length > 0) {
        const firstAttackedWorker = workersBeingAttacked[0];
        const nearbyEnemies = hostileMilitary.filter(e => new THREE.Vector3(e.position.x, 0, e.position.z).distanceToSquared(new THREE.Vector3(firstAttackedWorker.position.x, 0, firstAttackedWorker.position.z)) < 15 * 15);

        if (nearbyEnemies.length > 0) {
            const threat = nearbyEnemies[0];
            const availableDefenders = myUnits.filter(u => u.unitType !== UnitType.WORKER && (u.status === UnitStatus.IDLE || (u.status === UnitStatus.MOVING && !u.targetId)));
            if (availableDefenders.length > 0) {
                const closestDefender = findClosestTarget(threat.position, availableDefenders);
                    if (closestDefender) {
                    dispatch({
                        type: 'COMMAND_UNIT',
                        payload: {
                            unitId: closestDefender.id,
                            orderType: UnitOrderType.ATTACK_TARGET,
                            targetId: threat.id,
                            targetPosition: threat.position,
                            finalDestination: threat.position,
                            source: 'ai',
                        },
                    });
                    return; // React to harassment and check again next cycle.
                }
            }
        }
    }


    // --- AUTO ENGAGE NEARBY ENEMIES ---
    const AUTO_ENGAGE_RADIUS_SQ = 18 * 18;
    const engageableCombatants = myUnits.filter(u =>
        u.unitType !== UnitType.WORKER &&
        !u.isDying &&
        u.hp > 0 &&
        u.status !== UnitStatus.FLEEING
    );
    let autoEngageIssued = 0;
    for (const unit of engageableCombatants) {
        if (autoEngageIssued >= 8) break;
        if (unit.status !== UnitStatus.IDLE && unit.status !== UnitStatus.MOVING) continue;
        const threat = findClosestTarget(unit.position, hostileMilitary);
        if (!threat) continue;
        const dx = unit.position.x - threat.position.x;
        const dz = unit.position.z - threat.position.z;
        if (dx * dx + dz * dz > AUTO_ENGAGE_RADIUS_SQ) continue;
        if (unit.targetId === threat.id || unit.currentOrder?.targetId === threat.id) continue;

        dispatch({
            type: 'COMMAND_UNIT',
            payload: {
                unitId: unit.id,
                orderType: UnitOrderType.ATTACK_TARGET,
                targetId: threat.id,
                targetPosition: threat.position,
                finalDestination: threat.position,
                source: 'ai',
            },
        });
        autoEngageIssued++;
    }


    // --- TACTICAL RETREAT ---
    // This should run regardless of attack state, if a wave is active.
    if (aiState.currentAttackWave.length > 0 && myTownHall) {
        const waveUnits = aiState.currentAttackWave.map(id => state.units[id]).filter(Boolean);
        
        if (waveUnits.length > 0) {
            const hostileArmy = hostileUnits.filter(u => u.unitType !== UnitType.WORKER);
            const totalHostileStrength = state.players.reduce((sum, p) => {
                if (arePlayersHostile(player, p)) {
                    return sum + calculateArmyStrength(hostileArmy.filter(u => u.playerId === p.id), p.research);
                }
                return sum;
            }, 0);
            const attackerStrength = calculateArmyStrength(waveUnits, player.research);
            
            if (totalHostileStrength > attackerStrength * ARMY_STRENGTH_MULTIPLIER_RETREAT) {
                waveUnits.forEach((unit: Unit) => {
                    // Command to retreat to the town hall
                    dispatch({
                        type: 'COMMAND_UNIT',
                        payload: {
                            unitId: unit.id,
                            orderType: UnitOrderType.MOVE,
                            targetPosition: myTownHall.position,
                            finalDestination: myTownHall.position,
                            source: 'ai',
                        },
                    });
                });
                // Reset AI attack state
                aiState.attackState = 'idle';
                aiState.currentAttackWave = [];
                aiState.attackRallyPoint = undefined;
                aiState.attackWaveCooldown = 60;
                return; // Critical: Stop further AI logic for this cycle after deciding to retreat.
            }
        }
    }

    // --- TOWER UPGRADE ---
    const upgradableTowers = myBuildings.filter(b => b.buildingType === BuildingType.DEFENSIVE_TOWER && !b.isUpgraded && b.constructionProgress === undefined && b.upgradeTimer === undefined);
    if (upgradableTowers.length > 0 && player.resources.gold > 400 && player.resources.wood > 400) {
        dispatch({ type: 'UPGRADE_TOWER', payload: { buildingId: upgradableTowers[0].id } });
        return;
    }


    // --- FINISH CONSTRUCTION ---
    const unfinishedBuildings = myBuildings.filter(b => b.constructionProgress !== undefined);
    if (unfinishedBuildings.length > 0) {
        const constructionSite = unfinishedBuildings[0];
        const assignedWorkers = myUnits.filter(u => u.buildTask?.buildingId === constructionSite.id).length;
        const neededWorkers = Math.max(0, 3 - assignedWorkers);

        if (neededWorkers > 0) {
            const availableWorkers = myUnits.filter(u => u.unitType === UnitType.WORKER && (u.status === UnitStatus.IDLE || u.status === UnitStatus.GATHERING));
            const workersToAssign = availableWorkers.slice(0, neededWorkers);

            if (workersToAssign.length > 0) {
                workersToAssign.forEach(worker => {
                    dispatch({
                        type: 'COMMAND_UNIT',
                        payload: {
                            unitId: worker.id,
                            orderType: UnitOrderType.SMART,
                            targetPosition: constructionSite.position,
                            targetId: constructionSite.id,
                            finalDestination: constructionSite.position,
                            source: 'ai',
                        }
                    });
                });
                return; // Prioritize finishing buildings
            }
        }
    }

    // --- DEFENSE ---
    if (myTownHall) {
        const myMilitary = myUnits.filter(u => u.unitType !== UnitType.WORKER);
        const threats = hostileUnits.filter(u => new THREE.Vector3(u.position.x, 0, u.position.z).distanceToSquared(new THREE.Vector3(myTownHall.position.x, 0, myTownHall.position.z)) < AI_DEFENSE_RADIUS_SQ);
        if (threats.length > 0 && myMilitary.length > 0) {
             const availableDefenders = myMilitary.filter(u => u.status === UnitStatus.IDLE || u.status === UnitStatus.MOVING);
            if(availableDefenders.length > 0) {
                 availableDefenders.forEach(defender => {
                    const closestThreat = findClosestTarget(defender.position, threats);
                    if (closestThreat && defender.targetId !== closestThreat.id) {
                        dispatch({
                            type: 'COMMAND_UNIT',
                            payload: {
                                unitId: defender.id,
                                orderType: UnitOrderType.ATTACK_TARGET,
                                targetPosition: closestThreat.position,
                                targetId: closestThreat.id,
                                finalDestination: closestThreat.position,
                                source: 'ai',
                            },
                        });
                    }
                });
                return;
            }
        }
    }


    // --- IDLE WORKERS (ECONOMIC MANAGEMENT) ---
    const idleWorkers = myUnits.filter(w => w.unitType === UnitType.WORKER && w.status === UnitStatus.IDLE);
    if (idleWorkers.length > 0) {
        const trees = Object.values(state.resourcesNodes).filter(r => r.resourceType === ResourceType.TREE && r.amount > 0 && !r.isFalling);
        const goldMines = Object.values(state.resourcesNodes).filter(r => r.resourceType === ResourceType.GOLD_MINE && r.amount > 0);
        
        const woodWorkers = myUnits.filter(u => u.unitType === UnitType.WORKER && (u.harvestingResourceType === ResourceType.TREE || u.resourcePayload?.type === 'WOOD')).length;
        const goldWorkers = myUnits.filter(u => u.unitType === UnitType.WORKER && (u.harvestingResourceType === ResourceType.GOLD_MINE || u.resourcePayload?.type === 'GOLD')).length;

        idleWorkers.forEach(worker => {
            let targetResource: ResourceNode | null = null;

            if (worker.isHarvesting && worker.harvestingResourceType) {
                const potentialTargets = worker.harvestingResourceType === ResourceType.TREE ? trees : goldMines;
                targetResource = findClosestTarget(worker.position, potentialTargets);
            }

            if (!targetResource) {
                 if (player.resources.wood < player.resources.gold || woodWorkers <= goldWorkers) {
                    if(trees.length > 0) targetResource = findClosestTarget(worker.position, trees);
                    else if(goldMines.length > 0) targetResource = findClosestTarget(worker.position, goldMines);
                } else {
                    if(goldMines.length > 0) targetResource = findClosestTarget(worker.position, goldMines);
                    else if(trees.length > 0) targetResource = findClosestTarget(worker.position, trees);
                }
            }
            
            if (targetResource) {
                dispatch({
                    type: 'COMMAND_UNIT',
                    payload: {
                        unitId: worker.id,
                        orderType: UnitOrderType.SMART,
                        targetPosition: targetResource.position,
                        targetId: targetResource.id,
                        finalDestination: targetResource.position,
                        source: 'ai',
                    },
                });
            }
        });
    }

    // --- STRATEGY & EXECUTION (Requires a Town Hall) ---
    if (!myTownHall) return;

    const myWorkerCount = myUnits.filter(u => u.unitType === UnitType.WORKER).length;
    const myBarracksCount = myBuildings.filter(b => b.buildingType === BuildingType.BARRACKS).length;
    const researchCenter = myBuildings.find(b => b.buildingType === BuildingType.RESEARCH_CENTER && b.constructionProgress === undefined);
    const { gold, wood } = player.resources;
    const myArmy = myUnits.filter(u => u.unitType !== UnitType.WORKER);
    const infantryCount = myArmy.filter(u => u.unitType === UnitType.INFANTRY).length;
    const archerCount = myArmy.filter(u => u.unitType === UnitType.ARCHER).length;

    // --- WAREHOUSE MANAGEMENT ---
    let warehouseNeededAt: Vector3 | null = null;
    const workersGathering = myUnits.filter(u => u.status === UnitStatus.GATHERING && u.targetId);

    if (workersGathering.length >= MIN_WORKERS_FOR_WAREHOUSE_CLUSTER) {
        const resourceTargetCounts: Record<string, number> = {};
        workersGathering.forEach(worker => {
            if (worker.targetId) {
                resourceTargetCounts[worker.targetId] = (resourceTargetCounts[worker.targetId] || 0) + 1;
            }
        });

        let mainClusterResourceId: string | null = null;
        let maxWorkers = 0;
        for (const resourceId in resourceTargetCounts) {
            if (resourceTargetCounts[resourceId] > maxWorkers) {
                maxWorkers = resourceTargetCounts[resourceId];
                mainClusterResourceId = resourceId;
            }
        }
        
        if (mainClusterResourceId && maxWorkers >= MIN_WORKERS_FOR_WAREHOUSE_CLUSTER) {
            const clusterResource = state.resourcesNodes[mainClusterResourceId];
            const clusterCenterVec = new THREE.Vector3(clusterResource.position.x, 0, clusterResource.position.z);
            
            const myDropOffs = myBuildings.filter(b => (b.buildingType === BuildingType.TOWN_HALL || b.buildingType === BuildingType.WAREHOUSE) && b.constructionProgress === undefined);
            const closestDropOff = findClosestTarget(clusterResource.position, myDropOffs);

            if (closestDropOff) {
                const distanceToDropOffSq = clusterCenterVec.distanceToSquared(new THREE.Vector3(closestDropOff.position.x, 0, closestDropOff.position.z));
                
                if (distanceToDropOffSq > WAREHOUSE_EVAL_DISTANCE_SQ) {
                    const warehouses = myBuildings.filter(b => b.buildingType === BuildingType.WAREHOUSE);
                    const warehouseNearby = warehouses.some(w => new THREE.Vector3(w.position.x, 0, w.position.z).distanceToSquared(clusterCenterVec) < WAREHOUSE_PROXIMITY_CHECK_SQ);
                    
                    if (!warehouseNearby) {
                        warehouseNeededAt = clusterResource.position;
                    }
                }
            }
        }
    }

    let towerNeededAt: Vector3 | null = null;
    const remoteWarehouses = myBuildings.filter(b => b.buildingType === BuildingType.WAREHOUSE && b.constructionProgress === undefined && myTownHall && new THREE.Vector3(b.position.x, 0, b.position.z).distanceToSquared(new THREE.Vector3(myTownHall.position.x, 0, myTownHall.position.z)) > WAREHOUSE_EVAL_DISTANCE_SQ);

    if (remoteWarehouses.length > 0) {
        const allTowers = myBuildings.filter(b => b.buildingType === BuildingType.DEFENSIVE_TOWER);
        for (const warehouse of remoteWarehouses) {
            const hasTowerNearby = allTowers.some(tower => 
                new THREE.Vector3(tower.position.x, 0, tower.position.z).distanceToSquared(new THREE.Vector3(warehouse.position.x, 0, warehouse.position.z)) < WAREHOUSE_PROXIMITY_CHECK_SQ
            );
            if (!hasTowerNearby) {
                towerNeededAt = warehouse.position;
                break;
            }
        }
    }


    const market = myBuildings.find(b => b.buildingType === BuildingType.MARKET && b.constructionProgress === undefined);
    if (market && (gold > 300 && wood < 100)) {
        dispatch({ type: 'TRADE_RESOURCES', payload: { playerId: player.id, trade: 'buy_wood' } });
    } else if (market && (wood > 300 && gold < 100)) {
        dispatch({ type: 'TRADE_RESOURCES', payload: { playerId: player.id, trade: 'sell_wood' } });
    }

    let nextGoal: { type: UnitType | BuildingType | ResearchCategory; cost: { wood: number; gold: number } } | null = null;
    
    const housesUnderConstruction = myBuildings.some(b => b.buildingType === BuildingType.HOUSE && b.constructionProgress !== undefined);

    if (towerNeededAt) {
        nextGoal = { type: BuildingType.DEFENSIVE_TOWER, cost: BUILDING_CONFIG.DEFENSIVE_TOWER.cost };
    } else if ((player.population.cap - player.population.current <= 2) && player.population.cap < 100 && !housesUnderConstruction && myBuildings.filter(b => b.buildingType === BuildingType.HOUSE).length < 10) {
        nextGoal = { type: BuildingType.HOUSE, cost: BUILDING_CONFIG.HOUSE.cost };
    } else if (warehouseNeededAt) {
        nextGoal = { type: BuildingType.WAREHOUSE, cost: BUILDING_CONFIG.WAREHOUSE.cost };
    } else if (myWorkerCount < WORKER_BOOM_TARGET) {
        nextGoal = { type: UnitType.WORKER, cost: UNIT_CONFIG.WORKER.cost };
    } else if (myBarracksCount < 1) {
        nextGoal = { type: BuildingType.BARRACKS, cost: BUILDING_CONFIG.BARRACKS.cost };
    } else if (myBarracksCount < 2 && player.population.current > 20) {
        nextGoal = { type: BuildingType.BARRACKS, cost: BUILDING_CONFIG.BARRACKS.cost };
    } else if (myBarracksCount < 3 && player.population.current > 35) {
        nextGoal = { type: BuildingType.BARRACKS, cost: BUILDING_CONFIG.BARRACKS.cost };
    } else if (myBuildings.filter(b => b.buildingType === BuildingType.DEFENSIVE_TOWER).length < 2) {
        nextGoal = { type: BuildingType.DEFENSIVE_TOWER, cost: BUILDING_CONFIG.DEFENSIVE_TOWER.cost };
    } else if (myBuildings.filter(b => b.buildingType === BuildingType.MARKET).length === 0) {
        nextGoal = { type: BuildingType.MARKET, cost: BUILDING_CONFIG.MARKET.cost };
    } else if (!researchCenter && myBuildings.filter(b => b.buildingType === BuildingType.RESEARCH_CENTER).length === 0) {
        if (gold >= 500 && wood >= 500 && myArmy.length > 5) {
             nextGoal = { type: BuildingType.RESEARCH_CENTER, cost: BUILDING_CONFIG.RESEARCH_CENTER.cost };
        }
    } else if (market && player.research[ResearchCategory.WORKER_CAPACITY] === 0) {
        nextGoal = { type: ResearchCategory.WORKER_CAPACITY, cost: RESEARCH_CONFIG[ResearchCategory.WORKER_CAPACITY].cost(0) };
    } else if (researchCenter && (!researchCenter.researchQueue || researchCenter.researchQueue.length === 0)) {
        const research = player.research;
        const priorities = [
            { should: infantryCount > archerCount, type: ResearchCategory.MELEE_ATTACK },
            { should: archerCount >= infantryCount, type: ResearchCategory.RANGED_ATTACK },
            { should: infantryCount > archerCount, type: ResearchCategory.MELEE_DEFENSE },
            { should: archerCount >= infantryCount, type: ResearchCategory.RANGED_DEFENSE },
            { should: true, type: ResearchCategory.BUILDING_DEFENSE },
            { should: myArmy.some(u => u.unitType === UnitType.CATAPULT), type: ResearchCategory.SIEGE_ATTACK },
            { should: true, type: ResearchCategory.BUILDING_ATTACK },
        ];
        
        for (const priority of priorities) {
            if (priority.should) {
                const info = RESEARCH_CONFIG[priority.type];
                const level = research[priority.type];
                if (level < info.maxLevel) {
                    const cost = info.cost(level);
                    if(gold >= cost.gold && wood >= cost.wood) {
                        nextGoal = { type: priority.type, cost };
                        break;
                    }
                }
            }
        }
    }

    if (!nextGoal) {
        const catapultCount = myArmy.filter(u => u.unitType === UnitType.CATAPULT).length;
        const cavalryCount = myArmy.filter(u => u.unitType === UnitType.CAVALRY).length;

        if (catapultCount < (infantryCount + archerCount) / 5 && infantryCount > 5) {
            nextGoal = { type: UnitType.CATAPULT, cost: UNIT_CONFIG.CATAPULT.cost };
        } else if (cavalryCount < (archerCount / 2) && archerCount > 3) {
             nextGoal = { type: UnitType.CAVALRY, cost: UNIT_CONFIG.CAVALRY.cost };
        } else if (infantryCount <= archerCount) {
            nextGoal = { type: UnitType.INFANTRY, cost: UNIT_CONFIG.INFANTRY.cost };
        } else {
            nextGoal = { type: UnitType.ARCHER, cost: UNIT_CONFIG.ARCHER.cost };
        }
    }
    
    if (nextGoal) {
        const canAfford = gold >= nextGoal.cost.gold && wood >= nextGoal.cost.wood;

        if (canAfford) {
            if (Object.values(ResearchCategory).includes(nextGoal.type as ResearchCategory)) {
                let researchBuilding = nextGoal.type === ResearchCategory.WORKER_CAPACITY ? market : researchCenter;
                if(researchBuilding) dispatch({ type: 'START_RESEARCH', payload: { buildingId: researchBuilding.id, researchType: nextGoal.type as ResearchCategory } });
            } else if (Object.values(UnitType).includes(nextGoal.type as UnitType)) {
                const popAvailable = player.population.current < player.population.cap;
                if (popAvailable) {
                    const unitType = nextGoal.type as UnitType;
                    let trainingBuilding: Building | undefined;
                    if (unitType === UnitType.WORKER) {
                        trainingBuilding = myTownHall;
                    } else {
                        const availableBarracks = myBuildings.filter(
                            b => b.buildingType === BuildingType.BARRACKS &&
                                b.constructionProgress === undefined &&
                                b.trainingQueue.length < 5
                        );
                        if (availableBarracks.length > 0) {
                            trainingBuilding = availableBarracks.reduce<Building | undefined>((best, current) => {
                                if (!best) return current;
                                const bestQueue = best.trainingQueue.length;
                                const currentQueue = current.trainingQueue.length;
                                if (currentQueue < bestQueue) return current;
                                if (currentQueue > bestQueue) return best;
                                const bestProgress = best.trainingQueue[0]?.progress ?? 0;
                                const currentProgress = current.trainingQueue[0]?.progress ?? 0;
                                if (currentProgress < bestProgress) return current;
                                if (currentProgress > bestProgress) return best;
                                return Math.random() < 0.5 ? current : best;
                            }, undefined);
                        }
                    }

                    if (trainingBuilding && trainingBuilding.trainingQueue.length < 5) {
                        dispatch({ type: 'TRAIN_UNIT', payload: { buildingId: trainingBuilding.id, unitType } });
                    }
                }
            } else { // This is for buildings
                const buildingType = nextGoal.type as BuildingType;
                let center = myTownHall.position;
                let radius: number | undefined = undefined;

                if (buildingType === BuildingType.WAREHOUSE && warehouseNeededAt) {
                    center = warehouseNeededAt;
                    radius = 8;
                }
                if (buildingType === BuildingType.DEFENSIVE_TOWER && towerNeededAt) {
                    center = towerNeededAt;
                    radius = 15;
                }

                const placement = findBuildPlacement(buildingType, center, state, radius);


                if (placement) {
                    const worker = findClosestTarget(placement, idleWorkers) || findClosestTarget(placement, myUnits.filter(u => u.unitType === UnitType.WORKER));
                    if (worker) {
                        dispatch({
                            type: 'COMMAND_BUILD',
                            payload: { workerIds: [worker.id], type: buildingType, position: placement },
                        });
                    }
                }
            }
        }
    }

    // --- ATTACK STATE MACHINE ---
    const RALLY_THRESHOLD = 0.7; // 70% of units must be at rally point to proceed

    // Cleanup wave: Remove dead units from the wave
    if (aiState.currentAttackWave.length > 0) {
        aiState.currentAttackWave = aiState.currentAttackWave.filter(id => state.units[id] && !state.units[id].isDying);
    }
    const waveUnits = aiState.currentAttackWave.map(id => state.units[id]).filter(Boolean);


    // State: RALLYING
    if (aiState.attackState === 'rallying') {
        if (waveUnits.length === 0 || !aiState.attackRallyPoint) {
            aiState.attackState = 'idle';
            aiState.attackWaveCooldown = 60; // Cooldown after a failed rally
        } else {
            const RALLY_TIMEOUT = 45000; // 45 seconds
            const rallyTimeElapsed = now - (aiState.rallyStartTime || 0);

            const rallyPointVec = new THREE.Vector3(aiState.attackRallyPoint.x, 0, aiState.attackRallyPoint.z);
            const unitsAtRally = waveUnits.filter(u => 
                new THREE.Vector3(u.position.x, 0, u.position.z).distanceToSquared(rallyPointVec) < 20 * 20 // 20 unit radius
            );

            const forceAttack = rallyTimeElapsed > RALLY_TIMEOUT && unitsAtRally.length > 0;

            if (unitsAtRally.length / waveUnits.length >= RALLY_THRESHOLD || forceAttack) {
                // Threshold met or timed out, transition to attacking
                aiState.attackState = 'attacking';
                aiState.rallyStartTime = undefined;

                const attackingForce = forceAttack ? unitsAtRally : waveUnits;
                
                const hostileArmy = hostileUnits.filter(u => u.unitType !== UnitType.WORKER);
                const attackableHostileBuildings = hostileBuildings.filter(b => b.constructionProgress === undefined);
                const target = findClosestTarget(aiState.attackRallyPoint, hostileArmy) || findClosestTarget(aiState.attackRallyPoint, attackableHostileBuildings);

                if (target) {
                    attackingForce.forEach(unit => {
                        dispatch({
                            type: 'COMMAND_UNIT',
                            payload: {
                                unitId: unit.id,
                                orderType: UnitOrderType.ATTACK_TARGET,
                                targetPosition: target.position,
                                targetId: target.id,
                                finalDestination: target.position,
                                source: 'ai',
                            },
                        });
                    });
                } else {
                     // No targets found, disband attack
                    aiState.attackState = 'idle';
                    aiState.attackWaveCooldown = 60;
                }
            }
        }
    }
    
    // State: ATTACKING
    if (aiState.attackState === 'attacking') {
        if (waveUnits.length === 0) {
            // Wave has been defeated
            aiState.attackState = 'idle';
            aiState.currentAttackWave = [];
            aiState.attackRallyPoint = undefined;
            aiState.attackWaveCooldown = 90; // Longer cooldown after a defeat
        }
    }

    // State: IDLE -> Decide to attack
    aiState.attackWaveCooldown -= (AI_CHECK_INTERVAL / 1000);
    if (aiState.attackState === 'idle' && aiState.attackWaveCooldown <= 0) {
        const hostileArmy = hostileUnits.filter(u => u.unitType !== UnitType.WORKER);
        
        const myStrength = calculateArmyStrength(myArmy, player.research);
        const strongestHostilePlayer = state.players.filter(p => arePlayersHostile(player, p)).reduce((strongest, p) => {
            const pStrength = calculateArmyStrength(hostileArmy.filter(u => u.playerId === p.id), p.research);
            return pStrength > (strongest?.strength ?? 0) ? { player: p, strength: pStrength } : strongest;
        }, null as {player: Player, strength: number} | null);
        
        const playerStrength = strongestHostilePlayer?.strength ?? 0;

        if (myArmy.length > 8 && myStrength > playerStrength * armyStrengthMultiplierAttack) {
            const attackableHostileBuildings = hostileBuildings.filter(b => b.constructionProgress === undefined);
            const target = findClosestTarget(myTownHall.position, hostileArmy) || findClosestTarget(myTownHall.position, attackableHostileBuildings);

            if (target) {
                const attackingUnits = myArmy.filter(u => u.status === UnitStatus.IDLE || u.status === UnitStatus.MOVING);
                if (attackingUnits.length > 5) {
                    // Start rallying
                    aiState.attackState = 'rallying';
                    aiState.rallyStartTime = now;
                    aiState.currentAttackWave = attackingUnits.map(u => u.id);

                    // Determine rally point: 30% of the way from our base to theirs
                    const myBaseVec = new THREE.Vector3(myTownHall.position.x, 0, myTownHall.position.z);
                    const enemyTargetVec = new THREE.Vector3(target.position.x, 0, target.position.z);
                    const rallyPoint = new THREE.Vector3().lerpVectors(myBaseVec, enemyTargetVec, 0.3);
                    aiState.attackRallyPoint = { x: rallyPoint.x, y: 0, z: rallyPoint.z };
                    
                    const formationPositions = getFormationPositions(aiState.attackRallyPoint, attackingUnits.length);
                    attackingUnits.forEach((unit, index) => {
                        const destination = formationPositions[index] || aiState.attackRallyPoint!;
                        dispatch({
                            type: 'COMMAND_UNIT',
                            payload: {
                                unitId: unit.id,
                                orderType: UnitOrderType.ATTACK_MOVE,
                                targetPosition: destination,
                                finalDestination: destination,
                                source: 'ai',
                            },
                        });
                    });
                    
                    aiState.attackWaveCooldown = 120; // Reset cooldown for the next wave
                }
            }
        } else {
            // Not strong enough, wait a bit before checking again
            aiState.attackWaveCooldown = 30;
        }
    }
};

export const processAiLogic = (
    state: GameState,
    pathfindingGrid: number[][],
    delta: number,
    dispatch: BufferedDispatch
) => {
    let aiPlayerIndex = 0;
    for(const player of state.players) {
        if (!player.isHuman) {
            const aiState = state.aiStates[aiPlayerIndex];
            if (aiState) {
                processSingleAiLogic(state, delta, dispatch, player, aiState);
            }
            aiPlayerIndex++;
        }
    }
};
