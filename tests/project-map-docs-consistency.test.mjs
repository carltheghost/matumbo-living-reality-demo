import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const DOCS = [
  "docs/PRODUCT_AUDIT_PLAN.md",
  "docs/INTEGRATION_MATRIX.md",
  "docs/LAUNCH_KIT.md",
  "docs/DEVICE_PROJECTION.md",
  "docs/BLOCK_WORLD_MIGRATION.md",
  "docs/LIVE_GATEWAY_EVIDENCE.md",
  "docs/CURRENT_STATE.md",
  ".tumbo/continuity/NEXT.md",
];

test("project map documents the current 23-route registry and current full-suite count", async () => {
  const documents = Object.fromEntries(await Promise.all(DOCS.map(async (file) => [
    file,
    await readFile(new URL(`../${file}`, import.meta.url), "utf8"),
  ])));

  const current = documents["docs/CURRENT_STATE.md"];
  // Packet 215 adds the latest nested-preview verification above the historical
  // Packet 175 entry; keep the head window comfortably large enough to cover that
  // frontier without treating a documentation-length change as a runtime regression.
  const currentHead = current.slice(0, 50_000);
  assert.match(currentHead, /Packet 214/);
  assert.match(currentHead, /Packet 215/);
  assert.match(currentHead, /Packet 213/);
  assert.match(currentHead, /Packet 211/);
  assert.match(currentHead, /Packet 208/);
  assert.match(currentHead, /Packet 207/);
  assert.match(currentHead, /## Packet 186/);
  assert.match(currentHead, /## Packet 185/);
  assert.match(currentHead, /## Packet 185/);
  assert.match(currentHead, /## Packet 182/);
  assert.match(currentHead, /## Packet 181/);
  assert.match(currentHead, /## Packet 178/);
  assert.match(currentHead, /## Packet 180/);
  assert.match(currentHead, /## Packet 177/);
  assert.match(currentHead, /## Packet 175/);
  assert.match(current, /## Packet 174/);
  assert.match(currentHead, /Mission Control: 23 openable feature routes/);
  assert.match(currentHead, /current full suite passes 442\/442/);
  assert.match(documents["docs\/INTEGRATION_MATRIX.md"], /current full suite is 442\/442/);
  assert.match(currentHead, /panel=live-status&live=all/);
  assert.match(currentHead, /GAZE LOCK/);
  assert.doesNotMatch(current, /Mission Control: 20 openable feature routes/);

  const next = documents[".tumbo/continuity/NEXT.md"];
  // Keep current-frontier assertions near the head, but read historical
  // continuity markers from the complete append-only queue. New verified
  // packets must not make an older marker fail merely by moving it past a
  // byte window.
  const nextHead = next.slice(0, 50_000);
  assert.match(nextHead, /Packet 214/);
  assert.match(nextHead, /Packet 213/);
  assert.match(nextHead, /Packet 211/);
  assert.match(nextHead, /Packet 208/);
  assert.match(nextHead, /Packet 207/);
  assert.match(nextHead, /Latest bounded follow-up — Packet 186/);
  assert.match(nextHead, /Latest bounded follow-up — Packet 185/);
  assert.match(next, /Latest verified recheck — Packet 183/);
  assert.match(next, /Latest verified recheck — Packet 182/);
  assert.match(next, /Latest verified recheck — Packet 181/);
  assert.match(next, /Latest verified recheck — Packet 178/);
  assert.match(next, /Latest verified recheck — Packet 180/);
  assert.match(next, /Latest verified recheck — Packet 177/);
  assert.match(next, /23-feature local/);
  assert.match(next, /seven fixed adapters/);
  assert.match(next, /GAZE \+ HAND/);

  assert.match(documents["docs/PRODUCT_AUDIT_PLAN.md"], /Verified frontier — packets 166–215/);
  assert.match(documents["docs/PRODUCT_AUDIT_PLAN.md"], /Packet 215 — nested preview content focus fallback/);
  assert.match(documents["docs/PRODUCT_AUDIT_PLAN.md"], /Packet 214 — reachable cube-world feature rail/);
  assert.match(documents["docs/PRODUCT_AUDIT_PLAN.md"], /Packet 213 — Sports\/Tennis empty-state action/);
  assert.match(documents["docs/PRODUCT_AUDIT_PLAN.md"], /Packet 211 — final-tree gaze \+ hand\/finger carry recheck/);
  assert.match(documents["docs/PRODUCT_AUDIT_PLAN.md"], /Packet 208 — Contracts\/Pools route verification/);
  assert.match(documents["docs/PRODUCT_AUDIT_PLAN.md"], /Packet 185 companion — gaze-locked hand Grab/);
  assert.match(documents["docs/PRODUCT_AUDIT_PLAN.md"], /Packet 183 — red gaze-lock/);
  assert.match(documents["docs/PRODUCT_AUDIT_PLAN.md"], /Packet 182 — addressable/);
  assert.match(documents["docs/PRODUCT_AUDIT_PLAN.md"], /Packet 181 — feature navigation/);
  assert.match(documents["docs/PRODUCT_AUDIT_PLAN.md"], /Packet 180 — provider-backed sports/);
  assert.match(documents["docs/PRODUCT_AUDIT_PLAN.md"], /Packet 178 — live-status and World Pulse no-mock audit/);
  assert.match(documents["docs/PRODUCT_AUDIT_PLAN.md"], /23rd openable local feature/);
  assert.match(documents["docs/PRODUCT_AUDIT_PLAN.md"], /real-provider\/fail-closed audit/);
  assert.match(documents["docs/INTEGRATION_MATRIX.md"], /178/);
  assert.match(documents["docs/INTEGRATION_MATRIX.md"], /Packets? 180/);
  assert.match(documents["docs/INTEGRATION_MATRIX.md"], /Packets 166–215/);
  assert.match(documents["docs/INTEGRATION_MATRIX.md"], /182/);
  assert.match(documents["docs/INTEGRATION_MATRIX.md"], /183/);
  assert.match(documents["docs/INTEGRATION_MATRIX.md"], /Packet 185/);
  assert.match(documents["docs/INTEGRATION_MATRIX.md"], /Packet 208/);
  assert.match(documents["docs/INTEGRATION_MATRIX.md"], /Packet 211/);
  assert.match(documents["docs/INTEGRATION_MATRIX.md"], /Packet 214/);
  assert.match(documents["docs/INTEGRATION_MATRIX.md"], /Sports\/Tennis empty-state/);
  assert.match(documents["docs/INTEGRATION_MATRIX.md"], /HOST GAZE \+ HAND OPT-IN/);
  assert.match(documents["docs/LAUNCH_KIT.md"], /23 openable local features/);
  assert.match(documents["docs/LAUNCH_KIT.md"], /audit-live-status-no-mock-178\.json/);
  assert.match(documents["docs/DEVICE_PROJECTION.md"], /GAZE LOCK/);
  assert.match(documents["docs/DEVICE_PROJECTION.md"], /Grab → one-step Hold → Place\/Release/);
  assert.match(documents["docs/BLOCK_WORLD_MIGRATION.md"], /finite 19-destination registry/);
  assert.match(documents["docs/BLOCK_WORLD_MIGRATION.md"], /3-D \/ 4-D \/ 5-D/);
  assert.match(documents["docs/LIVE_GATEWAY_EVIDENCE.md"], /seven per-surface controls/);
  assert.match(documents["docs/LIVE_GATEWAY_EVIDENCE.md"], /no-mock\/fail-closed browser verification is Packet 178/);
});
