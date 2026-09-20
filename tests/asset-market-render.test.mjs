import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createUnavailableAssetMarketEvidence } from "../src/domains/asset-market.js";
import { createAssetMarketConsole } from "../src/render/asset-market.js";

function makeElement(documentRoot, tag = "div", id = "") {
  return {
    ownerDocument: documentRoot,
    tagName: tag.toUpperCase(),
    id,
    className: "",
    dataset: {},
    hidden: false,
    disabled: false,
    textContent: "",
    title: "",
    type: "",
    href: "",
    target: "",
    rel: "",
    children: [],
    listeners: new Map(),
    attributes: new Map(),
    classList: { toggle() {} },
    append(...children) { children.forEach((child) => this.appendChild(child)); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
  };
}

function makeDocument() {
  const elements = new Map();
  const documentRoot = {
    createElement(tag) { return makeElement(documentRoot, tag); },
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener() {},
  };
  for (const [id, hidden] of [
    ["asset-market-console", true],
    ["asset-market-close"],
    ["asset-market-refresh"],
    ["asset-market-reset"],
    ["asset-market-status"],
    ["asset-market-summary"],
    ["asset-market-query"],
    ["asset-market-current"],
    ["asset-market-sources"],
    ["asset-market-records"],
    ["asset-market-trace"],
    ["asset-market-boundary"],
  ]) {
    const element = makeElement(documentRoot, "div", id);
    element.hidden = hidden === true;
    elements.set(id, element);
  }
  return documentRoot;
}

function collectText(node) {
  return [node.textContent ?? "", ...(node.children ?? []).map(collectText)].join(" ");
}

function readyData() {
  return {
    schemaVersion: 1,
    source: "public-asset-market-evidence",
    status: "ready",
    currency: "usd",
    retrievedAt: "2026-08-28T05:00:00.000Z",
    nativeAsset: {
      id: "tumbo-sim",
      symbol: "TUMBO-SIM",
      listingStatus: "unlisted",
      listed: false,
      marketDataAvailable: false,
      priceStatus: "not-provided",
      marketStatus: "not-a-market-instrument",
      note: "TUMBO-SIM is a fictional local display unit; no listing or price.",
    },
    requestedAssetIds: ["bitcoin", "ethereum", "official-trump", "melania-meme"],
    returnedAssetIds: ["bitcoin"],
    missingAssetIds: ["ethereum", "official-trump", "melania-meme"],
    records: [{
      id: "coingecko:bitcoin",
      assetId: "bitcoin",
      symbol: "BTC",
      name: "Bitcoin",
      currentPrice: 70000,
      marketCap: 1000000,
      marketCapRank: 1,
      totalVolume24h: 50000,
      priceChangePercentage24h: 1.25,
      sourceUrl: "https://api.coingecko.com/api/v3/coins/markets?ids=bitcoin",
      assetPageUrl: "https://www.coingecko.com/en/coins/bitcoin",
      // Historical fixture field retained to prove compatibility fallback.
      coinPageUrl: "https://www.coingecko.com/en/coins/bitcoin",
      sourceObservedAt: "2026-08-28T04:59:00.000Z",
      retrievedAt: "2026-08-28T05:00:00.000Z",
      dataCompletenessGrade: "A",
      dataCompletenessPercent: 100,
      dataCompletenessBasis: "Field presence only; not a trading grade.",
    }],
    sources: [{ id: "coingecko-coins-markets", provider: "CoinGecko", available: true, recordCount: 1, endpoint: "https://api.coingecko.com/api/v3/coins/markets" }],
    providerAvailable: true,
    providerUnavailable: false,
    liveFetch: true,
    externalNetwork: true,
    externalSource: true,
    localOnly: true,
    simulation: true,
    complete: false,
    truthClaim: false,
    executable: false,
    boundary: "Market observations are unverified research data; TUMBO-SIM is unlisted and has no price.",
  };
}

test("Asset Market console starts unavailable and never invents a TUMBO price or peer row", () => {
  const documentRoot = makeDocument();
  const consoleView = createAssetMarketConsole({ documentRoot });
  const snapshot = consoleView.getSnapshot();
  assert.equal(snapshot.summary.status, "unavailable");
  assert.equal(snapshot.summary.recordCount, 0);
  assert.equal(snapshot.nativeAsset.listed, false);
  assert.equal(snapshot.nativeAsset.marketDataAvailable, false);
  assert.equal(documentRoot.getElementById("asset-market-records").children.length, 1);
  assert.match(collectText(documentRoot.getElementById("asset-market-current")), /TUMBO-SIM.*UNLISTED|NO PRICE/i);
  assert.match(collectText(documentRoot.getElementById("asset-market-records")), /NO DATA FABRICATED/i);
  assert.equal(snapshot.externalNetwork, false);
  assert.equal(snapshot.executable, false);
});

test("Asset Market console supports explicit refresh, selection, replay, and reset", async () => {
  const documentRoot = makeDocument();
  const selected = [];
  const replayed = [];
  const reset = [];
  let refreshCount = 0;
  let refreshArgs;
  const consoleView = createAssetMarketConsole({
    documentRoot,
    onRefresh: async (args) => {
      refreshCount += 1;
      refreshArgs = args;
      return readyData();
    },
    onSelect: (snapshot) => selected.push(snapshot),
    onReplay: (snapshot) => replayed.push(snapshot),
    onReset: (snapshot) => reset.push(snapshot),
  });
  const refreshed = await consoleView.refresh("button");
  assert.equal(refreshCount, 1);
  assert.deepEqual(refreshArgs.assetIds, ["bitcoin", "ethereum", "official-trump", "melania-meme"]);
  assert.equal(refreshed.summary.recordCount, 1);
  assert.equal(refreshed.summary.status, "ready");
  assert.match(documentRoot.getElementById("asset-market-status").textContent, /READY/);
  assert.match(collectText(documentRoot.getElementById("asset-market-current")), /Bitcoin|USD 70,000|TUMBO-SIM.*UNLISTED/i);
  assert.match(collectText(documentRoot.getElementById("asset-market-current")), /OPEN ASSET PAGE/);
  assert.doesNotMatch(collectText(documentRoot.getElementById("asset-market-current")), /OPEN COIN PAGE/);

  documentRoot.getElementById("asset-market-records").children[0].listeners.get("click")();
  assert.equal(selected.length, 1);
  assert.equal(selected[0].recordId, "coingecko:bitcoin");

  const replay = consoleView.replay("test-button");
  assert.equal(replay.externalNetwork, false);
  assert.equal(replayed.length, 1);
  assert.match(collectText(documentRoot.getElementById("asset-market-trace")), /REPLAY/);

  const resetSnapshot = consoleView.reset("test-reset");
  assert.equal(reset.length, 1);
  assert.equal(resetSnapshot.action, "reset");
  assert.equal(consoleView.getSnapshot().trace.length, 0);
  assert.match(collectText(documentRoot.getElementById("asset-market-trace")), /No local inspection/);
});

test("renderer is presentation-only and retains the unlisted/no-trading boundary", async () => {
  const source = await readFile(new URL("../src/render/asset-market.js", import.meta.url), "utf8");
  assert.match(source, /createAssetMarketConsole/);
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
  assert.doesNotMatch(source, /new\s+WebSocket/i);
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i);
  assert.match(source, /TUMBO-SIM.*NO PRICE|UNLISTED/);
  assert.match(source, /RESEARCH ONLY/);
  assert.deepEqual(createUnavailableAssetMarketEvidence({ retrievedAt: "2026-08-28T05:00:00.000Z" }).records, []);
});

test("renderer keeps the legacy coin-page field as a non-visible compatibility fallback", async () => {
  const documentRoot = makeDocument();
  const data = readyData();
  delete data.records[0].assetPageUrl;
  createAssetMarketConsole({ documentRoot, data });
  const current = collectText(documentRoot.getElementById("asset-market-current"));
  assert.match(current, /OPEN ASSET PAGE/);
  assert.doesNotMatch(current, /OPEN COIN PAGE/);
});
