import assert from "node:assert/strict";
import { test } from "node:test";
import {
  OUTCOME_CONTRACTS_BOUNDARY,
  OUTCOME_CONTRACTS_NO_VALUE,
  OUTCOME_CONTRACTS_SCHEMA_VERSION,
  OUTCOME_CONTRACTS_SOURCE,
  OUTCOME_CONTRACT_STATUSES,
  OUTCOME_RESULT_DRAW,
  OUTCOME_RESULT_VOID,
  OUTCOME_STAKE_UNIT,
  OUTCOME_TRANSITIONS,
  createOutcomeContracts,
  hashOutcomeSeed,
  planGrading,
} from "../src/domains/outcome-contracts.js";

const FIXED_NOW = "2026-09-18T12:00:00.000Z";
const TEN_YEARS_MS = 10 * 365.25 * 24 * 60 * 60 * 1000;

function desk(seed = "test-seed", clock = () => FIXED_NOW) {
  return createOutcomeContracts({ seed, now: clock });
}

function makeBook(d, { home = 60, away = 40 } = {}) {
  const contract = d.createContract({
    eventId: "evt:derby-1",
    eventLabel: "Derby — who takes it?",
    outcomes: ["HOME", "AWAY"],
    creator: "house",
  });
  d.join({ contractId: contract.id, participant: "winner-alice", outcome: "HOME", stakeAmount: home });
  d.join({ contractId: contract.id, participant: "loser-bob", outcome: "AWAY", stakeAmount: away });
  return contract;
}

test("creation validates event, outcomes, and creator", () => {
  const d = desk();
  assert.throws(() => d.createContract({ eventId: "", eventLabel: "x", outcomes: ["A", "B"], creator: "c" }), TypeError);
  assert.throws(() => d.createContract({ eventId: "e", eventLabel: "x", outcomes: ["A"], creator: "c" }), TypeError);
  assert.throws(() => d.createContract({ eventId: "e", eventLabel: "x", outcomes: ["A", "A"], creator: "c" }), TypeError);
  assert.throws(() => d.createContract({ eventId: "e", eventLabel: "x", outcomes: ["A", "DRAW"], creator: "c" }), TypeError);
  const contract = d.createContract({ eventId: "evt:1", eventLabel: "Final", outcomes: ["home_win", "away_win"], creator: "house" });
  assert.deepEqual(contract.outcomes, ["HOME_WIN", "AWAY_WIN"]);
  assert.equal(contract.status, "open");
  assert.equal(contract.simulation, true);
  assert.equal(contract.realMoney, false);
  assert.equal(contract.wagering, false);
  assert.equal(contract.settlement, false);
  assert.ok(Object.isFrozen(contract));
});

test("join validates outcome, amount, and contract state", () => {
  const d = desk();
  const contract = makeBook(d);
  assert.throws(() => d.join({ contractId: contract.id, participant: "x", outcome: "MAYBE", stakeAmount: 10 }), TypeError);
  assert.throws(() => d.join({ contractId: contract.id, participant: "x", outcome: "HOME", stakeAmount: 0 }), TypeError);
  assert.throws(() => d.join({ contractId: contract.id, participant: "x", outcome: "HOME", stakeAmount: -5 }), TypeError);
  assert.throws(() => d.join({ contractId: contract.id, participant: "x", outcome: "HOME", stakeAmount: 10001 }), TypeError);
  assert.throws(() => d.join({ contractId: "oct:deadbeef:0000", participant: "x", outcome: "HOME", stakeAmount: 10 }), TypeError);
  d.recordResult({ contractId: contract.id, result: "HOME" });
  assert.throws(() => d.join({ contractId: contract.id, participant: "late", outcome: "HOME", stakeAmount: 10 }), TypeError);
});

test("grading pays winners the whole pool and takes losers' stakes", () => {
  const d = desk();
  const contract = makeBook(d, { home: 60, away: 40 });
  const graded = d.recordResult({ contractId: contract.id, result: "HOME" });
  assert.equal(graded.status, "graded");
  assert.equal(graded.grading.kind, "award");
  assert.equal(graded.grading.winningOutcome, "HOME");
  // Alice staked 60 of 100: she takes the whole pool of 100.
  assert.deepEqual(graded.grading.awards.map((a) => [a.participant, a.amount]), [["winner-alice", 100]]);
  // Conservation: awards sum to the total pool, to the cent.
  const pool = graded.grading.totalPool;
  const awarded = graded.grading.awards.reduce((sum, a) => sum + a.amount, 0);
  assert.equal(Math.round(awarded * 100), Math.round(pool * 100));
  assert.equal(pool, 100);
  // Losers' stakes are taken: Bob has no escrow, Alice does.
  assert.equal(d.listEscrows().filter((e) => e.participant === "loser-bob").length, 0);
  const escrow = d.listEscrows().find((e) => e.participant === "winner-alice");
  assert.ok(escrow);
  assert.equal(escrow.amount, 100);
  assert.equal(escrow.expiresAt, null);
  assert.equal(escrow.kind, "award");
});

test("grading splits the pool pro-rata across multiple winners", () => {
  const d = desk();
  const contract = d.createContract({ eventId: "evt:multi", eventLabel: "Multi", outcomes: ["A", "B"], creator: "house" });
  d.join({ contractId: contract.id, participant: "p1", outcome: "A", stakeAmount: 30 });
  d.join({ contractId: contract.id, participant: "p2", outcome: "A", stakeAmount: 30 });
  d.join({ contractId: contract.id, participant: "p3", outcome: "B", stakeAmount: 40 });
  const graded = d.recordResult({ contractId: contract.id, result: "A" });
  const awards = new Map(graded.grading.awards.map((a) => [a.participant, a.amount]));
  assert.equal(awards.get("p1"), 50);
  assert.equal(awards.get("p2"), 50);
  const total = [...awards.values()].reduce((s, v) => s + v, 0);
  assert.equal(total, 100);
});

test("draw refunds every stake in full; void refunds every stake in full", () => {
  for (const result of [OUTCOME_RESULT_DRAW, OUTCOME_RESULT_VOID]) {
    const d = desk(`void-${result}`);
    const contract = makeBook(d, { home: 60, away: 40 });
    const graded = d.recordResult({ contractId: contract.id, result });
    assert.equal(graded.grading.kind, "refund");
    const byParticipant = new Map(graded.grading.awards.map((a) => [a.participant, a.amount]));
    assert.equal(byParticipant.get("winner-alice"), 60);
    assert.equal(byParticipant.get("loser-bob"), 40);
    assert.ok(d.listEscrows().every((e) => e.kind === "refund" && e.expiresAt === null));
  }
});

test("a landed outcome nobody picked refunds the whole book", () => {
  const d = desk();
  const contract = d.createContract({ eventId: "evt:miss", eventLabel: "Miss", outcomes: ["A", "B"], creator: "house" });
  d.join({ contractId: contract.id, participant: "p1", outcome: "A", stakeAmount: 25 });
  const graded = d.recordResult({ contractId: contract.id, result: "B" });
  assert.equal(graded.grading.kind, "refund");
  assert.deepEqual(graded.grading.awards.map((a) => [a.participant, a.amount]), [["p1", 25]]);
});

test("offline winners and losers are graded with no one watching", () => {
  const d = desk();
  const contract = makeBook(d);
  // Nobody is "online": grading reads only recorded stakes + the result.
  const graded = d.recordResult({ contractId: contract.id, result: "AWAY" });
  assert.equal(graded.grading.winningOutcome, "AWAY");
  // The offline winner's award sits in eternal escrow, untouched.
  const escrow = d.listEscrows().find((e) => e.participant === "loser-bob");
  assert.ok(escrow);
  assert.equal(escrow.amount, 100);
  assert.equal(escrow.claimedAt, null);
  // The offline loser's stake is taken: no escrow, no claim path.
  assert.equal(d.listEscrows().filter((e) => e.participant === "winner-alice").length, 0);
});

test("a win is claimable forever: 10-year time travel pays the exact amount", () => {
  let now = Date.parse(FIXED_NOW);
  const d = desk("eternal", () => new Date(now).toISOString());
  const contract = makeBook(d, { home: 60, away: 40 });
  d.recordResult({ contractId: contract.id, result: "HOME" });
  const nft = d.listNfts().find((n) => n.holder === "winner-alice");
  assert.ok(nft);
  // Ten years pass. Nobody touched anything.
  now += TEN_YEARS_MS;
  const receipt = d.claimAward({ nftId: nft.id });
  assert.equal(receipt.amount, 100);
  assert.equal(receipt.unit, OUTCOME_STAKE_UNIT);
  assert.equal(receipt.holder, "winner-alice");
  assert.equal(receipt.simulation, true);
  assert.equal(receipt.realMoney, false);
});

test("award NFT transfer moves the claim to the new holder", () => {
  const d = desk();
  const contract = makeBook(d);
  d.recordResult({ contractId: contract.id, result: "HOME" });
  const nft = d.listNfts().find((n) => n.holder === "winner-alice");
  const moved = d.transferAward({ nftId: nft.id, toHolder: "carol" });
  assert.equal(moved.holder, "carol");
  assert.equal(moved.transfers.length, 1);
  assert.equal(moved.transfers[0].from, "winner-alice");
  // The claim follows the NFT: the new holder claims the full amount.
  const receipt = d.claimAward({ nftId: nft.id });
  assert.equal(receipt.holder, "carol");
  assert.equal(receipt.amount, 100);
});

test("double-claim is impossible and claimed awards cannot transfer", () => {
  const d = desk();
  const contract = makeBook(d);
  d.recordResult({ contractId: contract.id, result: "HOME" });
  const nft = d.listNfts().find((n) => n.holder === "winner-alice");
  d.claimAward({ nftId: nft.id });
  assert.throws(() => d.claimAward({ nftId: nft.id }), /already been claimed/);
  assert.throws(() => d.transferAward({ nftId: nft.id, toHolder: "carol" }), /cannot be transferred/);
  assert.throws(() => d.claimAward({ nftId: "award-nft:deadbeef:0000" }), /unknown award nft/);
});

test("grading is deterministic per seed", () => {
  const build = (seed) => {
    const d = createOutcomeContracts({ seed, now: () => FIXED_NOW });
    const c = d.createContract({ eventId: "evt:det", eventLabel: "Det", outcomes: ["A", "B"], creator: "house" });
    d.join({ contractId: c.id, participant: "p1", outcome: "A", stakeAmount: 33.33 });
    d.join({ contractId: c.id, participant: "p2", outcome: "B", stakeAmount: 66.67 });
    const graded = d.recordResult({ contractId: c.id, result: "A" });
    return { contractId: graded.id, grading: graded.grading };
  };
  const first = build("same-seed");
  const second = build("same-seed");
  assert.deepEqual(first, second);
  const other = build("other-seed");
  assert.notDeepEqual(first.contractId, other.contractId);
});

test("contribution carries the projection interface with no authority", () => {
  const d = desk();
  const contribution = d.createContribution();
  assert.equal(contribution.schemaVersion, OUTCOME_CONTRACTS_SCHEMA_VERSION);
  assert.equal(contribution.source, OUTCOME_CONTRACTS_SOURCE);
  assert.equal(contribution.simulation, true);
  assert.ok(Array.isArray(contribution.entities));
  assert.ok(Array.isArray(contribution.evidence));
  assert.ok(Array.isArray(contribution.capabilities));
  assert.ok(contribution.capabilities.every((c) => c.authority === "none" && c.executable === false));
  assert.equal(contribution.boundary, OUTCOME_CONTRACTS_BOUNDARY);
  // Eternal escrow entities carry expiresAt: null explicitly.
  const escrowEntities = contribution.entities.filter((e) => e.kind === "eternal-escrow");
  assert.ok(escrowEntities.length === 0 || escrowEntities.every((e) => e.expiresAt === null));
});

test("snapshot and boundary flags deny all real-value authority", () => {
  const d = desk();
  const snapshot = d.getSnapshot();
  assert.equal(snapshot.eternal, true);
  assert.equal(snapshot.realMoney, false);
  assert.equal(snapshot.wagering, false);
  assert.equal(snapshot.wallet, false);
  assert.equal(snapshot.chain, false);
  assert.equal(snapshot.custody, false);
  assert.equal(snapshot.settlement, false);
  assert.equal(snapshot.boundary, OUTCOME_CONTRACTS_BOUNDARY);
  assert.match(OUTCOME_CONTRACTS_NO_VALUE, /zero real value/);
});

test("hashOutcomeSeed is deterministic", () => {
  assert.equal(hashOutcomeSeed("abc"), hashOutcomeSeed("abc"));
  assert.notEqual(hashOutcomeSeed("abc"), hashOutcomeSeed("abd"));
  assert.match(hashOutcomeSeed("abc"), /^[0-9a-f]{8}$/);
});

test("reset restores the starter book", () => {
  const d = desk();
  const before = d.list().length;
  d.createContract({ eventId: "evt:tmp", eventLabel: "Tmp", outcomes: ["A", "B"], creator: "house" });
  assert.equal(d.list().length, before + 1);
  d.reset();
  assert.equal(d.list().length, before);
  assert.equal(d.listEscrows().length, 0);
  assert.equal(d.listNfts().length, 0);
});

/* ------------------------------------------------------------------ */
/* Part 2 — hardened lifecycle, idempotency, deterministic plans.      */
/* ------------------------------------------------------------------ */

test("lifecycle states and the guarded transition table exist", () => {
  assert.deepEqual([...OUTCOME_CONTRACT_STATUSES], ["draft", "open", "locked", "graded", "settled", "claimed", "voided"]);
  assert.deepEqual(OUTCOME_TRANSITIONS.draft, ["open", "voided"]);
  assert.deepEqual(OUTCOME_TRANSITIONS.open, ["locked", "graded", "voided"]);
  assert.deepEqual(OUTCOME_TRANSITIONS.locked, ["graded", "voided"]);
  assert.deepEqual(OUTCOME_TRANSITIONS.graded, ["settled"]);
  assert.deepEqual(OUTCOME_TRANSITIONS.settled, ["claimed"]);
  assert.deepEqual(OUTCOME_TRANSITIONS.claimed, []);
  assert.deepEqual(OUTCOME_TRANSITIONS.voided, []);
});

function makeDraftBook(d) {
  return d.createContract({
    eventId: "evt:lc-1",
    eventLabel: "Lifecycle bout",
    outcomes: ["A", "B"],
    creator: "house",
    status: "draft",
  });
}

test("full lifecycle: draft → open → locked → graded → settled → claimed, with history", () => {
  const d = desk("lifecycle");
  const draft = makeDraftBook(d);
  assert.equal(draft.status, "draft");
  assert.deepEqual(draft.lifecycle.map((entry) => entry.status), ["draft"]);
  assert.ok(draft.lifecycle.every((entry) => entry.at && entry.reason));

  const opened = d.publish({ contractId: draft.id });
  assert.equal(opened.status, "open");
  d.join({ contractId: draft.id, participant: "p1", outcome: "A", stakeAmount: 30 });
  d.join({ contractId: draft.id, participant: "p2", outcome: "B", stakeAmount: 70 });

  const locked = d.lock({ contractId: draft.id });
  assert.equal(locked.status, "locked");
  assert.throws(() => d.join({ contractId: draft.id, participant: "late", outcome: "A", stakeAmount: 5 }), /not open for joining/);

  const graded = d.recordResult({ contractId: draft.id, result: "A" });
  assert.equal(graded.status, "graded");
  assert.deepEqual(graded.lifecycle.map((entry) => entry.status), ["draft", "open", "locked", "graded"]);
  assert.ok(graded.grading.planDigest);
  assert.ok(graded.grading.plan);

  const settled = d.settle({ contractId: draft.id });
  assert.equal(settled.status, "settled");

  const nft = d.listNfts().find((entry) => entry.contractId === draft.id);
  d.claimAward({ nftId: nft.id });
  assert.equal(d.get(draft.id).status, "claimed");
  assert.deepEqual(
    d.getLifecycle(draft.id).map((entry) => entry.status),
    ["draft", "open", "locked", "graded", "settled", "claimed"],
  );
});

test("illegal lifecycle transitions throw", () => {
  const d = desk("illegal");
  const draft = makeDraftBook(d);
  assert.throws(() => d.lock({ contractId: draft.id }), /illegal lifecycle transition/);
  assert.throws(() => d.recordResult({ contractId: draft.id, result: "A" }), /draft/);
  assert.throws(() => d.join({ contractId: draft.id, participant: "x", outcome: "A", stakeAmount: 5 }), /not open for joining/);
  assert.throws(() => d.settle({ contractId: draft.id }), /only a graded book/);
  assert.throws(() => d.createContract({ eventId: "e", eventLabel: "x", outcomes: ["A", "B"], creator: "c", status: "locked" }), /start as "open" or "draft"/);

  const opened = d.publish({ contractId: draft.id });
  assert.throws(() => d.publish({ contractId: opened.id }), /illegal lifecycle transition/);
  d.join({ contractId: opened.id, participant: "p1", outcome: "A", stakeAmount: 10 });
  const locked = d.lock({ contractId: opened.id });
  assert.throws(() => d.lock({ contractId: locked.id }), /illegal lifecycle transition/);
  assert.throws(() => d.join({ contractId: locked.id, participant: "p2", outcome: "B", stakeAmount: 10 }), /not open for joining/);

  const graded = d.recordResult({ contractId: locked.id, result: "A" });
  assert.throws(() => d.lock({ contractId: graded.id }), /illegal lifecycle transition/);
  assert.throws(() => d.void({ contractId: graded.id }), /cannot be voided/);
  assert.throws(() => d.publish({ contractId: graded.id }), /illegal lifecycle transition/);

  d.settle({ contractId: graded.id });
  const nft = d.listNfts().find((entry) => entry.contractId === graded.id);
  d.claimAward({ nftId: nft.id });
  const claimed = d.get(graded.id);
  assert.equal(claimed.status, "claimed");
  assert.equal(d.settle({ contractId: claimed.id }), claimed, "settle on a claimed book is an idempotent no-op");
  assert.equal(d.get(claimed.id).status, "claimed");
  assert.throws(() => d.getLifecycle("oct:deadbeef:0000"), /unknown outcome contract id/);
});

test("zero-stake grading settles explicitly with payoutKind no_stakes", () => {
  const d = desk("zero-stake");
  const contract = d.createContract({ eventId: "evt:empty", eventLabel: "Empty", outcomes: ["A", "B"], creator: "house" });
  const done = d.recordResult({ contractId: contract.id, result: "A" });
  assert.equal(done.status, "settled");
  assert.equal(done.grading.payoutKind, "no_stakes");
  assert.equal(done.grading.kind, "no_stakes");
  assert.deepEqual(done.grading.awards, []);
  assert.deepEqual(done.grading.escrowIds, []);
  assert.deepEqual(done.grading.nftIds, []);
  assert.equal(done.grading.totalPool, 0);
  assert.ok(done.grading.planDigest);
  assert.equal(d.listEscrows().filter((escrow) => escrow.contractId === contract.id).length, 0);
  assert.deepEqual(done.lifecycle.map((entry) => entry.status), ["open", "locked", "graded", "settled"]);
});

test("void refunds every stake in full and is terminal", () => {
  const d = desk("void-flow");
  const contract = makeBook(d, { home: 60, away: 40 });
  const voided = d.void({ contractId: contract.id, reason: "event cancelled" });
  assert.equal(voided.status, "voided");
  assert.equal(voided.grading.kind, "refund");
  assert.equal(voided.voidReason, "event cancelled");
  const escrows = d.listEscrows().filter((escrow) => escrow.contractId === contract.id);
  assert.equal(escrows.length, 2);
  const byParticipant = new Map(escrows.map((escrow) => [escrow.participant, escrow.amount]));
  assert.equal(byParticipant.get("winner-alice"), 60);
  assert.equal(byParticipant.get("loser-bob"), 40);
  assert.ok(escrows.every((escrow) => escrow.expiresAt === null));
  // Voided books are terminal — but refunds stay claimable forever.
  assert.throws(() => d.join({ contractId: contract.id, participant: "x", outcome: "HOME", stakeAmount: 5 }), /not open for joining/);
  assert.throws(() => d.recordResult({ contractId: contract.id, result: "HOME" }), /voided/);
  assert.throws(() => d.settle({ contractId: contract.id }), /only a graded book/);
  assert.throws(() => d.void({ contractId: contract.id }), /cannot be voided/);
  assert.throws(() => d.lock({ contractId: contract.id }), /illegal lifecycle transition/);
  const nft = d.listNfts().find((entry) => entry.holder === "winner-alice");
  const receipt = d.claimAward({ nftId: nft.id });
  assert.equal(receipt.amount, 60);
  assert.equal(receipt.kind, "refund");
  assert.equal(d.get(contract.id).status, "voided", "claims do not resurrect a voided book");
});

test("settle verifies escrow accounting and is idempotent", () => {
  const d = desk("settle-idem");
  const contract = makeBook(d);
  d.recordResult({ contractId: contract.id, result: "HOME" });
  const first = d.settle({ contractId: contract.id });
  assert.equal(first.status, "settled");
  const second = d.settle({ contractId: contract.id });
  assert.equal(second, first);
  assert.deepEqual(
    d.getLifecycle(contract.id).filter((entry) => entry.status === "settled"),
    [d.getLifecycle(contract.id).find((entry) => entry.status === "settled")],
    "no duplicate settled history entry",
  );
  assert.throws(() => d.settle({ contractId: "oct:deadbeef:0000" }), /unknown outcome contract/);
});

test("the book advances graded → settled → claimed as awards are actually claimed", () => {
  const d = desk("advance");
  const contract = d.createContract({ eventId: "evt:adv", eventLabel: "Adv", outcomes: ["A", "B"], creator: "house" });
  d.join({ contractId: contract.id, participant: "w1", outcome: "A", stakeAmount: 50 });
  d.join({ contractId: contract.id, participant: "w2", outcome: "A", stakeAmount: 50 });
  d.join({ contractId: contract.id, participant: "l1", outcome: "B", stakeAmount: 100 });
  d.recordResult({ contractId: contract.id, result: "A" });
  assert.equal(d.get(contract.id).status, "graded");
  const awards = d.listNfts().filter((nft) => nft.contractId === contract.id);
  assert.equal(awards.length, 2);
  d.claimAward({ nftId: awards[0].id, idempotencyKey: "final-1" });
  assert.equal(d.get(contract.id).status, "graded", "partial claims do not advance the book");
  d.claimAward({ nftId: awards[1].id, idempotencyKey: "final-2" });
  assert.equal(d.get(contract.id).status, "claimed");
  assert.deepEqual(d.getLifecycle(contract.id).map((entry) => entry.status), ["open", "locked", "graded", "settled", "claimed"]);
  const receipts = [
    d.claimAward({ nftId: awards[0].id, idempotencyKey: "final-1" }),
    d.claimAward({ nftId: awards[1].id, idempotencyKey: "final-2" }),
  ];
  assert.ok(receipts.every((receipt) => receipt.amount === 100));
  assert.throws(() => d.claimAward({ nftId: awards[0].id }), /already been claimed/);
});

test("join is idempotent per participant+contract+key; hedging across outcomes is rejected", () => {
  const d = desk("join-idem");
  const contract = d.createContract({ eventId: "evt:ji", eventLabel: "JI", outcomes: ["A", "B"], creator: "house" });
  const first = d.join({ contractId: contract.id, participant: "p1", outcome: "A", stakeAmount: 10, idempotencyKey: "k1" });
  const replay = d.join({ contractId: contract.id, participant: "p1", outcome: "A", stakeAmount: 10, idempotencyKey: "k1" });
  assert.equal(replay, first, "same key replays the original stake receipt");
  assert.equal(d.get(contract.id).stakes.length, 1, "no duplicate stake minted");
  assert.throws(
    () => d.join({ contractId: contract.id, participant: "p1", outcome: "A", stakeAmount: 11, idempotencyKey: "k1" }),
    /idempotency key was already used/,
  );
  assert.throws(
    () => d.join({ contractId: contract.id, participant: "p1", outcome: "B", stakeAmount: 10, idempotencyKey: "k2" }),
    /one outcome per participant/,
  );
  assert.throws(
    () => d.join({ contractId: contract.id, participant: "p1", outcome: "B", stakeAmount: 10 }),
    /one outcome per participant/,
  );
  // A different participant may reuse the same key string independently.
  d.join({ contractId: contract.id, participant: "p2", outcome: "B", stakeAmount: 10, idempotencyKey: "k1" });
  assert.equal(d.get(contract.id).stakes.length, 2);
});

test("re-grading with the identical result is a no-op; a different result is forbidden", () => {
  const d = desk("grade-idem");
  const contract = makeBook(d);
  const graded = d.recordResult({ contractId: contract.id, result: "HOME" });
  const escrowCount = d.listEscrows().length;
  const again = d.recordResult({ contractId: contract.id, result: "HOME" });
  assert.equal(again, graded, "identical re-grade returns the original graded contract");
  assert.equal(d.listEscrows().length, escrowCount, "escrow is never double-minted");
  assert.equal(d.listNfts().length, 1);
  assert.throws(() => d.recordResult({ contractId: contract.id, result: "AWAY" }), /different result is forbidden/);
  assert.throws(() => d.recordResult({ contractId: contract.id, result: "DRAW" }), /different result is forbidden/);
  assert.equal(d.listEscrows().length, escrowCount);
});

test("claim is idempotent per NFT key; keyless replays still throw", () => {
  const d = desk("claim-idem");
  const contract = makeBook(d);
  d.recordResult({ contractId: contract.id, result: "HOME" });
  const nft = d.listNfts().find((entry) => entry.holder === "winner-alice");
  const first = d.claimAward({ nftId: nft.id, idempotencyKey: "claim-1" });
  const replay = d.claimAward({ nftId: nft.id, idempotencyKey: "claim-1" });
  assert.equal(replay, first, "same key replays the original receipt");
  assert.equal(replay.amount, 100);
  assert.throws(() => d.claimAward({ nftId: nft.id }), /already been claimed/);
  assert.throws(() => d.claimAward({ nftId: nft.id, idempotencyKey: "other" }), /already been claimed/);
  assert.equal(d.get(contract.id).status, "claimed");
});

test("transfer is idempotent per key and never duplicates the claim", () => {
  const d = desk("transfer-idem");
  const contract = makeBook(d);
  d.recordResult({ contractId: contract.id, result: "HOME" });
  const nft = d.listNfts().find((entry) => entry.holder === "winner-alice");
  const moved = d.transferAward({ nftId: nft.id, toHolder: "carol", idempotencyKey: "t-1" });
  const replay = d.transferAward({ nftId: nft.id, toHolder: "carol", idempotencyKey: "t-1" });
  assert.equal(replay, moved, "same key replays the original moved NFT");
  assert.equal(d.getNft(nft.id).transfers.length, 1, "no duplicate transfer entry");
  // The same claim rides onward — one claim path, never two.
  const moved2 = d.transferAward({ nftId: nft.id, toHolder: "dave" });
  assert.equal(moved2.holder, "dave");
  assert.equal(moved2.transfers.length, 2);
  const receipt = d.claimAward({ nftId: nft.id });
  assert.equal(receipt.holder, "dave");
  assert.equal(receipt.amount, 100);
  assert.equal(d.listNfts().filter((entry) => entry.contractId === contract.id && entry.claimed).length, 1);
  assert.throws(() => d.claimAward({ nftId: nft.id }), /already been claimed/);
});

test("10-year time-travel claim with idempotency key pays the identical amount on replay", () => {
  let now = Date.parse(FIXED_NOW);
  const d = desk("eternal-key", () => new Date(now).toISOString());
  const contract = makeBook(d, { home: 60, away: 40 });
  d.recordResult({ contractId: contract.id, result: "HOME" });
  const nft = d.listNfts().find((entry) => entry.holder === "winner-alice");
  now += TEN_YEARS_MS;
  const first = d.claimAward({ nftId: nft.id, idempotencyKey: "eternal-1" });
  assert.equal(first.amount, 100);
  now += TEN_YEARS_MS; // another decade passes; the receipt is identical
  const replay = d.claimAward({ nftId: nft.id, idempotencyKey: "eternal-1" });
  assert.equal(replay, first);
  assert.equal(replay.amount, 100);
});

test("winner pro-rata conserves the pool to the cent with a remainder", () => {
  const d = desk("remainder");
  const contract = d.createContract({ eventId: "evt:rem", eventLabel: "Rem", outcomes: ["A", "B"], creator: "house" });
  d.join({ contractId: contract.id, participant: "w1", outcome: "A", stakeAmount: 1 });
  d.join({ contractId: contract.id, participant: "w2", outcome: "A", stakeAmount: 1 });
  d.join({ contractId: contract.id, participant: "w3", outcome: "A", stakeAmount: 1 });
  d.join({ contractId: contract.id, participant: "loser", outcome: "B", stakeAmount: 1 });
  const graded = d.recordResult({ contractId: contract.id, result: "A" });
  // Pool 400c, winning stakes 300c: floors are 133c each, leftover 1c goes to
  // the first winner in join order (largest-remainder).
  const byParticipant = new Map(graded.grading.awards.map((award) => [award.participant, Math.round(award.amount * 100)]));
  assert.equal(byParticipant.get("w1"), 134);
  assert.equal(byParticipant.get("w2"), 133);
  assert.equal(byParticipant.get("w3"), 133);
  const total = [...byParticipant.values()].reduce((sum, cents) => sum + cents, 0);
  assert.equal(total, 400, "shares sum to the pool exactly");
  assert.equal(d.listEscrows().filter((escrow) => escrow.participant === "loser").length, 0);
});

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("fuzz: 200 random books conserve the pool to the cent end to end", () => {
  const rand = mulberry32(0xc0ffee);
  const outcomePool = ["A", "B", "C", "D"];
  for (let book = 0; book < 200; book += 1) {
    const d = desk(`fuzz-${book}`);
    const outcomeCount = 2 + Math.floor(rand() * 3);
    const outcomes = outcomePool.slice(0, outcomeCount);
    const contract = d.createContract({
      eventId: `evt:fuzz-${book}`,
      eventLabel: `Fuzz ${book}`,
      outcomes,
      creator: "house",
    });
    const stakeCount = 1 + Math.floor(rand() * 6);
    for (let s = 0; s < stakeCount; s += 1) {
      const cents = 1 + Math.floor(rand() * 99999);
      d.join({
        contractId: contract.id,
        participant: `p${s}`,
        outcome: outcomes[Math.floor(rand() * outcomes.length)],
        stakeAmount: cents / 100,
      });
    }
    const roll = rand();
    const result = roll < 0.15 ? "DRAW" : roll < 0.25 ? "VOID" : outcomes[Math.floor(rand() * outcomes.length)];
    const graded = d.recordResult({ contractId: contract.id, result });
    const stakes = d.get(contract.id).stakes;
    const poolCents = stakes.reduce((sum, stake) => sum + Math.round(stake.amount * 100), 0);
    assert.equal(Math.round(graded.grading.totalPool * 100), poolCents, `book ${book}: totalPool != stake sum`);
    const awardedCents = graded.grading.awards.reduce((sum, award) => sum + Math.round(award.amount * 100), 0);
    assert.equal(awardedCents, poolCents, `book ${book}: awards do not conserve the pool`);
    const escrows = d.listEscrows().filter((escrow) => escrow.contractId === contract.id);
    assert.equal(escrows.length, graded.grading.escrowIds.length, `book ${book}: escrow row count`);
    const escrowedCents = escrows.reduce((sum, escrow) => sum + Math.round(escrow.amount * 100), 0);
    assert.equal(escrowedCents, poolCents, `book ${book}: escrowed != pool`);
    assert.ok(
      escrows.every((escrow) => escrow.expiresAt === null && escrow.kind === graded.grading.kind),
      `book ${book}: escrow not eternal or wrong kind`,
    );
    const nfts = d.listNfts().filter((nft) => nft.contractId === contract.id);
    assert.equal(nfts.length, escrows.length, `book ${book}: nft count != escrow count`);
    // Every award claims for its exact escrowed amount.
    for (const nft of nfts) {
      const receipt = d.claimAward({ nftId: nft.id, idempotencyKey: `fuzz-${book}` });
      const escrow = escrows.find((entry) => entry.id === nft.escrowId);
      assert.equal(Math.round(receipt.amount * 100), Math.round(escrow.amount * 100), `book ${book}: claim != escrow`);
    }
    assert.equal(d.get(contract.id).status, "claimed", `book ${book}: not fully claimed`);
  }
});

test("planGrading is byte-identical for identical inputs and diverges otherwise", () => {
  const bytes = {
    eventId: "evt:plan",
    outcomes: ["A", "B"],
    stakes: [
      { participant: "p1", outcome: "A", amount: 33.33 },
      { participant: "p2", outcome: "B", amount: 66.67 },
    ],
  };
  const first = planGrading(bytes, "A");
  const second = planGrading(bytes, "A");
  assert.equal(first.plan, second.plan, "byte-identical plans");
  assert.equal(first.digest, second.digest, "identical digests");
  assert.match(first.digest, /^[0-9a-f]{8}$/);
  assert.equal(first.poolCents, 10000);
  assert.equal(first.payoutKind, "award");
  const paid = first.payouts.reduce((sum, payout) => sum + payout.amountCents, 0);
  assert.equal(paid, first.poolCents, "plan payouts conserve the pool");
  // A JSON-string input gives the same bytes.
  assert.equal(planGrading(JSON.stringify(bytes), "A").digest, first.digest);
  // Any input difference changes the digest.
  assert.notEqual(planGrading(bytes, "B").digest, first.digest);
  assert.notEqual(planGrading(bytes, "DRAW").digest, first.digest);
  assert.notEqual(
    planGrading({ ...bytes, stakes: [{ participant: "p1", outcome: "A", amount: 33.34 }, bytes.stakes[1]] }, "A").digest,
    first.digest,
  );
  assert.notEqual(planGrading({ ...bytes, eventId: "evt:other" }, "A").digest, first.digest);
  // No timestamps or generated IDs leak into the plan.
  assert.ok(!first.plan.includes("gradedAt") && !first.plan.includes("stake-") && !first.plan.includes("oct:"));
  // The grading receipt records the plan digest.
  const d = desk("plan-desk");
  const contract = d.createContract({ eventId: "evt:plan", eventLabel: "Plan", outcomes: ["A", "B"], creator: "house" });
  d.join({ contractId: contract.id, participant: "p1", outcome: "A", stakeAmount: 33.33 });
  d.join({ contractId: contract.id, participant: "p2", outcome: "B", stakeAmount: 66.67 });
  const graded = d.recordResult({ contractId: contract.id, result: "A" });
  assert.equal(graded.grading.planDigest, first.digest);
  assert.equal(graded.grading.plan, first.plan);
});

test("draw and void refund the pool exactly, to the cent", () => {
  for (const result of [OUTCOME_RESULT_DRAW, OUTCOME_RESULT_VOID]) {
    const d = desk(`exact-refund-${result}`);
    const contract = d.createContract({ eventId: "evt:ref", eventLabel: "Ref", outcomes: ["A", "B"], creator: "house" });
    d.join({ contractId: contract.id, participant: "p1", outcome: "A", stakeAmount: 33.33 });
    d.join({ contractId: contract.id, participant: "p2", outcome: "A", stakeAmount: 33.33 });
    d.join({ contractId: contract.id, participant: "p3", outcome: "B", stakeAmount: 33.34 });
    const graded = d.recordResult({ contractId: contract.id, result });
    const refunded = graded.grading.awards.reduce((sum, award) => sum + Math.round(award.amount * 100), 0);
    assert.equal(refunded, 10000, `${result}: refunds do not equal the pool`);
    const byParticipant = new Map(graded.grading.awards.map((award) => [award.participant, award.amount]));
    assert.equal(byParticipant.get("p1"), 33.33);
    assert.equal(byParticipant.get("p2"), 33.33);
    assert.equal(byParticipant.get("p3"), 33.34);
  }
});

test("snapshot counts every lifecycle state", () => {
  const d = desk("snapshot-states");
  const draft = makeDraftBook(d);
  const snapshot = d.getSnapshot();
  assert.equal(snapshot.draft, 1);
  assert.equal(snapshot.open, 1, "the seeded starter book");
  assert.equal(snapshot.locked, 0);
  assert.equal(snapshot.graded, 0);
  assert.equal(snapshot.settled, 0);
  assert.equal(snapshot.claimedContracts, 0);
  assert.equal(snapshot.voided, 0);
  d.publish({ contractId: draft.id });
  d.join({ contractId: draft.id, participant: "p1", outcome: "A", stakeAmount: 5 });
  d.recordResult({ contractId: draft.id, result: "A" });
  assert.equal(d.getSnapshot().graded, 1);
  d.settle({ contractId: draft.id });
  assert.equal(d.getSnapshot().settled, 1);
});
