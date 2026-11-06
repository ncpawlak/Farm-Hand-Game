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
- **Hauler** (orange): carries up to 5 of a recipe's input from your farm bins into workshop storage (max 20). Haulers auto-route: each trip goes to whichever connected workshop is emptiest (counting deliveries already on the way), so one hauler can supply several workshops and multiple haulers share the work without overfilling.
- **Crafter** (purple): moves inputs from storage to the workbench, crafts the good, and puts it in the attached bin. Tap the workshop or its bin to sell the output.
- Farmers never deliver to workshop bins. Removing a workshop (or its bin) sells everything it holds and sends its workers home.

## Conveyors & Industry

- **Conveyor** ($10/tile): drag to lay a belt; the drag direction sets the flow. A belt pulls from an adjacent workshop output bin and delivers into whatever it points at (an Industry, or any bin). Tap a belt with the Conveyor tool (or *Turn* in its panel) to rotate it.
- **Merge / split**: belts feeding one belt merge in zipper order (alternating sides). Start a drag on an existing belt to branch it; a belt with several outputs splits round-robin, skipping any blocked side.
- Workers can't walk on belts. Crossing a path and a belt (either way round) automatically builds a **bridge** that workers walk over while items pass underneath.
- **Industry** ($500, 2×2, brick) comes with an attached output bin and is fed only by conveyors (no hauler). Hire a crafter and pick a recipe:
  - 🥐 **Pastry**: 2 flour → 1 in 8s, sells for $30.
  - 🥪 **Sandwich**: 2 bread → 1 in 10s, sells for $40.
- When an Industry's storage is full (20) or the item doesn't match its recipe, belts back up and wait.

All balance numbers (costs, timings, prices, recipes, grid size) live in [`src/config.ts`](src/config.ts). Crop growth is temporarily set to **5s** for testing (normally 30s).

## Controls

| Action | Touch | Mouse |
| --- | --- | --- |
| Place / select | Tap | Click |
| Paint paths, belts & farmland | Drag (with that tool) | Drag |
| Pan | Drag (tools other than Farmland/Path/Conveyor) or two fingers | Drag (tools other than Farmland/Path/Conveyor) or right-drag |
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
- More crops and recipes, and real art.
