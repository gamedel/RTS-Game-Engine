export type Vector3 = { x: number; y: number; z: number };

export enum GameObjectType {
  UNIT = 'UNIT',
  BUILDING = 'BUILDING',
  RESOURCE = 'RESOURCE',
  PROJECTILE = 'PROJECTILE',
}

export enum ResourceType {
    TREE = 'TREE',
    GOLD_MINE = 'GOLD_MINE',
}

export enum UnitType {
  WORKER = 'WORKER',
  INFANTRY = 'INFANTRY',
  ARCHER = 'ARCHER',
  CATAPULT = 'CATAPULT',
  CAVALRY = 'CAVALRY',
}

export enum BuildingType {
  TOWN_HALL = 'TOWN_HALL',
  BARRACKS = 'BARRACKS',
  HOUSE = 'HOUSE',
  DEFENSIVE_TOWER = 'DEFENSIVE_TOWER',
  WAREHOUSE = 'WAREHOUSE',
  RESEARCH_CENTER = 'RESEARCH_CENTER',
  MARKET = 'MARKET',
}

export enum UnitStatus {
    IDLE = 'IDLE',
    MOVING = 'MOVING',
    GATHERING = 'GATHERING',
    RETURNING = 'RETURNING',
    BUILDING = 'BUILDING',
    ATTACKING = 'ATTACKING',
    REPAIRING = 'REPAIRING',
    FLEEING = 'FLEEING',
}

export enum UnitStance {
    AGGRESSIVE = 'AGGRESSIVE',
    HOLD_GROUND = 'HOLD_GROUND',
}

export type WorkerGatherPhase = 'travelToResource' | 'harvesting' | 'travelToDropoff';
export type WorkerBuildPhase = 'travelToSite' | 'building';
export type WorkerRepairPhase = 'travelToTarget' | 'repairing';

type WorkerOrderBase = {
    anchor: Vector3;
    radius: number;
    issuedAt: number;
    lastProgressAt: number;
    retries: number;
};

export type WorkerOrder =
    | (WorkerOrderBase & {
        kind: 'gather';
        resourceId: string;
        resourceType: ResourceType;
        phase: WorkerGatherPhase;
        dropoffId?: string;
    })
    | (WorkerOrderBase & {
        kind: 'build';
        buildingId: string;
        phase: WorkerBuildPhase;
    })
    | (WorkerOrderBase & {
        kind: 'repair';
        buildingId: string;
        phase: WorkerRepairPhase;
    });

export enum AnimationState {
    IDLE = 'IDLE',
    WALKING = 'WALKING',
    GATHERING = 'GATHERING',
    BUILDING = 'BUILDING',
    ATTACKING_MELEE = 'ATTACKING_MELEE',
    ATTACKING_RANGED = 'ATTACKING_RANGED',
    DYING = 'DYING',
}

export enum ResearchCategory {
    MELEE_ATTACK = 'MELEE_ATTACK',
    MELEE_DEFENSE = 'MELEE_DEFENSE',
    RANGED_ATTACK = 'RANGED_ATTACK',
    RANGED_DEFENSE = 'RANGED_DEFENSE',
    SIEGE_ATTACK = 'SIEGE_ATTACK',
    BUILDING_ATTACK = 'BUILDING_ATTACK',
    BUILDING_DEFENSE = 'BUILDING_DEFENSE',
    WORKER_CAPACITY = 'WORKER_CAPACITY',
}

export interface ResearchState {
    [ResearchCategory.MELEE_ATTACK]: number;
    [ResearchCategory.MELEE_DEFENSE]: number;
    [ResearchCategory.RANGED_ATTACK]: number;
    [ResearchCategory.RANGED_DEFENSE]: number;
    [ResearchCategory.SIEGE_ATTACK]: number;
    [ResearchCategory.BUILDING_ATTACK]: number;
    [ResearchCategory.BUILDING_DEFENSE]: number;
    [ResearchCategory.WORKER_CAPACITY]: number;
}

interface BaseGameObject {
  id: string;
  position: Vector3;
  type: GameObjectType;
  playerId?: number; // Optional for resources, projectiles
}

export interface Unit extends BaseGameObject {
  type: GameObjectType.UNIT;
  unitType: UnitType;
  status: UnitStatus;
  playerId: number;
  stance: UnitStance;
  targetId?: string;
  targetPosition?: Vector3; // Current waypoint
  resourcePayload?: { type: 'WOOD' | 'GOLD', amount: number };
  buildTask?: { buildingId: string, position: Vector3 };
  repairTask?: { buildingId: string };
  isHarvesting: boolean; // Flag to indicate a persistent gathering task
  harvestingResourceType?: ResourceType; // What type of resource is the persistent task for
  hp: number;
  maxHp: number;
  gatherTimer?: number;
  buildTimer?: number;
  repairTimer?: number;
  gatherTargetId?: string;
  interactionAnchor?: Vector3;
  interactionRadius?: number;
  path?: Vector3[];
  pathIndex?: number;
  pathTarget?: Vector3; // Final destination of the current path
  finalDestination?: Vector3; // The ultimate destination of a command sequence (e.g., attack-move)
  squadId?: string; // For squad pathfinding optimization
  // Combat Stats
  attackDamage: number;
  attackSpeed: number; // Attacks per second
  attackRange: number;
  defense: number;
  attackCooldown?: number; // Time until next attack
  // Stuck detection
  lastPositionCheck?: { pos: Vector3; time: number };
  // Death animation
  isDying?: boolean;
  deathTime?: number;
  // Worker task metadata
  workerOrder?: WorkerOrder;
}

export interface Building extends BaseGameObject {
  type: GameObjectType.BUILDING;
  buildingType: BuildingType;
  playerId: number;
  hp: number;
  maxHp: number;
  trainingQueue: { unitType: UnitType, progress: number }[];
  researchQueue?: { type: ResearchCategory, level: number, progress: number }[];
  constructionProgress?: number;
  defense: number;
  rallyPoint?: Vector3;
  // Combat Stats (for defensive buildings)
  attackDamage?: number;
  attackSpeed?: number;
  attackRange?: number;
  attackCooldown?: number;
  targetId?: string;
  // Tower Upgrade
  isUpgraded?: boolean;
  upgradeProgress?: number;
  upgradeTimer?: number;
}

export interface ResourceNode extends BaseGameObject {
  type: GameObjectType.RESOURCE;
  resourceType: ResourceType;
  amount: number;
  isFalling?: boolean;
  fallStartTime?: number;
  isDepleting?: boolean;
  depletionStartTime?: number;
}

export interface Projectile extends BaseGameObject {
    type: GameObjectType.PROJECTILE;
    sourceId: string; // ID of the unit or building that fired it
    targetId: string;
    speed: number;
    damage: number;
    playerId: number;
    // New properties for catapults
    aoeRadius?: number;
    buildingDamageMultiplier?: number;
    isArcing?: boolean;
    initialPosition?: Vector3;
    targetLastPosition?: Vector3; // Store target's position at launch
}

export interface FloatingText {
    id: string;
    text: string;
    position: Vector3;
    resourceType: 'WOOD' | 'GOLD' | 'DAMAGE' | 'BONUS_DAMAGE' | 'RESIST_DAMAGE';
    startTime: number;
}

export interface CommandMarker {
    id: string;
    position: Vector3;
    startTime: number;
}

export interface ExplosionMarker {
    id: string;
    position: Vector3;
    startTime: number;
    radius: number;
}


export type GameObject = Unit | Building | ResourceNode;

export type AIState = {
    difficulty: AIDifficulty;
    buildOrder: { type: UnitType | BuildingType, targetCount: number }[];
    attackWaveCooldown: number;
    lastCheckTime: number; // To throttle AI decisions
    attackState: 'idle' | 'rallying' | 'attacking';
    attackRallyPoint?: Vector3;
    currentAttackWave: string[];
    rallyStartTime?: number; // To prevent getting stuck in rallying state
};

export type AIDifficulty = 'easy' | 'normal' | 'hard' | 'very_hard';
export type MapType = 'default' | 'forest' | 'gold_rush' | 'open_plains';

export type PlayerSetupConfig = {
    isHuman: boolean;
    teamId: string;
    difficulty?: AIDifficulty;
};

export type Player = {
    id: number; // Corresponds to index in players array
    isHuman: boolean;
    teamId: string; // e.g., '1', '2', or '-' for FFA
    color: string;
    resources: {
        gold: number;
        wood: number;
    };
    population: {
        current: number;
        cap: number;
    };
    research: ResearchState;
};

export type GameState = {
  players: Player[];
  units: Record<string, Unit>;
  buildings: Record<string, Building>;
  resourcesNodes: Record<string, ResourceNode>;
  projectiles: Record<string, Projectile>;
  floatingTexts: Record<string, FloatingText>;
  commandMarkers: Record<string, CommandMarker>;
  explosionMarkers: Record<string, ExplosionMarker>;
  selectedIds: string[];
  buildMode: {
    type: BuildingType,
    canPlace: boolean,
    position: Vector3,
  } | null;
  gameStatus: 'playing' | 'won' | 'lost' | 'paused';
  aiStates: AIState[];
};

export type BatchUpdatePayload = {
    units?: Array<Partial<Unit> & { id: string }>;
    buildings?: Array<Partial<Building> & { id: string }>;
    projectiles?: Array<Partial<Projectile> & { id: string }>;
};


export type Action =
  | { type: 'START_NEW_GAME'; payload: { mapType: MapType; players: PlayerSetupConfig[] } }
  | { type: 'SELECT_OBJECT'; payload: { id: string | null; isShift?: boolean } }
  | { type: 'SET_SELECTION'; payload: string[] }
  | { type: 'COMMAND_UNIT'; payload: { unitId: string, targetPosition: Vector3, targetId?: string, finalDestination?: Vector3, squadId?: string } }
  | { type: 'GAME_TICK'; payload: { deltaTime: number } }
  | { type: 'ADD_RESOURCES'; payload: { wood?: number; gold?: number; playerId: number } }
  | { type: 'UPDATE_RESOURCE_NODE'; payload: Partial<ResourceNode> & { id: string } }
  | { type: 'REMOVE_RESOURCE_NODE'; payload: { id: string } }
  | { type: 'SET_BUILD_MODE'; payload: BuildingType | null }
  | { type: 'UPDATE_BUILD_PLACEHOLDER'; payload: { position: Vector3, canPlace: boolean } }
  | { type: 'COMMAND_BUILD'; payload: { workerIds: string[], type: BuildingType, position: Vector3 } }
  | { type: 'ADD_BUILDING'; payload: { building: Building } }
  | { type: 'UPDATE_UNIT'; payload: Partial<Unit> & { id: string } }
  | { type: 'REMOVE_UNIT'; payload: { id: string } }
  | { type: 'TRAIN_UNIT'; payload: { buildingId: string, unitType: UnitType } }
  | { type: 'CANCEL_TRAIN_UNIT'; payload: { buildingId: string, queueIndex: number } }
  | { type: 'SPAWN_UNIT_FROM_QUEUE', payload: { buildingId: string, unitType: UnitType, playerId: number } }
  | { type: 'ADD_UNIT'; payload: { unit: Partial<Unit>, playerId: number } }
  | { type: 'UPDATE_BUILDING'; payload: Partial<Building> & { id: string } }
  | { type: 'ADD_FLOATING_TEXT', payload: FloatingText }
  | { type: 'REMOVE_FLOATING_TEXT', payload: string }
  | { type: 'ADD_COMMAND_MARKER', payload: CommandMarker }
  | { type: 'REMOVE_COMMAND_MARKER', payload: string }
  | { type: 'ADD_EXPLOSION_MARKER', payload: ExplosionMarker }
  | { type: 'REMOVE_EXPLOSION_MARKER', payload: string }
  | { type: 'WORKER_FINISH_DROPOFF'; payload: { workerId: string } }
  | { type: 'ADD_PROJECTILE', payload: Projectile }
  | { type: 'UPDATE_PROJECTILE', payload: Partial<Projectile> & { id: string } }
  | { type: 'REMOVE_PROJECTILE', payload: string }
  | { type: 'CHANGE_STANCE'; payload: { unitIds: string[]; stance: UnitStance } }
  | { type: 'SET_GAME_STATUS'; payload: GameState['gameStatus'] }
  | { type: 'CONTRIBUTE_TO_BUILDING', payload: { buildingId: string, contribution: number } }
  | { type: 'START_RESEARCH', payload: { buildingId: string, researchType: ResearchCategory } }
  | { type: 'CANCEL_RESEARCH', payload: { buildingId: string } }
  | { type: 'UPDATE_RESEARCH', payload: { playerId: number, researchType: ResearchCategory } }
  | { type: 'UPGRADE_TOWER', payload: { buildingId: string } }
  | { type: 'SET_RALLY_POINT'; payload: { buildingId: string; position: Vector3 } }
  | { type: 'TRADE_RESOURCES', payload: { playerId: number, trade: 'buy_wood' | 'sell_wood' } }
  | { type: 'PAUSE_GAME' }
  | { type: 'RESUME_GAME' }
  | { type: 'BATCH_UPDATE'; payload: BatchUpdatePayload }
  | { type: 'DEBUG_SPAWN_UNITS'; payload: { playerId: number, unitType: UnitType, count: number, position: Vector3 } }
  | { type: 'UPDATE_TRAINING_PROGRESS'; payload: { buildingId: string, progress: number } };
