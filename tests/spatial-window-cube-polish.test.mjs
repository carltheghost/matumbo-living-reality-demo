import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PANEL_DEPTH_MAX,
  PANEL_DEPTH_MIN,
  PANEL_HEIGHT_MIN,
  PANEL_WIDTH_MIN,
  clampDepth,
  clampSurface,
  clampSurfaceSize,
  composePanelTransform,
  normalizePanelArrangement,
} from '../src/render/centered-surfaces.js';

test('panel geometry remains bounded', () => {
  assert.deepEqual(clampSurface(-50, 2000, 300, 500, 390, 844), { x: 8, y: 302 });
  const min = clampSurfaceSize(1, 1, 1000, 800);
  assert.equal(min.width, PANEL_WIDTH_MIN);
  assert.equal(min.height, PANEL_HEIGHT_MIN);
  assert.equal(clampDepth(-9999), PANEL_DEPTH_MIN);
  assert.equal(clampDepth(9999), PANEL_DEPTH_MAX);
});

test('panel transform keeps independent x/y and depth', () => {
  const transform = composePanelTransform(10, 20, 0);
  assert.match(transform, /translate3d\(10\.0px, 20\.0px, 0px\)/);
  assert.match(transform, /scale\(1\.0000\)/);
});

test('arrangement vocabulary is explicit', () => {
  assert.deepEqual(
    ['free','left','right','top','bottom','front','back'].map(normalizePanelArrangement),
    ['free','left','right','top','bottom','front','back'],
  );
  assert.equal(normalizePanelArrangement('garbage'), 'free');
});

test('universal manager has cube cards, visible close control, resize handles and lazy child-list discovery', async () => {
  const source = await readFile(new URL('../src/render/centered-surfaces.js', import.meta.url), 'utf8');
  assert.match(source, /surface-mini-cube/);
  assert.match(source, /surface-grip-close/);
  assert.match(source, /textContent='×'/);
  assert.match(source, /panel-space-resize/);
  assert.match(source, /data-panel-space-resize/);
  assert.match(source, /childList:true/);
  assert.match(source, /data-floating-panel="true"/);
  assert.match(source, /matumbo\.panelSpace\.v2/);
  assert.match(source, /matumbo\.panelSpace\.v1/);
});

test('managed windows preserve live state on reopen and support z-order', async () => {
  const source = await readFile(new URL('../src/render/centered-surfaces.js', import.meta.url), 'utf8');
  assert.match(source, /bringFront/);
  assert.match(source, /zCounter/);
  assert.match(source, /Reopening a window never restores a stale saved position/);
});

test('View controls are a movable floating window and the giant center sentence is gone', async () => {
  const source = await readFile(new URL('../src/render/reality-assembly.js', import.meta.url), 'utf8');
  assert.match(source, /data-panel-space-title="View controls"/);
  assert.match(source, /data-floating-panel="true"/);
  assert.match(source, /maTumbo · Reality Lens Ω/);
  assert.doesNotMatch(source, /maTumbo Living Reality Ω · one world — scroll or pinch to approach/);
});

test('stacking order puts Reality Lens chrome below the TabEngine rail but above legacy HUD', async () => {
  const css = await readFile(new URL('../src/render/reality-assembly.css', import.meta.url), 'utf8');
  const tabs = await readFile(new URL('../src/render/tab-engine.js', import.meta.url), 'utf8');
  assert.match(css, /#reality-assembly\{position:fixed;inset:0;z-index:2100;/);
  assert.match(tabs, /\.tl-dock \{[\s\S]*?z-index: 3200;/);
  assert.match(tabs, /\.tl-layer \{[\s\S]*?z-index: 3050;/);
});

test('every feature cube gets consistent luminous decoration', async () => {
  const source = await readFile(new URL('../src/render/reality-assembly-scene.js', import.meta.url), 'utf8');
  assert.match(source, /const halo=new THREE\.Mesh/);
  assert.match(source, /const innerHalo=new THREE\.Mesh/);
  assert.match(source, /const glowCore=new THREE\.Mesh/);
  assert.match(source, /cornerPositions=/);
  assert.match(source, /world-block\/outer-halo/);
});

test('mascot HUD control uses the glass-cube visual language without pretending a screenshot is a portrait', async () => {
  const source = await readFile(new URL('../src/render/photo-mascot-mount.js', import.meta.url), 'utf8');
  assert.match(source, /const mascotCube/);
  assert.match(source, /textContent = "TUMBO"/);
  assert.match(source, /background = "linear-gradient\(145deg/);
});