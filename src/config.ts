// All tunable game balance lives here.

export type CropId = 'wheat';

export interface CropDef {
  name: string;
  tillSeconds: number;
  plantSeconds: number;
  growSeconds: number;
  harvestSeconds: number;
  /** Units produced per 1x1 tile of farmland (a 2x2 big plot yields 4x). */
  yieldPerTile: number;
  sellPrice: number;
}

export const CROPS: Record<CropId, CropDef> = {
  wheat: {
    name: 'Wheat',
    tillSeconds: 5,
    plantSeconds: 5,
    growSeconds: 30,
    harvestSeconds: 5,
    yieldPerTile: 1,
    sellPrice: 3,
  },
};

export const CONFIG = {
  grid: { width: 20, height: 20, tileSize: 48 },
  startingMoney: 500,
  costs: { plot: 50, path: 5, house: 200, bin: 100 },
  footprints: { plot: 1, path: 1, house: 3, bin: 1 },
  workerHireCost: 25,
  houseBeds: 4,
  demolishRefund: 0.5,
  /** Walking speed along paths, in tiles per second. */
  workerSpeed: 2,
  /** Slower ambling speed while working inside a field. */
  workerFieldSpeed: 0.6,
  /** Seconds between retries when a worker cannot find a route. */
  routeRetrySeconds: 1,
  sim: {
    /** Largest step used when advancing the simulation. */
    maxStepSeconds: 0.25,
    /** Step used when catching up after the game was closed. */
    offlineStepSeconds: 0.5,
    /** Cap on simulated offline time. */
    maxOfflineSeconds: 12 * 60 * 60,
  },
  autosaveSeconds: 5,
  saveKey: 'farmhand.save.v1',
} as const;
