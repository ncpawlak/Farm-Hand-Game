import type { CropId } from '../config';

export type BuildingType = 'plot' | 'path' | 'house' | 'bin';
export type PlotStage = 'untilled' | 'tilled' | 'planted' | 'ready';

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
  stock: Partial<Record<CropId, number>>;
}

export type Building = PlotBuilding | PathBuilding | HouseBuilding | BinBuilding;

export interface Point {
  x: number;
  y: number;
}

export type WorkerTask = 'idle' | 'walking' | 'tilling' | 'planting' | 'tending' | 'harvesting';
export type WorkerGoal = 'plot' | 'bin' | 'home';

export interface Worker {
  id: number;
  homeId: number;
  plotId: number | null;
  /** Position in tile units (0.5, 0.5 is the centre of cell 0,0). */
  x: number;
  y: number;
  inside: boolean;
  task: WorkerTask;
  goal: WorkerGoal | null;
  route: Point[];
  routeVersion: number;
  taskElapsed: number;
  carrying: { crop: CropId; amount: number } | null;
  wander: Point | null;
  wanderPause: number;
  blocked: string | null;
  retryIn: number;
}

export interface GameState {
  version: 1;
  width: number;
  height: number;
  money: number;
  nextId: number;
  buildings: Building[];
  workers: Worker[];
  savedAt: number;
}

export type Result = { ok: true } | { ok: false; reason: string };
