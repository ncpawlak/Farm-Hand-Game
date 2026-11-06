// All tunable game balance lives here.

export type CropId = 'wheat';
export type GoodId = 'flour' | 'bread';
export type ItemId = CropId | GoodId;

export interface CropDef {
  name: string;
  tillSeconds: number;
  plantSeconds: number;
  growSeconds: number;
  harvestSeconds: number;
  /** Units produced per 1x1 tile of farmland (a 2x2 big plot yields 4x). */
  yieldPerTile: number;
}

export const CROPS: Record<CropId, CropDef> = {
  wheat: {
    name: 'Wheat',
    tillSeconds: 5,
    plantSeconds: 5,
    // TODO: back to 30 after testing.
    growSeconds: 5,
    harvestSeconds: 5,
    yieldPerTile: 1,
  },
};

export interface ItemDef {
  name: string;
  icon: string;
  sellPrice: number;
  /** Colour used when drawing the item (carried by workers, in storage). */
  color: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  wheat: { name: 'Wheat', icon: '🌾', sellPrice: 3, color: 0xf2cf63 },
  flour: { name: 'Flour', icon: '🥣', sellPrice: 10, color: 0xfaf6ee },
  bread: { name: 'Bread', icon: '🍞', sellPrice: 16, color: 0xd08a4b },
};

export interface RecipeDef {
  name: string;
  input: CropId;
  inputAmount: number;
  craftSeconds: number;
  outputAmount: number;
}

/** What a workshop can make. The key is the produced good. */
export const RECIPES: Record<GoodId, RecipeDef> = {
  flour: { name: 'Mill flour', input: 'wheat', inputAmount: 2, craftSeconds: 6, outputAmount: 1 },
  bread: { name: 'Bake bread', input: 'wheat', inputAmount: 3, craftSeconds: 10, outputAmount: 1 },
};

export const CONFIG = {
  grid: { width: 20, height: 20, tileSize: 48 },
  startingMoney: 500,
  costs: { plot: 50, path: 5, house: 200, bin: 100, industry: 300 },
  footprints: { plot: 1, path: 1, house: 3, bin: 1, industry: 2 },
  workerHireCost: 25,
  houseBeds: 4,
  demolishRefund: 0.5,
  /** Walking speed along paths, in tiles per second. */
  workerSpeed: 2,
  /** Slower ambling speed while working inside a field or workshop. */
  workerFieldSpeed: 0.6,
  /** Seconds between retries when a worker cannot find a route. */
  routeRetrySeconds: 1,
  industry: {
    /** Raw goods the workshop can hold waiting to be crafted. */
    storageCapacity: 20,
    /** Most a hauler carries per trip. */
    haulCapacity: 5,
    /** Walking speed inside the workshop, in tiles per second. */
    insideSpeed: 1,
    /** Attached output bin position, relative to the workshop's top-left cell. */
    binOffset: { x: 2, y: 1 },
  },
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