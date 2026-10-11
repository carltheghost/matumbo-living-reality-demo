import test from 'node:test';
import assert from 'node:assert/strict';
import { describeHand, matchHands, twoHandTransform } from '../hand-gestures.mjs';

function makeHand({ open = false, offset = 0 } = {}) {
  const points = Array.from({ length: 21 }, () => ({ x: offset, y: 0, z: 0 }));
  const set = (id, x, y) => { points[id] = { x: x + offset, y, z: 0 }; };
  set(0, 0, 0); set(1, .08, -.03); set(2, .13, -.06); set(3, .16, -.1); set(4, open ? -.15 : .195, open ? -.2 : -.012);
  for (const [base, tip, height] of [[5, 8, .45], [9, 12, .5], [13, 16, .43], [17, 20, .36]]) {
    const x = (base - 5) / 20 + .2; set(base, x, 0); set(base + 1, x, -.12); set(base + 2, x, -.25); set(tip, x, open ? -height : -.05);
  }
  return points;
}

function makePoseHand({ thumb = false, index = false, middle = false, ring = false, pinky = false } = {}) {
  const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  const set = (id, x, y) => { points[id] = { x, y, z: 0 }; };
  set(0, 0, 0); set(1, .04, -.02); set(2, .08, -.05); set(3, .12, -.1); set(4, thumb ? -.18 : .12, thumb ? -.24 : -.1);
  for (const [base, extended] of [[5, index], [9, middle], [13, ring], [17, pinky]]) {
    const x = .2 + (base - 5) * .02;
    set(base, x, 0); set(base + 1, x, -.12); set(base + 2, x, -.22); set(base + 3, x, extended ? -.54 : -.08);
  }
  return points;
}

test('one frame contains every finger tip and classifies an open hand and a pinch', () => {
  const open = describeHand(makeHand({ open: true }));
  assert.equal(open.pose, 'open');
  assert.deepEqual(Object.keys(open.fingers), ['thumb', 'index', 'middle', 'ring', 'pinky']);
  assert.equal(Object.values(open.fingers).filter(Boolean).length, 5);
  assert.equal(describeHand(makeHand()).pose, 'pinch');
});

test('two-hand identity survives model result order swapping', () => {
  const left = makeHand({ open: true, offset: 0 }), right = makeHand({ open: true, offset: 1 });
  const first = matchHands([left, right]);
  const previous = first.map(hand => ({ center: [(hand.landmarks[0].x + hand.landmarks[9].x) / 2, (hand.landmarks[0].y + hand.landmarks[9].y) / 2] }));
  const swapped = matchHands([right, left], previous);
  assert.equal(swapped[0].landmarks[0].x, left[0].x);
  assert.equal(swapped[1].landmarks[0].x, right[0].x);
  assert.equal(swapped[0].id, 'hand-1'); assert.equal(swapped[1].id, 'hand-2');
});

test('detector handedness wins over a crossing and preserves held identities', () => {
  const left = makeHand({ open: true, offset: 0.45 }), right = makeHand({ open: true, offset: 0.55 });
  const first = matchHands([{ landmarks: left, handedness: 'Left' }, { landmarks: right, handedness: 'Right' }]);
  const crossed = matchHands([{ landmarks: makeHand({ open: true, offset: 0.53 }), handedness: 'Right' }, { landmarks: makeHand({ open: true, offset: 0.47 }), handedness: 'Left' }], first);
  assert.equal(crossed.ambiguous, false);
  assert.equal(crossed.find(hand => hand.handedness === 'left').id, 'hand-1');
  assert.equal(crossed.find(hand => hand.handedness === 'right').id, 'hand-2');
});

test('strong contradictory handedness is a loss, not continuity on the old hand', () => {
  const first = matchHands([
    { landmarks: makeHand({ open: true, offset: 0 }), handedness: 'Left', confidence: 0.99 },
    { landmarks: makeHand({ open: true, offset: 6 }), handedness: 'Right', confidence: 0.99 },
  ]);
  const replacement = matchHands([
    { landmarks: makeHand({ open: false, offset: 0.45 }), handedness: 'Right', confidence: 0.99 },
  ], first);
  assert.deepEqual(replacement.map(hand => hand.id), ['hand-2']);
  assert.deepEqual(replacement.conflictingIds, ['hand-1']);
});

test('near-tie crossing is explicitly ambiguous instead of transferring ownership', () => {
  const first = matchHands([makeHand({ open: true, offset: 0.45 }), makeHand({ open: true, offset: 0.55 })]);
  const crossing = matchHands([makeHand({ open: true, offset: 0.5 }), makeHand({ open: true, offset: 0.5 })], first);
  assert.equal(crossing.ambiguous, true);
  assert.deepEqual(crossing.ambiguousIds, ['hand-1', 'hand-2']);
});

test('two-hand span changes zoom and wrist angle changes Eye roll', () => {
  const start = twoHandTransform([10, 10], [110, 10]);
  const next = twoHandTransform([10, 10], [160, 60], start);
  assert.ok(next.scale > 1);
  assert.ok(next.rotation > 0);
  assert.ok(next.midpoint.every(Number.isFinite));
});

test('articulated fingers classify pointing, peace, thumbs-up and fist poses', () => {
  assert.equal(describeHand(makePoseHand({ index: true })).pose, 'point');
  assert.equal(describeHand(makePoseHand({ index: true, middle: true })).pose, 'peace');
  assert.equal(describeHand(makePoseHand({ thumb: true })).pose, 'thumbs-up');
  assert.equal(describeHand(makePoseHand()).pose, 'fist');
});
