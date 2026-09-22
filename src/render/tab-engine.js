/**
 * Reality Lens Ω — Tab Engine Core
 * =============================================================================
 * Owns every floating panel ("tab") in the Block World demo: one registry, one
 * dock, one set of rules. Replaces the ad-hoc show/hide chaos (camera+audio
 * preview, hint bar, Contract Atelier, Person Studio, Bot Plaza, proposals…).
 *
 * PRODUCT LAWS (enforced here, not just documented):
 *  - "DON'T DISPLAY INFORMATION. MATERIALIZE IT." — every tab starts CLOSED.
 *    A tab materializes only on user interaction (tap, key, voice, gesture).
 *    Nothing in this file ever auto-opens a tab. Not on load. Not on resize.
 *  - Product name is "Reality Lens Ω".
 *  - This file never touches the 3D Block World visuals. No npm dependencies.
 *    ES modules only.
 *
 * MIGRATION NOTES — mobile-panel-manager.js → TabEngine
 * -----------------------------------------------------------------------------
 * mobile-panel-manager.js (viewports ≤700px: only one floating panel visible at
 * a time, bottom-docked collapsible chip, 44px touch targets) is SUPERSEDED by
 * TabEngine but is NOT deleted or modified by this file. Migrate panel by panel:
 *
 *   1. Replace `manager.registerPanel(id, { show, hide })` with:
 *        tabEngine.registerTab({ id, title, icon, open: show, close: hide, node })
 *      Pass the panel's existing root element as `node`. The engine appends it to
 *      its own panel layer and toggles visibility via the `tl-open` class, while
 *      your existing `open`/`close` callbacks keep running on activate/deactivate
 *      — existing show/hide logic keeps working unchanged. For panels whose DOM
 *      position or id must not move (Mission Control's feature-shell and the
 *      other live-DOM asides), pass `adoptNode: false`: the node stays exactly
 *      where it is and keeps its id/role, and the engine only tracks state,
 *      renders the dock chip, and calls open()/close().
 *   2. Replace `manager.showPanel(id)` / `manager.hidePanel(id)` /
 *      `manager.hideAll()` with `tabEngine.activate(id)` /
 *      `tabEngine.deactivate(id)` / `tabEngine.closeAll()`.
 *   3. The ≤700px single-visible invariant is preserved: TabEngine's `phone` mode
 *      (auto-detected via `matchMedia('(max-width: 700px)')` unless you pass
 *      `{ autoDetect: false }`) enforces exactly one materialized tab.
 *   4. Drive viewport changes with `tabEngine.setDeviceMode('phone'|'desktop'|'ar')`.
 *      Auto-detection follows `(max-width: 700px)` by default; if the app already
 *      owns a resize observer, construct with `{ autoDetect: false }` and drive it
 *      manually.
 *   5. The old bottom-docked collapsible chip becomes the TabEngine dock
 *      (`.tl-dock--phone`). 44px minimum touch targets are preserved on every chip.
 *   6. Keyboard (1–9 / Escape) and focus management are now owned by TabEngine —
 *      remove duplicate key handlers from the old manager to avoid double-handling.
 *   7. Delete `src/render/mobile-panel-manager.js` only after every panel is
 *      registered with TabEngine and no imports of the old module remain.
 *
 * MODES
 *  - 'phone'   → bottom glass dock, one tab materialized at a time.
 *  - 'desktop' → right glass rail dock, up to 3 user tabs (LRU eviction).
 *                Tabs registered with `pinned: true` (persistent HUD chrome
 *                adopted at boot) are exempt from eviction and from the cap.
 *  - 'ar'      → compact edge rail, one tab at a time. The AR lane owns AR
 *                visuals; the engine only switches layout + policy here.
 *
 * PUBLIC API
 *  new TabEngine({ root, document?, mode?, maxPinnedDesktop?, autoDetect? })
 *  registerTab({ id, title, icon, open(), close(), node, adoptNode?, pinned? }) → tab record
 *    adoptNode (default true): move the node into the engine's panel layer and
 *    let the engine own its visibility classes/ids. Pass `adoptNode: false`
 *    to register an existing floating panel IN PLACE: the engine then only
 *    tracks state, renders the dock chip, and calls open()/close() — the
 *    panel's own show/hide logic keeps owning its DOM position and styles.
 *    Safe for panels (e.g. Mission Control's feature-shell) whose layout or
 *    id-based lookups must not be disturbed.
 *    pinned (default false): eviction-exempt persistent chrome. A pinned tab
 *    is never evicted by the LRU cap and never counts toward it. The tab
 *    registry pins panels that are already natively visible when the dock
 *    boots (token ticker, block launcher, readout…): the dock adopts their
 *    state but must never hide what it did not open.
 *  unregisterTab(id) → boolean
 *  activate(id) → boolean        (false when id is unknown)
 *  deactivate(id) → boolean
 *  toggle(id) → boolean
 *  closeAll() → number           (how many tabs were closed)
 *  getActive() → tab records[]   (oldest activation first)
 *  getActiveIds() → string[]
 *  getTab(id) → record | null
 *  isActive(id) → boolean
 *  setDeviceMode('phone'|'desktop'|'ar') → mode   (throws RangeError otherwise)
 *  handleVoiceIntent(text) → { ok, action, id? | closed? | reason?, query? }
 *  on(event, cb) / off(event, cb)
 *  destroy()
 *
 * Events: 'init' | 'register' | 'unregister' | 'activate' | 'deactivate' |
 *         'closeAll' | 'modechange' | 'error' | 'destroy'
 */

const TAB_ENGINE_CSS = `
/* Reality Lens Ω — Tab Engine dock + panel styles.
   Animation uses transform/opacity ONLY (no layout thrash). */
.tl-dock {
  position: fixed;
  z-index: 3200;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  background: rgba(14, 16, 24, 0.55);
  -webkit-backdrop-filter: blur(18px) saturate(1.5);
  backdrop-filter: blur(18px) saturate(1.5);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 20px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.08);
  max-width: calc(100vw - 24px);
  box-sizing: border-box;
}
/* phone/narrow: bottom glass dock */
.tl-dock--phone {
  left: 50%;
  bottom: calc(12px + env(safe-area-inset-bottom, 0px));
  transform: translateX(-50%);
  flex-direction: row;
  justify-content: center;
  flex-wrap: wrap;
}
/* desktop: right glass rail.
   The left side is intentionally reserved for Mission Control and other
   persistent navigation chrome. Minimized tabs live in this right-hand lane
   so they cannot disappear underneath the left control panel. */
.tl-dock--desktop {
  right: 12px;
  top: 84px;
  bottom: 84px;
  flex-direction: column;
  align-items: stretch;
  max-height: none;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: thin;
}
/* ar: compact right-edge rail (lane 2 owns AR visuals; layout switch only) */
.tl-dock--ar {
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  flex-direction: column;
  padding: 6px;
  border-radius: 16px;
}
.tl-dock--ar .tl-chip-label { display: none; }
.tl-dock--ar .tl-chip { border-radius: 50%; padding: 0; }

.tl-chip { position: relative;
  --tl-cube-size: 42px;
  --tl-cube-depth: 21px;
  appearance: none;
  -webkit-appearance: none;
  border: 0;
  background: transparent;
  color: #dff7ff;
  width: 76px;
  min-width: 76px;
  min-height: 76px;
  padding: 4px;
  border-radius: 14px;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 5px;
  font: 700 8px/1.15 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  letter-spacing: .12em;
  text-transform: uppercase;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  perspective: 520px;
  transition: transform 0.22s ease;
}
.tl-dock--desktop .tl-chip { width: 76px; min-width: 76px; min-height: 84px; }
.tl-chip:hover { transform: translateY(-2px) scale(1.03); }
.tl-chip:active { transform: scale(0.96); }
.tl-chip:focus-visible { outline: 2px solid #7ae6ff; outline-offset: 2px; }
.tl-chip.tl-active .tl-chip-cube {
  filter: brightness(1.12);
  box-shadow: 0 0 24px rgba(110,220,255,.28);
}
.tl-chip-cube {
  position: relative;
  width: var(--tl-cube-size);
  height: var(--tl-cube-size);
  flex: 0 0 auto;
  transform-style: preserve-3d;
  transform: rotateX(-18deg) rotateY(28deg);
  animation: tl-minimized-cube-spin 5.5s linear infinite;
  will-change: transform;
}
.tl-cube-face {
  position: absolute;
  inset: 0;
  width: var(--tl-cube-size);
  height: var(--tl-cube-size);
  border: 1px solid rgba(154,239,255,.52);
  border-radius: 5px;
  background:
    linear-gradient(145deg, rgba(111,225,255,.34), rgba(8,26,36,.92)),
    linear-gradient(45deg, rgba(255,255,255,.08), transparent 60%);
  box-shadow:
    inset 0 0 14px rgba(103,224,255,.12),
    0 0 12px rgba(103,224,255,.08);
  backface-visibility: hidden;
}
.tl-cube-face--front { transform: translateZ(var(--tl-cube-depth)); }
.tl-cube-face--back { transform: rotateY(180deg) translateZ(var(--tl-cube-depth)); }
.tl-cube-face--right { transform: rotateY(90deg) translateZ(var(--tl-cube-depth)); }
.tl-cube-face--left { transform: rotateY(-90deg) translateZ(var(--tl-cube-depth)); }
.tl-cube-face--top { transform: rotateX(90deg) translateZ(var(--tl-cube-depth)); }
.tl-cube-face--bottom { transform: rotateX(-90deg) translateZ(var(--tl-cube-depth)); }
.tl-cube-mark { position:absolute; inset:4px; display:grid; place-items:center; align-content:center; gap:2px; color:#e8fdff; font-size:13px; line-height:1; text-align:center; text-shadow:0 0 12px rgba(117,232,255,.82); }
.tl-cube-code { display:block; color:rgba(213,247,255,.82); font:700 5px/1.05 ui-monospace,SFMono-Regular,Consolas,monospace; letter-spacing:.08em; text-transform:uppercase; white-space:nowrap; transform:scale(.9); }
.tl-cube-mark::after { content:""; position:absolute; inset:5px; border:1px solid rgba(151,238,255,.22); border-radius:2px; box-shadow:inset 0 0 9px rgba(113,220,255,.08); }
.tl-cube-face--back .tl-cube-mark,.tl-cube-face--left .tl-cube-mark,.tl-cube-face--bottom .tl-cube-mark { color:#b7f4ff; }
.tl-cube-face--right .tl-cube-mark { color:#ffd37e; }
.tl-cube-face--top .tl-cube-mark { color:#b5ffcf; }
.tl-chip-close{position:absolute;right:4px;top:4px;width:20px;height:20px;display:grid;place-items:center;border:1px solid rgba(255,123,143,.36);border-radius:50%;background:rgba(7,17,25,.9);color:#ffd6de;font:700 13px/1 system-ui;z-index:9;cursor:pointer}.tl-chip-close:hover{border-color:rgba(255,123,143,.78);background:rgba(74,19,31,.92)}
.tl-chip-label {
  width: 72px;
  max-width: 72px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: center;
  color: #c8f7ff;
  letter-spacing: .1em;
  text-shadow: 0 1px 10px rgba(0,0,0,.75);
}
@keyframes tl-minimized-cube-spin {
  0% { transform: rotateX(-18deg) rotateY(0deg); }
  50% { transform: rotateX(-18deg) rotateY(180deg); }
  100% { transform: rotateX(-18deg) rotateY(360deg); }
}

/* Panel layer: pointer-events off so closed panels never intercept input. */
.tl-layer {
  position: fixed;
  z-index: 3050;
  display: flex;
  gap: 12px;
  pointer-events: none;
  box-sizing: border-box;
}
.tl-layer--phone {
  left: 12px;
  right: 12px;
  bottom: calc(88px + env(safe-area-inset-bottom, 0px));
  justify-content: center;
}
.tl-layer--desktop {
  right: 154px;
  left: auto;
  top: 50%;
  transform: translateY(-50%);
  flex-direction: column;
  align-items: flex-end;
  max-height: calc(100vh - 96px);
  overflow-y: auto;
  padding: 4px;
}
.tl-layer--ar {
  right: 64px;
  bottom: 24px;
  flex-direction: column;
  align-items: flex-end;
}

/* Panels materialize with a spring (overshoot cubic-bezier) on transform/opacity. */
.tl-panel {
  pointer-events: none;
  background: rgba(14, 16, 24, 0.62);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
  backdrop-filter: blur(20px) saturate(1.5);
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 18px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.5);
  color: #eef1f8;
  box-sizing: border-box;
  opacity: 0;
  visibility: hidden;
  transform: translateY(16px) scale(0.96);
  transform-origin: bottom center;
  will-change: transform, opacity;
  transition: transform 0.38s cubic-bezier(0.3, 1.35, 0.5, 1),
              opacity 0.26s ease,
              visibility 0s linear 0.4s;
}
.tl-layer--desktop .tl-panel {
  transform: translateX(-16px) scale(0.96);
  transform-origin: left center;
}
.tl-panel-movable { cursor:grab; translate:var(--tl-panel-drag-x, 0px) var(--tl-panel-drag-y, 0px); }
.tl-panel-movable.tl-dragging { cursor:grabbing; user-select:none; -webkit-user-select:none; }
.tl-panel-movable.tl-dragging * { user-select:none; -webkit-user-select:none; }

.tl-panel.tl-open {
  opacity: 1;
  visibility: visible;
  transform: none;
  pointer-events: auto;
  transition: transform 0.42s cubic-bezier(0.3, 1.4, 0.5, 1),
              opacity 0.26s ease,
              visibility 0s;
}
.tl-layer--phone .tl-panel {
  width: min(560px, 100%);
  max-height: 62vh;
  overflow-y: auto;
}
.tl-layer--desktop .tl-panel {
  width: 380px;
  max-width: min(420px, calc(100vw - 120px));
  max-height: calc(100vh - 96px);
  overflow-y: auto;
}
.tl-layer--ar .tl-panel {
  width: min(420px, calc(100vw - 96px));
  max-height: 56vh;
  overflow-y: auto;
}

@media (prefers-reduced-motion: reduce) {
  .tl-panel, .tl-chip { transition: none; }
}
`;

const INJECTED_STYLES = new WeakSet();

function ensureTabEngineStyles(doc) {
  if (!doc || INJECTED_STYLES.has(doc)) return;
  const style = doc.createElement('style');
  style.setAttribute('data-tab-engine', '1');
  style.textContent = TAB_ENGINE_CSS;
  const head = doc.head || doc.getElementsByTagName?.('head')?.[0];
  if (head && typeof head.appendChild === 'function') {
    head.appendChild(style);
    INJECTED_STYLES.add(doc);
  }
}

const FOCUSABLE_SELECTOR =
  'button, input, select, textarea, a[href], [tabindex], [data-autofocus]';

function isEditableTarget(target) {
  if (!target || typeof target.tagName !== 'string') return false;
  const tag = target.tagName.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true;
}

const VOICE_STOP_WORDS = new Set([
  'the', 'a', 'an', 'panel', 'panels', 'tab', 'tabs', 'please', 'for', 'me', 'my', 'app',
]);

export class TabEngine {
  constructor(options = {}) {
    const opts = options || {};

    const rootEl =
      opts.root || (typeof document !== 'undefined' ? document.body : null);
    if (
      !rootEl ||
      typeof rootEl.appendChild !== 'function' ||
      typeof rootEl.setAttribute !== 'function'
    ) {
      throw new TypeError(
        'TabEngine requires a valid root element (e.g. document.body). ' +
          'Pass { root } explicitly in non-DOM environments.'
      );
    }
    const doc =
      opts.document ||
      rootEl.ownerDocument ||
      (typeof document !== 'undefined' ? document : null);
    if (
      !doc ||
      typeof doc.createElement !== 'function' ||
      typeof doc.addEventListener !== 'function'
    ) {
      throw new TypeError(
        'TabEngine requires a document exposing createElement/addEventListener.'
      );
    }

    this.root = rootEl;
    this.document = doc;
    this.tabs = new Map(); // id -> record
    this.order = []; // registration order of ids
    this.activeOrder = []; // active ids, oldest first
    this.maxPinnedDesktop = Math.max(1, parseInt(opts.maxPinnedDesktop, 10) || 3);
    this.mode = 'desktop';
    this._listeners = new Map();
    this._returnFocus = null;
    this._keyHandler = (event) => this._onKeyDown(event);
    this._viewportMql = null;
    this._onViewportChange = null;

    ensureTabEngineStyles(doc);

    this.dock = doc.createElement('div');
    this.dock.className = 'tl-dock';
    this.dock.setAttribute('role', 'tablist');
    this.dock.setAttribute('aria-label', 'Reality Lens panels');
    rootEl.appendChild(this.dock);

    this.layer = doc.createElement('div');
    this.layer.className = 'tl-layer';
    rootEl.appendChild(this.layer);

    doc.addEventListener('keydown', this._keyHandler);

    const requestedMode =
      opts.mode || (opts.autoDetect === false ? null : this._detectModeFromViewport());
    this.setDeviceMode(requestedMode || 'desktop', { silent: true });
    if (opts.autoDetect !== false) this._bindViewportDetection();

    try {
      if (typeof window !== 'undefined') window.__tabEngine = this;
    } catch (err) {
      /* non-fatal: exposure is a convenience, not a requirement */
    }

    this._emit('init', { mode: this.mode });
  }

  // ---------------------------------------------------------------- registry

  registerTab({ id, title, icon, open, close, node, adoptNode = true, pinned = false }) {
    if (typeof id !== 'string' || id.trim() === '') {
      throw new TypeError('registerTab: "id" must be a non-empty string.');
    }
    if (this.tabs.has(id)) {
      throw new Error(`registerTab: tab "${id}" is already registered.`);
    }
    if (!node || typeof node.appendChild !== 'function' || !node.classList) {
      throw new TypeError('registerTab: "node" must be a DOM element.');
    }
    // adoptNode:false registers an existing panel in place: no DOM move, no
    // id/role relabeling, no engine visibility classes. The engine tracks
    // state, renders the dock chip, and calls open()/close(); the panel's own
    // logic keeps owning its position, styles, and attributes.
    const adopted = adoptNode !== false;
    // pinned:true marks eviction-exempt persistent chrome (see PUBLIC API).
    const isPinned = pinned === true;

    const tabTitle = typeof title === 'string' && title.trim() !== '' ? title.trim() : id;
    const record = {
      id,
      title: tabTitle,
      icon: typeof icon === 'string' && icon !== '' ? icon : '◈',
      open: typeof open === 'function' ? open : () => {},
      close: typeof close === 'function' ? close : () => {},
      node,
      chip: null,
      active: false,
      adopted,
      pinned: isPinned,
      _originalParent: node.parentNode || null,
      _originalNext: node.nextSibling || null,
      _originalAttrs: {
        id: node.getAttribute('id'),
        role: node.getAttribute('role'),
        tabindex: node.getAttribute('tabindex'),
        'aria-hidden': node.getAttribute('aria-hidden'),
        'aria-label': node.getAttribute('aria-label'),
      },
    };

    if (adopted) {
      // Panel shell: engine owns visibility; the tab's open()/close() own content.
      node.classList.add('tl-panel');
      node.setAttribute('role', 'tabpanel');
      node.setAttribute('id', `tl-panel-${id}`);
      node.setAttribute('aria-hidden', 'true');
      node.setAttribute('aria-label', tabTitle);
      node.setAttribute('aria-labelledby', `tl-chip-${id}`);
      this.layer.appendChild(node);
    }

    if (record.adopted) this._enablePanelDragging(record);

    const shortcutIndex = this.order.length + 1; // 1–9 keyboard map
    const chip = this.document.createElement('button');
    chip.setAttribute('type', 'button');
    chip.className = 'tl-chip';
    chip.setAttribute('role', 'tab');
    chip.setAttribute('id', `tl-chip-${id}`);
    const controlsId = adopted ? `tl-panel-${id}` : (node.getAttribute('id') || '');
    if (controlsId) chip.setAttribute('aria-controls', controlsId);
    chip.setAttribute('aria-selected', 'false');
    chip.setAttribute('aria-expanded', 'false');
    chip.setAttribute('aria-label', tabTitle);
    chip.setAttribute('title', tabTitle);
    if (shortcutIndex <= 9) chip.setAttribute('aria-keyshortcuts', String(shortcutIndex));

    const cubeEl = this.document.createElement('span');
    cubeEl.className = 'tl-chip-cube';
    cubeEl.setAttribute('aria-hidden', 'true');
    cubeEl.innerHTML = [
      "<span class='tl-cube-face tl-cube-face--front'><span class='tl-cube-mark'></span></span>",
      "<span class='tl-cube-face tl-cube-face--back'><span class='tl-cube-mark'></span></span>",
      "<span class='tl-cube-face tl-cube-face--right'><span class='tl-cube-mark'></span></span>",
      "<span class='tl-cube-face tl-cube-face--left'><span class='tl-cube-mark'></span></span>",
      "<span class='tl-cube-face tl-cube-face--top'><span class='tl-cube-mark'></span></span>",
      "<span class='tl-cube-face tl-cube-face--bottom'><span class='tl-cube-mark'></span></span>",
    ].join("");
    const faceMarks = [
      { selector: '.tl-cube-face--front', symbol: record.icon, code: tabTitle.slice(0, 5) },
      { selector: '.tl-cube-face--back', symbol: '⌖', code: 'TACT' },
      { selector: '.tl-cube-face--right', symbol: 'T', code: 'TUMBO' },
      { selector: '.tl-cube-face--left', symbol: 'Ω', code: 'REALITY' },
      { selector: '.tl-cube-face--top', symbol: '✦', code: 'SIM' },
      { selector: '.tl-cube-face--bottom', symbol: '▦', code: 'GRID' },
    ];
    for (const face of faceMarks) {
      const mark = cubeEl.querySelector(face.selector + ' .tl-cube-mark');
      if (!mark) continue;
      const symbol = this.document.createElement('span'); symbol.textContent = face.symbol;
      const code = this.document.createElement('span'); code.className = 'tl-cube-code'; code.textContent = face.code;
      mark.replaceChildren(symbol, code);
    }

    const labelEl = this.document.createElement('span');
    labelEl.className = 'tl-chip-label';
    labelEl.textContent = tabTitle;

    chip.appendChild(cubeEl);
    chip.appendChild(labelEl);
    const chipClose = this.document.createElement('span');
    chipClose.className = 'tl-chip-close';
    chipClose.textContent = '×';
    chipClose.setAttribute('role', 'button');
    chipClose.setAttribute('tabindex', '0');
    chipClose.setAttribute('aria-label', `Close ${tabTitle}`);
    chipClose.title = `Close ${tabTitle}`;
    chip.appendChild(chipClose);
    chipClose.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.deactivate(id);
    });
    chipClose.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        this.deactivate(id);
      }
    });
    chip.addEventListener('click', (event) => {
      if (event.target === chipClose) return;
      this.toggle(id);
    });
    record.chip = chip;
    this.dock.appendChild(chip);

    this.tabs.set(id, record);
    this.order.push(id);
    this._emit('register', { id, tab: record });
    return record;
  }

  unregisterTab(id) {
    const tab = this.tabs.get(id);
    if (!tab) return false;
    this._deactivateId(id, { restoreFocus: false });

    if (tab.chip && typeof tab.chip.remove === 'function') tab.chip.remove();
    this._disablePanelDragging(tab);

    const node = tab.node;
    if (tab.adopted) {
      node.classList.remove('tl-panel', 'tl-open');
      for (const [name, original] of Object.entries(tab._originalAttrs)) {
        if (original === null || original === undefined) node.removeAttribute(name);
        else node.setAttribute(name, original);
      }
      node.removeAttribute('aria-labelledby');
      if (node.parentNode && typeof node.parentNode.removeChild === 'function') {
        node.parentNode.removeChild(node);
      }
      const parent = tab._originalParent;
      const next = tab._originalNext;
      if (parent && typeof parent.appendChild === 'function') {
        if (next && next.parentNode === parent && typeof parent.insertBefore === 'function') {
          parent.insertBefore(node, next);
        } else {
          parent.appendChild(node);
        }
      }
    }

    this.tabs.delete(id);
    this.order = this.order.filter((x) => x !== id);
    this._emit('unregister', { id });
    return true;
  }

  // ------------------------------------------------------------------ state

  getTab(id) {
    return this.tabs.get(id) || null;
  }

  isActive(id) {
    const tab = this.tabs.get(id);
    return !!tab && tab.active === true;
  }

  /** Active tab records, oldest activation first. Empty array when all closed. */
  getActive() {
    return this.activeOrder.map((id) => this.tabs.get(id)).filter(Boolean);
  }

  getActiveIds() {
    return [...this.activeOrder];
  }

  activate(id) {
    const tab = this.tabs.get(id);
    if (!tab) return false;

    if (tab.active) {
      this._touchRecency(id);
      this._focusInto(tab);
      return true;
    }

    if (this.activeOrder.length === 0) {
      this._returnFocus = this._currentFocus();
    }

    tab.active = true;
    this.activeOrder.push(id);
    // Airtight cap: evict oldest non-pinned tabs over the limit, purge stale
    // entries, never evict the tab being activated. Pinned persistent chrome
    // is exempt and does not count toward the cap.
    this._enforceCap(id);

    if (tab.adopted) {
      tab.node.classList.add('tl-open');
      tab.node.setAttribute('aria-hidden', 'false');
    }
    tab.chip.classList.add('tl-active');
    tab.chip.setAttribute('aria-selected', 'true');
    tab.chip.setAttribute('aria-expanded', 'true');

    try {
      tab.open();
    } catch (err) {
      this._emit('error', { id, phase: 'open', error: err });
    }
    this._emit('activate', { id, tab });
    this._focusInto(tab);
    return true;
  }

  deactivate(id) {
    return this._deactivateId(id, { restoreFocus: true });
  }

  toggle(id) {
    if (this.isActive(id)) return this.deactivate(id);
    return this.activate(id);
  }

  /**
   * Closes every materialized tab the user opened. Pinned persistent chrome
   * (adopted at boot, never opened through the dock) survives close-all:
   * the dock must not hide what it did not open. Returns how many were closed.
   */
  closeAll() {
    const ids = [...this.activeOrder];
    let closed = 0;
    for (const id of ids) {
      const tab = this.tabs.get(id);
      if (tab && tab.pinned === true) continue;
      if (this._deactivateId(id, { restoreFocus: false })) closed += 1;
    }
    this._restoreFocus();
    if (closed > 0) this._emit('closeAll', { closed, ids });
    return closed;
  }

  // ------------------------------------------------------------- drag UX
  _enablePanelDragging(tab) {
    const node=tab?.node; if(!node || typeof node.addEventListener!=='function') return;
    const drag={active:false,pointerId:null,startX:0,startY:0,originX:0,originY:0,offsetX:0,offsetY:0,rect:null};
    const interactive=(target)=>{try{return !!target?.closest?.('button,input,select,textarea,option,a[href],[contenteditable="true"],[data-no-panel-drag]');}catch{return false;}};
    const apply=(x,y)=>{drag.offsetX=x;drag.offsetY=y;node.style.setProperty('--tl-panel-drag-x',String(x)+'px');node.style.setProperty('--tl-panel-drag-y',String(y)+'px');};
    const clamp=(dx,dy)=>{const r=drag.rect;if(!r||typeof window==='undefined')return[dx,dy];const vw=Math.max(320,Number(window.innerWidth)||0),vh=Math.max(320,Number(window.innerHeight)||0),m=22;return[Math.max(m-r.left,Math.min(vw-m-r.right,dx)),Math.max(m-r.top,Math.min(vh-m-r.bottom,dy))];};
    const move=(e)=>{if(!drag.active||e.pointerId!==drag.pointerId)return;const d=clamp(drag.originX+e.clientX-drag.startX,drag.originY+e.clientY-drag.startY);if(Math.abs(d[0]-drag.offsetX)+Math.abs(d[1]-drag.offsetY)>2){node.classList.add('tl-dragging');try{e.preventDefault();}catch{}}apply(d[0],d[1]);};
    const end=(e)=>{if(!drag.active||e.pointerId!==drag.pointerId)return;drag.active=false;node.classList.remove('tl-dragging');try{node.releasePointerCapture?.(drag.pointerId);}catch{}drag.pointerId=null;drag.rect=null;};
    const start=(e)=>{if(!tab.active||e.button!==0||interactive(e.target)||typeof node.getBoundingClientRect!=='function')return;drag.active=true;drag.pointerId=e.pointerId;drag.startX=e.clientX;drag.startY=e.clientY;drag.originX=drag.offsetX;drag.originY=drag.offsetY;drag.rect=node.getBoundingClientRect();try{node.setPointerCapture?.(e.pointerId);}catch{}};
    node.classList.add('tl-panel-movable');node.addEventListener('pointerdown',start);node.addEventListener('pointermove',move);node.addEventListener('pointerup',end);node.addEventListener('pointercancel',end);
    tab._panelDrag={node,start,move,end,drag};node.style.setProperty('--tl-panel-drag-x','0px');node.style.setProperty('--tl-panel-drag-y','0px');
  }
  _disablePanelDragging(tab) {
    const d=tab?._panelDrag;if(!d)return;const {node,start,move,end}=d;try{node.removeEventListener('pointerdown',start);}catch{}try{node.removeEventListener('pointermove',move);}catch{}try{node.removeEventListener('pointerup',end);}catch{}try{node.removeEventListener('pointercancel',end);}catch{}try{node.classList.remove('tl-panel-movable','tl-dragging');}catch{}try{node.style.removeProperty('--tl-panel-drag-x');node.style.removeProperty('--tl-panel-drag-y');}catch{}delete tab._panelDrag;
  }
  // ------------------------------------------------------------------- mode

  /**
   * Switch device mode. 'phone' → bottom dock, single tab. 'desktop' → left rail,
   * up to `maxPinnedDesktop` tabs. 'ar' → compact edge rail, single tab
   * (AR visuals belong to the AR lane; the engine only switches layout+policy).
   */
  setDeviceMode(mode, opts = {}) {
    if (mode !== 'phone' && mode !== 'desktop' && mode !== 'ar') {
      throw new RangeError(
        `setDeviceMode: unknown mode "${mode}". Expected 'phone', 'desktop' or 'ar'.`
      );
    }
    const changed = mode !== this.mode;
    this.mode = mode;
    this._applyDockModeClass();

    // Enforce the single-active policy outside desktop: keep the most recent
    // non-pinned tab; pinned persistent chrome stays untouched.
    if (mode !== 'desktop') {
      const nonPinned = this.activeOrder.filter((id) => {
        const t = this.tabs.get(id);
        return !!t && t.pinned !== true;
      });
      const keep = nonPinned[nonPinned.length - 1];
      for (const id of nonPinned) {
        if (id !== keep) this._deactivateId(id, { restoreFocus: false });
      }
    }

    if (changed && !opts.silent) this._emit('modechange', { mode });
    return this.mode;
  }

  // ------------------------------------------------------------------ voice

  /**
   * Route a voice-intent string to tab actions. Never throws on unknown text.
   * Examples: "open contracts" → activates the contracts tab;
   * "close all" → closeAll(); "hide the bot plaza" → deactivates it.
   */
  handleVoiceIntent(rawText) {
    const text = String(rawText == null ? '' : rawText)
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ');
    if (text === '') return { ok: false, action: 'none', reason: 'empty-input' };

    if (
      /\b(close|dismiss|hide)\b.*\b(all|everything|them)\b/.test(text) ||
      text === 'close' ||
      text === 'escape'
    ) {
      const closed = this.closeAll();
      return { ok: true, action: 'closeAll', closed };
    }

    let m = text.match(/^(open|show|launch|display|bring up|go to|take me to)\s+(.+)$/);
    if (m) {
      const tab = this._findTab(m[2]);
      if (!tab) return { ok: false, action: 'none', reason: 'no-matching-tab', query: m[2] };
      this.activate(tab.id);
      return { ok: true, action: 'activate', id: tab.id };
    }

    m = text.match(/^(close|hide|dismiss)\s+(.+)$/);
    if (m) {
      const tab = this._findTab(m[2]);
      if (!tab) return { ok: false, action: 'none', reason: 'no-matching-tab', query: m[2] };
      this.deactivate(tab.id);
      return { ok: true, action: 'deactivate', id: tab.id };
    }

    m = text.match(/^toggle\s+(.+)$/);
    if (m) {
      const tab = this._findTab(m[1]);
      if (!tab) return { ok: false, action: 'none', reason: 'no-matching-tab', query: m[1] };
      this.toggle(tab.id);
      return { ok: true, action: 'toggle', id: tab.id };
    }

    // Bare name ("contracts") → open it.
    const tab = this._findTab(text);
    if (tab) {
      this.activate(tab.id);
      return { ok: true, action: 'activate', id: tab.id };
    }
    return { ok: false, action: 'none', reason: 'no-matching-tab', query: text };
  }

  // ------------------------------------------------------------------ events

  on(event, listener) {
    if (typeof listener !== 'function') return this;
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(listener);
    return this;
  }

  off(event, listener) {
    const set = this._listeners.get(event);
    if (set) set.delete(listener);
    return this;
  }

  // ----------------------------------------------------------------- destroy

  destroy() {
    this.closeAll();
    try {
      this.document.removeEventListener('keydown', this._keyHandler);
    } catch (err) {
      /* ignore */
    }
    const mql = this._viewportMql;
    if (mql && this._onViewportChange) {
      try {
        if (typeof mql.removeEventListener === 'function') {
          mql.removeEventListener('change', this._onViewportChange);
        } else if (typeof mql.removeListener === 'function') {
          mql.removeListener(this._onViewportChange);
        }
      } catch (err) {
        /* ignore */
      }
    }
    for (const id of [...this.order]) this.unregisterTab(id);
    if (this.dock && typeof this.dock.remove === 'function') this.dock.remove();
    if (this.layer && typeof this.layer.remove === 'function') this.layer.remove();
    try {
      if (typeof window !== 'undefined' && window.__tabEngine === this) {
        window.__tabEngine = null;
      }
    } catch (err) {
      /* ignore */
    }
    this._emit('destroy', {});
  }

  // --------------------------------------------------------------- internals

  _activeLimit() {
    return this.mode === 'desktop' ? this.maxPinnedDesktop : 1;
  }

  /** Active, registered, non-pinned tab ids, oldest activation first. */
  _activeNonPinnedIds() {
    return this.activeOrder.filter((x) => {
      const t = this.tabs.get(x);
      return !!t && t.active === true && t.pinned !== true;
    });
  }

  /**
   * Enforce the active-tab cap exactly. Purges stale activeOrder entries
   * (ids whose tab is gone or no longer active — these could otherwise wedge
   * the eviction loop), then evicts the oldest non-pinned tabs until at most
   * `limit` non-pinned tabs remain. Pinned persistent chrome is exempt and
   * never counts toward the cap; `protectId` (the tab being activated) is
   * never chosen as an eviction victim.
   */
  _enforceCap(protectId = null) {
    this.activeOrder = this.activeOrder.filter((x) => {
      const t = this.tabs.get(x);
      return !!t && t.active === true;
    });
    const limit = this._activeLimit();
    let guard = this.tabs.size + 2;
    while (guard-- > 0) {
      const over = this._activeNonPinnedIds();
      if (over.length <= limit) break;
      const victim = over.find((x) => x !== protectId);
      if (!victim) break; // only pinned/protected tabs remain — nothing evictable
      this._deactivateId(victim, { restoreFocus: false });
    }
  }

  _touchRecency(id) {
    this.activeOrder = this.activeOrder.filter((x) => x !== id);
    this.activeOrder.push(id);
  }

  _deactivateId(id, { restoreFocus = true } = {}) {
    const tab = this.tabs.get(id);
    // Always purge the id from the activation order first: a stale entry
    // (tab gone, or tab.active already false) must never wedge the eviction
    // loop in _enforceCap.
    this.activeOrder = this.activeOrder.filter((x) => x !== id);
    if (!tab || !tab.active) return false;
    tab.active = false;
    if (tab.adopted) {
      tab.node.classList.remove('tl-open');
      tab.node.setAttribute('aria-hidden', 'true');
    }
    tab.chip.classList.remove('tl-active');
    tab.chip.setAttribute('aria-selected', 'false');
    tab.chip.setAttribute('aria-expanded', 'false');
    try {
      tab.close();
    } catch (err) {
      this._emit('error', { id, phase: 'close', error: err });
    }
    this._emit('deactivate', { id, tab });
    if (restoreFocus && this.activeOrder.length === 0) this._restoreFocus();
    return true;
  }

  _applyDockModeClass() {
    for (const el of [this.dock, this.layer]) {
      el.classList.remove(
        'tl-dock--phone',
        'tl-dock--desktop',
        'tl-dock--ar',
        'tl-layer--phone',
        'tl-layer--desktop',
        'tl-layer--ar'
      );
    }
    this.dock.classList.add(`tl-dock--${this.mode}`);
    this.layer.classList.add(`tl-layer--${this.mode}`);
    this.root.setAttribute('data-tl-mode', this.mode);
  }

  _detectModeFromViewport() {
    try {
      if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
        return window.matchMedia('(max-width: 700px)').matches ? 'phone' : 'desktop';
      }
    } catch (err) {
      /* ignore */
    }
    return null;
  }

  _bindViewportDetection() {
    try {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
      const mql = window.matchMedia('(max-width: 700px)');
      this._viewportMql = mql;
      const onChange = (event) => {
        this.setDeviceMode(event && event.matches ? 'phone' : 'desktop');
      };
      this._onViewportChange = onChange;
      if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange);
      else if (typeof mql.addListener === 'function') mql.addListener(onChange);
    } catch (err) {
      /* ignore */
    }
  }

  _onKeyDown(event) {
    if (!event || event.defaultPrevented) return;
    const key = event.key;

    if (key === 'Escape') {
      if (this.activeOrder.length > 0) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        this.closeAll();
      }
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (typeof key === 'string' && key >= '1' && key <= '9') {
      if (isEditableTarget(event.target)) return; // never hijack typing
      const id = this.order[Number(key) - 1];
      if (id !== undefined) {
        if (typeof event.preventDefault === 'function') event.preventDefault();
        this.activate(id);
      }
    }
  }

  _findTab(query) {
    const q = String(query || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (q === '') return null;
    const tokens = q.split(' ').filter((t) => t && !VOICE_STOP_WORDS.has(t));
    const significant = tokens.filter((t) => t.length >= 3);
    for (const id of this.order) {
      const tab = this.tabs.get(id);
      const idLower = id.toLowerCase();
      const titleLower = tab.title.toLowerCase();
      if (q.includes(idLower) || q.includes(titleLower)) return tab;
      const hay = `${idLower} ${titleLower}`;
      if (significant.some((t) => hay.includes(t))) return tab;
    }
    return null;
  }

  _currentFocus() {
    const doc = this.document;
    const ae = doc ? doc.activeElement : null;
    return ae && ae !== doc.body ? ae : null;
  }

  _focusInto(tab) {
    const node = tab.node;
    let target = null;
    try {
      target = node.querySelector('[data-autofocus]') || null;
    } catch (err) {
      target = null;
    }
    if (!target) {
      let candidates = [];
      try {
        candidates = node.querySelectorAll(FOCUSABLE_SELECTOR) || [];
      } catch (err) {
        candidates = [];
      }
      for (const el of candidates) {
        if (!el || el.disabled === true) continue;
        const ti = typeof el.tabIndex === 'number' ? el.tabIndex : 0;
        if (ti < 0) continue;
        target = el;
        break;
      }
    }
    if (!target) {
      if (node.tabIndex === undefined || node.tabIndex === null || node.tabIndex < 0) {
        node.setAttribute('tabindex', '-1');
      }
      target = node;
    }
    try {
      target.focus({ preventScroll: true });
    } catch (err) {
      try {
        target.focus();
      } catch (ignored) {
        /* focus is best-effort */
      }
    }
  }

  _restoreFocus() {
    const el = this._returnFocus;
    this._returnFocus = null;
    if (!el || typeof el.focus !== 'function') return;
    try {
      const inDoc = this.document && typeof this.document.contains === 'function'
        ? this.document.contains(el)
        : true;
      if (inDoc) el.focus({ preventScroll: true });
    } catch (err) {
      /* focus restore is best-effort */
    }
  }

  _emit(event, detail) {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        listener(detail);
      } catch (err) {
        if (event !== 'error') this._emit('error', { phase: 'listener', event, error: err });
      }
    }
  }
}

TabEngine.version = '1.0.0';

export default TabEngine;
