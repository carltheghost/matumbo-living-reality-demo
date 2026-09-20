import assert from "node:assert/strict";
import { test } from "node:test";
import {
  WORLD_EVENTS_ENDPOINTS,
  WORLD_EVENTS_HUMANITARIAN_ENDPOINTS,
  fetchWorldEvents,
  summarizeWorldEvents,
} from "../src/domains/world-events.js";

const NOW = "2026-08-27T12:00:00.000Z";

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

test("UNHCR is a documented credential-free browser-safe structured provider", () => {
  assert.deepEqual(WORLD_EVENTS_HUMANITARIAN_ENDPOINTS.map((endpoint) => endpoint.id), ["unhcr-population"]);
  const endpoint = WORLD_EVENTS_HUMANITARIAN_ENDPOINTS[0];
  assert.equal(endpoint.provider, "UNHCR Refugee Data Finder");
  assert.match(endpoint.endpoint, /^https:\/\//);
  assert.match(endpoint.documentation, /^https:\/\//);
  assert.equal(endpoint.credentialsRequired, false);
  assert.doesNotMatch(endpoint.endpoint, /token|key|secret|password/i);
});

test("UNHCR rows stay on a separate structured humanitarian rail", async () => {
  const calls = [];
  const snapshot = await fetchWorldEvents({
    now: NOW,
    maxRecords: 4,
    endpoints: [WORLD_EVENTS_ENDPOINTS[0]],
    structuredEndpoints: WORLD_EVENTS_HUMANITARIAN_ENDPOINTS,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.includes("api.unhcr.org")) {
        return response({
          page: 1,
          items: [
            {
              year: 2025,
              coo_name: "-",
              coo_iso: "-",
              coa_name: "-",
              coa_iso: "-",
              refugees: 28461306,
              asylum_seekers: 8998097,
              idps: 64239352,
              stateless: 4477220,
            },
            {
              year: 2024,
              coo_name: "Syrian Arab Republic",
              coo_iso: "SYR",
              coa_name: "Türkiye",
              coa_iso: "TUR",
              refugees: "5",
              asylum_seekers: "-",
              idps: "-",
            },
          ],
        });
      }
      return response({
        articles: [{
          url: "https://news.example.test/one",
          title: "Public conflict report",
          seendate: "20260827T113000Z",
        }],
      });
    },
  });

  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.records.length, 1, "headline/event rows remain unchanged");
  assert.equal(snapshot.records[0].providerId, "gdelt-doc");
  assert.equal(snapshot.humanitarian.providerId, "unhcr-population");
  assert.equal(snapshot.humanitarian.provider, "UNHCR Refugee Data Finder");
  assert.equal(snapshot.humanitarian.status, "ready");
  assert.equal(snapshot.humanitarian.records.length, 2);
  assert.equal(snapshot.humanitarianRecords.length, 2);
  assert.equal(snapshot.humanitarianSources.length, 1);
  assert.equal(snapshot.humanitarianSources[0].available, true);

  const aggregate = snapshot.humanitarian.records[0];
  assert.equal(aggregate.observedYear, 2025);
  assert.equal(aggregate.sourceObservedAt, null);
  assert.equal(aggregate.eventTime, null);
  assert.equal(aggregate.eventTimeStatus, "unavailable");
  assert.equal(aggregate.geographyStatus, "unavailable");
  assert.equal(aggregate.geography.origin, null);
  assert.equal(aggregate.geography.asylum, null);
  assert.equal(aggregate.metrics.refugees, 28461306);
  assert.equal(aggregate.metrics.idps, 64239352);
  assert.equal(aggregate.severity, null);
  assert.equal(aggregate.severityStatus, "unknown");
  assert.equal(aggregate.intensity, null);
  assert.equal(aggregate.intensityStatus, "unknown");
  assert.equal(aggregate.titleLanguageSignal, null);
  assert.equal(aggregate.truthClaim, false);
  assert.equal(aggregate.localOnly, true);
  assert.equal(aggregate.executable, false);

  const named = snapshot.humanitarian.records[1];
  assert.equal(named.geographyStatus, "provider-reported");
  assert.deepEqual(named.geography.origin, { name: "Syrian Arab Republic", code: "SYR", providerId: null });
  assert.deepEqual(named.geography.asylum, { name: "Türkiye", code: "TUR", providerId: null });
  assert.equal(named.metrics.refugees, 5);
  assert.equal(named.metrics.asylum_seekers, null, "missing provider metric remains unavailable");
  assert.match(named.sourceUrl, /^https:\/\/api\.unhcr\.org\/population\/v1\/population/);
  assert.match(named.eventTimeBasis, /annual reference year/i);
  assert.match(snapshot.humanitarian.boundary, /severity.*intensity.*unknown/i);

  assert.ok(calls.some(({ url }) => url.startsWith("https://api.unhcr.org/population/v1/population/")));
  assert.ok(calls.some(({ url }) => url.includes("yearFrom=2024") && url.includes("yearTo=2026")));
  assert.ok(calls.every(({ options }) => options.method === "GET"));
  assert.ok(calls.every(({ options }) => !Object.keys(options.headers ?? {}).some((key) => /authorization|token|key|secret/i.test(key))));
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.humanitarian), true);
  assert.equal(Object.isFrozen(snapshot.humanitarian.records[0]), true);
});

test("structured provider failure is explicit and never creates humanitarian rows", async () => {
  const snapshot = await fetchWorldEvents({
    now: NOW,
    endpoints: [WORLD_EVENTS_ENDPOINTS[0]],
    structuredEndpoints: WORLD_EVENTS_HUMANITARIAN_ENDPOINTS,
    fetchImpl: async (url) => {
      if (url.includes("api.unhcr.org")) throw new Error("UNHCR unavailable");
      return response({ articles: [] });
    },
  });
  assert.deepEqual(snapshot.humanitarian.records, []);
  assert.equal(snapshot.humanitarian.status, "unavailable");
  assert.equal(snapshot.humanitarian.providerAvailable, false);
  assert.equal(snapshot.humanitarianSources[0].available, false);
  assert.match(snapshot.humanitarianSources[0].reason, /UNHCR unavailable/i);
  assert.match(snapshot.humanitarian.reason, /no data was fabricated/i);
  const summary = summarizeWorldEvents(snapshot);
  assert.deepEqual(summary.humanitarian.records, []);
  assert.equal(summary.humanitarian.severityStatus, "unknown");
  assert.equal(summary.humanitarian.intensityStatus, "unknown");
});

