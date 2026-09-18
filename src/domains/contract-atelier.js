/**
 * Fictional local Contract Atelier for the Living Reality demo.
 *
 * Anyone can open a contract here: a pool, a normal binary (yes/no), or a
 * multi-outcome market, on any imaginable topic (sports, politics, weather,
 * transport, custom). The opener chooses any position: HOUSE (the
 * counterparty that sets the terms) or PLAYER (takes a yes/no side like
 * everyone else). Contracts resolve through a small logic constructor:
 * TRUE/FALSE on one condition, AND, OR, or IF/ELSE branches.
 *
 * Everything is a page-session rehearsal. Stakes are fictional "rehearsal
 * credits" with zero real value. There is no wallet, no chain, no custody,
 * no settlement, no wagering, no real money, and no external publication.
 * IDs are deterministic so the same seed always rebuilds the same atelier;
 * nothing here is an ownership, payout, or value claim.
 */

export const CONTRACT_ATELIER_SCHEMA_VERSION = 1;
export const CONTRACT_ATELIER_SOURCE = "contract-atelier";
export const CONTRACT_ATELIER_CONSOLE_SOURCE = "contract-atelier-console";
export const CONTRACT_ATELIER_UPDATED_AT = "2026-09-18T00:00:00.000Z";
export const CONTRACT_ATELIER_MAX_TITLE_LENGTH = 64;
export const CONTRACT_ATELIER_MAX_PROPOSITION_LENGTH = 200;
export const CONTRACT_ATELIER_MAX_OUTCOMES = 6;
export const CONTRACT_ATELIER_MAX_STAKE = 10000;
export const CONTRACT_ATELIER_STAKE_UNIT = "rehearsal credits";

export const CONTRACT_ATELIER_MARKET_TYPES = Object.freeze(["binary", "pool", "multi"]);
export const CONTRACT_ATELIER_ROLES = Object.freeze(["house", "player"]);
export const CONTRACT_ATELIER_TOPICS = Object.freeze(["sports", "politics", "weather", "transport", "custom"]);
export const CONTRACT_ATELIER_LOGIC_KINDS = Object.freeze(["condition", "and", "or", "if_else"]);

export const CONTRACT_ATELIER_BOUNDARY =
  "Contract Atelier is a fictional local rehearsal. Anyone may open a pool, binary, or multi-outcome contract as house or player and stake rehearsal credits, but every stake is simulated: no wallet, no chain, no custody, no settlement, no wagering, and no real money exists here. Resolutions are rehearsal outcomes only; nothing staked has value outside this page session.";

/** Fictional unit label carried on every stake so no real-money reading is possible. */
export const CONTRACT_ATELIER_NO_VALUE = "Stakes are rehearsal credits with zero real value.";

const freeze = (value) => {
  if (Array.isArray(value)) value.forEach(freeze);
  else if (value && typeof value === "object") Object.values(value).forEach(freeze);
  return value && typeof value === "object" ? Object.freeze(value) : value;
};

function safeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

/** Deterministic FNV-1a hash; keeps contract IDs stable per seed. */
export function hashContractAtelierSeed(value) {
  const text = safeText(value, "contract-atelier");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function nowIso(now) {
  try {
    const value = typeof now === "function" ? now() : now;
    // null/undefined/"" mean "no injected clock": use the wall clock.
    // (new Date(null) would silently become the 1970 epoch.)
    if (value === null || value === undefined || value === "") {
      return new Date().toISOString();
    }
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  } catch {
    // Fall through to the wall clock; tests inject `now`.
  }
  return new Date().toISOString();
}

function boundedTitle(title) {
  const normalized = safeText(title).trim().replace(/\s+/g, " ").slice(0, CONTRACT_ATELIER_MAX_TITLE_LENGTH);
  if (!normalized) throw new TypeError("contract title must be a non-empty string");
  return normalized;
}

function boundedProposition(proposition) {
  const normalized = safeText(proposition).trim().replace(/\s+/g, " ").slice(0, CONTRACT_ATELIER_MAX_PROPOSITION_LENGTH);
  if (!normalized) throw new TypeError("logic proposition must be a non-empty string");
  return normalized;
}

/**
 * Normalize a logic constructor into a frozen canonical node.
 * Accepts a shorthand string ("rain tomorrow") as {kind:"condition"}.
 * Nodes: {kind:"condition",proposition} | {kind:"and"|"or",conditions[]}
 *      | {kind:"if_else",if,then,else}
 */
export function normalizeContractLogic(logic) {
  if (typeof logic === "string") {
    return freeze({ kind: "condition", proposition: boundedProposition(logic) });
  }
  if (!logic || typeof logic !== "object" || Array.isArray(logic)) {
    throw new TypeError("contract logic must be a proposition string or a logic node");
  }
  const kind = safeText(logic.kind);
  if (!CONTRACT_ATELIER_LOGIC_KINDS.includes(kind)) {
    throw new TypeError(`unknown logic kind: ${kind || "(missing)"}`);
  }
  if (kind === "condition") {
    return freeze({ kind, proposition: boundedProposition(logic.proposition) });
  }
  if (kind === "and" || kind === "or") {
    const conditions = Array.isArray(logic.conditions) ? logic.conditions : [];
    if (conditions.length < 2) throw new TypeError(`${kind} logic needs at least two conditions`);
    if (conditions.length > 8) throw new TypeError(`${kind} logic accepts at most eight conditions`);
    return freeze({ kind, conditions: freeze(conditions.map((entry) => normalizeContractLogic(entry))) });
  }
  // if_else
  return freeze({
    kind,
    if: normalizeContractLogic(logic.if),
    then: normalizeContractLogic(logic.then),
    else: normalizeContractLogic(logic.else),
  });
}

/** Human-readable summary of a normalized logic node (fictional display only). */
export function describeContractLogic(node) {
  if (!node || typeof node !== "object") return "—";
  if (node.kind === "condition") return `IF “${node.proposition}” IS TRUE`;
  if (node.kind === "and" || node.kind === "or") {
    const joiner = node.kind === "and" ? " AND " : " OR ";
    return `(${node.conditions.map(describeContractLogic).join(joiner)})`;
  }
  if (node.kind === "if_else") {
    return `IF ${describeContractLogic(node.if)} THEN ${describeContractLogic(node.then)} ELSE ${describeContractLogic(node.else)}`;
  }
  return "—";
}

/**
 * Evaluate a normalized logic node against a facts map
 * ({ "proposition text": boolean }). Missing facts read as false.
 */
export function evaluateContractLogic(node, facts = {}) {
  const source = facts && typeof facts === "object" ? facts : {};
  const read = (proposition) => source[proposition] === true;
  const visit = (entry) => {
    if (!entry || typeof entry !== "object") return false;
    if (entry.kind === "condition") return read(entry.proposition);
    if (entry.kind === "and") return entry.conditions.every(visit);
    if (entry.kind === "or") return entry.conditions.some(visit);
    if (entry.kind === "if_else") return visit(entry.if) ? visit(entry.then) : visit(entry.else);
    return false;
  };
  return visit(node);
}

function normalizeOutcomes(type, outcomes) {
  if (outcomes === null || outcomes === undefined) {
    if (type === "binary") return ["YES", "NO"];
    throw new TypeError(`${type} contracts need an explicit outcomes list`);
  }
  if (!Array.isArray(outcomes)) throw new TypeError("outcomes must be an array of labels");
  const labels = outcomes
    .map((entry) => safeText(entry).trim().replace(/\s+/g, " ").slice(0, 32))
    .filter((label) => label.length > 0);
  const unique = [...new Set(labels)];
  if (type === "binary" || type === "pool") {
    if (unique.length !== 2) throw new TypeError(`${type} contracts need exactly two distinct outcomes`);
  } else if (type === "multi") {
    if (unique.length < 2 || unique.length > CONTRACT_ATELIER_MAX_OUTCOMES) {
      throw new TypeError(`multi contracts need 2–${CONTRACT_ATELIER_MAX_OUTCOMES} distinct outcomes`);
    }
  }
  return freeze(unique);
}

export const CONTRACT_ATELIER_STARTER_CONTRACTS = freeze([
  {
    key: "derby-day",
    type: "binary",
    role: "house",
    topic: "sports",
    title: "Derby day: the home side wins",
    logic: "the home side wins the derby",
    outcomes: ["YES", "NO"],
  },
  {
    key: "afternoon-rain-pool",
    type: "pool",
    role: "player",
    topic: "weather",
    title: "Afternoon rain pool",
    logic: { kind: "or", conditions: ["rain before 15:00", "rain after 15:00"] },
    outcomes: ["RAIN", "DRY"],
  },
  {
    key: "which-motion-carries",
    type: "multi",
    role: "house",
    topic: "politics",
    title: "Which motion carries the council vote?",
    logic: { kind: "and", conditions: ["quorum met", "vote concluded"] },
    outcomes: ["Motion A", "Motion B", "Neither"],
  },
]);

/**
 * Create a fictional contract atelier. `seed` rebuilds the same starter set;
 * `now` is injectable for deterministic tests.
 */
export function createContractAtelier({ seed = "local-contracts", now = null } = {}) {
  const atelierSeed = safeText(seed) || "local-contracts";
  let counter = 0;
  const contracts = new Map();
  const trace = [];
  let sequence = 0;

  function recordTrace(action, contractId, detail = "") {
    sequence += 1;
    trace.push(freeze({
      seq: sequence,
      action,
      contractId,
      detail: safeText(detail).slice(0, 120),
      at: nowIso(now),
      simulation: true,
    }));
    return sequence;
  }

  function buildContract({ key, type, role, topic, title, logic, outcomes }) {
    const marketType = safeText(type);
    if (!CONTRACT_ATELIER_MARKET_TYPES.includes(marketType)) {
      throw new TypeError(`unknown market type: ${marketType || "(missing)"}`);
    }
    const creatorRole = safeText(role);
    if (!CONTRACT_ATELIER_ROLES.includes(creatorRole)) {
      throw new TypeError(`unknown creator role: ${creatorRole || "(missing)"}`);
    }
    const contractTopic = safeText(topic);
    if (!CONTRACT_ATELIER_TOPICS.includes(contractTopic)) {
      throw new TypeError(`unknown topic: ${contractTopic || "(missing)"}`);
    }
    counter += 1;
    const tokenHash = hashContractAtelierSeed(`${atelierSeed}:${counter}:${title}`);
    const id = `ctr:${tokenHash.slice(0, 8)}:${String(counter).padStart(4, "0")}`;
    const normalizedLogic = normalizeContractLogic(logic);
    return freeze({
      id,
      key: safeText(key) || `contract-${counter}`,
      type: marketType,
      role: creatorRole,
      topic: contractTopic,
      title: boundedTitle(title),
      logic: normalizedLogic,
      logicSummary: describeContractLogic(normalizedLogic),
      outcomes: normalizeOutcomes(marketType, outcomes),
      stakes: freeze([]),
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
    recordTrace("create", contract.id, `${contract.type.toUpperCase()} · ${contract.role.toUpperCase()} · ${contract.title}`);
    return contract;
  }

  function get(contractId) {
    return contracts.get(safeText(contractId)) ?? null;
  }

  function list({ includeResolved = true } = {}) {
    const all = [...contracts.values()];
    return freeze(includeResolved ? all : all.filter((contract) => contract.status === "open"));
  }

  function placeStake({ contractId, side, amount } = {}) {
    const contract = get(contractId);
    if (!contract) throw new TypeError("unknown contract id");
    if (contract.status !== "open") throw new TypeError("contract is already resolved; stakes are closed");
    const chosen = safeText(side);
    if (!contract.outcomes.includes(chosen)) {
      throw new TypeError(`side must be one of: ${contract.outcomes.join(", ")}`);
    }
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) throw new TypeError("stake amount must be a positive number");
    if (value > CONTRACT_ATELIER_MAX_STAKE) throw new TypeError(`stake amount may not exceed ${CONTRACT_ATELIER_MAX_STAKE}`);
    const stake = freeze({
      id: `${contract.id}:stake-${contract.stakes.length + 1}`,
      side: chosen,
      amount: Math.round(value * 100) / 100,
      unit: CONTRACT_ATELIER_STAKE_UNIT,
      at: nowIso(now),
      simulation: true,
    });
    const updated = freeze({ ...contract, stakes: freeze([...contract.stakes, stake]) });
    contracts.set(contract.id, updated);
    recordTrace("stake", contract.id, `${stake.amount} ${CONTRACT_ATELIER_STAKE_UNIT} on ${stake.side}`);
    return stake;
  }

  function totalStaked(contract) {
    return contract.stakes.reduce((sum, stake) => sum + stake.amount, 0);
  }

  /**
   * Resolve a contract against rehearsal facts. `facts` maps proposition text
   * to booleans; for multi contracts `winner` names the winning outcome.
   * Binary and pool: logic true → outcomes[0], false → outcomes[1] (a binary
   * with custom outcomes maps to its own outcomes[0]/outcomes[1] labels, not
   * to YES/NO). Multi: winner must be a listed outcome and the logic must
   * hold (the event concluded).
   */
  function resolveContract({ contractId, facts = {}, winner = null } = {}) {
    const contract = get(contractId);
    if (!contract) throw new TypeError("unknown contract id");
    if (contract.status !== "open") throw new TypeError("contract is already resolved");
    const outcome = evaluateContractLogic(contract.logic, facts);
    let winningSide;
    if (contract.type === "binary") {
      winningSide = outcome ? contract.outcomes[0] : contract.outcomes[1];
    } else if (contract.type === "pool") {
      winningSide = outcome ? contract.outcomes[0] : contract.outcomes[1];
    } else {
      const named = safeText(winner);
      if (!contract.outcomes.includes(named)) {
        throw new TypeError(`winner must be one of: ${contract.outcomes.join(", ")}`);
      }
      if (!outcome) throw new TypeError("multi contracts resolve only when the logic conditions hold");
      winningSide = named;
    }
    const total = totalStaked(contract);
    const winningStakes = contract.stakes.filter((stake) => stake.side === winningSide);
    const winningTotal = winningStakes.reduce((sum, stake) => sum + stake.amount, 0);
    let payouts;
    if (contract.type === "binary") {
      // Fictional double-or-nothing paid by the rehearsal house; no real funds move.
      payouts = freeze(winningStakes.map((stake) => freeze({
        stakeId: stake.id,
        side: stake.side,
        amount: Math.round(stake.amount * 2 * 100) / 100,
        unit: CONTRACT_ATELIER_STAKE_UNIT,
        simulation: true,
      })));
    } else {
      // Parimutuel rehearsal: the pool splits pro-rata among winning stakes.
      let remainder = Math.round(total * 100);
      payouts = freeze(winningStakes.map((stake, index) => {
        let share;
        if (winningTotal <= 0) {
          share = 0;
        } else if (index === winningStakes.length - 1) {
          share = remainder;
        } else {
          share = Math.floor((stake.amount / winningTotal) * total * 100);
        }
        remainder -= share;
        return freeze({
          stakeId: stake.id,
          side: stake.side,
          amount: share / 100,
          unit: CONTRACT_ATELIER_STAKE_UNIT,
          simulation: true,
        });
      }));
    }
    const resolution = freeze({
      winningSide,
      facts: freeze({ ...(facts && typeof facts === "object" ? facts : {}) }),
      totalStaked: Math.round(total * 100) / 100,
      payouts,
      at: nowIso(now),
      simulation: true,
      note: "Rehearsal resolution. No real payout, settlement, or value transfer occurs.",
    });
    const resolved = freeze({ ...contract, status: "resolved", resolution });
    contracts.set(contract.id, resolved);
    recordTrace("resolve", contract.id, `winner: ${winningSide} · ${payouts.length} payout row(s)`);
    return resolved;
  }

  function reset() {
    contracts.clear();
    trace.length = 0;
    counter = 0;
    sequence = 0;
    CONTRACT_ATELIER_STARTER_CONTRACTS.forEach((starter) => {
      const contract = buildContract(starter);
      contracts.set(contract.id, contract);
    });
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
      open: all.filter((contract) => contract.status === "open").length,
      resolved: all.filter((contract) => contract.status === "resolved").length,
      contracts: all.map((contract) => freeze({
        id: contract.id,
        title: contract.title,
        type: contract.type,
        role: contract.role,
        topic: contract.topic,
        status: contract.status,
        outcomes: contract.outcomes,
        totalStaked: Math.round(totalStaked(contract) * 100) / 100,
        stakeCount: contract.stakes.length,
      })),
      trace: freeze([...trace].slice(-24)),
      boundary: CONTRACT_ATELIER_BOUNDARY,
      stakeUnit: CONTRACT_ATELIER_STAKE_UNIT,
      realMoney: false,
      wagering: false,
      wallet: false,
      chain: false,
      custody: false,
      settlement: false,
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
      entities: all.map((contract) => ({
        id: contract.id,
        kind: "contract-market",
        label: contract.title,
        marketType: contract.type,
        role: contract.role,
        topic: contract.topic,
        status: contract.status,
        simulation: true,
      })),
      evidence: [{
        id: "contract-atelier:local-contracts",
        kind: "simulated-contract-log",
        contractIds: all.map((contract) => contract.id),
        status: "local",
      }],
      capabilities: [{ id: "contract-atelier.stake", mode: "local-rehearsal", authority: "none", executable: false }],
      boundary: CONTRACT_ATELIER_BOUNDARY,
    });
  }

  // Seed the starter set so the atelier is never empty on first open.
  CONTRACT_ATELIER_STARTER_CONTRACTS.forEach((starter) => {
    const contract = buildContract(starter);
    contracts.set(contract.id, contract);
  });

  return freeze({
    createContract,
    get,
    list,
    placeStake,
    resolveContract,
    reset,
    getSnapshot,
    createContribution,
    source: CONTRACT_ATELIER_SOURCE,
    boundary: CONTRACT_ATELIER_BOUNDARY,
  });
}

export function createContractAtelierContribution({ seed = "local-contracts", updatedAt = CONTRACT_ATELIER_UPDATED_AT } = {}) {
  const atelier = createContractAtelier({ seed });
  const contribution = atelier.createContribution();
  return freeze({ ...contribution, updatedAt });
}

export default createContractAtelier;
