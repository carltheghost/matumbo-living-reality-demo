import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NFT_ATELIER_BOUNDARY,
  NFT_ATELIER_CONSOLE_SOURCE,
  NFT_ATELIER_SCHEMA_VERSION,
  NFT_ATELIER_SOURCE,
  NFT_ATELIER_STARTER_PIECES,
  createNftAtelier,
  hashNftAtelierSeed,
} from "../src/domains/nft-atelier.js";

const FIXED_NOW = "2026-09-18T12:00:00.000Z";

function atelier() {
  return createNftAtelier({ seed: "test-seed", now: () => FIXED_NOW });
}

test("starter set is seeded and deterministic per seed", () => {
  const first = atelier().list().map((piece) => piece.id);
  const second = atelier().list().map((piece) => piece.id);
  assert.deepEqual(first, second);
  assert.equal(first.length, NFT_ATELIER_STARTER_PIECES.length);
  const other = createNftAtelier({ seed: "different-seed", now: () => FIXED_NOW }).list().map((piece) => piece.id);
  assert.notDeepEqual(first, other);
});

test("minted pieces are frozen fictional records with no authority flags", () => {
  const studio = atelier();
  const piece = studio.mint({
    name: "  Test Relic  ",
    description: "A rehearsal piece.",
    collection: "Test Collection",
    attributes: [{ trait: "medium", value: "light" }],
  });
  assert.equal(piece.name, "Test Relic");
  assert.equal(piece.collection, "Test Collection");
  assert.equal(piece.simulation, true);
  assert.equal(piece.transferable, false);
  assert.equal(piece.valuable, false);
  assert.ok(Object.isFrozen(piece));
  assert.ok(Object.isFrozen(piece.provenance));
  assert.match(piece.id, /^nft:[0-9a-f]{8}:\d{4}$/);
  assert.ok(["common", "uncommon", "rare", "epic", "mythic"].includes(piece.rarity));
});

test("mint rejects empty names and oversized input is bounded", () => {
  const studio = atelier();
  assert.throws(() => studio.mint({ name: "   " }), TypeError);
  assert.throws(() => studio.mint({ name: "x", attributes: "nope" }), TypeError);
  const long = studio.mint({ name: "n".repeat(200), description: "d".repeat(900) });
  assert.ok(long.name.length <= 48);
  assert.ok(long.description.length <= 280);
  const many = studio.mint({ name: "attrs", attributes: Array.from({ length: 20 }, (_, i) => ({ trait: `t${i}`, value: "v" })) });
  assert.equal(many.attributes.length, 8);
});

test("inspect returns provenance and the boundary; unknown ids return null", () => {
  const studio = atelier();
  const piece = studio.list()[0];
  const view = studio.inspect(piece.id);
  assert.equal(view.piece.id, piece.id);
  assert.equal(view.boundary, NFT_ATELIER_BOUNDARY);
  assert.ok(view.provenance.some((entry) => entry.event === "minted"));
  assert.equal(studio.inspect("nft:deadbeef:0000"), null);
});

test("burn voids the piece locally and keeps a provenance trail", () => {
  const studio = atelier();
  const piece = studio.mint({ name: "Doomed" });
  const burned = studio.burn(piece.id);
  assert.equal(burned.burned, true);
  assert.ok(burned.provenance.some((entry) => entry.event === "burned"));
  assert.equal(studio.list().some((entry) => entry.id === piece.id), false);
  assert.equal(studio.list({ includeBurned: true }).some((entry) => entry.id === piece.id), true);
  assert.throws(() => studio.burn("nft:deadbeef:0000"), TypeError);
});

test("snapshot and contribution are frozen and carry no wallet/chain/transfer flags", () => {
  const studio = atelier();
  studio.mint({ name: "Extra" });
  const snapshot = studio.getSnapshot();
  assert.equal(snapshot.schemaVersion, NFT_ATELIER_SCHEMA_VERSION);
  assert.equal(snapshot.source, NFT_ATELIER_SOURCE);
  assert.equal(snapshot.simulation, true);
  assert.equal(snapshot.localOnly, true);
  assert.equal(snapshot.wallet, false);
  assert.equal(snapshot.chain, false);
  assert.equal(snapshot.transfer, false);
  assert.equal(snapshot.sale, false);
  assert.equal(snapshot.custody, false);
  assert.equal(snapshot.externalPublication, false);
  assert.ok(Object.isFrozen(snapshot));
  const contribution = studio.createContribution();
  assert.equal(contribution.source, NFT_ATELIER_SOURCE);
  assert.deepEqual(contribution.capabilities, [{ id: "nft-atelier.mint", mode: "local-rehearsal", authority: "none", executable: false }]);
  assert.ok(Object.isFrozen(contribution));
});

test("reset restores the starter set and clears minted pieces", () => {
  const studio = atelier();
  studio.mint({ name: "Temporary" });
  assert.equal(studio.list().length, NFT_ATELIER_STARTER_PIECES.length + 1);
  studio.reset();
  assert.equal(studio.list().length, NFT_ATELIER_STARTER_PIECES.length);
});

test("hashNftAtelierSeed is deterministic", () => {
  assert.equal(hashNftAtelierSeed("abc"), hashNftAtelierSeed("abc"));
  assert.notEqual(hashNftAtelierSeed("abc"), hashNftAtelierSeed("abd"));
  assert.match(hashNftAtelierSeed("abc"), /^[0-9a-f]{8}$/);
});

test("console source constant matches the feature wiring contract", () => {
  assert.equal(NFT_ATELIER_CONSOLE_SOURCE, "nft-atelier-console");
});

test("null clock uses the wall clock instead of the 1970 epoch", () => {
  const studio = createNftAtelier({ seed: "epoch-check", now: null });
  const piece = studio.mint({ name: "Epoch Check" });
  assert.ok(!piece.mintedAt.startsWith("1970-01-01"), "timestamp must not be the unix epoch");
  const year = Number(piece.mintedAt.slice(0, 4));
  assert.ok(year >= 2026, "timestamp must be the wall clock");
});
