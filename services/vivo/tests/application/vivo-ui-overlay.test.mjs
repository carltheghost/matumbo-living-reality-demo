import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inputCopy, inputModeForPointer, probeXrCapabilities, xrSummary} from '../../web/vivo-ui-overlay.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '../../web');

test('input guidance names all supported local input paths', () => {
  assert.match(inputCopy('touch').text, /Touch:/);
  assert.match(inputCopy('hand').text, /open hand/);
  assert.match(inputCopy('mouse').text, /orbit/);
  assert.equal(inputModeForPointer('touch'), 'touch');
  assert.equal(inputModeForPointer('mouse'), 'mouse');
  assert.equal(inputModeForPointer('pen'), 'mouse');
});

test('XR summary is explicit about secure context and route capability', () => {
  assert.match(xrSummary({secureContext: false}), /HTTPS/);
  assert.match(xrSummary({secureContext: true, api: false}), /WebXR/);
  assert.match(xrSummary({secureContext: true, api: true, ar: true, vr: false}), /AR READY/);
  assert.match(xrSummary({secureContext: true, api: true, ar: false, vr: true}), /VR READY/);
});

test('XR capability probe does not request a session or permission', async () => {
  const calls = [];
  const xr = {isSessionSupported: async mode => { calls.push(mode); return mode === 'immersive-ar'; }};
  const result = await probeXrCapabilities({secureContext: true, xr});
  assert.deepEqual(result, {secureContext: true, api: true, ar: true, vr: false});
  assert.deepEqual(calls.sort(), ['immersive-ar', 'immersive-vr']);
});

test('workshop and Studio routes load the application-owned overlay without replacing the field', async () => {
  const [workshop, studio, original, bridge, css, bootstrap, remoteBootstrap, localMount, remoteMount] = await Promise.all([
    fs.readFile(path.join(webRoot, 'index.html'), 'utf8'),
    fs.readFile(path.join(webRoot, 'studio.html'), 'utf8'),
    fs.readFile(path.join(webRoot, 'studio-original.html'), 'utf8'),
    fs.readFile(path.join(webRoot, 'studio-bridge.js'), 'utf8'),
    fs.readFile(path.join(webRoot, 'vivo-ui-overlay.css'), 'utf8'),
    fs.readFile(path.join(webRoot, 'application/bootstrap.mjs'), 'utf8'),
    fs.readFile(path.join(webRoot, 'application/remote-bootstrap.mjs'), 'utf8'),
    fs.readFile(path.resolve(webRoot, '../server/local_application.py'), 'utf8'),
    fs.readFile(path.resolve(webRoot, '../server/remote_application.py'), 'utf8')
  ]);
  assert.match(workshop, /shared\.css/);
  assert.doesNotMatch(bridge, /vivo-ui-overlay/);
  assert.match(studio, /studio-bridge\.js/);
  assert.match(original, /Field Lab 0\.4/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /overflow-x|calc\(100vw/);
  assert.match(bootstrap, /installWorkshopOverlay/);
  assert.match(remoteBootstrap, /installWorkshopOverlay/);
  assert.match(localMount, /installStudioOverlay/);
  assert.match(remoteMount, /vivo-ui-overlay/);
});
