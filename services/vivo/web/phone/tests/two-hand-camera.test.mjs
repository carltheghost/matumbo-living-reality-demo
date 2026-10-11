import test from 'node:test';
import assert from 'node:assert/strict';
import { PhoneTwoHandCamera } from '../two-hand-camera.mjs';

function makePinchHand(offset = 0) {
  const points = Array.from({ length: 21 }, () => ({ x: offset, y: 0, z: 0 }));
  const set = (id, x, y) => { points[id] = { x: x + offset, y, z: 0 }; };
  set(0, 0, 0); set(1, .08, -.03); set(2, .13, -.06); set(3, .16, -.1); set(4, .195, -.012);
  for (const [base, tip, height] of [[5,8,.45],[9,12,.5],[13,16,.43],[17,20,.36]]) {
    const x = (base - 5) / 20 + .2;
    set(base, x, 0); set(base + 1, x, -.12); set(base + 2, x, -.25); set(tip, x, -.05);
  }
  return points;
}

function makePoseHand({ thumb = false, index = false, middle = false, ring = false, pinky = false } = {}) {
  const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  const set = (id, x, y) => { points[id] = { x, y, z: 0 }; };
  set(0, 0, 0); set(1, .04, -.02); set(2, .08, -.05); set(3, .12, -.1);
  set(4, thumb ? -.18 : .12, thumb ? -.24 : -.1);
  for (const [base, extended] of [[5,index],[9,middle],[13,ring],[17,pinky]]) {
    const x = .2 + (base - 5) * .02;
    set(base, x, 0); set(base + 1, x, -.12); set(base + 2, x, -.22); set(base + 3, x, extended ? -.54 : -.08);
  }
  return points;
}

test('phone camera consumes two 21-landmark hands and turns a two-hand pinch into zoom', () => {
  let now = 0;
  const tracked = [], gestures = [];
  const scope = {
    innerWidth: 400,
    performance: { now: () => now },
    document: { getElementById: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 600 }) }) },
    addEventListener() {},
  };
  const camera = new PhoneTwoHandCamera({
    video: { videoWidth: 640, videoHeight: 480 },
    renderer: {},
    onHands: hands => tracked.push(hands),
    onGesture: event => gestures.push(event),
    scope,
  });
  camera.consume({ sequence: 1, landmarks: [makePinchHand(0), makePinchHand(1)] });
  now = 50;
  camera.consume({ sequence: 2, landmarks: [makePinchHand(0), makePinchHand(1.2)] });

  assert.equal(tracked.at(-1).length, 2);
  for (const hand of tracked.at(-1)) {
    assert.equal(hand.screenLandmarks.length, 21);
    assert.deepEqual(Object.keys(hand.fingers), ['thumb', 'index', 'middle', 'ring', 'pinky']);
  }
  const zooms = gestures.filter(event => event.type === 'twohand');
  assert.equal(zooms.length, 2);
  assert.ok(zooms[1].scale > 1);
  assert.ok(zooms[1].midpoint.every(Number.isFinite));
});

test('an open hand arms a pinch grab and an open hand releases it', () => {
  const gestures = [];
  const scope = {
    innerWidth: 400,
    performance: { now: () => 100 },
    document: { getElementById: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 600 }) }) },
    addEventListener() {},
  };
  const camera = new PhoneTwoHandCamera({ video: { videoWidth: 640, videoHeight: 480 }, renderer: {}, onGesture: event => gestures.push(event), scope });
  camera.consume({ sequence: 1, landmarks: [makePoseHand({ thumb: true, index: true, middle: true, ring: true, pinky: true })] });
  camera.consume({ sequence: 2, landmarks: [makePinchHand(0)] });
  camera.consume({ sequence: 3, landmarks: [makePoseHand({ thumb: true, index: true, middle: true, ring: true, pinky: true })] });
  assert.equal(gestures.filter(event => event.type === 'grab').length, 1);
  assert.equal(gestures.filter(event => event.type === 'release').length, 1);
});

