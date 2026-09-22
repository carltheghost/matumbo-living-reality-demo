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

/* ------------------------------------------------------------------ */
/* Pure geometry helpers (unit-tested).                                */
/* ------------------------------------------------------------------ */

/** Presentation only: opening a feature does not replace the canonical world. */
export function clampSurface(x, y, width, height, viewportWidth, viewportHeight) {
  return { x: Math.max(8, Math.min(x, Math.max(8, viewportWidth - width - 8))), y: Math.max(8, Math.min(y, Math.max(8, viewportHeight - height - 42))) };
}

export const PANEL_DEPTH_MIN = -800;
export const PANEL_DEPTH_MAX = 500;
export const PANEL_WIDTH_MIN = 180;
export const PANEL_WIDTH_MAX = 1200;
export const PANEL_HEIGHT_MIN = 100;
export const PANEL_HEIGHT_MAX = 900;
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

export function clampSurfaceSize(width, height, viewportWidth, viewportHeight) {
  const vw = Math.max(240, Number(viewportWidth) || 0);
  const vh = Math.max(180, Number(viewportHeight) || 0);
  const maxW = Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, vw - 36));
  const maxH = Math.max(PANEL_HEIGHT_MIN, Math.min(PANEL_HEIGHT_MAX, vh - 78));
  return {
    width: Math.max(PANEL_WIDTH_MIN, Math.min(maxW, Number(width) || PANEL_WIDTH_MIN)),
    height: Math.max(PANEL_HEIGHT_MIN, Math.min(maxH, Number(height) || PANEL_HEIGHT_MIN)),
  };
}

export function normalizePanelArrangement(value) {
  const key = String(value || '').toLowerCase();
  return new Set(['free','left','right','top','bottom','front','back']).has(key) ? key : 'free';
}

/** CSS transform for an independent panel transform {x, y, z}. */
export function composePanelTransform(x, y, z) {
  return `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0px) scale(${depthScale(z).toFixed(4)})`;
}

/* ------------------------------------------------------------------ */
/* Panel discovery (stub-testable).                                    */
/* ------------------------------------------------------------------ */

const EXTRA_PANEL_IDS = ['gesture-input-panel', 'media-preview', 'city-journey', 'hint'];

/** Every floating panel/tab: all asides plus the non-aside overlays. */
export function collectPanelDescriptors(documentRoot) {
  const out = [];
  const seen = new Set();
  const push = (el, type = 'panel') => {
    if (!el || seen.has(el)) return;
    if (el.getAttribute?.('data-panel-space-ignore') === 'true') return;
    if (el.id === 'portal-return-console' || el.id === 'cube-dive-hud') return;
    if (el.classList?.contains?.('assembly-directory')) return;
    seen.add(el);
    out.push({ id: el.id || el.getAttribute?.('data-panel-space-title') || '(panel)', el, type });
  };
  if (!documentRoot) return out;
  if (typeof documentRoot.querySelectorAll === 'function') {
    for (const el of documentRoot.querySelectorAll('aside')) push(el, 'aside');
    for (const el of documentRoot.querySelectorAll('[data-floating-panel="true"]')) push(el, 'floating');
  }
  if (typeof documentRoot.getElementById === 'function') {
    for (const id of EXTRA_PANEL_IDS) { const el = documentRoot.getElementById(id); if (el) push(el, 'extra'); }
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

const PANEL_SPACE_CSS = "[data-panel-space]{transform-origin:0 0!important;transition-property:opacity,filter!important;will-change:transform,opacity;box-sizing:border-box!important}\n[data-panel-space].panel-space-front{box-shadow:0 22px 80px rgba(0,0,0,.62),0 0 0 1px rgba(116,218,255,.12),0 0 36px rgba(95,191,255,.08)!important}\n.surface-grip{display:grid;grid-template-columns:50px minmax(0,1fr) auto auto;align-items:center;gap:8px;min-height:78px;width:100%;padding:8px;touch-action:none;color:#dff7ff;background:linear-gradient(145deg,rgba(25,59,82,.97),rgba(5,15,24,.97) 70%);border:1px solid rgba(129,232,255,.24);border-radius:16px;box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 10px 34px rgba(0,0,0,.48);user-select:none;-webkit-user-select:none}\n.surface-grip-toggle{display:flex;align-items:center;gap:9px;min-width:0;min-height:58px;padding:4px 6px;border:0;background:transparent;color:inherit;cursor:grab;text-align:left;font:600 11px/1.2 system-ui,-apple-system,\"Segoe UI\",sans-serif}\n.surface-grip-toggle:active{cursor:grabbing}\n.surface-grip-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:.05em;text-transform:uppercase}\n.surface-grip-action,.surface-grip-center,.surface-grip-arrange,.surface-grip-close{flex:none;min-width:38px;min-height:38px;padding:6px 8px;border:1px solid rgba(129,232,255,.28);border-radius:9px;color:#dff8ff;background:rgba(8,24,36,.76);cursor:pointer;font-size:10px}\n.surface-grip-action{padding:7px 9px;border-color:rgba(127,218,255,.32);color:#9ee9ff;letter-spacing:.08em;text-transform:uppercase}\n.surface-grip-close{font-size:18px;border-color:rgba(255,123,143,.38);color:#ffd5dc}\n.surface-grip-close:hover{border-color:rgba(255,123,143,.72);background:rgba(74,19,31,.86)}\n.surface-mini-cube{position:relative;width:42px;height:42px;flex:none;transform-style:preserve-3d;transform:rotateX(-18deg) rotateY(28deg);animation:panel-space-cube-spin 6s linear infinite;perspective:520px}\n.surface-mini-face{position:absolute;inset:0;border:1px solid rgba(153,238,255,.55);border-radius:6px;background:linear-gradient(145deg,rgba(111,225,255,.34),rgba(8,26,36,.92));box-shadow:inset 0 0 14px rgba(103,224,255,.12),0 0 15px rgba(103,224,255,.09);backface-visibility:hidden}\n.surface-mini-face--front{transform:translateZ(21px)}.surface-mini-face--back{transform:rotateY(180deg) translateZ(21px)}.surface-mini-face--right{transform:rotateY(90deg) translateZ(21px)}.surface-mini-face--left{transform:rotateY(-90deg) translateZ(21px)}.surface-mini-face--top{transform:rotateX(90deg) translateZ(21px)}.surface-mini-face--bottom{transform:rotateX(-90deg) translateZ(21px)}\n.surface-mini-mark{position:absolute;inset:0;display:grid;place-items:center;color:#e9fdff;font-size:14px;text-shadow:0 0 12px rgba(117,232,255,.82)}\n@keyframes panel-space-cube-spin{0%{transform:rotateX(-18deg) rotateY(0deg)}50%{transform:rotateX(-18deg) rotateY(180deg)}100%{transform:rotateX(-18deg) rotateY(360deg)}}\n[data-panel-space][data-compact=\"true\"]{width:auto!important;max-width:none!important;max-height:none!important;overflow:visible!important;background:transparent!important;border:0!important;box-shadow:none!important}\n[data-panel-space][data-compact=\"true\"]>:not(.surface-grip){display:none!important}\n[data-panel-space][data-compact=\"true\"]>.surface-grip{display:grid!important;width:min(286px,calc(100vw - 28px))!important}\n[data-panel-space][data-compact=\"true\"] .surface-grip-center,[data-panel-space][data-compact=\"true\"] .surface-grip-arrange{display:none!important}\n[data-panel-space]:not([data-compact=\"true\"]){min-width:180px;max-width:min(92vw,1200px);max-height:min(88vh,900px);border-radius:17px}\n.panel-space-resize{position:absolute;z-index:4;width:14px;height:14px;margin:-3px;background:transparent;border:0;padding:0;touch-action:none}\n.panel-space-resize[data-dir=\"n\"]{top:0;left:50%;transform:translate(-50%,-30%);cursor:ns-resize}.panel-space-resize[data-dir=\"s\"]{bottom:0;left:50%;transform:translate(-50%,30%);cursor:ns-resize}.panel-space-resize[data-dir=\"e\"]{top:50%;right:0;transform:translate(30%,-50%);cursor:ew-resize}.panel-space-resize[data-dir=\"w\"]{top:50%;left:0;transform:translate(-30%,-50%);cursor:ew-resize}.panel-space-resize[data-dir=\"ne\"]{top:0;right:0;transform:translate(30%,-30%);cursor:nesw-resize}.panel-space-resize[data-dir=\"nw\"]{top:0;left:0;transform:translate(-30%,-30%);cursor:nwse-resize}.panel-space-resize[data-dir=\"se\"]{bottom:0;right:0;transform:translate(30%,30%);cursor:nwse-resize}.panel-space-resize[data-dir=\"sw\"]{bottom:0;left:0;transform:translate(-30%,30%);cursor:nesw-resize}\n.panel-space-dragging *,.panel-space-resizing *{user-select:none!important;-webkit-user-select:none!important}\n@media(prefers-reduced-motion:reduce){.surface-mini-cube{animation:none}}\n";


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
        if (rec.placed) data[rec.id] = { x: Math.round(rec.state.x), y: Math.round(rec.state.y), z: Math.round(rec.state.z) };
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
    const v = viewport();
    const sx = Number(saved.x);
    const sy = Number(saved.y);
    rec.home = { x: r.left, y: r.top };
    const st = el.style;
    st.position = 'fixed'; st.left = '0px'; st.top = '0px';
    st.right = 'auto'; st.bottom = 'auto'; st.margin = '0px';
    rec.placed = true;
    const p = clampSurface(Number.isFinite(sx) ? sx : r.left, Number.isFinite(sy) ? sy : r.top, r.width, r.height, v.w, v.h);
    rec.state = { x: p.x, y: p.y, z: clampDepth(saved.z || 0) };
    applyTransform(rec);
    if (rec.compactible) setCompact(rec, true, null); // small by default; interaction materializes
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
    const isHint = el.id === 'hint';
    const rec = {
      id: desc.id, el,
      state: { x: 0, y: 0, z: 0 },
      home: null, placed: false, placeQueued: false,
      wasVisible: isPanelVisible(el, view),
      originalCssText: el.style ? el.style.cssText : '',
      grip: null, toggleBtn: null, actionEl: null,
      compactible: !isHint && el.id !== 'city-journey',
    };
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
    if (rec.wasVisible) requestPlace(rec, ctx);
    return rec;
  }

  function activate() {
    const styleEl = documentRoot.createElement('style');
    styleEl.setAttribute('data-panel-space-style', 'true');
    styleEl.textContent = PANEL_SPACE_CSS;
    (documentRoot.head || documentRoot).appendChild(styleEl);

    const ctx = {
      recs: [], byEl: new Map(), store: readStore(view), saveTimer: 0, styleEl,
    };
    for (const desc of collectPanelDescriptors(documentRoot)) {
      try { setupPanel(desc, ctx); } catch { /* one bad panel never breaks the field */ }
    }

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
