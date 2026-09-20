/**
 * TUMBO-SIM token core — TumboLedger and the window.TumboToken facade.
 *
 * Implements docs/TOKEN-CONTRACT.md (Canonical v1):
 * - Units: integer fluff (1 TUMBO-SIM = 1,000 fluff). Exact integer math only.
 * - Assets: TUMBO (native), sMIMAS (synthetic demo asset). Supply from the
 *   ONE config constant (src/domains/token-config.js) — never hardcoded.
 * - Accounts: u:<name>, b:<name>, sys:treasury, sys:faucet, sys:escrow,
 *   sys:vault, sys:void, sys:market. sys:void credited only by burns/tithes,
 *   never debited.
 * - Actions: send|receive|exchange|buy|sell|deliver|tip|stake|save|deposit|
 *   lock|reverse|cancel|unstake|withdraw (+ presence/ribbon-claim/hunger-tick
 *   meta events).
 * - Every mutation takes a client idempotency key; replays return the
 *   original receipt. Journals sum to 0 per asset; balances never negative.
 * - EchoProof-style receipts: hash-chained from genesis, independently
 *   verifiable.
 *
 * Simulation only — TUMBO-SIM is local demo points. Never real money,
 * never wagering, never custody, never chains, never real wallets.
 */

import {
  FLUFF_PER_TUMBO,
  TOKEN_TOTAL_SUPPLY,
  SMIMAS_TOTAL_SUPPLY,
  MARKET_TUMBO_FLOAT,
  MARKET_SMIMAS_FLOAT,
  FAUCET_BOOTSTRAP_FLUFF,
  REVERSE_WINDOW_TICKS,
  VOID_TITHE_BPS,
  QUOTE_TTL_TICKS,
  RIBBON_CAP,
  MARKET_RATE,
  ASSETS,
  SYSTEM_ACCOUNTS,
  FAUCET_DRIP_FLUFF,
  FAUCET_DRIPS_PER_DAY,
} from "./token-config.js";

export const TOKEN_CORE_VERSION = 1;
export const TOKEN_CORE_SOURCE = "tumbo-token-core";

const GENESIS_PREV_HASH = "GENESIS";
const BALANCE_SEP = "|";

/* ---------------- errors ---------------- */

export class TokenError extends Error {
  constructor(message, code = "TOKEN_ERROR") {
    super(message);
    this.name = "TokenError";
    this.code = code;
  }
}

/* ---------------- exact integer math ---------------- */

export function isFluff(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function assertFluff(value, field = "amount") {
  if (!isFluff(value)) {
    throw new TokenError(
      `${field} must be a safe non-negative integer fluff amount`,
      "INVALID_AMOUNT",
    );
  }
  return value;
}

function assertPositiveFluff(value, field = "amount") {
  assertFluff(value, field);
  if (value <= 0) {
    throw new TokenError(`${field} must be positive`, "INVALID_AMOUNT");
  }
  return value;
}

/**
 * Exact floor(a*b/c) for fluff math. BigInt-backed; never float on funds.
 */
export function mulDivFloor(a, b, c) {
  if (!isFluff(a) || !Number.isSafeInteger(b) || b < 0) {
    throw new TokenError(
      "mulDivFloor needs safe non-negative integer operands",
      "INVALID_AMOUNT",
    );
  }
  if (!Number.isSafeInteger(c) || c <= 0) {
    throw new TokenError(
      "mulDivFloor divisor must be a positive safe integer",
      "INVALID_AMOUNT",
    );
  }
  const result = Number((BigInt(a) * BigInt(b)) / BigInt(c));
  return assertFluff(result, "mulDivFloor result");
}

/**
 * Display formatting only: fluff -> "1.234". Integer math; never used for
 * money math.
 */
export function fmtFluff(fluff) {
  assertFluff(fluff, "fluff");
  const whole = Math.trunc(fluff / FLUFF_PER_TUMBO);
  const frac = String(fluff % FLUFF_PER_TUMBO).padStart(3, "0");
  return `${whole}.${frac}`;
}

/* ---------------- deterministic hashing ---------------- */

function djb2Hex(str) {
  let h = 5381 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Deterministic JSON: object keys sorted, recursively. */
function canonical(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
}

function freezeDeep(value) {
  if (Array.isArray(value)) {
    value.forEach(freezeDeep);
    return Object.freeze(value);
  }
  if (value !== null && typeof value === "object") {
    Object.values(value).forEach(freezeDeep);
    return Object.freeze(value);
  }
  return value;
}

function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TokenError(`${field} must be a non-empty string`, "INVALID_PARAM");
  }
  return value.trim();
}

const ACCOUNT_RE =
  /^(?:u:[A-Za-z0-9_.-]+|u:[A-Za-z0-9_.-]+:save:[A-Za-z0-9_.-]+|b:[A-Za-z0-9_.-]+|sys:[a-z]+)$/;

function kindForAccount(id) {
  if (id.startsWith("sys:")) return "system";
  if (id.startsWith("b:")) return "bot";
  if (/^u:[^:]+:save:/.test(id)) return "save";
  return "user";
}

/* ---------------- TumboLedger ---------------- */

export class TumboLedger {
  constructor({ emit = null } = {}) {
    this._emitExternal = typeof emit === "function" ? emit : null;
    this._balances = new Map();
    this._accounts = new Map();
    this._receipts = [];
    this._byIdem = new Map();
    this._byId = new Map();
    this._intents = new Map();
    this._locks = [];
    this._vaultPositions = new Map();
    this._ribbons = new Map();
    this._ribbonCount = 0;
    this._quotes = new Map();
    this._drips = new Map();
    this._presenceDays = new Map();
    this._reversed = new Set();
    this._listeners = new Map();
    this.tick = 0;
    this.seq = 0;
    this.day = 1;
    this._prevHash = GENESIS_PREV_HASH;
    this._txSeq = 0;
    this._intentSeq = 0;
    this._quoteSeq = 0;
    this._bootstrap();
  }

  /* ----- accounts & balances ----- */

  ensureAccount(id, kind = null, label = null) {
    const clean = requireNonEmptyString(id, "account id");
    if (!ACCOUNT_RE.test(clean)) {
      throw new TokenError(`invalid account id: ${clean}`, "INVALID_ACCOUNT");
    }
    const existing = this._accounts.get(clean);
    if (existing) return existing;
    const record = Object.freeze({
      id: clean,
      kind: kind ?? kindForAccount(clean),
      label: label ?? clean,
    });
    this._accounts.set(clean, record);
    return record;
  }

  hasAccount(id) {
    return this._accounts.has(id);
  }

  accounts() {
    return [...this._accounts.values()];
  }

  _balanceKey(account, asset) {
    return `${account}${BALANCE_SEP}${asset}`;
  }

  balance(account, asset = "TUMBO") {
    if (!ASSETS[asset]) throw new TokenError(`unknown asset: ${asset}`, "INVALID_ASSET");
    return this._balances.get(this._balanceKey(account, asset)) ?? 0;
  }

  _setBalanceDirect(account, asset, amount) {
    this._balances.set(this._balanceKey(account, asset), assertFluff(amount, "balance"));
  }

  _bootstrap() {
    for (const sys of SYSTEM_ACCOUNTS) this.ensureAccount(sys, "system", sys);
    this._setBalanceDirect(
      "sys:treasury",
      "TUMBO",
      TOKEN_TOTAL_SUPPLY - MARKET_TUMBO_FLOAT - FAUCET_BOOTSTRAP_FLUFF,
    );
    this._setBalanceDirect(
      "sys:treasury",
      "sMIMAS",
      SMIMAS_TOTAL_SUPPLY - MARKET_SMIMAS_FLOAT,
    );
    this._setBalanceDirect("sys:market", "TUMBO", MARKET_TUMBO_FLOAT);
    this._setBalanceDirect("sys:market", "sMIMAS", MARKET_SMIMAS_FLOAT);
    this._setBalanceDirect("sys:faucet", "TUMBO", FAUCET_BOOTSTRAP_FLUFF);
  }

  /* ----- events ----- */

  on(evt, cb) {
    if (evt !== "receipt" && evt !== "balance-changed") {
      throw new TokenError(`unknown event: ${evt}`, "INVALID_PARAM");
    }
    if (typeof cb !== "function") throw new TokenError("callback must be a function", "INVALID_PARAM");
    let set = this._listeners.get(evt);
    if (!set) {
      set = new Set();
      this._listeners.set(evt, set);
    }
    set.add(cb);
    return () => this.off(evt, cb);
  }

  off(evt, cb) {
    this._listeners.get(evt)?.delete(cb);
  }

  _emit(evt, data) {
    this._listeners.get(evt)?.forEach((cb) => {
      try {
        cb(data);
      } catch {
        /* listener errors never break the ledger */
      }
    });
    if (this._emitExternal) {
      try {
        this._emitExternal(evt, data);
      } catch {
        /* external emitter errors never break the ledger */
      }
    }
  }

  /* ----- the one write path ----- */

  _commit({ action, actor, entries = [], refs = {}, meta = {}, idem }) {
    const idemKey = requireNonEmptyString(idem, "idempotency key");
    const fingerprint = djb2Hex(canonical({ action, actor, entries, refs, meta }));

    // Idempotency: replays return the original receipt — never a second journal.
    const replayed = this._byIdem.get(idemKey);
    if (replayed) {
      if (replayed.fingerprint !== fingerprint) {
        throw new TokenError(
          `idempotency key reuse with a different intent: ${idemKey}`,
          "IDEM_MISMATCH",
        );
      }
      return replayed.receipt;
    }

    // Validate journal entries.
    const normEntries = entries.map((entry) => {
      if (!entry || typeof entry.account !== "string" || !ASSETS[entry.asset]) {
        throw new TokenError("journal entry needs an account and a known asset", "UNBALANCED");
      }
      if (!Number.isSafeInteger(entry.delta)) {
        throw new TokenError("journal delta must be a safe integer", "INVALID_AMOUNT");
      }
      return { account: entry.account, asset: entry.asset, delta: entry.delta };
    });

    // Double-entry: postings sum to exactly 0 per asset.
    const sums = new Map();
    for (const entry of normEntries) {
      sums.set(entry.asset, (sums.get(entry.asset) ?? 0) + entry.delta);
    }
    for (const [asset, sum] of sums) {
      if (sum !== 0) {
        throw new TokenError(`journal does not sum to 0 for ${asset}`, "UNBALANCED");
      }
    }

    // sys:void is credited only by burns/tithes — never debited.
    for (const entry of normEntries) {
      if (entry.account === "sys:void" && entry.delta < 0) {
        throw new TokenError("sys:void is never debited", "VOID_DEBIT_REFUSED");
      }
    }

    // Accounts must exist (auto-created for user/bot/save kinds).
    for (const entry of normEntries) this.ensureAccount(entry.account);

    // Stage on copies: atomic, and balances never go negative.
    const staged = new Map();
    for (const entry of normEntries) {
      const key = this._balanceKey(entry.account, entry.asset);
      const current = staged.has(key) ? staged.get(key) : this.balance(entry.account, entry.asset);
      const next = current + entry.delta;
      if (next < 0) {
        throw new TokenError(
          `${entry.account} has insufficient ${entry.asset}`,
          "INSUFFICIENT_FUNDS",
        );
      }
      staged.set(key, assertFluff(next, "resulting balance"));
    }
    for (const [key, next] of staged) this._balances.set(key, next);

    // Seal the EchoProof-style receipt and extend the hash chain.
    this.tick += 1;
    this.seq += 1;
    this._txSeq += 1;
    const body = {
      id: `tx-${String(this._txSeq).padStart(6, "0")}`,
      idem: idemKey,
      action,
      actor,
      state: "SETTLED",
      entries: normEntries.map((entry) => Object.freeze({ ...entry })),
      refs: freezeDeep({ ...refs }),
      meta: freezeDeep({ ...meta }),
      tick: this.tick,
      seq: this.seq,
      prevHash: this._prevHash,
    };
    const hash = djb2Hex(canonical(body));
    const receipt = Object.freeze({ ...body, hash });
    this._prevHash = hash;
    this._receipts.push(receipt);
    this._byId.set(receipt.id, receipt);
    this._byIdem.set(idemKey, { receipt, fingerprint });
    this._emit("receipt", receipt);
    this._emit("balance-changed", { tx: receipt.id, receipt });
    return receipt;
  }

  /* ----- action dispatch ----- */

  act(action, params = {}, idemKey) {
    const p = params ?? {};
    switch (action) {
      case "send":
      case "receive":
      case "tip":
        return this._transfer(action, p, idemKey);
      case "lock":
        return this._lock(p, idemKey);
      case "stake":
      case "deposit":
        return this._vaultIn(action, p, idemKey);
      case "save":
        return this._save(p, idemKey);
      case "withdraw":
      case "unstake":
        return this._vaultOut(action, p, idemKey);
      case "deliver":
        return this._deliver(p, idemKey);
      case "cancel":
        return this._cancel(p, idemKey);
      case "reverse":
        return this._reverse(p, idemKey);
      case "buy":
      case "sell":
      case "exchange":
        return this._market(action, p, idemKey);
      case "presence":
        return this._presence(p, idemKey);
      case "ribbon-claim":
        return this._ribbonClaim(p, idemKey);
      case "hunger-tick":
        return this._hungerTick(p, idemKey);
      default:
        throw new TokenError(`unknown action: ${action}`, "INVALID_ACTION");
    }
  }

  _transfer(action, { from, to, asset = "TUMBO", amount }, idem) {
    const src = requireNonEmptyString(from, "from");
    const dst = requireNonEmptyString(to, "to");
    if (!ASSETS[asset]) throw new TokenError(`unknown asset: ${asset}`, "INVALID_ASSET");
    assertPositiveFluff(amount, "amount");
    if (src === dst) throw new TokenError("sender and receiver must differ", "INVALID_PARAM");
    this.ensureAccount(src);
    this.ensureAccount(dst);
    return this._commit({
      action,
      actor: src,
      idem,
      entries: [
        { account: src, asset, delta: -amount },
        { account: dst, asset, delta: amount },
      ],
      refs: { from: src, to: dst, asset, amount },
      meta: {},
    });
  }

  _lock({ account, asset = "TUMBO", amount, unlockTick }, idem) {
    const acct = requireNonEmptyString(account, "account");
    if (!ASSETS[asset]) throw new TokenError(`unknown asset: ${asset}`, "INVALID_ASSET");
    assertPositiveFluff(amount, "amount");
    const idemKey = requireNonEmptyString(idem, "idempotency key");
    const lockId = `lock-${djb2Hex(`lock:${idemKey}`)}`;
    const existingLock = this._locks.find((l) => l.id === lockId);
    const finalUnlockTick =
      unlockTick === undefined
        ? (existingLock?.unlockTick ?? this.tick + 100)
        : assertFluff(unlockTick, "unlockTick");
    this.ensureAccount(acct);
    const wasReplay = this._byIdem.has(idemKey);
    const receipt = this._commit({
      action: "lock",
      actor: acct,
      idem: idemKey,
      entries: [
        { account: acct, asset, delta: -amount },
        { account: "sys:vault", asset, delta: amount },
      ],
      refs: { account: acct, asset, amount, lockId, unlockTick: finalUnlockTick },
      meta: { lockId, unlockTick: finalUnlockTick },
    });
    // Auxiliary lock state follows the sealed journal, never precedes it.
    if (!wasReplay && !existingLock) {
      this._locks.push({
        id: lockId,
        account: acct,
        asset,
        amount,
        unlockTick: finalUnlockTick,
        state: "OPEN",
        createdTick: receipt.tick,
      });
      const posKey = this._balanceKey(acct, asset);
      this._vaultPositions.set(posKey, (this._vaultPositions.get(posKey) ?? 0) + amount);
    }
    return receipt;
  }

  _vaultIn(action, { account, asset = "TUMBO", amount }, idem) {
    const acct = requireNonEmptyString(account, "account");
    if (!ASSETS[asset]) throw new TokenError(`unknown asset: ${asset}`, "INVALID_ASSET");
    assertPositiveFluff(amount, "amount");
    const idemKey = requireNonEmptyString(idem, "idempotency key");
    this.ensureAccount(acct);
    const wasReplay = this._byIdem.has(idemKey);
    const receipt = this._commit({
      action,
      actor: acct,
      idem: idemKey,
      entries: [
        { account: acct, asset, delta: -amount },
        { account: "sys:vault", asset, delta: amount },
      ],
      refs: { account: acct, asset, amount },
      meta: {},
    });
    if (!wasReplay) {
      const posKey = this._balanceKey(acct, asset);
      this._vaultPositions.set(posKey, (this._vaultPositions.get(posKey) ?? 0) + amount);
    }
    return receipt;
  }

  _openLockedAmount(account, asset) {
    let locked = 0;
    for (const lock of this._locks) {
      if (
        lock.account === account &&
        lock.asset === asset &&
        lock.state === "OPEN" &&
        lock.unlockTick > this.tick
      ) {
        locked += lock.amount;
      }
    }
    return locked;
  }

  _vaultOut(action, { account, asset = "TUMBO", amount }, idem) {
    const acct = requireNonEmptyString(account, "account");
    if (!ASSETS[asset]) throw new TokenError(`unknown asset: ${asset}`, "INVALID_ASSET");
    assertPositiveFluff(amount, "amount");
    const idemKey = requireNonEmptyString(idem, "idempotency key");
    this.ensureAccount(acct);
    const posKey = this._balanceKey(acct, asset);
    const position = this._vaultPositions.get(posKey) ?? 0;
    const locked = this._openLockedAmount(acct, asset);
    if (amount > position - locked) {
      throw new TokenError(
        `early withdrawal refused: ${fmtFluff(locked)} TUMBO-SIM still locked`,
        "LOCK_REFUSED",
      );
    }
    const wasReplay = this._byIdem.has(idemKey);
    const receipt = this._commit({
      action,
      actor: acct,
      idem: idemKey,
      entries: [
        { account: "sys:vault", asset, delta: -amount },
        { account: acct, asset, delta: amount },
      ],
      refs: { account: acct, asset, amount },
      meta: {},
    });
    if (!wasReplay) {
      this._vaultPositions.set(posKey, position - amount);
    }
    return receipt;
  }

  _save({ account, goal, asset = "TUMBO", amount }, idem) {
    const acct = requireNonEmptyString(account, "account");
    const goalName = requireNonEmptyString(goal, "goal");
    if (!ASSETS[asset]) throw new TokenError(`unknown asset: ${asset}`, "INVALID_ASSET");
    assertPositiveFluff(amount, "amount");
    const pocket = `${acct}:save:${goalName}`;
    this.ensureAccount(acct);
    this.ensureAccount(pocket, "save", `${acct} savings · ${goalName}`);
    return this._commit({
      action: "save",
      actor: acct,
      idem,
      entries: [
        { account: acct, asset, delta: -amount },
        { account: pocket, asset, delta: amount },
      ],
      refs: { account: acct, goal: goalName, asset, amount, pocket },
      meta: {},
    });
  }

  _deliver({ from, to, asset = "TUMBO", amount }, idem) {
    const src = requireNonEmptyString(from, "from");
    const dst = requireNonEmptyString(to, "to");
    if (!ASSETS[asset]) throw new TokenError(`unknown asset: ${asset}`, "INVALID_ASSET");
    assertPositiveFluff(amount, "amount");
    if (src === dst) throw new TokenError("sender and receiver must differ", "INVALID_PARAM");
    const idemKey = requireNonEmptyString(idem, "idempotency key");
    const intentId = `intent-${djb2Hex(`deliver:${idemKey}`)}`;
    this.ensureAccount(src);
    this.ensureAccount(dst);
    const wasReplay = this._byIdem.has(idemKey);
    const receipt = this._commit({
      action: "deliver",
      actor: src,
      idem: idemKey,
      entries: [
        { account: src, asset, delta: -amount },
        { account: "sys:escrow", asset, delta: amount },
      ],
      refs: { from: src, to: dst, asset, amount, intentId },
      meta: { intentId, phase: "held" },
    });
    if (!wasReplay && !this._intents.has(intentId)) {
      this._intents.set(intentId, {
        id: intentId,
        from: src,
        to: dst,
        asset,
        amount,
        state: "PENDING",
        createdTick: receipt.tick,
        receiptId: receipt.id,
      });
    }
    return receipt;
  }

  /** Receiver confirms a PENDING deliver intent; sender cancels via cancel(). */
  confirmDeliver(intentId, idemKey) {
    const id = requireNonEmptyString(intentId, "intentId");
    const key = requireNonEmptyString(idemKey, "idempotency key");
    const intent = this._intents.get(id);
    if (!intent) throw new TokenError(`unknown intent: ${id}`, "INTENT_UNKNOWN");
    // Replays return the original receipt before any state checks.
    const wasReplay = this._byIdem.has(key);
    if (!wasReplay && intent.state !== "PENDING") {
      throw new TokenError(`intent ${id} is ${intent.state}`, "INTENT_NOT_PENDING");
    }
    const receipt = this._commit({
      action: "deliver",
      actor: intent.to,
      idem: key,
      entries: [
        { account: "sys:escrow", asset: intent.asset, delta: -intent.amount },
        { account: intent.to, asset: intent.asset, delta: intent.amount },
      ],
      refs: { intentId: id, from: intent.from, to: intent.to, asset: intent.asset, amount: intent.amount },
      meta: { intentId: id, phase: "confirmed" },
    });
    if (!wasReplay) {
      this._intents.get(id).state = "CONFIRMED";
    }
    return receipt;
  }

  _cancel({ intentId }, idem) {
    const id = requireNonEmptyString(intentId, "intentId");
    const key = requireNonEmptyString(idem, "idempotency key");
    const intent = this._intents.get(id);
    if (!intent) throw new TokenError(`unknown intent: ${id}`, "INTENT_UNKNOWN");
    // Replays return the original receipt before any state checks.
    const wasReplay = this._byIdem.has(key);
    if (!wasReplay && intent.state !== "PENDING") {
      throw new TokenError(`intent ${id} is ${intent.state}; only PENDING intents can cancel`, "INTENT_NOT_PENDING");
    }
    const receipt = this._commit({
      action: "cancel",
      actor: intent.from,
      idem: key,
      entries: [
        { account: "sys:escrow", asset: intent.asset, delta: -intent.amount },
        { account: intent.from, asset: intent.asset, delta: intent.amount },
      ],
      refs: { intentId: id, from: intent.from, to: intent.to, asset: intent.asset, amount: intent.amount },
      meta: { intentId: id, phase: "cancelled" },
    });
    if (!wasReplay) {
      this._intents.get(id).state = "CANCELLED";
    }
    return receipt;
  }

  _reverse({ txId }, idem) {
    const id = requireNonEmptyString(txId, "txId");
    const original = this._byId.get(id);
    if (!original) throw new TokenError(`unknown transaction: ${id}`, "REVERSE_UNKNOWN");
    if (original.entries.length === 0) {
      throw new TokenError(`meta events cannot be reversed: ${id}`, "REVERSE_META");
    }
    if (this._reversed.has(id)) {
      throw new TokenError(`transaction already reversed: ${id}`, "REVERSE_ALREADY");
    }
    if (this.tick - original.tick > REVERSE_WINDOW_TICKS) {
      throw new TokenError(`reverse window closed for ${id}`, "REVERSE_EXPIRED");
    }
    const idemKey = requireNonEmptyString(idem, "idempotency key");
    const wasReplay = this._byIdem.has(idemKey);
    const entries = original.entries.map((entry) => ({
      account: entry.account,
      asset: entry.asset,
      delta: -entry.delta,
    }));
    const receipt = this._commit({
      action: "reverse",
      actor: original.actor,
      idem: idemKey,
      entries,
      refs: { reverses: id, reversedAction: original.action },
      meta: { reverses: id },
    });
    // History is never edited; the compensating journal is the reversal.
    // Auxiliary vault/lock state follows the sealed journal, never precedes it.
    if (!wasReplay) {
      this._reversed.add(id);
      const lockId = original.refs?.lockId;
      if (lockId) {
        const lock = this._locks.find((l) => l.id === lockId);
        if (lock && lock.state === "OPEN") lock.state = "REVERSED";
      }
      if (original.action === "stake" || original.action === "deposit") {
        const posKey = this._balanceKey(original.actor, original.refs.asset);
        const position = this._vaultPositions.get(posKey) ?? 0;
        this._vaultPositions.set(posKey, Math.max(0, position - original.refs.amount));
      }
    }
    return receipt;
  }

  /* ----- market: buy / sell / exchange with void tithe ----- */

  _marketParts(action, { account, amountIn, fromAsset, toAsset }) {
    const acct = requireNonEmptyString(account, "account");
    assertPositiveFluff(amountIn, "amountIn");
    let inAsset = fromAsset;
    let outAsset = toAsset;
    if (action === "buy") {
      inAsset = "TUMBO";
      outAsset = "sMIMAS";
    } else if (action === "sell") {
      inAsset = "sMIMAS";
      outAsset = "TUMBO";
    }
    if (!ASSETS[inAsset] || !ASSETS[outAsset]) {
      throw new TokenError(`unknown market pair: ${inAsset} -> ${outAsset}`, "INVALID_ASSET");
    }
    if (inAsset === outAsset) throw new TokenError("market pair must differ", "INVALID_PARAM");
    const grossOut =
      inAsset === "TUMBO"
        ? mulDivFloor(amountIn, MARKET_RATE.num, MARKET_RATE.den)
        : mulDivFloor(amountIn, MARKET_RATE.den, MARKET_RATE.num);
    if (grossOut <= 0) throw new TokenError("amount too small for a quote", "INVALID_AMOUNT");
    const tithe = mulDivFloor(grossOut, VOID_TITHE_BPS, 10000);
    const userOut = grossOut - tithe;
    return { account: acct, inAsset, outAsset, amountIn, grossOut, tithe, userOut };
  }

  _market(action, params, idem) {
    const parts = this._marketParts(action, params);
    const idemKey = requireNonEmptyString(idem, "idempotency key");
    this.ensureAccount(parts.account);
    if (this.balance("sys:market", parts.outAsset) < parts.grossOut) {
      throw new TokenError("market inventory insufficient", "INSUFFICIENT_FUNDS");
    }
    const refs = { ...parts, rate: { ...MARKET_RATE }, titheBps: VOID_TITHE_BPS };
    if (params.quoteId) refs.quoteId = params.quoteId;
    return this._commit({
      action,
      actor: parts.account,
      idem: idemKey,
      entries: [
        { account: parts.account, asset: parts.inAsset, delta: -parts.amountIn },
        { account: "sys:market", asset: parts.inAsset, delta: parts.amountIn },
        { account: "sys:market", asset: parts.outAsset, delta: -parts.grossOut },
        { account: parts.account, asset: parts.outAsset, delta: parts.userOut },
        { account: "sys:void", asset: parts.outAsset, delta: parts.tithe },
      ],
      refs,
      meta: {},
    });
  }

  quote(action, params = {}) {
    if (action !== "buy" && action !== "sell" && action !== "exchange") {
      throw new TokenError(`cannot quote action: ${action}`, "INVALID_ACTION");
    }
    const parts = this._marketParts(action, params);
    this._quoteSeq += 1;
    const body = {
      id: `quote-${String(this._quoteSeq).padStart(4, "0")}`,
      action,
      account: parts.account,
      from: parts.inAsset,
      to: parts.outAsset,
      amountIn: parts.amountIn,
      amountOut: parts.userOut,
      tithe: parts.tithe,
      rate: { ...MARKET_RATE },
      titheBps: VOID_TITHE_BPS,
      issuedTick: this.tick,
      expiresAt: this.tick + QUOTE_TTL_TICKS,
      executed: false,
    };
    const quote = Object.freeze({ ...body, hash: djb2Hex(canonical(body)) });
    this._quotes.set(quote.id, quote);
    return quote;
  }

  executeQuote(quoteId, idemKey) {
    const id = requireNonEmptyString(quoteId, "quoteId");
    const stored = this._quotes.get(id);
    if (!stored) throw new TokenError(`unknown quote: ${id}`, "QUOTE_UNKNOWN");
    if (stored.executed) throw new TokenError(`quote already executed: ${id}`, "QUOTE_EXECUTED");
    if (this.tick > stored.expiresAt) throw new TokenError(`quote expired: ${id}`, "QUOTE_EXPIRED");
    {
      const { hash, executed, ...body } = stored;
      if (djb2Hex(canonical(body)) !== hash) {
        throw new TokenError(`quote failed integrity check: ${id}`, "QUOTE_TAMPERED");
      }
    }
    // Execution recomputes and compares — forged or tampered quotes rejected.
    const recomputed = this._marketParts(stored.action, {
      account: stored.account,
      amountIn: stored.amountIn,
      fromAsset: stored.from,
      toAsset: stored.to,
    });
    if (recomputed.userOut !== stored.amountOut || recomputed.tithe !== stored.tithe) {
      throw new TokenError(`quote terms changed: ${id}`, "QUOTE_TAMPERED");
    }
    const receipt = this._market(stored.action, {
      account: stored.account,
      amountIn: stored.amountIn,
      fromAsset: stored.from,
      toAsset: stored.to,
      quoteId: id,
    }, idemKey);
    this._quotes.set(id, Object.freeze({ ...stored, executed: true }));
    return receipt;
  }

  /* ----- meta events: presence / ribbon-claim / hunger-tick ----- */

  _presence({ account, day }, idem) {
    const acct = requireNonEmptyString(account, "account");
    const d = day === undefined ? this.day : assertFluff(day, "day");
    if (d < 1) throw new TokenError("day must be >= 1", "INVALID_PARAM");
    const idemKey = requireNonEmptyString(idem, "idempotency key");
    this.ensureAccount(acct);
    const wasReplay = this._byIdem.has(idemKey);
    let days = this._presenceDays.get(acct);
    if (!wasReplay) {
      if (!days) {
        days = new Set();
        this._presenceDays.set(acct, days);
      }
      if (days.has(d)) {
        throw new TokenError(
          `presence already recorded for ${acct} on day ${d}`,
          "PRESENCE_ALREADY_RECORDED",
        );
      }
    }
    const receipt = this._commit({
      action: "presence",
      actor: acct,
      idem: idemKey,
      entries: [],
      refs: { account: acct },
      meta: { day: d, kind: "daily-check-in", simulation: true },
    });
    if (!wasReplay) {
      let set = this._presenceDays.get(acct);
      if (!set) {
        set = new Set();
        this._presenceDays.set(acct, set);
      }
      set.add(d);
    }
    return receipt;
  }

  _ribbonClaim({ account }, idem) {
    const acct = requireNonEmptyString(account, "account");
    const idemKey = requireNonEmptyString(idem, "idempotency key");
    this.ensureAccount(acct);
    const existing = this._ribbons.get(acct);
    if (existing) {
      if (this._byIdem.has(idemKey)) {
        return this._commit({
          action: "ribbon-claim",
          actor: acct,
          idem: idemKey,
          entries: [],
          refs: { account: acct },
          meta: { ribbonId: existing, cap: RIBBON_CAP, transferable: false, monetized: false },
        });
      }
      throw new TokenError(
        `${acct} already claimed ${existing}; ribbons are one per account`,
        "RIBBON_ALREADY_CLAIMED",
      );
    }
    if (this._ribbonCount >= RIBBON_CAP) {
      throw new TokenError("supporter ribbon cap reached", "RIBBON_CAP_REACHED");
    }
    const ribbonId = `ribbon-${String(this._ribbonCount + 1).padStart(4, "0")}`;
    const receipt = this._commit({
      action: "ribbon-claim",
      actor: acct,
      idem: idemKey,
      entries: [],
      refs: { account: acct },
      meta: { ribbonId, cap: RIBBON_CAP, transferable: false, monetized: false },
    });
    this._ribbons.set(acct, ribbonId);
    this._ribbonCount += 1;
    return receipt;
  }

  _hungerTick({ account, from, to }, idem) {
    const acct = requireNonEmptyString(account, "account");
    assertFluff(from, "from");
    assertFluff(to, "to");
    this.ensureAccount(acct);
    return this._commit({
      action: "hunger-tick",
      actor: acct,
      idem,
      entries: [],
      refs: { account: acct },
      meta: { from, to, kind: "hunger-decay", simulation: true },
    });
  }

  /* ----- faucet (system gate) ----- */

  drip(account, asset = "TUMBO", idem) {
    const acct = requireNonEmptyString(account, "account");
    if (!ASSETS[asset]) throw new TokenError(`unknown asset: ${asset}`, "INVALID_ASSET");
    const idemKey = requireNonEmptyString(idem, "idempotency key");
    this.ensureAccount(acct);
    const wasReplay = this._byIdem.has(idemKey);
    const key = `${acct}${BALANCE_SEP}${asset}${BALANCE_SEP}day-${this.day}`;
    if (!wasReplay) {
      const used = this._drips.get(key) ?? 0;
      if (used >= FAUCET_DRIPS_PER_DAY) {
        throw new TokenError(`faucet drip already claimed by ${acct} today`, "DRIP_LIMIT");
      }
    }
    const receipt = this._commit({
      action: "receive",
      actor: acct,
      idem: idemKey,
      entries: [
        { account: "sys:faucet", asset, delta: -FAUCET_DRIP_FLUFF },
        { account: acct, asset, delta: FAUCET_DRIP_FLUFF },
      ],
      refs: { from: "sys:faucet", to: acct, asset, amount: FAUCET_DRIP_FLUFF, drip: true },
      meta: { drip: true, simulation: true },
    });
    if (!wasReplay) {
      this._drips.set(key, (this._drips.get(key) ?? 0) + 1);
    }
    return receipt;
  }

  /* ----- time ----- */

  advanceDay() {
    this.day += 1;
    return this.day;
  }

  advanceTicks(n = 1) {
    if (!Number.isSafeInteger(n) || n < 0) {
      throw new TokenError("ticks must be a safe non-negative integer", "INVALID_PARAM");
    }
    this.tick += n;
    return this.tick;
  }

  /* ----- read views ----- */

  receipts() {
    return [...this._receipts];
  }

  receiptById(id) {
    return this._byId.get(id) ?? null;
  }

  intents() {
    return [...this._intents.values()];
  }

  locks() {
    return this._locks.map((l) => ({ ...l }));
  }

  ribbonOf(account) {
    return this._ribbons.get(account) ?? null;
  }

  ribbonCount() {
    return this._ribbonCount;
  }

  vaultPosition(account, asset = "TUMBO") {
    return this._vaultPositions.get(this._balanceKey(account, asset)) ?? 0;
  }

  escrowBalance(asset = "TUMBO") {
    return this.balance("sys:escrow", asset);
  }

  /** Conservation: Σ balances per asset (incl. sys:void). */
  conservation() {
    const sums = {};
    for (const asset of Object.keys(ASSETS)) sums[asset] = 0;
    for (const [key, amount] of this._balances) {
      const sep = key.lastIndexOf(BALANCE_SEP);
      const asset = key.slice(sep + 1);
      if (sums[asset] !== undefined) sums[asset] += amount;
    }
    return sums;
  }

  /* ----- verification ----- */

  verifyReceipt(txId) {
    const receipt = this._byId.get(txId);
    if (!receipt) return { ok: false, reason: "UNKNOWN_TX" };
    const { hash, ...body } = receipt;
    if (djb2Hex(canonical(body)) !== hash) return { ok: false, reason: "HASH_MISMATCH" };
    const idx = this._receipts.findIndex((r) => r.id === txId);
    const expectedPrev = idx === 0 ? GENESIS_PREV_HASH : this._receipts[idx - 1].hash;
    if (receipt.prevHash !== expectedPrev) return { ok: false, reason: "CHAIN_BREAK" };
    return { ok: true };
  }

  verifyChain() {
    let prev = GENESIS_PREV_HASH;
    for (const receipt of this._receipts) {
      const { hash, ...body } = receipt;
      if (djb2Hex(canonical(body)) !== hash) return { ok: false, badSeq: receipt.seq };
      if (receipt.prevHash !== prev) return { ok: false, badSeq: receipt.seq };
      prev = hash;
    }
    return { ok: true };
  }
}

/* ---------------- window.TumboToken facade ---------------- */

function domDispatch(documentRoot, type, payload) {
  const dispatch = documentRoot?.dispatchEvent;
  if (typeof dispatch !== "function") return;
  try {
    const Ctor =
      typeof CustomEvent === "function"
        ? CustomEvent
        : documentRoot.defaultView?.CustomEvent;
    if (typeof Ctor !== "function") return;
    dispatch.call(
      documentRoot,
      new Ctor("tumbo:token", { detail: { type, ...payload } }),
    );
  } catch {
    /* DOM dispatch never breaks the token core */
  }
}

export function createTumboToken({ documentRoot = globalThis.document } = {}) {
  const ledger = new TumboLedger({
    emit: (type, data) => {
      if (type === "receipt") {
        domDispatch(documentRoot, "receipt", { tx: data.id, receipt: data });
      } else if (type === "balance-changed") {
        domDispatch(documentRoot, "balance-changed", { tx: data.tx, receipt: data.receipt });
      }
    },
  });

  const api = {
    ledger,
    config: freezeDeep({
      FLUFF_PER_TUMBO,
      TOKEN_TOTAL_SUPPLY,
      SMIMAS_TOTAL_SUPPLY,
      REVERSE_WINDOW_TICKS,
      VOID_TITHE_BPS,
      QUOTE_TTL_TICKS,
      RIBBON_CAP,
      MARKET_RATE,
      ASSETS,
      SYSTEM_ACCOUNTS,
      FAUCET_DRIP_FLUFF,
      FAUCET_DRIPS_PER_DAY,
    }),
    balance: (account, asset = "TUMBO") => ledger.balance(account, asset),
    fmt: (fluff) => fmtFluff(fluff),
    ensureAccount: (id, kind, label) => ledger.ensureAccount(id, kind, label),
    act: (action, params, idemKey) => ledger.act(action, params, idemKey),
    quote: (action, params) => ledger.quote(action, params),
    executeQuote: (quoteId, idemKey) => ledger.executeQuote(quoteId, idemKey),
    reverse: (txId, idemKey) => ledger.act("reverse", { txId }, idemKey),
    cancel: (intentId, idemKey) => ledger.act("cancel", { intentId }, idemKey),
    confirmDeliver: (intentId, idemKey) => ledger.confirmDeliver(intentId, idemKey),
    drip: (account, asset, idemKey) => ledger.drip(account, asset, idemKey),
    advanceDay: () => ledger.advanceDay(),
    advanceTicks: (n) => ledger.advanceTicks(n),
    verifyReceipt: (txId) => ledger.verifyReceipt(txId),
    verifyChain: () => ledger.verifyChain(),
    on: (evt, cb) => ledger.on(evt, cb),
    off: (evt, cb) => ledger.off(evt, cb),
  };
  return Object.freeze(api);
}

/**
 * Create window.TumboToken once per page; return the existing one if present.
 */
export function ensureTumboToken({ documentRoot = globalThis.document } = {}) {
  const g = typeof window !== "undefined" ? window : globalThis;
  if (g.TumboToken) return g.TumboToken;
  const api = createTumboToken({ documentRoot });
  try {
    g.TumboToken = api;
  } catch {
    /* ignore: read-only global */
  }
  return api;
}

export default TumboLedger;
