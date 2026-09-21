import test from "node:test";
import assert from "node:assert/strict";
import { EXCHANGE_PRICING_ASSETS, createUnavailableExchangeBoard, fetchExchangeBoard } from "../src/domains/exchange-pricing.js";

test("the live pricing universe contains exactly 44 canonical assets", () => {
  assert.equal(EXCHANGE_PRICING_ASSETS.length, 44);
  assert.equal(new Set(EXCHANGE_PRICING_ASSETS.map(x => x.symbol)).size, 44);
  assert.equal(createUnavailableExchangeBoard().assets.length, 44);
});

test("four venue observations are retained, outliers are filtered, and reference/bid/ask are produced", async () => {
  const priceFor = (symbol) => symbol === "BTC" ? 100 : 10;
  const fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes("api.exchange.coinbase.com/products/")) {
      const symbol = value.split("/products/")[1].split("-USD")[0];
      return { ok: true, json: async () => ({ price: String(symbol === "BTC" ? 100 : priceFor(symbol)), time: new Date().toISOString() }) };
    }
    if (value.includes("api.bitstamp.net/api/v2/ticker/")) {
      const symbol = value.split("/ticker/")[1].split("usd")[0].toUpperCase();
      return { ok: true, json: async () => ({ last: String(priceFor(symbol)), timestamp: String(Date.now()/1000) }) };
    }
    if (value.includes("api.kraken.com/0/public/Ticker")) {
      const result = {};
      for (const asset of EXCHANGE_PRICING_ASSETS) {
        const pair = asset.symbol === "BTC" ? "XBTUSD" : asset.symbol + "USD";
        result[pair] = { c: [String(priceFor(asset.symbol))] };
      }
      result.XBTUSD = { c: ["100"] };
      return { ok: true, json: async () => ({ result }) };
    }
    if (value.includes("api.binance.com/api/v3/ticker/price")) {
      return { ok: true, json: async () => EXCHANGE_PRICING_ASSETS.map(asset => ({ symbol: asset.symbol + "USDT", price: String(asset.symbol === "BTC" ? 1000 : priceFor(asset.symbol)) })) };
    }
    throw new Error("unexpected endpoint");
  };
  const board = await fetchExchangeBoard({ fetchImpl });
  assert.equal(board.assetCount, 44);
  const btc = board.assets.find(x => x.symbol === "BTC");
  assert.equal(btc.sourceCount, 3);
  assert.equal(btc.rejectedObservations.length, 1);
  assert.equal(btc.referencePriceUsd, 100);
  assert.ok(btc.bidUsd < 100 && btc.askUsd > 100);
  assert.equal(btc.priceMethod, "median-after-outlier-filter");
  assert.ok(btc.observations.length >= 4);
  assert.equal(board.boundary.includes("Prediction contracts"), true);
});
