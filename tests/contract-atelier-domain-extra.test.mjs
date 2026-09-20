import assert from "node:assert/strict";
import { test } from "node:test";
import { createContractAtelier } from "../src/domains/contract-atelier.js";

const FIXED_NOW = "2026-09-18T12:00:00.000Z";

function atelier(seed = "domain-extra") {
  return createContractAtelier({ seed, now: () => FIXED_NOW });
}

test("pool resolving to outcomes[1] splits the pool pro-rata among winning stakes", () => {
  const desk = atelier();
  const contract = desk.createContract({
    type: "pool",
    role: "player",
    topic: "weather",
    title: "Rain pool",
    logic: "rain falls this afternoon",
    outcomes: ["RAIN", "DRY"],
  });
  desk.placeStake({ contractId: contract.id, side: "RAIN", amount: 60 });
  desk.placeStake({ contractId: contract.id, side: "DRY", amount: 30 });
  desk.placeStake({ contractId: contract.id, side: "DRY", amount: 10 });
  // Facts are empty, so the proposition reads false → outcomes[1] ("DRY") wins.
  const resolved = desk.resolveContract({ contractId: contract.id, facts: {} });
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.resolution.winningSide, "DRY");
  assert.equal(resolved.resolution.payouts.length, 2);
  assert.equal(resolved.resolution.payouts[0].amount, 75);
  assert.equal(resolved.resolution.payouts[1].amount, 25);
  const paid = resolved.resolution.payouts.reduce((sum, payout) => sum + payout.amount, 0);
  assert.equal(paid, 100);
  assert.ok(resolved.resolution.payouts.every((payout) => payout.side === "DRY"));
});

test("binary create with three outcomes throws", () => {
  assert.throws(
    () => atelier().createContract({
      type: "binary",
      role: "player",
      topic: "sports",
      title: "Three ways",
      logic: "x",
      outcomes: ["A", "B", "C"],
    }),
    /exactly two distinct outcomes/
  );
});

test("multi create with seven outcomes throws; null outcomes throws", () => {
  assert.throws(
    () => atelier().createContract({
      type: "multi",
      role: "house",
      topic: "politics",
      title: "Too many",
      logic: "x",
      outcomes: ["A", "B", "C", "D", "E", "F", "G"],
    }),
    /multi contracts need 2–6 distinct outcomes/
  );
  assert.throws(
    () => atelier().createContract({
      type: "multi",
      role: "house",
      topic: "politics",
      title: "No outcomes",
      logic: "x",
      outcomes: null,
    }),
    /need an explicit outcomes list/
  );
});

test("stake amounts are rounded to the cent by the domain rule", () => {
  const desk = atelier();
  const contract = desk.createContract({
    type: "binary",
    role: "player",
    topic: "sports",
    title: "Rounding",
    logic: "x",
  });
  assert.equal(desk.placeStake({ contractId: contract.id, side: "YES", amount: 10.005 }).amount, 10.01);
  assert.equal(desk.placeStake({ contractId: contract.id, side: "YES", amount: 10.456 }).amount, 10.46);
  assert.equal(desk.placeStake({ contractId: contract.id, side: "YES", amount: 10.454 }).amount, 10.45);
});

test("stake of exactly 10000 is accepted; 10000.01 is rejected", () => {
  const desk = atelier();
  const contract = desk.createContract({
    type: "binary",
    role: "player",
    topic: "sports",
    title: "Cap",
    logic: "x",
  });
  const stake = desk.placeStake({ contractId: contract.id, side: "YES", amount: 10000 });
  assert.equal(stake.amount, 10000);
  assert.throws(
    () => desk.placeStake({ contractId: contract.id, side: "YES", amount: 10000.01 }),
    /may not exceed/
  );
});

test("get() with an unknown id returns null", () => {
  assert.equal(atelier().get("ctr:deadbeef:9999"), null);
  assert.equal(atelier().get(""), null);
});
