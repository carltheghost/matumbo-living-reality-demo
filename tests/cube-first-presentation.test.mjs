import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("cube-first presentation clears the legacy rounded rails", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");

  assert.match(html, /body\.cube-first-mode #selector/);
  assert.match(html, /body\.cube-first-mode #reality-lens/);
  assert.match(html, /body\.cube-first-mode #asset-launch\.cube-first-hidden\{display:none!important;\}/);
  assert.match(source, /document\.body\?\.classList\.toggle\('cube-first-mode', blockWorldPresentationActive\)/);
  assert.match(source, /assetLaunchPanel\?\.classList\.toggle\(\s*'cube-first-hidden'/);
  assert.match(source, /feature\.id === 'block-world' && !portalMethod\) featureNavigator\?\.close\(\)/);
  // Default landing is the clean constellation overview (reality-lens),
  // resolved by the pure, unit-tested resolveDefaultFeature(); the
  // cube-field interior only appears on deliberate entry.
  assert.match(source, /const defaultLandingFeature = resolveDefaultFeature\(initialLandingQuery, initialLandingHash\);/);
  assert.match(source, /featureNavigator\.select\(defaultLandingFeature, 'default', \{ updateLocation: false \}\);\s*featureNavigator\.close\(\);/);
  assert.match(source, /block-world-close.*?setBlockWorldPresentation\(false\);\s*setBlockWorldFocusMode\(false\);/s);
  assert.match(source, /function openLaunchKit\(method = 'button'\)[\s\S]*?setBlockWorldPresentation\(true, \{ cubeFirstUi: true \}\);/);
  assert.match(source, /window\.__TUMBO_WORLD__ = world/);
});

test("cube-first mode keeps the feature directory reachable", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="feature-toggle"[^>]*aria-controls="feature-shell"/);
  assert.match(html, /OPEN FEATURES · F/);
  assert.match(html, /Select a block, double-click or double-tap a portal cube to dive inside it, double-click or double-tap a container to open it/);
});
