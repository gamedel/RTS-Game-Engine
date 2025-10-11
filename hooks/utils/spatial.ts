// hooks/utils/spatial.ts
type CellKey = string;

export class SpatialHash {
  private readonly cellSize: number;
  private readonly map = new Map<CellKey, string[]>();
  private readonly pool: string[][] = [];

  constructor(cellSize = 2) {
    this.cellSize = cellSize;
  }

  private key(x: number, z: number): CellKey {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    return `${cx},${cz}`;
  }

  private acquire(): string[] {
    const fromPool = this.pool.pop();
    if (fromPool) {
      fromPool.length = 0;
      return fromPool;
    }
    return [];
  }

  public clear() {
    for (const bucket of this.map.values()) {
      bucket.length = 0;
      this.pool.push(bucket);
    }
    this.map.clear();
  }

  public insert(id: string, x: number, z: number) {
    const k = this.key(x, z);
    let bucket = this.map.get(k);
    if (!bucket) {
      bucket = this.acquire();
      this.map.set(k, bucket);
    }
    bucket.push(id);
  }

  // Query for objects in the 3x3 grid of cells around the given position.
  // Pass an optional target array to reuse allocations across frames.
  public queryNeighbors(x: number, z: number, out?: string[]): string[] {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    const result: string[] = out ?? [];
    result.length = 0;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const bucket = this.map.get(`${cx + dx},${cz + dz}`);
        if (bucket && bucket.length) {
          result.push(...bucket);
        }
      }
    }

    return result;
  }
}
