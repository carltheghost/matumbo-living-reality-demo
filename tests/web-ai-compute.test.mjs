import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { WEB_AI_ASSISTANTS } from "../src/domains/web-ai.js";

test("Web + AI exposes the requested cross-provider handoffs", () => {
  const ids = new Set(WEB_AI_ASSISTANTS.map((assistant) => assistant.id));
  for (const id of ["chatgpt", "claude", "gemini", "deepseek", "kimi"]) {
    assert.equal(ids.has(id), true, `${id} is available as a provider handoff`);
  }
});

test("the Reality Lens Web + AI object contains one integrated COMPUTE surface", async () => {
  const source = await readFile(new URL("../src/render/web-ai.js", import.meta.url), "utf8");
  assert.match(source, /dataset\.tab = "economy"/);
  assert.match(source, /ONE TASK · MANY MODELS · ONE RECEIPT TRAIL/);
  assert.match(source, /PAYCORE METER/);
  assert.match(source, /T402 ROUTE/);
  assert.match(source, /PRIME LEDGER \/ ECHOPROOF/);
  assert.match(source, /REALITY LENS/);
  assert.match(source, /createComputeExchangeLedger/);
  assert.match(source, /getComputeEconomySnapshot/);
});

test("compute UI does not accept API keys, wallets, or pretend to perform settlement", async () => {
  const source = await readFile(new URL("../src/render/web-ai.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /api[_ -]?key\s*[:=]/i);
  assert.doesNotMatch(source, /private[_ -]?key\s*[:=]/i);
  assert.match(source, /live price requires adapter/);
  assert.match(source, /did not share credentials or claim billing authority/);
});


test("expanded compute surface includes wallet, router, consent vault and canonical world publication", async () => {
  const source = await readFile(new URL("../src/render/web-ai.js", import.meta.url), "utf8");
  assert.match(source, /COMPUTE WALLET/);
  assert.match(source, /AUTO ROUTER/);
  assert.match(source, /CONTRIBUTION VAULT/);
  assert.match(source, /ECONOMIC TIMELINE/);
  assert.match(source, /PLAN \+ TREASURY LAB/);
  assert.match(source, /evaluateComputeEconomics/);
  assert.match(source, /createComputeAccount/);
  assert.match(source, /createContributionVault/);
  assert.match(source, /createEconomicTimeline/);
  assert.match(source, /selectProviderRoute/);

  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /createComputeWorldContribution/);
  assert.match(main, /function publishComputeEconomyWorld/);
  assert.match(main, /simfabric:projection/);
  assert.match(main, /getComputeEconomySnapshot/);
});
