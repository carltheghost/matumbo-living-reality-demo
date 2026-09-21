import test from "node:test";
import assert from "node:assert/strict";
import { calculateExchangePrice, collectCryptoPrices } from "../src/domains/crypto-price-aggregator.js";

test("calculates a local exchange price from multiple providers", () => {
  const quote = calculateExchangePrice([
    { id: "coinbase", provider: "Coinbase", price: 100 },
    { id: "kraken", provider: "Kraken", price: 101 },
    { id: "bitstamp", provider: "Bitstamp", price: 99 },
    { id: "binance", provider: "Binance", price: 1000 },
  ]);
  assert.equal(quote.status, "ready");
  assert.equal(quote.exchangePrice, 100);
  assert.ok(quote.bid < quote.exchangePrice);
  assert.ok(quote.ask > quote.exchangePrice);
});

test("collects exchange prices without requiring provider credentials", async () => {
  const requested = [];
  const payloads = {
    "coinbase": { data: { amount: "100" } },
    "kraken": { result: { XBTUSD: { c: ["101"] } } },
    "bitstamp": { last: "99" },
    "binance": { price: "100" },
  };
  const result = await collectCryptoPrices({
    symbol: "BTC",
    fetchImpl: async (url) => {
      requested.push(url);
      const key = url.includes("coinbase") ? "coinbase"
        : url.includes("kraken") ? "kraken"
        : url.includes("bitstamp") ? "bitstamp"
        : "binance";
      return { ok: true, json: async () => payloads[key] };
    },
  });
  assert.equal(result.status, "ready");
  assert.equal(result.quote.exchangePrice, 100);
  assert.equal(result.sourceCount, 4);
  assert.equal(requested.length, 4);
});

test("does not invent a quote when too few providers respond", () => {
  const quote = calculateExchangePrice([
    { id: "coinbase", price: 100 },
    { id: "kraken", price: null },
  ]);
  assert.equal(quote.status, "insufficient-sources");
  assert.equal(quote.exchangePrice, null);
});
