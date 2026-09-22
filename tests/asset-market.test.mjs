import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
  ASSET_MARKET_ENDPOINTS,
  ASSET_MARKET_PEER_ASSET_IDS,
  createUnavailableAssetMarketEvidence,
  fetchAssetMarketEvidence,
  replayAssetMarketEvidence,
  summarizeAssetMarketEvidence,
} from "../src/domains/asset-market.js";

const NOW = "2026-08-28T05:00:00.000Z";

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; },
  };
}

function marketRow(id, values = {}) {
  const labels = {
    bitcoin: ["Bitcoin", "btc"],
    ethereum: ["Ethereum", "eth"],
    "official-trump": ["Official Trump", "trump"],
    "melania-meme": ["Melania Meme", "melania"],
  };
  const [name, symbol] = labels[id];
  return {
    id,
    name,
    symbol,
    current_price: 12.34,
    market_cap: 123456,
    market_cap_rank: 10,
    fully_diluted_valuation: 234567,
    total_volume: 45678,
    high_24h: 13,
    low_24h: 11,
    price_change_24h: 0.5,
    price_change_percentage_24h: 4.2,
    market_cap_change_24h: 123,
    market_cap_change_percentage_24h: 0.1,
    circulating_supply: 100000,
    total_supply: 1000000,
    max_supply: 1000000,
    ath: 100,
    ath_change_percentage: -87,
    ath_date: "2025-01-01T00:00:00.000Z",
    atl: 1,
    atl_change_percentage: 1200,
    atl_date: "2024-01-01T00:00:00.000Z",
    image: `https://coin-images.coingecko.com/coins/${id}.png`,
    last_updated: NOW,
    ...values,
  };
}

test("keyless CoinGecko read normalizes the fixed peer set and keeps TUMBO explicitly unlisted", async () => {
  const requested = [];
  const payload = ASSET_MARKET_PEER_ASSET_IDS.map((id) => marketRow(id));
  const snapshot = await fetchAssetMarketEvidence({
    now: NOW,
    fetchImpl: async (url, options) => {
      requested.push({ url, options });
      return response(payload);
    },
  });
  assert.equal(snapshot.status, "ready");
  assert.deepEqual(snapshot.records.map((record) => record.assetId), ASSET_MARKET_PEER_ASSET_IDS);
  assert.equal(snapshot.records.length, ASSET_MARKET_PEER_ASSET_IDS.length);
  assert.equal(snapshot.sources[0].available, true);
  assert.deepEqual(snapshot.nativeAsset, {
    id: "tumbo-sim",
    symbol: "TUMBO-SIM",
    name: "TUMBO-SIM",
    listingStatus: "unlisted",
    listed: false,
    marketDataAvailable: false,
    priceStatus: "not-provided",
    marketStatus: "not-a-market-instrument",
    source: "local asset-token declaration",
    note: "TUMBO-SIM is a fictional local display unit. CoinGecko is not queried for a TUMBO listing or price.",
    localOnly: true,
    simulation: true,
    externalSource: false,
    truthClaim: false,
    executable: false,
  });
  assert.equal(Object.hasOwn(snapshot.nativeAsset, "currentPrice"), false);
  assert.equal(snapshot.records[0].currentPrice, 12.34);
  assert.equal(snapshot.records[0].dataCompletenessGrade, "A");
  assert.match(snapshot.records[0].sourceUrl, /^https:\/\/api\.coingecko\.com\//);
  assert.match(snapshot.records[0].assetPageUrl, /coingecko\.com\/en\/coins\/bitcoin/);
  assert.match(snapshot.records[0].coinPageUrl, /coingecko\.com\/en\/coins\/bitcoin/);
  assert.equal(snapshot.records[0].assetPageUrl, snapshot.records[0].coinPageUrl);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.records[0]), true);
  assert.equal(requested.length, 1);
  assert.match(requested[0].url, /ids=bitcoin%2Cethereum%2Ctether%2Cbinancecoin/);
  assert.equal(requested[0].options.method, "GET");
  assert.equal(requested[0].options.headers.accept, "application/json");
  assert.equal(Object.hasOwn(requested[0].options.headers, "authorization"), false);
});

test("missing provider rows remain partial with no fixture replacement", async () => {
  const snapshot = await fetchAssetMarketEvidence({
    now: NOW,
    assetIds: ["bitcoin", "ethereum"],
    fetchImpl: async () => response([marketRow("bitcoin")]),
  });
  assert.equal(snapshot.status, "partial");
  assert.deepEqual(snapshot.requestedAssetIds, ["bitcoin", "ethereum"]);
  assert.deepEqual(snapshot.records.map((record) => record.assetId), ["bitcoin"]);
  assert.deepEqual(snapshot.missingAssetIds, ["ethereum"]);
  assert.match(snapshot.reason ?? snapshot.sources[0].reason, /ethereum/i);
  assert.equal(snapshot.nativeAsset.listingStatus, "unlisted");
});

test("provider failure and malformed responses fail closed without fake market data", async () => {
  const failed = await fetchAssetMarketEvidence({ now: NOW, fetchImpl: async () => { throw new Error("rate limited"); } });
  assert.equal(failed.status, "unavailable");
  assert.deepEqual(failed.records, []);
  assert.equal(failed.providerUnavailable, true);
  assert.match(failed.reason, /rate limited/i);

  const malformed = await fetchAssetMarketEvidence({ now: NOW, fetchImpl: async () => response({ data: [] }) });
  assert.equal(malformed.status, "unavailable");
  assert.deepEqual(malformed.records, []);
  assert.match(malformed.reason, /malformed|No CoinGecko/i);

  const empty = createUnavailableAssetMarketEvidence({ retrievedAt: NOW });
  assert.deepEqual(empty.records, []);
  assert.equal(empty.nativeAsset.listed, false);
  assert.match(empty.boundary, /unlisted|no CoinGecko listing|no wallet/i);
});

test("summary and replay are local, immutable, and do not refetch", async () => {
  let calls = 0;
  const snapshot = await fetchAssetMarketEvidence({
    now: NOW,
    fetchImpl: async () => {
      calls += 1;
      return response(ASSET_MARKET_PEER_ASSET_IDS.map((id) => marketRow(id)));
    },
  });
  const summary = summarizeAssetMarketEvidence(snapshot);
  assert.equal(summary.recordCount, ASSET_MARKET_PEER_ASSET_IDS.length);
  assert.equal(summary.completeRecordCount, ASSET_MARKET_PEER_ASSET_IDS.length);
  assert.equal(summary.missingAssetIds.length, 0);
  const replay = replayAssetMarketEvidence(summary, snapshot.records[1].id, "test");
  assert.equal(calls, 1);
  assert.equal(replay.recordId, snapshot.records[1].id);
  assert.equal(replay.liveFetch, false);
  assert.equal(replay.externalNetwork, false);
  assert.equal(replay.record.currentPrice, snapshot.records[1].currentPrice);
  assert.equal(Object.isFrozen(replay), true);
});

test("endpoint and source stay HTTPS-only, bounded, and credential-free", async () => {
  assert.equal(ASSET_MARKET_ENDPOINTS.length, 1);
  assert.match(ASSET_MARKET_ENDPOINTS[0].endpoint, /^https:\/\/api\.coingecko\.com\/api\/v3\/coins\/markets/);
  assert.match(ASSET_MARKET_ENDPOINTS[0].documentation, /^https:\/\/docs\.coingecko\.com\//);
  const source = await readFile(new URL("../src/domains/asset-market.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /x-cg-(?:demo|pro)-api-key|authorization|client[_-]?secret/i);
  assert.match(source, /ASSET_MARKET_MAX_RECORDS/);
  assert.match(source, /ASSET_MARKET_FETCH_TIMEOUT_MS/);
  assert.match(source, /unlisted|not-a-market-instrument/i);
  assert.match(source, /no-trading|no-custody|No wallet/i);
});
