import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inputCopy, inputModeForCameraState, inputModeForPointer, probeXrCapabilities, xrSummary} from '../../web/vivo-ui-overlay.mjs';

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

test('camera guidance distinguishes an open panel, video-only preview, hand tracking, and stop', () => {
  assert.equal(inputModeForCameraState({cameraLive: false, state: 'SECURE PAGE · Start a camera mode'}), 'touch');
  assert.equal(inputModeForCameraState({cameraLive: true, state: 'VIDEO LIVE · Back camera. Start hands to control it.'}), 'touch');
  assert.equal(inputModeForCameraState({cameraLive: true, state: '3 / 3 · Hand model ready. Show your whole hand.'}), 'hand');
  assert.equal(inputModeForCameraState({cameraLive: true, state: 'Tracking off. Camera video remains on.'}), 'touch');
  assert.equal(inputModeForCameraState({cameraLive: true, state: 'Hand tracking stopped: worker unavailable · camera and touch only'}), 'touch');
  assert.equal(inputModeForCameraState({cameraLive: false, state: 'OFF · Camera released. Nothing recorded.'}), 'touch');
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
  const [workshop, studio, original, bridge, css, overlay, bootstrap, remoteBootstrap, localMount, remoteMount] = await Promise.all([
    fs.readFile(path.join(webRoot, 'index.html'), 'utf8'),
    fs.readFile(path.join(webRoot, 'studio.html'), 'utf8'),
    fs.readFile(path.join(webRoot, 'studio-original.html'), 'utf8'),
    fs.readFile(path.join(webRoot, 'studio-bridge.js'), 'utf8'),
    fs.readFile(path.join(webRoot, 'vivo-ui-overlay.css'), 'utf8'),
    fs.readFile(path.join(webRoot, 'vivo-ui-overlay.mjs'), 'utf8'),
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
  assert.match(remoteMount, /source_name = name if name\.startswith\("vivo-ui-overlay\."\)/);
  assert.match(remoteMount, /asset\(request, n\)/);
  assert.match(overlay, /role="group" aria-label="Choose an input guide"/);
  assert.doesNotMatch(overlay, /role="tablist"|role="tab"|aria-selected/);
  assert.doesNotMatch(overlay, /event\.key === 'Tab'|event\.key\.startsWith\('Arrow'\)/);
});
