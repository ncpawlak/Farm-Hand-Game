# Farm Hand 🌾

A cozy phone farming game. Build a homestead on a tile grid, hire workers to farm the land, and (soon) move product around to craft goods.

Built with TypeScript + [Phaser](https://phaser.io), packaged as an installable PWA.

## v1 gameplay

- **Farmland** ($50): one plot per tile. Four plots placed in a 2×2 square merge into a **big field** that one worker farms at the same speed and with 4× the yield.
- **Paths** ($5): workers only walk on paths. Fields and bins must be connected to an employee house by paths (or by touching it directly); unconnected buildings show a red ❗.
- **Employee house** ($200, 3×3): 4 beds. You can only hire as many workers as you have beds.
- **Output bin** ($100): workers carry harvests here. Tap a bin to sell its contents.
- **Workers** ($25 to hire): tap a field → *Hire worker*. Each worker walks from the house to the field, then tills → plants → tends while the crop grows → harvests, carries the crop to the nearest bin, and returns. A progress bar shows the current task.
- **Remove**: demolishing refunds 50%.
- Progress autosaves to `localStorage` and keeps running while the game is closed (up to 12 hours).

All balance numbers (costs, timings, prices, grid size) live in [`src/config.ts`](src/config.ts).

## Controls

| Action | Touch | Mouse |
| --- | --- | --- |
| Place / select | Tap | Click |
| Paint paths & farmland | Drag (with that tool) | Drag |
| Pan | Drag (tools other than Farmland/Path) or two fingers | Drag (tools other than Farmland/Path) or right-drag |
| Zoom | Pinch | Wheel |

## Development

```sh
npm install
npm run dev        # http://localhost:5173 (also reachable on your LAN for phone testing)
npm test           # simulation unit tests (vitest)
npm run build      # typecheck + production build with service worker
npm run preview    # serve the production build
```

In dev builds, the game controller is exposed as `window.farm` for debugging.

## Structure

- `src/config.ts`: tunable balance values and crop definitions.
- `src/sim/`: pure, framework-free game simulation (world rules, pathfinding, worker state machine, save/offline catch-up), unit tested.
- `src/game/`: Phaser scene (rendering and input) and the controller that ticks the sim on wall-clock time.
- `src/ui/`: DOM HUD (toolbar, info panels, toasts).

## Roadmap

- v2: transport workers carrying product from bins to destinations.
- Then: more crops, processing buildings that turn products into goods, and real art.
