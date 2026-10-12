import { LocalVivoEngine } from './engine.mjs';
import { IndexedDbWorldStore } from './storage.mjs';
import {
  PhoneMaterialAuthority,
} from './material-patch.mjs';
import { PHONE_MATERIAL_ENTITY_ID, materialClone } from './material-contract.mjs';

const engine = new LocalVivoEngine({
  storage: new IndexedDbWorldStore(self),
  onChange: value => self.postMessage({ type: 'event', value }),
});

let materialAuthority = null;
let clock = null;
let dispatchTail = Promise.resolve();

const MATERIAL_METHODS = new Set([
  'materialSnapshot', 'materialBegin', 'materialTarget', 'materialEnd',
  'materialCancel', 'materialStopSource', 'materialStep', 'materialPreview',
  'materialReconcile', 'materialReconcileOperation',
]);
const ENGINE_METHODS = new Set([
  'open', 'snapshot', 'translate', 'applyLocalEdit', 'applyLocalTransform', 'step',
  'setEye', 'createEye', 'selectEye', 'enterNested', 'exitNested', 'forkOffline',
  'persist', 'close',
]);

function liveEnvelope() {
  return {
    snapshot: engine.world,
    eyes: engine.eyes,
    currentEyeId: engine.currentEyeId,
    branchId: engine.branchId,
    mode: engine.mode,
    parentBranchId: engine.parentBranchId,
    branchLabel: engine.branchLabel,
    forkedAt: engine.forkedAt,
  };
}

function nextMaterialSequence() {
  // The authority invokes this callback only while committing a new receipt
  // or physics checkpoint. Replays/rejections therefore do not consume an
  // accepted sequence slot.
  engine.world.acceptedSequence = Number(engine.world.acceptedSequence) + 1;
  return engine.world.acceptedSequence;
}

function initializeMaterialAuthority({ reopen = false } = {}) {
  if (!materialAuthority || reopen) {
    materialAuthority = new PhoneMaterialAuthority({
      sessionId: `phone-material:${engine.world.worldId}:${engine.branchId}`,
    });
  }
  return materialAuthority.open({ envelope: liveEnvelope(), entityId: PHONE_MATERIAL_ENTITY_ID });
}

function syncMaterialScope({ reopenOnFence = true } = {}) {
  if (!materialAuthority) return { available: false, changed: false };
  try {
    return materialAuthority.syncEnvelope(liveEnvelope());
  } catch (error) {
    if (!reopenOnFence || error?.code !== 'MATERIAL_SCOPE_CHANGED') throw error;
    return initializeMaterialAuthority({ reopen: true });
  }
}

function syncMaterialState(result = {}) {
  if (!materialAuthority?.body) return;
  const body = materialAuthority.body;
  const space = engine.world.spaces[body.identity.spaceId];
  const entity = space?.entities?.[PHONE_MATERIAL_ENTITY_ID];
  if (!entity) return;
  // All fields below are committed synchronously before persistence starts.
  // The material body remains authority-owned; the result is its detached
  // response/checkpoint, not a second mutable body.
  if (result.entity) {
    entity.q = [...result.entity.q];
    entity.v = [...result.entity.v];
    entity.revision = Number(result.entity.revision);
    body.entityRevision = entity.revision;
  }
  engine.world.materialBodies[PHONE_MATERIAL_ENTITY_ID] = body;
  if (result.physicsAdvanced && Number.isFinite(Number(result.worldTime))) {
    engine.world.simulationTime = Number(result.worldTime);
  }
  if (Number.isSafeInteger(Number(result.acceptedSequence))) {
    engine.world.acceptedSequence = Number(result.acceptedSequence);
  }
}

function markAcceptedInMemory(result, error) {
  const operationId = result?.receipt?.operationId;
  if (operationId && materialAuthority?.body) {
    const receipt = materialAuthority.body.receipts.find(item => item.operationId === operationId);
    if (receipt) {
      receipt.status = 'accepted-in-memory';
      receipt.code = 'MATERIAL_ACCEPTED_IN_MEMORY';
      receipt.safeToRetry = false;
      if (result.receipt) {
        result.receipt.status = receipt.status;
        result.receipt.code = receipt.code;
        result.receipt.safeToRetry = false;
      }
    }
  }
  return {
    ...result,
    persistence: {
      status: 'accepted-in-memory',
      safeToRetry: false,
      error: error?.message || String(error),
    },
  };
}

async function persistMaterial(result) {
  try {
    const persistence = await engine.persist();
    return {
      ...result,
      persistence: {
        status: persistence?.persistent === false ? 'memory-only' : 'saved',
        persistent: persistence?.persistent !== false,
        safeToRetry: false,
      },
    };
  } catch (error) {
    // The body and receipt are already accepted in the live worker envelope.
    // A storage failure is therefore an accepted-in-memory outcome, never a
    // rejection that a caller may blindly submit again.
    const accepted = markAcceptedInMemory(result, error);
    engine.emit('material-accepted-in-memory');
    return accepted;
  }
}

async function materialMutation(method, payload = {}) {
  if (!materialAuthority) initializeMaterialAuthority();
  syncMaterialScope();
  const input = { ...payload, envelope: liveEnvelope(), nextSequence: nextMaterialSequence };
  const result = materialAuthority[method](input);
  syncMaterialState(result);
  const accepted = await persistMaterial(result);
  engine.emit(`material-${method}`);
  return accepted;
}

async function materialStep(dt) {
  if (!materialAuthority) initializeMaterialAuthority();
  const scope = syncMaterialScope();
  if (!scope.available) return { status: 'unavailable', available: false, body: materialClone(materialAuthority.body) };
  const result = materialAuthority.step({ envelope: liveEnvelope(), dt, nextSequence: nextMaterialSequence });
  syncMaterialState(result);
  if (!result.changed) return result;
  const accepted = await persistMaterial(result);
  engine.emit('material-step');
  return accepted;
}

async function materialRead(method, payload = {}) {
  if (!materialAuthority) initializeMaterialAuthority();
  syncMaterialScope();
  if (method === 'materialSnapshot') return materialAuthority.snapshot();
  if (method === 'materialReconcileOperation') return materialAuthority.reconcileOperation(payload.operationId);
  const authorityMethod = method.replace(/^material/, '').replace(/^./, value => value.toLowerCase());
  return materialAuthority[authorityMethod]({ ...payload, envelope: liveEnvelope() });
}

async function tick() {
  const materialActive = Boolean(materialAuthority?.snapshot().activeContacts.length);
  const rigidActive = engine.activeIds.size > 0;
  if (!materialActive && !rigidActive) {
    if (clock) { clearInterval(clock); clock = null; }
    return false;
  }
  let moving = false;
  if (rigidActive) moving = await engine.step(1 / 30, materialAuthority ? [PHONE_MATERIAL_ENTITY_ID] : []);
  if (materialActive) {
    const result = await materialStep(1 / 30);
    moving = Boolean(moving || result?.changed);
  }
  return moving;
}

function ensureClock() {
  if (clock) return;
  clock = setInterval(() => enqueue(() => tick()).catch(error => {
    self.postMessage({ type: 'event', value: { reason: 'step-error', error: error?.message || String(error) } });
  }), 33);
}

async function dispatch(method, args) {
  if (!ENGINE_METHODS.has(method) && !MATERIAL_METHODS.has(method)) throw new TypeError('Unsupported local engine operation');

  if (MATERIAL_METHODS.has(method)) {
    if (method === 'materialSnapshot' || method === 'materialPreview' || method === 'materialReconcile' || method === 'materialReconcileOperation') {
      const result = await materialRead(method, args[0] || {});
      return result;
    }
    const authorityMethod = method.replace(/^material/, '').replace(/^./, value => value.toLowerCase());
    const result = await materialMutation(authorityMethod, args[0] || {});
    if (method === 'materialBegin' || method === 'materialTarget') ensureClock();
    if (method === 'materialEnd' || method === 'materialCancel' || method === 'materialStopSource') {
      if (!materialAuthority?.snapshot().activeContacts.length && !engine.activeIds.size && clock) { clearInterval(clock); clock = null; }
    }
    return result;
  }

  const result = await engine[method](...args);
  if (method === 'open') {
    initializeMaterialAuthority();
    try { await engine.persist(); } catch (error) {
      self.postMessage({ type: 'event', value: { reason: 'persistence-failed', error: error?.message || String(error) } });
    }
    return engine.snapshot();
  }
  if (['createEye', 'selectEye', 'enterNested', 'exitNested', 'forkOffline'].includes(method)) {
    await engine.lastPersistence;
    syncMaterialScope();
    if (method === 'enterNested' || method === 'exitNested' || method === 'forkOffline') initializeMaterialAuthority();
  }
  if (['translate', 'applyLocalEdit', 'applyLocalTransform'].includes(method)) {
    syncMaterialScope();
    if (materialAuthority?.body) await engine.persist();
    ensureClock();
  }
  if (method === 'step') {
    const excluded = materialAuthority ? [PHONE_MATERIAL_ENTITY_ID] : [];
    const moving = await engine.step(args[0], excluded);
    if (materialAuthority?.snapshot().activeContacts.length) await materialStep(args[0]);
    return moving;
  }
  if (method === 'close') { if (clock) clearInterval(clock); clock = null; materialAuthority = null; }
  return result;
}

function enqueue(task) {
  const operation = dispatchTail.then(task);
  dispatchTail = operation.catch(() => {});
  return operation;
}

self.onmessage = ({ data }) => {
  const { id, method, args = [] } = data || {};
  enqueue(() => dispatch(method, args)).then(
    value => self.postMessage({ id, ok: true, value }),
    error => self.postMessage({ id, ok: false, error: error?.message || String(error) }),
  );
};
