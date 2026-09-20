/**
 * token.js — TUMBO Token simulated ledger core (shared contract).
 *
 * Canonical simulation-first token core for the maTumbo block world.
 * Implements the shared builder contract:
 *
 *   window.TumboToken = {
 *     ledger,                        // full ledger object (balances, send, history, vault, ...)
 *     balance(acct, asset) -> fluff, // integer fluff
 *     fmt(fluff) -> string,          // divides by 1000 -> "95.500 TUMBO-SIM"
 *     on(evt, cb),                  // subscribe to 'balance-changed' | 'receipt'
 *   }
 *
 * Emits document CustomEvent('tumbo:token', { detail: {
 *   type: 'balance-changed' | 'receipt', tx, ... } }).
 *
 * Units: integer fluff. 1 TUMBO-SIM = 1000 fluff. Display divides by 1000.
 *
 * SIMULATION-FIRST: TUMBO-SIM is simulated points only. There is no issuer,
 * wallet connection, custody, signing, settlement, exchange, or real-money
 * path anywhere in this module. Every emitted record carries simulation:true.
 * Node-safe: no DOM or window access at import time.
 */

export const TUMBO_TOKEN_SOURCE = 'tumbo-token';
export const TUMBO_TOKEN_EVENT = 'tumbo:token';
export const TUMBO_TOKEN_ASSET = 'TUMBO-SIM';
export const TUMBO_TOKEN_DEFAULT_ACCOUNT = 'you';
export const FLUFF_PER_TUMBO_SIM = 1000;
export const TUMBO_TOKEN_MAX_MEMO_LENGTH = 140;
export const TUMBO_TOKEN_MAX_ID_LENGTH = 64;
export const TUMBO_TOKEN_HISTORY_LIMIT = 50;
export const TUMBO_TOKEN_SCHEMA_VERSION = 1;

const ACCOUNT_PATTERN = /^[a-z0-9][a-z0-9:_.-]{0,62}[a-z0-9]?$/i;
const ASSET_PATTERN = /^[A-Z0-9][A-Z0-9.-]{0,30}$/;

function freeze(value) {
  return Object.freeze(value);
}

function requireSafeIntegerFluff(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a safe non-negative integer (fluff)`);
  }
  return value;
}

function requireAccount(value, field = 'account') {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  const normalized = value.trim();
  if (normalized.length > TUMBO_TOKEN_MAX_ID_LENGTH || !ACCOUNT_PATTERN.test(normalized)) {
    throw new TypeError(`${field} must be 1-64 chars: letters, digits, : _ . -`);
  }
  return normalized;
}

function requireAsset(value, field = 'asset') {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  const normalized = value.trim().toUpperCase();
  if (!ASSET_PATTERN.test(normalized)) {
    throw new TypeError(`${field} must be 1-31 chars: A-Z, 0-9, . -`);
  }
  return normalized;
}

function requireMemo(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new TypeError('memo must be a string');
  if (value.length > TUMBO_TOKEN_MAX_MEMO_LENGTH) {
    throw new TypeError(`memo must be at most ${TUMBO_TOKEN_MAX_MEMO_LENGTH} characters`);
  }
  return value;
}

function requireIdempotencyKey(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('idempotencyKey must be a non-empty string');
  }
  if (value.length > 128) throw new TypeError('idempotencyKey must be at most 128 characters');
  return value;
}

/** Parse a TUMBO-SIM decimal amount into integer fluff. Pure. */
export function tumboSimToFluff(sim) {
  const numeric = typeof sim === 'string' ? Number(sim.trim().replace(/,/g, '')) : Number(sim);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new TypeError('amount must be a finite non-negative number of TUMBO-SIM');
  }
  const fluff = Math.round(numeric * FLUFF_PER_TUMBO_SIM);
  if (!Number.isSafeInteger(fluff)) {
    throw new TypeError('amount is out of range for integer fluff');
  }
  return fluff;
}

/** Convert integer fluff to TUMBO-SIM decimal. Pure. */
export function fluffToTumboSim(fluff) {
  requireSafeIntegerFluff(fluff, 'fluff');
  return fluff / FLUFF_PER_TUMBO_SIM;
}

const simFormatter = new Intl.NumberFormat('en-US', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

/** Format integer fluff as a TUMBO-SIM decimal string (no asset suffix). Pure. */
export function formatSimAmount(fluff) {
  return simFormatter.format(fluffToTumboSim(fluff));
}

/** Generate an idempotency key. Pure-ish (uses crypto when available). */
export function newIdempotencyKey(prefix = 'tumbo-send') {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}-${crypto.randomUUID()}`;
    }
  } catch {}
  const random = Math.floor(Math.random() * 0xffffffff).toString(36).padStart(7, '0');
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function newRecordId(prefix) {
  const random = Math.floor(Math.random() * 0xffffffff).toString(36).padStart(7, '0');
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function utcNowIso() {
  return new Date().toISOString();
}

function balanceKey(acct, asset) {
  return `${acct}::${asset}`;
}

/**
 * Create an in-memory, simulation-only token ledger. Balances are integer
 * fluff keyed by account + asset. Sends are idempotency-keyed: repeating a
 * send with the same key returns the original receipt without moving funds.
 */
export function createTumboTokenLedger({ seed = true } = {}) {
  const balances = new Map();
  const locks = new Map();
  const receipts = [];
  const idempotency = new Map();
  const listeners = new Map();

  function emit(type, detail = {}) {
    const event = freeze({
      type,
      source: TUMBO_TOKEN_SOURCE,
      schemaVersion: TUMBO_TOKEN_SCHEMA_VERSION,
      simulation: true,
      ...detail,
    });
    for (const evt of [type, '*']) {
      const set = listeners.get(evt);
      if (!set) continue;
      for (const cb of [...set]) {
        try { cb(event); } catch {}
      }
    }
    try {
      if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
        document.dispatchEvent(new CustomEvent(TUMBO_TOKEN_EVENT, { detail: event }));
      }
    } catch {}
    return event;
  }

  function getBalance(acct, asset = TUMBO_TOKEN_ASSET) {
    const account = requireAccount(acct);
    const normalizedAsset = requireAsset(asset);
    return balances.get(balanceKey(account, normalizedAsset)) ?? 0;
  }

  function setBalance(acct, asset, fluff) {
    balances.set(balanceKey(acct, asset), requireSafeIntegerFluff(fluff, 'balance'));
  }

  function fmt(fluff) {
    return `${formatSimAmount(requireSafeIntegerFluff(fluff, 'fluff'))} ${TUMBO_TOKEN_ASSET}`;
  }

  function on(evt, cb) {
    if (typeof cb !== 'function') throw new TypeError('on() callback must be a function');
    const name = String(evt ?? '');
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(cb);
    return () => listeners.get(name)?.delete(cb);
  }

  function accounts() {
    const rows = [];
    for (const [key, balanceFluff] of balances.entries()) {
      const separator = key.indexOf('::');
      rows.push(freeze({
        acct: key.slice(0, separator),
        asset: key.slice(separator + 2),
        balanceFluff,
        simulation: true,
      }));
    }
    rows.sort((a, b) => a.acct.localeCompare(b.acct) || a.asset.localeCompare(b.asset));
    return freeze(rows);
  }

  function totals() {
    const perAsset = {};
    let grandFluff = 0;
    for (const row of accounts()) {
      perAsset[row.asset] = (perAsset[row.asset] ?? 0) + row.balanceFluff;
      grandFluff += row.balanceFluff;
    }
    return freeze({ perAsset: freeze({ ...perAsset }), grandFluff, simulation: true });
  }

  function recordReceipt(entry) {
    const receipt = freeze({
      id: newRecordId('tx'),
      status: 'simulated',
      simulation: true,
      source: TUMBO_TOKEN_SOURCE,
      at: utcNowIso(),
      ...entry,
    });
    receipts.push(receipt);
    if (receipts.length > 500) receipts.splice(0, receipts.length - 500);
    return receipt;
  }

  /**
   * Idempotency-keyed simulated send. Repeating the same idempotencyKey
   * returns the original receipt with duplicate:true and moves no funds.
   */
  function send({
    from = TUMBO_TOKEN_DEFAULT_ACCOUNT,
    to,
    asset = TUMBO_TOKEN_ASSET,
    amountFluff,
    memo = '',
    idempotencyKey = newIdempotencyKey(),
  } = {}) {
    const sender = requireAccount(from, 'from');
    const recipient = requireAccount(to, 'to');
    const normalizedAsset = requireAsset(asset);
    const fluff = requireSafeIntegerFluff(amountFluff, 'amountFluff');
    if (fluff <= 0) throw new TypeError('amountFluff must be greater than 0');
    const key = requireIdempotencyKey(idempotencyKey);
    const note = requireMemo(memo);

    const cached = idempotency.get(key);
    if (cached) {
      const replay = freeze({ ...cached, duplicate: true });
      emit('receipt', { tx: replay, duplicate: true });
      return replay;
    }

    const senderBalance = getBalance(sender, normalizedAsset);
    if (senderBalance < fluff) {
      const error = new Error('insufficient-simulated-funds');
      error.code = 'insufficient-simulated-funds';
      error.simulation = true;
      throw error;
    }

    setBalance(sender, normalizedAsset, senderBalance - fluff);
    setBalance(recipient, normalizedAsset, getBalance(recipient, normalizedAsset) + fluff);

    const receipt = recordReceipt(freeze({
      kind: 'send',
      from: sender,
      to: recipient,
      asset: normalizedAsset,
      amountFluff: fluff,
      memo: note,
      idempotencyKey: key,
    }));
    idempotency.set(key, receipt);
    emit('balance-changed', {
      tx: receipt,
      accounts: freeze([sender, recipient]),
      asset: normalizedAsset,
      amountFluff: fluff,
    });
    emit('receipt', { tx: receipt, duplicate: false });
    return receipt;
  }

  /** Move funds into a simulated vault lock (spendable balance decreases). */
  function lock({
    acct = TUMBO_TOKEN_DEFAULT_ACCOUNT,
    asset = TUMBO_TOKEN_ASSET,
    amountFluff,
    label = 'Vault lock',
    unlocksAt = null,
  } = {}) {
    const account = requireAccount(acct);
    const normalizedAsset = requireAsset(asset);
    const fluff = requireSafeIntegerFluff(amountFluff, 'amountFluff');
    if (fluff <= 0) throw new TypeError('amountFluff must be greater than 0');
    if (typeof label !== 'string' || label.trim() === '') throw new TypeError('label must be a non-empty string');
    let unlockIso = null;
    if (unlocksAt !== null && unlocksAt !== undefined) {
      const parsed = new Date(unlocksAt);
      if (Number.isNaN(parsed.getTime())) throw new TypeError('unlocksAt must be a valid date');
      unlockIso = parsed.toISOString();
    }
    const available = getBalance(account, normalizedAsset);
    if (available < fluff) {
      const error = new Error('insufficient-simulated-funds');
      error.code = 'insufficient-simulated-funds';
      error.simulation = true;
      throw error;
    }
    setBalance(account, normalizedAsset, available - fluff);
    const entry = freeze({
      id: newRecordId('lock'),
      acct: account,
      asset: normalizedAsset,
      amountFluff: fluff,
      label: label.trim().slice(0, 80),
      lockedAt: utcNowIso(),
      unlocksAt: unlockIso,
      status: 'locked',
      simulation: true,
      source: TUMBO_TOKEN_SOURCE,
    });
    locks.set(entry.id, entry);
    emit('balance-changed', { vault: true, lock: entry, accounts: freeze([account]), asset: normalizedAsset });
    return entry;
  }

  /** Release a matured simulated lock back to the spendable balance. */
  function unlock(lockId) {
    if (typeof lockId !== 'string' || !lockId) throw new TypeError('lockId must be a non-empty string');
    const entry = locks.get(lockId);
    if (!entry) throw new Error('unknown-lock');
    if (entry.status !== 'locked') throw new Error('lock-not-active');
    if (entry.unlocksAt && Date.now() < Date.parse(entry.unlocksAt)) {
      const error = new Error('lock-not-matured');
      error.code = 'lock-not-matured';
      throw error;
    }
    const released = freeze({ ...entry, status: 'released', releasedAt: utcNowIso() });
    locks.set(lockId, released);
    setBalance(entry.acct, entry.asset, getBalance(entry.acct, entry.asset) + entry.amountFluff);
    emit('balance-changed', { vault: true, lock: released, accounts: freeze([entry.acct]), asset: entry.asset });
    return released;
  }

  function vault(acct = TUMBO_TOKEN_DEFAULT_ACCOUNT, asset = TUMBO_TOKEN_ASSET) {
    const account = requireAccount(acct);
    const normalizedAsset = requireAsset(asset);
    const entries = [...locks.values()]
      .filter((entry) => entry.acct === account && entry.asset === normalizedAsset)
      .sort((a, b) => a.lockedAt.localeCompare(b.lockedAt));
    const totalLockedFluff = entries
      .filter((entry) => entry.status === 'locked')
      .reduce((total, entry) => total + entry.amountFluff, 0);
    return freeze({ acct: account, asset: normalizedAsset, locks: freeze(entries), totalLockedFluff, simulation: true });
  }

  function history({ acct = null, asset = null, limit = TUMBO_TOKEN_HISTORY_LIMIT } = {}) {
    const account = acct === null || acct === undefined ? null : requireAccount(acct);
    const normalizedAsset = asset === null || asset === undefined ? null : requireAsset(asset);
    const bounded = Math.max(1, Math.min(200, Math.floor(Number(limit) || TUMBO_TOKEN_HISTORY_LIMIT)));
    const filtered = receipts.filter((receipt) => {
      if (account && receipt.from !== account && receipt.to !== account) return false;
      if (normalizedAsset && receipt.asset !== normalizedAsset) return false;
      return true;
    });
    return freeze(filtered.slice(-bounded).reverse());
  }

  const ledger = freeze({
    source: TUMBO_TOKEN_SOURCE,
    schemaVersion: TUMBO_TOKEN_SCHEMA_VERSION,
    simulation: true,
    balance: getBalance,
    accounts,
    totals,
    fmt,
    on,
    send,
    lock,
    unlock,
    vault,
    history,
  });

  if (seed) {
    // Deterministic demo seed, all simulated: a faucet credit for the local
    // demo account plus one vault lock so wallet + vault both render.
    setBalance(TUMBO_TOKEN_DEFAULT_ACCOUNT, TUMBO_TOKEN_ASSET, 0);
    const faucetReceipt = recordReceipt(freeze({
      kind: 'faucet-credit',
      from: 'tumbo-faucet',
      to: TUMBO_TOKEN_DEFAULT_ACCOUNT,
      asset: TUMBO_TOKEN_ASSET,
      amountFluff: 120500,
      memo: 'Simulated starter credit for the demo wallet',
      idempotencyKey: 'seed:faucet-credit:v1',
    }));
    idempotency.set('seed:faucet-credit:v1', faucetReceipt);
    setBalance(TUMBO_TOKEN_DEFAULT_ACCOUNT, TUMBO_TOKEN_ASSET, 120500);
    try {
      lock({
        acct: TUMBO_TOKEN_DEFAULT_ACCOUNT,
        asset: TUMBO_TOKEN_ASSET,
        amountFluff: 25000,
        label: 'Demo vault reserve',
        unlocksAt: '2027-01-01T00:00:00.000Z',
      });
    } catch {}
  }

  return ledger;
}

let facadeSingleton = null;

/**
 * Create (or reuse) the shared window.TumboToken facade:
 * { ledger, balance(acct, asset), fmt(fluff), on(evt, cb) }.
 */
export function ensureTumboTokenFacade({ seed = true } = {}) {
  if (facadeSingleton) return facadeSingleton;
  const ledger = createTumboTokenLedger({ seed });
  const facade = freeze({
    ledger,
    balance: (acct, asset) => ledger.balance(acct, asset),
    fmt: (fluff) => ledger.fmt(fluff),
    on: (evt, cb) => ledger.on(evt, cb),
  });
  facadeSingleton = facade;
  try {
    if (typeof window !== 'undefined') {
      window.TumboToken = facade;
      window.__TUMBO_TOKEN_LEDGER__ = ledger;
    }
  } catch {}
  return facade;
}

/** Return the existing facade (window.TumboToken) without creating one. */
export function getTumboTokenFacade() {
  if (facadeSingleton) return facadeSingleton;
  try {
    if (typeof window !== 'undefined' && window.TumboToken) return window.TumboToken;
  } catch {}
  return null;
}
