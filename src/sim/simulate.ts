import { CONFIG, CROPS, RECIPES, type CropId, type GoodId } from '../config';
import { findRoute } from './pathfinding';
import type { Building, IndustryBuilding, PlotBuilding, Point, Worker, WorkerGoal } from './types';
import { stockCount, type World } from './world';

/** Advances the simulation by `seconds`, in small fixed steps. */
export function advance(world: World, seconds: number, step: number = CONFIG.sim.maxStepSeconds): void {
  let remaining = Math.max(0, seconds);
  while (remaining > 1e-9) {
    const dt = Math.min(step, remaining);
    tick(world, dt);
    remaining -= dt;
  }
}

export function tick(world: World, dt: number): void {
  for (const b of world.state.buildings) {
    if (b.type === 'plot' && b.stage === 'planted') {
      b.growElapsed += dt;
      if (b.growElapsed >= CROPS[b.crop].growSeconds) {
        b.growElapsed = CROPS[b.crop].growSeconds;
        b.stage = 'ready';
      }
    }
  }
  for (const w of world.state.workers) updateWorker(world, w, dt);
}

/** 0..1 progress of the worker's current task, or null when not applicable. */
export function taskProgress(world: World, w: Worker): number | null {
  if (w.task === 'crafting') {
    const ind = world.getIndustry(w.industryId);
    const recipe = ind?.crafting ?? ind?.recipe;
    return recipe ? w.taskElapsed / RECIPES[recipe].craftSeconds : null;
  }
  const plot = world.getPlot(w.plotId);
  if (!plot) return null;
  const crop = CROPS[plot.crop];
  switch (w.task) {
    case 'tilling':
      return w.taskElapsed / crop.tillSeconds;
    case 'planting':
      return w.taskElapsed / crop.plantSeconds;
    case 'harvesting':
      return w.taskElapsed / crop.harvestSeconds;
    case 'tending':
      return plot.growElapsed / crop.growSeconds;
    default:
      return null;
  }
}

/** Where raw goods are kept inside a workshop (tile coordinates). */
export function storageSpot(ind: IndustryBuilding): Point {
  return { x: ind.x + 0.5, y: ind.y + 1.35 };
}

/** Where the crafter works inside a workshop (tile coordinates). */
export function benchSpot(ind: IndustryBuilding): Point {
  return { x: ind.x + 1.5, y: ind.y + 0.65 };
}

function updateWorker(world: World, w: Worker, dt: number): void {
  if (w.retryIn > 0) w.retryIn -= dt;

  switch (w.task) {
    case 'idle':
      decideNext(world, w);
      return;
    case 'walking':
      walk(world, w, dt);
      return;
    case 'tending': {
      const plot = assignedPlotContaining(world, w);
      if (!plot) return toIdle(w);
      amble(w, plot, dt);
      if (plot.stage === 'ready') beginWork(w, plot);
      return;
    }
    case 'tilling':
    case 'planting':
    case 'harvesting':
      return updateFarmWork(world, w, dt);
    case 'fetching':
    case 'loading':
    case 'crafting':
    case 'waiting':
      return updateWorkshop(world, w, dt);
  }
}

function updateFarmWork(world: World, w: Worker, dt: number): void {
  const plot = assignedPlotContaining(world, w);
  if (!plot) return toIdle(w);
  amble(w, plot, dt);
  w.taskElapsed += dt;
  const crop = CROPS[plot.crop];
  const needed = w.task === 'tilling' ? crop.tillSeconds : w.task === 'planting' ? crop.plantSeconds : crop.harvestSeconds;
  if (w.taskElapsed < needed) return;
  if (w.task === 'tilling') {
    plot.stage = 'tilled';
    beginWork(w, plot);
  } else if (w.task === 'planting') {
    plot.stage = 'planted';
    plot.growElapsed = 0;
    beginWork(w, plot);
  } else {
    plot.stage = 'untilled';
    plot.growElapsed = 0;
    const amount = crop.yieldPerTile * plot.w * plot.h;
    w.carrying = { item: plot.crop, amount };
    world.state.stats.harvested += amount;
    toIdle(w);
  }
}

function updateWorkshop(world: World, w: Worker, dt: number): void {
  const ind = ownIndustryContaining(world, w);
  if (!ind) return toIdle(w);
  const speed = CONFIG.industry.insideSpeed * dt;

  switch (w.task) {
    case 'waiting':
      w.taskElapsed += dt;
      if (w.taskElapsed >= 0.5) toIdle(w);
      return;

    case 'fetching': {
      // Crafter walks over to the storage section and picks up a recipe's worth of inputs.
      if (!moveTo(w, storageSpot(ind), speed)) return;
      const r = RECIPES[ind.recipe];
      if ((ind.storage[r.input] ?? 0) < r.inputAmount) return toIdle(w);
      ind.storage[r.input] = (ind.storage[r.input] ?? 0) - r.inputAmount;
      w.carrying = { item: r.input, amount: r.inputAmount };
      w.task = 'loading';
      w.status = null;
      return;
    }

    case 'loading': {
      if (w.role === 'hauler') {
        // Hauler stacks what it brought in the storage section.
        if (!moveTo(w, storageSpot(ind), speed)) return;
        if (w.carrying) {
          const crop = w.carrying.item as CropId;
          ind.storage[crop] = (ind.storage[crop] ?? 0) + w.carrying.amount;
          w.carrying = null;
        }
        return toIdle(w);
      }
      // Crafter carries the inputs to the workbench.
      if (!moveTo(w, benchSpot(ind), speed)) return;
      ind.crafting = ind.recipe;
      w.carrying = null;
      w.task = 'crafting';
      w.taskElapsed = 0;
      return;
    }

    case 'crafting': {
      if (!ind.crafting) return toIdle(w);
      const r = RECIPES[ind.crafting];
      w.taskElapsed += dt;
      if (w.taskElapsed < r.craftSeconds) return;
      w.carrying = { item: ind.crafting, amount: r.outputAmount };
      world.state.stats.crafted += r.outputAmount;
      ind.crafting = null;
      return toIdle(w);
    }
  }
}

/** Moves straight towards `spot`; returns true once there. */
function moveTo(w: Worker, spot: Point, step: number): boolean {
  const dx = spot.x - w.x;
  const dy = spot.y - w.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= step) {
    w.x = spot.x;
    w.y = spot.y;
    return true;
  }
  w.x += (dx / dist) * step;
  w.y += (dy / dist) * step;
  return false;
}

function toIdle(w: Worker): void {
  w.task = 'idle';
  w.taskElapsed = 0;
  w.wander = null;
}

function cellOf(w: Worker): { x: number; y: number } {
  return { x: Math.floor(w.x), y: Math.floor(w.y) };
}

function contains(b: Building, x: number, y: number): boolean {
  return x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h;
}

function assignedPlotContaining(world: World, w: Worker): PlotBuilding | undefined {
  const plot = world.getPlot(w.plotId);
  if (!plot || w.inside) return undefined;
  const c = cellOf(w);
  return contains(plot, c.x, c.y) ? plot : undefined;
}

function ownIndustryContaining(world: World, w: Worker): IndustryBuilding | undefined {
  const ind = world.getIndustry(w.industryId);
  if (!ind || w.inside) return undefined;
  const c = cellOf(w);
  return contains(ind, c.x, c.y) ? ind : undefined;
}

function decideNext(world: World, w: Worker): void {
  const ind = world.getIndustry(w.industryId);
  if (ind && w.role === 'crafter') return decideCrafter(world, w, ind);
  if (ind && w.role === 'hauler') return decideHauler(world, w, ind);
  if (w.carrying) return startTrip(world, w, 'bin');
  if (w.plotId != null) {
    const plot = assignedPlotContaining(world, w);
    if (plot) return beginWork(w, plot);
    return startTrip(world, w, 'plot');
  }
  w.status = null;
  if (!w.inside) startTrip(world, w, 'home');
  else w.blocked = null;
}

function isGood(item: string): item is GoodId {
  return item in RECIPES;
}

function decideCrafter(world: World, w: Worker, ind: IndustryBuilding): void {
  const inside = !!ownIndustryContaining(world, w);
  if (w.carrying) {
    if (isGood(w.carrying.item)) return startTrip(world, w, 'outbin');
    // Raw inputs in hand (e.g. after a reload): finish taking them to the bench.
    if (inside) return setTask(w, 'loading');
    return startTrip(world, w, 'industry');
  }
  if (!inside) return startTrip(world, w, 'industry');
  w.blocked = null;
  if (ind.crafting) return setTask(w, 'crafting');
  const r = RECIPES[ind.recipe];
  if ((ind.storage[r.input] ?? 0) >= r.inputAmount) {
    w.status = null;
    return setTask(w, 'fetching');
  }
  w.status = `Waiting for ${CROPS[r.input].name.toLowerCase()}`;
  setTask(w, 'waiting');
}

function decideHauler(world: World, w: Worker, ind: IndustryBuilding): void {
  const inside = !!ownIndustryContaining(world, w);
  if (w.carrying) {
    w.status = null;
    return inside ? setTask(w, 'loading') : startTrip(world, w, 'industry');
  }
  const input = RECIPES[ind.recipe].input;
  const space = CONFIG.industry.storageCapacity - stockCount(ind.storage);
  const supply = space > 0 && world.state.buildings.some((b) => isFarmBin(b) && (b.stock[input] ?? 0) > 0);
  if (supply) {
    w.status = null;
    startTrip(world, w, 'pickup');
    if (w.task === 'walking' || !inside) return;
  } else {
    w.blocked = null;
  }
  if (!inside) return startTrip(world, w, 'industry');
  if (!w.blocked) w.status = space <= 0 ? 'Storage full' : `Waiting for ${CROPS[input].name.toLowerCase()} in bins`;
  setTask(w, 'waiting');
}

function setTask(w: Worker, task: Worker['task']): void {
  w.task = task;
  w.taskElapsed = 0;
  w.wander = null;
}

function isFarmBin(b: Building): b is Extract<Building, { type: 'bin' }> {
  return b.type === 'bin' && b.industryId == null;
}

function beginWork(w: Worker, plot: PlotBuilding): void {
  w.blocked = null;
  w.taskElapsed = 0;
  w.task =
    plot.stage === 'untilled'
      ? 'tilling'
      : plot.stage === 'tilled'
        ? 'planting'
        : plot.stage === 'planted'
          ? 'tending'
          : 'harvesting';
}

const BLOCKED_MESSAGES: Record<WorkerGoal, string> = {
  plot: 'No path to field',
  bin: 'No path to an output bin',
  home: 'No path home',
  industry: 'No path to workshop',
  pickup: 'No path to a bin with wheat',
  outbin: 'No path to the workshop bin',
};

function goalMatcher(world: World, w: Worker, goal: WorkerGoal): ((b: Building) => boolean) | null {
  const ind = world.getIndustry(w.industryId);
  switch (goal) {
    case 'plot':
      return w.plotId == null ? null : (b) => b.id === w.plotId;
    case 'bin':
      return isFarmBin;
    case 'home':
      return world.getBuilding(w.homeId) ? (b) => b.id === w.homeId : null;
    case 'industry':
      return ind ? (b) => b.id === ind.id : null;
    case 'outbin':
      return ind ? (b) => b.id === ind.binId : null;
    case 'pickup': {
      if (!ind) return null;
      const input = RECIPES[ind.recipe].input;
      return (b) => isFarmBin(b) && (b.stock[input] ?? 0) > 0;
    }
  }
}

function startTrip(world: World, w: Worker, goal: WorkerGoal): void {
  if (w.retryIn > 0) return;
  const isTarget = goalMatcher(world, w, goal);
  const start = cellOf(w);
  const here = world.buildingAt(start.x, start.y);
  const route = isTarget ? findRoute(world, start, isTarget, here?.id ?? null) : null;

  if (!route) {
    w.task = 'idle';
    w.blocked = BLOCKED_MESSAGES[goal];
    w.retryIn = CONFIG.routeRetrySeconds;
    // Stranded on bare ground (e.g. its path was demolished): head back inside.
    if (!here && !w.inside) sendInside(world, w);
    return;
  }

  w.blocked = null;
  w.inside = false;
  w.task = 'walking';
  w.goal = goal;
  w.route = route.map((c) => ({ x: c.x + 0.5, y: c.y + 0.5 }));
  w.routeVersion = world.layoutVersion;
  w.wander = null;
}

function sendInside(world: World, w: Worker): void {
  const home = world.getBuilding(w.homeId);
  if (!home) return;
  w.x = home.x + home.w / 2;
  w.y = home.y + home.h / 2;
  w.inside = true;
}

function walk(world: World, w: Worker, dt: number): void {
  if (w.routeVersion !== world.layoutVersion && w.goal) {
    w.retryIn = 0;
    startTrip(world, w, w.goal);
    if (w.task !== 'walking') return;
  }
  moveAlongRoute(w, CONFIG.workerSpeed * dt);
  if (w.route.length === 0) arrive(world, w);
}

function moveAlongRoute(w: Worker, distance: number): void {
  let budget = distance;
  while (budget > 0 && w.route.length > 0) {
    const target = w.route[0];
    const dx = target.x - w.x;
    const dy = target.y - w.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= budget) {
      w.x = target.x;
      w.y = target.y;
      budget -= dist;
      w.route.shift();
    } else {
      w.x += (dx / dist) * budget;
      w.y += (dy / dist) * budget;
      budget = 0;
    }
  }
}

function arrive(world: World, w: Worker): void {
  const goal = w.goal;
  w.goal = null;
  toIdle(w);
  const c = cellOf(w);
  const here = world.buildingAt(c.x, c.y);
  const ind = world.getIndustry(w.industryId);

  if ((goal === 'bin' || goal === 'outbin') && here?.type === 'bin' && w.carrying) {
    if (goal === 'outbin' && here.id !== ind?.binId) return;
    here.stock[w.carrying.item] = (here.stock[w.carrying.item] ?? 0) + w.carrying.amount;
    w.carrying = null;
  } else if (goal === 'pickup' && here && isFarmBin(here) && ind && !w.carrying) {
    const input = RECIPES[ind.recipe].input;
    const space = CONFIG.industry.storageCapacity - stockCount(ind.storage);
    const take = Math.min(CONFIG.industry.haulCapacity, here.stock[input] ?? 0, space);
    if (take > 0) {
      here.stock[input] = (here.stock[input] ?? 0) - take;
      if (!here.stock[input]) delete here.stock[input];
      w.carrying = { item: input, amount: take };
    }
  } else if (goal === 'home' && here?.id === w.homeId && w.plotId == null && w.industryId == null) {
    sendInside(world, w);
  }
}

/** Slowly wander around inside the field while working. */
function amble(w: Worker, area: Building, dt: number): void {
  if (w.wanderPause > 0) {
    w.wanderPause -= dt;
    return;
  }
  if (!w.wander) {
    const inset = 0.25;
    w.wander = {
      x: area.x + inset + Math.random() * (area.w - inset * 2),
      y: area.y + inset + Math.random() * (area.h - inset * 2),
    };
  }
  const dx = w.wander.x - w.x;
  const dy = w.wander.y - w.y;
  const dist = Math.hypot(dx, dy);
  const step = CONFIG.workerFieldSpeed * dt;
  if (dist <= step) {
    w.x = w.wander.x;
    w.y = w.wander.y;
    w.wander = null;
    w.wanderPause = 0.5 + Math.random() * 1.5;
  } else {
    w.x += (dx / dist) * step;
    w.y += (dy / dist) * step;
  }
}