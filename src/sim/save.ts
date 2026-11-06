import { CONFIG } from '../config';
import { advance } from './simulate';
import type { GameState } from './types';
import { World } from './world';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function saveWorld(world: World, storage: StorageLike, now = Date.now()): void {
  world.state.savedAt = now;
  storage.setItem(CONFIG.saveKey, JSON.stringify(world.state));
}

export function clearSave(storage: StorageLike): void {
  storage.removeItem(CONFIG.saveKey);
}

export function loadWorld(storage: StorageLike): World | null {
  const raw = storage.getItem(CONFIG.saveKey);
  if (!raw) return null;
  try {
    const state = JSON.parse(raw) as GameState;
    if (state.version !== 1 || !Array.isArray(state.buildings) || !Array.isArray(state.workers)) return null;
    return new World(state);
  } catch {
    return null;
  }
}

export interface CatchUpSummary {
  seconds: number;
  harvested: number;
}

/** Simulates the time that passed while the game was closed or hidden. */
export function catchUp(world: World, elapsedSeconds: number): CatchUpSummary {
  const seconds = Math.min(Math.max(0, elapsedSeconds), CONFIG.sim.maxOfflineSeconds);
  const before = world.totalBinStock();
  advance(world, seconds, CONFIG.sim.offlineStepSeconds);
  return { seconds, harvested: Math.max(0, world.totalBinStock() - before) };
}
