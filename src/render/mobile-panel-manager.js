// Guarded: token-trade-mount's module graph is mid-flight (its imports don't
// match token.js yet); a static import would fail the whole module graph and
// red-banner the boot. Boots automatically once the lane lands a consistent graph.
import("./token-trade-mount.js?v=20260922-cache2").catch(() => {});
/** Mobile panel manager — 2D UI chrome/layout only.
 *
 * On narrow viewports (<=700px) only one floating panel may be visible at a
 * time. When a panel opens, every other panel collapses (including the
 * Mission Control feature-shell, the block readout sheet, the floating
 * "Camera + audio" device preview, and the City districts dropdown), and the
 * bottom cube-field hint bar hides until the panel closes. Desktop layout is
 * untouched.
 *
 * This changes no projection, ledger, identity, signing, settlement, wallet,
 * or authority state. It only toggles `hidden` / `open` / visibility-class
 * presentation flags on 2D overlay elements.
 */
const NARROW_QUERY = '(max-width:700px)';
const BODY_OPEN_CLASS = 'mobile-panel-open';

// Panels that never participate in the single-panel rule: the portal return
// affordance is persistent chrome, and the cube-dive inside-HUD is a compact
// bottom-docked bar that must stay available while the camera is inside a
// cube (it is the only way back to the field).
const EXCLUDED_IDS = new Set(['portal-return-console', 'cube-dive-hud']);

/** Panel descriptors collected from the live DOM. */
function collectPanels(documentRoot) {
  const panels = [];
  const asides = documentRoot.querySelectorAll
    ? Array.from(documentRoot.querySelectorAll('aside'))
    : [];
  for (const el of asides) {
    if (!el || !el.id || EXCLUDED_IDS.has(el.id)) continue;
    if(el.parentElement?.closest?.('aside'))continue;
    // Object skins and Assembly chrome are owned by the spatial renderer,
    // not loose floating panels. A mobile keeper election must not hide the
    // selected entity or its directory because a second aside exists.
    if (el.getAttribute?.('data-lens-surface-attached') === 'true' || el.closest?.('#reality-assembly')) continue;
    // Mission Control's shell is class-driven (#feature-shell.open); every
    // other aside uses the `hidden` attribute.
    panels.push({ id: el.id || '(aside)', kind: el.id === 'feature-shell' ? 'class-open' : 'hidden', el });
  }
  const gesture = documentRoot.getElementById ? documentRoot.getElementById('gesture-input-panel') : null;
  if (gesture && gesture.tagName !== 'ASIDE') panels.push({ id: 'gesture-input-panel', kind: 'hidden', el: gesture });
  const media = documentRoot.getElementById ? documentRoot.getElementById('media-preview') : null;
  if (media) panels.push({ id: 'media-preview', kind: 'details', el: media });
  // The block readout (#readout) is a div whose visibility is class-driven
  // (#readout.visible). It used to stack on top of consoles on phones.
  const readout = documentRoot.getElementById ? documentRoot.getElementById('readout') : null;
  if (readout && !EXCLUDED_IDS.has(readout.id)) panels.push({ id: readout.id || 'readout', kind: 'class-visible', el: readout });
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

function isPanelVisible(panel, windowRoot) {
  if (!panel || !panel.el) return false;
  const el = panel.el;
  // Computed display on a child can be block while an ancestor is hidden.
  // Nested dashboard asides previously evicted the requested feature even
  // though their entire dashboard had no rendered box.
  if(typeof el.getClientRects==='function'&&el.getClientRects().length===0)return false;
  if (panel.kind === 'details') return el.open === true;
  if (panel.kind === 'class-open') return classSaysVisible(el, ['open']) && computedHidden(el, windowRoot) !== true;
  if (panel.kind === 'class-visible') return classSaysVisible(el, ['visible']) && computedHidden(el, windowRoot) !== true;
  if (el.hidden === true) return false;
  // Class-less panels (e.g. #asset-launch) can be suppressed purely by
  // stylesheet rules while carrying no `hidden` attribute. A display:none
  // panel must not win the keeper election or mark the viewport occupied.
  const hiddenByCss = computedHidden(el, windowRoot);
  if (hiddenByCss !== null) return !hiddenByCss;
  return true;
}

function hidePanel(panel, documentRoot) {
  if (!panel || !panel.el) return;
  const el = panel.el;
  if (panel.kind === 'details') {
    if (el.open) el.open = false;
    return;
  }
  if (panel.kind === 'class-open' || panel.kind === 'class-visible') {
    // Route the Mission Control shell through its own close control so the
    // feature navigator's internal open state (and toggle label) stay in
    // sync; other class-driven overlays hide by class.
    if (panel.id === 'feature-shell') {
      const close = documentRoot && documentRoot.getElementById
        ? documentRoot.getElementById('feature-close')
        : null;
      if (close && typeof close.click === 'function') {
        close.click();
        return;
      }
    }
    if (el.classList && typeof el.classList.remove === 'function') {
      el.classList.remove('open');
      el.classList.remove('visible');
    }
    if (typeof el.setAttribute === 'function') el.setAttribute('aria-hidden', 'true');
    return;
  }
  if (!el.hidden) el.hidden = true;
  if (typeof el.setAttribute === 'function' && el.getAttribute?.('aria-hidden') !== 'true') el.setAttribute('aria-hidden', 'true');
}

/**
 * Pure policy: given the visible panels and the id of the panel that just
 * opened, decide which panels to hide and whether the hint bar should hide.
 * Exported for deterministic unit tests.
 */
export function applyMobilePanelPolicy({ panels, openedId }) {
  const list = Array.isArray(panels) ? panels : [];
  const visible = list.filter((p) => p.visible).map((p) => p.id);
  const keeper = openedId && visible.includes(openedId) ? openedId : visible[0] || null;
  const hideIds = keeper ? visible.filter((id) => id !== keeper) : [];
  return { keeper, hideIds, hintHidden: visible.length > 0 };
}

function closeCityDistricts(documentRoot) {
  const root = documentRoot.getElementById ? documentRoot.getElementById('city-journey') : null;
  const details = root && root.querySelector ? root.querySelector('details') : null;
  if (details && details.open) details.open = false;
}

function setHintHidden(documentRoot, hidden) {
  const hint = documentRoot && documentRoot.getElementById ? documentRoot.getElementById('hint') : null;
  // Setting a reflected boolean to its existing value still mutates its
  // attribute. The observer watches `hidden`, so unconditional writes here
  // starve the event loop forever on narrow screens (including initial boot).
  if (hint && 'hidden' in hint && hint.hidden !== Boolean(hidden)) hint.hidden = Boolean(hidden);
}

export function initMobilePanelManager({
  documentRoot = document,
  windowRoot = window,
  MutationObserverImpl = null,
} = {}) {
  const body = documentRoot ? documentRoot.body : null;
  if (!body) return { destroy() {}, isNarrow: () => false };
  const MO = MutationObserverImpl
    || (windowRoot && windowRoot.MutationObserver)
    || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
  const mq = windowRoot && typeof windowRoot.matchMedia === 'function'
    ? windowRoot.matchMedia(NARROW_QUERY)
    : null;
  const isNarrow = () => (mq ? mq.matches : (windowRoot && windowRoot.innerWidth != null ? windowRoot.innerWidth : 1024) <= 700);

  let applying = false;

  function sync(openedId) {
    if (applying) return;
    const narrow = isNarrow();
    const panels = collectPanels(documentRoot);
    const visibleNow = panels.some((p) => isPanelVisible(p, windowRoot));
    const bodyOpen=narrow&&visibleNow;
    if(body.classList.contains(BODY_OPEN_CLASS)!==bodyOpen)body.classList.toggle(BODY_OPEN_CLASS,bodyOpen);
    if (!narrow) return;
    applying = true;
    try {
      const state = panels.map((p) => ({ id: p.id, visible: isPanelVisible(p, windowRoot) }));
      const { hideIds, hintHidden } = applyMobilePanelPolicy({ panels: state, openedId });
      for (const panel of panels) {
        if (hideIds.includes(panel.id)) hidePanel(panel, documentRoot);
      }
      if (visibleNow) closeCityDistricts(documentRoot);
      setHintHidden(documentRoot, hintHidden);
    } finally {
      applying = false;
    }
  }

  function onMutations(mutations) {
    if (applying) return;
    let openedId = null;
    for (const mutation of mutations || []) {
      const target = mutation.target;
      if (!target) continue;
      const panels = collectPanels(documentRoot);
      const panel = panels.find((p) => p.el === target);
      if (panel && isPanelVisible(panel, windowRoot)) openedId = panel.id;
    }
    sync(openedId);
  }

  let observer = null;
  if (MO && documentRoot.documentElement) {
    observer = new MO(onMutations);
    observer.observe(documentRoot.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['hidden', 'open', 'aria-hidden', 'class'],
    });
  }
  const onResize = () => sync(null);
  if (windowRoot && typeof windowRoot.addEventListener === 'function') {
    windowRoot.addEventListener('resize', onResize);
  }
  if (typeof mq?.addEventListener === 'function') mq.addEventListener('change', onResize);

  // Settle the initial state (a console may already be open at boot).
  sync(null);

  return {
    isNarrow,
    /** Test/escape hook: re-run the policy immediately. */
    sync: () => sync(null),
    destroy() {
      if (observer) observer.disconnect();
      if (windowRoot && typeof windowRoot.removeEventListener === 'function') {
        windowRoot.removeEventListener('resize', onResize);
      }
      if (typeof mq?.removeEventListener === 'function') mq.removeEventListener('change', onResize);
      body.classList.remove(BODY_OPEN_CLASS);
    },
  };
}
