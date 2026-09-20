import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_MERGE4_SNAPSHOT,
  MERGE4_SNAPSHOT_ADAPTER_SOURCE,
  MERGE4_SNAPSHOT_BOUNDARY,
  adaptMerge4Snapshot,
  serializeMerge4Snapshot,
  summarizeMerge4Snapshot,
  validateMerge4Snapshot,
} from "../src/domains/merge4-snapshot-adapter.js";

test("Merge 4 fixture maps deterministically to a frozen local projection envelope", () => {
  const first = adaptMerge4Snapshot(DEFAULT_MERGE4_SNAPSHOT);
  const second = adaptMerge4Snapshot(JSON.parse(serializeMerge4Snapshot(DEFAULT_MERGE4_SNAPSHOT)));
  assert.equal(first.valid, true);
  assert.equal(first.adapted, true);
  assert.deepEqual(second.mapping.envelope, first.mapping.envelope);
  assert.equal(first.mapping.envelope.simulation, true);
  assert.equal(first.mapping.envelope.authority, "none");
  assert.equal(first.mapping.contribution.source, MERGE4_SNAPSHOT_ADAPTER_SOURCE);
  assert.equal(first.mapping.contribution.entities.length >= 7, true);
  assert.equal(first.mapping.contribution.capabilities.some((entry) => entry.enabled === false), true);
  assert.equal(first.deferred.length >= 3, true);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.mapping.envelope), true);
});

test("adapter validates balanced ledger and preserves caller input", () => {
  const source = JSON.parse(serializeMerge4Snapshot(DEFAULT_MERGE4_SNAPSHOT));
  const before = JSON.stringify(source);
  const result = validateMerge4Snapshot(source);
  assert.equal(result.valid, true);
  assert.equal(result.worldId, "demo");
  assert.equal(result.version, 3);
  assert.equal(JSON.stringify(source), before);

  source.state.ledger[1].amount = 11;
  const rejected = adaptMerge4Snapshot(source);
  assert.equal(rejected.valid, false);
  assert.equal(rejected.adapted, false);
  assert.equal(rejected.errors.some((error) => error.code === "ledger-unbalanced"), true);
  assert.equal(rejected.externalNetwork, false);
  assert.equal(rejected.persistence, false);
});

test("adapter rejects getters, cycles, executable fields, and oversized collections without invoking them", () => {
  let getterCalled = false;
  const getterFixture = JSON.parse(serializeMerge4Snapshot(DEFAULT_MERGE4_SNAPSHOT));
  Object.defineProperty(getterFixture.state.fabric.entities["entity:origin"], "script", {
    enumerable: true,
    get() { getterCalled = true; return "alert(1)"; },
  });
  const getterResult = validateMerge4Snapshot(getterFixture);
  assert.equal(getterCalled, false);
  assert.equal(getterResult.valid, false);
  assert.equal(getterResult.errors.some((error) => error.code === "forbidden-field"), true);

  const cyclic = JSON.parse(serializeMerge4Snapshot(DEFAULT_MERGE4_SNAPSHOT));
  cyclic.self = cyclic;
  const cyclicResult = validateMerge4Snapshot(cyclic);
  assert.equal(cyclicResult.valid, false);
  assert.equal(cyclicResult.errors.some((error) => error.code === "cyclic-value"), true);

  const oversized = JSON.parse(serializeMerge4Snapshot(DEFAULT_MERGE4_SNAPSHOT));
  oversized.state.events = Array.from({ length: 513 }, (_, index) => ({ id: `event:${index}`, type: "FIXTURE" }));
  const oversizedResult = validateMerge4Snapshot(oversized);
  assert.equal(oversizedResult.valid, false);
  assert.equal(oversizedResult.errors.some((error) => error.code === "collection-too-large"), true);
});

test("summary and boundary remain explicit about server and economic authority", () => {
  const summary = summarizeMerge4Snapshot(DEFAULT_MERGE4_SNAPSHOT);
  assert.equal(summary.source, MERGE4_SNAPSHOT_ADAPTER_SOURCE);
  assert.equal(summary.valid, true);
  assert.equal(summary.adapted, true);
  assert.equal(summary.boundary, MERGE4_SNAPSHOT_BOUNDARY);
  assert.equal(summary.externalImport, false);
  assert.equal(summary.externalTransfer, false);
  assert.equal(summary.executable, false);
});
