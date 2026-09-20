import assert from "node:assert/strict";
import test from "node:test";

import {
  FROZEN_RELICS_BOUNDARY,
  FROZEN_RELICS_COLLECTION,
  FROZEN_RELICS_FORM,
  FROZEN_RELICS_SOURCE,
  canonicalizeFrozen,
  createFrozenRelics,
  createFrozenRelicsContribution,
  sealFrozen,
  stageForRelic,
  verifyFrozenCoreData,
} from "../src/domains/frozen-relics.js";
import { createOutcomeContracts } from "../src/domains/outcome-contracts.js";

const T0 = "2026-09-18T12:00:00.000Z";

function vaultAt(now = T0, seed = "test-relics") {
  return createFrozenRelics({ seed, now });
}

test("minted relic takes the cube form of this reality", () => {
  const vault = vaultAt();
  const relic = vault.mintRelic({ name: "Test Cube", origin: "atelier:test", creator: "tumbo" });
  assert.equal(relic.collection, FROZEN_RELICS_COLLECTION);
  assert.equal(relic.form, FROZEN_RELICS_FORM);
  assert.equal(relic.simulation, true);
  assert.equal(relic.valuable, false);
  assert.match(relic.id, /^relic:[0-9a-f]{8}:\d{4}$/);
});

test("frozen core carries origin, creator, timestamp, terms, and genesis hash", () => {
  const vault = vaultAt();
  const relic = vault.mintRelic({
    name: "Core Check",
    origin: "outcome-contract:oct:abc123",
    creator: "house",
    terms: { claimAmount: "150", unit: "simulated TUMBO points" },
  });
  const core = relic.frozenCore;
  assert.equal(core.origin, "outcome-contract:oct:abc123");
  assert.equal(core.creator, "house");
  assert.equal(core.mintedAt, T0);
  assert.equal(core.terms.claimAmount, "150");
  assert.match(core.genesisHash, /^[0-9a-f]{8}$/);
});

test("frozen core mutation attempts throw — set, delete, nested, define", () => {
  const vault = vaultAt();
  const relic = vault.mintRelic({
    name: "Untouchable",
    origin: "atelier:test",
    creator: "tumbo",
    terms: { claimAmount: "150" },
  });
  assert.throws(() => { relic.frozenCore.origin = "evil"; }, /frozen core violation/);
  assert.throws(() => { relic.frozenCore.terms.claimAmount = "999999"; }, /frozen core violation/);
  assert.throws(() => { delete relic.frozenCore.creator; }, /frozen core violation/);
  assert.throws(() => { delete relic.frozenCore.terms.claimAmount; }, /frozen core violation/);
  assert.throws(() => { relic.frozenCore.newField = "nope"; }, /frozen core violation/);
  assert.throws(() => {
    Object.defineProperty(relic.frozenCore, "origin", { value: "evil" });
  }, /frozen core violation/);
  // And the stored record is untouched afterwards.
  const again = vault.getRelic(relic.id);
  assert.equal(again.frozenCore.origin, "atelier:test");
  assert.equal(again.frozenCore.terms.claimAmount, "150");
});

test("verifyFrozenCore proves the core has not changed", () => {
  const vault = vaultAt();
  const relic = vault.mintRelic({ name: "Proof", origin: "atelier:test", creator: "tumbo", terms: { a: "1" } });
  const verdict = vault.verifyFrozenCore(relic.id);
  assert.equal(verdict.ok, true);
  assert.equal(verdict.genesisHash, relic.frozenCore.genesisHash);
  assert.equal(verdict.relicId, relic.id);
  assert.match(verdict.verifiedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test("verifyFrozenCoreData detects a tampered core", () => {
  const vault = vaultAt();
  const relic = vault.mintRelic({ name: "Proof", origin: "atelier:test", creator: "tumbo", terms: { claimAmount: "150" } });
  const forged = {
    origin: relic.frozenCore.origin,
    creator: relic.frozenCore.creator,
    mintedAt: relic.frozenCore.mintedAt,
    terms: { claimAmount: "999999" },
    genesisHash: relic.frozenCore.genesisHash,
  };
  const verdict = verifyFrozenCoreData(forged);
  assert.equal(verdict.ok, false);
  assert.notEqual(verdict.recomputed, verdict.expected);
});

test("life history is append-only: edit and delete attempts throw", () => {
  const vault = vaultAt();
  const relic = vault.mintRelic({ name: "Living", origin: "atelier:test", creator: "tumbo" });
  vault.recordLifeEvent({ relicId: relic.id, kind: "witnessed", detail: "saw the world open" });
  const view = vault.getRelic(relic.id);
  assert.ok(view.life.history.length >= 2);
  assert.throws(() => { view.life.history[0].detail = "rewritten"; }, /frozen core violation/);
  assert.throws(() => { view.life.history.push({ kind: "forged" }); }, /frozen core violation/);
  assert.throws(() => { view.life.history.pop(); }, /frozen core violation/);
  assert.throws(() => { delete view.life.history[0]; }, /frozen core violation/);
  // The real history is intact.
  const again = vault.getRelic(relic.id);
  assert.equal(again.life.history[0].kind, "sealed");
});

test("the relic witnesses world events and annotations append", () => {
  const vault = vaultAt();
  const relic = vault.mintRelic({ name: "Witness", origin: "atelier:test", creator: "tumbo" });
  vault.witness({ relicId: relic.id, kind: "cube.opened", detail: "the market cube sprang open" });
  vault.annotate({ relicId: relic.id, note: "first light through the glass" });
  const view = vault.getRelic(relic.id);
  const kinds = view.life.history.map((entry) => entry.kind);
  assert.ok(kinds.includes("witnessed:cube.opened"));
  assert.ok(kinds.includes("annotated"));
  assert.equal(view.life.annotations.length, 1);
  assert.equal(view.life.annotations[0].note, "first light through the glass");
});

test("stages advance deterministically with age and activity", () => {
  assert.equal(stageForRelic({ bornAtMs: 0, nowMs: 0, eventCount: 0 }), "sealed");
  assert.equal(stageForRelic({ bornAtMs: 0, nowMs: 0, eventCount: 2 }), "stirring");
  assert.equal(stageForRelic({ bornAtMs: 0, nowMs: 0, eventCount: 4 }), "awake");
  assert.equal(stageForRelic({ bornAtMs: 0, nowMs: 0, eventCount: 7 }), "radiant");
  assert.equal(stageForRelic({ bornAtMs: 0, nowMs: 0, eventCount: 12 }), "mythic");
  const day = 86_400_000;
  assert.equal(stageForRelic({ bornAtMs: 0, nowMs: day, eventCount: 0 }), "stirring");
  assert.equal(stageForRelic({ bornAtMs: 0, nowMs: 8 * day, eventCount: 0 }), "awake");
  assert.equal(stageForRelic({ bornAtMs: 0, nowMs: 40 * day, eventCount: 0 }), "radiant");
  assert.equal(stageForRelic({ bornAtMs: 0, nowMs: 400 * day, eventCount: 0 }), "mythic");
});

test("a relic evolves with time travel: sealed at mint, radiant 40 days later", () => {
  let current = T0;
  const vault = createFrozenRelics({ seed: "time-travel", now: () => current });
  const relic = vault.mintRelic({ name: "Aging Cube", origin: "atelier:test", creator: "tumbo" });
  assert.equal(vault.getRelic(relic.id).life.stage, "sealed");
  current = new Date(new Date(T0).getTime() + 40 * 86_400_000).toISOString();
  assert.equal(vault.getRelic(relic.id).life.stage, "radiant");
});

test("award relics freeze the claim terms while life keeps growing", () => {
  const vault = vaultAt();
  const relic = vault.mintRelicFromAward({
    awardNftId: "award-nft:deadbeef:0001",
    escrowId: "esc:deadbeef:0001",
    contractId: "oct:deadbeef:0001",
    eventLabel: "Derby rematch",
    creator: "house",
    holder: "winner-a",
    amount: 150,
    kind: "award",
  });
  // The claim is frozen in the core.
  assert.equal(relic.frozenCore.terms.claimAmount, "150");
  assert.equal(relic.frozenCore.terms.escrowId, "esc:deadbeef:0001");
  assert.equal(relic.frozenCore.origin, "outcome-contract:oct:deadbeef:0001");
  // The life already records the grading birth.
  const kinds = relic.life.history.map((entry) => entry.kind);
  assert.ok(kinds.includes("graded"));
  // The relic rides around: transfer grows the life, core untouched.
  const moved = vault.recordRelicTransfer({ relicId: relic.id, toHolder: "winner-b" });
  assert.equal(moved.life.holder, "winner-b");
  assert.ok(moved.life.history.some((entry) => entry.kind === "transferred"));
  assert.equal(moved.frozenCore.terms.claimAmount, "150");
  // Claim honors the frozen amount exactly; wrong amounts are rejected.
  assert.throws(
    () => vault.recordRelicClaim({ relicId: relic.id, holder: "winner-b", amount: 999 }),
    /honors the frozen core/,
  );
  const claimed = vault.recordRelicClaim({ relicId: relic.id, holder: "winner-b", amount: 150 });
  assert.equal(claimed.life.claimed, true);
  assert.ok(claimed.life.history.some((entry) => entry.kind === "claimed"));
  // Spent relics cannot move or re-claim.
  assert.throws(() => vault.recordRelicTransfer({ relicId: relic.id, toHolder: "winner-c" }), /spent/);
  assert.throws(() => vault.recordRelicClaim({ relicId: relic.id, holder: "winner-b", amount: 150 }), /already been recorded/);
});

test("eternal-escrow awards mint as Frozen Relics end to end", () => {
  const vault = createFrozenRelics({ seed: "escrow-relics", now: T0 });
  const desk = createOutcomeContracts({ seed: "escrow-relics", now: T0, relicVault: vault });
  const contract = desk.createContract({
    eventId: "evt:derby-9",
    eventLabel: "Derby rematch — who takes it?",
    outcomes: ["HOME", "AWAY"],
    creator: "house",
  });
  desk.join({ contractId: contract.id, participant: "tumbo", outcome: "HOME", stakeAmount: 60 });
  desk.join({ contractId: contract.id, participant: "rival", outcome: "AWAY", stakeAmount: 40 });
  const graded = desk.recordResult({ contractId: contract.id, result: "HOME" });
  assert.equal(graded.grading.kind, "award");

  // Every award NFT became a living relic with the claim frozen in its core.
  const nfts = desk.listNfts();
  assert.equal(nfts.length, 1);
  const nft = nfts[0];
  assert.ok(nft.relicId, "award nft carries a relic id");
  const relic = vault.getRelic(nft.relicId);
  assert.equal(relic.frozenCore.terms.claimAmount, String(nft.amount));
  assert.equal(relic.frozenCore.terms.escrowId, nft.escrowId);

  // The award rides around: both the NFT and the relic life follow.
  const moved = desk.transferAward({ nftId: nft.id, toHolder: "friend" });
  assert.equal(moved.holder, "friend");
  assert.equal(vault.getRelic(nft.relicId).life.holder, "friend");

  // "Claim my win": exact frozen amount, escrow guarantees intact.
  const receipt = desk.claimAward({ nftId: nft.id });
  assert.equal(receipt.holder, "friend");
  assert.equal(receipt.amount, nft.amount);
  assert.equal(vault.getRelic(nft.relicId).life.claimed, true);
  assert.throws(() => desk.claimAward({ nftId: nft.id }), /already been claimed/);
  assert.throws(() => desk.transferAward({ nftId: nft.id, toHolder: "stranger" }), /claimed awards cannot be transferred/);

  // Eternal: a decade later the relic still verifies and the core is intact.
  const verdict = vault.verifyFrozenCore(nft.relicId);
  assert.equal(verdict.ok, true);
});

test("desks without a vault keep plain award NFTs", () => {
  const desk = createOutcomeContracts({ seed: "no-vault", now: T0 });
  const contract = desk.createContract({
    eventId: "evt:solo",
    eventLabel: "Solo bout",
    outcomes: ["A", "B"],
    creator: "house",
  });
  desk.join({ contractId: contract.id, participant: "tumbo", outcome: "A", stakeAmount: 10 });
  desk.join({ contractId: contract.id, participant: "rival", outcome: "B", stakeAmount: 10 });
  desk.recordResult({ contractId: contract.id, result: "A" });
  const [nft] = desk.listNfts();
  assert.equal(nft.relicId, null);
});

test("relics are deterministic per seed", () => {
  const first = vaultAt(T0, "deterministic");
  const second = vaultAt(T0, "deterministic");
  const a = first.mintRelic({ name: "Same", origin: "atelier:x", creator: "tumbo", terms: { k: "v" } });
  const b = second.mintRelic({ name: "Same", origin: "atelier:x", creator: "tumbo", terms: { k: "v" } });
  assert.equal(a.id, b.id);
  assert.equal(a.frozenCore.genesisHash, b.frozenCore.genesisHash);
  assert.equal(a.life.patina, b.life.patina);
  assert.equal(a.life.stage, b.life.stage);
});

test("canonicalizeFrozen is key-order stable", () => {
  assert.equal(
    canonicalizeFrozen({ b: 1, a: { y: 2, x: 1 } }),
    canonicalizeFrozen({ a: { x: 1, y: 2 }, b: 1 }),
  );
});

test("sealFrozen exposes reads and throws on any write", () => {
  const sealed = sealFrozen({ a: 1, nested: { b: [1, 2] } });
  assert.equal(sealed.a, 1);
  assert.equal(sealed.nested.b[1], 2);
  assert.equal(JSON.parse(JSON.stringify(sealed)).a, 1);
  assert.throws(() => { sealed.a = 2; }, /frozen core violation/);
  assert.throws(() => { sealed.nested.b.push(3); }, /frozen core violation/);
});

test("snapshot and contribution carry the projection boundary", () => {
  const vault = vaultAt();
  vault.mintRelic({ name: "Snap", origin: "atelier:test", creator: "tumbo" });
  const snapshot = vault.getSnapshot();
  assert.equal(snapshot.source, FROZEN_RELICS_SOURCE);
  assert.equal(snapshot.simulation, true);
  assert.equal(snapshot.wallet, false);
  assert.equal(snapshot.chain, false);
  assert.equal(snapshot.sale, false);
  assert.equal(snapshot.custody, false);
  assert.equal(snapshot.relics, 1);

  const contribution = vault.createContribution();
  assert.equal(contribution.source, FROZEN_RELICS_SOURCE);
  assert.equal(contribution.simulation, true);
  assert.ok(contribution.entities.every((entity) => entity.simulation === true));
  assert.ok(contribution.capabilities.every((cap) => cap.authority === "none" && cap.executable === false));
  assert.equal(contribution.boundary, FROZEN_RELICS_BOUNDARY);

  const seeded = createFrozenRelicsContribution({ updatedAt: T0 });
  assert.equal(seeded.source, FROZEN_RELICS_SOURCE);
  assert.equal(seeded.updatedAt, T0);
  assert.equal(seeded.entities.length, 1);
});

test("unknown relic ids throw clean errors", () => {
  const vault = vaultAt();
  assert.throws(() => vault.getRelic("relic:00000000:0000"), /unknown frozen relic id/);
  assert.throws(() => vault.verifyFrozenCore("relic:00000000:0000"), /unknown frozen relic id/);
  assert.throws(() => vault.mintRelic({ name: "   ", origin: "x", creator: "y" }), /non-empty string/);
});

test("recordRelicClaim requires holder proof: a mismatched holder cannot seize the claim", () => {
  const vault = vaultAt();
  const relic = vault.mintRelicFromAward({
    awardNftId: "award-nft:deadbeef:0001",
    escrowId: "esc:deadbeef:0001",
    contractId: "oct:deadbeef:0001",
    eventLabel: "Derby",
    creator: "house",
    holder: "winner-a",
    amount: 150,
    kind: "award",
  });
  // Wrong holder with the right amount: rejected — the claim follows the
  // current holder and can never be seized by naming someone else.
  assert.throws(
    () => vault.recordRelicClaim({ relicId: relic.id, holder: "mallory", amount: 150 }),
    /claim holder mismatch/,
  );
  // The rejected claim left the relic untouched and unspent.
  const untouched = vault.getRelic(relic.id);
  assert.equal(untouched.life.holder, "winner-a");
  assert.equal(untouched.life.claimed, false);
  // Wrong amount with the right holder: still the frozen-core error.
  assert.throws(
    () => vault.recordRelicClaim({ relicId: relic.id, holder: "winner-a", amount: 999 }),
    /honors the frozen core/,
  );
  // The real holder claims fine.
  const claimed = vault.recordRelicClaim({ relicId: relic.id, holder: "winner-a", amount: 150 });
  assert.equal(claimed.life.claimed, true);
  assert.equal(claimed.life.holder, "winner-a");
  // Duplicate claim is impossible.
  assert.throws(
    () => vault.recordRelicClaim({ relicId: relic.id, holder: "winner-a", amount: 150 }),
    /already been recorded/,
  );
  // The core still verifies after all of it.
  assert.equal(vault.verifyFrozenCore(relic.id).ok, true);
});

test("recordRelicClaim without a holder still honors the frozen amount", () => {
  const vault = vaultAt();
  const relic = vault.mintRelicFromAward({
    awardNftId: "award-nft:deadbeef:0002",
    escrowId: "esc:deadbeef:0002",
    contractId: "oct:deadbeef:0002",
    eventLabel: "Derby",
    creator: "house",
    holder: "winner-a",
    amount: 75,
    kind: "award",
  });
  const claimed = vault.recordRelicClaim({ relicId: relic.id, amount: 75 });
  assert.equal(claimed.life.claimed, true);
  assert.equal(claimed.life.holder, "winner-a");
  assert.equal(vault.verifyFrozenCore(relic.id).ok, true);
});
