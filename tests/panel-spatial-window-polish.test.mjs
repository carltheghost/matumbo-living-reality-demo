import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { clampSurfaceSize, normalizePanelArrangement } from '../src/render/centered-surfaces.js';

test('universal panel manager exposes resize and spatial arrangement bounds', () => {
  assert.deepEqual(clampSurfaceSize(1, 1, 1000, 800), { width: 180, height: 100 });
  assert.equal(normalizePanelArrangement('FRONT'), 'front');
  assert.equal(normalizePanelArrangement('unknown'), 'free');
});

test('minimized surfaces use the glass-cube language and have a visible close control', async () => {
  const source = await readFile(new URL('../src/render/centered-surfaces.js', import.meta.url), 'utf8');
  assert.match(source, /surface-mini-cube/);
  assert.match(source, /surface-grip-close/);
  assert.match(source, /textContent='×'/);
  assert.match(source, /panel-space-resize/);
  assert.match(source, /data-panel-space-resize/);
});

test('new floating surfaces can join the shared manager and frontmost z-order', async () => {
  const source = await readFile(new URL('../src/render/centered-surfaces.js', import.meta.url), 'utf8');
  assert.match(source, /\[data-floating-panel=\"true\"\]/);
  assert.match(source, /zCounter/);
  assert.match(source, /bringFront/);
  assert.doesNotMatch(source, /Closed -> open transition: appear small/);
});

test('assembly removes the giant middle instruction and makes View controls a floating window', async () => {
  const assembly = await readFile(new URL('../src/render/reality-assembly.js', import.meta.url), 'utf8');
  assert.doesNotMatch(assembly, /maTumbo Living Reality Ω · one world — scroll or pinch to approach/);
  assert.match(assembly, /class=\"assembly-toolbar\" data-floating-panel=\"true\"/);
  assert.match(assembly, /maTumbo · Reality Lens Ω/);
});

test('stacking keeps the assembly above legacy overlays and TabEngine rail above it', async () => {
  const assemblyCss = await readFile(new URL('../src/render/reality-assembly.css', import.meta.url), 'utf8');
  const tabs = await readFile(new URL('../src/render/tab-engine.js', import.meta.url), 'utf8');
  assert.match(assemblyCss, /#reality-assembly\{position:fixed;inset:0;z-index:2100;/);
  assert.match(tabs, /\.tl-dock \{[\s\S]*?z-index: 3200;/);
  assert.match(tabs, /\.tl-layer \{[\s\S]*?z-index: 3050;/);
});

test('every assembly cube receives decorative halo, inner ring and core details', async () => {
  const scene = await readFile(new URL('../src/render/reality-assembly-scene.js', import.meta.url), 'utf8');
  assert.match(scene, /const halo=new THREE\.Mesh/);
  assert.match(scene, /const innerHalo=new THREE\.Mesh/);
  assert.match(scene, /const glowCore=new THREE\.Mesh/);
  assert.match(scene, /cornerPositions=/);
  assert.match(scene, /world-block\/outer-halo/);
});