import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  SAMPLE_CONTRIBUTIONS,
  assembleWorldState,
  validateProjectionContribution,
} from "../src/core/world-state.js";
import { createProjectionEnvelope } from "../src/core/view-state.js";
import {
  ASSET_TOKEN_ALLOCATIONS,
  ASSET_TOKEN_CAPABILITIES,
  ASSET_TOKEN_LAUNCH_DISTRIBUTION,
  ASSET_TOKEN_PROVENANCE,
  ASSET_TOKEN_TOTAL_BASIS_POINTS,
  ASSET_TOKEN_TOTAL_SUPPLY,
  ASSET_TOKEN_UNIT,
  createAssetTokenContribution,
} from "../src/domains/asset-token.js";

const FIXED_TIME = "2025-01-01T00:00:00.000Z";
const ROOT = new URL("../", import.meta.url);

function contribution(source, entityId) {
  return {
    schemaVersion: 1,
    source,
    simulation: true,
    updatedAt: FIXED_TIME,
    entities: [{ id: entityId }],
    evidence: [{ id: `${entityId}-evidence`, status: "simulated" }],
    capabilities: [{ id: `${entityId}-observe`, authority: "none" }],
  };
}

test("projection contract rejects authoritative contributions", () => {
  assert.throws(
    () => validateProjectionContribution({ ...contribution("unsafe", "unsafe"), simulation: false }),
    /authoritative contributions are forbidden/,
  );
});

test("world assembly is deterministic across registration order", () => {
  const alpha = contribution("alpha", "a");
  const zulu = contribution("zulu", "z");
  const forward = assembleWorldState([zulu, alpha]);
  const reverse = assembleWorldState([alpha, zulu]);

  assert.deepEqual(forward, reverse);
  assert.deepEqual(forward.sources, ["alpha", "zulu"]);
  assert.deepEqual(forward.entities.map(({ id }) => id), ["a", "z"]);
  assert.equal(forward.simulation, true);
  assert.throws(() => assembleWorldState([alpha, alpha]), /Duplicate projection source/);
});

test("replaying the same input produces the same renderer envelope", () => {
  const first = createProjectionEnvelope({
    contributions: SAMPLE_CONTRIBUTIONS,
    projectedAt: FIXED_TIME,
  });
  const replay = createProjectionEnvelope({
    contributions: SAMPLE_CONTRIBUTIONS,
    projectedAt: FIXED_TIME,
  });

  assert.deepEqual(replay, first);
  assert.equal(replay.simulation, true);
  assert.equal(replay.authority, "none");
  assert.equal(Object.isFrozen(replay), true);
});

test("TUMBO asset-token launch uses the fixed supply and exact basis-point schedule", () => {
  const contribution = createAssetTokenContribution({ updatedAt: FIXED_TIME });
  const expectedBasisPoints = [2_500, 2_000, 1_500, 1_500, 1_000, 1_000, 300, 200];
  const expectedPercentages = [25, 20, 15, 15, 10, 10, 3, 2];
  const expectedUnits = [
    250_000_000,
    200_000_000,
    150_000_000,
    150_000_000,
    100_000_000,
    100_000_000,
    30_000_000,
    20_000_000,
  ];

  assert.equal(contribution.source, "tumbo-asset-token");
  assert.equal(contribution.unit, ASSET_TOKEN_UNIT);
  assert.equal(contribution.unit, "TUMBO-SIM");
  assert.equal(contribution.totalSupply, ASSET_TOKEN_TOTAL_SUPPLY);
  assert.equal(contribution.totalSupply, 1_000_000_000);
  assert.equal(contribution.fixedSupply, true);
  assert.equal(contribution.launchDistribution.totalSupply, ASSET_TOKEN_TOTAL_SUPPLY);
  assert.equal(contribution.launchDistribution.unit, ASSET_TOKEN_UNIT);
  assert.equal(contribution.launchDistribution.kind, ASSET_TOKEN_LAUNCH_DISTRIBUTION.kind);
  assert.equal(contribution.launchDistribution.basisPoints, ASSET_TOKEN_TOTAL_BASIS_POINTS);
  assert.equal(contribution.launchDistribution.status, "simulated");
  assert.equal(contribution.launchDistribution.externalDistribution, false);

  assert.deepEqual(
    contribution.allocations.map(({ basisPoints }) => basisPoints),
    expectedBasisPoints,
  );
  assert.deepEqual(
    contribution.allocations.map(({ percentage }) => percentage),
    expectedPercentages,
  );
  assert.deepEqual(
    contribution.allocations.map(({ percent }) => percent),
    expectedPercentages,
  );
  assert.deepEqual(
    contribution.allocations.map(({ tokenUnits }) => tokenUnits),
    expectedUnits,
  );
  assert.deepEqual(
    contribution.allocations.map(({ units }) => units),
    expectedUnits,
  );

  const basisPointTotal = contribution.allocations.reduce(
    (total, allocation) => total + allocation.basisPoints,
    0,
  );
  const tokenUnitTotal = contribution.allocations.reduce(
    (total, allocation) => total + allocation.tokenUnits,
    0,
  );
  assert.equal(basisPointTotal, ASSET_TOKEN_TOTAL_BASIS_POINTS);
  assert.equal(basisPointTotal, 10_000);
  assert.equal(tokenUnitTotal, ASSET_TOKEN_TOTAL_SUPPLY);
  assert.equal(tokenUnitTotal, 1_000_000_000);
  assert.equal(contribution.evidence[0].basisPoints, ASSET_TOKEN_TOTAL_BASIS_POINTS);
  assert.equal(contribution.evidence[0].tokenUnits, ASSET_TOKEN_TOTAL_SUPPLY);
  assert.equal(contribution.evidence[0].expectedTokenUnits, ASSET_TOKEN_TOTAL_SUPPLY);
  assert.equal(
    contribution.allocations.every((allocation) => Number.isSafeInteger(allocation.tokenUnits)),
    true,
  );
});

test("TUMBO allocation records are aggregate fictional cohorts with frozen provenance", () => {
  const contribution = createAssetTokenContribution({ updatedAt: FIXED_TIME });
  const expectedClasses = [
    "public-social-experiment",
    "county-community",
    "organizations",
    "international-public-good-funds",
    "ecosystem-grants",
    "treasury-reserve",
    "operations",
    "insurance-risk-reserve",
  ];

  assert.deepEqual(
    contribution.allocations.map(({ recipientClass }) => recipientClass),
    expectedClasses,
  );
  assert.deepEqual(contribution.launchDistribution.recipientClasses, expectedClasses);
  assert.deepEqual(
    contribution.launchDistribution.allocationIds,
    contribution.allocations.map(({ id }) => id),
  );
  assert.equal(contribution.assetToken.fictional, true);
  assert.equal(contribution.assetToken.assetClass, "simulation-only-asset-token");
  assert.equal(contribution.assetToken.paymentInstrument, false);
  assert.equal(contribution.assetToken.financialInstrument, false);
  assert.equal(contribution.assetToken.transferable, false);
  assert.equal(contribution.assetToken.provenance, ASSET_TOKEN_PROVENANCE);

  assert.equal(Object.isFrozen(contribution), true);
  assert.equal(Object.isFrozen(contribution.assetToken), true);
  assert.equal(Object.isFrozen(contribution.launchDistribution), true);
  assert.equal(Object.isFrozen(contribution.allocations), true);
  assert.equal(Object.isFrozen(contribution.entities), true);
  assert.equal(Object.isFrozen(contribution.evidence), true);
  assert.equal(Object.isFrozen(contribution.capabilities), true);
  assert.equal(Object.isFrozen(ASSET_TOKEN_ALLOCATIONS), true);
  assert.equal(Object.isFrozen(ASSET_TOKEN_PROVENANCE), true);

  for (const [index, allocation] of contribution.allocations.entries()) {
    assert.equal(Object.isFrozen(allocation), true, `allocation ${index + 1} must be frozen`);
    assert.equal(Object.isFrozen(allocation.provenance), true);
    assert.equal(allocation.simulation, true);
    assert.equal(allocation.executable, false);
    const allocationEntity = contribution.entities.find(({ id }) => id === allocation.id);
    assert.ok(allocationEntity, `entity record for ${allocation.id} must be present`);
    assert.equal(allocationEntity.type, "asset-token-allocation");
    assert.equal(allocationEntity.kind, "asset-token-allocation");
    assert.equal(Object.isFrozen(allocationEntity), true);
    assert.equal(allocation.provenance.simulation, true);
    assert.equal(allocation.provenance.externalSource, false);
    assert.equal(allocation.provenance.deterministic, true);
    assert.equal(allocation.provenance.source, "local-fixed-fixture");
    assert.equal(allocation.provenance.basis, "deterministic-fixed-supply-basis-point-schedule");
    assert.match(allocation.provenance.deterministicKey, /^tumbo-asset-token:/);
    assert.equal("address" in allocation, false);
    assert.equal("wallet" in allocation, false);
  }
});

test("TUMBO live capabilities are explicit denials and cannot be overridden", () => {
  const contribution = createAssetTokenContribution({ updatedAt: FIXED_TIME });
  const deniedIds = [
    "asset-token.live-issuance",
    "asset-token.custody",
    "asset-token.wallet-connection",
    "asset-token.signing",
    "asset-token.settlement",
    "asset-token.external-transfer",
    "asset-token.exchange-listing",
    "asset-token.real-money",
  ];
  const allowedPreviewIds = [
    "asset-token.preview-fixed-supply",
    "asset-token.preview-launch-distribution",
  ];

  assert.deepEqual(
    contribution.capabilities.filter(({ enabled }) => enabled).map(({ id }) => id),
    allowedPreviewIds,
  );
  assert.deepEqual(
    contribution.capabilities.filter(({ denied }) => denied).map(({ id }) => id),
    deniedIds,
  );
  assert.equal(contribution.capabilities.length, 10);
  assert.equal(contribution.capabilities, ASSET_TOKEN_CAPABILITIES);
  assert.equal(
    contribution.capabilities.every(
      (capability) => capability.simulationOnly === true && capability.executable === false,
    ),
    true,
  );
  for (const capability of contribution.capabilities.filter(({ denied }) => denied)) {
    assert.equal(capability.enabled, false);
    assert.equal(capability.status, "denied");
    assert.equal(capability.mode, "denied");
    assert.equal(capability.authority, "none");
    assert.equal(capability.denied, true);
  }

  assert.equal(contribution.assetToken.issuable, false);
  assert.equal(contribution.assetToken.custodial, false);
  assert.equal(contribution.assetToken.signable, false);
  assert.equal(contribution.assetToken.settleable, false);
  assert.equal(contribution.assetToken.transferable, false);
  assert.equal(contribution.assetToken.paymentInstrument, false);
  assert.equal(contribution.assetToken.financialInstrument, false);
  assert.throws(
    () => createAssetTokenContribution({ totalSupply: ASSET_TOKEN_TOTAL_SUPPLY - 1 }),
    /totalSupply is fixed at 1000000000 simulation units/,
  );
});

test("renderer source contains no external or authority-bearing execution path", async () => {
  const rendererFiles = [
    "src/main.js",
    "src/render/projection-bridge.js",
    "src/render/distribution-explorer.js",
    "src/render/launch-console.js",
    "src/render/social-explorer.js",
    "src/render/room-spaces.js",
    "src/render/camera-input.js",
    "src/render/gesture-input.js",
    "src/render/multi-sport-events.js",
    "src/render/block-world.js",
    "src/render/portal-return.js",
    "src/render/intent-timeline.js",
  ];
  const forbidden = [
    ["network request", /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b/],
    ["persistent browser storage", /\b(localStorage|sessionStorage|indexedDB)\b/],
    ["cryptographic API", /\b(?:window\.)?crypto\b/],
    ["wallet API", /\b(?:wallet|ethereum|solana)\s*\./i],
    ["authority operation", /\.\s*(?:sign|signTransaction|sendTransaction|transfer|settle|execute|custody)\s*\(/i],
  ];

  for (const relativePath of rendererFiles) {
    const source = await readFile(new URL(relativePath, ROOT), "utf8");
    for (const [label, pattern] of forbidden) {
      assert.doesNotMatch(source, pattern, `${relativePath} must not contain a ${label}`);
    }
  }
});

test("launch and distribution integration stays local with the vendored Three.js import map", async () => {
  const integrationFiles = [
    "src/main.js",
    "src/render/distribution-explorer.js",
    "src/render/launch-console.js",
    "src/render/social-explorer.js",
    "src/render/room-spaces.js",
    "src/render/camera-input.js",
    "src/render/gesture-input.js",
    "src/render/multi-sport-events.js",
    "src/render/block-world.js",
    "src/render/portal-return.js",
    "src/render/intent-timeline.js",
  ];
  const forbiddenExecution = [
    ["network request", /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*(?:\(|\.)/],
    ["wallet provider access", /\b(?:wallet|ethereum|solana)\s*(?:\.|\[)/i],
    ["issuance operation", /\b(?:issue|issuance|mint|burn|createToken|deployContract)\s*\(/i],
    ["custody operation", /\b(?:custody|custodial|deposit|withdraw)\s*\(/i],
    ["signing operation", /\b(?:sign|signTransaction|sendTransaction)\s*\(/i],
    ["settlement operation", /\b(?:settle|settlement)\s*\(/i],
    ["external transfer operation", /\b(?:transfer|externalTransfer|send)\s*\(/i],
    ["real-money operation", /\b(?:buy|sell|purchase|payment|charge)\s*\(/i],
  ];

  for (const relativePath of integrationFiles) {
    const source = await readFile(new URL(relativePath, ROOT), "utf8");
    assert.match(source, /simulation\s*:\s*true/);
    assert.match(source, /externalTransfer\s*:\s*false/);
    for (const [label, pattern] of forbiddenExecution) {
      assert.doesNotMatch(source, pattern, `${relativePath} must not contain a ${label}`);
    }
  }
  const distributionSource = await readFile(
    new URL("src/render/distribution-explorer.js", ROOT),
    "utf8",
  );
  assert.match(distributionSource, /executable\s*:\s*false/);

  const html = await readFile(new URL("index.html", ROOT), "utf8");
  assert.match(html, /id=["']asset-launch["']/);
  assert.match(html, /id=["']launch-console["']/);
  assert.match(html, /id=["']intent-timeline["']/);
  assert.match(html, /id=["']room-console["']/);
  assert.match(html, /id=["']portal-return-console["']/);
  assert.match(html, /RETURN TO CUBE FIELD/);
  assert.match(html, /Enter selected room/i);
  assert.match(html, /Leave room/i);
  assert.match(html, /Run local launch preview/i);
  assert.match(html, /Replay visible trace/i);
  assert.match(html, /TUMBO Asset Token/);
  assert.match(html, /NO WALLET/);
  assert.match(html, /NO TRANSFER/);
  assert.doesNotMatch(html, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*(?:\(|\.)/);
  const urls = [...html.matchAll(/https?:\/\/[^"'\s]+/g)].map(([url]) => url);
  assert.deepEqual(urls, [], "the app shell must not require an external CDN to boot");
  assert.match(html, /"three"\s*:\s*"\.\/vendor\/three-r179\.1\/build\/three\.module\.js"/);
  assert.match(html, /"three\/addons\/"\s*:\s*"\.\/vendor\/three-r179\.1\/examples\/jsm\/"/);
});

test("renderer bridge only emits frozen local simulation intents", async () => {
  const listeners = new Map();
  const dispatched = [];
  globalThis.window = {
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    dispatchEvent(event) { dispatched.push(event); return true; },
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, options) { this.type = type; this.detail = options.detail; }
  };

  try {
    const { createProjectionBridge } = await import("../src/render/projection-bridge.js");
    const bridge = createProjectionBridge();
    const intent = bridge.emitIntent("projection.focus", "sample", { method: "test" });

    assert.equal(dispatched.length, 1);
    assert.equal(dispatched[0].type, "simfabric:intent");
    assert.equal(dispatched[0].detail, intent);
    assert.equal(intent.source, "living-reality-renderer");
    assert.equal(intent.simulation, true);
    assert.equal(Object.isFrozen(intent), true);
    assert.equal(Object.isFrozen(intent.detail), true);
    assert.deepEqual(Object.keys(intent).sort(), [
      "createdAt", "detail", "schemaVersion", "simulation", "source", "target", "type",
    ]);
    assert.equal("authority" in intent, false);
    assert.equal("execute" in intent, false);
    bridge.destroy();
  } finally {
    delete globalThis.window;
    delete globalThis.CustomEvent;
  }
});
