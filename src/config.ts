// All tunable game balance lives here.

export type CropId = 'wheat';
export type GoodId = 'flour' | 'bread' | 'pastry' | 'sandwich';
/** Workshops turn crops into goods; industries turn workshop goods into finer goods. */
export type IndustryKind = 'workshop' | 'industry';
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
  pastry: { name: 'Pastry', icon: '🥐', sellPrice: 30, color: 0xe8a94f },
  sandwich: { name: 'Sandwich', icon: '🥪', sellPrice: 40, color: 0x9fc56b },
};

export interface RecipeDef {
  name: string;
  /** Which kind of building can make it. */
  building: IndustryKind;
  input: ItemId;
  inputAmount: number;
  craftSeconds: number;
  outputAmount: number;
}

/** What workshops and industries can make. The key is the produced good. */
export const RECIPES: Record<GoodId, RecipeDef> = {
  flour: { name: 'Mill flour', building: 'workshop', input: 'wheat', inputAmount: 2, craftSeconds: 6, outputAmount: 1 },
  bread: { name: 'Bake bread', building: 'workshop', input: 'wheat', inputAmount: 3, craftSeconds: 10, outputAmount: 1 },
  pastry: { name: 'Bake pastries', building: 'industry', input: 'flour', inputAmount: 2, craftSeconds: 8, outputAmount: 1 },
  sandwich: { name: 'Make sandwiches', building: 'industry', input: 'bread', inputAmount: 2, craftSeconds: 10, outputAmount: 1 },
};

export const CONFIG = {
  grid: { width: 20, height: 20, tileSize: 48 },
  startingMoney: 500,
  /** 'industry' is the workshop; 'factory' places an Industry building. */
  costs: { plot: 50, path: 5, house: 200, bin: 100, industry: 300, factory: 500, conveyor: 10 },
  footprints: { plot: 1, path: 1, house: 3, bin: 1, industry: 2, factory: 2, conveyor: 1 },
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
  conveyor: {
    /** Belt speed in tiles per second (each tile holds one item). */
    speed: 1.5,
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