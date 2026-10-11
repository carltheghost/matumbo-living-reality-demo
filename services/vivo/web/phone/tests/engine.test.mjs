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
