import type { Building, Point } from './types';

export interface GridLookup {
  width: number;
  height: number;
  buildingAt(x: number, y: number): Building | undefined;
}

const DIRS: Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export function isWalkable(b: Building): boolean {
  return b.type === 'path' || (b.type === 'conveyor' && b.bridge);
}

/**
 * Breadth-first search from `start` (a cell) along path tiles to the nearest cell
 * belonging to a building matching `isTarget`. Cells of the building with id
 * `sourceId` are also walkable so workers can leave the house/field they are in.
 * Returns the cells to visit (excluding the start), or null when unreachable.
 */
export function findRoute(
  grid: GridLookup,
  start: Point,
  isTarget: (b: Building) => boolean,
  sourceId: number | null,
): Point[] | null {
  const { width, height } = grid;
  const startBuilding = grid.buildingAt(start.x, start.y);
  if (startBuilding && isTarget(startBuilding)) return [];

  const prev = new Int32Array(width * height).fill(-2);
  const startIdx = start.y * width + start.x;
  prev[startIdx] = -1;
  const queue: number[] = [startIdx];

  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head];
    const cx = idx % width;
    const cy = (idx - cx) / width;
    for (const d of DIRS) {
      const nx = cx + d.x;
      const ny = cy + d.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nIdx = ny * width + nx;
      if (prev[nIdx] !== -2) continue;
      const b = grid.buildingAt(nx, ny);
      if (!b) continue;
      if (isTarget(b)) {
        prev[nIdx] = idx;
        return reconstruct(prev, nIdx, width);
      }
      if (isWalkable(b) || b.id === sourceId) {
        prev[nIdx] = idx;
        queue.push(nIdx);
      }
    }
  }
  return null;
}

function reconstruct(prev: Int32Array, endIdx: number, width: number): Point[] {
  const out: Point[] = [];
  let idx = endIdx;
  while (prev[idx] !== -1) {
    const x = idx % width;
    out.push({ x, y: (idx - x) / width });
    idx = prev[idx];
  }
  return out.reverse();
}

/**
 * Ids of buildings reachable from any house through the path network
 * (a building directly touching a house or a connected path counts).
 */
export function computeConnected(grid: GridLookup, buildings: Building[]): Set<number> {
  const { width, height } = grid;
  const visited = new Uint8Array(width * height);
  const connected = new Set<number>();
  const queue: number[] = [];

  for (const b of buildings) {
    if (b.type !== 'house') continue;
    connected.add(b.id);
    for (let y = b.y; y < b.y + b.h; y++) {
      for (let x = b.x; x < b.x + b.w; x++) {
        const idx = y * width + x;
        visited[idx] = 1;
        queue.push(idx);
      }
    }
  }

  for (let head = 0; head < queue.length; head++) {
    const idx = queue[head];
    const cx = idx % width;
    const cy = (idx - cx) / width;
    for (const d of DIRS) {
      const nx = cx + d.x;
      const ny = cy + d.y;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nIdx = ny * width + nx;
      if (visited[nIdx]) continue;
      const b = grid.buildingAt(nx, ny);
      if (!b) continue;
      if (b.type === 'conveyor' && !b.bridge) continue;
      connected.add(b.id);
      if (isWalkable(b)) {
        visited[nIdx] = 1;
        queue.push(nIdx);
      }
    }
  }
  return connected;
}
