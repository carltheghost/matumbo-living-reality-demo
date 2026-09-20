import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_LAUNCH_KIT,
  LAUNCH_KIT_DOWNLOAD_FILENAME,
  LAUNCH_KIT_FEATURES,
  LAUNCH_KIT_MAX_JSON_BYTES,
  createLaunchKit,
  serializeLaunchKit,
  summarizeLaunchKit,
  validateLaunchKit,
} from "../src/domains/launch-kit.js";

test("Launch Kit composes every local feature and fixed fictional allocation", () => {
  const summary = summarizeLaunchKit();
  assert.equal(summary.featureCount, 23);
  assert.equal(summary.allocationCount, 8);
  assert.equal(summary.registryCount, 18);
  assert.equal(summary.migrationCount, 6);
  assert.equal(summary.deferredMigrationCount, 1);
  assert.equal(summary.socialRoomCount, 4);
  assert.equal(summary.socialCreatorCardCount, 6);
  assert.equal(summary.socialDiscoverySignalCount, 6);
  assert.equal(summary.socialActionCount, 4);
  assert.equal(summary.deviceCount, 3);
  assert.equal(summary.totalSupply, 1_000_000_000);
  assert.equal(summary.totalBasisPoints, 10_000);
  assert.equal(summary.allocationClassCount, 8);
  assert.equal(summary.allocationComplete, true);
  assert.equal(summary.registryBasisPoints, 10_000);
  assert.equal(summary.registryUnits, 1_000_000_000);
  assert.equal(summary.unit, "TUMBO-SIM");
  assert.equal(summary.localOnly, true);
  assert.equal(summary.simulation, true);
  assert.equal(summary.executable, false);
  assert.equal(LAUNCH_KIT_FEATURES.length, summary.featureCount);
  assert.equal(LAUNCH_KIT_FEATURES.find((feature) => feature.id === "runtime-sync")?.route, "?panel=runtime-sync");
  assert.equal(Object.isFrozen(DEFAULT_LAUNCH_KIT), true);
});

test("Launch Kit is deterministic, serializable, and validates its frozen payload", () => {
  const first = createLaunchKit();
  const second = createLaunchKit();
  assert.deepEqual(first, second);
  const serialized = serializeLaunchKit(first);
  assert.ok(serialized.length < LAUNCH_KIT_MAX_JSON_BYTES);
  assert.equal(LAUNCH_KIT_DOWNLOAD_FILENAME, "matumbo-space-explorer-launch-kit.json");
  const parsed = JSON.parse(serialized);
  assert.deepEqual(validateLaunchKit(parsed), parsed);
  assert.equal(parsed.token.registry.every((row) => row.aggregate && row.fictional && !row.executable), true);
  assert.equal(parsed.token.allocationSummary.complete, true);
  assert.equal(parsed.token.allocationSummary.classes.length, 8);
  assert.equal(parsed.token.allocationSummary.totalBasisPoints, 10_000);
  assert.equal(parsed.token.allocationSummary.totalUnits, 1_000_000_000);
  assert.equal(parsed.token.externalDistribution, false);
  assert.equal(parsed.boundary.externalNetwork, false);
  assert.equal(parsed.boundary.persistence, false);
});

test("Launch Kit rejects malformed, unknown, executable-looking, cyclic, getter-backed, and oversized input", () => {
  assert.throws(() => validateLaunchKit(null), /launchKit must be an object/);

  const unknownSchema = JSON.parse(serializeLaunchKit());
  unknownSchema.schemaVersion = 99;
  assert.throws(() => validateLaunchKit(unknownSchema), /schemaVersion/);

  const executable = JSON.parse(serializeLaunchKit());
  executable.executable = true;
  assert.throws(() => validateLaunchKit(executable), /executable must be false/);

  const wallet = JSON.parse(serializeLaunchKit());
  wallet.token.wallet = "0xnot-accepted";
  assert.throws(() => validateLaunchKit(wallet), /wallet is not accepted/);

  const getter = JSON.parse(serializeLaunchKit());
  Object.defineProperty(getter, "updatedAt", {
    configurable: true,
    enumerable: true,
    get() {
      throw new Error("getter invoked");
    },
  });
  assert.throws(() => validateLaunchKit(getter), /getter or setter/);

  const cyclic = JSON.parse(serializeLaunchKit());
  cyclic.loop = cyclic;
  assert.throws(() => validateLaunchKit(cyclic), /cycles/);

  const oversized = JSON.parse(serializeLaunchKit());
  oversized.features = Array.from({ length: 513 }, () => oversized.features[0]);
  assert.throws(() => validateLaunchKit(oversized), /too many entries|all local routes/);
});

test("Launch Kit keeps external capabilities explicitly denied", () => {
  const kit = validateLaunchKit(DEFAULT_LAUNCH_KIT);
  const denied = kit.capabilities.filter((capability) => capability.denied === true);
  assert.equal(denied.length, 2);
  assert.equal(kit.token.walletConnection, false);
  assert.equal(kit.token.recipientAddresses, false);
  assert.equal(kit.token.issuance, false);
  assert.equal(kit.token.custody, false);
  assert.equal(kit.token.signing, false);
  assert.equal(kit.token.settlement, false);
  assert.equal(kit.token.market, false);
  assert.equal(kit.token.realMoney, false);
});
