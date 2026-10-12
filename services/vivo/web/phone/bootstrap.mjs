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
import { LocalAgentController } from './agent-control.mjs';
import { mountPhoneEconomyContext } from './economy-entry.mjs';
import { PhoneMaterialInputRuntime } from './material-input-runtime.mjs';
import { PHONE_MATERIAL_ENTITY_ID } from './material-contract.mjs';

const $ = id => document.getElementById(id);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const browserCapabilities = await detectPhoneCapabilities();
const bridge = new AndroidPhoneBridge(window);
const registry = new AgentToolRegistry({ bridge });
const shared = window.VivaShared;
if (!shared?.R || !shared?.S || !shared?.camera) throw new Error('Viva phone integration loaded before the shared renderer.');
const { R, S, camera } = shared;
const STATIC_PHONE_ROUTE = /\/services\/vivo\/web\/phone(?:\/|$)/.test(location.pathname);
let engine = null, authority = null, localMode = false, selectedId = null, activeAxis = 0, contactMode = 'surface';
let pinch = null, projection = null, fieldWorld = null, fieldEnvelope = null, interactionFabric = null;
let materialInput = null;
const agentController = new LocalAgentController({
  snapshot: () => engine?.snapshot(),
  applyTransform: (entityId, delta, geometry, expected) => engine?.applyLocalTransform(entityId, delta, geometry, expected),
  setEye: patch => engine?.setEye(patch),
  onChange: event => {
    updateAgentControlUI(event);
    if (localMode && fieldWorld) updateFieldWorld();
    if (event.reason === 'agent-stopped' && materialInput) {
      const agent = event.agents?.find(item => item.sourceId === event.sourceId);
      materialInput.stopSource({
        kind: 'agent', sourceId: event.sourceId,
        sessionId: agent?.sessionId || materialInput.sessionId,
        generation: agent?.generation || 1,
      }, event.reason || 'agent-stopped').catch(error => status(`Material agent stop reconciliation required: ${error.message}`));
    }
    if (event.reason === 'agent-stopped') status(`LOCAL AGENT STOPPED · ${event.sourceId} · surviving human/agent contacts preserved`);
    if (event.reason === 'agent-reenabled') status(`LOCAL AGENT RE-ENABLED · ${event.sourceId} · fresh generation ${event.agents.find(item => item.sourceId === event.sourceId)?.generation || '?'}`);
  },
});
registry.setAgentController(agentController);
bridge.setAgentController(agentController);
let economyContext = null;
const handContacts = new Map(), pointerContacts = new Map();
const materialHandContacts = new Map();
const touchGestures = new Map();
const touchOperationIds = new LocalOperationIdFactory('touch-preview');
let touchApplyTail = Promise.resolve();
const pendingFieldApplies = [];
let fieldApplyTail = Promise.resolve(), fieldApplySequence = 0;
let snapshotTail = Promise.resolve(), snapshotSequence = 0, renderedSnapshot = null, publishedEnvelope = null;
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
  updateAgentControlUI();
}
function updateAgentControlUI() {
  const statusView = $('phoneAgentControlStatus');
  const listView = $('phoneAgentSessions');
  if (!statusView || !listView) return;
  const agents = agentController.agents();
  const stoppedCount = agents.filter(agent => agent.status === 'stopped').length;
  statusView.textContent = agents.length
    ? `${agents.length} registered local agent${agents.length === 1 ? '' : 's'} · stop/revoke is scoped to its exact source and generation${stoppedCount ? ` · ${stoppedCount} stopped; surviving contacts preserved` : ''}`
    : 'No registered local agents. Register a source explicitly; agentId arguments cannot create authority.';
  listView.replaceChildren();
  for (const agent of agents) {
    const row = document.createElement('div'); row.className = 'agent-session-row';
    const details = document.createElement('div'); details.className = 'agent-session-details';
    const title = document.createElement('strong'); title.textContent = `${agent.label} · ${agent.sourceId}`;
    const meta = document.createElement('small'); meta.textContent = `${agent.status.toUpperCase()} · generation ${agent.generation} · ${agent.activeContacts} contact(s) · ${agent.activeOperations} queued/submitted`;
    details.append(title, meta);
    const action = document.createElement('button'); action.type = 'button'; action.className = agent.status === 'active' ? 'agent-stop' : 'agent-reenable';
    action.textContent = agent.status === 'active' ? 'Stop this agent' : 'Re-enable fresh generation';
    action.dataset.agentSource = agent.sourceId;
    action.onclick = async () => {
      action.disabled = true;
      try {
        if (agent.status === 'active') {
          const result = await registry.stopAgent(agent.sessionId, 'user-stop');
          status(`LOCAL AGENT STOPPED · ${agent.sourceId} · ${result.operations?.filter(item => item.status === 'submitted-requires-reconciliation').length || 0} submitted result(s) require reconciliation`);
        } else {
          await registry.reenableAgent(agent.sourceId);
          status(`LOCAL AGENT RE-ENABLED · ${agent.sourceId} · stale constraints were not restored`);
        }
      } catch (error) { status(error.message); }
      finally { updateAgentControlUI(); }
    };
    row.append(details, action); listView.append(row);
  }
}
function renderEye(envelope, options = {}) {
  const projected = projectForRenderer({ snapshot: () => envelope });
  const state = projected.state;
  const priorScope = fieldEnvelope ? snapshotMarker(fieldEnvelope) : null;
  const nextScope = snapshotMarker(envelope);
  if (localMode && priorScope && (
    priorScope.worldId !== nextScope.worldId
    || priorScope.branchId !== nextScope.branchId
    || priorScope.eyeId !== nextScope.eyeId
    || priorScope.spaceId !== nextScope.spaceId
  )) fenceLocalContacts('scope-transition');
  S.state = state; S.live = state; R.state = state; R.grid = projected.grid; R.actor = projected.eye.id;
  R.materialPatch = projected.materialPatch;
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
  if (!state.entities[selectedId]) selectedId = R.selected;
  syncEconomyContext();
  updateEyeControls(envelope);
  fieldEnvelope = envelope;
  updateFieldWorld(envelope, options);
  const axis = $('phoneAxis'); if (axis) { axis.replaceChildren(); for (let i = 0; i < state.geometry.dimension; i++) { const option = document.createElement('option'); option.value = String(i); option.textContent = `x${i + 1}${i > 2 ? ' · extra axis' : ''}`; axis.append(option); } axis.value = String(Math.min(activeAxis, state.geometry.dimension - 1)); }
  updateContactModeControls();
  const eyeInfo = $('phoneEyeInfo'); if (eyeInfo) eyeInfo.textContent = `${projected.eye.label} · ${projected.eye.spaceId} · ${state.geometry.dimension} spatial axes + separate time · world ${envelope.snapshot.worldId}`;
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
function publishEnvelope(envelope) {
  if (!envelope) return publishedEnvelope;
  if (!publishedEnvelope || !isOlderSnapshot(envelope, snapshotMarker(publishedEnvelope))) publishedEnvelope = envelope;
  return publishedEnvelope;
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
    const envelope = publishEnvelope(await read());
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
  for (const eye of Object.values(envelope.eyes)) { const option = document.createElement('option'); option.value = eye.id; option.textContent = `${eye.label} · ${eye.spaceId}`; select.append(option); }
  select.value = envelope.currentEyeId || prior;
  const nested = envelope.eyes[envelope.currentEyeId]?.returnStack?.length || 0;
  $('phoneExitNested').disabled = nested === 0;
  $('phoneEnterNested').disabled = !S.state?.entities[R.selected]?.innerSpaceId;
}
async function refreshSnapshot(options = {}) {
  if (!engine) return null;
  // Public reads must return the same envelope that feeds the field preview.
  // State-change events can accumulate while the sparse material worker is
  // stepping; queueing an external read behind those renders lets the engine
  // advance beyond the coordinates shown beside the read result.
  if (options.externalSnapshot) {
    const sequence = ++snapshotSequence;
    const envelope = publishEnvelope(await engine.snapshot());
    if (localMode && !isOlderSnapshot(envelope, renderedSnapshot)) {
      renderedSnapshot = snapshotMarker(envelope);
      renderEye(envelope, { ...options, snapshotSequence: sequence });
    }
    return envelope;
  }
  return enqueueSnapshot(() => engine.snapshot(), options);
}
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
      option.value = entity.id; option.textContent = entity.name + (entity.awake ? ' · awake' : ' · sleeping');
      entitySelect.append(option);
    }
    const preferred = [selectedId, R.selected, prior, model.entities[0]?.id]
      .find(id => model.entities.some(entity => entity.id === id)) || '';
    entitySelect.value = preferred;
    if (preferred) { selectedId = preferred; R.selected = preferred; if (S) S.selected = preferred; }
  }
  drawFieldAtlas($('phoneFieldAtlas'), model);
  R.localPreview = model.previews?.filter(item => item.kind === 'transform') || (model.preview?.kind === 'transform' ? [model.preview] : []);
  const preview = updateFieldActionButtons();
  const statusView = $('phoneFieldStatus');
  if (statusView) statusView.textContent = model.awakeIds.length + '/' + model.entities.length + ' objects awake · ' + model.atlas.length + ' coordinate planes · analytic information mix · ' + model.field.materialAuthority;
  const previewView = $('phoneFieldPreview');
  if (previewView) previewView.textContent = preview
    ? preview.kind + ' preview for ' + preview.entityId + ' · local only · ' + (preview.mixWith ? 'mixed with ' + preview.mixWith + ' · ' : '') + 'apply explicitly or discard'
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
function selectPhoneEntity(id, { announce = false, discardPending = true } = {}) {
  const entities = S.state?.entities || {};
  const eye = fieldEnvelope?.eyes?.[fieldEnvelope.currentEyeId];
  const fieldEntities = fieldEnvelope?.snapshot?.spaces?.[eye?.spaceId]?.entities || {};
  const modelEntity = fieldWorld?.model?.entities?.find(entity => entity.id === id);
  const entity = entities[id] || fieldEntities[id] || modelEntity;
  if (!entity) return false;
  const pending = fieldWorld?.commitCandidate();
  const activeObjects = new Set([
    ...[...pointerContacts.values()].map(record => record.target).filter(Boolean),
    ...[...handContacts.values()].map(record => record.entityId).filter(Boolean),
  ]);
  activeObjects.add(id);
  const discardedIds = discardPending ? fieldWorld?.discardPreviewsExcept([...activeObjects]) || [] : [];
  const discarded = discardedIds.length > 0;
  selectedId = id;
  R.selected = id;
  if (S) S.selected = id;
  syncEconomyContext();
  const fieldSelect = $('phoneFieldEntity');
  if (fieldSelect && [...fieldSelect.options].some(option => option.value === id)) fieldSelect.value = id;
  if (fieldWorld && fieldEnvelope) updateFieldWorld(fieldEnvelope);
  updateEyeControls(fieldEnvelope);
  if (announce) status(discarded
    ? `Retargeted to ${entity.name || id}; the previous ${pending.entityId} preview was discarded.`
    : `Selected ${entity.name || id}.`);
  return true;
}
function fieldEntityId() { return selectedId || R.selected || $('phoneFieldEntity')?.value || null; }
function economySelection() {
  const entityId = fieldEntityId();
  const entity = (S.state?.entities || {})[entityId]
    || fieldEnvelope?.snapshot?.spaces?.[fieldEnvelope?.eyes?.[fieldEnvelope?.currentEyeId]?.spaceId]?.entities?.[entityId]
    || null;
  return { active: localMode, entityId, name: entity?.name || entityId || 'selected object' };
}
function syncEconomyContext() { economyContext?.sync(economySelection()); }
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
    baseGeometry: structuredClone(entity.geometry || { scale: 1, rotation: 0, axes: [0, 1] }),
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
function refreshFieldApplySnapshot(options = {}) {
  // Apply lifecycle reads are transactional coordination points, not paint
  // work. Bypass the ordinary render queue so a continuous solver/statechange
  // stream cannot leave a second explicit Apply waiting behind stale frames.
  return refreshSnapshot({ ...options, externalSnapshot: true });
}
async function runFieldApply(pending) {
  pending.phase = 'running';
  let candidate = pending.candidate;
  let current = null;
  try {
    if (pending.cancelled || fieldWorld.isDiscarded(candidate)) return { cancelled: true };
    current = await refreshFieldApplySnapshot({ fieldApplyPreflight: pending });
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
          const expected = {
            worldId: candidate.worldId, branchId: candidate.branchId, eyeId: candidate.eyeId,
            spaceId: candidate.spaceId, entityId: candidate.entityId, baseRevision: candidate.baseRevision,
            operationId: candidate.operationId,
            rebaseOnRevision: true,
          };
          result = candidate.kind === 'transform'
            ? await engine.applyLocalTransform(candidate.entityId, candidate.delta, candidate.geometry, expected)
            : await engine.applyLocalEdit(candidate.entityId, candidate.delta, expected);
        } catch (error) {
          if (!stalePreviewError(error) || applyAttempts >= 3) throw error;
          applyAttempts++;
          current = await refreshFieldApplySnapshot({ fieldApplyRetry: pending, retry: applyAttempts });
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
    await refreshFieldApplySnapshot({ completedApply: { candidate, result }, fieldApply: pending });
    const newerPreview = fieldWorld.commitCandidate();
    if (result?.cancelled) status('Local field Apply was cancelled without changing accepted state.');
    else status(`${result?.replayed ? 'Local field edit replay acknowledged' : 'Local field edit applied explicitly'}${newerPreview && newerPreview.operationId !== candidate.operationId ? '; newer local preview preserved and rebased' : ''}. Canonical authority was not contacted.`);
    return result;
  } catch (error) {
    if (stalePreviewError(error)) {
      let retryMessage = null;
      try {
        current = await refreshFieldApplySnapshot({ fieldApplyError: pending });
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
    ? 'PAGES STATIC/OFFLINE · canonical authority unavailable on this route; local phone state remains independent'
    : mapping.status !== 'available'
    ? (debug.connected ? 'CONNECTED' : 'OFFLINE') + ' · ' + (mapping.code || 'PHONE_OBJECT_UNAVAILABLE') + ' · ' + (mapping.reason || 'Local object is not mapped.')
    : (debug.connected ? 'CONNECTED' : 'OFFLINE') + ' · ' + (debug.local?.mode || 'local') + ' · ' + (debug.local?.dimension || '?') + 'D root · ' + (debug.authorityPersistence?.durable ? 'authority durable' : 'authority memory/session') + ' · ' + (capability.allowed ? 'canonical commit available' : (capability.rejectionCode || 'canonical commit unavailable'));
  if (state) state.textContent = debug.conflict
    ? `CONFLICT · ${debug.message}`
    : statusText + (debug.message ? ` · ${debug.message}` : '');
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
function updateContactModeControls() {
  const control = $('phoneContactMode'), state = $('phoneContactModeState');
  if (!control) return;
  const dimension = S.state?.geometry?.dimension || 4;
  const axis = Math.max(0, Math.min(Number(activeAxis) || 0, dimension - 1));
  const dimensionalOption = control.querySelector('option[value="dimensional"]');
  if (dimensionalOption) dimensionalOption.disabled = axis < 3;
  if (axis < 3 && control.value === 'dimensional') control.value = 'surface';
  contactMode = control.value === 'dimensional' && axis >= 3 ? 'dimensional' : 'surface';
  if (state) state.textContent = contactMode === 'dimensional'
    ? `DIMENSIONAL CONTACT · selected x${axis + 1} position only · visible-plane bimanual shape stays separate · held contacts keep this mapping`
    : 'SURFACE CONTACT · renderer x1/x2/x3 position + ordinary bimanual scale/rotation · held contacts keep their captured mapping';
}
function captureContactMapping(dimension = S.state?.geometry?.dimension || 4) {
  const axis = Math.max(0, Math.min(Number(activeAxis) || 0, dimension - 1));
  const mode = (($('phoneContactMode')?.value || contactMode) === 'dimensional' && axis >= 3) ? 'dimensional' : 'surface';
  return Object.freeze({
    mode, axis,
    surfaceAxes: Object.freeze([0, 2, 1]),
    dimensionalAxes: mode === 'dimensional' ? Object.freeze([axis, 2, 1]) : null,
  });
}
function rendererDepthForObject(objectId) {
  const screenPoint = R.screen?.find(point => point.id === objectId);
  if (screenPoint?.k) return Math.max(0.15, Math.min(1e6, Math.min(R.w || innerWidth || 1, R.h || innerHeight || 1) * 1.18 / screenPoint.k));
  return Math.max(0.15, Number(R.distance) || 10.5);
}
function rendererPointForInput(point, objectId, axes) {
  const envelope = fieldEnvelope, eye = envelope?.eyes?.[envelope.currentEyeId];
  const rect = $('world')?.getBoundingClientRect?.() || { left: 0, top: 0, width: innerWidth || 1, height: innerHeight || 1 };
  if (!eye) return [0, 0, 0];
  return mapRendererPointToCanonical({
    devicePoint: { x: Number(point?.[0]) || 0, y: Number(point?.[1]) || 0 },
    viewport: rect,
    eye,
    renderer: R,
    axes,
    depth: rendererDepthForObject(objectId),
  });
}
function materialAxisGesture(point, objectId, mapping) {
  if (!mapping?.dimensionalAxes) return null;
  // The selected extra coordinate is derived from the same camera inverse as
  // surface contacts. Raw pointer/camera deltas never become canonical q.
  const mapped = rendererPointForInput(point, objectId, mapping.dimensionalAxes);
  return mapped[mapping.axis];
}
function geometryPointForInput(point, objectId, mapping = captureContactMapping()) {
  return rendererPointForInput(point, objectId, mapping.surfaceAxes);
}
function canonicalPointForInput(point, objectId = null, mapping = captureContactMapping(), anchorPoint = null) {
  const surface = geometryPointForInput(point, objectId, mapping);
  if (mapping.mode !== 'dimensional') return surface;
  const q = Array.isArray(anchorPoint) ? [...anchorPoint] : [...surface];
  q[mapping.axis] = materialAxisGesture(point, objectId, mapping);
  return q;
}
function selectedTransformAxes(dimension = S.state?.geometry?.dimension || 4) {
  const axes = [0, 2].filter(axis => axis < dimension);
  for (let axis = 0; axes.length < 2 && axis < dimension; axis++) if (!axes.includes(axis)) axes.push(axis);
  return axes.slice(0, 2);
}
function activeObjectContacts(objectId) { return interactionFabric?.forObject(objectId) || []; }
function beginMaterialFinger({ handId, finger, nodeId = null } = {}) {
  if (!materialInput || !finger?.source || !Array.isArray(finger.point)) return null;
  const contactId = finger.contactId || `finger:${handId}:${finger.fingerId}`;
  if (materialInput.snapshot().some(item => item.contactId === contactId)) return materialHandContacts.get(handId)?.get(contactId) || null;
  const hit = nodeId ? { nodeId } : R.atMaterialNode?.(finger.point[0], finger.point[1]);
  if (!hit?.nodeId) return null;
  const record = {
    contactId, handId, fingerId: finger.fingerId, point: [...finger.point],
    ready: materialInput.begin({
      contactId, source: finger.source, point: finger.point, nodeId: hit.nodeId, gesture: 'pinch',
    }),
    updates: Promise.resolve(),
  };
  record.ready.catch(error => status(`Material finger ${finger.fingerId} could not begin: ${error.message}`));
  const hand = materialHandContacts.get(handId) || new Map();
  hand.set(contactId, record); materialHandContacts.set(handId, hand);
  return record;
}
function updateMaterialFinger(record, point) {
  if (!record || !Array.isArray(point)) return Promise.resolve(null);
  record.point = [...point];
  record.updates = record.updates.then(() => record.ready).then(() => materialInput?.update(record.contactId, point)).catch(error => {
    status(`Material finger update failed: ${error.message}`); return null;
  });
  return record.updates;
}
function releaseMaterialFinger(record, reason = 'release', { cancel = false } = {}) {
  if (!record) return Promise.resolve(null);
  record.releasing = true;
  return record.updates.then(() => record.ready).then(() => materialInput?.end(record.contactId, reason, { cancel })).finally(() => {
    const hand = materialHandContacts.get(record.handId);
    hand?.delete(record.contactId);
    if (hand?.size === 0) materialHandContacts.delete(record.handId);
  });
}
function releaseMaterialHand(handId, reason = 'hand-release', { cancel = false } = {}) {
  const hand = materialHandContacts.get(handId);
  if (!hand) return Promise.resolve([]);
  return Promise.all([...hand.values()].map(record => releaseMaterialFinger(record, reason, { cancel })));
}
function stopMaterialSource(source, reason = 'source-stop') {
  if (!materialInput) return Promise.resolve(null);
  return materialInput.stopSource(source, reason).catch(error => { status(`Material source stop reconciliation required: ${error.message}`); return null; });
}
function beginLocalContact({ contactId, kind, sourceId, objectId, point, gesture = 'grab' } = {}) {
  if (!objectId || !fieldWorld || !engine) return null;
  const identity = localObjectIdentity(objectId);
  if (!identity) return null;
  const mapping = captureContactMapping(identity.baseQ.length);
  const geometryPoint = geometryPointForInput(point, objectId, mapping);
  const canonicalPoint = canonicalPointForInput(point, objectId, mapping);
  interactionFabric?.begin({
    contactId, source: { kind, id: String(sourceId) }, objectId, gesture, canonicalPoint, geometryPoint,
    metadata: {
      transformAxes: selectedTransformAxes(canonicalPoint.length),
      positionAxes: mapping.mode === 'dimensional' ? [mapping.axis] : null,
      contactMode: mapping.mode, activeAxis: mapping.axis,
      inverseAxes: mapping.mode === 'dimensional' ? [...mapping.dimensionalAxes] : [...mapping.surfaceAxes],
    },
  });
  const record = { id: sourceId, contactId, entityId: objectId, point: [...point], canonicalPoint, anchorCanonicalPoint: [...canonicalPoint], geometryPoint, mapping, ...identity, editQueue: new LocalEditQueue() };
  if (kind === 'hand') handContacts.set(contactId, record);
  const objectGesture = beginObjectTouchGesture(objectId);
  objectGesture?.contacts.add(contactId);
  previewObjectTouchGesture(objectId);
  return record;
}
function updateLocalContact(record, point, gesture = 'drag') {
  if (!record) return null;
  const canonicalPoint = canonicalPointForInput(point, record.entityId, record.mapping, record.anchorCanonicalPoint);
  const geometryPoint = geometryPointForInput(point, record.entityId, record.mapping);
  record.point = [...point]; record.canonicalPoint = canonicalPoint; record.geometryPoint = geometryPoint;
  interactionFabric?.update(record.contactId || record.id, { canonicalPoint, geometryPoint, gesture });
  return canonicalPoint;
}
function fenceHandEdits(reason = 'hand-fence') {
  for (const contactId of [...handContacts.keys()]) {
    const contact = handContacts.get(contactId); contact?.editQueue?.stop();
    releaseHandContact(contactId, reason);
  }
  handContacts.clear();
  for (const [handId, contacts] of [...materialHandContacts.entries()]) {
    const source = [...contacts.values()][0]?.source || { kind: 'hand', sourceId: handId, sessionId: materialInput?.sessionId, generation: 1 };
    stopMaterialSource({ kind: 'hand', sourceId: handId, sessionId: source.sessionId, generation: source.generation }, reason);
  }
  materialHandContacts.clear();
}
function releaseHandContact(contactId, reason = 'hand-release') {
  const contact = handContacts.get(contactId);
  if (!contact) return Promise.resolve(null);
  if (/cancel|lost|missing|fence|stop|hidden|ambiguous|worker|disconnect|two-hand/i.test(String(reason))) contact.editQueue?.stop?.();
  if (handContacts.get(contactId) === contact) return finishLocalContact(contactId, reason);
  return Promise.resolve({ cancelled: true, status: 'stale-contact' });
}
function handleTwoHandObjectGesture(event) {
  const points = Array.isArray(event.points) ? event.points : [];
  if (points.length < 2) return false;
  const hits = points.map(point => R.at(...point));
  if (!hits.some(Boolean)) return false;
  for (let index = 0; index < Math.min(2, points.length); index++) {
    const handId = event.hands?.[index]; if (!handId) continue;
    const contactId = 'hand:' + handId, hit = hits[index];
    if (hit && !handContacts.has(contactId)) {
      selectPhoneEntity(hit, { announce: false });
      beginLocalContact({ contactId, kind: 'hand', sourceId: handId, objectId: hit, point: points[index], gesture: 'pinch' });
    }
    const contact = handContacts.get(contactId); if (!contact) continue;
    updateLocalContact(contact, points[index], 'scale');
    previewObjectTouchGesture(contact.entityId);
  }
  return true;
}
function handleFieldHandGesture(event) {
  if (!localMode) return;
  if (event.type === 'lost') {
    if (event.handId) releaseHandContact('hand:' + event.handId, event.reason || 'hand-lost');
    else for (const contactId of [...handContacts.keys()]) releaseHandContact(contactId, event.reason || 'tracking-lost');
    if (event.handId) releaseMaterialHand(event.handId, event.reason || 'hand-lost', { cancel: true });
    else for (const handId of [...materialHandContacts.keys()]) releaseMaterialHand(handId, event.reason || 'tracking-lost', { cancel: true });
    R.pointer = null; lastPoseByHand.clear(); return;
  }
  if (event.type === 'frame') {
    const active = new Map(event.hands.map(hand => ['hand:' + hand.id, hand]));
    for (const [contactId, contact] of [...handContacts.entries()]) {
      const hand = active.get(contactId);
      if (!hand) releaseHandContact(contactId, 'hand-missing');
      else if (hand.pose !== 'pinch' && activeObjectContacts(contact.entityId).some(item => item.contactId === contactId)) releaseHandContact(contactId, hand.pose || 'hand-release');
    }
    for (const hand of event.hands) {
      const contacts = materialHandContacts.get(hand.id);
      if (!contacts) continue;
      const fingertips = new Map((hand.fingertips || []).map(finger => [finger.fingerId, finger]));
      for (const record of [...contacts.values()]) {
        const finger = fingertips.get(record.fingerId);
        if (finger) updateMaterialFinger(record, finger.point);
        else releaseMaterialFinger(record, 'finger-missing', { cancel: true });
      }
      if (hand.pose !== 'pinch') releaseMaterialHand(hand.id, hand.pose || 'hand-release');
    }
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
      if (hit) { selectPhoneEntity(hit, { announce: true }); lastPoseAction = now; }
    } else if (event.pose === 'peace') {
      R.overview = !R.overview; updateProjectionState({ mode: R.overview ? 'overview' : 'slice' });
      status('PEACE · ' + (R.overview ? 'overview' : 'current slice')); lastPoseAction = now;
    } else if (event.pose === 'thumbs-up') {
      activeAxis = (activeAxis + 1) % (S.state?.geometry.dimension || 4);
      const axis = $('phoneAxis'); if (axis) axis.value = String(activeAxis);
      status('THUMBS-UP · move axis x' + (activeAxis + 1)); lastPoseAction = now;
    }
    return;
  }
  if (event.type === 'grab') {
    const hit = R.at(...event.point), contactId = 'hand:' + event.handId;
    if (hit === PHONE_MATERIAL_ENTITY_ID && event.fingertips?.length) {
      const fingers = event.fingertips.map(finger => beginMaterialFinger({ handId: event.handId, finger })).filter(Boolean);
      if (fingers.length) {
        selectPhoneEntity(hit, { announce: false });
        status(`HAND MATERIAL GRAB · ${hit} · ${fingers.length} independent fingertip contact(s)`);
        return;
      }
    }
    if (hit && !handContacts.has(contactId)) {
      selectPhoneEntity(hit, { announce: false });
      beginLocalContact({ contactId, kind: 'hand', sourceId: event.handId, objectId: hit, point: event.point, gesture: 'grab' });
      status('HAND GRAB · ' + hit);
    }
    return;
  }
  if (event.type === 'move' && materialHandContacts.has(event.handId)) {
    const contacts = materialHandContacts.get(event.handId);
    for (const record of contacts.values()) {
      const finger = event.fingertips?.find(item => item.fingerId === record.fingerId);
      if (finger) updateMaterialFinger(record, finger.point);
    }
    return;
  }
  const contactId = 'hand:' + event.handId, contact = handContacts.get(contactId);
  if (event.type === 'move' && contact) {
    updateLocalContact(contact, event.point, 'drag');
    previewObjectTouchGesture(contact.entityId);
    return;
  }
  if (event.type === 'release') {
    if (materialHandContacts.has(event.handId)) releaseMaterialHand(event.handId, event.reason || 'release', { cancel: /lost|missing|cancel|stop|fence|disconnect|ambiguous|worker/i.test(String(event.reason || '')) });
    if (contact) releaseHandContact(contactId, event.reason || 'release');
    return;
  }
  if (event.type === 'twohand') {
    if (!handleTwoHandObjectGesture(event)) {
      if (event.scale > 0.01 && Number.isFinite(event.scale)) R.distance = clamp(R.distance / event.scale, 4, 22);
      R.yaw = (R.yaw - event.rotation + Math.PI * 4) % (Math.PI * 2);
      updateProjectionState({ mode: R.overview ? 'overview' : 'slice', scale: R.distance, rotation: R.yaw });
    }
    return;
  }
  if (event.type === 'swipe' && !handContacts.size && S.state) {
    const ids = Object.keys(S.state.entities), i = ids.indexOf(R.selected), step = event.dx < 0 ? 1 : -1;
    selectPhoneEntity(ids[(i + step + ids.length) % ids.length], { announce: true });
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
  onHands: hands => { const view = $('cameraState'); if (hands.length && view) view.textContent = 'Tracking ' + hands.length + ' hand(s) · 21 landmarks · all five fingers · local only.'; },
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
  const enter = button('enterPhoneLocal', 'Enter local Vivo · works offline', 'primary');
  enter.setAttribute('aria-describedby', 'phoneLocalNote');
  const note = Object.assign(document.createElement('p'), { id: 'phoneLocalNote', className: 'muted', textContent: 'Phone engine runs locally. Objects keep stable IDs; each Eye and projection stays independent. Camera stays off until you start it.' });
  $('createRoom')?.before(enter, note);
  enter.onclick = () => startLocal().catch(error => status(error.message));
  const nav = button('phonePanelButton', 'Advanced', 'secondary');
  nav.type = 'button'; nav.onclick = openPhonePanel; $('toolbar')?.append(nav);
  // The phone route owns a compact field dock in the page shell. Keep one
  // advanced sheet instance so the existing controls retain their IDs and
  // handlers without duplicating the field controls.
  document.querySelector('#panel .sheet[data-sheet="phone"]')?.remove();
  const sheet = document.createElement('div'); sheet.className = 'sheet'; sheet.dataset.sheet = 'phone'; sheet.innerHTML = `
    <h3>Viva Phone Engine</h3><p id="phoneEngineState" class="muted">Local engine closed. World state and Eyes are stored on this device.</p>
    <p id="phoneEyeInfo" class="muted"></p>
    <label>Active Eye<select id="phoneEyeSelect"></select></label><div class="row"><button id="phoneNewEye">Create independent Eye</button><button id="phonePersist">Save now</button></div>
    <label>Active material axis<select id="phoneAxis"></select></label><div class="row"><button id="phoneAxisMinus">− Move selected</button><button id="phoneAxisPlus">+ Move selected</button></div>
    <label>Contact movement mode<select id="phoneContactMode"><option value="surface">Surface contact · x1/x2/x3 + bimanual shape</option><option value="dimensional">Dimensional contact · selected x4+ position</option></select></label><p id="phoneContactModeState" class="muted">Surface contact uses the renderer plane. Choose x4+ to enable dimensional contact.</p>
    <div class="row"><button id="phoneEnterNested">Enter selected inner world</button><button id="phoneExitNested">Return with this Eye</button></div>
    <div class="row"><button id="phoneFork">Create explicit offline branch</button><button id="phoneExport">Export world + Eyes</button></div>
    <hr><h3>Hands-free input & projection</h3><p class="muted">Up to two hands · all 21 landmarks and all five articulated fingers · local inference. Open, point, peace, thumbs-up, fist and pinch poses; two hands zoom and rotate; touch drag/pinch also work. Object scale/rotation uses the visible renderer x1/x3 plane; the atlas axis selectors stay a separate view choice. Camera frames stay on this phone.</p>
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
    <p class="muted">Native camera permission, accessibility, notifications, files and projection are controlled in the Companion. Accessibility actions remain user-revocable; passwords are never returned or logged.</p>
    <hr><h3>Local agent stop / revoke</h3>
    <p class="muted">This is an in-app local control. The page user registers, stops and explicitly re-enables exact sources; agent-facing tools cannot acquire a new session. Stopped work is fenced; grant refresh never silently re-enables it. Same-page role separation is not Android/browser permission security.</p>
    <label>Registered source<input id="phoneAgentSource" maxlength="154" value="worker" autocomplete="off" spellcheck="false"></label>
    <button id="phoneRegisterAgent" type="button">Register / explicitly re-enable source</button>
    <p id="phoneAgentControlStatus" class="muted" role="status" aria-live="polite">No registered local agents.</p>
    <div id="phoneAgentSessions" class="agent-session-list" aria-live="polite"></div>`;
  const fieldHeading = [...sheet.querySelectorAll('h3')].find(node => node.textContent.includes('Information field + plane atlas'));
  if (fieldHeading) {
    fieldHeading.previousElementSibling?.remove();
    let node = fieldHeading;
    while (node) {
      const next = node.nextElementSibling;
      if (node.tagName === 'HR' && next?.textContent.includes('Canonical authority')) break;
      node.remove();
      node = next;
    }
  }
  $('panel')?.append(sheet);
  document.querySelectorAll('[data-local-cap]').forEach(input => { input.checked = localGrants().includes(input.dataset.localCap); input.addEventListener('change', updateLocalGrants); });
  $('phoneEyeSelect').onchange = () => engine?.selectEye($('phoneEyeSelect').value).catch(error => status(error.message));
  $('phoneNewEye').onclick = async () => { await engine.createEye(`Eye ${Object.keys((await engine.snapshot()).eyes).length + 1}`); await refreshSnapshot(); };
  $('phonePersist').onclick = async () => {
    try { await reportPersistenceStatus('save', engine.persist()); }
    catch (error) { status(`Local Vivo state could not be saved: ${error.message}. Retry remains available.`); }
  };
  $('phoneAxis').onchange = () => { activeAxis = Number($('phoneAxis').value); updateContactModeControls(); };
  $('phoneContactMode').onchange = () => {
    updateContactModeControls();
    status(contactMode === 'dimensional'
      ? `DIMENSIONAL CONTACT ARMED · new touch/hand contacts use x${activeAxis + 1}; held contacts keep their captured mapping.`
      : 'SURFACE CONTACT ARMED · new touch/hand contacts use the visible renderer plane; held contacts keep their captured mapping.');
  };
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
  $('phoneStartHands').onclick = () => startCameraFromButton({ facing: 'user', start: startPhoneCamera, status, activeMessage: 'Two-hand tracking active · local worker · camera frames stay on this phone.' });
  $('phoneStartBackHands').onclick = () => startCameraFromButton({ facing: 'environment', start: startPhoneCamera, status, activeMessage: 'Rear camera · two-hand tracking active locally.' });
  $('phoneStopHands').onclick = () => { stopPhoneCamera(); status('Camera stopped. Touch controls remain available.'); };
  $('phoneProject').onclick = async () => { try { const result = await projection.start(); $('phoneProjectionState').textContent = `Projection route: ${result.route} · camera track ${result.cameraTrack}. OS/browser may pause camera when the page is backgrounded.`; } catch (error) { $('phoneProjectionState').textContent = `${error.message} The camera remains local; touch still works.`; } };
  $('phoneStopProject').onclick = () => { projection.stop(); $('phoneProjectionState').textContent = 'Projection mode stopped; camera can continue until you stop it.'; };
  const refreshFieldControls = () => updateFieldWorld(fieldEnvelope);
  $('phoneFieldQuery').oninput = refreshFieldControls;
  $('phoneFieldThreshold').oninput = refreshFieldControls;
  $('phoneFieldLayout').onchange = refreshFieldControls;
  for (const id of ['phoneFieldAxisA', 'phoneFieldAxisB', 'phoneFieldAxisC']) $(id).onchange = refreshFieldControls;
  $('phoneFieldEntity').onchange = event => { selectPhoneEntity(event.target.value, { announce: true }); };
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
  $('phoneRegisterAgent').onclick = () => {
    const value = $('phoneAgentSource').value.trim();
    if (!value) { status('Enter an exact local agent source before registering.'); return; }
    try {
      const agent = registry.registerAgent({ sourceId: value, label: value });
      updateAgentControlUI();
      status(`${agent.status === 'active' && agent.generation > 1 ? 'LOCAL AGENT RE-ENABLED' : 'LOCAL AGENT REGISTERED'} · ${agent.sourceId} · generation ${agent.generation}`);
    } catch (error) { status(error.message); }
  };
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
  projection.addEventListener('change', event => { $('phoneProjectionState').textContent = `Projection ${event.detail.type} · ${event.detail.route} · camera ${event.detail.cameraTrack} · frames uploaded: no`; });
  bridge.addEventListener('ready', refreshNativeTools);
  bridge.addEventListener('message', event => {
    if (event.detail.kind === 'tools') { const tools = hostToolCaps(event.detail); updateAgentList(tools); }
    if (event.detail.kind === 'event' && event.detail.name === 'orientation') window.dispatchEvent(new CustomEvent('vivo:orientation', { detail: event.detail.value }));
    if (event.detail.kind === 'agent-action') {
      const { id, name, args = {}, sessionId, generation } = event.detail;
      const session = sessionId ? { sessionId, ...(generation === undefined ? {} : { generation }) } : null;
      Promise.resolve(name?.startsWith('vivo.')
        ? registry.invoke(name, args, { session })
        : name === 'phone.camera.start' ? startPhoneCamera(args.facing === 'environment' ? 'environment' : 'user')
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
  if (engine) {
    localMode = true;
    agentController.setFabric(interactionFabric);
    updateLocalGrants();
    document.body.classList.add('phone-local');
    const state = await engine.snapshot();
    publishedEnvelope = state;
    renderedSnapshot = snapshotMarker(state);
    renderEye(state);
    window.dispatchEvent(new CustomEvent('vivo:phone-local-ready', { detail: { worldId: state.snapshot.worldId, branchId: state.branchId, state } }));
    economyContext?.initialize();
    syncEconomyContext();
    await authority?.syncLocal(state);
    updatePhoneAuthorityUI();
    return;
  }
  status("Starting the local worker and opening this phone’s saved Vivo world…");
  engine = new PhoneEngineClient();
  engine.addEventListener('statechange', event => {
    if (event.detail?.state && localMode) {
      const published = publishEnvelope(event.detail.state);
      window.dispatchEvent(new CustomEvent('vivo:phone-statechange', {
        detail: { reason: event.detail.reason || null, state: published },
      }));
      enqueueSnapshot(() => published, { stateEvent: event.detail.reason }).catch(() => {});
    }
    if (event.detail?.state && authority) authority.syncLocal(event.detail.state).catch(() => {});
    if (event.detail?.reason === 'step-error') status(event.detail.error || 'Local material step stopped safely.');
    if (event.detail?.reason === 'persistence-failed') status(`Local Vivo state changed but was not saved: ${event.detail.state?.persistence?.error || 'storage failed'}. Retry remains available.`);
  });
  const rootDimension = Number($('createD')?.value) || 4;
  const state = await engine.open(getWorldId(), rootDimension);
  materialInput = new PhoneMaterialInputRuntime({
    engine, renderer: R,
    getEnvelope: () => engine.snapshot(),
    getViewport: () => canvas?.getBoundingClientRect?.() || { left: 0, top: 0, width: innerWidth || 1, height: innerHeight || 1 },
    onPreview: (preview, record) => {
      R.materialEditing = Boolean(preview?.provisional);
      if (!preview?.provisional) { R.materialProvisional = null; return; }
      const accepted = fieldEnvelope?.snapshot?.materialBodies?.[PHONE_MATERIAL_ENTITY_ID] || state.snapshot.materialBodies?.[PHONE_MATERIAL_ENTITY_ID] || {};
      R.materialProvisional = {
        ...accepted, nodes: preview.nodes, edges: preview.edges,
        bodyRevision: preview.bodyRevision, physicsTick: preview.physicsTick,
        provisional: true, contactId: record?.contactId || null,
      };
      R.draw(performance.now());
    },
    onState: event => { if (event.type === 'material-begin') status(`MATERIAL CONTACT · ${event.nodeId} · ${event.source?.kind || 'source'}`); },
  });
  fieldWorld = new FieldWorldController(state, { selectedId: selectedId || R.selected || null });
  interactionFabric = new SpatialInteractionFabric();
  agentController.setFabric(interactionFabric);
  authority = new PhoneAuthorityAdapter({ engine, onState: updatePhoneAuthorityUI });
  await authority.syncLocal(state);
  localMode = true; updateLocalGrants(); document.body.classList.add('phone-local'); publishedEnvelope = state; renderedSnapshot = snapshotMarker(state); renderEye(state);
  window.dispatchEvent(new CustomEvent('vivo:phone-local-ready', { detail: { worldId: state.snapshot.worldId, branchId: state.branchId, state } }));
  economyContext?.initialize();
  syncEconomyContext();
  $('welcome').hidden = true; $('toolbar').hidden = false;
  const caps = await detectPhoneCapabilities(); latestCapabilities = caps;
  $('phoneEngineState').textContent = `Worker ready · ${caps.webgpu ? 'WebGPU available' : caps.webgl2 ? 'WebGL2 renderer' : 'Canvas renderer'} · ${caps.wasm ? 'WASM-ready' : 'JS fallback'} · sparse ${state.snapshot.spaces.root.dimension}D root / ${state.snapshot.spaces.inner.dimension}D nested · IndexedDB ${caps.indexedDb ? 'available' : 'unavailable'}.`;
  $('phoneCapabilityState').textContent = `Browser capabilities: ${Object.entries(caps).filter(([, value]) => value === true).map(([name]) => name).join(' · ') || 'touch only'}. Graphics capability is detected independently from the sparse worker solver.`;
  if (bridge.available) await refreshNativeTools().catch(() => {});
  status('LOCAL VIVO · same persistent objects · independent Eye · no server required.');
}
async function forkPhoneOffline(label) {
  fenceHandEdits('offline-fork');
  return engine?.forkOffline(label);
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
    const shellUrl = STATIC_PHONE_ROUTE ? new URL('./index.html', import.meta.url) : new URL('../index.html', import.meta.url);
    // The active worker owns the cache version. Match by URL so this page
    // cannot drift from a renamed shell cache during a fresh install.
    const shell = await caches.match(shellUrl);
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

// Local mode captures touch before the shared-network handlers. Contacts feed
// one object-level provisional transform; accepted state changes only once the
// final contact releases, while cancellation discards the whole object gesture.
const canvas = $('world');
function objectTouchRecords(objectId) {
  return [...pointerContacts.values()].filter(record => record.target === objectId);
}
function promoteMaterialTouchRecords(objectId, reason = 'bimanual-rigid-transform') {
  const records = objectTouchRecords(objectId).filter(record => record.material);
  for (const record of records) {
    const contact = beginLocalContact({
      contactId: record.contactId, kind: 'touch', sourceId: String(record.id),
      objectId, point: [record.x, record.y], gesture: 'touch',
    });
    if (!contact) continue;
    // A second touch changes the gesture class to the existing rigid
    // bimanual path. Fence the material actuator after any already-submitted
    // target, while the captured rigid contact owns subsequent transforms.
    record.material = false;
    record.materialUpdates = record.materialUpdates.then(() => record.materialPromise)
      .then(() => materialInput?.end(record.contactId, reason, { cancel: true }))
      .catch(error => status(`Material-to-rigid handoff requires reconciliation: ${error.message}`));
    record.canonicalPoint = [...contact.canonicalPoint];
    record.anchorCanonicalPoint = [...contact.anchorCanonicalPoint];
    record.mapping = contact.mapping;
  }
  return records.length;
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
    editQueue: new LocalEditQueue(),
    lastPreview: null,
    lastCandidate: null,
  };
  touchGestures.set(objectId, gesture);
  return gesture;
}
function transformAxesForPreview(objectId, preview) {
  const geometricChange = Math.abs(Number(preview?.scale || 1) - 1) > 1e-9 || Math.abs(Number(preview?.rotation || 0)) > 1e-9;
  const entity = fieldWorld?.entity(objectId);
  return geometricChange ? preview?.axes : (entity?.baseGeometry?.axes || entity?.geometry?.axes || preview?.axes);
}
function previewObjectTouchGesture(objectId) {
  const gesture = touchGestures.get(objectId), dimension = S.state?.geometry?.dimension || 4;
  const hasHand = activeObjectContacts(objectId).some(item => item.source?.startsWith('hand:'));
  const preview = hasHand
    ? interactionFabric?.preview(objectId, dimension) || null
    : interactionFabric?.preview(objectId, dimension, { sourceKinds: ['touch'] }) || null;
  if (gesture) gesture.lastPreview = preview;
  if (gesture && preview) {
    try {
      gesture.lastCandidate = fieldWorld.previewTransform(objectId, { translation: preview.translation, scale: preview.scale, rotation: preview.rotation, axes: transformAxesForPreview(objectId, preview) });
      updateFieldWorld();
      status(`LOCAL PROVISIONAL · ${objectId} · ${preview.contactCount} contact(s) · translation ${preview.translation.map(value => value.toFixed(2)).join(',')} · shape ${preview.scale.toFixed(2)}x / ${(preview.rotation * 180 / Math.PI).toFixed(1)}° · release to apply or cancel to discard`);
    } catch (error) { status(error.message); }
  }
  return preview;
}
function releaseObjectTouchContacts(objectId, reason) {
  for (const record of objectTouchRecords(objectId)) {
    if (record.material) {
      record.released = true;
      record.materialUpdates = record.materialUpdates.then(() => record.materialPromise).then(() => materialInput?.end(record.contactId, reason, { cancel: true })).catch(error => status(error.message));
    } else finishLocalContact('touch:' + record.id, reason).catch(error => status(error.message));
    pointerContacts.delete(record.id);
  }
}
function releaseObjectTouchContact(record, reason) {
  if (!record?.target) return;
  if (record.material) {
    record.released = true;
    const cancel = /cancel|lost|missing|fence|stop|hidden|ambiguous|worker|disconnect/i.test(String(reason));
    record.materialUpdates = record.materialUpdates.then(() => record.materialPromise).then(() => materialInput?.end(record.contactId, reason, { cancel })).catch(error => status(error.message));
  } else finishLocalContact('touch:' + record.id, reason).catch(error => status(error.message));
  pointerContacts.delete(record.id);
}
function fenceLocalContacts(reason = 'scope-transition') {
  const objectIds = new Set([
    ...[...pointerContacts.values()].map(record => record.target).filter(Boolean),
    ...touchGestures.keys(),
  ]);
  for (const objectId of objectIds) cancelObjectTouchGesture(objectId, reason);
  fenceHandEdits(reason);
  pointerContacts.clear();
  pinch = null;
}
function cancelObjectTouchGesture(objectId, reason = 'touch-cancel') {
  releaseObjectTouchContacts(objectId, reason);
  touchGestures.delete(objectId);
  fieldWorld?.discardPreview({ entityId: objectId });
  interactionFabric?.clearObjectAggregate(objectId);
  updateFieldWorld();
  status(`LOCAL PROVISIONAL DISCARDED · ${objectId} · ${reason}`);
}
function rebaseAcceptedContact(contactId, appliedPoint) {
  // The fabric already rebases during a selective release; this guarded hook
  // keeps an accepted live contact anchored for adapters that finish a commit
  // without ending the contact first.
  return interactionFabric?.rebase(contactId, appliedPoint);
}
async function commitObjectTouchGesture(objectId, preview) {
  const gesture = touchGestures.get(objectId);
  touchGestures.delete(objectId);
  const shapeChanged = Boolean(preview?.geometry && JSON.stringify(preview.geometry) !== JSON.stringify(gesture?.baseGeometry));
  if (!gesture || !preview || (!preview.delta?.some(value => value !== 0) && !shapeChanged)) {
    interactionFabric?.clearObjectAggregate(objectId);
    fieldWorld?.discardPreview({ entityId: objectId }); updateFieldWorld();
    return null;
  }
  try {
    const contact = gesture;
    const queued = await contact.editQueue.enqueue({
      submit: () => {
        const operation = touchApplyTail.then(async () => {
          let candidate = fieldWorld?.previewFor(objectId) || preview;
          for (let attempt = 0; attempt <= 5; attempt++) {
            const current = fieldWorld?.previewFor(objectId);
            if (current && current.operationId !== preview.operationId) return { changed: false, cancelled: true, status: 'newer-preview' };
            if (!current && fieldWorld?.isDiscarded(preview)) return { changed: false, cancelled: true, status: 'discarded-preview' };
            candidate = current || candidate || preview;
            const expected = {
              worldId: contact.worldId, branchId: contact.branchId, eyeId: contact.eyeId,
              spaceId: contact.spaceId, entityId: contact.entityId, baseRevision: candidate.baseRevision,
              operationId: candidate.operationId || contact.operationId,
              rebaseOnRevision: candidate.rebaseOnRevision === true,
            };
            expected.worldId = candidate.worldId || expected.worldId;
            expected.branchId = candidate.branchId ?? expected.branchId;
            expected.eyeId = candidate.eyeId || expected.eyeId;
            expected.spaceId = candidate.spaceId || expected.spaceId;
            expected.entityId = candidate.entityId || expected.entityId;
            try {
              return await engine.applyLocalTransform(objectId, candidate.delta, candidate.geometry, expected);
            } catch (error) {
              if (!stalePreviewError(error) || attempt >= 5) throw error;
              const currentEnvelope = await refreshSnapshot({ touchApplyRetry: { entityId: objectId, operationId: preview.operationId, attempt } });
              const refreshed = fieldWorld?.previewFor(objectId);
              if (refreshed?.operationId === preview.operationId) candidate = refreshed;
              else {
                const rebased = fieldWorld?.rebaseCandidate(candidate, currentEnvelope);
                if (!rebased) throw error;
                candidate = rebased;
              }
            }
          }
          throw new Error('Local touch transform remained stale after bounded retries.');
        });
        touchApplyTail = operation.catch(() => {});
        return operation;
      },
    });
    if (!queued.submitted) return { cancelled: true, status: queued.status };
    const result = queued.result;
    if (fieldWorld?.isCurrent(preview)) fieldWorld.clearAppliedPreview(preview);
    await refreshSnapshot();
    status(`${result?.replayed ? 'LOCAL PROVISIONAL REPLAY ACKNOWLEDGED' : 'LOCAL PROVISIONAL APPLIED'} · ${objectId} · canonical authority was not contacted.`);
    reportPersistenceStatus('release', engine?.lastPersistence).catch(error => status('Local transform persistence status unavailable: ' + error.message + '. Retry remains available.'));
    return result;
  } finally {
    interactionFabric?.clearObjectAggregate(objectId);
    const current = fieldWorld?.previewFor(objectId);
    if (!current || current.operationId === preview?.operationId) fieldWorld?.discardPreview({ entityId: objectId, mark: false });
    updateFieldWorld();
  }
}
function finishLocalContact(contactId, reason = 'release') {
  const contact = handContacts.get(contactId);
  const tracked = interactionFabric?.snapshot().contacts.find(item => item.contactId === contactId);
  const objectId = contact?.entityId || tracked?.objectId;
  if (!objectId) return Promise.resolve(null);
  const result = interactionFabric?.end(contactId, reason);
  handContacts.delete(contactId);
  touchGestures.get(objectId)?.contacts.delete(contactId);
  if (activeObjectContacts(objectId).length) {
    previewObjectTouchGesture(objectId);
    return Promise.resolve(result);
  }
  if (/cancel|lost|missing|fence|stop|hidden|ambiguous|worker|disconnect|two-hand/i.test(String(reason))) {
    touchGestures.delete(objectId); interactionFabric?.clearObjectAggregate(objectId);
    fieldWorld?.discardPreview({ entityId: objectId }); updateFieldWorld();
    return Promise.resolve(result);
  }
  const preview = interactionFabric?.preview(objectId, S.state?.geometry?.dimension || 4);
  const gesture = touchGestures.get(objectId);
  const candidate = preview
    ? fieldWorld?.previewTransform(objectId, { translation: preview.translation, scale: preview.scale, rotation: preview.rotation, axes: transformAxesForPreview(objectId, preview) })
    : gesture?.lastCandidate || null;
  return commitObjectTouchGesture(objectId, candidate).then(() => result);
}
canvas.addEventListener('pointerdown', event => {
  if (!localMode) return;
  event.preventDefault(); event.stopImmediatePropagation(); canvas.setPointerCapture(event.pointerId);
  const contactId = 'touch:' + event.pointerId;
  const point = [event.clientX, event.clientY];
  const target = R.at(event.clientX, event.clientY);
  const record = { id: event.pointerId, contactId, x: point[0], y: point[1], target, canonicalPoint: null, mapping: null, anchorCanonicalPoint: null, released: false };
  pointerContacts.set(event.pointerId, record);
  if (target) {
    selectPhoneEntity(target, { announce: true });
    const materialPeers = target === PHONE_MATERIAL_ENTITY_ID
      ? objectTouchRecords(target).filter(item => item.material)
      : [];
    const hasExistingRigidTarget = [...pointerContacts.values()].some(item => item.id !== event.pointerId && item.target && !item.material);
    if (materialPeers.length) promoteMaterialTouchRecords(target);
    const materialHit = target === PHONE_MATERIAL_ENTITY_ID ? R.atMaterialNode?.(point[0], point[1]) : null;
    if (materialHit && materialInput && contactMode !== 'dimensional' && !materialPeers.length && !hasExistingRigidTarget) {
      record.material = true; record.materialNodeId = materialHit.nodeId;
      record.materialUpdates = Promise.resolve();
      record.materialPromise = materialInput.begin({
        contactId, point, nodeId: materialHit.nodeId,
        source: { kind: 'touch', sourceId: String(event.pointerId), sessionId: materialInput.sessionId },
        gesture: 'touch',
      }).catch(error => { status(`Material touch could not begin: ${error.message}`); return null; });
    } else {
      const contact = beginLocalContact({ contactId, kind: 'touch', sourceId: String(event.pointerId), objectId: target, point, gesture: 'touch' });
      if (contact) {
        record.canonicalPoint = [...contact.canonicalPoint];
        record.anchorCanonicalPoint = [...contact.anchorCanonicalPoint];
        record.mapping = contact.mapping;
      }
    }
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
  if (record.material) {
    record.materialUpdates = record.materialUpdates.then(() => record.materialPromise).then(() => materialInput?.update(record.contactId, [record.x, record.y]));
    return;
  }
  if (record.target && record.mapping && S.state?.entities[record.target]) {
    updateLocalContact(record, [record.x, record.y], 'drag');
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
  if (record?.material) {
    if (event.type === 'lostpointercapture' && record.released) return;
    const cancel = event.type !== 'pointerup';
    record.released = true;
    const reason = cancel ? (event.type === 'pointercancel' ? 'touch-cancel' : 'lost-pointer-capture') : 'touch-release';
    record.materialUpdates = record.materialUpdates.then(() => record.materialPromise).then(() => materialInput?.end(record.contactId, reason, { cancel }));
    record.materialUpdates.catch(error => status(`Material touch release failed: ${error.message}`));
    pointerContacts.delete(event.pointerId);
    return;
  }
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
        status(`LOCAL PROVISIONAL DISCARDED · ${objectId} · ${reason}`);
      } else previewObjectTouchGesture(objectId);
    } else {
      const objectId = record.target;
      record.released = true;
      releaseObjectTouchContact(record, 'touch-release');
      const active = objectTouchRecords(objectId);
      if (active.length) previewObjectTouchGesture(objectId);
    }
  } else if (record) {
    pointerContacts.delete(event.pointerId);
  }
  const views = [...pointerContacts.values()].filter(item => !item.target);
  if (views.length < 2) pinch = null;
};
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, pointerEnd, { capture: true });

  // This is an agent-facing capability surface. Registration, stop and
  // re-enable stay on the separate user-admin surface below. Both objects
  // live in the same page, so this is role separation within the documented
  // local trust model, not browser/Android OS permission security.
  window.VivaAgentTools = Object.freeze({
    list: () => registry.list(),
    listFor: session => registry.listFor(session),
    invoke: (name, args, context) => registry.invoke(name, args, context),
    invokeFor: (session, name, args) => registry.invokeFor(session, name, args),
  });
  window.VivaPhoneAgentAdmin = Object.freeze({
    register: spec => registry.registerAgent(spec),
    stop: (session, reason) => registry.stopAgent(session, reason),
    reenable: sourceOrSession => registry.reenableAgent(sourceOrSession),
    beginContact: (session, values) => registry.beginContact(session, values),
    updateContact: (session, contactId, values) => registry.updateContact(session, contactId, values),
    endContact: (session, contactId, reason) => registry.endContact(session, contactId, reason),
    agents: () => registry.agents(),
    revokeAll: () => registry.revokeAll(),
    audit: () => structuredClone(registry.audit),
  });
window.VivaPhoneEngine = Object.freeze({
  get active() { return !!engine && localMode; }, get available() { return browserCapabilities.worker; },
  // Keep the public read paired with the rendered field-world envelope. A
  // direct worker snapshot can be newer than the preview model while the
  // sparse solver is still stepping, which makes an active preview appear to
  // drift from the coordinate it is actually based on.
  snapshot: () => refreshSnapshot({ externalSnapshot: true }), select: id => selectPhoneEntity(id, { announce: false }), translate: (...args) => engine?.translate(...args), applyLocalEdit: (...args) => engine?.applyLocalEdit(...args), applyLocalTransform: (...args) => engine?.applyLocalTransform(...args), setEye: patch => engine?.setEye(patch),
  materialSnapshot: () => engine?.materialSnapshot(),
  materialBegin: payload => engine?.materialBegin(payload),
  materialTarget: payload => engine?.materialTarget(payload),
  materialEnd: payload => engine?.materialEnd(payload),
  materialCancel: payload => engine?.materialCancel(payload),
  materialStopSource: payload => engine?.materialStopSource(payload),
  materialStep: dt => engine?.materialStep(dt),
  materialPreview: payload => engine?.materialPreview(payload),
  materialPreviewContact: (contactId, point) => materialInput?.preview(contactId, point),
  materialReconcile: payload => engine?.materialReconcile(payload),
  materialReconcileOperation: operationId => engine?.materialReconcileOperation(operationId),
  materialContacts: () => materialInput?.snapshot() || [],
  forkOffline: label => forkPhoneOffline(label), startCamera: (facing = 'user') => startPhoneCamera(facing), stopCamera: stopPhoneCamera,
  authority: () => authority?.debug() || null,
  connectAuthority: options => authority?.connect(options), readAuthority: () => authority?.read(),
  previewAuthority: options => authority?.preview(options), publishAuthority: () => authority?.publish(),
  commitAuthority: () => authority?.commit(),
  fieldWorld: () => fieldWorld?.model || null,
  publishedSnapshot: () => publishedEnvelope,
  interaction: () => interactionFabric?.snapshot() || null,
  agentControl: () => ({ schema: 'vivo.phone.agent-control/1', agents: registry.agents() }),
  syntheticHandLandmarks: (hands, options = {}) => {
    if (!localMode) throw new Error('Enter local Vivo before sending synthetic hand landmarks.');
    phoneCamera.consume({ sequence: ++phoneCamera.sequence, time: performance.now(), hands, handednesses: options.handednesses || [] });
    return { accepted: true, hands: Array.isArray(hands) ? hands.length : 0, landmarksPerHand: 21 };
  },
  capabilities: () => latestCapabilities || browserCapabilities,
});

addPhoneSurface();
economyContext = mountPhoneEconomyContext({
  documentRoot: document,
  getSelection: economySelection,
  onWorldFocus: selection => {
    if (selection?.selected?.entityId) selectPhoneEntity(selection.selected.entityId, { announce: false, discardPending: false });
  },
});
syncEconomyContext();
