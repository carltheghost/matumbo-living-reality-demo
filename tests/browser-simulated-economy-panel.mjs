// Explicit browser regression for panel operation identity. This is not part
// of the dependency-free unit suite; run it with a local static server.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const dependencyPackage = process.env.MATUMBO_NODE_DEPENDENCIES
  ?? "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/package.json";
const { chromium } = createRequire(dependencyPackage)("playwright");
const base = process.env.MATUMBO_PREVIEW_URL ?? "http://127.0.0.1:8123/matumbo-living-reality-demo/field-lab-phone.html";

const browser = await chromium.launch({ headless: true, executablePath: process.env.MATUMBO_CHROMIUM ?? "/usr/bin/chromium", args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
page.setDefaultTimeout(4_000);
try {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 10_000 });
  await page.evaluate(async () => {
    document.body.replaceChildren();
    const { mountSimulatedEconomyPanel } = await import("/matumbo-living-reality-demo/src/render/simulated-economy-panel.js");
    const keys = [];
    let attempts = 0;
    const model = {
      balances: () => ({ available: { TUMBO: 10_000, sMIMAS: 10_000 } }),
      exchangeOrders: () => [],
      predictionMarkets: () => [],
      contracts: () => [],
      on: () => () => {},
      seedDemoLiquidity: () => ({ seeded: true }),
      placeExchangeOrder: (request) => {
        keys.push(request.idempotencyKey);
        attempts += 1;
        if (attempts === 1) throw new Error("retryable local failure");
        return { order: { id: "fake-order" }, fills: [], simulation: true };
      },
      token: { quote: () => ({}), execute: () => ({ amountOut: 1 }) },
    };
    const trigger = document.createElement("button");
    trigger.id = "economy-trigger-one";
    document.body.append(trigger);
    const first = mountSimulatedEconomyPanel({ documentRoot: document, economy: model, trigger, seedLiquidity: false });
    trigger.click();
    window.__simulatedEconomyPanelTest = { keys, get attempts() { return attempts; }, model, trigger, mount: first };
  });
  await page.locator('[data-action="exchange:place"]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-action="exchange:place"]').click();
  await page.waitForTimeout(20);
  const retry = await page.evaluate(() => ({
    keys: [...window.__simulatedEconomyPanelTest.keys],
    attempts: window.__simulatedEconomyPanelTest.attempts,
    status: document.querySelector(".sim-economy-status")?.textContent,
  }));
  assert.equal(retry.attempts, 2);
  assert.equal(retry.keys.length, 2);
  assert.equal(retry.keys[0], retry.keys[1], "a retry keeps the same operation identity");
  assert.match(retry.status, /Committed/);

  await page.evaluate(async () => {
    const { mountSimulatedEconomyPanel } = await import("/matumbo-living-reality-demo/src/render/simulated-economy-panel.js");
    window.__simulatedEconomyPanelTest.mount.destroy();
    window.__simulatedEconomyPanelTest.trigger.remove();
    const trigger = document.createElement("button");
    trigger.id = "economy-trigger-two";
    document.body.append(trigger);
    const mount = mountSimulatedEconomyPanel({ documentRoot: document, economy: window.__simulatedEconomyPanelTest.model, trigger, seedLiquidity: false });
    window.__simulatedEconomyPanelTest.trigger = trigger;
    window.__simulatedEconomyPanelTest.mount = mount;
    trigger.click();
  });
  await page.locator('[data-action="exchange:place"]').click();
  await page.waitForTimeout(20);
  const remount = await page.evaluate(() => ({
    keys: [...window.__simulatedEconomyPanelTest.keys],
    status: document.querySelector(".sim-economy-status")?.textContent,
  }));
  assert.equal(remount.keys.length, 3);
  assert.notEqual(remount.keys[2], remount.keys[0], "a remount creates a fresh operation namespace");
  assert.match(remount.status, /Committed/);

  await page.evaluate(async () => {
    const { mountSimulatedEconomyPanel } = await import("/matumbo-living-reality-demo/src/render/simulated-economy-panel.js");
    window.__simulatedEconomyPanelTest.mount.destroy();
    window.__simulatedEconomyPanelTest.trigger.remove();
    const pools = [
      {
        id: "pool:alice",
        name: "Alice shared pool",
        owner: "u:alice",
        status: "open",
        revision: 1,
        capacityFluff: 5_000,
        totalUnits: 1_000,
        availableCapacityFluff: 4_000,
        contributors: [{ account: "u:you", units: 1_000, reservedUnits: 1_000, committedUnits: 0, ownershipNumerator: 1_000, ownershipDenominator: 1_000 }],
        contributions: [{ id: "contribution:you-in-alice", contributor: "u:you", amountFluff: 1_000, status: "reserved", reserveReceiptId: "reserve:alice-pool", releaseReceiptId: null, commitment: null }],
      },
      {
        id: "pool:you",
        name: "You shared pool",
        owner: "u:you",
        status: "open",
        revision: 2,
        capacityFluff: 5_000,
        totalUnits: 2_500,
        availableCapacityFluff: 2_500,
        contributors: [{ account: "u:you", units: 1_500, reservedUnits: 500, committedUnits: 1_000, ownershipNumerator: 1_500, ownershipDenominator: 2_500 }],
        contributions: [
          { id: "contribution:alice-in-you", contributor: "u:alice", amountFluff: 1_000, status: "reserved", reserveReceiptId: "reserve:foreign", releaseReceiptId: null, commitment: null },
          { id: "contribution:you-in-you", contributor: "u:you", amountFluff: 500, status: "reserved", reserveReceiptId: "reserve:you-pool", releaseReceiptId: null, commitment: null },
          { id: "contribution:you-committed", contributor: "u:you", amountFluff: 1_000, status: "committed", reserveReceiptId: "reserve:committed", releaseReceiptId: null, commitment: { receiptId: "commit:you-pool", outcomeId: "outcome:shared" } },
        ],
      },
    ];
    const queries = [];
    const model = {
      balances: () => ({ available: { TUMBO: 8_500, sMIMAS: 10_000 } }),
      exchangeOrders: () => [],
      predictionMarkets: () => [],
      contracts: () => [],
      housePools: (...args) => { queries.push(args); return pools; },
      on: () => () => {},
      storageStatus: "in-memory",
      token: { quote: () => ({}), execute: () => ({ amountOut: 1 }) },
    };
    const trigger = document.createElement("button");
    trigger.id = "economy-trigger-house-pool";
    document.body.append(trigger);
    const mount = mountSimulatedEconomyPanel({ documentRoot: document, economy: model, trigger, seedLiquidity: false });
    window.__simulatedEconomyPanelTest = { model, trigger, mount, queries };
    trigger.click();
  });
  await page.locator('[data-action="tab:house-pool"]').click();
  const housePoolUi = await page.evaluate(() => ({
    options: [...document.querySelectorAll("#sim-economy-house-pool-select option")].map(option => option.textContent),
    cards: [...document.querySelectorAll(".sim-economy-house-pool-card")].map(card => card.innerText),
    reservedSummary: document.querySelectorAll(".sim-economy-balance-card")[2]?.innerText,
    releaseButtons: document.querySelectorAll('[data-action="house-pool:release"]').length,
    queries: window.__simulatedEconomyPanelTest.queries,
  }));
  assert.deepEqual(housePoolUi.options, ["Select a house pool", "Alice shared pool · 1.000 TUMBO-SIM / 5.000 TUMBO-SIM", "You shared pool · 2.500 TUMBO-SIM / 5.000 TUMBO-SIM"]);
  assert.equal(housePoolUi.cards.length, 2, "the panel lists pools owned by other accounts");
  assert.match(housePoolUi.reservedSummary, /2\.500 TUMBO-SIM/);
  assert.equal(housePoolUi.releaseButtons, 2, "release controls only cover the current user's reserved contributions");
  const committedCard = housePoolUi.cards.find(card => card.includes("COMMITTED · 1.000"));
  assert.match(committedCard, /Receipt · commit:you-pool/);
  assert.doesNotMatch(committedCard, /reserve:committed/);
  assert.ok(housePoolUi.queries.length > 0 && housePoolUi.queries.every(args => args.length === 0), "panel pool lookups are not owner-filtered");
  console.log(JSON.stringify({ passed: true, retry, remount, housePoolUi }));
} finally {
  await browser.close();
}
