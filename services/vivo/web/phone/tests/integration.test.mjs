import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root = new URL('../../', import.meta.url);

test('GitHub Pages Vivo app loads the local phone engine additively', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.match(html, /phone\/bootstrap\.mjs/);
  assert.match(html, /phone\/manifest\.webmanifest/);
  assert.match(html, /SHARED WORKSHOP/);
});

test('two-hand model configuration and local worker camera path never transport frames', async () => {
  const [worker, camera, sw] = await Promise.all([
    readFile(new URL('hand-worker.js', root), 'utf8'),
    readFile(new URL('camera.js', root), 'utf8'),
    readFile(new URL('vivo-sw.js', root), 'utf8'),
  ]);
  assert.match(worker, /numHands:2/); assert.match(worker, /landmarksPerHand:21/); assert.match(worker, /delegate:'GPU'/);
  assert.match(camera, /twohand/); assert.match(camera, /framesUploaded:false/); assert.match(camera, /handSlots/);
  assert.match(sw, /readyz\|healthz\|api\|ws/); assert.match(sw, /camera frames.*never cached/i);
  assert.doesNotMatch(worker, /fetch\(/);
  assert.doesNotMatch(camera, /fetch\(|XMLHttpRequest|WebSocket/);
});
