import test from 'node:test';
import assert from 'node:assert/strict';
import { createEye } from '../engine.mjs';
import {
  SpatialInteractionFabric,
  mapDevicePointToCanonical,
  mapRendererPointToCanonical,
} from '../spatial-fabric.mjs';

test('device coordinates use the supplied inverse projection and Eye axes', () => {
  const eye = createEye({ id: 'eye-map', dimension: 4 });
  eye.q = [1, 2, 3, 4];
  const point = mapDevicePointToCanonical({
    devicePoint: { x: 75, y: 25 },
    viewport: { left: 0, top: 0, width: 100, height: 100 },
    eye,
    axes: [1, 3],
    scale: 2,
    inverseProjection: ({ normalized }) => ({ x: normalized.x * 0.5, y: normalized.y * 0.25 }),
  });
  assert.deepEqual(point, [1, 2.5, 3, 4.25]);
  assert.throws(() => mapDevicePointToCanonical({
    devicePoint: { x: 1, y: 1 },
    viewport: { left: 0, top: 0, width: 1, height: 1 },
    eye,
    axes: [0, 4],
  }), /outside the Eye/);
});

test('renderer inverse follows yaw, pitch and camera depth instead of an identity plane', () => {
  const eye = createEye({ id: 'renderer-eye', dimension: 4 });
  const renderer = { w: 1000, h: 800, yaw: 0.6, pitch: 0.4, distance: 8, origin: [0.2, -0.3, 0.5] };
  const point = [1.1, -0.4, 0.8];
  const ca = Math.cos(renderer.yaw), sa = Math.sin(renderer.yaw), cp = Math.cos(renderer.pitch), sp = Math.sin(renderer.pitch);
  const x = point[0] - renderer.origin[0], y = point[1] - renderer.origin[1], z = point[2] - renderer.origin[2];
  const xx = ca * x - sa * z, zz = sa * x + ca * z, yy = cp * y - sp * zz;
  const depth = renderer.distance - (sp * y + cp * zz);
  const k = Math.min(renderer.w, renderer.h) * 1.18 / depth;
  const screen = { x: renderer.w / 2 + xx * k, y: renderer.h * 0.52 - yy * k };
  const mapped = mapRendererPointToCanonical({ devicePoint: screen, viewport: { left: 0, top: 0, width: renderer.w, height: renderer.h }, eye, renderer, axes: [0, 1, 2], depth });
  assert.ok(mapped.slice(0, 3).every((value, index) => Math.abs(value - point[index]) < 1e-9), mapped);
  const rotated = mapRendererPointToCanonical({ devicePoint: screen, viewport: { left: 0, top: 0, width: renderer.w, height: renderer.h }, eye, renderer: { ...renderer, yaw: renderer.yaw + 0.4 }, axes: [0, 1, 2], depth });
  assert.notDeepEqual(rotated.slice(0, 3), mapped.slice(0, 3));
});

test('flat renderer inverse uses q0,q2,q1 embedding and the target depth', () => {
  const eye = createEye({ id: 'flat-renderer-eye', dimension: 4 });
  const renderer = { w: 400, h: 800, yaw: 0.55, pitch: 0.68, distance: 10.5, origin: [0, 0, 0] };
  const projectFlat = q => {
    const [x, y, z] = [q[0], q[2], q[1]];
    const ca = Math.cos(renderer.yaw), sa = Math.sin(renderer.yaw), cp = Math.cos(renderer.pitch), sp = Math.sin(renderer.pitch);
    const xx = ca * x - sa * z, zz = sa * x + ca * z, yy = cp * y - sp * zz;
    const depth = renderer.distance - (sp * y + cp * zz);
    const k = Math.min(renderer.w, renderer.h) * 1.18 / depth;
    return { screen: { x: renderer.w / 2 + xx * k, y: renderer.h * 0.52 - yy * k }, depth };
  };
  for (const point of [[-1.15, -0.1, 0.25, 0], [0.3, 0.55, -0.6, 0]]) {
    const { screen, depth } = projectFlat(point);
    const mapped = mapRendererPointToCanonical({
      devicePoint: screen,
      viewport: { left: 0, top: 0, width: renderer.w, height: renderer.h },
      eye,
      renderer,
      axes: [0, 2, 1],
      depth,
    });
    assert.ok(mapped.slice(0, 3).every((value, index) => Math.abs(value - point[index]) < 1e-9), mapped);
  }
});

test('contacts and per-object constraints support independent fingers and bimanual preview', () => {
  let clock = 100;
  const fabric = new SpatialInteractionFabric({ now: () => ++clock });
  fabric.begin({ contactId: 'touch-1', source: { kind: 'touch', id: '1' }, objectId: 'relic', gesture: 'touch', canonicalPoint: [0, 0, 0, 0], timestamp: 1 });
  fabric.begin({ contactId: 'touch-2', source: { kind: 'touch', id: '2' }, objectId: 'relic', gesture: 'touch', canonicalPoint: [1, 0, 0, 0], timestamp: 1 });
  fabric.update('touch-1', { canonicalPoint: [0.25, 0.5, 0, 0], gesture: 'drag', timestamp: 2 });
  fabric.update('touch-2', { canonicalPoint: [2, 1, 0, 0], gesture: 'drag', timestamp: 3 });
  const preview = fabric.preview('relic', 4);
  assert.deepEqual(preview.contactIds, ['touch-1', 'touch-2']);
  assert.deepEqual(preview.translation, [0.625, 0.75, 0, 0]);
  assert.ok(preview.rotation > 0);
  assert.ok(preview.scale > 1);
  assert.equal(preview.provisional, true);
  assert.equal(fabric.snapshot().constraints.length, 1);
});

test('mixed hand and touch previews exclude already-accepted hand displacement from touch commit', () => {
  const fabric = new SpatialInteractionFabric({ now: () => 100 });
  fabric.begin({ contactId: 'hand-a', source: { kind: 'hand', id: 'a' }, objectId: 'relic', canonicalPoint: [0, 0, 0, 0] });
  fabric.update('hand-a', { canonicalPoint: [1, 0, 0, 0] });
  fabric.begin({ contactId: 'touch-1', source: { kind: 'touch', id: '1' }, objectId: 'relic', canonicalPoint: [0, 0, 0, 0] });
  fabric.update('touch-1', { canonicalPoint: [0.2, 0, 0, 0] });
  assert.ok(Math.abs(fabric.preview('relic', 4, { sourceKinds: ['touch'] }).translation[0] - 0.2) < 1e-12);
  fabric.rebase('hand-a', [1, 0, 0, 0]);
  assert.ok(Math.abs(fabric.preview('relic', 4).translation[0] - 0.1) < 1e-12);
});

test('released fingers preserve the aggregate while another finger continues the same object gesture', () => {
  const fabric = new SpatialInteractionFabric({ now: () => 100 });
  fabric.begin({ contactId: 'touch-1', source: { kind: 'touch', id: '1' }, objectId: 'relic', canonicalPoint: [0, 0, 0, 0] });
  fabric.begin({ contactId: 'touch-2', source: { kind: 'touch', id: '2' }, objectId: 'relic', canonicalPoint: [1, 0, 0, 0] });
  fabric.update('touch-1', { canonicalPoint: [0.4, 0, 0, 0] });
  fabric.update('touch-2', { canonicalPoint: [1.6, 0, 0, 0] });
  fabric.end('touch-1', 'touch-release');
  const preview = fabric.preview('relic', 4);
  assert.deepEqual(preview.contactIds, ['touch-2']);
  assert.ok(Math.abs(preview.translation[0] - 0.5) < 1e-12);
});

test('touch release order preserves the aggregate and rebases remaining-finger continuation', () => {
  for (const firstRelease of ['moved', 'stationary']) {
    const fabric = new SpatialInteractionFabric({ now: () => 100 });
    fabric.begin({ contactId: 'touch-1', source: { kind: 'touch', id: '1' }, objectId: 'relic', canonicalPoint: [0, 0, 0] });
    fabric.begin({ contactId: 'touch-2', source: { kind: 'touch', id: '2' }, objectId: 'relic', canonicalPoint: [1, 0, 0] });
    fabric.update('touch-1', { canonicalPoint: [0.2, 0, 0] });
    assert.ok(Math.abs(fabric.preview('relic', 3).translation[0] - 0.1) < 1e-12);
    const released = firstRelease === 'moved' ? 'touch-1' : 'touch-2';
    const remaining = firstRelease === 'moved' ? 'touch-2' : 'touch-1';
    fabric.end(released, 'touch-release');
    assert.ok(Math.abs(fabric.preview('relic', 3).translation[0] - 0.1) < 1e-12);
    const current = firstRelease === 'moved' ? [1.1, 0, 0] : [0.3, 0, 0];
    fabric.update(remaining, { canonicalPoint: current });
    assert.ok(Math.abs(fabric.preview('relic', 3).translation[0] - 0.2) < 1e-12);
    fabric.end(remaining, 'touch-release');
    assert.ok(Math.abs(fabric.preview('relic', 3).translation[0] - 0.2) < 1e-12);
    fabric.clearObjectAggregate('relic');
    assert.equal(fabric.preview('relic', 3), null);
  }
});

test('canceling one same-object touch releases only that contact', () => {
  const fabric = new SpatialInteractionFabric({ now: () => 100 });
  fabric.begin({ contactId: 'touch-1', source: { kind: 'touch', id: '1' }, objectId: 'relic', canonicalPoint: [0, 0, 0] });
  fabric.begin({ contactId: 'touch-2', source: { kind: 'touch', id: '2' }, objectId: 'relic', canonicalPoint: [1, 0, 0] });
  fabric.update('touch-2', { canonicalPoint: [1.3, 0, 0] });
  assert.equal(fabric.end('touch-1', 'touch-cancel').reason, 'touch-cancel');
  assert.deepEqual(fabric.forObject('relic').map(item => item.contactId), ['touch-2']);
  assert.ok(Math.abs(fabric.preview('relic', 3).translation[0] - 0.3) < 1e-12);
});

test('selective tracking loss and agent kill-switch do not release unrelated contacts', () => {
  const fabric = new SpatialInteractionFabric({ now: () => 100 });
  fabric.begin({ contactId: 'hand-a', source: { kind: 'hand', id: 'a' }, objectId: 'relic', canonicalPoint: [0, 0, 0] });
  fabric.begin({ contactId: 'finger-a', source: { kind: 'finger', id: 'a' }, objectId: 'workpiece', canonicalPoint: [0, 0, 0] });
  fabric.begin({ contactId: 'agent-a', source: { kind: 'agent', id: 'worker' }, objectId: 'portal', canonicalPoint: [0, 0, 0] });
  fabric.begin({ contactId: 'agent-b', source: { kind: 'agent', id: 'other' }, objectId: 'portal', canonicalPoint: [0, 0, 0] });
  fabric.begin({ contactId: 'agent-child', source: { kind: 'agent', id: 'worker:2' }, objectId: 'portal', canonicalPoint: [0, 0, 0] });
  assert.equal(fabric.releaseKind('hand').length, 1);
  assert.deepEqual(fabric.forObject('relic'), []);
  assert.equal(fabric.forObject('workpiece').length, 1);
  assert.equal(fabric.killAgent('worker').length, 1);
  assert.deepEqual(fabric.forObject('portal').map(item => item.contactId), ['agent-b', 'agent-child']);
  assert.equal(fabric.emergencyStop().length, 3);
  assert.equal(fabric.snapshot().contacts.length, 0);
});

test('contact identity, bounds and constraint limits are explicit', () => {
  const fabric = new SpatialInteractionFabric({ maxContacts: 1, now: () => 100 });
  assert.throws(() => fabric.begin({ contactId: '', source: 'touch:bad', objectId: 'relic', canonicalPoint: [0, 0, 0] }), /bounded identity/);
  fabric.begin({ contactId: 'one', source: 'touch:one', objectId: 'relic', canonicalPoint: [0, 0, 0] });
  assert.throws(() => fabric.begin({ contactId: 'two', source: 'touch:two', objectId: 'relic', canonicalPoint: [0, 0, 0] }), /contact limit/);
  assert.equal(fabric.end('one', 'lost').reason, 'lost');
  assert.equal(fabric.end('missing'), null);
  assert.equal(fabric.snapshot().contacts.length, 0);
});

test('touch and synthetic hand contacts share deterministic translation, scale and rotation semantics', () => {
  const make = sourceKind => {
    const fabric = new SpatialInteractionFabric({ now: () => 100 });
    fabric.begin({ contactId: 'a', source: { kind: sourceKind, id: 'a' }, objectId: 'relic', canonicalPoint: [0, 0, 0, 9], metadata: { transformAxes: [0, 1] } });
    fabric.begin({ contactId: 'b', source: { kind: sourceKind, id: 'b' }, objectId: 'relic', canonicalPoint: [2, 0, 0, 9], metadata: { transformAxes: [0, 1] } });
    fabric.update('a', { canonicalPoint: [0.5, -0.25, 0, 9], gesture: 'scale' });
    fabric.update('b', { canonicalPoint: [0.5 + Math.sqrt(2) * 1.5, -0.25 + Math.sqrt(2) * 1.5, 0, 9], gesture: 'rotate' });
    return fabric.preview('relic', 4);
  };
  const touch = make('touch');
  const hand = make('hand');
  assert.ok(Math.abs(touch.translation[0] - (0.5 + (Math.sqrt(2) * 1.5 - 1.5)) / 2) < 1e-12);
  assert.ok(Math.abs(touch.translation[1] - (-0.25 + (Math.sqrt(2) * 1.5 - 0.25)) / 2) < 1e-12);
  assert.ok(Math.abs(touch.scale - 1.5) < 1e-12);
  assert.ok(Math.abs(touch.rotation - Math.PI / 4) < 1e-12);
  assert.deepEqual(touch.geometry.axes, [0, 1]);
  assert.deepEqual(hand, touch);
  assert.equal(touch.geometry.scale, touch.scale);
  assert.equal(touch.geometry.rotation, touch.rotation);
  assert.equal(touch.translation[3], 0);
});

test('pair release order preserves the same accepted transform and selective loss keeps the survivor', () => {
  const resultFor = (firstRelease, reason = 'touch-release') => {
    const fabric = new SpatialInteractionFabric({ now: () => 100 });
    fabric.begin({ contactId: 'a', source: { kind: 'touch', id: 'a' }, objectId: 'relic', canonicalPoint: [0, 0, 0] });
    fabric.begin({ contactId: 'b', source: { kind: 'hand', id: 'b' }, objectId: 'relic', canonicalPoint: [2, 0, 0] });
    fabric.update('a', { canonicalPoint: [0.5, -0.25, 0] });
    fabric.update('b', { canonicalPoint: [0.5 + Math.sqrt(2) * 1.5, -0.25 + Math.sqrt(2) * 1.5, 0] });
    const first = fabric.end(firstRelease, reason);
    const second = cancelledReasonForTest(reason) ? null : fabric.end(firstRelease === 'a' ? 'b' : 'a', 'touch-release');
    return { first, second, fabric };
  };
  const aFirst = resultFor('a');
  const bFirst = resultFor('b');
  assert.deepEqual(aFirst.first.acceptedPreview.geometry, bFirst.first.acceptedPreview.geometry);
  assert.deepEqual(aFirst.first.acceptedPreview.translation, bFirst.first.acceptedPreview.translation);
  assert.deepEqual(aFirst.second.acceptedPreview.geometry, aFirst.first.acceptedPreview.geometry);
  assert.deepEqual(aFirst.second.acceptedPreview.translation, aFirst.first.acceptedPreview.translation);

  const cancelled = resultFor('a', 'hand-lost');
  assert.equal(cancelled.first.acceptedPreview, null);
  assert.deepEqual(cancelled.fabric.forObject('relic').map(item => item.contactId), ['b']);
  const survivor = cancelled.fabric.preview('relic', 3);
  assert.deepEqual(survivor.contactIds, ['b']);
  assert.deepEqual(survivor.translation, [Math.sqrt(2) * 1.5 - 1.5, Math.sqrt(2) * 1.5 - 0.25, 0]);
});

test('independent objects retain contact identity and previews without cross-object transforms', () => {
  const fabric = new SpatialInteractionFabric({ now: () => 100 });
  fabric.begin({ contactId: 'left', source: { kind: 'touch', id: 'left' }, objectId: 'relic', canonicalPoint: [-1, 0, 0] });
  fabric.begin({ contactId: 'right', source: { kind: 'hand', id: 'right' }, objectId: 'workpiece', canonicalPoint: [1, 1, 0] });
  fabric.update('left', { canonicalPoint: [-0.4, 0.2, 0] });
  fabric.update('right', { canonicalPoint: [1.2, 1.7, 0] });
  const left = fabric.preview('relic', 3);
  const right = fabric.preview('workpiece', 3);
  assert.deepEqual(left.contactIds, ['left']);
  assert.deepEqual(right.contactIds, ['right']);
  assert.deepEqual(left.translation, [0.6, 0.2, 0]);
  assert.ok(Math.abs(right.translation[0] - 0.2) < 1e-12);
  assert.ok(Math.abs(right.translation[1] - 0.7) < 1e-12);
  assert.notEqual(left.objectId, right.objectId);
  assert.equal(fabric.snapshot().contacts.length, 2);
});

function cancelledReasonForTest(reason) {
  return /cancel|lost|missing|fence|stop|hidden|ambiguous|worker|disconnect|replaced|two-hand/i.test(reason);
}
