/**
 * TumboToken — TUMBO / sMIMAS token core with a hardened quote engine.
 *
 * SIMULATED POINTS ONLY. Every balance in this module is a simulated
 * TUMBO-SIM point. There is no real money, no wagering, no wallet custody,
 * no chain, and no settlement. Any surface built on this module must be
 * labelled "simulated".
 *
 * Shared contract (token workstream):
 * - Units: integer fluff. 1 TUMBO-SIM = 1000 fluff. Safe integers, >= 0.
 * - Assets: TUMBO, sMIMAS. Supply originates from the single CONFIG
 *   constant below — never hardcoded or quoted anywhere else.
 * - Accounts: u:<name>, b:<name>, sys:treasury, sys:faucet, sys:escrow,
 *   sys:vault, sys:vault, sys:market. sys:void is credited only by
 *   burns/tithes and is never debited.
 * - Actions: send|receive|exchange|buy|sell|deliver|tip|stake|save|deposit|
 *   lock|reverse|cancel|unstake|withdraw.
 * - Every mutation takes a client idempotency key; replays return the
 *   original receipt. Journals sum to 0 per asset; balances never negative.
 * - Quote engine: quote() returns {id, action, from, to, amountIn, amountOut,
 *   expiresAt, hash}; execute() recomputes the hash and rejects expired or
 *   tampered quotes. Market ops (exchange|buy|sell) settle against the
 *   sys:market market maker and pay a 10 bps Void tithe (10 per 10,000)
 *   to sys:void.
 * - Facade: window.TumboToken = { ledger, balance(acct, asset), fmt(fluff),
 *   on(evt, cb) }; settling emits document CustomEvent("tumbo:token",
 *   { detail: { type: "balance-changed" | "receipt", ... } }).
 *
 * This module adds no 3D and no UI: it is pure ledger logic plus DOM events.
 * It is dependency-free and runs in browsers and in Node.js.
 */

// ---------------------------------------------------------------------------
// 1. The ONE config constant: supply, market float, tithe, TTL, price.
// ---------------------------------------------------------------------------

export const CONFIG = Object.freeze({
  /** Total issued supply, in integer fluff (1 TUMBO-SIM = 1000 fluff). */
  supply: Object.freeze({ TUMBO: 10_000_000_000, sMIMAS: 100_000_000_000 }),
  /** TUMBO float seeded from the treasury into the market maker. */
  marketFloatTumbo: 1_000_000_000,
  /** TUMBO handed to the faucet for demo funding. */
  faucetTumbo: 500_000_000,
  /** Void tithe on market ops, in basis points (10 bps = 10 per 10,000). */
  titheBps: 10,
  titheDenominator: 10_000,
  /** How long a quote stays executable, in milliseconds. */
  quoteTtlMs: 60_000,
  /** Market price as an exact rational: 1 TUMBO buys num/den sMIMAS. */
  price: Object.freeze({ num: 10, den: 1 }),
});

// ---------------------------------------------------------------------------
// 2. Exact integer math — never float on funds.
// ---------------------------------------------------------------------------

/** Require a non-negative safe integer amount of fluff. */
export function assertFluff(n, name = "amount") {
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer (fluff); got ${String(n)}`);
  }
  return n;
}

/** Require a signed safe integer (journal postings may be debits). */
export function assertSignedFluff(n, name = "amount") {
  if (typeof n !== "number" || !Number.isSafeInteger(n)) {
    throw new TypeError(`${name} must be a signed safe integer; got ${String(n)}`);
  }
  return n;
}

/**
 * Exact floor(a * b / c) for non-negative safe integers. The product is
 * computed with BigInt so large intermediate values stay exact —
 * floating-point math is never used on funds.
 */
export function mulDivFloor(a, b, c) {
  assertFluff(a, "a");
  assertFluff(b, "b");
  if (typeof c !== "number" || !Number.isSafeInteger(c) || c <= 0) {
    throw new TypeError(`divisor must be a positive safe integer; got ${String(c)}`);
  }
  const q = (BigInt(a) * BigInt(b)) / BigInt(c);
  if (q > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("mulDivFloor result exceeds the safe integer range");
  }
  return Number(q);
}

// FNV-1a 64-bit: deterministic, synchronous, dependency-free hashing for
// quote tamper-evidence. Works identically in browsers and in Node.js.
const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const FNV64_MASK = 0xffffffffffffffffn;

export function fnv1a64Hex(input) {
  const s = String(input);
  let h = FNV64_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * FNV64_PRIME) & FNV64_MASK;
  }
  return h.toString(16).padStart(16, "0");
}

let _idSeq = 0;
/** Unique id without any node:crypto dependency (browser-safe). */
export function newId(prefix = "id") {
  _idSeq += 1;
  const rand = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
  return `${prefix}_${Date.now().toString(36)}_${_idSeq.toString(36)}_${rand}`;
}

// ---------------------------------------------------------------------------
// 3. Accounts and assets.
// ---------------------------------------------------------------------------

export const ASSETS = Object.freeze(["TUMBO", "sMIMAS"]);

const SYS_ACCOUNTS = new Set([
  "sys:treasury",
  "sys:faucet",
  "sys:escrow",
  "sys:vault",
  "sys:vault",
  "sys:market",
  "sys:void",
  // Internal negative mirror so every journal sums to zero per asset.
  "sys:issuance",
]);

const USER_ACCOUNT_RE = /^(u|b):[a-z0-9][a-z0-9_-]{0,63}$/i;

export function assertAsset(asset) {
  if (!ASSETS.includes(asset)) {
    throw new TypeError(`unknown asset ${String(asset)}; expected one of ${ASSETS.join(", ")}`);
  }
  return asset;
}

export function assertAccount(account) {
  if (typeof account !== "string" || !(SYS_ACCOUNTS.has(account) || USER_ACCOUNT_RE.test(account))) {
    throw new TypeError(`invalid account ${String(account)}; expected u:<name>, b:<name>, or a known sys: account`);
  }
  return account;
}

export function isUserAccount(account) {
  return typeof account === "string" && USER_ACCOUNT_RE.test(account);
}

// ---------------------------------------------------------------------------
// 4. TokenLedger — double-entry journal with hard invariants.
// ---------------------------------------------------------------------------

export class TokenLedger {
  constructor() {
    this._balances = new Map();
    this._opened = [];
    this._negativeOk = new Set();
    this._receipts = new Map(); // idempotencyKey -> receipt
    this._journals = [];
  }

  _key(account, asset) {
    return `${account}|${asset}`;
  }

  openAccount(account, asset, { allowNegative = false } = {}) {
    assertAccount(account);
    assertAsset(asset);
    const k = this._key(account, asset);
    if (!this._balances.has(k)) {
      this._balances.set(k, 0);
      this._opened.push({ account, asset });
    }
    if (allowNegative) this._negativeOk.add(k);
    return this;
  }

  /** Balance in integer fluff; 0 for a valid account never touched. */
  balance(account, asset) {
    assertAccount(account);
    assertAsset(asset);
    return this._balances.get(this._key(account, asset)) ?? 0;
  }

  accounts() {
    return this._opened.map((e) => ({ ...e }));
  }

  journalCount() {
    return this._journals.length;
  }

  /**
   * Post a double-entry journal. Each posting is { account, asset, amount }
   * with a SIGNED safe integer amount (negative = debit).
   *
   * Invariants enforced:
   * - idempotencyKey is required; replays return the original receipt.
   * - every asset's postings sum to exactly zero;
   * - no account goes negative (except allowNegative accounts);
   * - sys:void is never debited, and is credited only when
   *   voidCreditReason is "tithe" or "burn".
   */
  post(postings, { idempotencyKey, action = "post", memo = "", voidCreditReason = null } = {}) {
    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
      throw new TypeError("post() requires a client idempotencyKey");
    }
    const replay = this._receipts.get(idempotencyKey);
    if (replay) return replay;
    if (!Array.isArray(postings) || postings.length === 0) {
      throw new TypeError("post() requires a non-empty postings array");
    }

    const sums = new Map();
    for (const p of postings) {
      assertAccount(p.account);
      assertAsset(p.asset);
      assertSignedFluff(p.amount, "posting.amount");
      if (p.account === "sys:void" && p.amount < 0) {
        throw new Error("sys:void is never debited");
      }
      if (p.account === "sys:void" && p.amount > 0 && voidCreditReason !== "tithe" && voidCreditReason !== "burn") {
        throw new Error("sys:void is credited only by tithes or burns");
      }
      const next = (sums.get(p.asset) ?? 0) + p.amount;
      if (!Number.isSafeInteger(next)) throw new RangeError("journal sum exceeds the safe integer range");
      sums.set(p.asset, next);
    }
    for (const [asset, sum] of sums) {
      if (sum !== 0) throw new Error(`journal does not sum to zero for ${asset} (sum ${sum})`);
    }

    const applied = new Map();
    for (const p of postings) {
      this.openAccount(p.account, p.asset);
      const k = this._key(p.account, p.asset);
      const next = (applied.has(k) ? applied.get(k) : this._balances.get(k)) + p.amount;
      if (!Number.isSafeInteger(next)) throw new RangeError("balance exceeds the safe integer range");
      if (next < 0 && !this._negativeOk.has(k)) {
        throw new Error(`insufficient funds: ${p.account} holds ${this._balances.get(k)} ${p.asset}`);
      }
      applied.set(k, next);
    }
    for (const [k, v] of applied) this._balances.set(k, v);

    const receipt = Object.freeze({
      id: newId("rcpt"),
      kind: "receipt",
      action,
      idempotencyKey,
      memo,
      postings: Object.freeze(postings.map((p) => Object.freeze({ ...p }))),
      ts: Date.now(),
    });
    this._receipts.set(idempotencyKey, receipt);
    this._journals.push(receipt);
    return receipt;
  }
}

// ---------------------------------------------------------------------------
// 5. Quote engine.
// ---------------------------------------------------------------------------

export class QuoteError extends Error {
  constructor(message) {
    super(message);
    this.name = "QuoteError";
  }
}

export const MARKET_ACTIONS = Object.freeze(["exchange", "buy", "sell"]);
export const MARKET_MAKER = "sys:market";
export const VOID_ACCOUNT = "sys:void";

/**
 * Tamper-evident quote hash. The hash binds every quote field; execute()
 * recomputes it and rejects any mismatch.
 */
export function quoteHash(q) {
  const body = [
    "tumbo:quote:v1",
    q.id,
    q.action,
    q.from,
    q.to,
    q.fromAsset,
    q.toAsset,
    q.amountIn,
    q.amountOut,
    q.expiresAt,
  ].join("|");
  return fnv1a64Hex(body);
}

export class QuoteEngine {
  constructor(config = CONFIG) {
    this.config = config;
    this.ledger = new TokenLedger();
    this._receipts = new Map(); // idempotencyKey -> receipt
    this._executedQuoteIds = new Set(); // consumed quote ids
    this._listeners = new Map();
    this._genesis();
  }

  /** Issue supply once, from the single CONFIG constant. */
  _genesis() {
    const cfg = this.config;
    const supplyTumbo = assertFluff(cfg?.supply?.TUMBO, "config.supply.TUMBO");
    const supplySmimas = assertFluff(cfg?.supply?.sMIMAS, "config.supply.sMIMAS");
    const floatTumbo = assertFluff(cfg?.marketFloatTumbo, "config.marketFloatTumbo");
    const faucetTumbo = assertFluff(cfg?.faucetTumbo, "config.faucetTumbo");
    if (floatTumbo + faucetTumbo > supplyTumbo) {
      throw new RangeError("market float + faucet funding exceeds the TUMBO supply");
    }
    this.ledger.openAccount("sys:issuance", "TUMBO", { allowNegative: true });
    this.ledger.openAccount("sys:issuance", "sMIMAS", { allowNegative: true });
    this.ledger.post(
      [
        { account: "sys:issuance", asset: "TUMBO", amount: -supplyTumbo },
        { account: "sys:treasury", asset: "TUMBO", amount: supplyTumbo },
      ],
      { idempotencyKey: "genesis:tumbo-supply", action: "genesis" }
    );
    this.ledger.post(
      [
        { account: "sys:issuance", asset: "sMIMAS", amount: -supplySmimas },
        { account: MARKET_MAKER, asset: "sMIMAS", amount: supplySmimas },
      ],
      { idempotencyKey: "genesis:smimas-supply", action: "genesis" }
    );
    this.ledger.post(
      [
        { account: "sys:treasury", asset: "TUMBO", amount: -floatTumbo },
        { account: MARKET_MAKER, asset: "TUMBO", amount: floatTumbo },
      ],
      { idempotencyKey: "genesis:market-float", action: "genesis" }
    );
    this.ledger.post(
      [
        { account: "sys:treasury", asset: "TUMBO", amount: -faucetTumbo },
        { account: "sys:faucet", asset: "TUMBO", amount: faucetTumbo },
      ],
      { idempotencyKey: "genesis:faucet", action: "genesis" }
    );
  }

  /** Exact rational price for a direction; sell uses the reciprocal. */
  _priceFor(fromAsset, toAsset) {
    const { num, den } = this.config.price;
    if (fromAsset === "TUMBO" && toAsset === "sMIMAS") return { num, den };
    if (fromAsset === "sMIMAS" && toAsset === "TUMBO") return { num: den, den: num };
    throw new QuoteError(`unsupported market pair ${fromAsset} -> ${toAsset}`);
  }

  _checkDirection(action, fromAsset, toAsset) {
    if (action === "buy" && !(fromAsset === "TUMBO" && toAsset === "sMIMAS")) {
      throw new QuoteError("buy quotes are TUMBO -> sMIMAS only");
    }
    if (action === "sell" && !(fromAsset === "sMIMAS" && toAsset === "TUMBO")) {
      throw new QuoteError("sell quotes are sMIMAS -> TUMBO only");
    }
  }

  /**
   * Build a firm, tamper-evident quote against the market maker.
   * amountOut is computed with exact integer mulDivFloor math.
   */
  quote({ action, from, fromAsset, toAsset, amountIn, ttlMs } = {}) {
    if (!MARKET_ACTIONS.includes(action)) {
      throw new QuoteError(`action must be one of ${MARKET_ACTIONS.join("|")}; got ${String(action)}`);
    }
    assertAccount(from);
    if (!isUserAccount(from)) {
      throw new QuoteError("market quotes are issued to user accounts (u:<name> or b:<name>) only");
    }
    assertAsset(fromAsset);
    assertAsset(toAsset);
    if (fromAsset === toAsset) throw new QuoteError("fromAsset and toAsset must differ");
    this._checkDirection(action, fromAsset, toAsset);
    assertFluff(amountIn, "amountIn");
    if (amountIn <= 0) throw new QuoteError("amountIn must be positive");
    const { num, den } = this._priceFor(fromAsset, toAsset);
    const amountOut = mulDivFloor(amountIn, num, den);
    if (amountOut <= 0) throw new QuoteError("amountIn too small: quoted output rounds to zero fluff");
    const ttl = ttlMs === undefined ? this.config.quoteTtlMs : ttlMs;
    if (typeof ttl !== "number" || !Number.isFinite(ttl)) {
      throw new TypeError("ttlMs must be a finite number of milliseconds");
    }
    const q = {
      id: newId("q"),
      action,
      from,
      to: MARKET_MAKER,
      fromAsset,
      toAsset,
      amountIn,
      amountOut,
      expiresAt: Date.now() + ttl,
    };
    q.hash = quoteHash(q);
    return Object.freeze(q);
  }

  _validateQuoteShape(q) {
    if (!q || typeof q !== "object") throw new QuoteError("quote is required");
    if (typeof q.id !== "string" || q.id.length === 0) throw new QuoteError("quote.id is malformed");
    if (!MARKET_ACTIONS.includes(q.action)) throw new QuoteError("quote.action is malformed");
    assertAccount(q.from);
    if (!isUserAccount(q.from)) throw new QuoteError("quotes settle from user accounts only");
    if (q.to !== MARKET_MAKER) throw new QuoteError("quotes settle against sys:market only");
    assertAsset(q.fromAsset);
    assertAsset(q.toAsset);
    if (q.fromAsset === q.toAsset) throw new QuoteError("quote assets must differ");
    this._checkDirection(q.action, q.fromAsset, q.toAsset);
    assertFluff(q.amountIn, "quote.amountIn");
    assertFluff(q.amountOut, "quote.amountOut");
    if (q.amountIn <= 0 || q.amountOut <= 0) throw new QuoteError("quote amounts must be positive");
    if (typeof q.expiresAt !== "number" || !Number.isFinite(q.expiresAt)) {
      throw new QuoteError("quote.expiresAt is malformed");
    }
    if (typeof q.hash !== "string" || !/^[0-9a-f]{16}$/.test(q.hash)) {
      throw new QuoteError("quote.hash is malformed");
    }
  }

  /**
   * Execute a quote. Rejects expired or tampered quotes (the hash is
   * recomputed from the presented fields and compared; any mismatch
   * rejects). A repeated idempotency key returns the original receipt
   * without moving funds; re-executing a consumed quote id under a new
   * key is rejected.
   *
   * Settlement: the taker pays amountIn; 10 bps of it goes to sys:void
   * (the Void tithe) and the rest to sys:market; the taker receives
   * amountOut from the market maker's inventory. Emits "tumbo:token"
   * receipt and balance-changed events on settle.
   */
  execute(quote, { idempotencyKey } = {}) {
    const key = idempotencyKey ?? `quote:${quote?.id}`;
    if (typeof key !== "string" || key.length === 0) {
      throw new TypeError("idempotencyKey must be a non-empty string");
    }
    const replay = this._receipts.get(key);
    if (replay) return replay;
    if (quote && this._executedQuoteIds.has(quote.id)) {
      throw new QuoteError(`quote ${quote.id} has already been executed`);
    }

    this._validateQuoteShape(quote);
    if (quoteHash(quote) !== quote.hash) {
      throw new QuoteError("quote rejected: hash mismatch — the quote was tampered with");
    }
    if (Date.now() > quote.expiresAt) {
      throw new QuoteError("quote rejected: the quote has expired");
    }
    if (this.ledger.balance(quote.from, quote.fromAsset) < quote.amountIn) {
      throw new QuoteError(`insufficient funds: ${quote.from} cannot cover ${quote.amountIn} ${quote.fromAsset}`);
    }
    if (this.ledger.balance(MARKET_MAKER, quote.toAsset) < quote.amountOut) {
      throw new QuoteError("market inventory insufficient for this quote");
    }

    // 10 bps Void tithe on the inbound leg: 10 per 10,000 goes to sys:void.
    const tithe = mulDivFloor(quote.amountIn, this.config.titheBps, this.config.titheDenominator);
    const marketNet = quote.amountIn - tithe;
    const postings = [
      { account: quote.from, asset: quote.fromAsset, amount: -quote.amountIn },
      { account: MARKET_MAKER, asset: quote.fromAsset, amount: marketNet },
    ];
    if (tithe > 0) {
      postings.push({ account: VOID_ACCOUNT, asset: quote.fromAsset, amount: tithe });
    }
    postings.push(
      { account: MARKET_MAKER, asset: quote.toAsset, amount: -quote.amountOut },
      { account: quote.from, asset: quote.toAsset, amount: quote.amountOut }
    );

    const journal = this.ledger.post(postings, {
      idempotencyKey: key,
      action: quote.action,
      memo: `quote ${quote.id}`,
      voidCreditReason: "tithe",
    });

    const receipt = Object.freeze({
      id: journal.id,
      kind: "receipt",
      action: quote.action,
      quoteId: quote.id,
      idempotencyKey: key,
      from: quote.from,
      to: MARKET_MAKER,
      fromAsset: quote.fromAsset,
      toAsset: quote.toAsset,
      amountIn: quote.amountIn,
      amountOut: quote.amountOut,
      tithe,
      postings: journal.postings,
      ts: journal.ts,
    });
    this._receipts.set(key, receipt);
    this._executedQuoteIds.add(quote.id);

    this._emit("receipt", { receipt });
    for (const p of postings) {
      this._emit("balance-changed", {
        account: p.account,
        asset: p.asset,
        balance: this.ledger.balance(p.account, p.asset),
      });
    }
    return receipt;
  }

  /**
   * Demo funding: move TUMBO from sys:faucet to a user account.
   * Simulation-only, like everything else here.
   */
  faucet(to, asset, amount, { idempotencyKey } = {}) {
    assertAccount(to);
    if (!isUserAccount(to)) throw new Error("faucet pays user accounts (u:<name> or b:<name>) only");
    assertAsset(asset);
    assertFluff(amount, "amount");
    if (amount <= 0) throw new RangeError("faucet amount must be positive");
    const key = idempotencyKey ?? newId("faucet");
    const journal = this.ledger.post(
      [
        { account: "sys:faucet", asset, amount: -amount },
        { account: to, asset, amount },
      ],
      { idempotencyKey: key, action: "faucet", memo: `demo faucet -> ${to}` }
    );
    const receipt = Object.freeze({ ...journal, quoteId: null, tithe: 0 });
    this._receipts.set(key, receipt);
    this._emit("receipt", { receipt });
    this._emit("balance-changed", { account: to, asset, balance: this.ledger.balance(to, asset) });
    return receipt;
  }

  balance(account, asset) {
    return this.ledger.balance(account, asset);
  }

  /**
   * Subscribe to "balance-changed" or "receipt". Returns an unsubscribe
   * function. In DOM environments, settling also dispatches a document
   * CustomEvent("tumbo:token", { detail: { type, ... } }).
   */
  on(evt, cb) {
    if (evt !== "balance-changed" && evt !== "receipt") {
      throw new TypeError(`unknown event ${String(evt)}; expected "balance-changed" or "receipt"`);
    }
    if (typeof cb !== "function") throw new TypeError("listener must be a function");
    if (!this._listeners.has(evt)) this._listeners.set(evt, new Set());
    this._listeners.get(evt).add(cb);
    return () => {
      const set = this._listeners.get(evt);
      if (set) set.delete(cb);
    };
  }

  _emit(type, detail) {
    const set = this._listeners.get(type);
    if (set) {
      for (const cb of [...set]) {
        try {
          cb(detail);
        } catch {
          // Listener errors never break settlement.
        }
      }
    }
    if (typeof document !== "undefined" && typeof CustomEvent === "function") {
      document.dispatchEvent(new CustomEvent("tumbo:token", { detail: { type, ...detail } }));
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Formatting.
// ---------------------------------------------------------------------------

/** Format integer fluff as a TUMBO-SIM string, e.g. fmt(1500) -> "1.500 TUMBO-SIM". */
export function fmt(fluff) {
  if (typeof fluff !== "number" || !Number.isSafeInteger(fluff)) {
    throw new TypeError("fmt() expects a safe integer number of fluff");
  }
  const neg = fluff < 0;
  const abs = Math.abs(fluff);
  const whole = Math.floor(abs / 1000);
  const frac = String(abs % 1000).padStart(3, "0");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}.${frac} TUMBO-SIM`;
}

// ---------------------------------------------------------------------------
// 7. Engine factory, default engine, and the window.TumboToken facade.
// ---------------------------------------------------------------------------

export function createTokenEngine(config) {
  return new QuoteEngine(config ?? CONFIG);
}

/** Default shared engine (genesis runs once at import). */
export const engine = new QuoteEngine();

/**
 * Install the shared facade contract:
 *   window.TumboToken = { ledger, balance(acct, asset), fmt(fluff), on(evt, cb) }
 * plus quote/execute/faucet/engine conveniences.
 */
export function installFacade(target, { force = false } = {}) {
  const t = target ?? (typeof globalThis !== "undefined" ? globalThis : undefined);
  if (!t) return undefined;
  if (t.TumboToken !== undefined && !force) return t.TumboToken;
  const api = {
    ledger: engine.ledger,
    balance: (account, asset) => engine.balance(account, asset),
    fmt,
    on: (evt, cb) => engine.on(evt, cb),
    quote: (input) => engine.quote(input),
    execute: (q, opts) => engine.execute(q, opts),
    faucet: (to, asset, amount, opts) => engine.faucet(to, asset, amount, opts),
    engine,
  };
  t.TumboToken = api;
  return api;
}

if (typeof window !== "undefined") installFacade(window);
