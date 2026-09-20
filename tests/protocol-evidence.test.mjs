import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  PROTOCOL_EVIDENCE_ENDPOINTS,
  createUnavailableProtocolEvidence,
  fetchProtocolEvidence,
  summarizeProtocolEvidence,
} from "../src/domains/protocol-evidence.js";

const NOW = "2026-08-28T12:00:00.000Z";

function response(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return payload; } };
}

test("protocol evidence uses a fixed HTTPS DeFiLlama allowlist and starts without values", () => {
  assert.equal(PROTOCOL_EVIDENCE_ENDPOINTS.length, 4);
  assert.ok(PROTOCOL_EVIDENCE_ENDPOINTS.every((endpoint) => endpoint.endpoint.startsWith("https://api.llama.fi/tvl/")));
  const unavailable = createUnavailableProtocolEvidence({ retrievedAt: NOW });
  assert.equal(unavailable.records.length, 4);
  assert.ok(unavailable.records.every((record) => record.currentTvl === null && record.status === "unavailable"));
  assert.equal(unavailable.liveFetch, false);
  assert.equal(unavailable.externalNetwork, false);
});

test("explicit protocol refresh normalizes real numeric TVL responses and keeps provenance", async () => {
  const requested = [];
  const values = { aave: 1000, uniswap: 2000, lido: 3000, makerdao: 4000 };
  const snapshot = await fetchProtocolEvidence({
    now: NOW,
    fetchImpl: async (url, options) => {
      requested.push({ url, options });
      return response(values[url.split("/").pop()]);
    },
  });
  assert.equal(snapshot.status, "ready");
  assert.equal(snapshot.availableCount, 4);
  assert.equal(snapshot.unavailableCount, 0);
  assert.deepEqual(snapshot.records.map((record) => record.currentTvl), [1000, 2000, 3000, 4000]);
  assert.ok(requested.every(({ url, options }) => url.startsWith("https://api.llama.fi/tvl/") && options.method === "GET" && options.headers.accept === "application/json"));
  assert.ok(snapshot.records.every((record) => record.sourceUrl.startsWith("https://defillama.com/protocol/")));
  const summary = summarizeProtocolEvidence(snapshot);
  assert.equal(summary.recordCount, 4);
  assert.equal(summary.availableCount, 4);
  assert.equal(summary.providerAvailable, true);
  assert.match(summary.boundary, /not a quote|settlement/i);
});

test("protocol failures and malformed values remain visible as unavailable without fallback rows", async () => {
  const snapshot = await fetchProtocolEvidence({
    now: NOW,
    fetchImpl: async (url) => {
      if (url.endsWith("/aave")) return response(123);
      if (url.endsWith("/uniswap")) return response({ tvl: "not-a-number" });
      throw new Error("provider offline");
    },
  });
  assert.equal(snapshot.status, "partial");
  assert.equal(snapshot.availableCount, 1);
  assert.equal(snapshot.unavailableCount, 3);
  assert.equal(snapshot.records.find((record) => record.protocolSlug === "aave").currentTvl, 123);
  assert.equal(snapshot.records.filter((record) => record.status === "unavailable").length, 3);
  assert.ok(snapshot.records.filter((record) => record.status === "unavailable").every((record) => record.currentTvl === null));
  const source = await readFile(new URL("../src/domains/protocol-evidence.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /authorization|api[_-]?key|client[_-]?secret/i);
  assert.match(source, /NO DATA FABRICATED|no rows were fabricated/i);
});
