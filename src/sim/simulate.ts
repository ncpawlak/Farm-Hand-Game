import { CONFIG, CROPS } from '../config';
import { findRoute } from './pathfinding';
import type { Building, PlotBuilding, Worker, WorkerGoal } from './types';
import type { World } from './world';

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
    case 'harvesting': {
      const plot = assignedPlotContaining(world, w);
      if (!plot) return toIdle(w);
      amble(w, plot, dt);
      w.taskElapsed += dt;
      const crop = CROPS[plot.crop];
      const needed =
        w.task === 'tilling' ? crop.tillSeconds : w.task === 'planting' ? crop.plantSeconds : crop.harvestSeconds;
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
        w.carrying = { crop: plot.crop, amount: crop.yieldPerTile * plot.w * plot.h };
        toIdle(w);
      }
      return;
    }
  }
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

function decideNext(world: World, w: Worker): void {
  if (w.carrying) return startTrip(world, w, 'bin');
  if (w.plotId != null) {
    const plot = assignedPlotContaining(world, w);
    if (plot) return beginWork(w, plot);
    return startTrip(world, w, 'plot');
  }
  if (!w.inside) startTrip(world, w, 'home');
  else w.blocked = null;
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
};

function goalMatcher(world: World, w: Worker, goal: WorkerGoal): ((b: Building) => boolean) | null {
  switch (goal) {
    case 'plot':
      return w.plotId == null ? null : (b) => b.id === w.plotId;
    case 'bin':
      return (b) => b.type === 'bin';
    case 'home':
      return world.getBuilding(w.homeId) ? (b) => b.id === w.homeId : null;
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

  if (goal === 'bin' && here?.type === 'bin' && w.carrying) {
    here.stock[w.carrying.crop] = (here.stock[w.carrying.crop] ?? 0) + w.carrying.amount;
    w.carrying = null;
  } else if (goal === 'home' && here?.id === w.homeId && w.plotId == null) {
    sendInside(world, w);
  }
}

/** Slowly wander around inside the field while working. */
function amble(w: Worker, plot: PlotBuilding, dt: number): void {
  if (w.wanderPause > 0) {
    w.wanderPause -= dt;
    return;
  }
  if (!w.wander) {
    const inset = 0.25;
    w.wander = {
      x: plot.x + inset + Math.random() * (plot.w - inset * 2),
      y: plot.y + inset + Math.random() * (plot.h - inset * 2),
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
