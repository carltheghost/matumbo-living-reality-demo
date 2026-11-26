import test from 'node:test';
import assert from 'node:assert/strict';
import { PhoneRenderer } from '../phone-render.mjs';
import { PhoneMaterialInputRuntime } from '../material-input-runtime.mjs';

function makePhoneRenderer(width = 390, height = 844) {
  const canvas = { getContext: () => null, addEventListener: () => {} };
  const overlay = { getContext: () => ({}) };
  const renderer = new PhoneRenderer(canvas, overlay);
  Object.assign(renderer, { w: width, h: height, yaw: 0.55, pitch: 0.68, distance: 10.5, origin: [0, 0, 0] });
  return renderer;
}

test('material contacts capture the selected node camera depth and reproject a 50px drag exactly in 4D and 11D', () => {
  for (const dimension of [4, 11]) {
    const renderer = makePhoneRenderer();
    const q = [0.1, 0.72, 0.25, ...Array(dimension - 3).fill(0).map((_, axis) => (axis + 1) * 0.11)];
    const projected = renderer.project([q[0], q[2], q[1]]);
    renderer.materialNodePoints = [{ ...projected, nodeId: 'selected-node' }];
    const runtime = new PhoneMaterialInputRuntime({
      engine: {}, renderer,
      getEnvelope: () => ({}),
      getViewport: () => ({ left: 0, top: 0, width: 390, height: 844 }),
    });
    const mapping = runtime.capturedMapping([projected.x, projected.y], q, dimension, 'selected-node');
    assert.equal(mapping.renderer.projectionProfile, 'phone');
    assert.ok(Math.abs(mapping.depth - projected.depth) < 1e-12, { mapping, projected });
    assert.ok(Math.abs(mapping.depth - renderer.distance) > 0.1, { mapping, projected });

    const record = { attachment: { capturedCanonicalPoint: [...q], inverseMapping: mapping } };
    const target = runtime.canonicalPoint(record, [projected.x + 50, projected.y]);
    const reprojected = renderer.project([target[0], target[2], target[1]]);
    assert.ok(Math.abs((reprojected.x - projected.x) - 50) < 1e-9, { dimension, projected, target, reprojected });
    assert.ok(Math.abs(reprojected.y - projected.y) < 1e-9, { dimension, projected, target, reprojected });
    for (let axis = 3; axis < dimension; axis++) assert.equal(target[axis], q[axis], `x${axis + 1} must remain unchanged`);
  }
});


const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function pendingMaterialFixture({ delayedPreview = false } = {}) {
  const renderer = makePhoneRenderer(), q = [0.1, 0.72, 0.25, 0.11];
  const nodeId = 'workpiece.patch.v1.r1c2', contactId = 'touch:701';
  const projected = renderer.project([q[0], q[2], q[1]]);
  renderer.materialNodePoints = [{ ...projected, nodeId }];
  const point = [projected.x, projected.y], calls = [], previews = [], states = [];
  const admission = deferred(), admissionEntered = deferred(), previewEntered = deferred(), previewGate = deferred();
  const body = { nodes: { [nodeId]: { q } }, topologyId: 'workpiece.patch.grid-4x3', bodyRevision: 0 };
  const envelope = {
    branchId: 'fixture-branch', currentEyeId: 'eye', eyes: { eye: { spaceId: 'root' } },
    snapshot: {
      worldId: 'fixture-world', authorityId: 'fixture-authority', rootSpaceId: 'root',
      spaces: { root: { dimension: 4, entities: { workpiece: { chart: 'flat' } } } },
      materialBodies: { workpiece: body },
    },
  };
  const engine = {
    async materialBegin(request) {
      calls.push(['begin', request]); admissionEntered.resolve();
      await admission.promise;
      return { status: 'accepted' };
    },
    async materialTarget(request) { calls.push(['target', request]); return { status: 'accepted' }; },
    async materialEnd(request) { calls.push(['end', request]); return { status: 'accepted' }; },
    async materialCancel(request) { calls.push(['cancel', request]); return { status: 'accepted' }; },
    async materialPreview(request) {
      calls.push(['preview', request]); previewEntered.resolve();
      if (delayedPreview) await previewGate.promise;
      return { provisional: true };
    },
  };
  const runtime = new PhoneMaterialInputRuntime({
    engine, renderer, getEnvelope: () => envelope,
    getViewport: () => ({ left: 0, top: 0, width: 390, height: 844 }),
    onPreview: (preview) => previews.push(preview),
    onState: (state) => states.push(state.type),
  });
  const begin = runtime.begin({ contactId, source: { kind: 'touch', sourceId: '701' }, point, nodeId });
  return { runtime, begin, admission, admissionEntered, previewEntered, previewGate, contactId, point, calls, previews, states };
}

test('release during delayed admission drains the latest point once and ends the same worker contact', async () => {
  const f = pendingMaterialFixture();
  await f.admissionEntered.promise;
  const pending = f.runtime.contacts.get(f.contactId);
  const old = f.runtime.update(f.contactId, [f.point[0] + 10, f.point[1]]);
  const latest = f.runtime.update(f.contactId, [f.point[0] + 40, f.point[1] + 12]);
  const release = f.runtime.end(f.contactId);
  const duplicate = f.runtime.end(f.contactId);
  assert.deepEqual(await f.runtime.update(f.contactId, [0, 0]), { status: 'fenced', submitted: false });
  f.admission.resolve();
  await Promise.all([f.begin, old, latest, release, duplicate]);
  assert.deepEqual(f.calls.map(([kind]) => kind), ['begin', 'target', 'end']);
  assert.equal(f.calls[1][1].contactId, f.contactId);
  assert.deepEqual(f.calls[1][1].q, f.runtime.canonicalPoint(pending, [f.point[0] + 40, f.point[1] + 12]));
  assert.equal(f.calls[1][1].q[3], 0.11);
  assert.deepEqual(f.runtime.snapshot(), []);
  assert.deepEqual(f.states, ['material-begin', 'material-end']);
});

test('cancel during delayed admission fences buffered targets and removes the admitted worker contact exactly once', async () => {
  const f = pendingMaterialFixture();
  await f.admissionEntered.promise;
  const pendingUpdate = f.runtime.update(f.contactId, [f.point[0] + 100, f.point[1]]);
  const cancel = f.runtime.end(f.contactId, 'scope-transition', { cancel: true });
  const duplicate = f.runtime.end(f.contactId, 'scope-transition', { cancel: true });
  f.admission.resolve();
  await Promise.all([f.begin, pendingUpdate, cancel, duplicate]);
  assert.deepEqual(f.calls.map(([kind]) => kind), ['begin', 'cancel']);
  assert.deepEqual(f.runtime.snapshot(), []);
  assert.deepEqual(f.states, ['material-begin', 'material-cancel']);
});

test('preview waiting for admission uses the promoted record, and late preview cannot reappear after release', async () => {
  const f = pendingMaterialFixture({ delayedPreview: true });
  await f.admissionEntered.promise;
  const preview = f.runtime.preview(f.contactId, [f.point[0] + 24, f.point[1] + 14]);
  f.admission.resolve();
  await f.begin;
  await f.previewEntered.promise;
  await f.runtime.end(f.contactId);
  f.previewGate.resolve();
  assert.deepEqual(await preview, { status: 'fenced', submitted: false });
  assert.deepEqual(f.calls.map(([kind]) => kind), ['begin', 'target', 'preview', 'end']);
  assert.deepEqual(f.previews, [null]);
  assert.deepEqual(f.runtime.snapshot(), []);
});

test('failed worker admission removes the pending record without issuing a terminal or target command', async () => {
  const f = pendingMaterialFixture();
  await f.admissionEntered.promise;
  const ended = f.runtime.end(f.contactId, 'cancel', { cancel: true });
  const observedBegin = assert.rejects(f.begin, /fixture admission denied/);
  const observedEnd = assert.rejects(ended, /fixture admission denied/);
  f.admission.reject(new Error('fixture admission denied'));
  await Promise.all([observedBegin, observedEnd]);
  assert.deepEqual(f.calls.map(([kind]) => kind), ['begin']);
  assert.deepEqual(f.runtime.snapshot(), []);
});
