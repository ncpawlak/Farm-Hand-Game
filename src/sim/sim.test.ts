import { describe, expect, it } from 'vitest';
import { CONFIG, CROPS, ITEMS, RECIPES } from '../config';
import { computeConnected, findRoute } from './pathfinding';
import { catchUp, loadWorld, saveWorld, type StorageLike } from './save';
import { advance } from './simulate';
import type { BinBuilding, ConveyorBuilding, IndustryBuilding, PlotBuilding } from './types';
import { stockCount, World } from './world';

function memoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** House at (0,0), path (3,1)-(4,1), plot at (5,1), bin at (4,2). */
function starterFarm(): { world: World; plot: PlotBuilding } {
  const world = new World();
  expect(world.place('house', 0, 0).ok).toBe(true);
  expect(world.place('path', 3, 1).ok).toBe(true);
  expect(world.place('path', 4, 1).ok).toBe(true);
  expect(world.place('plot', 5, 1).ok).toBe(true);
  expect(world.place('bin', 4, 2).ok).toBe(true);
  const plot = world.buildingAt(5, 1) as PlotBuilding;
  return { world, plot };
}

const wheat = CROPS.wheat;
const cycleSeconds = wheat.tillSeconds + wheat.plantSeconds + wheat.growSeconds + wheat.harvestSeconds;

describe('placement', () => {
  it('charges money and rejects overlap, out-of-bounds and unaffordable builds', () => {
    const world = new World();
    expect(world.place('house', 0, 0).ok).toBe(true);
    expect(world.money).toBe(CONFIG.startingMoney - CONFIG.costs.house);
    expect(world.place('plot', 2, 2)).toEqual({ ok: false, reason: 'Space is taken' });
    expect(world.place('house', CONFIG.grid.width - 2, 0)).toEqual({ ok: false, reason: 'Out of bounds' });
    world.state.money = 10;
    expect(world.place('plot', 10, 10)).toEqual({ ok: false, reason: 'Not enough money' });
  });

  it('merges four plots in a 2x2 square into one big plot', () => {
    const world = new World();
    world.place('plot', 5, 5);
    world.place('plot', 6, 5);
    world.place('plot', 5, 6);
    expect(world.state.buildings.filter((b) => b.type === 'plot')).toHaveLength(3);
    world.place('plot', 6, 6);
    const plots = world.state.buildings.filter((b) => b.type === 'plot');
    expect(plots).toHaveLength(1);
    expect(plots[0]).toMatchObject({ x: 5, y: 5, w: 2, h: 2, cost: 4 * CONFIG.costs.plot });
    expect(world.buildingAt(6, 6)?.id).toBe(plots[0].id);
  });

  it('keeps one worker and sends the rest home when plots merge', () => {
    const world = new World();
    world.state.money = 10_000;
    world.place('house', 0, 0);
    const cells = [[5, 5], [6, 5], [5, 6]];
    for (const [x, y] of cells) {
      world.place('plot', x, y);
      world.assignWorker(world.buildingAt(x, y)!.id);
    }
    world.place('plot', 6, 6);
    const big = world.buildingAt(5, 5) as PlotBuilding;
    expect(big.w).toBe(2);
    const assigned = world.state.workers.filter((w) => w.plotId != null);
    expect(assigned).toHaveLength(1);
    expect(big.workerId).toBe(assigned[0].id);
  });

  it('refunds half the cost on demolish', () => {
    const world = new World();
    world.place('plot', 1, 1);
    const id = world.buildingAt(1, 1)!.id;
    const before = world.money;
    expect(world.demolish(id).ok).toBe(true);
    expect(world.money).toBe(before + CONFIG.costs.plot * CONFIG.demolishRefund);
    expect(world.buildingAt(1, 1)).toBeUndefined();
  });

  it('will not demolish a house that workers need', () => {
    const { world, plot } = starterFarm();
    world.assignWorker(plot.id);
    const house = world.buildingAt(0, 0)!;
    expect(world.demolish(house.id).ok).toBe(false);
  });
});

describe('workers', () => {
  it('requires a house with a free bed to hire', () => {
    const world = new World();
    world.place('plot', 5, 5);
    expect(world.assignWorker(world.buildingAt(5, 5)!.id)).toEqual({
      ok: false,
      reason: 'Build an employee house first',
    });
    world.place('house', 0, 0);
    world.state.money = 1000;
    for (let i = 0; i < CONFIG.houseBeds; i++) expect(world.hireWorker().ok).toBe(true);
    expect(world.hireWorker().ok).toBe(false);
  });

  it('runs the full till → plant → grow → harvest → deliver loop', () => {
    const { world, plot } = starterFarm();
    expect(world.assignWorker(plot.id).ok).toBe(true);
    const worker = world.state.workers[0];

    advance(world, 3);
    expect(worker.task).toBe('tilling');
    advance(world, wheat.tillSeconds);
    expect(plot.stage).toBe('tilled');
    advance(world, wheat.plantSeconds);
    expect(plot.stage).toBe('planted');
    expect(worker.task).toBe('tending');
    advance(world, wheat.growSeconds);
    expect(plot.stage).toBe('ready');
    advance(world, wheat.harvestSeconds + 3);

    const bin = world.buildingAt(4, 2);
    expect(bin?.type === 'bin' && bin.stock.wheat).toBe(wheat.yieldPerTile);
    expect(worker.carrying).toBeNull();
  });

  it('big plots take the same time and yield 4x', () => {
    const world = new World();
    world.state.money = 10_000;
    world.place('house', 0, 0);
    world.place('path', 3, 1);
    world.place('bin', 3, 2);
    for (const [x, y] of [[4, 1], [5, 1], [4, 2], [5, 2]]) world.place('plot', x, y);
    const big = world.buildingAt(4, 1) as PlotBuilding;
    expect(big.w).toBe(2);
    world.assignWorker(big.id);
    advance(world, cycleSeconds + 8);
    const bin = world.buildingAt(3, 2);
    expect(bin?.type === 'bin' && bin.stock.wheat).toBe(4 * wheat.yieldPerTile);
  });

  it('waits when the field is not connected by a path', () => {
    const world = new World();
    world.place('house', 0, 0);
    world.place('plot', 8, 8);
    const plot = world.buildingAt(8, 8) as PlotBuilding;
    world.assignWorker(plot.id);
    advance(world, 5);
    const w = world.state.workers[0];
    expect(w.inside).toBe(true);
    expect(w.blocked).toBe('No path to field');
    expect(world.connected.has(plot.id)).toBe(false);

    for (let y = 1; y < 8; y++) world.place('path', 3, y);
    for (let x = 3; x < 8; x++) world.place('path', x, 8);
    expect(world.connected.has(plot.id)).toBe(true);
    advance(world, 10);
    expect(w.blocked).toBeNull();
    expect(w.inside).toBe(false);
  });

  it('walks home after being unassigned', () => {
    const { world, plot } = starterFarm();
    world.assignWorker(plot.id);
    advance(world, 4);
    expect(world.unassignWorker(plot.id).ok).toBe(true);
    advance(world, 5);
    const w = world.state.workers[0];
    expect(w.inside).toBe(true);
    expect(w.plotId).toBeNull();
    expect(plot.workerId).toBeNull();
  });
});

describe('bins', () => {
  it('sells stock for money', () => {
    const { world } = starterFarm();
    const bin = world.buildingAt(4, 2)!;
    if (bin.type !== 'bin') throw new Error('expected bin');
    bin.stock.wheat = 10;
    const before = world.money;
    expect(world.sellBin(bin.id)).toEqual({ ok: true, earned: 10 * ITEMS.wheat.sellPrice });
    expect(world.money).toBe(before + 10 * ITEMS.wheat.sellPrice);
    expect(world.sellBin(bin.id).ok).toBe(false);
  });
});

/** starterFarm plus a workshop at (4,4) (its bin lands on (6,5)), linked by a path down column 3. */
function workshopFarm() {
  const { world, plot } = starterFarm();
  world.state.money = 10_000;
  for (const y of [2, 3, 4]) expect(world.place('path', 3, y).ok).toBe(true);
  expect(world.place('industry', 4, 4).ok).toBe(true);
  const ind = world.buildingAt(4, 4) as IndustryBuilding;
  const farmBin = world.buildingAt(4, 2) as BinBuilding;
  const outBin = world.getBin(ind.binId)!;
  return { world, plot, ind, farmBin, outBin };
}

describe('workshops', () => {
  it('places a 2x2 workshop with an attached output bin', () => {
    const { world, ind, outBin } = workshopFarm();
    expect(ind).toMatchObject({ type: 'industry', w: 2, h: 2, recipe: 'flour' });
    expect(outBin).toMatchObject({ x: 6, y: 5, industryId: ind.id });
    expect(world.connected.has(ind.id)).toBe(true);
    expect(world.connected.has(outBin.id)).toBe(true);
    // The bin cell must be free too.
    world.place('path', 12, 13);
    expect(world.place('industry', 10, 12)).toEqual({ ok: false, reason: 'Space is taken' });
  });

  it('demolishing the attached bin removes the whole workshop and pays out its goods', () => {
    const { world, ind, outBin } = workshopFarm();
    outBin.stock.flour = 2;
    ind.storage.wheat = 4;
    const before = world.money;
    expect(world.demolish(outBin.id).ok).toBe(true);
    expect(world.getBuilding(ind.id)).toBeUndefined();
    expect(world.getBuilding(outBin.id)).toBeUndefined();
    const expected = 2 * ITEMS.flour.sellPrice + 4 * ITEMS.wheat.sellPrice + CONFIG.costs.industry * CONFIG.demolishRefund;
    expect(world.money).toBe(before + expected);
  });

  it('hauler brings wheat in and crafter makes goods into the output bin', () => {
    const { world, ind, farmBin, outBin } = workshopFarm();
    farmBin.stock.wheat = 7;
    expect(world.assignIndustryWorker(ind.id, 'hauler').ok).toBe(true);
    expect(world.assignIndustryWorker(ind.id, 'crafter').ok).toBe(true);
    expect(world.assignIndustryWorker(ind.id, 'crafter').ok).toBe(false);

    advance(world, 60);
    // 7 wheat -> 3 flour (2 each) with 1 wheat left over in storage.
    expect(outBin.stock.flour).toBe(3);
    expect(farmBin.stock.wheat ?? 0).toBe(0);
    expect(ind.storage.wheat).toBe(1);
    expect(world.state.stats.crafted).toBe(3);
    const crafter = world.getWorker(ind.crafterId)!;
    expect(['waiting', 'idle']).toContain(crafter.task);
    expect(crafter.status).toBe('Waiting for wheat');
  });

  it('follows the chosen recipe', () => {
    const { world, ind, outBin } = workshopFarm();
    ind.storage.wheat = 6;
    expect(world.setRecipe(ind.id, 'bread').ok).toBe(true);
    world.assignIndustryWorker(ind.id, 'crafter');
    advance(world, 2 * RECIPES.bread.craftSeconds + 30);
    expect(outBin.stock.bread).toBe(2);
    expect(outBin.stock.flour).toBeUndefined();
  });

  it('farmers never deliver into a workshop bin', () => {
    const { world, plot, farmBin, outBin } = workshopFarm();
    world.assignWorker(plot.id);
    advance(world, cycleSeconds + 8);
    expect(farmBin.stock.wheat).toBe(1);
    expect(outBin.stock.wheat).toBeUndefined();
  });

  it('returns inputs to storage when the crafter is sent home mid-craft', () => {
    const { world, ind } = workshopFarm();
    ind.storage.wheat = 2;
    world.assignIndustryWorker(ind.id, 'crafter');
    advance(world, 8);
    expect(ind.crafting).toBe('flour');
    expect(ind.storage.wheat).toBe(0);
    expect(world.unassignIndustryWorker(ind.id, 'crafter').ok).toBe(true);
    expect(ind.crafting).toBeNull();
    expect(ind.storage.wheat).toBe(2);
  });

  it('a hauler auto-routes to keep every connected workshop supplied', () => {
    const { world, ind, farmBin } = workshopFarm();
    for (const y of [5, 6, 7]) expect(world.place('path', 3, y).ok).toBe(true);
    expect(world.place('industry', 4, 7).ok).toBe(true);
    const second = world.buildingAt(4, 7) as IndustryBuilding;
    world.setRecipe(second.id, 'bread');
    farmBin.stock.wheat = 20;
    expect(world.assignIndustryWorker(ind.id, 'hauler').ok).toBe(true);

    advance(world, 90);
    expect(stockCount(ind.storage)).toBeGreaterThan(0);
    expect(stockCount(second.storage)).toBeGreaterThan(0);
    expect(stockCount(ind.storage) + stockCount(second.storage)).toBe(20);
    expect(Math.abs(stockCount(ind.storage) - stockCount(second.storage))).toBeLessThanOrEqual(CONFIG.industry.haulCapacity);
  });

  it('haulers never overfill a workshop', () => {
    const { world, ind, farmBin } = workshopFarm();
    farmBin.stock.wheat = 60;
    expect(world.assignIndustryWorker(ind.id, 'hauler').ok).toBe(true);
    for (const y of [5, 6, 7]) expect(world.place('path', 3, y).ok).toBe(true);
    expect(world.place('industry', 4, 7).ok).toBe(true);
    const second = world.buildingAt(4, 7) as IndustryBuilding;
    expect(world.assignIndustryWorker(second.id, 'hauler').ok).toBe(true);

    advance(world, 180);
    expect(stockCount(ind.storage)).toBe(CONFIG.industry.storageCapacity);
    expect(stockCount(second.storage)).toBe(CONFIG.industry.storageCapacity);
    expect(farmBin.stock.wheat).toBe(60 - 2 * CONFIG.industry.storageCapacity);
    for (const w of world.state.workers) expect(w.carrying).toBeNull();
    expect(world.getWorker(ind.haulerId)!.status).toBe('Workshops are full');
  });
});

describe('pathfinding', () => {
  it('only walks on paths and source/target buildings', () => {
    const { world, plot } = starterFarm();
    const route = findRoute(world, { x: 1, y: 1 }, (b) => b.id === plot.id, world.buildingAt(1, 1)!.id);
    expect(route?.at(-1)).toEqual({ x: 5, y: 1 });
    expect(findRoute(world, { x: 1, y: 1 }, (b) => b.id === plot.id, null)).toBeNull();
    expect(computeConnected(world, world.state.buildings).has(plot.id)).toBe(true);
  });
});

describe('save & offline progress', () => {
  it('round-trips state and catches up elapsed time', () => {
    const { world, plot } = starterFarm();
    world.assignWorker(plot.id);
    const storage = memoryStorage();
    saveWorld(world, storage);

    const loaded = loadWorld(storage)!;
    expect(loaded.state.buildings).toHaveLength(world.state.buildings.length);
    const summary = catchUp(loaded, 10 * 60);
    expect(summary.seconds).toBe(600);
    expect(summary.harvested).toBeGreaterThanOrEqual(10);
  });

  it('caps offline time', () => {
    const world = new World();
    expect(catchUp(world, 10 * 24 * 3600).seconds).toBe(CONFIG.sim.maxOfflineSeconds);
  });

  it('upgrades saves from before workshops existed', () => {
    const { world, plot } = starterFarm();
    world.assignWorker(plot.id);
    const old = JSON.parse(JSON.stringify(world.state));
    delete old.stats;
    for (const w of old.workers) {
      delete w.industryId;
      delete w.role;
      delete w.status;
      w.carrying = { crop: 'wheat', amount: 1 };
    }
    const storage = memoryStorage();
    storage.setItem(CONFIG.saveKey, JSON.stringify(old));
    const loaded = loadWorld(storage)!;
    expect(loaded.state.stats).toEqual({ harvested: 0, crafted: 0 });
    expect(loaded.state.workers[0]).toMatchObject({ industryId: null, role: null, carrying: { item: 'wheat', amount: 1 } });
  });

  it('rejects corrupt saves', () => {
    const storage = memoryStorage();
    storage.setItem(CONFIG.saveKey, '{not json');
    expect(loadWorld(storage)).toBeNull();
  });
});

/** Workshop at (0,0) with its output bin at (2,1). */
function beltWorld() {
  const world = new World();
  world.state.money = 100_000;
  expect(world.place('industry', 0, 0).ok).toBe(true);
  const source = world.getBin((world.buildingAt(0, 0) as IndustryBuilding).binId)!;
  return { world, source };
}

/** Lays belts through `cells` in order, each pointing at the next (the last points `lastDir`). */
function lay(world: World, cells: [number, number][], last: [number, number]) {
  for (const [x, y] of cells) expect(world.place('conveyor', x, y).ok).toBe(true);
  const all = [...cells, last];
  for (let i = 0; i < cells.length; i++) {
    expect(world.linkConveyor(all[i][0], all[i][1], all[i + 1][0], all[i + 1][1], true).ok).toBe(true);
  }
}

describe('conveyors', () => {
  it('carry goods from a workshop output bin into an industry', () => {
    const { world, source } = beltWorld();
    expect(world.place('factory', 6, 0).ok).toBe(true);
    const factory = world.buildingAt(6, 0) as IndustryBuilding;
    expect(factory).toMatchObject({ kind: 'industry', recipe: 'pastry' });
    lay(world, [[3, 1], [4, 1], [5, 1]], [6, 1]);
    source.stock.flour = 4;
    advance(world, 10);
    expect(factory.storage.flour).toBe(4);
    expect(stockCount(source.stock)).toBe(0);
  });

  it('only lets an industry take the input its recipe needs', () => {
    const { world, source } = beltWorld();
    world.place('factory', 6, 0);
    const factory = world.buildingAt(6, 0) as IndustryBuilding;
    lay(world, [[3, 1], [4, 1], [5, 1]], [6, 1]);
    source.stock.bread = 2;
    advance(world, 10);
    expect(stockCount(factory.storage)).toBe(0);
    expect((world.buildingAt(5, 1) as ConveyorBuilding).item?.id).toBe('bread');
  });

  it('merges two lines in zipper order', () => {
    const { world, source } = beltWorld();
    world.place('industry', 0, 4);
    const source2 = world.getBin((world.buildingAt(0, 4) as IndustryBuilding).binId)!;
    world.place('bin', 6, 3);
    lay(world, [[3, 1], [4, 1], [4, 2]], [4, 3]);
    lay(world, [[3, 5], [4, 5], [4, 4]], [4, 3]);
    lay(world, [[4, 3], [5, 3]], [6, 3]);
    source.stock.flour = 20;
    source2.stock.bread = 20;
    const merge = world.buildingAt(4, 3) as ConveyorBuilding;
    const seen: string[] = [];
    let last: unknown = null;
    for (let i = 0; i < 600 && seen.length < 10; i++) {
      advance(world, 0.05);
      if (merge.item && merge.item !== last) seen.push(merge.item.id);
      last = merge.item;
    }
    expect(seen.length).toBe(10);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
  });

  it('splits round-robin between outputs', () => {
    const { world, source } = beltWorld();
    const north = world.place('bin', 4, 0) && (world.buildingAt(4, 0) as BinBuilding);
    const south = world.place('bin', 4, 2) && (world.buildingAt(4, 2) as BinBuilding);
    lay(world, [[3, 0]], [4, 0]);
    lay(world, [[3, 2]], [4, 2]);
    expect(world.place('conveyor', 3, 1).ok).toBe(true);
    world.linkConveyor(3, 1, 3, 0, true);
    world.linkConveyor(3, 1, 3, 2, false);
    expect((world.buildingAt(3, 1) as ConveyorBuilding).outs).toEqual([3, 1]);
    source.stock.flour = 6;
    advance(world, 15);
    expect(north.stock.flour).toBe(3);
    expect(south.stock.flour).toBe(3);
  });

  it('turns when tapped and branching drops outputs that lead nowhere', () => {
    const world = new World();
    world.place('conveyor', 5, 5);
    const c = world.buildingAt(5, 5) as ConveyorBuilding;
    world.rotateConveyor(c.id);
    expect(c.outs).toEqual([0]);
    world.rotateConveyor(c.id);
    expect(c.outs).toEqual([1]);
    world.place('conveyor', 4, 5);
    world.linkConveyor(5, 5, 4, 5, false);
    expect(c.outs).toEqual([2]);
  });
});

describe('bridges', () => {
  it('crossing a path and a conveyor makes a bridge automatically', () => {
    const world = new World();
    world.place('path', 5, 5);
    const money = world.money;
    expect(world.place('conveyor', 5, 5).ok).toBe(true);
    expect(world.buildingAt(5, 5)).toMatchObject({ type: 'conveyor', bridge: true });
    expect(world.money).toBe(money - CONFIG.costs.conveyor);

    world.place('conveyor', 6, 5);
    expect(world.place('path', 6, 5).ok).toBe(true);
    expect(world.buildingAt(6, 5)).toMatchObject({ type: 'conveyor', bridge: true });
    expect(world.place('path', 6, 5).ok).toBe(false);

    // Removing a bridge leaves the path.
    world.demolish(world.buildingAt(6, 5)!.id);
    expect(world.buildingAt(6, 5)?.type).toBe('path');
  });

  it('workers cannot cross plain belts but can cross bridges', () => {
    const { world, plot } = starterFarm();
    world.demolish(world.buildingAt(4, 1)!.id);
    world.place('conveyor', 4, 1);
    expect(world.connected.has(plot.id)).toBe(false);
    world.place('path', 4, 1);
    expect(world.connected.has(plot.id)).toBe(true);
  });
});

describe('industry', () => {
  it('a crafter turns conveyed flour into pastries', () => {
    const { world } = workshopFarm();
    for (const y of [5, 6, 7]) expect(world.place('path', 3, y).ok).toBe(true);
    expect(world.place('factory', 4, 7).ok).toBe(true);
    const factory = world.buildingAt(4, 7) as IndustryBuilding;
    expect(world.connected.has(factory.id)).toBe(true);
    expect(world.assignIndustryWorker(factory.id, 'hauler').ok).toBe(false);
    expect(world.setRecipe(factory.id, 'bread').ok).toBe(false);
    expect(world.assignIndustryWorker(factory.id, 'crafter').ok).toBe(true);
    factory.storage.flour = 4;
    advance(world, 60);
    expect(world.getBin(factory.binId)!.stock.pastry).toBe(2);
    expect(factory.storage.flour ?? 0).toBe(0);
  });

  it('old saves load workshops as workshops', () => {
    const { world } = workshopFarm();
    const old = JSON.parse(JSON.stringify(world.state));
    for (const b of old.buildings) delete b.kind;
    const storage = memoryStorage();
    storage.setItem(CONFIG.saveKey, JSON.stringify(old));
    const loaded = loadWorld(storage)!;
    expect(loaded.buildingAt(4, 4)).toMatchObject({ type: 'industry', kind: 'workshop' });
  });
});
