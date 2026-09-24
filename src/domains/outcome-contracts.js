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
 * Hardened lifecycle (Part 2):
 *   draft → open → locked → graded → settled → claimed
 *                                  ↘ voided (from draft/open/locked only)
 * Every transition is guarded by a transition table and recorded on the
 * contract's lifecycle history (status, at, reason). Accounting runs in
 * integer cents and is asserted after EVERY mutation: stake sum == pool,
 * awards/refunds conserve the pool exactly (largest-remainder pro-rata by
 * join order), losers are collected exactly once, and every eternal escrow
 * row carries expiresAt: null. Joins, grades, claims, and transfers are
 * idempotent via idempotency keys. Grading follows a deterministic plan:
 * planGrading(contractBytes, resultBytes) canonicalizes event + outcomes +
 * stakes + result (no timestamps, no generated IDs) and hashes it to a
 * digest recorded on the grading receipt.
 *
 * Everything here is a page-session rehearsal. Stakes and awards are
 * simulated TUMBO points with zero real value. There is no wallet, no chain,
 * no custody, no settlement, no wagering, and no real money. IDs are
 * deterministic so the same seed always rebuilds the same set; nothing here
 * is an ownership, payout, or value claim.
 */

export const OUTCOME_CONTRACTS_SCHEMA_VERSION = 2;
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

const freeze = (value) => {
  if (Array.isArray(value)) value.forEach(freeze);
  else if (value && typeof value === "object") Object.values(value).forEach(freeze);
  return value && typeof value === "object" ? Object.freeze(value) : value;
};

/** Full hardened lifecycle. Terminal states: claimed, voided. */
export const OUTCOME_CONTRACT_STATUSES = Object.freeze([
  "draft",
  "open",
  "locked",
  "graded",
  "settled",
  "claimed",
  "voided",
]);

/**
 * Guarded transition table. recordResult auto-locks an open book
 * (open → locked → graded in one deterministic step); grading leaves the
 * book "graded" so the grade stays observable, then settle() or the final
 * claim advances it. void() is only legal before grading — once the
 * deterministic machine has graded, it runs to completion.
 */
export const OUTCOME_TRANSITIONS = freeze({
  draft: ["open", "voided"],
  open: ["locked", "graded", "voided"],
  locked: ["graded", "voided"],
  graded: ["settled"],
  settled: ["claimed"],
  claimed: [],
  voided: [],
});

export const OUTCOME_PAYOUT_KINDS = Object.freeze(["award", "refund", "no_stakes"]);

export const OUTCOME_CONTRACTS_BOUNDARY =
  "Outcome contracts are a fictional local rehearsal. Stakes and awards are simulated TUMBO points with zero real value: no wallet, no chain, no custody, no settlement, no wagering, no real money. Grading is deterministic local logic — winners and losers are computed from the recorded result with no human in the loop and no one required to be online. The lifecycle is draft → open → locked → graded → settled → claimed (or voided before grading); every transition is guarded and recorded. Escrow claims never expire and never decay: the exact awarded amount is claimable forever.";

/** Fictional unit label carried on every stake, award, and claim. */
export const OUTCOME_CONTRACTS_NO_VALUE = "Stakes and awards are simulated TUMBO points with zero real value.";

function safeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

/** Deterministic FNV-1a hash; keeps IDs and plan digests stable per input. */
export function hashOutcomeSeed(value) {
  const text = safeText(value, "outcome-contracts");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Canonical JSON: sorted keys at every level, so digests are stable. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

const toCents = (amount) => Math.round(Number(amount) * 100);

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
 * Deterministic grading plan. Pure: no timestamps, no generated IDs, no
 * wall clock. `contractBytes` is { eventId, outcomes, stakes:
 * [{ participant, outcome, amount }] } (a JSON string is also accepted) and
 * `resultBytes` is the landed result. The plan canonicalizes eventId +
 * outcomes + participants' stakes + result, hashes it to a digest, and
 * computes the full payout table in integer cents — so identical
 * event/result bytes give byte-identical plans and digests.
 *
 * Payout rule: winners split the whole pool pro-rata. Each share is floored
 * to the cent and leftover cents are dealt out one per winner in join order
 * (largest-remainder), so the shares always sum to the pool exactly. Losers
 * get 0 — their stakes were collected into the pool exactly once.
 */
export function planGrading(contractBytes, resultBytes) {
  const input = typeof contractBytes === "string" ? JSON.parse(contractBytes) : (contractBytes ?? {});
  const result = safeText(resultBytes).trim().toUpperCase();
  const eventId = safeText(input.eventId);
  const outcomes = (Array.isArray(input.outcomes) ? input.outcomes : [])
    .map((entry) => safeText(entry).trim().toUpperCase());
  // NOTE: stake order is preserved byte-for-byte — it drives the
  // largest-remainder split. Sort first if you want order-independence.
  const stakes = (Array.isArray(input.stakes) ? input.stakes : []).map((stake) => ({
    participant: safeText(stake?.participant),
    outcome: safeText(stake?.outcome).trim().toUpperCase(),
    amountCents: toCents(stake?.amount),
  }));
  const poolCents = stakes.reduce((sum, stake) => sum + stake.amountCents, 0);

  let payoutKind = "refund";
  let payouts = stakes.map(() => 0);
  if (poolCents > 0) {
    if (result === OUTCOME_RESULT_DRAW || result === OUTCOME_RESULT_VOID) {
      payoutKind = "refund";
      payouts = stakes.map((stake) => stake.amountCents);
    } else {
      const winners = stakes
        .map((stake, index) => ({ ...stake, index }))
        .filter((stake) => stake.outcome === result);
      if (winners.length === 0) {
        payoutKind = "refund";
        payouts = stakes.map((stake) => stake.amountCents);
      } else {
        payoutKind = "award";
        const winningCents = winners.reduce((sum, stake) => sum + stake.amountCents, 0);
        const shares = winners.map((stake) => Math.floor((stake.amountCents * poolCents) / winningCents));
        let leftover = poolCents - shares.reduce((sum, share) => sum + share, 0);
        for (let i = 0; leftover > 0; i += 1) {
          shares[i % shares.length] += 1;
          leftover -= 1;
        }
        winners.forEach((stake, position) => { payouts[stake.index] = shares[position]; });
      }
    }
  } else {
    payoutKind = "no_stakes";
  }

  const canonical = canonicalJson({
    eventId,
    outcomes,
    result,
    stakes: stakes.map((stake) => ({
      amountCents: stake.amountCents,
      outcome: stake.outcome,
      participant: stake.participant,
    })),
  });
  const digest = hashOutcomeSeed(canonical);
  const payoutRows = stakes.map((stake, index) => freeze({
    participant: stake.participant,
    outcome: stake.outcome,
    amountCents: payouts[index],
  }));
  return freeze({
    plan: canonical,
    digest,
    result,
    eventId,
    outcomes: freeze(outcomes),
    stakeCount: stakes.length,
    poolCents,
    payoutKind,
    payouts: freeze(payoutRows),
  });
}

/**
 * Split a pool (in cents) pro-rata across winning stakes with exact
 * conservation: every share is floored and the leftover cents go one per
 * winner in join order (largest-remainder), so the shares always sum to
 * the pool exactly. Kept for compatibility; planGrading computes the same.
 */
function splitPoolCents(winningStakes, poolCents) {
  const winningCents = winningStakes.reduce((sum, stake) => sum + toCents(stake.amount), 0);
  if (winningCents <= 0 || poolCents <= 0) return winningStakes.map(() => 0);
  const shares = winningStakes.map((stake) => Math.floor((toCents(stake.amount) * poolCents) / winningCents));
  let leftover = poolCents - shares.reduce((sum, share) => sum + share, 0);
  for (let i = 0; leftover > 0; i += 1) {
    shares[i % shares.length] += 1;
    leftover -= 1;
  }
  return shares;
}

/**
 * Accounting invariant, asserted after EVERY mutation, in integer cents:
 *  - stake sum == pool
 *  - total awards/refunds == pool exactly (conservation to the cent)
 *  - every escrowed cent is accounted by an award/refund of the same kind
 *  - losers collected exactly once: in an award, every escrowed participant
 *    is a winner (losers have no escrow — their stakes were taken)
 *  - every eternal escrow row has expiresAt: null (claimable forever)
 */
function assertAccounting({ stakes, poolCents, awardsCents, escrows, kind, context }) {
  const stakeCents = stakes.reduce((sum, stake) => sum + toCents(stake.amount), 0);
  if (stakeCents !== poolCents) {
    throw new Error(`accounting violation (${context}): stake sum ${stakeCents}c != pool ${poolCents}c`);
  }
  if (awardsCents !== poolCents) {
    throw new Error(`accounting violation (${context}): awards ${awardsCents}c != pool ${poolCents}c — the pool is not conserved`);
  }
  const escrowCents = escrows.reduce((sum, escrow) => sum + toCents(escrow.amount), 0);
  if (escrowCents !== awardsCents) {
    throw new Error(`accounting violation (${context}): escrowed ${escrowCents}c != awarded ${awardsCents}c`);
  }
  for (const escrow of escrows) {
    if (escrow.expiresAt !== null) {
      throw new Error(`accounting violation (${context}): escrow ${escrow.id} is not eternal (expiresAt must be null)`);
    }
    if (escrow.kind !== kind) {
      throw new Error(`accounting violation (${context}): escrow ${escrow.id} kind "${escrow.kind}" != "${kind}"`);
    }
  }
  // Losers-collected-exactly-once (award kind) is checked by the caller,
  // which knows the winning outcome: every escrowed participant must hold a
  // winning stake, so losers have no escrow row at all.
  return true;
}

/**
 * Create an outcome-contracts desk. `seed` rebuilds the same starter set;
 * `now` is injectable for deterministic tests (including the 10-year
 * time-travel claim test). `relicVault` is an optional Frozen Relics vault:
 * when provided, every award NFT is ALSO minted as a Frozen Relic — the
 * claim terms freeze in the relic's immutable core while its life
 * (grading → transfers → claim) keeps growing. Escrow guarantees are
 * untouched: the claim still follows the holder, double-claim stays
 * impossible, and claims never expire.
 */
export function createOutcomeContracts({ seed = "local-outcomes", now = null, relicVault = null } = {}) {
  const deskSeed = safeText(seed) || "local-outcomes";
  let counter = 0;
  let escrowCounter = 0;
  let nftCounter = 0;
  const contracts = new Map();
  const escrows = new Map();
  const nfts = new Map();
  const trace = [];
  let sequence = 0;
  // Idempotency ledgers (in-memory, local-only; cleared on reset):
  const joinLedger = new Map(); // `${contractId}‖${participant}‖${key}` → { stake, outcome, amountCents }
  const claimLedger = new Map(); // nftId → { receipt, idempotencyKey }
  const transferLedger = new Map(); // `${nftId}‖${key}` → moved nft

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

  function mintAwardNft({ escrow, eventLabel = "", creator = "" }) {
    nftCounter += 1;
    const tokenHash = hashOutcomeSeed(`${deskSeed}:award-nft:${nftCounter}:${escrow.id}`);
    const id = `award-nft:${tokenHash.slice(0, 8)}:${String(nftCounter).padStart(4, "0")}`;
    // The award can also live as a Frozen Relic: the claim terms freeze in
    // the relic's immutable core while its life keeps growing. The vault is
    // optional — without it the award is a plain local NFT as before.
    let relicId = null;
    if (relicVault) {
      const relic = relicVault.mintRelicFromAward({
        awardNftId: id,
        escrowId: escrow.id,
        contractId: escrow.contractId,
        eventLabel,
        creator,
        holder: escrow.participant,
        amount: escrow.amount,
        kind: escrow.kind,
        unit: OUTCOME_STAKE_UNIT,
      });
      relicId = relic.id;
    }
    const nft = freeze({
      id,
      escrowId: escrow.id,
      contractId: escrow.contractId,
      amount: escrow.amount,
      unit: OUTCOME_STAKE_UNIT,
      holder: escrow.participant,
      kind: escrow.kind,
      relicId,
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

  function get(contractId) {
    return contracts.get(safeText(contractId)) ?? null;
  }

  /** Guarded lifecycle transition: validates the table, records history. */
  function applyTransition(contract, to, reason) {
    const allowed = OUTCOME_TRANSITIONS[contract.status] ?? [];
    if (!allowed.includes(to)) {
      throw new TypeError(`illegal lifecycle transition: "${contract.status}" → "${to}" (allowed: ${allowed.join(", ") || "none"})`);
    }
    const entry = freeze({ status: to, at: nowIso(now), reason: safeText(reason).slice(0, 160) });
    const updated = freeze({ ...contract, status: to, lifecycle: freeze([...contract.lifecycle, entry]) });
    contracts.set(contract.id, updated);
    recordTrace("lifecycle", contract.id, `${contract.status} → ${to} · ${entry.reason}`);
    return updated;
  }

  function getLifecycle(contractId) {
    const contract = get(contractId);
    if (!contract) throw new TypeError("unknown outcome contract id");
    return freeze([...contract.lifecycle]);
  }

  function createContract({ eventId, eventLabel, outcomes, creator, status = "open" } = {}) {
    const initial = safeText(status).trim().toLowerCase() || "open";
    if (initial !== "open" && initial !== "draft") {
      throw new TypeError('new contracts start as "open" or "draft"');
    }
    // Event IDs are provider identities, not presentation labels. Truncating a
    // long namespaced college-sports ID breaks the approved evidence binding.
    const exactEventId = safeText(eventId).trim();
    if (!exactEventId || exactEventId.length > 160) throw new TypeError('event id must be 1–160 characters without truncation');
    const contract = freeze({
      id: nextId("oct"),
      eventId: exactEventId,
      eventLabel: boundedLabel(eventLabel, "event label", 96),
      outcomes: normalizeOutcomes(outcomes),
      creator: boundedParticipant(creator),
      stakes: freeze([]),
      status: initial,
      lifecycle: freeze([freeze({
        status: initial,
        at: nowIso(now),
        reason: initial === "draft" ? "created as draft" : "created open",
      })]),
      result: null,
      grading: null,
      createdAt: nowIso(now),
      simulation: true,
      realMoney: false,
      wagering: false,
      settlement: false,
    });
    contracts.set(contract.id, contract);
    recordTrace("create", contract.id, `${contract.eventLabel} · ${contract.outcomes.join(" / ")} · ${initial}`);
    return contract;
  }

  /** Publish a draft book: draft → open. Joining opens. */
  function publish({ contractId } = {}) {
    const contract = get(contractId);
    if (!contract) throw new TypeError("unknown outcome contract id");
    return applyTransition(contract, "open", "published: the book is open for joining");
  }

  /** Close joining without grading yet: open → locked. */
  function lock({ contractId } = {}) {
    const contract = get(contractId);
    if (!contract) throw new TypeError("unknown outcome contract id");
    return applyTransition(contract, "locked", "joining closed");
  }

  function list({ includeGraded = true } = {}) {
    const all = [...contracts.values()];
    return freeze(includeGraded ? all : all.filter((contract) => contract.status === "open"));
  }

  /**
   * Join a contract with simulated TUMBO points. The participant may walk
   * away immediately after — the contract does not care who is online.
   * Idempotent: re-submitting the same participant + contract +
   * idempotencyKey is a no-op returning the original stake receipt. One
   * participant backs one outcome per contract — hedging across outcomes
   * is rejected.
   */
  function join({ contractId, participant, outcome, stakeAmount, idempotencyKey = null } = {}) {
    const contract = get(contractId);
    if (!contract) throw new TypeError("unknown outcome contract id");
    if (contract.status !== "open") {
      throw new TypeError(
        contract.status === "graded"
          ? "contract is graded; joining is closed"
          : `contract is not open for joining (status: "${contract.status}")`,
      );
    }
    const chosen = safeText(outcome).trim().toUpperCase();
    if (!contract.outcomes.includes(chosen)) {
      throw new TypeError(`outcome must be one of: ${contract.outcomes.join(", ")}`);
    }
    const name = boundedParticipant(participant);
    const amount = normalizeAmount(stakeAmount);
    const amountCents = toCents(amount);
    const key = idempotencyKey === undefined || idempotencyKey === null || idempotencyKey === ""
      ? null
      : safeText(idempotencyKey);

    // One outcome per participant per contract: hedging is rejected.
    const backed = new Set(contract.stakes.filter((stake) => stake.participant === name).map((stake) => stake.outcome));
    if (backed.size > 0 && !backed.has(chosen)) {
      throw new TypeError(`"${name}" already backs ${[...backed][0]} on this contract — one outcome per participant`);
    }

    // Idempotent replay: same participant + contract + key → original stake.
    if (key !== null) {
      const dedupeKey = `${contract.id}‖${name}‖${key}`;
      const prior = joinLedger.get(dedupeKey);
      if (prior) {
        if (prior.outcome === chosen && prior.amountCents === amountCents) return prior.stake;
        throw new TypeError("idempotency key was already used with different join parameters");
      }
    }

    const poolCentsBefore = contract.stakes.reduce((sum, entry) => sum + toCents(entry.amount), 0);
    const stake = freeze({
      id: `${contract.id}:stake-${contract.stakes.length + 1}`,
      participant: name,
      outcome: chosen,
      amount,
      unit: OUTCOME_STAKE_UNIT,
      at: nowIso(now),
      simulation: true,
    });
    const updated = freeze({ ...contract, stakes: freeze([...contract.stakes, stake]) });
    contracts.set(contract.id, updated);
    if (key !== null) {
      joinLedger.set(`${contract.id}‖${name}‖${key}`, { stake, outcome: chosen, amountCents });
    }
    // Invariant: the pool is exactly the sum of stakes — the new stake
    // entered exactly once, in integer cents.
    const poolCentsAfter = updated.stakes.reduce((sum, entry) => sum + toCents(entry.amount), 0);
    if (poolCentsAfter !== poolCentsBefore + amountCents) {
      throw new Error("accounting violation (join): stake did not enter the pool exactly once");
    }
    recordTrace("join", contract.id, `${stake.participant} · ${stake.amount} ${OUTCOME_STAKE_UNIT} on ${stake.outcome}`);
    return stake;
  }

  /**
   * The deterministic grading core shared by recordResult and void().
   * Builds the plan, computes awards in integer cents, mints eternal escrow
   * + award NFTs, asserts every accounting invariant, and returns the
   * stored contract at its new status.
   */
  function gradeBook(contract, landed, { voidReason = null } = {}) {
    const stakes = contract.stakes;
    const plan = planGrading(
      {
        eventId: contract.eventId,
        outcomes: contract.outcomes,
        stakes: stakes.map((stake) => ({ participant: stake.participant, outcome: stake.outcome, amount: stake.amount })),
      },
      landed,
    );
    const poolCents = plan.poolCents;

    let kind = plan.payoutKind;
    let winningOutcome = null;
    if (kind === "award") winningOutcome = landed;
    if (voidReason !== null) kind = "refund";

    // Awards mirror the deterministic plan, in stake order; losers get 0.
    const awards = [];
    plan.payouts.forEach((payout, index) => {
      if (payout.amountCents <= 0) return;
      awards.push(freeze({
        stakeId: stakes[index].id,
        participant: payout.participant,
        amount: payout.amountCents / 100,
      }));
    });
    const awardsCents = awards.reduce((sum, award) => sum + toCents(award.amount), 0);

    // Eternal escrow: every award/refund is locked to its participant with
    // expiresAt: null — claimable forever, never decaying.
    const escrowIds = [];
    const nftIds = [];
    const newEscrows = [];
    for (const award of awards) {
      const escrow = escrowFor({ contractId: contract.id, participant: award.participant, amount: award.amount, kind });
      const nft = mintAwardNft({ escrow, eventLabel: contract.eventLabel, creator: contract.creator });
      const linked = freeze({ ...escrow, nftId: nft.id });
      escrows.set(linked.id, linked);
      newEscrows.push(linked);
      escrowIds.push(linked.id);
      nftIds.push(nft.id);
    }

    // Assert EVERY accounting invariant after this mutation, in cents.
    assertAccounting({
      stakes,
      poolCents,
      awardsCents,
      escrows: newEscrows,
      kind,
      context: voidReason !== null ? "void" : "grade",
    });
    if (kind === "award") {
      // Losers collected exactly once: every escrowed participant holds a
      // winning stake; nobody else got an escrow row.
      const winners = new Set(
        stakes.filter((stake) => stake.outcome === winningOutcome).map((stake) => stake.participant),
      );
      for (const escrow of newEscrows) {
        if (!winners.has(escrow.participant)) {
          throw new Error(`accounting violation (grade): escrow for non-winner "${escrow.participant}"`);
        }
      }
    }

    const grading = freeze({
      result: landed,
      kind,
      payoutKind: kind,
      winningOutcome,
      totalPool: poolCents / 100,
      unit: OUTCOME_STAKE_UNIT,
      plan: plan.plan,
      planDigest: plan.digest,
      awards: freeze(awards),
      escrowIds: freeze(escrowIds),
      nftIds: freeze(nftIds),
      gradedAt: nowIso(now),
      deterministic: true,
      simulation: true,
      note: kind === "award"
        ? "Winners take the pool. Losers' stakes were collected. Claim the exact awarded amount whenever — it never expires."
        : kind === "refund"
          ? "No winner took the pool. Every stake was refunded in full into eternal escrow."
          : "No stakes were placed. The book settles with nothing escrowed — an explicit no-stakes settlement.",
    });

    let working = contract;
    if (working.status === "open") {
      working = applyTransition(working, "locked", voidReason !== null ? "joining closed: contract voided" : "joining auto-closed when the result was recorded");
    }
    const terminal = voidReason !== null ? "voided" : kind === "no_stakes" ? "settled" : "graded";
    const transitionReason = voidReason !== null
      ? `voided${voidReason ? `: ${voidReason}` : ""} · stakes refunded in full`
      : kind === "no_stakes"
        ? "zero-stake grading: settled with nothing escrowed"
        : `result ${landed} recorded · ${kind.toUpperCase()} · ${escrowIds.length} escrowed forever`;
    // Walk the guarded chain explicitly so history shows every hop.
    const chain = [];
    if (terminal === "voided") chain.push("voided");
    else if (terminal === "graded") chain.push("graded");
    else chain.push("graded", "settled");
    let settled = working;
    for (const hop of chain) {
      settled = applyTransition(settled, hop, transitionReason);
    }
    const finished = freeze({
      ...settled,
      result: freeze({ outcome: landed, at: nowIso(now) }),
      grading,
      voidReason: voidReason !== null ? safeText(voidReason).slice(0, 160) : null,
    });
    contracts.set(finished.id, finished);
    recordTrace(voidReason !== null ? "void" : "grade", finished.id, `${landed} · ${kind.toUpperCase()} · ${escrowIds.length} escrowed`);
    return finished;
  }

  /**
   * The event lands: record its result and GRADE the contract in the same
   * deterministic step. No human in the loop, no one needs to be online.
   * `result` is a listed outcome, DRAW, or VOID. An open book auto-locks
   * first (open → locked → graded). Re-grading with the IDENTICAL result is
   * an idempotent no-op returning the original graded contract — escrow is
   * never double-minted. A different result is forbidden.
   */
  function recordResult({ contractId, result } = {}) {
    const contract = get(contractId);
    if (!contract) throw new TypeError("unknown outcome contract id");
    const landed = safeText(result).trim().toUpperCase();
    if (contract.status === "graded" || contract.status === "settled" || contract.status === "claimed") {
      if (contract.grading && contract.grading.result === landed) return contract;
      throw new TypeError(
        `contract is already graded with result "${contract.grading ? contract.grading.result : "?"}"; re-grading with a different result is forbidden`,
      );
    }
    if (contract.status === "voided") throw new TypeError("contract is voided; it cannot be graded");
    if (contract.status === "draft") throw new TypeError('contract is a draft; publish it with publish() before grading');
    const valid = [...contract.outcomes, OUTCOME_RESULT_DRAW, OUTCOME_RESULT_VOID];
    if (!valid.includes(landed)) {
      throw new TypeError(`result must be one of: ${valid.join(", ")}`);
    }
    return gradeBook(contract, landed);
  }

  /**
   * Settle a graded book: graded → settled. Verifies the escrow accounting
   * is complete (every escrow linked to its award NFT, amounts exact,
   * eternal). Idempotent: already settled/claimed books are returned
   * unchanged. Claims do not require settling first — the final claim
   * advances the book automatically.
   */
  function settle({ contractId } = {}) {
    const contract = get(contractId);
    if (!contract) throw new TypeError("unknown outcome contract id");
    if (contract.status === "settled" || contract.status === "claimed") return contract;
    if (contract.status !== "graded") {
      throw new TypeError(`only a graded book can settle (status: "${contract.status}")`);
    }
    const grading = contract.grading;
    const contractEscrows = grading.escrowIds.map((id) => escrows.get(id));
    if (contractEscrows.some((escrow) => !escrow)) {
      throw new Error("settlement blocked: an escrow row is missing for this book");
    }
    for (const escrow of contractEscrows) {
      if (!escrow.nftId || !nfts.get(escrow.nftId)) {
        throw new Error(`settlement blocked: escrow ${escrow.id} has no linked award NFT`);
      }
    }
    assertAccounting({
      stakes: contract.stakes,
      poolCents: toCents(grading.totalPool),
      awardsCents: grading.awards.reduce((sum, award) => sum + toCents(award.amount), 0),
      escrows: contractEscrows,
      kind: grading.kind,
      context: "settle",
    });
    return applyTransition(contract, "settled", "escrow fully settled: every award/refund accounted to the cent");
  }

  /**
   * Void a book before grading: draft/open/locked → voided. Every stake is
   * refunded in full into eternal escrow (claimable forever). Terminal.
   */
  function voidContract({ contractId, reason = "" } = {}) {
    const contract = get(contractId);
    if (!contract) throw new TypeError("unknown outcome contract id");
    const allowed = OUTCOME_TRANSITIONS[contract.status] ?? [];
    if (!allowed.includes("voided")) {
      throw new TypeError(`contract cannot be voided from status "${contract.status}"`);
    }
    return gradeBook(contract, OUTCOME_RESULT_VOID, { voidReason: safeText(reason) || "voided by the house" });
  }

  function getNft(nftId) {
    return nfts.get(safeText(nftId)) ?? null;
  }

  /**
   * The award rides around: transfer the NFT locally and the claim follows
   * the new holder. Claimed awards cannot move — they are spent.
   * Idempotent: re-submitting the same nft + idempotencyKey returns the
   * original moved NFT without appending another transfer entry.
   */
  function transferAward({ nftId, toHolder, idempotencyKey = null } = {}) {
    const nft = getNft(nftId);
    if (!nft) throw new TypeError("unknown award nft id");
    const key = idempotencyKey === undefined || idempotencyKey === null || idempotencyKey === ""
      ? null
      : safeText(idempotencyKey);
    if (key !== null) {
      const prior = transferLedger.get(`${nft.id}‖${key}`);
      if (prior) return prior;
    }
    if (nft.claimed) throw new TypeError("claimed awards cannot be transferred");
    const next = boundedParticipant(toHolder);
    if (next === nft.holder) throw new TypeError("award is already held by that participant");
    // The relic's life grows with the award: record the transfer first so a
    // vault disagreement never leaves the desk inconsistent.
    if (nft.relicId && relicVault) relicVault.recordRelicTransfer({ relicId: nft.relicId, toHolder: next });
    const moved = freeze({
      ...nft,
      holder: next,
      transfers: freeze([...nft.transfers, freeze({ from: nft.holder, to: next, at: nowIso(now) })]),
    });
    nfts.set(nft.id, moved);
    if (key !== null) transferLedger.set(`${nft.id}‖${key}`, moved);
    recordTrace("transfer", nft.id, `${nft.holder} → ${next}`);
    return moved;
  }

  /**
   * "Claim my win": pays the CURRENT holder the exact escrowed amount.
   * Never expires, never decays — ten seconds or ten years, same amount.
   * Double-claim is impossible: a second claim without the original
   * idempotency key throws; replaying the SAME key returns the original
   * receipt. When the final award of a book is claimed, the book advances
   * graded → settled → claimed (or settled → claimed) automatically.
   */
  function claimAward({ nftId, idempotencyKey = null } = {}) {
    const nft = getNft(nftId);
    if (!nft) throw new TypeError("unknown award nft id");
    const key = idempotencyKey === undefined || idempotencyKey === null || idempotencyKey === ""
      ? null
      : safeText(idempotencyKey);
    if (nft.claimed) {
      const prior = claimLedger.get(nft.id);
      if (key !== null && prior && prior.idempotencyKey === key) return prior.receipt;
      throw new TypeError("award has already been claimed");
    }
    const escrow = escrows.get(nft.escrowId);
    if (!escrow) throw new TypeError("escrow record missing for award");
    if (toCents(escrow.amount) !== toCents(nft.amount)) {
      throw new Error("accounting violation (claim): escrow amount != award amount");
    }
    // The relic's life records the claim FIRST (its hardened claim path
    // proves the holder); a vault rejection leaves the desk untouched.
    if (nft.relicId && relicVault) relicVault.recordRelicClaim({ relicId: nft.relicId, holder: nft.holder, amount: escrow.amount });
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
      idempotencyKey: key,
      simulation: true,
      realMoney: false,
      note: "Simulated claim. The exact escrowed amount is paid to the holder; no real value moves.",
    });
    claimLedger.set(nft.id, { receipt, idempotencyKey: key });
    recordTrace("claim", nft.id, `${receipt.holder} claimed ${receipt.amount} ${OUTCOME_STAKE_UNIT}`);
    advanceOnClaims(nft.contractId);
    return receipt;
  }

  /** When every award of a book is claimed, advance graded → settled → claimed. */
  function advanceOnClaims(contractId) {
    const contract = contracts.get(contractId);
    if (!contract) return;
    if (contract.status !== "graded" && contract.status !== "settled") return;
    const book = [...nfts.values()].filter((nft) => nft.contractId === contractId);
    if (book.length === 0) return;
    if (!book.every((nft) => nft.claimed)) return;
    let current = contract;
    if (current.status === "graded") {
      current = applyTransition(current, "settled", "escrow fully settled: every award accounted to the cent");
    }
    applyTransition(current, "claimed", "every award claimed — the book is complete");
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
    joinLedger.clear();
    claimLedger.clear();
    transferLedger.clear();
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
      .reduce((sum, nft) => sum + toCents(nft.amount), 0);
    const count = (status) => all.filter((contract) => contract.status === status).length;
    return freeze({
      schemaVersion: OUTCOME_CONTRACTS_SCHEMA_VERSION,
      source: OUTCOME_CONTRACTS_SOURCE,
      seed: deskSeed,
      simulation: true,
      localOnly: true,
      open: count("open"),
      graded: count("graded"),
      draft: count("draft"),
      locked: count("locked"),
      settled: count("settled"),
      claimedContracts: count("claimed"),
      voided: count("voided"),
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
        lifecycle: contract.lifecycle.map((entry) => entry.status),
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
        relicId: nft.relicId ?? null,
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
    publish,
    lock,
    get,
    getLifecycle,
    list,
    join,
    recordResult,
    settle,
    void: voidContract,
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
