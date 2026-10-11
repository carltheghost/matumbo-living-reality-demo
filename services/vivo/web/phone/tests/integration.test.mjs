import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root = new URL('../../', import.meta.url);

test('the Android Companion extends the canonical GitHub Pages UI at runtime', async () => {
  const [html, activity, bootstrap] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('../android-companion/app/src/main/java/com/matumbo/vivo/MainActivity.kt', root), 'utf8'),
    readFile(new URL('phone/bootstrap.mjs', root), 'utf8'),
  ]);
  assert.match(html, /SHARED WORKSHOP/);
  assert.match(html, /src="shared\.js"/);
  assert.doesNotMatch(html, /phone\/bootstrap\.mjs|phone\/manifest\.webmanifest/);
  assert.match(activity, /onPageFinished/);
  assert.match(activity, /import\(new URL\('phone\/bootstrap\.mjs',\s*location\.href\)\.href\)/);
  assert.match(bootstrap, /two-hand-camera\.mjs/);
});

test('the phone-owned tracker detects two complete hands without transporting frames', async () => {
  const [worker, camera, sw] = await Promise.all([
    readFile(new URL('phone/two-hand-worker.mjs', root), 'utf8'),
    readFile(new URL('phone/two-hand-camera.mjs', root), 'utf8'),
    readFile(new URL('vivo-sw.js', root), 'utf8'),
  ]);
  assert.match(worker, /numHands: 2/);
  assert.match(worker, /maxHands: 2/);
  assert.match(worker, /landmarksPerHand: 21/);
  assert.match(worker, /handednesses/);
  assert.match(worker, /delegate: 'GPU'/);
  assert.match(worker, /delegate: 'CPU'/);
  assert.match(camera, /matchHands\(detections, this\.previous,/);
  assert.match(camera, /describeHand\(item\.landmarks\)/);
  assert.match(camera, /twohand/);
  assert.match(camera, /createImageBitmap\(this\.video\)/);
  assert.match(camera, /postMessage\(\{ type: 'frame'.*\}, \[image\]\)/);
  assert.match(sw, /readyz\|healthz\|api\|ws/);
  assert.match(sw, /camera frames.*never cached/i);
  assert.match(sw, /phone\/two-hand-camera\.mjs/);
  assert.match(sw, /phone\/two-hand-worker\.mjs/);
  assert.doesNotMatch(worker, /\bfetch\s*\(|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(camera, /\bfetch\s*\(|XMLHttpRequest|WebSocket/);
});

