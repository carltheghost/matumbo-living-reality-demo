import test from 'node:test';
import assert from 'node:assert/strict';
import { PhoneRenderer } from '../phone-render.mjs';
import { SpatialInteractionFabric, mapRendererPointToCanonical } from '../spatial-fabric.mjs';
import { rendererProjectionParameters } from '../projection-parameters.mjs';

const close = (actual, expected, tolerance = 1e-9) => Math.abs(actual - expected) <= tolerance;
const assertVectorClose = (actual, expected, label) => {
  assert.equal(actual.length, expected.length, label);
  assert.ok(actual.every((value, axis) => close(value, expected[axis])), `${label}: ${JSON.stringify({ actual, expected })}`);
};

function makePhoneRenderer({ width, height, yaw, pitch, distance, origin }) {
  const canvas = { getContext: () => null, addEventListener: () => {} };
  const overlay = { getContext: () => ({}) };
  const renderer = new PhoneRenderer(canvas, overlay);
  Object.assign(renderer, { w: width, h: height, yaw, pitch, distance, origin: [...origin] });
  return renderer;
}

function projectCanonical(renderer, q) {
  // The flat phone chart embeds canonical [x1, x2, x3] as [x, z, y].
  return renderer.project([q[0], q[2], q[1]]);
}

function inverseProjected(renderer, projected, q, viewport) {
  return inverseDevicePoint(renderer, { x: projected.x + viewport.left, y: projected.y + viewport.top }, q, viewport, projected.depth);
}

function inverseDevicePoint(renderer, devicePoint, q, viewport, depth) {
  return mapRendererPointToCanonical({
    devicePoint,
    viewport,
    eye: { q: [...q] },
    renderer,
    axes: [0, 2, 1],
    depth,
  });
}

test('PhoneRenderer forward projection and inverse agree at narrow and wide breakpoints for 4D and 11D', () => {
  const viewports = [
    { width: 390, height: 844, left: 13, top: 19 },
    { width: 719, height: 900, left: 7, top: 11 },
    { width: 720, height: 900, left: 5, top: 9 },
    { width: 1024, height: 768, left: 23, top: 17 },
  ];
  const views = [
    { yaw: 0.55, pitch: 0.68, distance: 10.5, origin: [0, 0, 0] },
    { yaw: -0.82, pitch: -0.37, distance: 8.4, origin: [0.4, -0.2, 0.7] },
  ];
  const points = [
    [0.1, 0.72, 0.25],
    [-0.8, -0.2, 0.6],
    [1.2, 0.1, -0.8],
  ];

  for (const dimension of [4, 11]) {
    for (const viewport of viewports) for (const view of views) for (const xyz of points) {
      const q = [...xyz, ...Array(dimension - 3).fill(0).map((_, axis) => (axis + 1) * 0.07)];
      const renderer = makePhoneRenderer({ ...viewport, ...view });
      const projected = projectCanonical(renderer, q);
      const parameters = rendererProjectionParameters(renderer);
      const expectedCenterY = viewport.width < 720 ? viewport.height * 0.37 : viewport.height * 0.52;
      assert.equal(renderer.projectionProfile, 'phone');
      assert.ok(close(parameters.centerY, expectedCenterY), `center mismatch at ${viewport.width}`);
      assert.ok(projected.depth > 0.15, JSON.stringify({ viewport, view, q, projected }));
      assertVectorClose(inverseProjected(renderer, projected, q, viewport), q, `roundtrip ${dimension}D ${viewport.width}px`);
    }
  }
});

test('two contacts keep their canonical anchors across a narrow-to-wide breakpoint resize and rebase safely', () => {
  const renderer = makePhoneRenderer({ width: 390, height: 844, yaw: 0.55, pitch: 0.68, distance: 10.5, origin: [0.2, -0.1, 0.35] });
  const viewport = { left: 0, top: 0, width: 390, height: 844 };
  const first = [0.1, 0.72, 0.25, 0];
  const second = [0.6, 0.72, 0.45, 0];
  const mapAtCurrentSize = q => inverseProjected(renderer, projectCanonical(renderer, q), q, viewport);
  const fabric = new SpatialInteractionFabric({ now: () => 100 });
  fabric.begin({ contactId: 'touch:first', source: { kind: 'touch', id: 'first' }, objectId: 'workpiece', canonicalPoint: mapAtCurrentSize(first), geometryPoint: mapAtCurrentSize(first), metadata: { transformAxes: [0, 2] } });
  fabric.begin({ contactId: 'touch:second', source: { kind: 'touch', id: 'second' }, objectId: 'workpiece', canonicalPoint: mapAtCurrentSize(second), geometryPoint: mapAtCurrentSize(second), metadata: { transformAxes: [0, 2] } });

  renderer.w = 720; renderer.h = 900;
  viewport.width = 720; viewport.height = 900;
  const movedFirst = [0.3, 0.82, 0.35, 0];
  const movedSecond = [0.9, 0.82, 0.55, 0];
  const firstPoint = mapAtCurrentSize(movedFirst);
  const secondPoint = mapAtCurrentSize(movedSecond);
  assertVectorClose(firstPoint, movedFirst, 'resized first contact');
  assertVectorClose(secondPoint, movedSecond, 'resized second contact');
  fabric.update('touch:first', { canonicalPoint: firstPoint, geometryPoint: firstPoint });
  fabric.update('touch:second', { canonicalPoint: secondPoint, geometryPoint: secondPoint });
  const pair = fabric.preview('workpiece', 4);
  assert.ok(pair.translation[0] > 0.15 && pair.translation[1] > 0.05 && pair.translation[2] > 0.05, pair);
  assert.ok(pair.scale > 1, pair);

  const canceled = fabric.end('touch:first', 'touch-cancel:resize-regression');
  assert.equal(canceled.acceptedPreview, null);
  const survivor = fabric.preview('workpiece', 4);
  assert.ok(survivor && survivor.contactIds.length === 1, survivor);
  const beforeRebase = survivor.translation;
  fabric.rebase('touch:second', secondPoint, secondPoint);
  const afterRebase = fabric.preview('workpiece', 4);
  assert.deepEqual(afterRebase.translation, beforeRebase, 'rebasing the surviving contact must not jump the accepted carry');
  const released = fabric.end('touch:second', 'touch-release');
  assert.ok(released.acceptedPreview, released);
});

test('active pointer coordinates remain invertible when a live contact crosses the 720px breakpoint', () => {
  const renderer = makePhoneRenderer({ width: 390, height: 844, yaw: 0.55, pitch: 0.68, distance: 10.5, origin: [0, 0, 0] });
  const viewport = { left: 17, top: 23, width: 390, height: 844 };
  const capturedQ = [0.1, 0.72, 0.25, 0];
  const captured = projectCanonical(renderer, capturedQ);
  const depth = captured.depth;
  const activePointer = { x: 246.25, y: 307.5 };

  renderer.w = 720; renderer.h = 900;
  viewport.width = 720; viewport.height = 900;
  const mapped = inverseDevicePoint(renderer, activePointer, capturedQ, viewport, depth);
  const reprojected = projectCanonical(renderer, mapped);
  assert.equal(rendererProjectionParameters(renderer).centerY, 468);
  assert.ok(close(reprojected.x, activePointer.x - viewport.left), JSON.stringify({ activePointer, viewport, mapped, reprojected }));
  assert.ok(close(reprojected.y, activePointer.y - viewport.top), JSON.stringify({ activePointer, viewport, mapped, reprojected }));
  assert.notDeepEqual(mapped.slice(0, 3), capturedQ.slice(0, 3), 'the same live screen coordinate may map to a new canonical point after resize');
});
