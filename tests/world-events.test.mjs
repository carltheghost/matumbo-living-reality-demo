import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WORLD_EVENTS_DEFAULT_QUERY,
  WORLD_EVENTS_ENDPOINTS,
  WORLD_EVENTS_OPTIONAL_ENDPOINTS,
  WORLD_EVENTS_MAX_QUERY_LENGTH,
  fetchWorldEvents,
  normalizeWorldEventsQuery,
  replayWorldEventEvidence,
  summarizeWorldEventMapCells,
  summarizeWorldEventRealityBrutality,
  summarizeWorldEvents,
  worldEventMapCell,
} from "../src/domains/world-events.js";

const NOW = "2026-08-27T12:00:00.000Z";

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

function textResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return payload; },
  };
}

test("default world-event sources are public no-key endpoints and ReliefWeb is opt-in", () => {
  assert.deepEqual(WORLD_EVENTS_ENDPOINTS.map((endpoint) => endpoint.id), [
    "gdelt-doc",
    "nyt-world-rss",
    "usgs-earthquakes",
    "nasa-eonet",
  ]);
  assert.equal(WORLD_EVENTS_OPTIONAL_ENDPOINTS[0].id, "reliefweb-reports");
  assert.equal(WORLD_EVENTS_OPTIONAL_ENDPOINTS[0].appNameRequired, true);
  assert.match(WORLD_EVENTS_ENDPOINTS[0].endpoint, /^https:\/\//);
  for (const endpoint of WORLD_EVENTS_ENDPOINTS) {
    assert.doesNotMatch(endpoint.endpoint, /token|key|secret|password/i);
  }
});

test("public query normalization is bounded, visible, and falls back safely", () => {
  assert.equal(normalizeWorldEventsQuery("  conflict\n\t crisis  "), "conflict crisis");
  assert.equal(normalizeWorldEventsQuery(""), WORLD_EVENTS_DEFAULT_QUERY);
  assert.equal(normalizeWorldEventsQuery(null), WORLD_EVENTS_DEFAULT_QUERY);
  const oversized = normalizeWorldEventsQuery("x".repeat(WORLD_EVENTS_MAX_QUERY_LENGTH + 40));
  assert.equal(oversized.length, WORLD_EVENTS_MAX_QUERY_LENGTH);
  assert.doesNotMatch(normalizeWorldEventsQuery("unsafe\u0000query"), /[\u0000-\u001f\u007f]/);
});

test("title-language signals use whole words and safe inflections", async () => {
  const snapshot = await fetchWorldEvents({
    now: NOW,
    endpoints: [WORLD_EVENTS_ENDPOINTS[0]],
    structuredEndpoints: [],
    fetchImpl: async () => response({
      articles: [
        { url: "https://news.example.test/warning", title: "Warning systems are active" },
        { url: "https://news.example.test/war", title: "War monitor publishes a report" },
        { url: "https://news.example.test/attacks", title: "Attacks reported overnight" },
      ],
    }),
  });
  assert.deepEqual(snapshot.records.map((record) => record.brutalityLanguageSignal.level), [0, 1, 2]);
  assert.deepEqual(snapshot.records.map((record) => record.brutalityLanguageSignal.matchedTerms), [[], ["war"], ["attack"]]);
  assert.equal(snapshot.records[0].classification, "public-source event mention");
  assert.equal(snapshot.records[1].classification, "conflict mention");
  assert.equal(snapshot.records[2].classification, "violence / conflict mention");
});

test("explicit refresh normalizes GDELT, NYT RSS, USGS, and NASA public records with provenance", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("gdeltproject.org")) {
      return response({
        articles: [
          { url: "https://news.example.test/one", title: "Conflict report", seendate: "20260827T113000Z" },
          { title: "Missing source URL" },
          { url: "https://user:password@news.example.test/credentialed", title: "Credentialed source must be ignored" },
        ],
      });
    }
    if (url.includes("rss.nytimes.com")) {
      return textResponse(`<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0"><channel>
          <item>
            <title><![CDATA[World conflict report]]></title>
            <link>https://www.nytimes.com/2026/08/27/world/example.html</link>
            <guid isPermaLink="false">nyt-1</guid>
            <pubDate>Thu, 27 Aug 2026 11:45:00 GMT</pubDate>
          </item>
        </channel></rss>`);
    }
    if (url.includes("earthquake.usgs.gov")) {
      return response({
        features: [{
          id: "usgs-1",
          properties: {
            url: "https://earthquake.usgs.gov/earthquakes/eventpage/usgs-1",
            title: "M 4.2 - Public earthquake record",
            time: Date.parse("2026-08-27T11:00:00.000Z"),
          },
          geometry: { type: "Point", coordinates: [-73.9, 40.7, 10] },
        }],
      });
    }
    if (url.includes("eonet.gsfc.nasa.gov")) {
      return response({
        events: [{
          id: "nasa-1",
          title: "Public environmental event",
          sources: [{ id: "source", url: "https://eonet.gsfc.nasa.gov/api/v3/events/nasa-1" }],
          geometry: [{ date: "2026-08-27T10:30:00.000Z", coordinates: [12.5, 41.9] }],
        }],
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const snapshot = await fetchWorldEvents({ fetchImpl, now: NOW, maxRecords: 12 });
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.query, WORLD_EVENTS_DEFAULT_QUERY);
  assert.equal(snapshot.retrievedAt, NOW);
  assert.equal(snapshot.records.length, 4);
  assert.equal(snapshot.sources.length, 4);
  assert.deepEqual(snapshot.records.map((record) => record.providerId), [
    "gdelt-doc",
    "nyt-world-rss",
    "usgs-earthquakes",
    "nasa-eonet",
  ]);
  assert.equal(snapshot.records[0].eventTime, null, "GDELT article publication time is not an occurrence claim");
  assert.equal(snapshot.records[0].sourceObservedAt, "2026-08-27T11:30:00.000Z");
  assert.equal(snapshot.records[0].eventTimeStatus, "unavailable");
  assert.equal(snapshot.records[0].brutalityLanguageSignal.level, 1);
  assert.equal(snapshot.records[0].brutalityLanguageSignal.band, "conflict-context");
  assert.deepEqual(snapshot.records[0].brutalityLanguageSignal.matchedTerms, ["conflict"]);
  assert.equal(snapshot.records[1].eventTime, null, "RSS publication time is not an occurrence claim");
  assert.equal(snapshot.records[1].sourceObservedAt, "2026-08-27T11:45:00.000Z");
  assert.equal(snapshot.records[1].eventTimeStatus, "unavailable");
  assert.equal(snapshot.records[1].rawId, "nyt-1");
  assert.equal(snapshot.records[2].eventTime, "2026-08-27T11:00:00.000Z");
  assert.equal(snapshot.records[2].eventTimeStatus, "provider-reported");
  assert.deepEqual(snapshot.records[2].coordinates, { longitude: -73.9, latitude: 40.7 });
  assert.equal(snapshot.records[2].geographyStatus, "provider-reported");
  assert.equal(snapshot.records[3].eventTime, "2026-08-27T10:30:00.000Z");
  assert.deepEqual(snapshot.records[3].coordinates, { longitude: 12.5, latitude: 41.9 });
  assert.equal(snapshot.records[0].geographyStatus, "unavailable");
  assert.equal(snapshot.records[1].geographyStatus, "unavailable");
  assert.equal(snapshot.brutalityLanguageSignalCount, 2);
  assert.equal(snapshot.explicitBrutalityLanguageSignalCount, 0);
  assert.deepEqual(snapshot.geographicCoverage, {
    status: "partial",
    returnedRecordCount: 4,
    mappedCount: 2,
    mapUnavailableCount: 2,
    basis: "Provider-returned bounded coordinates only; no geocoding or place inference is performed.",
  });
  assert.deepEqual(snapshot.signalCoverage, {
    status: "available",
    returnedRecordCount: 4,
    signalCount: 2,
    noSignalCount: 2,
    explicitSignalCount: 0,
    basis: "Existing title-language signal only; this is not a verified severity, casualty, or violence determination.",
  });
  assert.deepEqual(snapshot.signalField.bands.map((band) => band.recordCount), [2, 2, 0, 0]);
  assert.equal(snapshot.signalField.mappedCount, 2);
  assert.equal(snapshot.signalField.mapUnavailableCount, 2);
  assert.equal(snapshot.mapCells.recordCount, 4);
  assert.equal(snapshot.mapCells.mappedRecordCount, 2);
  assert.equal(snapshot.mapCells.mapUnavailableCount, 2);
  assert.deepEqual(snapshot.mapCells.cells.map((cell) => cell.id), ["north:west", "north:central"]);
  assert.deepEqual(snapshot.mapCells.cells.map((cell) => cell.recordCount), [1, 1]);
  assert.match(snapshot.mapCells.basis, /not geocoded|no geocoding/i);
  assert.match(snapshot.signalField.basis, /title-language|severity/i);
  assert.match(snapshot.brutalitySignalBasis, /title-language|severity/i);
  for (const record of snapshot.records) {
    assert.equal(record.retrievedAt, NOW);
    assert.ok(record.sourceUrl.startsWith("https://"));
    assert.doesNotMatch(record.sourceUrl, /@/);
    assert.equal(record.confidence, 0);
    assert.equal(record.uncertainty, 1);
    assert.equal(record.truthClaim, false);
    assert.equal(record.complete, false);
    assert.equal(record.localOnly, true);
    assert.equal(record.executable, false);
  }
  assert.ok(calls.every(({ options }) => options.method === "GET"));
  assert.ok(calls.every(({ options }) => !Object.keys(options.headers ?? {}).some((key) => /authorization|token|key|secret/i.test(key))));
  assert.ok(calls.some(({ url }) => url.includes("query=%28violence+OR+conflict")));
  assert.ok(calls.some(({ url }) => url.startsWith("https://rss.nytimes.com/")));
  assert.ok(calls.some(({ url }) => url.startsWith("https://earthquake.usgs.gov/")));
  assert.ok(calls.some(({ url }) => url.startsWith("https://eonet.gsfc.nasa.gov/")));
  assert.ok(calls.every(({ url }) => !/reliefweb/i.test(url)));
  assert.ok(snapshot.sources.every((source) => source.simulation === true && source.truthClaim === false && source.complete === false));
  assert.equal(snapshot.externalNetwork, true, "the envelope records that explicit provider I/O occurred");
  assert.equal(Object.isFrozen(snapshot), true);
});

test("coverage summaries reject invalid coordinates and never geocode missing places", async () => {
  const snapshot = await fetchWorldEvents({
    fetchImpl: async (url) => {
      if (url.includes("earthquake.usgs.gov")) {
        return response({ features: [{
          id: "bad-coordinate",
          properties: { url: "https://earthquake.usgs.gov/earthquakes/eventpage/bad-coordinate", title: "Public hazard record" },
          geometry: { type: "Point", coordinates: [999, 91] },
        }] });
      }
      if (url.includes("gdeltproject.org")) {
        return response({ articles: [{ url: "https://news.example.test/no-place", title: "Public conflict report" }] });
      }
      return response({});
    },
    now: NOW,
    maxRecords: 4,
    endpoints: [WORLD_EVENTS_ENDPOINTS[0], WORLD_EVENTS_ENDPOINTS[2]],
  });
  assert.equal(snapshot.records.length, 2);
  assert.equal(snapshot.records.every((record) => record.coordinates === null), true);
  assert.equal(snapshot.records.every((record) => record.geographyStatus === "unavailable"), true);
  assert.equal(snapshot.geographicCoverage.status, "map-unavailable");
  assert.equal(snapshot.geographicCoverage.mappedCount, 0);
  assert.equal(snapshot.geographicCoverage.mapUnavailableCount, 2);
  assert.match(snapshot.geographicCoverage.basis, /no geocoding|coordinates only/i);
  const summary = summarizeWorldEvents(snapshot);
  assert.equal(summary.geographicCoverage.status, "map-unavailable");
  assert.equal(summary.geographicCoverage.returnedRecordCount, 2);
  assert.equal(summary.signalField.recordCount, 2);
  assert.equal(summary.signalField.mapUnavailableCount, 2);
  assert.equal(summary.mapCells.activeCellCount, 0);
  assert.equal(Object.isFrozen(summary.geographicCoverage), true);
});

test("map-cell projection uses bounded coordinate buckets and never invents a place", () => {
  const records = [
    { id: "north-west", providerId: "one", coordinates: { longitude: -120, latitude: 45 }, brutalityLanguageSignal: { level: 3 } },
    { id: "equatorial-central", providerId: "two", coordinates: { longitude: 0, latitude: 0 }, brutalityLanguageSignal: { level: 1 } },
    { id: "south-east", providerId: "three", coordinates: { longitude: 120, latitude: -45 }, brutalityLanguageSignal: { level: 0 } },
    { id: "unmapped", providerId: "four", coordinates: null, brutalityLanguageSignal: { level: 2 } },
  ];
  assert.equal(worldEventMapCell(records[0]).id, "north:west");
  assert.equal(worldEventMapCell(records[1]).id, "equatorial:central");
  assert.equal(worldEventMapCell(records[2]).id, "south:east");
  assert.equal(worldEventMapCell(records[3]), null);
  const field = summarizeWorldEventMapCells(records);
  assert.equal(field.recordCount, 4);
  assert.equal(field.mappedRecordCount, 3);
  assert.equal(field.mapUnavailableCount, 1);
  assert.equal(field.activeCellCount, 3);
  assert.deepEqual(field.cells.map((cell) => cell.id), ["north:west", "equatorial:central", "south:east"]);
  assert.deepEqual(field.cells.map((cell) => cell.signalCounts), [[0, 0, 0, 1], [0, 1, 0, 0], [1, 0, 0, 0]]);
  assert.equal(field.cells[0].explicitSignalCount, 1);
  assert.equal(Object.isFrozen(field), true);
  assert.equal(Object.isFrozen(field.cells[0]), true);
  assert.match(field.basis, /coordinate|geocod/i);
});

test("Reality/Brutality readout derives only from returned bands, providers, and map cells", () => {
  const records = [
    {
      id: "context",
      providerId: "nyt",
      coordinates: { longitude: -73, latitude: 40 },
      brutalityLanguageSignal: { level: 1 },
    },
    {
      id: "explicit",
      providerId: "usgs",
      coordinates: null,
      brutalityLanguageSignal: { level: 3 },
    },
    {
      id: "none",
      providerId: "nasa",
      coordinates: null,
      brutalityLanguageSignal: { level: 0 },
    },
  ];
  const readout = summarizeWorldEventRealityBrutality(records, [
    { id: "nyt", provider: "NYT", available: true, recordCount: 1 },
    { id: "usgs", provider: "USGS", available: false, recordCount: 0, reason: "timeout" },
  ]);
  assert.equal(readout.recordCount, 3);
  assert.equal(readout.signalRecordCount, 2);
  assert.equal(readout.contextualSignalCount, 1);
  assert.equal(readout.violenceSignalCount, 1);
  assert.equal(readout.explicitSignalCount, 1);
  assert.equal(readout.mappedCount, 1);
  assert.equal(readout.mapUnavailableCount, 2);
  assert.equal(readout.activeMapCellCount, 1);
  assert.equal(readout.availableProviderCount, 1);
  assert.equal(readout.unavailableProviderCount, 1);
  assert.deepEqual(readout.focusRecordIds, ["context", "explicit", "none"]);
  assert.match(readout.basis, /not a verified brutality/i);
  assert.equal(readout.truthClaim, false);
  assert.equal(Object.isFrozen(readout), true);
});

test("offline and malformed providers remain unavailable without synthetic records", async () => {
  const endpoints = WORLD_EVENTS_ENDPOINTS.map((endpoint) => ({ ...endpoint }));
  const offline = await fetchWorldEvents({
    fetchImpl: async () => { throw new Error("offline"); },
    now: NOW,
    endpoints,
  });
  assert.equal(offline.status, "unavailable");
  assert.deepEqual(offline.records, []);
  assert.equal(offline.providerAvailable, false);
  assert.equal(offline.providerUnavailable, true);
  assert.match(offline.reason, /no provider returned|offline/i);

  const malformed = await fetchWorldEvents({
    fetchImpl: async () => response({ nope: "not a provider payload" }),
    now: NOW,
    endpoints: [endpoints[0]],
  });
  assert.equal(malformed.status, "unavailable");
  assert.deepEqual(malformed.records, []);
  assert.equal(malformed.sources[0].available, true);
  assert.match(malformed.sources[0].reason, /no rows|source URL and title/i);

  const noFetch = await fetchWorldEvents({ fetchImpl: null, now: NOW });
  assert.equal(noFetch.liveFetch, false);
  assert.equal(noFetch.externalNetwork, false);
  assert.deepEqual(noFetch.records, []);
});

test("custom endpoint failures are isolated and non-HTTPS endpoints are rejected", async () => {
  let callCount = 0;
  const snapshot = await fetchWorldEvents({
    fetchImpl: async () => { callCount += 1; return response({ articles: [] }); },
    now: NOW,
    endpoints: [
      { id: "bad-url", provider: "Bad URL", endpoint: "not-a-url", format: "gdelt-doc" },
      { id: "insecure-url", provider: "Insecure URL", endpoint: "http://example.test/events", format: "gdelt-doc" },
    ],
  });
  assert.equal(callCount, 0);
  assert.equal(snapshot.status, "unavailable");
  assert.equal(snapshot.records.length, 0);
  assert.equal(snapshot.sources.length, 2);
  assert.match(snapshot.sources[0].reason, /invalid|URL|only documented HTTPS/i);
  assert.match(snapshot.sources[1].reason, /HTTPS/i);
});

test("a stalled public endpoint is bounded and does not block the empty-state contract", async () => {
  const started = Date.now();
  const snapshot = await fetchWorldEvents({
    fetchImpl: async (_url, options) => new Promise((_, reject) => {
      options.signal?.addEventListener("abort", () => reject(new Error("provider timed out")), { once: true });
    }),
    now: NOW,
    timeoutMs: 5,
    endpoints: [WORLD_EVENTS_ENDPOINTS[0]],
  });
  assert.equal(snapshot.status, "unavailable");
  assert.deepEqual(snapshot.records, []);
  assert.match(snapshot.sources[0].reason, /timed out|abort/i);
  assert.ok(Date.now() - started < 1_000, "timeout should be bounded for an interactive refresh");
});

test("a stalled public endpoint does not starve sibling feeds", async () => {
  const endpoints = [
    { ...WORLD_EVENTS_ENDPOINTS[0] },
    { ...WORLD_EVENTS_ENDPOINTS[2] },
    { ...WORLD_EVENTS_ENDPOINTS[3] },
  ];
  const started = [];
  const snapshot = await fetchWorldEvents({
    now: NOW,
    endpoints,
    structuredEndpoints: [],
    timeoutMs: 20,
    fetchImpl: async (url, options) => {
      started.push(url);
      if (url.includes("gdeltproject.org")) {
        return new Promise((_, reject) => {
          options.signal?.addEventListener("abort", () => reject(new Error("provider timed out")), { once: true });
        });
      }
      if (url.includes("earthquake.usgs.gov")) {
        return response({ features: [{
          id: "sibling-usgs",
          properties: { url: "https://earthquake.usgs.gov/earthquakes/eventpage/sibling-usgs", title: "Sibling public earthquake" },
          geometry: { type: "Point", coordinates: [12, 48, 5] },
        }] });
      }
      return response({ events: [{
        id: "sibling-nasa",
        title: "Sibling public environmental event",
        sources: [{ id: "source", url: "https://eonet.gsfc.nasa.gov/api/v3/events/sibling-nasa" }],
        geometry: [{ date: NOW, coordinates: [2, 41] }],
      }] });
    },
  });
  assert.equal(started.length, 3, "all allowlisted providers should start before a slow provider times out");
  assert.ok(started[0].includes("gdeltproject.org"));
  assert.ok(started.some((url) => url.includes("earthquake.usgs.gov")));
  assert.ok(started.some((url) => url.includes("eonet.gsfc.nasa.gov")));
  assert.equal(snapshot.sources.length, 3);
  assert.equal(snapshot.sources[0].available, false);
  assert.match(snapshot.sources[0].reason, /timed out|abort/i);
  assert.equal(snapshot.sources[1].available, true);
  assert.equal(snapshot.sources[2].available, true);
  assert.deepEqual(snapshot.records.map((record) => record.providerId), ["usgs-earthquakes", "nasa-eonet"]);
  assert.equal(snapshot.status, "partial");
});

test("ReliefWeb is never contacted without an explicit approved appname", async () => {
  const endpoint = { ...WORLD_EVENTS_OPTIONAL_ENDPOINTS[0] };
  let callCount = 0;
  const skipped = await fetchWorldEvents({
    fetchImpl: async () => { callCount += 1; return response({ data: [] }); },
    now: NOW,
    endpoints: [endpoint],
  });
  assert.equal(callCount, 0);
  assert.equal(skipped.status, "unavailable");
  assert.equal(skipped.sources[0].skipped, true);
  assert.match(skipped.sources[0].reason, /appname/i);

  const requests = [];
  const approved = await fetchWorldEvents({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return response({
        data: [{
          id: "rw-1",
          fields: {
            title: "Humanitarian public report",
            url: "https://reliefweb.int/report/example/rw-1",
            date: "2026-08-27T09:00:00.000Z",
          },
        }],
      });
    },
    now: NOW,
    appName: "approved-demo-app",
    endpoints: [endpoint],
  });
  assert.equal(approved.status, "ready");
  assert.equal(approved.records[0].sourceUrl, "https://reliefweb.int/report/example/rw-1");
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /appname=approved-demo-app/);
  assert.doesNotMatch(requests[0].url, /token|secret|password/i);
});

test("replay and summary are deterministic, local-only, and do not refetch", async () => {
  let calls = 0;
  const snapshot = await fetchWorldEvents({
    fetchImpl: async () => {
      calls += 1;
      return response({ articles: [{ url: "https://news.example.test/replay", title: "Replay report", seendate: "20260827090000" }] });
    },
    now: NOW,
    endpoints: [WORLD_EVENTS_ENDPOINTS[0]],
  });
  assert.equal(calls, 1);
  const first = replayWorldEventEvidence(snapshot, snapshot.records[0].id, "test-replay");
  const second = replayWorldEventEvidence(snapshot, snapshot.records[0].id, "test-replay");
  assert.deepEqual(first, second);
  assert.equal(first.liveFetch, false);
  assert.equal(first.externalNetwork, false);
  assert.equal(first.deterministic, true);
  assert.equal(first.truthClaim, false);
  assert.equal(first.executable, false);
  assert.equal(calls, 1);
  const summary = summarizeWorldEvents(snapshot);
  assert.equal(summary.recordCount, 1);
  assert.equal(summary.availableProviderCount, 1);
  assert.equal(summary.externalNetwork, true);
  assert.equal(summary.localOnly, true);
});
