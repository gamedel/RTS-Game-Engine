import { GameState, UnitType, BuildingType, GameObjectType, ResourceType, UnitStatus, UnitStance, ResearchCategory, ResearchState, Unit, Building, AIDifficulty, MapType, ResourceNode, Player, PlayerSetupConfig, Vector3 } from './types';
import { v4 as uuidv4 } from 'uuid';

export const UNIT_CONFIG = {
  [UnitType.WORKER]: { cost: { gold: 50, wood: 0 }, hp: 50, speed: 5, gatherAmount: 10, gatherTime: 0.5, carryCapacity: 10, attackDamage: 0, attackSpeed: 1, attackRange: 1.5, defense: 0, aggroRange: 0 },
  [UnitType.INFANTRY]: { cost: { gold: 75, wood: 25 }, hp: 100, speed: 4, attackDamage: 12, attackSpeed: 1.2, attackRange: 1.8, defense: 1, aggroRange: 10 },
  [UnitType.ARCHER]: { cost: { gold: 50, wood: 50 }, hp: 70, speed: 4.5, attackDamage: 8, attackSpeed: 1, attackRange: 10, defense: 0, aggroRange: 12 },
  [UnitType.CAVALRY]: { cost: { gold: 100, wood: 40 }, hp: 120, speed: 6, attackDamage: 15, attackSpeed: 1.0, attackRange: 2.0, defense: 1, aggroRange: 11 },
  [UnitType.CATAPULT]: { cost: { gold: 150, wood: 150 }, hp: 80, speed: 3, attackDamage: 20, attackSpeed: 0.3, attackRange: 15, defense: 0, aggroRange: 16 },
};

export const BUILDING_CONFIG = {
  [BuildingType.TOWN_HALL]: { cost: { gold: 200, wood: 200 }, hp: 1500, buildTime: 60, defense: 5, attackDamage: 20, attackSpeed: 0.6, attackRange: 12 },
  [BuildingType.BARRACKS]: { cost: { gold: 50, wood: 150 }, hp: 800, buildTime: 20, defense: 3 },
  [BuildingType.HOUSE]: { cost: { gold: 0, wood: 100 }, hp: 400, buildTime: 10, defense: 2 },
  [BuildingType.DEFENSIVE_TOWER]: { cost: { gold: 75, wood: 125 }, hp: 600, buildTime: 25, defense: 5, attackDamage: 30, attackSpeed: 0.8, attackRange: 14 },
  [BuildingType.WAREHOUSE]: { cost: { gold: 25, wood: 50 }, hp: 200, buildTime: 15, defense: 2 },
  [BuildingType.RESEARCH_CENTER]: { cost: { gold: 100, wood: 200 }, hp: 900, buildTime: 30, defense: 3 },
  [BuildingType.MARKET]: { cost: { gold: 0, wood: 100 }, hp: 600, buildTime: 30, defense: 2 },
};

export const TOWER_UPGRADE_CONFIG = {
    cost: { gold: 150, wood: 100 },
    time: 45, // seconds
    upgradedDamage: 50,
    upgradedAttackSpeed: 0.25,
    upgradedAttackRange: 18,
};

export const TRAINING_TIME = {
    [UnitType.WORKER]: 10,
    [UnitType.INFANTRY]: 15,
    [UnitType.ARCHER]: 18,
    [UnitType.CAVALRY]: 22,
    [UnitType.CATAPULT]: 30,
};

export const RESEARCH_CONFIG = {
    [ResearchCategory.MELEE_ATTACK]: { nameKey: 'research.name.MELEE_ATTACK', maxLevel: 3, cost: (level: number) => ({ gold: 100 * (level + 1), wood: 50 * (level + 1) }), time: 30, bonus: 0.15 },
    [ResearchCategory.MELEE_DEFENSE]: { nameKey: 'research.name.MELEE_DEFENSE', maxLevel: 3, cost: (level: number) => ({ gold: 75 * (level + 1), wood: 75 * (level + 1) }), time: 30, bonus: 1 },
    [ResearchCategory.RANGED_ATTACK]: { nameKey: 'research.name.RANGED_ATTACK', maxLevel: 3, cost: (level: number) => ({ gold: 125 * (level + 1), wood: 75 * (level + 1) }), time: 40, bonus: 0.15 },
    [ResearchCategory.RANGED_DEFENSE]: { nameKey: 'research.name.RANGED_DEFENSE', maxLevel: 3, cost: (level: number) => ({ gold: 50 * (level + 1), wood: 100 * (level + 1) }), time: 30, bonus: 1 },
    [ResearchCategory.SIEGE_ATTACK]: { nameKey: 'research.name.SIEGE_ATTACK', maxLevel: 3, cost: (level: number) => ({ gold: 200 * (level + 1), wood: 200 * (level + 1) }), time: 60, bonus: 0.20 },
    [ResearchCategory.BUILDING_ATTACK]: { nameKey: 'research.name.BUILDING_ATTACK', maxLevel: 3, cost: (level: number) => ({ gold: 150 * (level + 1), wood: 150 * (level + 1) }), time: 45, bonus: 0.25 },
    [ResearchCategory.BUILDING_DEFENSE]: { nameKey: 'research.name.BUILDING_DEFENSE', maxLevel: 3, cost: (level: number) => ({ gold: 50 * (level + 1), wood: 150 * (level + 1) }), time: 45, bonus: 2 },
    [ResearchCategory.WORKER_CAPACITY]: { nameKey: 'research.name.WORKER_CAPACITY', maxLevel: 1, cost: (level: number) => ({ gold: 150, wood: 150 }), time: 60, bonus: 10 },
};

export const REPAIR_HP_PER_TICK = 25;
export const REPAIR_TICK_TIME = 0.5; // A worker contributes to repair every this many seconds.

export const COLLISION_DATA = {
    BUILDINGS: {
        [BuildingType.TOWN_HALL]: { width: 4, depth: 4 },
        [BuildingType.BARRACKS]: { width: 3.5, depth: 5.5 },
        [BuildingType.HOUSE]: { width: 3, depth: 3 },
        [BuildingType.DEFENSIVE_TOWER]: { width: 2.5, depth: 2.5 },
        [BuildingType.WAREHOUSE]: { width: 3.5, depth: 3.5 },
        [BuildingType.RESEARCH_CENTER]: { width: 4, depth: 4 },
        [BuildingType.MARKET]: { width: 3.5, depth: 3.5 },
    },
    UNITS: {
        [UnitType.WORKER]: { radius: 0.4 },
        [UnitType.INFANTRY]: { radius: 0.5 },
        [UnitType.ARCHER]: { radius: 0.5 },
        [UnitType.CAVALRY]: { radius: 0.7 },
        [UnitType.CATAPULT]: { radius: 0.8 },
    }
};

export const BUILDING_COLLISION_MASK_SCALE = 0.65;

export const getBuildingCollisionMask = (buildingType: BuildingType) => {
    const base = COLLISION_DATA.BUILDINGS[buildingType];
    if (!base) {
        return { width: 0, depth: 0 };
    }

    return {
        width: base.width * BUILDING_COLLISION_MASK_SCALE,
        depth: base.depth * BUILDING_COLLISION_MASK_SCALE,
    };
};

export const RESOURCE_NODE_INTERACTION_RADIUS: Record<ResourceType, number> = {
  [ResourceType.TREE]: 1.1,
  [ResourceType.GOLD_MINE]: 1.25,
};

export const COMMAND_MARKER_DURATION = 750; // ms
export const EXPLOSION_MARKER_DURATION = 500; // ms
export const DEATH_ANIMATION_DURATION = 2500; // ms
export const GOLD_MINE_DEPLETE_DURATION = 2000; // ms
export const PLAYER_COLORS = ['#38bdf8', '#f87171', '#facc15', '#a3e635']; // Blue, Red, Yellow, Green

const createInitialResearchState = (): ResearchState => ({
    [ResearchCategory.MELEE_ATTACK]: 0,
    [ResearchCategory.MELEE_DEFENSE]: 0,
    [ResearchCategory.RANGED_ATTACK]: 0,
    [ResearchCategory.RANGED_DEFENSE]: 0,
    [ResearchCategory.SIEGE_ATTACK]: 0,
    [ResearchCategory.BUILDING_ATTACK]: 0,
    [ResearchCategory.BUILDING_DEFENSE]: 0,
    [ResearchCategory.WORKER_CAPACITY]: 0,
});

const generateResources = (mapType: MapType, startPositions: Vector3[]): Record<string, ResourceNode> => {
    const nodes: Record<string, ResourceNode> = {};
    const existingNodePositions: Vector3[] = [];
    const MIN_DISTANCE_BETWEEN_NODES_SQ = 2 * 2; // Prevent nodes from spawning on top of each other
    const START_AREA_PROTECTION_RADIUS_SQ = 15 * 15; // Smaller radius for initial resources
    const GLOBAL_START_AREA_PROTECTION_RADIUS_SQ = 25 * 25; // Larger radius for contested resources

    const createNode = (protoNode: Partial<ResourceNode>, protectionRadiusSq: number, checkOtherNodes: boolean = true) => {
        const pos = protoNode.position!;

        // Check if too close to ANY start position
        for (const startPos of startPositions) {
            const dx = pos.x - startPos.x;
            const dz = pos.z - startPos.z;
            if (dx * dx + dz * dz < protectionRadiusSq) {
                return;
            }
        }
        
        // Check if too close to another resource node
        if (checkOtherNodes) {
            for (const existingPos of existingNodePositions) {
                const dx = pos.x - existingPos.x;
                const dz = pos.z - existingPos.z;
                if (dx * dx + dz * dz < MIN_DISTANCE_BETWEEN_NODES_SQ) {
                    return;
                }
            }
        }

        const id = uuidv4();
        nodes[id] = { ...protoNode, id, type: GameObjectType.RESOURCE } as ResourceNode;
        existingNodePositions.push(pos);
    };

    // --- Symmetrical Resource Generation for Each Player ---
    startPositions.forEach(startPos => {
        // Each player gets a nearby gold mine
        for (let i = 0; i < 2; i++) {
            const angle = (Math.random() - 0.5) * (Math.PI / 2) + (i * Math.PI); // Place on opposite sides
            const radius = 18 + Math.random() * 5;
            createNode({
                resourceType: ResourceType.GOLD_MINE,
                position: { x: startPos.x + Math.cos(angle) * radius, y: 0, z: startPos.z + Math.sin(angle) * radius },
                amount: 3000
            }, START_AREA_PROTECTION_RADIUS_SQ, true);
        }

        // Each player gets a nearby patch of trees
        for (let i = 0; i < 10; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = 20 + Math.random() * 15;
            createNode({
                resourceType: ResourceType.TREE,
                position: { x: startPos.x + Math.cos(angle) * radius, y: 0, z: startPos.z + Math.sin(angle) * radius },
                amount: 300
            }, START_AREA_PROTECTION_RADIUS_SQ, true);
        }
    });

    // --- Contested / Map-specific Resource Generation ---
    // The logic inside the switch will now focus on resources that are not player-specific
    switch (mapType) {
        case 'forest':
            // Add dense forests in the middle and symmetrically placed gold mines
            const groves = Array.from({ length: 2 + Math.floor(Math.random() * 2) }).map(() => ({
                x: (Math.random() - 0.5) * 100,
                z: (Math.random() - 0.5) * 100,
            }));
            for (let i = 0; i < 100; i++) {
                const grove = groves[i % groves.length];
                const angle = Math.random() * Math.PI * 2;
                const radius = Math.random() * 30;
                createNode({ resourceType: ResourceType.TREE, position: { x: grove.x + Math.cos(angle) * radius, y: 0, z: grove.z + Math.sin(angle) * radius }, amount: 300 }, GLOBAL_START_AREA_PROTECTION_RADIUS_SQ);
            }
            // Symmetrically placed extra gold mines
            for (let i = 0; i < 4; i++) {
                const angle = (Math.PI / 2) * i + (Math.PI / 4);
                const radius = 80 + Math.random() * 20;
                createNode({ resourceType: ResourceType.GOLD_MINE, position: { x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius }, amount: 4000 }, GLOBAL_START_AREA_PROTECTION_RADIUS_SQ);
            }
            break;
        case 'gold_rush':
             // Central cluster of gold
             for (let i = 0; i < 15; i++) {
                const angle = Math.random() * Math.PI * 2;
                const radius = Math.random() * 40;
                createNode({ resourceType: ResourceType.GOLD_MINE, position: { x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius }, amount: 4000 }, GLOBAL_START_AREA_PROTECTION_RADIUS_SQ);
            }
            // Symmetrical outer ring of trees
            for (let i = 0; i < 20; i++) {
                const angle = Math.random() * Math.PI * 2;
                const radius = 100 + Math.random() * 20;
                createNode({ resourceType: ResourceType.TREE, position: { x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius }, amount: 300 }, GLOBAL_START_AREA_PROTECTION_RADIUS_SQ);
            }
            break;
        case 'open_plains':
             // A few symmetrical resource spots
            for (let i = 0; i < 2; i++) {
                const angle = (Math.PI) * i + (Math.PI / 2); // Top and bottom
                const radius = 90;
                createNode({ resourceType: ResourceType.GOLD_MINE, position: { x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius }, amount: 3000 }, GLOBAL_START_AREA_PROTECTION_RADIUS_SQ);
                createNode({ resourceType: ResourceType.GOLD_MINE, position: { x: Math.cos(angle+Math.PI/8) * radius, y: 0, z: Math.sin(angle+Math.PI/8) * radius }, amount: 3000 }, GLOBAL_START_AREA_PROTECTION_RADIUS_SQ);
            }
            for (let i = 0; i < 20; i++) {
                createNode({ resourceType: ResourceType.TREE, position: { x: (Math.random() - 0.5) * 280, y: 0, z: (Math.random() - 0.5) * 280 }, amount: 300 }, GLOBAL_START_AREA_PROTECTION_RADIUS_SQ);
            }
            break;
        case 'default':
        default:
            // Symmetrical contested gold mines
             Array.from({ length: 4 }).forEach((_, i) => {
                const angle = (Math.PI / 2) * i + (Math.PI / 4); // 45, 135, 225, 315 degrees
                const radius = 70 + Math.random() * 20;
                createNode({ resourceType: ResourceType.GOLD_MINE, position: { x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius }, amount: 3000 }, GLOBAL_START_AREA_PROTECTION_RADIUS_SQ);
             });
             // Random trees scattered around, but avoiding start areas
             Array.from({ length: 60 }).forEach(() => {
                const angle = Math.random() * Math.PI * 2;
                const radius = 40 + Math.random() * 90;
                createNode({ resourceType: ResourceType.TREE, position: { x: Math.cos(angle) * radius, y: 0, z: Math.sin(angle) * radius }, amount: 300 }, GLOBAL_START_AREA_PROTECTION_RADIUS_SQ);
             });
            break;
    }
    return nodes;
};

export const createInitialGameState = (mapType: MapType = 'default', playersSetup: PlayerSetupConfig[]): GameState => {
    const START_POSITIONS: Vector3[] = [
        { x: -110, y: 0, z: 110 }, // Top-left
        { x: 110, y: 0, z: -110 }, // Bottom-right
        { x: 110, y: 0, z: 110 },  // Top-right
        { x: -110, y: 0, z: -110 },// Bottom-left
    ];

    const players: Player[] = [];
    const units: Record<string, Unit> = {};
    const buildings: Record<string, Building> = {};
    const aiStates: GameState['aiStates'] = [];
    
    const workerConfig = UNIT_CONFIG[UnitType.WORKER];
    const thConfig = BUILDING_CONFIG[BuildingType.TOWN_HALL];

    for (let i = 0; i < playersSetup.length; i++) {
        const setup = playersSetup[i];
        const isHuman = setup.isHuman;
        const startPos = START_POSITIONS[i];
        let initialGold = 200;
        let initialWood = 200;

        if (!isHuman) {
            switch(setup.difficulty) {
                case 'easy': initialGold = 150; initialWood = 150; break;
                case 'hard': initialGold = 400; initialWood = 400; break;
                case 'very_hard': initialGold = 600; initialWood = 600; break;
            }
        }

        players.push({
            id: i,
            isHuman,
            teamId: setup.teamId,
            color: PLAYER_COLORS[i],
            resources: { gold: initialGold, wood: initialWood },
            population: { current: 0, cap: 10 },
            research: createInitialResearchState(),
        });
        
        const townHallId = uuidv4();
        buildings[townHallId] = {
            id: townHallId, type: GameObjectType.BUILDING, buildingType: BuildingType.TOWN_HALL, playerId: i,
            position: startPos, hp: thConfig.hp, maxHp: thConfig.hp, trainingQueue: [], defense: thConfig.defense,
            attackDamage: thConfig.attackDamage, attackSpeed: thConfig.attackSpeed, attackRange: thConfig.attackRange,
        };

        for (let j = 0; j < (isHuman ? 2 : 3); j++) {
            const workerId = uuidv4();
            units[workerId] = {
                id: workerId, type: GameObjectType.UNIT, unitType: UnitType.WORKER, playerId: i,
                position: { x: startPos.x - 5 + (j * 5), y: 0, z: startPos.z + 5 },
                status: UnitStatus.IDLE, hp: workerConfig.hp, maxHp: workerConfig.hp,
                attackDamage: workerConfig.attackDamage, attackSpeed: workerConfig.attackSpeed, attackRange: workerConfig.attackRange,
                defense: workerConfig.defense, stance: UnitStance.HOLD_GROUND, isHarvesting: false
            };
        }

        players[i].population.current = Object.values(units).filter(u => u.playerId === i).length;
        
        if (!isHuman) {
            let attackWaveCooldown = 90;
            const difficulty = setup.difficulty || 'normal';
            switch(difficulty) {
                case 'easy': attackWaveCooldown = 180; break;
                case 'hard': attackWaveCooldown = 60; break;
                case 'very_hard': attackWaveCooldown = 45; break;
            }

            aiStates.push({
                difficulty,
                buildOrder: [
                    { type: UnitType.WORKER, targetCount: 8 },
                    { type: BuildingType.BARRACKS, targetCount: 1 },
                    { type: UnitType.INFANTRY, targetCount: 5 },
                    { type: BuildingType.HOUSE, targetCount: 2},
                    { type: UnitType.ARCHER, targetCount: 5 },
                    { type: BuildingType.HOUSE, targetCount: 3},
                    { type: UnitType.CAVALRY, targetCount: 4 },
                    { type: BuildingType.RESEARCH_CENTER, targetCount: 1},
                    { type: UnitType.INFANTRY, targetCount: 10 },
                    { type: UnitType.ARCHER, targetCount: 10 },
                ],
                attackWaveCooldown,
                lastCheckTime: 0,
                attackState: 'idle',
                currentAttackWave: [],
            });
        }
    }
    
    const resourcesNodes = generateResources(mapType, START_POSITIONS.slice(0, playersSetup.length));

    const gameState: GameState = {
        players,
        units,
        buildings,
        resourcesNodes,
        aiStates,
        projectiles: {},
        floatingTexts: {},
        commandMarkers: {},
        explosionMarkers: {},
        selectedIds: [],
        buildMode: null,
        gameStatus: 'playing',
    };

  return gameState;
};


// --- Helper functions for calculating bonuses ---

export const arePlayersHostile = (p1: Player, p2: Player): boolean => {
    if (!p1 || !p2) return false;
    if (p1.id === p2.id) return false;
    if (p1.teamId === '-' || p2.teamId === '-') return true;
    return p1.teamId !== p2.teamId;
};

export const getAttackBonus = (unitOrBuilding: Unit | Building, research: ResearchState): number => {
    const baseDamage = unitOrBuilding.attackDamage || 0;
    if (baseDamage === 0) return 0;

    let bonus = 0;
    if (unitOrBuilding.type === GameObjectType.UNIT) {
        switch (unitOrBuilding.unitType) {
            case UnitType.INFANTRY:
            case UnitType.CAVALRY:
                bonus = baseDamage * research[ResearchCategory.MELEE_ATTACK] * RESEARCH_CONFIG[ResearchCategory.MELEE_ATTACK].bonus;
                break;
            case UnitType.ARCHER:
                bonus = baseDamage * research[ResearchCategory.RANGED_ATTACK] * RESEARCH_CONFIG[ResearchCategory.RANGED_ATTACK].bonus;
                break;
            case UnitType.CATAPULT:
                 bonus = baseDamage * research[ResearchCategory.SIEGE_ATTACK] * RESEARCH_CONFIG[ResearchCategory.SIEGE_ATTACK].bonus;
                break;
        }
    } else if (unitOrBuilding.type === GameObjectType.BUILDING) {
        const config = RESEARCH_CONFIG[ResearchCategory.BUILDING_ATTACK];
        bonus = baseDamage * research[ResearchCategory.BUILDING_ATTACK] * config.bonus;
    }
    return bonus;
};


export const getDefenseBonus = (unitOrBuilding: Unit | Building, research: ResearchState): number => {
    let bonus = 0;
     if (unitOrBuilding.type === GameObjectType.UNIT) {
        switch (unitOrBuilding.unitType) {
            case UnitType.INFANTRY:
            case UnitType.CATAPULT:
            case UnitType.CAVALRY:
                bonus = research[ResearchCategory.MELEE_DEFENSE] * RESEARCH_CONFIG[ResearchCategory.MELEE_DEFENSE].bonus;
                break;
            case UnitType.ARCHER:
                bonus = research[ResearchCategory.RANGED_DEFENSE] * RESEARCH_CONFIG[ResearchCategory.RANGED_DEFENSE].bonus;
                break;
        }
    } else if (unitOrBuilding.type === GameObjectType.BUILDING) {
        bonus = research[ResearchCategory.BUILDING_DEFENSE] * RESEARCH_CONFIG[ResearchCategory.BUILDING_DEFENSE].bonus;
    }
    return bonus;
};