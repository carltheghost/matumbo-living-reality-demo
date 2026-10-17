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
