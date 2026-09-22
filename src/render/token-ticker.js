/** token-ticker.js — Token ticker + live state panel.
 *
 * Token workstream 9 (ticker + live state panel), built locally.
 * Read-only projection over the canonical TUMBO-SIM token core
 * (docs/TOKEN-CONTRACT.md, PR #6 src/domains/token.js).
 *
 * - Small by default: a chip strip with live balances; the live state body
 *   expands on interaction via centered-surfaces (drag, depth, remembered
 *   position come free from the shared panel manager).
 * - Subscribes to the facade 'balance-changed' / 'receipt' events and also
 *   listens for the document 'tumbo:token' CustomEvent; refreshes the
 *   reversal-window countdowns on a short interval.
 * - If the unified token core is not present in this build, degrades to a
 *   calm empty state — no error wall.
 * - Never mutates the ledger. The only engine touch is ensureTumboTokenFacade,
 *   which applies the contract's sanctioned demo seed.
 * - Simulation-only: every surface carries the simulated notice.
 */

const SIM_NOTICE = 'Simulated points only — never real money or wagering.';
const TICKER_ID = 'token-ticker';
const DEFAULT_ACCOUNT = 'you';
const TUMBO_SIM = 'TUMBO-SIM';
const SMIMAS = 'sMIMAS';
const FALLBACK_REVERSE_WINDOW_TICKS = 1000;
const REFRESH_MS = 5000;
const MAX_ACTIVITY_ROWS = 8;
const MAX_CHAIN_ROWS = 6;
const MAX_MARKET_ROWS = 3;

let mounted = false;

/* ------------------------------------------------------------------ */
/* Pure helpers (unit-tested, no DOM).                                  */
/* ------------------------------------------------------------------ */

/** Escape a string for HTML insertion. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Reversal-window status for one receipt tick against the current tick.
 * Returns { eligible, ticksLeft } — pure, contract REVERSE_WINDOW_TICKS=1000.
 */
export function reversalWindowInfo(receiptTick, currentTick, windowTicks = FALLBACK_REVERSE_WINDOW_TICKS) {
  const rt = Number(receiptTick);
  const ct = Number(currentTick);
  const wt = Number(windowTicks);
  if (!Number.isFinite(rt) || !Number.isFinite(ct) || !Number.isFinite(wt) || wt <= 0) {
    return { eligible: false, ticksLeft: 0 };
  }
  const elapsed = ct - rt;
  if (elapsed < 0) return { eligible: false, ticksLeft: 0 };
  const ticksLeft = wt - elapsed;
  return { eligible: ticksLeft > 0, ticksLeft: Math.max(0, Math.floor(ticksLeft)) };
}

/** Shorten a chain hash for display (first 10 hex chars). Pure. */
export function shortHash(hash) {
  const h = String(hash ?? '');
  return h.length > 12 ? `${h.slice(0, 10)}…` : h;
}

/** Verify one chain link: row.prevHash matches the previous row's hash. Pure. */
export function checkChainLinkage(rows) {
  const list = Array.isArray(rows) ? rows : [];
  for (let i = 0; i + 1 < list.length; i++) {
    const newer = list[i] || {};
    const older = list[i + 1] || {};
    if (newer.prevHash && older.hash && newer.prevHash !== older.hash) {
      return { ok: false, badIndex: i };
    }
  }
  return { ok: true, badIndex: -1 };
}

/** Human label for a verifyChain() result. Pure. */
export function chainStatusLabel(result) {
  if (!result || typeof result !== 'object') return 'unknown';
  if (result.ok === true) return 'verified';
  if (result.ok === false) return 'broken';
  return 'unknown';
}

/** Summarize one wallet history row for the activity list. Pure. */
export function activitySummary(row) {
  const r = row || {};
  const kind = String(r.kind ?? 'activity');
  const asset = String(r.asset ?? TUMBO_SIM);
  const amount = Number(r.amountFluff);
  const who = r.to && r.from && r.to !== r.from ? `${r.from} → ${r.to}` : String(r.from ?? '');
  return {
    kind,
    asset,
    amountFluff: Number.isSafeInteger(amount) ? amount : 0,
    who,
    at: String(r.at ?? ''),
    id: String(r.id ?? ''),
  };
}

/** Summarize one journal row for the chain list. Pure. */
export function journalSummary(row, currentTick, windowTicks) {
  const r = row || {};
  const info = reversalWindowInfo(r.tick, currentTick, windowTicks);
  return {
    id: String(r.id ?? ''),
    action: String(r.action ?? 'post'),
    seq: r.seq ?? r.tick ?? '',
    tick: Number(r.tick) || 0,
    hash: shortHash(r.hash),
    prevHash: shortHash(r.prevHash),
    reversible: info.eligible,
    ticksLeft: info.ticksLeft,
  };
}

/* ------------------------------------------------------------------ */
/* Facade resolution.                                                  */
/* ------------------------------------------------------------------ */

/** Resolve the canonical token facade, or null when the core is absent. */
export async function resolveTokenFacade() {
  try {
    if (typeof window !== 'undefined' && window.TumboToken) return window.TumboToken;
  } catch { /* ignore */ }
  try {
    const mod = await import('../domains/token.js?v=20260922-cache2');
    if (mod && typeof mod.ensureTumboTokenFacade === 'function') {
      return mod.ensureTumboTokenFacade({ seed: true });
    }
    if (mod && typeof mod.getTumboTokenFacade === 'function') {
      return mod.getTumboTokenFacade();
    }
  } catch { /* core not present in this build */ }
  return null;
}

/* ------------------------------------------------------------------ */
/* Rendering.                                                         */
/* ------------------------------------------------------------------ */

function rowHtml(k, v, cls = '') {
  return `<div class="token-ticker-row"><span class="k">${escapeHtml(k)}</span><span class="v ${cls}">${v}</span></div>`;
}

function balancesSection(facade) {
  const acct = DEFAULT_ACCOUNT;
  let tumbo = null;
  let smimas = null;
  let locked = null;
  try {
    tumbo = facade.balance(acct, TUMBO_SIM);
    smimas = facade.balance(acct, SMIMAS);
    const vault = facade.ledger && typeof facade.ledger.vault === 'function'
      ? facade.ledger.vault(acct, TUMBO_SIM)
      : null;
    locked = vault ? vault.totalLockedFluff : 0;
  } catch { /* read failed; show dashes */ }
  const fmt = (n) => (typeof n === 'number' && Number.isSafeInteger(n) ? facade.fmt(n) : '—');
  return `<div class="token-ticker-section" aria-label="Balances">
    <h3>Balances · ${escapeHtml(acct)}</h3>
    <div class="token-ticker-rows">
      ${rowHtml(TUMBO_SIM, escapeHtml(fmt(tumbo)))}
      ${rowHtml(SMIMAS, escapeHtml(fmt(smimas)))}
      ${rowHtml('Vault locked', escapeHtml(fmt(locked)), 'dim')}
    </div>
  </div>`;
}

function activitySection(facade) {
  let rows = [];
  try {
    rows = facade.ledger && typeof facade.ledger.history === 'function'
      ? facade.ledger.history({ limit: MAX_ACTIVITY_ROWS })
      : [];
  } catch { rows = []; }
  const items = rows.map(activitySummary).map((r) => {
    const amount = Number.isSafeInteger(r.amountFluff) ? facade.fmt(r.amountFluff) : '—';
    const meta = `${escapeHtml(r.kind)} · ${escapeHtml(r.asset)}`;
    return `<div class="token-ticker-row"><span class="k">${meta}<br><span class="dim">${escapeHtml(r.who)}</span></span><span class="v">${escapeHtml(amount)}</span></div>`;
  }).join('');
  return `<div class="token-ticker-section" aria-label="Recent activity">
    <h3>Recent activity</h3>
    <div class="token-ticker-rows">${items || '<div class="token-ticker-empty">No simulated activity yet.</div>'}</div>
  </div>`;
}

function chainSection(facade, currentTick, windowTicks) {
  let journals = [];
  let chain = { ok: null };
  try {
    const res = facade.journalHistory({ limit: MAX_CHAIN_ROWS });
    journals = (res && res.rows) || [];
  } catch { journals = []; }
  try {
    chain = facade.verifyChain() || { ok: null };
  } catch { chain = { ok: null }; }
  const linkage = checkChainLinkage(journals);
  const items = journals.map((j) => journalSummary(j, currentTick, windowTicks)).map((s) => {
    const rev = s.reversible
      ? `<span class="token-ticker-countdown">reversible · ${s.ticksLeft} ticks left</span>`
      : `<span class="dim">window closed</span>`;
    return `<div class="token-ticker-row"><span class="k"><span class="token-ticker-hash">${escapeHtml(s.hash)}</span><br><span class="dim">${escapeHtml(s.action)} · seq ${escapeHtml(String(s.seq))} · tick ${s.tick}</span></span><span class="v">${rev}</span></div>`;
  }).join('');
  const statusCls = chain.ok === true ? 'good' : (chain.ok === false ? 'bad' : 'dim');
  return `<div class="token-ticker-section" aria-label="Receipt chain">
    <h3>EchoProof chain</h3>
    <div class="token-ticker-rows">
      ${rowHtml('Chain status', escapeHtml(chainStatusLabel(chain)), statusCls)}
      ${rowHtml('Linkage (shown)', linkage.ok ? 'intact' : `broken at row ${linkage.badIndex}`, linkage.ok ? 'good' : 'bad')}
      ${rowHtml('Ledger tick', String(currentTick))}
      ${items || '<div class="token-ticker-empty">No receipts yet.</div>'}
    </div>
  </div>`;
}

function marketSection(facade) {
  let marketTumbo = null;
  let marketSmimas = null;
  let journals = [];
  try {
    marketTumbo = facade.balance('sys:market', 'TUMBO');
    marketSmimas = facade.balance('sys:market', 'sMIMAS');
  } catch { /* system reads may fail; show dashes */ }
  try {
    const res = facade.journalHistory({ limit: 40 });
    journals = ((res && res.rows) || []).filter((r) => ['exchange', 'buy', 'sell'].includes(r.action)).slice(0, MAX_MARKET_ROWS);
  } catch { journals = []; }
  const fmt = (n) => (typeof n === 'number' && Number.isSafeInteger(n) ? facade.fmt(n) : '—');
  const items = journals.map((j) => {
    const s = journalSummary(j, 0, 0);
    return `<div class="token-ticker-row"><span class="k">${escapeHtml(s.action)}<br><span class="dim token-ticker-hash">${escapeHtml(s.hash)}</span></span><span class="v dim">tick ${s.tick}</span></div>`;
  }).join('');
  return `<div class="token-ticker-section" aria-label="Market state">
    <h3>Market · sys:market</h3>
    <div class="token-ticker-rows">
      ${rowHtml('TUMBO float', escapeHtml(fmt(marketTumbo)))}
      ${rowHtml('sMIMAS inventory', escapeHtml(fmt(marketSmimas)))}
      ${items || '<div class="token-ticker-empty">No market settlements yet.</div>'}
    </div>
  </div>`;
}

function systemSection(facade) {
  let voidBal = null;
  let escrowBal = null;
  let vaultBal = null;
  try {
    voidBal = facade.balance('sys:void', 'TUMBO');
    escrowBal = facade.balance('sys:escrow', 'TUMBO');
    vaultBal = facade.balance('sys:vault', 'TUMBO');
  } catch { /* ignore */ }
  const fmt = (n) => (typeof n === 'number' && Number.isSafeInteger(n) ? facade.fmt(n) : '—');
  return `<div class="token-ticker-section" aria-label="System accounts">
    <h3>System accounts</h3>
    <div class="token-ticker-rows">
      ${rowHtml('Void tithe (never debited)', escapeHtml(fmt(voidBal)), 'dim')}
      ${rowHtml('Escrow (pending intents)', escapeHtml(fmt(escrowBal)), 'dim')}
      ${rowHtml('Vault (locks/stakes)', escapeHtml(fmt(vaultBal)), 'dim')}
    </div>
  </div>`;
}

function stripHtml(facade) {
  let tumbo = null;
  let smimas = null;
  try {
    tumbo = facade.balance(DEFAULT_ACCOUNT, TUMBO_SIM);
    smimas = facade.balance(DEFAULT_ACCOUNT, SMIMAS);
  } catch { /* ignore */ }
  const fmt = (n) => (typeof n === 'number' && Number.isSafeInteger(n) ? facade.fmt(n) : '—');
  return `<div class="token-ticker-strip" aria-live="polite">
    <span class="token-ticker-dot" aria-hidden="true"></span>
    <span class="token-ticker-balances">${escapeHtml(fmt(tumbo))} · ${escapeHtml(fmt(smimas))}</span>
    <span class="token-ticker-acct">TUMBO-SIM · ${escapeHtml(DEFAULT_ACCOUNT)}</span>
  </div>`;
}

function emptyStripHtml() {
  return `<div class="token-ticker-strip" aria-live="polite">
    <span class="token-ticker-dot is-off" aria-hidden="true"></span>
    <span class="token-ticker-balances">TUMBO-SIM · core not loaded</span>
    <span class="token-ticker-acct">simulated</span>
  </div>`;
}

function emptyBodyHtml() {
  return `<div class="token-ticker-body">
    <p class="token-ticker-kicker">Token · live state</p>
    <div class="token-ticker-empty">The unified token core is not loaded in this build, so simulated balances are unavailable. Nothing here can move real money.</div>
    <p class="token-ticker-notice">${escapeHtml(SIM_NOTICE)}</p>
  </div>`;
}

/** Mount the ticker. Returns a teardown handle. Safe to call once. */
export function mountTokenTicker({ documentRoot = (typeof document !== 'undefined' ? document : null) } = {}) {
  if (mounted) return () => {};
  mounted = true;
  if (!documentRoot) return () => {};

  // Stylesheet (person-studio pattern: link injected from the module).
  try {
    const link = documentRoot.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./token-ticker.css', import.meta.url).href;
    documentRoot.head.append(link);
  } catch { /* CSS is cosmetic; never break the panel */ }

  let aside = documentRoot.getElementById(TICKER_ID);
  if (!aside) {
    aside = documentRoot.createElement('aside');
    aside.id = TICKER_ID;
    documentRoot.body.append(aside);
  }
  aside.setAttribute('aria-label', 'TUMBO-SIM token ticker and live state');
  aside.innerHTML = `${emptyStripHtml()}<div class="token-ticker-body"><p class="token-ticker-kicker">Token · live state</p><div class="token-ticker-empty">Loading simulated token state…</div><p class="token-ticker-notice">${escapeHtml(SIM_NOTICE)}</p></div>`;

  let facade = null;
  let windowTicks = FALLBACK_REVERSE_WINDOW_TICKS;
  let timer = 0;
  let unsubscribers = [];
  let disposed = false;
  const MAX_BOOT_ATTEMPTS = 3;

  const render = () => {
    if (disposed || !facade) return;
    let currentTick = 0;
    try { currentTick = Number(facade.tick()) || 0; } catch { /* ignore */ }
    try {
      aside.innerHTML = `${stripHtml(facade)}<div class="token-ticker-body">
        <p class="token-ticker-kicker">Token · live state</p>
        ${balancesSection(facade)}
        ${activitySection(facade)}
        ${chainSection(facade, currentTick, windowTicks)}
        ${marketSection(facade)}
        ${systemSection(facade)}
        <p class="token-ticker-notice">${escapeHtml(SIM_NOTICE)}</p>
      </div>`;
    } catch {
      /* A bad render never takes the panel down; next tick retries. */
    }
  };

  const schedule = () => {
    render();
    timer = setTimeout(schedule, REFRESH_MS);
  };

  /** Boot (or re-boot) the facade link. Retries a few times so a slow or
   * backlogged module graph cannot leave the ticker permanently dark. */
  const boot = (attempt = 1) => {
    if (disposed || facade) return;
    (async () => {
      const found = await resolveTokenFacade();
      if (disposed || facade) return;
      if (!found) {
        aside.innerHTML = `${emptyStripHtml()}${emptyBodyHtml()}`;
        if (attempt < MAX_BOOT_ATTEMPTS) {
          setTimeout(() => boot(attempt + 1), 3000 * attempt);
        }
        return;
      }
      facade = found;
      try {
        const mod = await import('../domains/token.js?v=20260922-cache2');
        if (mod && Number.isFinite(Number(mod.REVERSE_WINDOW_TICKS))) {
          windowTicks = Number(mod.REVERSE_WINDOW_TICKS);
        }
      } catch { /* contract fallback (1000) stands */ }
      try {
        const off1 = facade.on('balance-changed', () => render());
        const off2 = facade.on('receipt', () => render());
        if (typeof off1 === 'function') unsubscribers.push(off1);
        if (typeof off2 === 'function') unsubscribers.push(off2);
      } catch { /* events are best-effort; the interval still refreshes */ }
      schedule();
    })();
  };

  // If the unified core boots after the ticker and installs window.TumboToken,
  // its first 'tumbo:token' event re-arms the link without a reload.
  try {
    documentRoot.addEventListener('tumbo:token', () => { if (!facade) boot(1); }, { once: true });
  } catch { /* ignore */ }
  boot(1);

  return () => {
    disposed = true;
    mounted = false;
    if (timer) clearTimeout(timer);
    for (const off of unsubscribers) { try { off(); } catch { /* ignore */ } }
    unsubscribers = [];
  };
}
