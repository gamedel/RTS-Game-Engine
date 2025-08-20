// hooks/utils/spatial.ts
type CellKey = string;

export class SpatialHash {
  private cellSize: number;
  private map = new Map<CellKey, string[]>();

  constructor(cellSize = 2) {
    this.cellSize = cellSize;
  }

  private key(x: number, z: number): CellKey {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    return `${cx},${cz}`;
  }

  public clear() {
    this.map.clear();
  }

  public insert(id: string, x: number, z: number) {
    const k = this.key(x, z);
    const arr = this.map.get(k) || [];
    arr.push(id);
    this.map.set(k, arr);
  }

  // Query for objects in the 3x3 grid of cells around the given position
  public queryNeighbors(x: number, z: number): string[] {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    const out: string[] = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const arr = this.map.get(`${cx + dx},${cz + dz}`);
        if (arr) {
          out.push(...arr);
        }
      }
    }
    return out;
  }
}