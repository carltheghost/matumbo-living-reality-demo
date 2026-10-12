/*
 * Simulated Economy — local, deterministic rehearsal for the Living Reality
 * world.
 *
 * This module deliberately composes the canonical TUMBO-SIM QuoteEngine. It
 * does not introduce a wallet, a chain, an external order venue, wagering,
 * deposits, withdrawals, or real-money settlement. Exchange orders, demo
 * prediction positions, and contracts all use integer fluff and the same
 * TokenLedger receipt chain.
 */

import {
  assertAccount,
  assertAsset,
  assertFluff,
  ensureTumboTokenFacade,
  fnv1a64Hex,
  isUserAccount,
  mulDivFloor,
  toCoreAccount,
} from "./token.js";
import {
  LedgerStore,
  adoptTokenEngine,
  loadTokenEngine,
  serializeTokenEngine,
} from "./token-store.js";

export const SIMULATED_ECONOMY_FORMAT = "matumbo-simulated-economy-v1";
export const SIMULATED_ECONOMY_STORAGE_KEY = "matumbo.simulated-economy.v1";
export const SIMULATED_ECONOMY_SOURCE = "matumbo-simulated-economy";
export const SIMULATED_ECONOMY_UNIT = "integer fluff";
export const EXCHANGE_BASE_ASSET = "TUMBO";
export const EXCHANGE_QUOTE_ASSET = "sMIMAS";
export const ECONOMY_ESCROW_ACCOUNT = "sys:escrow";
export const DEMO_LIQUIDITY_ACCOUNT = "b:liquidity";
export const PREDICTION_PROVENANCE_KIND = "explicit-demo-outcome";
export const CONTRACT_EVIDENCE_KIND = "explicit-demo-evidence";

export const EXCHANGE_ORDER_STATUSES = Object.freeze(["open", "partial", "filled", "cancelled"]);
export const PREDICTION_MARKET_STATUSES = Object.freeze(["open", "settled"]);
export const PREDICTION_POSITION_STATUSES = Object.freeze(["open", "settled"]);
export const CONTRACT_STATUSES = Object.freeze(["draft", "active", "completed", "cancelled"]);

export class SimulatedEconomyError extends Error {
  constructor(message, code = "SIMULATED_ECONOMY_ERROR") {
    super(message);
    this.name = "SimulatedEconomyError";
    this.code = code;
    this.simulation = true;
  }
}

export class EconomyIdempotencyError extends SimulatedEconomyError {
  constructor(message = "idempotency key belongs to another simulated economy request") {
    super(message, "IDEM_MISMATCH");
    this.name = "EconomyIdempotencyError";
  }
}

export class EconomyStaleStateError extends SimulatedEconomyError {
  constructor(message = "simulated economy state is stale; reload before retrying") {
    super(message, "STALE_STATE");
    this.name = "EconomyStaleStateError";
  }
}

export class EconomyStateError extends SimulatedEconomyError {
  constructor(message = "simulated economy lifecycle state does not allow this action") {
    super(message, "INVALID_STATE");
    this.name = "EconomyStateError";
  }
}

const MAX_LABEL_LENGTH = 120;
const MAX_NOTE_LENGTH = 240;
const MAX_OUTCOMES = 6;
const MAX_ORDER_BASE = 1_000_000_000;
const MAX_POSITION_UNITS = 1_000_000;
const MAX_CONTRACT_AMOUNT = 1_000_000_000;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function requestHash(value) {
  return fnv1a64Hex(canonicalJson(value));
}

function nowIso(now) {
  const value = typeof now === "function" ? now() : now;
  const date = value === undefined || value === null || value === "" ? new Date() : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError("clock must return a valid date");
  return date.toISOString();
}

function boundedText(value, field, max = MAX_LABEL_LENGTH) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) throw new TypeError(`${field} must be a non-empty string`);
  if (text.length > max) throw new TypeError(`${field} exceeds ${max} characters`);
  return text;
}

function optionalText(value, field, max = MAX_NOTE_LENGTH) {
  if (value === undefined || value === null || value === "") return "";
  const text = String(value).trim().replace(/\s+/g, " ");
  if (text.length > max) throw new TypeError(`${field} exceeds ${max} characters`);
  return text;
}

function positiveFluff(value, field, maximum = Number.MAX_SAFE_INTEGER) {
  assertFluff(value, field);
  if (value <= 0) throw new TypeError(`${field} must be greater than zero`);
  if (value > maximum) throw new RangeError(`${field} exceeds the simulated bound`);
  return value;
}

function positiveRational(num, den, field = "price") {
  positiveFluff(num, `${field}.num`, 1_000_000_000);
  positiveFluff(den, `${field}.den`, 1_000_000_000);
  return { num, den };
}

function ceilMulDiv(a, b, c) {
  assertFluff(a, "a");
  assertFluff(b, "b");
  positiveFluff(c, "c");
  const result = (BigInt(a) * BigInt(b) + BigInt(c) - 1n) / BigInt(c);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("exact result exceeds safe integer range");
  return Number(result);
}

function compareRational(leftNum, leftDen, rightNum, rightDen) {
  const left = BigInt(leftNum) * BigInt(rightDen);
  const right = BigInt(rightNum) * BigInt(leftDen);
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeOwner(value, field = "owner") {
  const account = toCoreAccount(value ?? "you");
  if (!isUserAccount(account)) throw new TypeError(`${field} must be a user or bot account`);
  return account;
}

function normalizeActor(value, field = "actor") {
  const account = normalizeOwner(value, field);
  return account;
}

function normalizeOutcomes(outcomes) {
  if (!Array.isArray(outcomes)) throw new TypeError("outcomes must be an array");
  const normalized = [...new Set(outcomes.map((outcome) => boundedText(outcome, "outcome", 32).toUpperCase()))];
  if (normalized.length < 2 || normalized.length > MAX_OUTCOMES) {
    throw new TypeError(`prediction markets need 2-${MAX_OUTCOMES} distinct outcomes`);
  }
  return normalized;
}

function storageOrNull(storage) {
  if (storage) return storage;
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function emptyState(escrowBaseline) {
  return {
    schemaVersion: 1,
    nextId: 0,
    escrowBaseline: { ...escrowBaseline },
    exchange: { orders: [], trades: [], seeded: false, revision: 0 },
    predictions: { markets: [], positions: [] },
    contracts: [],
    events: [],
    operations: [],
  };
}

function assertArray(value, field) {
  if (!Array.isArray(value)) throw new SimulatedEconomyError(`malformed economy snapshot: ${field}`, "INVALID_SNAPSHOT");
  return value;
}

function assertSafeNonNegative(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SimulatedEconomyError(`malformed economy snapshot: ${field}`, "INVALID_SNAPSHOT");
  }
}

function validateState(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SimulatedEconomyError("malformed economy state", "INVALID_SNAPSHOT");
  }
  if (raw.schemaVersion !== 1) throw new SimulatedEconomyError("unsupported economy state version", "INVALID_SNAPSHOT");
  assertSafeNonNegative(raw.nextId, "nextId");
  if (!raw.escrowBaseline || typeof raw.escrowBaseline !== "object") {
    throw new SimulatedEconomyError("malformed economy snapshot: escrowBaseline", "INVALID_SNAPSHOT");
  }
  for (const asset of [EXCHANGE_BASE_ASSET, EXCHANGE_QUOTE_ASSET]) {
    assertSafeNonNegative(raw.escrowBaseline[asset], `escrowBaseline.${asset}`);
  }
  const state = clone(raw);
  const orders = assertArray(state.exchange?.orders, "exchange.orders");
  if (state.exchange.revision === undefined) state.exchange.revision = 0;
  else assertSafeNonNegative(state.exchange.revision, "exchange.revision");
  const orderIds = new Set();
  for (const order of orders) {
    if (!order || typeof order.id !== "string" || orderIds.has(order.id)) throw new SimulatedEconomyError("duplicate exchange order", "INVALID_SNAPSHOT");
    orderIds.add(order.id);
    if (!["buy", "sell"].includes(order.side)) throw new SimulatedEconomyError("invalid exchange order side", "INVALID_SNAPSHOT");
    try { assertAccount(order.owner); } catch { throw new SimulatedEconomyError("invalid exchange order owner", "INVALID_SNAPSHOT"); }
    for (const [field, value] of Object.entries({ amountBase: order.amountBase, remainingBase: order.remainingBase, reservedQuote: order.reservedQuote, priceNum: order.priceNum, priceDen: order.priceDen })) {
      assertSafeNonNegative(value, `exchange.orders.${field}`);
    }
    if (order.amountBase <= 0 || order.remainingBase > order.amountBase || order.priceNum <= 0 || order.priceDen <= 0) {
      throw new SimulatedEconomyError("invalid exchange order amounts", "INVALID_SNAPSHOT");
    }
    if (!EXCHANGE_ORDER_STATUSES.includes(order.status)) throw new SimulatedEconomyError("invalid exchange order status", "INVALID_SNAPSHOT");
    if (order.status === "filled" && order.remainingBase !== 0) throw new SimulatedEconomyError("filled order has remaining quantity", "INVALID_SNAPSHOT");
    if (["open", "partial"].includes(order.status) && order.remainingBase <= 0) throw new SimulatedEconomyError("open order has no remaining quantity", "INVALID_SNAPSHOT");
    if (order.side === "sell" && order.reservedQuote !== 0) throw new SimulatedEconomyError("sell order has quote reserve", "INVALID_SNAPSHOT");
    if (order.side === "buy" && order.status !== "cancelled" && order.reservedQuote < mulDivFloor(order.remainingBase, order.priceNum, order.priceDen)) {
      throw new SimulatedEconomyError("buy order quote reserve is too small", "INVALID_SNAPSHOT");
    }
  }
  const trades = assertArray(state.exchange?.trades, "exchange.trades");
  const tradeIds = new Set();
  for (const trade of trades) {
    if (!trade || typeof trade.id !== "string" || tradeIds.has(trade.id)) throw new SimulatedEconomyError("duplicate exchange trade", "INVALID_SNAPSHOT");
    tradeIds.add(trade.id);
    for (const field of ["baseAmount", "quoteAmount", "priceNum", "priceDen"]) assertSafeNonNegative(trade[field], `exchange.trades.${field}`);
    if (trade.baseAmount <= 0 || trade.quoteAmount <= 0 || trade.priceNum <= 0 || trade.priceDen <= 0) throw new SimulatedEconomyError("invalid exchange trade", "INVALID_SNAPSHOT");
  }
  const markets = assertArray(state.predictions?.markets, "predictions.markets");
  const marketIds = new Set();
  for (const market of markets) {
    if (!market || typeof market.id !== "string" || marketIds.has(market.id)) throw new SimulatedEconomyError("duplicate prediction market", "INVALID_SNAPSHOT");
    marketIds.add(market.id);
    if (!PREDICTION_MARKET_STATUSES.includes(market.status)) throw new SimulatedEconomyError("invalid prediction market status", "INVALID_SNAPSHOT");
    assertSafeNonNegative(market.priceFluff, "prediction market price");
    assertSafeNonNegative(market.poolFluff, "prediction market pool");
    if (!Array.isArray(market.outcomes) || market.outcomes.length < 2 || market.outcomes.length > MAX_OUTCOMES) throw new SimulatedEconomyError("invalid prediction outcomes", "INVALID_SNAPSHOT");
  }
  const positions = assertArray(state.predictions?.positions, "predictions.positions");
  const positionIds = new Set();
  for (const position of positions) {
    if (!position || typeof position.id !== "string" || positionIds.has(position.id)) throw new SimulatedEconomyError("duplicate prediction position", "INVALID_SNAPSHOT");
    positionIds.add(position.id);
    if (!marketIds.has(position.marketId) || !PREDICTION_POSITION_STATUSES.includes(position.status)) throw new SimulatedEconomyError("invalid prediction position reference", "INVALID_SNAPSHOT");
    assertSafeNonNegative(position.units, "prediction position units");
    assertSafeNonNegative(position.costFluff, "prediction position cost");
    assertSafeNonNegative(position.payoutFluff, "prediction position payout");
    if (!position.units || !position.costFluff) throw new SimulatedEconomyError("prediction position must be positive", "INVALID_SNAPSHOT");
  }
  const contracts = assertArray(state.contracts, "contracts");
  const contractIds = new Set();
  for (const contract of contracts) {
    if (!contract || typeof contract.id !== "string" || contractIds.has(contract.id)) throw new SimulatedEconomyError("duplicate contract", "INVALID_SNAPSHOT");
    contractIds.add(contract.id);
    if (!CONTRACT_STATUSES.includes(contract.status)) throw new SimulatedEconomyError("invalid contract status", "INVALID_SNAPSHOT");
    assertSafeNonNegative(contract.amountFluff, "contract amount");
    if (!contract.funding || !["unfunded", "funded", "released", "refunded"].includes(contract.funding.status)) throw new SimulatedEconomyError("invalid contract funding", "INVALID_SNAPSHOT");
    assertArray(contract.history, "contract.history");
  }
  assertArray(state.events, "events");
  assertArray(state.operations, "operations");
  const operationKeys = new Set();
  for (const operation of state.operations) {
    if (!operation || typeof operation.key !== "string" || operationKeys.has(operation.key) || typeof operation.requestHash !== "string") throw new SimulatedEconomyError("invalid economy operation registry", "INVALID_SNAPSHOT");
    operationKeys.add(operation.key);
  }
  return state;
}

function extractEngine(token) {
  const engine = token?.engine ?? token?._engine ?? (token?.ledger?.post && token);
  if (!engine?.ledger?.post || typeof engine?.quote !== "function") {
    throw new TypeError("SimulatedEconomy requires the canonical QuoteEngine or TumboToken facade");
  }
  return engine;
}

function resolveToken(token) {
  if (token) return token;
  return ensureTumboTokenFacade({ seed: true });
}

function readJson(storage, key) {
  if (!storage || typeof storage.getItem !== "function") return null;
  const raw = storage.getItem(key);
  return raw ? JSON.parse(raw) : null;
}

function orderSortForMatching(a, b, side) {
  const price = compareRational(a.priceNum, a.priceDen, b.priceNum, b.priceDen);
  if (price !== 0) return side === "sell" ? price : -price;
  return a.id.localeCompare(b.id);
}

function sum(values) {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(total + value)) throw new RangeError("simulated economy sum exceeds safe integer range");
    total += value;
  }
  return total;
}

function proportionalAllocation(total, rows, weightField) {
  assertFluff(total, "total");
  const weightTotal = sum(rows.map((row) => row[weightField]));
  if (weightTotal <= 0) return rows.map(() => 0);
  const allocations = rows.map((row) => {
    const result = (BigInt(total) * BigInt(row[weightField])) / BigInt(weightTotal);
    if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("allocation exceeds safe integer range");
    return Number(result);
  });
  let remainder = total - sum(allocations);
  for (let index = 0; remainder > 0; index = (index + 1) % allocations.length) {
    allocations[index] += 1;
    remainder -= 1;
  }
  return allocations;
}

export class SimulatedEconomy {
  constructor({
    token = null,
    engine = null,
    storage = null,
    storageKey = SIMULATED_ECONOMY_STORAGE_KEY,
    now = null,
    seedLiquidity = false,
  } = {}) {
    this.token = resolveToken(token ?? engine);
    this.engine = extractEngine(this.token);
    this.storage = storageOrNull(storage);
    this.storageKey = storageKey;
    this.now = now;
    this._listeners = new Set();
    this.storageStatus = "in-memory";

    let state = null;
    const raw = readJson(this.storage, this.storageKey);
    if (raw) {
      if (raw.format !== SIMULATED_ECONOMY_FORMAT || !raw.token || !raw.state) {
        throw new SimulatedEconomyError("unsupported simulated economy snapshot", "INVALID_SNAPSHOT");
      }
      const restored = loadTokenEngine(raw.token);
      adoptTokenEngine(this.engine, restored);
      state = validateState(raw.state);
      this.storageStatus = "restored-local-snapshot";
    } else {
      // The regular token boot owns this key in the root app. If a Vivo phone
      // opens this module directly, adopt its validated canonical token
      // snapshot before creating the economy state.
      try {
        const restored = LedgerStore.load();
        if (restored) {
          adoptTokenEngine(this.engine, restored);
          this.storageStatus = "restored-token-snapshot";
        }
      } catch {
        this.storageStatus = "invalid-token-snapshot-skipped";
      }
    }

    if (!state) {
      state = emptyState({
        TUMBO: this.engine.balance(ECONOMY_ESCROW_ACCOUNT, EXCHANGE_BASE_ASSET),
        sMIMAS: this.engine.balance(ECONOMY_ESCROW_ACCOUNT, EXCHANGE_QUOTE_ASSET),
      });
    }
    this._state = state;
    this.verify();
    if (seedLiquidity && !this._state.exchange.seeded) this.seedDemoLiquidity();
  }

  on(callback) {
    if (typeof callback !== "function") throw new TypeError("economy listener must be a function");
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  _emit(event) {
    for (const callback of [...this._listeners]) {
      try { callback(deepFreeze(clone(event))); } catch { /* observers cannot unwind a committed local journal */ }
    }
    if (typeof document !== "undefined" && typeof CustomEvent === "function") {
      try { document.dispatchEvent(new CustomEvent("tumbo:economy", { detail: event })); } catch { /* DOM is optional */ }
    }
  }

  _nextId(prefix) {
    this._state.nextId += 1;
    return `${prefix}:${this._state.nextId}`;
  }

  _operation(key, request, mutate) {
    if (typeof key !== "string" || !key.trim()) throw new TypeError("idempotencyKey must be a non-empty string");
    const normalizedKey = key.trim();
    const hash = requestHash(request);
    const prior = this._state.operations.find((entry) => entry.key === normalizedKey);
    if (prior) {
      if (prior.requestHash !== hash) throw new EconomyIdempotencyError();
      return clone(prior.result);
    }
    const result = mutate();
    this._state.operations.push({ key: normalizedKey, requestHash: hash, result: clone(result) });
    this._persist();
    this._emit({ type: "changed", operation: normalizedKey, result: clone(result) });
    return clone(result);
  }

  _assertRevision(actual, expected, label) {
    if (expected === undefined || expected === null) return;
    if (!Number.isSafeInteger(expected) || expected !== actual) {
      throw new EconomyStaleStateError(`${label} revision ${actual} does not match expected ${String(expected)}`);
    }
  }

  _post(postings, options) {
    const existed = this.engine.ledger._receipts?.has(options.idempotencyKey) === true;
    const receipt = this.engine.ledger.post(postings, options);
    if (!existed && typeof this.engine._emit === "function") this.engine._emit("receipt", { receipt });
    return receipt;
  }

  _audit({ key, action, actor, refType, refId, detail = "" }) {
    const account = normalizeActor(actor);
    const receipt = this._post([
      { account, asset: EXCHANGE_BASE_ASSET, amount: 0 },
      { account: "sys:market", asset: EXCHANGE_BASE_ASSET, amount: 0 },
    ], {
      idempotencyKey: key,
      action,
      memo: optionalText(detail, "memo", 140),
      authority: "internal",
      links: {
        economy: SIMULATED_ECONOMY_SOURCE,
        refType,
        refId,
        actor: account,
        simulation: true,
      },
    });
    this._state.events.push({
      id: this._nextId("event"),
      type: action,
      refType,
      refId,
      actor: account,
      receiptId: receipt.id,
      hash: receipt.hash,
      at: nowIso(this.now),
      detail: optionalText(detail, "detail"),
      simulation: true,
    });
    return receipt;
  }

  _moneyReceipt({ postings, key, action, refType, refId, actor, detail = "" }) {
    const account = normalizeActor(actor);
    const receipt = this._post(postings, {
      idempotencyKey: key,
      action,
      memo: optionalText(detail, "memo", 140),
      authority: "internal",
      links: {
        economy: SIMULATED_ECONOMY_SOURCE,
        refType,
        refId,
        actor: account,
        simulation: true,
      },
    });
    this._state.events.push({
      id: this._nextId("event"),
      type: action,
      refType,
      refId,
      actor: account,
      receiptId: receipt.id,
      hash: receipt.hash,
      at: nowIso(this.now),
      detail: optionalText(detail, "detail"),
      simulation: true,
    });
    return receipt;
  }

  _persist() {
    const snapshot = {
      format: SIMULATED_ECONOMY_FORMAT,
      version: 1,
      token: JSON.parse(serializeTokenEngine(this.engine)),
      state: clone(this._state),
    };
    const raw = JSON.stringify(snapshot);
    try {
      if (this.storage?.setItem) this.storage.setItem(this.storageKey, raw);
      LedgerStore.save(this.engine);
      this.storageStatus = this.storage ? "persisted-local-snapshot" : "in-memory";
    } catch {
      // A browser quota/private-mode failure must not erase the committed
      // in-memory journal. The UI can show the status as non-durable.
      this.storageStatus = "storage-unavailable";
    }
    return raw;
  }

  snapshot() {
    return deepFreeze(clone(this._state));
  }

  balances(account = "you") {
    const owner = normalizeOwner(account);
    return deepFreeze({
      account: owner,
      unit: SIMULATED_ECONOMY_UNIT,
      simulation: true,
      available: {
        TUMBO: this.engine.balance(owner, EXCHANGE_BASE_ASSET),
        sMIMAS: this.engine.balance(owner, EXCHANGE_QUOTE_ASSET),
      },
      receiptChain: this.engine.ledger.verifyChain(),
    });
  }

  receipts({ limit = 100 } = {}) {
    const bounded = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    return deepFreeze(clone(this.engine.ledger._journals
      .filter((receipt) => receipt.links?.economy === SIMULATED_ECONOMY_SOURCE)
      .slice(-bounded)
      .reverse()));
  }

  exchangeOrders({ owner = null } = {}) {
    const account = owner === null ? null : normalizeOwner(owner);
    return deepFreeze(clone(this._state.exchange.orders.filter((order) => !account || order.owner === account)));
  }

  exchangeTrades({ limit = 100 } = {}) {
    const bounded = Math.max(1, Math.min(500, Math.floor(Number(limit) || 100)));
    return deepFreeze(clone(this._state.exchange.trades.slice(-bounded).reverse()));
  }

  predictionMarkets() {
    return deepFreeze(clone(this._state.predictions.markets.map((market) => ({
      ...market,
      positions: this._state.predictions.positions.filter((position) => position.marketId === market.id),
    }))));
  }

  contracts() {
    return deepFreeze(clone(this._state.contracts));
  }

  seedDemoLiquidity({ idempotencyKey = "economy:seed-liquidity:v1" } = {}) {
    const request = { action: "seed-demo-liquidity", account: DEMO_LIQUIDITY_ACCOUNT };
    return this._operation(idempotencyKey, request, () => {
      if (this._state.exchange.seeded) {
        return { seeded: true, orders: this.exchangeOrders({ owner: DEMO_LIQUIDITY_ACCOUNT }) };
      }
      const allocation = 50_000;
      this._post([
        { account: "sys:market", asset: EXCHANGE_BASE_ASSET, amount: -allocation },
        { account: DEMO_LIQUIDITY_ACCOUNT, asset: EXCHANGE_BASE_ASSET, amount: allocation },
        { account: "sys:market", asset: EXCHANGE_QUOTE_ASSET, amount: -allocation },
        { account: DEMO_LIQUIDITY_ACCOUNT, asset: EXCHANGE_QUOTE_ASSET, amount: allocation },
      ], {
        idempotencyKey: "economy:seed-liquidity:inventory:v1",
        action: "exchange.liquidity.seed",
        memo: "TUMBO-SIM demo liquidity; no external venue",
        authority: "internal",
        links: { economy: SIMULATED_ECONOMY_SOURCE, refType: "liquidity", refId: DEMO_LIQUIDITY_ACCOUNT, simulation: true },
      });
      const sell = this._createOrder({
        owner: DEMO_LIQUIDITY_ACCOUNT,
        side: "sell",
        amountBase: 20_000,
        priceNum: 1,
        priceDen: 1,
        id: "order:demo-sell",
        holdKey: "economy:seed-liquidity:sell-hold:v1",
      });
      const buy = this._createOrder({
        owner: DEMO_LIQUIDITY_ACCOUNT,
        side: "buy",
        amountBase: 20_000,
        priceNum: 1,
        priceDen: 1,
        id: "order:demo-buy",
        holdKey: "economy:seed-liquidity:buy-hold:v1",
      });
      this._state.exchange.seeded = true;
      this._state.exchange.revision += 1;
      const audit = this._audit({
        key: "economy:seed-liquidity:audit:v1",
        action: "exchange.liquidity.seed",
        actor: DEMO_LIQUIDITY_ACCOUNT,
        refType: "liquidity",
        refId: DEMO_LIQUIDITY_ACCOUNT,
        detail: "Seeded local two-sided demo liquidity",
      });
      return { seeded: true, orders: [sell, buy], receiptId: audit.id, simulation: true };
    });
  }

  _createOrder({ owner, side, amountBase, priceNum, priceDen, id = null, holdKey = null }) {
    const account = normalizeOwner(owner);
    positiveFluff(amountBase, "amountBase", MAX_ORDER_BASE);
    const price = positiveRational(priceNum, priceDen, "price");
    const requiredQuote = ceilMulDiv(amountBase, price.num, price.den);
    if (requiredQuote <= 0) throw new TypeError("order quote reserve rounds to zero");
    const orderId = id ?? this._nextId("order");
    const key = holdKey ?? `economy:exchange:order:${orderId}:hold`;
    const postings = side === "sell"
      ? [
          { account, asset: EXCHANGE_BASE_ASSET, amount: -amountBase },
          { account: ECONOMY_ESCROW_ACCOUNT, asset: EXCHANGE_BASE_ASSET, amount: amountBase },
        ]
      : [
          { account, asset: EXCHANGE_QUOTE_ASSET, amount: -requiredQuote },
          { account: ECONOMY_ESCROW_ACCOUNT, asset: EXCHANGE_QUOTE_ASSET, amount: requiredQuote },
        ];
    const hold = this._moneyReceipt({
      postings,
      key,
      action: "exchange.order.hold",
      refType: "exchange-order",
      refId: orderId,
      actor: account,
      detail: `${side} order hold at ${price.num}/${price.den}`,
    });
    const order = {
      id: orderId,
      owner: account,
      side,
      baseAsset: EXCHANGE_BASE_ASSET,
      quoteAsset: EXCHANGE_QUOTE_ASSET,
      amountBase,
      remainingBase: amountBase,
      priceNum: price.num,
      priceDen: price.den,
      reservedQuote: side === "buy" ? requiredQuote : 0,
      status: "open",
      revision: 0,
      holdReceiptId: hold.id,
      releaseReceiptId: null,
      createdAt: nowIso(this.now),
      updatedAt: nowIso(this.now),
      simulation: true,
    };
    this._state.exchange.orders.push(order);
    return order;
  }

  _bestOrders(side) {
    return this._state.exchange.orders
      .filter((order) => order.side === side && ["open", "partial"].includes(order.status) && order.remainingBase > 0)
      .sort((a, b) => orderSortForMatching(a, b, side));
  }

  _matchOrders() {
    const fills = [];
    while (true) {
      const sells = this._bestOrders("sell");
      const buys = this._bestOrders("buy");
      let pair = null;
      for (const sell of sells) {
        pair = buys.find((buy) => {
          if (buy.owner === sell.owner || compareRational(sell.priceNum, sell.priceDen, buy.priceNum, buy.priceDen) > 0) return false;
          const candidateBase = Math.min(sell.remainingBase, buy.remainingBase);
          const candidateQuote = mulDivFloor(candidateBase, sell.priceNum, sell.priceDen);
          // One unit of base can be worth less than one unit of quote in
          // integer-fluff space. Leave that pair open until a whole-fluff
          // fill is possible instead of creating a zero-value receipt.
          return candidateQuote > 0 && candidateQuote <= buy.reservedQuote;
        });
        if (pair) {
          pair = { sell, buy: pair };
          break;
        }
      }
      if (!pair) break;
      const { sell, buy } = pair;
      const baseAmount = Math.min(sell.remainingBase, buy.remainingBase);
      const quoteAmount = mulDivFloor(baseAmount, sell.priceNum, sell.priceDen);
      if (quoteAmount <= 0 || quoteAmount > buy.reservedQuote) throw new SimulatedEconomyError("exchange fill is not exactly fundable", "ACCOUNTING_ERROR");
      const tradeId = this._nextId("trade");
      const receipt = this._moneyReceipt({
        postings: [
          { account: ECONOMY_ESCROW_ACCOUNT, asset: EXCHANGE_BASE_ASSET, amount: -baseAmount },
          { account: buy.owner, asset: EXCHANGE_BASE_ASSET, amount: baseAmount },
          { account: ECONOMY_ESCROW_ACCOUNT, asset: EXCHANGE_QUOTE_ASSET, amount: -quoteAmount },
          { account: sell.owner, asset: EXCHANGE_QUOTE_ASSET, amount: quoteAmount },
        ],
        key: `economy:exchange:fill:${tradeId}`,
        action: "exchange.fill",
        refType: "exchange-trade",
        refId: tradeId,
        actor: buy.owner,
        detail: `${baseAmount} TUMBO-SIM at ${sell.priceNum}/${sell.priceDen}`,
      });
      sell.remainingBase -= baseAmount;
      buy.remainingBase -= baseAmount;
      buy.reservedQuote -= quoteAmount;
      sell.revision += 1;
      buy.revision += 1;
      sell.updatedAt = nowIso(this.now);
      buy.updatedAt = nowIso(this.now);
      sell.status = sell.remainingBase === 0 ? "filled" : "partial";
      buy.status = buy.remainingBase === 0 ? "filled" : "partial";
      if (buy.status === "filled" && buy.reservedQuote > 0) {
        const releaseAmount = buy.reservedQuote;
        const release = this._moneyReceipt({
          postings: [
            { account: ECONOMY_ESCROW_ACCOUNT, asset: EXCHANGE_QUOTE_ASSET, amount: -releaseAmount },
            { account: buy.owner, asset: EXCHANGE_QUOTE_ASSET, amount: releaseAmount },
          ],
          key: `economy:exchange:order:${buy.id}:release`,
          action: "exchange.order.release",
          refType: "exchange-order",
          refId: buy.id,
          actor: buy.owner,
          detail: "Unused quote reserve returned after fill",
        });
        buy.reservedQuote = 0;
        buy.releaseReceiptId = release.id;
      }
      const trade = {
        id: tradeId,
        buyOrderId: buy.id,
        sellOrderId: sell.id,
        baseAmount,
        quoteAmount,
        priceNum: sell.priceNum,
        priceDen: sell.priceDen,
        receiptId: receipt.id,
        createdAt: nowIso(this.now),
        simulation: true,
      };
      this._state.exchange.trades.push(trade);
      fills.push(trade);
    }
    return fills;
  }

  placeExchangeOrder({
    owner = "you",
    side,
    amountBase,
    priceNum,
    priceDen,
    expectedRevision = null,
    idempotencyKey,
  } = {}) {
    const account = normalizeOwner(owner);
    if (!["buy", "sell"].includes(side)) throw new TypeError("side must be buy or sell");
    positiveFluff(amountBase, "amountBase", MAX_ORDER_BASE);
    const price = positiveRational(priceNum, priceDen, "price");
    const request = { action: "place-exchange-order", owner: account, side, amountBase, price, expectedRevision };
    return this._operation(idempotencyKey, request, () => {
      this._assertRevision(this._state.exchange.revision, expectedRevision, "exchange book");
      const order = this._createOrder({ owner: account, side, amountBase, priceNum: price.num, priceDen: price.den });
      const fills = this._matchOrders();
      const audit = this._audit({
        key: `economy:exchange:order:${order.id}:audit`,
        action: "exchange.order.open",
        actor: account,
        refType: "exchange-order",
        refId: order.id,
        detail: `${side.toUpperCase()} ${amountBase} TUMBO-SIM at ${price.num}/${price.den}`,
      });
      this._state.exchange.revision += 1;
      return { order: clone(order), fills: clone(fills), receiptId: audit.id, simulation: true };
    });
  }

  cancelExchangeOrder({ orderId, owner = "you", expectedRevision = null, idempotencyKey } = {}) {
    const account = normalizeOwner(owner);
    const order = this._state.exchange.orders.find((entry) => entry.id === orderId);
    if (!order) throw new SimulatedEconomyError(`unknown exchange order ${String(orderId)}`, "UNKNOWN_ORDER");
    const request = { action: "cancel-exchange-order", orderId, owner: account, expectedRevision };
    return this._operation(idempotencyKey, request, () => {
      if (order.owner !== account) throw new SimulatedEconomyError("only the order owner can cancel it", "NOT_OWNER");
      this._assertRevision(order.revision, expectedRevision, `order ${order.id}`);
      if (!["open", "partial"].includes(order.status)) throw new EconomyStateError(`order ${order.id} is ${order.status}`);
      let release = null;
      const amount = order.side === "sell" ? order.remainingBase : order.reservedQuote;
      if (amount > 0) {
        const asset = order.side === "sell" ? EXCHANGE_BASE_ASSET : EXCHANGE_QUOTE_ASSET;
        release = this._moneyReceipt({
          postings: [
            { account: ECONOMY_ESCROW_ACCOUNT, asset, amount: -amount },
            { account: order.owner, asset, amount },
          ],
          key: `economy:exchange:order:${order.id}:cancel-release`,
          action: "exchange.order.release",
          refType: "exchange-order",
          refId: order.id,
          actor: account,
          detail: "Cancelled order reserve returned",
        });
      }
      order.remainingBase = 0;
      order.reservedQuote = 0;
      order.status = "cancelled";
      order.revision += 1;
      order.updatedAt = nowIso(this.now);
      const audit = this._audit({
        key: `economy:exchange:order:${order.id}:cancel-audit`,
        action: "exchange.order.cancel",
        actor: account,
        refType: "exchange-order",
        refId: order.id,
        detail: "Cancelled local simulated order",
      });
      this._state.exchange.revision += 1;
      return { order: clone(order), releaseReceiptId: release?.id ?? null, receiptId: audit.id, simulation: true };
    });
  }

  createPredictionMarket({
    title,
    outcomes,
    priceFluff = 100,
    owner = "you",
    idempotencyKey,
  } = {}) {
    const account = normalizeOwner(owner);
    const marketTitle = boundedText(title, "title");
    const normalizedOutcomes = normalizeOutcomes(outcomes);
    positiveFluff(priceFluff, "priceFluff", 1_000_000);
    const request = { action: "create-prediction-market", title: marketTitle, outcomes: normalizedOutcomes, priceFluff, owner: account };
    return this._operation(idempotencyKey, request, () => {
      const id = this._nextId("market");
      const audit = this._audit({
        key: `economy:prediction:${id}:create`,
        action: "prediction.market.open",
        actor: account,
        refType: "prediction-market",
        refId: id,
        detail: marketTitle,
      });
      const market = {
        id,
        title: marketTitle,
        outcomes: normalizedOutcomes,
        priceFluff,
        owner: account,
        status: "open",
        poolFluff: 0,
        revision: 0,
        openedAt: nowIso(this.now),
        settledAt: null,
        settlement: null,
        openReceiptId: audit.id,
        simulation: true,
        outcomeProvenance: "No live feed. Settlement requires an explicit demo outcome.",
      };
      this._state.predictions.markets.push(market);
      return { market: clone(market), receiptId: audit.id, simulation: true };
    });
  }

  buyPredictionPosition({
    marketId,
    outcome,
    units,
    owner = "you",
    expectedRevision = null,
    idempotencyKey,
  } = {}) {
    const account = normalizeOwner(owner);
    const market = this._state.predictions.markets.find((entry) => entry.id === marketId);
    if (!market) throw new SimulatedEconomyError(`unknown prediction market ${String(marketId)}`, "UNKNOWN_MARKET");
    const normalizedOutcome = boundedText(outcome, "outcome", 32).toUpperCase();
    positiveFluff(units, "units", MAX_POSITION_UNITS);
    if (!market.outcomes.includes(normalizedOutcome)) throw new TypeError("outcome is not in this prediction market");
    const costFluff = mulDivFloor(units, market.priceFluff, 1);
    positiveFluff(costFluff, "position cost");
    const request = { action: "buy-prediction-position", marketId, outcome: normalizedOutcome, units, owner: account, expectedRevision };
    return this._operation(idempotencyKey, request, () => {
      if (market.status !== "open") throw new EconomyStateError(`prediction market ${market.id} is ${market.status}`);
      this._assertRevision(market.revision, expectedRevision, `prediction market ${market.id}`);
      const id = this._nextId("position");
      const receipt = this._moneyReceipt({
        postings: [
          { account, asset: EXCHANGE_BASE_ASSET, amount: -costFluff },
          { account: ECONOMY_ESCROW_ACCOUNT, asset: EXCHANGE_BASE_ASSET, amount: costFluff },
        ],
        key: `economy:prediction:${id}:buy`,
        action: "prediction.position.open",
        refType: "prediction-position",
        refId: id,
        actor: account,
        detail: `${units} ${normalizedOutcome} demo shares`,
      });
      const position = {
        id,
        marketId,
        owner: account,
        outcome: normalizedOutcome,
        units,
        costFluff,
        payoutFluff: 0,
        status: "open",
        receiptId: receipt.id,
        settlementReceiptId: null,
        openedAt: nowIso(this.now),
        simulation: true,
      };
      this._state.predictions.positions.push(position);
      market.poolFluff += costFluff;
      market.revision += 1;
      return { market: clone(market), position: clone(position), receiptId: receipt.id, simulation: true };
    });
  }

  settlePredictionMarket({
    marketId,
    outcome,
    provenance,
    expectedRevision = null,
    idempotencyKey,
  } = {}) {
    const market = this._state.predictions.markets.find((entry) => entry.id === marketId);
    if (!market) throw new SimulatedEconomyError(`unknown prediction market ${String(marketId)}`, "UNKNOWN_MARKET");
    const normalizedOutcome = boundedText(outcome, "outcome", 32).toUpperCase();
    if (!market.outcomes.includes(normalizedOutcome)) throw new TypeError("settlement outcome is not in the market");
    if (!provenance || provenance.kind !== PREDICTION_PROVENANCE_KIND || provenance.live === true || provenance.external === true) {
      throw new SimulatedEconomyError("prediction settlement requires an explicit non-live demo provenance record", "PROVENANCE_REQUIRED");
    }
    const source = boundedText(provenance.source, "provenance.source", 120);
    const note = optionalText(provenance.note, "provenance.note");
    const normalizedProvenance = { kind: PREDICTION_PROVENANCE_KIND, source, ...(note ? { note } : {}), live: false, simulation: true };
    const request = { action: "settle-prediction-market", marketId, outcome: normalizedOutcome, provenance: normalizedProvenance, expectedRevision };
    return this._operation(idempotencyKey, request, () => {
      if (market.status !== "open") throw new EconomyStateError(`prediction market ${market.id} is ${market.status}`);
      this._assertRevision(market.revision, expectedRevision, `prediction market ${market.id}`);
      const positions = this._state.predictions.positions.filter((position) => position.marketId === market.id && position.status === "open");
      const winners = positions.filter((position) => position.outcome === normalizedOutcome);
      const payouts = winners.length > 0
        ? proportionalAllocation(market.poolFluff, winners, "units")
        : positions.map((position) => position.costFluff);
      const payoutRows = positions.map((position) => ({
        positionId: position.id,
        owner: position.owner,
        outcome: position.outcome,
        units: position.units,
        payoutFluff: winners.length > 0 ? (position.outcome === normalizedOutcome ? payouts[winners.indexOf(position)] : 0) : position.costFluff,
      }));
      const totalPayout = sum(payoutRows.map((row) => row.payoutFluff));
      if (totalPayout !== market.poolFluff) throw new SimulatedEconomyError("prediction pool is not conserved", "ACCOUNTING_ERROR");
      const postings = [{ account: ECONOMY_ESCROW_ACCOUNT, asset: EXCHANGE_BASE_ASSET, amount: -totalPayout }];
      for (const row of payoutRows) if (row.payoutFluff > 0) postings.push({ account: row.owner, asset: EXCHANGE_BASE_ASSET, amount: row.payoutFluff });
      const settlementReceipt = totalPayout > 0
        ? this._moneyReceipt({
            postings,
            key: `economy:prediction:${market.id}:settle`,
            action: "prediction.market.settle",
            refType: "prediction-market",
            refId: market.id,
            actor: market.owner,
            detail: `${normalizedOutcome} · ${source}`,
          })
        : this._audit({
            key: `economy:prediction:${market.id}:settle`,
            action: "prediction.market.settle",
            actor: market.owner,
            refType: "prediction-market",
            refId: market.id,
            detail: `${normalizedOutcome} · ${source}`,
          });
      for (const row of payoutRows) {
        const position = this._state.predictions.positions.find((entry) => entry.id === row.positionId);
        position.status = "settled";
        position.payoutFluff = row.payoutFluff;
        position.settlementReceiptId = settlementReceipt.id;
      }
      market.poolFluff = 0;
      market.status = "settled";
      market.revision += 1;
      market.settledAt = nowIso(this.now);
      market.settlement = {
        outcome: normalizedOutcome,
        provenance: normalizedProvenance,
        receiptId: settlementReceipt.id,
        payoutRows,
        totalPayout,
        winnerCount: winners.length,
        simulation: true,
      };
      return { market: clone(market), payouts: clone(payoutRows), receiptId: settlementReceipt.id, simulation: true };
    });
  }

  createContract({
    title,
    creator = "you",
    counterparty = "b:guide",
    amountFluff = 0,
    terms = "Local simulated deliverable",
    idempotencyKey,
  } = {}) {
    const creatorAccount = normalizeOwner(creator, "creator");
    const counterpartyAccount = normalizeOwner(counterparty, "counterparty");
    if (creatorAccount === counterpartyAccount) throw new TypeError("creator and counterparty must differ");
    const contractTitle = boundedText(title, "title");
    assertFluff(amountFluff, "amountFluff");
    if (amountFluff > MAX_CONTRACT_AMOUNT) throw new RangeError("contract amount exceeds the simulated bound");
    const normalizedTerms = boundedText(terms, "terms", MAX_NOTE_LENGTH);
    const request = { action: "create-contract", title: contractTitle, creator: creatorAccount, counterparty: counterpartyAccount, amountFluff, terms: normalizedTerms };
    return this._operation(idempotencyKey, request, () => {
      const id = this._nextId("contract");
      const audit = this._audit({
        key: `economy:contract:${id}:create`,
        action: "contract.draft",
        actor: creatorAccount,
        refType: "contract",
        refId: id,
        detail: contractTitle,
      });
      const contract = {
        id,
        title: contractTitle,
        terms: normalizedTerms,
        creator: creatorAccount,
        counterparty: counterpartyAccount,
        amountFluff,
        status: "draft",
        revision: 0,
        funding: { status: "unfunded", funder: null, receiptId: null },
        history: [{ status: "draft", actor: creatorAccount, reason: "Contract drafted locally", receiptId: audit.id, at: nowIso(this.now), simulation: true }],
        createdAt: nowIso(this.now),
        completedAt: null,
        provenance: { source: "local-demo", simulation: true, realMoney: false },
        simulation: true,
      };
      this._state.contracts.push(contract);
      return { contract: clone(contract), receiptId: audit.id, simulation: true };
    });
  }

  _contract(contractId) {
    const contract = this._state.contracts.find((entry) => entry.id === contractId);
    if (!contract) throw new SimulatedEconomyError(`unknown contract ${String(contractId)}`, "UNKNOWN_CONTRACT");
    return contract;
  }

  _contractTransition(contract, { to, actor, reason, auditKey, action }) {
    const account = normalizeActor(actor);
    const audit = this._audit({ key: auditKey, action, actor: account, refType: "contract", refId: contract.id, detail: reason });
    contract.status = to;
    contract.revision += 1;
    const entry = { status: to, actor: account, reason, receiptId: audit.id, at: nowIso(this.now), simulation: true };
    contract.history.push(entry);
    return audit;
  }

  acceptContract({ contractId, actor = "b:guide", expectedRevision = null, idempotencyKey } = {}) {
    const contract = this._contract(contractId);
    const account = normalizeActor(actor);
    const request = { action: "accept-contract", contractId, actor: account, expectedRevision };
    return this._operation(idempotencyKey, request, () => {
      this._assertRevision(contract.revision, expectedRevision, `contract ${contract.id}`);
      if (contract.status !== "draft") throw new EconomyStateError(`contract ${contract.id} is ${contract.status}`);
      if (account !== contract.counterparty) throw new SimulatedEconomyError("only the named counterparty can accept this contract", "NOT_COUNTERPARTY");
      const receipt = this._contractTransition(contract, {
        to: "active",
        actor: account,
        reason: "Counterparty accepted local terms",
        auditKey: `economy:contract:${contract.id}:accept`,
        action: "contract.accept",
      });
      return { contract: clone(contract), receiptId: receipt.id, simulation: true };
    });
  }

  fundContract({ contractId, actor = "you", expectedRevision = null, idempotencyKey } = {}) {
    const contract = this._contract(contractId);
    const account = normalizeActor(actor);
    const request = { action: "fund-contract", contractId, actor: account, expectedRevision };
    return this._operation(idempotencyKey, request, () => {
      this._assertRevision(contract.revision, expectedRevision, `contract ${contract.id}`);
      if (contract.status !== "active") throw new EconomyStateError(`contract ${contract.id} is ${contract.status}`);
      if (account !== contract.creator) throw new SimulatedEconomyError("only the creator can fund this contract", "NOT_CREATOR");
      if (contract.funding.status !== "unfunded") throw new EconomyStateError(`contract ${contract.id} is already funded`);
      const receipt = contract.amountFluff > 0
        ? this._moneyReceipt({
            postings: [
              { account, asset: EXCHANGE_BASE_ASSET, amount: -contract.amountFluff },
              { account: ECONOMY_ESCROW_ACCOUNT, asset: EXCHANGE_BASE_ASSET, amount: contract.amountFluff },
            ],
            key: `economy:contract:${contract.id}:fund`,
            action: "contract.fund",
            refType: "contract",
            refId: contract.id,
            actor: account,
            detail: "Contract amount held in local simulated escrow",
          })
        : this._audit({
            key: `economy:contract:${contract.id}:fund`,
            action: "contract.fund",
            actor: account,
            refType: "contract",
            refId: contract.id,
            detail: "Zero-value local contract funding record",
          });
      contract.funding = { status: "funded", funder: account, receiptId: receipt.id };
      contract.revision += 1;
      contract.history.push({ status: "active", actor: account, reason: "Contract funded in simulated escrow", receiptId: receipt.id, at: nowIso(this.now), simulation: true });
      return { contract: clone(contract), receiptId: receipt.id, simulation: true };
    });
  }

  completeContract({ contractId, actor = "b:guide", evidence, provenance, expectedRevision = null, idempotencyKey } = {}) {
    const contract = this._contract(contractId);
    const account = normalizeActor(actor);
    const evidenceText = boundedText(evidence, "evidence", MAX_NOTE_LENGTH);
    if (!provenance || provenance.kind !== CONTRACT_EVIDENCE_KIND || provenance.live === true || provenance.external === true) {
      throw new SimulatedEconomyError("contract completion requires explicit non-live demo evidence", "PROVENANCE_REQUIRED");
    }
    const evidenceSource = boundedText(provenance.source, "provenance.source", 120);
    const normalizedProvenance = { kind: CONTRACT_EVIDENCE_KIND, source: evidenceSource, live: false, simulation: true };
    const request = { action: "complete-contract", contractId, actor: account, evidence: evidenceText, provenance: normalizedProvenance, expectedRevision };
    return this._operation(idempotencyKey, request, () => {
      this._assertRevision(contract.revision, expectedRevision, `contract ${contract.id}`);
      if (contract.status !== "active") throw new EconomyStateError(`contract ${contract.id} is ${contract.status}`);
      if (account !== contract.counterparty) throw new SimulatedEconomyError("only the named counterparty can complete this contract", "NOT_COUNTERPARTY");
      if (contract.amountFluff > 0 && contract.funding.status !== "funded") throw new EconomyStateError("fund the contract before completion");
      const receipt = contract.amountFluff > 0
        ? this._moneyReceipt({
            postings: [
              { account: ECONOMY_ESCROW_ACCOUNT, asset: EXCHANGE_BASE_ASSET, amount: -contract.amountFluff },
              { account: contract.counterparty, asset: EXCHANGE_BASE_ASSET, amount: contract.amountFluff },
            ],
            key: `economy:contract:${contract.id}:complete`,
            action: "contract.complete",
            refType: "contract",
            refId: contract.id,
            actor: account,
            detail: `${evidenceSource}: ${evidenceText}`,
          })
        : this._audit({
            key: `economy:contract:${contract.id}:complete`,
            action: "contract.complete",
            actor: account,
            refType: "contract",
            refId: contract.id,
            detail: `${evidenceSource}: ${evidenceText}`,
          });
      contract.status = "completed";
      contract.completedAt = nowIso(this.now);
      contract.funding.status = contract.amountFluff > 0 ? "released" : "unfunded";
      contract.revision += 1;
      contract.history.push({ status: "completed", actor: account, reason: evidenceText, evidence: { text: evidenceText, provenance: normalizedProvenance }, receiptId: receipt.id, at: nowIso(this.now), simulation: true });
      return { contract: clone(contract), receiptId: receipt.id, simulation: true };
    });
  }

  cancelContract({ contractId, actor = "you", expectedRevision = null, idempotencyKey } = {}) {
    const contract = this._contract(contractId);
    const account = normalizeActor(actor);
    const request = { action: "cancel-contract", contractId, actor: account, expectedRevision };
    return this._operation(idempotencyKey, request, () => {
      this._assertRevision(contract.revision, expectedRevision, `contract ${contract.id}`);
      if (!["draft", "active"].includes(contract.status)) throw new EconomyStateError(`contract ${contract.id} is ${contract.status}`);
      if (account !== contract.creator && account !== contract.counterparty) throw new SimulatedEconomyError("only a named contract party can cancel", "NOT_PARTY");
      let receipt;
      if (contract.funding.status === "funded" && contract.amountFluff > 0) {
        receipt = this._moneyReceipt({
          postings: [
            { account: ECONOMY_ESCROW_ACCOUNT, asset: EXCHANGE_BASE_ASSET, amount: -contract.amountFluff },
            { account: contract.funding.funder, asset: EXCHANGE_BASE_ASSET, amount: contract.amountFluff },
          ],
          key: `economy:contract:${contract.id}:cancel-refund`,
          action: "contract.refund",
          refType: "contract",
          refId: contract.id,
          actor: account,
          detail: "Cancelled contract reserve returned",
        });
        contract.funding.status = "refunded";
      } else {
        receipt = this._audit({
          key: `economy:contract:${contract.id}:cancel`,
          action: "contract.cancel",
          actor: account,
          refType: "contract",
          refId: contract.id,
          detail: "Cancelled local simulated contract",
        });
      }
      contract.status = "cancelled";
      contract.revision += 1;
      contract.history.push({ status: "cancelled", actor: account, reason: "Contract cancelled locally", receiptId: receipt.id, at: nowIso(this.now), simulation: true });
      return { contract: clone(contract), receiptId: receipt.id, simulation: true };
    });
  }

  verify() {
    if (!this.engine.ledger.verifyChain().ok) throw new SimulatedEconomyError("canonical token receipt chain is invalid", "ACCOUNTING_ERROR");
    const expectedEscrow = {
      TUMBO: sum([
        ...this._state.exchange.orders.filter((order) => order.status !== "cancelled" && order.side === "sell").map((order) => order.remainingBase),
        ...this._state.exchange.orders.filter((order) => order.status !== "cancelled" && order.side === "buy").map(() => 0),
        ...this._state.predictions.markets.filter((market) => market.status === "open").map((market) => market.poolFluff),
        ...this._state.contracts.filter((contract) => contract.funding.status === "funded").map((contract) => contract.amountFluff),
      ]),
      sMIMAS: sum(this._state.exchange.orders.filter((order) => order.status !== "cancelled" && order.side === "buy").map((order) => order.reservedQuote)),
    };
    for (const asset of [EXCHANGE_BASE_ASSET, EXCHANGE_QUOTE_ASSET]) {
      const actual = this.engine.balance(ECONOMY_ESCROW_ACCOUNT, asset);
      const expected = this._state.escrowBaseline[asset] + expectedEscrow[asset];
      if (actual !== expected) throw new SimulatedEconomyError(`escrow conservation failed for ${asset}: ${actual} != ${expected}`, "ACCOUNTING_ERROR");
    }
    for (const market of this._state.predictions.markets) {
      const openPositions = this._state.predictions.positions.filter((position) => position.marketId === market.id && position.status === "open");
      const positionPool = sum(openPositions.map((position) => position.costFluff));
      if (market.status === "open" && positionPool !== market.poolFluff) throw new SimulatedEconomyError(`prediction pool mismatch for ${market.id}`, "ACCOUNTING_ERROR");
      if (market.status === "settled" && market.poolFluff !== 0) throw new SimulatedEconomyError(`settled prediction pool is not empty for ${market.id}`, "ACCOUNTING_ERROR");
    }
    return Object.freeze({ ok: true, chain: this.engine.ledger.verifyChain(), escrow: expectedEscrow, simulation: true });
  }
}

export function createSimulatedEconomy(options = {}) {
  return new SimulatedEconomy(options);
}

export default createSimulatedEconomy;
