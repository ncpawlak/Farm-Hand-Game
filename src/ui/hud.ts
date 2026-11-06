import { CONFIG, CROPS, ITEMS, RECIPES, type GoodId, type ItemId } from '../config';
import type { GameController, Tool } from '../game/controller';
import type { CatchUpSummary } from '../sim/save';
import { taskProgress } from '../sim/simulate';
import type { Building, IndustryBuilding, Worker, WorkerRole } from '../sim/types';
import { binValue, isIdleWorker, stockCount, type World } from '../sim/world';

const TOOLS: { tool: Tool; icon: string; label: string; cost?: number }[] = [
  { tool: 'select', icon: '👆', label: 'Select' },
  { tool: 'plot', icon: '🌱', label: 'Farmland', cost: CONFIG.costs.plot },
  { tool: 'path', icon: '🟫', label: 'Path', cost: CONFIG.costs.path },
  { tool: 'house', icon: '🏠', label: 'House', cost: CONFIG.costs.house },
  { tool: 'bin', icon: '📦', label: 'Bin', cost: CONFIG.costs.bin },
  { tool: 'industry', icon: '🏭', label: 'Workshop', cost: CONFIG.costs.industry },
  { tool: 'demolish', icon: '🔨', label: 'Remove' },
];

const HINTS: Partial<Record<Tool, string>> = {
  select: 'Tap a field, bin, house or workshop to manage it',
  plot: 'Tap or drag to plant farmland · 4 in a square make a big field',
  path: 'Tap or drag to lay paths · connect fields & bins to a house',
  house: 'Tap to place a 3×3 employee house (4 beds)',
  bin: 'Tap to place an output bin',
  industry: 'Tap to place a 2×2 workshop with its own output bin · connect it with a path',
  demolish: `Tap to remove · refunds ${CONFIG.demolishRefund * 100}%`,
};

const ROLE_LABEL: Record<WorkerRole, string> = { crafter: 'Crafter', hauler: 'Hauler' };

export function mountHud(root: HTMLElement, controller: GameController, onReset: () => void): void {
  root.insertAdjacentHTML(
    'beforeend',
    `
    <div class="topbar">
      <div class="pill" id="money"></div>
      <div class="pill" id="workers"></div>
      <button class="icon-btn" id="menu-btn" aria-label="Menu">⋯</button>
    </div>
    <div class="panel" id="panel" hidden></div>
    <div class="bottom">
      <div class="hint" id="hint"></div>
      <div class="toolbar" id="toolbar" style="grid-template-columns: repeat(${TOOLS.length}, 1fr)">
        ${TOOLS.map(
          (t) => `<button class="tool" data-tool="${t.tool}">
            <span class="tool-icon">${t.icon}</span>
            <span class="tool-label">${t.label}</span>
            ${t.cost != null ? `<span class="tool-cost">$${t.cost}</span>` : ''}
          </button>`,
        ).join('')}
      </div>
    </div>
    <div class="toast" id="toast"></div>
    <div class="modal-backdrop" id="modal" hidden><div class="modal" id="modal-body"></div></div>
  `,
  );

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const moneyEl = $('money');
  const workersEl = $('workers');
  const hintEl = $('hint');
  const panel = $('panel');
  const toast = $('toast');
  const modal = $('modal');
  const modalBody = $('modal-body');
  const toolbar = $('toolbar');

  let toastTimer = 0;
  controller.onToast = (msg) => {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2000);
  };

  const showModal = (html: string) => {
    modalBody.innerHTML = html;
    modal.hidden = false;
  };
  controller.onAwaySummary = (s: CatchUpSummary) => {
    const lines: string[] = [];
    if (s.harvested > 0) lines.push(`harvested <b>${s.harvested}</b> wheat`);
    if (s.crafted > 0) lines.push(`crafted <b>${s.crafted}</b> goods`);
    showModal(`
      <h2>Welcome back! 🌾</h2>
      <p>You were away for <b>${formatDuration(s.seconds)}</b>.</p>
      <p>${lines.length ? `Your workers ${lines.join(' and ')}.` : 'The farm rested quietly while you were gone.'}</p>
      <button class="btn primary" data-action="close-modal">Lovely</button>`);
  };

  $('menu-btn').addEventListener('click', () =>
    showModal(`
      <h2>Farm Hand</h2>
      <p>Build farmland, connect it to an employee house and an output bin with paths, then assign workers.
      Tap a bin to sell its harvest.</p>
      <p>Workshops turn wheat into goods: hire a hauler to bring wheat from your bins and a crafter to make the
      chosen product into the workshop's own output bin. Haulers keep every connected workshop supplied,
      starting with whichever is emptiest.</p>
      <p class="muted">Progress saves automatically and keeps going while you're away (up to ${CONFIG.sim.maxOfflineSeconds / 3600}h).</p>
      <div class="row">
        <button class="btn danger" data-action="reset">Start a new farm</button>
        <button class="btn primary" data-action="close-modal">Close</button>
      </div>`),
  );

  modal.addEventListener('click', (e) => {
    const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
    if (action === 'close-modal' || e.target === modal) modal.hidden = true;
    if (action === 'reset' && confirm('Start over? Your current farm will be lost.')) {
      modal.hidden = true;
      onReset();
    }
  });

  toolbar.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-tool]');
    if (btn) controller.setTool(btn.dataset.tool as Tool);
  });

  const sell = (binId: number) =>
    controller.act((w) => {
      const r = w.sellBin(binId);
      if (r.ok) controller.onToast(`Sold for $${r.earned} 💰`);
      return r;
    });

  panel.addEventListener('click', (e) => {
    const action = (e.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
    const id = controller.selectedId;
    if (!action) return;
    if (action === 'close') return controller.select(null);
    if (id == null) return;
    switch (action) {
      case 'assign':
        controller.act((w) => w.assignWorker(id));
        break;
      case 'unassign':
        controller.act((w) => w.unassignWorker(id));
        break;
      case 'assign-crafter':
      case 'assign-hauler':
        controller.act((w) => w.assignIndustryWorker(id, action === 'assign-crafter' ? 'crafter' : 'hauler'));
        break;
      case 'unassign-crafter':
      case 'unassign-hauler':
        controller.act((w) => w.unassignIndustryWorker(id, action === 'unassign-crafter' ? 'crafter' : 'hauler'));
        break;
      case 'sell':
        sell(id);
        break;
      case 'sell-output': {
        const ind = controller.world.getIndustry(id);
        if (ind) sell(ind.binId);
        break;
      }
      case 'dismiss':
        controller.act((w) => w.dismissIdleWorker(id));
        break;
    }
    render();
  });

  panel.addEventListener('change', (e) => {
    const el = e.target as HTMLSelectElement;
    const id = controller.selectedId;
    if (el.dataset.action !== 'recipe' || id == null) return;
    controller.act((w) => w.setRecipe(id, el.value as GoodId));
    render();
  });

  let last = { body: '', controls: '', actions: '' };
  panel.innerHTML =
    '<button class="icon-btn small panel-close" data-action="close" aria-label="Close">✕</button>' +
    '<div id="panel-body"></div><div class="panel-controls" id="panel-controls"></div><div class="panel-actions" id="panel-actions"></div>';
  const panelBody = $('panel-body');
  const panelControls = $('panel-controls');
  const panelActions = $('panel-actions');
  const render = () => {
    const world = controller.world;
    moneyEl.textContent = `💰 $${world.money.toLocaleString()}`;
    workersEl.textContent = `👷 ${world.state.workers.length}/${world.bedCount()}`;
    hintEl.textContent = HINTS[controller.tool] ?? '';
    for (const btn of toolbar.querySelectorAll<HTMLElement>('[data-tool]')) {
      const tool = btn.dataset.tool as Tool;
      btn.classList.toggle('active', tool === controller.tool);
      const cost = TOOLS.find((t) => t.tool === tool)?.cost;
      btn.classList.toggle('unaffordable', cost != null && cost > world.money);
    }

    const b = world.getBuilding(controller.selectedId);
    panel.hidden = !b;
    const view = b ? renderPanel(world, b) : { body: '', actions: '' };
    // Each section updates separately so buttons and the dropdown are not replaced mid-tap.
    if (view.body !== last.body) panelBody.innerHTML = last.body = view.body;
    const controls = view.controls ?? '';
    if (controls !== last.controls) panelControls.innerHTML = last.controls = controls;
    if (view.actions !== last.actions) panelActions.innerHTML = last.actions = view.actions;
  };

  controller.subscribe(render);
  window.setInterval(render, 250);
  render();
}

interface PanelView {
  body: string;
  controls?: string;
  actions: string;
}

function renderPanel(world: World, b: Building): PanelView {
  const warning = (text: string) => `<div class="warning">⚠️ ${text}</div>`;
  const connected = world.connected.has(b.id);
  const idle = world.state.workers.some(isIdleWorker);
  const hireLabel = (what: string) => (idle ? `Assign idle worker as ${what}` : `Hire ${what} · $${CONFIG.workerHireCost}`);

  switch (b.type) {
    case 'plot': {
      const crop = CROPS[b.crop];
      const worker = world.getWorker(b.workerId);
      const stage =
        b.stage === 'untilled'
          ? 'Untilled soil'
          : b.stage === 'tilled'
            ? 'Tilled, ready to plant'
            : b.stage === 'planted'
              ? `Growing · ${pct(b.growElapsed / crop.growSeconds)}`
              : 'Ready to harvest';
      const yieldAmount = crop.yieldPerTile * b.w * b.h;
      return { body: `
        <div class="panel-head"><h3>${b.w > 1 ? `Big ${crop.name} field` : `${crop.name} field`}</h3></div>
        <div class="stat"><span>Crop</span><b>${stage}</b></div>
        <div class="stat"><span>Yield</span><b>${yieldAmount} ${crop.name.toLowerCase()} / harvest</b></div>
        <div class="stat"><span>Worker</span><b>${worker ? describeWorker(world, worker) : 'None'}</b></div>
        ${connected ? '' : warning('Not connected to a house by a path')}`, actions: `${
          worker
            ? `<button class="btn" data-action="unassign">Send worker home</button>`
            : `<button class="btn primary" data-action="assign">${idle ? 'Assign idle worker' : `Hire worker · $${CONFIG.workerHireCost}`}</button>`
        }` };
    }
    case 'bin': {
      const value = binValue(b);
      const attached = b.industryId != null;
      return { body: `
        <div class="panel-head"><h3>${attached ? 'Workshop output bin' : 'Output bin'}</h3></div>
        ${stockLines(b.stock) || `<div class="muted">Empty — ${attached ? 'the crafter puts finished goods here' : 'workers will drop harvests here'}.</div>`}
        ${connected ? '' : warning('Not connected to a house by a path')}`, actions: `<button class="btn primary" data-action="sell" ${value ? '' : 'disabled'}>Sell all · $${value}</button>` };
    }
    case 'industry':
      return renderIndustry(world, b, connected, hireLabel);
    case 'house': {
      const residents = world.state.workers.filter((w) => w.homeId === b.id);
      const idleHere = residents.filter(isIdleWorker).length;
      return { body: `
        <div class="panel-head"><h3>Employee house</h3></div>
        <div class="stat"><span>Residents</span><b>${residents.length}/${CONFIG.houseBeds} beds</b></div>
        <div class="stat"><span>Idle</span><b>${idleHere}</b></div>`, actions: `<button class="btn" data-action="dismiss" ${idleHere ? '' : 'disabled'}>Dismiss an idle worker</button>` };
    }
    case 'path':
      return { body: `
        <div class="panel-head"><h3>Path</h3></div>
        <div class="muted">Workers walk along paths between houses, fields, bins and workshops.</div>`, actions: `` };
  }
}

function renderIndustry(
  world: World,
  b: IndustryBuilding,
  connected: boolean,
  hireLabel: (what: string) => string,
): PanelView {
  const recipe = RECIPES[b.recipe];
  const input = ITEMS[recipe.input];
  const crafter = world.getWorker(b.crafterId);
  const hauler = world.getWorker(b.haulerId);
  const bin = world.getBin(b.binId);
  const value = bin ? binValue(bin) : 0;
  const bench = b.crafting
    ? `Making ${ITEMS[b.crafting].name.toLowerCase()} · ${pct(crafter ? taskProgress(world, crafter) ?? 0 : 0)}`
    : 'Empty';

  const options = (Object.keys(RECIPES) as GoodId[])
    .map((id) => {
      const r = RECIPES[id];
      const out = ITEMS[id];
      return `<option value="${id}" ${id === b.recipe ? 'selected' : ''}>${out.icon} ${out.name} — ${r.inputAmount} ${ITEMS[r.input].name.toLowerCase()} → ${r.outputAmount} · ${r.craftSeconds}s · $${out.sellPrice}</option>`;
    })
    .join('');

  const staffButton = (role: WorkerRole, worker: Worker | undefined) =>
    worker
      ? `<button class="btn" data-action="unassign-${role}">Send ${role} home</button>`
      : `<button class="btn primary" data-action="assign-${role}">${hireLabel(role)}</button>`;

  return {
    body: `
      <div class="panel-head"><h3>Workshop · ${ITEMS[b.recipe].icon} ${ITEMS[b.recipe].name}</h3></div>
      <div class="stat"><span>Storage</span><b>${input.icon} ${stockCount(b.storage)}/${CONFIG.industry.storageCapacity}</b></div>
      <div class="stat"><span>Workbench</span><b>${bench}</b></div>
      <div class="stat"><span>${ROLE_LABEL.crafter}</span><b>${crafter ? describeWorker(world, crafter) : 'None'}</b></div>
      <div class="stat"><span>${ROLE_LABEL.hauler}</span><b>${hauler ? describeWorker(world, hauler) : 'None'}</b></div>
      <div class="stat"><span>Output bin</span><b>${bin && stockCount(bin.stock) ? stockSummary(bin.stock) : 'Empty'}</b></div>
      ${connected ? '' : `<div class="warning">⚠️ Not connected to a house by a path</div>`}`,
    controls: `<label class="field"><span>Makes</span><select data-action="recipe">${options}</select></label>`,
    actions: `
      <div class="row">${staffButton('hauler', hauler)}${staffButton('crafter', crafter)}</div>
      <button class="btn" data-action="sell-output" ${value ? '' : 'disabled'}>Sell output · $${value}</button>`,
  };
}

function stockLines(stock: Partial<Record<ItemId, number>>): string {
  return Object.entries(stock)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([item, n]) => {
      const def = ITEMS[item as ItemId];
      return `<div class="stat"><span>${def.icon} ${def.name}</span><b>× ${n}</b></div>`;
    })
    .join('');
}

function stockSummary(stock: Partial<Record<ItemId, number>>): string {
  return Object.entries(stock)
    .filter(([, n]) => (n ?? 0) > 0)
    .map(([item, n]) => `${ITEMS[item as ItemId].icon} ${n}`)
    .join(' · ');
}

function describeWorker(world: World, w: Worker): string {
  if (w.blocked) return `⚠️ ${w.blocked}`;
  const load = w.carrying ? `${w.carrying.amount} ${ITEMS[w.carrying.item].name.toLowerCase()}` : '';
  if (w.task === 'walking') {
    switch (w.goal) {
      case 'bin':
        return w.carrying && w.carrying.item in CROPS ? 'Carrying harvest to a bin' : `Taking ${load} to a bin`;
      case 'home':
        return 'Heading home';
      case 'industry':
        return w.carrying ? `Bringing ${load} to ${w.targetId != null && w.targetId !== w.industryId ? 'another' : 'the'} workshop` : 'Walking to the workshop';
      case 'pickup':
        return 'Collecting from a bin';
      case 'outbin':
        return `Putting ${load} in the output bin`;
      default:
        return 'Walking to the field';
    }
  }
  const p = taskProgress(world, w);
  const label: Record<string, string> = {
    tilling: 'Tilling',
    planting: 'Planting',
    tending: 'Tending crops',
    harvesting: 'Harvesting',
    crafting: 'Crafting',
  };
  if (label[w.task]) return `${label[w.task]} · ${pct(p ?? 0)}`;
  if (w.task === 'fetching') return 'Getting supplies from storage';
  if (w.task === 'loading') return w.role === 'hauler' ? `Stacking ${load} in storage` : `Moving ${load} to the workbench`;
  if (w.task === 'waiting') return w.status ?? 'Waiting';
  return w.inside ? 'Getting ready' : 'Thinking…';
}

function pct(v: number): string {
  return `${Math.floor(Math.min(1, Math.max(0, v)) * 100)}%`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}