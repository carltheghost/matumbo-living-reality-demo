import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("every direct feature route uses the Reality Lens tab surface", async () => {
  const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(source, /if \(active && realityAssembly\?\.active\) return;/);
  assert.match(source, /if \(!enteredFromRealityAssembly\) \{\s*setBlockWorldPresentation\(true,/);
  assert.match(source, /if \(enteredFromRealityAssembly\) \{\s*if \(exposeRealityAssemblyFeaturePanel\(feature\.id\)\)/);
  assert.match(source, /else if \(new URLSearchParams\(globalThis\.location\?\.search \?\? ''\)\.has\('feature'\)\) \{[\s\S]{0,220}realityAssembly\.open\(\{ lensMode: true, featureId \}\)/);
  assert.match(source, /onPanelFrame:[\s\S]{0,180}exposeRealityAssemblyFeaturePanel\(id\)/);
});

test("cube substrate hides only the round selector rail while route controls remain mounted", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /body\.cube-substrate-mode #selector\{opacity:0;pointer-events:none;transform:translateY\(8px\);\}/);
  assert.match(html, /id="feature-toggle"[^>]*aria-controls="feature-shell"/);
  assert.match(html, /id="block-world-console"/);
  assert.match(html, /id="room-console"/);
  assert.match(html, /id="contracts-markets-console"/);
  assert.match(html, /id="asset-launch"/);
  assert.match(html, /id="reality-lens"/);
  assert.match(html, /body\.cube-substrate-mode #asset-launch\.asset-route-hidden\{display:none!important;\}/);
});

test("Contracts, sports, and Academy keep the shared cube rail reachable beside their consoles", async () => {
  const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(
    source,
    /feature\.id === 'contracts'[\s\S]{0,500}contractsMarkets\?\.open\(\);[\s\S]{0,500}featureNavigator\?\.close\(\);/,
    "Contracts must close the overlapping Mission Control directory after opening its route console",
  );
  assert.match(html, /id="block-world-quick-actions"/);
  assert.match(html, /#block-world-quick-actions\{[^}]*resize:vertical/);
  assert.match(html, /body\.cube-substrate-mode #contracts-markets-console,body\.cube-substrate-mode #sports-events-console,body\.cube-substrate-mode #multi-sport-events-console,body\.cube-substrate-mode #academy-console\{max-height:calc\(100vh - 340px\)\}/);
  assert.match(html, /body\.cube-substrate-mode #block-world-quick-actions\{z-index:40\}/);
  assert.match(html, /id="contracts-markets-open-sports"/);
  assert.match(html, /OPEN TENNIS EVIDENCE.*SELECT A PUBLIC RECORD/);
});
