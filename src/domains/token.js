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

/* Config — the ONE place supply and lifecycle constants live.        */
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
  /** Journal states. */
  STATES: Object.freeze(["pending", "settled", "reversed", "cancelled"]),
  /**
   * Reverse window in ledger ticks. A settled journal can only be
   * reversed while `currentTick - journal.tick <= REVERSE_WINDOW_TICKS`.
   */
  REVERSE_WINDOW_TICKS: 1000,
});

/* Small errors with machine-readable codes.                          */

export class TokenError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "TokenError";
    this.code = code;
  }
}

const tokenErr = (code, message) => new TokenError(code, message);

/* Integer fluff helpers — exact math only.                          */

/**
 * Normalize a public amount to a nonnegative safe integer of fluff.
 * Accepts numbers, numeric strings, or bigints; rejects negatives,
 * fractions, booleans, null/undefined, and unsafe integers.
 */
export function toFluff(value, label = "amount") {
  if (typeof value === "boolean" || value === null || value === undefined) {
    throw tokenErr("bad-amount", `${label} must be an integer fluff amount`);
  }
  if (typeof value === "bigint") {
    if (value < 0n) throw tokenErr("negative-amount", `${label} must be >= 0 fluff`);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw tokenErr("amount-unsafe", `${label} is outside the safe integer range`);
    }
    return Number(value);
  }
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return toFluff(BigInt(value), label);
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
    throw tokenErr("bad-amount", `${label} must be an integer fluff amount`);
  }
  if (value < 0) throw tokenErr("negative-amount", `${label} must be >= 0 fluff`);
  return value;
}

/**
 * Signed counterpart for internal postings. Debit legs are negative and
 * credit legs positive; same strictness as toFluff, but sign is allowed.
 * Public amounts must still go through toFluff.
 */
export function toSignedFluff(value, label = "posting") {
  if (typeof value === "boolean" || value === null || value === undefined) {
    throw tokenErr("bad-amount", `${label} must be an integer fluff amount`);
  }
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(-Number.MAX_SAFE_INTEGER)) {
      throw tokenErr("amount-unsafe", `${label} is outside the safe integer range`);
    }
    return Number(value);
  }
  if (typeof value === "string" && /^-?[0-9]+$/.test(value)) return toSignedFluff(BigInt(value), label);
  if (typeof value !== "number" || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
    throw tokenErr("bad-amount", `${label} must be an integer fluff amount`);
  }
  return value;
}

/** Exact fluff formatting: `1.500 TUMBO-SIM`, never floats. */
export function fmtFluff(fluff, asset = "TUMBO") {
  const v = toFluff(fluff, "fluff");
  const per = TOKEN_CONFIG.FLUFF_PER_UNIT;
  const whole = Math.floor(v / per);
  const frac = String(v % per).padStart(3, "0");
  return `${whole}.${frac} ${asset}-SIM`;
}

/* Canonical JSON + self-contained SHA-256 (browser & Node).         */

/** Canonical JSON: sorted keys, no whitespace, BigInt -> string. */
export function canonicalJson(value) {
  const seen = new Set();
  const encode = (v) => {
    if (v === null || v === undefined) return "null";
    if (typeof v === "bigint") return JSON.stringify(v.toString());
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") {
      const s = JSON.stringify(v);
      if (s === undefined) throw tokenErr("bad-payload", "value is not JSON-encodable");
      return s;
    }
    if (typeof v !== "object") throw tokenErr("bad-payload", "value is not JSON-encodable");
    if (seen.has(v)) throw tokenErr("bad-payload", "circular value is not encodable");
    seen.add(v);
    let out;
    if (Array.isArray(v)) {
      out = `[${v.map((item) => encode(item)).join(",")}]`;
    } else {
      out =
        "{" +
        Object.keys(v)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${encode(v[k])}`)
          .join(",") +
        "}";
    }
    seen.delete(v);
    return out;
  };
  return encode(value);
}

/* SHA-256 over UTF-8 bytes. Self-contained so the module stays
 * dependency-free in the browser (ledger-core/events.js needs
 * node:crypto and cannot run client-side). */
const SHA256_K = Object.freeze([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Bytes(message) {
  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  // Pad to a multiple of 512 bits, reserving 64 bits for the length.
  const paddedLen = (((bytes.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 2 ** 32), false);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  const rotr = (x, n) => (x >>> n) | (x << (32 - n));

  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + s1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  [h0, h1, h2, h3, h4, h5, h6, h7].forEach((h, i) => ov.setUint32(i * 4, h, false));
  return out;
}

/** Lowercase hex SHA-256 digest of a string. */
export function sha256Hex(message) {
  return Array.from(sha256Bytes(String(message)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hash a canonical-JSON payload. */
export function hashPayload(payload) {
  return sha256Hex(canonicalJson(payload));
}

/* Account / asset validation.                                   */

function validateAccount(acct) {
  if (typeof acct !== "string") throw tokenErr("bad-account", "account must be a string");
  if (TOKEN_CONFIG.SYSTEM_ACCOUNTS.includes(acct)) return acct;
  if (/^[ub]:[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(acct)) return acct;
  throw tokenErr("bad-account", `unknown account "${acct}"`);
}

function validateAsset(asset) {
  if (!TOKEN_CONFIG.ASSETS.includes(asset)) throw tokenErr("bad-asset", `unknown asset "${asset}"`);
  return asset;
}

function validateAction(action) {
  if (!TOKEN_CONFIG.ACTIONS.includes(action)) throw tokenErr("bad-action", `unknown action "${action}"`);
  return action;
}

/* The ledger.                                                   */

/**
 * createTumboToken() — builds one independent simulated ledger.
 *
 * Journals (double-entry, signed integer fluff postings):
 *   { journalId, tick, action, asset, memo, state,
 *     linkedJournalId, postings:[{account, asset, amountFluff}],
 *     balanced:true, prevHash, hash, idempotencyKey }
 * Receipts: { journalId, tick, state, afterHash, prevHash, hash } — an
 * unbroken chain anchored at genesis; `hash` signs (journalId, tick,
 * state, afterHash, prevHash).
 */
export function createTumboToken() {
  const listeners = new Map();
  const ledger = {
    tick: 0,
    seq: 0,
    balances: new Map(),
    journals: [],
    _byId: new Map(),
    _byKey: new Map(),
    _receipts: [],
    get journalCount() {
      return this.journals.length;
    },
  };

  const emit = (event, payload) => {
    const set = listeners.get(event);
    if (!set) return;
    set.forEach((cb) => {
      try {
        cb(payload);
      } catch (err) {
        if (typeof console !== "undefined" && console.error) console.error("[TumboToken]", err);
      }
    });
  };

  const balanceKey = (acct, asset) => `${acct}\u0000${asset}`;

  const getBalance = (acct, asset) => {
    validateAccount(acct);
    validateAsset(asset);
    return ledger.balances.get(balanceKey(acct, asset)) ?? 0;
  };

  const checkBalanced = (postings) => {
    const totals = new Map();
    for (const p of postings) {
      const k = validateAsset(p.asset);
      totals.set(k, (totals.get(k) ?? 0n) + BigInt(toSignedFluff(p.amountFluff, "postings[].amountFluff")));
    }
    for (const [asset, total] of totals) {
      if (total !== 0n) throw tokenErr("unbalanced", `journal does not balance for asset ${asset}`);
    }
    return true;
  };

  const canonicalizeJournal = (journal) => {
    checkBalanced(journal.postings);
    return {
      journalId: String(journal.journalId),
      tick: journal.tick,
      action: journal.action,
      asset: journal.asset,
      memo: journal.memo == null ? "" : String(journal.memo),
      state: journal.state,
      linkedJournalId: journal.linkedJournalId == null ? null : String(journal.linkedJournalId),
      postings: journal.postings.map((p) => ({
        account: validateAccount(p.account),
        asset: validateAsset(p.asset),
        amountFluff: toSignedFluff(p.amountFluff, "postings[].amountFluff"),
      })),
      balanced: true,
      prevHash: journal.prevHash,
      idempotencyKey: journal.idempotencyKey,
    };
  };

  /* Genesis — mints the configured supply per asset into sys:treasury. */
  const genesis = (() => {
    const postings = [];
    for (const asset of TOKEN_CONFIG.ASSETS) {
      postings.push({ account: "sys:treasury", asset, amountFluff: TOKEN_CONFIG.SUPPLY_FLUFF });
    }
    // Genesis carries no offsetting debit: it is the supply root, marked
    // explicitly so balance checks never see a fake counterparty.
    const body = canonicalizeGenesis(postings);
    const hash = hashPayload(body);
    const journal = { ...body, journalId: "genesis", tick: 0, action: "genesis", hash };
    for (const p of postings) {
      ledger.balances.set(balanceKey(p.account, p.asset), p.amountFluff);
    }
    ledger.journals.push(journal);
    ledger._byId.set("genesis", journal);
    ledger._receipts.push({
      journalId: "genesis",
      tick: 0,
      state: "settled",
      afterHash: hash,
      prevHash: "GENESIS",
      hash: hashPayload({ journalId: "genesis", tick: 0, state: "settled", afterHash: hash, prevHash: "GENESIS" }),
    });
    return journal;
  })();

  function canonicalizeGenesis(postings) {
    return {
      tick: 0,
      action: "genesis",
      asset: "*",
      memo: "simulated supply root (no real value)",
      state: "settled",
      linkedJournalId: null,
      postings: postings.map((p) => ({
        account: validateAccount(p.account),
        asset: validateAsset(p.asset),
        amountFluff: toFluff(p.amountFluff, "genesis"),
      })),
      balanced: true,
      prevHash: "GENESIS",
      idempotencyKey: "genesis",
    };
  }

  /* Core commit path — validates, applies, chains, receipts, emits. */
  const _commit = ({ action, asset, postings, memo, state, linkedJournalId, idempotencyKey }) => {
    validateAction(action);
    const journal = {
      journalId: `j${++ledger.seq}`,
      tick: ++ledger.tick,
      action,
      asset: asset == null ? "*" : validateAsset(asset),
      memo: memo == null ? "" : String(memo),
      state,
      linkedJournalId: linkedJournalId == null ? null : linkedJournalId,
      postings: postings.map((leg) => ({
        account: validateAccount(leg.account),
        asset: validateAsset(leg.asset),
        amountFluff: toSignedFluff(leg.amount, "postings[].amountFluff"),
      })),
      balanced: true,
      prevHash: ledger._receipts[ledger._receipts.length - 1].hash,
      idempotencyKey,
    };
    checkBalanced(journal.postings);

    // Balance guard: apply to a scratch copy first so failed commits
    // never leave partial state.
    const deltas = new Map();
    for (const p of journal.postings) {
      if (p.account === "sys:void" && p.amountFluff < 0) {
        throw tokenErr("void-debit", "sys:void can be credited by burns but never debited");
      }
      const k = balanceKey(p.account, p.asset);
      deltas.set(k, (deltas.get(k) ?? 0n) + BigInt(p.amountFluff));
    }
    for (const [k, delta] of deltas) {
      const next = BigInt(ledger.balances.get(k) ?? 0) + delta;
      if (next < 0n) throw tokenErr("insufficient-funds", "balance would go negative");
      deltas.set(k, next);
    }
    for (const [k, next] of deltas) ledger.balances.set(k, Number(next));

    const body = canonicalizeJournal({ ...journal });
    journal.hash = hashPayload(body);
    ledger.journals.push(journal);
    ledger._byId.set(journal.journalId, journal);
    ledger._byKey.set(idempotencyKey, journal.journalId);

    const receipt = {
      journalId: journal.journalId,
      tick: journal.tick,
      state: journal.state,
      afterHash: journal.hash,
      prevHash: journal.prevHash,
      hash: hashPayload({
        journalId: journal.journalId,
        tick: journal.tick,
        state: journal.state,
        afterHash: journal.hash,
        prevHash: journal.prevHash,
      }),
    };
    ledger._receipts.push(receipt);
    emit("journal", { journal: freezeJournal(journal), receipt: { ...receipt } });
    emit("receipt", { journal: freezeJournal(journal), receipt: { ...receipt } });
    return { journal: freezeJournal(journal), receipt: { ...receipt } };
  };

  const freezeJournal = (j) =>
    Object.freeze({
      ...j,
      postings: Object.freeze(j.postings.map((p) => Object.freeze({ ...p }))),
    });

  /* Posting templates.                                             */
  const _legsFor = ({ asset, from, to, amountFluff }) => {
    const v = toFluff(amountFluff, "amountFluff");
    return [
      { account: from, asset, amount: -v },
      { account: to, asset, amount: v },
    ];
  };

  const _execute = (spec, { settle }) => {
    const action = validateAction(spec.action);
    const asset = validateAsset(spec.asset ?? "TUMBO");
    const from = validateAccount(spec.from);
    const to = validateAccount(spec.to);
    const key = spec.idempotencyKey == null ? null : String(spec.idempotencyKey);
    if (!key) throw tokenErr("missing-idempotency-key", "every mutation needs a client idempotency key");
    const replayId = ledger._byKey.get(key);
    if (replayId) {
      const j = ledger._byId.get(replayId);
      return { journal: freezeJournal(j), receipt: null, replayed: true };
    }
    if (from === to) throw tokenErr("self-transfer", "from and to must differ");

    let postings;
    if (action === "exchange") {
      const giveAsset = validateAsset(spec.giveAsset ?? asset);
      const wantAsset = validateAsset(spec.wantAsset);
      if (giveAsset === wantAsset) throw tokenErr("bad-exchange", "exchange needs two different assets");
      const give = toFluff(spec.amountFluff, "amountFluff");
      const want = toFluff(spec.wantAmountFluff ?? spec.amountFluff, "wantAmountFluff");
      const market = "sys:market";
      postings = [
        { account: from, asset: giveAsset, amount: -give },
        { account: market, asset: giveAsset, amount: give },
        { account: market, asset: wantAsset, amount: -want },
        { account: to, asset: wantAsset, amount: want },
      ];
    } else {
      postings = _legsFor({ asset, from, to, amountFluff: spec.amountFluff });
    }

    return {
      ..._commit({
        action,
        asset,
        postings,
        memo: spec.memo,
        state: settle ? "settled" : "pending",
        linkedJournalId: spec.linkedJournalId,
        idempotencyKey: key,
      }),
      replayed: false,
    };
  };

  /* Public API.                                                    */
  const api = {
    config: TOKEN_CONFIG,
    ledger,
    genesis: () => freezeJournal(genesis),

    on(event, cb) {
      if (typeof cb !== "function") throw tokenErr("bad-listener", "listener must be a function");
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(cb);
      return () => listeners.get(event)?.delete(cb);
    },

    tick: () => ledger.tick,
    balance: (acct, asset = "TUMBO") => getBalance(acct, asset),
    balances: (acct) => {
      validateAccount(acct);
      const out = {};
      for (const asset of TOKEN_CONFIG.ASSETS) out[asset] = getBalance(acct, asset);
      return out;
    },
    fmt: (fluff, asset = "TUMBO") => fmtFluff(fluff, asset),

    journalOf: (journalId) => {
      const j = ledger._byId.get(journalId);
      if (!j) throw tokenErr("unknown-journal", `no journal ${journalId}`);
      return freezeJournal(j);
    },

    receiptOf: (journalId) => {
      const r = ledger._receipts.find((x) => x.journalId === journalId);
      if (!r) throw tokenErr("unknown-receipt", `no receipt for ${journalId}`);
      return { ...r };
    },

    execute(spec) {
      return _execute(spec, { settle: spec.settle !== false });
    },

    /** Mark a pending journal settled (idempotent no-op when settled). */
    settle(journalId) {
      const j = ledger._byId.get(journalId);
      if (!j) throw tokenErr("unknown-journal", `no journal ${journalId}`);
      if (j.state === "settled") return { journal: freezeJournal(j), unchanged: true };
      if (j.state !== "pending") throw tokenErr("settle-rejected", `cannot settle a ${j.state} journal`);
      j.state = "settled";
      emit("journal", { journal: freezeJournal(j), receipt: null });
      return { journal: freezeJournal(j), unchanged: false };
    },

    /**
     * Reverse a settled journal by posting a compensating journal that
     * mirrors the original legs. History is never edited.
     * Idempotent via the deterministic key `reverse:<original-key>`:
     * replays return the original compensating receipt; a *different*
     * key against an already-reversed journal throws `already-reversed`.
     */
    reverse(journalId, { idempotencyKey = null } = {}) {
      const j = ledger._byId.get(journalId);
      if (!j) throw tokenErr("unknown-journal", `no journal ${journalId}`);
      if (j.journalId === "genesis") throw tokenErr("reverse-rejected", "genesis cannot be reversed");
      if (j.state !== "settled") throw tokenErr("reverse-rejected", `only settled journals can be reversed (state: ${j.state})`);
      const age = ledger.tick - j.tick;
      if (age > TOKEN_CONFIG.REVERSE_WINDOW_TICKS) {
        throw tokenErr("reverse-window-expired", `reverse window of ${TOKEN_CONFIG.REVERSE_WINDOW_TICKS} ticks expired (age ${age})`);
      }
      const deterministicKey = `reverse:${j.idempotencyKey}`;
      const priorId = ledger._byKey.get(deterministicKey);
      if (priorId) {
        const prior = ledger._byId.get(priorId);
        return { journal: freezeJournal(prior), receipt: null, replayed: true };
      }
      if (idempotencyKey != null && ledger._byKey.has(String(idempotencyKey))) {
        const prior = ledger._byId.get(ledger._byKey.get(String(idempotencyKey)));
        return { journal: freezeJournal(prior), receipt: null, replayed: true };
      }
      // A different key against an already-reversed journal must fail
      // closed: the deterministic key above is the only legal replay path.
      const alreadyReversed = ledger.journals.some(
        (x) => x.action === "reverse" && x.linkedJournalId === j.journalId
      );
      if (alreadyReversed) throw tokenErr("already-reversed", `journal ${journalId} was already reversed`);
      const mirror = j.postings.map((leg) => ({
        account: leg.account,
        asset: leg.asset,
        amount: toSignedFluff(-leg.amountFluff, "reverse.postings[].amountFluff"),
      }));
      const res = _commit({
        action: "reverse",
        asset: j.asset,
        postings: mirror,
        memo: `reversal of ${j.journalId}`,
        state: "settled",
        linkedJournalId: j.journalId,
        idempotencyKey: idempotencyKey == null ? deterministicKey : String(idempotencyKey),
      });
      j.state = "reversed";
      emit("journal", { journal: freezeJournal(j), receipt: null });
      return { ...res, replayed: false };
    },

    /** Cancel a pending journal (voids it; settled journals fail closed). */
    cancel(journalId, { idempotencyKey = null } = {}) {
      const j = ledger._byId.get(journalId);
      if (!j) throw tokenErr("unknown-journal", `no journal ${journalId}`);
      if (j.journalId === "genesis") throw tokenErr("cancel-rejected", "genesis cannot be cancelled");
      if (j.state !== "pending") throw tokenErr("cancel-rejected", `only pending journals can be cancelled (state: ${j.state})`);
      const deterministicKey = `cancel:${j.idempotencyKey}`;
      const priorId = ledger._byKey.get(deterministicKey);
      if (priorId) {
        const prior = ledger._byId.get(priorId);
        return { journal: freezeJournal(prior), receipt: null, replayed: true };
      }
      // Cancelling unwinds the pending hold: post the mirror legs so the
      // net effect is zero while the cancel itself stays in history.
      const mirror = j.postings.map((leg) => ({
        account: leg.account,
        asset: leg.asset,
        amount: toSignedFluff(-leg.amountFluff, "cancel.postings[].amountFluff"),
      }));
      const res = _commit({
        action: "cancel",
        asset: j.asset,
        postings: mirror,
        memo: `cancellation of ${j.journalId}`,
        state: "settled",
        linkedJournalId: j.journalId,
        idempotencyKey: idempotencyKey == null ? deterministicKey : String(idempotencyKey),
      });
      j.state = "cancelled";
      emit("journal", { journal: freezeJournal(j), receipt: null });
      return { ...res, replayed: false };
    },

    /** Filtered journal history (newest first), with pagination. */
    history({ action = null, account = null, asset = null, state = null, limit = 50, offset = 0 } = {}) {
      let rows = ledger.journals.slice().reverse();
      if (action) rows = rows.filter((r) => r.action === action);
      if (state) rows = rows.filter((r) => r.state === state);
      // Genesis carries the supply root for every asset held by
      // sys:treasury, so it genuinely matches account/asset filters.
      if (account) rows = rows.filter((r) => r.postings.some((p) => p.account === account));
      if (asset) rows = rows.filter((r) => r.postings.some((p) => p.asset === asset));
      const total = rows.length;
      const page = rows.slice(offset, offset + limit).map(freezeJournal);
      return { total, limit, offset, rows: page };
    },

    /** Recompute a journal's hashes and re-walk its chain links. */
    verifyJournal(journalId) {
      const j = ledger._byId.get(journalId);
      if (!j) throw tokenErr("unknown-journal", `no journal ${journalId}`);
      const checks = [];
      const push = (name, ok, detail = "") => checks.push({ name, ok, detail });

      const balanced = (() => {
        try {
          checkBalanced(j.postings);
          return true;
        } catch {
          return false;
        }
      })();
      push("balanced", balanced);

      const body = j.journalId === "genesis" ? canonicalizeGenesis(j.postings) : canonicalizeJournal({ ...j, hash: undefined });
      const recomputed = hashPayload(body);
      push("journal-hash", recomputed === j.hash, `${recomputed.slice(0, 12)}…`);

      const idx = ledger.journals.findIndex((x) => x.journalId === journalId);
      const expectedPrev = idx === 0 ? "GENESIS" : ledger.journals[idx - 1].hash;
      push("prevHash-link", j.prevHash === expectedPrev);

      const receipt = ledger._receipts.find((x) => x.journalId === journalId);
      push("receipt-exists", !!receipt);
      if (receipt) {
        const rbody = {
          journalId: receipt.journalId,
          tick: receipt.tick,
          state: receipt.state,
          afterHash: j.hash,
          prevHash: receipt.prevHash,
        };
        push("receipt-recompute", hashPayload(rbody) === receipt.hash);
        push("receipt-afterHash", receipt.afterHash === j.hash);
      }
      return { journalId, ok: checks.every((c) => c.ok), checks };
    },

    /** Walk the whole receipt chain; returns false at the first break. */
    verifyChain() {
      let prev = "GENESIS";
      for (const r of ledger._receipts) {
        const j = ledger._byId.get(r.journalId);
        if (!j) return false;
        if (r.afterHash !== j.hash) return false;
        const recomputed = hashPayload({
          journalId: r.journalId,
          tick: r.tick,
          state: r.state,
          afterHash: r.afterHash,
          prevHash: r.prevHash,
        });
        if (recomputed !== r.hash) return false;
        if (r.prevHash !== prev) return false;
        prev = r.hash;
      }
      // Journal-to-journal prevHash continuity.
      for (let i = 1; i < ledger.journals.length; i += 1) {
        if (ledger.journals[i].prevHash !== ledger.journals[i - 1].hash) return false;
      }
      return true;
    },
  };

  return api;
}

/* window.TumboToken facade — installed automatically in browsers.   */

const __facade = (() => {
  const shared = createTumboToken();
  return {
    ledger: shared.ledger,
    balance: (acct, asset) => shared.balance(acct, asset),
    fmt: (fluff, asset) => shared.fmt(fluff, asset),
    on: (evt, cb) => shared.on(evt, cb),
  };
})();

export const TumboToken = __facade;

if (typeof window !== "undefined") {
  window.TumboToken = window.TumboToken || __facade;
}

export default TumboToken;
