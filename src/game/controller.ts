import { CONFIG } from '../config';
import { catchUp, clearSave, loadWorld, saveWorld, type CatchUpSummary } from '../sim/save';
import { advance } from '../sim/simulate';
import type { Result } from '../sim/types';
import { World, type PlaceableType } from '../sim/world';

export type Tool = 'select' | PlaceableType | 'demolish';

type Listener = () => void;

/** Shared game state between the Phaser scene and the DOM HUD. */
export class GameController {
  world: World;
  tool: Tool = 'select';
  selectedId: number | null = null;
  private lastTickAt = Date.now();
  private lastSaveAt = Date.now();
  private listeners = new Set<Listener>();
  onToast: (msg: string) => void = () => {};
  onAwaySummary: (summary: CatchUpSummary) => void = () => {};

  constructor(private storage: Storage) {
    this.world = loadWorld(storage) ?? new World();
  }

  /** Catch up on time that passed since the last save (call once at startup). */
  resumeFromSave(): void {
    const elapsed = (Date.now() - this.world.state.savedAt) / 1000;
    this.reportCatchUp(catchUp(this.world, elapsed));
    this.lastTickAt = Date.now();
  }

  /** Advances the simulation using wall-clock time, so background tabs catch up. */
  tick(): void {
    const now = Date.now();
    const elapsed = (now - this.lastTickAt) / 1000;
    this.lastTickAt = now;
    if (elapsed > 5) this.reportCatchUp(catchUp(this.world, elapsed));
    else advance(this.world, elapsed);

    if (now - this.lastSaveAt > CONFIG.autosaveSeconds * 1000) this.save();
  }

  private reportCatchUp(summary: CatchUpSummary): void {
    if (summary.seconds >= 60) this.onAwaySummary(summary);
    this.emit();
  }

  save(): void {
    this.lastSaveAt = Date.now();
    try {
      saveWorld(this.world, this.storage);
    } catch {
      // Storage may be unavailable (private mode / quota); keep playing.
    }
  }

  reset(): void {
    clearSave(this.storage);
    this.world = new World();
    this.selectedId = null;
    this.tool = 'select';
    this.save();
    this.emit();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    if (tool !== 'select') this.selectedId = null;
    this.emit();
  }

  select(id: number | null): void {
    this.selectedId = id;
    this.emit();
  }

  /** Runs a world action, toasting failures and notifying listeners. */
  act(fn: (world: World) => Result, silent = false): boolean {
    const result = fn(this.world);
    if (!result.ok && !silent) this.onToast(result.reason);
    if (this.selectedId != null && !this.world.getBuilding(this.selectedId)) this.selectedId = null;
    this.emit();
    return result.ok;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    for (const fn of this.listeners) fn();
  }
}
