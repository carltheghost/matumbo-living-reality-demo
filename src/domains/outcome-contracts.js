/**
 * Outcome contracts with eternal escrow — fictional local rehearsal.
 *
 * The law Tumbo set: you place a contract on an event and walk away. Go live
 * your reality, go offline, it does not matter. When the event lands, the
 * contract GRADES it deterministically: winners get paid, losers' stakes are
 * taken — nobody needs to be watching. A win is claimable FOREVER: log in
 * ten years later and the exact same amount is still yours. The award can
 * ride around as a local simulated NFT, but the value stays with the holder.
 *
 * Everything here is a page-session rehearsal. Stakes and awards are
 * simulated TUMBO points with zero real value. There is no wallet, no chain,
 * no custody, no settlement, no wagering, and no real money. IDs are
 * deterministic so the same seed always rebuilds the same set; nothing here
 * is an ownership, payout, or value claim.
 */

export const OUTCOME_CONTRACTS_SCHEMA_VERSION = 1;
export const OUTCOME_CONTRACTS_SOURCE = "outcome-contracts";
export const OUTCOME_CONTRACTS_CONSOLE_SOURCE = "outcome-contracts-console";
export const OUTCOME_CONTRACTS_UPDATED_AT = "2026-09-18T00:00:00.000Z";
export const OUTCOME_STAKE_UNIT = "simulated TUMBO points";
export const OUTCOME_CONTRACTS_MAX_OUTCOMES = 6;
export const OUTCOME_CONTRACTS_MAX_STAKE = 10000;
export const OUTCOME_CONTRACTS_MAX_LABEL_LENGTH = 48;
export const OUTCOME_CONTRACTS_MAX_PARTICIPANT_LENGTH = 40;
export const OUTCOME_RESULT_DRAW = "DRAW";
export const OUTCOME_RESULT_VOID = "VOID";

export const OUTCOME_CONTRACTS_BOUNDARY =
  "Outcome contracts are a fictional local rehearsal. Stakes and awards are simulated TUMBO points with zero real value: no wallet, no chain, no custody, no settlement, no wagering, no real money. Grading is deterministic local logic — winners and losers are computed from the recorded result with no human in the loop and no one required to be online. Escrow claims never expire and never decay: the exact awarded amount is claimable forever.";

/** Fictional unit label carried on every stake, award, and claim. */
export const OUTCOME_CONTRACTS_NO_VALUE = "Stakes and awards are simulated TUMBO points with zero real value.";

const freeze = (value) => {
  if (Array.isArray(value)) value.forEach(freeze);
  else if (value && typeof value === "object") Object.values(value).forEach(freeze);
  return value && typeof value === "object" ? Object.freeze(value) : value;
};

function safeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

/** Deterministic FNV-1a hash; keeps IDs stable per seed. */
export function hashOutcomeSeed(value) {
  const text = safeText(value, "outcome-contracts");
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

function boundedLabel(value, name, max = OUTCOME_CONTRACTS_MAX_LABEL_LENGTH) {
  const normalized = safeText(value).trim().replace(/\s+/g, " ").slice(0, max);
  if (!normalized) throw new TypeError(`${name} must be a non-empty string`);
  return normalized;
}

function boundedParticipant(value) {
  return boundedLabel(value, "participant name", OUTCOME_CONTRACTS_MAX_PARTICIPANT_LENGTH);
}

function normalizeOutcomes(outcomes) {
  if (!Array.isArray(outcomes)) throw new TypeError("outcomes must be an array of labels");
  const labels = outcomes
    .map((entry) => safeText(entry).trim().replace(/\s+/g, " ").slice(0, 32).toUpperCase())
    .filter((label) => label.length > 0 && label !== OUTCOME_RESULT_DRAW && label !== OUTCOME_RESULT_VOID);
  const unique = [...new Set(labels)];
  if (unique.length < 2 || unique.length > OUTCOME_CONTRACTS_MAX_OUTCOMES) {
    throw new TypeError(`contracts need 2–${OUTCOME_CONTRACTS_MAX_OUTCOMES} distinct outcomes (DRAW and VOID are reserved)`);
  }
  return freeze(unique);
}

function normalizeAmount(amount) {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new TypeError("stake amount must be a positive number");
  if (value > OUTCOME_CONTRACTS_MAX_STAKE) throw new TypeError(`stake amount may not exceed ${OUTCOME_CONTRACTS_MAX_STAKE}`);
  return Math.round(value * 100) / 100;
}

/**
 * Split a pool (in cents) pro-rata across winning stakes with exact
 * conservation: every share is floored and the leftover cents go to the
 * last winner, so the shares always sum to the pool.
 */
function splitPoolCents(winningStakes, poolCents) {
  const winningCents = winningStakes.reduce((sum, stake) => sum + Math.round(stake.amount * 100), 0);
  if (winningCents <= 0 || poolCents <= 0) return winningStakes.map(() => 0);
  let remainder = poolCents;
  return winningStakes.map((stake, index) => {
    if (index === winningStakes.length - 1) return remainder;
    const share = Math.floor((Math.round(stake.amount * 100) / winningCents) * poolCents);
    remainder -= share;
    return share;
  });
}

/**
 * Create an outcome-contracts desk. `seed` rebuilds the same starter set;
 * `now` is injectable for deterministic tests (including the 10-year
 * time-travel claim test).
 */
export function createOutcomeContracts({ seed = "local-outcomes", now = null } = {}) {
  const deskSeed = safeText(seed) || "local-outcomes";
  let counter = 0;
  let escrowCounter = 0;
  let nftCounter = 0;
  const contracts = new Map();
  const escrows = new Map();
  const nfts = new Map();
  const trace = [];
  let sequence = 0;

  function recordTrace(action, refId, detail = "") {
    sequence += 1;
    trace.push(freeze({
      seq: sequence,
      action,
      refId,
      detail: safeText(detail).slice(0, 140),
      at: nowIso(now),
      simulation: true,
    }));
    return sequence;
  }

  function nextId(prefix) {
    counter += 1;
    const tokenHash = hashOutcomeSeed(`${deskSeed}:${prefix}:${counter}`);
    return `${prefix}:${tokenHash.slice(0, 8)}:${String(counter).padStart(4, "0")}`;
  }

  function escrowFor({ contractId, participant, amount, kind }) {
    escrowCounter += 1;
    const tokenHash = hashOutcomeSeed(`${deskSeed}:esc:${escrowCounter}:${contractId}:${participant}`);
    const id = `esc:${tokenHash.slice(0, 8)}:${String(escrowCounter).padStart(4, "0")}`;
    const record = freeze({
      id,
      contractId,
      participant,
      amount: Math.round(amount * 100) / 100,
      unit: OUTCOME_STAKE_UNIT,
      kind,
      createdAt: nowIso(now),
      // The eternal part: there is no expiry. Null means "claimable forever".
      expiresAt: null,
      claimedAt: null,
      simulation: true,
      realMoney: false,
    });
    escrows.set(id, record);
    return record;
  }

  function mintAwardNft({ escrow }) {
    nftCounter += 1;
    const tokenHash = hashOutcomeSeed(`${deskSeed}:award-nft:${nftCounter}:${escrow.id}`);
    const id = `award-nft:${tokenHash.slice(0, 8)}:${String(nftCounter).padStart(4, "0")}`;
    const nft = freeze({
      id,
      escrowId: escrow.id,
      contractId: escrow.contractId,
      amount: escrow.amount,
      unit: OUTCOME_STAKE_UNIT,
      holder: escrow.participant,
      kind: escrow.kind,
      claimed: false,
      claimedAt: null,
      transfers: freeze([]),
      mintedAt: nowIso(now),
      simulation: true,
      valuable: false,
      // The award may "go around" locally: transfer moves the claim to the
      // new holder. Local only — no chain, no sale, no custody.
      localTransferOnly: true,
    });
    nfts.set(id, nft);
    return nft;
  }

  function createContract({ eventId, eventLabel, outcomes, creator } = {}) {
    const contract = freeze({
      id: nextId("oct"),
      eventId: boundedLabel(eventId, "event id", 64),
      eventLabel: boundedLabel(eventLabel, "event label", 96),
      outcomes: normalizeOutcomes(outcomes),
      creator: boundedParticipant(creator),
      stakes: freeze([]),
      status: "open",
      result: null,
      grading: null,
      createdAt: nowIso(now),
      simulation: true,
      realMoney: false,
      wagering: false,
      settlement: false,
    });
    contracts.set(contract.id, contract);
    recordTrace("create", contract.id, `${contract.eventLabel} · ${contract.outcomes.join(" / ")}`);
    return contract;
  }

  function get(contractId) {
    return contracts.get(safeText(contractId)) ?? null;
  }

  function list({ includeGraded = true } = {}) {
    const all = [...contracts.values()];
    return freeze(includeGraded ? all : all.filter((contract) => contract.status === "open"));
  }

  /**
   * Join a contract with simulated TUMBO points. The participant may walk
   * away immediately after — the contract does not care who is online.
   */
  function join({ contractId, participant, outcome, stakeAmount } = {}) {
    const contract = get(contractId);
    if (!contract) throw new TypeError("unknown outcome contract id");
    if (contract.status !== "open") throw new TypeError("contract is graded; joining is closed");
    const chosen = safeText(outcome).trim().toUpperCase();
    if (!contract.outcomes.includes(chosen)) {
      throw new TypeError(`outcome must be one of: ${contract.outcomes.join(", ")}`);
    }
    const stake = freeze({
      id: `${contract.id}:stake-${contract.stakes.length + 1}`,
      participant: boundedParticipant(participant),
      outcome: chosen,
      amount: normalizeAmount(stakeAmount),
      unit: OUTCOME_STAKE_UNIT,
      at: nowIso(now),
      simulation: true,
    });
    const updated = freeze({ ...contract, stakes: freeze([...contract.stakes, stake]) });
    contracts.set(contract.id, updated);
    recordTrace("join", contract.id, `${stake.participant} · ${stake.amount} ${OUTCOME_STAKE_UNIT} on ${stake.outcome}`);
    return stake;
  }

  /**
   * The event lands: record its result and GRADE the contract in the same
   * deterministic step. No human in the loop, no one needs to be online.
   * `result` is a listed outcome, DRAW, or VOID.
   */
  function recordResult({ contractId, result } = {}) {
    const contract = get(contractId);
    if (!contract) throw new TypeError("unknown outcome contract id");
    if (contract.status !== "open") throw new TypeError("contract is already graded");
    const landed = safeText(result).trim().toUpperCase();
    const valid = [...contract.outcomes, OUTCOME_RESULT_DRAW, OUTCOME_RESULT_VOID];
    if (!valid.includes(landed)) {
      throw new TypeError(`result must be one of: ${valid.join(", ")}`);
    }

    const totalCents = contract.stakes.reduce((sum, stake) => sum + Math.round(stake.amount * 100), 0);
    const total = totalCents / 100;
    let kind;
    let winningOutcome = null;
    let awards = [];

    if (landed === OUTCOME_RESULT_DRAW || landed === OUTCOME_RESULT_VOID) {
      // Draw or void: every stake is refunded in full into eternal escrow.
      kind = "refund";
      awards = contract.stakes.map((stake) => ({ stakeId: stake.id, participant: stake.participant, amount: stake.amount }));
    } else {
      const winningStakes = contract.stakes.filter((stake) => stake.outcome === landed);
      if (winningStakes.length === 0) {
        // Nobody picked the landed outcome: the pool returns to everyone.
        kind = "refund";
        awards = contract.stakes.map((stake) => ({ stakeId: stake.id, participant: stake.participant, amount: stake.amount }));
      } else {
        // Winners take the whole pool pro-rata: their own stake back plus
        // their share of the losers' stakes, which are collected ("taken").
        kind = "award";
        winningOutcome = landed;
        const shares = splitPoolCents(winningStakes, totalCents);
        awards = winningStakes.map((stake, index) => ({
          stakeId: stake.id,
          participant: stake.participant,
          amount: shares[index] / 100,
        }));
      }
    }

    // Eternal escrow: every award/refund is locked to its participant with
    // expiresAt: null — claimable forever, never decaying.
    const escrowIds = [];
    const nftIds = [];
    for (const award of awards) {
      const escrow = escrowFor({ contractId: contract.id, participant: award.participant, amount: award.amount, kind });
      const nft = mintAwardNft({ escrow });
      const linked = freeze({ ...escrow, nftId: nft.id });
      escrows.set(linked.id, linked);
      escrowIds.push(linked.id);
      nftIds.push(nft.id);
    }

    const grading = freeze({
      result: landed,
      kind,
      winningOutcome,
      totalPool: total,
      unit: OUTCOME_STAKE_UNIT,
      awards: freeze(awards.map((award) => freeze({ ...award }))),
      escrowIds: freeze(escrowIds),
      nftIds: freeze(nftIds),
      gradedAt: nowIso(now),
      deterministic: true,
      simulation: true,
      note: kind === "award"
        ? "Winners take the pool. Losers' stakes were collected. Claim the exact awarded amount whenever — it never expires."
        : "No winner took the pool. Every stake was refunded in full into eternal escrow.",
    });
    const graded = freeze({
      ...contract,
      status: "graded",
      result: freeze({ outcome: landed, at: nowIso(now) }),
      grading,
    });
    contracts.set(contract.id, graded);
    recordTrace("grade", contract.id, `${landed} · ${kind.toUpperCase()} · ${escrowIds.length} escrowed`);
    return graded;
  }

  function getNft(nftId) {
    return nfts.get(safeText(nftId)) ?? null;
  }

  /**
   * The award rides around: transfer the NFT locally and the claim follows
   * the new holder. Claimed awards cannot move — they are spent.
   */
  function transferAward({ nftId, toHolder } = {}) {
    const nft = getNft(nftId);
    if (!nft) throw new TypeError("unknown award nft id");
    if (nft.claimed) throw new TypeError("claimed awards cannot be transferred");
    const next = boundedParticipant(toHolder);
    if (next === nft.holder) throw new TypeError("award is already held by that participant");
    const moved = freeze({
      ...nft,
      holder: next,
      transfers: freeze([...nft.transfers, freeze({ from: nft.holder, to: next, at: nowIso(now) })]),
    });
    nfts.set(nft.id, moved);
    recordTrace("transfer", nft.id, `${nft.holder} → ${next}`);
    return moved;
  }

  /**
   * "Claim my win": pays the CURRENT holder the exact escrowed amount.
   * Never expires, never decays — ten seconds or ten years, same amount.
   * Double-claim is impossible.
   */
  function claimAward({ nftId } = {}) {
    const nft = getNft(nftId);
    if (!nft) throw new TypeError("unknown award nft id");
    if (nft.claimed) throw new TypeError("award has already been claimed");
    const escrow = escrows.get(nft.escrowId);
    if (!escrow) throw new TypeError("escrow record missing for award");
    const claimedAt = nowIso(now);
    const claimedNft = freeze({ ...nft, claimed: true, claimedAt });
    nfts.set(nft.id, claimedNft);
    escrows.set(escrow.id, freeze({ ...escrow, claimedAt }));
    const receipt = freeze({
      nftId: nft.id,
      escrowId: escrow.id,
      contractId: nft.contractId,
      holder: nft.holder,
      amount: escrow.amount,
      unit: OUTCOME_STAKE_UNIT,
      kind: escrow.kind,
      claimedAt,
      simulation: true,
      realMoney: false,
      note: "Simulated claim. The exact escrowed amount is paid to the holder; no real value moves.",
    });
    recordTrace("claim", nft.id, `${receipt.holder} claimed ${receipt.amount} ${OUTCOME_STAKE_UNIT}`);
    return receipt;
  }

  function listEscrows() {
    return freeze([...escrows.values()]);
  }

  function listNfts() {
    return freeze([...nfts.values()]);
  }

  function claimableFor(holder) {
    const name = boundedParticipant(holder);
    return freeze(listNfts().filter((nft) => nft.holder === name && !nft.claimed));
  }

  function reset() {
    contracts.clear();
    escrows.clear();
    nfts.clear();
    trace.length = 0;
    counter = 0;
    escrowCounter = 0;
    nftCounter = 0;
    sequence = 0;
    seedStarters();
    recordTrace("reset", "desk", "starter set restored");
    return getSnapshot();
  }

  function getSnapshot() {
    const all = list();
    const escrowList = listEscrows();
    const nftList = listNfts();
    const claimableCents = nftList
      .filter((nft) => !nft.claimed)
      .reduce((sum, nft) => sum + Math.round(nft.amount * 100), 0);
    return freeze({
      schemaVersion: OUTCOME_CONTRACTS_SCHEMA_VERSION,
      source: OUTCOME_CONTRACTS_SOURCE,
      seed: deskSeed,
      simulation: true,
      localOnly: true,
      open: all.filter((contract) => contract.status === "open").length,
      graded: all.filter((contract) => contract.status === "graded").length,
      escrowed: escrowList.length,
      claimed: nftList.filter((nft) => nft.claimed).length,
      claimableAmount: claimableCents / 100,
      eternal: true,
      contracts: all.map((contract) => freeze({
        id: contract.id,
        eventId: contract.eventId,
        eventLabel: contract.eventLabel,
        outcomes: contract.outcomes,
        status: contract.status,
        stakeCount: contract.stakes.length,
        totalStaked: Math.round(contract.stakes.reduce((sum, stake) => sum + stake.amount, 0) * 100) / 100,
      })),
      escrows: escrowList.map((escrow) => freeze({
        id: escrow.id,
        participant: escrow.participant,
        amount: escrow.amount,
        kind: escrow.kind,
        nftId: escrow.nftId ?? null,
        expiresAt: escrow.expiresAt,
        claimedAt: escrow.claimedAt,
      })),
      nfts: nftList.map((nft) => freeze({
        id: nft.id,
        holder: nft.holder,
        amount: nft.amount,
        kind: nft.kind,
        claimed: nft.claimed,
        transfers: nft.transfers.length,
      })),
      trace: freeze([...trace].slice(-24)),
      boundary: OUTCOME_CONTRACTS_BOUNDARY,
      stakeUnit: OUTCOME_STAKE_UNIT,
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
      schemaVersion: OUTCOME_CONTRACTS_SCHEMA_VERSION,
      source: OUTCOME_CONTRACTS_SOURCE,
      updatedAt: OUTCOME_CONTRACTS_UPDATED_AT,
      simulation: true,
      entities: [
        ...all.map((contract) => ({
          id: contract.id,
          kind: "outcome-contract",
          label: contract.eventLabel,
          eventId: contract.eventId,
          status: contract.status,
          simulation: true,
        })),
        ...listEscrows().map((escrow) => ({
          id: escrow.id,
          kind: "eternal-escrow",
          label: `Escrow · ${escrow.participant} · ${escrow.amount} ${OUTCOME_STAKE_UNIT}`,
          expiresAt: null,
          simulation: true,
        })),
        ...listNfts().map((nft) => ({
          id: nft.id,
          kind: "award-nft",
          label: `Award NFT · ${nft.holder} · ${nft.amount} ${OUTCOME_STAKE_UNIT}`,
          simulation: true,
        })),
      ],
      evidence: [{
        id: "outcome-contracts:eternal-escrow-log",
        kind: "simulated-escrow-log",
        contractIds: all.map((contract) => contract.id),
        escrowIds: listEscrows().map((escrow) => escrow.id),
        status: "local",
      }],
      capabilities: [
        { id: "outcome-contracts.grade", mode: "local-rehearsal", authority: "none", executable: false },
        { id: "outcome-contracts.claim", mode: "local-rehearsal", authority: "none", executable: false },
      ],
      boundary: OUTCOME_CONTRACTS_BOUNDARY,
    });
  }

  function seedStarters() {
    const starter = createContract({
      eventId: "demo:derby-rematch",
      eventLabel: "Derby rematch — who takes it?",
      outcomes: ["HOME", "AWAY"],
      creator: "house",
    });
    join({ contractId: starter.id, participant: "tumbo", outcome: "HOME", stakeAmount: 50 });
    join({ contractId: starter.id, participant: "rival", outcome: "AWAY", stakeAmount: 50 });
  }

  // Seed a small open book so the desk is never empty on first open.
  seedStarters();

  return freeze({
    createContract,
    get,
    list,
    join,
    recordResult,
    getNft,
    transferAward,
    claimAward,
    listEscrows,
    listNfts,
    claimableFor,
    reset,
    getSnapshot,
    createContribution,
    source: OUTCOME_CONTRACTS_SOURCE,
    boundary: OUTCOME_CONTRACTS_BOUNDARY,
  });
}

export function createOutcomeContractsContribution({ seed = "local-outcomes", updatedAt = OUTCOME_CONTRACTS_UPDATED_AT } = {}) {
  const desk = createOutcomeContracts({ seed });
  const contribution = desk.createContribution();
  return freeze({ ...contribution, updatedAt });
}

export default createOutcomeContracts;
