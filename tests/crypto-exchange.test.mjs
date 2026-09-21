import assert from "node:assert/strict";
import { test } from "node:test";
import { TOP_20_CRYPTO_ASSETS, TOP_20_CRYPTO_IDS, createCryptoExchangeCatalogContribution } from "../src/domains/crypto-exchange.js";

test("crypto exchange exposes exactly the requested top 20 catalog", () => {
  assert.equal(TOP_20_CRYPTO_ASSETS.length, 20);
  assert.deepEqual(TOP_20_CRYPTO_ASSETS.map((x) => x.symbol), [
    "BTC","ETH","USDT","BNB","XRP","USDC","SOL","TRX","ZEC","FIGR_HELOC",
    "HYPE","DOGE","XMR","RAIN","WBT","USDS","LINK","ADA","LEO","XLM",
  ]);
  assert.equal(new Set(TOP_20_CRYPTO_IDS).size, 20);
  const catalog = createCryptoExchangeCatalogContribution({ updatedAt: "2026-09-21T00:00:00.000Z" });
  assert.equal(catalog.assetCount, 20);
  assert.equal(catalog.capabilities.browse, true);
  assert.equal(catalog.capabilities.marketEvidenceRefresh, true);
  assert.equal(catalog.capabilities.realOrderExecution, false);
  assert.equal(catalog.capabilities.custody, false);
  assert.equal(catalog.executable, false);
  assert.equal(catalog.simulation, true);
});
