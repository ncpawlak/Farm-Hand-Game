import { CONFIG, CROPS } from '../config';
import type { GameController, Tool } from '../game/controller';
import type { CatchUpSummary } from '../sim/save';
import { taskProgress } from '../sim/simulate';
import type { Building, Worker } from '../sim/types';
import { binValue, type World } from '../sim/world';

const TOOLS: { tool: Tool; icon: string; label: string; cost?: number }[] = [
  { tool: 'select', icon: '👆', label: 'Select' },
  { tool: 'plot', icon: '🌱', label: 'Farmland', cost: CONFIG.costs.plot },
  { tool: 'path', icon: '🟫', label: 'Path', cost: CONFIG.costs.path },
  { tool: 'house', icon: '🏠', label: 'House', cost: CONFIG.costs.house },
  { tool: 'bin', icon: '📦', label: 'Bin', cost: CONFIG.costs.bin },
  { tool: 'demolish', icon: '🔨', label: 'Remove' },
];

const HINTS: Partial<Record<Tool, string>> = {
  select: 'Tap a field, bin or house to manage it',
  plot: 'Tap or drag to plant farmland · 4 in a square make a big field',
  path: 'Tap or drag to lay paths · connect fields & bins to a house',
  house: 'Tap to place a 3×3 employee house (4 beds)',
  bin: 'Tap to place an output bin',
  demolish: `Tap to remove · refunds ${CONFIG.demolishRefund * 100}%`,
};

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
      <div class="toolbar" id="toolbar">
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
    showModal(`
      <h2>Welcome back! 🌾</h2>
      <p>You were away for <b>${formatDuration(s.seconds)}</b>.</p>
      <p>${s.harvested > 0 ? `Your workers harvested <b>${s.harvested}</b> wheat into the bins.` : 'The farm rested quietly while you were gone.'}</p>
      <button class="btn primary" data-action="close-modal">Lovely</button>`);
  };

  $('menu-btn').addEventListener('click', () =>
    showModal(`
      <h2>Farm Hand</h2>
      <p>Build farmland, connect it to an employee house and an output bin with paths, then assign workers.
      Tap a bin to sell its harvest.</p>
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
      case 'sell':
        controller.act((w) => {
          const r = w.sellBin(id);
          if (r.ok) controller.onToast(`Sold for $${r.earned} 🌾`);
          return r;
        });
        break;
      case 'dismiss':
        controller.act((w) => w.dismissIdleWorker(id));
        break;
    }
    render();
  });

  let lastBody = '';
  let lastActions = '';
  panel.innerHTML = '<button class="icon-btn small panel-close" data-action="close" aria-label="Close">✕</button><div id="panel-body"></div><div class="panel-actions" id="panel-actions"></div>';
  const panelBody = $('panel-body');
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
    // Body and actions update separately so buttons are not replaced mid-tap.
    if (view.body !== lastBody) panelBody.innerHTML = lastBody = view.body;
    if (view.actions !== lastActions) panelActions.innerHTML = lastActions = view.actions;
  };

  controller.subscribe(render);
  window.setInterval(render, 250);
  render();
}

function renderPanel(world: World, b: Building): { body: string; actions: string } {
  const warning = (text: string) => `<div class="warning">⚠️ ${text}</div>`;
  const connected = world.connected.has(b.id);

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
      const idle = world.state.workers.some((w) => w.plotId == null);
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
      const lines = Object.entries(b.stock)
        .filter(([, n]) => (n ?? 0) > 0)
        .map(([crop, n]) => `<div class="stat"><span>${CROPS[crop as keyof typeof CROPS].name}</span><b>× ${n}</b></div>`)
        .join('');
      const value = binValue(b);
      return { body: `
        <div class="panel-head"><h3>Output bin</h3></div>
        ${lines || '<div class="muted">Empty — workers will drop harvests here.</div>'}
        ${connected ? '' : warning('Not connected to a house by a path')}`, actions: `<button class="btn primary" data-action="sell" ${value ? '' : 'disabled'}>Sell all · $${value}</button>` };
    }
    case 'house': {
      const residents = world.state.workers.filter((w) => w.homeId === b.id);
      const idle = residents.filter((w) => w.plotId == null).length;
      return { body: `
        <div class="panel-head"><h3>Employee house</h3></div>
        <div class="stat"><span>Residents</span><b>${residents.length}/${CONFIG.houseBeds} beds</b></div>
        <div class="stat"><span>Idle</span><b>${idle}</b></div>`, actions: `<button class="btn" data-action="dismiss" ${idle ? '' : 'disabled'}>Dismiss an idle worker</button>` };
    }
    case 'path':
      return { body: `
        <div class="panel-head"><h3>Path</h3></div>
        <div class="muted">Workers walk along paths between houses, fields and bins.</div>`, actions: `` };
  }
}

function describeWorker(world: World, w: Worker): string {
  if (w.blocked) return `⚠️ ${w.blocked}`;
  if (w.task === 'walking') {
    if (w.goal === 'bin') return 'Carrying harvest to a bin';
    if (w.goal === 'home') return 'Heading home';
    return 'Walking to the field';
  }
  const p = taskProgress(world, w);
  const label: Record<string, string> = {
    tilling: 'Tilling',
    planting: 'Planting',
    tending: 'Tending crops',
    harvesting: 'Harvesting',
  };
  if (label[w.task]) return `${label[w.task]} · ${pct(p ?? 0)}`;
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
