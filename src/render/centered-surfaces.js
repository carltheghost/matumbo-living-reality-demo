/** Panel space manager — every floating 2D panel lives in its own simulated
 * space: fully draggable in 3D (plane + depth), small by default, and
 * materialized only through interaction (the translation-on-interact law:
 * closed until touched, only appears when needed).
 *
 * - Drag the grip to move a panel anywhere in the field (up / down /
 *   left / right). Shift-drag, mouse-wheel over the grip, or a two-pointer
 *   touch drag moves it in depth (back / forward); closer panels grow,
 *   farther panels shrink and dim.
 * - Panels open as small chips. Click / tap the grip to expand
 *   (materialize); click again to minimize. Each panel keeps its own
 *   independent transform, restored across sessions from local storage.
 * - Desktop only (viewport wider than 700px). On narrow viewports this
 *   module stays inert so the mobile panel manager keeps its
 *   one-panel-at-a-time behavior untouched.
 * - The 3D world (reality assembly LOD / spring-open) is not touched.
 *
 * Projection only: this moves 2D overlay elements. It changes no ledger,
 * identity, signing, settlement, wallet, custody, or authority state.
 */

import {
  PANEL_SCROLL_ATTR,
  dockSlot,
  enhancePanel,
  ensurePanelSystemStylesheet,
  hasPanelState,
  mountWorldDrawer,
  readPanelState,
  writePanelState,
} from './panel-system.js?v=20260919-glass-world';

/* ------------------------------------------------------------------ */
/* Pure geometry helpers (unit-tested).                                */
/* ------------------------------------------------------------------ */

/** Presentation only: opening a feature does not replace the canonical world. */
export function clampSurface(x, y, width, height, viewportWidth, viewportHeight) {
  return { x: Math.max(8, Math.min(x, Math.max(8, viewportWidth - width - 8))), y: Math.max(8, Math.min(y, Math.max(8, viewportHeight - height - 42))) };
}

export const PANEL_DEPTH_MIN = -800;
export const PANEL_DEPTH_MAX = 500;
const PANEL_PERSPECTIVE = 1400;

/** Depth axis in px: positive = toward the viewer (closer), negative = away. */
export function clampDepth(z) {
  const n = Number(z);
  if (!Number.isFinite(n)) return 0;
  return Math.max(PANEL_DEPTH_MIN, Math.min(PANEL_DEPTH_MAX, n));
}

/** Perspective scale for a depth value: closer grows, farther shrinks. */
export function depthScale(z) {
  const c = clampDepth(z);
  return PANEL_PERSPECTIVE / (PANEL_PERSPECTIVE - c);
}

/** Subtle depth cue: farther panels dim slightly. */
export function depthBrightness(z) {
  const c = clampDepth(z);
  return Math.max(0.75, Math.min(1.12, 1 + c / 4500));
}

/** CSS transform for an independent panel transform {x, y, z}. */
export function composePanelTransform(x, y, z) {
  return `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0px) scale(${depthScale(z).toFixed(4)})`;
}

/* ------------------------------------------------------------------ */
/* Panel discovery (stub-testable).                                    */
/* ------------------------------------------------------------------ */

const EXTRA_PANEL_IDS = ['gesture-input-panel', 'media-preview', 'city-journey', 'hint'];

/**
 * Utility panels that dock as a tidy chip column instead of scattering
 * overlapping boxes across the field (Packet 233a consolidation). They
 * stay fully draggable and their positions persist like every panel.
 */
const DOCK_IDS = ['city-journey', 'camera-input-panel', 'media-preview', 'gesture-input-panel'];

/* Panels whose bodies already scroll internally; the shared scroll-body
   wrapper would only add a nested scroll layer. */
const NO_SCROLL_WRAP_IDS = ['feature-shell', 'hint'];

/** Every floating panel/tab: all asides plus the non-aside overlays. */
export function collectPanelDescriptors(documentRoot) {
  const out = [];
  const seen = new Set();
  const seenIds = new Set();
  const push = (el) => {
    if (!el || seen.has(el)) return;
    const id = el.id || '(panel)';
    if (seenIds.has(id)) return; // duplicate mount guard: keep the first panel per id
    seen.add(el);
    seenIds.add(id);
    out.push({ id, el });
  };
  if (documentRoot && typeof documentRoot.querySelectorAll === 'function') {
    const asides = documentRoot.querySelectorAll('aside');
    for (const el of asides) push(el);
  }
  if (documentRoot && typeof documentRoot.getElementById === 'function') {
    for (const id of EXTRA_PANEL_IDS) push(documentRoot.getElementById(id));
  }
  return out;
}

/** Human label for a panel's drag grip. */
export function panelTitle(el) {
  if (!el) return 'Panel';
  try {
    const labelled = el.getAttribute && el.getAttribute('aria-label');
    if (labelled && labelled.trim()) return labelled.trim().slice(0, 64);
    const head = el.querySelector && el.querySelector('h2, h3');
    const text = head && head.textContent && head.textContent.trim();
    if (text) return text.slice(0, 64);
  } catch { /* ignore and fall through */ }
  const id = (el.id || '').replace(/[-_]+/g, ' ').trim();
  return id ? id.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Panel';
}

/**
 * Visibility across the panel open mechanisms: `hidden`, the feature-shell
 * `.open` class, `<details>` `open`, and class-driven display (asset-launch).
 */
export function isPanelVisible(el, view) {
  if (!el) return false;
  if (el.hidden === true) return false;
  if (el.id === 'feature-shell') return !!(el.classList && el.classList.contains('open'));
  if (el.tagName === 'DETAILS') return el.open !== false;
  if (view && typeof view.getComputedStyle === 'function') {
    try {
      const cs = view.getComputedStyle(el);
      if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
    } catch { /* ignore */ }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Per-panel persisted space (best-effort local storage).              */
/* ------------------------------------------------------------------ */

const STORE_KEY = 'matumbo.panelSpace.v1';

/**
 * Open a feature from the world drawer through the canonical Mission
 * Control path: click the real feature-nav button when it exists, so the
 * drawer never grows a second feature-opening implementation. Falls back
 * to opening the shell first when the button is not mounted yet.
 */
export function openFeatureFromDrawer(documentRoot, featureId) {
  if (!documentRoot || !featureId) return false;
  try {
    const getBtn = () => (documentRoot.getElementById
      ? documentRoot.getElementById(`feature-button-${featureId}`)
      : null);
    let btn = getBtn();
    if (!btn) {
      const shell = documentRoot.getElementById ? documentRoot.getElementById('feature-shell') : null;
      const toggle = documentRoot.getElementById ? documentRoot.getElementById('feature-toggle') : null;
      if (shell && toggle && !shell.classList.contains('open')) toggle.click();
      btn = getBtn();
    }
    if (btn) {
      btn.click();
      return true;
    }
  } catch { /* never break the field */ }
  return false;
}

function readStore(view) {
  try {
    const raw = view && view.localStorage ? view.localStorage.getItem(STORE_KEY) : null;
    if (!raw) return {};
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : {};
  } catch { return {}; }
}

function writeStore(view, data) {
  try {
    if (view && view.localStorage) view.localStorage.setItem(STORE_KEY, JSON.stringify(data));
  } catch { /* private mode etc: positions simply do not persist */ }
}

/* ------------------------------------------------------------------ */
/* Manager                                                             */
/* ------------------------------------------------------------------ */

const NARROW_QUERY = '(max-width:700px)';

const PANEL_SPACE_CSS = `
.surface-grip{display:flex;align-items:center;gap:8px;flex-shrink:0;padding:6px 8px;border-bottom:1px solid rgba(120,160,190,.25);touch-action:none;color:#d9eeff;font:12px system-ui;background:rgba(10,25,38,.35);border-radius:10px 10px 0 0;user-select:none;-webkit-user-select:none}
.surface-grip-toggle{flex:1;min-width:0;display:flex;align-items:center;gap:8px;overflow:hidden;color:inherit;background:transparent;border:0;padding:6px 4px;cursor:grab;font:inherit;text-align:left}
.surface-grip-toggle:active{cursor:grabbing}
.surface-grip-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.surface-grip-depth{flex:none;opacity:.55;font-size:10px;white-space:nowrap}
.surface-grip-action{flex:none;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#8fd8f2;border:1px solid rgba(120,180,220,.35);border-radius:6px;padding:3px 8px;white-space:nowrap}
.surface-grip-center{flex:none;color:inherit;background:#15283b;border:1px solid #68859e;border-radius:6px;padding:5px 9px;cursor:pointer;font-size:11px}
[data-panel-space]{transform-origin:0 0;transition-property:opacity !important}
[data-panel-space][data-compact="true"]{width:auto !important;max-width:min(340px,calc(100vw - 16px)) !important}
[data-panel-space][data-compact="true"] > :not(.surface-grip){display:none !important}
/* An expanded (materialized) console must never swallow the world: it stays
   bounded so the 3D field remains visible and interactive around it. */
[data-panel-space]:not([data-compact="true"]){max-width:min(80vw,calc(100vw - 16px)) !important;max-height:80vh !important}
@keyframes panelSpaceIn{from{opacity:0}to{opacity:1}}
.panel-space-appearing{animation:panelSpaceIn .18s ease-out}
@media (prefers-reduced-motion: reduce){.panel-space-appearing{animation:none !important}}
#hint[data-panel-space]{cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}
`;

export function mountCenteredSurfaces(documentRoot = document, view = window) {
  const noop = () => {};
  if (!documentRoot || !view) return noop;
  const mq = typeof view.matchMedia === 'function' ? view.matchMedia(NARROW_QUERY) : null;
  const isNarrow = () => (mq ? mq.matches : (typeof view.innerWidth === 'number' ? view.innerWidth : 1024) <= 700);
  const raf = typeof view.requestAnimationFrame === 'function'
    ? view.requestAnimationFrame.bind(view)
    : (fn) => setTimeout(fn, 16);

  let active = false;
  let teardownActive = null;

  const viewport = () => ({
    w: typeof view.innerWidth === 'number' ? view.innerWidth : 1024,
    h: typeof view.innerHeight === 'number' ? view.innerHeight : 768,
  });

  function applyTransform(rec) {
    const { x, y, z } = rec.state;
    rec.el.style.transform = composePanelTransform(x, y, z);
    rec.el.style.filter = z === 0 ? '' : `brightness(${depthBrightness(z).toFixed(3)})`;
  }

  function persistSoon(ctx) {
    if (ctx.saveTimer) return;
    ctx.saveTimer = setTimeout(() => {
      ctx.saveTimer = 0;
      const data = {};
      for (const rec of ctx.recs) {
        if (rec.placed) {
          const snap = { x: Math.round(rec.state.x), y: Math.round(rec.state.y), z: Math.round(rec.state.z) };
          data[rec.id] = snap;
          // Packet 233a: the per-panel namespaced key is the source of
          // truth for minimized state + position (legacy store kept for
          // sessions saved before this packet).
          writePanelState(view.localStorage, rec.id, {
            ...snap,
            minimized: rec.el.getAttribute('data-compact') === 'true',
          });
        }
      }
      writeStore(view, data);
    }, 250);
  }

  function setCompact(rec, on, ctx) {
    if (!rec.compactible) return;
    if (on) {
      // Compact applies even before placement: a console that materializes
      // must be small from its very first visible frame.
      rec.el.setAttribute('data-compact', 'true');
    } else {
      if (!rec.placed) return; // cannot measure an unplaced panel; stay a chip
      rec.el.removeAttribute('data-compact');
    }
    if (rec.actionEl) rec.actionEl.textContent = on ? 'Open' : 'Minimize';
    if (rec.toggleBtn) rec.toggleBtn.setAttribute('aria-expanded', String(!on));
    // Packet 233a: minimized state persists per panel under matumbo.panel.<id>.
    try {
      writePanelState(view.localStorage, rec.id, { minimized: !!on });
    } catch { /* private mode etc: state simply does not persist */ }
    if (!on && rec.placed) {
      // The grown panel must stay in reach.
      const r = rec.el.getBoundingClientRect();
      const v = viewport();
      const p = clampSurface(rec.state.x, rec.state.y, r.width, r.height, v.w, v.h);
      rec.state.x = p.x; rec.state.y = p.y;
      applyTransform(rec);
    }
    if (ctx) persistSoon(ctx);
  }

  function toggleCompact(rec, ctx) {
    setCompact(rec, rec.el.getAttribute('data-compact') !== 'true', ctx);
  }

  function recenter(rec, ctx) {
    if (!rec.placed || !rec.home) return;
    const r = rec.el.getBoundingClientRect();
    const v = viewport();
    const p = clampSurface(rec.home.x, rec.home.y, r.width, r.height, v.w, v.h);
    rec.state.x = p.x; rec.state.y = p.y; rec.state.z = 0;
    applyTransform(rec);
    persistSoon(ctx);
  }

  function placePanel(rec, ctx) {
    const el = rec.el;
    if (rec.placed || !isPanelVisible(el, view)) return false;
    const r = el.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) return false; // not laid out yet; caller retries
    const saved = ctx.store[rec.id] || {};
    // Packet 233a: per-panel namespaced state wins; the legacy panelSpace
    // store is only a fallback for sessions saved before this packet.
    // Fresh panels (no stored state) stay compact: small by default.
    const remembered = hasPanelState(view.localStorage, rec.id)
      ? readPanelState(view.localStorage, rec.id)
      : null;
    const v = viewport();
    const numOr = (a, b) => (Number.isFinite(a) ? a : Number(b));
    const sx = remembered && remembered.x != null ? remembered.x : numOr(Number(saved.x), NaN);
    const sy = remembered && remembered.y != null ? remembered.y : numOr(Number(saved.y), NaN);
    rec.home = { x: r.left, y: r.top };
    const st = el.style;
    st.position = 'fixed'; st.left = '0px'; st.top = '0px';
    st.right = 'auto'; st.bottom = 'auto'; st.margin = '0px';
    rec.placed = true;
    // Docked utility panels stack in one tidy column (bottom-left) instead
    // of scattering overlapping boxes; anywhere the user dragged them wins.
    let defX = r.left;
    let defY = r.top;
    if (rec.docked) {
      const slot = dockSlot(rec.dockIndex, { viewport: v });
      defX = slot.x;
      defY = slot.y;
    }
    const p = clampSurface(Number.isFinite(sx) ? sx : defX, Number.isFinite(sy) ? sy : defY, r.width, r.height, v.w, v.h);
    rec.state = { x: p.x, y: p.y, z: clampDepth(saved.z || 0) };
    applyTransform(rec);
    // Packet 233a: honor the remembered minimized state; fresh panels stay
    // compact (small by default) and interaction materializes. The
    // closed->open transition in reconcilePanel still appears small.
    if (rec.compactible) setCompact(rec, !remembered || remembered.minimized, null);
    el.classList.add('panel-space-appearing');
    setTimeout(() => el.classList.remove('panel-space-appearing'), 260);
    persistSoon(ctx);
    return true;
  }

  function requestPlace(rec, ctx, attempt = 0) {
    if (rec.placed || rec.placeQueued) return;
    rec.placeQueued = true;
    raf(() => {
      rec.placeQueued = false;
      if (rec.placed || !isPanelVisible(rec.el, view)) return;
      if (placePanel(rec, ctx)) return; // placed and chipped
      // Layout was not ready (zero rect): retry with backoff instead of
      // giving up forever. Any later visibility signal also re-arms this.
      if (attempt < 10) {
        setTimeout(() => requestPlace(rec, ctx, attempt + 1), 150);
      }
    });
  }

  function reconcilePanel(rec, ctx) {
    const visible = isPanelVisible(rec.el, view);
    const was = rec.wasVisible === true;
    rec.wasVisible = visible;
    if (!visible) return;
    if (!rec.placed) {
      // Visible but not yet in panel space: chip it immediately so it is
      // small from the first frame, then place it (with retries).
      if (rec.compactible) setCompact(rec, true, ctx);
      requestPlace(rec, ctx);
      return;
    }
    // Closed -> open transition: appear small; interaction materializes.
    if (!was && rec.compactible) setCompact(rec, true, ctx);
  }

  function attachPlaneDepthDrag(rec, ctx, handle, { tapToggles }) {
    const pointers = new Map();
    let drag = null;
    let suppressClick = false;
    handle.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try { handle.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const avgY = [...pointers.values()].reduce((a, p) => a + p.y, 0) / pointers.size;
      drag = {
        depth: !!e.shiftKey || pointers.size > 1,
        startX: e.clientX, startY: e.clientY, startAvgY: avgY,
        ox: rec.state.x, oy: rec.state.y, oz: rec.state.z, moved: false,
      };
      handle.style.cursor = drag.depth ? 'ns-resize' : 'grabbing';
      e.preventDefault();
    });
    handle.addEventListener('pointermove', (e) => {
      if (!drag || !pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
      if (drag.depth || pointers.size > 1) {
        // Depth: drag up to pull closer, down to push away. Full 3D freedom.
        const avgY = [...pointers.values()].reduce((a, p) => a + p.y, 0) / pointers.size;
        rec.state.z = clampDepth(drag.oz + (drag.startAvgY - avgY) * 2);
      } else {
        const r = rec.el.getBoundingClientRect();
        const v = viewport();
        const p = clampSurface(drag.ox + dx, drag.oy + dy, r.width, r.height, v.w, v.h);
        rec.state.x = p.x; rec.state.y = p.y;
      }
      applyTransform(rec);
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (!drag) return;
      const wasTap = !drag.moved;
      drag = null;
      handle.style.cursor = '';
      if (wasTap && tapToggles && !e.shiftKey) {
        suppressClick = true;
        toggleCompact(rec, ctx);
      } else {
        persistSoon(ctx);
      }
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
    if (tapToggles) {
      handle.addEventListener('click', () => {
        if (suppressClick) { suppressClick = false; return; }
        toggleCompact(rec, ctx); // keyboard activation
      });
      handle.addEventListener('dblclick', (e) => e.preventDefault());
      handle.addEventListener('wheel', (e) => {
        // Wheel over the grip travels in depth; panel content keeps scrolling.
        e.preventDefault();
        rec.state.z = clampDepth(rec.state.z - e.deltaY * 1.2);
        applyTransform(rec);
        persistSoon(ctx);
      }, { passive: false });
    }
  }

  function setupPanel(desc, ctx) {
    const el = desc.el;
    // Duplicate mount guard: one panel per id, the first wins.
    if (ctx.byId.has(desc.id)) return ctx.byId.get(desc.id);
    const isHint = el.id === 'hint';
    const docked = !isHint && DOCK_IDS.includes(el.id);
    const rec = {
      id: desc.id, el,
      state: { x: 0, y: 0, z: 0 },
      home: null, placed: false, placeQueued: false,
      wasVisible: isPanelVisible(el, view),
      originalCssText: el.style ? el.style.cssText : '',
      grip: null, toggleBtn: null, actionEl: null,
      compactible: !isHint,
      docked,
      dockIndex: docked ? ctx.dockOrder.length : -1,
    };
    if (docked) ctx.dockOrder.push(rec);
    if (!isHint) {
      const title = panelTitle(el);
      const grip = documentRoot.createElement('div');
      grip.className = 'surface-grip';
      const toggle = documentRoot.createElement('button');
      toggle.type = 'button';
      toggle.className = 'surface-grip-toggle';
      toggle.title = `${title} — drag to move anywhere, shift-drag or wheel for depth, click to open or minimize`;
      const label = documentRoot.createElement('span');
      label.className = 'surface-grip-label';
      label.textContent = `${title} · drag to move`;
      const depthHint = documentRoot.createElement('span');
      depthHint.className = 'surface-grip-depth';
      depthHint.textContent = 'depth: shift-drag / wheel';
      const action = documentRoot.createElement('span');
      action.className = 'surface-grip-action';
      action.textContent = 'Open';
      toggle.append(label, depthHint, action);
      const center = documentRoot.createElement('button');
      center.type = 'button';
      center.className = 'surface-grip-center';
      center.textContent = 'Center';
      center.title = 'Return to the designed position';
      grip.append(toggle, center);
      const summary = el.tagName === 'DETAILS' ? el.querySelector('summary') : null;
      if (summary && summary.parentNode === el) summary.after(grip);
      else if (typeof el.prepend === 'function') el.prepend(grip);
      else el.insertBefore(grip, el.firstChild);
      center.addEventListener('click', () => recenter(rec, ctx));
      attachPlaneDepthDrag(rec, ctx, toggle, { tapToggles: true });
      rec.grip = grip; rec.toggleBtn = toggle; rec.actionEl = action;
    } else {
      attachPlaneDepthDrag(rec, ctx, el, { tapToggles: false });
    }
    el.setAttribute('data-panel-space', 'managed');
    ctx.recs.push(rec);
    ctx.byEl.set(el, rec);
    ctx.byId.set(rec.id, rec);
    // Packet 233a: every panel body scrolls (opt-in attribute, applied on
    // mount) and minimized state persists per panel. The surface-grip is
    // the desktop minimize control, so the panel system runs in delegate
    // mode here: no second button, no second chip.
    try {
      if (!NO_SCROLL_WRAP_IDS.includes(rec.id) && el.hasAttribute && !el.hasAttribute(PANEL_SCROLL_ATTR)) {
        el.setAttribute(PANEL_SCROLL_ATTR, '');
      }
      enhancePanel(el, {
        id: rec.id,
        documentRoot,
        windowRoot: view,
        mode: 'delegate',
        applyMinimized: (minimized) => {
          if (rec.compactible) setCompact(rec, minimized, ctx);
        },
      });
    } catch { /* one bad panel never breaks the field */ }
    if (rec.wasVisible) requestPlace(rec, ctx);
    return rec;
  }

  function activate() {
    const styleEl = documentRoot.createElement('style');
    styleEl.setAttribute('data-panel-space-style', 'true');
    styleEl.textContent = PANEL_SPACE_CSS;
    (documentRoot.head || documentRoot).appendChild(styleEl);
    // Packet 233a shared panel styles (scrollbars, chips, drawer).
    try {
      ensurePanelSystemStylesheet(documentRoot);
    } catch { /* layout still works without the shared sheet */ }

    const ctx = {
      recs: [], byEl: new Map(), byId: new Map(), dockOrder: [],
      store: readStore(view), saveTimer: 0, styleEl,
    };
    for (const desc of collectPanelDescriptors(documentRoot)) {
      try { setupPanel(desc, ctx); } catch { /* one bad panel never breaks the field */ }
    }

    // Packet 233a: the single scrollable world drawer (left side
    // consolidation). Drawer entries expand panels through the same
    // code paths as the panels' own controls.
    let drawerEl = null;
    try {
      drawerEl = mountWorldDrawer({
        documentRoot,
        windowRoot: view,
        onOpenPanel: (id) => {
          const rec = ctx.byId.get(id);
          if (!rec) return false;
          if (rec.compactible) setCompact(rec, false, ctx);
          if (!rec.placed) requestPlace(rec, ctx);
          return true;
        },
        onOpenFeature: (featureId) => openFeatureFromDrawer(documentRoot, featureId),
      });
    } catch { drawerEl = null; }

    const onMutations = (mutations) => {
      let reconcileAll = false;
      for (const m of mutations || []) {
        const t = m.target;
        if (!t) continue;
        if (t === documentRoot.body || t === documentRoot.documentElement) { reconcileAll = true; continue; }
        const rec = ctx.byEl.get(t);
        if (rec) { reconcilePanel(rec, ctx); continue; }
        // feature-shell's .open class drives asset-launch visibility via a
        // sibling selector, so its class change reconciles the whole field.
        if (t.id === 'feature-shell') reconcileAll = true;
      }
      if (reconcileAll) for (const rec of ctx.recs) reconcilePanel(rec, ctx);
    };

    const MO = view.MutationObserver || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
    let observer = null;
    if (MO && documentRoot.documentElement) {
      observer = new MO(onMutations);
      observer.observe(documentRoot.documentElement, {
        subtree: true, attributes: true, attributeFilter: ['hidden', 'open', 'class', 'style'],
      });
    }

    const onResize = () => {
      const v = viewport();
      for (const rec of ctx.recs) {
        if (!rec.placed || !isPanelVisible(rec.el, view)) continue;
        const r = rec.el.getBoundingClientRect();
        const p = clampSurface(rec.state.x, rec.state.y, r.width, r.height, v.w, v.h);
        rec.state.x = p.x; rec.state.y = p.y;
        applyTransform(rec);
      }
    };
    if (typeof view.addEventListener === 'function') view.addEventListener('resize', onResize);

    return function teardown() {
      if (observer) observer.disconnect();
      if (typeof view.removeEventListener === 'function') view.removeEventListener('resize', onResize);
      if (ctx.saveTimer) { clearTimeout(ctx.saveTimer); ctx.saveTimer = 0; }
      // Remove the world drawer (re-mounted on the next activation).
      try {
        const drawer = documentRoot.getElementById ? documentRoot.getElementById('world-drawer') : null;
        if (drawer && drawer.remove) drawer.remove();
      } catch { /* ignore */ }
      for (const rec of ctx.recs) {
        try {
          if (rec.grip && rec.grip.remove) rec.grip.remove();
          rec.el.removeAttribute('data-panel-space');
          rec.el.removeAttribute('data-compact');
          rec.el.classList.remove('panel-space-appearing');
          if (rec.el.style) rec.el.style.cssText = rec.originalCssText;
        } catch { /* ignore */ }
      }
      if (styleEl.remove) styleEl.remove();
    };
  }

  const syncMode = () => {
    const narrow = isNarrow();
    if (narrow && active) {
      if (teardownActive) teardownActive();
      teardownActive = null; active = false;
    } else if (!narrow && !active) {
      teardownActive = activate();
      active = true;
    }
  };

  if (typeof view.addEventListener === 'function') view.addEventListener('resize', syncMode);
  if (mq && typeof mq.addEventListener === 'function') mq.addEventListener('change', syncMode);
  syncMode();

  return function destroy() {
    if (typeof view.removeEventListener === 'function') view.removeEventListener('resize', syncMode);
    if (mq && typeof mq.removeEventListener === 'function') mq.removeEventListener('change', syncMode);
    if (teardownActive) teardownActive();
    teardownActive = null; active = false;
  };
}
