import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LIVE_GATEWAY_PUBLIC_SURFACES,
  normalizePublicSourceStatus,
  summarizePublicSourceStatuses,
} from "../src/render/live-gateway.js";
import { SOCIAL_PULSE_ENDPOINT, SOCIAL_PULSE_PROVIDER } from "../src/domains/social-pulse.js";
import { PICTURE_MATTER_METADATA_SOURCE, WIKIMEDIA_COMMONS_API } from "../src/domains/picture-matter-metadata.js";

const NOW = "2026-08-28T12:30:00.000Z";

function socialSnapshot() {
  return {
    source: "public-social-pulse-bluesky",
    provider: SOCIAL_PULSE_PROVIDER,
    endpoint: SOCIAL_PULSE_ENDPOINT,
    requestUrl: `${SOCIAL_PULSE_ENDPOINT}?actor=atproto.com&limit=8`,
    status: "ready",
    providerAvailable: true,
    returnedCount: 1,
    retrievedAt: "2026-08-28T12:25:00.000Z",
    externalNetwork: true,
    publicSource: true,
    untrusted: true,
    metadataOnly: true,
    mediaBytesFetched: false,
    mediaBytesStored: false,
    mediaBytesRendered: false,
    records: [{
      id: "bluesky:post:at://did:plc:demo/app.bsky.feed.post/abc123",
      provider: SOCIAL_PULSE_PROVIDER,
      providerId: "public-social-pulse-bluesky",
      text: "Provider-returned text is untrusted metadata.",
      sourceUrl: "https://bsky.app/profile/atproto.com/post/abc123",
      retrievedAt: "2026-08-28T12:25:00.000Z",
      metadataOnly: true,
      untrusted: true,
      mediaBytesFetched: false,
    }],
  };
}

function pictureSnapshot() {
  return {
    source: PICTURE_MATTER_METADATA_SOURCE,
    provider: "Wikimedia Commons",
    endpoint: WIKIMEDIA_COMMONS_API,
    requestUrl: `${WIKIMEDIA_COMMONS_API}?action=query&format=json&gsrsearch=reality`,
    status: "ready",
    providerAvailable: true,
    returnedCount: 1,
    retrievedAt: "2026-08-28T12:24:00.000Z",
    externalNetwork: true,
    metadataOnly: true,
    imageBytesFetched: false,
    imageBytesStored: false,
    imageBytesRendered: false,
    records: [{
      id: "wikimedia-commons:page:1",
      title: "File:Reality.jpg",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Reality.jpg",
      thumbnailUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/demo.jpg",
      metadataOnly: true,
      imageBytesFetched: false,
      imageBytesStored: false,
      imageBytesRendered: false,
    }],
  };
}

test("Live Gateway all-sources registry has a finite order including Social Pulse and Picture Matter", () => {
  assert.deepEqual(
    LIVE_GATEWAY_PUBLIC_SURFACES.map((surface) => surface.id),
    ["world-events", "sports-events", "asset-market", "protocol-evidence", "multi-sport-events", "social-pulse", "picture-matter"],
  );
  assert.deepEqual(
    LIVE_GATEWAY_PUBLIC_SURFACES.map((surface) => surface.refreshLabel),
    ["Refresh World Pulse", "Refresh Tennis", "Refresh Asset Market", "Refresh Protocol TVL", "Refresh Multi-Sport Scoreboards", "Refresh Social Pulse", "Refresh Picture Metadata"],
  );
});

test("single-envelope Social Pulse and Picture Matter adapters normalize as provider rows with explicit metadata boundaries", () => {
  const socialRows = normalizePublicSourceStatus("social-pulse", socialSnapshot(), { now: NOW });
  assert.equal(socialRows.length, 1);
  assert.equal(socialRows[0].provider, SOCIAL_PULSE_PROVIDER);
  assert.equal(socialRows[0].state, "ready");
  assert.equal(socialRows[0].freshness, "fresh");
  assert.equal(socialRows[0].recordCount, 1);
  assert.equal(socialRows[0].sourceUrl, socialSnapshot().requestUrl);
  assert.equal(socialRows[0].metadataOnly, true);
  assert.equal(socialRows[0].untrusted, true);
  assert.equal(socialRows[0].mediaBytesFetched, false);

  const pictureRows = normalizePublicSourceStatus("picture-matter", pictureSnapshot(), { now: NOW });
  assert.equal(pictureRows.length, 1);
  assert.equal(pictureRows[0].provider, "Wikimedia Commons");
  assert.equal(pictureRows[0].state, "ready");
  assert.equal(pictureRows[0].freshness, "fresh");
  assert.equal(pictureRows[0].recordCount, 1);
  assert.equal(pictureRows[0].sourceUrl, pictureSnapshot().requestUrl);
  assert.equal(pictureRows[0].metadataOnly, true);
  assert.equal(pictureRows[0].imageBytesFetched, false);
  assert.equal(pictureRows[0].imageBytesStored, false);
  assert.equal(pictureRows[0].imageBytesRendered, false);
  assert.equal(Object.isFrozen(socialRows), true);
  assert.equal(Object.isFrozen(pictureRows), true);
});

test("aggregate status keeps both new adapters unavailable until an explicit refresh envelope arrives", () => {
  const summary = summarizePublicSourceStatuses({ "social-pulse": socialSnapshot(), "picture-matter": pictureSnapshot() }, { now: NOW });
  assert.equal(summary.surfaceCount, 7);
  assert.equal(summary.providerCount, 7);
  assert.equal(summary.status, "partial");
  assert.equal(summary.readyCount, 2);
  assert.equal(summary.unavailableCount, 5);
  assert.equal(summary.statuses.find((row) => row.surfaceId === "social-pulse")?.state, "ready");
  assert.equal(summary.statuses.find((row) => row.surfaceId === "picture-matter")?.state, "ready");
  const unavailable = summarizePublicSourceStatuses({}, { now: NOW });
  assert.equal(unavailable.statuses.find((row) => row.surfaceId === "social-pulse")?.state, "unavailable");
  assert.equal(unavailable.statuses.find((row) => row.surfaceId === "picture-matter")?.state, "unavailable");
});

test("aggregate public status never reports READY when every provider row is stale", () => {
  const staleAt = "2026-08-28T11:00:00.000Z";
  const snapshots = Object.fromEntries(LIVE_GATEWAY_PUBLIC_SURFACES.map((surface) => [surface.id, {
    status: "ready",
    provider: `${surface.label} provider`,
    liveFetch: true,
    externalNetwork: true,
    retrievedAt: staleAt,
    records: [{ id: `${surface.id}:record`, sourceUrl: "https://example.com/public-record", sourceObservedAt: staleAt }],
    sources: [{ id: `${surface.id}:provider`, provider: `${surface.label} provider`, available: true, recordCount: 1, retrievedAt: staleAt, requestUrl: "https://example.com/public-source" }],
  }]));

  const summary = summarizePublicSourceStatuses(snapshots, { now: NOW, staleAfterMs: 15 * 60 * 1000 });
  assert.equal(summary.readyCount, LIVE_GATEWAY_PUBLIC_SURFACES.length);
  assert.equal(summary.staleCount, LIVE_GATEWAY_PUBLIC_SURFACES.length);
  assert.equal(summary.status, "partial", "stale provider envelopes require another explicit refresh instead of aggregate READY");
});
