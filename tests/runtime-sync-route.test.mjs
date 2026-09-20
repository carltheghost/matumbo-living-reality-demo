import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("Local Cube Sync is a Mission Control and Launch Kit route", async () => {
  const featureNavigator = await readFile(new URL("../src/render/feature-navigator.js", import.meta.url), "utf8");
  const launchKit = await readFile(new URL("../src/domains/launch-kit.js", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const docs = await readFile(new URL("../docs/LAUNCH_KIT.md", import.meta.url), "utf8");

  assert.match(featureNavigator, /id: "runtime-sync"/);
  assert.match(featureNavigator, /label: "Local Cube Sync"/);
  assert.match(featureNavigator, /runtime-sync.*LOOPBACK/s);
  assert.match(launchKit, /\["runtime-sync", "Local Cube Sync", "Merge 4 runtime"\]/);
  assert.match(launchKit, /id === "runtime-sync" \? "\?panel=runtime-sync"/);

  const handoffStart = main.indexOf("onRoute: (snapshot) => {");
  const handoffEnd = main.indexOf("onReplay: (snapshot)", handoffStart);
  assert.ok(handoffStart >= 0 && handoffEnd > handoffStart, "Launch Kit route callback must be present");
  const handoff = main.slice(handoffStart, handoffEnd);
  assert.match(handoff, /snapshot\.featureId === 'runtime-sync'/);
  assert.match(handoff, /openBlockWorldRuntimeSync\('launch-kit-route', \{ updateLocation: true, route: snapshot\.route \}\)/);
  assert.match(handoff, /featureNavigator\?\.select\(snapshot\.featureId, 'launch-kit-route'\)/);
  assert.match(main, /feature\.id === 'runtime-sync'/);
  assert.match(main, /selectFeature: false/);
  assert.match(main, /setBlockWorldRuntimeSyncLocation/);
  assert.match(main, /blockWorldRuntimeRouteQuery\.get\('world'\)/);
  assert.match(main, /setWorldId\?\./);
  assert.match(main, /initialLandingQuery\.get\('feature'\) === 'runtime-sync'[\s\S]*featureNavigator\.close\(\)/);
  assert.match(docs, /\?panel=runtime-sync/);
});
