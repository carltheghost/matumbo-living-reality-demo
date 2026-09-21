/**
 * Reality Lens Ω — AR tab adaptation layer.
 *
 * Enhances the single TabEngine dock (`src/render/tab-engine.js`, exposed as
 * `window.__tabEngine`) for the full AR ecosystem: AR glasses and camera
 * sessions ("Hand Lens" vision: hands tracked through the front camera, pinch
 * to grab, no physical keyboard), phones, and desktop.
 *
 * THIS MODULE NEVER BUILDS A SECOND DOCK. There is exactly one tab dock in
 * the app — the engine's `.tl-dock`. This adapter only:
 *   - detects the device mode (AR session > ?ar=1 > fullscreen+camera >
 *     narrow viewport > desktop) and drives `engine.setDeviceMode()`,
 *   - applies AR styling to the engine's dock (64px+ targets, slim edge rail
 *     that keeps the camera center view clear),
 *   - wires gaze-dwell, Hand Lens pinch gestures, and voice commands to the
 *     engine's existing chips and actions.
 *
 * Engine contract (built against, never redefined here):
 *   registerTab({ id, title, icon, open(), close(), node })
 *   activate(id) · closeAll() · toggle(id) · getActive()
 *   setDeviceMode('phone' | 'desktop' | 'ar')
 *   handleVoiceIntent(text)
 *   on('register' | 'unregister' | 'destroy', cb)
 *
 * PROJECT LAWS:
 * - "DON'T DISPLAY INFORMATION. MATERIALIZE IT." — every tab starts closed;
 *   panels materialize only on explicit interaction (tap, pinch, dwell, voice).
 * - Product name: "Reality Lens Ω".
 * - No changes to the 3D Block World visuals. No npm dependencies. ES modules.
 *
 * Graceful degradation: if the engine is absent this module never throws.
 * Pinch/voice report `false`, dwell stays disarmed, and mode detection still
 * runs so a late-appearing engine is picked up by refreshMode()/attach().
 */

export const PRODUCT_NAME = 'Reality Lens Ω';

/** Gaze-dwell duration before a hovered chip activates (ms). */
export const DWELL_MS = 1200;
/** Minimum touch target size in AR mode (px). */
export const MIN_TOUCH_PX = 64;
/** Viewports at or below this width are treated as phones (matches the
 *  canonical 700px law used by the engine and the mobile panel manager). */
export const PHONE_MAX_WIDTH = 700;

/** Hand Lens gesture events (CustomEvents on window). */
export const GESTURE_SELECT = 'handlens:pinch-select'; // detail: { x, y }
export const GESTURE_CLOSE = 'handlens:pinch-close';
export const GESTURE_FIST = 'handlens:fist';
/** Voice phrases arrive as a CustomEvent on window; detail: { text } | string. */
export const VOICE_EVENT = 'lens:voice-command';

/* ------------------------------------------------------------------ */
/* Device mode detection                                               */
/* ------------------------------------------------------------------ */

/**
 * Read the environment signals used for mode detection. Accepts an explicit
 * window-like object so tests can inject fakes; defaults to the real window.
 */
export function readBrowserEnv(w) {
  const scope = w ?? (typeof window !== 'undefined' ? window : undefined);
  const fallback = {
    arSessionActive: false,
    arFlag: false,
    fullscreen: false,
    cameraPresent: false,
    width: 1024,
  };
  if (!scope) return { ...fallback };
  try {
    let arFlag = false;
    try {
      arFlag = new URLSearchParams(scope.location?.search ?? '').get('ar') === '1';
    } catch { /* URLSearchParams unavailable — treat as no flag */ }
    const matches = (q) => {
      try { return !!scope.matchMedia?.(q)?.matches; } catch { return false; }
    };
    const nav = scope.navigator;
    const rawWidth = Number(scope.innerWidth);
    return {
      // Set `window.__arSessionActive = true` while a camera/AR session runs.
      arSessionActive: scope.__arSessionActive === true,
      arFlag,
      fullscreen: matches('(display-mode: fullscreen)'),
      cameraPresent: !!(nav?.mediaDevices?.getUserMedia || nav?.xr),
      width: Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : 1024,
    };
  } catch {
    return { ...fallback };
  }
}

/**
 * Decide the device mode. Priority: active AR session > `?ar=1` >
 * fullscreen display mode + camera > narrow viewport > desktop.
 */
export function detectMode(env) {
  const e = env ?? readBrowserEnv();
  if (e.arSessionActive) return 'ar';
  if (e.arFlag) return 'ar';
  if (e.fullscreen && e.cameraPresent) return 'ar';
  if ((e.width ?? 1024) <= PHONE_MAX_WIDTH) return 'phone';
  return 'desktop';
}

/* ------------------------------------------------------------------ */
/* Camera-center-clear geometry                                        */
/* ------------------------------------------------------------------ */

/**
 * The central safe zone of the camera view that tab UI must never cover.
 * Defined as the middle 60% × 70% of the viewport, rounded to whole pixels.
 */
export function getCenterRect(viewport) {
  const width = viewport?.width ?? 1024;
  const height = viewport?.height ?? 768;
  return {
    x: Math.round(width * 0.2),
    y: Math.round(height * 0.15),
    width: Math.round(width * 0.6),
    height: Math.round(height * 0.7),
  };
}

export function rectsOverlap(a, b) {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * True when none of `nodes` (elements with getBoundingClientRect, or raw
 * rects) overlaps the camera center rect. Used to enforce the invariant that
 * the AR edge rail never covers the center of the camera view.
 */
export function isCenterClear(nodes, viewport) {
  const center = getCenterRect(viewport);
  for (const node of nodes ?? []) {
    let r = null;
    try {
      r = typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : node;
    } catch { /* unreadable node — treat as clear */ }
    if (r && rectsOverlap(r, center)) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Styles — enhancements for the ENGINE's dock (no second dock).       */
/* ------------------------------------------------------------------ */

const AR_CSS = [
  /* Slim AR edge rail: vertically centered on the screen edge, never near the
     camera center. Builds on the engine's own .tl-dock--ar layout. */
  '.tl-dock.tl-dock--ar.rl-ar-dock{position:fixed;z-index:1040;top:50%;bottom:auto;left:auto;right:max(10px,env(safe-area-inset-right,0px));transform:translateY(-50%);flex-direction:column;gap:14px;padding:14px 10px;background:transparent;border:0;box-shadow:none;max-height:calc(100vh - 32px);overflow-y:auto}',
  '.tl-dock.tl-dock--ar.rl-ar-dock.rl-ar-left{right:auto;left:max(10px,env(safe-area-inset-left,0px))}',
  /* AR: LARGE world-edge-anchored glass chips — 64px+ targets, high contrast. */
  '.tl-dock.tl-dock--ar.rl-ar-dock .tl-chip{flex-direction:column;justify-content:center;gap:6px;min-width:64px;min-height:64px;width:auto;padding:12px 10px;border-radius:18px;border:1px solid rgba(255,255,255,.28);background:rgba(8,10,14,.62);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 8px 32px rgba(0,0,0,.45);font-size:19px;font-weight:700;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.9),0 0 1px rgba(0,0,0,.9)}',
  '.tl-dock.tl-dock--ar.rl-ar-dock .tl-chip .tl-chip-icon{font-size:28px}',
  '.tl-dock.tl-dock--ar.rl-ar-dock .tl-chip.tl-active{background:rgba(64,120,255,.55);border-color:rgba(255,255,255,.6)}',
  '.tl-dock.tl-dock--ar.rl-ar-dock .tl-chip-label{display:block;max-width:88px;font-size:12px;font-weight:600}',
  /* Reduced motion: instant show/hide everywhere under this root. */
  '.rl-reduced-motion .tl-chip{transition:none!important;animation:none!important}',
  '@media (prefers-reduced-motion:reduce){.tl-chip{transition:none!important;animation:none!important}}',
].join('\n');

/* ------------------------------------------------------------------ */
/* Adapter                                                             */
/* ------------------------------------------------------------------ */

/**
 * Create the AR tab adapter.
 *
 * deps: {
 *   window, document,          // injectable for tests; default to globals
 *   engine,                    // a TabEngine instance (optional; attach() later also works)
 *   getEngine(),               // default: () => window.__tabEngine
 *   side: 'left' | 'right',    // which screen edge the AR rail anchors to
 *   scheduler: { setTimeout, clearTimeout } // injectable clock for tests
 * }
 */
export function createTabARAdapter(deps = {}) {
  const win = deps.window ?? (typeof window !== 'undefined' ? window : undefined);
  const doc = deps.document ?? win?.document;
  const scheduler = deps.scheduler ?? {
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
  };
  const side = deps.side === 'right' ? 'right' : 'left';
  const getEngine = typeof deps.getEngine === 'function' ? deps.getEngine : () => win?.__tabEngine;

  let started = false;
  let engine = deps.engine ?? null;
  let engineAttached = false;
  let mode = 'desktop';
  let reducedMotion = false;
  let styleEl = null;
  const chips = new Map(); // tab id -> engine chip element
  const dwellTimers = new Map(); // tab id -> timer handle
  const dwellUnbind = new Map(); // tab id -> unbind fn
  const bound = []; // [target, type, fn] for destroy()

  const warn = (...args) => { try { console.warn('[tab-ar]', ...args); } catch { /* ignore */ } };
  const getEng = () => {
    if (engine) return engine;
    try { return getEngine() ?? null; } catch { return null; }
  };

  const listen = (target, type, fn, opts) => {
    if (!target || typeof target.addEventListener !== 'function') return;
    target.addEventListener(type, fn, opts);
    bound.push([target, type, fn]);
  };

  /* ---------------- engine attachment ---------------- */

  /** Track one engine chip for dwell/pinch hit-testing. */
  function trackChip(id, chipEl) {
    if (!chipEl || chips.get(String(id)) === chipEl) return;
    untrackChip(id);
    const key = String(id);
    chips.set(key, chipEl);
    armDwellForChip(key, chipEl);
  }

  function untrackChip(id) {
    const key = String(id);
    cancelDwell(key);
    const unbind = dwellUnbind.get(key);
    if (unbind) {
      try { unbind(); } catch { /* ignore */ }
      dwellUnbind.delete(key);
    }
    chips.delete(key);
  }

  function sweepEngineChips(eng) {
    if (!eng || !eng.tabs) return;
    for (const [id, tab] of eng.tabs) {
      if (tab && tab.chip) trackChip(id, tab.chip);
    }
  }

  /**
   * Attach to a TabEngine (idempotent). Subscribes to register/unregister so
   * chips created later are tracked too. Safe to call when the engine
   * appears after start().
   */
  function attach(next) {
    const eng = next ?? getEng();
    if (!eng || eng === engine && engineAttached) return adapter;
    if (engine && engineAttached && eng !== engine) detachEngine();
    engine = eng;
    if (!engine) return adapter;
    sweepEngineChips(engine);
    try {
      engine.on('register', ({ id, tab }) => { if (tab && tab.chip) trackChip(id, tab.chip); });
      engine.on('unregister', ({ id }) => untrackChip(id));
      engine.on('destroy', () => detachEngine());
    } catch { /* engine without events — sweep is enough */ }
    engineAttached = true;
    return adapter;
  }

  function detachEngine() {
    for (const key of [...chips.keys()]) untrackChip(key);
    engineAttached = false;
  }

  function ensureAttached() {
    if (!engineAttached) attach(getEng());
    return engineAttached;
  }

  /* ---------------- styles ---------------- */

  function injectStyles() {
    if (!doc || styleEl) return;
    const el = doc.createElement('style');
    el.id = 'tab-ar-styles';
    el.setAttribute('data-product', PRODUCT_NAME);
    el.textContent = AR_CSS;
    (doc.head ?? doc.documentElement)?.appendChild?.(el);
    styleEl = el;
  }

  /* ---------------- tab actions (via the engine) ---------------- */

  function activateTab(id) {
    const key = String(id);
    const eng = getEng();
    if (eng && typeof eng.activate === 'function') {
      try { eng.activate(key); return true; }
      catch (err) { warn('activate failed', err); return false; }
    }
    return false;
  }

  function closeAllTabs() {
    const eng = getEng();
    if (eng && typeof eng.closeAll === 'function') {
      try { eng.closeAll(); return true; }
      catch (err) { warn('closeAll failed', err); return false; }
    }
    return false;
  }

  /* ---------------- gaze dwell ---------------- */

  function armDwellForChip(id, chipEl) {
    const key = String(id);
    if (dwellUnbind.has(key) || !chipEl || typeof chipEl.addEventListener !== 'function') return;
    const onEnter = () => armDwell(key);
    const onLeave = () => cancelDwell(key);
    chipEl.addEventListener('pointerenter', onEnter);
    chipEl.addEventListener('pointerleave', onLeave);
    dwellUnbind.set(key, () => {
      try {
        chipEl.removeEventListener('pointerenter', onEnter);
        chipEl.removeEventListener('pointerleave', onLeave);
      } catch { /* ignore */ }
    });
  }

  function armDwell(id) {
    cancelDwell(id);
    if (mode === 'desktop') return; // dwell disabled on desktop
    const key = String(id);
    const timer = scheduler.setTimeout(() => {
      dwellTimers.delete(key);
      activateTab(key);
    }, DWELL_MS);
    dwellTimers.set(key, timer);
  }

  function cancelDwell(id) {
    const key = String(id);
    const t = dwellTimers.get(key);
    if (t !== undefined) {
      try { scheduler.clearTimeout(t); } catch { /* ignore */ }
      dwellTimers.delete(key);
    }
  }

  function cancelAllDwell() {
    for (const key of [...dwellTimers.keys()]) cancelDwell(key);
  }

  /* ---------------- hand gestures ---------------- */

  function hitTestChip(x, y) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    try {
      const el = doc?.elementFromPoint?.(x, y) ?? null;
      const chipEl = el?.closest?.('.tl-chip') ?? null;
      if (chipEl) {
        for (const [id, tracked] of chips) {
          if (tracked === chipEl) return id;
        }
        // Untracked engine chip (registered before attach sweep missed it):
        // fall back to the engine's chip id convention.
        const raw = chipEl.getAttribute?.('id') ?? chipEl.id ?? '';
        const m = /^tl-chip-(.+)$/.exec(String(raw));
        if (m) return m[1];
      }
    } catch { /* fall through to rect walk */ }
    for (const [id, chip] of chips) {
      let r = null;
      try { r = chip.getBoundingClientRect(); } catch { /* ignore */ }
      if (r && x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) return id;
    }
    return null;
  }

  function onPinchSelect(e) {
    const d = e?.detail ?? {};
    const id = hitTestChip(Number(d.x), Number(d.y));
    if (id !== null) activateTab(id);
  }

  function onPinchClose() {
    closeAllTabs();
  }

  /* ---------------- voice ---------------- */

  function routeVoice(text) {
    const phrase = String(text ?? '').trim();
    if (!phrase) return false;
    const eng = getEng();
    if (!eng || typeof eng.handleVoiceIntent !== 'function') return false;
    try { eng.handleVoiceIntent(phrase); return true; }
    catch { return false; }
  }

  function onVoiceEvent(e) {
    const d = e?.detail;
    routeVoice(typeof d === 'string' ? d : d?.text);
  }

  /* ---------------- center-clear invariant ---------------- */

  function viewport() {
    const w = Number(win?.innerWidth);
    const h = Number(win?.innerHeight);
    return {
      width: Number.isFinite(w) && w > 0 ? w : 1024,
      height: Number.isFinite(h) && h > 0 ? h : 768,
    };
  }

  function checkCenterClear() {
    return isCenterClear([...chips.values()], viewport());
  }

  function verifyCenterClear() {
    if (!checkCenterClear()) {
      warn('AR layout violation: a tab chip overlaps the camera center view.');
    }
  }

  /* ---------------- device modes ---------------- */

  function applyReducedMotion() {
    let reduce = false;
    try { reduce = !!win?.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; } catch { /* ignore */ }
    reducedMotion = reduce;
    try { doc?.documentElement?.classList?.toggle('rl-reduced-motion', reduce); } catch { /* ignore */ }
  }

  function applyMode(next) {
    ensureAttached();
    mode = next;
    try {
      const root = doc?.documentElement;
      if (root && root.dataset) root.dataset.deviceMode = next;
      doc?.body?.classList?.toggle('rl-ar-mode', next === 'ar');
    } catch { /* ignore */ }
    const eng = getEng();
    const dock = eng?.dock ?? null;
    if (dock && dock.classList) {
      try {
        dock.classList.toggle('rl-ar-dock', next === 'ar');
        dock.classList.toggle('rl-ar-left', next === 'ar' && side === 'left');
      } catch { /* ignore */ }
    }
    applyReducedMotion();
    try { eng?.setDeviceMode?.(next); } catch { /* ignore */ }
    if (next === 'ar') verifyCenterClear();
  }

  function refreshMode() {
    const next = detectMode(readBrowserEnv(win));
    if (next !== mode) {
      applyMode(next);
    } else {
      // Same mode, but the engine may have appeared since the last apply.
      ensureAttached();
      try { getEng()?.setDeviceMode?.(mode); } catch { /* ignore */ }
    }
  }

  /* ---------------- lifecycle ---------------- */

  function start() {
    if (started || !doc) return adapter;
    started = true;
    injectStyles();
    attach(getEng());
    applyReducedMotion();

    const onResize = () => refreshMode();
    listen(win, 'resize', onResize);
    listen(win, 'orientationchange', onResize);

    for (const q of ['(display-mode: fullscreen)', `(max-width: ${PHONE_MAX_WIDTH}px)`, '(prefers-reduced-motion: reduce)']) {
      let mql = null;
      try { mql = win?.matchMedia?.(q) ?? null; } catch { /* ignore */ }
      if (!mql || typeof mql.addEventListener !== 'function') continue;
      listen(mql, 'change', () => {
        if (q === '(prefers-reduced-motion: reduce)') applyReducedMotion();
        else refreshMode();
      });
    }

    listen(win, GESTURE_SELECT, onPinchSelect);
    listen(win, GESTURE_CLOSE, onPinchClose);
    listen(win, GESTURE_FIST, onPinchClose);
    listen(win, VOICE_EVENT, onVoiceEvent);

    applyMode(detectMode(readBrowserEnv(win)));
    return adapter;
  }

  function destroy() {
    for (const [t, type, fn] of bound) {
      try { t.removeEventListener(type, fn); } catch { /* ignore */ }
    }
    bound.length = 0;
    cancelAllDwell();
    for (const key of [...dwellUnbind.keys()]) {
      try { dwellUnbind.get(key)(); } catch { /* ignore */ }
    }
    dwellUnbind.clear();
    chips.clear();
    engineAttached = false;
    try { styleEl?.parentNode?.removeChild(styleEl); } catch { /* ignore */ }
    styleEl = null;
    started = false;
    return adapter;
  }

  const adapter = {
    start,
    destroy,
    attach,
    refreshMode,
    applyMode,
    routeVoice,
    checkCenterClear,
    hitTestChip,
    getMode: () => mode,
    isAr: () => mode === 'ar',
    /** The engine's dock (the one and only tab dock), or null. */
    getDock: () => getEng()?.dock ?? null,
    /** Tracked engine chips: tab id -> chip element. */
    getChips: () => new Map(chips),
    get reducedMotion() { return reducedMotion; },
  };
  return adapter;
}

/** Convenience: create + start in one call. */
export function initTabAR(deps = {}) {
  return createTabARAdapter(deps).start();
}

/* ------------------------------------------------------------------ */
/* Auto-boot in real browsers only (never under Node / test fakes).    */
/* ------------------------------------------------------------------ */

const __isNode = typeof process !== 'undefined' && !!process.versions?.node;
if (!__isNode && typeof window !== 'undefined' && typeof document !== 'undefined') {
  try {
    if (!window.__tabARAdapter) {
      const boot = () => {
        try {
          if (!window.__tabARAdapter) window.__tabARAdapter = initTabAR();
        } catch { /* never break page boot */ }
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot, { once: true });
      } else {
        boot();
      }
    }
  } catch { /* never break page boot */ }
}
