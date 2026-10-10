// Deliberately synthetic geometry. This proves contracts, never human accuracy.
export const TRAIN_TARGETS = [.1, .5, .9].flatMap(y => [.1, .5, .9].map(x => ({ x, y, phase: 'train' })));
export const VALIDATION_TARGETS = [[.3, .3], [.7, .3], [.5, .5], [.3, .7], [.7, .7]].map(([x, y]) => ({ x, y, phase: 'validate' }));
export const CONTEXT = Object.freeze({ videoWidth: 640, videoHeight: 640, viewportWidth: 1600, viewportHeight: 900,
  sourceId: 'synthetic-source-1', sourceGeneration: 1, kind: 'camera', mirrored: true, videoId: 1 });
export function eyeFixture({ x = .5, y = .5, irisX = .5 + .2 * (x - .5), irisY = .12 * (y - .5), openness = .3,
  blink = 0, shiftX = 0, shiftY = 0, yaw = 0, pitch = 0, faceCount = 1 } = {}) {
  const face = Array.from({ length: 478 }, () => ({ x: .5 + shiftX, y: .5 + shiftY, z: 0 }));
  const p = (index, px, py) => { face[index] = { x: px + shiftX, y: py + shiftY, z: 0 }; };
  for (const [a, b, top, bottom, center, ring, left] of [[33, 133, 159, 145, 468, [469, 470, 471, 472], .25], [362, 263, 386, 374, 473, [474, 475, 476, 477], .65]]) {
    p(a, left, .4); p(b, left + .1, .4); p(top, left + .05, .4 - openness * .05); p(bottom, left + .05, .4 + openness * .05);
    const cx = left + .1 * irisX, cy = .4 + .1 * irisY;
    p(center, cx, cy); [[.01, 0], [0, .01], [-.01, 0], [0, -.01]].forEach(([dx, dy], i) => p(ring[i], cx + dx, cy + dy));
  }
  p(1, .5, .54);
  const matrix = [1, 0, 0, 0, 0, 1, 0, 0, yaw, pitch, Math.sqrt(Math.max(0, 1 - yaw * yaw - pitch * pitch)), 0, 0, 0, 0, 1];
  return { faceLandmarks: Array.from({ length: faceCount }, () => face), faceBlendshapes: [{ categories: ['eyeBlinkLeft', 'eyeBlinkRight'].map(categoryName => ({ categoryName, score: blink })) }],
    facialTransformationMatrixes: [{ rows: 4, columns: 4, data: matrix }] };
}
export function makeEstimatorHarness(createEstimator) {
  let time = 0;
  const estimator = createEstimator({ now: () => time });
  estimator.setContext(CONTEXT);
  const feed = (target = {}, options = {}, context = CONTEXT) => { time += 80; return estimator.update(eyeFixture({ ...target, ...options }), time, context); };
  const capture = (target, options = {}, context = CONTEXT) => { for (let i = 0; i < 6; i++) feed(target, options, context); return estimator.calibrationSample(target); };
  const calibrate = () => { estimator.startCalibration(); for (const target of [...TRAIN_TARGETS, ...VALIDATION_TARGETS]) {
    const result = capture(target); if (!result.accepted) throw new Error(result.reason);
  } return estimator.finishCalibration(); };
  return { estimator, feed, capture, calibrate, advance(ms) { time += ms; }, get time() { return time; } };
}
