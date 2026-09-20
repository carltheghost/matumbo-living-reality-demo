import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("plain launch-distribution panel route opens the complete local registry", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const docs = await readFile(new URL("../docs/DEMO_LAUNCH.md", import.meta.url), "utf8");
  const routeStart = main.indexOf("const launchDistributionRouteQuery = new URLSearchParams");
  const routeEnd = main.indexOf("if (new URLSearchParams(globalThis.location?.search ?? '').get('panel') === 'world-events')", routeStart);
  assert.ok(routeStart >= 0, "launch-distribution route query must be present");
  assert.ok(routeEnd > routeStart, "launch-distribution route block must end before World Pulse routing");
  const routeBlock = main.slice(routeStart, routeEnd);

  assert.match(routeBlock, /const launchDistributionPanelRoute = .*get\('panel'\) === 'launch-distribution'/);
  assert.match(routeBlock, /const launchDistributionPopulationRoute = .*get\('live'\) === 'population'/);
  assert.match(routeBlock, /if \(launchDistributionPanelRoute \|\| \(launchDistributionRouteQuery\.get\('feature'\) === 'launch-distribution' && launchDistributionPopulationRoute\)\)/);
  assert.match(routeBlock, /featureNavigator\.select\('launch-distribution', 'url', \{ updateLocation: false \}\)/);
  assert.match(routeBlock, /if \(launchDistributionPanelRoute\) featureNavigator\.close\(\)/);
  assert.match(routeBlock, /launchConsole\?\.open\(\)/);
  assert.match(routeBlock, /if \(launchDistributionPopulationRoute\) \{[\s\S]*refreshPopulationContext\?\.\('url'\)/);
  assert.equal((routeBlock.match(/refreshPopulationContext/g) ?? []).length, 1, "population context has one URL-triggered refresh call");
  assert.match(docs, /panel=launch-distribution/);
  assert.match(docs, /plain .*panel route|complete .*registry/i);
});

test("launch-distribution compare route is canonical-only and fail-closed", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const renderer = await readFile(new URL("../src/render/launch-console.js", import.meta.url), "utf8");
  assert.match(main, /get\('compare'\)/, "main route parser reads compare");
  assert.match(main, /hydrateCompareRoute\?\./, "cold load hydrates compare route");
  assert.match(renderer, /compare requires exactly two distinct canonical cohort IDs/);
  assert.match(renderer, /ids\.length!==2\|\|ids\[0\]===ids\[1\]/);
  assert.match(renderer, /COMPARE ·/);
  assert.match(renderer, /TUMBO-SIM LOCAL REGISTRY/);
});

test("Launch Distribution Social journey aligns the visible Social Explorer surface", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const start = main.indexOf("onJourney: (step) => {");
  const end = main.indexOf("onPopulationRefresh:", start);
  assert.ok(start >= 0 && end > start, "expected launch journey handoff callback");
  const journey = main.slice(start, end);
  const socialStart = journey.indexOf("if (step.step === 'social')");
  assert.ok(socialStart >= 0, "expected Social journey step");
  const socialBranch = journey.slice(socialStart);
  assert.match(socialBranch, /alignFeatureSurface\('social-explorer', 'launch-journey:social'\)/);
  assert.match(socialBranch, /launchConsole\?\.close\(\)/);
  assert.match(socialBranch, /featureNavigator\?\.close\(\)/);
  assert.match(socialBranch, /socialExplorer\?\.open\(\)/);
});
