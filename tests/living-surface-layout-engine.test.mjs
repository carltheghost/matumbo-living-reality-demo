import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fitObjectToContent,
  layoutObjects,
  measureContent,
  surfaceTransform,
  clampToView,
} from '../src/domains/living-surface-layout-engine.js';

const EPSILON = 1e-9;
const VOLUME_RATIO_LIMIT = 1.6;
const VIEWPORT_FRACTION_LIMIT = 0.4;

const volume = ({width, height, depth}) => width * height * depth;
const dims = result => ({width: result.width, height: result.height, depth: result.depth});

const CONTENT_CASES = [
  {title: 'Tiny', lines: ['one'], actions: []},
  {title: 'Short', lines: ['one', 'two'], actions: ['Open']},
  {title: 'Wide', lines: ['a moderately long line of readable content'], actions: ['Open', 'Close']},
  {title: 'Tall', lines: ['one', 'two', 'three', 'four', 'five', 'six'], actions: ['Next']},
  {title: 'Dense', lines: Array.from({length: 12}, (_, i) => `line ${i + 1} with useful information`), actions: ['Back', 'Next', 'Open']},
];

test('measureContent is monotonic with added lines and actions', () => {
  const base = measureContent({title: 'Reality', lines: ['one'], actions: []});
  const moreLines = measureContent({title: 'Reality', lines: ['one', 'two', 'three'], actions: []});
  const moreActions = measureContent({title: 'Reality', lines: ['one'], actions: ['Open', 'Close']});
  const longerTitle = measureContent({title: 'A much longer Reality Lens title', lines: ['one'], actions: []});

  assert.ok(moreLines.height > base.height, 'adding content lines must increase content height');
  assert.ok(moreActions.height >= base.height, 'adding actions must not shrink content height');
  assert.ok(moreActions.width >= base.width, 'adding actions must not shrink content width');
  assert.ok(longerTitle.width > base.width, 'a longer title must increase measured width');
  for (const metrics of [base, moreLines, moreActions, longerTitle]) {
    assert.ok(Number.isFinite(metrics.width) && Number.isFinite(metrics.height));
    assert.ok(metrics.width > 0 && metrics.height > 0);
  }
});

test('fitObjectToContent keeps empty volume within 1.6x the content box across sizes', () => {
  for (const descriptor of CONTENT_CASES) {
    const metrics = measureContent(descriptor);
    const fit = fitObjectToContent(metrics, {padding: 0.08});
    assert.ok(fit.width > 0 && fit.height > 0 && fit.depth > 0);
    const contentBox = metrics.width * metrics.height;
    const ratio = volume(fit) / (contentBox * Math.max(fit.depth, 1));
    assert.ok(ratio <= VOLUME_RATIO_LIMIT + EPSILON,
      `${descriptor.title}: empty-volume ratio ${ratio} exceeds ${VOLUME_RATIO_LIMIT}`);
  }
});

test('fitObjectToContent selects the smallest suitable shape rather than an oversized default', () => {
  const cases = [
    {metrics: {width: 1.2, height: 1.2}, expected: 'cube'},
    {metrics: {width: 1.2, height: 2.4}, expected: 'phone'},
    {metrics: {width: 3.2, height: 1.8}, expected: 'rectangle'},
  ];

  for (const {metrics, expected} of cases) {
    const fit = fitObjectToContent(metrics, {padding: 0});
    assert.equal(fit.shape, expected, `${metrics.width}x${metrics.height} should use the smallest matching shape`);
    assert.ok(fit.width <= metrics.width * 1.6 + EPSILON);
    assert.ok(fit.height <= metrics.height * 1.6 + EPSILON);
  }
});

test('fitObjectToContent applies padding without changing the content metrics', () => {
  const metrics = {width: 2, height: 1};
  const unpadded = fitObjectToContent(metrics, {padding: 0});
  const padded = fitObjectToContent(metrics, {padding: 0.25});

  assert.ok(padded.width >= unpadded.width);
  assert.ok(padded.height >= unpadded.height);
  assert.ok(padded.depth >= unpadded.depth);
  assert.ok(padded.width > metrics.width);
  assert.ok(padded.height > metrics.height);
});

test('surfaceTransform mounts a fitted panel on every named face and never inside the volume', () => {
  const object = {width: 4, height: 3, depth: 2};
  const panel = {width: 2, height: 1};

  const expected = {
    front: {axis: 2, sign: 1, faceWidth: object.width},
    back: {axis: 2, sign: -1, faceWidth: object.width},
    left: {axis: 0, sign: -1, faceWidth: object.depth},
    right: {axis: 0, sign: 1, faceWidth: object.depth},
    top: {axis: 1, sign: 1, faceWidth: object.width},
  };

  for (const [face, rule] of Object.entries(expected)) {
    const result = surfaceTransform(object, panel, face);
    assert.equal(result.position.length, 3);
    assert.equal(result.rotation.length, 3);
    assert.ok([...result.position, ...result.rotation, result.width, result.height].every(Number.isFinite));
    assert.ok(result.width > 0 && result.height > 0);
    assert.ok(result.width <= rule.faceWidth + EPSILON, `${face}: panel exceeds face width`);

    const coordinate = result.position[rule.axis];
    const halfExtent = object[['width', 'height', 'depth'][rule.axis]] / 2;
    assert.equal(Math.sign(coordinate), rule.sign, `${face}: panel is not on the outward side`);
    assert.ok(Math.abs(coordinate) > halfExtent,
      `${face}: panel must have an outward offset beyond the object's surface`);

    const bounds = result.position.map((value, i) => Math.abs(value) + 0);
    assert.ok(bounds[rule.axis] > halfExtent, `${face}: panel must never be inside the volume`);
  }
});

test('surfaceTransform keeps mounted panels within the bounds of their supporting face', () => {
  const object = {width: 5, height: 4, depth: 3};
  const panels = [
    ['front', {width: 4.5, height: 3.5}],
    ['back', {width: 4.5, height: 3.5}],
    ['left', {width: 2.5, height: 3.5}],
    ['right', {width: 2.5, height: 3.5}],
    ['top', {width: 4.5, height: 2.5}],
  ];

  for (const [face, panel] of panels) {
    const result = surfaceTransform(object, panel, face);
    assert.ok(result.width <= (face === 'left' || face === 'right' ? object.depth : object.width) + EPSILON);
    assert.ok(result.height <= (face === 'top' ? object.depth : object.height) + EPSILON);
  }
});

test('layoutObjects is deterministic and keeps objects separated', () => {
  const items = [
    {id: 'a', width: 2.4, height: 2, depth: 1.2},
    {id: 'b', width: 1.8, height: 2.2, depth: 1.1},
    {id: 'c', width: 2.1, height: 1.7, depth: 1.3},
    {id: 'd', width: 1.6, height: 2, depth: 1},
  ];
  const viewport = {width: 1200, height: 800};

  const first = layoutObjects(items, viewport);
  const second = layoutObjects(items, viewport);

  assert.deepEqual(first, second);
  assert.deepEqual(first.map(item => item.id), items.map(item => item.id));
  for (const item of first) {
    assert.equal(item.position.length, 3);
    assert.ok(item.position.every(Number.isFinite));
  }

  const minSeparation = Math.min(...items.map(item => Math.max(item.width, item.height, item.depth)));
  for (let i = 0; i < first.length; i += 1) {
    for (let j = i + 1; j < first.length; j += 1) {
      const distance = Math.hypot(...first[i].position.map((value, axis) => value - first[j].position[axis]));
      assert.ok(distance >= minSeparation - EPSILON,
        `objects ${first[i].id} and ${first[j].id} are too close: ${distance}`);
    }
  }
});

test('layoutObjects respects the 40% viewport-height cap for default-distance placements', () => {
  const viewport = {width: 1000, height: 900};
  const items = [
    {id: 'giant', width: 2000, height: 2000, depth: 2000},
    {id: 'normal', width: 180, height: 180, depth: 120},
  ];

  const laidOut = layoutObjects(items, viewport);
  const giant = laidOut.find(item => item.id === 'giant');
  assert.ok(giant);
  assert.ok(Math.abs(giant.position[1]) <= viewport.height * VIEWPORT_FRACTION_LIMIT + EPSILON,
    'a laid-out object must not be allowed to dominate more than 40% of viewport height');
});

test('clampToView clamps oversized and near objects while leaving fine objects unchanged', () => {
  const camera = {
    viewportWidth: 1200,
    viewportHeight: 800,
    near: 0.1,
    defaultDistance: 10,
    minDistance: 2,
    maxDistance: 100,
  };

  const fine = {position: [0, 0, 10], scale: 1, width: 2, height: 2, depth: 2};
  const oversized = {position: [0, 0, 1], scale: 10, width: 20, height: 20, depth: 20};
  const near = {position: [0, 0, 0.2], scale: 1, width: 2, height: 2, depth: 2};

  const fineBefore = structuredClone(fine);
  const fineAfter = clampToView(fine, camera);
  assert.deepEqual(fineAfter, fineBefore, 'an already well-framed object must remain unchanged');

  const largeAfter = clampToView(oversized, camera);
  assert.ok(largeAfter.scale < oversized.scale || Math.hypot(...largeAfter.position) > Math.hypot(...oversized.position),
    'an oversized object must be reduced or moved farther away');
  assert.ok(largeAfter.scale * largeAfter.height <= camera.viewportHeight * VIEWPORT_FRACTION_LIMIT + EPSILON ||
    Math.hypot(...largeAfter.position) >= camera.defaultDistance,
    'the oversized object must no longer dominate the viewport');

  const nearAfter = clampToView(near, camera);
  assert.ok(Math.hypot(...nearAfter.position) >= camera.minDistance - EPSILON,
    'an object too close to the camera must be pushed back');
});
