/** Panel system — shared scroll / minimize-to-chip / drawer behavior.
 *
 * Packet 233a: every floating 2D panel in the demo gets the same three
 * behaviors from this one module:
 *
 *  1. SCROLL — every panel body scrolls. Panels opt in with the
 *     `data-panel-scroll` attribute (or the host calls
 *     `ensurePanelScrollBody` on mount). The scroll region gets a thin
 *     translucent-blue scrollbar; see panel-system.css.
 *  2. MINIMIZE-TO-CHIP — every panel gets a minimize control. Minimizing
 *     collapses the panel to a small translucent chip (feature label +
 *     restore affordance) near the panel's last position (docked to a
 *     screen edge on narrow viewports). Clicking the chip restores the
 *     panel. Minimized state and last position persist in localStorage
 *     under `matumbo.panel.<id>`, remembered until moved again.
 *  3. ONE DRAWER — `mountWorldDrawer` builds the single scrollable
 *     left-side world directory ("Find a connected feature") with
 *     sections, so utility panels dock as chips instead of scattering
 *     overlapping boxes across the field.
 *
 * This module is importable in node: nothing touches the DOM at the top
 * level. Browser helpers take `documentRoot` / `windowRoot` arguments and
 * degrade silently when they are absent.
 *
 * Two enhance modes:
 *  - `mode:'chip'` (default): full behavior — injects a minimize button,
 *    hides the panel on minimize and shows a chip. Used on narrow
 *    viewports (mobile-panel-manager) and for the drawer itself.
 *  - `mode:'delegate'`: the host owns the minimize visuals (on desktop
 *    that is centered-surfaces' surface-grip compact chip). The module
 *    only applies the scroll body and wires persisted minimized state
 *    through the host's `applyMinimized` callback.
 *
 * Presentation only. This changes no ledger, identity, signing,
 * settlement, wallet, custody, or authority state, and makes no network
 * calls.
 */

import { FEATURE_DEFINITIONS } from './feature-navigator.js?v=20260918-muse2';

/* ------------------------------------------------------------------ */
/* Pure: storage keys                                                  */
/* ------------------------------------------------------------------ */

export const PANEL_STORE_PREFIX = 'matumbo.panel.';
export const PANEL_SCROLL_ATTR = 'data-panel-scroll';

/** Normalize a panel id into a safe storage suffix. */
export function sanitizePanelId(id) {
  const s = String(id == null ? '' : id).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'panel';
}

/** Namespaced localStorage key for one panel, e.g. `matumbo.panel.city-journey`. */
export function panelStorageKey(id) {
  return PANEL_STORE_PREFIX + sanitizePanelId(id);
}

/* ------------------------------------------------------------------ */
/* Pure: persisted panel state                                         */
/* ------------------------------------------------------------------ */

const DEFAULT_PANEL_STATE = Object.freeze({ minimized: false, x: null, y: null });

function normalizeStoredState(raw) {
  const numOrNull = (v) => (v === null || v === undefined || v === ''
    ? null
    : (Number.isFinite(Number(v)) ? Number(v) : null));
  const out = { minimized: false, x: null, y: null };
  if (!raw || typeof raw !== 'object') return out;
  out.minimized = raw.minimized === true;
  out.x = numOrNull(raw.x);
  out.y = numOrNull(raw.y);
  return out;
}

/** Read `{minimized, x, y}` for a panel. Never throws; missing/corrupt → defaults. */
export function readPanelState(storage, id) {
  try {
    if (!storage || typeof storage.getItem !== 'function') return { ...DEFAULT_PANEL_STATE };
    const raw = storage.getItem(panelStorageKey(id));
    if (!raw) return { ...DEFAULT_PANEL_STATE };
    return normalizeStoredState(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PANEL_STATE };
  }
}

/**
 * Merge `patch` into the stored state for a panel and write it back.
 * Returns true when the write landed.
 */
export function writePanelState(storage, id, patch) {
  try {
    if (!storage || typeof storage.setItem !== 'function') return false;
    const next = { ...readPanelState(storage, id), ...(patch || {}) };
    storage.setItem(panelStorageKey(id), JSON.stringify(next));
    return true;
  } catch {
    return false;
  }
}

/** True when a panel has any persisted state (vs. never-seen defaults). */
export function hasPanelState(storage, id) {
  try {
    if (!storage || typeof storage.getItem !== 'function') return false;
    return storage.getItem(panelStorageKey(id)) != null;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Pure: motion + chip state machine                                   */
/* ------------------------------------------------------------------ */

/** True when the user asked for reduced motion. Safe in node (view optional). */
export function isReducedMotion(view) {
  try {
    const mq = view && typeof view.matchMedia === 'function'
      ? view.matchMedia('(prefers-reduced-motion: reduce)')
      : null;
    return !!(mq && mq.matches === true);
  } catch {
    return false;
  }
}

/** Chip state machine: 'chip' when minimized, 'expanded' otherwise. */
export function resolveChipMode(state) {
  return state && state.minimized === true ? 'chip' : 'expanded';
}

/** Pure transition: toggle minimized, keeping the remembered position. */
export function nextChipState(state) {
  const s = normalizeStoredState(state);
  return { ...s, minimized: !s.minimized };
}

/* ------------------------------------------------------------------ */
/* Pure: dock layout                                                   */
/* ------------------------------------------------------------------ */

/**
 * Slot for the i-th docked chip. Docked utility panels stack in one tidy
 * column instead of scattering overlapping boxes. Pure given a viewport.
 */
export function dockSlot(index, { x = 10, gap = 52, edge = 'bottom-left', viewport = null } = {}) {
  const i = Math.max(0, Math.floor(Number(index) || 0));
  if (edge === 'bottom-left' && viewport && Number.isFinite(viewport.h)) {
    return { x, y: Math.max(8, Math.round(viewport.h) - 150 - i * gap) };
  }
  return { x, y: 64 + i * gap };
}

/* ------------------------------------------------------------------ */
/* Pure: drawer section registry                                       */
/* ------------------------------------------------------------------ */

/**
 * Ordered registry of drawer sections. Hosts register the sections they
 * own; the drawer renders them sorted by `order`, then title.
 */
export class DrawerSectionRegistry {
  constructor() {
    this.sections = new Map();
  }
  register(id, { title = '', order = 100, blurb = '' } = {}) {
    if (!id) return this;
    this.sections.set(String(id), { id: String(id), title: String(title), order: Number(order) || 100, blurb: String(blurb) });
    return this;
  }
  unregister(id) {
    this.sections.delete(String(id));
    return this;
  }
  has(id) {
    return this.sections.has(String(id));
  }
  list() {
    return [...this.sections.values()].sort((a, b) => (a.order - b.order) || a.title.localeCompare(b.title));
  }
}

/** The default world-drawer sections for Packet 233a. */
export function defaultDrawerSections() {
  return new DrawerSectionRegistry()
    .register('features', { title: 'Features', order: 10, blurb: 'Every openable local feature. Choosing one opens its console.' })
    .register('city', { title: 'City journey', order: 20, blurb: 'Districts ride the canonical feature channel — local only.' })
    .register('device', { title: 'Device', order: 30, blurb: 'Camera, audio and gesture input. Nothing leaves this browser.' });
}

/* ------------------------------------------------------------------ */
/* Browser helpers (no top-level DOM)                                  */
/* ------------------------------------------------------------------ */

function elMatches(el, tag) {
  try {
    return !!(el && el.tagName === tag);
  } catch {
    return false;
  }
}

function childElements(el) {
  try {
    return el && el.children ? Array.from(el.children) : [];
  } catch {
    return [];
  }
}

/** Human label for a panel element (aria-label, heading, or id). */
export function panelLabel(el) {
  if (!el) return 'Panel';
  try {
    const labelled = el.getAttribute && el.getAttribute('aria-label');
    if (labelled && labelled.trim()) return labelled.trim().slice(0, 64);
    for (const child of childElements(el)) {
      if (/^H[1-6]$/.test(child.tagName || '')) {
        const text = child.textContent && child.textContent.trim();
        if (text) return text.slice(0, 64);
      }
    }
  } catch { /* fall through */ }
  const id = String(el.id || '').replace(/[-_]+/g, ' ').trim();
  return id ? id.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Panel';
}

function isNarrowViewport(windowRoot) {
  try {
    if (windowRoot && typeof windowRoot.matchMedia === 'function') {
      return windowRoot.matchMedia('(max-width:700px)').matches === true;
    }
    return typeof windowRoot?.innerWidth === 'number' ? windowRoot.innerWidth <= 700 : false;
  } catch {
    return false;
  }
}

function viewportSize(windowRoot) {
  return {
    w: typeof windowRoot?.innerWidth === 'number' ? windowRoot.innerWidth : 1024,
    h: typeof windowRoot?.innerHeight === 'number' ? windowRoot.innerHeight : 768,
  };
}

function clampNum(n, lo, hi) {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Wrap a panel's body (everything after its header) in a
 * `.panel-scroll-body` so the body scrolls with a themed scrollbar while
 * the header stays put. Idempotent. The surface-grip (desktop) is never
 * wrapped: it must stay visible on a compacted chip.
 */
export function ensurePanelScrollBody(el, documentRoot) {
  if (!el || !documentRoot || typeof documentRoot.createElement !== 'function') return null;
  try {
    const existing = childElements(el).find((c) => c.classList && c.classList.contains('panel-scroll-body'));
    if (existing) return existing;
    const kids = childElements(el).filter((c) => !(c.classList && c.classList.contains('surface-grip')));
    if (kids.length === 0) return null;
    let splitAt = kids.length; // default: wrap everything (no header found)
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      const tag = c.tagName || '';
      const cid = c.id || '';
      if (tag === 'HEADER' || tag === 'SUMMARY' || /-head$/.test(cid) || c.classList.contains('world-drawer-head')) {
        splitAt = i + 1;
        break;
      }
      // A leading block that only holds a heading counts as the header.
      if (i === 0 && /^H[1-6]$/.test(tag)) {
        splitAt = 1;
        break;
      }
    }
    if (splitAt >= kids.length) return null; // nothing after the header
    const wrap = documentRoot.createElement('div');
    wrap.className = 'panel-scroll-body';
    const anchor = kids[splitAt];
    el.insertBefore(wrap, anchor);
    for (let i = splitAt; i < kids.length; i++) wrap.appendChild(kids[i]);
    return wrap;
  } catch {
    return null;
  }
}

/**
 * Ensure a minimize control exists on the panel. Reuses a
 * `[data-panel-minimize]` button from markup when present; otherwise
 * injects one before the close button (or into the header, or at the
 * top of the panel). Wires aria-expanded/aria-controls.
 */
export function ensureMinimizeControl(el, { documentRoot, label = '', onMinimize = null } = {}) {
  if (!el || !documentRoot || typeof documentRoot.createElement !== 'function') return null;
  try {
    let btn = null;
    try {
      btn = el.querySelector('[data-panel-minimize]');
    } catch { btn = null; }
    if (btn) {
      if (typeof onMinimize === 'function') btn.addEventListener('click', onMinimize);
      return btn;
    }
    btn = documentRoot.createElement('button');
    btn.type = 'button';
    btn.className = 'panel-minimize';
    btn.setAttribute('data-panel-minimize', '');
    btn.setAttribute('aria-expanded', 'true');
    if (el.id) btn.setAttribute('aria-controls', el.id);
    const text = label || panelLabel(el);
    btn.title = `Minimize ${text} to a chip`;
    btn.setAttribute('aria-label', `Minimize ${text}`);
    const glyph = documentRoot.createElement('span');
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = '–';
    btn.appendChild(glyph);
    if (typeof onMinimize === 'function') {
      btn.addEventListener('click', (e) => {
        try { e.stopPropagation(); } catch { /* ignore */ }
        onMinimize();
      });
    }
    let closeBtn = null;
    try {
      closeBtn = el.querySelector('[id$="-close"]');
    } catch { closeBtn = null; }
    if (closeBtn && closeBtn.parentNode === el) {
      el.insertBefore(btn, closeBtn);
    } else if (closeBtn && closeBtn.parentNode) {
      closeBtn.parentNode.insertBefore(btn, closeBtn);
    } else {
      const head = childElements(el).find((c) => {
        const t = c.tagName || '';
        return t === 'HEADER' || /-head$/.test(c.id || '') || (c.classList && c.classList.contains('world-drawer-head'));
      });
      if (head) head.appendChild(btn);
      else if (typeof el.prepend === 'function') el.prepend(btn);
      else el.insertBefore(btn, el.firstChild);
    }
    return btn;
  } catch {
    return null;
  }
}

function setPanelHidden(el, hidden) {
  try {
    if (elMatches(el, 'DETAILS')) {
      el.open = !hidden;
    } else {
      el.hidden = !!hidden;
    }
    if (typeof el.setAttribute === 'function') el.setAttribute('aria-hidden', String(!!hidden));
  } catch { /* ignore */ }
}

/**
 * Create the minimized chip for a panel. On narrow viewports chips stack
 * in the `#panel-chip-dock` edge dock; otherwise the chip sits near the
 * panel's last position.
 */
export function mountChip({ documentRoot, windowRoot = null, id, label, x = null, y = null, onRestore = null } = {}) {
  if (!documentRoot || typeof documentRoot.createElement !== 'function') return null;
  try {
    const chip = documentRoot.createElement('button');
    chip.type = 'button';
    chip.className = 'panel-chip';
    chip.setAttribute('data-panel-chip', sanitizePanelId(id));
    const tag = documentRoot.createElement('span');
    tag.className = 'panel-chip-label';
    tag.textContent = label;
    const glyph = documentRoot.createElement('span');
    glyph.className = 'panel-chip-restore';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = '▸';
    chip.appendChild(tag);
    chip.appendChild(glyph);
    chip.setAttribute('aria-label', `Restore ${label} panel`);
    chip.title = `Restore ${label}`;
    if (typeof onRestore === 'function') chip.addEventListener('click', onRestore);
    if (isReducedMotion(windowRoot)) chip.classList.add('panel-no-motion');
    const host = documentRoot.body || documentRoot.documentElement;
    if (!host) return null;
    if (isNarrowViewport(windowRoot)) {
      let dock = null;
      try {
        dock = documentRoot.getElementById('panel-chip-dock');
      } catch { dock = null; }
      if (!dock) {
        dock = documentRoot.createElement('div');
        dock.id = 'panel-chip-dock';
        dock.setAttribute('aria-label', 'Minimized panels');
        host.appendChild(dock);
      }
      dock.appendChild(chip);
    } else {
      const v = viewportSize(windowRoot);
      chip.style.position = 'fixed';
      chip.style.left = `${clampNum(x, 8, Math.max(8, v.w - 140))}px`;
      chip.style.top = `${clampNum(y, 8, Math.max(8, v.h - 60))}px`;
      chip.style.zIndex = '1200';
      host.appendChild(chip);
    }
    return chip;
  } catch {
    return null;
  }
}

const chipApis = new WeakMap();

/**
 * Give a panel the shared minimize-to-chip behavior.
 *
 * mode 'chip' (default): injects a minimize control; minimizing hides the
 * panel and shows a chip near its last position (edge dock on narrow
 * screens); the chip restores it. State persists under
 * `matumbo.panel.<id>`.
 *
 * mode 'delegate': for hosts that own the minimize visuals (desktop
 * surface-grips). Only the scroll body and persisted-state wiring are
 * applied; `applyMinimized(minimized)` is called with the remembered
 * state and whenever it must be re-applied.
 */
export function enhancePanel(el, opts = {}) {
  if (!el) return null;
  const {
    id = el.id || 'panel',
    label = '',
    documentRoot = null,
    windowRoot = null,
    mode = 'chip',
    storage = null,
    onMinimize = null,
    onRestore = null,
    applyMinimized = null,
  } = opts;
  const text = label || panelLabel(el);
  const store = storage || (windowRoot && windowRoot.localStorage) || null;

  if (mode !== 'chip') {
    // Delegate mode is intentionally not cached: the host re-passes fresh
    // callbacks (closures over its own records) on every mount.
    try {
      if (documentRoot && el.hasAttribute && el.hasAttribute(PANEL_SCROLL_ATTR)) {
        ensurePanelScrollBody(el, documentRoot);
      }
      const remembered = readPanelState(store, id);
      if (remembered.minimized && typeof applyMinimized === 'function') applyMinimized(true);
    } catch { /* never break the host */ }
    return {
      id, el, mode,
      persist: (patch) => writePanelState(store, id, patch || {}),
      read: () => readPanelState(store, id),
    };
  }

  if (chipApis.has(el)) return chipApis.get(el);

  let scrollApplied = false;
  try {
    if (documentRoot && el.hasAttribute && el.hasAttribute(PANEL_SCROLL_ATTR)) {
      ensurePanelScrollBody(el, documentRoot);
      scrollApplied = true;
    }
  } catch { /* ignore */ }

  let minimizeBtn = null;
  let chipEl = null;

  const panelRect = () => {
    try {
      const r = el.getBoundingClientRect();
      return r ? { left: r.left, top: r.top } : { left: 12, top: 64 };
    } catch {
      return { left: 12, top: 64 };
    }
  };

  const api = {
    id,
    el,
    mode,
    scrollApplied,
    get minimized() {
      return readPanelState(store, id).minimized === true;
    },
    minimize() {
      const r = panelRect();
      writePanelState(store, id, { minimized: true, x: Math.round(r.left), y: Math.round(r.top) });
      if (chipEl && chipEl.remove) {
        try { chipEl.remove(); } catch { /* ignore */ }
      }
      chipEl = mountChip({
        documentRoot, windowRoot, id, label: text, x: r.left, y: r.top,
        onRestore: () => api.restore(),
      });
      setPanelHidden(el, true);
      if (minimizeBtn && minimizeBtn.setAttribute) minimizeBtn.setAttribute('aria-expanded', 'false');
      if (typeof onMinimize === 'function') {
        try { onMinimize(); } catch { /* ignore */ }
      }
    },
    restore() {
      writePanelState(store, id, { minimized: false });
      if (chipEl && chipEl.remove) {
        try { chipEl.remove(); } catch { /* ignore */ }
      }
      chipEl = null;
      setPanelHidden(el, false);
      if (minimizeBtn && minimizeBtn.setAttribute) minimizeBtn.setAttribute('aria-expanded', 'true');
      if (typeof onRestore === 'function') {
        try { onRestore(); } catch { /* ignore */ }
      }
    },
    toggle() {
      if (api.minimized) api.restore();
      else api.minimize();
    },
    destroy() {
      if (chipEl && chipEl.remove) {
        try { chipEl.remove(); } catch { /* ignore */ }
      }
      chipEl = null;
      chipApis.delete(el);
      try { el.removeAttribute('data-panel-enhanced'); } catch { /* ignore */ }
    },
  };

  try {
    minimizeBtn = ensureMinimizeControl(el, { documentRoot, label: text, onMinimize: () => api.minimize() });
  } catch { minimizeBtn = null; }

  try {
    el.setAttribute('data-panel-enhanced', 'chip');
  } catch { /* ignore */ }
  chipApis.set(el, api);

  // Honor the remembered state from a previous session.
  try {
    if (readPanelState(store, id).minimized) api.minimize();
    else if (minimizeBtn && minimizeBtn.setAttribute) minimizeBtn.setAttribute('aria-expanded', 'true');
  } catch { /* ignore */ }

  return api;
}

/* ------------------------------------------------------------------ */
/* The world drawer — one scrollable left drawer with sections         */
/* ------------------------------------------------------------------ */

function featureButton(documentRoot, feature, onOpenFeature) {
  const b = documentRoot.createElement('button');
  b.type = 'button';
  b.className = 'world-drawer-feature';
  b.dataset.featureId = feature.id;
  const title = documentRoot.createElement('span');
  title.className = 'world-drawer-feature-title';
  title.textContent = feature.label || feature.id;
  const meta = documentRoot.createElement('span');
  meta.className = 'world-drawer-feature-meta';
  meta.textContent = feature.kicker || '';
  b.appendChild(title);
  b.appendChild(meta);
  b.setAttribute('aria-label', `Open ${feature.label || feature.id}`);
  b.addEventListener('click', () => {
    try {
      if (typeof onOpenFeature === 'function') onOpenFeature(feature.id);
    } catch { /* ignore */ }
  });
  return b;
}

/**
 * Mount the single scrollable world drawer ("Find a connected feature").
 * Sections come from a DrawerSectionRegistry. `onOpenFeature(featureId)`
 * should open the feature through its canonical path; `onOpenPanel(id)`
 * should expand/restore a utility panel. Mounts once per document.
 */
export function mountWorldDrawer({
  documentRoot = null,
  windowRoot = null,
  registry = null,
  onOpenFeature = null,
  onOpenPanel = null,
} = {}) {
  if (!documentRoot || typeof documentRoot.createElement !== 'function') return null;
  try {
    const existing = documentRoot.getElementById ? documentRoot.getElementById('world-drawer') : null;
    if (existing) return existing;
    const reg = registry || defaultDrawerSections();

    const drawer = documentRoot.createElement('section');
    drawer.id = 'world-drawer';
    drawer.className = 'world-drawer';
    drawer.setAttribute('aria-label', 'Find a connected feature · world directory');

    const head = documentRoot.createElement('div');
    head.className = 'world-drawer-head';
    const headText = documentRoot.createElement('div');
    const eyebrow = documentRoot.createElement('div');
    eyebrow.className = 'world-drawer-eyebrow';
    eyebrow.textContent = 'World directory · local';
    const h2 = documentRoot.createElement('h2');
    h2.textContent = 'Find a connected feature';
    headText.appendChild(eyebrow);
    headText.appendChild(h2);
    head.appendChild(headText);
    drawer.appendChild(head);

    const searchWrap = documentRoot.createElement('div');
    searchWrap.className = 'world-drawer-search';
    const search = documentRoot.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search features…';
    search.setAttribute('aria-label', 'Search features');
    searchWrap.appendChild(search);
    drawer.appendChild(searchWrap);

    const body = documentRoot.createElement('div');
    body.className = 'panel-scroll-body world-drawer-body';
    body.setAttribute(PANEL_SCROLL_ATTR, '');
    drawer.appendChild(body);

    const featureButtons = [];
    for (const section of reg.list()) {
      const sec = documentRoot.createElement('section');
      sec.className = 'world-drawer-section';
      sec.dataset.section = section.id;
      const h3 = documentRoot.createElement('h3');
      h3.textContent = section.title;
      sec.appendChild(h3);
      if (section.blurb) {
        const p = documentRoot.createElement('p');
        p.className = 'world-drawer-blurb';
        p.textContent = section.blurb;
        sec.appendChild(p);
      }
      if (section.id === 'features') {
        const list = documentRoot.createElement('div');
        list.className = 'world-drawer-features';
        for (const feature of FEATURE_DEFINITIONS) {
          const b = featureButton(documentRoot, feature, onOpenFeature);
          featureButtons.push(b);
          list.appendChild(b);
        }
        sec.appendChild(list);
      } else if (section.id === 'city') {
        const b = documentRoot.createElement('button');
        b.type = 'button';
        b.className = 'world-drawer-action';
        b.textContent = 'Open Local City journey';
        b.addEventListener('click', () => {
          try {
            if (typeof onOpenPanel === 'function') onOpenPanel('city-journey');
          } catch { /* ignore */ }
        });
        sec.appendChild(b);
      } else if (section.id === 'device') {
        const items = [
          ['camera-input-panel', 'Camera motion'],
          ['media-preview', 'Camera + audio · device preview'],
          ['gesture-input-panel', 'Gesture input'],
        ];
        for (const [pid, t] of items) {
          const b = documentRoot.createElement('button');
          b.type = 'button';
          b.className = 'world-drawer-action';
          b.textContent = t;
          b.addEventListener('click', () => {
            try {
              if (typeof onOpenPanel === 'function') onOpenPanel(pid);
            } catch { /* ignore */ }
          });
          sec.appendChild(b);
        }
      }
      body.appendChild(sec);
    }

    search.addEventListener('input', () => {
      const q = (search.value || '').toLowerCase().trim();
      for (const b of featureButtons) {
        const hit = !q || (b.textContent || '').toLowerCase().includes(q);
        b.style.display = hit ? '' : 'none';
      }
    });

    const host = documentRoot.body || documentRoot.documentElement;
    if (!host) return null;
    host.appendChild(drawer);

    // The drawer itself minimizes to a chip like every other panel.
    try {
      enhancePanel(drawer, { id: 'world-drawer', label: 'World directory', documentRoot, windowRoot, mode: 'chip' });
    } catch { /* drawer still works without the chip */ }

    if (isReducedMotion(windowRoot)) {
      try { drawer.classList.add('panel-no-motion'); } catch { /* ignore */ }
    }
    return drawer;
  } catch {
    return null;
  }
}

/**
 * Inject the panel-system stylesheet once per document, following the
 * repo convention (`new URL('./panel-system.css', import.meta.url)`).
 */
export function ensurePanelSystemStylesheet(documentRoot = null) {
  try {
    if (!documentRoot || typeof documentRoot.createElement !== 'function') return false;
    const head = documentRoot.head;
    if (!head) return false;
    const links = head.querySelectorAll ? head.querySelectorAll('link[data-panel-system-css]') : [];
    if (links && links.length) return true;
    const link = documentRoot.createElement('link');
    link.rel = 'stylesheet';
    link.setAttribute('data-panel-system-css', 'true');
    try {
      link.href = new URL('./panel-system.css?v=20260919-glass-world', import.meta.url).href;
    } catch {
      link.href = './src/render/panel-system.css?v=20260919-chibi-champions';
    }
    head.appendChild(link);
    return true;
  } catch {
    return false;
  }
}
