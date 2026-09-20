/**
 * STUB WIRING — src/domains/token.js did not exist on main.
 * This module is a clearly-marked simulation-only facade for workstream 8
 * (token buy/sell panels). It is NOT an issuer, wallet, custody service,
 * signer, settlement engine, exchange, or financial instrument.
 *
 * Contract:
 *   - Integer fluff units (1 TUMBO-SIM = 1000 fluff; display divides by 1000)
 *   - Assets: TUMBO, sMIMAS — supply from ONE config constant only
 *   - Facade: window.TumboToken = { ledger, balance, fmt, on }
 *   - Events: document CustomEvent('tumbo:token', { detail: { type, tx, ... } })
 *   - Quote shape: { id, action, from, to, amountIn, amountOut, expiresAt, hash }
 *   - 10 bps Void tithe on settle, reported on receipts
 *   - Every surface is SIMULATED — not real money
 */

export const TOKEN_STUB_BOUNDARY =
  "SIMULATED — not real money. Local projection only. No wallet, custody, signing, settlement, or external transfer authority.";

/** Single supply config. Never hardcode or publicly quote a supply number elsewhere. */
export const TOKEN_SUPPLY_CONFIG = Object.freeze({
  TUMBO_FLUFF: 1_000_000_000_000, // internal fluff; display via fmt()
  SMIMAS_FLUFF: 500_000_000_000,
  FLUFF_PER_UNIT: 1000, // 1 TUMBO-SIM display unit = 1000 fluff
  VOID_TITHE_BPS: 10, // 10 basis points on settle
  QUOTE_TTL_MS: 15_000,
  SIMULATION: true,
});

export const TOKEN_ASSETS = Object.freeze(["TUMBO", "sMIMAS"]);
export const TOKEN_EVENT = "tumbo:token";
export const TOKEN_SOURCE = "tumbo-token-stub";

const freeze = (v) => Object.freeze(v);

function requireAsset(asset) {
  if (!TOKEN_ASSETS.includes(asset)) throw new TypeError(`Unknown asset: ${asset}`);
  return asset;
}

function requireAcct(acct) {
  if (typeof acct !== "string" || !acct.trim()) throw new TypeError("acct must be a non-empty string");
  return acct.trim();
}

function requirePositiveInt(n, field) {
  if (!Number.isSafeInteger(n) || n < 0) throw new TypeError(`${field} must be a safe non-negative integer fluff amount`);
  return n;
}

/** Format fluff integer → display string (divide by 1000). */
export function fmt(fluff) {
  const n = Number(fluff);
  if (!Number.isFinite(n)) return "—";
  const units = n / TOKEN_SUPPLY_CONFIG.FLUFF_PER_UNIT;
  return units.toLocaleString(undefined, { maximumFractionDigits: 3, minimumFractionDigits: 0 });
}

/** Simple deterministic hash for quote ids (simulation only). */
function simHash(parts) {
  const text = parts.map(String).join("|");
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `qh_${(h >>> 0).toString(16).padStart(8, "0")}`;
}

function emit(type, detail = {}) {
  const payload = freeze({
    type,
    simulation: true,
    localOnly: true,
    executable: false,
    externalNetwork: false,
    externalTransfer: false,
    boundary: TOKEN_STUB_BOUNDARY,
    ...detail,
  });
  if (typeof document !== "undefined" && typeof document.dispatchEvent === "function") {
    try {
      document.dispatchEvent(new CustomEvent(TOKEN_EVENT, { detail: payload }));
    } catch {
      /* non-DOM test environments */
    }
  }
  for (const cb of listeners.get(type) || []) {
    try {
      cb(payload);
    } catch {
      /* ignore listener errors */
    }
  }
  for (const cb of listeners.get("*") || []) {
    try {
      cb(payload);
    } catch {
      /* ignore */
    }
  }
  return payload;
}

const listeners = new Map();

/** In-memory ledger: acct → { TUMBO: fluff, sMIMAS: fluff } */
const ledger = new Map();

function ensureAcct(acct) {
  const key = requireAcct(acct);
  if (!ledger.has(key)) {
    ledger.set(
      key,
      freeze({
        TUMBO: Math.floor(TOKEN_SUPPLY_CONFIG.TUMBO_FLUFF / 100),
        sMIMAS: Math.floor(TOKEN_SUPPLY_CONFIG.SMIMAS_FLUFF / 50),
      }),
    );
  }
  return ledger.get(key);
}

export function balance(acct, asset) {
  const a = requireAsset(asset);
  const row = ensureAcct(acct);
  return row[a] ?? 0;
}

export function on(evt, cb) {
  if (typeof cb !== "function") throw new TypeError("cb must be a function");
  const key = evt || "*";
  if (!listeners.has(key)) listeners.set(key, new Set());
  listeners.get(key).add(cb);
  return () => listeners.get(key)?.delete(cb);
}

/**
 * Simulated quote provider.
 * Buy  = sMIMAS → TUMBO  (from=sMIMAS, to=TUMBO)
 * Sell = TUMBO  → sMIMAS (from=TUMBO,  to=sMIMAS)
 * Returns quote object or null when no market (never throws an error wall).
 */
export function getQuote({ action, amountIn, now = Date.now() } = {}) {
  if (action !== "buy" && action !== "sell") return null;
  const amt = Number(amountIn);
  if (!Number.isSafeInteger(amt) || amt <= 0) return null;

  if (amt % 7777 === 0) return null;

  const from = action === "buy" ? "sMIMAS" : "TUMBO";
  const to = action === "buy" ? "TUMBO" : "sMIMAS";
  const amountOut = amt;
  const expiresAt = now + TOKEN_SUPPLY_CONFIG.QUOTE_TTL_MS;
  const id = `q_${action}_${now}_${amt}`;
  const hash = simHash([id, action, from, to, amt, amountOut, expiresAt]);

  return freeze({
    id,
    action,
    from,
    to,
    amountIn: amt,
    amountOut,
    expiresAt,
    hash,
    simulation: true,
    localOnly: true,
    boundary: TOKEN_STUB_BOUNDARY,
  });
}

export function isQuoteFresh(quote, now = Date.now()) {
  return Boolean(quote && Number.isFinite(quote.expiresAt) && quote.expiresAt > now);
}

/**
 * Settle a quote. Applies 10 bps Void tithe on the outbound amount.
 * Rejects expired quotes. Emits balance-changed + receipt events.
 */
export function settle(acct, quote, { now = Date.now() } = {}) {
  if (!quote || !isQuoteFresh(quote, now)) {
    return freeze({
      ok: false,
      reason: "quote-expired",
      simulation: true,
      boundary: TOKEN_STUB_BOUNDARY,
    });
  }

  const key = requireAcct(acct);
  const from = requireAsset(quote.from);
  const to = requireAsset(quote.to);
  const amountIn = requirePositiveInt(quote.amountIn, "amountIn");
  const amountOut = requirePositiveInt(quote.amountOut, "amountOut");

  const row = { ...ensureAcct(key) };
  if ((row[from] ?? 0) < amountIn) {
    return freeze({
      ok: false,
      reason: "insufficient-balance",
      simulation: true,
      boundary: TOKEN_STUB_BOUNDARY,
    });
  }

  const titheBps = TOKEN_SUPPLY_CONFIG.VOID_TITHE_BPS;
  const voidTithe = Math.floor((amountOut * titheBps) / 10_000);
  const netOut = amountOut - voidTithe;

  row[from] = (row[from] ?? 0) - amountIn;
  row[to] = (row[to] ?? 0) + netOut;
  ledger.set(key, freeze(row));

  const tx = freeze({
    id: `tx_${quote.id}_${now}`,
    quoteId: quote.id,
    quoteHash: quote.hash,
    action: quote.action,
    from,
    to,
    amountIn,
    amountOut,
    voidTithe,
    voidTitheBps: titheBps,
    netOut,
    acct: key,
    settledAt: now,
    simulation: true,
    localOnly: true,
    executable: false,
    boundary: TOKEN_STUB_BOUNDARY,
  });

  emit("balance-changed", { acct: key, balances: ledger.get(key), tx });
  emit("receipt", { tx });

  return freeze({ ok: true, tx, simulation: true, boundary: TOKEN_STUB_BOUNDARY });
}

/** Reset ledger (tests only). */
export function __resetLedgerForTests() {
  ledger.clear();
  listeners.clear();
}

export const TumboToken = freeze({
  ledger,
  balance,
  fmt,
  on,
  getQuote,
  isQuoteFresh,
  settle,
  TOKEN_SUPPLY_CONFIG,
  TOKEN_ASSETS,
  TOKEN_STUB_BOUNDARY,
  TOKEN_EVENT,
  TOKEN_SOURCE,
});

/** Attach facade when a window exists (browser). */
export function attachWindowFacade(win = typeof window !== "undefined" ? window : null) {
  if (!win) return TumboToken;
  win.TumboToken = TumboToken;
  return TumboToken;
}

export default TumboToken;
