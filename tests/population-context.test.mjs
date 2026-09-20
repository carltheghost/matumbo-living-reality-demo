import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  POPULATION_CONTEXT_DOCUMENTATION,
  POPULATION_CONTEXT_ENDPOINT,
  POPULATION_CONTEXT_END_YEAR,
  POPULATION_CONTEXT_INDICATOR,
  POPULATION_CONTEXT_MAX_ROWS,
  POPULATION_CONTEXT_PROVIDER,
  POPULATION_CONTEXT_START_YEAR,
  POPULATION_CONTEXTS,
  buildWorldBankPopulationUrl,
  createUnavailablePopulationContext,
  fetchPopulationContext,
  summarizePopulationContext,
} from "../src/domains/population-context.js";

const NOW = "2026-08-28T14:00:00.000Z";

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

test("population context starts unavailable and never creates fallback observations", () => {
  const snapshot = createUnavailablePopulationContext({ retrievedAt: NOW });
  assert.equal(snapshot.status, "unavailable");
  assert.equal(snapshot.records.length, 0);
  assert.equal(snapshot.contextStatuses.length, POPULATION_CONTEXTS.length);
  assert.ok(snapshot.contextStatuses.every((context) => context.status === "unavailable"));
  assert.equal(snapshot.externalNetwork, false);
  assert.equal(snapshot.providerAvailable, false);
  assert.equal(snapshot.recipientCount, false);
  assert.equal(snapshot.allocationWeight, false);
  assert.match(snapshot.boundary, /not recipient counts|allocation weights/i);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.contextStatuses), true);
});

test("World Bank URL is fixed to the allowlisted contexts, indicator, years, and row cap", () => {
  const url = buildWorldBankPopulationUrl();
  assert.equal(url, POPULATION_CONTEXT_ENDPOINT);
  assert.ok(url.startsWith("https://api.worldbank.org/v2/country/"));
  assert.match(url, new RegExp(`/indicator/${POPULATION_CONTEXT_INDICATOR}\\?`));
  const parsed = new URL(url);
  assert.equal(parsed.hostname, "api.worldbank.org");
  assert.equal(parsed.searchParams.get("format"), "json");
  assert.equal(parsed.searchParams.get("date"), `${POPULATION_CONTEXT_START_YEAR}:${POPULATION_CONTEXT_END_YEAR}`);
  assert.equal(parsed.searchParams.get("per_page"), String(POPULATION_CONTEXT_MAX_ROWS));
  assert.equal(parsed.searchParams.get("page"), "1");
  for (const context of POPULATION_CONTEXTS) assert.ok(parsed.pathname.includes(context.code));
  assert.match(POPULATION_CONTEXT_DOCUMENTATION, /^https:\/\//);
});

test("explicit refresh normalizes only usable fixed-context population observations", async () => {
  const requested = [];
  const payload = [
    { page: 1, pages: 1, per_page: POPULATION_CONTEXT_MAX_ROWS, total: 5, lastupdated: "2026-07-13" },
    [
      { indicator: { id: "SP.POP.TOTL", value: "Population, total" }, country: { id: "US", value: "United States\u0000" }, countryiso3code: "USA", date: "2024", value: 340_110_988 },
      { indicator: { id: "SP.POP.TOTL", value: "Population, total" }, country: { id: "KE", value: "Kenya" }, countryiso3code: "KEN", date: "2023", value: "55100586" },
      { indicator: { id: "SP.POP.TOTL", value: "Population, total" }, country: { id: "FR", value: "France" }, countryiso3code: "FRA", date: "2024", value: 68_000_000 },
      { indicator: { id: "WRONG", value: "Other" }, country: { id: "IN", value: "India" }, countryiso3code: "IND", date: "2024", value: 1_400_000_000 },
      { indicator: { id: "SP.POP.TOTL", value: "Population, total" }, country: { id: "BR", value: "Brazil" }, countryiso3code: "BRA", date: "2024", value: "NaN" },
    ],
  ];
  const snapshot = await fetchPopulationContext({
    now: NOW,
    fetchImpl: async (url, options) => {
      requested.push({ url, options });
      return response(payload);
    },
  });
  assert.equal(requested.length, 1);
  assert.equal(requested[0].url, POPULATION_CONTEXT_ENDPOINT);
  assert.equal(requested[0].options.method, "GET");
  assert.equal(requested[0].options.headers.accept, "application/json");
  assert.equal(snapshot.status, "partial");
  assert.equal(snapshot.records.length, 2);
  assert.deepEqual(snapshot.records.map((record) => record.contextCode), ["USA", "KEN"]);
  assert.equal(snapshot.records[0].population, 340_110_988);
  assert.equal(snapshot.records[0].countryName, "United States");
  assert.equal(snapshot.records.every((record) => record.indicator === POPULATION_CONTEXT_INDICATOR), true);
  assert.equal(snapshot.contextStatuses.filter((context) => context.status === "provider-reported").length, 2);
  assert.equal(snapshot.availableContextCount, 2);
  assert.equal(snapshot.contextCount, POPULATION_CONTEXTS.length);
  assert.equal(snapshot.contextStatuses.find((context) => context.contextCode === "USA").latestYear, 2024);
  assert.equal(snapshot.providerAvailable, true);
  assert.equal(snapshot.externalNetwork, true);
  assert.equal(snapshot.recipientCount, false);
  assert.equal(snapshot.allocationWeight, false);
  assert.equal(snapshot.geocoded, false);
  assert.equal(snapshot.identityResolution, false);
  assert.equal(Object.isFrozen(snapshot.records), true);
  const summary = summarizePopulationContext(snapshot);
  assert.equal(summary.recordCount, 2);
  assert.equal(summary.availableContextCount, 2);
  assert.equal(summary.requestedYears.from, POPULATION_CONTEXT_START_YEAR);
  assert.equal(summary.requestedYears.to, POPULATION_CONTEXT_END_YEAR);
  assert.match(summary.boundary, /contextual public metadata/i);
});

test("HTTP, malformed, and empty provider responses fail closed without mock rows", async () => {
  const failed = await fetchPopulationContext({ now: NOW, fetchImpl: async () => response({ error: "offline" }, 503) });
  assert.equal(failed.status, "unavailable");
  assert.equal(failed.records.length, 0);
  assert.equal(failed.contextStatuses.length, POPULATION_CONTEXTS.length);
  assert.match(failed.reason, /World Bank population context is unavailable/i);

  const malformed = await fetchPopulationContext({ now: NOW, fetchImpl: async () => response([{}]) });
  assert.equal(malformed.status, "unavailable");
  assert.equal(malformed.records.length, 0);
  assert.match(malformed.reason, /invalid indicator envelope/i);

  const empty = await fetchPopulationContext({ now: NOW, fetchImpl: async () => response([{ total: 0 }, []]) });
  assert.equal(empty.status, "unavailable");
  assert.equal(empty.records.length, 0);
  assert.match(empty.reason, /no usable SP\.POP\.TOTL observations/i);

  const source = await readFile(new URL("../src/domains/population-context.js", import.meta.url), "utf8");
  assert.match(source, /api\.worldbank\.org\/v2/);
  assert.match(source, /SP\.POP\.TOTL/);
  assert.doesNotMatch(source, /api[_-]?key|client[_-]?secret/i);
  assert.match(source, /no fallback.*rows were fabricated/i);
});
