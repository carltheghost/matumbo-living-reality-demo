/***
 * Contract Review Queue — "Contracts for your review" panel.
 * Ranked drafts from rankProposalsForReview. Simulated TUMBO points only.
 * Mobile: one panel, bottom-docked collapsible, 44px targets, 390x844 safe.
 */

const PANEL_ID = 'contract-review-queue';
const TITLE = 'Contracts for your review';
const MOBILE_BREAKPOINT = 700;
const TOUCH_MIN = 44;

function safeNotify(fn, payload) {
  if (typeof fn === 'function') {
    try { fn(payload); } catch (err) { console.warn('[contract-review-queue] notify failed', err); }
  }
}

function formatStartTime(ts) {
  if (ts == null) return 'TBD';
  try {
    const d = typeof ts === 'number' ? new Date(ts) : new Date(String(ts));
    if (Number.isNaN(d.getTime())) return 'TBD';
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return 'TBD'; }
}

function formatTumboQuote(quote) {
  if (quote == null || quote === '') return null;
  const n = Number(quote);
  if (!Number.isFinite(n)) return String(quote);
  return `${n.toLocaleString()} TUMBO (simulated)`;
}

function createEl(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

function isMobileViewport() {
  return typeof window !== 'undefined' && window.innerWidth <= MOBILE_BREAKPOINT;
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.root
 * @param {Array} opts.drafts - ranked proposal entries (frozen)
 * @param {function} opts.onApprove
 * @param {function} opts.onReject
 * @param {function} opts.onOpenContract
 * @param {function} [opts.notify]
 * @returns {{ update: function, dispose: function }}
 */
export function renderReviewQueue({
  root,
  drafts = [],
  onApprove,
  onReject,
  onOpenContract,
  notify,
}) {
  if (!root || !(root instanceof HTMLElement)) {
    console.warn('[contract-review-queue] root must be an HTMLElement');
    return { update() {}, dispose() {} };
  }

  let currentDrafts = Array.isArray(drafts) ? drafts.slice() : [];
  let collapsed = false;
  let disposed = false;

  const panel = createEl('div', 'crq-panel');
  panel.id = PANEL_ID;
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', TITLE);
  panel.tabIndex = -1;

  const header = createEl('div', 'crq-header');
  const titleEl = createEl('h2', 'crq-title', TITLE);
  titleEl.id = 'crq-title';
  panel.setAttribute('aria-labelledby', 'crq-title');

  const collapseBtn = createEl('button', 'crq-collapse-btn', 'Collapse');
  collapseBtn.type = 'button';
  collapseBtn.setAttribute('aria-expanded', 'true');
  collapseBtn.setAttribute('aria-controls', 'crq-body');
  collapseBtn.style.minHeight = `${TOUCH_MIN}px`;
  collapseBtn.style.minWidth = `${TOUCH_MIN}px`;

  const countBadge = createEl('span', 'crq-count', '0');
  countBadge.setAttribute('aria-live', 'polite');
  header.appendChild(titleEl);
  header.appendChild(countBadge);
  header.appendChild(collapseBtn);

  const body = createEl('div', 'crq-body');
  body.id = 'crq-body';
  const list = createEl('ul', 'crq-list');
  list.setAttribute('role', 'list');
  const emptyMsg = createEl('p', 'crq-empty', 'No contracts awaiting review.');
  emptyMsg.hidden = true;
  body.appendChild(list);
  body.appendChild(emptyMsg);
  panel.appendChild(header);
  panel.appendChild(body);

  // Styles (scoped via class prefix; no Block World visual redesign)
  const style = document.createElement('style');
  style.textContent = `
    .crq-panel {
      position: fixed; z-index: 40;
      background: rgba(12, 14, 20, 0.96);
      border: 1px solid rgba(120, 140, 180, 0.35);
      border-radius: 10px; color: #e8ecf4;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      font-size: 14px;
      box-shadow: 0 8px 28px rgba(0,0,0,0.45);
      max-width: 390px; width: calc(100vw - 16px);
      max-height: min(70vh, 844px);
      display: flex; flex-direction: column; overflow: hidden;
      right: 8px; bottom: 8px;
    }
    @media (min-width: 701px) {
      .crq-panel { right: 16px; bottom: 16px; max-width: 360px; }
    }
    .crq-panel.crq-collapsed .crq-body { display: none; }
    .crq-header {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid rgba(120, 140, 180, 0.25);
      flex-shrink: 0; min-height: ${TOUCH_MIN}px;
    }
    .crq-title { margin: 0; font-size: 15px; font-weight: 600; flex: 1; line-height: 1.3; }
    .crq-count {
      background: rgba(80, 120, 200, 0.35);
      border-radius: 999px; padding: 2px 8px;
      font-size: 12px; font-weight: 600; min-width: 1.5em; text-align: center;
    }
    .crq-collapse-btn {
      background: rgba(40, 48, 64, 0.9);
      border: 1px solid rgba(120, 140, 180, 0.4);
      color: #e8ecf4; border-radius: 6px; padding: 6px 10px;
      cursor: pointer; font-size: 13px;
      min-height: ${TOUCH_MIN}px; min-width: ${TOUCH_MIN}px;
    }
    .crq-collapse-btn:focus-visible { outline: 2px solid #7af; outline-offset: 2px; }
    .crq-body { overflow-y: auto; -webkit-overflow-scrolling: touch; flex: 1; padding: 8px; }
    .crq-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .crq-card {
      background: rgba(24, 28, 40, 0.95);
      border: 1px solid rgba(100, 120, 160, 0.3);
      border-radius: 8px; padding: 10px 12px;
      display: flex; flex-direction: column; gap: 8px;
    }
    .crq-card:focus-within { border-color: rgba(120, 180, 255, 0.55); }
    .crq-card-meta { display: flex; flex-direction: column; gap: 2px; }
    .crq-game { font-weight: 600; font-size: 14px; }
    .crq-league, .crq-time, .crq-quote { font-size: 12px; color: #a8b4c8; }
    .crq-quote { color: #9ec8a8; }
    .crq-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .crq-btn {
      flex: 1; min-height: ${TOUCH_MIN}px; min-width: ${TOUCH_MIN}px;
      border-radius: 6px; border: 1px solid transparent;
      font-size: 13px; font-weight: 600; cursor: pointer; padding: 8px 12px;
    }
    .crq-btn:focus-visible { outline: 2px solid #7af; outline-offset: 2px; }
    .crq-btn-approve { background: rgba(40, 120, 80, 0.85); border-color: rgba(80, 180, 120, 0.5); color: #e8fff0; }
    .crq-btn-reject { background: rgba(100, 40, 40, 0.85); border-color: rgba(180, 80, 80, 0.5); color: #ffe8e8; }
    .crq-btn-open { background: rgba(40, 60, 100, 0.85); border-color: rgba(100, 140, 200, 0.5); color: #e0e8ff; flex: 0 0 auto; }
    .crq-empty { margin: 16px 8px; text-align: center; color: #8890a0; font-size: 13px; }
    .crq-panel.crq-mobile-hidden { display: none; }
  `;
  document.head.appendChild(style);

  function setCollapsed(next) {
    collapsed = !!next;
    panel.classList.toggle('crq-collapsed', collapsed);
    collapseBtn.textContent = collapsed ? 'Expand' : 'Collapse';
    collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }

  function buildCard(entry, index) {
    const li = createEl('li', 'crq-card');
    li.setAttribute('role', 'listitem');
    li.dataset.index = String(index);

    const game = (entry && (entry.game || entry.matchup || entry.title)) || 'Untitled match';
    const league = (entry && (entry.league || entry.competition)) || '—';
    const start = formatStartTime(entry && (entry.startTime || entry.kickoff || entry.startsAt));
    const quoteRaw = entry && (entry.tumboQuote ?? entry.simulatedTumbo ?? entry.pointsQuote);
    const quoteStr = formatTumboQuote(quoteRaw);

    const meta = createEl('div', 'crq-card-meta');
    meta.appendChild(createEl('div', 'crq-game', String(game)));
    meta.appendChild(createEl('div', 'crq-league', `League: ${league}`));
    meta.appendChild(createEl('div', 'crq-time', `Start: ${start}`));
    if (quoteStr) {
      meta.appendChild(createEl('div', 'crq-quote', `Quote: ${quoteStr}`));
    }
    li.appendChild(meta);

    const actions = createEl('div', 'crq-actions');

    const openBtn = createEl('button', 'crq-btn crq-btn-open', 'Open');
    openBtn.type = 'button';
    openBtn.setAttribute('aria-label', `Open contract for ${game}`);
    openBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof onOpenContract === 'function') {
        try { onOpenContract(entry); } catch (err) { console.warn('[contract-review-queue] onOpenContract failed', err); }
      }
      safeNotify(notify, { title: 'Contract opened', body: `Reviewing: ${game}` });
    });

    const approveBtn = createEl('button', 'crq-btn crq-btn-approve', 'Approve');
    approveBtn.type = 'button';
    approveBtn.setAttribute('aria-label', `Approve contract for ${game}`);
    approveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof onApprove === 'function') {
        try { onApprove(entry); } catch (err) { console.warn('[contract-review-queue] onApprove failed', err); }
      }
      safeNotify(notify, {
        title: 'Contract approved',
        body: `${game} moved toward open contract. Simulated TUMBO points only.`,
      });
    });

    const rejectBtn = createEl('button', 'crq-btn crq-btn-reject', 'Reject');
    rejectBtn.type = 'button';
    rejectBtn.setAttribute('aria-label', `Reject contract for ${game}`);
    rejectBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const reason = 'Rejected by reviewer';
      if (typeof onReject === 'function') {
        try { onReject(entry, reason); } catch (err) { console.warn('[contract-review-queue] onReject failed', err); }
      }
      safeNotify(notify, { title: 'Contract rejected', body: `${game} removed. Reason: ${reason}` });
    });

    actions.appendChild(openBtn);
    actions.appendChild(approveBtn);
    actions.appendChild(rejectBtn);
    li.appendChild(actions);
    return li;
  }

  function renderList() {
    while (list.firstChild) list.removeChild(list.firstChild);
    const items = currentDrafts;
    countBadge.textContent = String(items.length);
    emptyMsg.hidden = items.length > 0;
    list.hidden = items.length === 0;
    items.forEach((entry, i) => { list.appendChild(buildCard(entry, i)); });
  }

  function applyMobileVisibility() {
    // Mobile rule: one floating panel at a time. This panel is the review queue;
    // integrator may hide siblings. We only ensure bottom-dock + size.
    if (isMobileViewport()) {
      panel.classList.add('crq-mobile');
    } else {
      panel.classList.remove('crq-mobile');
    }
  }

  function onKeyDown(e) {
    if (disposed) return;
    if (e.key === 'Escape') {
      if (!collapsed) { setCollapsed(true); e.preventDefault(); }
    }
  }

  function onResize() {
    if (disposed) return;
    applyMobileVisibility();
  }

  collapseBtn.addEventListener('click', () => { setCollapsed(!collapsed); });
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', onResize);
  root.appendChild(panel);
  applyMobileVisibility();
  renderList();

  // Focus management for keyboard users
  if (currentDrafts.length > 0) {
    panel.focus({ preventScroll: true });
  }

  function update(nextDrafts) {
    if (disposed) return;
    currentDrafts = Array.isArray(nextDrafts) ? nextDrafts.slice() : [];
    renderList();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    document.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', onResize);
    if (panel.parentNode) panel.parentNode.removeChild(panel);
    if (style.parentNode) style.parentNode.removeChild(style);
  }

  return { update, dispose };
}

export default renderReviewQueue;
