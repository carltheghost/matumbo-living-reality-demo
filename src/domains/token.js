/**
 * TUMBO-SIM token core — ledger, lifecycle (reverse / cancel / history),
 * receipt hash chain, and the `window.TumboToken` facade.
 *
 * SIMULATION ONLY — TUMBO-SIM are simulated points. No real money, no
 * wagering, no wallets, no custody, no chains, no settlement of real
 * value. Every surface built on this module must label the simulation.
 *
 * Shared contract implemented here:
 *  - Units are integer fluff. 1 TUMBO-SIM = 1000 fluff. Safe integers,
 *    >= 0, exact integer (BigInt) math only.
 *  - Assets: TUMBO, sMIMAS. Supply comes from ONE config constant
 *    (`TOKEN_CONFIG.SUPPLY_FLUFF`); never hardcode or quote it elsewhere.
 *  - Accounts: `u:<name>`, `b:<name>`, and sys:treasury, sys:faucet,
 *    sys:escrow, sys:vault, sys:void, sys:market. sys:void is credited
 *    only by burns (send to sys:void) and can never be debited.
 *  - Actions: send|receive|exchange|buy|sell|deliver|tip|stake|save|
 *    deposit|lock|reverse|cancel|unstake|withdraw.
 *  - Every mutation takes a client idempotency key; replays return the
 *    original receipt. Journals sum to 0 per asset; balances never go
 *    negative; receipts form an unbroken hash chain from genesis.
 *  - Lifecycle: reversing a settled tx posts a compensating journal
 *    (history is never edited). The reverse window is bounded to
 *    REVERSE_WINDOW_TICKS (1000) ledger ticks; double-reverse is
 *    impossible via the deterministic reverse idempotency key
 *    `reverse:<original-key>`. Cancelling a settled tx fails closed.
 *
 * This module is dependency-free and runtime-agnostic: it runs in Node
 * (tests) and in the browser (audit UI). Hashing is a self-contained
 * SHA-256 over canonical JSON (ledger-core's events.js needs node:crypto
 * and cannot run in the browser).
 */

/* ------------------------------------------------------------------ */
/* Config — the ONE place supply and lifecycle constants live.        */
/* ------------------------------------------------------------------ */

export const TOKEN_CONFIG = Object.freeze({
  /** Integer fluff per simulated token unit. */
  FLUFF_PER_UNIT: 1000,
  /** Supported assets. */
  ASSETS: Object.freeze(["TUMBO", "sMIMAS"]),
  /**
   * THE supply constant. Each asset's genesis allocation derives from
   * this single value. Never hardcode a supply number anywhere else and
   * never quote it in user-facing copy.
   */
  SUPPLY_FLUFF: 1_000_000_000_000,
  /** System accounts. */
  SYSTEM_ACCOUNTS: Object.freeze([
    "sys:treasury",
    "sys:faucet",
    "sys:escrow",
    "sys:vault",
    "sys:void",
    "sys:market",
  ]),
  /** All lifecycle actions. */
  ACTIONS: Object.freeze([
    "send",
    "receive",
    "exchange",
    "buy",
    "sell",
    "deliver",
    "tip",
    "stake",
    "save",
    "deposit",
    "lock",
    "reverse",
    "cancel",
    "unstake",
    "withdraw",
  ]),
  /** Bounded reverse window, in ledger ticks (one tick per journal). */
  REVERSE_WINDOW_TICKS: 1000,
  REALM: "tumbo-sim",
  STAMP: "Simulated Proof \u2014 TUMBO-SIM",
  SIMULATION: true,
});

const {
  ASSETS,
  SYSTEM_ACCOUNTS,
  ACTIONS,
  REVERSE_WINDOW_TICKS,
  FLUFF_PER_UNIT,
  SUPPLY_FLUFF,
  REALM,
  STAMP,
} = TOKEN_CONFIG;

const ACCOUNT_RE = /^(?:u|b):[a-z0-9](?:[a-z0-9._-]{0,62})?$/i;
const GENESIS_TICK = 0;

/* ------------------------------------------------------------------ */
/* Deterministic hashing: canonical JSON + self-contained SHA-256.    */
/* ------------------------------------------------------------------ */

function sortValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const v = sortValue(value[key]);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  return value;
}

/** Deterministic JSON: sorted keys, no incidental whitespace. */
export function canonicalJson(obj) {
  return JSON.stringify(sortValue(obj));
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

const rotr = (x, n) => (x >>> n) | (x << (32 - n));

/** SHA-256 hex digest of a UTF-8 string (sync, no node:crypto). */
export function sha256Hex(message) {
  const bytes = new TextEncoder().encode(String(message));
  const bitLen = bytes.length * 8;
  let paddedLen = bytes.length + 1;
  while (paddedLen % 64 !== 56) paddedLen += 1;
  const padded = new Uint8Array(paddedLen + 8);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen, Math.floor(bitLen / 0x100000000));
  view.setUint32(paddedLen + 4, bitLen >>> 0);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => (x >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

/** SHA-256 hex digest of the canonical JSON of `obj`. */
export function contentHash(obj) {
  return sha256Hex(canonicalJson(obj));
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export class TokenError extends Error {
  constructor(message, code = "token-error") {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}
export class InsufficientFundsError extends TokenError {
  constructor(message) {
    super(message, "insufficient-funds");
  }
}
export class UnbalancedJournalError extends TokenError {
  constructor(message) {
    super(message, "unbalanced-journal");
  }
}
export class UnknownAccountError extends TokenError {
  constructor(message) {
    super(message, "unknown-account");
  }
}
export class JournalNotFoundError extends TokenError {
  constructor(message) {
    super(message, "journal-not-found");
  }
}
export class ReverseWindowExpiredError extends TokenError {
  constructor(message) {
    super(message, "reverse-window-expired");
  }
}
export class AlreadyReversedError extends TokenError {
  constructor(message) {
    super(message, "already-reversed");
  }
}
export class CancelRejectedError extends TokenError {
  constructor(message) {
    super(message, "cancel-rejected");
  }
}

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */

function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function assertAccount(account) {
  requireNonEmptyString(account, "account");
  if (SYSTEM_ACCOUNTS.includes(account)) return account;
  if (ACCOUNT_RE.test(account)) return account;
  throw new UnknownAccountError(
    `unknown account "${account}": expected u:<name>, b:<name>, or a sys:* account`
  );
}

function assertAsset(asset) {
  if (!ASSETS.includes(asset)) {
    throw new TokenError(`unknown asset "${asset}": expected ${ASSETS.join("|")}`, "unknown-asset");
  }
  return asset;
}

/** Integer fluff as BigInt. Accepts safe-integer numbers or bigints >= 0. */
function toFluff(value, field = "amountFluff") {
  if (typeof value === "bigint") {
    if (value < 0n) throw new TypeError(`${field} must be >= 0`);
    return value;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a safe non-negative integer (fluff)`);
  }
  return BigInt(value);
}

/** Human-readable fluff: "1.500 TUMBO-SIM". Exact decimal, no floats. */
export function fmtFluff(fluff, asset = "TUMBO") {
  assertAsset(asset);
  const v = toFluff(fluff, "fluff");
  const units = v / BigInt(FLUFF_PER_UNIT);
  const rem = v % BigInt(FLUFF_PER_UNIT);
  return `${units.toString()}.${rem.toString().padStart(3, "0")} ${asset}-SIM`;
}

function freezePosting(p) {
  return Object.freeze({
    account: p.account,
    asset: p.asset,
    amountFluff: p.amount.toString(),
  });
}

/* ------------------------------------------------------------------ */
/* TumboToken — the ledger core with reverse / cancel / history.       */
/* ------------------------------------------------------------------ */

export class TumboToken {
  constructor() {
    this._balances = new Map(); // `${account}::${asset}` -> bigint
    this._journals = []; // append-only; index = seq - 1
    this._byKey = new Map(); // idempotencyKey -> journal
    this._byJournalId = new Map(); // journalId -> journal
    this._receiptByJournal = new Map(); // journalId -> receipt
    this._receipts = []; // receipt chain, index 0 = genesis
    this._receiptStates = []; // retained {beforeState, afterState, payload}
    this._tick = GENESIS_TICK;
    this._listeners = new Map();
    this._genesisAt = Date.now();
    this._issueGenesis();
  }

  /* -- balances --------------------------------------------------- */

  _bkey(account, asset) {
    return `${account}::${asset}`;
  }

  _getb(account, asset) {
    return this._balances.get(this._bkey(account, asset)) ?? 0n;
  }

  /** Balance in integer fluff (Number, safe). */
  balance(account, asset = "TUMBO") {
    assertAccount(account);
    assertAsset(asset);
    const v = this._getb(account, asset);
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new TokenError("balance exceeds safe integer range", "unsafe-integer");
    }
    return Number(v);
  }

  /** Current ledger tick (one tick per committed journal). */
  get tick() {
    return this._tick;
  }

  get journalCount() {
    return this._journals.length;
  }

  /* -- events ----------------------------------------------------- */

  /**
   * Subscribe to 'balance-changed' | 'receipt' | 'journal'.
   * Also mirrored as document CustomEvent('tumbo:token', {detail:{type,...}}).
   */
  on(evt, cb) {
    if (!["balance-changed", "receipt", "journal"].includes(evt)) {
      throw new TokenError(`unknown event "${evt}"`, "unknown-event");
    }
    if (typeof cb !== "function") throw new TypeError("callback must be a function");
    if (!this._listeners.has(evt)) this._listeners.set(evt, new Set());
    this._listeners.get(evt).add(cb);
    return () => this._listeners.get(evt)?.delete(cb);
  }

  _emit(type, detail) {
    const subs = this._listeners.get(type);
    if (subs) {
      for (const cb of [...subs]) {
        try {
          cb({ type, ...detail });
        } catch {
          /* listener errors never break the ledger */
        }
      }
    }
    try {
      if (typeof document !== "undefined" && typeof CustomEvent !== "undefined") {
        document.dispatchEvent(
          new CustomEvent("tumbo:token", {
            detail: { type, simulation: true, ...detail },
          })
        );
      }
    } catch {
      /* DOM mirroring is best-effort */
    }
  }

  /* -- genesis ---------------------------------------------------- */

  _snapshot(accounts) {
    const snap = {};
    for (const account of accounts) {
      const perAsset = {};
      for (const asset of ASSETS) {
        perAsset[asset] = this._getb(account, asset).toString();
      }
      snap[account] = perAsset;
    }
    return snap;
  }

  _issueGenesis() {
    for (const asset of ASSETS) {
      this._balances.set(this._bkey("sys:treasury", asset), BigInt(SUPPLY_FLUFF));
    }
    const afterState = this._snapshot(["sys:treasury"]);
    const payload = {
      genesis: true,
      assets: [...ASSETS],
      allocation: { "sys:treasury": "SUPPLY_FLUFF (see TOKEN_CONFIG)" },
      note: "Simulated genesis allocation. TUMBO-SIM are simulated points; no real value.",
    };
    const receipt = this._issueReceipt({
      actorId: "tumbo-sim-node",
      reference: "genesis",
      action: "genesis",
      summary: "genesis \u2014 simulated supply allocation to sys:treasury",
      beforeState: null,
      afterState,
      payload,
    });
    this._receiptByJournal.set("genesis", receipt);
  }

  _issueReceipt({ actorId, reference, action, summary, beforeState, afterState, payload }) {
    const seq = this._receipts.length;
    const prevHash = seq === 0 ? "genesis" : this._receipts[seq - 1].afterHash;
    const receipt = Object.freeze({
      sequence: seq,
      actorId,
      realm: REALM,
      reference,
      action,
      summary,
      beforeHash: contentHash({ prev: prevHash, state: beforeState }),
      afterHash: contentHash({ prev: prevHash, state: afterState }),
      payloadHash: contentHash(payload),
      verificationState: "verified-simulated",
      signer: "tumbo-sim-node",
      issuedAt: Date.now(),
      stamp: STAMP,
      simulation: true,
    });
    this._receipts.push(receipt);
    this._receiptStates.push({ beforeState, afterState, payload });
    return receipt;
  }

  /* -- journal plumbing ------------------------------------------- */

  _lookup(id) {
    if (id === "genesis") return null; // genesis is not a journal
    return (
      this._byJournalId.get(id) ??
      this._byKey.get(id) ??
      (typeof id === "number" ? this._journals[id - 1] : undefined) ??
      null
    );
  }

  _requireJournal(id) {
    const j = this._lookup(id);
    if (!j) throw new JournalNotFoundError(`no journal for "${id}"`);
    return j;
  }

  /** Frozen public copy of a journal. */
  journalOf(id) {
    if (id === "genesis") return this._genesisRow();
    const j = this._lookup(id);
    return j ? this._copyJournal(j) : null;
  }

  _copyJournal(j) {
    return Object.freeze({
      journalId: j.journalId,
      seq: j.seq,
      tick: j.tick,
      action: j.action,
      state: j.state,
      actor: j.actor,
      memo: j.memo,
      idempotencyKey: j.idempotencyKey,
      linkedJournalId: j.linkedJournalId,
      reversedBy: j.reversedBy,
      settledTick: j.settledTick,
      createdAt: j.createdAt,
      summary: j.summary,
      postings: Object.freeze(j.postings.map((p) => Object.freeze({ ...p }))),
    });
  }

  _genesisRow() {
    return Object.freeze({
      journalId: "genesis",
      seq: 0,
      tick: GENESIS_TICK,
      action: "genesis",
      state: "settled",
      actor: "tumbo-sim-node",
      memo: "Simulated genesis allocation.",
      idempotencyKey: "genesis",
      linkedJournalId: null,
      reversedBy: null,
      settledTick: GENESIS_TICK,
      createdAt: this._genesisAt,
      summary: "genesis \u2014 simulated supply allocation to sys:treasury",
      postings: Object.freeze([]),
    });
  }

  /**
   * The ONE write path. Validates, applies atomically, appends the
   * journal, issues the chained receipt, emits events.
   * Idempotent: a repeated key returns the original {journal, receipt}.
   */
  _commit({ action, legs, idempotencyKey, actor = "sim", memo = null, linkedJournalId = null, settle = false }) {
    requireNonEmptyString(idempotencyKey, "idempotencyKey");
    if (!ACTIONS.includes(action)) {
      throw new TokenError(`unknown action "${action}"`, "unknown-action");
    }

    const replayed = this._byKey.get(idempotencyKey);
    if (replayed) {
      return {
        journal: this._copyJournal(replayed),
        receipt: this._receiptByJournal.get(replayed.journalId),
        replayed: true,
      };
    }

    if (!Array.isArray(legs) || legs.length === 0) {
      throw new UnbalancedJournalError("a journal needs at least one posting leg");
    }
    const normLegs = legs.map((leg, i) => {
      if (!leg || typeof leg !== "object") throw new TypeError(`legs[${i}] must be an object`);
      return {
        account: assertAccount(leg.account),
        asset: assertAsset(leg.asset),
        amount: toFluff(leg.amount, `legs[${i}].amount`),
      };
    });
    // sys:void is credited only by burns, never debited.
    for (const leg of normLegs) {
      if (leg.account === "sys:void" && leg.amount < 0n) {
        throw new TokenError("sys:void can never be debited", "void-debit");
      }
    }
    if (normLegs.every((leg) => leg.amount === 0n)) {
      throw new UnbalancedJournalError("journal postings are all zero");
    }
    // Journals sum to exactly 0 per asset (exact integer math).
    const totals = new Map();
    for (const leg of normLegs) {
      totals.set(leg.asset, (totals.get(leg.asset) ?? 0n) + leg.amount);
    }
    for (const [asset, total] of totals) {
      if (total !== 0n) {
        throw new UnbalancedJournalError(
          `postings for ${asset} sum to ${total} fluff, must be exactly 0`
        );
      }
    }

    // Stage on copies: atomic — never half-apply. Balances never negative.
    const touched = new Set(normLegs.map((leg) => leg.account));
    const beforeSnap = this._snapshot(touched);
    const staged = new Map();
    for (const leg of normLegs) {
      const key = this._bkey(leg.account, leg.asset);
      const current = staged.has(key) ? staged.get(key) : this._getb(leg.account, leg.asset);
      const next = current + leg.amount;
      if (next < 0n) {
        throw new InsufficientFundsError(
          `${leg.account} would go negative in ${leg.asset} (needs ${fmtFluff(-leg.amount > current ? -leg.amount : 0n, leg.asset)})`
        );
      }
      staged.set(key, next);
    }
    for (const [key, next] of staged) this._balances.set(key, next);
    const afterSnap = this._snapshot(touched);

    const seq = this._journals.length + 1;
    this._tick += 1;
    const journalId = `tx-${String(seq).padStart(6, "0")}`;
    const summary = summarize(action, normLegs);
    const journal = {
      journalId,
      seq,
      tick: this._tick,
      action,
      state: settle ? "settled" : "pending",
      actor,
      memo,
      idempotencyKey,
      linkedJournalId,
      reversedBy: null,
      settledTick: settle ? this._tick : null,
      createdAt: Date.now(),
      summary,
      postings: normLegs.map((leg) => freezePosting(leg)),
    };
    this._journals.push(journal);
    this._byKey.set(idempotencyKey, journal);
    this._byJournalId.set(journalId, journal);

    const receipt = this._issueReceipt({
      actorId: actor,
      reference: journalId,
      action,
      summary,
      beforeState: beforeSnap,
      afterState: afterSnap,
      payload: {
        journalId,
        seq,
        tick: journal.tick,
        action,
        postings: journal.postings,
        linkedJournalId,
        memo,
      },
    });
    this._receiptByJournal.set(journalId, receipt);

    this._emit("journal", { journal: this._copyJournal(journal) });
    this._emit("receipt", { receipt });
    for (const account of touched) {
      for (const asset of ASSETS) {
        const k = this._bkey(account, asset);
        if (staged.has(k)) {
          this._emit("balance-changed", {
            account,
            asset,
            balance: this.balance(account, asset),
            journalId,
          });
        }
      }
    }
    return { journal: this._copyJournal(journal), receipt, replayed: false };
  }

  /* -- action legs ------------------------------------------------- */

  _legsFor(action, { asset, from, to, amount, assetB, amountB }) {
    const A = assertAsset(asset);
    const amt = toFluff(amount, "amountFluff");
    const debit = (account, a, v) => ({ account, asset: a, amount: -v });
    const credit = (account, a, v) => ({ account, asset: a, amount: v });
    const req = (v, name) => {
      if (v === undefined || v === null) throw new TypeError(`${name} is required for ${action}`);
      return v;
    };
    switch (action) {
      case "send":
      case "receive":
      case "tip":
        return [debit(assertAccount(req(from, "from")), A, amt), credit(assertAccount(req(to, "to")), A, amt)];
      case "deposit":
        return [
          debit(assertAccount(from ?? "sys:faucet"), A, amt),
          credit(assertAccount(req(to, "to")), A, amt),
        ];
      case "stake":
      case "save":
        return [
          debit(assertAccount(req(from, "from")), A, amt),
          credit("sys:vault", A, amt),
        ];
      case "lock":
        return [
          debit(assertAccount(req(from, "from")), A, amt),
          credit("sys:escrow", A, amt),
        ];
      case "deliver":
        return [
          debit(assertAccount(from ?? "sys:escrow"), A, amt),
          credit(assertAccount(req(to, "to")), A, amt),
        ];
      case "unstake":
      case "withdraw":
        return [
          debit(assertAccount(from ?? "sys:vault"), A, amt),
          credit(assertAccount(req(to, "to")), A, amt),
        ];
      case "exchange":
      case "buy":
      case "sell": {
        const B = assertAsset(req(assetB, "assetB"));
        const amtB = toFluff(req(amountB, "amountBFluff"), "amountBFluff");
        const f = assertAccount(req(from, "from"));
        const t = assertAccount(req(to, "to"));
        return [
          debit(f, A, amt),
          credit(t, A, amt),
          debit(t, B, amtB),
          credit(f, B, amtB),
        ];
      }
      default:
        throw new TokenError(
          `action "${action}" cannot be executed directly (use reverse()/cancel())`,
          "lifecycle-action"
        );
    }
  }

  /**
   * Execute a token action. Every mutation takes a client idempotency
   * key; replays return the original receipt.
   */
  execute(params = {}) {
    const {
      action,
      asset = "TUMBO",
      from,
      to,
      amountFluff,
      assetB,
      amountBFluff,
      idempotencyKey,
      actor = "sim",
      memo = null,
      settle = true,
    } = params;
    requireNonEmptyString(action, "action");
    if (action === "reverse" || action === "cancel") {
      throw new TokenError(`use ${action}() for lifecycle actions`, "lifecycle-action");
    }
    const legs = this._legsFor(action, {
      asset,
      from,
      to,
      amount: amountFluff,
      assetB,
      amountB: amountBFluff,
    });
    return this._commit({ action, legs, idempotencyKey, actor, memo, settle });
  }

  /** pending -> settled. */
  settle(id, { actor = "sim" } = {}) {
    const j = this._requireJournal(id);
    if (j.state !== "pending") {
      throw new TokenError(
        `only pending journals can settle (tx ${j.journalId} is ${j.state})`,
        "invalid-state"
      );
    }
    j.state = "settled";
    j.settledTick = this._tick;
    this._emit("journal", { journal: this._copyJournal(j), transition: "settled", actor });
    return this._copyJournal(j);
  }

  /**
   * Reverse a journal by posting a compensating journal. History is
   * never edited: the original journal stays, linked to its reversal.
   * Bounded by REVERSE_WINDOW_TICKS — afterwards it fails closed.
   * Double-reverse is impossible: the deterministic key
   * `reverse:<original-key>` replays the original reversal, and any
   * fresh key against an already-reversed journal throws.
   */
  reverse(id, { idempotencyKey, actor = "sim", memo = null } = {}) {
    const j = this._requireJournal(id);
    const rkey = idempotencyKey ?? `reverse:${j.idempotencyKey}`;
    const replayed = this._byKey.get(rkey);
    if (replayed) {
      return {
        journal: this._copyJournal(replayed),
        receipt: this._receiptByJournal.get(replayed.journalId),
        replayed: true,
      };
    }
    if (j.state === "reversed") {
      throw new AlreadyReversedError(`tx ${j.journalId} was already reversed by ${j.reversedBy}`);
    }
    if (j.state !== "settled" && j.state !== "pending") {
      throw new TokenError(`tx ${j.journalId} cannot be reversed from state "${j.state}"`, "invalid-state");
    }
    if (j.action === "reverse" || j.action === "cancel") {
      throw new TokenError(
        `lifecycle journals cannot be reversed (tx ${j.journalId} is a ${j.action})`,
        "lifecycle-action"
      );
    }
    const age = this._tick - j.tick;
    if (age > REVERSE_WINDOW_TICKS) {
      throw new ReverseWindowExpiredError(
        `reverse window expired: tx ${j.journalId} is ${age} ticks old (window is ${REVERSE_WINDOW_TICKS} ticks)`
      );
    }
    const legs = j.postings.map((p) => ({
      account: p.account,
      asset: p.asset,
      amount: -BigInt(p.amountFluff),
    }));
    const res = this._commit({
      action: "reverse",
      legs,
      idempotencyKey: rkey,
      actor,
      memo: memo ?? `reversal of ${j.journalId} (${j.action})`,
      linkedJournalId: j.journalId,
      settle: true,
    });
    j.state = "reversed";
    j.reversedBy = res.journal.journalId;
    this._emit("journal", {
      journal: this._copyJournal(j),
      transition: "reversed",
      reversalId: res.journal.journalId,
    });
    return res;
  }

  /**
   * Cancel a PENDING journal by posting a compensating journal.
   * Cancelling a settled journal fails closed — reverse it instead.
   */
  cancel(id, { idempotencyKey, actor = "sim", memo = null } = {}) {
    const j = this._requireJournal(id);
    const ckey = idempotencyKey ?? `cancel:${j.idempotencyKey}`;
    const replayed = this._byKey.get(ckey);
    if (replayed) {
      return {
        journal: this._copyJournal(replayed),
        receipt: this._receiptByJournal.get(replayed.journalId),
        replayed: true,
      };
    }
    if (j.state === "settled") {
      throw new CancelRejectedError(
        `cannot cancel settled tx ${j.journalId}; reverse it within ${REVERSE_WINDOW_TICKS} ticks instead`
      );
    }
    if (j.state !== "pending") {
      throw new TokenError(`tx ${j.journalId} cannot be cancelled from state "${j.state}"`, "invalid-state");
    }
    if (j.action === "reverse" || j.action === "cancel") {
      throw new TokenError(
        `lifecycle journals cannot be cancelled (tx ${j.journalId} is a ${j.action})`,
        "lifecycle-action"
      );
    }
    const legs = j.postings.map((p) => ({
      account: p.account,
      asset: p.asset,
      amount: -BigInt(p.amountFluff),
    }));
    const res = this._commit({
      action: "cancel",
      legs,
      idempotencyKey: ckey,
      actor,
      memo: memo ?? `cancellation of pending ${j.journalId} (${j.action})`,
      linkedJournalId: j.journalId,
      settle: true,
    });
    j.state = "cancelled";
    this._emit("journal", {
      journal: this._copyJournal(j),
      transition: "cancelled",
      cancellationId: res.journal.journalId,
    });
    return res;
  }

  /* -- history / audit -------------------------------------------- */

  /**
   * List journals (newest first) with filters: action, account, asset,
   * state. Includes the synthetic genesis row.
   */
  history({ action, account, asset, state, limit = 100, offset = 0 } = {}) {
    let rows = [this._genesisRow()];
    for (let i = this._journals.length - 1; i >= 0; i -= 1) {
      rows.push(this._copyJournal(this._journals[i]));
    }
    if (action) rows = rows.filter((r) => r.action === action);
    if (state) rows = rows.filter((r) => r.state === state);
    if (asset) {
      assertAsset(asset);
      rows = rows.filter(
        (r) => r.journalId === "genesis" || r.postings.some((p) => p.asset === asset)
      );
    }
    if (account) {
      assertAccount(account);
      rows = rows.filter(
        (r) => r.journalId === "genesis" || r.postings.some((p) => p.account === account)
      );
    }
    const total = rows.length;
    rows = rows.slice(offset, offset + Math.max(0, limit));
    return { total, rows: Object.freeze(rows) };
  }

  /** EchoProof-style receipt for a journal (frozen copy). */
  receiptFor(id) {
    if (id === "genesis") return this._receiptByJournal.get("genesis");
    const j = this._lookup(id);
    return j ? this._receiptByJournal.get(j.journalId) : null;
  }

  /**
   * Recompute a receipt's hashes from the retained states and check the
   * prevHash linkage. This is the per-tx check the audit view runs.
   */
  verifyJournal(id) {
    const jid = id === "genesis" ? "genesis" : this._requireJournal(id).journalId;
    const seq = jid === "genesis" ? 0 : this._requireJournal(jid).seq;
    const receipt = this._receipts[seq];
    const { beforeState, afterState, payload } = this._receiptStates[seq];
    const prevHash = seq === 0 ? "genesis" : this._receipts[seq - 1].afterHash;
    const checks = [
      {
        name: "sequence",
        ok: receipt.sequence === seq,
        detail: `receipt.sequence=${receipt.sequence}, expected=${seq}`,
      },
      {
        name: "reference",
        ok: receipt.reference === jid,
        detail: `receipt.reference=${receipt.reference}`,
      },
      {
        name: "beforeHash recomputed",
        ok: receipt.beforeHash === contentHash({ prev: prevHash, state: beforeState }),
        detail: receipt.beforeHash.slice(0, 16),
      },
      {
        name: "afterHash recomputed",
        ok: receipt.afterHash === contentHash({ prev: prevHash, state: afterState }),
        detail: receipt.afterHash.slice(0, 16),
      },
      {
        name: "payloadHash recomputed",
        ok: receipt.payloadHash === contentHash(payload),
        detail: receipt.payloadHash.slice(0, 16),
      },
      {
        name: "prevHash chain link",
        ok:
          seq === 0 ||
          receipt.beforeHash ===
            contentHash({ prev: this._receipts[seq - 1].afterHash, state: beforeState }),
        detail: seq === 0 ? "genesis anchor" : `prev=${String(prevHash).slice(0, 16)}\u2026`,
      },
    ];
    return { journalId: jid, ok: checks.every((c) => c.ok), checks: Object.freeze(checks) };
  }

  /** Full chain integrity report, one entry per receipt. */
  verifyChainReport() {
    const report = [];
    for (let seq = 0; seq < this._receipts.length; seq += 1) {
      const jid = seq === 0 ? "genesis" : this._journals[seq - 1].journalId;
      const v = this.verifyJournal(jid);
      report.push({
        seq,
        journalId: jid,
        ok: v.ok,
        failures: v.checks.filter((c) => !c.ok).map((c) => c.name),
      });
    }
    return Object.freeze(report);
  }

  /** Recompute the whole chain: every hash and every prevHash link. */
  verifyChain() {
    return this.verifyChainReport().every((r) => r.ok);
  }
}

/* ------------------------------------------------------------------ */
/* Summaries                                                           */
/* ------------------------------------------------------------------ */

function summarize(action, legs) {
  const byAsset = new Map();
  for (const leg of legs) {
    if (!byAsset.has(leg.asset)) byAsset.set(leg.asset, []);
    byAsset.get(leg.asset).push(leg);
  }
  const parts = [];
  for (const [asset, ls] of byAsset) {
    const outs = ls.filter((l) => l.amount < 0n);
    const ins = ls.filter((l) => l.amount > 0n);
    if (outs.length === 1 && ins.length === 1) {
      parts.push(`${fmtFluff(-outs[0].amount, asset)} ${outs[0].account} \u2192 ${ins[0].account}`);
    } else {
      parts.push(`${fmtFluff(ls.reduce((t, l) => t + (l.amount > 0n ? l.amount : 0n), 0n), asset)} across ${ls.length} legs`);
    }
  }
  return `${action} ${parts.join(" + ")}`;
}

/* ------------------------------------------------------------------ */
/* Facade: window.TumboToken                                           */
/* ------------------------------------------------------------------ */

/** Build the facade object over a fresh ledger core. */
export function createTumboToken() {
  const core = new TumboToken();
  const facade = {
    /** The ledger core (journals, reverse/cancel, history, receipts). */
    ledger: core,
    core,
    config: TOKEN_CONFIG,
    /** Balance in integer fluff. */
    balance: (account, asset = "TUMBO") => core.balance(account, asset),
    /** Format integer fluff, e.g. "1.500 TUMBO-SIM". */
    fmt: (fluff, asset = "TUMBO") => fmtFluff(fluff, asset),
    /** Subscribe to 'balance-changed' | 'receipt' | 'journal'. */
    on: (evt, cb) => core.on(evt, cb),
    execute: (params) => core.execute(params),
    settle: (id, opts) => core.settle(id, opts),
    reverse: (id, opts) => core.reverse(id, opts),
    cancel: (id, opts) => core.cancel(id, opts),
    history: (filters) => core.history(filters),
    journalOf: (id) => core.journalOf(id),
    receiptFor: (id) => core.receiptFor(id),
    verifyJournal: (id) => core.verifyJournal(id),
    verifyChain: () => core.verifyChain(),
    verifyChainReport: () => core.verifyChainReport(),
    tick: () => core.tick,
    simulation: true,
  };
  return Object.freeze(facade);
}

/** Install the facade as `scope.TumboToken`. Returns the facade. */
export function installTumboToken(scope) {
  const facade = createTumboToken();
  scope.TumboToken = facade;
  return facade;
}

// Auto-install in browsers so `window.TumboToken` exists on import.
if (typeof window !== "undefined") {
  installTumboToken(window);
}
