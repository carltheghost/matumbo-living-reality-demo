import test from "node:test";
import assert from "node:assert/strict";

import {
  createTokenEngine,
  CONFIG,
} from "../src/domains/token.js";
import { LedgerStore } from "../src/domains/token-store.js";
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

function withLocalStorage(storage, callback) {
  const hadStorage = Object.prototype.hasOwnProperty.call(globalThis, "localStorage");
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: storage });
  try {
    return callback();
  } finally {
    if (hadStorage) Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: previous });
    else delete globalThis.localStorage;
  }
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

test("reload keeps a newer canonical token owner instead of rolling back to an older economy snapshot", () => {
  const economyStorage = new MemoryStorage();
  const canonicalStorage = new MemoryStorage();
  withLocalStorage(canonicalStorage, () => {
    const first = fixture({ storage: economyStorage });
    first.economy.createContract({ title: "Canonical ownership", idempotencyKey: "test:canonical:contract" });
    const olderJournalCount = first.engine.ledger.journalCount();
    const olderBalance = first.engine.balance("u:you", "TUMBO");

    first.engine.faucet("u:you", "TUMBO", 321, { idempotencyKey: "test:canonical:advance" });
    LedgerStore.save(first.engine);
    assert.equal(first.engine.ledger.journalCount(), olderJournalCount + 1);
    assert.equal(economyStorage.getItem("matumbo.simulated-economy.v1").includes("test:canonical:advance"), false);

    const reloadedEngine = createTokenEngine();
    const reloaded = createSimulatedEconomy({ engine: reloadedEngine, storage: economyStorage });
    assert.equal(reloaded.storageStatus, "restored-canonical-snapshot");
    assert.equal(reloadedEngine.ledger.journalCount(), olderJournalCount + 1);
    assert.equal(reloadedEngine.balance("u:you", "TUMBO"), olderBalance + 321);
    assert.equal(reloadedEngine.ledger._journals.at(-1).idempotencyKey, "test:canonical:advance");
    assert.equal(reloaded.verify().ok, true);
  });
});

test("demo liquidity seeding is idempotent across wrappers and canonical re-entry", () => {
  const canonicalStorage = new MemoryStorage();
  withLocalStorage(canonicalStorage, () => {
    const first = fixture({ seedLiquidity: true });
    const firstJournalCount = first.engine.ledger.journalCount();
    const firstBalances = {
      TUMBO: first.engine.balance("sys:escrow", "TUMBO"),
      sMIMAS: first.engine.balance("sys:escrow", "sMIMAS"),
    };
    const firstOrders = first.economy.exchangeOrders({ owner: DEMO_LIQUIDITY_ACCOUNT });

    const sameEngine = createSimulatedEconomy({ engine: first.engine, seedLiquidity: true });
    assert.equal(sameEngine.verify().ok, true);
    assert.equal(first.engine.ledger.journalCount(), firstJournalCount);
    assert.deepEqual(sameEngine.exchangeOrders({ owner: DEMO_LIQUIDITY_ACCOUNT }), firstOrders);
    assert.deepEqual({
      TUMBO: first.engine.balance("sys:escrow", "TUMBO"),
      sMIMAS: first.engine.balance("sys:escrow", "sMIMAS"),
    }, firstBalances);

    const freshEngine = createTokenEngine();
    const durableReentry = createSimulatedEconomy({ engine: freshEngine, seedLiquidity: true });
    assert.equal(durableReentry.verify().ok, true);
    assert.equal(freshEngine.ledger.journalCount(), firstJournalCount);
    assert.deepEqual(durableReentry.exchangeOrders({ owner: DEMO_LIQUIDITY_ACCOUNT }), firstOrders);
    assert.deepEqual({
      TUMBO: freshEngine.balance("sys:escrow", "TUMBO"),
      sMIMAS: freshEngine.balance("sys:escrow", "sMIMAS"),
    }, firstBalances);
  });
});

test("stale wrappers reject before rewinding canonical receipts or economic obligations", () => {
  const canonicalStorage = new MemoryStorage();
  withLocalStorage(canonicalStorage, () => {
    const storageA = new MemoryStorage();
    const first = fixture({ storage: storageA, seedLiquidity: true });
    const storageB = new MemoryStorage();
    storageB.setItem("matumbo.simulated-economy.v1", storageA.getItem("matumbo.simulated-economy.v1"));
    const second = createSimulatedEconomy({
      engine: createTokenEngine(),
      storage: storageB,
      now: () => "2026-10-12T00:00:00.000Z",
    });
    const created = second.createContract({ title: "Wrapper B obligation", amountFluff: 1_000, idempotencyKey: "test:wrappers:b:create" });
    const accepted = second.acceptContract({ contractId: created.contract.id, idempotencyKey: "test:wrappers:b:accept" });
    second.fundContract({ contractId: created.contract.id, expectedRevision: accepted.contract.revision, idempotencyKey: "test:wrappers:b:fund" });
    const committed = LedgerStore.load();
    const committedJournalCount = committed.ledger.journalCount();
    assert.equal(committed.balance("sys:escrow", "TUMBO"), 21_000);

    assert.throws(() => first.economy.createContract({ title: "Stale wrapper write", idempotencyKey: "test:wrappers:a:create" }), (error) => {
      assert.equal(error.code, "STALE_STATE");
      return error instanceof EconomyStaleStateError;
    });
    const afterRejectedWrite = LedgerStore.load();
    assert.equal(afterRejectedWrite.ledger.journalCount(), committedJournalCount);
    assert.equal(afterRejectedWrite.balance("sys:escrow", "TUMBO"), 21_000);
    assert.equal(storageA.getItem("matumbo.simulated-economy.v1").includes("test:wrappers:b:fund"), false);

    assert.throws(() => createSimulatedEconomy({ engine: createTokenEngine(), storage: storageA }), (error) => {
      assert.equal(error.code, "STALE_STATE");
      return error instanceof EconomyStaleStateError;
    });
    const afterRejectedReload = LedgerStore.load();
    assert.equal(afterRejectedReload.ledger.journalCount(), committedJournalCount);
    assert.equal(afterRejectedReload.balance("sys:escrow", "TUMBO"), 21_000);
  });
});

test("partial demo seed recovery restores the remaining order and residual escrow", () => {
  const canonicalStorage = new MemoryStorage();
  withLocalStorage(canonicalStorage, () => {
    const economyStorage = new MemoryStorage();
    const first = fixture({ storage: economyStorage, seedLiquidity: true });
    first.economy.placeExchangeOrder({
      owner: "you", side: "buy", amountBase: 10_000, priceNum: 1, priceDen: 1,
      idempotencyKey: "test:partial-recovery:buy",
    });
    const beforeReload = LedgerStore.load();
    const journalCount = beforeReload.ledger.journalCount();
    economyStorage.removeItem("matumbo.simulated-economy.v1");

    const recovered = createSimulatedEconomy({
      engine: createTokenEngine(),
      storage: economyStorage,
      seedLiquidity: false,
      now: () => "2026-10-12T00:00:00.000Z",
    });
    const sell = recovered.exchangeOrders({ owner: DEMO_LIQUIDITY_ACCOUNT }).find((order) => order.id === "order:demo-sell");
    assert.equal(sell.status, "partial");
    assert.equal(sell.amountBase, 20_000);
    assert.equal(sell.remainingBase, 10_000);
    assert.equal(recovered.exchangeTrades()[0].baseAmount, 10_000);
    assert.equal(recovered.engine.balance("sys:escrow", "TUMBO"), 10_000);
    assert.equal(recovered.verify().ok, true);
    assert.equal(LedgerStore.load().ledger.journalCount(), journalCount);

    const seededAgain = recovered.seedDemoLiquidity();
    assert.equal(seededAgain.rehydrated, undefined);
    assert.equal(LedgerStore.load().ledger.journalCount(), journalCount);
    assert.equal(recovered.exchangeOrders({ owner: DEMO_LIQUIDITY_ACCOUNT }).find((order) => order.id === "order:demo-sell").remainingBase, 10_000);
  });
});

test("missing economy snapshot recovers completed and cancelled user order history with dedupe", () => {
  const canonicalStorage = new MemoryStorage();
  withLocalStorage(canonicalStorage, () => {
    const economyStorage = new MemoryStorage();
    const first = fixture({ storage: economyStorage, seedLiquidity: true });
    const placed = first.economy.placeExchangeOrder({
      owner: "you", side: "sell", amountBase: 1_000, priceNum: 2, priceDen: 1,
      idempotencyKey: "test:history:place",
    });
    const cancelled = first.economy.cancelExchangeOrder({
      orderId: placed.order.id, owner: "you", expectedRevision: placed.order.revision,
      idempotencyKey: "test:history:cancel",
    });
    const journalCount = LedgerStore.load().ledger.journalCount();
    economyStorage.removeItem("matumbo.simulated-economy.v1");

    const recovered = createSimulatedEconomy({ engine: createTokenEngine(), storage: economyStorage });
    const order = recovered.exchangeOrders({ owner: "you" }).find((entry) => entry.id === placed.order.id);
    assert.equal(order.status, "cancelled");
    assert.equal(recovered.snapshot().operations.some((entry) => entry.key === "test:history:place"), true);
    assert.equal(recovered.snapshot().operations.some((entry) => entry.key === "test:history:cancel"), true);
    assert.equal(recovered.verify().ok, true);

    const replay = recovered.placeExchangeOrder({
      owner: "you", side: "sell", amountBase: 1_000, priceNum: 2, priceDen: 1,
      idempotencyKey: "test:history:place",
    });
    assert.equal(replay.order.id, placed.order.id);
    assert.equal(recovered.engine.ledger.journalCount(), journalCount);
    assert.equal(recovered.exchangeOrders({ owner: "you" }).length, 1);
    const cancelReplay = recovered.cancelExchangeOrder({
      orderId: placed.order.id, owner: "you", expectedRevision: placed.order.revision,
      idempotencyKey: "test:history:cancel",
    });
    assert.equal(cancelReplay.order.id, cancelled.order.id);
    assert.equal(cancelReplay.order.status, "cancelled");
    assert.equal(recovered.engine.ledger.journalCount(), journalCount);
  });
});

test("rational-price exchange fills retain exact recorded price through recovery", () => {
  const canonicalStorage = new MemoryStorage();
  withLocalStorage(canonicalStorage, () => {
    const economyStorage = new MemoryStorage();
    const first = fixture({ storage: economyStorage, seedLiquidity: true });
    const placed = first.economy.placeExchangeOrder({
      owner: "you", side: "sell", amountBase: 10_000, priceNum: 1, priceDen: 2,
      idempotencyKey: "test:rational:recovery",
    });
    assert.equal(placed.fills[0].quoteAmount, 5_000);
    economyStorage.removeItem("matumbo.simulated-economy.v1");

    const recovered = createSimulatedEconomy({ engine: createTokenEngine(), storage: economyStorage });
    const trade = recovered.exchangeTrades().find((entry) => entry.id === placed.fills[0].id);
    assert.deepEqual({ priceNum: trade.priceNum, priceDen: trade.priceDen }, { priceNum: 1, priceDen: 2 });
    assert.equal(trade.buyOrderId, "order:demo-buy");
    assert.equal(trade.sellOrderId, placed.order.id);
    assert.equal(recovered.verify().ok, true);
    const journalCount = recovered.engine.ledger.journalCount();
    const replay = recovered.placeExchangeOrder({
      owner: "you", side: "sell", amountBase: 10_000, priceNum: 1, priceDen: 2,
      idempotencyKey: "test:rational:recovery",
    });
    assert.equal(replay.order.id, placed.order.id);
    assert.equal(recovered.engine.ledger.journalCount(), journalCount);
  });
});

test("zero-value funded contracts cancel with a refunded funding lifecycle", () => {
  const { engine, economy } = fixture();
  const created = economy.createContract({ title: "Zero-value cancel", amountFluff: 0, idempotencyKey: "test:zero:contract" });
  const accepted = economy.acceptContract({ contractId: created.contract.id, actor: "b:guide", idempotencyKey: "test:zero:accept" });
  const funded = economy.fundContract({ contractId: created.contract.id, actor: "you", expectedRevision: accepted.contract.revision, idempotencyKey: "test:zero:fund" });
  assert.equal(funded.contract.funding.status, "funded");
  const cancelled = economy.cancelContract({ contractId: created.contract.id, actor: "you", expectedRevision: funded.contract.revision, idempotencyKey: "test:zero:cancel" });
  assert.equal(cancelled.contract.status, "cancelled");
  assert.equal(cancelled.contract.funding.status, "refunded");
  assert.equal(engine.balance("sys:escrow", "TUMBO"), 0);
  assert.equal(economy.verify().ok, true);
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
