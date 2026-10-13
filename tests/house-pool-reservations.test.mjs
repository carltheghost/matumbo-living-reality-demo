import test from "node:test";
import assert from "node:assert/strict";

import { createTokenEngine } from "../src/domains/token.js";
import { LedgerStore } from "../src/domains/token-store.js";
import {
  EconomyIdempotencyError,
  EconomyStaleStateError,
  EconomyStateError,
  createSimulatedEconomy,
} from "../src/domains/simulated-economy.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
    this.failWrites = false;
  }

  getItem(key) { return this.values.get(key) ?? null; }

  setItem(key, value) {
    if (this.failWrites) throw new Error("simulated persistence failure");
    this.values.set(key, String(value));
  }

  removeItem(key) { this.values.delete(key); }
}

function withLocalStorage(storage, callback) {
  const hadStorage = Object.prototype.hasOwnProperty.call(globalThis, "localStorage");
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: storage });
  try {
    return callback();
  } finally {
    if (hadStorage) Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: previous });
    else delete globalThis.localStorage;
  }
}

function fixture({ storage = null, seed = "house-pool", now = () => "2026-10-13T00:00:00.000Z" } = {}) {
  const engine = createTokenEngine();
  for (const [account, amount] of [["u:you", 20_000], ["u:alice", 12_000], ["u:bob", 12_000]]) {
    engine.faucet(account, "TUMBO", amount, { idempotencyKey: `fixture:house-pool:${seed}:${account}` });
  }
  const economy = createSimulatedEconomy({ engine, storage, now });
  return { engine, economy };
}

function createPool(economy, overrides = {}) {
  return economy.createHousePool({
    name: "Local house pool",
    capacityFluff: 10_000,
    idempotencyKey: "house-pool:create",
    ...overrides,
  });
}

test("house-pool reservations use TUMBO fluff, exact proportional units, and escrow conservation", () => {
  const { engine, economy } = fixture();
  const created = createPool(economy);
  const first = economy.reserveHousePoolContribution({
    poolId: created.pool.id,
    contributor: "alice",
    amountFluff: 4_000,
    expectedRevision: 0,
    idempotencyKey: "house-pool:reserve:alice",
  });
  const second = economy.reserveHousePoolContribution({
    poolId: created.pool.id,
    contributor: "bob",
    amountFluff: 6_000,
    expectedRevision: 1,
    idempotencyKey: "house-pool:reserve:bob",
  });

  assert.equal(first.contribution.status, "reserved");
  assert.equal(first.balances.available.TUMBO, 8_000);
  assert.equal(second.balances.available.TUMBO, 6_000);
  assert.equal(second.pool.asset, "TUMBO");
  assert.equal(second.pool.unit, "integer fluff");
  assert.equal(second.pool.totalUnits, 10_000);
  assert.equal(second.pool.availableCapacityFluff, 0);
  assert.deepEqual(second.pool.contributors.map((entry) => [entry.account, entry.units, entry.ownershipNumerator, entry.ownershipDenominator]), [
    ["u:alice", 4_000, 4_000, 10_000],
    ["u:bob", 6_000, 6_000, 10_000],
  ]);
  assert.deepEqual(engine.ledger._journals.at(-2).postings, [
    { account: "u:alice", asset: "TUMBO", amount: -4_000 },
    { account: "sys:escrow", asset: "TUMBO", amount: 4_000 },
  ]);
  assert.deepEqual(engine.ledger._journals.at(-1).postings, [
    { account: "u:bob", asset: "TUMBO", amount: -6_000 },
    { account: "sys:escrow", asset: "TUMBO", amount: 6_000 },
  ]);
  assert.ok(economy.receipts().every((receipt) => economy.engine.ledger.verifyReceipt(receipt.id).ok));
  assert.equal(economy.verify().ok, true);
  assert.equal(economy.verify().escrow.TUMBO, 10_000);
});

test("house-pool capacity and available-balance failures do not post receipts", () => {
  const { engine, economy } = fixture();
  const created = createPool(economy, { capacityFluff: 5_000, idempotencyKey: "house-pool:create:limits" });
  assert.throws(() => economy.reserveHousePoolContribution({
    poolId: created.pool.id, contributor: "alice", amountFluff: 1.5,
    idempotencyKey: "house-pool:limits:fractional",
  }), /safe integer/);
  assert.throws(() => economy.reserveHousePoolContribution({
    poolId: created.pool.id, contributor: "alice", amountFluff: "1000",
    idempotencyKey: "house-pool:limits:string",
  }), /safe integer/);
  const first = economy.reserveHousePoolContribution({
    poolId: created.pool.id, contributor: "alice", amountFluff: 4_000,
    idempotencyKey: "house-pool:limits:first",
  });
  const journalCount = engine.ledger.journalCount();
  assert.throws(() => economy.reserveHousePoolContribution({
    poolId: created.pool.id, contributor: "bob", amountFluff: 2_000,
    expectedRevision: first.pool.revision, idempotencyKey: "house-pool:limits:capacity",
  }), (error) => error.code === "CAPACITY_EXCEEDED");
  assert.equal(engine.ledger.journalCount(), journalCount);
  assert.throws(() => economy.reserveHousePoolContribution({
    poolId: created.pool.id, contributor: "alice", amountFluff: 20_001,
    expectedRevision: first.pool.revision, idempotencyKey: "house-pool:limits:balance",
  }), (error) => error.code === "CAPACITY_EXCEEDED");
  assert.equal(engine.ledger.journalCount(), journalCount);
  const balancePool = createPool(economy, { name: "Balance pool", capacityFluff: 30_000, idempotencyKey: "house-pool:create:balance" });
  assert.throws(() => economy.reserveHousePoolContribution({
    poolId: balancePool.pool.id, contributor: "alice", amountFluff: 20_001,
    idempotencyKey: "house-pool:limits:balance-only",
  }), /insufficient funds/);
  assert.equal(economy.verify().ok, true);
});

test("stale house-pool revisions fail closed without consuming the request key", () => {
  const { engine, economy } = fixture();
  const created = createPool(economy);
  const first = economy.reserveHousePoolContribution({
    poolId: created.pool.id, contributor: "alice", amountFluff: 1_000,
    expectedRevision: 0, idempotencyKey: "house-pool:stale-tab:first",
  });
  const journalCount = engine.ledger.journalCount();
  assert.throws(() => economy.reserveHousePoolContribution({
    poolId: created.pool.id, contributor: "bob", amountFluff: 1_000,
    expectedRevision: 0, idempotencyKey: "house-pool:stale-tab:stale",
  }), (error) => error instanceof EconomyStaleStateError && error.code === "STALE_STATE");
  assert.equal(engine.ledger.journalCount(), journalCount);
  const second = economy.reserveHousePoolContribution({
    poolId: created.pool.id, contributor: "bob", amountFluff: 1_000,
    expectedRevision: first.pool.revision, idempotencyKey: "house-pool:stale-tab:retry",
  });
  assert.equal(second.pool.totalUnits, 2_000);
  assert.equal(economy.verify().ok, true);
});

test("duplicate and conflicting requests are request-hash bound", () => {
  const { engine, economy } = fixture();
  const created = createPool(economy);
  const createdReplay = createPool(economy);
  assert.deepEqual(createdReplay, created);
  assert.equal(engine.ledger.journalCount(), 8);
  assert.throws(() => economy.createHousePool({
    name: "Other pool", capacityFluff: 10_000, idempotencyKey: "house-pool:create",
  }), EconomyIdempotencyError);

  const reserved = economy.reserveHousePoolContribution({
    poolId: created.pool.id, contributor: "alice", amountFluff: 1_000,
    idempotencyKey: "house-pool:duplicate",
  });
  const journalCount = engine.ledger.journalCount();
  assert.deepEqual(economy.reserveHousePoolContribution({
    poolId: created.pool.id, contributor: "alice", amountFluff: 1_000,
    idempotencyKey: "house-pool:duplicate",
  }), reserved);
  assert.equal(engine.ledger.journalCount(), journalCount);
  assert.throws(() => economy.reserveHousePoolContribution({
    poolId: created.pool.id, contributor: "alice", amountFluff: 1_001,
    idempotencyKey: "house-pool:duplicate",
  }), EconomyIdempotencyError);
});

test("owners can release only reserved contributions and replay the balanced release", () => {
  const { engine, economy } = fixture();
  const created = createPool(economy);
  const reserved = economy.reserveHousePoolContribution({
    poolId: created.pool.id, contributor: "alice", amountFluff: 3_000,
    idempotencyKey: "house-pool:release:reserve",
  });
  const beforeRelease = engine.balance("u:alice", "TUMBO");
  const journalCount = engine.ledger.journalCount();
  assert.throws(() => economy.releaseHousePoolContribution({
    poolId: created.pool.id, contributionId: reserved.contribution.id, actor: "bob",
    expectedRevision: reserved.pool.revision, idempotencyKey: "house-pool:release:not-owner",
  }), (error) => error.code === "NOT_OWNER");
  assert.equal(engine.ledger.journalCount(), journalCount);

  const released = economy.releaseHousePoolContribution({
    poolId: created.pool.id, contributionId: reserved.contribution.id, actor: "alice",
    expectedRevision: reserved.pool.revision, idempotencyKey: "house-pool:release",
  });
  assert.equal(released.contribution.status, "released");
  assert.equal(released.balances.available.TUMBO, beforeRelease + 3_000);
  assert.equal(released.pool.totalUnits, 0);
  assert.equal(released.pool.availableCapacityFluff, 10_000);
  const releaseReceipt = engine.ledger._journals.at(-1);
  assert.deepEqual(releaseReceipt.postings, [
    { account: "sys:escrow", asset: "TUMBO", amount: -3_000 },
    { account: "u:alice", asset: "TUMBO", amount: 3_000 },
  ]);
  assert.equal(releaseReceipt.links.reversesReceiptId, reserved.receiptId);
  const afterReleaseJournals = engine.ledger.journalCount();
  assert.deepEqual(economy.releaseHousePoolContribution({
    poolId: created.pool.id, contributionId: reserved.contribution.id, actor: "alice",
    expectedRevision: reserved.pool.revision, idempotencyKey: "house-pool:release",
  }), released);
  assert.equal(engine.ledger.journalCount(), afterReleaseJournals);
  assert.throws(() => economy.releaseHousePoolContribution({
    poolId: created.pool.id, contributionId: reserved.contribution.id, actor: "alice",
    idempotencyKey: "house-pool:release:again",
  }), EconomyStateError);
  assert.equal(economy.verify().ok, true);
  assert.equal(economy.verify().escrow.TUMBO, 0);
});

test("commitment is an owner-only lock with no payout or release lifecycle", () => {
  const { engine, economy } = fixture();
  const created = createPool(economy);
  const reserved = economy.reserveHousePoolContribution({
    poolId: created.pool.id, contributor: "alice", amountFluff: 2_000,
    idempotencyKey: "house-pool:commit:reserve",
  });
  const balance = engine.balance("u:alice", "TUMBO");
  assert.throws(() => economy.commitHousePoolContribution({
    poolId: created.pool.id, contributionId: reserved.contribution.id, actor: "bob",
    outcomeId: "outcome:yes", expectedRevision: reserved.pool.revision,
    idempotencyKey: "house-pool:commit:not-owner",
  }), (error) => error.code === "NOT_OWNER");
  const committed = economy.commitHousePoolContribution({
    poolId: created.pool.id, contributionId: reserved.contribution.id, actor: "alice",
    outcomeId: "outcome:yes", expectedRevision: reserved.pool.revision,
    idempotencyKey: "house-pool:commit",
  });
  assert.equal(committed.contribution.status, "committed");
  assert.equal(committed.contribution.commitment.outcomeId, "outcome:yes");
  assert.equal(engine.balance("u:alice", "TUMBO"), balance);
  assert.equal(committed.pool.committedFluff, 2_000);
  assert.equal(committed.pool.investorPayouts.available, false);
  assert.throws(() => economy.releaseHousePoolContribution({
    poolId: created.pool.id, contributionId: reserved.contribution.id, actor: "alice",
    idempotencyKey: "house-pool:commit:release",
  }), EconomyStateError);
  const journalCount = engine.ledger.journalCount();
  assert.deepEqual(economy.commitHousePoolContribution({
    poolId: created.pool.id, contributionId: reserved.contribution.id, actor: "alice",
    outcomeId: "outcome:yes", expectedRevision: reserved.pool.revision,
    idempotencyKey: "house-pool:commit",
  }), committed);
  assert.equal(engine.ledger.journalCount(), journalCount);
  assert.throws(() => economy.commitHousePoolContribution({
    poolId: created.pool.id, contributionId: reserved.contribution.id, actor: "alice",
    outcomeId: "outcome:no", idempotencyKey: "house-pool:commit",
  }), EconomyIdempotencyError);
  assert.equal(economy.verify().escrow.TUMBO, 2_000);
});

test("house-pool reservations survive reload and preserve operation replays", () => {
  const storage = new MemoryStorage();
  const first = fixture({ storage });
  const created = createPool(first.economy);
  const reserved = first.economy.reserveHousePoolContribution({
    poolId: created.pool.id, contributor: "alice", amountFluff: 2_500,
    idempotencyKey: "house-pool:reload:reserve",
  });
  const journalCount = first.engine.ledger.journalCount();
  const second = createSimulatedEconomy({ engine: createTokenEngine(), storage, now: () => "2026-10-13T00:00:00.000Z" });
  assert.equal(second.storageStatus, "restored-local-snapshot");
  assert.deepEqual(second.getHousePool(created.pool.id), reserved.pool);
  assert.equal(second.engine.balance("u:alice", "TUMBO"), 9_500);
  assert.deepEqual(second.reserveHousePoolContribution({
    poolId: created.pool.id, contributor: "alice", amountFluff: 2_500,
    idempotencyKey: "house-pool:reload:reserve",
  }), reserved);
  assert.equal(second.engine.ledger.journalCount(), journalCount);
  assert.equal(second.verify().ok, true);
});

test("stale economy wrappers reject house-pool writes before changing canonical escrow", () => {
  const canonicalStorage = new MemoryStorage();
  withLocalStorage(canonicalStorage, () => {
    const storageA = new MemoryStorage();
    const first = fixture({ storage: storageA });
    const created = createPool(first.economy);
    const storageB = new MemoryStorage();
    storageB.setItem("matumbo.simulated-economy.v1", storageA.getItem("matumbo.simulated-economy.v1"));
    const second = createSimulatedEconomy({ engine: createTokenEngine(), storage: storageB });
    const committed = second.reserveHousePoolContribution({
      poolId: created.pool.id, contributor: "alice", amountFluff: 1_000,
      idempotencyKey: "house-pool:stale:second",
    });
    const canonical = LedgerStore.load();
    const canonicalJournals = canonical.ledger.journalCount();
    const canonicalEscrow = canonical.balance("sys:escrow", "TUMBO");
    assert.equal(committed.pool.totalUnits, 1_000);
    assert.throws(() => first.economy.reserveHousePoolContribution({
      poolId: created.pool.id, contributor: "bob", amountFluff: 1_000,
      idempotencyKey: "house-pool:stale:first",
    }), (error) => error instanceof EconomyStaleStateError && error.code === "STALE_STATE");
    const after = LedgerStore.load();
    assert.equal(after.ledger.journalCount(), canonicalJournals);
    assert.equal(after.balance("sys:escrow", "TUMBO"), canonicalEscrow);
  });
});

test("failed persistence retains exact in-memory receipts without duplicating a reservation", () => {
  const storage = new MemoryStorage();
  const { engine, economy } = fixture({ storage });
  const created = createPool(economy);
  storage.failWrites = true;
  const reserved = economy.reserveHousePoolContribution({
    poolId: created.pool.id, contributor: "alice", amountFluff: 1_500,
    idempotencyKey: "house-pool:persistence:reserve",
  });
  assert.equal(economy.storageStatus, "storage-unavailable");
  const journalCount = engine.ledger.journalCount();
  assert.deepEqual(economy.reserveHousePoolContribution({
    poolId: created.pool.id, contributor: "alice", amountFluff: 1_500,
    idempotencyKey: "house-pool:persistence:reserve",
  }), reserved);
  assert.equal(engine.ledger.journalCount(), journalCount);
  assert.equal(economy.verify().ok, true);
});

test("legacy economy snapshots without housePools restore with an empty registry", () => {
  const storage = new MemoryStorage();
  const first = fixture({ storage });
  first.economy.createContract({ title: "Legacy-compatible snapshot", idempotencyKey: "house-pool:legacy:contract" });
  const raw = JSON.parse(storage.getItem("matumbo.simulated-economy.v1"));
  delete raw.state.housePools;
  delete raw.commit;
  storage.setItem("matumbo.simulated-economy.v1", JSON.stringify(raw));
  const restored = createSimulatedEconomy({ engine: createTokenEngine(), storage });
  assert.deepEqual(restored.housePools(), []);
  assert.equal(restored.verify().ok, true);
});
