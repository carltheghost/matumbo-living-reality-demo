import { PhoneEngineClient } from './client.mjs';
import { projectForRenderer, detectPhoneCapabilities } from './engine.mjs';
import { AndroidPhoneBridge } from './bridge.mjs';
import { AgentToolRegistry } from './agent-tools.mjs';
import { HandsFreeProjection } from './projection.mjs';
import { PhoneTwoHandCamera } from './two-hand-camera.mjs';
import { formatPersistenceStatus } from './persistence-status.mjs';
import { startCameraFromButton } from './camera-start-status.mjs';

const $ = id => document.getElementById(id);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const browserCapabilities = await detectPhoneCapabilities();
const bridge = new AndroidPhoneBridge(window);
const registry = new AgentToolRegistry({ bridge });
const shared = window.VivaShared;
if (!shared?.R || !shared?.S || !shared?.camera) throw new Error('Viva phone integration loaded before the shared renderer.');
const { R, S, camera } = shared;
let engine = null, localMode = false, selectedId = null, activeAxis = 0, heldHand = null;
let pointer = null, pinch = null, projection = null;
let persistTimer = null, lastTwoHand = null, latestCapabilities = null, lastPoseAction = -Infinity;
const lastPoseByHand = new Map();
let appliedEyeId = null, appliedEyeRevision = -1;

const button = (id, label, className = 'secondary') => Object.assign(document.createElement('button'), { id, textContent: label, className });
const status = text => { const el = $('phoneStatus') || $('status'); if (el) el.textContent = text; };
const onlineUrl = new URL(location.href).origin === 'null' ? '' : location.href;
const canUseLocalStorage = (() => { try { return !!window.localStorage; } catch { return false; } })();
function getWorldId() {
  try {
    let id = localStorage.getItem('vivo.phone.worldId');
    if (!id) { id = `vivo.phone.${crypto.randomUUID()}`; localStorage.setItem('vivo.phone.worldId', id); }
    return id;
  } catch { return `vivo.phone.${Date.now()}`; }
}
function hostToolCaps(value) {
  const tools = value?.tools || bridge.tools || [];
  const capabilities = new Set(value?.capabilities || tools.map(tool => tool.capability).filter(Boolean));
  const activeLocal = engine && localMode ? localGrants() : [];
  registry.setLocalCapabilities(activeLocal);
  registry.updateGrants([...new Set([...capabilities, ...activeLocal])]);
  return tools;
}
function localGrants() {
  if (!canUseLocalStorage) return [];
  try { return JSON.parse(localStorage.getItem('vivo.phone.local-agent-grants') || '[]'); } catch { return []; }
}
function updateLocalGrants() {
  const names = [...document.querySelectorAll('[data-local-cap]:checked')].map(node => node.dataset.localCap);
  const activeLocal = engine && localMode ? names : [];
  registry.setLocalCapabilities(activeLocal);
  registry.updateGrants([...new Set([...bridge.tools.map(tool => tool.capability).filter(Boolean), ...activeLocal])]);
  try { localStorage.setItem('vivo.phone.local-agent-grants', JSON.stringify(names)); } catch {}
  updateAgentList();
}
function updateAgentList(nativeTools = bridge.tools) {
  const list = [...new Set([
    ...registry.list().map(tool => tool.name),
    ...(nativeTools || []).filter(tool => tool.capability && registry.grants.has(tool.capability)).map(tool => tool.name),
  ])];
  const view = $('phoneAgentTools');
  if (view) view.textContent = list.length ? list.join('\n') : 'No agent tools granted. Check only the specific capabilities you want an agent to use.';
}
function renderEye(envelope) {
  const projected = projectForRenderer({ snapshot: () => envelope });
  const state = projected.state;
  S.state = state; S.live = state; R.state = state; R.grid = projected.grid; R.actor = projected.eye.id;
  if (appliedEyeId !== projected.eye.id || appliedEyeRevision !== projected.eye.revision) {
    const cameraView = projected.eye.projection || {};
    R.distance = clamp(Number(cameraView.scale) || 10.5, 4, 22);
    R.yaw = Number.isFinite(Number(cameraView.rotation)) ? Number(cameraView.rotation) : 0.55;
    R.pitch = clamp(Number.isFinite(Number(cameraView.tilt)) ? Number(cameraView.tilt) : 0.68, -1.35, 1.35);
    R.overview = cameraView.mode === 'overview';
    appliedEyeId = projected.eye.id; appliedEyeRevision = projected.eye.revision;
  }
  R.slice = Array(state.geometry.dimension).fill(0);
  for (let i = 3; i < projected.eye.q.length; i++) R.slice[i] = Number(projected.eye.slice?.[`x${i + 1}`] || 0);
  if (!state.entities[R.selected]) R.selected = Object.keys(state.entities)[0] || null;
  if (selectedId && state.entities[selectedId]) R.selected = selectedId;
  updateEyeControls(envelope);
  const axis = $('phoneAxis'); if (axis) { axis.replaceChildren(); for (let i = 0; i < state.geometry.dimension; i++) { const option = document.createElement('option'); option.value = String(i); option.textContent = `x${i + 1}${i > 2 ? ' · extra axis' : ''}`; axis.append(option); } axis.value = String(Math.min(activeAxis, state.geometry.dimension - 1)); }
  const eyeInfo = $('phoneEyeInfo'); if (eyeInfo) eyeInfo.textContent = `${projected.eye.label} · ${projected.eye.spaceId} · ${state.geometry.dimension} spatial axes + separate time · world ${envelope.snapshot.worldId}`;
}
function updateEyeControls(envelope) {
  const select = $('phoneEyeSelect'); if (!select) return;
  const prior = select.value;
  select.replaceChildren();
  for (const eye of Object.values(envelope.eyes)) { const option = document.createElement('option'); option.value = eye.id; option.textContent = `${eye.label} · ${eye.spaceId}`; select.append(option); }
  select.value = envelope.currentEyeId || prior;
  const nested = envelope.eyes[envelope.currentEyeId]?.returnStack?.length || 0;
  $('phoneExitNested').disabled = nested === 0;
  $('phoneEnterNested').disabled = !S.state?.entities[R.selected]?.innerSpaceId;
}
async function refreshSnapshot() { if (!engine) return null; const envelope = await engine.snapshot(); if (localMode) renderEye(envelope); return envelope; }
async function reportPersistenceStatus(action, operation = engine?.lastPersistence) {
  let result = null;
  try { if (operation) result = await operation; } catch {}
  const current = await refreshSnapshot();
  status(formatPersistenceStatus(action, current?.persistence, result));
  return current?.persistence || null;
}
function updateProjectionState(projectionPatch) {
  if (!engine) return;
  const write = async () => {
    const current = await engine.snapshot(), eye = current.eyes[current.currentEyeId];
    eye.projection = { ...eye.projection, ...projectionPatch, scale: R.distance, rotation: R.yaw, tilt: R.pitch };
    await engine.setEye({ projection: eye.projection });
  };
  clearTimeout(persistTimer); persistTimer = setTimeout(() => write().catch(error => status(`Local Eye changed but was not saved: ${error.message}. Retry remains available.`)), 350);
}
function materialAxisGesture(dx, dy) {
  const scale = 2.8 / Math.max(320, Math.min(innerWidth, innerHeight));
  const dimension = S.state?.geometry.dimension || 4;
  const primaryAxis = Math.min(activeAxis, dimension - 1);
  if (primaryAxis === 0) return dx * scale;
  if (primaryAxis === 1) return -dy * scale;
  return (Math.abs(dx) > Math.abs(dy) ? dx : -dy) * scale;
}
function handleHandGesture(event) {
  if (!localMode) return;
  if (event.type === 'lost') { heldHand = null; R.pointer = null; lastPoseByHand.clear(); return; }
  if (event.type === 'frame') { const active = new Set(event.hands.map(hand => hand.id)); for (const id of lastPoseByHand.keys()) if (!active.has(id)) lastPoseByHand.delete(id); return; }
  if (event.type === 'aim') { R.pointer = event.point; return; }
  if (event.type === 'pose') {
    const priorPose = lastPoseByHand.get(event.handId); lastPoseByHand.set(event.handId, event.pose);
    if (priorPose === event.pose) return;
    const now = performance.now(); if (now - lastPoseAction < 650) return;
    if (event.pose === 'point') {
      const hit = R.at(...event.point); if (hit) { selectedId = hit; R.selected = hit; status(`POINT · selected ${S.state.entities[hit]?.name || hit}`); lastPoseAction = now; }
    } else if (event.pose === 'peace') { R.overview = !R.overview; updateProjectionState({ mode: R.overview ? 'overview' : 'slice' }); status(`PEACE · ${R.overview ? 'overview' : 'current slice'}`); lastPoseAction = now; }
    else if (event.pose === 'thumbs-up') { activeAxis = (activeAxis + 1) % (S.state?.geometry.dimension || 4); const axis = $('phoneAxis'); if (axis) axis.value = String(activeAxis); status(`THUMBS-UP · move axis x${activeAxis + 1}`); lastPoseAction = now; }
    return;
  }
  if (event.type === 'grab') {
    const hit = R.at(...event.point); if (hit && !heldHand) { heldHand = { id: event.handId, entityId: hit, point: event.point }; selectedId = hit; R.selected = hit; status(`HAND GRAB · ${hit}`); }
    return;
  }
  if (event.type === 'move' && heldHand?.id === event.handId) {
    const prior = heldHand.point, dx = event.point[0] - prior[0], dy = event.point[1] - prior[1];
    heldHand.point = event.point;
    const dimension = S.state?.geometry.dimension || 4;
    if (activeAxis < dimension) engine.translate(heldHand.entityId, activeAxis, materialAxisGesture(dx, dy)).catch(error => status(error.message));
    return;
  }
  if (event.type === 'release' && heldHand?.id === event.handId) {
    const pending = engine?.lastPersistence;
    heldHand = null;
    reportPersistenceStatus('release', pending).catch(error => status(`Hand released · local persistence status unavailable: ${error.message}. Retry remains available.`));
    return;
  }
  if (event.type === 'twohand') {
    if (event.scale > 0.01 && Number.isFinite(event.scale)) R.distance = clamp(R.distance / event.scale, 4, 22);
    R.yaw = (R.yaw - event.rotation + Math.PI * 4) % (Math.PI * 2);
    updateProjectionState({ mode: R.overview ? 'overview' : 'slice', scale: R.distance, rotation: R.yaw });
    if (lastTwoHand) lastTwoHand = event;
    return;
  }
  if (event.type === 'swipe' && !heldHand && S.state) {
    const ids = Object.keys(S.state.entities), i = ids.indexOf(R.selected), step = event.dx < 0 ? 1 : -1;
    selectedId = ids[(i + step + ids.length) % ids.length]; R.selected = selectedId;
    status(`SWIPE · selected ${S.state.entities[selectedId]?.name || selectedId}`);
  }
}
const sharedCameraGesture = camera.onGesture.bind(camera);
function handleSharedHandGesture(event) {
  if (event.type === 'frame') return;
  if (event.type === 'twohand') {
    if (event.scale > 0.01 && Number.isFinite(event.scale)) R.distance = clamp(R.distance / event.scale, 4, 22);
    R.yaw = (R.yaw - event.rotation + Math.PI * 4) % (Math.PI * 2);
    return;
  }
  if (event.type === 'pose' && event.pose === 'point' && !$('panel')?.open && !S.replay) {
    const hit = R.at(...event.point); if (hit) shared.select?.(hit);
    return;
  }
  if (event.type === 'swipe' && !$('panel')?.open && S.state) {
    const ids = Object.keys(S.state.entities), index = ids.indexOf(S.selected), direction = event.dx < 0 ? 1 : -1;
    const target = ids[(index + direction + ids.length) % ids.length];
    if (target) shared.select?.(target);
    return;
  }
  if (event.type === 'grab') camera.held = true;
  sharedCameraGesture(event);
  if (event.type === 'release' || event.type === 'lost') camera.held = false;
}
const phoneVideo = Object.assign(document.createElement('video'), { id: 'phoneCameraVideo', muted: true, playsInline: true });
Object.assign(phoneVideo.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', objectFit: 'cover', display: 'none', zIndex: '0', filter: 'brightness(.68) saturate(.7)' });
const handOverlay = Object.assign(document.createElement('canvas'), { id: 'phoneHandOverlay', ariaHidden: 'true' });
const worldCanvas = $('world'), baseOverlay = $('overlay');
if (worldCanvas) worldCanvas.style.zIndex = '1';
if (baseOverlay) baseOverlay.style.zIndex = '3';
document.body.append(phoneVideo, handOverlay);
const phoneCamera = new PhoneTwoHandCamera({
  video: phoneVideo, overlay: handOverlay, renderer: R,
  onState: message => { const view = $('cameraState'); if (view) view.textContent = message; },
  onGesture: event => { if (localMode) handleHandGesture(event); else handleSharedHandGesture(event); },
  onHands: hands => { const view = $('cameraState'); if (hands.length && view) view.textContent = 'Tracking ' + hands.length + ' hand(s) · 21 landmarks · all five fingers · local only.'; },
});
projection = new HandsFreeProjection({ bridge, camera: phoneCamera });
async function startPhoneCamera(facing = 'user') {
  if (camera.video) camera.video.style.display = 'none';
  try { return await phoneCamera.start(facing); }
  catch (error) { if (camera.video) camera.video.style.display = ''; throw error; }
}
function stopPhoneCamera() {
  projection?.stop(); phoneCamera.stop();
  if (camera.video) camera.video.style.display = '';
}
const localCameraActions = {
  frontCamera: () => startPhoneCamera('user'),
  backCamera: () => startPhoneCamera('environment'),
  previewCamera: () => startPhoneCamera(phoneCamera.facing || 'user'),
  stopCamera: stopPhoneCamera,
};
for (const [id, action] of Object.entries(localCameraActions)) $(id)?.addEventListener('click', event => {
  if (!localMode) return;
  event.preventDefault(); event.stopImmediatePropagation();
  if (id !== 'stopCamera') $('panel')?.close();
  Promise.resolve(action()).catch(error => status(error.message));
}, true);

function addPhoneSurface() {
  const enter = button('enterPhoneLocal', 'Enter local Vivo · works offline', 'primary');
  enter.setAttribute('aria-describedby', 'phoneLocalNote');
  const note = Object.assign(document.createElement('p'), { id: 'phoneLocalNote', className: 'muted', textContent: 'Phone engine runs locally. Objects keep stable IDs; each Eye and projection stays independent. Camera stays off until you start it.' });
  $('createRoom')?.before(enter, note);
  enter.onclick = () => startLocal().catch(error => status(error.message));
  const nav = button('phonePanelButton', '📱 Phone', 'secondary');
  nav.type = 'button'; nav.onclick = openPhonePanel; $('toolbar')?.append(nav);
  const sheet = document.createElement('div'); sheet.className = 'sheet'; sheet.dataset.sheet = 'phone'; sheet.innerHTML = `
    <h3>Viva Phone Engine</h3><p id="phoneEngineState" class="muted">Local engine closed. World state and Eyes are stored on this device.</p>
    <p id="phoneEyeInfo" class="muted"></p>
    <label>Active Eye<select id="phoneEyeSelect"></select></label><div class="row"><button id="phoneNewEye">Create independent Eye</button><button id="phonePersist">Save now</button></div>
    <label>Active material axis<select id="phoneAxis"></select></label><div class="row"><button id="phoneAxisMinus">− Move selected</button><button id="phoneAxisPlus">+ Move selected</button></div>
    <div class="row"><button id="phoneEnterNested">Enter selected inner world</button><button id="phoneExitNested">Return with this Eye</button></div>
    <div class="row"><button id="phoneFork">Create explicit offline branch</button><button id="phoneExport">Export world + Eyes</button></div>
    <hr><h3>Hands-free input & projection</h3><p class="muted">Up to two hands · all 21 landmarks and all five articulated fingers · local inference. Open, point, peace, thumbs-up, fist and pinch poses; two hands zoom and rotate; touch drag/pinch also work. Camera frames stay on this phone.</p>
    <div class="row"><button id="phoneStartHands">Start front camera + hands</button><button id="phoneStartBackHands">Start rear camera + hands</button></div>
    <div class="row"><button id="phoneStopHands">Stop camera and release it</button></div>
    <div class="row"><button id="phoneProject">Project / cast view</button><button id="phoneStopProject">Stop projection mode</button></div>
    <p id="phoneProjectionState" class="muted">Projection is controlled separately from input. OS support decides whether a route is available.</p>
    <div class="row"><button id="phoneInstallOffline">Install offline shell</button><button id="phoneCacheHands">Cache hand model (large)</button></div>
    <p id="phoneCapabilityState" class="muted"></p>
    <hr><h3>Agent tool grants</h3><p class="muted">An agent only receives the capabilities you check here or explicitly grant in the Android Companion.</p>
    <label class="check"><input type="checkbox" data-local-cap="world.read">Allow local agent to read this world</label>
    <label class="check"><input type="checkbox" data-local-cap="world.edit">Allow local agent to move objects</label>
    <label class="check"><input type="checkbox" data-local-cap="world.eye">Allow local agent to change this Eye</label>
    <button id="phoneRefreshTools">Refresh Android Companion grants</button><pre id="phoneAgentTools" class="muted" aria-live="polite"></pre>
    <p class="muted">Native camera permission, accessibility, notifications, files and projection are controlled in the Companion. Accessibility actions remain user-revocable; passwords are never returned or logged.</p>`;
  $('panel')?.append(sheet);
  document.querySelectorAll('[data-local-cap]').forEach(input => { input.checked = localGrants().includes(input.dataset.localCap); input.addEventListener('change', updateLocalGrants); });
  $('phoneEyeSelect').onchange = () => engine?.selectEye($('phoneEyeSelect').value).catch(error => status(error.message));
  $('phoneNewEye').onclick = async () => { await engine.createEye(`Eye ${Object.keys((await engine.snapshot()).eyes).length + 1}`); await refreshSnapshot(); };
  $('phonePersist').onclick = async () => {
    try { await reportPersistenceStatus('save', engine.persist()); }
    catch (error) { status(`Local Vivo state could not be saved: ${error.message}. Retry remains available.`); }
  };
  $('phoneAxis').onchange = () => { activeAxis = Number($('phoneAxis').value); };
  for (const [id, direction] of [['phoneAxisMinus', -1], ['phoneAxisPlus', 1]]) $(id).onclick = async () => {
    const id = R.selected, axis = Number($('phoneAxis').value); if (!id) return;
    await engine.translate(id, axis, direction * 0.14); await engine.step(1 / 30); status(`Moved ${id} along x${axis + 1}.`);
  };
  $('phoneEnterNested').onclick = async () => { if (R.selected) await engine.enterNested(R.selected); await refreshSnapshot(); };
  $('phoneExitNested').onclick = async () => { await engine.exitNested(); await refreshSnapshot(); };
  $('phoneFork').onclick = async () => {
    try {
      await engine.forkOffline('Phone offline branch'); const current = await refreshSnapshot();
      const durable = current?.persistence?.state === 'saved';
      status(`Offline branch ${current.branchId.slice(0, 10)} ${durable ? 'created and saved' : 'created in memory only'}. No automatic merge.`);
    } catch (error) { await refreshSnapshot().catch(() => {}); status(`Offline branch remains in memory but was not saved: ${error.message}. Retry remains available.`); }
  };
  $('phoneExport').onclick = async () => {
    const envelope = await engine.snapshot(), blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${envelope.snapshot.worldId}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  };
  $('phoneStartHands').onclick = () => startCameraFromButton({ facing: 'user', start: startPhoneCamera, status, activeMessage: 'Two-hand tracking active · local worker · camera frames stay on this phone.' });
  $('phoneStartBackHands').onclick = () => startCameraFromButton({ facing: 'environment', start: startPhoneCamera, status, activeMessage: 'Rear camera · two-hand tracking active locally.' });
  $('phoneStopHands').onclick = () => { stopPhoneCamera(); status('Camera stopped. Touch controls remain available.'); };
  $('phoneProject').onclick = async () => { try { const result = await projection.start(); $('phoneProjectionState').textContent = `Projection route: ${result.route} · camera track ${result.cameraTrack}. OS/browser may pause camera when the page is backgrounded.`; } catch (error) { $('phoneProjectionState').textContent = `${error.message} The camera remains local; touch still works.`; } };
  $('phoneStopProject').onclick = () => { projection.stop(); $('phoneProjectionState').textContent = 'Projection mode stopped; camera can continue until you stop it.'; };
  $('phoneInstallOffline').onclick = installOffline;
  $('phoneCacheHands').onclick = cacheHandAssets;
  $('phoneRefreshTools').onclick = refreshNativeTools;
  projection.addEventListener('change', event => { $('phoneProjectionState').textContent = `Projection ${event.detail.type} · ${event.detail.route} · camera ${event.detail.cameraTrack} · frames uploaded: no`; });
  bridge.addEventListener('ready', refreshNativeTools);
  bridge.addEventListener('message', event => {
    if (event.detail.kind === 'tools') { const tools = hostToolCaps(event.detail); updateAgentList(tools); }
    if (event.detail.kind === 'event' && event.detail.name === 'orientation') window.dispatchEvent(new CustomEvent('vivo:orientation', { detail: event.detail.value }));
    if (event.detail.kind === 'agent-action') {
      const { id, name, args = {} } = event.detail;
      Promise.resolve(name === 'phone.camera.start' ? startPhoneCamera(args.facing === 'environment' ? 'environment' : 'user')
        : name === 'phone.camera.stop' ? stopPhoneCamera()
        : Promise.reject(new Error('Unsupported page-side action')))
        .then(value => value === false ? bridge.reply(id, false, 'Camera did not start') : bridge.reply(id, true, { started: true, framesUploaded: false }))
        .catch(error => bridge.reply(id, false, error));
    }
  });
  updateLocalGrants();
}
function openPhonePanel() {
  if (!engine) { status('Enter the local Vivo engine first.'); return; }
  document.querySelectorAll('[data-sheet]').forEach(node => node.classList.toggle('active', node.dataset.sheet === 'phone'));
  $('panelTitle').textContent = 'Phone engine & capabilities'; $('panel').showModal();
  refreshSnapshot().catch(error => status(error.message));
}
async function startLocal() {
  if (engine) { localMode = true; updateLocalGrants(); document.body.classList.add('phone-local'); const state = await engine.snapshot(); renderEye(state); openPhonePanel(); return; }
  status('Starting the local worker and opening this phone’s saved Vivo world…');
  engine = new PhoneEngineClient();
  engine.addEventListener('statechange', event => {
    if (event.detail?.state && localMode) renderEye(event.detail.state);
    if (event.detail?.reason === 'step-error') status(event.detail.error || 'Local material step stopped safely.');
    if (event.detail?.reason === 'persistence-failed') status(`Local Vivo state changed but was not saved: ${event.detail.state?.persistence?.error || 'storage failed'}. Retry remains available.`);
  });
  const rootDimension = Number($('createD')?.value) || 4;
  const state = await engine.open(getWorldId(), rootDimension);
  localMode = true; updateLocalGrants(); document.body.classList.add('phone-local'); renderEye(state);
  $('welcome').hidden = true; $('toolbar').hidden = false;
  const caps = await detectPhoneCapabilities(); latestCapabilities = caps;
  $('phoneEngineState').textContent = `Worker ready · ${caps.webgpu ? 'WebGPU available' : caps.webgl2 ? 'WebGL2 renderer' : 'Canvas renderer'} · ${caps.wasm ? 'WASM-ready' : 'JS fallback'} · sparse ${state.snapshot.spaces.root.dimension}D root / ${state.snapshot.spaces.inner.dimension}D nested · IndexedDB ${caps.indexedDb ? 'available' : 'unavailable'}.`;
  $('phoneCapabilityState').textContent = `Browser capabilities: ${Object.entries(caps).filter(([, value]) => value === true).map(([name]) => name).join(' · ') || 'touch only'}. Graphics capability is detected independently from the sparse worker solver.`;
  if (bridge.available) await refreshNativeTools().catch(() => {});
  status('LOCAL VIVO · same persistent objects · independent Eye · no server required.');
  openPhonePanel();
}
async function refreshNativeTools() {
  if (!bridge.available) { $('phoneCapabilityState').textContent = 'Android Companion not connected. Browser engine, storage, camera and touch remain available.'; updateAgentList(); return; }
  try {
    const result = await bridge.listTools(); const tools = hostToolCaps(result); updateAgentList(tools);
    $('phoneCapabilityState').textContent = `Android Companion connected · ${tools.length} granted native tools. Capability status is OS-checked; frames are never in the bridge.`;
  } catch (error) { $('phoneCapabilityState').textContent = `Android Companion bridge unavailable: ${error.message}`; }
}
async function installOffline() {
  try {
    if (!('serviceWorker' in navigator)) throw new Error('This browser does not support service workers.');
    await navigator.serviceWorker.register(new URL('../vivo-sw.js', import.meta.url), { scope: new URL('../', import.meta.url).pathname });
    const ready = await navigator.serviceWorker.ready;
    if (!ready.active) throw new Error('Offline shell service worker did not become active.');
    const shell = await (await caches.open('vivo-phone-shell-2026-10-11-v2')).match(new URL('../index.html', import.meta.url));
    if (!shell) throw new Error('Offline shell cache did not finish installing.');
    const persisted = await navigator.storage?.persist?.().catch(() => false);
    $('phoneEngineState').textContent = `Offline shell ready · service worker active · persistent storage ${persisted ? 'granted' : 'not granted by browser'}.`;
    status('Offline app shell cached. The large hand model is optional and cached separately.');
  } catch (error) { status(`Offline install unavailable: ${error.message}`); }
}
async function cacheHandAssets() {
  try {
    if (!('caches' in window)) throw new Error('This browser has no Cache Storage.');
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota && estimate.usage / estimate.quota > 0.9) throw new Error('Phone storage is nearly full; clear space before caching the hand model.');
    const cache = await caches.open('vivo-hand-tracker-2026-10');
    const base = new URL('../', import.meta.url);
    const assets = ['vendor/field-lab/vision_bundle.mjs', 'vendor/field-lab/wasm/vision_wasm_internal.js', 'vendor/field-lab/wasm/vision_wasm_internal.wasm', 'vendor/field-lab/hand_landmarker.task'];
    for (const asset of assets) { const url = new URL(asset, base); const response = await fetch(url); if (!response.ok) throw new Error(`Could not fetch ${asset}`); await cache.put(url, response); }
    status('Hand model assets cached on this phone. No video or camera frames were cached.');
  } catch (error) { status(`Hand-model cache failed: ${error.message}`); }
}

// Local mode captures touch before the shared-network handlers; otherwise they are unchanged.
const canvas = $('world'), pointers = new Map();
canvas.addEventListener('pointerdown', event => {
  if (!localMode) return;
  event.preventDefault(); event.stopImmediatePropagation(); canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, [event.clientX, event.clientY]);
  if (pointers.size > 1) {
    pointer = null; const entries = [...pointers.values()], dx = entries[1][0] - entries[0][0], dy = entries[1][1] - entries[0][1];
    pinch = { span: Math.max(1, Math.hypot(dx, dy)), angle: Math.atan2(dy, dx) }; heldHand = null; return;
  }
  const target = R.at(event.clientX, event.clientY); pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, target };
  if (target) { selectedId = target; R.selected = target; status(`Selected ${S.state.entities[target]?.name || target}`); }
}, { capture: true });
canvas.addEventListener('pointermove', event => {
  if (!localMode) return;
  if (!pointers.has(event.pointerId)) return;
  event.preventDefault(); event.stopImmediatePropagation(); pointers.set(event.pointerId, [event.clientX, event.clientY]);
  if (pointers.size === 2 && pinch) {
    const entries = [...pointers.values()], dx = entries[1][0] - entries[0][0], dy = entries[1][1] - entries[0][1], span = Math.max(1, Math.hypot(dx, dy)), angle = Math.atan2(dy, dx);
    R.distance = clamp(R.distance * pinch.span / span, 4, 22); R.yaw -= angle - pinch.angle; pinch = { span, angle };
    updateProjectionState({ scale: R.distance, rotation: R.yaw }); return;
  }
  if (!pointer || pointer.id !== event.pointerId) return;
  const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y; pointer.x = event.clientX; pointer.y = event.clientY;
  if (pointer.target && S.state?.entities[pointer.target]) {
    engine.translate(pointer.target, activeAxis, materialAxisGesture(dx, dy)).catch(error => status(error.message));
  } else { R.yaw += dx * 0.006; R.pitch = clamp(R.pitch + dy * 0.005, -1.35, 1.35); updateProjectionState({ rotation: R.yaw }); }
}, { capture: true });
const pointerEnd = event => { if (!localMode) return; event.preventDefault(); event.stopImmediatePropagation(); pointers.delete(event.pointerId); if (pointer?.id === event.pointerId) pointer = null; if (pointers.size < 2) pinch = null; };
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, pointerEnd, { capture: true });

window.VivaAgentTools = Object.freeze({ list: () => registry.list(), invoke: (name, args) => registry.invoke(name, args), revokeAll: () => registry.revokeAll(), audit: () => structuredClone(registry.audit) });
window.VivaPhoneEngine = Object.freeze({
  get active() { return !!engine && localMode; }, get available() { return browserCapabilities.worker; },
  snapshot: () => engine?.snapshot(), translate: (...args) => engine?.translate(...args), setEye: patch => engine?.setEye(patch),
  forkOffline: label => engine?.forkOffline(label), startCamera: (facing = 'user') => startPhoneCamera(facing), stopCamera: stopPhoneCamera,
  capabilities: () => latestCapabilities || browserCapabilities,
});

addPhoneSurface();
