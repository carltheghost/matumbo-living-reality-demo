import { PhoneEngineClient } from './client.mjs';
import { projectForRenderer, detectPhoneCapabilities } from './engine.mjs';
import { AndroidPhoneBridge } from './bridge.mjs';
import { AgentToolRegistry } from './agent-tools.mjs';
import { HandsFreeProjection } from './projection.mjs';
import { PhoneTwoHandCamera } from './two-hand-camera.mjs';
import { formatPersistenceStatus } from './persistence-status.mjs';
import { startCameraFromButton } from './camera-start-status.mjs';
import { PhoneAuthorityAdapter } from './authority-adapter.mjs';
import { FieldWorldController, drawFieldAtlas } from './field-world.mjs';
import { SpatialInteractionFabric, mapRendererPointToCanonical } from './spatial-fabric.mjs';
import { LocalOperationIdFactory } from './local-operation.mjs';
import { LocalEditQueue } from './local-edit-queue.mjs';

const $ = id => document.getElementById(id);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const browserCapabilities = await detectPhoneCapabilities();
const bridge = new AndroidPhoneBridge(window);
const registry = new AgentToolRegistry({ bridge });
const shared = window.VivaShared;
if (!shared?.R || !shared?.S || !shared?.camera) throw new Error('Viva phone integration loaded before the shared renderer.');
const { R, S, camera } = shared;
const STATIC_PHONE_ROUTE = /\/services\/vivo\/web\/phone(?:\/|$)/.test(location.pathname);
let engine = null, authority = null, localMode = false, selectedId = null, activeAxis = 0;
let pinch = null, projection = null, fieldWorld = null, fieldEnvelope = null, interactionFabric = null;
const handContacts = new Map(), pointerContacts = new Map();
const touchGestures = new Map();
const touchOperationIds = new LocalOperationIdFactory('touch-preview');
const pendingFieldApplies = [];
let fieldApplyTail = Promise.resolve(), fieldApplySequence = 0;
let snapshotTail = Promise.resolve(), snapshotSequence = 0, renderedSnapshot = null;
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
function renderEye(envelope, options = {}) {
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
  fieldEnvelope = envelope;
  updateFieldWorld(envelope, options);
  const axis = $('phoneAxis'); if (axis) { axis.replaceChildren(); for (let i = 0; i < state.geometry.dimension; i++) { const option = document.createElement('option'); option.value = String(i); option.textContent = `x${i + 1}${i > 2 ? ' ? extra axis' : ''}`; axis.append(option); } axis.value = String(Math.min(activeAxis, state.geometry.dimension - 1)); }
  const eyeInfo = $('phoneEyeInfo'); if (eyeInfo) eyeInfo.textContent = `${projected.eye.label} ? ${projected.eye.spaceId} ? ${state.geometry.dimension} spatial axes + separate time ? world ${envelope.snapshot.worldId}`;
}
function snapshotMarker(envelope) {
  const snapshot = envelope?.snapshot;
  const eye = envelope?.eyes?.[envelope?.currentEyeId];
  const space = snapshot?.spaces?.[eye?.spaceId || snapshot?.rootSpaceId];
  return {
    worldId: snapshot?.worldId || null,
    branchId: envelope?.branchId || null,
    eyeId: envelope?.currentEyeId || null,
    spaceId: eye?.spaceId || snapshot?.rootSpaceId || null,
    acceptedSequence: Number(snapshot?.acceptedSequence) || 0,
    eyeRevision: Number(eye?.revision) || 0,
    entityRevisions: Object.entries(space?.entities || {}).sort(([a], [b]) => a.localeCompare(b)).map(([id, entity]) => [id, Number(entity?.revision) || 0]),
  };
}
function isOlderSnapshot(next, prior) {
  if (!prior) return false;
  const current = snapshotMarker(next);
  if (current.worldId !== prior.worldId || current.branchId !== prior.branchId || current.eyeId !== prior.eyeId || current.spaceId !== prior.spaceId) return false;
  if (current.acceptedSequence !== prior.acceptedSequence) return current.acceptedSequence < prior.acceptedSequence;
  if (current.eyeRevision !== prior.eyeRevision) return current.eyeRevision < prior.eyeRevision;
  const priorRevisions = new Map(prior.entityRevisions);
  return current.entityRevisions.some(([id, revision]) => revision < (priorRevisions.get(id) || 0));
}
function enqueueSnapshot(read, options = {}) {
  const sequence = ++snapshotSequence;
  const task = snapshotTail.then(async () => {
    const envelope = await read();
    if (localMode && !isOlderSnapshot(envelope, renderedSnapshot)) {
      renderedSnapshot = snapshotMarker(envelope);
      renderEye(envelope, { ...options, snapshotSequence: sequence });
    }
    return envelope;
  });
  snapshotTail = task.catch(() => {});
  return task;
}
function updateEyeControls(envelope) {
  const select = $('phoneEyeSelect'); if (!select) return;
  const prior = select.value;
  select.replaceChildren();
  for (const eye of Object.values(envelope.eyes)) { const option = document.createElement('option'); option.value = eye.id; option.textContent = `${eye.label} ? ${eye.spaceId}`; select.append(option); }
  select.value = envelope.currentEyeId || prior;
  const nested = envelope.eyes[envelope.currentEyeId]?.returnStack?.length || 0;
  $('phoneExitNested').disabled = nested === 0;
  $('phoneEnterNested').disabled = !S.state?.entities[R.selected]?.innerSpaceId;
}
async function refreshSnapshot(options = {}) { if (!engine) return null; return enqueueSnapshot(() => engine.snapshot(), options); }
function fieldAxes() {
  return ['phoneFieldAxisA', 'phoneFieldAxisB', 'phoneFieldAxisC'].map(id => Number($(id)?.value)).filter(Number.isInteger);
}
function updateFieldWorld(envelope = fieldEnvelope, options = {}) {
  if (!fieldWorld || !envelope) return;
  const fieldOptions = {
    query: $('phoneFieldQuery')?.value || '',
    relevanceThreshold: Number($('phoneFieldThreshold')?.value || 0.2),
    eyeAxes: fieldAxes(),
    layout: $('phoneFieldLayout')?.value || 'gather',
    selectedId: selectedId || R.selected || null,
    authorityDebug: authority?.debug?.() || null,
  };
  const model = fieldWorld.refresh(envelope, { ...fieldOptions, ...options, pendingApplies: pendingFieldApplies });
  const dimensions = model.dimension;
  for (const [index, id] of ['phoneFieldAxisA', 'phoneFieldAxisB', 'phoneFieldAxisC'].entries()) {
    const select = $(id);
    if (!select) continue;
    const prior = Number(select.value);
    select.replaceChildren();
    for (let axis = 0; axis < dimensions; axis++) {
      const option = document.createElement('option');
      option.value = String(axis); option.textContent = 'x' + (axis + 1);
      select.append(option);
    }
    const selectedAxis = model.eye.axes?.[index];
    select.value = String(Number.isInteger(selectedAxis) && selectedAxis < dimensions ? selectedAxis : (Number.isInteger(prior) && prior < dimensions ? prior : Math.min(index, dimensions - 1)));
  }
  const entitySelect = $('phoneFieldEntity');
  if (entitySelect) {
    const prior = entitySelect.value;
    entitySelect.replaceChildren();
    for (const entity of model.entities) {
      const option = document.createElement('option');
      option.value = entity.id; option.textContent = entity.name + (entity.awake ? ' ? awake' : ' ? sleeping');
      entitySelect.append(option);
    }
    entitySelect.value = model.entities.some(entity => entity.id === prior) ? prior : (selectedId || model.entities[0]?.id || '');
  }
  drawFieldAtlas($('phoneFieldAtlas'), model);
  const preview = updateFieldActionButtons();
  const statusView = $('phoneFieldStatus');
  if (statusView) statusView.textContent = model.awakeIds.length + '/' + model.entities.length + ' objects awake ? ' + model.atlas.length + ' coordinate planes ? analytic information mix ? ' + model.field.materialAuthority;
  const previewView = $('phoneFieldPreview');
  if (previewView) previewView.textContent = preview
    ? preview.kind + ' preview for ' + preview.entityId + ' ? local only ? ' + (preview.mixWith ? 'mixed with ' + preview.mixWith + ' ? ' : '') + 'apply explicitly or discard'
    : 'No local edit preview. Preview never enters accepted history.';
  const acceptedView = $('phoneFieldAccepted');
  if (acceptedView) acceptedView.textContent = JSON.stringify(model.accepted, null, 2);
}
function updateFieldActionButtons(completedGeneration = null) {
  const preview = fieldWorld?.commitCandidate() || null;
  const superseded = preview && completedGeneration !== null && preview.generation !== completedGeneration;
  const enabled = Boolean(preview);
  if ($('phoneFieldApply')) $('phoneFieldApply').disabled = !enabled;
  if ($('phoneFieldDiscard')) $('phoneFieldDiscard').disabled = !enabled;
  if (superseded) status('A newer local field preview is ready; the earlier Apply did not replace it.');
  return preview;
}
function fieldEntityId() { return $('phoneFieldEntity')?.value || selectedId || R.selected || null; }
function localObjectIdentity(entityId) {
  const eye = fieldEnvelope?.eyes?.[fieldEnvelope.currentEyeId], spaceId = eye?.spaceId;
  const entity = fieldEnvelope?.snapshot?.spaces?.[spaceId]?.entities?.[entityId];
  if (!eye || !spaceId || !entity) return null;
  return {
    worldId: fieldEnvelope.snapshot.worldId,
    branchId: fieldEnvelope.branchId || null,
    eyeId: fieldEnvelope.currentEyeId,
    spaceId,
    entityId,
    baseRevision: entity.revision,
    baseQ: [...entity.q],
  };
}
function fieldScopeMatches(envelope, candidate) {
  const eye = envelope?.eyes?.[envelope?.currentEyeId];
  const spaceId = eye?.spaceId;
  return Boolean(envelope?.snapshot
    && envelope.snapshot.worldId === candidate?.worldId
    && (envelope.branchId || null) === candidate?.branchId
    && envelope.currentEyeId === candidate?.eyeId
    && spaceId === candidate?.spaceId);
}
function appliedLocalOperation(envelope, candidate) {
  return (envelope?.snapshot?.localOperationResults || []).find(item => item?.operationId === candidate?.operationId) || null;
}
function syncPendingCandidate(pending) {
  const current = fieldWorld?.commitCandidate();
  if (current?.operationId === pending.candidate?.operationId && !fieldWorld.isDiscarded(pending.candidate)) pending.candidate = current;
  return pending.candidate;
}
function stalePreviewError(error) {
  return /STALE_LOCAL_PREVIEW|changed before the preview|changed while the preview/i.test(String(error?.message || error));
}
async function runFieldApply(pending) {
  pending.phase = 'running';
  let candidate = pending.candidate;
  let current = null;
  try {
    if (pending.cancelled || fieldWorld.isDiscarded(candidate)) return { cancelled: true };
    current = await refreshSnapshot({ fieldApplyPreflight: pending });
    if (pending.cancelled || fieldWorld.isDiscarded(candidate)) return { cancelled: true };
    candidate = syncPendingCandidate(pending);
    if (!fieldScopeMatches(current, candidate)) {
      if (fieldWorld.commitCandidate()) fieldWorld.discardPreview();
      updateFieldWorld(current);
      throw new Error('The selected object changed branch, Eye or space while the preview was queued; preview discarded.');
    }
    let result = appliedLocalOperation(current, candidate);
    if (result) {
      result = { ...result.result, replayed: true };
    } else {
      let applyAttempts = 0;
      while (!result) {
        const eye = current.eyes[current.currentEyeId], spaceId = eye?.spaceId;
        const entity = current.snapshot.spaces[spaceId]?.entities[candidate.entityId];
        if (!entity) throw new Error('The selected object is no longer present in the active space; preview discarded.');
        if (entity.revision !== candidate.baseRevision) {
          const rebased = fieldWorld.rebaseCandidate(candidate, current);
          if (!rebased) throw new Error('Local field preview became stale and could not be safely rebased; press Preview again.');
          candidate = pending.candidate = rebased;
          fieldEnvelope = current;
          updateFieldWorld(current, { fieldApplyPreflight: pending });
        }
        try {
          result = await engine.applyLocalEdit(candidate.entityId, candidate.delta, {
            worldId: candidate.worldId, branchId: candidate.branchId, eyeId: candidate.eyeId,
            spaceId: candidate.spaceId, entityId: candidate.entityId, baseRevision: candidate.baseRevision,
            operationId: candidate.operationId,
          });
        } catch (error) {
          if (!stalePreviewError(error) || applyAttempts >= 3) throw error;
          applyAttempts++;
          current = await refreshSnapshot({ fieldApplyRetry: pending, retry: applyAttempts });
          const replay = appliedLocalOperation(current, candidate);
          if (replay) {
            result = { ...replay.result, replayed: true };
            break;
          }
          const active = fieldWorld.commitCandidate();
          const rebaseTarget = active?.operationId === candidate.operationId ? active : candidate;
          const rebased = fieldWorld.rebaseCandidate(rebaseTarget, current);
          if (!rebased) throw new Error('Local field preview became stale and could not be safely rebased; press Apply to retry.');
          candidate = pending.candidate = rebased;
          fieldEnvelope = current;
          updateFieldWorld(current, { fieldApplyRetry: pending, retry: applyAttempts });
        }
      }
    }
    pending.result = result;
    pending.phase = 'settling';
    if (fieldWorld.isCurrent(candidate)) fieldWorld.clearAppliedPreview(candidate);
    await refreshSnapshot({ completedApply: { candidate, result }, fieldApply: pending });
    const newerPreview = fieldWorld.commitCandidate();
    if (result?.cancelled) status('Local field Apply was cancelled without changing accepted state.');
    else status(`${result?.replayed ? 'Local field edit replay acknowledged' : 'Local field edit applied explicitly'}${newerPreview && newerPreview.operationId !== candidate.operationId ? '; newer local preview preserved and rebased' : ''}. Canonical authority was not contacted.`);
    return result;
  } catch (error) {
    if (stalePreviewError(error)) {
      let retryMessage = null;
      try {
        current = await refreshSnapshot({ fieldApplyError: pending });
        const active = fieldWorld.commitCandidate();
        if (active && active.operationId === candidate.operationId && fieldScopeMatches(current, active) && !fieldWorld.isDiscarded(active)) {
          const rebased = fieldWorld.rebaseCandidate(active, current);
          if (rebased) {
            pending.candidate = rebased;
            fieldEnvelope = current;
            updateFieldWorld(current, { fieldApplyError: pending });
            retryMessage = 'Local field preview became stale; it was rebased and remains ready. Press Apply to retry.';
          }
        }
      } catch {}
      if (retryMessage) throw new Error(retryMessage);
    }
    throw error;
  } finally {
    const index = pendingFieldApplies.indexOf(pending);
    if (index >= 0) pendingFieldApplies.splice(index, 1);
  }
}
function enqueueFieldApply(candidate) {
  const pending = { candidate, result: null, phase: 'queued', sequence: ++fieldApplySequence, cancelled: false };
  pendingFieldApplies.push(pending);
  const operation = fieldApplyTail.then(() => runFieldApply(pending));
  pending.promise = operation;
  fieldApplyTail = operation.catch(() => {});
  return operation;
}
async function applyFieldPreview() {
  const candidate = fieldWorld?.commitCandidate();
  if (!candidate || !engine) return;
  if (candidate.kind === 'rotate-view') {
    if (fieldWorld.isCurrent(candidate)) fieldWorld.discardPreview(); updateFieldWorld(fieldEnvelope);
    status('Rotation is a view-only preview; no canonical or local object state was changed.');
    return;
  }
  return enqueueFieldApply(candidate);
}
function updatePhoneAuthorityUI(detail = null) {
  const debug = detail?.state || authority?.debug();
  const state = $('phoneAuthorityState'), output = $('phoneAuthorityDebug');
  if (!debug) {
    if (state) state.textContent = 'Enter local Vivo first. Canonical authority is never contacted automatically.';
    if (output) output.textContent = '';
    return;
  }
  const mapping = debug.mapping || {};
  const capability = debug.capabilities?.canonicalCommit || {};
  const statusText = STATIC_PHONE_ROUTE
    ? 'PAGES STATIC/OFFLINE ? canonical authority unavailable on this route; local phone state remains independent'
    : mapping.status !== 'available'
    ? (debug.connected ? 'CONNECTED' : 'OFFLINE') + ' ? ' + (mapping.code || 'PHONE_OBJECT_UNAVAILABLE') + ' ? ' + (mapping.reason || 'Local object is not mapped.')
    : (debug.connected ? 'CONNECTED' : 'OFFLINE') + ' ? ' + (debug.local?.mode || 'local') + ' ? ' + (debug.local?.dimension || '?') + 'D root ? ' + (debug.authorityPersistence?.durable ? 'authority durable' : 'authority memory/session') + ' ? ' + (capability.allowed ? 'canonical commit available' : (capability.rejectionCode || 'canonical commit unavailable'));
  if (state) state.textContent = debug.conflict
    ? `CONFLICT ? ${debug.message}`
    : statusText + (debug.message ? ` ? ${debug.message}` : '');
  if (output) output.textContent = JSON.stringify({
    mapping: debug.mapping,
    local: debug.local,
    acceptedSequence: debug.acceptedSequence,
    acceptedBinding: debug.acceptedBinding,
    acceptedEntity: debug.acceptedEntity,
    capabilities: debug.capabilities,
    authorityPersistence: debug.authorityPersistence,
    conflict: debug.conflict,
    lastResult: debug.lastResult,
  }, null, 2);
  const entity = $('phoneAuthorityEntity'), connected = debug.connected;
  if (entity && entity.value !== authority?.selectedEntityId) entity.value = authority?.selectedEntityId || entity.value;
  const setDisabled = (id, disabled) => { const node = $(id); if (node) node.disabled = disabled; };
  setDisabled('phoneAuthorityConnect', STATIC_PHONE_ROUTE || connected || !engine);
  setDisabled('phoneAuthorityRead', STATIC_PHONE_ROUTE || !connected);
  setDisabled('phoneAuthorityPreview', !engine);
  setDisabled('phoneAuthorityPublish', STATIC_PHONE_ROUTE || !connected || mapping.status !== 'available' || !debug.capabilities?.projection);
  setDisabled('phoneAuthorityCommit', STATIC_PHONE_ROUTE || !connected || mapping.status !== 'available' || !capability.allowed);
}
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
function rendererDepthForObject(objectId) {
  const screenPoint = R.screen?.find(point => point.id === objectId);
  if (screenPoint?.k) return Math.max(0.15, Math.min(1e6, Math.min(R.w || innerWidth || 1, R.h || innerHeight || 1) * 1.18 / screenPoint.k));
  return Math.max(0.15, Number(R.distance) || 10.5);
}
function canonicalPointForInput(point, objectId = null) {
  const envelope = fieldEnvelope, eye = envelope?.eyes?.[envelope.currentEyeId];
  const rect = $('world')?.getBoundingClientRect?.() || { left: 0, top: 0, width: innerWidth || 1, height: innerHeight || 1 };
  if (!eye) return [0, 0, 0];
  return mapRendererPointToCanonical({
    devicePoint: { x: Number(point?.[0]) || 0, y: Number(point?.[1]) || 0 },
    viewport: rect,
    eye,
    renderer: R,
    axes: [0, 2, 1],
    depth: rendererDepthForObject(objectId),
  });
}
function fenceHandEdits(reason = 'hand-fence') {
  for (const [contactId, contact] of handContacts) {
    contact.editQueue?.stop();
    interactionFabric?.end(contactId, reason);
  }
  handContacts.clear();
}
function releaseHandContact(contactId, reason = 'hand-release') {
  const contact = handContacts.get(contactId);
  if (!contact) return;
  contact.editQueue?.stop();
  interactionFabric?.end(contactId, reason);
  handContacts.delete(contactId);
}
function handleFieldHandGesture(event) {
  if (!localMode) return;
  if (event.type === 'lost') {
    if (event.handId) releaseHandContact('hand:' + event.handId, event.reason || 'hand-lost');
    else for (const contactId of [...handContacts.keys()]) releaseHandContact(contactId, event.reason || 'tracking-lost');
    R.pointer = null; lastPoseByHand.clear(); return;
  }
  if (event.type === 'frame') {
    const active = new Set(event.hands.map(hand => 'hand:' + hand.id));
    for (const contactId of [...handContacts.keys()]) if (!active.has(contactId)) releaseHandContact(contactId, 'hand-missing');
    for (const id of lastPoseByHand.keys()) if (!active.has('hand:' + id)) lastPoseByHand.delete(id);
    return;
  }
  if (event.type === 'aim') { R.pointer = event.point; return; }
  if (event.type === 'pose') {
    const priorPose = lastPoseByHand.get(event.handId); lastPoseByHand.set(event.handId, event.pose);
    if (priorPose === event.pose) return;
    const now = performance.now(); if (now - lastPoseAction < 650) return;
    if (event.pose === 'point') {
      const hit = R.at(...event.point);
      if (hit) { selectedId = hit; R.selected = hit; status('POINT ? selected ' + (S.state.entities[hit]?.name || hit)); lastPoseAction = now; }
    } else if (event.pose === 'peace') {
      R.overview = !R.overview; updateProjectionState({ mode: R.overview ? 'overview' : 'slice' });
      status('PEACE ? ' + (R.overview ? 'overview' : 'current slice')); lastPoseAction = now;
    } else if (event.pose === 'thumbs-up') {
      activeAxis = (activeAxis + 1) % (S.state?.geometry.dimension || 4);
      const axis = $('phoneAxis'); if (axis) axis.value = String(activeAxis);
      status('THUMBS-UP ? move axis x' + (activeAxis + 1)); lastPoseAction = now;
    }
    return;
  }
  if (event.type === 'grab') {
    const hit = R.at(...event.point), contactId = 'hand:' + event.handId;
    if (hit && !handContacts.has(contactId)) {
      const canonicalPoint = canonicalPointForInput(event.point, hit);
      interactionFabric?.begin({ contactId, source: { kind: 'hand', id: event.handId }, objectId: hit, gesture: 'grab', canonicalPoint });
      const identity = localObjectIdentity(hit);
      handContacts.set(contactId, {
        id: event.handId, entityId: hit, point: event.point, canonicalPoint,
        worldId: identity?.worldId || fieldEnvelope?.snapshot?.worldId,
        branchId: identity?.branchId || fieldEnvelope?.branchId || null,
        eyeId: identity?.eyeId || fieldEnvelope?.currentEyeId,
        spaceId: identity?.spaceId || fieldEnvelope?.eyes?.[fieldEnvelope?.currentEyeId]?.spaceId,
        editQueue: new LocalEditQueue(),
      });
      selectedId = hit; R.selected = hit; status('HAND GRAB ? ' + hit);
    }
    return;
  }
  const contactId = 'hand:' + event.handId, contact = handContacts.get(contactId);
  if (event.type === 'move' && contact) {
    const prior = contact.point, dx = event.point[0] - prior[0], dy = event.point[1] - prior[1];
    contact.point = event.point; contact.canonicalPoint = canonicalPointForInput(event.point, contact.entityId);
    interactionFabric?.update(contactId, { canonicalPoint: contact.canonicalPoint, gesture: 'drag' });
    const dimension = S.state?.geometry.dimension || 4;
    if (activeAxis < dimension) {
      const delta = Array(dimension).fill(0); delta[activeAxis] = materialAxisGesture(dx, dy);
      const appliedPoint = [...contact.canonicalPoint];
      contact.pending = contact.editQueue.enqueue({
        submit: () => engine.applyLocalEdit(contact.entityId, delta, {
          worldId: contact.worldId, branchId: contact.branchId, eyeId: contact.eyeId,
          spaceId: contact.spaceId, entityId: contact.entityId,
        }),
        afterSubmit: () => {
          if (handContacts.get(contactId) === contact) interactionFabric?.rebase(contactId, appliedPoint);
        },
      }).catch(error => {
        if (!contact.editQueue.stopped && handContacts.get(contactId) === contact) status(error.message);
        return { status: 'error', submitted: false, error };
      });
    }
    return;
  }
  if (event.type === 'release' && contact) {
    interactionFabric?.end(contactId, event.reason || 'release');
    handContacts.delete(contactId);
    const pending = engine?.lastPersistence;
    reportPersistenceStatus('release', pending).catch(error => status('Hand released ? local persistence status unavailable: ' + error.message + '. Retry remains available.'));
    return;
  }
  if (event.type === 'twohand') {
    if (event.scale > 0.01 && Number.isFinite(event.scale)) R.distance = clamp(R.distance / event.scale, 4, 22);
    R.yaw = (R.yaw - event.rotation + Math.PI * 4) % (Math.PI * 2);
    updateProjectionState({ mode: R.overview ? 'overview' : 'slice', scale: R.distance, rotation: R.yaw });
    return;
  }
  if (event.type === 'swipe' && !handContacts.size && S.state) {
    const ids = Object.keys(S.state.entities), i = ids.indexOf(R.selected), step = event.dx < 0 ? 1 : -1;
    selectedId = ids[(i + step + ids.length) % ids.length]; R.selected = selectedId;
    status('SWIPE ? selected ' + (S.state.entities[selectedId]?.name || selectedId));
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
  onGesture: event => { if (localMode) handleFieldHandGesture(event); else handleSharedHandGesture(event); },
  onHands: hands => { const view = $('cameraState'); if (hands.length && view) view.textContent = 'Tracking ' + hands.length + ' hand(s) ? 21 landmarks ? all five fingers ? local only.'; },
});
projection = new HandsFreeProjection({ bridge, camera: phoneCamera });
async function startPhoneCamera(facing = 'user') {
  if (camera.video) camera.video.style.display = 'none';
  try { return await phoneCamera.start(facing); }
  catch (error) { if (camera.video) camera.video.style.display = ''; throw error; }
}
function stopPhoneCamera() {
  fenceHandEdits('camera-stop');
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
  const enter = button('enterPhoneLocal', 'Enter local Vivo ? works offline', 'primary');
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
    <hr><h3>Hands-free input & projection</h3><p class="muted">Up to two hands ? all 21 landmarks and all five articulated fingers ? local inference. Open, point, peace, thumbs-up, fist and pinch poses; two hands zoom and rotate; touch drag/pinch also work. Camera frames stay on this phone.</p>
    <div class="row"><button id="phoneStartHands">Start front camera + hands</button><button id="phoneStartBackHands">Start rear camera + hands</button></div>
    <div class="row"><button id="phoneStopHands">Stop camera and release it</button></div>
    <div class="row"><button id="phoneProject">Project / cast view</button><button id="phoneStopProject">Stop projection mode</button></div>
    <p id="phoneProjectionState" class="muted">Projection is controlled separately from input. OS support decides whether a route is available.</p>
    <div class="row"><button id="phoneInstallOffline">Install offline shell</button><button id="phoneCacheHands">Cache hand model (large)</button></div>
    <p id="phoneCapabilityState" class="muted"></p>
    <hr><h3>Information field + plane atlas</h3>
    <p class="muted">Phone-local analytic information mix. Relevance wakes nearby or requested objects; the atlas samples every coordinate plane without pretending to render a dense 11D grid.</p>
    <label>Information request<input id="phoneFieldQuery" maxlength="80" placeholder="place, memory, person"></label>
    <label>Awake relevance <input id="phoneFieldThreshold" type="range" min="0" max="1" step=".05" value=".2"></label>
    <label>Field layout<select id="phoneFieldLayout"><option value="gather">Gather by coordinates</option><option value="ring">Ring</option><option value="row">Row</option></select></label>
    <div class="row"><label>Eye axis A<select id="phoneFieldAxisA"></select></label><label>Eye axis B<select id="phoneFieldAxisB"></select></label><label>Eye axis C<select id="phoneFieldAxisC"></select></label></div>
    <canvas id="phoneFieldAtlas" width="360" height="180" aria-label="All coordinate-plane field atlas"></canvas>
    <p id="phoneFieldStatus" class="muted">Field atlas waits for the local phone engine.</p>
    <label>Selected field object<select id="phoneFieldEntity"></select></label>
    <div class="row"><button id="phoneFieldPreviewMove">Preview move</button><button id="phoneFieldPreviewRotate">Preview turn</button><button id="phoneFieldPreviewMix">Preview mix</button></div>
    <div class="row"><button id="phoneFieldApply" disabled>Apply local edit</button><button id="phoneFieldDiscard" disabled>Discard preview</button><button id="phoneReleaseContacts">Release local contacts</button></div>
    <p id="phoneFieldPreview" class="muted">No local edit preview. Preview never enters accepted history.</p>
    <details><summary>Accepted-event inspector</summary><pre id="phoneFieldAccepted" class="muted"></pre></details>
    <hr><h3>Canonical authority (explicit)</h3>
    <p class="muted">The phone remains a local authority. Connect and read are explicit; Preview sends nothing. Publish selected uses <code>studio.transform</code> only. Commit canonical uses <code>studio.commit</code> with global, binding and entity CAS. Offline branches never send and accepted state is never copied back into the phone. On the static Pages phone route, the shared authority is unavailable and those write controls remain disabled.</p>
    <label>Authority seat<select id="phoneAuthoritySeat"><option value="one">Seat one</option><option value="two">Seat two</option></select></label>
    <label>Phone object<select id="phoneAuthorityEntity"><option value="relic">Relic → canonical Echo</option><option value="workpiece">Workpiece → canonical Workpiece</option><option value="portal">Portal → canonical Portal</option><option value="innerRelic">Inner relic → local only</option></select></label>
    <div class="row"><button id="phoneAuthorityConnect">Connect authority</button><button id="phoneAuthorityRead" disabled>Read accepted</button></div>
    <div class="row"><button id="phoneAuthorityPreview" disabled>Preview local mapping</button><button id="phoneAuthorityPublish" disabled>Publish projection</button></div>
    <div class="row"><button id="phoneAuthorityCommit" disabled>Commit canonical</button></div>
    <p id="phoneAuthorityState" class="muted" aria-live="polite">Enter local Vivo first. Canonical authority is never contacted automatically.</p>
    <pre id="phoneAuthorityDebug" class="muted" aria-live="polite"></pre>
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
  $('phoneEnterNested').onclick = async () => { fenceHandEdits('nested-enter'); if (R.selected) await engine.enterNested(R.selected); await refreshSnapshot(); };
  $('phoneExitNested').onclick = async () => { fenceHandEdits('nested-exit'); await engine.exitNested(); await refreshSnapshot(); };
  $('phoneFork').onclick = async () => {
    try {
      await forkPhoneOffline('Phone offline branch'); const current = await refreshSnapshot();
      const durable = current?.persistence?.state === 'saved';
      status(`Offline branch ${current.branchId.slice(0, 10)} ${durable ? 'created and saved' : 'created in memory only'}. No automatic merge.`);
    } catch (error) { await refreshSnapshot().catch(() => {}); status(`Offline branch remains in memory but was not saved: ${error.message}. Retry remains available.`); }
  };
  $('phoneExport').onclick = async () => {
    const envelope = await engine.snapshot(), blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${envelope.snapshot.worldId}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  };
  $('phoneStartHands').onclick = () => startCameraFromButton({ facing: 'user', start: startPhoneCamera, status, activeMessage: 'Two-hand tracking active ? local worker ? camera frames stay on this phone.' });
  $('phoneStartBackHands').onclick = () => startCameraFromButton({ facing: 'environment', start: startPhoneCamera, status, activeMessage: 'Rear camera ? two-hand tracking active locally.' });
  $('phoneStopHands').onclick = () => { stopPhoneCamera(); status('Camera stopped. Touch controls remain available.'); };
  $('phoneProject').onclick = async () => { try { const result = await projection.start(); $('phoneProjectionState').textContent = `Projection route: ${result.route} ? camera track ${result.cameraTrack}. OS/browser may pause camera when the page is backgrounded.`; } catch (error) { $('phoneProjectionState').textContent = `${error.message} The camera remains local; touch still works.`; } };
  $('phoneStopProject').onclick = () => { projection.stop(); $('phoneProjectionState').textContent = 'Projection mode stopped; camera can continue until you stop it.'; };
  const refreshFieldControls = () => updateFieldWorld(fieldEnvelope);
  $('phoneFieldQuery').oninput = refreshFieldControls;
  $('phoneFieldThreshold').oninput = refreshFieldControls;
  $('phoneFieldLayout').onchange = refreshFieldControls;
  for (const id of ['phoneFieldAxisA', 'phoneFieldAxisB', 'phoneFieldAxisC']) $(id).onchange = refreshFieldControls;
  $('phoneFieldEntity').onchange = event => { if (fieldWorld?.commitCandidate()?.entityId !== event.target.value) fieldWorld?.discardPreview(); selectedId = event.target.value; R.selected = selectedId; refreshFieldControls(); };
  $('phoneFieldPreviewMove').onclick = () => {
    try { fieldWorld.previewMove(fieldEntityId(), Number($('phoneAxis').value || 0), 0.14); updateFieldWorld(); $('phoneFieldApply').disabled = false; $('phoneFieldDiscard').disabled = false; }
    catch (error) { status(error.message); }
  };
  $('phoneFieldPreviewRotate').onclick = () => {
    try { fieldWorld.previewRotate(fieldEntityId(), Math.PI / 12); updateFieldWorld(); $('phoneFieldApply').disabled = false; $('phoneFieldDiscard').disabled = false; }
    catch (error) { status(error.message); }
  };
  $('phoneFieldPreviewMix').onclick = () => {
    try { fieldWorld.previewMix(fieldEntityId()); updateFieldWorld(); $('phoneFieldApply').disabled = false; $('phoneFieldDiscard').disabled = false; }
    catch (error) { status(error.message); }
  };
  $('phoneFieldApply').onclick = async () => {
    const candidate = fieldWorld?.commitCandidate(), completedGeneration = candidate?.generation ?? null;
    try { await applyFieldPreview(); }
    catch (error) { status(error.message); }
    finally { updateFieldActionButtons(completedGeneration); }
  };
  $('phoneFieldDiscard').onclick = () => { fieldWorld?.discardPreview(); updateFieldWorld(); $('phoneFieldApply').disabled = true; $('phoneFieldDiscard').disabled = true; status('Local field preview discarded without changing accepted state.'); };
  $('phoneReleaseContacts').onclick = () => {
    for (const objectId of [...touchGestures.keys()]) cancelObjectTouchGesture(objectId, 'ui-emergency-stop');
    fenceHandEdits('ui-emergency-stop'); interactionFabric?.emergencyStop('ui-emergency-stop'); pointerContacts.clear();
    status('All local interaction contacts released. No provisional touch edit was committed.');
  };
  $('phoneInstallOffline').onclick = installOffline;
  $('phoneCacheHands').onclick = cacheHandAssets;
  $('phoneRefreshTools').onclick = refreshNativeTools;
  $('phoneAuthorityEntity').onchange = async event => {
    if (!authority) return;
    try { await authority.selectEntity(event.target.value); updatePhoneAuthorityUI(); }
    catch (error) { status(error.message); }
  };
  $('phoneAuthorityConnect').onclick = async () => {
    if (!authority) { status('Enter the local Vivo engine before connecting the canonical authority.'); return; }
    try {
      const result = await authority.connect({ seat: $('phoneAuthoritySeat').value });
      updatePhoneAuthorityUI();
      status(result?.status === 'rejected'
        ? (result.reason || `Canonical authority connection rejected: ${result.code || 'AUTHORITY_UNAVAILABLE'}.`)
        : 'Canonical authority connected explicitly. Local phone state remains unchanged.');
    }
    catch (error) { updatePhoneAuthorityUI(); status(`Canonical authority unavailable: ${error.message}`); }
  };
  $('phoneAuthorityRead').onclick = async () => {
    try {
      const result = await authority.read();
      updatePhoneAuthorityUI();
      status(result?.code === 'AUTHORITY_SESSION_CHANGED'
        ? 'Canonical authority closed before the read completed. Local phone state remains unchanged.'
        : result?.status === 'rejected'
        ? (result.reason || `Canonical read rejected: ${result.code || 'AUTHORITY_UNAVAILABLE'}.`)
        : 'Accepted canonical state refreshed. Local phone state remains unchanged.');
    }
    catch (error) { updatePhoneAuthorityUI(); status(`Canonical read failed: ${error.message}`); }
  };
  $('phoneAuthorityPreview').onclick = async () => {
    try { const result = await authority.preview({ entityId: $('phoneAuthorityEntity').value }); updatePhoneAuthorityUI(); status(result.reason); }
    catch (error) { updatePhoneAuthorityUI(); status(`Phone mapping preview failed: ${error.message}`); }
  };
  $('phoneAuthorityPublish').onclick = async () => {
    try { const result = await authority.publish(); updatePhoneAuthorityUI(); status(result.reason || (result.status === 'accepted' ? 'Projection published.' : 'Projection rejected.')); }
    catch (error) { updatePhoneAuthorityUI(); status(`Projection publish failed: ${error.message}`); }
  };
  $('phoneAuthorityCommit').onclick = async () => {
    try { const result = await authority.commit(); updatePhoneAuthorityUI(); status(result.reason || (result.status === 'accepted' ? 'Canonical commit accepted.' : 'Canonical commit rejected.')); }
    catch (error) { updatePhoneAuthorityUI(); status(`Canonical commit failed: ${error.message}`); }
  };
  projection.addEventListener('change', event => { $('phoneProjectionState').textContent = `Projection ${event.detail.type} ? ${event.detail.route} ? camera ${event.detail.cameraTrack} ? frames uploaded: no`; });
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
  if (engine) { localMode = true; updateLocalGrants(); document.body.classList.add('phone-local'); const state = await engine.snapshot(); renderedSnapshot = snapshotMarker(state); renderEye(state); await authority?.syncLocal(state); updatePhoneAuthorityUI(); openPhonePanel(); return; }
  status("Starting the local worker and opening this phone’s saved Vivo world…");
  engine = new PhoneEngineClient();
  engine.addEventListener('statechange', event => {
    if (event.detail?.state && localMode) enqueueSnapshot(() => event.detail.state, { stateEvent: event.detail.reason }).catch(() => {});
    if (event.detail?.state && authority) authority.syncLocal(event.detail.state).catch(() => {});
    if (event.detail?.reason === 'step-error') status(event.detail.error || 'Local material step stopped safely.');
    if (event.detail?.reason === 'persistence-failed') status(`Local Vivo state changed but was not saved: ${event.detail.state?.persistence?.error || 'storage failed'}. Retry remains available.`);
  });
  const rootDimension = Number($('createD')?.value) || 4;
  const state = await engine.open(getWorldId(), rootDimension);
  fieldWorld = new FieldWorldController(state, { selectedId: selectedId || R.selected || null });
  interactionFabric = new SpatialInteractionFabric();
  authority = new PhoneAuthorityAdapter({ engine, onState: updatePhoneAuthorityUI });
  await authority.syncLocal(state);
  localMode = true; updateLocalGrants(); document.body.classList.add('phone-local'); renderedSnapshot = snapshotMarker(state); renderEye(state);
  $('welcome').hidden = true; $('toolbar').hidden = false;
  const caps = await detectPhoneCapabilities(); latestCapabilities = caps;
  $('phoneEngineState').textContent = `Worker ready ? ${caps.webgpu ? 'WebGPU available' : caps.webgl2 ? 'WebGL2 renderer' : 'Canvas renderer'} ? ${caps.wasm ? 'WASM-ready' : 'JS fallback'} ? sparse ${state.snapshot.spaces.root.dimension}D root / ${state.snapshot.spaces.inner.dimension}D nested ? IndexedDB ${caps.indexedDb ? 'available' : 'unavailable'}.`;
  $('phoneCapabilityState').textContent = `Browser capabilities: ${Object.entries(caps).filter(([, value]) => value === true).map(([name]) => name).join(' ? ') || 'touch only'}. Graphics capability is detected independently from the sparse worker solver.`;
  if (bridge.available) await refreshNativeTools().catch(() => {});
  status('LOCAL VIVO ? same persistent objects ? independent Eye ? no server required.');
  openPhonePanel();
}
async function forkPhoneOffline(label) {
  fenceHandEdits('offline-fork');
  return engine?.forkOffline(label);
}
async function refreshNativeTools() {
  if (!bridge.available) { $('phoneCapabilityState').textContent = 'Android Companion not connected. Browser engine, storage, camera and touch remain available.'; updateAgentList(); return; }
  try {
    const result = await bridge.listTools(); const tools = hostToolCaps(result); updateAgentList(tools);
    $('phoneCapabilityState').textContent = `Android Companion connected ? ${tools.length} granted native tools. Capability status is OS-checked; frames are never in the bridge.`;
  } catch (error) { $('phoneCapabilityState').textContent = `Android Companion bridge unavailable: ${error.message}`; }
}
async function installOffline() {
  try {
    if (!('serviceWorker' in navigator)) throw new Error('This browser does not support service workers.');
    await navigator.serviceWorker.register(new URL('../vivo-sw.js', import.meta.url), { scope: new URL('../', import.meta.url).pathname });
    const ready = await navigator.serviceWorker.ready;
    if (!ready.active) throw new Error('Offline shell service worker did not become active.');
    const shellUrl = STATIC_PHONE_ROUTE ? new URL('./index.html', import.meta.url) : new URL('../index.html', import.meta.url);
    const shell = await (await caches.open('vivo-phone-shell-2026-10-11-v2')).match(shellUrl);
    if (!shell) throw new Error('Offline shell cache did not finish installing.');
    const persisted = await navigator.storage?.persist?.().catch(() => false);
    $('phoneEngineState').textContent = `Offline shell ready ? service worker active ? persistent storage ${persisted ? 'granted' : 'not granted by browser'}.`;
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

// Local mode captures touch before the shared-network handlers. Contacts feed
// one object-level provisional transform; accepted state changes only once the
// final contact releases, while cancellation discards the whole object gesture.
const canvas = $('world');
function objectTouchRecords(objectId) {
  return [...pointerContacts.values()].filter(record => record.target === objectId);
}
function beginObjectTouchGesture(objectId) {
  let gesture = touchGestures.get(objectId);
  if (gesture) return gesture;
  const identity = localObjectIdentity(objectId);
  if (!identity) return null;
  gesture = {
    ...identity,
    operationId: touchOperationIds.next(`${identity.worldId}:${identity.branchId || 'local'}:${identity.eyeId}:${identity.spaceId}:${objectId}`),
    contacts: new Set(),
    lastPreview: null,
  };
  touchGestures.set(objectId, gesture);
  return gesture;
}
function previewObjectTouchGesture(objectId) {
  const gesture = touchGestures.get(objectId), dimension = S.state?.geometry?.dimension || 4;
  const preview = interactionFabric?.preview(objectId, dimension, { sourceKinds: ['touch'] }) || null;
  if (gesture) gesture.lastPreview = preview;
  if (preview) status(`LOCAL PROVISIONAL ? ${objectId} ? ${preview.contactCount} contact(s) ? translation ${preview.translation.map(value => value.toFixed(2)).join(',')} ? release to apply or cancel to discard`);
  return preview;
}
function releaseObjectTouchContacts(objectId, reason) {
  const gesture = touchGestures.get(objectId);
  for (const record of objectTouchRecords(objectId)) {
    interactionFabric?.end('touch:' + record.id, reason);
    gesture?.contacts.delete('touch:' + record.id);
    pointerContacts.delete(record.id);
  }
}
function releaseObjectTouchContact(record, reason) {
  if (!record?.target) return;
  interactionFabric?.end('touch:' + record.id, reason);
  touchGestures.get(record.target)?.contacts.delete('touch:' + record.id);
  pointerContacts.delete(record.id);
}
function cancelObjectTouchGesture(objectId, reason = 'touch-cancel') {
  releaseObjectTouchContacts(objectId, reason);
  touchGestures.delete(objectId);
  interactionFabric?.clearObjectAggregate(objectId);
  status(`LOCAL PROVISIONAL DISCARDED ? ${objectId} ? ${reason}`);
}
async function commitObjectTouchGesture(objectId, preview) {
  const gesture = touchGestures.get(objectId);
  touchGestures.delete(objectId);
  if (!gesture || !preview || !preview.translation?.some(value => value !== 0)) {
    interactionFabric?.clearObjectAggregate(objectId);
    return null;
  }
  try {
    const result = await engine.applyLocalEdit(objectId, preview.translation, {
      worldId: gesture.worldId, branchId: gesture.branchId, eyeId: gesture.eyeId,
      spaceId: gesture.spaceId, entityId: gesture.entityId, baseRevision: gesture.baseRevision,
      operationId: gesture.operationId,
    });
    await refreshSnapshot();
    status(`${result?.replayed ? 'LOCAL PROVISIONAL REPLAY ACKNOWLEDGED' : 'LOCAL PROVISIONAL APPLIED'} ? ${objectId} ? canonical authority was not contacted.`);
    return result;
  } finally {
    interactionFabric?.clearObjectAggregate(objectId);
  }
}
canvas.addEventListener('pointerdown', event => {
  if (!localMode) return;
  event.preventDefault(); event.stopImmediatePropagation(); canvas.setPointerCapture(event.pointerId);
  const contactId = 'touch:' + event.pointerId;
  const point = [event.clientX, event.clientY];
  const target = R.at(event.clientX, event.clientY);
  const record = { id: event.pointerId, x: point[0], y: point[1], target, canonicalPoint: target ? canonicalPointForInput(point, target) : null, released: false };
  pointerContacts.set(event.pointerId, record);
  if (target) {
    const gesture = beginObjectTouchGesture(target);
    interactionFabric?.begin({ contactId, source: { kind: 'touch', id: String(event.pointerId) }, objectId: target, gesture: 'touch', canonicalPoint: record.canonicalPoint });
    gesture?.contacts.add(contactId);
    selectedId = target; R.selected = target; status('Selected ' + (S.state.entities[target]?.name || target));
  } else if (pointerContacts.size > 1) {
    const entries = [...pointerContacts.values()].filter(item => !item.target);
    if (entries.length > 1) {
      const dx = entries[1].x - entries[0].x, dy = entries[1].y - entries[0].y;
      pinch = { span: Math.max(1, Math.hypot(dx, dy)), angle: Math.atan2(dy, dx) };
    }
  }
}, { capture: true });
canvas.addEventListener('pointermove', event => {
  if (!localMode) return;
  const record = pointerContacts.get(event.pointerId);
  if (!record) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const prior = { x: record.x, y: record.y };
  if (record.released) return;
  record.x = event.clientX; record.y = event.clientY;
  if (record.target && S.state?.entities[record.target]) {
    const nextPoint = canonicalPointForInput([record.x, record.y], record.target);
    interactionFabric?.update('touch:' + event.pointerId, { canonicalPoint: nextPoint, gesture: 'drag' });
    record.canonicalPoint = nextPoint;
    previewObjectTouchGesture(record.target);
    return;
  }
  const views = [...pointerContacts.values()].filter(item => !item.target);
  if (views.length > 1 && pinch) {
    const entries = views.slice(0, 2), dx = entries[1].x - entries[0].x, dy = entries[1].y - entries[0].y;
    const span = Math.max(1, Math.hypot(dx, dy)), angle = Math.atan2(dy, dx);
    R.distance = clamp(R.distance * pinch.span / span, 4, 22); R.yaw -= angle - pinch.angle; pinch = { span, angle };
    updateProjectionState({ scale: R.distance, rotation: R.yaw });
    return;
  }
  R.yaw += (record.x - prior.x) * 0.006;
  R.pitch = clamp(R.pitch + (record.y - prior.y) * 0.005, -1.35, 1.35);
  updateProjectionState({ rotation: R.yaw });
}, { capture: true });
const pointerEnd = event => {
  if (!localMode) return;
  event.preventDefault(); event.stopImmediatePropagation();
  const record = pointerContacts.get(event.pointerId);
  if (record?.target) {
    if (event.type === 'lostpointercapture' && record.released) return;
    const cancel = event.type !== 'pointerup';
    if (cancel) {
      const objectId = record.target;
      const reason = event.type === 'pointercancel' ? 'touch-cancel' : 'lost-pointer-capture';
      releaseObjectTouchContact(record, reason);
      if (!objectTouchRecords(objectId).length) {
        touchGestures.delete(objectId);
        interactionFabric?.clearObjectAggregate(objectId);
        status(`LOCAL PROVISIONAL DISCARDED ? ${objectId} ? ${reason}`);
      } else previewObjectTouchGesture(objectId);
    } else {
      const objectId = record.target;
      const preview = interactionFabric?.preview(objectId, S.state?.geometry?.dimension || 4, { sourceKinds: ['touch'] });
      record.released = true;
      releaseObjectTouchContact(record, 'touch-release');
      const active = objectTouchRecords(objectId);
      if (!active.length) {
        commitObjectTouchGesture(objectId, preview).catch(error => status(error.message));
      } else previewObjectTouchGesture(objectId);
    }
  } else if (record) {
    pointerContacts.delete(event.pointerId);
  }
  const views = [...pointerContacts.values()].filter(item => !item.target);
  if (views.length < 2) pinch = null;
};
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, pointerEnd, { capture: true });

window.VivaAgentTools = Object.freeze({ list: () => registry.list(), invoke: (name, args) => registry.invoke(name, args), revokeAll: () => registry.revokeAll(), audit: () => structuredClone(registry.audit) });
window.VivaPhoneEngine = Object.freeze({
  get active() { return !!engine && localMode; }, get available() { return browserCapabilities.worker; },
  snapshot: () => engine?.snapshot(), translate: (...args) => engine?.translate(...args), applyLocalEdit: (...args) => engine?.applyLocalEdit(...args), setEye: patch => engine?.setEye(patch),
  forkOffline: label => forkPhoneOffline(label), startCamera: (facing = 'user') => startPhoneCamera(facing), stopCamera: stopPhoneCamera,
  authority: () => authority?.debug() || null,
  connectAuthority: options => authority?.connect(options), readAuthority: () => authority?.read(),
  previewAuthority: options => authority?.preview(options), publishAuthority: () => authority?.publish(),
  commitAuthority: () => authority?.commit(),
  fieldWorld: () => fieldWorld?.model || null,
  interaction: () => interactionFabric?.snapshot() || null,
  capabilities: () => latestCapabilities || browserCapabilities,
});

addPhoneSurface();
