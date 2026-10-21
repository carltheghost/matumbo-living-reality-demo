import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONTRACT_ATELIER_HOUSE_POOL_INVESTOR_PAYOUT_UNAVAILABLE,
  CONTRACT_ATELIER_HOUSE_POOL_MODES,
  CONTRACT_ATELIER_HOUSE_POOL_UNIT,
  CONTRACT_ATELIER_HOUSE_POOL_UNIT_SCALE,
  createContractAtelier,
} from "../src/domains/contract-atelier.js";

const NOW = "2026-10-13T00:00:00.000Z";

function atelier(seed = "house-pool-accounting") {
  return createContractAtelier({ seed, now: () => NOW });
}

function housePoolContract(desk, overrides = {}) {
  return desk.createContract({
    type: "pool",
    role: "house",
    topic: "custom",
    title: "Bounded house pool",
    logic: "the declared event lands",
    outcomes: ["YES", "NO"],
    housePool: { mode: "pool", capacity: 100 },
    ...overrides,
  });
}

test("house-pool contributions use exact subunits and derive fractional ownership", () => {
  const desk = atelier();
  const contract = housePoolContract(desk);

  assert.deepEqual([...CONTRACT_ATELIER_HOUSE_POOL_MODES], ["single", "pool"]);
  assert.equal(contract.housePool.unit, CONTRACT_ATELIER_HOUSE_POOL_UNIT);
  assert.equal(contract.housePool.unitScale, CONTRACT_ATELIER_HOUSE_POOL_UNIT_SCALE);
  assert.equal(contract.housePool.capacityUnits, 10_000);
  assert.equal(contract.housePool.committedCapitalUnits, 0);
  assert.equal(contract.housePool.availableCapitalUnits, 0);
  assert.equal(contract.housePool.remainingCapacityUnits, 10_000);

  desk.registerHouse({ contractId: contract.id, house: "alice", capital: "60", operationId: "alice-register" });
  desk.registerHouse({ contractId: contract.id, house: "bob", capital: "40", operationId: "bob-register" });
  const first = desk.joinHousePool({ contractId: contract.id, house: "alice", amount: "60", operationId: "alice-commit" });
  const replay = desk.joinHousePool({ contractId: contract.id, house: "alice", amount: "60", operationId: "alice-commit" });
  assert.equal(first.contributions.length, 1);
  assert.equal(replay.contributions.length, 1);

  const pool = desk.joinHousePool({ contractId: contract.id, house: "bob", amount: "40", operationId: "bob-commit" });
  assert.equal(pool.declaredCapital, 100);
  assert.equal(pool.committedCapital, 100);
  assert.equal(pool.availableCapital, 0);
  assert.equal(pool.remainingCapacity, 0);
  assert.equal(pool.totalUnits, 10_000);
  assert.deepEqual(pool.contributors.map((entry) => [entry.house, entry.units, entry.ownership]), [
    ["alice", 6_000, 0.6],
    ["bob", 4_000, 0.4],
  ]);
  assert.deepEqual(pool.contributors.map((entry) => [entry.ownershipNumerator, entry.ownershipDenominator]), [
    [6_000, 10_000],
    [4_000, 10_000],
  ]);
  assert.ok(Object.isFrozen(pool));
  assert.ok(Object.isFrozen(pool.contributors[0]));
  assert.equal(pool.contributors[0].registrationOperationId, "alice-register");
  assert.equal(pool.contributions[0].operationId, "alice-commit");
  assert.equal(pool.investorPayouts.available, false);
  assert.equal(pool.investorPayouts.reason, CONTRACT_ATELIER_HOUSE_POOL_INVESTOR_PAYOUT_UNAVAILABLE);
  assert.equal(Object.hasOwn(pool, "fee"), false);
});

test("declared capital and available capital are bounded independently of settlement", () => {
  const desk = atelier("house-pool-capacity");
  const contract = housePoolContract(desk, {
    title: "Capacity limits",
    housePool: { mode: "pool", capacity: "50" },
  });

  assert.throws(
    () => desk.registerHouse({ contractId: contract.id, house: "alice", capital: "50.001", operationId: "too-precise" }),
    /canonical decimal string/,
  );
  assert.throws(
    () => desk.registerHouse({ contractId: contract.id, house: "alice", capital: 50.01, operationId: "float-precision" }),
    /exact whole-credit number|canonical decimal string/,
  );
  assert.throws(
    () => desk.registerHouse({ contractId: contract.id, house: "alice", capital: "050", operationId: "non-canonical" }),
    /canonical decimal string/,
  );
  assert.throws(
    () => desk.registerHouse({ contractId: contract.id, house: "alice", capitalUnits: 5_001, operationId: "too-many-units" }),
    /exceeds the house-pool capacity/,
  );
  desk.registerHouse({ contractId: contract.id, house: "alice", capital: "30", operationId: "alice-register" });
  assert.throws(
    () => desk.registerHouse({ contractId: contract.id, house: "bob", capital: "20.01", operationId: "bob-register" }),
    /exceeds the house-pool capacity/,
  );
  assert.throws(
    () => desk.joinHousePool({ contractId: contract.id, house: "unregistered", amount: "1", operationId: "unregistered" }),
    /not registered/,
  );
  assert.throws(
    () => desk.joinHousePool({ contractId: contract.id, house: "alice", amount: 0.009, operationId: "subunit-rounding" }),
    /exact whole-credit number|canonical decimal string/,
  );

  desk.joinHousePool({ contractId: contract.id, house: "alice", amount: "29.99", operationId: "alice-commit" });
  assert.throws(
    () => desk.joinHousePool({ contractId: contract.id, house: "alice", amount: "0.02", operationId: "over-available" }),
    /available capital/,
  );
  const pool = desk.getHousePool(contract.id);
  assert.equal(pool.committedCapital, 29.99);
  assert.equal(pool.availableCapital, 0.01);
  assert.equal(pool.remainingCapacity, 20.01);
  assert.equal(pool.contributors[0].availableCapital, 0.01);
});

test("operation IDs bind registrations and contributions, including replay after resolution", () => {
  const desk = atelier("house-pool-guards");
  assert.throws(
    () => desk.createContract({
      type: "pool", role: "player", topic: "custom", title: "Wrong role", logic: "x",
      outcomes: ["YES", "NO"], housePool: { mode: "pool", capacity: 10 },
    }),
    /requires the house role/,
  );
  const contract = housePoolContract(desk, {
    title: "Single provider",
    housePool: { mode: "single", capacity: "10" },
  });
  assert.throws(
    () => desk.registerHouse({ contractId: contract.id, house: "alice", capital: "10" }),
    /operationId must be a non-empty string/,
  );
  desk.registerHouse({ contractId: contract.id, house: "alice", capital: "10", operationId: "register-alice" });
  const registrationReplay = desk.registerHouse({ contractId: contract.id, house: "alice", capital: "10", operationId: "register-alice" });
  assert.equal(registrationReplay.contributors.length, 1);
  assert.throws(
    () => desk.registerHouse({ contractId: contract.id, house: "bob", capital: "1", operationId: "register-bob" }),
    /single house pools accept one/,
  );
  assert.throws(
    () => desk.joinHousePool({ contractId: contract.id, house: "alice", amount: "2" }),
    /operationId must be a non-empty string/,
  );
  assert.throws(
    () => desk.joinHousePool({ contractId: contract.id, house: "alice", amount: "2", operationId: "register-alice" }),
    /different house-contribution parameters/,
  );
  desk.joinHousePool({ contractId: contract.id, house: "alice", amount: "2", operationId: "contribute-alice" });
  assert.throws(
    () => desk.joinHousePool({ contractId: contract.id, house: "alice", amount: "3", operationId: "contribute-alice" }),
    /different house-contribution parameters/,
  );
  assert.throws(
    () => desk.registerHouse({ contractId: contract.id, house: "h".repeat(65), capital: "1", operationId: "long-house" }),
    /house must be at most 64 characters/,
  );
  assert.throws(
    () => desk.joinHousePool({ contractId: contract.id, house: "alice", amount: "1", operationId: "o".repeat(129) }),
    /operationId must be at most 128 characters/,
  );
  desk.placeStake({ contractId: contract.id, side: "YES", amount: 5 });
  const resolved = desk.resolveContract({ contractId: contract.id, facts: { "the declared event lands": true } });
  assert.equal(resolved.resolution.housePool.committedCapital, 2);
  assert.equal(resolved.resolution.housePool.investorPayouts.available, false);
  const contributionReplayAfterResolution = desk.joinHousePool({
    contractId: contract.id,
    house: "alice",
    amount: "2",
    operationId: "contribute-alice",
  });
  const registrationReplayAfterResolution = desk.registerHouse({
    contractId: contract.id,
    house: "alice",
    capital: "10",
    operationId: "register-alice",
  });
  assert.equal(contributionReplayAfterResolution.committedCapital, 2);
  assert.equal(registrationReplayAfterResolution.committedCapital, 2);
  assert.throws(
    () => desk.joinHousePool({ contractId: contract.id, house: "alice", amount: "1", operationId: "new-after-resolution" }),
    /closed after resolution/,
  );
});

test("house-pool state is present in local projections and reset clears the session state", () => {
  const desk = atelier("house-pool-projection");
  const contract = housePoolContract(desk, { title: "Projection" });
  desk.registerHouse({ contractId: contract.id, house: "alice", capitalUnits: 1_000, operationId: "projection-register" });
  desk.joinHousePool({ contractId: contract.id, house: "alice", amountUnits: 400, operationId: "projection-commit" });

  const snapshot = desk.getSnapshot();
  const summary = snapshot.contracts.find((entry) => entry.id === contract.id);
  assert.equal(summary.housePool.committedCapital, 4);
  const contribution = desk.createContribution();
  const entity = contribution.entities.find((entry) => entry.id === contract.id);
  assert.equal(entity.housePool.totalUnits, 400);
  assert.ok(contribution.capabilities.some((entry) => entry.id === "contract-atelier.house-pool-accounting"));
  assert.equal(contribution.boundary.includes("investor payouts are unavailable"), true);
  assert.equal(snapshot.localOnly, true);

  desk.reset();
  assert.equal(desk.list().some((entry) => entry.id === contract.id), false);
  assert.throws(() => desk.getHousePool(contract.id), /unknown contract id/);
});
