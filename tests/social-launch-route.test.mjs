import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("shareable Social and Space Explorer routes select a local launch mode", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(main, /const socialLaunchQuery = new URLSearchParams/);
  assert.match(main, /const requestedSocialMode = socialLaunchQuery\.get\('mode'\)/);
  assert.match(main, /const requestedSocialPanel = socialLaunchQuery\.get\('panel'\)/);
  assert.match(main, /panel.*social-explorer/s);
  assert.match(main, /featureNavigator\.select\('social-explorer', 'url', \{ updateLocation: false \}\)/);
  assert.match(main, /socialExplorer\?\.selectLaunchMode\(requestedSocialMode, 'url'\)/);
  assert.match(main, /plan\.modeId === 'space-explorer'/);
  assert.match(main, /featureNavigator\?\.select\('block-world', 'social-launch-space-mode'/);
  assert.match(main, /socialExplorer\?\.close\(\);[\s\S]{0,120}blockWorld\?\.open\(\);/);
  assert.match(main, /projection\.social-launch-space-route/);
  assert.match(html, /social-explorer-launch-modes/);
  assert.match(html, /Social experiment/i);
  assert.match(html, /Space explorer/i);
  assert.doesNotMatch(main, /requestedSocialMode[\s\S]{0,400}history\.(pushState|replaceState)/i);
});

test("Social allocate-preview hands Mission Control into the visible local distribution registry", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const start = main.indexOf("onAction: (action) => {");
  const end = main.indexOf("onReset: (reset)", start);
  assert.ok(start >= 0 && end > start, "expected Social Explorer action handoff");
  const handoff = main.slice(start, end);
  const allocateStart = handoff.indexOf("if (action.accepted !== false && action.intent === 'allocate-preview')");
  assert.ok(allocateStart >= 0, "expected allocate-preview branch");
  const allocateBranch = handoff.slice(allocateStart);
  assert.match(allocateBranch, /alignFeatureSurface\('launch-distribution', 'social-action:allocate-preview'\)/);
  assert.match(allocateBranch, /featureNavigator\?\.close\(\)/);
  assert.match(allocateBranch, /launchConsole\?\.open\(\)/);
  assert.match(allocateBranch, /launchConsole\?\.setJourneyStep\?\.\('registry', 'social-action'\)/);
});
