import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CONTRACT_ATELIER_DEFAULT_FEE_BPS,
  CONTRACT_ATELIER_HOUSE_MODES,
  CONTRACT_ATELIER_MARKET_TYPES,
  createContractAtelier,
  quoteBinaryTrade,
} from "../src/domains/contract-atelier.js";

const NOW = "2026-09-21T12:00:00.000Z";
const atelier = (seed = "house-algorithms") => createContractAtelier({ seed, now: () => NOW });

test("the canonical market primitive is always YES/NO", () => {
  assert.deepEqual([...CONTRACT_ATELIER_MARKET_TYPES], ["yes_no"]);
  assert.deepEqual([...CONTRACT_ATELIER_HOUSE_MODES], ["single", "pool"]);
  const market = atelier().createContract({ type: "yes_no", role: "house", topic: "custom", title: "Will the project finish?", logic: "project finishes" });
  assert.deepEqual([...market.outcomes], ["YES", "NO"]);
  assert.equal(market.houseMode, "single");
});

test("LMSR quotes move price and charge the configured house fee", () => {
  const quote = quoteBinaryTrade({ qYes: 0, qNo: 0, side: "YES", shares: 10, b: 100, feeBps: 100 });
  assert.equal(quote.priceBefore, 0.5);
  assert.ok(quote.priceAfter > quote.priceBefore);
  assert.ok(quote.totalCost > quote.grossCost);
  assert.equal(quote.fee, Math.round(quote.grossCost * 0.01 * 100) / 100);
  assert.ok(quote.maxLoss > 0);
});

test("a person can register as the House and earn fees through the market algorithm", () => {
  const desk = atelier();
  const market = desk.createContract({ type: "yes_no", role: "house", houseMode: "single", title: "House market", logic: "event happens", feeBps: 200, liquidityB: 100, houseCapital: 100 });
  const registered = desk.registerHouse({ contractId: market.id, house: "alice", capital: 100 });
  assert.equal(registered.houseContributors[0].provider, "alice");
  const position = desk.placeStake({ contractId: market.id, participant: "bob", side: "YES", amount: 10 });
  assert.equal(position.side, "YES");
  assert.ok(position.cost > 0);
  const resolved = desk.resolveContract({ contractId: market.id, facts: { "event happens": true } });
  assert.equal(resolved.resolution.winningSide, "YES");
  assert.equal(resolved.resolution.payouts[0].participant, "bob");
  assert.ok(Number.isFinite(resolved.resolution.grossHousePnl));
});

test("multiple people can form a House Pool and share the terminal P&L", () => {
  const desk = atelier("pool-algorithm");
  const market = desk.createContract({ type: "yes_no", role: "house", houseMode: "pool", title: "Pool-backed market", logic: "pool event happens", feeBps: CONTRACT_ATELIER_DEFAULT_FEE_BPS, liquidityB: 100, houseCapital: 100 });
  desk.joinHousePool({ contractId: market.id, participant: "alice", amount: 60 });
  const joined = desk.joinHousePool({ contractId: market.id, participant: "bob", amount: 40 });
  assert.equal(joined.houseContributors.length, 2);
  assert.equal(joined.houseContributors[0].shares, 0.6);
  assert.equal(joined.houseContributors[1].shares, 0.4);
  desk.placeStake({ contractId: market.id, participant: "trader-yes", side: "YES", amount: 20 });
  desk.placeStake({ contractId: market.id, participant: "trader-no", side: "NO", amount: 5 });
  const resolved = desk.resolveContract({ contractId: market.id, facts: { "pool event happens": true } });
  assert.equal(resolved.resolution.winningSide, "YES");
  assert.equal(resolved.resolution.houseContributors.length, 2);
  assert.equal(resolved.resolution.houseContributors[0].share, 0.6);
  assert.equal(resolved.resolution.houseContributors[1].share, 0.4);
  assert.equal(Math.round(resolved.resolution.houseContributors[0].pnl + resolved.resolution.houseContributors[1].pnl), Math.round(resolved.resolution.grossHousePnl));
});

test("positions can be sold before resolution and fees remain accounted", () => {
  const desk = atelier("sell-algorithm");
  const market = desk.createContract({ type: "yes_no", role: "house", title: "Tradeable market", logic: "x", houseCapital: 100 });
  const position = desk.placeStake({ contractId: market.id, participant: "trader", side: "NO", amount: 8 });
  const sale = desk.sellPosition({ contractId: market.id, positionId: position.id, shares: 3 });
  assert.equal(sale.side, "NO");
  assert.equal(sale.shares, 3);
  assert.ok(sale.proceeds >= 0);
  assert.equal(desk.get(market.id).positions[0].shares, 5);
});

test("resolution is deterministic: logic true is YES, logic false is NO", () => {
  const desk = atelier("resolution");
  const yes = desk.createContract({ type: "yes_no", role: "house", title: "Yes case", logic: "condition" });
  const no = desk.createContract({ type: "yes_no", role: "house", title: "No case", logic: "condition" });
  desk.placeStake({ contractId: yes.id, participant: "a", side: "YES", amount: 1 });
  desk.placeStake({ contractId: no.id, participant: "b", side: "NO", amount: 1 });
  assert.equal(desk.resolveContract({ contractId: yes.id, facts: { condition: true } }).resolution.winningSide, "YES");
  assert.equal(desk.resolveContract({ contractId: no.id, facts: { condition: false } }).resolution.winningSide, "NO");
});
