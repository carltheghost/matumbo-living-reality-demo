import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("normal feature routes keep the cube substrate as the visual layer", async () => {
  const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(source, /setBlockWorldPresentation\(true, \{\s*cubeFirstUi: feature\.id === 'block-world' \|\| feature\.id === 'runtime-sync' \|\| preserveCubeSubstrate,\s*\}\);/);
  assert.match(source, /world\.children\.forEach\(child=>\{child\.visible=child===blockWorld\?\.layer;\}\);/);
  assert.match(source, /if \(portalCubeSubstrateActive \|\| blockWorldPresentationActive\) \{\s*restorePortalCubeReadout\(method\);/);
  assert.match(source, /const cubeTarget = blockWorldPresentationActive \? blockWorld\?\.getFocusTarget\?\.\(\) : null;/);
  assert.match(source, /feature\.id === 'reality-lens'[\s\S]*setRealityLens\('world'/);
  assert.match(source, /feature\.id === 'person'[\s\S]*setRealityLens\('detail'/);
  assert.match(source, /feature\.id === 'rooms'[\s\S]*roomSpaces\?\.open\(\)/);
  assert.match(source, /feature\.id === 'asset-token'[\s\S]*previewAssetLaunch/);
  assert.match(source, /feature\.id === 'contracts'[\s\S]*contractsMarkets\?\.open\(\)/);
  assert.match(source, /assetLaunchPanel\?\.classList\.toggle\(\s*'asset-route-hidden',\s*feature\.id !== 'asset-token',\s*\);/);
  assert.match(source, /if \(cubeTarget\) restorePortalCubeReadout\(method\);\s*else if\(realityLensMode==='detail'/);
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
