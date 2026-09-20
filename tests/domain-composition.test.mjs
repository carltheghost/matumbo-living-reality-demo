import test from "node:test";
import assert from "node:assert/strict";
import {
  LIVING_REALITY_SAMPLE_TIME,
  SAMPLE_LIVING_REALITY_PROJECTION,
  createLivingRealityProjection,
} from "../src/core/demo-projection.js";

test("all role contributions compose into one deterministic world", () => {
  const projection = SAMPLE_LIVING_REALITY_PROJECTION;
  assert.equal(projection.kind, "simfabric.projection-envelope");
  assert.equal(projection.simulation, true);
  assert.equal(projection.authority, "none");
  assert.equal(projection.world.sources.length, 26);
  assert.deepEqual(projection.world.sources, [
    "block-migration-bridge",
    "bot-plaza",
    "financial-academy",
    "frozen-relics",
    "live-gateway-mock-evidence",
    "luna-companion",
    "muse-agent",
    "nft-atelier",
    "semantic-block-fabric",
    "cipher-messaging",
    "contract-atelier",
    "contracts-markets",
    "picture-matter-statement-forge",
    "prime-ledger-echoproof",
    "skynet-neural-mesh",
    "social-explorer-rehearsal",
    "spatial-rooms",
    "arena-games",
    "tumbo-asset-token",
    "tumbo-distribution-registry",
    "tumbo-paycore",
    "t402-value-routing",
    "person-profile",
    "wardrobe-atelier",
    "white-paper-document",
    "gesture-lens",
  ].sort((a, b) => a.localeCompare(b)));
});

test("composition is replay-stable", () => {
  const first = createLivingRealityProjection({ projectedAt: LIVING_REALITY_SAMPLE_TIME });
  const second = createLivingRealityProjection({ projectedAt: LIVING_REALITY_SAMPLE_TIME });
  assert.deepEqual(second, first);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.world), true);
});

test("authority boundary remains simulation-only across entities", () => {
  const entities = SAMPLE_LIVING_REALITY_PROJECTION.world.entities;
  assert.equal(entities.length, 241);
  assert.equal(entities.every((entity) => entity.simulation === true), true);
  assert.equal(entities.some((entity) => entity.executable === true), false);
  assert.equal(entities.some((entity) => entity.authoritative === true), false);
});
