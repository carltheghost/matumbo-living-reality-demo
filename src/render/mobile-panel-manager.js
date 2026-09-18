/** Mobile panel manager — 2D UI chrome/layout only.
 *
 * On narrow viewports (<=700px) only one floating panel may be visible at a
 * time. When a panel opens, every other panel collapses, the floating
 * "Camera + audio" device preview and the City districts dropdown close, and
 * the bottom cube-field hint bar hides until the panel closes. Desktop layout
 * is untouched.
 *
 * This changes no projection, ledger, identity, signing, settlement, wallet,
 * or authority state. It only toggles `hidden` / `open` presentation flags on
 * 2D overlay elements.
 */
const NARROW_QUERY = '(max-width:700px)';
const BODY_OPEN_CLASS = 'mobile-panel-open';

/** Panel descriptors collected from the live DOM. */
function collectPanels(documentRoot) {
  const panels = [];
  const asides = documentRoot.querySelectorAll
    ? Array.from(documentRoot.querySelectorAll('aside'))
    : [];
  for (const el of asides) {
    if (!el || el.id === 'feature-shell' || el.id === 'portal-return-console') continue;
    panels.push({ id: el.id || '(aside)', kind: 'hidden', el });
  }
  const gesture = documentRoot.getElementById ? documentRoot.getElementById('gesture-input-panel') : null;
  if (gesture && gesture.tagName !== 'ASIDE') panels.push({ id: 'gesture-input-panel', kind: 'hidden', el: gesture });
  const media = documentRoot.getElementById ? documentRoot.getElementById('media-preview') : null;
  if (media) panels.push({ id: 'media-preview', kind: 'details', el: media });
  return panels;
}

function isPanelVisible(panel) {
  if (!panel || !panel.el) return false;
  if (panel.kind === 'details') return panel.el.open === true;
  return panel.el.hidden !== true;
}

function hidePanel(panel) {
  if (!panel || !panel.el) return;
  if (panel.kind === 'details') {
    if (panel.el.open) panel.el.open = false;
    return;
  }
  panel.el.hidden = true;
  if (typeof panel.el.setAttribute === 'function') panel.el.setAttribute('aria-hidden', 'true');
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
    const visibleNow = panels.some(isPanelVisible);
    body.classList.toggle(BODY_OPEN_CLASS, narrow && visibleNow);
    if (!narrow) return;
    applying = true;
    try {
      const state = panels.map((p) => ({ id: p.id, visible: isPanelVisible(p) }));
      const { hideIds } = applyMobilePanelPolicy({ panels: state, openedId });
      for (const panel of panels) {
        if (hideIds.includes(panel.id)) hidePanel(panel);
      }
      if (visibleNow) closeCityDistricts(documentRoot);
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
      if (panel && isPanelVisible(panel)) openedId = panel.id;
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
