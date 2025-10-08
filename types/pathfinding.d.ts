declare module 'pathfinding' {
  const PathFinding: {
    Grid: new (width: number, height: number, matrix?: number[][]) => any;
    JumpPointFinder: new (options?: any) => { findPath: (sx: number, sy: number, ex: number, ey: number, grid: any) => number[][] };
    DiagonalMovement: Record<string, number>;
    Heuristic: Record<string, (dx: number, dy: number) => number>;
  };
  export default PathFinding;
}
