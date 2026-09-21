import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLiveMarket } from "../server/market-normalize.mjs";

test("live market normalizers keep provider, probability and source fields", () => {
  const kalshi = normalizeLiveMarket("kalshi", { ticker:"KXTEST", title:"Test", yes_price:62 });
  assert.equal(kalshi.provider, "kalshi");
  assert.equal(kalshi.probability, 0.62);
  const poly = normalizeLiveMarket("polymarket", { id:"1", question:"Test", outcomePrices:"[\"0.73\",\"0.27\"]" });
  assert.equal(poly.probability, 0.73);
});
