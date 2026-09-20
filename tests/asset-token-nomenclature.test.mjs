import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const standaloneCoin = /\bcoins?\b/i;

function assertTumboLinesStayAssetTokenFirst(source, label) {
  const violations = source
    .split(/\r?\n/)
    .map((line, index) => ({ line, index: index + 1 }))
    .filter(({ line }) => /tumbo/i.test(line) && standaloneCoin.test(line) && !/coingecko/i.test(line));
  assert.deepEqual(violations, [], `${label} must not pair TUMBO with the legacy standalone coin vocabulary`);
}

test("visible TUMBO surfaces use Asset Token nomenclature", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const navigatorSource = await readFile(new URL("../src/render/feature-navigator.js", import.meta.url), "utf8");
  const marketSource = await readFile(new URL("../src/domains/asset-market.js", import.meta.url), "utf8");
  const currentState = await readFile(new URL("../docs/CURRENT_STATE.md", import.meta.url), "utf8");

  assert.match(html, /TUMBO Asset Token/);
  assert.match(html, /TUMBO-SIM/);
  assert.match(html, /asset-token display unit/i);
  assertTumboLinesStayAssetTokenFirst(html, "index.html");

  assert.match(navigatorSource, /label: "TUMBO Asset Token"/);
  assert.match(navigatorSource, /TUMBO-SIM/);
  assertTumboLinesStayAssetTokenFirst(navigatorSource, "feature navigator");

  assert.match(marketSource, /CoinGecko/);
  assert.match(marketSource, /asset-token display unit/i);
  assert.match(currentState, /OPEN ASSET PAGE/);
  assert.doesNotMatch(currentState, /OPEN COIN PAGE/);
});

test("PAYCORE emits asset-token kinds while retaining parser-only compatibility aliases", async () => {
  const paycoreSource = await readFile(new URL("../src/domains/paycore.js", import.meta.url), "utf8");
  assert.match(paycoreSource, /asset-token-balance-preview/);
  assert.match(paycoreSource, /asset-token-flow-preview/);
  assert.match(paycoreSource, /coin-balance-preview/);
  assert.match(paycoreSource, /coin-flow-preview/);
  assert.match(paycoreSource, /Historical fixture values are accepted only by the explicit parser boundary/);
});
