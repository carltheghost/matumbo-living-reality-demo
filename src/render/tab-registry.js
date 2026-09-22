/**
 * Reality Lens Ω — tab dock wiring (canonical integration).
 * =============================================================================
 * Builds the ONE coherent tab dock for the demo: a single TabEngine owns every
 * floating panel, closed by default, materialized only on interaction. The AR
 * adapter (tab-ar-tabs.js) enhances that same dock for phone/desktop/AR —
 * it never builds a second dock.
 *
 * PRODUCT LAWS (enforced):
 *  - "DON'T DISPLAY INFORMATION. MATERIALIZE IT." — every tab starts CLOSED.
 *    Nothing here auto-opens a panel. Panels already visible when the dock
 *    boots are adopted (their state is synced into the engine) — never hidden.
 *  - Existing panels are registered IN PLACE (`adoptNode: false`): the engine
 *    never moves them, never renames their ids, never fights their own
 *    show/hide logic. The dock chip, keyboard (1–9 / Escape), voice intents,
 *    Hand Lens pinch gestures, and gaze-dwell all route through the engine.
 *  - The mobile panel manager keeps running: it owns the ≤700px
 *    single-visible invariant and the hint-bar behavior for panels opened
 *    through their native buttons. This dock is the coherent control surface
 *    on top — it does not replace the manager until the full panel-by-panel
 *    migration lands.
 *  - Product name is "Reality Lens Ω". No npm dependencies. ES modules only.
 *
 * BOOT SAFETY: this module never throws out of initTabDock. main.js loads it
 * through a guarded dynamic import, so a tab-dock failure degrades to "no
 * dock" and can never red-banner the boot.
 */

import { TabEngine } from './tab-engine.js?v=20260922-rotating-cubes3';
import { initTabAR } from './tab-ar-tabs.js';

const NARROW_QUERY = '(max-width:700px)';

// Panels that never become dock tabs: the portal return affordance is
// persistent chrome, and the cube-dive inside-HUD is a compact bottom-docked
// bar that must stay available while the camera is inside a cube.
const EXCLUDED_IDS = new Set(['portal-return-console', 'cube-dive-hud']);

const TITLES = {
  'feature-shell': 'Mission Control',
  'gesture-input-panel': 'Gesture Input',
  'media-preview': 'Media Preview',
  'readout': 'Readout',
  'asset-launch': 'Asset Launch',
};

const ICONS = {
  'feature-shell': '◈',
  'gesture-input-panel': '✋',
  'media-preview': '▣',
  'readout': '◉',
  'asset-launch': '⬢',
};

function humanize(id) {
  const words = String(id || 'panel')
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return 'Panel';
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Collect floating panels from the live DOM. Mirrors the collectors in
 * mobile-panel-manager.js so the dock and the manager govern the same set.
 */
function collectPanels(documentRoot) {
  const panels = [];
  const asides = documentRoot.querySelectorAll
    ? Array.from(documentRoot.querySelectorAll('aside'))
    : [];
  for (const el of asides) {
    if (!el || EXCLUDED_IDS.has(el.id)) continue;
    // The TabEngine's own layer/dock are divs, never asides — no self-hit.
    // asset-launch is class-driven (portal-destination-visible /
    // asset-route-hidden / cube-first-hidden + body mode classes), NOT the
    // `hidden` attribute — it gets its own visibility kind below.
    panels.push({
      id: el.id || '(aside)',
      kind: el.id === 'feature-shell'
        ? 'class-open'
        : el.id === 'asset-launch'
          ? 'portal-visible'
          : 'hidden',
      el,
    });
  }
  const gesture = documentRoot.getElementById
    ? documentRoot.getElementById('gesture-input-panel')
    : null;
  if (gesture && gesture.tagName !== 'ASIDE' && !panels.some((p) => p.el === gesture)) {
    panels.push({ id: 'gesture-input-panel', kind: 'hidden', el: gesture });
  }
  const media = documentRoot.getElementById ? documentRoot.getElementById('media-preview') : null;
  if (media && !panels.some((p) => p.el === media)) {
    panels.push({ id: 'media-preview', kind: 'details', el: media });
  }
  const readout = documentRoot.getElementById ? documentRoot.getElementById('readout') : null;
  if (readout && !EXCLUDED_IDS.has(readout.id) && !panels.some((p) => p.el === readout)) {
    panels.push({ id: readout.id || 'readout', kind: 'class-visible', el: readout });
  }
  return panels;
}

function classSaysVisible(el, names) {
  const classList = el && el.classList;
  if (!classList || typeof classList.contains !== 'function') return false;
  return names.some((name) => classList.contains(name));
}

function computedHidden(el, windowRoot) {
  if (typeof windowRoot?.getComputedStyle !== 'function') return null;
  try {
    const style = windowRoot.getComputedStyle(el);
    if (!style) return null;
    if (style.display === 'none') return true;
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return true;
    return false;
  } catch {
    return null;
  }
}

/** Read a panel's CURRENT native visibility (mirrors mobile-panel-manager). */
function isPanelVisible(panel, windowRoot) {
  if (!panel || !panel.el) return false;
  const el = panel.el;
  if (panel.kind === 'details') return el.open === true;
  if (panel.kind === 'class-open') return classSaysVisible(el, ['open']);
  if (panel.kind === 'class-visible') return classSaysVisible(el, ['visible']);
  if (el.hidden === true) return false;
  const hiddenByCss = computedHidden(el, windowRoot);
  if (hiddenByCss !== null) return !hiddenByCss;
  return true;
}

function setAriaHidden(el, hidden) {
  try {
    if (el && typeof el.setAttribute === 'function') {
      el.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    }
  } catch { /* non-fatal */ }
}

/**
 * Build the engine open()/close() pair for a panel, reusing that panel's own
 * visibility mechanism so existing show/hide logic keeps working unchanged.
 * Every pair VERIFIES the result and falls back to a dock-owned mechanism
 * when the panel's native one cannot reveal/hide it — a chip must never lie
 * about its panel's state.
 */
function visibilityHandlers(panel, documentRoot, windowRoot) {
  const el = panel.el;
  if (panel.kind === 'details') {
    return {
      open() { try { el.open = true; } catch { /* ignore */ } setAriaHidden(el, false); },
      close() { try { el.open = false; } catch { /* ignore */ } setAriaHidden(el, true); },
    };
  }
  if (panel.kind === 'class-open') {
    return {
      open() {
        try { el.classList.add('open'); } catch { /* ignore */ }
        setAriaHidden(el, false);
      },
      close() {
        // Route Mission Control's shell through its own close control so the
        // feature navigator's internal open state stays in sync (same rule
        // the mobile panel manager uses); other class-driven panels hide
        // by class.
        try {
          if (panel.id === 'feature-shell') {
            const closeBtn = documentRoot && documentRoot.getElementById
              ? documentRoot.getElementById('feature-close')
              : null;
            if (closeBtn && typeof closeBtn.click === 'function') {
              closeBtn.click();
              // Verify: the native close control can be unreachable (the 3D
              // canvas intercepts the hit test) or its handler may leave the
              // shell up. Fall back to hiding the panel programmatically.
              if (!isPanelVisible(panel, windowRoot)) {
                setAriaHidden(el, true);
                return;
              }
            }
          }
          el.classList.remove('open');
        } catch { /* ignore */ }
        setAriaHidden(el, true);
      },
    };
  }
  if (panel.kind === 'class-visible') {
    return {
      open() {
        try { el.classList.add('visible'); } catch { /* ignore */ }
        setAriaHidden(el, false);
      },
      close() {
        try { el.classList.remove('visible'); } catch { /* ignore */ }
        setAriaHidden(el, true);
      },
    };
  }
  if (panel.kind === 'portal-visible') {
    // The Asset Launch panel (aside#asset-launch) is class-driven: its
    // visibility comes from `portal-destination-visible` (shown),
    // `asset-route-hidden` / `cube-first-hidden` (hidden), and body mode
    // classes — never the `hidden` attribute. Mirror the native mechanism
    // from src/main.js (portal surface opener + route toggles), then verify
    // with computed style and fall back to dock-owned state when the page's
    // mode classes would otherwise keep it hidden/shown.
    const HIDE_CLASSES = ['asset-route-hidden', 'cube-first-hidden'];
    const SHOW_CLASS = 'portal-destination-visible';
    return {
      open() {
        try {
          el.classList.remove(...HIDE_CLASSES);
          el.classList.add(SHOW_CLASS);
          el.hidden = false;
        } catch { /* ignore */ }
        setAriaHidden(el, false);
        try {
          if (computedHidden(el, windowRoot) === true && el.style) {
            el.style.display = 'block';
          }
        } catch { /* ignore */ }
      },
      close() {
        try {
          el.classList.remove(SHOW_CLASS);
          // Mirrors navigating off the asset-token route in src/main.js.
          el.classList.add('asset-route-hidden');
          if (el.style) el.style.display = '';
        } catch { /* ignore */ }
        setAriaHidden(el, true);
        try {
          // Outside the cube presentation modes the hiding classes above are
          // inert; the `hidden` attribute is then the dock-owned fallback.
          // The panel's native code only toggles classes, never `hidden`,
          // so this fallback state belongs to the dock (cleared on open).
          if (computedHidden(el, windowRoot) === false) el.hidden = true;
        } catch { /* ignore */ }
      },
    };
  }
  return {
    open() { try { el.hidden = false; } catch { /* ignore */ } setAriaHidden(el, false); },
    close() { try { el.hidden = true; } catch { /* ignore */ } setAriaHidden(el, true); },
  };
}

/**
 * Build the single tab dock. Safe to call once per page: a second call
 * returns the existing dock instead of building a duplicate.
 */
export function initTabDock({
  documentRoot = (typeof document !== 'undefined' ? document : undefined),
  windowRoot = (typeof window !== 'undefined' ? window : undefined),
} = {}) {
  try {
    if (windowRoot && windowRoot.__TUMBO_TAB_DOCK__) {
      return windowRoot.__TUMBO_TAB_DOCK__;
    }
    const body = documentRoot ? documentRoot.body : null;
    if (!body || typeof documentRoot.createElement !== 'function') return null;

    // One engine, one dock. autoDetect is off: the AR adapter owns device
    // mode detection (AR session > ?ar=1 > fullscreen+camera > ≤700px phone).
    const engine = new TabEngine({ root: body, document: documentRoot, autoDetect: false });
    const registered = new Map(); // panel id -> node

    function registerPanel(panel) {
      const id = String(panel.id || '');
      if (!id || id === '(aside)' || registered.has(id) || engine.getTab(id)) return false;
      const node = panel.el;
      if (!node) return false;
      const { open, close } = visibilityHandlers(panel, documentRoot, windowRoot);
      // Persistent chrome that is already natively visible when the panel is
      // registered (token ticker, block launcher, readout… at boot) is
      // adopted AND pinned: the dock tracks its state, but the LRU cap and
      // close-all may never evict or hide it — the dock must not hide what
      // it did not open. Only tabs the user materializes through the dock
      // are subject to eviction.
      let visibleNow = false;
      try { visibleNow = isPanelVisible(panel, windowRoot); } catch { visibleNow = false; }
      try {
        engine.registerTab({
          id,
          title: TITLES[id] || node.getAttribute?.('aria-label') || humanize(id),
          icon: ICONS[id] || '◈',
          open,
          close,
          node,
          adoptNode: false, // in place: never move, never rename, never restyle
          pinned: visibleNow,
        });
      } catch {
        return false; // duplicate or invalid — skip, never break the scan
      }
      registered.set(id, node);
      // Adopt panels that are already natively visible (state sync, not an
      // auto-open: the panel was opened by existing boot/app logic).
      try {
        if (visibleNow) engine.activate(id);
      } catch { /* activation is best-effort */ }
      return true;
    }

    function rescan() {
      try {
        for (const panel of collectPanels(documentRoot)) registerPanel(panel);
        // Drop tabs whose nodes left the DOM.
        for (const [id, node] of [...registered]) {
          let connected = true;
          try {
            connected = documentRoot.contains
              ? documentRoot.contains(node)
              : node.isConnected !== false;
          } catch { connected = true; }
          if (!connected) {
            try { engine.unregisterTab(id); } catch { /* ignore */ }
            registered.delete(id);
          }
        }
      } catch { /* scan never throws */ }
    }

    rescan();

    // Late-appearing panels (feature consoles mounted after boot) join the
    // dock automatically.
    let observer = null;
    try {
      const MO = windowRoot?.MutationObserver
        || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
      if (MO && documentRoot.documentElement) {
        observer = new MO(() => rescan());
        observer.observe(documentRoot.documentElement, { childList: true, subtree: true });
      }
    } catch { /* observer is a convenience */ }
    // One deferred rescan covers panels mounted in the gap between the
    // dynamic import resolving and the observer attaching.
    try {
      const timer = (windowRoot?.setTimeout ?? setTimeout)(() => rescan(), 2000);
      if (timer && typeof timer.unref === 'function') { try { timer.unref(); } catch { /* ignore */ } }
    } catch { /* ignore */ }

    // AR adapter: enhances THIS dock for phone/desktop/AR. Never a 2nd dock.
    let ar = null;
    try {
      ar = windowRoot?.__tabARAdapter
        || initTabAR({
            window: windowRoot,
            document: documentRoot,
            getEngine: () => engine,
          });
      if (windowRoot) windowRoot.__tabARAdapter = ar;
      ar.attach(engine);
      ar.refreshMode();
    } catch {
      ar = null; // dock works without AR enhancements
    }

    const dock = {
      engine,
      ar,
      rescan,
      getTabIds: () => [...registered.keys()],
      destroy() {
        try { observer?.disconnect?.(); } catch { /* ignore */ }
        try { ar?.destroy?.(); } catch { /* ignore */ }
        try { engine.destroy(); } catch { /* ignore */ }
        registered.clear();
        if (windowRoot && windowRoot.__TUMBO_TAB_DOCK__ === dock) {
          try { windowRoot.__tabARAdapter = null; } catch { /* ignore */ }
          windowRoot.__TUMBO_TAB_DOCK__ = null;
        }
      },
    };
    if (windowRoot) windowRoot.__TUMBO_TAB_DOCK__ = dock;
    return dock;
  } catch {
    return null; // the dock must never break the boot
  }
}

export default initTabDock;
