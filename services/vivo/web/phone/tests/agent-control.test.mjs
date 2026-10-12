import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalAgentController, MAX_AGENT_SOURCE_ID_LENGTH } from '../agent-control.mjs';
import { LocalVivoEngine } from '../engine.mjs';
import { SpatialInteractionFabric } from '../spatial-fabric.mjs';

const clone = value => structuredClone(value);

class MemoryStore {
  rows = new Map();
  async load(id) { return clone(this.rows.get(id) || null); }
  async save(id, value) { this.rows.set(id, clone(value)); }
}

function makeEnvelope({ worldId = 'agent-world', branchId = 'branch-a', eyeId = 'eye-a', revision = 0 } = {}) {
  const dimension = 11;
  const q = Array.from({ length: dimension }, (_, axis) => axis / 10);
  const entity = {
    id: 'relic', spaceId: 'root', dimension, q, v: Array(dimension).fill(0), revision,
    geometry: { scale: 1, rotation: 0, axes: [0, 1] },
  };
  return {
    snapshot: {
      worldId, acceptedSequence: revision, localOperationResults: [],
      spaces: { root: { id: 'root', dimension, entities: { relic: entity } } },
    },
    eyes: { [eyeId]: { id: eyeId, spaceId: 'root', q: Array(dimension).fill(0), returnStack: [] } },
    currentEyeId: eyeId, branchId, mode: 'local',
  };
}

function acceptanceResult(state, { entityId, delta, geometry, expected }) {
  const entity = state.snapshot.spaces.root.entities[entityId];
  entity.q = entity.q.map((value, axis) => value + delta[axis]);
  if (geometry !== null && geometry !== undefined) entity.geometry = clone(geometry);
  entity.revision++;
  state.snapshot.acceptedSequence++;
  state.snapshot.localOperationResults.push({
    operationId: expected.operationId,
    scope: JSON.stringify({ worldId: expected.worldId, branchId: expected.branchId, eyeId: expected.eyeId, spaceId: expected.spaceId, entityId }),
    result: { changed: true, revision: entity.revision },
  });
  return { changed: true, revision: entity.revision, identity: { ...expected, revision: entity.revision }, geometry: clone(entity.geometry) };
}

function enginePayload(envelope, operationId, delta, geometry = undefined) {
  const spaceId = envelope.eyes[envelope.currentEyeId].spaceId;
  const entity = envelope.snapshot.spaces[spaceId].entities.relic;
  const payload = {
    worldId: envelope.snapshot.worldId,
    branchId: envelope.branchId,
    eyeId: envelope.currentEyeId,
    spaceId,
    entityId: entity.id,
    baseRevision: entity.revision,
    operationId,
    delta,
  };
  if (geometry !== undefined) payload.geometry = geometry;
  return payload;
}

function editPayload(state, operationId, delta = null, overrides = {}) {
  const envelope = state;
  const entity = envelope.snapshot.spaces.root.entities.relic;
  return {
    worldId: envelope.snapshot.worldId,
    branchId: envelope.branchId,
    eyeId: envelope.currentEyeId,
    spaceId: 'root',
    entityId: 'relic',
    baseRevision: entity.revision,
    operationId,
    delta: delta || Array.from({ length: entity.dimension }, () => 0),
    geometry: entity.geometry,
    ...overrides,
  };
}

test('stopping one exact agent preserves same-object human and other-agent provisional contacts', async () => {
  const fabric = new SpatialInteractionFabric({ now: () => 100 });
  fabric.begin({ contactId: 'human-contact', source: { kind: 'touch', id: 'human' }, objectId: 'relic', canonicalPoint: [0, 0, 0] });
  fabric.update('human-contact', { canonicalPoint: [0.25, 0.5, 0] });
  fabric.begin({ contactId: 'human-contact-2', source: { kind: 'touch', id: 'human:2' }, objectId: 'relic', canonicalPoint: [2, 0, 0] });
  fabric.update('human-contact-2', { canonicalPoint: [0.25 + Math.sqrt(2) * 1.5, 0.5 + Math.sqrt(2) * 1.5, 0] });
  fabric.begin({ contactId: 'worker-contact', source: { kind: 'agent', id: 'worker' }, objectId: 'relic', canonicalPoint: [0, 0, 0] });
  fabric.update('worker-contact', { canonicalPoint: [1, 1, 0] });
  fabric.begin({ contactId: 'worker-two-contact', source: { kind: 'agent', id: 'worker:2' }, objectId: 'relic', canonicalPoint: [2, 0, 0] });
  fabric.update('worker-two-contact', { canonicalPoint: [2.4, 0.2, 0] });
  fabric.begin({ contactId: 'worker-other-object', source: { kind: 'agent', id: 'worker:2' }, objectId: 'other', canonicalPoint: [0, 0, 0] });

  const state = makeEnvelope();
  const controller = new LocalAgentController({ fabric, snapshot: async () => clone(state), onChange: () => {} });
  controller.setGrantedCapabilities(['world.read', 'world.edit', 'world.eye']);
  const worker = controller.register({ sourceId: 'worker' });
  const workerTwo = controller.register({ sourceId: 'worker:2' });
  const humanOnlyBefore = fabric.preview('relic', 3, { sourceKinds: ['touch'] });

  const stopped = await controller.stop(worker.sessionId);
  assert.equal(stopped.released.length, 1);
  assert.deepEqual(fabric.forObject('relic').map(item => item.source), ['touch:human', 'touch:human:2', 'agent:worker:2']);
  assert.equal(fabric.forObject('other').length, 1);
  const remaining = fabric.forObject('relic');
  const survivorTranslation = Array(3).fill(0);
  for (const item of remaining) for (let axis = 0; axis < 3; axis++) survivorTranslation[axis] += (item.point[axis] - item.anchor[axis]) / remaining.length;
  assert.deepEqual(fabric.preview('relic', 3).translation, survivorTranslation);
  const humanOnlyAfter = fabric.preview('relic', 3, { sourceKinds: ['touch'] });
  assert.deepEqual(humanOnlyAfter.translation, humanOnlyBefore.translation);
  assert.equal(humanOnlyAfter.scale, humanOnlyBefore.scale);
  assert.equal(humanOnlyAfter.rotation, humanOnlyBefore.rotation);
  assert.equal(controller.agents().find(item => item.sourceId === 'worker').status, 'stopped');
  assert.equal(controller.agents().find(item => item.sourceId === 'worker:2').status, 'active');
  assert.equal(workerTwo.sourceId, 'worker:2');
  await controller.stop(worker.sessionId);
  assert.deepEqual(fabric.forObject('relic').map(item => item.source), ['touch:human', 'touch:human:2', 'agent:worker:2']);
});

test('stop distinguishes queued cancellation from a submitted delayed result and reconciles it', async () => {
  const state = makeEnvelope();
  const fabric = new SpatialInteractionFabric({ now: () => 100 });
  let resolveFirst;
  let firstStarted;
  const started = new Promise(resolve => { firstStarted = resolve; });
  const calls = [];
  const controller = new LocalAgentController({
    fabric,
    snapshot: async () => clone(state),
    applyTransform: async (entityId, delta, geometry, expected) => {
      calls.push(expected.operationId);
      firstStarted();
      await new Promise(resolve => { resolveFirst = resolve; });
      return acceptanceResult(state, { entityId, delta, geometry, expected });
    },
  });
  controller.setGrantedCapabilities(['world.edit']);
  const worker = controller.register({ sourceId: 'worker', capabilities: ['world.edit'] });
  const firstPayload = editPayload(state, 'op-first', Object.assign(Array(11).fill(0), { 3: 0.4 }));
  const secondPayload = editPayload(state, 'op-second', Object.assign(Array(11).fill(0), { 10: -0.6 }));
  const first = controller.submitTransform(worker.sessionId, firstPayload);
  await started;
  const second = controller.submitTransform(worker.sessionId, secondPayload);
  await new Promise(resolve => setImmediate(resolve));
  const stopping = controller.stop(worker.sessionId, 'user-stop');
  resolveFirst();
  const [firstResult, secondResult, stopped] = await Promise.all([first, second, stopping]);
  assert.equal(calls.length, 1);
  assert.equal(firstResult.status, 'submitted-requires-reconciliation');
  assert.equal(firstResult.reconciliation.state, 'accepted');
  assert.equal(secondResult.status, 'cancelled-before-submission');
  assert.equal(stopped.operations.some(item => item.status === 'submitted-requires-reconciliation'), true);
  assert.equal(state.snapshot.spaces.root.entities.relic.q[3], 0.7);
  assert.equal(state.snapshot.spaces.root.entities.relic.q[10], 1);
});

test('grant refresh and repeated stop cannot revive work; explicit re-enable creates a fresh generation', async () => {
  const state = makeEnvelope();
  const calls = [];
  const controller = new LocalAgentController({
    snapshot: async () => clone(state),
    applyTransform: async (entityId, delta, geometry, expected) => { calls.push(expected.operationId); return acceptanceResult(state, { entityId, delta, geometry, expected }); },
  });
  await controller.setGrantedCapabilities(['world.edit']);
  const worker = controller.register({ sourceId: 'worker', capabilities: ['world.edit'] });
  await controller.setGrantedCapabilities([]);
  assert.equal(controller.agents()[0].status, 'stopped');
  await assert.rejects(controller.submitTransform(worker.sessionId, editPayload(state, 'revoked')), /AGENT_STOPPED/);
  await controller.setGrantedCapabilities(['world.edit']);
  assert.equal(controller.agents()[0].status, 'stopped');
  const fresh = await controller.reenable('worker');
  assert.equal(fresh.generation, worker.generation + 1);
  await assert.rejects(controller.submitTransform(worker.sessionId, editPayload(state, 'stale-generation')), /AGENT_GENERATION_STALE/);
  const accepted = await controller.submitTransform(fresh.sessionId, editPayload(state, 'q3-q10', Object.assign(Array(11).fill(0), { 3: 0.4, 10: -0.6 })));
  assert.equal(accepted.status, 'accepted');
  assert.deepEqual(calls, ['q3-q10']);
  assert.equal(state.snapshot.spaces.root.entities.relic.q[3], 0.7);
  assert.equal(state.snapshot.spaces.root.entities.relic.q[10], 0.4);
  await controller.stop(fresh.sessionId);
  await controller.stop(fresh.sessionId);
});

test('full scope rejects Eye and branch changes and duplicate operation ids are idempotent', async () => {
  const state = makeEnvelope();
  const calls = [];
  const controller = new LocalAgentController({
    snapshot: async () => clone(state),
    applyTransform: async (entityId, delta, geometry, expected) => { calls.push(expected.operationId); return acceptanceResult(state, { entityId, delta, geometry, expected }); },
  });
  controller.setGrantedCapabilities(['world.edit']);
  const worker = controller.register({ sourceId: 'worker', capabilities: ['world.edit'] });
  const payload = editPayload(state, 'idempotent', Object.assign(Array(11).fill(0), { 3: 0.2 }));
  const [first, replay] = await Promise.all([
    controller.submitTransform(worker.sessionId, payload),
    controller.submitTransform(worker.sessionId, payload),
  ]);
  assert.equal(first.status, 'accepted');
  assert.strictEqual(replay, first);
  assert.deepEqual(calls, ['idempotent']);
  await assert.rejects(
    controller.submitTransform(worker.sessionId, { ...payload, delta: Object.assign(Array(11).fill(0), { 3: 0.9 }) }),
    /AGENT_OPERATION_REPLAY_MISMATCH/,
  );
  const staleEye = editPayload(state, 'eye-stale');
  state.currentEyeId = 'eye-b'; state.eyes['eye-b'] = { id: 'eye-b', spaceId: 'root', q: Array(11).fill(0), returnStack: [] };
  await assert.rejects(controller.submitTransform(worker.sessionId, staleEye), /AGENT_SCOPE_CHANGED/);
  state.currentEyeId = 'eye-a'; state.branchId = 'branch-forked';
  await assert.rejects(controller.submitTransform(worker.sessionId, editPayload({ ...state, branchId: 'branch-a' }, 'branch-stale')), /AGENT_SCOPE_CHANGED/);
});

test('real LocalVivoEngine replays omitted and explicit geometry from the original request fingerprint', async () => {
  const engine = new LocalVivoEngine({ storage: new MemoryStore() });
  await engine.open('agent-controller-engine-fingerprint', 11);
  const calls = [];
  const controller = new LocalAgentController({
    snapshot: () => engine.snapshot(),
    applyTransform: (entityId, delta, geometry, expected) => {
      calls.push(expected.operationId);
      return engine.applyLocalTransform(entityId, delta, geometry, expected);
    },
  });
  await controller.setGrantedCapabilities(['world.edit']);
  const worker = controller.register({ sourceId: 'worker', capabilities: ['world.edit'] });

  const initial = await engine.snapshot();
  const omittedDelta = Array(11).fill(0); omittedDelta[3] = 0.24;
  const omittedPayload = enginePayload(initial, 'engine-replay:omitted', omittedDelta);
  const omittedFirst = await controller.submitTransform(worker.sessionId, omittedPayload);
  assert.equal(omittedFirst.status, 'accepted');
  const afterOmitted = await engine.snapshot();
  assert.equal(afterOmitted.snapshot.spaces.root.entities.relic.q[3], initial.snapshot.spaces.root.entities.relic.q[3] + 0.24);

  const geometryOnlyBase = await engine.snapshot();
  const geometryOnlyDelta = Array(11).fill(0);
  const geometryOnly = await controller.submitTransform(worker.sessionId, enginePayload(
    geometryOnlyBase,
    'engine-replay:geometry-only',
    geometryOnlyDelta,
    { scale: 1.55, rotation: 0.3, axes: [0, 2] },
  ));
  assert.equal(geometryOnly.status, 'accepted');
  const beforeOmittedReplay = await engine.snapshot();
  const omittedReplay = await controller.submitTransform(worker.sessionId, omittedPayload);
  const afterOmittedReplay = await engine.snapshot();
  assert.equal(omittedReplay.status, 'accepted');
  assert.deepEqual(afterOmittedReplay.snapshot.spaces.root.entities.relic.q, beforeOmittedReplay.snapshot.spaces.root.entities.relic.q);
  assert.equal(afterOmittedReplay.snapshot.spaces.root.entities.relic.revision, beforeOmittedReplay.snapshot.spaces.root.entities.relic.revision);
  assert.equal(afterOmittedReplay.snapshot.acceptedSequence, beforeOmittedReplay.snapshot.acceptedSequence);
  assert.deepEqual(calls, ['engine-replay:omitted', 'engine-replay:geometry-only']);
  await assert.rejects(
    controller.submitTransform(worker.sessionId, { ...omittedPayload, geometry: { scale: 1, rotation: 0, axes: [0, 1] } }),
    /AGENT_OPERATION_REPLAY_MISMATCH/,
  );

  const explicitBase = await engine.snapshot();
  const explicitDelta = Array(11).fill(0); explicitDelta[10] = -0.35;
  const explicitGeometry = { scale: 1.25, rotation: -0.2, axes: [1, 3] };
  const explicitPayload = enginePayload(explicitBase, 'engine-replay:explicit', explicitDelta, explicitGeometry);
  const explicitFirst = await controller.submitTransform(worker.sessionId, explicitPayload);
  assert.equal(explicitFirst.status, 'accepted');
  const explicitGeometryBase = await engine.snapshot();
  const explicitGeometryOnly = await controller.submitTransform(worker.sessionId, enginePayload(
    explicitGeometryBase,
    'engine-replay:explicit-geometry-only',
    Array(11).fill(0),
    { scale: 1.8, rotation: 0.7, axes: [2, 4] },
  ));
  assert.equal(explicitGeometryOnly.status, 'accepted');
  const beforeExplicitReplay = await engine.snapshot();
  const explicitReplay = await controller.submitTransform(worker.sessionId, explicitPayload);
  const afterExplicitReplay = await engine.snapshot();
  assert.equal(explicitReplay.status, 'accepted');
  assert.deepEqual(afterExplicitReplay.snapshot.spaces.root.entities.relic.q, beforeExplicitReplay.snapshot.spaces.root.entities.relic.q);
  assert.equal(afterExplicitReplay.snapshot.spaces.root.entities.relic.revision, beforeExplicitReplay.snapshot.spaces.root.entities.relic.revision);
  assert.equal(afterExplicitReplay.snapshot.acceptedSequence, beforeExplicitReplay.snapshot.acceptedSequence);
  assert.deepEqual(calls, [
    'engine-replay:omitted',
    'engine-replay:geometry-only',
    'engine-replay:explicit',
    'engine-replay:explicit-geometry-only',
  ]);
  const omittedExplicitRetry = { ...explicitPayload };
  delete omittedExplicitRetry.geometry;
  await assert.rejects(
    controller.submitTransform(worker.sessionId, omittedExplicitRetry),
    /AGENT_OPERATION_REPLAY_MISMATCH/,
  );
  await engine.close();
});

test('real LocalVivoEngine persists no-op operation receipts across re-enable and reload', async () => {
  const store = new MemoryStore();
  const engine = new LocalVivoEngine({ storage: store });
  await engine.open('agent-controller-noop-receipt', 11);
  const controller = new LocalAgentController({
    snapshot: () => engine.snapshot(),
    applyTransform: (entityId, delta, geometry, expected) => engine.applyLocalTransform(entityId, delta, geometry, expected),
  });
  await controller.setGrantedCapabilities(['world.edit']);
  const worker = controller.register({ sourceId: 'worker', capabilities: ['world.edit'] });
  const before = await engine.snapshot();
  const zeroDelta = Array(11).fill(0);
  const noOpPayload = enginePayload(before, 'engine-noop-reuse', zeroDelta);
  const first = await controller.submitTransform(worker.sessionId, noOpPayload);
  assert.equal(first.result.changed, false);
  const afterNoOp = await engine.snapshot();
  assert.equal(afterNoOp.snapshot.localOperationResults.length, 1);
  assert.equal(afterNoOp.snapshot.localOperationResults[0].operationId, 'engine-noop-reuse');

  await controller.stop(worker.sessionId);
  const fresh = await controller.reenable('worker');
  const changedDelta = Array(11).fill(0); changedDelta[3] = 0.6;
  await assert.rejects(
    controller.submitTransform(fresh.sessionId, enginePayload(before, 'engine-noop-reuse', changedDelta)),
    /AGENT_OPERATION_REPLAY_MISMATCH/,
  );
  assert.equal((await engine.snapshot()).snapshot.spaces.root.entities.relic.revision, 0);

  await engine.close();
  const reloaded = new LocalVivoEngine({ storage: store });
  await reloaded.open('agent-controller-noop-receipt', 11);
  const restartedController = new LocalAgentController({
    snapshot: () => reloaded.snapshot(),
    applyTransform: (entityId, delta, geometry, expected) => reloaded.applyLocalTransform(entityId, delta, geometry, expected),
  });
  await restartedController.setGrantedCapabilities(['world.edit']);
  const restarted = restartedController.register({ sourceId: 'worker', capabilities: ['world.edit'] });
  await assert.rejects(
    restartedController.submitTransform(restarted.sessionId, enginePayload(await reloaded.snapshot(), 'engine-noop-reuse', changedDelta)),
    /AGENT_OPERATION_REPLAY_MISMATCH/,
  );
  assert.equal((await reloaded.snapshot()).snapshot.spaces.root.entities.relic.revision, 0);
  await reloaded.close();
});

test('source IDs stay within fabric bounds and legacy cleanup cannot strand contacts', async () => {
  const fabric = new SpatialInteractionFabric();
  const state = makeEnvelope();
  const controller = new LocalAgentController({ fabric, snapshot: async () => clone(state) });
  await controller.setGrantedCapabilities(['world.edit']);
  assert.throws(
    () => controller.register({ sourceId: 'x'.repeat(MAX_AGENT_SOURCE_ID_LENGTH + 1), capabilities: ['world.edit'] }),
    /AGENT_INVALID_IDENTITY/,
  );
  const worker = controller.register({ sourceId: 'legacy-worker', capabilities: ['world.edit'] });
  controller.beginContact(worker.sessionId, { contactId: 'legacy-contact', objectId: 'relic', canonicalPoint: [0, 0, 0, 0] });
  const record = controller.records.get('legacy-worker');
  record.sourceId = 'x'.repeat(MAX_AGENT_SOURCE_ID_LENGTH + 1);
  const stopped = await controller.stop(worker.sessionId);
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.released.length, 1);
  assert.equal(fabric.snapshot().contacts.length, 0);
  assert.equal(record.contacts.size, 0);
});

test('operation terminal transitions emit a fresh controller status', async () => {
  const state = makeEnvelope();
  const events = [];
  let rejectNext = false;
  const controller = new LocalAgentController({
    snapshot: async () => clone(state),
    applyTransform: async (entityId, delta, geometry, expected) => {
      if (rejectNext) throw Object.assign(new Error('simulated acceptance failure'), { code: 'SIMULATED_REJECT' });
      return acceptanceResult(state, { entityId, delta, geometry, expected });
    },
    onChange: event => events.push(event),
  });
  await controller.setGrantedCapabilities(['world.edit']);
  const worker = controller.register({ sourceId: 'terminal-events', capabilities: ['world.edit'] });
  const accepted = await controller.submitTransform(worker.sessionId, editPayload(state, 'terminal:accepted', Object.assign(Array(11).fill(0), { 3: 0.2 })));
  assert.equal(accepted.status, 'accepted');
  const acceptedEvent = events.find(event => event.reason === 'agent-operation-settled' && event.operationId === 'terminal:accepted');
  assert.equal(acceptedEvent.status, 'accepted');
  assert.equal(acceptedEvent.agents.find(item => item.sourceId === 'terminal-events').activeOperations, 0);

  rejectNext = true;
  await assert.rejects(
    controller.submitTransform(worker.sessionId, editPayload(state, 'terminal:rejected', Array(11).fill(0))),
    /simulated acceptance failure/,
  );
  const rejectedEvent = events.find(event => event.reason === 'agent-operation-settled' && event.operationId === 'terminal:rejected');
  assert.equal(rejectedEvent.status, 'rejected');
  assert.equal(rejectedEvent.agents.find(item => item.sourceId === 'terminal-events').activeOperations, 0);
});

test('world read rechecks the session after an asynchronous snapshot', async () => {
  const state = makeEnvelope();
  let release;
  const controller = new LocalAgentController({
    snapshot: () => new Promise(resolve => { release = () => resolve(clone(state)); }),
  });
  await controller.setGrantedCapabilities(['world.read']);
  const worker = controller.register({ sourceId: 'delayed-reader', capabilities: ['world.read'] });
  const read = controller.invokeTool(worker.sessionId, 'vivo.world.read');
  await new Promise(resolve => setImmediate(resolve));
  const stopping = controller.stop(worker.sessionId);
  release();
  await assert.rejects(read, /AGENT_STOPPED|AGENT_GENERATION_STALE/);
  await stopping;
});
