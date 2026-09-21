/**
 * Local binary prediction-market rehearsal.
 *
 * Canonical contract primitive:
 *   QUESTION -> YES / NO
 *
 * House is a liquidity-provider role, not an outcome. One person can be the
 * House, or multiple people can form a House Pool. The market uses LMSR for
 * deterministic pricing, a configurable house fee, participant positions,
 * risk limits, and deterministic resolution. All balances are rehearsal
 * credits only: no wallet, custody, chain, settlement, or real money.
 */

export const CONTRACT_ATELIER_SCHEMA_VERSION = 2;
export const CONTRACT_ATELIER_SOURCE = "contract-atelier";
export const CONTRACT_ATELIER_CONSOLE_SOURCE = "contract-atelier-console";
export const CONTRACT_ATELIER_UPDATED_AT = "2026-09-21T00:00:00.000Z";
export const CONTRACT_ATELIER_MAX_TITLE_LENGTH = 64;
export const CONTRACT_ATELIER_MAX_PROPOSITION_LENGTH = 200;
export const CONTRACT_ATELIER_MAX_OUTCOMES = 2;
export const CONTRACT_ATELIER_MAX_STAKE = 10000;
export const CONTRACT_ATELIER_STAKE_UNIT = "rehearsal credits";

export const CONTRACT_ATELIER_MARKET_TYPES = Object.freeze(["yes_no"]);
export const CONTRACT_ATELIER_ROLES = Object.freeze(["house", "player"]);
export const CONTRACT_ATELIER_HOUSE_MODES = Object.freeze(["single", "pool"]);
export const CONTRACT_ATELIER_TOPICS = Object.freeze(["sports", "politics", "weather", "transport", "custom"]);
export const CONTRACT_ATELIER_LOGIC_KINDS = Object.freeze(["condition", "and", "or", "if_else"]);
export const CONTRACT_ATELIER_DEFAULT_FEE_BPS = 100;
export const CONTRACT_ATELIER_MAX_FEE_BPS = 1000;
export const CONTRACT_ATELIER_DEFAULT_LIQUIDITY_B = 100;
export const CONTRACT_ATELIER_MIN_LIQUIDITY_B = 10;
export const CONTRACT_ATELIER_MAX_LIQUIDITY_B = 10000;

export const CONTRACT_ATELIER_BOUNDARY =
  "Contract Atelier is a fictional local rehearsal. Every prediction market is YES/NO. A House may be one provider or a House Pool of multiple providers; fees, prices, positions, and settlement are simulated rehearsal values only. No wallet, chain, custody, wagering, real money, or external settlement exists here.";

export const CONTRACT_ATELIER_NO_VALUE = "Balances are rehearsal credits with zero real value.";

const freeze = (value) => {
  if (Array.isArray(value)) value.forEach(freeze);
  else if (value && typeof value === "object") Object.values(value).forEach(freeze);
  return value && typeof value === "object" ? Object.freeze(value) : value;
};
const text = (value, fallback = "") => value === null || value === undefined ? fallback : String(value);
const round = (value) => Math.round(Number(value) * 10000) / 10000;
const cents = (value) => Math.round(Number(value) * 100) / 100;

export function hashContractAtelierSeed(value) {
  const input = text(value, "contract-atelier");
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function nowIso(now) {
  try {
    const value = typeof now === "function" ? now() : now;
    if (value === null || value === undefined || value === "") return new Date().toISOString();
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  } catch {}
  return new Date().toISOString();
}

function bounded(value, max, field) {
  const normalized = text(value).trim().replace(/\s+/g, " ").slice(0, max);
  if (!normalized) throw new TypeError(field + " must be a non-empty string");
  return normalized;
}

function boundedTitle(value) { return bounded(value, CONTRACT_ATELIER_MAX_TITLE_LENGTH, "contract title"); }
function boundedProposition(value) { return bounded(value, CONTRACT_ATELIER_MAX_PROPOSITION_LENGTH, "logic proposition"); }

export function normalizeContractLogic(logic) {
  if (typeof logic === "string") return freeze({ kind: "condition", proposition: boundedProposition(logic) });
  if (!logic || typeof logic !== "object" || Array.isArray(logic)) throw new TypeError("contract logic must be a proposition string or a logic node");
  const kind = text(logic.kind);
  if (!CONTRACT_ATELIER_LOGIC_KINDS.includes(kind)) throw new TypeError("unknown logic kind: " + (kind || "(missing)"));
  if (kind === "condition") return freeze({ kind, proposition: boundedProposition(logic.proposition) });
  if (kind === "and" || kind === "or") {
    const conditions = Array.isArray(logic.conditions) ? logic.conditions : [];
    if (conditions.length < 2 || conditions.length > 8) throw new TypeError(kind + " logic needs 2–8 conditions");
    return freeze({ kind, conditions: freeze(conditions.map(normalizeContractLogic)) });
  }
  return freeze({
    kind,
    if: normalizeContractLogic(logic.if),
    then: normalizeContractLogic(logic.then),
    else: normalizeContractLogic(logic.else),
  });
}

export function describeContractLogic(node) {
  if (!node || typeof node !== "object") return "—";
  if (node.kind === "condition") return `IF “${node.proposition}” IS TRUE`;
  if (node.kind === "and" || node.kind === "or") return `(${node.conditions.map(describeContractLogic).join(node.kind === "and" ? " AND " : " OR ")})`;
  if (node.kind === "if_else") return `IF ${describeContractLogic(node.if)} THEN ${describeContractLogic(node.then)} ELSE ${describeContractLogic(node.else)}`;
  return "—";
}

export function evaluateContractLogic(node, facts = {}) {
  const source = facts && typeof facts === "object" ? facts : {};
  const visit = (entry) => {
    if (!entry || typeof entry !== "object") return false;
    if (entry.kind === "condition") return source[entry.proposition] === true;
    if (entry.kind === "and") return entry.conditions.every(visit);
    if (entry.kind === "or") return entry.conditions.some(visit);
    if (entry.kind === "if_else") return visit(entry.if) ? visit(entry.then) : visit(entry.else);
    return false;
  };
  return visit(node);
}

const FIXED_OUTCOMES = Object.freeze(["YES", "NO"]);
function normalizeOutcomes(type, outcomes) {
  if (type !== "yes_no") throw new TypeError("unknown contract type: " + (type || "(missing)") + "; use yes_no");
  if (outcomes === null || outcomes === undefined) return FIXED_OUTCOMES;
  if (!Array.isArray(outcomes) || outcomes.length !== 2
    || text(outcomes[0]).trim().toUpperCase() !== "YES"
    || text(outcomes[1]).trim().toUpperCase() !== "NO") {
    throw new TypeError("YES/NO contracts use fixed outcomes: YES, NO");
  }
  return FIXED_OUTCOMES;
}

function normalizeHouseMode(value) {
  const mode = text(value, "single");
  if (!CONTRACT_ATELIER_HOUSE_MODES.includes(mode)) throw new TypeError("house mode must be single or pool");
  return mode;
}

function normalizeFee(value) {
  const fee = Number(value ?? CONTRACT_ATELIER_DEFAULT_FEE_BPS);
  if (!Number.isInteger(fee) || fee < 0 || fee > CONTRACT_ATELIER_MAX_FEE_BPS) {
    throw new TypeError(`house fee must be an integer from 0 to ${CONTRACT_ATELIER_MAX_FEE_BPS} bps`);
  }
  return fee;
}

function normalizeB(value) {
  const b = Number(value ?? CONTRACT_ATELIER_DEFAULT_LIQUIDITY_B);
  if (!Number.isFinite(b) || b < CONTRACT_ATELIER_MIN_LIQUIDITY_B || b > CONTRACT_ATELIER_MAX_LIQUIDITY_B) {
    throw new TypeError(`liquidity b must be between ${CONTRACT_ATELIER_MIN_LIQUIDITY_B} and ${CONTRACT_ATELIER_MAX_LIQUIDITY_B}`);
  }
  return round(b);
}

function logSumExp(a, b) {
  const m = Math.max(a, b);
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m));
}

function lmsrCost(qYes, qNo, b) {
  return b * logSumExp(qYes / b, qNo / b);
}

function lmsrPrices(qYes, qNo, b) {
  const yesLog = qYes / b;
  const noLog = qNo / b;
  const max = Math.max(yesLog, noLog);
  const yesWeight = Math.exp(yesLog - max);
  const noWeight = Math.exp(noLog - max);
  const total = yesWeight + noWeight;
  return freeze({ YES: round(yesWeight / total), NO: round(noWeight / total) });
}

export function quoteBinaryTrade({ qYes = 0, qNo = 0, side, shares, b = CONTRACT_ATELIER_DEFAULT_LIQUIDITY_B, feeBps = CONTRACT_ATELIER_DEFAULT_FEE_BPS } = {}) {
  const normalizedSide = text(side).toUpperCase();
  if (!FIXED_OUTCOMES.includes(normalizedSide)) throw new TypeError("side must be YES or NO");
  const quantity = Number(shares);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new TypeError("shares must be a positive number");
  const liquidity = normalizeB(b);
  const fee = normalizeFee(feeBps);
  const before = lmsrCost(qYes, qNo, liquidity);
  const after = normalizedSide === "YES"
    ? lmsrCost(qYes + quantity, qNo, liquidity)
    : lmsrCost(qYes, qNo + quantity, liquidity);
  const grossCost = after - before;
  const houseFee = grossCost * fee / 10000;
  const pricesBefore = lmsrPrices(qYes, qNo, liquidity);
  const pricesAfter = normalizedSide === "YES"
    ? lmsrPrices(qYes + quantity, qNo, liquidity)
    : lmsrPrices(qYes, qNo + quantity, liquidity);
  return freeze({
    side: normalizedSide,
    shares: round(quantity),
    grossCost: cents(grossCost),
    fee: cents(houseFee),
    totalCost: cents(grossCost + houseFee),
    averagePrice: round(grossCost / quantity),
    priceBefore: pricesBefore[normalizedSide],
    priceAfter: pricesAfter[normalizedSide],
    yesPriceAfter: pricesAfter.YES,
    noPriceAfter: pricesAfter.NO,
    maxLoss: round(liquidity * Math.log(2)),
    simulation: true,
  });
}

export const CONTRACT_ATELIER_STARTER_CONTRACTS = freeze([
  {
    key: "rain-question",
    type: "yes_no",
    role: "house",
    houseMode: "single",
    topic: "weather",
    title: "Will it rain this afternoon?",
    logic: { kind: "or", conditions: ["rain before 15:00", "rain after 15:00"] },
    outcomes: ["YES", "NO"],
    feeBps: 100,
    liquidityB: 100,
    houseCapital: 69.32,
  },
  {
    key: "pool-question",
    type: "yes_no",
    role: "house",
    houseMode: "pool",
    topic: "custom",
    title: "Will the pool contract finish on schedule?",
    logic: "pool contract finishes on schedule",
    outcomes: ["YES", "NO"],
    feeBps: 100,
    liquidityB: 100,
    houseCapital: 69.32,
  },
]);

export function createContractAtelier({ seed = "local-contracts", now = null } = {}) {
  const atelierSeed = text(seed) || "local-contracts";
  let counter = 0;
  let sequence = 0;
  const contracts = new Map();
  const trace = [];

  function recordTrace(action, contractId, detail = "") {
    sequence += 1;
    trace.push(freeze({ seq: sequence, action, contractId, detail: text(detail).slice(0, 160), at: nowIso(now), simulation: true }));
    return sequence;
  }

  function buildContract(input = {}) {
    const type = text(input.type, "yes_no");
    if (!CONTRACT_ATELIER_MARKET_TYPES.includes(type)) throw new TypeError("unknown market type: " + type);
    const role = text(input.role, "house");
    if (!CONTRACT_ATELIER_ROLES.includes(role)) throw new TypeError("unknown creator role: " + role);
    const topic = text(input.topic, "custom");
    if (!CONTRACT_ATELIER_TOPICS.includes(topic)) throw new TypeError("unknown topic: " + topic);
    const houseMode = normalizeHouseMode(input.houseMode ?? "single");
    const feeBps = normalizeFee(input.feeBps);
    const liquidityB = normalizeB(input.liquidityB);
    const houseCapital = Number(input.houseCapital ?? liquidityB * Math.log(2));
    if (!Number.isFinite(houseCapital) || houseCapital < liquidityB * Math.log(2)) {
      throw new TypeError(`house capital must cover the LMSR worst-case subsidy of ${round(liquidityB * Math.log(2))}`);
    }
    counter += 1;
    const id = `ctr:${hashContractAtelierSeed(`${atelierSeed}:${counter}:${input.title}`)}:${String(counter).padStart(4, "0")}`;
    const logic = normalizeContractLogic(input.logic);
    return freeze({
      id,
      key: text(input.key, `contract-${counter}`),
      type: "yes_no",
      role,
      houseMode,
      topic,
      title: boundedTitle(input.title),
      logic,
      logicSummary: describeContractLogic(logic),
      outcomes: FIXED_OUTCOMES,
      feeBps,
      liquidityB,
      houseCapital: round(houseCapital),
      qYes: 0,
      qNo: 0,
      cashCollected: 0,
      feesCollected: 0,
      positions: freeze([]),
      stakes: freeze([]),
      houseContributors: freeze([]),
      status: "open",
      resolution: null,
      createdAt: nowIso(now),
      simulation: true,
      realMoney: false,
      wagering: false,
      settlement: false,
    });
  }

  function createContract(input = {}) {
    const contract = buildContract(input);
    contracts.set(contract.id, contract);
    recordTrace("create", contract.id, `YES/NO · ${contract.houseMode.toUpperCase()} HOUSE · ${contract.title}`);
    return contract;
  }

  function get(contractId) { return contracts.get(text(contractId)) ?? null; }
  function list({ includeResolved = true } = {}) {
    const all = [...contracts.values()];
    return freeze(includeResolved ? all : all.filter((c) => c.status === "open"));
  }

  function replaceContract(contract, patch) {
    const next = freeze({ ...contract, ...patch });
    contracts.set(contract.id, next);
    return next;
  }

  function registerHouse({ contractId, house = "house", capital } = {}) {
    const contract = get(contractId);
    if (!contract) throw new TypeError("unknown contract id");
    if (contract.houseMode !== "single") throw new TypeError("single-house registration requires house mode single");
    if (contract.houseContributors.length) throw new TypeError("house is already registered");
    const provider = bounded(house, 80, "house");
    const amount = Number(capital ?? contract.houseCapital);
    if (!Number.isFinite(amount) || amount < contract.liquidityB * Math.log(2)) throw new TypeError("house capital is below the required LMSR subsidy");
    const contributor = freeze({ id: `house:${hashContractAtelierSeed(provider)}`, provider, capital: round(amount), shares: 1, at: nowIso(now), simulation: true });
    const updated = replaceContract(contract, { houseContributors: freeze([contributor]), houseCapital: round(amount) });
    recordTrace("house-register", contract.id, `${provider} provides ${round(amount)} ${CONTRACT_ATELIER_STAKE_UNIT}`);
    return updated;
  }

  function joinHousePool({ contractId, participant, amount } = {}) {
    const contract = get(contractId);
    if (!contract) throw new TypeError("unknown contract id");
    if (contract.houseMode !== "pool") throw new TypeError("house pool contributions require house mode pool");
    if (contract.status !== "open") throw new TypeError("contract is already resolved");
    const provider = bounded(participant, 80, "pool participant");
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) throw new TypeError("pool contribution must be positive");
    const totalBefore = contract.houseContributors.reduce((sum, entry) => sum + entry.capital, 0);
    const contributorShares = totalBefore > 0 ? value / totalBefore : 1;
    const existing = contract.houseContributors.find((entry) => entry.provider === provider);
    const next = existing
      ? contract.houseContributors.map((entry) => entry.provider === provider
        ? freeze({ ...entry, capital: round(entry.capital + value) })
        : entry)
      : [...contract.houseContributors, freeze({
        id: `pool:${hashContractAtelierSeed(`${contract.id}:${provider}`)}`,
        provider,
        capital: round(value),
        shares: round(contributorShares),
        at: nowIso(now),
        simulation: true,
      })];
    const totalCapital = next.reduce((sum, entry) => sum + entry.capital, 0);
    if (totalCapital < contract.liquidityB * Math.log(2)) throw new TypeError("house pool is below the required LMSR subsidy");
    const normalized = next.map((entry) => freeze({ ...entry, shares: round(entry.capital / totalCapital) }));
    const updated = replaceContract(contract, { houseContributors: freeze(normalized), houseCapital: round(totalCapital) });
    recordTrace("pool-join", contract.id, `${provider} contributes ${round(value)} ${CONTRACT_ATELIER_STAKE_UNIT}`);
    return updated;
  }

  function quotePosition({ contractId, side, shares } = {}) {
    const contract = get(contractId);
    if (!contract) throw new TypeError("unknown contract id");
    if (contract.status !== "open") throw new TypeError("contract is not open");
    if (contract.houseCapital < contract.liquidityB * Math.log(2)) throw new TypeError("house liquidity is underfunded");
    return quoteBinaryTrade({ qYes: contract.qYes, qNo: contract.qNo, side, shares, b: contract.liquidityB, feeBps: contract.feeBps });
  }

  function placeStake({ contractId, side, amount, participant = "player" } = {}) {
    const quote = quotePosition({ contractId, side, shares: amount });
    const contract = get(contractId);
    const actor = bounded(participant, 80, "participant");
    const position = freeze({
      id: `${contract.id}:position-${contract.positions.length + 1}`,
      participant: actor,
      side: quote.side,
      shares: quote.shares,
      cost: quote.totalCost,
      fee: quote.fee,
      at: nowIso(now),
      simulation: true,
    });
    const next = replaceContract(contract, {
      qYes: round(contract.qYes + (quote.side === "YES" ? quote.shares : 0)),
      qNo: round(contract.qNo + (quote.side === "NO" ? quote.shares : 0)),
      cashCollected: round(contract.cashCollected + quote.grossCost),
      feesCollected: round(contract.feesCollected + quote.fee),
      positions: freeze([...contract.positions, position]),
      stakes: freeze([...contract.stakes, freeze({
        id: position.id, side: position.side, amount: position.shares, unit: CONTRACT_ATELIER_STAKE_UNIT,
        participant: actor, cost: position.cost, fee: position.fee, at: position.at, simulation: true,
      })]),
    });
    recordTrace("position", contract.id, `${actor} buys ${quote.shares} ${quote.side} @ ${quote.averagePrice}`);
    return position;
  }

  function sellPosition({ contractId, positionId, shares } = {}) {
    const contract = get(contractId);
    if (!contract) throw new TypeError("unknown contract id");
    if (contract.status !== "open") throw new TypeError("contract is not open");
    const position = contract.positions.find((entry) => entry.id === positionId);
    if (!position) throw new TypeError("unknown position id");
    const quantity = Number(shares);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > position.shares) throw new TypeError("invalid sell quantity");
    const before = lmsrCost(contract.qYes, contract.qNo, contract.liquidityB);
    const after = position.side === "YES"
      ? lmsrCost(contract.qYes - quantity, contract.qNo, contract.liquidityB)
      : lmsrCost(contract.qYes, contract.qNo - quantity, contract.liquidityB);
    const gross = before - after;
    const fee = gross * contract.feeBps / 10000;
    const proceeds = cents(gross - fee);
    const remaining = round(position.shares - quantity);
    const positions = remaining > 0
      ? contract.positions.map((entry) => entry.id === position.id ? freeze({ ...entry, shares: remaining }) : entry)
      : contract.positions.filter((entry) => entry.id !== position.id);
    const updated = replaceContract(contract, {
      qYes: round(contract.qYes - (position.side === "YES" ? quantity : 0)),
      qNo: round(contract.qNo - (position.side === "NO" ? quantity : 0)),
      cashCollected: round(contract.cashCollected - gross),
      feesCollected: round(contract.feesCollected + fee),
      positions: freeze(positions),
    });
    recordTrace("sell", contract.id, `${position.participant} sells ${quantity} ${position.side} for ${proceeds}`);
    return freeze({ positionId, side: position.side, shares: round(quantity), grossProceeds: cents(gross), fee: cents(fee), proceeds, unit: CONTRACT_ATELIER_STAKE_UNIT, simulation: true, market: updated });
  }

  function resolveContract({ contractId, facts = {} } = {}) {
    const contract = get(contractId);
    if (!contract) throw new TypeError("unknown contract id");
    if (contract.status !== "open") throw new TypeError("contract is already resolved");
    const yesWins = evaluateContractLogic(contract.logic, facts);
    const winningSide = yesWins ? "YES" : "NO";
    const winningShares = contract.positions
      .filter((position) => position.side === winningSide)
      .reduce((sum, position) => sum + position.shares, 0);
    const payout = cents(winningShares);
    const grossHousePnl = cents(contract.cashCollected + contract.feesCollected - payout);
    const contributors = contract.houseContributors.length
      ? contract.houseContributors.map((entry) => freeze({
        provider: entry.provider,
        share: entry.shares,
        pnl: cents(grossHousePnl * entry.shares),
        payout: cents((contract.houseCapital + grossHousePnl) * entry.shares),
      }))
      : [];
    const payouts = freeze(contract.positions.filter((position) => position.side === winningSide).map((position) => freeze({
      positionId: position.id,
      participant: position.participant,
      side: winningSide,
      shares: position.shares,
      amount: cents(position.shares),
      unit: CONTRACT_ATELIER_STAKE_UNIT,
      simulation: true,
    })));
    const resolution = freeze({
      winningSide,
      facts: freeze({ ...(facts && typeof facts === "object" ? facts : {}) }),
      winningShares: round(winningShares),
      payout,
      grossHousePnl,
      feeCollected: cents(contract.feesCollected),
      houseCapital: cents(contract.houseCapital),
      houseContributors: freeze(contributors),
      payouts,
      at: nowIso(now),
      simulation: true,
      note: "Rehearsal resolution. YES pays one unit per winning share; NO pays zero, and vice versa. House fees and pool accounting are simulated.",
    });
    const resolved = replaceContract(contract, { status: "resolved", resolution });
    recordTrace("resolve", contract.id, `winner: ${winningSide} · house P&L ${grossHousePnl}`);
    return resolved;
  }

  function totalStaked(contract) {
    return contract.positions.reduce((sum, position) => sum + position.shares, 0);
  }

  function reset() {
    contracts.clear();
    trace.length = 0;
    counter = 0;
    sequence = 0;
    CONTRACT_ATELIER_STARTER_CONTRACTS.forEach((starter) => contracts.set(starter.key, buildContract(starter)));
    // Starter IDs are intentionally regenerated by seed; expose them in the same
    // deterministic order as a freshly created atelier.
    const starterContracts = CONTRACT_ATELIER_STARTER_CONTRACTS.map(buildContract);
    contracts.clear();
    starterContracts.forEach((contract) => contracts.set(contract.id, contract));
    recordTrace("reset", "atelier", "starter set restored");
    return getSnapshot();
  }

  function getSnapshot() {
    const all = list();
    return freeze({
      schemaVersion: CONTRACT_ATELIER_SCHEMA_VERSION,
      source: CONTRACT_ATELIER_SOURCE,
      seed: atelierSeed,
      simulation: true,
      localOnly: true,
      open: all.filter((c) => c.status === "open").length,
      resolved: all.filter((c) => c.status === "resolved").length,
      contracts: all.map((c) => freeze({
        id: c.id, title: c.title, type: c.type, role: c.role, houseMode: c.houseMode, topic: c.topic,
        status: c.status, outcomes: c.outcomes, yesPrice: lmsrPrices(c.qYes, c.qNo, c.liquidityB).YES,
        noPrice: lmsrPrices(c.qYes, c.qNo, c.liquidityB).NO, liquidityB: c.liquidityB,
        houseCapital: c.houseCapital, feeBps: c.feeBps, totalStaked: round(totalStaked(c)),
        positionCount: c.positions.length, houseContributorCount: c.houseContributors.length,
      })),
      trace: freeze([...trace].slice(-32)),
      boundary: CONTRACT_ATELIER_BOUNDARY,
      stakeUnit: CONTRACT_ATELIER_STAKE_UNIT,
      realMoney: false, wagering: false, wallet: false, chain: false, custody: false, settlement: false,
      externalPublication: false,
    });
  }

  function createContribution() {
    const all = list();
    return freeze({
      schemaVersion: CONTRACT_ATELIER_SCHEMA_VERSION,
      source: CONTRACT_ATELIER_SOURCE,
      updatedAt: CONTRACT_ATELIER_UPDATED_AT,
      simulation: true,
      entities: all.map((c) => ({
        id: c.id, kind: "contract-market", label: c.title, marketType: "yes_no",
        role: c.role, houseMode: c.houseMode, topic: c.topic, status: c.status, simulation: true,
      })),
      evidence: [{ id: "contract-atelier:local-contracts", kind: "simulated-contract-log", contractIds: all.map((c) => c.id), status: "local" }],
      capabilities: [
        { id: "contract-atelier.yes-no", mode: "local-rehearsal", authority: "none", executable: false },
        { id: "contract-atelier.house", mode: "local-rehearsal", authority: "none", executable: false },
        { id: "contract-atelier.house-pool", mode: "local-rehearsal", authority: "none", executable: false },
      ],
      boundary: CONTRACT_ATELIER_BOUNDARY,
    });
  }

  CONTRACT_ATELIER_STARTER_CONTRACTS.forEach((starter) => {
    const contract = buildContract(starter);
    contracts.set(contract.id, contract);
  });

  return freeze({
    createContract, get, list, registerHouse, joinHousePool, quotePosition, placeStake, sellPosition,
    resolveContract, reset, getSnapshot, createContribution, source: CONTRACT_ATELIER_SOURCE, boundary: CONTRACT_ATELIER_BOUNDARY,
  });
}

export function createContractAtelierContribution({ seed = "local-contracts", updatedAt = CONTRACT_ATELIER_UPDATED_AT } = {}) {
  const atelier = createContractAtelier({ seed });
  return freeze({ ...atelier.createContribution(), updatedAt });
}

export default createContractAtelier;
