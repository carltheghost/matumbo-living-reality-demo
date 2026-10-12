import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_EYES, LocalVivoEngine, createEye, createPhoneSnapshot, projectForRenderer, stepSparseSpace, validatePhoneSnapshot } from '../engine.mjs';

class MemoryStore {
  rows = new Map();
  async load(id) { return structuredClone(this.rows.get(id) || null); }
  async save(id, value) { this.rows.set(id, structuredClone(value)); }
}

class FaultingStore extends MemoryStore {
  fail = false;
  async save(id, value) {
    if (this.fail) throw new Error('QuotaExceededError: phone storage quota exceeded');
    return super.save(id, value);
  }
}

test('3D through 11D worlds store vectors and sparse edges without dense hyper-grids', () => {
  const snapshot = createPhoneSnapshot({ worldId: 'test-world' });
  validatePhoneSnapshot(snapshot);
  assert.equal(snapshot.spaces.root.dimension, 4);
  assert.equal(snapshot.spaces.inner.dimension, 11);
  assert.equal(snapshot.spaces.inner.entities.innerRelic.q.length, 11);
  assert.equal(snapshot.spaces.root.field.nodes.length, 3);
  assert.equal(snapshot.spaces.root.field.edges.length, 2);
  assert.equal('voxels' in snapshot.spaces.root.field, false);
  assert.equal('voxels' in snapshot.spaces.inner.field, false);
  for (let dimension = 3; dimension <= 11; dimension++) {
    const variant = createPhoneSnapshot({ rootDimension: dimension });
    assert.equal(variant.spaces.root.dimension, dimension);
    assert.equal(variant.spaces.root.entities.relic.q.length, dimension);
  }
});

test('local object edits preserve the full vector and move only the selected spatial axis', async () => {
  const engine = new LocalVivoEngine({ storage: new MemoryStore(), now: () => 100 });
  const initial = await engine.open('persistent-world');
  const before = initial.snapshot.spaces.root.entities.relic.q.slice();
  await engine.translate('relic', 3, 0.4);
  const after = await engine.snapshot();
  assert.equal(after.snapshot.spaces.root.entities.relic.q[3], before[3] + 0.4);
  assert.deepEqual(after.snapshot.spaces.root.entities.relic.q.slice(0, 3), before.slice(0, 3));
  assert.ok(after.snapshot.acceptedSequence > initial.snapshot.acceptedSequence);
  await engine.step(1 / 30);
  assert.ok(after.snapshot.spaces.root.field.edges.length <= 12 * after.snapshot.spaces.root.field.nodes.length);
  await engine.close();
});

test('zero-delta local edits are mutation-free, including velocity and persistence fences', async () => {
  const engine = new LocalVivoEngine({ storage: new MemoryStore() });
  await engine.open('zero-delta-edit');
  const entity = engine.world.spaces.root.entities.relic;
  entity.v = [1, 2, 3, 4];
  const before = await engine.snapshot();
  const result = await engine.applyLocalEdit('relic', [0, 0, 0, 0]);
  const after = await engine.snapshot();
  assert.deepEqual(result, { changed: false, revision: before.snapshot.spaces.root.entities.relic.revision });
  assert.deepEqual(after.snapshot.spaces.root.entities.relic.q, before.snapshot.spaces.root.entities.relic.q);
  assert.deepEqual(after.snapshot.spaces.root.entities.relic.v, [1, 2, 3, 4]);
  assert.equal(after.snapshot.spaces.root.entities.relic.revision, before.snapshot.spaces.root.entities.relic.revision);
  assert.equal(after.snapshot.acceptedSequence, before.snapshot.acceptedSequence);
  await engine.close();
});

test('local field CAS accepts one concurrent preview and idempotently replays the duplicate', async () => {
  const engine = new LocalVivoEngine({ storage: new MemoryStore() });
  await engine.open('local-cas-idempotency');
  const before = await engine.snapshot();
  const expected = {
    worldId: before.snapshot.worldId, branchId: before.branchId, eyeId: before.currentEyeId,
    spaceId: 'root', entityId: 'relic', baseRevision: before.snapshot.spaces.root.entities.relic.revision,
    operationId: 'field-preview:one',
  };
  const [first, second] = await Promise.all([
    engine.applyLocalEdit('relic', [0.14, 0, 0, 0], expected),
    engine.applyLocalEdit('relic', [0.14, 0, 0, 0], expected),
  ]);
  const after = await engine.snapshot();
  assert.equal(first.changed, true);
  assert.equal(second.replayed, true);
  assert.equal(after.snapshot.spaces.root.entities.relic.q[0], before.snapshot.spaces.root.entities.relic.q[0] + 0.14);
  assert.equal(after.snapshot.spaces.root.entities.relic.revision, 1);
  await engine.close();
});

test('different stale previews and intervening branch edits cannot partially apply', async () => {
  const engine = new LocalVivoEngine({ storage: new MemoryStore() });
  await engine.open('local-cas-stale');
  const before = await engine.snapshot();
  const base = {
    worldId: before.snapshot.worldId, branchId: before.branchId, eyeId: before.currentEyeId,
    spaceId: 'root', entityId: 'relic', baseRevision: before.snapshot.spaces.root.entities.relic.revision,
  };
  const one = Promise.resolve().then(() => engine.applyLocalEdit('relic', [0.14, 0, 0, 0], { ...base, operationId: 'field-preview:first' }));
  const two = Promise.resolve().then(() => engine.applyLocalEdit('relic', [0.14, 0, 0, 0], { ...base, operationId: 'field-preview:second' }));
  const results = await Promise.allSettled([one, two]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.filter(item => item.status === 'rejected').length, 1);
  assert.match(results.find(item => item.status === 'rejected').reason.message, /STALE_LOCAL_PREVIEW/);
  const afterOne = await engine.snapshot();
  assert.equal(afterOne.snapshot.spaces.root.entities.relic.revision, 1);
  await engine.translate('relic', 0, 0.5);
  assert.throws(() => engine.applyLocalEdit('relic', [0.14, 0, 0, 0], { ...base, operationId: 'field-preview:third' }), /STALE_LOCAL_PREVIEW/);
  const afterTwo = await engine.snapshot();
  assert.equal(afterTwo.snapshot.spaces.root.entities.relic.q[0], before.snapshot.spaces.root.entities.relic.q[0] + 0.14 + 0.5);
  const branch = engine.forkOffline('stale branch');
  assert.throws(() => engine.applyLocalEdit('relic', [0.14, 0, 0, 0], { ...base, operationId: 'field-preview:branch' }), /STALE_LOCAL_PREVIEW/);
  assert.deepEqual((await engine.snapshot()).snapshot.spaces.root.entities.relic.q, branch.snapshot.spaces.root.entities.relic.q);
  await engine.close();
});

test('explicit UI rebase accepts solver revision drift without relaxing scope or replay identity', async () => {
  const engine = new LocalVivoEngine({ storage: new MemoryStore() });
  await engine.open('local-cas-explicit-rebase');
  const before = await engine.snapshot();
  const expected = {
    worldId: before.snapshot.worldId, branchId: before.branchId, eyeId: before.currentEyeId,
    spaceId: 'root', entityId: 'relic', baseRevision: 0,
    operationId: 'field-preview:explicit-rebase', rebaseOnRevision: true,
  };
  await engine.translate('relic', 0, 0.2);
  const accepted = await engine.applyLocalEdit('relic', [0.14, 0, 0, 0], expected);
  assert.equal(accepted.changed, true);
  const after = await engine.snapshot();
  assert.deepEqual(after.snapshot.localOperationResults.at(-1).identity, {
    worldId: before.snapshot.worldId, branchId: before.branchId, eyeId: before.currentEyeId,
    spaceId: 'root', entityId: 'relic', baseRevision: 1, revision: 2,
  });
  assert.ok(Math.abs(after.snapshot.spaces.root.entities.relic.q[0] - (before.snapshot.spaces.root.entities.relic.q[0] + 0.34)) < 1e-12);
  const replay = await engine.applyLocalEdit('relic', [0.14, 0, 0, 0], expected);
  assert.equal(replay.replayed, true);
  const legacyReplayExpected = { ...expected };
  delete legacyReplayExpected.rebaseOnRevision;
  const legacyReplay = await engine.applyLocalEdit('relic', [0.14, 0, 0, 0], legacyReplayExpected);
  assert.equal(legacyReplay.replayed, true);
  await engine.close();
});

test('accepted local operation identity remains idempotent after reload', async () => {
  const store = new MemoryStore(), first = new LocalVivoEngine({ storage: store });
  await first.open('local-operation-reload');
  const before = await first.snapshot();
  const expected = {
    worldId: before.snapshot.worldId, branchId: before.branchId, eyeId: before.currentEyeId,
    spaceId: 'root', entityId: 'relic', baseRevision: 0, operationId: 'field-preview:reload',
  };
  await first.applyLocalEdit('relic', [0.14, 0, 0, 0], expected);
  await first.close();
  const reloaded = new LocalVivoEngine({ storage: store });
  await reloaded.open('local-operation-reload');
  const replay = await reloaded.applyLocalEdit('relic', [0.14, 0, 0, 0], expected);
  assert.equal(replay.replayed, true);
  assert.equal((await reloaded.snapshot()).snapshot.spaces.root.entities.relic.revision, 1);
  await reloaded.close();
});

test('world identity is persistent while two Eyes keep separate view and nested return state', async () => {
  const store = new MemoryStore(), first = new LocalVivoEngine({ storage: store });
  await first.open('world-eye-test');
  const eyeOne = (await first.snapshot()).currentEyeId;
  await first.setEye({ q: [1, 2, 3, 4] });
  await first.setEye({ projection: { scale: 15, rotation: 1.25, tilt: 0.2 } });
  const eyeTwo = first.createEye('Second Eye');
  await first.setEye({ q: [0, 0, 0, 0] });
  await first.setEye({ projection: { scale: 7, rotation: -0.4, tilt: -0.3 } });
  await first.enterNested('portal');
  assert.equal(first.eye.spaceId, 'inner');
  assert.equal(first.eye.q.length, 11);
  assert.equal(first.exitNested(), true);
  assert.equal(first.eye.spaceId, 'root');
  first.selectEye(eyeOne);
  assert.deepEqual(first.eye.q, [1, 2, 3, 4]);
  const envelope = await first.snapshot();
  await first.close();
  const reloaded = new LocalVivoEngine({ storage: store });
  await reloaded.open('world-eye-test');
  assert.equal(reloaded.world.worldId, envelope.snapshot.worldId);
  assert.notEqual(eyeTwo.id, eyeOne);
  assert.deepEqual(reloaded.eyes[eyeOne].q, [1, 2, 3, 4]);
  assert.deepEqual(reloaded.eyes[eyeTwo.id].q, [0, 0, 0, 0]);
  assert.equal(reloaded.eyes[eyeOne].projection.scale, 15);
  assert.equal(reloaded.eyes[eyeTwo.id].projection.scale, 7);
});

test('branch identity and offline provenance survive close and reload', async () => {
  const store = new MemoryStore(), first = new LocalVivoEngine({ storage: store, now: () => 100 });
  await first.open('branch-persistence');
  const parentBranchId = first.branchId;
  const branch = first.forkOffline('No-network work');
  await first.close();
  const reloaded = new LocalVivoEngine({ storage: store });
  await reloaded.open('branch-persistence');
  assert.equal(reloaded.branchId, branch.branchId);
  assert.equal(reloaded.mode, 'offline-branch');
  assert.equal(reloaded.parentBranchId, parentBranchId);
  assert.equal(reloaded.branchLabel, 'No-network work');
  assert.equal(reloaded.forkedAt, 100);
});

test('Eye creation is capped at the validated envelope limit', async () => {
  const engine = new LocalVivoEngine(); await engine.open('eye-cap');
  for (let index = 1; index < MAX_EYES; index++) engine.createEye(`Eye ${index + 1}`);
  assert.equal(Object.keys((await engine.snapshot()).eyes).length, MAX_EYES);
  assert.throws(() => engine.createEye('poisoning Eye'), new RegExp(`Eye limit is ${MAX_EYES}`));
});

test('nested transitions fence active material IDs to their current space', async () => {
  const engine = new LocalVivoEngine(); await engine.open('nested-active-fence');
  engine.translate('relic', 0, 0.1);
  engine.enterNested('portal');
  assert.equal(await engine.step(1 / 30), false);
  engine.translate('innerRelic', 0, 0.1);
  assert.equal(await engine.step(1 / 30), false);
  assert.equal(engine.exitNested(), true);
  assert.equal(await engine.step(1 / 30), false);
});

test('snapshot and sparse solver reject unsupported dimensions, neighbors, and unsafe time steps', () => {
  const snapshot = createPhoneSnapshot();
  snapshot.spaces.inner.dimension = 12;
  assert.throws(() => validatePhoneSnapshot(snapshot), /Invalid space/);
  const space = createPhoneSnapshot().spaces.root;
  assert.throws(() => stepSparseSpace(space, 0.5), /between 0 and 100 ms/);
  assert.throws(() => createEye({ dimension: 12 }), /Eye dimension must be 3 through 11/);
  assert.throws(() => validatePhoneSnapshot({ schema: 'wrong', worldId: 'x', spaces: {} }), /Unsupported/);
});

test('offline forks are explicit and renderer projection carries the same object identity', async () => {
  const engine = new LocalVivoEngine(); await engine.open('identity-test');
  const originalWorldId = engine.world.worldId;
  const branch = engine.forkOffline('No-network work');
  assert.equal(branch.snapshot.worldId, originalWorldId);
  assert.equal(branch.mode, 'offline-branch');
  const view = projectForRenderer(engine);
  assert.equal(view.state.worldId, originalWorldId);
  assert.equal(view.state.entities.portal.innerSpaceId, 'inner');
  assert.equal(view.grid.positions.length, 49);
  assert.equal(view.eye.id, engine.eye.id);
  assert.equal(branch.mode, 'offline-branch');
});

test('Eye persistence failures are explicit, retain in-memory state, and can be retried', async () => {
  const store = new FaultingStore(), engine = new LocalVivoEngine({ storage: store, now: () => 100 });
  await engine.open('eye-persistence-failure');
  store.fail = true;
  await assert.rejects(engine.setEye({ q: [1, 2, 3, 4] }), /QuotaExceededError/);
  let current = await engine.snapshot();
  assert.deepEqual(current.eyes[current.currentEyeId].q, [1, 2, 3, 4]);
  assert.equal(current.persistence.state, 'unsaved');
  assert.match(current.persistence.error, /QuotaExceededError/);
  store.fail = false;
  await engine.persist();
  const reloaded = new LocalVivoEngine({ storage: store });
  await reloaded.open('eye-persistence-failure');
  assert.deepEqual(reloaded.eye.q, [1, 2, 3, 4]);
  assert.equal((await reloaded.snapshot()).persistence.state, 'saved');
});

test('offline branch persistence failures do not erase provenance and retry durably', async () => {
  const store = new FaultingStore(), engine = new LocalVivoEngine({ storage: store, now: () => 200 });
  await engine.open('branch-persistence-failure');
  const parentBranchId = engine.branchId;
  store.fail = true;
  const branch = engine.forkOffline('No-network retry');
  await assert.rejects(engine.lastPersistence, /QuotaExceededError/);
  assert.equal(branch.mode, 'offline-branch');
  assert.equal(engine.mode, 'offline-branch');
  assert.equal(engine.parentBranchId, parentBranchId);
  assert.equal((await engine.snapshot()).persistence.state, 'unsaved');
  store.fail = false;
  await engine.persist();
  const reloaded = new LocalVivoEngine({ storage: store });
  await reloaded.open('branch-persistence-failure');
  assert.equal(reloaded.mode, 'offline-branch');
  assert.equal(reloaded.parentBranchId, parentBranchId);
  assert.equal(reloaded.branchLabel, 'No-network retry');
});

test('bimanual transforms persist geometry separately from canonical coordinates with CAS identity', async () => {
  const store = new MemoryStore();
  const engine = new LocalVivoEngine({ storage: store });
  await engine.open('bimanual-transform-persistence', 4);
  const before = await engine.snapshot();
  const entity = before.snapshot.spaces.root.entities.relic;
  const expected = {
    worldId: before.snapshot.worldId,
    branchId: before.branchId,
    eyeId: before.currentEyeId,
    spaceId: 'root',
    entityId: 'relic',
    baseRevision: entity.revision,
    operationId: 'bimanual-transform:one',
  };
  const geometry = { scale: 1.75, rotation: Math.PI / 4, axes: [0, 2] };
  const delta = [0.2, -0.1, 0, 0];
  const accepted = await engine.applyLocalTransform('relic', delta, geometry, expected);
  assert.equal(accepted.changed, true);
  assert.deepEqual(accepted.identity, {
    worldId: before.snapshot.worldId,
    branchId: before.branchId,
    eyeId: before.currentEyeId,
    spaceId: 'root',
    entityId: 'relic',
    baseRevision: 0,
    revision: 1,
  });
  assert.deepEqual(accepted.geometry, { scale: 1.75, rotation: Math.PI / 4, axes: [0, 2] });
  const after = await engine.snapshot();
  assert.deepEqual(after.snapshot.spaces.root.entities.relic.q, entity.q.map((value, axis) => value + delta[axis]));
  assert.deepEqual(after.snapshot.spaces.root.entities.relic.geometry, accepted.geometry);
  assert.equal(after.snapshot.spaces.root.entities.relic.q[3], entity.q[3]);

  const replay = await engine.applyLocalTransform('relic', delta, geometry, expected);
  assert.equal(replay.replayed, true);
  assert.throws(
    () => engine.applyLocalTransform('relic', delta, { ...geometry, scale: 1.8 }, expected),
    error => error.code === 'LOCAL_OPERATION_REPLAY_MISMATCH',
  );
  assert.throws(
    () => engine.applyLocalTransform('relic', [0, 0, 0, 0], { ...geometry, rotation: 0 }, {
      ...expected, operationId: 'bimanual-transform:stale', baseRevision: 0,
    }),
    error => error.code === 'STALE_LOCAL_PREVIEW',
  );

  await engine.close();
  const reloaded = new LocalVivoEngine({ storage: store });
  await reloaded.open('bimanual-transform-persistence', 4);
  const reloadedBefore = await reloaded.snapshot();
  assert.deepEqual(reloadedBefore.snapshot.spaces.root.entities.relic.geometry, accepted.geometry);
  const replayAfterReload = await reloaded.applyLocalTransform('relic', delta, geometry, expected);
  assert.equal(replayAfterReload.replayed, true);

  const concurrentBase = await reloaded.snapshot();
  const concurrentExpected = {
    worldId: concurrentBase.snapshot.worldId, branchId: concurrentBase.branchId,
    eyeId: concurrentBase.currentEyeId, spaceId: 'root', entityId: 'relic',
    baseRevision: concurrentBase.snapshot.spaces.root.entities.relic.revision,
  };
  const concurrent = await Promise.allSettled([
    Promise.resolve().then(() => reloaded.applyLocalTransform('relic', [0.1, 0, 0, 0], { scale: 1.9, rotation: 0.1, axes: [0, 1] }, { ...concurrentExpected, operationId: 'bimanual-transform:a' })),
    Promise.resolve().then(() => reloaded.applyLocalTransform('relic', [0, 0.1, 0, 0], { scale: 1.6, rotation: -0.1, axes: [0, 1] }, { ...concurrentExpected, operationId: 'bimanual-transform:b' })),
  ]);
  assert.equal(concurrent.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(concurrent.filter(item => item.status === 'rejected').length, 1);
  assert.equal(concurrent.find(item => item.status === 'rejected').reason.code, 'STALE_LOCAL_PREVIEW');
  await reloaded.close();
  const final = new LocalVivoEngine({ storage: store });
  await final.open('bimanual-transform-persistence', 4);
  const finalEntity = (await final.snapshot()).snapshot.spaces.root.entities.relic;
  assert.equal(finalEntity.revision, 2);
  assert.ok(finalEntity.geometry.scale === 1.9 || finalEntity.geometry.scale === 1.6);
  await final.close();
});
