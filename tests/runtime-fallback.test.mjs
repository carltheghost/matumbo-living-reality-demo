import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

test("runtime bootstrap exposes loading, ready, and failure states", async () => {
  const html = await readFile(new URL("index.html", ROOT), "utf8");
  const main = await readFile(new URL("src/main.js", ROOT), "utf8");

  assert.match(html, /id="runtime-status"/);
  assert.match(html, /data-runtime-state="loading"/);
  assert.match(html, /Loading local Living Reality/);
  assert.match(html, /id="runtime-status-retry"/);
  assert.match(html, /globalThis\.__MATUMBO_RUNTIME__/);
  assert.match(html, /unhandledrejection/);
  assert.match(html, /module still loading/);
  assert.match(html, /slow connection/);
  assert.match(html, /type="module" src="\.\/src\/main\.js[^>]+onerror="globalThis\.__MATUMBO_RUNTIME__\?\.markFailed/);
  assert.match(html, /Three\.js renderer module did not load/);
  assert.match(main, /__MATUMBO_RUNTIME__/);
  assert.match(main, /markReady/);
  assert.match(main, /markFailed/);
});

test("narrow ready status preserves the brand and feature controls", async () => {
  const html = await readFile(new URL("index.html", ROOT), "utf8");

  assert.match(html, /#runtime-status\[data-runtime-state="loading"\]\{[^}]*pointer-events:none/);
  assert.match(html, /#runtime-status\[data-runtime-state="ready"\]\{[^}]*right:12px[^}]*max-width:calc\(100vw - 156px\)/);
  assert.match(html, /#runtime-status\[data-runtime-state="ready"\] #runtime-status-message\{display:none\}/);
  assert.match(html, /#feature-toggle\{left:12px;top:50px/);
});

test("cube substrate reserves a mobile action lane for every sports-to-contract surface", async () => {
  const html = await readFile(new URL("index.html", ROOT), "utf8");

  const laneRule = html.match(/@media\(max-width:700px\)\{body\.cube-substrate-mode #contracts-markets-console,[\s\S]*?body\.cube-substrate-mode #block-world-quick-actions\{z-index:40\}\}/)?.[0] ?? "";
  assert.match(laneRule, /body\.cube-substrate-mode #contracts-markets-console/);
  assert.match(laneRule, /body\.cube-substrate-mode #sports-events-console/);
  assert.match(laneRule, /body\.cube-substrate-mode #multi-sport-events-console/);
  assert.match(laneRule, /max-height:calc\(100vh - 340px\)/);
});

test("narrow consoles give Tennis and multi-sport the same full-height scrollable surface as Contracts", async () => {
  const html = await readFile(new URL("index.html", ROOT), "utf8");
  const terminalMobileRule = html.match(/@media \(max-width: 700px\) \{[\s\S]*?#sports-events-console, #multi-sport-events-console,[\s\S]*?max-height: calc\(100vh - 72px\); overflow-y: auto; overflow-x: hidden;/)?.[0] ?? "";
  assert.match(terminalMobileRule, /#contracts-markets-console,/);
  assert.match(terminalMobileRule, /#sports-events-console, #multi-sport-events-console,/);
  assert.match(terminalMobileRule, /top: 54px; bottom: auto; width: auto; max-width: none;/);
});

test("narrow World Pulse projection stays below the console and scrollable", async () => {
  const html = await readFile(new URL("index.html", ROOT), "utf8");
  const rule = html.match(/@media\(max-width:700px\)\{#world-events-projection\{z-index:33;max-height:calc\(100vh - 112px\);overflow-y:auto\}\}/)?.[0] ?? "";
  assert.match(rule, /z-index:33/);
  assert.match(rule, /max-height:calc\(100vh - 112px\)/);
  assert.match(rule, /overflow-y:auto/);
});

test("runtime recovery remains a local renderer boundary", async () => {
  const html = await readFile(new URL("index.html", ROOT), "utf8");
  assert.match(html, /No wallet, provider, persistence, or external execution was attempted/);
  assert.doesNotMatch(html, /getUserMedia\s*\(/);
  assert.doesNotMatch(html, /fetch\s*\(/);
  assert.doesNotMatch(html, /WebSocket\s*\(/);
});

test("renderer failure keeps the pre-rendered feature directory controls usable without claiming 3-D recovery", async () => {
  const html = await readFile(new URL("index.html", ROOT), "utf8");

  assert.match(html, /const activateStaticDirectory/);
  assert.match(html, /featureShell\.dataset\.staticFallback = 'active'/);
  assert.match(html, /featureToggle\?\.addEventListener\('click',[\s\S]*?state !== 'error'/);
  assert.match(html, /featureClose\?\.addEventListener\('click',[\s\S]*?state !== 'error'/);
  assert.match(html, /event\.key\?\.toLowerCase\(\) !== 'f'/);
  assert.match(html, /static local feature directory and its local route links remain available; it does not replace the 3-D surface/);
  assert.match(html, /id="feature-nav-fallback"/);
  assert.match(html, /href="\?feature=contracts/);
  assert.doesNotMatch(html, /staticFallback[\s\S]*?fetch\s*\(/);
});

test("static renderer fallback presents canonical feature routes as keyboard and touch focusable blocks", async () => {
  const html = await readFile(new URL("index.html", ROOT), "utf8");

  assert.match(html, /id="static-cube-readout"/);
  assert.match(html, /STATIC CUBE DIRECTORY · 2-D route handoff only/);
  assert.match(html, /const staticCubes/);
  assert.match(html, /const focusStaticCube/);
  assert.match(html, /staticDirectory\?\.addEventListener\('pointerover'/);
  assert.match(html, /staticDirectory\?\.addEventListener\('focusin'/);
  assert.match(html, /\['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'\]/);
  assert.match(html, /href="\?feature=block-world/);
  assert.match(html, /href="\?feature=contracts/);
  assert.match(html, /2-D fallback only; no 3-D renderer, provider read, or external execution/);
});

test("camera and gesture panel routes align the shared feature context with device projection", async () => {
  const main = await readFile(new URL("src/main.js", ROOT), "utf8");
  const start = main.indexOf("if (new URLSearchParams(globalThis.location?.search ?? '').get('panel') === 'camera'", main.indexOf("applyContractsRoute('url')"));
  const end = main.indexOf("document.getElementById('camera-reset')", start);
  assert.ok(start >= 0 && end > start, "expected final camera/gesture route handoff");
  const routeBlock = main.slice(start, end);
  assert.match(routeBlock, /alignFeatureSurface\('projections', 'device-input-route'\)/);
  assert.match(routeBlock, /featureNavigator\.close\(\)/);
});

test("Mission Control camera and gesture buttons open the same projections context as direct device routes", async () => {
  const main = await readFile(new URL("src/main.js", ROOT), "utf8");
  const cameraStart = main.indexOf("document.getElementById('camera-input-open')?.addEventListener");
  const gestureStart = main.indexOf("document.getElementById('gesture-input-open')?.addEventListener", cameraStart);
  const closeStart = main.indexOf("document.getElementById('camera-input-close')", gestureStart);
  assert.ok(cameraStart >= 0 && gestureStart > cameraStart && closeStart > gestureStart, "expected device control button handoffs");
  const cameraButton = main.slice(cameraStart, gestureStart);
  const gestureButton = main.slice(gestureStart, closeStart);
  assert.match(cameraButton, /alignFeatureSurface\('projections', 'camera-input-button'\)/);
  assert.match(cameraButton, /featureNavigator\?\.close\(\)/);
  assert.match(cameraButton, /cameraInput\.open\(\)/);
  assert.match(gestureButton, /alignFeatureSurface\('projections', 'gesture-input-button'\)/);
  assert.match(gestureButton, /featureNavigator\?\.close\(\)/);
  assert.match(gestureButton, /cameraInput\.open\(\)/);
  assert.match(gestureButton, /gestureInput\?\.open\(\)/);
});
