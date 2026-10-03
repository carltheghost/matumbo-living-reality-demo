/**
 * Local simulated transfer/escrow adapter over the canonical QuoteEngine.
 * Balances, journal order, idempotency and chain verification have one owner.
 * Receipt aliases support the older console; they do not create another proof
 * chain or grant wallet, signing, custody or external settlement capabilities.
 */
import { createTokenEngine, CONFIG, ASSETS, assertAccount, assertAsset, isUserAccount } from './token.js?v=20261003-complete8';
import { FLUFF_PER_TUMBO as FLUFF_PER_TUMBO_SIM } from './token-config.js?v=20261003-complete8';
import { createTokenFacade } from './token-facade.js?v=20261003-complete8';
export { FLUFF_PER_TUMBO_SIM };
export const TOKEN_TRANSFER_ASSETS = ASSETS;
export const TOKEN_TRANSFER_SUPPLY_FLUFF = CONFIG.supply;
export const TOKEN_TRANSFER_SYS_ACCOUNTS = Object.freeze(['sys:treasury', 'sys:faucet', 'sys:escrow', 'sys:vault', 'sys:void', 'sys:market']);
export const TOKEN_TRANSFER_REALM = 'tumbo-token';
export const TOKEN_TRANSFER_STAMP = 'TUMBO-SIM · Local Demo Proof';
export const TOKEN_TRANSFER_SIGNER = 'tumbo-sim-node';

export class TokenTransferError extends Error {
  constructor(message, code = 'INVALID_TRANSFER') { super(message); this.name = this.constructor.name; this.code = code; }
}
export class InsufficientFundsError extends TokenTransferError {}
export class UnbalancedJournalError extends TokenTransferError {}
export class UnknownIntentError extends TokenTransferError {}
export class IntentStateError extends TokenTransferError {}
export class VoidDebitError extends TokenTransferError {}

// Pure utility hashes remain available to consumers. Canonical receipts use
// QuoteEngine's own hash/prevHash fields, not these unrelated SHA-256 helpers.
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** SHA-256 hex digest of a UTF-8 string. Pure and deterministic. */
export function sha256Hex(message) {
  const text = String(message);
  const bytes = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        const full = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
        bytes.push(
          0xf0 | (full >> 18),
          0x80 | ((full >> 12) & 0x3f),
          0x80 | ((full >> 6) & 0x3f),
          0x80 | (full & 0x3f),
        );
      } else {
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      }
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  bytes.push(
    (hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff,
    (lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff,
  );

  let h0 = 0x6a09e667; let h1 = 0xbb67ae85; let h2 = 0x3c6ef372; let h3 = 0xa54ff53a;
  let h4 = 0x510e527f; let h5 = 0x9b05688c; let h6 = 0x1f83d9ab; let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < bytes.length; off += 64) {
    for (let t = 0; t < 16; t++) {
      w[t] =
        (bytes[off + t * 4] << 24) |
        (bytes[off + t * 4 + 1] << 16) |
        (bytes[off + t * 4 + 2] << 8) |
        bytes[off + t * 4 + 3];
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = h0; let b = h1; let c = h2; let d = h3;
    let e = h4; let f = h5; let g = h6; let h = h7;
    for (let t = 0; t < 64; t++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + SHA256_K[t] + w[t]) | 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  const hex = (x) => ("00000000" + (x >>> 0).toString(16)).slice(-8);
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4) + hex(h5) + hex(h6) + hex(h7);
}

function sortValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TokenTransferError("canonical JSON cannot encode non-finite numbers");
    return value;
  }
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) {
      const v = sortValue(value[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  throw new TokenTransferError(`canonical JSON cannot encode ${typeof value}`);
}

/** Deterministic JSON: sorted keys, no incidental whitespace. */
export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

/** SHA-256 hex of the canonical JSON of `value`. */
export function contentHash(value) {
  return sha256Hex(canonicalJson(value));
}

// ---------------------------------------------------------------------------
// Amount helpers — exact integer math on fluff only.
// ---------------------------------------------------------------------------

/** Format integer fluff as "1.234 TUMBO-SIM" with exact integer math. */
export function fmtFluff(fluff) {
  if (!Number.isSafeInteger(fluff)) {
    throw new TokenTransferError("fmtFluff expects a safe integer number of fluff");
  }
  const neg = fluff < 0;
  const abs = neg ? -fluff : fluff;
  const whole = Math.floor(abs / FLUFF_PER_TUMBO_SIM);
  const frac = String(abs % FLUFF_PER_TUMBO_SIM).padStart(3, "0");
  return `${neg ? "-" : ""}${whole}.${frac} TUMBO-SIM`;
}

/**
 * Parse a user-typed "1.234" TUMBO-SIM decimal into integer fluff with exact
 * string math — never float. At most 3 fraction digits; never negative here.
 */
export function parseSimToFluff(text) {
  const s = String(text ?? "").trim();
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(s);
  if (!m) {
    throw new TokenTransferError(
      `amount "${s}" must be a non-negative decimal with at most 3 fraction digits (TUMBO-SIM)`,
    );
  }
  const fluff = BigInt(m[1]) * BigInt(FLUFF_PER_TUMBO_SIM) + BigInt((m[2] ?? "").padEnd(3, "0"));
  if (fluff > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TokenTransferError(`amount "${s}" is not a safe integer number of fluff`);
  }
  return Number(fluff);
}

// ---------------------------------------------------------------------------
// Validation and the canonical adapter.
// ---------------------------------------------------------------------------
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;
const KEY_PREFIX = 'transfer:';
function validateIdempotencyKey(key) {
  if (typeof key !== 'string' || !key.trim() || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new TokenTransferError('every mutation requires a nonempty client idempotency key of at most 256 characters');
  }
  return key;
}
function validateAccount(account) {
  try { return assertAccount(account); }
  catch { throw new TokenTransferError('account must be a valid canonical user, bot, or system account'); }
}
function validateAsset(asset) {
  try { return assertAsset(asset); }
  catch { throw new TokenTransferError('unknown canonical asset'); }
}
function requirePositiveFluff(amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new TokenTransferError('amountFluff must be a positive safe integer (fluff)');
  return amount;
}
function textValue(value, name, limit = 240) {
  if (typeof value !== 'string' || value.length > limit) throw new TokenTransferError(`${name} must be a string of at most ${limit} characters`);
  return value;
}
// Validate the canonical owner contract rather than one URL's class identity.
// Adapter metadata never grants a partial facade authority to own balances.
function isCanonicalEngine(engine) {
  const ledger = engine?.ledger;
  return Boolean(engine && ledger &&
    ['quote', 'execute', 'faucet', 'balance', 'on', '_emit', 'journalHistory'].every(name => typeof engine[name] === 'function') &&
    ['post', 'openAccount', 'verifyChain', 'verifyReceipt', 'accounts', 'journalCount', 'onCommit'].every(name => typeof ledger[name] === 'function') &&
    Array.isArray(ledger._journals) && typeof ledger._receipts?.get === 'function' &&
    typeof engine._reversedJournalKeys?.has === 'function' && Number.isSafeInteger(ledger.tick) && ledger.tick >= 0 &&
    ASSETS.every(asset => Number.isSafeInteger(engine.config?.supply?.[asset]) && engine.config.supply[asset] > 0));
}
function ownerEngine(owner) {
  const engine = isCanonicalEngine(owner) ? owner : owner?.engine ?? owner?._engine;
  return isCanonicalEngine(engine) ? engine : null;
}
function requireUserSource(account) {
  if (account === 'sys:void') throw new VoidDebitError('sys:void can never be debited', 'VOID_DEBIT');
  if (!isUserAccount(account)) throw new TokenTransferError('system debits require the explicit canonical funding or escrow path', 'SYSTEM_DEBIT');
}

export function createTokenTransferLedger({ engine = null } = {}) {
  const owner = engine === null ? createTokenEngine() : ownerEngine(engine);
  if (!isCanonicalEngine(owner)) throw new TypeError('transfers require the canonical QuoteEngine');
  const core = owner.ledger;
  const views = new WeakMap(); // Derived UI views only; never balances/journals.
  const balance = (account, asset = 'TUMBO') => owner.balance(validateAccount(account), validateAsset(asset));
  const validChain = () => {
    if (!core.verifyChain().ok) throw new TokenTransferError('canonical receipt chain is invalid', 'INVALID_CHAIN');
  };
  const findCoreReceipt = ref => {
    const id = typeof ref === 'string' ? ref : ref?.receiptId ?? ref?.id;
    const row = core._journals.find(item => item.id === id || item.idempotencyKey === id);
    if (!row) throw new TokenTransferError('unknown canonical receipt');
    return row;
  };
  function view(row) {
    if (views.has(row)) return views.get(row);
    const meta = row.links?.kind === 'local-transfer' ? row.links : null;
    const phase = meta?.phase ?? null;
    const asset = meta?.asset ?? row.postings[0].asset;
    const amountFluff = meta?.amountFluff ?? Math.max(...row.postings.map(leg => Math.abs(leg.amount)));
    const accounts = Object.freeze([...new Set(row.postings.map(leg => leg.account))]);
    const receipt = Object.freeze({
      ...row, receiptId: row.id, journalId: row.id, sequence: row.tick - 1,
      phase, reference: meta?.clientKey ?? row.idempotencyKey, intentId: meta?.intentId ?? null,
      actorId: meta?.actorId ?? row.postings.find(leg => leg.amount < 0)?.account ?? 'simulation',
      asset, amountFluff, accounts, realm: TOKEN_TRANSFER_REALM,
      summary: `${row.action}${phase ? ':' + phase : ''} ${fmtFluff(amountFluff)} ${asset} · simulated`,
      verificationState: 'local-chain', issuedAt: row.ts, stamp: TOKEN_TRANSFER_STAMP, simulation: true,
    });
    views.set(row, receipt); return receipt;
  }
  function totalSupply(asset) {
    validateAsset(asset);
    const total = core.accounts().filter(row => row.asset === asset && row.account !== 'sys:issuance')
      .reduce((n, row) => n + BigInt(balance(row.account, asset)), 0n);
    if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new TokenTransferError('supply exceeds safe integer range');
    return Number(total);
  }
  function assertConservation() {
    for (const asset of ASSETS) if (totalSupply(asset) !== owner.config.supply[asset]) {
      throw new TokenTransferError('canonical supply conservation failed', 'CONSERVATION');
    }
    return true;
  }
  function verifyReceipt(ref) {
    const row = findCoreReceipt(ref), canonical = core.verifyReceipt(row.id), checks = {};
    for (const check of canonical.checks ?? []) checks[check.name] = check.ok;
    checks['canonical-record'] = typeof ref === 'string' || canonicalJson(ref) === canonicalJson(ref?.receiptId ? view(row) : row);
    const sums = new Map();
    for (const leg of row.postings) sums.set(leg.asset, (sums.get(leg.asset) ?? 0n) + BigInt(leg.amount));
    checks['balanced-postings'] = [...sums.values()].every(sum => sum === 0n);
    return { receiptId: row.id, ok: Object.values(checks).every(Boolean), checks };
  }
  function emit(row) {
    owner._emit('receipt', { receipt: row });
    for (const leg of row.postings) owner._emit('balance-changed', {
      account: leg.account, asset: leg.asset, balance: owner.balance(leg.account, leg.asset),
    });
  }
  function commit({ action, phase = null, from, to, asset, amountFluff, idempotencyKey, actor, memo = '', intentId = null, recipient = null }) {
    const key = validateIdempotencyKey(idempotencyKey);
    validateAsset(asset); requirePositiveFluff(amountFluff); textValue(memo, 'memo');
    const actorId = textValue(actor ?? from, 'actor', 100);
    validChain();
    const canonicalKey = KEY_PREFIX + key, replay = core._receipts.has(canonicalKey);
    let row;
    try {
      row = core.post([
        { account: from, asset, amount: -amountFluff },
        { account: to, asset, amount: amountFluff },
      ], {
        idempotencyKey: canonicalKey, action, memo,
        links: { kind: 'local-transfer', phase, from, to, asset, amountFluff, clientKey: key, actorId, intentId, recipient },
        authority: phase === 'settle' || phase === 'cancel' ? 'internal' : null,
        voidCreditReason: action === 'burn' ? 'burn' : null,
      });
    } catch (error) {
      if (/insufficient funds/.test(error.message)) throw new InsufficientFundsError(error.message, 'INSUFFICIENT_FUNDS');
      if (error.code === 'IDEM_MISMATCH') throw new TokenTransferError(error.message, error.code);
      throw new TokenTransferError(error.message, error.code ?? 'INVALID_TRANSFER');
    }
    if (!replay) emit(row);
    return view(row);
  }
  function move(action, args = {}) {
    const { from, to, asset, amountFluff, idempotencyKey, actor, memo = '' } = args;
    const src = validateAccount(from), dst = validateAccount(to);
    if (src === dst) throw new TokenTransferError('transfer requires two different accounts');
    requireUserSource(src);
    return commit({ action, from: src, to: dst, asset, amountFluff, idempotencyKey, actor: actor ?? (action === 'receive' ? dst : src), memo });
  }
  function burn({ from, asset, amountFluff, idempotencyKey, actor, memo = '' } = {}) {
    const src = validateAccount(from); requireUserSource(src);
    return commit({ action: 'burn', from: src, to: 'sys:void', asset, amountFluff, idempotencyKey, actor, memo });
  }
  function fundDemo({ to, asset = 'TUMBO', amountFluff, idempotencyKey } = {}) {
    const destination = validateAccount(to); validateAsset(asset); requirePositiveFluff(amountFluff);
    if (!isUserAccount(destination) || asset !== 'TUMBO') throw new TokenTransferError('demo funding supplies TUMBO to user/bot accounts only');
    const key = KEY_PREFIX + validateIdempotencyKey(idempotencyKey);
    validChain();
    return view(owner.faucet(destination, asset, amountFluff, { idempotencyKey: key }));
  }
  function intents() {
    const reversed = new Set(core._journals.filter(row => row.action === 'reverse').map(row => row.links?.reverses));
    const rows = new Map();
    for (const receipt of core._journals) {
      const meta = receipt.links;
      if (receipt.action !== 'deliver' || meta?.kind !== 'local-transfer') continue;
      if (meta.phase === 'hold') rows.set(meta.intentId, Object.freeze({
        intentId: meta.intentId, action: 'deliver', status: reversed.has(receipt.id) ? 'reversed' : 'held',
        from: meta.from, to: meta.recipient, asset: meta.asset, amountFluff: meta.amountFluff,
        holdReceiptId: receipt.id, holdJournalId: receipt.id, createdAt: receipt.ts, settledReceiptId: null, settledAt: null,
      }));
      else if (meta.phase === 'settle' || meta.phase === 'cancel') {
        const intent = rows.get(meta.intentId);
        if (intent && intent.status !== 'reversed' && !reversed.has(receipt.id)) rows.set(meta.intentId, Object.freeze({
          ...intent, status: meta.phase === 'settle' ? 'settled' : 'cancelled', settledReceiptId: receipt.id, settledAt: receipt.ts,
        }));
      }
    }
    return [...rows.values()];
  }
  const getIntent = id => intents().find(row => row.intentId === id) ?? null;
  function deliverHold({ from, to, asset, amountFluff, idempotencyKey, actor, memo = '' } = {}) {
    const src = validateAccount(from), dst = validateAccount(to), key = validateIdempotencyKey(idempotencyKey);
    requireUserSource(src);
    if (!isUserAccount(dst) || src === dst) throw new TokenTransferError('deliver requires different user/bot accounts');
    return commit({ action: 'deliver', phase: 'hold', from: src, to: 'sys:escrow', asset, amountFluff,
      idempotencyKey: key, actor, memo, intentId: `deliver:${key}`,
      // Hash the final recipient separately from the first escrow posting.
      recipient: dst,
    });
  }
  function closeIntent(phase, { intentId, idempotencyKey, actor, memo = '', reason = '' } = {}) {
    const key = validateIdempotencyKey(idempotencyKey), intent = getIntent(intentId);
    if (!intent) throw new UnknownIntentError('unknown deliver intent', 'UNKNOWN_INTENT');
    const replay = core._receipts.has(KEY_PREFIX + key);
    if (!replay && intent.status !== 'held') throw new IntentStateError(`deliver intent is ${intent.status}; only held intents can close`, 'INTENT_STATE');
    if (!replay) {
      const required = intents().filter(row => row.status === 'held' && row.asset === intent.asset).reduce((n, row) => n + BigInt(row.amountFluff), 0n);
      if (BigInt(balance('sys:escrow', intent.asset)) < required) throw new InsufficientFundsError('canonical escrow cannot cover its held intents', 'INSUFFICIENT_FUNDS');
    }
    const finalMemo = phase === 'cancel' && reason ? `cancel: ${textValue(reason, 'reason')}${memo ? ` — ${memo}` : ''}` : memo;
    return commit({ action: 'deliver', phase, from: 'sys:escrow', to: phase === 'settle' ? intent.to : intent.from,
      asset: intent.asset, amountFluff: intent.amountFluff, idempotencyKey: key, actor: actor ?? intent.from, memo: finalMemo, intentId });
  }
  function onEvent(callback) {
    if (typeof callback !== 'function') throw new TokenTransferError('onEvent callback must be a function');
    const offReceipt = owner.on('receipt', ({ receipt }) => callback({ type: 'receipt', receipt: view(findCoreReceipt(receipt.id)) }));
    const offBalance = owner.on('balance-changed', detail => callback({ type: 'balance-changed', ...detail, balanceFluff: detail.balance }));
    return () => { offReceipt(); offBalance(); };
  }
  return Object.freeze({
    engine: owner, ledger: core, assets: ASSETS, sysAccounts: TOKEN_TRANSFER_SYS_ACCOUNTS, supplyFluff: owner.config.supply, realm: TOKEN_TRANSFER_REALM,
    balance, balances: account => Object.fromEntries(ASSETS.map(asset => [asset, balance(account, asset)])), totalSupply, assertConservation,
    journals: () => core._journals.slice(), journalCount: () => core.journalCount(),
    receipts: () => core._journals.filter(row => row.action !== 'genesis').map(view),
    getReceipt: ref => view(findCoreReceipt(ref)), verifyReceipt, verifyChain: () => core.verifyChain().ok,
    intents, getIntent, fundDemo,
    send: args => move('send', args), receive: args => move('receive', args), tip: args => move('tip', args), burn,
    deliverHold, deliverSettle: args => closeIntent('settle', args), deliverCancel: args => closeIntent('cancel', args),
    onEvent, fmt: fmtFluff, parseSimToFluff,
  });
}

const adapters = new WeakMap();
export function attachTokenTransfers(facade = null, options = {}) {
  const existingOwner = ownerEngine(facade), suppliedOwner = ownerEngine(options.engine);
  if (facade !== null && !existingOwner) throw new TypeError('existing facade must identify its canonical QuoteEngine');
  if (options.engine !== undefined && !suppliedOwner) throw new TypeError('engine option must identify the canonical QuoteEngine');
  if (existingOwner && suppliedOwner && existingOwner !== suppliedOwner) throw new TypeError('transfer engine must match the existing facade owner');
  const engine = existingOwner ?? suppliedOwner ?? createTokenEngine();
  if (facade?.tokenTransfers?.engine === engine) return facade;
  const base = facade ?? createTokenFacade(engine);
  if (!adapters.has(engine)) adapters.set(engine, createTokenTransferLedger({ engine }));
  const adapter = adapters.get(engine), target = { ...base, engine, tokenTransfers: adapter };
  for (const name of ['send', 'receive', 'tip', 'burn', 'deliverHold', 'deliverSettle', 'deliverCancel', 'fundDemo']) {
    if (typeof target[name] !== 'function') target[name] = adapter[name];
  }
  if (typeof target.receipts !== 'function') target.receipts = adapter.receipts;
  if (typeof target.deliverIntents !== 'function') target.deliverIntents = adapter.intents;
  target.__tokenTransferDetach = () => {}; // The layer adds no permanent subscription.
  Object.freeze(target);
  try { if (typeof window !== 'undefined' && (!window.TumboToken || window.TumboToken === facade)) window.TumboToken = target; } catch { /* non-browser hosts */ }
  return target;
}
export default createTokenTransferLedger;
