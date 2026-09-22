import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('clean root remains Reality Assembly forever', async () => {
  const landing = await import('../src/core/default-landing.js');
  assert.equal(landing.resolveDefaultFeature('', ''), 'reality-lens');

  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /featureNavigator\.getSnapshot\(\)\.activeId==='reality-lens'\)realityAssembly\.open\(\)/);
});

test('final assembly spacing keeps the feature rings separated', async () => {
  const source = await readFile(new URL('../src/render/reality-assembly.js', import.meta.url), 'utf8');
  assert.match(source, /radius=outer\?20\.5:10\.5/);
  assert.match(source, /innerWidth<700\?92:76/);
});

test('central cube has six local-style face systems', async () => {
  const source = await readFile(new URL('../src/render/reality-assembly-scene.js', import.meta.url), 'utf8');
  assert.match(source, /if\(feature\.id==='block-world'\)/);
  assert.match(source, /const faceColors=\['#48d7ff','#7ff0b7','#c59cff','#ffd166','#ff7188','#72a7ff'\]/);
  assert.match(source, /\/face-\$\{axis\}-\$\{sign\}\/door/);
  assert.match(source, /\/face-\$\{axis\}-\$\{sign\}\/block-\$\{i\}/);
});

test('TUMBO-SIM transfer chip is one continuously rotating cube', async () => {
  const source = await readFile(new URL('../src/domains/token-transfers-ui.js', import.meta.url), 'utf8');
  assert.match(source, /TOKEN_TRANSFER_UI_VERSION = "20260922-token-transfers-cube2"/);
  assert.match(source, /const cubeRoot = new THREE\.Group\(\)/);
  assert.match(source, /cubeRoot\.rotation\.y = t \* 0\.5/);
  assert.match(source, /const faceDefs = \[/);
  assert.doesNotMatch(source, /const satA = makeGlassCube/);
  assert.doesNotMatch(source, /makeConnectionLines\(THREE/);
});


test('desktop tabs stay on the right and use the TUMBO-SIM minimized glass language', async () => {
  const source = await readFile(new URL('../src/render/tab-engine.js', import.meta.url), 'utf8');
  assert.match(source, /\.tl-dock--desktop\s*\{[\s\S]*?right:\s*12px;/);
  assert.doesNotMatch(source, /\.tl-dock--desktop\s*\{[\s\S]*?left:\s*12px;/);
  assert.match(source, /\.tl-layer--desktop\s*\{[\s\S]*?right:\s*154px;/);
  assert.doesNotMatch(source, /\.tl-layer--desktop\s*\{[\s\S]*?left:\s*92px;/);
  assert.match(source, /\.tl-chip\s*\{[\s\S]*?border:\s*1px solid rgba\(129, 232, 255, 0\.24\)/);
  assert.match(source, /\.tl-chip\s*\{[\s\S]*?linear-gradient\(165deg/);
  assert.match(source, /\.tl-chip-cube\s*\{[\s\S]*?transform-style:\s*preserve-3d/);
  assert.match(source, /@keyframes\s+tl-minimized-cube-spin/);
  assert.match(source, /\.tl-cube-face--front/);
  assert.match(source, /cubeEl\.className = 'tl-chip-cube'/);
  assert.match(source, /\.tl-dock--desktop \{[\s\S]*?right:\s*12px;/);
});

test('token transfer UI stays behind the primary panel/tabs layer', async () => {
  const source = await readFile(new URL('../src/domains/token-transfers-ui.js', import.meta.url), 'utf8');
  assert.match(source, /#token-transfer-chip\{position:fixed;z-index:44;/);
  assert.match(source, /#token-transfer-console\{position:fixed;z-index:45;/);
});
