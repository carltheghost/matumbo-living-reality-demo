import test from "node:test";
import assert from "node:assert/strict";

import {
  CONFIG,
  TumboUserLedger,
  createTokenEngine,
  seedDemoWallet,
} from "../src/domains/token.js";
import { serializeTokenEngine } from "../src/domains/token-store.js";
import { createTokenVaultLedger } from "../src/domains/token-vault.js";
import { createSimulatedEconomy } from "../src/domains/simulated-economy.js";
import {
  createTokenEconomyOverview,
  formatAssetAmount,
  parseTumboSimExact,
} from "../src/domains/token-economy-overview.js";
import { renderTokenEconomyOverview } from "../src/render/token-economy-overview.js";

function fundTumbo(engine, account = "u:alice", amount = 20_000) {
  engine.faucet(account, "TUMBO", amount, { idempotencyKey: `fixture:overview:faucet:${account}` });
}

function marketReceiptFixture() {
  const engine = createTokenEngine();
  fundTumbo(engine, "u:alice", 20_000);
  const quote = engine.quote({
    action: "buy",
    from: "u:alice",
    fromAsset: "TUMBO",
    toAsset: "sMIMAS",
    amountIn: 10_001,
  });
  engine.execute(quote, { idempotencyKey: "overview:semantic:market" });
  return { engine, key: "overview:semantic:market" };
}

test("exact amount boundaries reject binary-float input", () => {
  assert.equal(parseTumboSimExact("1.001"), 1_001);
  assert.equal(parseTumboSimExact(" 7 "), 7_000);
  assert.equal(parseTumboSimExact("0.001"), 1);
  assert.equal(formatAssetAmount("TUMBO", 1_001), "1.001 TUMBO-SIM");
  assert.equal(formatAssetAmount("sMIMAS", 1_001), "1,001 sMIMAS-fluff");
  assert.throws(() => parseTumboSimExact(0.1), /decimal strings/);
  assert.throws(() => parseTumboSimExact("1.2345"), /at most three/);
  assert.throws(() => parseTumboSimExact("1e-3"), /at most three/);
  assert.throws(() => parseTumboSimExact("-1"), /at most three/);
});

test("fresh canonical state reconciles each asset into explicit categories", () => {
  const engine = createTokenEngine();
  const overview = createTokenEconomyOverview({ engine });

  assert.equal(overview.invariants.ok, true);
  assert.equal(overview.source.kind, "live-engine");
  assert.equal(overview.source.hashAlgorithm, "fnv1a64-local-receipt-chain");
  assert.deepEqual(overview.assets.TUMBO.categories, {
    available: 0,
    locked: 0,
    reserved: 0,
    burned: 0,
    treasury: 8_500_000_000,
    faucet: 500_000_000,
    market: 1_000_000_000,
    issuanceMirror: -CONFIG.supply.TUMBO,
    otherSystem: 0,
  });
  assert.equal(overview.assets.TUMBO.recordedSupplyFluff, CONFIG.supply.TUMBO);
  assert.equal(overview.assets.sMIMAS.recordedSupplyFluff, CONFIG.supply.sMIMAS);
  assert.equal(overview.assets.TUMBO.reconciliationDeltaFluff, 0);
  assert.equal(overview.assets.sMIMAS.reconciliationDeltaFluff, 0);
  assert.equal(overview.assets.TUMBO.circulatingFluff, 0);
  assert.equal(overview.definitions.recordedSupply.includes("does not choose"), true);
  assert.equal(Object.isFrozen(overview), true);
});

test("wallet locks and vault positions remain visible without double-counting", () => {
  const engine = createTokenEngine();
  const wallet = new TumboUserLedger(engine);
  seedDemoWallet(wallet);
  const vault = createTokenVaultLedger({ engine });
  const opened = vault.stake({ from: "u:you", asset: "TUMBO", amountFluff: 10_000, idempotencyKey: "overview:stake" });
  vault.advanceTick({ ticks: 10, idempotencyKey: "overview:tick" });

  const overview = createTokenEconomyOverview({ engine, vault });
  const tumbo = overview.assets.TUMBO;
  assert.equal(overview.invariants.ok, true);
  assert.equal(tumbo.categories.available, 85_500);
  assert.equal(tumbo.categories.locked, 35_000); // wallet lock 25,000 + vault stake 10,000
  assert.equal(tumbo.circulatingFluff, 120_500);
  assert.equal(overview.rewards.status, "observed");
  assert.equal(overview.rewards.positionCount, 1);
  assert.equal(overview.rewards.byAsset.TUMBO.openPrincipalFluff, 10_000);
  assert.equal(overview.rewards.byAsset.TUMBO.pendingRewardFluff, 50);
  assert.equal(overview.rewards.byAsset.TUMBO.coverageFluff, 8_499_999_950);
  assert.equal(overview.rewards.byAsset.TUMBO.ok, true);
  assert.equal(opened.position.status, "open");
});

test("market fee checks use exact floor arithmetic and execution replay adds no journal", () => {
  const engine = createTokenEngine();
  fundTumbo(engine, "u:alice", 20_000);
  const quote = engine.quote({
    action: "buy",
    from: "u:alice",
    fromAsset: "TUMBO",
    toAsset: "sMIMAS",
    amountIn: 10_001,
  });
  const settled = engine.execute(quote, { idempotencyKey: "overview:market:settle" });
  const journalCount = engine.ledger.journalCount();
  assert.equal(settled.tithe, 10); // floor(10,001 * 10 / 10,000)
  assert.equal(engine.execute(quote, { idempotencyKey: "overview:market:settle" }).id, settled.id);
  assert.equal(engine.ledger.journalCount(), journalCount);

  const overview = createTokenEconomyOverview({ engine });
  const checks = overview.fees.checks.filter((check) => check.idempotencyKey === "overview:market:settle");
  assert.equal(overview.invariants.ok, true);
  assert.deepEqual(checks, [{
    idempotencyKey: "overview:market:settle",
    action: "buy",
    asset: "TUMBO",
    inputFluff: 10_001,
    expectedTitheFluff: 10,
    actualTitheFluff: 10,
    ok: true,
  }]);
  assert.equal(overview.fees.realizedTitheFluff.TUMBO, 10);
  assert.equal(overview.invariants.idempotency.ok, true);
});

test("authorized simulated burns are explicit and remain in the conservation anchor", () => {
  const engine = createTokenEngine();
  fundTumbo(engine, "u:alice", 1_000);
  engine.ledger.post([
    { account: "u:alice", asset: "TUMBO", amount: -123 },
    { account: "sys:void", asset: "TUMBO", amount: 123 },
  ], {
    idempotencyKey: "overview:burn",
    action: "burn",
    memo: "local simulated burn",
    voidCreditReason: "burn",
    authority: "internal",
  });
  const overview = createTokenEconomyOverview({ engine });
  assert.equal(overview.assets.TUMBO.categories.burned, 123);
  assert.deepEqual(overview.fees.unattributedVoidCredits, [{
    idempotencyKey: "overview:burn",
    action: "burn",
    asset: "TUMBO",
    amountFluff: 123,
    attributedAs: "other-authorized-burn",
  }]);
  assert.equal(overview.assets.TUMBO.reconciliationDeltaFluff, 0);
  assert.equal(overview.invariants.ok, true);
});

test("serialized snapshots are read-only projections and do not roll forward", () => {
  const engine = createTokenEngine();
  fundTumbo(engine);
  const raw = serializeTokenEngine(engine);
  const snapshotOverview = createTokenEconomyOverview({ snapshot: raw });
  const before = snapshotOverview.assets.TUMBO.categories.available;
  engine.faucet("u:alice", "TUMBO", 321, { idempotencyKey: "overview:live:advance" });

  assert.equal(snapshotOverview.source.kind, "serialized-snapshot");
  assert.equal(snapshotOverview.assets.TUMBO.categories.available, before);
  assert.equal(snapshotOverview.source.journalCount, 5);
  assert.equal(createTokenEconomyOverview({ engine }).assets.TUMBO.categories.available, before + 321);
});

test("economy adapter exposes escrow obligations and operation uniqueness", () => {
  const engine = createTokenEngine();
  fundTumbo(engine, "u:you", 2_000);
  const economy = createSimulatedEconomy({ engine, now: () => "2026-10-12T00:00:00.000Z" });
  const draft = economy.createContract({ title: "Overview reserve", amountFluff: 500, idempotencyKey: "overview:contract:create" });
  const accepted = economy.acceptContract({ contractId: draft.contract.id, actor: "b:guide", idempotencyKey: "overview:contract:accept" });
  economy.fundContract({ contractId: draft.contract.id, actor: "you", expectedRevision: accepted.contract.revision, idempotencyKey: "overview:contract:fund" });

  const overview = createTokenEconomyOverview({ engine, economy });
  assert.equal(overview.economy.status, "observed");
  assert.equal(overview.economy.counts.fundedContracts, 1);
  assert.equal(overview.economy.pendingObligationsFluff.TUMBO, 500);
  assert.deepEqual(overview.economy.escrow.TUMBO, { actualFluff: 500, expectedFluff: 500, deltaFluff: 0, ok: true });
  assert.equal(overview.economy.operationRegistry.unique, true);
  assert.equal(overview.economy.ok, true);
  assert.equal(overview.invariants.ok, true);
});

test("the projection surfaces negative-balance corruption instead of hiding it", () => {
  const engine = createTokenEngine();
  engine.ledger._balances.set("u:corrupt|TUMBO", -1);
  const overview = createTokenEconomyOverview({ engine });
  assert.equal(overview.invariants.nonNegativeBalances.ok, false);
  assert.deepEqual(overview.invariants.nonNegativeBalances.violations, [{ account: "u:corrupt", asset: "TUMBO", balanceFluff: -1 }]);
  assert.equal(overview.invariants.ok, false);
});

test("receipt and request registries fail closed on tampered, missing, or extra bindings", () => {
  const engine = createTokenEngine();
  const key = "overview:registry:tamper";
  engine.faucet("u:alice", "TUMBO", 100, { idempotencyKey: key });
  const receipt = engine.ledger._receipts.get(key);
  const request = engine.ledger._requestKeys.get(key);

  engine.ledger._receipts.set(key, { ...receipt, action: "tampered" });
  let overview = createTokenEconomyOverview({ engine });
  assert.equal(overview.invariants.idempotency.ok, false);
  assert.equal(overview.invariants.idempotency.receiptRegistry.ok, false);
  assert.equal(overview.invariants.idempotency.receiptRegistry.receiptMismatches[0].key, key);

  engine.ledger._receipts.set(key, undefined);
  overview = createTokenEconomyOverview({ engine });
  assert.equal(overview.invariants.idempotency.receiptRegistry.ok, false);
  assert.equal(overview.invariants.idempotency.receiptRegistry.receiptMismatches[0].key, key);

  engine.ledger._receipts.set(key, receipt);
  engine.ledger._requestKeys.delete(key);
  overview = createTokenEconomyOverview({ engine });
  assert.equal(overview.invariants.ok, false);
  assert.deepEqual(overview.invariants.idempotency.receiptRegistry.missingRequestKeys, [key]);

  engine.ledger._requestKeys.set(key, request);
  engine.ledger._receipts.set("overview:registry:extra-receipt", receipt);
  overview = createTokenEconomyOverview({ engine });
  assert.deepEqual(overview.invariants.idempotency.receiptRegistry.extraReceiptKeys, ["overview:registry:extra-receipt"]);

  engine.ledger._receipts.delete("overview:registry:extra-receipt");
  engine.ledger._requestKeys.set("overview:registry:extra-request", request);
  overview = createTokenEconomyOverview({ engine });
  assert.deepEqual(overview.invariants.idempotency.receiptRegistry.extraRequestKeys, ["overview:registry:extra-request"]);
});

test("request bindings require the journal-implied Void reason and system authority", () => {
  const reasonFixture = marketReceiptFixture();
  const reasonRequest = JSON.parse(reasonFixture.engine.ledger._requestKeys.get(reasonFixture.key));
  reasonRequest.voidCreditReason = "burn";
  reasonFixture.engine.ledger._requestKeys.set(reasonFixture.key, JSON.stringify(reasonRequest));
  let overview = createTokenEconomyOverview({ engine: reasonFixture.engine });
  assert.equal(overview.invariants.ok, false);
  assert.deepEqual(
    overview.invariants.idempotency.receiptRegistry.requestMismatches.find((row) => row.key === reasonFixture.key).fields,
    ["voidCreditReason"],
  );

  const authorityFixture = marketReceiptFixture();
  const authorityRequest = JSON.parse(authorityFixture.engine.ledger._requestKeys.get(authorityFixture.key));
  authorityRequest.authority = null;
  authorityFixture.engine.ledger._requestKeys.set(authorityFixture.key, JSON.stringify(authorityRequest));
  overview = createTokenEconomyOverview({ engine: authorityFixture.engine });
  assert.equal(overview.invariants.ok, false);
  assert.deepEqual(
    overview.invariants.idempotency.receiptRegistry.requestMismatches.find((row) => row.key === authorityFixture.key).fields,
    ["authority"],
  );
});

test("receipt equality rejects non-finite, cyclic, and hostile values without throwing", () => {
  const mutations = [
    (receipt) => ({ ...receipt, links: Number.NaN }),
    (receipt) => {
      const links = {};
      links.self = links;
      return { ...receipt, links };
    },
    (receipt) => {
      const hostile = { ...receipt };
      Object.defineProperty(hostile, "links", { enumerable: true, get: () => { throw new Error("hostile getter"); } });
      return hostile;
    },
  ];
  for (const mutate of mutations) {
    const engine = createTokenEngine();
    const key = "overview:hostile:receipt";
    engine.faucet("u:alice", "TUMBO", 100, { idempotencyKey: key });
    engine.ledger._receipts.set(key, mutate(engine.ledger._receipts.get(key)));
    let overview;
    assert.doesNotThrow(() => { overview = createTokenEconomyOverview({ engine }); });
    assert.equal(overview.invariants.ok, false);
    assert.equal(overview.invariants.idempotency.receiptRegistry.ok, false);
  }
});

test("the shared snapshot graph validator covers receipt arrays and nested economy branches", () => {
  const receiptEngine = createTokenEngine();
  const receiptKey = "overview:graph:receipt-array-prototype";
  receiptEngine.faucet("u:alice", "TUMBO", 100, { idempotencyKey: receiptKey });
  const receipt = receiptEngine.ledger._receipts.get(receiptKey);
  const customPostings = receipt.postings.slice();
  const customArrayPrototype = Object.create(Array.prototype);
  Object.setPrototypeOf(customPostings, customArrayPrototype);
  receiptEngine.ledger._receipts.set(receiptKey, { ...receipt, postings: customPostings });
  const receiptOverview = createTokenEconomyOverview({ engine: receiptEngine });
  assert.equal(receiptOverview.invariants.idempotency.receiptRegistry.ok, false);
  assert.equal(Object.getPrototypeOf(customPostings), customArrayPrototype, "validation must not normalize the hostile array");

  const receiptCases = [
    ["top-level receipt prototype", (receipt) => {
      const hostile = { ...receipt };
      const prototype = Object.create(Object.prototype);
      Object.setPrototypeOf(hostile, prototype);
      return { value: hostile, after: () => assert.equal(Object.getPrototypeOf(hostile), prototype) };
    }],
    ["nested links prototype", (receipt) => {
      const links = { ...receipt.links };
      const prototype = Object.create(Object.prototype);
      Object.setPrototypeOf(links, prototype);
      const hostile = { ...receipt, links };
      return { value: hostile, after: () => assert.equal(Object.getPrototypeOf(links), prototype) };
    }],
    ["links accessor", (receipt) => {
      let invoked = false;
      const hostile = { ...receipt };
      Object.defineProperty(hostile, "links", {
        enumerable: true,
        get() {
          invoked = true;
          return receipt.links;
        },
      });
      return { value: hostile, after: () => assert.equal(invoked, false, "receipt graph validation must not invoke links getters") };
    }],
    ["null-prototype postings array", (receipt) => {
      const postings = receipt.postings.slice();
      Object.setPrototypeOf(postings, null);
      const hostile = { ...receipt, postings };
      return { value: hostile, after: () => assert.equal(Object.getPrototypeOf(postings), null) };
    }],
  ];
  for (const [label, mutate] of receiptCases) {
    const engine = createTokenEngine();
    const key = `overview:graph:receipt:${label.replaceAll(" ", "-")}`;
    engine.faucet("u:alice", "TUMBO", 100, { idempotencyKey: key });
    const original = engine.ledger._receipts.get(key);
    const { value, after } = mutate(original);
    engine.ledger._receipts.set(key, value);
    const overview = createTokenEconomyOverview({ engine });
    assert.equal(overview.invariants.idempotency.receiptRegistry.ok, false, label);
    after();
  }

  const cases = [
    ["custom event array prototype", (state) => {
      const events = [];
      const prototype = Object.create(Array.prototype);
      Object.setPrototypeOf(events, prototype);
      state.events = events;
      return () => assert.equal(Object.getPrototypeOf(state.events), prototype);
    }],
    ["null-prototype event array", (state) => {
      const events = [];
      Object.setPrototypeOf(events, null);
      state.events = events;
      return () => assert.equal(Object.getPrototypeOf(state.events), null);
    }],
    ["cyclic event entry", (state) => {
      const events = [];
      events.push(events);
      state.events = events;
      return () => assert.equal(state.events[0], state.events);
    }],
    ["cyclic contract history", (state) => {
      const history = [];
      history.push(history);
      state.contracts = [{
        id: "contract:overview:graph",
        status: "draft",
        amountFluff: 1,
        funding: { status: "unfunded" },
        history,
      }];
      return () => assert.equal(state.contracts[0].history[0], state.contracts[0].history);
    }],
    ["non-JSON event value", (state) => {
      state.events = [{ value: 1n }];
      return () => {};
    }],
    ["hostile nested accessor", (state) => {
      let invoked = false;
      const event = {};
      Object.defineProperty(event, "detail", {
        enumerable: true,
        get() {
          invoked = true;
          throw new Error("hostile event getter");
        },
      });
      state.events = [event];
      return () => assert.equal(invoked, false, "descriptor validation must not invoke hostile getters");
    }],
  ];

  for (const [label, mutate] of cases) {
    const engine = createTokenEngine();
    const source = createSimulatedEconomy({ engine });
    const state = JSON.parse(JSON.stringify(source.snapshot()));
    const assertUnchanged = mutate(state);
    const economy = { engine, snapshot: () => state };
    const overview = createTokenEconomyOverview({ engine, economy });
    assert.equal(overview.economy.status, "invalid", label);
    assert.equal(overview.economy.ok, false, label);
    assert.equal(overview.invariants.economy.ok, false, label);
    assertUnchanged();
  }
});

test("issuance mirror is an exact conservation invariant, not an ignored system balance", () => {
  for (const corruptedMirror of [0, 1]) {
    const engine = createTokenEngine();
    engine.ledger._balances.set("sys:issuance|TUMBO", corruptedMirror);
    const overview = createTokenEconomyOverview({ engine });
    const report = overview.assets.TUMBO;
    assert.equal(report.issuanceMirrorDeltaFluff, corruptedMirror + CONFIG.supply.TUMBO);
    assert.equal(report.invariants.issuanceMirror, false);
    assert.equal(report.invariants.nonIssuanceConservation, true);
    assert.equal(report.invariants.conservation, false);
    assert.equal(overview.invariants.ok, false);
  }
});

test("malformed economy snapshots are invalid instead of becoming healthy zero-obligation views", () => {
  const engine = createTokenEngine();
  const source = createSimulatedEconomy({ engine });
  const state = source.snapshot();
  const cases = [
    ["exchange.orders", { exchange: { ...state.exchange, orders: undefined } }],
    ["predictions.markets", { predictions: { ...state.predictions, markets: undefined } }],
    ["contracts", { contracts: undefined }],
  ];
  for (const [path, replacement] of cases) {
    const malformed = { ...state, ...replacement };
    const economy = { engine, snapshot: () => malformed };
    const overview = createTokenEconomyOverview({ engine, economy });
    assert.equal(overview.economy.status, "invalid", path);
    assert.equal(overview.economy.ok, false, path);
    assert.equal(overview.invariants.economy.ok, false, path);
    assert.equal(overview.invariants.ok, false, path);
    assert.match(overview.economy.error, /missing/);
  }
});

test("economy entry schemas fail closed while retaining canonical optional fields", () => {
  const engine = createTokenEngine();
  const source = createSimulatedEconomy({ engine });
  const state = source.snapshot();
  const validOrder = {
    id: "order:overview-schema",
    owner: "u:alice",
    side: "sell",
    amountBase: 1,
    remainingBase: 0,
    priceNum: 1,
    priceDen: 1,
    reservedQuote: 0,
    status: "cancelled",
  };
  const cases = [
    ["unknown order side", { exchange: { ...state.exchange, orders: [{ ...validOrder, side: "hold" }] } }],
    ["missing operation key", { operations: [{ requestHash: "hash-only" }] }],
    ["invalid position object", {
      predictions: {
        ...state.predictions,
        markets: [{ id: "market:overview-schema", status: "open", priceFluff: 1, poolFluff: 0, outcomes: ["YES", "NO"] }],
        positions: [{ id: "position:overview-schema" }],
      },
    }],
  ];
  for (const [label, replacement] of cases) {
    const malformed = { ...state, ...replacement };
    const economy = { engine, snapshot: () => malformed };
    const overview = createTokenEconomyOverview({ engine, economy });
    assert.equal(overview.economy.status, "invalid", label);
    assert.equal(overview.economy.ok, false, label);
    assert.equal(overview.invariants.ok, false, label);
  }

  const legacy = {
    ...state,
    exchange: { ...state.exchange, legacyMode: "historical-fixture" },
    events: [{ legacy: true, detail: "optional event payload" }],
  };
  delete legacy.exchange.revision;
  const legacyOverview = createTokenEconomyOverview({ engine, economy: { engine, snapshot: () => legacy } });
  assert.equal(legacyOverview.economy.status, "observed");
  assert.equal(legacyOverview.economy.ok, true);
  assert.equal(legacyOverview.invariants.ok, true);
});

test("adapters must share the same canonical owner", () => {
  const engine = createTokenEngine();
  const otherEngine = createTokenEngine();
  assert.throws(
    () => createTokenEconomyOverview({ engine, vault: createTokenVaultLedger({ engine: otherEngine }) }),
    /share the canonical engine/,
  );
  const otherEconomy = createSimulatedEconomy({ engine: otherEngine });
  assert.throws(() => createTokenEconomyOverview({ engine, economy: otherEconomy }), /share the canonical engine/);
});

class FakeNode {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.dataset = {};
    this.className = "";
    this.textContent = "";
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
}

test("renderer exposes simulation status and derived-total explanations without owning state", () => {
  const documentRef = { createElement: (tagName) => new FakeNode(tagName, documentRef) };
  const container = new FakeNode("div", documentRef);
  const overview = createTokenEconomyOverview({ engine: createTokenEngine() });
  const root = renderTokenEconomyOverview(container, overview);
  assert.equal(container.children.length, 1);
  assert.equal(root.dataset.simulation, "true");
  assert.equal(root.dataset.status, "local-simulation-only");
  assert.equal(root.children[0].textContent, "TUMBO-SIM economy");
  assert.equal(root.children.some((child) => child.tagName === "details"), true);
});
