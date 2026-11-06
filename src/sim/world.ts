import { CONFIG, CROPS } from '../config';
import { computeConnected, type GridLookup } from './pathfinding';
import type {
  BinBuilding,
  Building,
  BuildingType,
  GameState,
  HouseBuilding,
  PlotBuilding,
  Result,
  Worker,
} from './types';

export type PlaceableType = BuildingType;

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
    savedAt: Date.now(),
  };
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

  getWorker(id: number | null | undefined): Worker | undefined {
    return id == null ? undefined : this.state.workers.find((w) => w.id === id);
  }

  bedCount(): number {
    return this.state.buildings.filter((b) => b.type === 'house').length * CONFIG.houseBeds;
  }

  // ---------------------------------------------------------------- building

  canPlace(type: PlaceableType, x: number, y: number): Result {
    const size = CONFIG.footprints[type];
    for (let cy = y; cy < y + size; cy++) {
      for (let cx = x; cx < x + size; cx++) {
        if (!this.inBounds(cx, cy)) return fail('Out of bounds');
        if (this.buildingAt(cx, cy)) return fail('Space is taken');
      }
    }
    if (this.state.money < CONFIG.costs[type]) return fail('Not enough money');
    return OK;
  }

  place(type: PlaceableType, x: number, y: number): Result {
    const check = this.canPlace(type, x, y);
    if (!check.ok) return check;
    const size = CONFIG.footprints[type];
    const cost = CONFIG.costs[type];
    const base = { id: this.state.nextId++, x, y, w: size, h: size, cost };
    let building: Building;
    switch (type) {
      case 'plot':
        building = { ...base, type, crop: 'wheat', stage: 'untilled', growElapsed: 0, workerId: null };
        break;
      case 'bin':
        building = { ...base, type, stock: {} };
        break;
      default:
        building = { ...base, type };
    }
    this.state.money -= cost;
    this.state.buildings.push(building);
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

  demolish(id: number): Result {
    const b = this.getBuilding(id);
    if (!b) return fail('Nothing to demolish');
    if (b.type === 'house') {
      const bedsAfter = this.bedCount() - CONFIG.houseBeds;
      if (this.state.workers.length > bedsAfter) return fail('Workers live here — dismiss some first');
    }
    if (b.type === 'plot') {
      const w = this.getWorker(b.workerId);
      if (w) this.releaseWorker(w);
    }
    if (b.type === 'bin') this.state.money += binValue(b);

    this.state.money += Math.floor(b.cost * CONFIG.demolishRefund);
    this.state.buildings = this.state.buildings.filter((other) => other.id !== id);
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

  // ----------------------------------------------------------------- workers

  /** Assigns an unassigned worker to the plot, hiring a new one if needed. */
  assignWorker(plotId: number): Result {
    const plot = this.getPlot(plotId);
    if (!plot) return fail('Not a farm plot');
    if (plot.workerId != null) return fail('Plot already has a worker');

    let worker = this.state.workers.find((w) => w.plotId == null);
    if (!worker) {
      const hired = this.hireWorker();
      if (!hired.ok) return hired;
      worker = hired.worker;
    }
    worker.plotId = plot.id;
    plot.workerId = worker.id;
    if (worker.task === 'walking' && worker.goal === 'home') worker.task = 'idle';
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

  /** Detaches a worker from its plot; it finishes any delivery then walks home. */
  private releaseWorker(w: Worker): void {
    const plot = this.getPlot(w.plotId);
    if (plot) plot.workerId = null;
    w.plotId = null;
    if (!(w.task === 'walking' && w.goal === 'bin')) {
      w.task = 'idle';
      w.blocked = null;
      w.retryIn = 0;
    }
  }

  /** Dismisses an unassigned worker (no refund). */
  dismissIdleWorker(houseId: number): Result {
    const w = this.state.workers.find((wk) => wk.homeId === houseId && wk.plotId == null && !wk.carrying);
    if (!w) return fail('No idle workers here');
    this.state.workers = this.state.workers.filter((wk) => wk.id !== w.id);
    return OK;
  }

  // -------------------------------------------------------------------- bins

  sellBin(binId: number): { ok: true; earned: number } | { ok: false; reason: string } {
    const bin = this.getBuilding(binId);
    if (bin?.type !== 'bin') return { ok: false, reason: 'Not an output bin' };
    const earned = binValue(bin);
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

export function binValue(bin: BinBuilding): number {
  let value = 0;
  for (const [crop, amount] of Object.entries(bin.stock)) {
    value += (amount ?? 0) * CROPS[crop as keyof typeof CROPS].sellPrice;
  }
  return value;
}
