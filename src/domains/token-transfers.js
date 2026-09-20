/**
 * token-transfers.js — Part 02 · Token transfers (send / receive / deliver / tip).
 *
 * Implements the transfer half of the shared TUMBO-SIM token contract on top of
 * an exact integer journal:
 *
 * - Units are integer fluff. 1 TUMBO-SIM = 1000 fluff. Every amount is
 *   Number.isSafeInteger and >= 0; all fund math is exact integer math.
 * - Assets: TUMBO, sMIMAS. Total supply comes from ONE config constant
 *   (TOKEN_TRANSFER_SUPPLY_FLUFF); it is never restated anywhere else.
 * - Accounts: u:<name>, b:<name>, sys:treasury, sys:faucet, sys:escrow,
 *   sys:vault, sys:void, sys:market. sys:void is credited only by burns and
 *   can never be debited.
 * - Every mutation takes a client idempotency key. Replaying a key returns
 *   the original receipt — never a second journal.
 * - Every journal sums to exactly 0 per asset; balances never go negative;
 *   conservation holds (the per-asset total always equals the configured
 *   supply).
 * - deliver is a two-phase intent: hold (sender -> sys:escrow), then settle
 *   (sys:escrow -> recipient) or cancel (sys:escrow -> sender).
 * - Every settled mutation issues an EchoProof-style hash-chained receipt.
 *   attachTokenTransfers() plugs the engine into the window.TumboToken
 *   facade ({ ledger, balance(acct, asset), fmt(fluff), on(evt, cb) }) and
 *   surfaces receipts through document CustomEvent('tumbo:token',
 *   { detail: { type: 'balance-changed' | 'receipt', ... } }).
 *
 * Pure module: no DOM, no THREE, no node builtins. Node-importable for
 * `node --test` and browser-importable through the repo import map.
 *
 * Simulation-only: TUMBO-SIM balances are simulated demo points. No real
 * money, no wagering, no wallets, no custody, no chains.
 */

// ---------------------------------------------------------------------------
// Config — the single source of truth for units, assets, accounts, and supply.
// ---------------------------------------------------------------------------

/** Integer fluff per 1 TUMBO-SIM. All fund math is done in fluff. */
export const FLUFF_PER_TUMBO_SIM = 1000;

/** Assets supported by the transfer engine. */
export const TOKEN_TRANSFER_ASSETS = Object.freeze(["TUMBO", "sMIMAS"]);

/**
 * THE supply constant. Every per-asset total in the system derives from this
 * one object; no other supply number exists in this module.
 */
export const TOKEN_TRANSFER_SUPPLY_FLUFF = Object.freeze({
  TUMBO: 1_000_000 * FLUFF_PER_TUMBO_SIM,
  sMIMAS: 250_000 * FLUFF_PER_TUMBO_SIM,
});

/** System accounts owned by the simulation. */
export const TOKEN_TRANSFER_SYS_ACCOUNTS = Object.freeze([
  "sys:treasury",
  "sys:faucet",
  "sys:escrow",
  "sys:vault",
  "sys:void",
  "sys:market",
]);

export const TOKEN_TRANSFER_REALM = "tumbo-token";
export const TOKEN_TRANSFER_STAMP = "TUMBO-SIM \u00b7 Local Demo Proof";
export const TOKEN_TRANSFER_SIGNER = "tumbo-sim-node";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TokenTransferError extends Error {}
export class InsufficientFundsError extends TokenTransferError {}
export class UnbalancedJournalError extends TokenTransferError {}
export class UnknownIntentError extends TokenTransferError {}
export class IntentStateError extends TokenTransferError {}
export class VoidDebitError extends TokenTransferError {}

// ---------------------------------------------------------------------------
// Pure hashing: SHA-256 (sync, dependency-free) + canonical JSON.
// ---------------------------------------------------------------------------

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
  const fluff = Number(m[1]) * FLUFF_PER_TUMBO_SIM + Number((m[2] ?? "").padEnd(3, "0"));
  if (!Number.isSafeInteger(fluff)) {
    throw new TokenTransferError(`amount "${s}" is not a safe integer number of fluff`);
  }
  return fluff;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const USER_ACCT_RE = /^[ub]:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MAX_IDEMPOTENCY_KEY_LENGTH = 256;

function validateAsset(asset) {
  if (!TOKEN_TRANSFER_ASSETS.includes(asset)) {
    throw new TokenTransferError(`unknown asset "${asset}"; expected one of ${TOKEN_TRANSFER_ASSETS.join(", ")}`);
  }
  return asset;
}

function validateAccount(acct) {
  if (typeof acct !== "string") throw new TokenTransferError("account must be a string");
  const a = acct.trim();
  if (TOKEN_TRANSFER_SYS_ACCOUNTS.includes(a)) return a;
  if (USER_ACCT_RE.test(a)) return a;
  throw new TokenTransferError(
    `invalid account "${acct}"; expected u:<name>, b:<name>, or one of ${TOKEN_TRANSFER_SYS_ACCOUNTS.join(", ")}`,
  );
}

// ---------------------------------------------------------------------------
// The transfer ledger.
// ---------------------------------------------------------------------------

const TRANSFER_ACTIONS = Object.freeze(["send", "receive", "deliver", "tip", "burn"]);

/**
 * Create an isolated token-transfer ledger.
 *
 * The ledger boots with the configured per-asset supply distributed across
 * system accounts (a boot allocation, not a journal): TUMBO starts in
 * sys:treasury with a faucet share in sys:faucet; sMIMAS starts in sys:market
 * with a faucet share in sys:faucet. Every later balance change goes through
 * postJournal, so journals always sum to zero and the per-asset total always
 * equals the configured supply.
 */
export function createTokenTransferLedger({ supplyFluff = TOKEN_TRANSFER_SUPPLY_FLUFF } = {}) {
  for (const asset of TOKEN_TRANSFER_ASSETS) {
    const supply = supplyFluff?.[asset];
    if (!Number.isSafeInteger(supply) || supply < 0) {
      throw new TokenTransferError(`supply for ${asset} must be a safe non-negative integer (fluff)`);
    }
  }

  const balances = new Map(); // `${acct}::${asset}` -> integer fluff
  const journals = [];
  const receipts = [];
  const receiptStates = new Map(); // receiptId -> { before, after, payload }
  const idemIndex = new Map(); // idempotencyKey -> receipt (replay returns this)
  const intents = new Map(); // deliver intentId -> intent
  const listeners = new Set();

  const bkey = (acct, asset) => `${acct}::${asset}`;

  // Boot allocation: the only balances that do not come from a journal.
  for (const asset of TOKEN_TRANSFER_ASSETS) {
    const supply = supplyFluff[asset];
    for (const acct of TOKEN_TRANSFER_SYS_ACCOUNTS) balances.set(bkey(acct, asset), 0);
    const faucetShare = Math.floor(supply / 4);
    const home = asset === "TUMBO" ? "sys:treasury" : "sys:market";
    balances.set(bkey(home, asset), supply - faucetShare);
    balances.set(bkey("sys:faucet", asset), faucetShare);
  }

  function balance(acct, asset) {
    const a = validateAccount(acct);
    validateAsset(asset);
    return balances.get(bkey(a, asset)) ?? 0;
  }

  function emit(type, detail) {
    for (const cb of [...listeners]) {
      try { cb({ type, ...detail }); } catch { /* listener errors never break settlement */ }
    }
  }

  function snapshotBalances(accounts) {
    const snap = {};
    for (const acct of accounts) {
      snap[acct] = {};
      for (const a of TOKEN_TRANSFER_ASSETS) snap[acct][a] = balances.get(bkey(acct, a)) ?? 0;
    }
    return snap;
  }

  /**
   * The ONE write path. Atomically applies balanced legs, then issues a
   * hash-chained receipt. Replays (same idempotency key) return the original
   * receipt without journaling anything new.
   */
  function postJournal({
    action,
    phase = null,
    asset,
    legs,
    idempotencyKey,
    actor = "system",
    memo = "",
    intentId = null,
  }) {
    if (!TRANSFER_ACTIONS.includes(action)) {
      throw new TokenTransferError(`unknown transfer action "${action}"`);
    }
    validateAsset(asset);
    const key = validateIdempotencyKey(idempotencyKey);

    // 1. Idempotency: a replay returns the original receipt, never a journal.
    const replayed = idemIndex.get(key);
    if (replayed) return replayed;

    if (!Array.isArray(legs) || legs.length < 2) {
      throw new UnbalancedJournalError("a journal needs at least two legs");
    }
    const actorId = typeof actor === "string" && actor.trim() !== "" ? actor.trim() : "system";

    // 2. Zero-sum per asset + staged validation (atomicity: never half-apply).
    let sum = 0;
    const staged = new Map();
    const touched = [];
    for (const leg of legs) {
      const acct = validateAccount(leg?.acct);
      const delta = validateDelta(leg?.delta);
      if (acct === "sys:void" && delta < 0) {
        throw new VoidDebitError("sys:void is credited only by burns and can never be debited");
      }
      sum += delta;
      const k = bkey(acct, asset);
      const next = (staged.has(k) ? staged.get(k) : (balances.get(k) ?? 0)) + delta;
      staged.set(k, next);
      if (!touched.includes(acct)) touched.push(acct);
    }
    if (sum !== 0) {
      throw new UnbalancedJournalError(`journal legs for ${asset} sum to ${sum} fluff; must be exactly 0`);
    }
    const before = snapshotBalances(touched);
    for (const [k, next] of staged) {
      if (next < 0) {
        const [acct] = k.split("::");
        throw new InsufficientFundsError(
          `${acct} cannot cover this journal (would hold ${fmtFluff(next)} of ${asset})`,
        );
      }
    }

    // 3. Commit — validation passed, this cannot fail now.
    for (const [k, next] of staged) balances.set(k, next);
    const after = snapshotBalances(touched);

    const journal = Object.freeze({
      journalId: `journal:${journals.length}`,
      seq: journals.length,
      action,
      phase,
      asset,
      legs: Object.freeze(legs.map((leg) => Object.freeze({ acct: validateAccount(leg.acct), delta: validateDelta(leg.delta) }))),
      idempotencyKey: key,
      actor: actorId,
      memo: String(memo ?? ""),
      intentId,
      at: Date.now(),
    });
    journals.push(journal);

    // 4. Hash-chained EchoProof-style receipt.
    const sequence = receipts.length;
    const prevHash = sequence === 0 ? "genesis" : receipts[sequence - 1].afterHash;
    const payload = {
      action,
      phase,
      asset,
      amountFluff: Math.max(...legs.map((l) => Math.abs(l.delta))),
      legs: journal.legs.map((l) => ({ acct: l.acct, delta: l.delta })),
      journalId: journal.journalId,
      idempotencyKey: key,
      actor: actorId,
      memo: journal.memo,
      intentId,
    };
    const receipt = Object.freeze({
      receiptId: `tumbo-tx-${String(sequence).padStart(4, "0")}`,
      sequence,
      action,
      phase,
      actorId,
      realm: TOKEN_TRANSFER_REALM,
      reference: key,
      asset,
      amountFluff: payload.amountFluff,
      accounts: Object.freeze([...touched]),
      journalId: journal.journalId,
      intentId,
      summary: describeAction({ action, phase, actor: actorId, asset, amountFluff: payload.amountFluff, legs: journal.legs }),
      beforeHash: contentHash({ prev: prevHash, state: before }),
      afterHash: contentHash({ prev: prevHash, state: after }),
      payloadHash: contentHash(payload),
      verificationState: "verified-demo",
      signer: TOKEN_TRANSFER_SIGNER,
      issuedAt: journal.at,
      stamp: TOKEN_TRANSFER_STAMP,
      simulation: true,
    });
    receipts.push(receipt);
    receiptStates.set(receipt.receiptId, { before, after, payload });
    idemIndex.set(key, receipt);
    emit("receipt", { receipt });
    for (const acct of touched) {
      emit("balance-changed", { account: acct, asset, balanceFluff: balances.get(bkey(acct, asset)) ?? 0, receiptId: receipt.receiptId });
    }
    return receipt;
  }

  function describeAction({ action, phase, actor, asset, amountFluff, legs }) {
    const amount = `${fmtFluff(amountFluff)} ${asset}`;
    const route = legs.map((l) => `${l.acct} ${l.delta < 0 ? "-" : "+"}${fmtFluff(Math.abs(l.delta))}`).join(" \u2192 ");
    const label = phase ? `${action}:${phase}` : action;
    return `${actor} ${label} ${amount} (${route}) \u00b7 simulated`;
  }

  function move({ action, phase = null, from, to, asset, amountFluff, idempotencyKey, actor, memo = "", intentId = null }) {
    const src = validateAccount(from);
    const dst = validateAccount(to);
    if (src === dst) throw new TokenTransferError(`${action} needs two different accounts`);
    requirePositiveFluff(amountFluff);
    return postJournal({
      action, phase, asset,
      legs: [{ acct: src, delta: -amountFluff }, { acct: dst, delta: amountFluff }],
      idempotencyKey, actor, memo, intentId,
    });
  }

  /** Move funds from sender to recipient (sender-initiated). */
  function send({ from, to, asset, amountFluff, idempotencyKey, actor, memo = "" } = {}) {
    return move({ action: "send", from, to, asset, amountFluff, idempotencyKey, actor: actor ?? from, memo });
  }

  /** Claim funds into the recipient account (recipient-initiated view of send). */
  function receive({ from, to, asset, amountFluff, idempotencyKey, actor, memo = "" } = {}) {
    return move({ action: "receive", from, to, asset, amountFluff, idempotencyKey, actor: actor ?? to, memo });
  }

  /** A gratuity transfer: same journal shape as send, receipted as a tip. */
  function tip({ from, to, asset, amountFluff, idempotencyKey, actor, memo = "" } = {}) {
    return move({ action: "tip", from, to, asset, amountFluff, idempotencyKey, actor: actor ?? from, memo });
  }

  /** Destroy funds into sys:void (the only account allowed to receive burns). */
  function burn({ from, asset, amountFluff, idempotencyKey, actor, memo = "" } = {}) {
    const src = validateAccount(from);
    requirePositiveFluff(amountFluff);
    return postJournal({
      action: "burn",
      asset,
      legs: [{ acct: src, delta: -amountFluff }, { acct: "sys:void", delta: amountFluff }],
      idempotencyKey, actor: actor ?? src, memo,
    });
  }

  /**
   * deliver phase 1 — hold: lock funds in sys:escrow and open a deliver
   * intent. Replaying the same idempotency key returns the original receipt
   * and the original intent (never a second hold, never a second intent).
   */
  function deliverHold({ from, to, asset, amountFluff, idempotencyKey, actor, memo = "" } = {}) {
    const key = validateIdempotencyKey(idempotencyKey);
    const replayed = idemIndex.get(key);
    if (replayed) return replayed;
    const src = validateAccount(from);
    const dst = validateAccount(to);
    if (src === dst) throw new TokenTransferError("deliver needs two different accounts");
    requirePositiveFluff(amountFluff);
    validateAsset(asset);
    const intentId = `deliver:${key}`;
    const receipt = postJournal({
      action: "deliver",
      phase: "hold",
      asset,
      legs: [{ acct: src, delta: -amountFluff }, { acct: "sys:escrow", delta: amountFluff }],
      idempotencyKey: key,
      actor: actor ?? src,
      memo,
      intentId,
    });
    const intent = Object.freeze({
      intentId,
      action: "deliver",
      status: "held",
      from: src,
      to: dst,
      asset,
      amountFluff,
      holdReceiptId: receipt.receiptId,
      holdJournalId: receipt.journalId,
      createdAt: receipt.issuedAt,
      settledReceiptId: null,
      settledAt: null,
    });
    intents.set(intentId, intent);
    return receipt;
  }

  function resolveIntent(intentId) {
    const intent = intents.get(intentId);
    if (!intent) throw new UnknownIntentError(`unknown deliver intent "${intentId}"`);
    return intent;
  }

  /**
   * deliver phase 2a — settle: release the escrowed funds to the recipient.
   * Idempotent via its own key; a replay returns the original settle receipt.
   */
  function deliverSettle({ intentId, idempotencyKey, actor, memo = "" } = {}) {
    const key = validateIdempotencyKey(idempotencyKey);
    const replayed = idemIndex.get(key);
    if (replayed) return replayed;
    const intent = resolveIntent(intentId);
    if (intent.status !== "held") {
      throw new IntentStateError(`deliver intent "${intentId}" is ${intent.status}; only held intents can settle`);
    }
    const receipt = postJournal({
      action: "deliver",
      phase: "settle",
      asset: intent.asset,
      legs: [{ acct: "sys:escrow", delta: -intent.amountFluff }, { acct: intent.to, delta: intent.amountFluff }],
      idempotencyKey: key,
      actor: actor ?? intent.from,
      memo,
      intentId,
    });
    intents.set(intentId, Object.freeze({ ...intent, status: "settled", settledReceiptId: receipt.receiptId, settledAt: receipt.issuedAt }));
    return receipt;
  }

  /**
   * deliver phase 2b — cancel: return the escrowed funds to the sender.
   * Idempotent via its own key; a replay returns the original cancel receipt.
   */
  function deliverCancel({ intentId, idempotencyKey, actor, reason = "", memo = "" } = {}) {
    const key = validateIdempotencyKey(idempotencyKey);
    const replayed = idemIndex.get(key);
    if (replayed) return replayed;
    const intent = resolveIntent(intentId);
    if (intent.status !== "held") {
      throw new IntentStateError(`deliver intent "${intentId}" is ${intent.status}; only held intents can cancel`);
    }
    const receipt = postJournal({
      action: "deliver",
      phase: "cancel",
      asset: intent.asset,
      legs: [{ acct: "sys:escrow", delta: -intent.amountFluff }, { acct: intent.from, delta: intent.amountFluff }],
      idempotencyKey: key,
      actor: actor ?? intent.from,
      memo: reason ? `cancel: ${reason}${memo ? ` \u2014 ${memo}` : ""}` : memo,
      intentId,
    });
    intents.set(intentId, Object.freeze({ ...intent, status: "cancelled", settledReceiptId: receipt.receiptId, settledAt: receipt.issuedAt }));
    return receipt;
  }

  // ---- reads -----------------------------------------------------------

  function totalSupply(asset) {
    validateAsset(asset);
    let total = 0;
    for (const [k, bal] of balances) {
      if (k.endsWith(`::${asset}`)) total += bal;
    }
    return total;
  }

  /** Conservation: every asset's total must equal the configured supply. */
  function assertConservation() {
    for (const asset of TOKEN_TRANSFER_ASSETS) {
      const total = totalSupply(asset);
      if (total !== supplyFluff[asset]) {
        throw new TokenTransferError(`conservation broken for ${asset}: total ${total} fluff \u2260 supply ${supplyFluff[asset]} fluff`);
      }
    }
    return true;
  }

  function getReceipt(ref) {
    const receipt = typeof ref === "string" ? receipts.find((r) => r.receiptId === ref) : ref;
    if (!receipt || !receiptStates.has(receipt.receiptId)) {
      throw new TokenTransferError(`unknown receipt "${typeof ref === "string" ? ref : "?"}"`);
    }
    return receipt;
  }

  /**
   * Recompute a receipt's hashes from the retained before/after states and
   * payload — the same recomputation the receipt viewer performs. Returns
   * per-check results plus an overall ok flag.
   */
  function verifyReceipt(ref) {
    const receipt = getReceipt(ref);
    const { before, after, payload } = receiptStates.get(receipt.receiptId);
    const idx = receipt.sequence;
    const prevHash = idx === 0 ? "genesis" : receipts[idx - 1].afterHash;
    const checks = {
      sequence: receipts[idx] === receipt,
      linkage: idx === 0 || receipts[idx - 1].afterHash === prevHash,
      beforeHash: receipt.beforeHash === contentHash({ prev: prevHash, state: before }),
      afterHash: receipt.afterHash === contentHash({ prev: prevHash, state: after }),
      payloadHash: receipt.payloadHash === contentHash(payload),
    };
    return { receiptId: receipt.receiptId, ok: Object.values(checks).every(Boolean), checks };
  }

  /** Recompute the whole receipt chain. */
  function verifyChain() {
    for (const receipt of receipts) {
      if (!verifyReceipt(receipt.receiptId).ok) return false;
    }
    return true;
  }

  return {
    // config
    assets: TOKEN_TRANSFER_ASSETS,
    sysAccounts: TOKEN_TRANSFER_SYS_ACCOUNTS,
    supplyFluff: Object.freeze({ ...supplyFluff }),
    realm: TOKEN_TRANSFER_REALM,
    // reads
    balance,
    balances: (acct) => {
      const out = {};
      for (const asset of TOKEN_TRANSFER_ASSETS) out[asset] = balance(acct, asset);
      return out;
    },
    totalSupply,
    assertConservation,
    journals: () => [...journals],
    journalCount: () => journals.length,
    receipts: () => [...receipts],
    getReceipt,
    verifyReceipt,
    verifyChain,
    intents: () => [...intents.values()],
    getIntent: (intentId) => intents.get(intentId) ?? null,
    // mutations
    send,
    receive,
    tip,
    burn,
    deliverHold,
    deliverSettle,
    deliverCancel,
    // events + formatting helpers
    onEvent: (cb) => {
      if (typeof cb !== "function") throw new TokenTransferError("onEvent callback must be a function");
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    fmt: fmtFluff,
    parseSimToFluff,
  };
}

// ---------------------------------------------------------------------------
// Facade adapter — plugs the engine into window.TumboToken.
// ---------------------------------------------------------------------------

/**
 * Attach transfer actions to a TumboToken facade (creating the minimal
 * contract-shaped facade when none exists yet, e.g. before the core port in
 * src/domains/token.js lands).
 *
 * Every settled mutation emits through the facade's on(evt, cb) hub AND as a
 * document CustomEvent('tumbo:token', { detail: { type, ... } }) with
 * type 'receipt' or 'balance-changed', per the shared contract.
 */
export function attachTokenTransfers(facade = null, options = {}) {
  const engine = options.engine ?? createTokenTransferLedger(options.ledgerOptions);
  const target = facade && typeof facade === "object" ? facade : {};

  if (!target.ledger) target.ledger = engine;
  if (typeof target.balance !== "function") {
    target.balance = (acct, asset) => engine.balance(acct, asset);
  }
  if (typeof target.fmt !== "function") {
    target.fmt = (fluff) => engine.fmt(fluff);
  }

  const hubListeners = new Map();
  if (typeof target.on !== "function") {
    target.on = (evt, cb) => {
      if (typeof cb !== "function") throw new TokenTransferError("on() callback must be a function");
      let set = hubListeners.get(evt);
      if (!set) { set = new Set(); hubListeners.set(evt, set); }
      set.add(cb);
      return () => { set.delete(cb); };
    };
  }

  const notify = (type, detail) => {
    for (const cb of hubListeners.get(type) ?? []) {
      try { cb(detail); } catch { /* subscriber errors never break settlement */ }
    }
    try {
      if (typeof document !== "undefined" && typeof document.dispatchEvent === "function") {
        document.dispatchEvent(new CustomEvent("tumbo:token", { detail: { type, ...detail } }));
      }
    } catch { /* DOM event failures never break settlement */ }
  };

  const forwardEngineEvents = engine.onEvent(({ type, ...detail }) => notify(type, detail));
  target.__tokenTransferDetach = () => { forwardEngineEvents(); };

  for (const name of ["send", "receive", "tip", "burn", "deliverHold", "deliverSettle", "deliverCancel"]) {
    if (typeof target[name] !== "function") target[name] = (args) => engine[name](args);
  }
  if (typeof target.receipts !== "function") target.receipts = () => engine.receipts();
  if (typeof target.verifyReceipt !== "function") target.verifyReceipt = (ref) => engine.verifyReceipt(ref);
  if (typeof target.deliverIntents !== "function") target.deliverIntents = () => engine.intents();
  target.tokenTransfers = engine;

  try {
    if (typeof window !== "undefined" && !window.TumboToken) window.TumboToken = target;
  } catch { /* non-browser hosts skip the global */ }
  return target;
}

export default createTokenTransferLedger;

function validateIdempotencyKey(key) {
  if (typeof key !== "string" || key.trim() === "") {
    throw new TokenTransferError("every mutation requires a non-empty client idempotency key");
  }
  if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new TokenTransferError(`idempotency key must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`);
  }
  return key;
}

function requirePositiveFluff(amount, field = "amountFluff") {
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new TokenTransferError(`${field} must be a positive safe integer (fluff); received ${String(amount)}`);
  }
  return amount;
}

function validateDelta(delta) {
  if (!Number.isSafeInteger(delta)) {
    throw new TokenTransferError(`journal leg delta must be a safe integer; received ${String(delta)}`);
  }
  return delta;
}
