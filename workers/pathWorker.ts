import PathFinding = require('@screeps/pathfinding');

type InitMessage = {
  type: 'init';
  width: number;
  height: number;
  matrix: ArrayLike<number>;
};

type UpdateMessage = {
  type: 'update';
  x: number;
  y: number;
  weight: number;
};

type PathRequestMessage = {
  type: 'path';
  id: number;
  start: [number, number];
  goal: [number, number];
};

type IncomingMessage = InitMessage | UpdateMessage | PathRequestMessage;

type PathResultMessage =
  | {
      type: 'path-result';
      id: number;
      path: Array<[number, number]>;
      reachedGoal: boolean;
      elapsedMs: number;
    }
  | {
      type: 'path-result';
      id: number;
      error: string;
    };

type InitResultMessage = {
  type: 'init-complete';
};

type OutgoingMessage = PathResultMessage | InitResultMessage;

let grid: any | null = null;
let finder: any | null = null;
let gridWidth = 0;
let gridHeight = 0;

const resetGridState = () => {
  if (!grid) return;
  const nodes = grid.nodes;
  for (let y = 0; y < gridHeight; y++) {
    const row = nodes[y];
    for (let x = 0; x < gridWidth; x++) {
      const node = row[x];
      if (node.opened || node.closed || node.parent) {
        node.opened = false;
        node.closed = false;
        node.parent = null;
        node.g = 0;
        node.h = 0;
        node.f = 0;
      }
    }
  }
};

const handleInit = (msg: InitMessage) => {
  gridWidth = msg.width;
  gridHeight = msg.height;
  const matrix2d: number[][] = [];
  let index = 0;
  for (let y = 0; y < gridHeight; y++) {
    const row: number[] = [];
    for (let x = 0; x < gridWidth; x++, index++) {
      row.push(msg.matrix[index] ? 1 : 0);
    }
    matrix2d.push(row);
  }

  grid = new PathFinding.Grid(gridWidth, gridHeight, matrix2d);
  finder = new PathFinding.JumpPointFinder({
    diagonalMovement: PathFinding.DiagonalMovement.OnlyWhenNoObstacle
  });

  const message: InitResultMessage = { type: 'init-complete' };
  (self as unknown as Worker).postMessage(message);
};

const handleUpdate = (msg: UpdateMessage) => {
  if (!grid) return;
  if (msg.x < 0 || msg.x >= gridWidth || msg.y < 0 || msg.y >= gridHeight) return;
  const weight = msg.weight > 0 ? 1 : 0;
  const node = grid.nodes[msg.y][msg.x];
  node.weight = weight;
  node.walkable = weight > 0;
};

const handlePathRequest = (msg: PathRequestMessage) => {
  if (!grid || !finder) {
    const response: PathResultMessage = {
      type: 'path-result',
      id: msg.id,
      error: 'not-initialized'
    };
    (self as unknown as Worker).postMessage(response);
    return;
  }

  resetGridState();

  const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const path: Array<[number, number]> = finder.findPath(
    msg.start[0],
    msg.start[1],
    msg.goal[0],
    msg.goal[1],
    grid
  );
  const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startTime;

  if (!path || path.length === 0) {
    const response: PathResultMessage = {
      type: 'path-result',
      id: msg.id,
      error: 'no-path-found'
    };
    (self as unknown as Worker).postMessage(response);
    return;
  }

  const last = path[path.length - 1];
  const reachedGoal = last[0] === msg.goal[0] && last[1] === msg.goal[1];

  const response: PathResultMessage = {
    type: 'path-result',
    id: msg.id,
    path,
    reachedGoal,
    elapsedMs: elapsed
  };
  (self as unknown as Worker).postMessage(response);
};

(self as unknown as Worker).onmessage = (event: MessageEvent<IncomingMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'init':
      handleInit(message);
      break;
    case 'update':
      handleUpdate(message);
      break;
    case 'path':
      handlePathRequest(message);
      break;
    default:
      break;
  }
};

export {};
