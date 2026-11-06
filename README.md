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

## Workshops

- **Workshop** ($300, 2×2) comes with an attached output bin (free, placed to its right). Connect it to a house with paths.
- Tap the workshop and use the **Makes** dropdown to pick a recipe:
  - 🥣 **Flour**: 2 wheat → 1 in 6s, sells for $10.
  - 🍞 **Bread**: 3 wheat → 1 in 10s, sells for $16.
- **Hauler** (orange): carries up to 5 of the recipe's input from your farm bins into the workshop's storage (max 20).
- **Crafter** (purple): moves inputs from storage to the workbench, crafts the good, and puts it in the attached bin. Tap the workshop or its bin to sell the output.
- Farmers never deliver to workshop bins. Removing a workshop (or its bin) sells everything it holds and sends its workers home.

All balance numbers (costs, timings, prices, recipes, grid size) live in [`src/config.ts`](src/config.ts). Crop growth is temporarily set to **5s** for testing (normally 30s).

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

- Transport workers carrying goods to destinations (markets, orders).
- More crops and recipes, chained workshops, and real art.
