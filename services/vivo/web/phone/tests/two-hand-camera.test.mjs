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

function makePoseHand({ thumb = false, index = false, middle = false, ring = false, pinky = false, offset = 0 } = {}) {
  const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  const set = (id, x, y) => { points[id] = { x: x + offset, y, z: 0 }; };
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

test('handedness survives a one-frame occlusion and reacquire keeps the same IDs', () => {
  const tracked = [];
  const scope = {
    innerWidth: 400,
    performance: { now: () => 100 },
    document: { getElementById: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 600 }) }) },
    addEventListener() {},
  };
  const camera = new PhoneTwoHandCamera({ video: { videoWidth: 640, videoHeight: 480 }, renderer: {}, onHands: hands => tracked.push(hands), scope });
  const left = makePinchHand(0), right = makePinchHand(1);
  camera.consume({ sequence: 1, hands: [{ landmarks: left, handedness: 'Left' }, { landmarks: right, handedness: 'Right' }] });
  camera.consume({ sequence: 2, hands: [{ landmarks: left, handedness: 'Left' }] });
  assert.deepEqual(tracked.at(-1).map(hand => hand.id), ['hand-1']);
  camera.consume({ sequence: 3, hands: [{ landmarks: right, handedness: 'Right' }, { landmarks: left, handedness: 'Left' }] });
  assert.equal(tracked.at(-1).find(hand => hand.handedness === 'left').id, 'hand-1');
  assert.equal(tracked.at(-1).find(hand => hand.handedness === 'right').id, 'hand-2');
});

test('ambiguous crossing releases an owned hand instead of transferring it', () => {
  const gestures = [];
  const scope = {
    innerWidth: 400,
    performance: { now: () => 100 },
    document: { getElementById: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 600 }) }) },
    addEventListener() {},
  };
  const camera = new PhoneTwoHandCamera({ video: { videoWidth: 640, videoHeight: 480 }, renderer: {}, onGesture: event => gestures.push(event), scope });
  camera.consume({ sequence: 1, landmarks: [makePinchHand(0.45), makePinchHand(0.55)] });
  camera.held.add('hand-1');
  camera.consume({ sequence: 2, landmarks: [makePinchHand(0.5), makePinchHand(0.5)] });
  assert.ok(gestures.some(event => event.type === 'release' && event.handId === 'hand-1' && event.reason === 'ambiguous hand crossing'));
  assert.ok(gestures.some(event => event.type === 'lost' && event.reason === 'ambiguous hand crossing'));
});

test('contradictory handedness releases the old owner and requires an open-hand re-arm', () => {
  const gestures = [];
  const scope = {
    innerWidth: 400,
    performance: { now: () => 100 },
    document: { getElementById: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 600 }) }) },
    addEventListener() {},
  };
  const camera = new PhoneTwoHandCamera({ video: { videoWidth: 640, videoHeight: 480 }, renderer: {}, onGesture: event => gestures.push(event), scope });
  camera.consume({ sequence: 1, hands: [
    { landmarks: makePinchHand(0), handedness: 'Left', confidence: 0.99 },
    { landmarks: makePinchHand(6), handedness: 'Right', confidence: 0.99 },
  ] });
  camera.held.add('hand-1');
  camera.consume({ sequence: 2, hands: [{ landmarks: makePinchHand(0.45), handedness: 'Right', confidence: 0.99 }] });
  assert.ok(gestures.some(event => event.type === 'release' && event.handId === 'hand-1' && event.reason === 'contradictory handedness'));
  assert.equal(gestures.filter(event => event.type === 'move' && event.handId === 'hand-1').length, 0);
  assert.equal(camera.armed.has('hand-2'), false);
  camera.consume({ sequence: 3, hands: [{ landmarks: makePoseHand({ thumb: true, index: true, middle: true, ring: true, pinky: true, offset: 0.45 }), handedness: 'Right', confidence: 0.99 }] });
  camera.consume({ sequence: 4, hands: [{ landmarks: makePinchHand(0.45), handedness: 'Right', confidence: 0.99 }] });
  assert.ok(gestures.some(event => event.type === 'grab' && event.handId === 'hand-2'));
});

test('late inference releases held ownership and rejects stale moves until re-armed', () => {
  let now = 0;
  const gestures = [];
  const scope = {
    innerWidth: 400,
    performance: { now: () => now },
    document: { getElementById: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 600 }) }) },
    addEventListener() {},
  };
  const camera = new PhoneTwoHandCamera({ video: { videoWidth: 640, videoHeight: 480 }, renderer: {}, onGesture: event => gestures.push(event), scope });
  camera.consume({ sequence: 1, time: 0, landmarks: [makePoseHand({ thumb: true, index: true, middle: true, ring: true, pinky: true })] });
  now = 20;
  camera.consume({ sequence: 2, time: 20, landmarks: [makePinchHand(0)] });
  now = 1000;
  camera.consume({ sequence: 3, time: 20, landmarks: [makePinchHand(0.1)] });
  assert.ok(gestures.some(event => event.type === 'release' && event.reason === 'stale hand inference result'));
  const movesAtRelease = gestures.filter(event => event.type === 'move').length;
  now = 1010;
  camera.consume({ sequence: 4, time: 1010, landmarks: [makePinchHand(0.1)] });
  assert.equal(gestures.filter(event => event.type === 'move').length, movesAtRelease);
  now = 1020;
  camera.consume({ sequence: 5, time: 1020, landmarks: [makePoseHand({ thumb: true, index: true, middle: true, ring: true, pinky: true, offset: 0.1 })] });
  now = 1030;
  camera.consume({ sequence: 6, time: 1030, landmarks: [makePinchHand(0.1)] });
  assert.equal(gestures.filter(event => event.type === 'grab').length, 2);
});

test('worker failure and background interruption release ownership and stop the camera', () => {
  const gestures = [], listeners = {};
  const scope = {
    innerWidth: 400,
    performance: { now: () => 100 },
    document: {
      visibilityState: 'visible',
      getElementById: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 600 }) }),
      addEventListener: (name, listener) => { listeners[name] = listener; },
    },
    addEventListener() {},
  };
  const camera = new PhoneTwoHandCamera({
    video: { videoWidth: 640, videoHeight: 480 }, renderer: {}, onGesture: event => gestures.push(event), scope,
  });
  const track = { stop() {} };
  camera.stream = { getTracks: () => [track] }; camera.worker = { terminate() {} }; camera.ready = true; camera.held.add('hand-1');
  camera.handleWorkerFailure('worker exploded');
  assert.equal(camera.active, false);
  assert.ok(gestures.some(event => event.type === 'release' && event.reason === 'Hand inference failed: worker exploded'));

  const second = new PhoneTwoHandCamera({
    video: { videoWidth: 640, videoHeight: 480 }, renderer: {}, onGesture: event => gestures.push(event), scope,
  });
  second.stream = { getTracks: () => [track] }; second.worker = { terminate() {} }; second.ready = true; second.held.add('hand-2');
  scope.document.visibilityState = 'hidden'; listeners.visibilitychange();
  assert.equal(second.active, false);
  assert.ok(gestures.some(event => event.type === 'release' && event.handId === 'hand-2' && /page was hidden/.test(event.reason)));
});

