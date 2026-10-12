import test from "node:test";
import assert from "node:assert/strict";

import {
  createTokenEngine,
  CONFIG,
} from "../src/domains/token.js";
import {
  CONTRACT_EVIDENCE_KIND,
  DEMO_LIQUIDITY_ACCOUNT,
  EconomyStateError,
  EconomyStaleStateError,
  PREDICTION_PROVENANCE_KIND,
  SimulatedEconomyError,
  createSimulatedEconomy,
} from "../src/domains/simulated-economy.js";

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

function fund(engine, account = "u:you", amount = 200_000) {
  engine.faucet(account, "TUMBO", amount, { idempotencyKey: `fixture:tumbo:${account}` });
  engine.ledger.post([
    { account: "sys:market", asset: "sMIMAS", amount: -amount },
    { account, asset: "sMIMAS", amount },
  ], {
    idempotencyKey: `fixture:smimas:${account}`,
    action: "fixture.funding",
    authority: "internal",
    links: { simulation: true, fixture: true },
  });
}

function fixture({ storage = null, seedLiquidity = false } = {}) {
  const engine = createTokenEngine();
  fund(engine);
  fund(engine, "u:alice", 200_000);
  const economy = createSimulatedEconomy({ engine, storage, seedLiquidity, now: () => "2026-10-12T00:00:00.000Z" });
  return { engine, economy };
}

function conservedTotals(engine) {
  return Object.fromEntries(Object.entries(CONFIG.supply).map(([asset, supply]) => {
    const total = engine.ledger.accounts()
      .filter((entry) => entry.asset === asset && entry.account !== "sys:issuance")
      .reduce((sum, entry) => sum + engine.balance(entry.account, asset), 0);
    return [asset, { total, supply }];
  }));
}

test("exchange orders use the canonical ledger, partially fill, cancel, and replay safely", () => {
  const { engine, economy } = fixture({ seedLiquidity: true });
  const before = economy.balances("you").available;
  const placed = economy.placeExchangeOrder({
    owner: "you",
    side: "buy",
    amountBase: 25_000,
    priceNum: 1,
    priceDen: 1,
    idempotencyKey: "test:exchange:buy",
  });
  assert.equal(placed.order.status, "partial");
  assert.equal(placed.order.remainingBase, 5_000);
  assert.equal(placed.fills.length, 1);
  assert.equal(placed.fills[0].baseAmount, 20_000);
  assert.equal(economy.balances("you").available.TUMBO, before.TUMBO + 20_000);
  assert.equal(economy.balances("you").available.sMIMAS, before.sMIMAS - 25_000);
  assert.equal(engine.balance(DEMO_LIQUIDITY_ACCOUNT, "TUMBO"), 30_000);

  const journalsAfterFirstClick = engine.ledger.journalCount();
  const replay = economy.placeExchangeOrder({
    owner: "you", side: "buy", amountBase: 25_000, priceNum: 1, priceDen: 1,
    idempotencyKey: "test:exchange:buy",
  });
  assert.deepEqual(replay, placed);
  assert.equal(engine.ledger.journalCount(), journalsAfterFirstClick);

  const cancelled = economy.cancelExchangeOrder({
    orderId: placed.order.id,
    owner: "you",
    expectedRevision: placed.order.revision,
    idempotencyKey: "test:exchange:cancel",
  });
  assert.equal(cancelled.order.status, "cancelled");
  assert.equal(cancelled.order.remainingBase, 0);
  // The 20,000-fluff maker fill is spent; only the unused 5,000-fluff
  // reserve is returned when the partial order is cancelled.
  assert.equal(economy.balances("you").available.sMIMAS, before.sMIMAS - 20_000);
  assert.deepEqual(economy.cancelExchangeOrder({
    orderId: placed.order.id, owner: "you", expectedRevision: placed.order.revision,
    idempotencyKey: "test:exchange:cancel",
  }), cancelled);
  assert.equal(economy.verify().ok, true);
  assert.equal(engine.ledger.verifyChain().ok, true);
  assert.deepEqual(conservedTotals(engine).TUMBO, { total: CONFIG.supply.TUMBO, supply: CONFIG.supply.TUMBO });
  assert.deepEqual(conservedTotals(engine).sMIMAS, { total: CONFIG.supply.sMIMAS, supply: CONFIG.supply.sMIMAS });
});

test("exchange rejects insufficient funds, stale revisions, and mismatched replays", () => {
  const { engine, economy } = fixture({ seedLiquidity: true });
  const journalCount = engine.ledger.journalCount();
  assert.throws(() => economy.placeExchangeOrder({
    owner: "you", side: "buy", amountBase: 999_999, priceNum: 1, priceDen: 1,
    idempotencyKey: "test:exchange:too-large",
  }), /insufficient funds/);
  assert.equal(engine.ledger.journalCount(), journalCount);

  const placed = economy.placeExchangeOrder({
    owner: "you", side: "sell", amountBase: 10_000, priceNum: 1, priceDen: 1,
    idempotencyKey: "test:exchange:sell",
  });
  assert.equal(placed.order.status, "filled");
  assert.throws(() => economy.cancelExchangeOrder({
    orderId: placed.order.id, owner: "you", expectedRevision: 0, idempotencyKey: "test:exchange:stale",
  }), EconomyStaleStateError);
  assert.throws(() => economy.placeExchangeOrder({
    owner: "you", side: "sell", amountBase: 11_000, priceNum: 1, priceDen: 1,
    idempotencyKey: "test:exchange:sell",
  }), (error) => error.code === "IDEM_MISMATCH");
  assert.throws(() => economy.cancelExchangeOrder({
    orderId: placed.order.id, owner: "you", expectedRevision: placed.order.revision, idempotencyKey: "test:exchange:filled-cancel",
  }), EconomyStateError);
  assert.equal(economy.verify().ok, true);
});

test("exchange keeps sub-fluff rational pairs open without a zero-value fill", () => {
  const { engine, economy } = fixture();
  const seller = economy.placeExchangeOrder({
    owner: "alice", side: "sell", amountBase: 1, priceNum: 1, priceDen: 3,
    idempotencyKey: "test:exchange:fractional:sell",
  });
  const buyer = economy.placeExchangeOrder({
    owner: "you", side: "buy", amountBase: 1, priceNum: 1, priceDen: 3,
    idempotencyKey: "test:exchange:fractional:buy",
  });
  assert.equal(seller.order.status, "open");
  assert.equal(buyer.order.status, "open");
  assert.equal(economy.exchangeTrades().length, 0);
  assert.equal(engine.balance("u:you", "sMIMAS"), 199_999);
  assert.equal(economy.verify().ok, true);
});

test("prediction positions settle only from an explicit demo outcome and conserve the pool", () => {
  const { engine, economy } = fixture();
  const opened = economy.createPredictionMarket({
    title: "Demo rain rehearsal",
    outcomes: ["rain", "dry"],
    priceFluff: 100,
    idempotencyKey: "test:prediction:create",
  });
  const rain = economy.buyPredictionPosition({
    marketId: opened.market.id, outcome: "rain", units: 3,
    idempotencyKey: "test:prediction:rain",
  });
  const dry = economy.buyPredictionPosition({
    marketId: opened.market.id, outcome: "dry", units: 2, owner: "alice",
    expectedRevision: rain.market.revision, idempotencyKey: "test:prediction:dry",
  });
  assert.equal(dry.market.poolFluff, 500);
  assert.throws(() => economy.settlePredictionMarket({
    marketId: opened.market.id, outcome: "rain", provenance: { source: "weather-api", live: true },
    idempotencyKey: "test:prediction:live",
  }), (error) => error.code === "PROVENANCE_REQUIRED");

  const settled = economy.settlePredictionMarket({
    marketId: opened.market.id,
    outcome: "rain",
    provenance: { kind: PREDICTION_PROVENANCE_KIND, source: "user-entered-demo-outcome", note: "local rehearsal" },
    expectedRevision: dry.market.revision,
    idempotencyKey: "test:prediction:settle",
  });
  assert.equal(settled.market.status, "settled");
  assert.equal(settled.market.poolFluff, 0);
  assert.equal(settled.payouts.find((row) => row.positionId === rain.position.id).payoutFluff, 500);
  assert.equal(settled.payouts.find((row) => row.positionId === dry.position.id).payoutFluff, 0);
  assert.equal(engine.balance("u:you", "TUMBO"), 200_000 - 300 + 500);
  assert.deepEqual(economy.settlePredictionMarket({
    marketId: opened.market.id, outcome: "rain",
    provenance: { kind: PREDICTION_PROVENANCE_KIND, source: "user-entered-demo-outcome", note: "local rehearsal" },
    expectedRevision: dry.market.revision, idempotencyKey: "test:prediction:settle",
  }), settled);
  assert.throws(() => economy.settlePredictionMarket({
    marketId: opened.market.id, outcome: "rain",
    provenance: { kind: PREDICTION_PROVENANCE_KIND, source: "user-entered-demo-outcome" },
    idempotencyKey: "test:prediction:settle-again",
  }), EconomyStateError);
  assert.equal(economy.verify().ok, true);
  assert.equal(engine.ledger._journals.at(-1).links.economy, "matumbo-simulated-economy");
});

test("contract lifecycle records auditable receipts, funds escrow, completes, and can refund on cancel", () => {
  const { engine, economy } = fixture();
  const created = economy.createContract({
    title: "Build a local field marker",
    amountFluff: 1_000,
    terms: "Deliver a labelled marker inside the demo field",
    idempotencyKey: "test:contract:create",
  });
  const accepted = economy.acceptContract({
    contractId: created.contract.id,
    actor: "b:guide",
    expectedRevision: created.contract.revision,
    idempotencyKey: "test:contract:accept",
  });
  const funded = economy.fundContract({
    contractId: created.contract.id,
    actor: "you",
    expectedRevision: accepted.contract.revision,
    idempotencyKey: "test:contract:fund",
  });
  const completed = economy.completeContract({
    contractId: created.contract.id,
    actor: "b:guide",
    evidence: "Marker is present in the local field projection",
    provenance: { kind: CONTRACT_EVIDENCE_KIND, source: "user-entered-demo-evidence" },
    expectedRevision: funded.contract.revision,
    idempotencyKey: "test:contract:complete",
  });
  assert.equal(completed.contract.status, "completed");
  assert.deepEqual(completed.contract.history.map((entry) => entry.status), ["draft", "active", "active", "completed"]);
  assert.equal(engine.balance("u:you", "TUMBO"), 200_000 - 1_000);
  assert.equal(engine.balance("b:guide", "TUMBO"), 1_000);
  assert.ok(completed.contract.history.every((entry) => entry.receiptId));
  assert.ok(economy.receipts().some((receipt) => receipt.action === "contract.complete"));

  const toCancel = economy.createContract({
    title: "Cancel rehearsal",
    amountFluff: 500,
    idempotencyKey: "test:contract:cancel:create",
  });
  const acceptedCancel = economy.acceptContract({
    contractId: toCancel.contract.id,
    actor: "b:guide",
    idempotencyKey: "test:contract:cancel:accept",
  });
  const fundedCancel = economy.fundContract({
    contractId: toCancel.contract.id,
    actor: "you",
    expectedRevision: acceptedCancel.contract.revision,
    idempotencyKey: "test:contract:cancel:fund",
  });
  const cancelled = economy.cancelContract({
    contractId: toCancel.contract.id,
    actor: "you",
    expectedRevision: fundedCancel.contract.revision,
    idempotencyKey: "test:contract:cancel",
  });
  assert.equal(cancelled.contract.status, "cancelled");
  assert.equal(cancelled.contract.funding.status, "refunded");
  assert.equal(economy.verify().ok, true);
});

test("combined token and economy snapshots restore across a reload without replaying journals", () => {
  const storage = new MemoryStorage();
  const first = fixture({ storage, seedLiquidity: true });
  const opened = first.economy.createPredictionMarket({
    title: "Reloadable local market", outcomes: ["A", "B"], priceFluff: 75,
    idempotencyKey: "test:reload:market",
  });
  first.economy.buyPredictionPosition({
    marketId: opened.market.id, outcome: "A", units: 4,
    idempotencyKey: "test:reload:position",
  });
  const contract = first.economy.createContract({
    title: "Reloadable contract", amountFluff: 250,
    idempotencyKey: "test:reload:contract",
  });
  const firstJournalCount = first.engine.ledger.journalCount();
  const secondEngine = createTokenEngine();
  const second = createSimulatedEconomy({
    engine: secondEngine,
    storage,
    now: () => "2026-10-12T00:00:00.000Z",
  });
  assert.equal(second.storageStatus, "restored-local-snapshot");
  assert.deepEqual(second.snapshot().exchange, first.economy.snapshot().exchange);
  assert.deepEqual(second.snapshot().predictions, first.economy.snapshot().predictions);
  assert.equal(secondEngine.ledger.journalCount(), firstJournalCount);
  assert.equal(second.verify().ok, true);
  const replayed = second.buyPredictionPosition({
    marketId: opened.market.id, outcome: "A", units: 4,
    idempotencyKey: "test:reload:position",
  });
  assert.equal(replayed.position.id, first.economy.snapshot().predictions.positions[0].id);
  assert.equal(secondEngine.ledger.journalCount(), firstJournalCount);
  assert.ok(contract.contract.id.startsWith("contract:"));
  assert.equal(secondEngine.ledger.verifyChain().ok, true);
});

test("stale prediction and contract writes fail before a new receipt is committed", () => {
  const { engine, economy } = fixture();
  const market = economy.createPredictionMarket({ title: "Stale check", outcomes: ["YES", "NO"], idempotencyKey: "test:stale:market" });
  const position = economy.buyPredictionPosition({ marketId: market.market.id, outcome: "YES", units: 1, idempotencyKey: "test:stale:position" });
  const before = engine.ledger.journalCount();
  assert.throws(() => economy.settlePredictionMarket({
    marketId: market.market.id, outcome: "YES",
    provenance: { kind: PREDICTION_PROVENANCE_KIND, source: "demo" }, expectedRevision: 0,
    idempotencyKey: "test:stale:settle",
  }), EconomyStaleStateError);
  assert.equal(engine.ledger.journalCount(), before);

  const contract = economy.createContract({ title: "Stale contract", idempotencyKey: "test:stale:contract" });
  assert.throws(() => economy.acceptContract({ contractId: contract.contract.id, actor: "b:guide", expectedRevision: 1, idempotencyKey: "test:stale:accept" }), EconomyStaleStateError);
  assert.equal(position.position.status, "open");
  assert.equal(economy.verify().ok, true);
});

test("every domain receipt is visibly simulation-only and tied to the canonical chain", () => {
  const { economy } = fixture();
  economy.createContract({ title: "Receipt labels", idempotencyKey: "test:labels:contract" });
  const receipts = economy.receipts();
  assert.ok(receipts.length > 0);
  assert.ok(receipts.every((receipt) => receipt.links?.economy === "matumbo-simulated-economy"));
  assert.ok(receipts.every((receipt) => economy.engine.ledger.verifyReceipt(receipt.id).ok));
  assert.ok(economy.snapshot().events.every((event) => event.simulation === true));
  assert.throws(() => economy.createPredictionMarket({ title: "bad", outcomes: ["A"], idempotencyKey: "test:bad" }), /2-6/);
  assert.throws(() => economy.settlePredictionMarket({ marketId: "missing", outcome: "A", provenance: { kind: PREDICTION_PROVENANCE_KIND, source: "demo" }, idempotencyKey: "test:missing" }), SimulatedEconomyError);
});
