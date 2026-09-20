import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLivingRealityProjection } from "../src/core/demo-projection.js";
import {
  LIVE_GATEWAY_PUBLIC_AUTO_REFRESH_INTERVAL_MS,
  LIVE_GATEWAY_PUBLIC_SURFACES,
  LIVE_GATEWAY_PUBLIC_STATUS_SOURCE,
  createLiveGatewayConsole,
  normalizePublicSourceStatus,
  normalizeStructuredPublicSourceStatus,
  summarizePublicSourceStatuses,
} from "../src/render/live-gateway.js";

function makeElement(documentRoot, tag = "div") {
  return {
    ownerDocument: documentRoot,
    tagName: tag.toUpperCase(),
    id: "",
    className: "",
    dataset: {},
    hidden: false,
    disabled: false,
    textContent: "",
    children: [],
    listeners: new Map(),
    attributes: new Map(),
    classList: { toggle() {} },
    append(...children) { children.forEach((child) => this.appendChild(child)); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    focus() {},
  };
}

function makeDocument() {
  const elements = new Map();
  const documentRoot = {
    createElement(tag) { return makeElement(documentRoot, tag); },
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener() {},
  };
  [
    ["live-gateway-console", true],
    ["live-gateway-close"],
    ["live-gateway-replay"],
    ["live-gateway-reset"],
    ["live-gateway-status"],
    ["live-gateway-summary"],
    ["live-gateway-public-actions"],
    ["live-gateway-public-refresh-status"],
    ["live-gateway-public-status"],
    ["live-gateway-legacy-fixture"],
    ["live-gateway-current"],
    ["live-gateway-evidence"],
    ["live-gateway-interpretations"],
    ["live-gateway-trace"],
    ["live-gateway-boundary"],
  ].forEach(([id, hidden]) => {
    const element = makeElement(documentRoot);
    element.id = id;
    element.hidden = hidden === true;
    elements.set(id, element);
  });
  return documentRoot;
}

function collectText(node) {
  return [node?.textContent ?? "", ...(node?.children ?? []).map(collectText)].join(" ");
}

const NOW = "2026-08-28T12:30:00.000Z";

function worldSnapshot() {
  return {
    status: "partial",
    retrievedAt: "2026-08-28T12:00:00.000Z",
    liveFetch: true,
    externalSource: true,
    records: [{ id: "world:nyt:1", providerId: "nyt-world-rss", provider: "NYT World RSS", sourceObservedAt: "2026-08-28T11:59:00.000Z", sourceUrl: "https://www.nytimes.com/2026/08/28/world/example.html" }],
    sources: [
      { id: "gdelt-doc", provider: "GDELT DOC 2.0", available: false, recordCount: 0, retrievedAt: "2026-08-28T12:00:00.000Z", endpoint: "https://api.gdeltproject.org/api/v2/doc/doc", reason: "Provider request timed out." },
      { id: "nyt-world-rss", provider: "The New York Times · World RSS", available: true, recordCount: 1, retrievedAt: "2026-08-28T12:00:00.000Z", requestUrl: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml" },
    ],
    humanitarian: {
      providerId: "unhcr-population",
      provider: "UNHCR Refugee Data Finder",
      status: "ready",
      liveFetch: true,
      externalSource: true,
      recordCount: 1,
      records: [{
        id: "unhcr-population:2025:aggregate",
        providerId: "unhcr-population",
        provider: "UNHCR Refugee Data Finder",
        sourceUrl: "https://api.unhcr.org/population/v1/population/?yearFrom=2024&yearTo=2026&limit=12",
        retrievedAt: "2026-08-28T12:00:00.000Z",
        observedYear: 2025,
        sourceObservedAt: null,
        eventTime: null,
        geographyStatus: "unavailable",
        metrics: { refugees: 28461306 },
      }],
      sources: [{
        id: "unhcr-population",
        provider: "UNHCR Refugee Data Finder",
        available: true,
        recordCount: 1,
        retrievedAt: "2026-08-28T12:00:00.000Z",
        requestUrl: "https://api.unhcr.org/population/v1/population/?yearFrom=2024&yearTo=2026&limit=12",
        documentation: "https://www.unhcr.org/refugee-statistics/insights/explainers/forcibly-displaced-api.html",
        reason: null,
      }],
    },
  };
}

test("public status normalizer keeps provider state, provenance, times, and stale boundary explicit", () => {
  const snapshot = worldSnapshot();
  const rows = normalizePublicSourceStatus("world-events", snapshot, { now: NOW, staleAfterMs: 15 * 60 * 1000 });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].provider, "GDELT DOC 2.0");
  assert.equal(rows[0].state, "unavailable");
  assert.equal(rows[0].freshness, "unavailable");
  assert.equal(rows[0].recordCount, 0);
  assert.equal(rows[1].state, "ready");
  assert.equal(rows[1].freshness, "stale");
  assert.equal(rows[1].recordCount, 1);
  assert.equal(rows[1].sourceUrl, "https://rss.nytimes.com/services/xml/rss/nyt/World.xml");
  assert.equal(rows[1].observedAt, "2026-08-28T11:59:00.000Z");
  assert.equal(Object.isFrozen(rows), true);

  const structuredRows = normalizeStructuredPublicSourceStatus("world-events", snapshot, { now: NOW, staleAfterMs: 15 * 60 * 1000 });
  assert.equal(structuredRows.length, 1);
  assert.equal(structuredRows[0].providerId, "unhcr-population");
  assert.equal(structuredRows[0].surfaceLabel, "World Pulse · HUMANITARIAN");
  assert.equal(structuredRows[0].state, "ready");
  assert.equal(structuredRows[0].freshness, "stale");
  assert.equal(structuredRows[0].recordCount, 1);
  assert.equal(structuredRows[0].observedAt, null);
  assert.equal(structuredRows[0].sourceUrl, "https://api.unhcr.org/population/v1/population/?yearFrom=2024&yearTo=2026&limit=12");
  assert.equal(structuredRows[0].documentationUrl, "https://www.unhcr.org/refugee-statistics/insights/explainers/forcibly-displaced-api.html");
  assert.equal(structuredRows[0].structured, true);
  assert.equal(Object.isFrozen(structuredRows), true);

  const summary = summarizePublicSourceStatuses({ "world-events": snapshot }, { now: NOW });
  assert.equal(summary.status, "partial");
  assert.equal(summary.surfaceCount, 7);
  assert.equal(summary.providerCount, 8);
  assert.equal(summary.readyCount, 1);
  assert.equal(summary.unavailableCount, 7);
  assert.equal(summary.structuredProviderCount, 1);
  assert.equal(summary.structuredReadyCount, 1);
  assert.equal(summary.structuredUnavailableCount, 0);
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.statuses), true);
  assert.equal(Object.isFrozen(summary.structuredStatuses), true);
});

test("Gateway never reports ready when the returned provider envelope says unavailable", () => {
  const rows = normalizePublicSourceStatus("sports-events", {
    status: "ready",
    provider: "ATP / WTA public scoreboard",
    providerAvailable: false,
    retrievedAt: NOW,
    records: [],
    reason: "Upstream request failed.",
  }, { now: NOW });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].state, "unavailable");
  assert.equal(rows[0].freshness, "unavailable");
  assert.equal(rows[0].recordCount, 0);
  assert.match(rows[0].reason, /Upstream request failed/i);
});

test("Live Gateway public bridge renders alongside, but does not merge into, the legacy fixture", () => {
  const callbacks = [];
  const documentRoot = makeDocument();
  const adapter = createLiveGatewayConsole({
    documentRoot,
    projection: createLivingRealityProjection().world,
    onPublicSourceStatus: (snapshot) => callbacks.push(snapshot),
  });
  const initial = adapter.getSnapshot();
  assert.equal(initial.publicSourceStatus.source, LIVE_GATEWAY_PUBLIC_STATUS_SOURCE);
  assert.equal(initial.publicSourceStatus.statuses.length, 7);

  const synced = adapter.syncPublicSourceStatus("world-events", worldSnapshot(), { method: "test-refresh", now: NOW });
  assert.equal(synced.action, "sync");
  assert.equal(synced.surfaceId, "world-events");
  assert.equal(synced.statuses.length, 2);
  assert.equal(Object.isFrozen(synced), true);
  assert.equal(callbacks.length, 1);

  const publicMount = documentRoot.getElementById("live-gateway-public-status");
  assert.equal(publicMount.children.length, 8);
  assert.equal(publicMount.children.some((row) => row.dataset.surfaceId === "world-events" && row.dataset.providerId === "nyt-world-rss"), true);
  const worldRow = publicMount.children.find((row) => row.dataset.surfaceId === "world-events" && row.dataset.providerId === "gdelt-doc");
  assert.ok(worldRow);
  assert.equal(publicMount.children.filter((row) => row.dataset.structuredKind === "humanitarian").length, 0, "the structured rail is nested, not a duplicate top-level provider row");
  assert.equal(publicMount.children.filter((row) => row.children?.some((child) => child.dataset.structuredKind === "humanitarian")).length, 1, "UNHCR renders once beneath the World Pulse provider rows");
  const humanitarianRail = worldRow.children.find((child) => child.dataset.structuredKind === "humanitarian");
  assert.ok(humanitarianRail, "UNHCR must render beneath the World Pulse provider rows");
  assert.match(humanitarianRail.children[0].textContent, /Structured humanitarian · UNHCR/i);
  const humanitarianRow = humanitarianRail.children.find((child) => child.dataset.structured === "true");
  assert.ok(humanitarianRow);
  const humanitarianText = collectText(humanitarianRow);
  assert.match(humanitarianText, /UNHCR Refugee Data Finder/);
  assert.match(humanitarianText, /RECORDS 1/);
  assert.match(humanitarianText, /OPEN PUBLIC SOURCE/);
  assert.match(humanitarianText, /OPEN PROVIDER DOCS/);
  assert.match(humanitarianText, /forcibly-displaced-api\.html/);
  assert.equal(documentRoot.getElementById("live-gateway-evidence").children.length > 0, true);
  assert.equal(documentRoot.getElementById("live-gateway-interpretations").children.length > 0, true);

  const beforeReset = adapter.getSnapshot().publicSourceStatus;
  adapter.reset("test-reset");
  assert.deepEqual(adapter.getSnapshot().publicSourceStatus, beforeReset);
  assert.equal(adapter.getSnapshot().publicSourceStatus.statuses.some((row) => row.provider === "The New York Times · World RSS"), true);
});

test("public-first Gateway can omit the legacy fixture while retaining real-source refresh controls", () => {
  const documentRoot = makeDocument();
  const adapter = createLiveGatewayConsole({
    documentRoot,
    projection: createLivingRealityProjection().world,
    includeLegacyFixture: false,
  });
  const initial = adapter.getSnapshot();
  assert.equal(initial.summary.recordCount, 0);
  assert.equal(initial.summary.evidenceCount, 0);
  assert.equal(initial.summary.interpretationCount, 0);
  assert.match(initial.boundary, /public-read route/i);
  const legacyFixture = documentRoot.getElementById("live-gateway-legacy-fixture");
  assert.equal(legacyFixture.hidden, true, "public-first renderer must hide compatibility fixture at mount time");
  assert.equal(legacyFixture.attributes.get("aria-hidden"), "true", "public-first renderer must hide compatibility fixture from assistive technology");

  adapter.syncProjection(createLivingRealityProjection().world);
  const afterProjection = adapter.getSnapshot();
  assert.equal(afterProjection.summary.recordCount, 0);
  assert.equal(afterProjection.selectedRecord, null);
  const controls = documentRoot.getElementById("live-gateway-public-actions");
  assert.equal(controls.children.length, 9);
  assert.equal(controls.children[0].id, "live-gateway-refresh-all");
  assert.equal(controls.children[0].dataset.action, "refresh-all");
  assert.equal(controls.children[1].id, "live-gateway-auto-refresh");
  assert.equal(controls.children[1].dataset.action, "auto-refresh-start");
});

test("public status controls delegate explicit refreshes and keep failures visible", async () => {
  const calls = [];
  const documentRoot = makeDocument();
  const adapter = createLiveGatewayConsole({
    documentRoot,
    projection: createLivingRealityProjection().world,
    onPublicRefresh: async (surfaceId, method) => {
      calls.push({ surfaceId, method });
      if (surfaceId === "world-events") return worldSnapshot();
      throw new Error("provider unavailable in test");
    },
  });
  const controls = documentRoot.getElementById("live-gateway-public-actions");
  assert.equal(controls.children.length, 9);
  const worldRequest = await adapter.refreshPublicSource("world-events", "test-world");
  assert.equal(worldRequest.action, "refresh-request");
  assert.deepEqual(calls[0], { surfaceId: "world-events", method: "test-world" });
  assert.match(documentRoot.getElementById("live-gateway-public-refresh-status").textContent, /REFRESH COMPLETE/);
  const failed = await adapter.refreshPublicSource("sports-events", "test-tennis");
  assert.equal(failed.action, "refresh-failed");
  assert.equal(failed.reason, "provider unavailable in test");
  assert.match(documentRoot.getElementById("live-gateway-public-refresh-status").textContent, /REFRESH FAILED/);
  assert.equal(controls.children.every((button) => button.disabled === false), true);
});

test("a resolved refresh without a provider envelope stays visibly failed", async () => {
  const documentRoot = makeDocument();
  const adapter = createLiveGatewayConsole({
    documentRoot,
    projection: createLivingRealityProjection().world,
    onPublicRefresh: async () => undefined,
  });
  const failed = await adapter.refreshPublicSource("sports-events", "test-empty-result");
  assert.equal(failed.action, "refresh-failed");
  assert.match(failed.reason, /no status envelope/i);
  assert.match(documentRoot.getElementById("live-gateway-public-refresh-status").textContent, /REFRESH FAILED/);
  const tennisStatus = adapter.getSnapshot().publicSourceStatus.statuses.find((row) => row.surfaceId === "sports-events");
  assert.equal(tennisStatus.state, "unavailable");
});

test("Refresh all public sources delegates the fixed adapters sequentially and reports aggregate provenance", async () => {
  const calls = [];
  const documentRoot = makeDocument();
  const adapter = createLiveGatewayConsole({
    documentRoot,
    projection: createLivingRealityProjection().world,
    onPublicRefresh: async (surfaceId, method) => {
      calls.push({ surfaceId, method, active: adapter.getSnapshot().publicRefreshBatchActive });
      if (surfaceId === "asset-market") throw new Error("CoinGecko unavailable in test");
      const result = surfaceId === "world-events" ? worldSnapshot() : {
        status: "ready",
        liveFetch: true,
        externalSource: true,
        retrievedAt: NOW,
        records: [{ id: `${surfaceId}:1`, providerId: `${surfaceId}:provider`, provider: surfaceId, sourceUrl: `https://example.test/${surfaceId}` }],
        sources: [{ id: `${surfaceId}:provider`, provider: surfaceId, available: true, recordCount: 1, retrievedAt: NOW, endpoint: `https://example.test/${surfaceId}` }],
      };
      adapter.syncPublicSourceStatus(surfaceId, result, { method, now: NOW });
      return result;
    },
    onPublicRefreshAll: async (method) => {
      const requested = ["world-events", "sports-events", "asset-market", "protocol-evidence", "multi-sport-events", "social-pulse", "picture-matter"];
      const completed = [];
      for (const surfaceId of requested) {
        await adapter.refreshPublicSource(surfaceId, method, { batch: true });
        completed.push({ surfaceId, action: "refresh-settled" });
      }
      return { active: false, requested, completed };
    },
  });
  const allButton = documentRoot.getElementById("live-gateway-public-actions").children[0];
  assert.equal(allButton.id, "live-gateway-refresh-all");
  const result = await adapter.refreshAllPublicSources("test-all");
  assert.equal(result.action, "refresh-all-complete");
  assert.deepEqual(calls.map(({ surfaceId }) => surfaceId), [
    "world-events",
    "sports-events",
    "asset-market",
    "protocol-evidence",
    "multi-sport-events",
    "social-pulse",
    "picture-matter",
  ]);
  assert.equal(calls.every(({ active }) => active === true), true);
  assert.equal(result.batch.completed.length, 7);
  assert.equal(result.aggregate.surfaceCount, 7);
  assert.equal(result.aggregate.status, "partial");
  assert.equal(result.aggregate.unavailableCount >= 1, true);
  assert.match(documentRoot.getElementById("live-gateway-public-refresh-status").textContent, /ALL PUBLIC SOURCES/);
  assert.match(documentRoot.getElementById("live-gateway-public-refresh-status").textContent, /FRESH \d+/);
  assert.match(documentRoot.getElementById("live-gateway-public-refresh-status").textContent, /PARTIAL \d+/);
  assert.match(documentRoot.getElementById("live-gateway-public-refresh-status").textContent, /UNAVAILABLE \d+/);
  assert.match(documentRoot.getElementById("live-gateway-public-refresh-status").textContent, /PROVENANCE VISIBLE/);
  assert.equal(adapter.getSnapshot().publicRefreshBatchActive, false);
  assert.equal(allButton.disabled, false);
  assert.equal(Object.isFrozen(result), true);
});

test("all-surface status refresh is an explicit fixed-order settled batch", async () => {
  const calls = [];
  const documentRoot = makeDocument();
  const adapter = createLiveGatewayConsole({
    documentRoot,
    projection: createLivingRealityProjection().world,
    onPublicRefresh: async (surfaceId, method) => {
      calls.push({ surfaceId, method, at: calls.length });
      if (surfaceId === "asset-market") throw new Error("CoinGecko unavailable in test");
      const result = surfaceId === "world-events" ? worldSnapshot() : {
        status: "ready",
        liveFetch: true,
        externalSource: true,
        retrievedAt: NOW,
        records: [{ id: `${surfaceId}:1`, providerId: `${surfaceId}:provider`, provider: surfaceId, sourceUrl: `https://example.test/${surfaceId}` }],
        sources: [{ id: `${surfaceId}:provider`, provider: surfaceId, available: true, recordCount: 1, retrievedAt: NOW, endpoint: `https://example.test/${surfaceId}` }],
      };
      adapter.syncPublicSourceStatus(surfaceId, result, { method });
      return result;
    },
  });
  // The host route owns the fixed order; each call is awaited before the next
  // one starts, matching the browser-facing `live=all` contract.
  for (const surfaceId of ["world-events", "sports-events", "asset-market", "protocol-evidence", "multi-sport-events", "social-pulse", "picture-matter"]) {
    await adapter.refreshPublicSource(surfaceId, "status-dashboard:all");
  }
  assert.deepEqual(calls.map(({ surfaceId }) => surfaceId), [
    "world-events",
    "sports-events",
    "asset-market",
    "protocol-evidence",
    "multi-sport-events",
    "social-pulse",
    "picture-matter",
  ]);
  assert.equal(calls.length, 7);
  assert.equal(adapter.getSnapshot().publicSourceStatus.surfaceCount, 7);
  assert.equal(adapter.getSnapshot().publicSourceStatus.statuses.length, 8, "World Pulse exposes two provider rows; the seven surfaces remain fixed");
  assert.equal(adapter.getSnapshot().publicSourceStatus.statuses.find((row) => row.surfaceId === "asset-market")?.state, "unavailable");
  assert.equal(adapter.getSnapshot().publicSourceStatus.statuses.find((row) => row.surfaceId === "multi-sport-events")?.state, "ready");
  assert.equal(documentRoot.getElementById("live-gateway-public-refresh-status").textContent, "REFRESH COMPLETE · PICTURE MATTER METADATA · ROWS STAY PROVIDER-RETURNED");
});

test("opt-in auto-refresh runs one immediate seven-source tick and cancels on stop, close, reset, and destroy", async () => {
  const calls = [];
  const documentRoot = makeDocument();
  const adapter = createLiveGatewayConsole({
    documentRoot,
    projection: createLivingRealityProjection().world,
    onPublicRefresh: async (surfaceId, method) => {
      calls.push({ surfaceId, method, active: adapter.getSnapshot().publicRefreshBatchActive });
      const result = surfaceId === "world-events" ? worldSnapshot() : {
        status: "ready",
        liveFetch: true,
        externalSource: true,
        retrievedAt: NOW,
        records: [{ id: `${surfaceId}:1`, providerId: `${surfaceId}:provider`, provider: surfaceId, sourceUrl: `https://example.test/${surfaceId}` }],
        sources: [{ id: `${surfaceId}:provider`, provider: surfaceId, available: true, recordCount: 1, retrievedAt: NOW, endpoint: `https://example.test/${surfaceId}` }],
      };
      adapter.syncPublicSourceStatus(surfaceId, result, { method, now: NOW });
      return result;
    },
    onPublicRefreshAll: async (method) => {
      const requested = LIVE_GATEWAY_PUBLIC_SURFACES.map((surface) => surface.id);
      const completed = [];
      for (const surfaceId of requested) {
        await adapter.refreshPublicSource(surfaceId, method, { batch: true });
        completed.push({ surfaceId, action: "refresh-settled" });
      }
      return { active: false, requested, completed };
    },
  });
  const waitFor = async (predicate, label) => {
    const deadline = Date.now() + 1000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };

  const initial = adapter.getSnapshot();
  assert.equal(initial.publicRefreshAutoEnabled, false);
  assert.equal(initial.publicRefreshAutoTimerActive, false);
  assert.equal(calls.length, 0, "default load must not poll");

  adapter.open();
  const started = adapter.startAutoRefresh("test-auto-start");
  assert.equal(started.action, "auto-refresh-start");
  assert.equal(started.autoRefreshEnabled, true);
  await waitFor(() => adapter.getSnapshot().publicRefreshAutoTickCount === 1 && !adapter.getSnapshot().publicRefreshBatchActive && adapter.getSnapshot().publicRefreshAutoTimerActive, "first auto-refresh tick");
  const afterTick = adapter.getSnapshot();
  assert.equal(calls.length, LIVE_GATEWAY_PUBLIC_SURFACES.length);
  assert.deepEqual(calls.map(({ surfaceId }) => surfaceId), LIVE_GATEWAY_PUBLIC_SURFACES.map((surface) => surface.id));
  assert.equal(calls.every(({ active }) => active === true), true);
  assert.equal(afterTick.publicRefreshAutoIntervalMs, LIVE_GATEWAY_PUBLIC_AUTO_REFRESH_INTERVAL_MS);
  assert.ok(Math.abs((afterTick.publicRefreshAutoNextAt - afterTick.publicRefreshAutoLastTickAt) - LIVE_GATEWAY_PUBLIC_AUTO_REFRESH_INTERVAL_MS) <= 100, "next tick stays within the fixed 30-second cadence");
  assert.match(afterTick.publicRefreshMessage, /AUTO-REFRESH ON/);
  assert.match(afterTick.publicRefreshMessage, /FIXED CADENCE 30S/);
  assert.equal(documentRoot.getElementById("live-gateway-public-actions").children[1].textContent, "Stop auto-refresh · 30s");

  const stopped = adapter.stopAutoRefresh("test-stop");
  assert.equal(stopped.action, "auto-refresh-stop");
  assert.equal(adapter.getSnapshot().publicRefreshAutoEnabled, false);
  assert.equal(adapter.getSnapshot().publicRefreshAutoTimerActive, false);
  assert.match(adapter.getSnapshot().publicRefreshMessage, /AUTO-REFRESH STOPPED/);
  const callsAfterStop = calls.length;
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(calls.length, callsAfterStop, "stop cancels future provider reads");

  // Each lifecycle path cancels the same fixed timer. Reuse the in-memory
  // adapter and wait for its immediate tick so these assertions are not
  // dependent on the 30-second interval.
  adapter.startAutoRefresh("test-close");
  await waitFor(() => adapter.getSnapshot().publicRefreshAutoTimerActive, "timer before close");
  adapter.close();
  assert.equal(adapter.getSnapshot().publicRefreshAutoEnabled, false);
  assert.equal(adapter.getSnapshot().publicRefreshAutoTimerActive, false);

  adapter.open();
  adapter.startAutoRefresh("test-reset");
  await waitFor(() => adapter.getSnapshot().publicRefreshAutoTimerActive, "timer before reset");
  adapter.reset("test-reset");
  assert.equal(adapter.getSnapshot().publicRefreshAutoEnabled, false);
  assert.equal(adapter.getSnapshot().publicRefreshAutoTimerActive, false);

  adapter.open();
  adapter.startAutoRefresh("test-destroy");
  await waitFor(() => adapter.getSnapshot().publicRefreshAutoTimerActive, "timer before destroy");
  adapter.destroy();
  assert.equal(adapter.getSnapshot().publicRefreshAutoEnabled, false);
  assert.equal(adapter.getSnapshot().publicRefreshAutoTimerActive, false);
});

test("main wires panel=live-status&live=all to the fixed public adapter order while preserving plain World Pulse", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /const LIVE_STATUS_PUBLIC_SURFACE_ORDER = Object\.freeze\(\[[\s\S]*?'world-events',[\s\S]*?'sports-events',[\s\S]*?'asset-market',[\s\S]*?'protocol-evidence',[\s\S]*?'multi-sport-events',[\s\S]*?'social-pulse',[\s\S]*?'picture-matter',[\s\S]*?\]\)/);
  assert.match(main, /async function refreshLiveStatusSurfaces\(method = 'status-dashboard', all = false\)/);
  assert.match(main, /for \(const surfaceId of requested\)[\s\S]{0,1600}await liveGatewayConsole\?\.refreshPublicSource\?\.\(surfaceId, method, \{ batch: all === true \}\)/);
  assert.match(main, /const requested = all[\s\S]{0,220}\[LIVE_STATUS_PUBLIC_SURFACE_ORDER\[0\]\]/);
  assert.match(main, /const liveStatusRouteQuery = new URLSearchParams/);
  assert.match(main, /liveStatusRouteQuery\.get\('panel'\) === 'live-status'/);
  assert.match(main, /const refreshAll = liveStatusRouteQuery\.get\('live'\)\?\.toLowerCase\(\) === 'all'/);
  assert.match(main, /openLivePublicStatus\('url', true, \{ all: refreshAll \}\)/);
  assert.match(main, /if \(options\.all === true\) void liveGatewayConsole\?\.refreshAllPublicSources/);
  assert.match(main, /if \(refresh\) \{[\s\S]{0,260}options\.all === true[\s\S]{0,180}refreshAllPublicSources[\s\S]{0,260}else void refreshLiveStatusSurfaces\(`live-status:\$\{method\}`, false\)/);
});

test("public status bridge is static-mounted, host-wired, and renderer-only", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/render/live-gateway.js", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(html, /id=["']live-gateway-public-status["']/);
  assert.match(html, /id=["']live-gateway-public-actions["']/);
  assert.match(html, /id=["']live-gateway-refresh-world-events["']/);
  assert.match(html, /id=["']live-gateway-refresh-sports-events["']/);
  assert.match(html, /id=["']live-gateway-refresh-asset-market["']/);
  assert.match(html, /id=["']live-gateway-refresh-protocol-evidence["']/);
  assert.match(html, /id=["']live-gateway-refresh-multi-sport-events["']/);
  assert.match(html, /id=["']live-gateway-refresh-social-pulse["']/);
  assert.match(html, /id=["']live-gateway-refresh-picture-matter["']/);
  assert.match(html, /id=["']live-gateway-refresh-all["']/);
  assert.match(html, /id=["']live-gateway-auto-refresh["']/);
  assert.match(html, /Refresh all public sources/);
  assert.match(html, /Refresh all public sources runs the seven fixed adapters one at a time/);
  assert.match(html, /Auto-refresh is off by default/);
  assert.match(html, /Public source status · live refresh snapshots/);
  assert.match(html, /Structured humanitarian · UNHCR/);
  assert.match(html, /Legacy mock observations · internal only/);
  assert.match(source, /LIVE_GATEWAY_PUBLIC_STATUS_DOM_ID/);
  assert.match(source, /normalizeStructuredPublicSourceStatus/);
  assert.match(source, /structuredStatuses/);
  assert.match(source, /structuredKind.*humanitarian/);
  assert.match(source, /syncPublicSourceStatus/);
  assert.match(source, /refreshPublicSource/);
  assert.match(source, /refreshAllPublicSources/);
  assert.match(source, /LIVE_GATEWAY_PUBLIC_AUTO_REFRESH_INTERVAL_MS/);
  assert.match(source, /startAutoRefresh/);
  assert.match(source, /stopAutoRefresh/);
  assert.match(source, /setTimeout/);
  assert.doesNotMatch(source, /setInterval/);
  assert.match(source, /LIVE_GATEWAY_PUBLIC_REFRESH_ALL_DOM_ID/);
  assert.match(main, /syncPublicSourceStatus\?\.\('world-events'/);
  assert.match(main, /syncPublicSourceStatus\?\.\('sports-events'/);
  assert.match(main, /syncPublicSourceStatus\?\.\('asset-market'/);
  assert.match(main, /syncPublicSourceStatus\?\.\('protocol-evidence'/);
  assert.match(main, /syncPublicSourceStatus\?\.\('multi-sport-events'/);
  assert.match(main, /syncPublicSourceStatus\?\.\('social-pulse'/);
  assert.match(main, /syncPublicSourceStatus\?\.\('picture-matter'/);
  assert.match(main, /onPublicRefresh:/);
  assert.match(main, /includeLegacyFixture:\s*false/);
  assert.match(main, /20260901-provider-docs/);
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
  assert.doesNotMatch(source, /new\s+WebSocket/i);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i);
});
