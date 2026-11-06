import type { CropId, GoodId, IndustryKind, ItemId } from '../config';

export type BuildingType = 'plot' | 'path' | 'house' | 'bin' | 'industry' | 'conveyor';
export type PlotStage = 'untilled' | 'tilled' | 'planted' | 'ready';
/** 0 = east, 1 = south, 2 = west, 3 = north. */
export type Dir = 0 | 1 | 2 | 3;

interface BuildingBase {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Total money spent on this building (used for demolish refunds). */
  cost: number;
}

export interface PlotBuilding extends BuildingBase {
  type: 'plot';
  crop: CropId;
  stage: PlotStage;
  growElapsed: number;
  workerId: number | null;
}

export interface PathBuilding extends BuildingBase {
  type: 'path';
}

export interface HouseBuilding extends BuildingBase {
  type: 'house';
}

export interface BinBuilding extends BuildingBase {
  type: 'bin';
  stock: Partial<Record<ItemId, number>>;
  /** Set when this bin is the attached output bin of a workshop. */
  industryId?: number;
  /** Round-robin pointer over neighbouring conveyors this bin feeds. */
  nextOut?: number;
}

export interface IndustryBuilding extends BuildingBase {
  type: 'industry';
  kind: IndustryKind;
  /** What the workshop is set to make. */
  recipe: GoodId;
  /** Inputs waiting in the storage section. */
  storage: Partial<Record<ItemId, number>>;
  /** Recipe currently on the workbench (inputs already taken from storage). */
  crafting: GoodId | null;
  binId: number;
  crafterId: number | null;
  haulerId: number | null;
}

export interface ConveyorItem {
  id: ItemId;
  /** 0 = entering edge, 0.5 = tile centre, 1 = ready to leave. */
  p: number;
  /** Side it came in from (null when unknown). */
  from: Dir | null;
}

/** One belt tile. Workers can't cross it unless it's a bridge (a path laid over it). */
export interface ConveyorBuilding extends BuildingBase {
  type: 'conveyor';
  /** Sides items leave from; several = round-robin splitter. */
  outs: Dir[];
  bridge: boolean;
  item: ConveyorItem | null;
  /** Round-robin pointer into `outs`. */
  nextOut: number;
  /** Zipper pointer: the side whose item gets priority next when several feed this tile. */
  nextIn: number;
}

export type Building = PlotBuilding | PathBuilding | HouseBuilding | BinBuilding | IndustryBuilding | ConveyorBuilding;

export interface Point {
  x: number;
  y: number;
}

export type WorkerRole = 'crafter' | 'hauler';

export type WorkerTask =
  | 'idle'
  | 'walking'
  | 'tilling'
  | 'planting'
  | 'tending'
  | 'harvesting'
  /** Crafter walking to the workshop's storage section. */
  | 'fetching'
  /** Crafter moving raw goods from storage to the workbench. */
  | 'loading'
  | 'crafting'
  /** Workshop worker with nothing to do right now. */
  | 'waiting';

/**
 * plot/bin/home are farm trips; industry = own workshop, pickup = a farm bin with
 * the workshop's raw input, outbin = the workshop's attached output bin.
 */
export type WorkerGoal = 'plot' | 'bin' | 'home' | 'industry' | 'pickup' | 'outbin';

export interface Worker {
  id: number;
  homeId: number;
  plotId: number | null;
  industryId: number | null;
  role: WorkerRole | null;
  /** Haulers: the workshop the current trip is supplying (may differ from the one they were hired at). */
  targetId: number | null;
  /** Position in tile units (0.5, 0.5 is the centre of cell 0,0). */
  x: number;
  y: number;
  inside: boolean;
  task: WorkerTask;
  goal: WorkerGoal | null;
  route: Point[];
  routeVersion: number;
  taskElapsed: number;
  carrying: { item: ItemId; amount: number } | null;
  wander: Point | null;
  wanderPause: number;
  blocked: string | null;
  /** Short non-error status, e.g. "Waiting for wheat". */
  status: string | null;
  retryIn: number;
}

export interface GameStats {
  harvested: number;
  crafted: number;
}

export interface GameState {
  version: 1;
  width: number;
  height: number;
  money: number;
  nextId: number;
  buildings: Building[];
  workers: Worker[];
  stats: GameStats;
  savedAt: number;
}

export type Result = { ok: true } | { ok: false; reason: string };