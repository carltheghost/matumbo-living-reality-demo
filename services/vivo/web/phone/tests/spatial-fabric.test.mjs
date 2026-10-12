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
