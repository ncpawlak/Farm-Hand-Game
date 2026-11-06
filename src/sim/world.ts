import { CONFIG, ITEMS, RECIPES, type GoodId, type ItemId } from '../config';
import { DIRS, dirBetween, opposite } from './conveyor';
import { computeConnected, type GridLookup } from './pathfinding';
import type {
  BinBuilding,
  Building,
  BuildingType,
  ConveyorBuilding,
  Dir,
  GameState,
  HouseBuilding,
  IndustryBuilding,
  PlotBuilding,
  Point,
  Result,
  Worker,
  WorkerRole,
} from './types';

/** 'industry' places a Workshop; 'factory' places an Industry (both are IndustryBuildings). */
export type PlaceableType = BuildingType | 'factory';

const fail = (reason: string): Result => ({ ok: false, reason });
const OK: Result = { ok: true };

export function createNewState(): GameState {
  return {
    version: 1,
    width: CONFIG.grid.width,
    height: CONFIG.grid.height,
    money: CONFIG.startingMoney,
    nextId: 1,
    buildings: [],
    workers: [],
    stats: { harvested: 0, crafted: 0 },
    savedAt: Date.now(),
  };
}

/** Cells covered when placing `type` with its top-left at x,y (workshops include their output bin). */
export function footprintCells(type: PlaceableType, x: number, y: number): Point[] {
  const size = CONFIG.footprints[type];
  const cells: Point[] = [];
  for (let cy = y; cy < y + size; cy++) {
    for (let cx = x; cx < x + size; cx++) cells.push({ x: cx, y: cy });
  }
  if (type === 'industry' || type === 'factory') {
    const o = CONFIG.industry.binOffset;
    cells.push({ x: x + o.x, y: y + o.y });
  }
  return cells;
}

/** A worker with no field or workshop job. */
export function isIdleWorker(w: Worker): boolean {
  return w.plotId == null && w.industryId == null;
}

export class World implements GridLookup {
  readonly state: GameState;
  /** Building id per cell (0 = empty). */
  private cells: Int32Array;
  private byId = new Map<number, Building>();
  /** Incremented whenever the layout changes, so walking workers re-route. */
  layoutVersion = 0;
  connected = new Set<number>();

  constructor(state: GameState = createNewState()) {
    this.state = state;
    this.cells = new Int32Array(state.width * state.height);
    this.rebuild();
  }

  get width(): number {
    return this.state.width;
  }

  get height(): number {
    return this.state.height;
  }

  get money(): number {
    return this.state.money;
  }

  rebuild(): void {
    this.cells.fill(0);
    this.byId.clear();
    for (const b of this.state.buildings) {
      this.byId.set(b.id, b);
      for (let y = b.y; y < b.y + b.h; y++) {
        for (let x = b.x; x < b.x + b.w; x++) this.cells[y * this.width + x] = b.id;
      }
    }
    this.connected = computeConnected(this, this.state.buildings);
    // A workshop's output bin is reached through the workshop itself.
    for (const b of this.state.buildings) {
      if (b.type === 'industry' && this.connected.has(b.id)) this.connected.add(b.binId);
    }
    this.layoutVersion++;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  buildingAt(x: number, y: number): Building | undefined {
    if (!this.inBounds(x, y)) return undefined;
    const id = this.cells[y * this.width + x];
    return id ? this.byId.get(id) : undefined;
  }

  getBuilding(id: number | null | undefined): Building | undefined {
    return id == null ? undefined : this.byId.get(id);
  }

  getPlot(id: number | null | undefined): PlotBuilding | undefined {
    const b = this.getBuilding(id);
    return b?.type === 'plot' ? b : undefined;
  }

  getIndustry(id: number | null | undefined): IndustryBuilding | undefined {
    const b = this.getBuilding(id);
    return b?.type === 'industry' ? b : undefined;
  }

  getBin(id: number | null | undefined): BinBuilding | undefined {
    const b = this.getBuilding(id);
    return b?.type === 'bin' ? b : undefined;
  }

  getWorker(id: number | null | undefined): Worker | undefined {
    return id == null ? undefined : this.state.workers.find((w) => w.id === id);
  }

  bedCount(): number {
    return this.state.buildings.filter((b) => b.type === 'house').length * CONFIG.houseBeds;
  }

  // ---------------------------------------------------------------- building

  canPlace(type: PlaceableType, x: number, y: number): Result {
    const here = this.buildingAt(x, y);
    // Crossing a path and a belt makes a bridge automatically.
    if (type === 'conveyor' && here?.type === 'path') return this.afford(CONFIG.costs.conveyor);
    if (type === 'path' && here?.type === 'conveyor') {
      return here.bridge ? fail('Already a crossing') : this.afford(CONFIG.costs.path);
    }
    for (const c of footprintCells(type, x, y)) {
      if (!this.inBounds(c.x, c.y)) return fail('Out of bounds');
      if (this.buildingAt(c.x, c.y)) return fail('Space is taken');
    }
    return this.afford(CONFIG.costs[type]);
  }

  private afford(cost: number): Result {
    return this.state.money < cost ? fail('Not enough money') : OK;
  }

  place(type: PlaceableType, x: number, y: number): Result {
    const check = this.canPlace(type, x, y);
    if (!check.ok) return check;
    const here = this.buildingAt(x, y);
    if (type === 'path' && here?.type === 'conveyor') {
      here.bridge = true;
      here.cost += CONFIG.costs.path;
      this.state.money -= CONFIG.costs.path;
      this.rebuild();
      return OK;
    }
    if (type === 'conveyor' && here?.type === 'path') {
      // Swap the path for a bridged belt (keeps the path's value).
      this.state.buildings = this.state.buildings.filter((b) => b.id !== here.id);
      this.state.money -= CONFIG.costs.conveyor;
      this.state.buildings.push(this.newConveyor(x, y, true, here.cost + CONFIG.costs.conveyor));
      this.rebuild();
      return OK;
    }
    const size = CONFIG.footprints[type];
    const cost = CONFIG.costs[type];
    const base = { id: this.state.nextId++, x, y, w: size, h: size, cost };
    this.state.money -= cost;
    switch (type) {
      case 'plot':
        this.state.buildings.push({ ...base, type, crop: 'wheat', stage: 'untilled', growElapsed: 0, workerId: null });
        break;
      case 'bin':
        this.state.buildings.push({ ...base, type, stock: {} });
        break;
      case 'conveyor':
        this.state.buildings.push({ ...base, type, outs: [], bridge: false, item: null, nextOut: 0, nextIn: 0 });
        break;
      case 'industry':
      case 'factory': {
        const o = CONFIG.industry.binOffset;
        const bin: BinBuilding = {
          id: this.state.nextId++,
          type: 'bin',
          x: x + o.x,
          y: y + o.y,
          w: 1,
          h: 1,
          cost: 0,
          stock: {},
          industryId: base.id,
        };
        const industry: IndustryBuilding = {
          ...base,
          type: 'industry',
          kind: type === 'factory' ? 'industry' : 'workshop',
          recipe: type === 'factory' ? 'pastry' : 'flour',
          storage: {},
          crafting: null,
          binId: bin.id,
          crafterId: null,
          haulerId: null,
        };
        this.state.buildings.push(industry, bin);
        break;
      }
      default:
        this.state.buildings.push({ ...base, type });
    }
    this.rebuild();
    if (type === 'plot') this.tryMerge(x, y);
    return OK;
  }

  /** Merge four 1x1 plots forming a 2x2 square (containing x,y) into one big plot. */
  private tryMerge(x: number, y: number): void {
    for (let oy = y - 1; oy <= y; oy++) {
      for (let ox = x - 1; ox <= x; ox++) {
        const parts: PlotBuilding[] = [];
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const b = this.buildingAt(ox + dx, oy + dy);
            if (b?.type === 'plot' && b.w === 1) parts.push(b);
          }
        }
        if (parts.length !== 4) continue;

        const big: PlotBuilding = {
          id: this.state.nextId++,
          type: 'plot',
          x: ox,
          y: oy,
          w: 2,
          h: 2,
          cost: parts.reduce((sum, p) => sum + p.cost, 0),
          crop: 'wheat',
          stage: 'untilled',
          growElapsed: 0,
          workerId: null,
        };
        const partIds = new Set(parts.map((p) => p.id));
        const assigned = parts.map((p) => this.getWorker(p.workerId)).filter((w): w is Worker => !!w);
        this.state.buildings = this.state.buildings.filter((b) => !partIds.has(b.id));
        this.state.buildings.push(big);
        assigned.forEach((w, i) => {
          if (i === 0) {
            w.plotId = big.id;
            big.workerId = w.id;
            if (w.task !== 'walking') w.task = 'idle';
          } else {
            this.releaseWorker(w);
          }
        });
        this.rebuild();
        return;
      }
    }
  }

  private newConveyor(x: number, y: number, bridge: boolean, cost: number): ConveyorBuilding {
    return { id: this.state.nextId++, type: 'conveyor', x, y, w: 1, h: 1, cost, outs: [], bridge, item: null, nextOut: 0, nextIn: 0 };
  }

  /**
   * Points the belt at a towards the neighbouring cell b. `replace` makes it the only output;
   * otherwise it's added as a branch (dropping outputs that lead nowhere). A belt at b no longer
   * flows back into a.
   */
  linkConveyor(ax: number, ay: number, bx: number, by: number, replace: boolean): Result {
    const a = this.buildingAt(ax, ay);
    if (a?.type !== 'conveyor') return fail('Not a conveyor');
    const d = dirBetween({ x: ax, y: ay }, { x: bx, y: by });
    if (d == null) return fail('Not adjacent');
    const b = this.buildingAt(bx, by);
    if (b === a) return fail('Not adjacent');
    if (replace) a.outs = [d];
    else {
      a.outs = a.outs.filter((o) => o !== d && this.buildingAt(ax + DIRS[o].x, ay + DIRS[o].y));
      a.outs.push(d);
    }
    a.nextOut = 0;
    if (b?.type === 'conveyor') b.outs = b.outs.filter((o) => o !== opposite(d));
    return OK;
  }

  /** Turns a belt to face the next direction clockwise. */
  rotateConveyor(id: number): Result {
    const c = this.getBuilding(id);
    if (c?.type !== 'conveyor') return fail('Not a conveyor');
    const next = c.outs.length === 0 ? 0 : (c.outs[0] + 1) % 4;
    c.outs = [next as Dir];
    c.nextOut = 0;
    return OK;
  }

  demolish(id: number): Result {
    const b = this.getBuilding(id);
    if (!b) return fail('Nothing to demolish');
    // An attached output bin goes with its workshop.
    if (b.type === 'bin' && b.industryId != null) return this.demolish(b.industryId);
    if (b.type === 'conveyor') {
      if (b.item) this.state.money += ITEMS[b.item.id].sellPrice;
      if (b.bridge) {
        // Removing a crossing leaves the path behind.
        const pathCost = CONFIG.costs.path;
        this.state.money += Math.floor(Math.max(0, b.cost - pathCost) * CONFIG.demolishRefund);
        this.state.buildings = this.state.buildings.filter((o) => o.id !== id);
        this.state.buildings.push({ id: this.state.nextId++, type: 'path', x: b.x, y: b.y, w: 1, h: 1, cost: pathCost });
        this.rebuild();
        return OK;
      }
    }
    if (b.type === 'house') {
      const bedsAfter = this.bedCount() - CONFIG.houseBeds;
      if (this.state.workers.length > bedsAfter) return fail('Workers live here — dismiss some first');
    }
    const removed = new Set([id]);
    if (b.type === 'plot') {
      const w = this.getWorker(b.workerId);
      if (w) this.releaseWorker(w);
    }
    if (b.type === 'bin') this.state.money += stockValue(b.stock);
    if (b.type === 'industry') {
      for (const wid of [b.crafterId, b.haulerId]) {
        const w = this.getWorker(wid);
        if (w) this.releaseWorker(w);
      }
      this.state.money += stockValue(b.storage);
      const bin = this.getBin(b.binId);
      if (bin) {
        this.state.money += stockValue(bin.stock);
        removed.add(bin.id);
      }
    }

    this.state.money += Math.floor(b.cost * CONFIG.demolishRefund);
    this.state.buildings = this.state.buildings.filter((other) => !removed.has(other.id));
    this.rebuild();
    if (b.type === 'house') this.rehomeWorkers(b);
    return OK;
  }

  private rehomeWorkers(oldHouse: HouseBuilding): void {
    for (const w of this.state.workers) {
      if (w.homeId !== oldHouse.id) continue;
      const home = this.findHouseWithBed();
      if (!home) continue;
      w.homeId = home.id;
      if (w.inside) {
        w.x = home.x + home.w / 2;
        w.y = home.y + home.h / 2;
      }
    }
  }

  private findHouseWithBed(): HouseBuilding | undefined {
    for (const b of this.state.buildings) {
      if (b.type !== 'house') continue;
      const residents = this.state.workers.filter((w) => w.homeId === b.id).length;
      if (residents < CONFIG.houseBeds) return b;
    }
    return undefined;
  }

  setRecipe(industryId: number, recipe: GoodId): Result {
    const ind = this.getIndustry(industryId);
    if (!ind) return fail('Not a workshop');
    if (!RECIPES[recipe]) return fail('Unknown recipe');
    if (RECIPES[recipe].building !== ind.kind) return fail(`A ${ind.kind} can't make that`);
    if (recipe !== ind.recipe) {
      // Inputs for the old recipe are sold off so storage only holds what's needed.
      for (const [item, n] of Object.entries(ind.storage)) {
        if (item !== RECIPES[recipe].input) {
          this.state.money += (n ?? 0) * ITEMS[item as ItemId].sellPrice;
          delete ind.storage[item as ItemId];
        }
      }
    }
    ind.recipe = recipe;
    return OK;
  }

  // ----------------------------------------------------------------- workers

  /** An idle worker, hiring a new one if nobody is free. */
  private obtainWorker(): { ok: true; worker: Worker } | { ok: false; reason: string } {
    const idle = this.state.workers.find(isIdleWorker);
    if (idle) return { ok: true, worker: idle };
    return this.hireWorker();
  }

  /** Assigns an unassigned worker to the plot, hiring a new one if needed. */
  assignWorker(plotId: number): Result {
    const plot = this.getPlot(plotId);
    if (!plot) return fail('Not a farm plot');
    if (plot.workerId != null) return fail('Plot already has a worker');
    const got = this.obtainWorker();
    if (!got.ok) return got;
    const worker = got.worker;
    worker.plotId = plot.id;
    plot.workerId = worker.id;
    if (worker.task === 'walking' && worker.goal === 'home') worker.task = 'idle';
    return OK;
  }

  /** Staffs a workshop's crafter or hauler slot, hiring if needed. */
  assignIndustryWorker(industryId: number, role: WorkerRole): Result {
    const ind = this.getIndustry(industryId);
    if (!ind) return fail('Not a workshop');
    if (role === 'hauler' && ind.kind === 'industry') return fail('Industries are fed by conveyors');
    const slot = role === 'crafter' ? 'crafterId' : 'haulerId';
    if (ind[slot] != null) return fail(`Workshop already has a ${role}`);
    const got = this.obtainWorker();
    if (!got.ok) return got;
    const worker = got.worker;
    worker.industryId = ind.id;
    worker.role = role;
    ind[slot] = worker.id;
    if (worker.task === 'walking' && worker.goal === 'home') worker.task = 'idle';
    return OK;
  }

  unassignIndustryWorker(industryId: number, role: WorkerRole): Result {
    const ind = this.getIndustry(industryId);
    const w = this.getWorker(role === 'crafter' ? ind?.crafterId : ind?.haulerId);
    if (!ind || !w) return fail(`No ${role} at this workshop`);
    this.releaseWorker(w);
    return OK;
  }

  hireWorker(): { ok: true; worker: Worker } | { ok: false; reason: string } {
    const home = this.findHouseWithBed();
    if (!home) {
      return { ok: false, reason: this.bedCount() === 0 ? 'Build an employee house first' : 'No free beds — build another house' };
    }
    if (this.state.money < CONFIG.workerHireCost) return { ok: false, reason: 'Not enough money to hire' };
    this.state.money -= CONFIG.workerHireCost;
    const worker: Worker = {
      id: this.state.nextId++,
      homeId: home.id,
      plotId: null,
      industryId: null,
      role: null,
      targetId: null,
      x: home.x + home.w / 2,
      y: home.y + home.h / 2,
      inside: true,
      task: 'idle',
      goal: null,
      route: [],
      routeVersion: -1,
      taskElapsed: 0,
      carrying: null,
      wander: null,
      wanderPause: 0,
      blocked: null,
      status: null,
      retryIn: 0,
    };
    this.state.workers.push(worker);
    return { ok: true, worker };
  }

  unassignWorker(plotId: number): Result {
    const plot = this.getPlot(plotId);
    const w = this.getWorker(plot?.workerId);
    if (!plot || !w) return fail('No worker on this plot');
    this.releaseWorker(w);
    return OK;
  }

  /** Detaches a worker from its job; it finishes any delivery then walks home. */
  private releaseWorker(w: Worker): void {
    const plot = this.getPlot(w.plotId);
    if (plot) plot.workerId = null;
    const ind = this.getIndustry(w.industryId);
    if (ind) {
      if (ind.crafterId === w.id) {
        ind.crafterId = null;
        // Put anything not yet crafted back into storage.
        if (ind.crafting) {
          const r = RECIPES[ind.crafting];
          ind.storage[r.input] = (ind.storage[r.input] ?? 0) + r.inputAmount;
          ind.crafting = null;
        }
        if (w.carrying && w.task === 'loading') {
          const item = w.carrying.item;
          ind.storage[item] = (ind.storage[item] ?? 0) + w.carrying.amount;
          w.carrying = null;
        }
      }
      if (ind.haulerId === w.id) ind.haulerId = null;
    }
    w.plotId = null;
    w.industryId = null;
    w.role = null;
    w.targetId = null;
    w.status = null;
    if (!(w.task === 'walking' && w.goal === 'bin')) {
      w.task = 'idle';
      w.goal = null;
      w.blocked = null;
      w.retryIn = 0;
    }
  }

  /** Dismisses an unassigned worker (no refund). */
  dismissIdleWorker(houseId: number): Result {
    const w = this.state.workers.find((wk) => wk.homeId === houseId && isIdleWorker(wk) && !wk.carrying);
    if (!w) return fail('No idle workers here');
    this.state.workers = this.state.workers.filter((wk) => wk.id !== w.id);
    return OK;
  }

  // -------------------------------------------------------------------- bins

  sellBin(binId: number): { ok: true; earned: number } | { ok: false; reason: string } {
    const bin = this.getBin(binId);
    if (!bin) return { ok: false, reason: 'Not an output bin' };
    const earned = stockValue(bin.stock);
    if (earned === 0) return { ok: false, reason: 'Bin is empty' };
    this.state.money += earned;
    bin.stock = {};
    return { ok: true, earned };
  }

  totalBinStock(): number {
    let total = 0;
    for (const b of this.state.buildings) {
      if (b.type === 'bin') for (const n of Object.values(b.stock)) total += n ?? 0;
    }
    return total;
  }
}

export function stockValue(stock: Partial<Record<ItemId, number>>): number {
  let value = 0;
  for (const [item, amount] of Object.entries(stock)) {
    value += (amount ?? 0) * ITEMS[item as ItemId].sellPrice;
  }
  return value;
}

export function binValue(bin: BinBuilding): number {
  return stockValue(bin.stock);
}

export function stockCount(stock: Partial<Record<ItemId, number>>): number {
  return Object.values(stock).reduce((s: number, n) => s + (n ?? 0), 0);
}