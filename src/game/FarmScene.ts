import * as Phaser from 'phaser';
import { CONFIG, CROPS, ITEMS, type ItemId } from '../config';
import { benchSpot, storageSpot, taskProgress } from '../sim/simulate';
import type { BinBuilding, Building, HouseBuilding, IndustryBuilding, PlotBuilding, Worker } from '../sim/types';
import { footprintCells, stockCount, type World } from '../sim/world';
import type { GameController } from './controller';

const T = CONFIG.grid.tileSize;

const COLORS = {
  bg: 0xf7f1e3,
  grassA: 0xa8d5a2,
  grassB: 0xa0cf9a,
  border: 0x86b87f,
  path: 0xecdcb4,
  pathEdge: 0xd8c495,
  pebble: 0xcdb98c,
  soil: 0xc79d70,
  soilTilled: 0x9c6d45,
  furrow: 0x845a37,
  sprout: 0x6dbb5b,
  wheat: 0xf2cf63,
  wheatDark: 0xd9b347,
  wall: 0xfaecd6,
  roof: 0xe8907e,
  roofDark: 0xcf7765,
  door: 0xa77650,
  window: 0xbfe3f0,
  crate: 0xcb9e6c,
  crateDark: 0xa97d4f,
  worker: 0x5677b8,
  crafter: 0x9a6fc0,
  hauler: 0xe0954f,
  floor: 0xe8d2a6,
  plank: 0xd4b98a,
  wallWood: 0xa97d4f,
  bench: 0x8f633d,
  stone: 0xb9b4ad,
  stoneDark: 0x8f8a84,
  oven: 0xc4694f,
  ovenDark: 0x8a4434,
  pallet: 0xc9a46f,
  workerBlocked: 0xc96a5f,
  shadow: 0x000000,
  barBg: 0x3d3a35,
  warn: 0xe0574f,
  select: 0xffffff,
  ghostOk: 0x7fd67a,
  ghostBad: 0xe06a5f,
};

const TASK_COLORS: Record<string, number> = {
  tilling: 0xb07a4a,
  planting: 0x6dbb5b,
  tending: 0x9be08a,
  harvesting: 0xf2cf63,
  crafting: 0x9a6fc0,
};

type Gesture = 'none' | 'pending' | 'pan' | 'paint' | 'pinch';

export class FarmScene extends Phaser.Scene {
  private g!: Phaser.GameObjects.Graphics;
  private bg!: Phaser.GameObjects.Graphics;
  private labels = new Map<string, Phaser.GameObjects.Text>();
  private seenLabels = new Set<string>();
  private downs = new Map<number, { x: number; y: number; sx: number; sy: number }>();
  private gesture: Gesture = 'none';
  private pinchDist = 0;
  private pinchMid = { x: 0, y: 0 };
  private lastPaintCell = '';
  private paintFailed = false;
  private hoverCell: { x: number; y: number } | null = null;
  private minZoom = 0.3;
  private maxZoom = 3;

  constructor(private controller: GameController) {
    super('farm');
  }

  private get world(): World {
    return this.controller.world;
  }

  create(): void {
    this.cameras.main.setBackgroundColor(COLORS.bg);
    this.bg = this.add.graphics();
    this.g = this.add.graphics();
    this.drawBackground();
    this.input.addPointer(2);
    this.input.mouse?.disableContextMenu();

    this.input.on('pointerdown', this.onDown, this);
    this.input.on('pointermove', this.onMove, this);
    this.input.on('pointerup', this.onUp, this);
    this.input.on('pointerupoutside', this.onUp, this);
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.zoomAt(p.x, p.y, this.cameras.main.zoom * Math.exp(-dy * 0.0015));
    });

    this.scale.on('resize', () => this.fitCamera(false));
    this.fitCamera(true);
  }

  update(): void {
    this.controller.tick();
    this.draw();
  }

  // ------------------------------------------------------------------ camera

  private fitCamera(recenter: boolean): void {
    const cam = this.cameras.main;
    const { width, height } = this.scale;
    const worldW = this.world.width * T;
    const worldH = this.world.height * T;
    const fit = Math.min(width / (worldW + T), (height - 160) / (worldH + T));
    this.minZoom = Math.max(0.15, fit * 0.7);
    this.maxZoom = Math.max(3, fit * 4);
    if (recenter) {
      cam.setZoom(Phaser.Math.Clamp(Math.min(fit * 1.6, 1.1), this.minZoom, this.maxZoom));
      cam.centerOn(worldW / 2, worldH / 2);
    } else {
      cam.setZoom(Phaser.Math.Clamp(cam.zoom, this.minZoom, this.maxZoom));
    }
    this.clampCamera();
  }

  /** Screen → world conversion that does not depend on the camera matrix being refreshed. */
  private toWorld(sx: number, sy: number): { x: number; y: number } {
    const cam = this.cameras.main;
    return {
      x: (sx - cam.width / 2) / cam.zoom + cam.width / 2 + cam.scrollX,
      y: (sy - cam.height / 2) / cam.zoom + cam.height / 2 + cam.scrollY,
    };
  }

  private toCell(sx: number, sy: number): { x: number; y: number } {
    const w = this.toWorld(sx, sy);
    return { x: Math.floor(w.x / T), y: Math.floor(w.y / T) };
  }

  private zoomAt(sx: number, sy: number, zoom: number): void {
    const cam = this.cameras.main;
    const before = this.toWorld(sx, sy);
    cam.setZoom(Phaser.Math.Clamp(zoom, this.minZoom, this.maxZoom));
    const after = this.toWorld(sx, sy);
    cam.scrollX += before.x - after.x;
    cam.scrollY += before.y - after.y;
    this.clampCamera();
  }

  private panBy(dx: number, dy: number): void {
    const cam = this.cameras.main;
    cam.scrollX -= dx / cam.zoom;
    cam.scrollY -= dy / cam.zoom;
    this.clampCamera();
  }

  private clampCamera(): void {
    const cam = this.cameras.main;
    const cx = Phaser.Math.Clamp(cam.scrollX + cam.width / 2, 0, this.world.width * T);
    const cy = Phaser.Math.Clamp(cam.scrollY + cam.height / 2, 0, this.world.height * T);
    cam.scrollX = cx - cam.width / 2;
    cam.scrollY = cy - cam.height / 2;
  }

  // ------------------------------------------------------------------- input

  private onDown(p: Phaser.Input.Pointer): void {
    this.downs.set(p.id, { x: p.x, y: p.y, sx: p.x, sy: p.y });
    if (this.downs.size >= 2) {
      this.gesture = 'pinch';
      this.initPinch();
      return;
    }
    this.gesture = p.rightButtonDown() || p.middleButtonDown() ? 'pan' : 'pending';
    this.paintFailed = false;
    this.lastPaintCell = '';
  }

  private onMove(p: Phaser.Input.Pointer): void {
    this.hoverCell = this.toCell(p.x, p.y);
    const d = this.downs.get(p.id);
    if (!d) return;
    const prev = { x: d.x, y: d.y };
    d.x = p.x;
    d.y = p.y;

    if (this.gesture === 'pinch') {
      if (this.downs.size < 2) return;
      const [a, b] = [...this.downs.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (this.pinchDist > 0) this.zoomAt(mid.x, mid.y, (this.cameras.main.zoom * dist) / this.pinchDist);
      this.panBy(mid.x - this.pinchMid.x, mid.y - this.pinchMid.y);
      this.pinchDist = dist;
      this.pinchMid = mid;
      return;
    }

    if (this.gesture === 'pending' && Math.hypot(p.x - d.sx, p.y - d.sy) > 8) {
      const paints = this.controller.tool === 'path' || this.controller.tool === 'plot';
      this.gesture = paints ? 'paint' : 'pan';
      if (paints) this.paintAt(this.toCell(d.sx, d.sy));
    }
    if (this.gesture === 'pan') this.panBy(p.x - prev.x, p.y - prev.y);
    if (this.gesture === 'paint') this.paintAt(this.toCell(p.x, p.y));
  }

  private onUp(p: Phaser.Input.Pointer): void {
    const d = this.downs.get(p.id);
    this.downs.delete(p.id);
    if (this.gesture === 'pending' && d) this.handleTap(this.toCell(d.sx, d.sy));
    if (this.downs.size === 0) this.gesture = 'none';
    else if (this.gesture === 'pinch') this.initPinch();
    if (p.wasTouch) this.hoverCell = null;
  }

  private initPinch(): void {
    const pts = [...this.downs.values()];
    if (pts.length < 2) {
      this.pinchDist = 0;
      return;
    }
    const [a, b] = pts;
    this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    this.pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private paintAt(cell: { x: number; y: number }): void {
    const key = `${cell.x},${cell.y}`;
    if (key === this.lastPaintCell) return;
    this.lastPaintCell = key;
    const tool = this.controller.tool;
    if (tool !== 'path' && tool !== 'plot') return;
    if (this.world.buildingAt(cell.x, cell.y) || !this.world.inBounds(cell.x, cell.y)) return;
    const ok = this.controller.act((w) => w.place(tool, cell.x, cell.y), this.paintFailed);
    if (!ok) this.paintFailed = true;
  }

  private handleTap(cell: { x: number; y: number }): void {
    const tool = this.controller.tool;
    const target = this.world.buildingAt(cell.x, cell.y);
    switch (tool) {
      case 'select':
        this.controller.select(target?.id ?? null);
        return;
      case 'demolish':
        if (target) this.controller.act((w) => w.demolish(target.id));
        return;
      default: {
        const anchor = this.anchorFor(tool, cell);
        this.controller.act((w) => w.place(tool, anchor.x, anchor.y));
      }
    }
  }

  private anchorFor(tool: 'plot' | 'path' | 'house' | 'bin' | 'industry', cell: { x: number; y: number }): { x: number; y: number } {
    const off = Math.floor(CONFIG.footprints[tool] / 2);
    return { x: cell.x - off, y: cell.y - off };
  }

  // ----------------------------------------------------------------- drawing

  private drawBackground(): void {
    const bg = this.bg;
    const { width, height } = this.world;
    bg.clear();
    bg.fillStyle(COLORS.border, 1);
    bg.fillRoundedRect(-10, -10, width * T + 20, height * T + 20, 18);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        bg.fillStyle((x + y) % 2 === 0 ? COLORS.grassA : COLORS.grassB, 1);
        bg.fillRect(x * T, y * T, T, T);
      }
    }
    // A few decorative tufts so the grass feels alive.
    bg.fillStyle(0x8fc488, 1);
    for (let i = 0; i < width * height * 0.35; i++) {
      const h = hash(i * 7919);
      const px = (h % (width * T)) | 0;
      const py = (hash(i * 104729) % (height * T)) | 0;
      bg.fillTriangle(px, py, px + 3, py - 7, px + 6, py);
    }
  }

  private draw(): void {
    const g = this.g;
    g.clear();
    const world = this.world;
    this.seenLabels.clear();

    for (const b of world.state.buildings) if (b.type === 'path') this.drawPath(b);
    for (const b of world.state.buildings) {
      if (b.type === 'plot') this.drawPlot(b);
      else if (b.type === 'house') this.drawHouse(b);
      else if (b.type === 'industry') this.drawIndustry(b);
      else if (b.type === 'bin') this.drawBin(b);
      const attachedBin = b.type === 'bin' && b.industryId != null;
      if ((b.type === 'plot' || b.type === 'bin' || b.type === 'industry') && !attachedBin && !world.connected.has(b.id)) {
        this.drawWarning(b);
      }
    }
    for (const [key, label] of this.labels) {
      if (!this.seenLabels.has(key)) {
        label.destroy();
        this.labels.delete(key);
      }
    }

    const selected = world.getBuilding(this.controller.selectedId);
    if (selected) {
      g.lineStyle(3, COLORS.select, 1);
      g.strokeRoundedRect(selected.x * T + 1, selected.y * T + 1, selected.w * T - 2, selected.h * T - 2, 8);
    }

    for (const w of world.state.workers) if (!w.inside) this.drawWorker(w);
    this.drawGhost();
  }

  private drawPath(b: Building): void {
    const g = this.g;
    const x = b.x * T;
    const y = b.y * T;
    g.fillStyle(COLORS.pathEdge, 1);
    g.fillRect(x, y, T, T);
    g.fillStyle(COLORS.path, 1);
    g.fillRect(x + 2, y + 2, T - 4, T - 4);
    g.fillStyle(COLORS.pebble, 1);
    for (let i = 0; i < 3; i++) {
      const h = hash(b.x * 31 + b.y * 17 + i * 13);
      g.fillCircle(x + 8 + (h % (T - 16)), y + 8 + (hash(h) % (T - 16)), 2);
    }
  }

  private drawPlot(p: PlotBuilding): void {
    const g = this.g;
    const x = p.x * T;
    const y = p.y * T;
    const w = p.w * T;
    const h = p.h * T;
    g.fillStyle(p.stage === 'untilled' ? COLORS.soil : COLORS.soilTilled, 1);
    g.fillRoundedRect(x + 3, y + 3, w - 6, h - 6, 8);

    if (p.stage !== 'untilled') {
      g.lineStyle(2, COLORS.furrow, 0.7);
      const rows = p.h * 3;
      for (let r = 0; r < rows; r++) {
        const ry = y + ((r + 0.5) * h) / rows;
        g.lineBetween(x + 8, ry, x + w - 8, ry);
      }
    }

    if (p.stage === 'planted' || p.stage === 'ready') {
      const growth = p.stage === 'ready' ? 1 : p.growElapsed / CROPS[p.crop].growSeconds;
      const cols = p.w * 3;
      const rows = p.h * 3;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cx = x + ((c + 0.5) * w) / cols;
          const cy = y + ((r + 0.5) * h) / rows;
          if (p.stage === 'ready') {
            g.fillStyle(COLORS.wheatDark, 1);
            g.fillRoundedRect(cx - 3, cy - 9, 6, 12, 3);
            g.fillStyle(COLORS.wheat, 1);
            g.fillRoundedRect(cx - 2, cy - 10, 4, 9, 2);
          } else {
            g.fillStyle(COLORS.sprout, 1);
            g.fillCircle(cx, cy - 1, 1.5 + growth * 3.5);
          }
        }
      }
    }
  }

  private drawHouse(b: HouseBuilding): void {
    const g = this.g;
    const x = b.x * T;
    const y = b.y * T;
    const w = b.w * T;
    const h = b.h * T;
    g.fillStyle(COLORS.shadow, 0.12);
    g.fillEllipse(x + w / 2, y + h - 10, w - 16, 16);
    g.fillStyle(COLORS.wall, 1);
    g.fillRoundedRect(x + 10, y + h * 0.4, w - 20, h * 0.55, 6);
    g.fillStyle(COLORS.roofDark, 1);
    g.fillTriangle(x + 2, y + h * 0.45, x + w / 2, y + 6, x + w - 2, y + h * 0.45);
    g.fillStyle(COLORS.roof, 1);
    g.fillTriangle(x + 10, y + h * 0.42, x + w / 2, y + 12, x + w - 10, y + h * 0.42);
    g.fillStyle(COLORS.door, 1);
    g.fillRoundedRect(x + w / 2 - 10, y + h - 40, 20, 32, 4);
    g.fillStyle(COLORS.window, 1);
    g.fillRoundedRect(x + 24, y + h * 0.52, 22, 18, 3);
    g.fillRoundedRect(x + w - 46, y + h * 0.52, 22, 18, 3);
  }

  private drawBin(b: BinBuilding): void {
    const g = this.g;
    const x = b.x * T;
    const y = b.y * T;
    const total = stockCount(b.stock);
    g.fillStyle(COLORS.shadow, 0.12);
    g.fillRoundedRect(x + 6, y + 10, T - 8, T - 10, 6);
    g.fillStyle(COLORS.crate, 1);
    g.fillRoundedRect(x + 5, y + 12, T - 10, T - 17, 5);
    g.lineStyle(2, COLORS.crateDark, 1);
    g.lineBetween(x + 7, y + 22, x + T - 7, y + 22);
    g.lineBetween(x + 7, y + 32, x + T - 7, y + 32);
    if (total > 0) {
      const top = topItem(b.stock);
      g.fillStyle(ITEMS[top].color, 1);
      g.lineStyle(1.5, 0x000000, 0.15);
      g.fillCircle(x + T / 2 - 7, y + 12, 6);
      g.strokeCircle(x + T / 2 - 7, y + 12, 6);
      g.fillCircle(x + T / 2 + 6, y + 11, 7);
      g.strokeCircle(x + T / 2 + 6, y + 11, 7);
    }
    this.label(`bin${b.id}`, String(total), x + T / 2, y + 38);
  }

  private drawIndustry(b: IndustryBuilding): void {
    const g = this.g;
    const x = b.x * T;
    const y = b.y * T;
    const w = b.w * T;
    const h = b.h * T;

    // Chute joining the workshop to its attached output bin.
    const bin = this.world.getBin(b.binId);
    if (bin) {
      g.fillStyle(COLORS.wallWood, 1);
      g.fillRect(x + w - 6, bin.y * T + 18, bin.x * T - (x + w) + 14, 12);
      g.fillStyle(COLORS.plank, 1);
      g.fillRect(x + w - 6, bin.y * T + 20, bin.x * T - (x + w) + 14, 8);
    }

    g.fillStyle(COLORS.shadow, 0.12);
    g.fillEllipse(x + w / 2, y + h - 4, w - 8, 14);
    g.fillStyle(COLORS.wallWood, 1);
    g.fillRoundedRect(x + 2, y + 2, w - 4, h - 4, 10);
    g.fillStyle(COLORS.floor, 1);
    g.fillRoundedRect(x + 7, y + 7, w - 14, h - 14, 7);
    g.lineStyle(1.5, COLORS.plank, 1);
    for (let i = 1; i < 6; i++) g.lineBetween(x + 9, y + 7 + (i * (h - 14)) / 6, x + w - 9, y + 7 + (i * (h - 14)) / 6);
    // Doorway gap on the front wall.
    g.fillStyle(COLORS.floor, 1);
    g.fillRect(x + w / 2 - 10, y + h - 8, 20, 6);

    // Storage section: a pallet with stacked sacks of raw goods.
    const s = storageSpot(b);
    const sx = s.x * T;
    const sy = s.y * T;
    g.fillStyle(COLORS.pallet, 1);
    g.fillRoundedRect(sx - 18, sy - 14, 36, 30, 4);
    g.lineStyle(1.5, COLORS.crateDark, 0.8);
    g.lineBetween(sx - 18, sy - 4, sx + 18, sy - 4);
    g.lineBetween(sx - 18, sy + 6, sx + 18, sy + 6);
    const stored = stockCount(b.storage);
    const sacks = Math.min(9, Math.ceil((stored / CONFIG.industry.storageCapacity) * 9));
    for (let i = 0; i < sacks; i++) {
      const col = i % 3;
      const row = Math.floor(i / 3);
      g.fillStyle(COLORS.wheatDark, 1);
      g.fillCircle(sx - 10 + col * 10, sy + 8 - row * 9, 5.5);
      g.fillStyle(COLORS.wheat, 1);
      g.fillCircle(sx - 10 + col * 10, sy + 7 - row * 9, 4);
    }
    this.label(`ind${b.id}s`, `${stored}/${CONFIG.industry.storageCapacity}`, sx, sy + 24, '11px');

    // Workbench with a recipe-specific station.
    const p = benchSpot(b);
    const bx = p.x * T;
    const by = p.y * T;
    g.fillStyle(COLORS.bench, 1);
    g.fillRoundedRect(bx - 20, by - 18, 40, 18, 4);
    const station = b.crafting ?? b.recipe;
    if (station === 'flour') {
      g.fillStyle(COLORS.stoneDark, 1);
      g.fillCircle(bx, by - 12, 11);
      g.fillStyle(COLORS.stone, 1);
      g.fillCircle(bx, by - 13, 9);
      g.fillStyle(COLORS.stoneDark, 1);
      g.fillCircle(bx, by - 13, 2.5);
    } else {
      g.fillStyle(COLORS.ovenDark, 1);
      g.fillRoundedRect(bx - 13, by - 26, 26, 20, { tl: 12, tr: 12, bl: 2, br: 2 });
      g.fillStyle(COLORS.oven, 1);
      g.fillRoundedRect(bx - 11, by - 24, 22, 17, { tl: 10, tr: 10, bl: 2, br: 2 });
      g.fillStyle(b.crafting ? 0xffb347 : 0x3d2b20, 1);
      g.fillRoundedRect(bx - 5, by - 15, 10, 7, { tl: 4, tr: 4, bl: 0, br: 0 });
    }
    if (b.crafting) {
      // A little puff while working.
      const t = this.time.now / 400;
      g.fillStyle(0xffffff, 0.6);
      g.fillCircle(bx + 8 + Math.sin(t) * 2, by - 30 - (t % 1) * 6, 4);
    }
    this.label(`ind${b.id}r`, ITEMS[b.recipe].icon, x + 16, y + 16, '15px');
  }

  /** Draws (or reuses) a text label for this frame. */
  private label(key: string, text: string, x: number, y: number, fontSize = '13px'): void {
    let label = this.labels.get(key);
    if (!label) {
      label = this.add
        .text(0, 0, '', { fontFamily: 'system-ui, sans-serif', fontSize, color: '#5a3d22', fontStyle: 'bold' })
        .setOrigin(0.5)
        .setResolution(Math.min(3, window.devicePixelRatio || 1));
      this.labels.set(key, label);
    }
    if (label.text !== text) label.setText(text);
    label.setPosition(x, y);
    this.seenLabels.add(key);
  }

  private drawWarning(b: Building): void {
    const g = this.g;
    const cx = (b.x + b.w) * T - 8;
    const cy = b.y * T + 8;
    g.fillStyle(COLORS.warn, 1);
    g.fillCircle(cx, cy, 7);
    g.fillStyle(0xffffff, 1);
    g.fillRect(cx - 1, cy - 4, 2, 5);
    g.fillRect(cx - 1, cy + 2, 2, 2);
  }

  private drawWorker(w: Worker): void {
    const g = this.g;
    const x = w.x * T;
    const y = w.y * T;
    const bob = w.task === 'walking' ? Math.sin(this.time.now / 90 + w.id) * 1.5 : 0;
    g.fillStyle(COLORS.shadow, 0.18);
    g.fillEllipse(x, y + 7, 14, 6);
    g.fillStyle(0xffffff, 1);
    g.fillCircle(x, y + bob, 8);
    g.fillStyle(w.blocked ? COLORS.workerBlocked : w.role === 'crafter' ? COLORS.crafter : w.role === 'hauler' ? COLORS.hauler : COLORS.worker, 1);
    g.fillCircle(x, y + bob, 6.5);

    if (w.carrying) {
      g.fillStyle(ITEMS[w.carrying.item].color, 1);
      g.lineStyle(1.5, 0x000000, 0.2);
      g.fillRoundedRect(x + 4, y - 14 + bob, 9, 8, 2);
      g.strokeRoundedRect(x + 4, y - 14 + bob, 9, 8, 2);
    }

    if (w.blocked) {
      g.fillStyle(COLORS.warn, 1);
      g.fillCircle(x, y - 18, 7);
      g.fillStyle(0xffffff, 1);
      g.fillRect(x - 1, y - 22, 2, 5);
      g.fillRect(x - 1, y - 16, 2, 2);
      return;
    }

    const progress = taskProgress(this.world, w);
    if (progress != null) {
      const bw = 30;
      g.fillStyle(COLORS.barBg, 0.75);
      g.fillRoundedRect(x - bw / 2 - 1, y - 19, bw + 2, 7, 3);
      g.fillStyle(TASK_COLORS[w.task] ?? 0xffffff, 1);
      g.fillRoundedRect(x - bw / 2, y - 18, Math.max(2, bw * Math.min(1, progress)), 5, 2);
    }
  }

  private drawGhost(): void {
    const tool = this.controller.tool;
    const cell = this.hoverCell;
    if (!cell || tool === 'select' || this.gesture === 'pan' || this.gesture === 'pinch') return;
    const g = this.g;
    if (tool === 'demolish') {
      let b = this.world.buildingAt(cell.x, cell.y);
      if (b?.type === 'bin' && b.industryId != null) b = this.world.getBuilding(b.industryId);
      if (!b) return;
      g.fillStyle(COLORS.ghostBad, 0.35);
      if (b.type === 'industry') for (const c of footprintCells('industry', b.x, b.y)) g.fillRect(c.x * T, c.y * T, T, T);
      else g.fillRoundedRect(b.x * T, b.y * T, b.w * T, b.h * T, 8);
      return;
    }
    const a = this.anchorFor(tool, cell);
    const ok = this.world.canPlace(tool, a.x, a.y).ok;
    g.fillStyle(ok ? COLORS.ghostOk : COLORS.ghostBad, 0.35);
    if (tool === 'industry') {
      for (const c of footprintCells(tool, a.x, a.y)) g.fillRect(c.x * T, c.y * T, T, T);
    } else {
      const size = CONFIG.footprints[tool];
      g.fillRoundedRect(a.x * T, a.y * T, size * T, size * T, 8);
    }
  }

  /** Call after the world object is replaced (e.g. reset). */
  refreshWorld(): void {
    for (const label of this.labels.values()) label.destroy();
    this.labels.clear();
    this.drawBackground();
    this.fitCamera(true);
  }
}

/** The item a bin holds the most of (decides the colour shown on top). */
function topItem(stock: Partial<Record<ItemId, number>>): ItemId {
  let best: ItemId = 'wheat';
  let most = -1;
  for (const [item, n] of Object.entries(stock)) {
    if ((n ?? 0) > most) {
      most = n ?? 0;
      best = item as ItemId;
    }
  }
  return best;
}

function hash(n: number): number {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}
