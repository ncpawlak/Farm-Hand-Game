import { CONFIG, RECIPES, type ItemId } from '../config';
import type { BinBuilding, Building, ConveyorBuilding, Dir, Point } from './types';
import { stockCount, type World } from './world';

/** Unit offsets for each Dir (east, south, west, north). */
export const DIRS: readonly Point[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

export function opposite(d: Dir): Dir {
  return ((d + 2) % 4) as Dir;
}

/** Direction from cell a to an orthogonally adjacent cell b, or null when not adjacent. */
export function dirBetween(a: Point, b: Point): Dir | null {
  const i = DIRS.findIndex((d) => d.x === b.x - a.x && d.y === b.y - a.y);
  return i < 0 ? null : (i as Dir);
}

export function neighbor(world: World, b: Point, d: Dir): Building | undefined {
  return world.buildingAt(b.x + DIRS[d].x, b.y + DIRS[d].y);
}

/** Workshop/industry output bins hand their goods to any touching belt that doesn't point into them. */
export function isSourceBin(b: Building | undefined): b is BinBuilding {
  return b?.type === 'bin' && b.industryId != null;
}

/** Sides of a belt that something feeds into it from (other belts or a source bin). */
export function feederSides(world: World, c: ConveyorBuilding): Dir[] {
  const sides: Dir[] = [];
  for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
    if (c.outs.includes(d)) continue;
    const n = neighbor(world, c, d);
    if (n?.type === 'conveyor' && n.outs.includes(opposite(d))) sides.push(d);
    else if (isSourceBin(n)) sides.push(d);
  }
  return sides;
}

interface Offer {
  send: () => void;
  target: Building;
  item: ItemId;
  /** Side of the target the item enters from. */
  side: Dir;
}

/**
 * Moves items along belts. Each belt tile holds one item. When several inputs compete for the same
 * belt they zipper (take turns by side); a belt with several outputs splits round-robin, skipping
 * outputs that are blocked.
 */
export function updateConveyors(world: World, dt: number): void {
  const belts: ConveyorBuilding[] = [];
  const sources: BinBuilding[] = [];
  for (const b of world.state.buildings) {
    if (b.type === 'conveyor') belts.push(b);
    else if (isSourceBin(b) && stockCount(b.stock) > 0) sources.push(b);
  }
  if (belts.length === 0) return;

  const step = CONFIG.conveyor.speed * dt;
  for (const c of belts) if (c.item) c.item.p = Math.min(1, c.item.p + step);

  const offers = new Map<number, Offer[]>();
  const offer = (o: Offer) => {
    const list = offers.get(o.target.id);
    if (list) list.push(o);
    else offers.set(o.target.id, [o]);
  };

  for (const c of belts) {
    const item = c.item;
    if (!item || item.p < 1 || c.outs.length === 0) continue;
    const n = c.outs.length;
    for (let k = 0; k < n; k++) {
      const i = (c.nextOut + k) % n;
      const d = c.outs[i];
      const target = neighbor(world, c, d);
      if (!target || !accepts(target, item.id)) continue;
      offer({
        target,
        item: item.id,
        side: opposite(d),
        send: () => {
          c.item = null;
          c.nextOut = (i + 1) % n;
        },
      });
      break;
    }
  }

  for (const bin of sources) {
    const item = firstItem(bin);
    if (!item) continue;
    const start = bin.nextOut ?? 0;
    for (let k = 0; k < 4; k++) {
      const d = ((start + k) % 4) as Dir;
      const target = neighbor(world, bin, d);
      if (target?.type !== 'conveyor' || target.outs.includes(opposite(d)) || target.item) continue;
      offer({
        target,
        item,
        side: opposite(d),
        send: () => {
          bin.stock[item] = (bin.stock[item] ?? 0) - 1;
          if (!bin.stock[item]) delete bin.stock[item];
          bin.nextOut = (d + 1) % 4;
        },
      });
      break;
    }
  }

  for (const list of offers.values()) {
    const target = list[0].target;
    if (target.type === 'conveyor') {
      // Zipper: the side closest after `nextIn` goes first, then priority moves on.
      const rank = (o: Offer) => (o.side - target.nextIn + 4) % 4;
      const winner = list.reduce((a, b) => (rank(b) < rank(a) ? b : a));
      winner.send();
      target.item = { id: winner.item, p: 0, from: winner.side };
      target.nextIn = (winner.side + 1) % 4;
    } else {
      for (const o of list) {
        if (!accepts(target, o.item)) break;
        o.send();
        deliver(target, o.item);
      }
    }
  }
}

function accepts(target: Building, item: ItemId): boolean {
  switch (target.type) {
    case 'conveyor':
      return target.item == null;
    case 'bin':
      return !isSourceBin(target);
    case 'industry':
      return RECIPES[target.recipe].input === item && stockCount(target.storage) < CONFIG.industry.storageCapacity;
    default:
      return false;
  }
}

function deliver(target: Building, item: ItemId): void {
  if (target.type === 'bin') target.stock[item] = (target.stock[item] ?? 0) + 1;
  else if (target.type === 'industry') target.storage[item] = (target.storage[item] ?? 0) + 1;
}

function firstItem(bin: BinBuilding): ItemId | undefined {
  for (const [item, n] of Object.entries(bin.stock)) if ((n ?? 0) > 0) return item as ItemId;
  return undefined;
}
