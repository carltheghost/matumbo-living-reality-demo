import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { getTumboSupplyPolicy } from "../src/domains/token-supply-policy.js";

test("asset-token route exposes canonical simulation/policy supply without the stale registry headline", async () => {
  const [mainSource, navigatorSource, launchSource, html] = await Promise.all([
    readFile(new URL("../src/main.js", import.meta.url), "utf8"),
    readFile(new URL("../src/render/feature-navigator.js", import.meta.url), "utf8"),
    readFile(new URL("../src/render/launch-console.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
  ]);
  const policy = getTumboSupplyPolicy();

  assert.match(mainSource, /readAssetRoutePolicy/);
  assert.match(mainSource, /currentIssuedLabel/);
  assert.match(mainSource, /intendedMaximumPolicyLabel/);
  assert.match(navigatorSource, /TUMBO_CURRENT_ISSUED_LABEL/);
  assert.match(navigatorSource, /TUMBO_INTENDED_MAXIMUM_LABEL/);
  assert.match(launchSource, /ISSUED \$\{TUMBO_CURRENT_ISSUED_LABEL\}/);
  assert.match(launchSource, /MAX \$\{TUMBO_INTENDED_MAXIMUM_LABEL\}/);
  assert.match(html, /id="asset-policy-max"/);
  assert.match(html, /id="asset-supply-note"/);
  assert.doesNotMatch(mainSource, /fixed\s+\$\{formatAssetUnits\(distributionExplorer\.getSnapshot\(\)\.totalSupply\)\}/);
  assert.doesNotMatch(navigatorSource, /1,000,000,000\s+TUMBO-SIM/);
  assert.doesNotMatch(html, /1,000,000,000\s+TUMBO-SIM/);
  assert.equal(policy.currentIssued.wholeTumbo, "10000000");
  assert.equal(policy.intendedMaximum.wholeTumbo, "42000000000000");
  assert.equal(policy.fluffPerTumbo, "1000");
});

test("asset-token route keeps the full registry visible and bounded in assembly mode", async () => {
  const css = await readFile(new URL("../src/render/reality-assembly.css", import.meta.url), "utf8");
  assert.match(css, /#hud\s*>\s*#launch-console\.tl-panel-movable:not\(\[hidden\]\)/);
  assert.match(css, /z-index:130!important/);
  assert.match(css, /inset:152px 12px 12px!important/);
  assert.match(css, /transform:none!important/);
  assert.match(css, /\[data-compact="true"\]\s*>\s*:not\(\.surface-grip\)/);
  assert.match(css, /asset-registry-open[\s\S]*visibility:hidden!important/);
});
