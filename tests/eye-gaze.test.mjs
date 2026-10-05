import test from 'node:test';
import assert from 'node:assert/strict';
import { createEyeGazeEstimator, extractEyeFeatures } from '../src/domains/eye-gaze.js';
import { eyeFixture, TRAIN_TARGETS, VALIDATION_TARGETS, CONTEXT, makeEstimatorHarness } from './fixtures/eye-gaze-fixture.mjs';
const harness = () => makeEstimatorHarness(createEyeGazeEstimator);

test('synthetic calibration fits nine training targets and evaluates five independent holdouts', () => {
  const h = harness(), calibration = h.calibrate();
  assert.equal(calibration.accepted, true); assert.equal(calibration.trainTargets, 9); assert.equal(calibration.validationTargets, 5);
  assert.ok(calibration.metrics.holdoutRmse < .001); assert.equal(calibration.metrics.measuredAccuracy, false);
  assert.equal(h.estimator.getSnapshot().sample.valid, false);
  const sample = h.feed({ x: .6, y: .4 });
  assert.equal(sample.valid, true); assert.ok(Math.abs(sample.point.x - .6) < .001); assert.ok(Math.abs(sample.point.y - .4) < .001);
  assert.ok(Math.abs(sample.normalized.x - .2) < .002); assert.ok(Math.abs(sample.normalized.y - .2) < .002);
  assert.equal(Object.isFrozen(sample.point), true);
  assert.equal('features' in sample, false); assert.equal('faceLandmarks' in h.estimator.getSnapshot(), false);
});

test('iris localization alone cannot emit a calibrated gaze point', () => {
  const h = harness(); const sample = h.feed(); assert.equal(sample.valid, false); assert.equal(sample.point, null); assert.equal(sample.reason, 'calibration-needed');
});

test('geometry, face count, task confidence and eye openness reject bad observations', () => {
  const cases = [
    [{ faceLandmarks: [] }, 'no-face'],
    [{ faceLandmarks: [eyeFixture().faceLandmarks[0], eyeFixture().faceLandmarks[0]] }, 'multiple-faces'],
    [{ faceLandmarks: [Array(468).fill({ x: .5, y: .5 })] }, 'iris-landmarks-missing'],
    [{ ...eyeFixture(), facePresenceConfidence: .3 }, 'low-confidence'],
    [eyeFixture({ openness: .04 }), 'eyes-closed'], [eyeFixture({ blink: .7 }), 'eyes-closed'],
    [eyeFixture({ irisX: 1.2 }), 'invalid-iris-geometry'], [eyeFixture({ yaw: .8 }), 'head-pose-out-of-range'],
  ];
  const broken = eyeFixture(); broken.faceLandmarks[0][468].x = NaN; cases.push([broken, 'invalid-eye-geometry']);
  const tinyIris = eyeFixture(); for (const i of [469, 470, 471, 472]) tinyIris.faceLandmarks[0][i] = { ...tinyIris.faceLandmarks[0][468] }; cases.push([tinyIris, 'invalid-iris-geometry']);
  for (const [fixture, reason] of cases) { const result = extractEyeFeatures(fixture, CONTEXT); assert.equal(result.valid, false, reason); assert.equal(result.reason, reason); }
  assert.equal(extractEyeFeatures(eyeFixture(), { videoWidth: 0, videoHeight: 0 }).reason, 'invalid-video-geometry');
});

test('capture requires fresh stable eyes, consumes its window and rejects duplicate or invalid targets', () => {
  const h = harness(); h.estimator.startCalibration(); assert.equal(h.estimator.calibrationSample(TRAIN_TARGETS[0]).reason, 'fresh-eyes-needed');
  h.feed(TRAIN_TARGETS[0]); assert.equal(h.estimator.calibrationSample(TRAIN_TARGETS[0]).reason, 'hold-still');
  for (let i = 0; i < 5; i++) h.feed(TRAIN_TARGETS[0]);
  assert.equal(h.estimator.calibrationSample({ x: -1, y: .5 }).reason, 'invalid-target');
  assert.equal(h.estimator.calibrationSample(TRAIN_TARGETS[0]).accepted, true);
  assert.equal(h.estimator.calibrationSample(TRAIN_TARGETS[0]).reason, 'target-already-captured');
  assert.equal(h.estimator.calibrationSample(TRAIN_TARGETS[1]).reason, 'hold-still');
  h.advance(351); assert.equal(h.estimator.calibrationSample(TRAIN_TARGETS[1]).reason, 'fresh-eyes-needed');
});

test('unstable iris or translated head cannot capture; lost face clears prior stable frames', () => {
  const h = harness(); h.estimator.startCalibration();
  for (let i = 0; i < 6; i++) h.feed({}, { irisX: i % 2 ? .6 : .4 });
  assert.equal(h.estimator.calibrationSample(TRAIN_TARGETS[0]).reason, 'eyes-not-stable');
  h.estimator.invalidate('tracking-lost');
  for (let i = 0; i < 6; i++) h.feed({}, { shiftX: i % 2 ? .02 : -.02 });
  assert.equal(h.estimator.calibrationSample(TRAIN_TARGETS[0]).reason, 'head-not-stable');
  h.estimator.update({ faceLandmarks: [] }, h.time, CONTEXT); h.feed();
  assert.equal(h.estimator.calibrationSample(TRAIN_TARGETS[0]).reason, 'hold-still');
});

test('incomplete targets and insufficient screen coverage cannot calibrate', () => {
  const h = harness(); h.estimator.startCalibration(); h.capture(TRAIN_TARGETS[0]); assert.equal(h.estimator.finishCalibration().reason, 'more-targets-needed');
  h.estimator.startCalibration();
  for (const t of TRAIN_TARGETS.map(t => ({ ...t, x: .45 + t.x * .1, y: .45 + t.y * .1 }))) assert.equal(h.capture(t).accepted, true);
  for (const t of VALIDATION_TARGETS) h.capture(t);
  assert.equal(h.estimator.finishCalibration().reason, 'insufficient-target-coverage');
});

test('constant or collinear iris features are rejected despite target coverage', () => {
  for (const collinear of [false, true]) {
    const h = harness(); h.estimator.startCalibration();
    for (const t of [...TRAIN_TARGETS, ...VALIDATION_TARGETS]) h.capture(t, collinear ? { irisX: .5 + .2 * (t.x - .5), irisY: .12 * (t.x - .5) } : { irisX: .5, irisY: 0 });
    assert.equal(h.estimator.finishCalibration().reason, collinear ? 'degenerate-calibration' : 'insufficient-eye-variation');
    assert.equal(h.estimator.getSnapshot().sample.valid, false);
  }
});

test('holdout errors reject a plausible training fit and are not fitted away', () => {
  const h = harness(); h.estimator.startCalibration(); for (const t of TRAIN_TARGETS) h.capture(t);
  for (const t of VALIDATION_TARGETS) h.capture(t, { irisX: .5 + .2 * ((1 - t.x) - .5), irisY: .12 * ((1 - t.y) - .5) });
  const result = h.estimator.finishCalibration(); assert.equal(result.accepted, false); assert.equal(result.reason, 'holdout-error-too-high');
  assert.ok(result.metrics.holdoutRmse > .3); assert.equal(h.feed().point, null);
});

test('source id, generation, mirror, video dimensions and viewport invalidate calibration', () => {
  for (const change of [{ sourceId: 'new-source' }, { sourceGeneration: 2 }, { mirrored: false }, { videoId: 2 }, { videoWidth: 800 }, { viewportWidth: 900 }]) {
    const h = harness(); h.calibrate(); h.feed(); h.estimator.setContext({ ...CONTEXT, ...change });
    const state = h.estimator.getSnapshot(); assert.equal(state.calibration.calibrated, false); assert.equal(state.sample.valid, false);
    assert.equal(state.calibration.reason, 'viewportWidth' in change ? 'viewport-changed' : 'source-changed');
  }
});

test('stale frames, blink and head movement immediately remove a valid point; fresh frames smooth motion', () => {
  const h = harness(); h.calibrate(); const first = h.feed({ x: .3, y: .3 }), next = h.feed({ x: .7, y: .7 });
  assert.ok(next.point.x > first.point.x && next.point.x < .7);
  assert.equal(h.feed({}, { shiftX: .12 }).reason, 'head-moved-recalibrate'); assert.equal(h.feed().valid, true);
  assert.equal(h.feed({}, { blink: 1 }).point, null); assert.equal(h.feed().valid, true);
  h.advance(351); assert.equal(h.estimator.getSnapshot().sample.reason, 'stale-frame');
  assert.equal(h.estimator.update(eyeFixture(), h.time - 400, CONTEXT).valid, false);
  h.feed(); h.estimator.startCalibration(); assert.equal(h.estimator.getSnapshot().sample.valid, false);
});
