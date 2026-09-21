import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { FEATURE_DEFINITIONS } from "../src/render/feature-navigator.js";

const DOCS = [
  "docs/PRODUCT_AUDIT_PLAN.md",
  "docs/INTEGRATION_MATRIX.md",
  "docs/LAUNCH_KIT.md",
  "docs/DEVICE_PROJECTION.md",
  "docs/BLOCK_WORLD_MIGRATION.md",
  "docs/LIVE_GATEWAY_EVIDENCE.md",
  "docs/CURRENT_STATE.md",
];

test("project-map documents track current source-of-truth state without frozen history", async () => {
  const documents = Object.fromEntries(await Promise.all(DOCS.map(async (file) => [
    file,
    await readFile(new URL(`../${file}`, import.meta.url), "utf8"),
  ])));

  const featureIds = FEATURE_DEFINITIONS.map((feature) => feature.id);
  assert.ok(featureIds.length > 0);
  assert.equal(new Set(featureIds).size, featureIds.length);

  const launchKit = documents["docs/LAUNCH_KIT.md"];
  const integration = documents["docs/INTEGRATION_MATRIX.md"];
  const current = documents["docs/CURRENT_STATE.md"];

  assert.match(launchKit, /Launch Kit/);
  assert.match(integration, /INTEGRATION MATRIX/);
  assert.match(current, /Current|current/);

  // Historical packet receipts may remain in dated documents. The consistency
  // test intentionally does not freeze suite counts, route counts, or packet ids.
  assert.match(documents["docs/DEVICE_PROJECTION.md"], /GAZE LOCK/);
  assert.match(documents["docs/DEVICE_PROJECTION.md"], /Grab → one-step Hold → Place\\/Release/);
  assert.match(documents["docs/BLOCK_WORLD_MIGRATION.md"], /finite 19-destination registry/);
  assert.match(documents["docs/BLOCK_WORLD_MIGRATION.md"], /3-D \/ 4-D \/ 5-D/);
  assert.match(documents["docs/LIVE_GATEWAY_EVIDENCE.md"], /seven per-surface controls/);

  // The continuity queue is optional. If it exists in a checkout, it is
  // historical continuity data rather than a required project-map artifact.
  const continuityPath = new URL("../.tumbo/continuity/NEXT.md", import.meta.url);
  try {
    const next = await readFile(continuityPath, "utf8");
    assert.equal(typeof next, "string");
  } catch (error) {
    assert.equal(error?.code, "ENOENT");
  }
});
