import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const root = new URL('../../', import.meta.url);

test('the Android Companion extends the canonical GitHub Pages UI at runtime', async () => {
  const [html, activity, bootstrap, tools, control, bridge] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('../android-companion/app/src/main/java/com/matumbo/vivo/MainActivity.kt', root), 'utf8'),
    readFile(new URL('phone/bootstrap.mjs', root), 'utf8'),
    readFile(new URL('phone/agent-tools.mjs', root), 'utf8'),
    readFile(new URL('phone/agent-control.mjs', root), 'utf8'),
    readFile(new URL('phone/bridge.mjs', root), 'utf8'),
  ]);
  assert.match(html, /SHARED WORKSHOP/);
  assert.match(html, /src="shared\.js"/);
  assert.doesNotMatch(html, /phone\/bootstrap\.mjs|phone\/manifest\.webmanifest/);
  assert.match(activity, /onPageFinished/);
  assert.match(activity, /import\(new URL\('phone\/bootstrap\.mjs',\s*location\.href\)\.href\)/);
  assert.match(activity, /setCustomTitle\(capabilityDialogHeader\(\)\)/);
  const capabilityDialog = activity.slice(activity.indexOf('private fun capabilityDialogHeader'), activity.indexOf('private fun manageAccessibility'));
  assert.match(capabilityDialog, /setMultiChoiceItems/);
  assert.doesNotMatch(capabilityDialog, /\.setMessage\(/);
  assert.match(capabilityDialog, /Only checked capabilities are exposed as native tools/);
  assert.match(activity, /phone\.torch\.set/);
  assert.match(tools, /phone\.torch\.set/);
  assert.match(control, /vivo\.phone\.agent-control\/1/);
  assert.match(control, /AGENT_GENERATION_STALE/);
  assert.match(control, /AGENT_CAS_STALE/);
  assert.match(bootstrap, /LocalAgentController/);
  assert.match(bootstrap, /phoneRegisterAgent/);
  assert.match(bootstrap, /agentController\.setFabric/);
  assert.match(bootstrap, /window\.VivaPhoneAgentAdmin/);
  assert.match(bootstrap, /role separation within the documented/);
  assert.match(bootstrap, /maxlength=\"154\"/);
  const agentSurface = bootstrap.slice(bootstrap.indexOf('window.VivaAgentTools ='), bootstrap.indexOf('window.VivaPhoneAgentAdmin ='));
  assert.doesNotMatch(agentSurface, /register:|reenable:/);
  assert.match(tools, /Registered local agent session required/);
  assert.match(bridge, /agentController\.invokeTool/);
  assert.doesNotMatch(bridge, /api\.translate/);
  assert.match(bootstrap, /navigator\.serviceWorker\.ready/);
  assert.match(bootstrap, /caches\.open\('vivo-phone-shell-2026-10-12-v5'\)/);
  assert.match(bootstrap, /two-hand-camera\.mjs/);
  assert.match(bootstrap, /camera-start-status\.mjs/);
  assert.match(bootstrap, /phoneStartHands.*startCameraFromButton/);
  assert.match(bootstrap, /phoneStartBackHands.*startCameraFromButton/);
  assert.match(bootstrap, /persistence-status\.mjs/);
  assert.match(bootstrap, /reportPersistenceStatus\('release'/);
  assert.match(bootstrap, /reportPersistenceStatus\('save'/);
  assert.match(bootstrap, /PhoneAuthorityAdapter/);
  assert.match(bootstrap, /phoneAuthorityConnect/);
  assert.match(bootstrap, /phoneAuthorityPublish/);
  assert.match(bootstrap, /phoneAuthorityCommit/);
  assert.match(bootstrap, /const result = await authority\.connect\(\{ seat: \$\('phoneAuthoritySeat'\)\.value \}\)/);
  assert.match(bootstrap, /result\?\.status === 'rejected'/);
  assert.match(bootstrap, /const result = await authority\.read\(\)/);
  assert.match(bootstrap, /result\?\.status === 'rejected'/);
});

test('phone authority adapter is cached for offline local startup and keeps shared contracts lazy', async () => {
  const [adapter, mapping, sw] = await Promise.all([
    readFile(new URL('phone/authority-adapter.mjs', root), 'utf8'),
    readFile(new URL('phone/authority-mapping.mjs', root), 'utf8'),
    readFile(new URL('vivo-sw.js', root), 'utf8'),
  ]);
  assert.match(mapping, /studio\.node\.echo/);
  assert.match(mapping, /studio\.node\.workpiece/);
  assert.match(mapping, /studio\.node\.portal/);
  assert.match(adapter, /PHONE_OFFLINE_BRANCH_NO_SEND/);
  assert.match(adapter, /studioCommitCommand/);
  assert.match(adapter, /studioTransformCommand/);
  assert.match(adapter, /loadStudioCommands/);
  assert.match(sw, /phone\/authority-adapter\.mjs/);
  assert.match(sw, /phone\/agent-control\.mjs/);
  assert.match(sw, /phone\/authority-mapping\.mjs/);
  assert.doesNotMatch(adapter, /new LocalTransport\(options\)/);
});

test('field Apply completion preserves a newer preview generation', async () => {
  const bootstrap = await readFile(new URL('phone/bootstrap.mjs', root), 'utf8');
  const start = bootstrap.indexOf("$('phoneFieldApply').onclick");
  const end = bootstrap.indexOf("$('phoneFieldDiscard').onclick", start);
  assert.ok(start >= 0 && end > start, 'field action handlers must remain present');
  const applyHandler = bootstrap.slice(start, end);
  assert.match(applyHandler, /const candidate = fieldWorld\?\.commitCandidate\(\), completedGeneration = candidate\?\.generation \?\? null/);
  assert.match(applyHandler, /finally \{ updateFieldActionButtons\(completedGeneration\); \}/);
  assert.doesNotMatch(applyHandler, /phoneFieldApply.*disabled = true/);
  assert.doesNotMatch(applyHandler, /phoneFieldDiscard.*disabled = true/);
  assert.match(bootstrap, /preview && completedGeneration !== null && preview\.generation !== completedGeneration/);
});

test('field touch handlers keep source filtering and selective contact release at the UI boundary', async () => {
  const bootstrap = await readFile(new URL('phone/bootstrap.mjs', root), 'utf8');
  assert.match(bootstrap, /interactionFabric\?\.preview\(objectId, dimension, \{ sourceKinds: \['touch'\] \}\)/);
  assert.match(bootstrap, /function releaseObjectTouchContact\(record, reason\)/);
  assert.match(bootstrap, /releaseObjectTouchContact\(record, reason\)/);
  assert.match(bootstrap, /interactionFabric\?\.rebase\(contactId, appliedPoint\)/);
});

test('queued hand edits fence future commands across contact stop, camera stop and branch fork', async () => {
  const bootstrap = await readFile(new URL('phone/bootstrap.mjs', root), 'utf8');
  assert.match(bootstrap, /new LocalEditQueue\(\)/);
  assert.match(bootstrap, /contact\.editQueue\.enqueue/);
  assert.match(bootstrap, /fenceHandEdits\('offline-fork'\)/);
  assert.match(bootstrap, /fenceHandEdits\('camera-stop'\)/);
  assert.match(bootstrap, /branchId: contact\.branchId/);
  assert.match(bootstrap, /if \(handContacts\.get\(contactId\) === contact\)/);
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
  assert.match(sw, /phone\/persistence-status\.mjs/);
  assert.match(sw, /phone\/camera-start-status\.mjs/);
  assert.match(sw, /request\.mode === 'navigate'/);
  assert.match(sw, /scope\.pathname/);
  assert.match(sw, /shell\.match\(scoped\('index\.html'\)\)/);
  assert.match(sw, /SHELL_CACHE.*v7/);
  for (const asset of ['phone/material-contract.mjs', 'phone/material-patch.mjs', 'phone/material-input-runtime.mjs', 'phone/fingertip-input.mjs', 'phone/companion.mjs']) assert.match(sw, new RegExp(asset.replaceAll('.', '\\.')));
  assert.doesNotMatch(worker, /\bfetch\s*\(|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(camera, /\bfetch\s*\(|XMLHttpRequest|WebSocket/);
});

