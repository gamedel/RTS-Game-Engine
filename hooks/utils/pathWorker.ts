/// <reference lib="webworker" />
import { Grid, JumpPointFinder, DiagonalMovement } from 'pathfinding';

let gridMatrix: number[][] | null = null;
let baseGrid: Grid | null = null;
const finder = new JumpPointFinder({ diagonalMovement: DiagonalMovement.IfAtMostOneObstacle });

function clampToGrid(node: { x: number; y: number }, W: number, H: number) {
  if (node.x < 0 || node.x >= W) node.x = Math.max(0, Math.min(W - 1, node.x));
  if (node.y < 0 || node.y >= H) node.y = Math.max(0, Math.min(H - 1, node.y));
}

function findNearestWalkable(grid: number[][], start: { x: number; y: number }): { x: number; y: number } | null {
  const H = grid.length;
  const W = grid[0]?.length || 0;
  const visited = new Set<string>();
  const queue: Array<{ x: number; y: number; d: number }> = [{ ...start, d: 0 }];
  const directions = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1]
  ];
  const MAX_DISTANCE = 30;

  while (queue.length > 0) {
    const { x, y, d } = queue.shift()!;
    if (x < 0 || x >= W || y < 0 || y >= H) continue;
    const key = `${x},${y}`;
    if (visited.has(key)) continue;
    visited.add(key);
    if (grid[y][x] === 0) return { x, y };
    if (d >= MAX_DISTANCE) continue;
    for (const [dx, dy] of directions) {
      queue.push({ x: x + dx, y: y + dy, d: d + 1 });
    }
  }
  return null;
}

self.onmessage = (e: MessageEvent) => {
  const data = e.data as any;
  if (data.type === 'setGrid') {
    gridMatrix = data.grid as number[][];
    baseGrid = new Grid(gridMatrix);
    (self as any).postMessage({ type: 'gridReady' });
    return;
  } else if (data.type === 'findPath' && gridMatrix && baseGrid) {
    const { id, start, end } = data;
    const H = gridMatrix.length;
    const W = gridMatrix[0]?.length || 0;
    let s = { ...start };
    let t = { ...end };
    clampToGrid(s, W, H);
    clampToGrid(t, W, H);

    if (gridMatrix[s.y]?.[s.x] === 1) {
      const alt = findNearestWalkable(gridMatrix, s);
      if (alt) {
        s = alt;
      } else {
        (self as any).postMessage({ type: 'path', id, path: [] });
        return;
      }
    }

    if (gridMatrix[t.y]?.[t.x] === 1) {
      const alt = findNearestWalkable(gridMatrix, t);
      if (alt) {
        t = alt;
      } else {
        (self as any).postMessage({ type: 'path', id, path: [] });
        return;
      }
    }

    const grid = baseGrid.clone();
    const rawPath = finder.findPath(s.x, s.y, t.x, t.y, grid);
    (self as any).postMessage({ type: 'path', id, path: rawPath });
  }
};

export {}; // ensure this file is treated as a module
