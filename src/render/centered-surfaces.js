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

/** Every floating panel/tab: all asides plus the non-aside overlays. */
export function collectPanelDescriptors(documentRoot) {
  const out = [];
  const seen = new Set();
  const push = (el) => {
    if (!el || seen.has(el)) return;
    seen.add(el);
    out.push({ id: el.id || '(panel)', el });
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
        if (rec.placed) data[rec.id] = { x: Math.round(rec.state.x), y: Math.round(rec.state.y), z: Math.round(rec.state.z) };
      }
      writeStore(view, data);
    }, 250);
  }

  function setCompact(rec, on, ctx) {
    if (rec.spatialAttached) return;
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
    if (rec.spatialAttached || rec.placed || !isPanelVisible(el, view)) return false;
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
    if (rec.spatialAttached || rec.placed || rec.placeQueued) return;
    rec.placeQueued = true;
    raf(() => {
      rec.placeQueued = false;
      if (rec.spatialAttached || rec.placed || !isPanelVisible(rec.el, view)) return;
      if (placePanel(rec, ctx)) return; // placed and chipped
      // Layout was not ready (zero rect): retry with backoff instead of
      // giving up forever. Any later visibility signal also re-arms this.
      if (attempt < 10) {
        setTimeout(() => requestPlace(rec, ctx, attempt + 1), 150);
      }
    });
  }

  function reconcilePanel(rec, ctx) {
    if (rec.spatialAttached) return;
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

  function attachPanelGrip(rec, ctx) {
    if (rec.grip || rec.isHint) return;
    const el = rec.el;
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
    center.textContent = 'Center panel';
    center.title = 'Return this panel to its designed position';
    grip.append(toggle, center);
    const summary = el.tagName === 'DETAILS' ? el.querySelector('summary') : null;
    if (summary && summary.parentNode === el) summary.after(grip);
    else if (typeof el.prepend === 'function') el.prepend(grip);
    else el.insertBefore(grip, el.firstChild);
    center.addEventListener('click', () => recenter(rec, ctx));
    attachPlaneDepthDrag(rec, ctx, toggle, { tapToggles: true });
    rec.grip = grip;
    rec.toggleBtn = toggle;
    rec.actionEl = action;
  }

  function setupPanel(desc, ctx) {
    const el = desc.el;
    const isHint = el.id === 'hint';
    const spatialAttached = el.getAttribute?.('data-lens-surface-attached') === 'true';
    const rec = {
      id: desc.id, el,
      state: { x: 0, y: 0, z: 0 },
      home: null, placed: false, placeQueued: false,
      wasVisible: isPanelVisible(el, view),
      originalCssText: el.style ? el.style.cssText : '',
      spatialAttached,
      isHint,
      grip: null, toggleBtn: null, actionEl: null,
      compactible: !isHint && el.id !== 'city-journey',
    };
    if (!spatialAttached && !isHint) attachPanelGrip(rec, ctx);
    else if (isHint) {
      attachPlaneDepthDrag(rec, ctx, el, { tapToggles: false });
    }
    if (spatialAttached) {
      // Reality Assembly can mount before this manager starts on a direct-link
      // load. Never re-chip or overlay a panel already parented to its object.
      el.removeAttribute('data-panel-space');
      el.removeAttribute('data-compact');
      el.classList.remove('panel-space-appearing');
    } else {
      el.setAttribute('data-panel-space', 'managed');
    }
    ctx.recs.push(rec);
    ctx.byEl.set(el, rec);
    if (rec.wasVisible && !rec.spatialAttached) requestPlace(rec, ctx);
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
        if (rec) { if (!rec.spatialAttached) reconcilePanel(rec, ctx); continue; }
        // feature-shell's .open class drives asset-launch visibility via a
        // sibling selector, so its class change reconciles the whole field.
        if (t.id === 'feature-shell') reconcileAll = true;
      }
      if (reconcileAll) for (const rec of ctx.recs) reconcilePanel(rec, ctx);
    };

    const onMaterializeRealityLensPanel = (event) => {
      const panelId = String(event?.detail?.panelId ?? '');
      const rec = ctx.recs.find((candidate) => candidate.id === panelId);
      if (!rec || rec.spatialAttached) return;
      const anchorX = Number(event?.detail?.anchorX);
      const anchorY = Number(event?.detail?.anchorY);
      const hasAnchor = Number.isFinite(anchorX) && Number.isFinite(anchorY);
      const shouldAnchor = hasAnchor && (event?.detail?.forceAnchor === true || (!rec.placed && !ctx.store[rec.id]));
      const materialize = (attempt = 0) => {
        if (rec.spatialAttached) return;
        if (!isPanelVisible(rec.el, view)) return;
        if (rec.placed) {
          if(rec.compactible&&rec.el.getAttribute('data-compact')==='true')setCompact(rec,false,ctx);
          if (shouldAnchor) {
            if(rec.state.z!==0){rec.state.z=0;applyTransform(rec);}
            const rect = rec.el.getBoundingClientRect();
            const point = clampSurface(anchorX + 24, anchorY - rect.height / 2, rect.width, rect.height, viewport().w, viewport().h);
            if(Math.abs(rec.state.x-point.x)>.65||Math.abs(rec.state.y-point.y)>.65){
              rec.state.x = point.x;
              rec.state.y = point.y;
              rec.home = { x: point.x, y: point.y };
              applyTransform(rec);
            }
          }
          return;
        }
        requestPlace(rec, ctx);
        if (attempt < 6) raf(() => materialize(attempt + 1));
      };
      materialize();
    };
    documentRoot.addEventListener?.('matumbo:reality-lens-materialize', onMaterializeRealityLensPanel);
    const onRealityLensAttachment = (event) => {
      const rec = ctx.recs.find((candidate) => candidate.id === String(event?.detail?.panelId ?? ''));
      if (!rec) return;
      rec.spatialAttached = event?.detail?.attached === true;
      if (rec.spatialAttached) {
        rec.el.removeAttribute('data-panel-space');
        rec.el.removeAttribute('data-compact');
        rec.el.classList.remove('panel-space-appearing');
      } else {
        rec.el.setAttribute('data-panel-space', 'managed');
        attachPanelGrip(rec, ctx);
        if (rec.placed) applyTransform(rec);
        reconcilePanel(rec, ctx);
      }
    };
    documentRoot.addEventListener?.('matumbo:reality-lens-surface-attachment', onRealityLensAttachment);

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
        if (rec.spatialAttached) continue;
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
      documentRoot.removeEventListener?.('matumbo:reality-lens-materialize', onMaterializeRealityLensPanel);
      documentRoot.removeEventListener?.('matumbo:reality-lens-surface-attachment', onRealityLensAttachment);
      if (typeof view.removeEventListener === 'function') view.removeEventListener('resize', onResize);
      if (ctx.saveTimer) { clearTimeout(ctx.saveTimer); ctx.saveTimer = 0; }
      for (const rec of ctx.recs) {
        if (rec.spatialAttached) continue;
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
