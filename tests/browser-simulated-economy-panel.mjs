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
  console.log(JSON.stringify({ passed: true, retry, remount }));
} finally {
  await browser.close();
}
