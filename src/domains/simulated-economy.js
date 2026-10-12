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
export const SIMULATED_ECONOMY_SNAPSHOT_VERSION = 2;
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
  constructor(message = "simulated economy state is stale; reload before retrying", code = "STALE_STATE") {
    super(message, code);
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

const DEMO_SEED_ORDER_SPECS = Object.freeze([
  Object.freeze({
    id: "order:demo-sell",
    side: "sell",
    priceNum: 1,
    priceDen: 1,
    holdKey: "economy:seed-liquidity:sell-hold:v1",
    asset: EXCHANGE_BASE_ASSET,
  }),
  Object.freeze({
    id: "order:demo-buy",
    side: "buy",
    priceNum: 1,
    priceDen: 1,
    holdKey: "economy:seed-liquidity:buy-hold:v1",
    asset: EXCHANGE_QUOTE_ASSET,
  }),
]);

const EXCHANGE_OPERATION_ACTIONS = new Set([
  "place-exchange-order",
  "cancel-exchange-order",
  "seed-demo-liquidity",
]);

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

function engineJournalInfo(engine) {
  const journals = engine?.ledger?._journals ?? [];
  return {
    count: journals.length,
    hash: journals.at(-1)?.hash ?? "genesis",
  };
}

function tokenSnapshotInfo(token) {
  const journals = Array.isArray(token?.journals) ? token.journals : [];
  return {
    count: journals.length,
    hash: journals.at(-1)?.hash ?? "genesis",
  };
}

function journalSignature(journal) {
  return canonicalJson({
    idempotencyKey: journal?.idempotencyKey ?? null,
    action: journal?.action ?? null,
    memo: journal?.memo ?? "",
    postings: journal?.postings ?? null,
    links: journal?.links ?? null,
  });
}

function journalPrefix(shorter, longer) {
  const left = shorter?.ledger?._journals ?? shorter?.journals ?? [];
  const right = longer?.ledger?._journals ?? longer?.journals ?? [];
  if (left.length > right.length) return false;
  return left.every((journal, index) => journalSignature(journal) === journalSignature(right[index]));
}

function journalDelta(shorter, longer) {
  if (!journalPrefix(shorter, longer)) {
    throw new SimulatedEconomyError("canonical token snapshots diverge and cannot be reconciled", "CANONICAL_CONFLICT");
  }
  const left = shorter?.ledger?._journals ?? shorter?.journals ?? [];
  const right = longer?.ledger?._journals ?? longer?.journals ?? [];
  return right.slice(left.length);
}

function isEconomyJournal(journal) {
  return journal?.links?.economy === SIMULATED_ECONOMY_SOURCE;
}

function tokenMarker(engine) {
  const info = engineJournalInfo(engine);
  return { journalCount: info.count, tipHash: info.hash };
}

function snapshotCommit(token, state) {
  const tokenInfo = tokenSnapshotInfo(token);
  const value = {
    version: 1,
    tokenJournalCount: tokenInfo.count,
    tokenTipHash: tokenInfo.hash,
    stateHash: fnv1a64Hex(canonicalJson(state)),
  };
  return { ...value, id: fnv1a64Hex(canonicalJson(value)) };
}

function snapshotMarker(raw) {
  if (!raw) return null;
  const commit = raw.commit ?? snapshotCommit(raw.token, raw.state);
  return {
    commitId: commit.id,
    tokenJournalCount: commit.tokenJournalCount,
    tokenTipHash: commit.tokenTipHash,
    stateHash: commit.stateHash,
  };
}

function durableMarker(raw, canonicalEngine) {
  return {
    combined: snapshotMarker(raw),
    canonical: canonicalEngine ? tokenMarker(canonicalEngine) : null,
  };
}

function sameMarker(left, right) {
  return canonicalJson(left ?? null) === canonicalJson(right ?? null);
}

function validateSnapshotCommit(raw) {
  if (raw.commit === undefined) return;
  if (!raw.commit || typeof raw.commit !== "object" || raw.commit.version !== 1 ||
      !Number.isSafeInteger(raw.commit.tokenJournalCount) || raw.commit.tokenJournalCount < 0 ||
      typeof raw.commit.tokenTipHash !== "string" || typeof raw.commit.stateHash !== "string" ||
      typeof raw.commit.id !== "string") {
    throw new SimulatedEconomyError("malformed simulated economy commit marker", "INVALID_SNAPSHOT");
  }
  const expected = snapshotCommit(raw.token, raw.state);
  if (!sameMarker(raw.commit, expected)) {
    throw new SimulatedEconomyError("simulated economy commit marker does not match its token and state", "INVALID_SNAPSHOT");
  }
}

function parseEconomySnapshot(raw) {
  if (!raw) return null;
  if (raw.format !== SIMULATED_ECONOMY_FORMAT || !raw.token || !raw.state) {
    throw new SimulatedEconomyError("unsupported simulated economy snapshot", "INVALID_SNAPSHOT");
  }
  const rawEngine = loadTokenEngine(raw.token);
  const rawState = validateState(raw.state);
  validateSnapshotCommit(raw);
  return { raw, rawEngine, rawState };
}

function readCanonicalEngine() {
  try {
    return { engine: LedgerStore.load(), error: null };
  } catch (error) {
    return { engine: null, error };
  }
}

function selectCanonicalEngine(candidates) {
  let selected = candidates.find(Boolean);
  const priority = (source) => source === "canonical-store" ? 3 : source === "economy-snapshot" ? 2 : 1;
  for (const candidate of candidates.filter(Boolean).slice(1)) {
    const selectedInfo = engineJournalInfo(selected.engine);
    const candidateInfo = engineJournalInfo(candidate.engine);
    if (candidateInfo.count === selectedInfo.count && journalPrefix(selected.engine, candidate.engine) && journalPrefix(candidate.engine, selected.engine)) {
      if (priority(candidate.source) > priority(selected.source)) selected = candidate;
      continue;
    }
    if (candidateInfo.count > selectedInfo.count) {
      journalDelta(selected.engine, candidate.engine);
      selected = candidate;
      continue;
    }
    if (selectedInfo.count > candidateInfo.count) {
      journalDelta(candidate.engine, selected.engine);
      continue;
    }
    throw new SimulatedEconomyError(
      `conflicting canonical token snapshots (${selected.source} vs ${candidate.source})`,
      "CANONICAL_CONFLICT",
    );
  }
  return selected;
}

function ledgerReceipt(engine, idempotencyKey) {
  return engine?.ledger?._receipts?.get(idempotencyKey)
    ?? engine?.ledger?._journals?.find((journal) => journal.idempotencyKey === idempotencyKey)
    ?? null;
}

function posting(receipt, predicate) {
  return receipt?.postings?.find(predicate) ?? null;
}

function recordedTradePrice(receipt) {
  const linkedNum = receipt?.links?.priceNum;
  const linkedDen = receipt?.links?.priceDen;
  if (Number.isSafeInteger(linkedNum) && linkedNum > 0 && Number.isSafeInteger(linkedDen) && linkedDen > 0) {
    return { priceNum: linkedNum, priceDen: linkedDen };
  }
  const match = String(receipt?.memo ?? "").match(/\bat\s+(\d+)\/(\d+)\s*$/);
  if (!match) return null;
  const priceNum = Number(match[1]);
  const priceDen = Number(match[2]);
  if (!Number.isSafeInteger(priceNum) || priceNum <= 0 || !Number.isSafeInteger(priceDen) || priceDen <= 0) return null;
  return { priceNum, priceDen };
}

function seedFillDetails(receipt) {
  if (receipt?.action !== "exchange.fill") return null;
  const baseEscrow = posting(receipt, (entry) => entry.account === ECONOMY_ESCROW_ACCOUNT && entry.asset === EXCHANGE_BASE_ASSET && entry.amount < 0);
  const quoteEscrow = posting(receipt, (entry) => entry.account === ECONOMY_ESCROW_ACCOUNT && entry.asset === EXCHANGE_QUOTE_ASSET && entry.amount < 0);
  const buyer = posting(receipt, (entry) => entry.account !== ECONOMY_ESCROW_ACCOUNT && entry.asset === EXCHANGE_BASE_ASSET && entry.amount > 0);
  const seller = posting(receipt, (entry) => entry.account !== ECONOMY_ESCROW_ACCOUNT && entry.asset === EXCHANGE_QUOTE_ASSET && entry.amount > 0);
  if (!baseEscrow || !quoteEscrow || !buyer || !seller) {
    throw new SimulatedEconomyError("exchange fill receipt is missing canonical postings", "ACCOUNTING_ERROR");
  }
  const price = recordedTradePrice(receipt);
  if (!price) {
    throw new EconomyStaleStateError(
      "exchange fill receipt has no exact simulated price provenance; reload the paired economy snapshot",
    );
  }
  const buyOrderId = typeof receipt.links?.buyOrderId === "string" ? receipt.links.buyOrderId : null;
  const sellOrderId = typeof receipt.links?.sellOrderId === "string" ? receipt.links.sellOrderId : null;
  const seedSide = sellOrderId === "order:demo-sell" || (!sellOrderId && seller.account === DEMO_LIQUIDITY_ACCOUNT)
    ? "sell"
    : buyOrderId === "order:demo-buy" || (!buyOrderId && buyer.account === DEMO_LIQUIDITY_ACCOUNT) ? "buy" : null;
  return {
    seedSide,
    buyOrderId,
    sellOrderId,
    baseAmount: Math.abs(baseEscrow.amount),
    quoteAmount: Math.abs(quoteEscrow.amount),
    ...price,
    buyer: buyer.account,
    seller: seller.account,
  };
}

function receiptAmountToAccount(receipt, account, asset) {
  return receipt?.postings?.filter((entry) => entry.account === account && entry.asset === asset && entry.amount > 0)
    .reduce((total, entry) => total + entry.amount, 0) ?? 0;
}

function referencedSequence(journal) {
  const values = [journal?.idempotencyKey, journal?.links?.refId];
  let highest = 0;
  for (const value of values) {
    const match = String(value ?? "").match(/(?:order|trade|market|position|contract):(\d+)(?::|$)/g) || [];
    for (const part of match) {
      const number = Number(part.match(/(\d+)(?::)?$/)?.[1]);
      if (Number.isSafeInteger(number)) highest = Math.max(highest, number);
    }
  }
  return highest;
}

function operationMetadata(journal) {
  const links = journal?.links;
  if (links?.operationKey === undefined) return null;
  if (typeof links.operationKey !== "string" || !links.operationKey ||
      typeof links.operationAction !== "string" || !links.operationAction ||
      typeof links.operationRequestHash !== "string" || !links.operationRequest || typeof links.operationRequest !== "object") {
    throw new EconomyStaleStateError("exchange receipt has incomplete operation provenance; reload the paired economy snapshot");
  }
  if (requestHash(links.operationRequest) !== links.operationRequestHash) {
    throw new EconomyStaleStateError("exchange receipt operation provenance does not match its request; reload the paired economy snapshot");
  }
  if (links.operationResult !== undefined && (!links.operationResult || typeof links.operationResult !== "object" || Array.isArray(links.operationResult))) {
    throw new EconomyStaleStateError("exchange receipt has malformed operation result provenance; reload the paired economy snapshot");
  }
  return {
    key: links.operationKey,
    action: links.operationAction,
    requestHash: links.operationRequestHash,
    request: clone(links.operationRequest),
    result: links.operationResult === undefined ? null : clone(links.operationResult),
  };
}

function recoveredEvent(journal, now) {
  return {
    id: `event:recovered:${journal.id}`,
    type: journal.action,
    refType: journal.links?.refType ?? "receipt",
    refId: journal.links?.refId ?? journal.id,
    actor: journal.links?.actor ?? journal.postings?.find((entry) => entry.amount < 0)?.account ?? DEMO_LIQUIDITY_ACCOUNT,
    receiptId: journal.id,
    hash: journal.hash,
    at: nowIso(journal.ts ?? now),
    detail: journal.memo ?? "Recovered from canonical simulated receipt",
    simulation: true,
    recovered: true,
  };
}

function recoverDemoLiquidity(engine, now) {
  const seedKeys = [
    "economy:seed-liquidity:inventory:v1",
    "economy:seed-liquidity:audit:v1",
    ...DEMO_SEED_ORDER_SPECS.map((spec) => spec.holdKey),
  ];
  if (!seedKeys.some((key) => ledgerReceipt(engine, key))) return null;
  const inventory = ledgerReceipt(engine, "economy:seed-liquidity:inventory:v1");
  const audit = ledgerReceipt(engine, "economy:seed-liquidity:audit:v1");
  const orders = [];
  const locked = { TUMBO: 0, sMIMAS: 0 };
  const handledJournalIds = new Set([inventory?.id, audit?.id].filter(Boolean));
  const fillsBySide = { sell: [], buy: [] };
  const cancellations = new Set();
  const journals = engine?.ledger?._journals ?? [];

  for (const spec of DEMO_SEED_ORDER_SPECS) {
    const hold = ledgerReceipt(engine, spec.holdKey);
    const holdPosting = hold?.postings?.find((entry) => entry.account === ECONOMY_ESCROW_ACCOUNT && entry.asset === spec.asset && entry.amount > 0);
    if (!hold || !holdPosting) {
      throw new EconomyStaleStateError(`demo liquidity receipt ${spec.holdKey} is incomplete; reload the paired economy snapshot`, "STALE_STATE");
    }
    handledJournalIds.add(hold.id);
    const fills = fillsBySide[spec.side];
    const releases = [];
    for (const journal of journals) {
      if (journal.action === "exchange.fill") {
        const details = seedFillDetails(journal);
        if (details?.seedSide === spec.side) {
          fills.push({ journal, ...details });
          handledJournalIds.add(journal.id);
        }
      }
      if (journal.action === "exchange.order.release" && journal.links?.refId === spec.id) {
        releases.push(journal);
        handledJournalIds.add(journal.id);
      }
      if (journal.action === "exchange.order.cancel" && journal.links?.refId === spec.id) {
        cancellations.add(spec.id);
        handledJournalIds.add(journal.id);
      }
      if (journal.action === "exchange.order.open" && journal.links?.refId === spec.id) handledJournalIds.add(journal.id);
    }
    const filledBase = sum(fills.map((entry) => entry.baseAmount));
    const filledQuote = sum(fills.map((entry) => entry.quoteAmount));
    const released = sum(releases.map((receipt) => receiptAmountToAccount(receipt, DEMO_LIQUIDITY_ACCOUNT, spec.asset)));
    const initialAmount = holdPosting.amount;
    const cancelled = cancellations.has(spec.id);
    const residualBeforeRelease = spec.side === "sell" ? initialAmount - filledBase : initialAmount - filledQuote;
    if (residualBeforeRelease < 0 || released > residualBeforeRelease) {
      throw new SimulatedEconomyError(`demo liquidity receipts over-release ${spec.id}`, "ACCOUNTING_ERROR");
    }
    if (cancelled && released !== residualBeforeRelease) {
      throw new SimulatedEconomyError(`cancelled demo order ${spec.id} has an unreconciled reserve`, "ACCOUNTING_ERROR");
    }
    const amountBase = initialAmount;
    const remainingBase = spec.side === "sell"
      ? (cancelled ? 0 : initialAmount - filledBase - released)
      : (cancelled ? 0 : initialAmount - filledBase);
    const reservedQuote = spec.side === "buy"
      ? (cancelled ? 0 : initialAmount - filledQuote - released)
      : 0;
    if (remainingBase < 0 || reservedQuote < 0) throw new SimulatedEconomyError(`demo liquidity order ${spec.id} has negative residual`, "ACCOUNTING_ERROR");
    const status = cancelled ? "cancelled" : remainingBase === 0 ? "filled" : fills.length ? "partial" : "open";
    const lifecycle = [hold, ...fills.map((entry) => entry.journal), ...releases, ...journals.filter((journal) => journal.action === "exchange.order.cancel" && journal.links?.refId === spec.id)];
    const updatedAt = lifecycle.reduce((latest, journal) => Math.max(latest, Number(journal.ts) || 0), Number(hold.ts) || 0) || nowIso(now);
    if (spec.side === "sell") locked.TUMBO += remainingBase;
    else locked.sMIMAS += reservedQuote;
    orders.push({
      id: spec.id,
      owner: DEMO_LIQUIDITY_ACCOUNT,
      side: spec.side,
      baseAsset: EXCHANGE_BASE_ASSET,
      quoteAsset: EXCHANGE_QUOTE_ASSET,
      amountBase,
      remainingBase,
      priceNum: spec.priceNum,
      priceDen: spec.priceDen,
      reservedQuote,
      status,
      revision: fills.length + (cancelled ? 1 : 0),
      holdReceiptId: hold.id,
      releaseReceiptId: releases.at(-1)?.id ?? null,
      createdAt: hold.ts ?? nowIso(now),
      updatedAt,
      simulation: true,
      recovered: true,
    });
  }

  const trades = fillsBySide.sell.concat(fillsBySide.buy).map(({ journal, baseAmount, quoteAmount, seedSide, buyer, seller, buyOrderId, sellOrderId, priceNum, priceDen }) => ({
    id: journal.links?.refId ?? `recovered:${journal.id}`,
    buyOrderId: buyOrderId ?? (seedSide === "buy" ? "order:demo-buy" : null),
    sellOrderId: sellOrderId ?? (seedSide === "sell" ? "order:demo-sell" : null),
    baseAmount,
    quoteAmount,
    priceNum,
    priceDen,
    receiptId: journal.id,
    createdAt: journal.ts ?? nowIso(now),
    counterpartyAccount: seedSide === "sell" ? buyer : seller,
    recovered: true,
    simulation: true,
  }));

  const exchangeActions = new Set([
    "exchange.order.hold", "exchange.order.open", "exchange.order.cancel", "exchange.order.release", "exchange.fill", "exchange.operation.commit",
  ]);
  const unsupported = journals.filter((journal) => isEconomyJournal(journal) && !handledJournalIds.has(journal.id) && !exchangeActions.has(journal.action));
  const unhandledExchange = journals.filter((journal) => isEconomyJournal(journal) && !handledJournalIds.has(journal.id) && exchangeActions.has(journal.action));
  const exchangeRevision = 1
    + journals.filter((journal) => journal.action === "exchange.order.open").length
    + journals.filter((journal) => journal.action === "exchange.order.cancel").length;
  const events = journals.filter((journal) => handledJournalIds.has(journal.id)).map((journal) => ({
    id: `event:recovered:${journal.id}`,
    type: journal.action,
    refType: journal.links?.refType ?? "receipt",
    refId: journal.links?.refId ?? journal.id,
    actor: journal.links?.actor ?? journal.postings?.find((entry) => entry.amount < 0)?.account ?? DEMO_LIQUIDITY_ACCOUNT,
    receiptId: journal.id,
    hash: journal.hash,
    at: nowIso(journal.ts ?? now),
    detail: journal.memo ?? "Recovered from canonical simulated receipt",
    simulation: true,
    recovered: true,
  }));
  return {
    orders,
    trades,
    locked,
    seeded: true,
    receiptId: audit?.id ?? null,
    events,
    handledJournalIds,
    unsupported,
    unhandledExchange,
    nextId: Math.max(0, ...journals.map(referencedSequence)),
    revision: exchangeRevision,
  };
}

function buildRecoveredExchangeOrder({ request, orderId, hold, fills, releases, cancellations, now }) {
  if (!request || request.action !== "place-exchange-order" || !["buy", "sell"].includes(request.side) ||
      !request.price || !Number.isSafeInteger(request.price.num) || request.price.num <= 0 ||
      !Number.isSafeInteger(request.price.den) || request.price.den <= 0 ||
      !Number.isSafeInteger(request.amountBase) || request.amountBase <= 0) {
    throw new EconomyStaleStateError(`exchange order ${String(orderId)} has insufficient request provenance; reload the paired economy snapshot`);
  }
  const owner = request.owner;
  const holdAsset = request.side === "sell" ? EXCHANGE_BASE_ASSET : EXCHANGE_QUOTE_ASSET;
  const holdPosting = hold?.postings?.find((entry) => entry.account === ECONOMY_ESCROW_ACCOUNT && entry.asset === holdAsset && entry.amount > 0);
  if (!holdPosting) throw new SimulatedEconomyError(`exchange order ${String(orderId)} is missing its escrow hold`, "ACCOUNTING_ERROR");
  const filledBase = sum(fills.map((entry) => entry.baseAmount));
  const filledQuote = sum(fills.map((entry) => entry.quoteAmount));
  const released = sum(releases.map((receipt) => receiptAmountToAccount(receipt, owner, holdAsset)));
  const initialReserve = holdPosting.amount;
  const residualBeforeRelease = request.side === "sell" ? initialReserve - filledBase : initialReserve - filledQuote;
  const cancelled = cancellations.length > 0;
  if (residualBeforeRelease < 0 || released > residualBeforeRelease) {
    throw new SimulatedEconomyError(`exchange order ${String(orderId)} has an over-released reserve`, "ACCOUNTING_ERROR");
  }
  if (cancelled && released !== residualBeforeRelease) {
    throw new SimulatedEconomyError(`cancelled exchange order ${String(orderId)} has an unreconciled reserve`, "ACCOUNTING_ERROR");
  }
  const remainingBase = request.side === "sell"
    ? (cancelled ? 0 : initialReserve - filledBase - released)
    : (cancelled ? 0 : request.amountBase - filledBase);
  const reservedQuote = request.side === "buy"
    ? (cancelled ? 0 : initialReserve - filledQuote - released)
    : 0;
  if (remainingBase < 0 || reservedQuote < 0) {
    throw new SimulatedEconomyError(`exchange order ${String(orderId)} has a negative residual`, "ACCOUNTING_ERROR");
  }
  const status = cancelled ? "cancelled" : remainingBase === 0 ? "filled" : fills.length ? "partial" : "open";
  const lifecycle = [hold, ...fills.map((entry) => entry.journal), ...releases, ...cancellations];
  const updatedAt = lifecycle.reduce((latest, journal) => Math.max(latest, Number(journal?.ts) || 0), Number(hold?.ts) || 0) || nowIso(now);
  return {
    id: orderId,
    owner,
    side: request.side,
    baseAsset: EXCHANGE_BASE_ASSET,
    quoteAsset: EXCHANGE_QUOTE_ASSET,
    amountBase: request.amountBase,
    remainingBase,
    priceNum: request.price.num,
    priceDen: request.price.den,
    reservedQuote,
    status,
    revision: fills.length + (cancelled ? 1 : 0),
    holdReceiptId: hold.id,
    releaseReceiptId: releases.at(-1)?.id ?? null,
    createdAt: hold.ts ?? nowIso(now),
    updatedAt,
    simulation: true,
    recovered: true,
  };
}

function recoveredTradeFromFill(entry, genericOrderIds) {
  const { journal, baseAmount, quoteAmount, buyer, seller, buyOrderId, sellOrderId, priceNum, priceDen } = entry;
  const hasGenericOrder = genericOrderIds.has(buyOrderId) || genericOrderIds.has(sellOrderId);
  if (!hasGenericOrder || !buyOrderId || !sellOrderId) return null;
  return {
    id: journal.links?.refId ?? `recovered:${journal.id}`,
    buyOrderId,
    sellOrderId,
    baseAmount,
    quoteAmount,
    priceNum,
    priceDen,
    receiptId: journal.id,
    createdAt: journal.ts ?? new Date().toISOString(),
    counterpartyAccount: genericOrderIds.has(buyOrderId) ? seller : buyer,
    recovered: true,
    simulation: true,
  };
}

function recoverGenericExchange(engine, now, handledJournalIds) {
  const journals = engine?.ledger?._journals ?? [];
  const exchangeActions = new Set([
    "exchange.order.hold", "exchange.order.open", "exchange.order.cancel", "exchange.order.release", "exchange.fill", "exchange.operation.commit",
  ]);
  const exchangeJournals = journals.filter((journal) => isEconomyJournal(journal) && exchangeActions.has(journal.action));
  if (!exchangeJournals.length) return null;

  const groups = new Map();
  const journalGroups = new Map();
  for (const journal of exchangeJournals) {
    const metadata = operationMetadata(journal);
    if (!metadata) continue;
    const existing = groups.get(metadata.key);
    if (existing && (existing.action !== metadata.action || existing.requestHash !== metadata.requestHash || canonicalJson(existing.request) !== canonicalJson(metadata.request))) {
      throw new EconomyStaleStateError(`exchange operation ${metadata.key} has conflicting receipt provenance`);
    }
    const group = existing ?? { ...metadata, journals: [] };
    if (metadata.result) {
      if (group.result && canonicalJson(group.result) !== canonicalJson(metadata.result)) {
        throw new EconomyStaleStateError(`exchange operation ${metadata.key} has conflicting result provenance`);
      }
      group.result = metadata.result;
    }
    group.journals.push(journal);
    groups.set(metadata.key, group);
    journalGroups.set(journal.id, group);
  }

  const genericHoldIds = new Set(exchangeJournals
    .filter((journal) => journal.action === "exchange.order.hold" && !DEMO_SEED_ORDER_SPECS.some((spec) => spec.id === journal.links?.refId))
    .map((journal) => journal.links?.refId)
    .filter((id) => typeof id === "string"));
  const orderGroups = new Map();
  for (const orderId of genericHoldIds) {
    const hold = exchangeJournals.find((journal) => journal.action === "exchange.order.hold" && journal.links?.refId === orderId);
    const holdGroup = journalGroups.get(hold?.id);
    const request = holdGroup?.action === "place-exchange-order" ? holdGroup.request : null;
    const open = exchangeJournals.find((journal) => journal.action === "exchange.order.open" && journal.links?.refId === orderId);
    const openGroup = journalGroups.get(open?.id);
    if (!holdGroup || !openGroup || holdGroup !== openGroup || holdGroup.action !== "place-exchange-order" ||
        canonicalJson(holdGroup.request) !== canonicalJson(openGroup.request)) {
      continue;
    }
    orderGroups.set(orderId, { orderId, request, group: holdGroup, hold, open });
  }

  const fillEntries = [];
  for (const journal of exchangeJournals.filter((entry) => entry.action === "exchange.fill")) {
    const details = seedFillDetails(journal);
    fillEntries.push({ journal, ...details });
  }
  const genericOrderIds = new Set(orderGroups.keys());
  const fillsByOrder = new Map([...genericOrderIds].map((id) => [id, []]));
  const trades = [];
  for (const entry of fillEntries) {
    const trade = recoveredTradeFromFill(entry, genericOrderIds);
    if (!trade) continue;
    trades.push(trade);
    if (genericOrderIds.has(entry.buyOrderId)) fillsByOrder.get(entry.buyOrderId).push(entry);
    if (genericOrderIds.has(entry.sellOrderId)) fillsByOrder.get(entry.sellOrderId).push(entry);
    handledJournalIds.add(entry.journal.id);
  }

  const orders = [];
  const operations = [];
  const locked = { TUMBO: 0, sMIMAS: 0 };
  for (const group of groups.values()) {
    if (group.action === "seed-demo-liquidity" && group.result) {
      for (const journal of group.journals) handledJournalIds.add(journal.id);
      operations.push({ key: group.key, requestHash: group.requestHash, result: clone(group.result) });
    }
  }
  for (const [orderId, descriptor] of orderGroups) {
    const fills = fillsByOrder.get(orderId);
    const releases = exchangeJournals.filter((journal) => journal.action === "exchange.order.release" && journal.links?.refId === orderId);
    const cancellations = exchangeJournals.filter((journal) => journal.action === "exchange.order.cancel" && journal.links?.refId === orderId);
    const order = buildRecoveredExchangeOrder({ request: descriptor.request, orderId, hold: descriptor.hold, fills, releases, cancellations, now });
    orders.push(order);
    if (order.side === "sell") locked.TUMBO += order.remainingBase;
    else locked.sMIMAS += order.reservedQuote;
    if (descriptor.group.result) {
      for (const journal of descriptor.group.journals) handledJournalIds.add(journal.id);
    }
    for (const journal of releases) {
      const group = journalGroups.get(journal.id);
      if (group && (group === descriptor.group || (group.action === "cancel-exchange-order" && group.result))) handledJournalIds.add(journal.id);
    }
    for (const journal of cancellations) {
      const group = journalGroups.get(journal.id);
      if (group && group.action === "cancel-exchange-order" && group.result) {
        for (const operationJournal of group.journals) handledJournalIds.add(operationJournal.id);
        operations.push({
          key: group.key,
          requestHash: group.requestHash,
          result: clone(group.result),
        });
      }
    }
    const placeGroup = descriptor.group;
    if (placeGroup.result) {
      operations.push({
        key: placeGroup.key,
        requestHash: placeGroup.requestHash,
        result: clone(placeGroup.result),
      });
    }
  }
  const handledEvents = journals.filter((journal) => handledJournalIds.has(journal.id)).map((journal) => recoveredEvent(journal, now));
  const unhandledExchange = exchangeJournals.filter((journal) => !handledJournalIds.has(journal.id));
  const unsupported = journals.filter((journal) => isEconomyJournal(journal) && !handledJournalIds.has(journal.id) && !exchangeActions.has(journal.action));
  return {
    orders,
    trades,
    locked,
    seeded: false,
    receiptId: null,
    events: handledEvents,
    operations,
    handledJournalIds,
    unsupported,
    unhandledExchange,
    nextId: Math.max(0, ...journals.map(referencedSequence)),
    revision: journals.filter((journal) => journal.action === "exchange.order.open" || journal.action === "exchange.order.cancel").length,
  };
}

function recoverExchangeHistory(engine, now) {
  const demo = recoverDemoLiquidity(engine, now);
  const handledJournalIds = demo?.handledJournalIds ?? new Set();
  const generic = recoverGenericExchange(engine, now, handledJournalIds);
  if (!demo && !generic) return null;
  const locked = {
    TUMBO: (demo?.locked.TUMBO ?? 0) + (generic?.locked.TUMBO ?? 0),
    sMIMAS: (demo?.locked.sMIMAS ?? 0) + (generic?.locked.sMIMAS ?? 0),
  };
  const operations = [...(generic?.operations ?? [])];
  const operationKeys = new Set();
  return {
    orders: [...(demo?.orders ?? []), ...(generic?.orders ?? [])],
    trades: [...(demo?.trades ?? []), ...(generic?.trades ?? [])],
    locked,
    seeded: Boolean(demo?.seeded),
    receiptId: demo?.receiptId ?? null,
    events: [...(demo?.events ?? []), ...(generic?.events ?? [])],
    operations: operations.filter((operation) => {
      if (operationKeys.has(operation.key)) return false;
      operationKeys.add(operation.key);
      return true;
    }),
    handledJournalIds,
    unsupported: generic?.unsupported ?? [],
    unhandledExchange: generic?.unhandledExchange ?? [],
    nextId: Math.max(demo?.nextId ?? 0, generic?.nextId ?? 0),
    revision: Math.max(demo?.revision ?? 0, generic?.revision ?? 0),
  };
}

function applyRecoveredDemoLiquidity(state, recovery, { adjustBaseline = false } = {}) {
  if (!recovery || state.exchange.seeded) return false;
  if (adjustBaseline) {
    for (const asset of [EXCHANGE_BASE_ASSET, EXCHANGE_QUOTE_ASSET]) {
      const current = state.escrowBaseline[asset] - recovery.locked[asset];
      if (current < 0) throw new SimulatedEconomyError(`cannot reconcile demo liquidity baseline for ${asset}`, "ACCOUNTING_ERROR");
      state.escrowBaseline[asset] = current;
    }
  }
  for (const order of recovery.orders) {
    if (!state.exchange.orders.some((entry) => entry.id === order.id)) state.exchange.orders.push(order);
  }
  for (const trade of recovery.trades ?? []) {
    if (!state.exchange.trades.some((entry) => entry.id === trade.id)) state.exchange.trades.push(trade);
  }
  for (const event of recovery.events ?? []) {
    if (!state.events.some((entry) => entry.receiptId === event.receiptId)) state.events.push(event);
  }
  for (const operation of recovery.operations ?? []) {
    if (!state.operations.some((entry) => entry.key === operation.key)) state.operations.push(operation);
  }
  state.nextId = Math.max(state.nextId, recovery.nextId ?? 0);
  state.exchange.seeded = Boolean(recovery.seeded);
  state.exchange.revision = Math.max(state.exchange.revision, recovery.revision ?? (recovery.orders.length ? 1 : 0));
  return true;
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
    this._operationContext = null;
    this.storageStatus = "in-memory";

    let state = null;
    let stateReconciled = false;
    let tokenReconciled = false;
    const raw = readJson(this.storage, this.storageKey);
    const parsedSnapshot = parseEconomySnapshot(raw);
    const rawEngine = parsedSnapshot?.rawEngine ?? null;
    const rawState = parsedSnapshot?.rawState ?? null;
    const canonicalResult = readCanonicalEngine();
    const canonicalEngine = canonicalResult.engine;
    // The regular token boot owns this key in the root app. If a Vivo phone
    // opens this module directly, consider its validated canonical snapshot
    // alongside the combined economy snapshot. The canonical store is the
    // durable owner when it exists; a provided in-memory owner may be newer,
    // while the combined token is only a fallback when no canonical store is
    // available. An older economy snapshot must never roll the owner backward.
    if (canonicalResult.error) {
      this.storageStatus = "invalid-token-snapshot-skipped";
    }

    const candidates = [
      { source: "provided-engine", engine: this.engine },
      canonicalEngine ? { source: "canonical-store", engine: canonicalEngine } : null,
      rawEngine ? { source: "economy-snapshot", engine: rawEngine } : null,
    ];
    const selected = selectCanonicalEngine(candidates);
    if (!selected) throw new SimulatedEconomyError("no canonical token engine is available", "INVALID_SNAPSHOT");

    // A newer canonical token chain is safe to adopt only when every journal
    // added after the paired economy snapshot is non-economic. Economic
    // receipts carry obligations that cannot be reconstructed from an older
    // state object without risking a false balance or inaccessible escrow.
    if (rawEngine && selected.engine !== rawEngine) {
      const delta = journalDelta(rawEngine, selected.engine);
      if (delta.some(isEconomyJournal)) {
        throw new EconomyStaleStateError(
          "simulated economy snapshot is older than canonical economic receipts; reload the latest economy state before continuing",
        );
      }
    }

    this._durableMarker = durableMarker(raw, canonicalEngine);
    if (selected.engine !== this.engine) adoptTokenEngine(this.engine, selected.engine);
    if (rawEngine && !sameMarker(tokenMarker(rawEngine), tokenMarker(this.engine))) tokenReconciled = true;
    if (canonicalEngine && !sameMarker(tokenMarker(canonicalEngine), tokenMarker(this.engine))) tokenReconciled = true;

    if (rawState) {
      state = rawState;
      this.storageStatus = selected.source === "canonical-store" ? "restored-canonical-snapshot" : "restored-local-snapshot";
    } else if (canonicalEngine && selected.source === "canonical-store") {
      this.storageStatus = "restored-token-snapshot";
    }

    if (!state) {
      const recovery = recoverExchangeHistory(this.engine, this.now);
      const economyJournals = this.engine.ledger._journals.filter(isEconomyJournal);
      if (!recovery && economyJournals.length) {
        throw new EconomyStaleStateError(
          "canonical economic receipts exist without a paired simulated economy snapshot; reload the durable economy state before continuing",
        );
      }
      if (recovery?.unsupported?.length) {
        const actions = [...new Set(recovery.unsupported.map((journal) => journal.action))].join(", ");
        throw new EconomyStaleStateError(
          `canonical economic receipts (${actions}) require their paired simulated economy snapshot; reload before continuing`,
        );
      }
      const actualEscrow = {
        TUMBO: this.engine.balance(ECONOMY_ESCROW_ACCOUNT, EXCHANGE_BASE_ASSET),
        sMIMAS: this.engine.balance(ECONOMY_ESCROW_ACCOUNT, EXCHANGE_QUOTE_ASSET),
      };
      const baseline = {
        TUMBO: actualEscrow.TUMBO - (recovery?.locked.TUMBO ?? 0),
        sMIMAS: actualEscrow.sMIMAS - (recovery?.locked.sMIMAS ?? 0),
      };
      for (const asset of [EXCHANGE_BASE_ASSET, EXCHANGE_QUOTE_ASSET]) {
        if (baseline[asset] < 0) throw new SimulatedEconomyError(`cannot reconcile demo liquidity baseline for ${asset}`, "ACCOUNTING_ERROR");
      }
      if (recovery?.unhandledExchange?.length) {
        throw new EconomyStaleStateError(
          "canonical exchange receipts include lifecycle history that cannot be reconstructed without the paired simulated economy snapshot",
        );
      }
      state = emptyState({
        TUMBO: baseline.TUMBO,
        sMIMAS: baseline.sMIMAS,
      });
      stateReconciled = applyRecoveredDemoLiquidity(state, recovery);
    } else if (!state.exchange.seeded) {
      const recovery = recoverExchangeHistory(this.engine, this.now);
      if (recovery?.unsupported?.length || recovery?.unhandledExchange?.length) {
        const actions = [...new Set([...(recovery.unsupported ?? []), ...(recovery.unhandledExchange ?? [])].map((journal) => journal.action))].join(", ");
        throw new EconomyStaleStateError(`economy snapshot is missing lifecycle state for canonical receipts (${actions})`);
      }
      stateReconciled = applyRecoveredDemoLiquidity(state, recovery);
    }
    this._state = state;
    this.verify();
    const restoredStatus = this.storageStatus;
    if (stateReconciled || tokenReconciled) {
      this._persist();
      if (rawState) this.storageStatus = restoredStatus;
    }
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

  _readDurableSources() {
    const raw = readJson(this.storage, this.storageKey);
    const parsed = parseEconomySnapshot(raw);
    const canonicalResult = readCanonicalEngine();
    if (canonicalResult.error) {
      throw new SimulatedEconomyError("canonical token snapshot is invalid; simulated economy persistence is held", "PERSISTENCE_ERROR");
    }
    return {
      raw,
      parsed,
      canonicalEngine: canonicalResult.engine,
      marker: durableMarker(raw, canonicalResult.engine),
    };
  }

  _assertDurableFresh() {
    const durable = this._readDurableSources();
    if (sameMarker(this._durableMarker, durable.marker)) return durable;

    // A paired economy snapshot changed: the state and token journal must be
    // advanced together. Refuse a stale writer rather than overwriting the
    // newer obligations with this wrapper's in-memory state.
    if (!sameMarker(this._durableMarker?.combined, durable.marker.combined)) {
      throw new EconomyStaleStateError("another simulated economy wrapper committed; reload before continuing");
    }

    const canonical = durable.canonicalEngine;
    if (!canonical) throw new EconomyStaleStateError("canonical token storage disappeared; reload before continuing");
    let delta;
    try {
      delta = journalDelta(this.engine, canonical);
    } catch {
      throw new EconomyStaleStateError("canonical token storage changed incompatibly; reload before continuing");
    }
    if (delta.some(isEconomyJournal)) {
      throw new EconomyStaleStateError("canonical economic receipts advanced outside this wrapper; reload before continuing");
    }
    adoptTokenEngine(this.engine, canonical);
    this._durableMarker = durable.marker;
    return durable;
  }

  _operationLinks() {
    if (!this._operationContext) return {};
    return {
      operationKey: this._operationContext.key,
      operationAction: this._operationContext.request.action,
      operationRequestHash: this._operationContext.requestHash,
      operationRequest: clone(this._operationContext.request),
    };
  }

  _recordExchangeOperation({ key, request, requestHash: hash, result }) {
    const actor = normalizeActor(request.owner ?? request.account ?? "you");
    const receipt = this._post([
      { account: actor, asset: EXCHANGE_BASE_ASSET, amount: 0 },
      { account: "sys:market", asset: EXCHANGE_BASE_ASSET, amount: 0 },
    ], {
      idempotencyKey: `economy:exchange:operation:${fnv1a64Hex(`${key}:${hash}`)}`,
      action: "exchange.operation.commit",
      memo: `Committed simulated exchange operation ${request.action}`,
      authority: "internal",
      links: {
        economy: SIMULATED_ECONOMY_SOURCE,
        refType: "exchange-operation",
        refId: key,
        actor,
        simulation: true,
        ...this._operationLinks(),
        operationResult: clone(result),
      },
    });
    this._state.events.push({
      id: this._nextId("event"),
      type: "exchange.operation.commit",
      refType: "exchange-operation",
      refId: key,
      actor,
      receiptId: receipt.id,
      hash: receipt.hash,
      at: nowIso(this.now),
      detail: `Committed simulated exchange operation ${request.action}`,
      simulation: true,
    });
    return receipt;
  }

  _operation(key, request, mutate) {
    if (typeof key !== "string" || !key.trim()) throw new TypeError("idempotencyKey must be a non-empty string");
    const normalizedKey = key.trim();
    this._assertDurableFresh();
    const hash = requestHash(request);
    const prior = this._state.operations.find((entry) => entry.key === normalizedKey);
    if (prior) {
      if (prior.requestHash !== hash) throw new EconomyIdempotencyError();
      return clone(prior.result);
    }
    const stateBefore = clone(this._state);
    const tokenBefore = serializeTokenEngine(this.engine);
    const previousOperationContext = this._operationContext;
    this._operationContext = { key: normalizedKey, requestHash: hash, request: clone(request) };
    let result;
    try {
      result = mutate();
      if (EXCHANGE_OPERATION_ACTIONS.has(request.action)) {
        this._recordExchangeOperation({ key: normalizedKey, request, requestHash: hash, result });
      }
    } catch (error) {
      this._operationContext = previousOperationContext;
      try { adoptTokenEngine(this.engine, loadTokenEngine(tokenBefore)); } catch { /* preserve the original failure */ }
      this._state = stateBefore;
      throw error;
    }
    this._operationContext = previousOperationContext;
    try {
      this._state.operations.push({ key: normalizedKey, requestHash: hash, result: clone(result) });
      this.verify();
      this._persist();
      this._emit({ type: "changed", operation: normalizedKey, result: clone(result) });
      return clone(result);
    } catch (error) {
      // A stale/persistence failure must not leave this wrapper with a token
      // journal that no longer matches its state. Restore the pre-operation
      // in-memory pair; durable storage remains untouched or is fenced on the
      // next call if a lower-level storage failure happened mid-write.
      try { adoptTokenEngine(this.engine, loadTokenEngine(tokenBefore)); } catch { /* preserve the original failure */ }
      this._state = stateBefore;
      throw error;
    }
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
        ...this._operationLinks(),
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

  _moneyReceipt({ postings, key, action, refType, refId, actor, detail = "", metadata = null }) {
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
        ...(metadata && typeof metadata === "object" ? clone(metadata) : {}),
        ...this._operationLinks(),
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
    const durable = this._readDurableSources();
    if (!sameMarker(this._durableMarker, durable.marker)) {
      throw new EconomyStaleStateError("another simulated economy wrapper committed; reload before continuing");
    }
    this.verify();
    const token = JSON.parse(serializeTokenEngine(this.engine));
    const state = clone(this._state);
    const snapshot = {
      format: SIMULATED_ECONOMY_FORMAT,
      version: SIMULATED_ECONOMY_SNAPSHOT_VERSION,
      commit: snapshotCommit(token, state),
      token,
      state,
    };
    const raw = JSON.stringify(snapshot);
    try {
      if (this.storage?.setItem) this.storage.setItem(this.storageKey, raw);
      LedgerStore.save(this.engine);
      this.storageStatus = this.storage ? "persisted-local-snapshot" : "in-memory";
      const afterCanonical = readCanonicalEngine();
      if (afterCanonical.error) throw afterCanonical.error;
      this._durableMarker = durableMarker(this.storage ? snapshot : null, afterCanonical.engine);
    } catch (error) {
      if (error instanceof EconomyStaleStateError || error?.code === "STALE_STATE") throw error;
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
      const existing = recoverExchangeHistory(this.engine, this.now);
      if (existing?.seeded) {
        applyRecoveredDemoLiquidity(this._state, existing);
        return {
          seeded: true,
          orders: this.exchangeOrders({ owner: DEMO_LIQUIDITY_ACCOUNT }),
          receiptId: existing.receiptId,
          rehydrated: true,
          simulation: true,
        };
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
        metadata: {
          buyOrderId: buy.id,
          sellOrderId: sell.id,
          priceNum: sell.priceNum,
          priceDen: sell.priceDen,
        },
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
      if (contract.funding.status === "funded") {
        receipt = contract.amountFluff > 0
          ? this._moneyReceipt({
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
            })
          : this._audit({
              key: `economy:contract:${contract.id}:cancel-refund`,
              action: "contract.refund",
              actor: account,
              refType: "contract",
              refId: contract.id,
              detail: "Cancelled zero-value contract funding record",
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
