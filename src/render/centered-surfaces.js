/** Panel Space Ω — universal floating-window manager.
 *
 * Every feature console/tab is treated as an independent local spatial
 * surface. The manager owns presentation layout only:
 *
 *   move       x / y
 *   depth      z (front / back)
 *   resize     width / height from eight edges/corners
 *   arrange    left / right / top / bottom / front / back / free
 *   focus      bring one surface in front
 *   materialize expand / minimize without recentering
 *
 * Layout is persisted by stable DOM id. A panel opening or navigating to a
 * different feature never resets another panel's x/y/z/size state.
 *
 * This does not own the 3D world, route state, wallet, ledger, provider,
 * identity, signing, settlement, or other application authority.
 */

/* ------------------------------------------------------------------ */
/* Pure geometry helpers.                                             */
/* ------------------------------------------------------------------ */

/** Clamp a panel to the visible viewport without recentering it. */
export function clampSurface(
  x,
  y,
  width,
  height,
  viewportWidth,
  viewportHeight,
) {
  const safeWidth = Math.max(80, Number.isFinite(Number(width)) ? Number(width) : 320);
  const safeHeight = Math.max(60, Number.isFinite(Number(height)) ? Number(height) : 220);
  const vw = Math.max(safeWidth + 16, Number.isFinite(Number(viewportWidth)) ? Number(viewportWidth) : 1024);
  const vh = Math.max(safeHeight + 42, Number.isFinite(Number(viewportHeight)) ? Number(viewportHeight) : 768);
  return {
    x: Math.max(8, Math.min(Number(x) || 0, Math.max(8, vw - safeWidth - 8))),
    y: Math.max(8, Math.min(Number(y) || 0, Math.max(8, vh - safeHeight - 42))),
  };
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
  return Math.max(0.72, Math.min(1.12, 1 + c / 4500));
}

/** Keep panel dimensions within safe local bounds. */
export function clampSurfaceSize(
  width,
  height,
  viewportWidth = 1440,
  viewportHeight = 900,
) {
  const vw = Math.max(320, Number(viewportWidth) || 1440);
  const vh = Math.max(240, Number(viewportHeight) || 900);
  const maxWidth = Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, vw - 24));
  const maxHeight = Math.min(PANEL_HEIGHT_MAX, Math.max(PANEL_HEIGHT_MIN, vh - 54));
  return {
    width: Math.max(PANEL_WIDTH_MIN, Math.min(Number(width) || 320, maxWidth)),
    height: Math.max(PANEL_HEIGHT_MIN, Math.min(Number(height) || 220, maxHeight)),
  };
}

/** CSS transform for an independent panel transform {x, y, z}. */
export function composePanelTransform(x, y, z) {
  return `translate3d(${Number(x).toFixed(1)}px, ${Number(y).toFixed(1)}px, 0px) scale(${depthScale(z).toFixed(4)})`;
}

/* ------------------------------------------------------------------ */
/* Panel discovery.                                                   */
/* ------------------------------------------------------------------ */

const EXTRA_PANEL_IDS = [
  "gesture-input-panel",
  "media-preview",
  "city-journey",
  "hint",
];

/**
 * Every floating feature surface:
 *   - <aside> consoles;
 *   - [data-floating-panel] explicit non-asides;
 *   - [role="dialog"] consoles;
 *   - known legacy overlays.
 *
 * Full-screen presentation layers are intentionally excluded unless they
 * opt into data-floating-panel.
 */
export function collectPanelDescriptors(documentRoot) {
  const out = [];
  const seen = new Set();

  const push = (el) => {
    if (!el || seen.has(el)) return;
    if (el.dataset?.panelSpaceIgnore === "true") return;
    if (el.id === "xr-spatial-ui" || el.id === "immersive-toolbar") return;
    seen.add(el);
    out.push({ id: el.id || `panel-${out.length + 1}`, el });
  };

  if (documentRoot?.querySelectorAll) {
    for (const selector of [
      "aside",
      "[data-floating-panel='true']",
      "[role='dialog']",
    ]) {
      documentRoot.querySelectorAll(selector).forEach(push);
    }
  }

  if (documentRoot?.getElementById) {
    EXTRA_PANEL_IDS.forEach((id) => push(documentRoot.getElementById(id)));
  }

  return out;
}

/** Human label for a panel's drag grip. */
export function panelTitle(el) {
  if (!el) return "Panel";
  try {
    const labelled = el.getAttribute?.("aria-label");
    if (labelled?.trim()) return labelled.trim().slice(0, 64);
    const title = el.querySelector?.("[data-panel-title],h1,h2,h3,h4,summary");
    const text = title?.textContent?.trim();
    if (text) return text.slice(0, 64);
  } catch {
    // Keep deterministic fallback.
  }
  const id = (el.id || "").replace(/[-_]+/g, " ").trim();
  return id ? id.replace(/\b\w/g, (c) => c.toUpperCase()) : "Panel";
}

/**
 * Visibility across the panel open mechanisms.
 */
export function isPanelVisible(el, view) {
  if (!el) return false;
  if (el.hidden === true) return false;
  if (el.id === "feature-shell") {
    return !!el.classList?.contains("open");
  }
  if (el.tagName === "DETAILS") {
    return el.open !== false;
  }
  if (view?.getComputedStyle) {
    try {
      const cs = view.getComputedStyle(el);
      if (cs && (cs.display === "none" || cs.visibility === "hidden")) return false;
    } catch {
      // Fall through to DOM visibility.
    }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Persistence.                                                       */
/* ------------------------------------------------------------------ */

const STORE_KEY = "matumbo.panelSpace.v2";

function readStore(view) {
  try {
    const raw = view?.localStorage?.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(view, data) {
  try {
    view?.localStorage?.setItem(STORE_KEY, JSON.stringify(data));
  } catch {
    // Private mode / unavailable storage: live layout still works.
  }
}

/* ------------------------------------------------------------------ */
/* Manager.                                                            */
/* ------------------------------------------------------------------ */

const NARROW_QUERY = "(max-width:700px)";

const PANEL_SPACE_CSS = `
[data-panel-space]{transform-origin:0 0;transition-property:opacity,filter !important;position:fixed !important}
.surface-grip{display:flex;align-items:center;gap:6px;flex-shrink:0;padding:5px 7px;border-bottom:1px solid rgba(120,160,190,.25);touch-action:none;color:#d9eeff;font:12px system-ui;background:rgba(10,25,38,.35);border-radius:10px 10px 0 0;user-select:none;-webkit-user-select:none}
.surface-grip-toggle{flex:1;min-width:0;display:flex;align-items:center;gap:6px;overflow:hidden;color:inherit;background:transparent;border:0;padding:5px 3px;cursor:grab;font:inherit;text-align:left}
.surface-grip-toggle:active{cursor:grabbing}
.surface-grip-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.surface-grip-depth{flex:none;opacity:.55;font-size:9px;white-space:nowrap}
.surface-grip-action{flex:none;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:#8fd8f2;border:1px solid rgba(120,180,220,.35);border-radius:6px;padding:2px 6px;white-space:nowrap}
.surface-grip-tool{flex:none;color:inherit;background:#15283b;border:1px solid #68859e;border-radius:6px;padding:4px 6px;cursor:pointer;font-size:9px}
.surface-grip-tool:hover{background:#20384d}
.surface-grip-center{flex:none;color:inherit;background:#15283b;border:1px solid #68859e;border-radius:6px;padding:4px 7px;cursor:pointer;font-size:9px}
.surface-dock{flex:none;max-width:84px;border:1px solid rgba(120,180,220,.35);border-radius:6px;background:#0f2232;color:#d9eeff;font:9px system-ui;padding:3px}
.panel-resize-handle{position:absolute;z-index:8;touch-action:none;user-select:none;-webkit-user-select:none}
.panel-resize-n{left:10px;right:10px;top:-4px;height:8px;cursor:ns-resize}
.panel-resize-s{left:10px;right:10px;bottom:-4px;height:8px;cursor:ns-resize}
.panel-resize-e{top:10px;bottom:10px;right:-4px;width:8px;cursor:ew-resize}
.panel-resize-w{top:10px;bottom:10px;left:-4px;width:8px;cursor:ew-resize}
.panel-resize-ne{right:-5px;top:-5px;width:12px;height:12px;cursor:nesw-resize}
.panel-resize-nw{left:-5px;top:-5px;width:12px;height:12px;cursor:nwse-resize}
.panel-resize-se{right:-5px;bottom:-5px;width:12px;height:12px;cursor:nwse-resize}
.panel-resize-sw{left:-5px;bottom:-5px;width:12px;height:12px;cursor:nesw-resize}
[data-panel-space][data-compact="true"]{width:auto !important;max-width:min(360px,calc(100vw - 16px)) !important;min-width:0 !important;min-height:0 !important}
[data-panel-space][data-compact="true"] > :not(.surface-grip){display:none !important}
[data-panel-space]:not([data-compact="true"]){max-width:calc(100vw - 16px) !important;max-height:calc(100vh - 48px) !important}
[data-panel-space] [data-panel-content]{min-width:0;min-height:0;overflow:auto}
@keyframes panelSpaceIn{from{opacity:0}to{opacity:1}}
.panel-space-appearing{animation:panelSpaceIn .18s ease-out}
#hint[data-panel-space]{touch-action:none;user-select:none;-webkit-user-select:none}
`;

export function mountCenteredSurfaces(documentRoot = document, view = window) {
  const noop = () => {};
  if (!documentRoot || !view) return noop;

  const mq = typeof view.matchMedia === "function" ? view.matchMedia(NARROW_QUERY) : null;
  const isNarrow = () =>
    mq
      ? mq.matches
      : (typeof view.innerWidth === "number" ? view.innerWidth : 1024) <= 700;

  const raf =
    typeof view.requestAnimationFrame === "function"
      ? view.requestAnimationFrame.bind(view)
      : (fn) => setTimeout(fn, 16);

  let active = false;
  let teardownActive = null;

  const viewport = () => ({
    w: typeof view.innerWidth === "number" ? view.innerWidth : 1024,
    h: typeof view.innerHeight === "number" ? view.innerHeight : 768,
  });

  function applyTransform(rec) {
    const { x, y, z } = rec.state;
    rec.el.style.transform = composePanelTransform(x, y, z);
    rec.el.style.filter =
      z === 0 ? "" : `brightness(${depthBrightness(z).toFixed(3)})`;
    rec.el.style.zIndex = String(rec.zIndex);
  }

  function readBox(rec) {
    const box = rec.el.getBoundingClientRect?.();
    return {
      width: Math.max(
        PANEL_WIDTH_MIN,
        Number(box?.width) || rec.state.width || 320,
      ),
      height: Math.max(
        PANEL_HEIGHT_MIN,
        Number(box?.height) || rec.state.height || 220,
      ),
    };
  }

  function persistSoon(ctx) {
    if (ctx.saveTimer) return;
    ctx.saveTimer = setTimeout(() => {
      ctx.saveTimer = 0;
      const data = {};
      for (const rec of ctx.recs) {
        if (!rec.placed) continue;
        data[rec.id] = {
          x: Math.round(rec.state.x),
          y: Math.round(rec.state.y),
          z: Math.round(rec.state.z),
          width: Math.round(rec.state.width),
          height: Math.round(rec.state.height),
          compact: rec.el.getAttribute("data-compact") === "true",
          zIndex: rec.zIndex,
        };
      }
      writeStore(view, data);
    }, 180);
  }

  function setCompact(rec, on, ctx, { animate = false } = {}) {
    if (!rec.compactible) return;
    const next = !!on;
    if (!next && !rec.placed) return;

    rec.el.toggleAttribute("data-compact", next);
    if (!next) {
      // Materialized panels regain their remembered dimensions. Nothing gets
      // recentered; only size is restored.
      rec.el.style.width = `${rec.state.width}px`;
      rec.el.style.height = `${rec.state.height}px`;
    }
    if (rec.actionEl) rec.actionEl.textContent = next ? "Open" : "Min";
    if (rec.toggleBtn) rec.toggleBtn.setAttribute("aria-expanded", String(!next));

    if (animate) {
      rec.el.classList.add("panel-space-appearing");
      setTimeout(() => rec.el.classList.remove("panel-space-appearing"), 220);
    }

    if (!next && rec.placed) {
      clampRecordIntoViewport(rec, ctx);
    }
    if (ctx) persistSoon(ctx);
  }

  function toggleCompact(rec, ctx) {
    setCompact(
      rec,
      rec.el.getAttribute("data-compact") !== "true",
      ctx,
      { animate: true },
    );
  }

  function clampRecordIntoViewport(rec, ctx) {
    const v = viewport();
    const size = clampSurfaceSize(rec.state.width, rec.state.height, v.w, v.h);
    rec.state.width = size.width;
    rec.state.height = size.height;
    rec.el.style.width = `${size.width}px`;
    rec.el.style.height = `${size.height}px`;
    const p = clampSurface(
      rec.state.x,
      rec.state.y,
      size.width,
      size.height,
      v.w,
      v.h,
    );
    rec.state.x = p.x;
    rec.state.y = p.y;
    applyTransform(rec);
    if (ctx) persistSoon(ctx);
  }

  function recenter(rec, ctx) {
    if (!rec.placed || !rec.home) return;
    const v = viewport();
    const p = clampSurface(
      rec.home.x,
      rec.home.y,
      rec.state.width,
      rec.state.height,
      v.w,
      v.h,
    );
    rec.state.x = p.x;
    rec.state.y = p.y;
    rec.state.z = 0;
    rec.dock = "free";
    applyTransform(rec);
    persistSoon(ctx);
  }

  function arrange(rec, dock, ctx) {
    const v = viewport();
    const w = rec.state.width;
    const h = rec.state.height;
    let x = rec.state.x;
    let y = rec.state.y;

    switch (dock) {
      case "left":
        x = 12;
        break;
      case "right":
        x = v.w - w - 12;
        break;
      case "top":
        y = 12;
        break;
      case "bottom":
        y = v.h - h - 54;
        break;
      case "front":
        x = (v.w - w) / 2;
        y = (v.h - h) / 2;
        rec.state.z = PANEL_DEPTH_MAX;
        break;
      case "back":
        rec.state.z = PANEL_DEPTH_MIN;
        break;
      case "free":
      default:
        break;
    }

    const p = clampSurface(x, y, w, h, v.w, v.h);
    rec.state.x = p.x;
    rec.state.y = p.y;
    rec.dock = ["left","right","top","bottom","front","back"].includes(dock) ? dock : "free";

    focus(rec);
    applyTransform(rec);
    persistSoon(ctx);
    return true;
  }

  function focus(rec) {
    if (!rec) return false;
    rec.zIndex = ++ctxState.zCounter;
    applyTransform(rec);
    return true;
  }

  // ctxState is intentionally replaced once per activation; focus() is kept
  // tiny so every surface click follows the same stacking rule.
  let ctxState = { zCounter: 9500 };

  function placePanel(rec, ctx) {
    const el = rec.el;
    if (rec.placed || !isPanelVisible(el, view)) return false;

    const saved = ctx.store[rec.id] && typeof ctx.store[rec.id] === "object"
      ? ctx.store[rec.id]
      : null;
    const r = el.getBoundingClientRect?.();
    if (!r || (r.width === 0 && r.height === 0)) return false;

    const v = viewport();
    rec.home = { x: r.left, y: r.top };

    rec.state.width = saved && Number.isFinite(Number(saved.width))
      ? Number(saved.width)
      : r.width;
    rec.state.height = saved && Number.isFinite(Number(saved.height))
      ? Number(saved.height)
      : r.height;

    const size = clampSurfaceSize(rec.state.width, rec.state.height, v.w, v.h);
    rec.state.width = size.width;
    rec.state.height = size.height;

    const sx = saved && Number.isFinite(Number(saved.x)) ? Number(saved.x) : r.left;
    const sy = saved && Number.isFinite(Number(saved.y)) ? Number(saved.y) : r.top;

    rec.state.x = clampSurface(
      sx,
      sy,
      size.width,
      size.height,
      v.w,
      v.h,
    ).x;
    rec.state.y = clampSurface(
      sx,
      sy,
      size.width,
      size.height,
      v.w,
      v.h,
    ).y;
    rec.state.z = clampDepth(
      saved && Number.isFinite(Number(saved.z)) ? Number(saved.z) : 0,
    );

    rec.placed = true;
    rec.hasSavedLayout = !!saved;

    const st = el.style;
    st.position = "fixed";
    st.left = "0px";
    st.top = "0px";
    st.right = "auto";
    st.bottom = "auto";
    st.margin = "0px";
    st.width = `${size.width}px`;
    st.height = `${size.height}px`;

    rec.zIndex =
      saved && Number.isFinite(Number(saved.zIndex))
        ? Math.max(1, Number(saved.zIndex))
        : ++ctxState.zCounter;
    ctxState.zCounter = Math.max(ctxState.zCounter, rec.zIndex);

    applyTransform(rec);

    // First-ever opening remains compact. A saved expanded panel stays
    // expanded. This is the no-jump rule.
    const shouldCompact = saved ? saved.compact === true : true;
    if (rec.compactible) {
      if (shouldCompact) setCompact(rec, true, null);
      else setCompact(rec, false, null);
    }

    el.classList.add("panel-space-appearing");
    setTimeout(() => el.classList.remove("panel-space-appearing"), 220);
    persistSoon(ctx);
    return true;
  }

  function requestPlace(rec, ctx, attempt = 0) {
    if (rec.placed || rec.placeQueued) return;
    rec.placeQueued = true;
    raf(() => {
      rec.placeQueued = false;
      if (rec.placed || !isPanelVisible(rec.el, view)) return;
      if (placePanel(rec, ctx)) return;
      if (attempt < 12) {
        setTimeout(() => requestPlace(rec, ctx, attempt + 1), 120);
      }
    });
  }

  function reconcilePanel(rec, ctx) {
    const visible = isPanelVisible(rec.el, view);
    const was = rec.wasVisible === true;
    rec.wasVisible = visible;

    if (!visible) return;

    if (!rec.placed) {
      requestPlace(rec, ctx);
      return;
    }

    // Hidden -> visible: never force a new location, size, depth or compact
    // state. Only bring it into the saved local field.
    if (!was) {
      const saved = ctx.store[rec.id];
      if (rec.compactible && !saved && !rec.userInteracted) {
        setCompact(rec, true, ctx, { animate: true });
      } else if (rec.compactible && saved) {
        setCompact(rec, saved.compact === true, ctx, { animate: true });
      }
      clampRecordIntoViewport(rec, ctx);
    }
  }

  function makeHandle(rec, direction, ctx) {
    const handle = documentRoot.createElement("div");
    handle.className = `panel-resize-handle panel-resize-${direction}`;
    handle.dataset.panelResize = direction;
    handle.setAttribute("aria-hidden", "true");

    let drag = null;

    const pointerDown = (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      focus(rec);
      try { handle.setPointerCapture?.(event.pointerId); } catch {}
      drag = {
        x: event.clientX,
        y: event.clientY,
        width: rec.state.width,
        height: rec.state.height,
        left: rec.state.x,
        top: rec.state.y,
      };
    };

    const pointerMove = (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      let width = drag.width;
      let height = drag.height;
      let left = drag.left;
      let top = drag.top;

      if (direction.includes("e")) width += dx;
      if (direction.includes("s")) height += dy;
      if (direction.includes("w")) {
        width -= dx;
        left += dx;
      }
      if (direction.includes("n")) {
        height -= dy;
        top += dy;
      }

      const v = viewport();
      const size = clampSurfaceSize(width, height, v.w, v.h);

      if (direction.includes("w")) {
        left = drag.left + (drag.width - size.width);
      }
      if (direction.includes("n")) {
        top = drag.top + (drag.height - size.height);
      }

      rec.state.width = size.width;
      rec.state.height = size.height;
      rec.state.x = left;
      rec.state.y = top;
      rec.dock = "free";
      rec.userInteracted = true;

      // Resizing a compact chip materializes that surface instead of trapping
      // the resize handle inside hidden content.
      if (rec.compactible && rec.el.getAttribute("data-compact") === "true") {
        setCompact(rec, false, ctx);
      }

      clampRecordIntoViewport(rec, null);
      event.preventDefault();
      event.stopPropagation();
    };

    const pointerEnd = (event) => {
      if (!drag) return;
      drag = null;
      try { handle.releasePointerCapture?.(event.pointerId); } catch {}
      persistSoon(ctx);
      event.preventDefault();
      event.stopPropagation();
    };

    handle.addEventListener("pointerdown", pointerDown);
    handle.addEventListener("pointermove", pointerMove);
    handle.addEventListener("pointerup", pointerEnd);
    handle.addEventListener("pointercancel", pointerEnd);

    rec.cleanup.push(() => {
      handle.removeEventListener("pointerdown", pointerDown);
      handle.removeEventListener("pointermove", pointerMove);
      handle.removeEventListener("pointerup", pointerEnd);
      handle.removeEventListener("pointercancel", pointerEnd);
      handle.remove();
    });

    rec.el.append(handle);
  }

  function attachMove(rec, ctx, handle) {
    let drag = null;
    let suppressClick = false;

    const pointerDown = (event) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      if (event.target?.closest?.(
        ".surface-grip-tool,.surface-grip-center,.surface-dock",
      )) return;

      focus(rec);
      try { handle.setPointerCapture?.(event.pointerId); } catch {}

      drag = {
        startX: event.clientX,
        startY: event.clientY,
        ox: rec.state.x,
        oy: rec.state.y,
        oz: rec.state.z,
        depth: !!event.shiftKey,
        moved: false,
      };
      event.preventDefault();
    };

    const pointerMove = (event) => {
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;

      if (Math.abs(dx) + Math.abs(dy) > 4) {
        drag.moved = true;
        rec.userInteracted = true;
      }

      if (drag.depth) {
        rec.state.z = clampDepth(drag.oz + (drag.startY - event.clientY) * 2);
        rec.dock = "free";
      } else {
        rec.state.x = drag.ox + dx;
        rec.state.y = drag.oy + dy;
        rec.dock = "free";
      }

      clampRecordIntoViewport(rec, null);
      event.preventDefault();
    };

    const pointerEnd = (event) => {
      if (!drag) return;
      const wasTap = !drag.moved;
      drag = null;
      if (wasTap && rec.compactible && !event.shiftKey) {
        suppressClick = true;
        toggleCompact(rec, ctx);
      } else {
        persistSoon(ctx);
      }
      try { handle.releasePointerCapture?.(event.pointerId); } catch {}
      event.preventDefault();
    };

    handle.addEventListener("pointerdown", pointerDown);
    handle.addEventListener("pointermove", pointerMove);
    handle.addEventListener("pointerup", pointerEnd);
    handle.addEventListener("pointercancel", pointerEnd);

    handle.addEventListener("click", () => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      if (rec.compactible) toggleCompact(rec, ctx);
    });

    handle.addEventListener("wheel", (event) => {
      rec.state.z = clampDepth(rec.state.z - event.deltaY * 1.2);
      rec.dock = "free";
      rec.userInteracted = true;
      applyTransform(rec);
      persistSoon(ctx);
      event.preventDefault();
    }, { passive: false });
  }

  function setupPanel(desc, ctx) {
    const el = desc.el;
    if (el.dataset.panelSpace === "managed") return ctx.byEl.get(el);

    const isHint = el.id === "hint";
    const rec = {
      id: desc.id,
      el,
      state: { x: 0, y: 0, z: 0, width: 320, height: 220 },
      home: null,
      dock: "free",
      placed: false,
      placeQueued: false,
      hasSavedLayout: false,
      userInteracted: false,
      wasVisible: isPanelVisible(el, view),
      originalCssText: el.style?.cssText || "",
      grip: null,
      toggleBtn: null,
      actionEl: null,
      compactible: !isHint,
      cleanup: [],
    };

    if (!isHint) {
      const title = panelTitle(el);

      const grip = documentRoot.createElement("div");
      grip.className = "surface-grip";
      grip.dataset.panelChrome = "true";

      const toggle = documentRoot.createElement("button");
      toggle.type = "button";
      toggle.className = "surface-grip-toggle";
      toggle.title =
        `${title} — drag to move, SHIFT-drag / wheel for depth, resize edges, click to open/minimize`;

      const label = documentRoot.createElement("span");
      label.className = "surface-grip-label";
      label.textContent = `${title} · move / resize`;

      const depthHint = documentRoot.createElement("span");
      depthHint.className = "surface-grip-depth";
      depthHint.textContent = "SHIFT = depth";

      const action = documentRoot.createElement("span");
      action.className = "surface-grip-action";
      action.textContent = "Open";

      toggle.append(label, depthHint, action);

      const dock = documentRoot.createElement("select");
      dock.className = "surface-dock";
      dock.setAttribute("aria-label", `${title} arrangement`);
      [
        ["free", "FREE"],
        ["left", "LEFT"],
        ["right", "RIGHT"],
        ["top", "TOP"],
        ["bottom", "BOTTOM"],
        ["front", "FRONT"],
        ["back", "BACK"],
      ].forEach(([value, text]) => {
        const option = documentRoot.createElement("option");
        option.value = value;
        option.textContent = text;
        dock.append(option);
      });

      const center = documentRoot.createElement("button");
      center.type = "button";
      center.className = "surface-grip-center";
      center.textContent = "⌾";
      center.title = "Return this panel to its original designed position";

      const front = documentRoot.createElement("button");
      front.type = "button";
      front.className = "surface-grip-tool";
      front.textContent = "↑";
      front.title = "Bring this panel all the way to the front";

      const close = documentRoot.createElement("button");
      close.type = "button";
      close.className = "surface-grip-tool";
      close.textContent = "×";
      close.title = "Hide this panel";

      grip.append(toggle, dock, center, front, close);

      const summary = el.tagName === "DETAILS" ? el.querySelector("summary") : null;
      if (summary && summary.parentNode === el) summary.after(grip);
      else if (typeof el.prepend === "function") el.prepend(grip);
      else el.insertBefore(grip, el.firstChild);

      const onDock = () => {
        arrange(rec, dock.value, ctx);
      };

      const onCenter = () => recenter(rec, ctx);
      const onFront = () => arrange(rec, "front", ctx);
      const onClose = () => {
        el.hidden = true;
        persistSoon(ctx);
      };

      dock.addEventListener("change", onDock);
      center.addEventListener("click", onCenter);
      front.addEventListener("click", onFront);
      close.addEventListener("click", onClose);

      toggle.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          toggleCompact(rec, ctx);
        }
      });

      attachMove(rec, ctx, toggle);

      rec.cleanup.push(() => {
        dock.removeEventListener("change", onDock);
        center.removeEventListener("click", onCenter);
        front.removeEventListener("click", onFront);
        close.removeEventListener("click", onClose);
        toggle.removeEventListener("keydown", () => {});
        grip.remove();
      });

      rec.grip = grip;
      rec.toggleBtn = toggle;
      rec.actionEl = action;
    } else {
      attachMove(rec, ctx, el);
    }

    // Eight handles let width and height be changed independently from every
    // edge/corner. This is the universal resize behavior.
    if (!isHint) {
      [
        "n","s","e","w",
        "ne","nw","se","sw",
      ].forEach((direction) => makeHandle(rec, direction, ctx));
    }

    el.setAttribute("data-panel-space", "managed");
    ctx.recs.push(rec);
    ctx.byEl.set(el, rec);

    if (rec.wasVisible) requestPlace(rec, ctx);
    return rec;
  }

  function activate() {
    const styleEl = documentRoot.createElement("style");
    styleEl.setAttribute("data-panel-space-style", "true");
    styleEl.textContent = PANEL_SPACE_CSS;
    (documentRoot.head || documentRoot).appendChild(styleEl);

    ctxState = { zCounter: 9500 };

    const ctx = {
      recs: [],
      byEl: new Map(),
      store: readStore(view),
      saveTimer: 0,
      styleEl,
    };

    const addDiscovered = (root) => {
      if (!root) return;

      const candidates = [];
      if (root.matches?.("aside,[data-floating-panel='true'],[role='dialog']")) {
        candidates.push(root);
      }
      root.querySelectorAll?.("aside,[data-floating-panel='true'],[role='dialog']").forEach((el) => candidates.push(el));

      for (const el of candidates) {
        if (ctx.byEl.has(el)) continue;
        try { setupPanel({ id: el.id || `panel-${ctx.recs.length + 1}`, el }, ctx); } catch {}
      }

      EXTRA_PANEL_IDS.forEach((id) => {
        const el = documentRoot.getElementById?.(id);
        if (el && !ctx.byEl.has(el)) {
          try { setupPanel({ id, el }, ctx); } catch {}
        }
      });
    };

    collectPanelDescriptors(documentRoot).forEach((desc) => {
      try { setupPanel(desc, ctx); } catch {}
    });

    const onMutations = (mutations) => {
      for (const mutation of mutations || []) {
        if (mutation.type === "childList") {
          mutation.addedNodes?.forEach((node) => {
            if (node?.nodeType === 1) addDiscovered(node);
          });
          continue;
        }

        const target = mutation.target;
        const rec = ctx.byEl.get(target);
        if (rec) {
          reconcilePanel(rec, ctx);
          continue;
        }

        if (target?.id === "feature-shell") {
          for (const entry of ctx.recs) reconcilePanel(entry, ctx);
        }
      }
    };

    const MO =
      view.MutationObserver ||
      (typeof MutationObserver !== "undefined" ? MutationObserver : null);

    let observer = null;
    if (MO && documentRoot.documentElement) {
      observer = new MO(onMutations);
      observer.observe(documentRoot.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["hidden", "open", "class", "style"],
      });
    }

    const onResize = () => {
      const v = viewport();
      for (const rec of ctx.recs) {
        if (!rec.placed) continue;
        const size = clampSurfaceSize(rec.state.width, rec.state.height, v.w, v.h);
        rec.state.width = size.width;
        rec.state.height = size.height;
        rec.el.style.width = `${size.width}px`;
        rec.el.style.height = `${size.height}px`;
        const p = clampSurface(rec.state.x, rec.state.y, size.width, size.height, v.w, v.h);
        rec.state.x = p.x;
        rec.state.y = p.y;
        applyTransform(rec);
      }
      persistSoon(ctx);
    };

    if (typeof view.addEventListener === "function") {
      view.addEventListener("resize", onResize);
    }

    return function teardown() {
      if (observer) observer.disconnect();
      if (typeof view.removeEventListener === "function") {
        view.removeEventListener("resize", onResize);
      }
      if (ctx.saveTimer) {
        clearTimeout(ctx.saveTimer);
        ctx.saveTimer = 0;
      }

      for (const rec of ctx.recs) {
        try {
          rec.cleanup.forEach((cleanup) => cleanup());
          rec.el.removeAttribute("data-panel-space");
          rec.el.removeAttribute("data-compact");
          rec.el.classList.remove("panel-space-appearing");
          if (rec.el.style) rec.el.style.cssText = rec.originalCssText;
        } catch {
          // One malformed panel never prevents teardown.
        }
      }

      styleEl.remove?.();
    };
  }

  const syncMode = () => {
    const narrow = isNarrow();

    if (narrow && active) {
      teardownActive?.();
      teardownActive = null;
      active = false;
    } else if (!narrow && !active) {
      teardownActive = activate();
      active = true;
    }
  };

  if (typeof view.addEventListener === "function") {
    view.addEventListener("resize", syncMode);
  }
  if (mq && typeof mq.addEventListener === "function") {
    mq.addEventListener("change", syncMode);
  }

  syncMode();

  return function destroy() {
    if (typeof view.removeEventListener === "function") {
      view.removeEventListener("resize", syncMode);
    }
    if (mq && typeof mq.removeEventListener === "function") {
      mq.removeEventListener("change", syncMode);
    }
    teardownActive?.();
    teardownActive = null;
    active = false;
  };
}
