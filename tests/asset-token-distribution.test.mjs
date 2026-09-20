import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  DEFAULT_LAUNCH_DISTRIBUTION_PREVIEW,
  DEFAULT_RECIPIENT_DEFINITIONS,
  DISTRIBUTION_REHEARSAL_ACTION_ID,
  DISTRIBUTION_REGISTRY_SOURCE,
  createLaunchDistributionRehearsal,
  createLaunchDistributionPreview,
  summarizeDistributionRegistry,
} from "../src/domains/distribution-registry.js";

test("launch preview covers every fictional recipient cohort and reconciles exactly", () => {
  const preview = DEFAULT_LAUNCH_DISTRIBUTION_PREVIEW;
  assert.equal(preview.source, DISTRIBUTION_REGISTRY_SOURCE);
  assert.equal(preview.simulation, true);
  assert.equal(preview.externalDistribution, false);
  assert.equal(preview.registry.length, DEFAULT_RECIPIENT_DEFINITIONS.length);
  assert.equal(preview.records.length, DEFAULT_RECIPIENT_DEFINITIONS.length);
  assert.equal(preview.registry.reduce((sum, row) => sum + row.shareBasisPoints, 0), 10_000);
  assert.equal(preview.records.reduce((sum, row) => sum + row.tokenUnits, 0), 1_000_000_000);
  const reconciliation = preview.evidence.find((item) => item.kind === "recipient-registry-reconciliation");
  assert.equal(reconciliation?.basisPoints, 10_000);
  assert.equal(reconciliation?.tokenUnits, 1_000_000_000);
  assert.equal(reconciliation?.status, "verified");
});

test("default token and distribution projections use the current release timestamp", async () => {
  const assetSource = await readFile(new URL("../src/domains/asset-token.js", import.meta.url), "utf8");
  const registrySource = await readFile(new URL("../src/domains/distribution-registry.js", import.meta.url), "utf8");
  assert.match(assetSource, /ASSET_TOKEN_UPDATED_AT\s*=\s*["']2026-09-03T00:00:00\.000Z/);
  assert.match(registrySource, /DISTRIBUTION_UPDATED_AT\s*=\s*["']2026-09-03T00:00:00\.000Z/);
});

test("allocation summary exposes every class and reconciles against the same registry rows", () => {
  const preview = DEFAULT_LAUNCH_DISTRIBUTION_PREVIEW;
  const summary = summarizeDistributionRegistry(preview.registry);
  assert.equal(summary.complete, true);
  assert.equal(summary.allocationCount, 8);
  assert.equal(summary.registryRowCount, 18);
  assert.equal(summary.totalBasisPoints, 10_000);
  assert.equal(summary.expectedBasisPoints, 10_000);
  assert.equal(summary.totalUnits, 1_000_000_000);
  assert.equal(summary.expectedUnits, 1_000_000_000);
  assert.equal(summary.classes.every((allocation) => allocation.complete), true);
  const labels = summary.classes.map((allocation) => allocation.label.toLowerCase()).join(" | ");
  for (const required of ["county", "organisation", "international", "grant", "treasury", "operations"]) {
    assert.match(labels, new RegExp(required), `summary includes ${required} allocation class`);
  }
  assert.deepEqual(
    summary.classes.map((allocation) => allocation.tokenUnits),
    preview.allocations?.map((allocation) => allocation.tokenUnits)
      ?? [250_000_000, 200_000_000, 150_000_000, 150_000_000, 100_000_000, 100_000_000, 30_000_000, 20_000_000],
  );
  assert.ok(preview.allocationSummary);
  assert.deepEqual(preview.allocationSummary, summary);
});

test("launch preview is deterministic and replay-safe", () => {
  const first = createLaunchDistributionPreview({ updatedAt: "2025-01-01T00:00:00.000Z" });
  const second = createLaunchDistributionPreview({ updatedAt: "2025-01-01T00:00:00.000Z" });
  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.equal(first.launchEvent.id, "distribution-event:tumbo-demo-launch");
  assert.equal(first.records.every((record) => record.status === "simulated"), true);
});

test("explicit launch rehearsal checks every aggregate registry row and class", () => {
  const rehearsal = createLaunchDistributionRehearsal({ method: "button" });
  assert.equal(rehearsal.actionId, DISTRIBUTION_REHEARSAL_ACTION_ID);
  assert.equal(rehearsal.status, "reconciled");
  assert.equal(rehearsal.registryComplete, true);
  assert.equal(rehearsal.registryEntryCount, 18);
  assert.equal(rehearsal.allocationClassCount, 8);
  assert.equal(rehearsal.completeClassCount, 8);
  assert.equal(rehearsal.totalBasisPoints, 10_000);
  assert.equal(rehearsal.totalUnits, 1_000_000_000);
  assert.equal(rehearsal.totalSupply, 1_000_000_000);
  assert.equal(rehearsal.classChecks.length, 8);
  assert.equal(rehearsal.registryEntryIds.length, 18);
  assert.equal(rehearsal.classChecks.every((entry) => entry.complete && entry.aggregate && entry.executable === false), true);
  assert.equal(rehearsal.externalDistribution, false);
  assert.equal(rehearsal.externalTransfer, false);
  assert.equal(rehearsal.walletConnection, false);
  assert.equal(rehearsal.custody, false);
  assert.equal(rehearsal.signing, false);
  assert.equal(rehearsal.settlement, false);
  assert.equal(rehearsal.issuance, false);
  assert.equal(rehearsal.money, false);
  assert.equal(rehearsal.localOnly, true);
  assert.equal(Object.isFrozen(rehearsal), true);
  assert.equal(Object.isFrozen(rehearsal.classChecks), true);
  assert.match(rehearsal.boundary, /no issuance/i);
  assert.match(rehearsal.boundary, /no recipient address/i);
});

test("distribution records stay aggregate and contain no recipient authority fields", () => {
  const preview = DEFAULT_LAUNCH_DISTRIBUTION_PREVIEW;
  for (const record of [...preview.registry, ...preview.records]) {
    assert.equal(record.aggregate, true);
    assert.equal(record.fictional, true);
    assert.equal(record.externalTransfer, false);
    assert.equal(record.executable, false);
    for (const forbidden of ["address", "wallet", "key", "signature", "privateKey", "recipientAddress"]) {
      assert.equal(Object.prototype.hasOwnProperty.call(record, forbidden), false, `${forbidden} must not be present`);
    }
  }
  assert.ok(preview.capabilities.some((capability) => capability.id === "distribution.external-transfer" && capability.denied === true));
  assert.ok(preview.capabilities.some((capability) => capability.id === "distribution.wallet-custody" && capability.denied === true));
  assert.ok(preview.capabilities.some((capability) => capability.id === "distribution.signing-settlement" && capability.denied === true));
});
