/**
 * Token buy/sell panels — SIMULATED only.
 * Follows repo UI conventions: <aside> consoles, hidden + .visible,
 * Escape close, own close button, mobile one-panel rule via existing manager.
 *
 * Buy  = sMIMAS → TUMBO
 * Sell = TUMBO  → sMIMAS
 */

import {
  TumboToken,
  TOKEN_STUB_BOUNDARY,
  TOKEN_SUPPLY_CONFIG,
  getQuote,
  isQuoteFresh,
  settle,
  fmt,
  balance,
  attachWindowFacade,
} from "../domains/token.js";

export const TOKEN_TRADE_CONSOLE_SOURCE = "token-trade-console";
export const TOKEN_TRADE_BOUNDARY = TOKEN_STUB_BOUNDARY;

const freeze = (v) => Object.freeze(v);

function text(value, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function createEl(doc, tag, className, value) {
  const el = doc.createElement(tag);
  if (className) el.className = className;
  if (value != null) el.textContent = text(value);
  return el;
}

function ensureStyles(doc) {
  if (doc.getElementById("token-trade-styles")) return;
  const style = doc.createElement("style");
  style.id = "token-trade-styles";
  style.textContent = `
#token-buy-console,
#token-sell-console {
  position: fixed; z-index: 48; top: 72px; right: 16px;
  width: min(360px, calc(100vw - 24px)); max-height: min(78vh, 640px);
  display: flex; flex-direction: column;
  background: rgba(21, 57, 84, 0.72);
  border: 1px solid rgba(127, 212, 255, 0.45);
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(0, 12, 28, 0.45), inset 0 1px 0 rgba(127, 212, 255, 0.18);
  backdrop-filter: blur(14px);
  color: #e8f4ff; font: 13px/1.45 system-ui, sans-serif; overflow: hidden;
}
#token-buy-console[hidden], #token-sell-console[hidden] { display: none !important; }
#token-buy-console.visible, #token-sell-console.visible { display: flex; }
.token-trade-head {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; border-bottom: 1px solid rgba(127,212,255,0.22);
  cursor: grab; user-select: none; flex-shrink: 0;
}
.token-trade-head:active { cursor: grabbing; }
.token-trade-title { font-weight: 700; letter-spacing: 0.02em; flex: 1; }
.token-trade-sim {
  font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
  color: #7fd4ff; background: rgba(8,16,26,0.45);
  border: 1px solid rgba(127,212,255,0.35); border-radius: 999px;
  padding: 2px 8px; text-transform: uppercase;
}
.token-trade-btn {
  appearance: none; border: 1px solid rgba(127,212,255,0.35);
  background: rgba(8,16,26,0.4); color: #e8f4ff;
  border-radius: 8px; padding: 6px 10px; font: inherit; cursor: pointer;
}
.token-trade-btn:hover { border-color: #7fd4ff; }
.token-trade-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.token-trade-btn-primary {
  background: rgba(54,166,211,0.35); border-color: #36a6d3; font-weight: 600;
}
.token-trade-body {
  padding: 12px; overflow-y: auto; flex: 1; min-height: 0;
  display: flex; flex-direction: column; gap: 10px;
}
.token-trade-label { font-size: 11px; letter-spacing: 0.04em; color: #9ec9e8; text-transform: uppercase; }
.token-trade-input {
  width: 100%; box-sizing: border-box;
  background: rgba(8,16,26,0.55); border: 1px solid rgba(127,212,255,0.3);
  border-radius: 8px; color: #e8f4ff; padding: 8px 10px; font: inherit;
}
.token-trade-quote {
  background: rgba(8,16,26,0.4); border: 1px solid rgba(127,212,255,0.25);
  border-radius: 10px; padding: 10px; display: flex; flex-direction: column; gap: 4px;
}
.token-trade-quote-empty { color: #9ec9e8; font-style: italic; }
.token-trade-countdown { font-variant-numeric: tabular-nums; color: #7fd4ff; font-weight: 600; }
.token-trade-countdown.expired { color: #f08a9a; }
.token-trade-confirm {
  background: rgba(8,16,26,0.5); border: 1px dashed rgba(127,212,255,0.35);
  border-radius: 10px; padding: 10px; display: none; flex-direction: column; gap: 4px;
}
.token-trade-confirm.open { display: flex; }
.token-trade-tithe { color: #f0c27a; font-weight: 600; }
.token-trade-boundary {
  font-size: 11px; color: #9ec9e8; border-top: 1px solid rgba(127,212,255,0.18);
  padding-top: 8px; margin-top: 4px;
}
.token-trade-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.token-trade-toast {
  position: fixed; z-index: 60; left: 50%; bottom: 24px; transform: translateX(-50%);
  background: rgba(21,57,84,0.92); border: 1px solid rgba(127,212,255,0.5);
  border-radius: 12px; padding: 12px 16px; color: #e8f4ff; max-width: min(420px, calc(100vw - 24px));
  box-shadow: 0 10px 30px rgba(0,0,0,0.4); font: 13px/1.4 system-ui, sans-serif;
}
.token-trade-chip {
  position: fixed; z-index: 47; bottom: 16px; right: 16px;
  background: rgba(21,57,84,0.75); border: 1px solid rgba(127,212,255,0.4);
  border-radius: 999px; padding: 6px 12px; color: #7fd4ff; font: 11px/1 system-ui, sans-serif;
  cursor: pointer; backdrop-filter: blur(10px); display: none;
}
.token-trade-chip.visible { display: inline-flex; align-items: center; gap: 6px; }
@media (max-width: 700px) {
  #token-buy-console, #token-sell-console {
    top: auto; bottom: 0; right: 0; left: 0;
    width: 100%; max-height: min(70vh, 560px);
    border-radius: 16px 16px 0 0;
  }
}
`;
  doc.head.appendChild(style);
}

function ensurePanelMarkup(doc, { id, title, action }) {
  let panel = doc.getElementById(id);
  if (panel) return panel;
  panel = doc.createElement("aside");
  panel.id = id;
  panel.hidden = true;
  panel.setAttribute("aria-hidden", "true");
  panel.setAttribute("aria-label", title);
  panel.innerHTML = `
    <div class="token-trade-head" data-drag-handle>
      <span class="token-trade-title">${title}</span>
      <span class="token-trade-sim">SIMULATED — not real money</span>
      <button type="button" class="token-trade-btn" data-action="minimize" title="Minimize" aria-label="Minimize">–</button>
      <button type="button" class="token-trade-btn" data-action="close" title="Close" aria-label="Close">×</button>
    </div>
    <div class="token-trade-body">
      <label class="token-trade-label" for="${id}-amount">Amount (fluff units)</label>
      <input id="${id}-amount" class="token-trade-input" type="number" min="1" step="1" inputmode="numeric" placeholder="e.g. 1000" />
      <div class="token-trade-actions">
        <button type="button" class="token-trade-btn token-trade-btn-primary" data-action="quote">Get quote</button>
        <button type="button" class="token-trade-btn" data-action="requote" disabled>Re-quote</button>
      </div>
      <div class="token-trade-quote" data-role="quote">
        <div class="token-trade-quote-empty">No quote yet. Enter an amount and request a simulated quote.</div>
      </div>
      <div class="token-trade-confirm" data-role="confirm">
        <strong>Confirm ${action === "buy" ? "buy" : "sell"} (simulated)</strong>
        <div data-role="confirm-lines"></div>
        <div class="token-trade-actions" style="margin-top:8px">
          <button type="button" class="token-trade-btn token-trade-btn-primary" data-action="confirm">Confirm settle</button>
          <button type="button" class="token-trade-btn" data-action="cancel-confirm">Cancel</button>
        </div>
      </div>
      <div class="token-trade-boundary">${TOKEN_STUB_BOUNDARY}</div>
    </div>
  `;
  doc.body.appendChild(panel);
  return panel;
}

function ensureChip(doc, { id, label }) {
  const chipId = `${id}-chip`;
  let chip = doc.getElementById(chipId);
  if (chip) return chip;
  chip = doc.createElement("button");
  chip.type = "button";
  chip.id = chipId;
  chip.className = "token-trade-chip";
  chip.textContent = label;
  chip.setAttribute("aria-label", `Restore ${label}`);
  doc.body.appendChild(chip);
  return chip;
}

function storageKey(id) {
  return `tumbo:token-panel-pos:${id}`;
}

function loadPosition(id) {
  try {
    const raw = localStorage.getItem(storageKey(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Number.isFinite(parsed?.left) && Number.isFinite(parsed?.top)) return parsed;
  } catch { /* ignore */ }
  return null;
}

function savePosition(id, left, top) {
  try {
    localStorage.setItem(storageKey(id), JSON.stringify({ left, top }));
  } catch { /* ignore */ }
}

function applyPosition(panel, pos) {
  if (!pos || window.matchMedia("(max-width:700px)").matches) return;
  panel.style.left = `${pos.left}px`;
  panel.style.top = `${pos.top}px`;
  panel.style.right = "auto";
}

function enableDrag(panel, id) {
  const handle = panel.querySelector("[data-drag-handle]");
  if (!handle) return;
  let dragging = false;
  let ox = 0;
  let oy = 0;
  handle.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    if (window.matchMedia("(max-width:700px)").matches) return;
    dragging = true;
    const rect = panel.getBoundingClientRect();
    ox = e.clientX - rect.left;
    oy = e.clientY - rect.top;
    handle.setPointerCapture?.(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const left = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - ox));
    const top = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - oy));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = "auto";
  });
  const end = () => {
    if (!dragging) return;
    dragging = false;
    const rect = panel.getBoundingClientRect();
    savePosition(id, rect.left, rect.top);
  };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

export function createTokenTradeConsole({
  action = "buy",
  documentRoot = globalThis.document,
  acct = "local-participant",
  onSettled = null,
} = {}) {
  if (!documentRoot?.body) throw new Error("Token trade console needs a document body");
  if (action !== "buy" && action !== "sell") throw new TypeError("action must be buy or sell");

  attachWindowFacade(typeof window !== "undefined" ? window : null);
  ensureStyles(documentRoot);

  const id = action === "buy" ? "token-buy-console" : "token-sell-console";
  const title = action === "buy" ? "Buy TUMBO (sMIMAS → TUMBO)" : "Sell TUMBO (TUMBO → sMIMAS)";
  const panel = ensurePanelMarkup(documentRoot, { id, title, action });
  const chip = ensureChip(documentRoot, {
    id,
    label: action === "buy" ? "Buy TUMBO · SIM" : "Sell TUMBO · SIM",
  });

  const amountInput = panel.querySelector(`#${id}-amount`);
  const quoteEl = panel.querySelector('[data-role="quote"]');
  const confirmEl = panel.querySelector('[data-role="confirm"]');
  const confirmLines = panel.querySelector('[data-role="confirm-lines"]');
  const btnQuote = panel.querySelector('[data-action="quote"]');
  const btnRequote = panel.querySelector('[data-action="requote"]');
  const btnConfirm = panel.querySelector('[data-action="confirm"]');
  const btnCancelConfirm = panel.querySelector('[data-action="cancel-confirm"]');
  const btnClose = panel.querySelector('[data-action="close"]');
  const btnMin = panel.querySelector('[data-action="minimize"]');

  let opened = false;
  let currentQuote = null;
  let countdownTimer = null;
  let toastTimer = null;

  applyPosition(panel, loadPosition(id));
  enableDrag(panel, id);

  function setOpen(next) {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.classList.toggle("visible", opened);
    panel.setAttribute("aria-hidden", String(!opened));
    chip.classList.toggle("visible", false);
    if (!opened) stopCountdown();
  }

  function minimize() {
    if (!opened) return;
    opened = false;
    panel.hidden = true;
    panel.classList.remove("visible");
    panel.setAttribute("aria-hidden", "true");
    chip.classList.add("visible");
    stopCountdown();
  }

  function stopCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
  }

  function remainingMs(quote, now = Date.now()) {
    if (!quote) return 0;
    return Math.max(0, quote.expiresAt - now);
  }

  function renderQuote(quote, { expired = false } = {}) {
    quoteEl.replaceChildren();
    if (!quote) {
      quoteEl.appendChild(createEl(documentRoot, "div", "token-trade-quote-empty", "No market quote right now"));
      btnRequote.disabled = true;
      btnConfirm.disabled = true;
      confirmEl.classList.remove("open");
      return;
    }
    const secs = Math.ceil(remainingMs(quote) / 1000);
    quoteEl.append(
      createEl(documentRoot, "div", null, `Route: ${quote.from} → ${quote.to}`),
      createEl(documentRoot, "div", null, `In: ${fmt(quote.amountIn)} · Out: ${fmt(quote.amountOut)} (display units)`),
      createEl(documentRoot, "div", null, `Hash: ${quote.hash}`),
      createEl(
        documentRoot,
        "div",
        `token-trade-countdown${expired || secs <= 0 ? " expired" : ""}`,
        expired || secs <= 0 ? "Quote expired — re-quote required" : `Expires in ${secs}s`,
      ),
      createEl(documentRoot, "div", "token-trade-sim", "SIMULATED — not real money"),
    );
    btnRequote.disabled = false;
    btnConfirm.disabled = expired || secs <= 0;
  }

  function startCountdown() {
    stopCountdown();
    countdownTimer = setInterval(() => {
      if (!currentQuote) return;
      if (!isQuoteFresh(currentQuote)) {
        renderQuote(currentQuote, { expired: true });
        btnConfirm.disabled = true;
        stopCountdown();
        return;
      }
      renderQuote(currentQuote);
    }, 250);
  }

  function requestQuote() {
    const amountIn = Math.floor(Number(amountInput.value));
    if (!Number.isSafeInteger(amountIn) || amountIn <= 0) {
      currentQuote = null;
      quoteEl.replaceChildren();
      quoteEl.appendChild(
        createEl(documentRoot, "div", "token-trade-quote-empty", "Enter a positive integer fluff amount."),
      );
      return null;
    }
    const quote = getQuote({ action, amountIn });
    currentQuote = quote;
    renderQuote(quote);
    if (quote) startCountdown();
    else stopCountdown();
    confirmEl.classList.remove("open");
    return quote;
  }

  function openConfirm() {
    if (!currentQuote || !isQuoteFresh(currentQuote)) {
      requestQuote();
      if (!currentQuote || !isQuoteFresh(currentQuote)) {
        renderQuote(currentQuote, { expired: true });
        return;
      }
    }
    const q = currentQuote;
    const tithe = Math.floor((q.amountOut * TOKEN_SUPPLY_CONFIG.VOID_TITHE_BPS) / 10_000);
    const net = q.amountOut - tithe;
    confirmLines.replaceChildren();
    confirmLines.append(
      createEl(documentRoot, "div", null, `In:  ${fmt(q.amountIn)} ${q.from}`),
      createEl(documentRoot, "div", null, `Out: ${fmt(q.amountOut)} ${q.to}`),
      createEl(documentRoot, "div", "token-trade-tithe", `Void tithe (10 bps): ${fmt(tithe)} ${q.to}`),
      createEl(documentRoot, "div", null, `Net received: ${fmt(net)} ${q.to}`),
      createEl(documentRoot, "div", "token-trade-sim", "SIMULATED — not real money"),
    );
    confirmEl.classList.add("open");
    btnConfirm.disabled = !isQuoteFresh(q);
  }

  function showToast(message) {
    let toast = documentRoot.getElementById("token-trade-toast");
    if (!toast) {
      toast = documentRoot.createElement("div");
      toast.id = "token-trade-toast";
      toast.className = "token-trade-toast";
      documentRoot.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
  }

  function doConfirm() {
    if (!currentQuote) return;
    if (!isQuoteFresh(currentQuote)) {
      const refreshed = requestQuote();
      showToast("Quote expired — refreshed. Review the new quote before confirming. (SIMULATED)");
      if (refreshed) openConfirm();
      return;
    }
    const result = settle(acct, currentQuote);
    if (!result.ok) {
      if (result.reason === "quote-expired") {
        requestQuote();
        showToast("Quote expired on settle — re-quoted. (SIMULATED)");
      } else {
        showToast(`Settle blocked: ${result.reason} (SIMULATED — not real money)`);
      }
      return;
    }
    const tx = result.tx;
    showToast(
      `Receipt · ${tx.action.toUpperCase()} · in ${fmt(tx.amountIn)} → net ${fmt(tx.netOut)} · Void tithe ${fmt(tx.voidTithe)} · SIMULATED — not real money`,
    );
    confirmEl.classList.remove("open");
    currentQuote = null;
    renderQuote(null);
    stopCountdown();
    onSettled?.(result);
  }

  btnQuote.addEventListener("click", () => requestQuote());
  btnRequote.addEventListener("click", () => requestQuote());
  btnConfirm.addEventListener("click", () => {
    if (!confirmEl.classList.contains("open")) {
      openConfirm();
      return;
    }
    doConfirm();
  });
  btnCancelConfirm.addEventListener("click", () => confirmEl.classList.remove("open"));
  btnClose.addEventListener("click", () => setOpen(false));
  btnMin.addEventListener("click", () => minimize());
  chip.addEventListener("click", () => setOpen(true));

  documentRoot.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && opened) setOpen(false);
  });

  return freeze({
    id,
    action,
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => (opened ? setOpen(false) : setOpen(true)),
    minimize,
    requestQuote,
    confirmStep: openConfirm,
    getQuote: () => currentQuote,
    isOpen: () => opened,
    destroy() {
      stopCountdown();
      if (toastTimer) clearTimeout(toastTimer);
    },
  });
}

export function createTokenBuyConsole(opts = {}) {
  return createTokenTradeConsole({ ...opts, action: "buy" });
}

export function createTokenSellConsole(opts = {}) {
  return createTokenTradeConsole({ ...opts, action: "sell" });
}

export default createTokenTradeConsole;
