import test from 'node:test';
import assert from 'node:assert/strict';
import { createEyeTracker, EYE_TRACKER_ASSETS, EYE_TRACKER_MODEL_OPTIONS } from '../src/render/eye-tracker.js';
import { eyeFixture, TRAIN_TARGETS, VALIDATION_TARGETS } from './fixtures/eye-gaze-fixture.mjs';
const video = () => ({ videoWidth: 640, videoHeight: 640, readyState: 4 });
function trackerHarness(options = {}) {
  let time = 0, target = {}, view = { width: 1600, height: 900 }, closed = 0;
  const samples = [], statuses = [], calls = [], feedVideo = video();
  const tracker = createEyeTracker({ now: () => time, viewport: () => view, onSample: s => samples.push(s), onStatus: s => statuses.push(s),
    landmarkerFactory: async args => { calls.push(args.delegate); return { detectForVideo: () => eyeFixture(target), close() { closed++; } }; }, ...options });
  async function feed(nextTarget = {}, source = { kind: 'camera', mirrored: true, id: 'source-1', generation: 1 }, nextVideo = feedVideo) {
    target = nextTarget; time += 80; return tracker.processFrame({ video: nextVideo, timestamp: time, source });
  }
  async function calibrate() {
    tracker.startCalibration();
    for (const target of [...TRAIN_TARGETS, ...VALIDATION_TARGETS]) {
      for (let i = 0; i < 6; i++) await feed(target);
      assert.equal(tracker.calibrationSample(target).accepted, true);
    }
    return tracker.finishCalibration();
  }
  return { tracker, samples, statuses, calls, feed, calibrate, advance(ms) { time += ms; }, resize(width, height) { view = { width, height }; }, get closed() { return closed; }, get time() { return time; } };
}

test('constructing tracker performs no model load; opt-in readiness differs from source and calibrated gaze', async () => {
  const h = trackerHarness(); assert.deepEqual(h.calls, []); assert.equal(h.tracker.getSnapshot().state, 'disabled');
  assert.equal(h.tracker.startCalibration().reason, 'eye-detector-not-ready');
  assert.equal(await h.tracker.enable(), true); const ready = h.tracker.getSnapshot();
  assert.equal(ready.detectorReady, true); assert.equal(ready.sourceRunning, false); assert.equal(ready.sample.valid, false);
  const sample = await h.feed(); assert.equal(sample.valid, false); assert.equal(h.tracker.getSnapshot().sourceRunning, true);
  assert.equal(h.tracker.getSnapshot().framesUploaded, false); assert.equal(h.tracker.getSnapshot().identityRecognition, false);
  h.tracker.destroy(); assert.equal(h.closed, 1); assert.equal(h.tracker.getSnapshot().state, 'destroyed');
  assert.equal(await h.tracker.enable(), false);
});

test('GPU initialization failure uses CPU delegate with the same local assets', async () => {
  const calls = []; const tracker = createEyeTracker({ landmarkerFactory: async args => { calls.push(args); if (args.delegate === 'GPU') throw new Error('unavailable GPU');
    return { detectForVideo: () => eyeFixture(), close() {} }; } });
  assert.equal(await tracker.enable(), true); assert.deepEqual(calls.map(c => c.delegate), ['GPU', 'CPU']);
  assert.equal(calls[1].assets, EYE_TRACKER_ASSETS); assert.equal(tracker.getSnapshot().delegate, 'CPU'); tracker.destroy();
  assert.equal(calls[1].options, EYE_TRACKER_MODEL_OPTIONS); assert.equal(calls[1].options.numFaces, 2);
  assert.equal(calls[1].options.runningMode, 'VIDEO');
  for (const key of ['minFaceDetectionConfidence', 'minFacePresenceConfidence', 'minTrackingConfidence']) assert.equal(calls[1].options[key], .7);
  assert.equal(calls[1].options.outputFaceBlendshapes, true); assert.equal(calls[1].options.outputFacialTransformationMatrixes, true);
});

test('bounded load, cancellation and late candidates close resources without becoming ready', async () => {
  let stop = 0; const pending = new Promise(() => {}); pending.close = () => { stop++; };
  const timeoutTracker = createEyeTracker({ loadTimeoutMs: 15, landmarkerFactory: () => pending });
  assert.equal(await timeoutTracker.enable(), false); assert.equal(timeoutTracker.getSnapshot().reason, 'model-load-timeout'); assert.equal(stop, 1); timeoutTracker.destroy();
  let resolve, closed = 0; const cancelled = createEyeTracker({ landmarkerFactory: () => new Promise(r => { resolve = r; }) });
  const loading = cancelled.enable(); cancelled.disable(); assert.equal(await loading, false);
  resolve({ detectForVideo() {}, close() { closed++; } }); await new Promise(r => setImmediate(r));
  assert.equal(closed, 1); assert.equal(cancelled.getSnapshot().detectorReady, false); cancelled.destroy();
});

test('synthetic calibration integration invalidates a valid sample when restarted or viewport changes without a new frame', async () => {
  const h = trackerHarness(); await h.tracker.enable(); assert.equal((await h.calibrate()).accepted, true);
  assert.equal((await h.feed({ x: .6, y: .4 })).valid, true);
  h.resize(900, 900); const resized = h.tracker.getSnapshot(); assert.equal(resized.sample.valid, false); assert.equal(resized.calibration.reason, 'viewport-changed');
  assert.equal(h.samples.at(-1).valid, false); assert.equal((await h.calibrate()).accepted, true); await h.feed();
  h.tracker.startCalibration(); assert.equal(h.samples.at(-1).valid, false); h.tracker.destroy();
});

test('camera generation or source changes clear calibration and stale receipt clears the output', async () => {
  const h = trackerHarness(); await h.tracker.enable(); await h.calibrate(); await h.feed();
  await h.feed({}, { kind: 'camera', mirrored: true, id: 'source-1', generation: 2 });
  assert.equal(h.tracker.getSnapshot().calibration.calibrated, false); assert.equal(h.tracker.getSnapshot().calibration.reason, 'source-changed');
  h.advance(351); const snapshot = h.tracker.getSnapshot(); assert.equal(snapshot.sourceRunning, false); assert.equal(snapshot.sample.reason, 'stale-frame'); h.tracker.destroy();
});

test('out-of-order frames and detector errors emit invalid points; detector timeout closes the worker', async () => {
  const h = trackerHarness(); await h.tracker.enable(); await h.feed();
  const repeated = await h.tracker.processFrame({ video: video(), timestamp: h.time, source: { kind: 'camera' } });
  // A different video is a new source, so repeat within that same video to test ordering.
  assert.equal(repeated.valid, false); const sameVideo = video(); await h.tracker.processFrame({ video: sameVideo, timestamp: h.time, source: {} });
  assert.equal((await h.tracker.processFrame({ video: sameVideo, timestamp: h.time, source: {} })).reason, 'non-monotonic-frame'); h.tracker.destroy();
  let closed = 0; const timeout = trackerHarness({ detectionTimeoutMs: 10, coldFrameTimeoutMs: 10, landmarkerFactory: async () => ({ detectForVideo: () => new Promise(() => {}), close() { closed++; } }) });
  await timeout.tracker.enable(); assert.equal((await timeout.feed()).reason, 'detector-timeout'); assert.equal(closed, 1); assert.equal(timeout.tracker.getSnapshot().detectorReady, false); timeout.tracker.destroy();
  const failed = trackerHarness({ landmarkerFactory: async () => ({ detectForVideo() { throw new Error('raw internal detail'); }, close() {} }) });
  await failed.tracker.enable(); assert.equal((await failed.feed()).reason, 'face-detection-failed'); assert.equal(JSON.stringify(failed.statuses).includes('raw internal detail'), false); failed.tracker.destroy();
});

test('in-flight result from an old source is discarded and processing remains single flight', async () => {
  let resolve, calls = 0; const h = trackerHarness({ landmarkerFactory: async () => ({ detectForVideo() { calls++; return new Promise(r => { resolve = r; }); }, close() {} }) });
  await h.tracker.enable(); const old = h.feed(); await new Promise(r => setImmediate(r));
  assert.equal(await h.feed({}, { id: 'source-2' }), null); assert.equal(calls, 1);
  resolve(eyeFixture()); assert.equal(await old, null); assert.equal(h.tracker.getSnapshot().sample.valid, false); h.tracker.destroy();
});

test('cold first face has a separate bounded warmup and warmed detection uses the shorter timeout', async () => {
  let calls = 0, closed = 0;
  const h = trackerHarness({ coldFrameTimeoutMs: 80, detectionTimeoutMs: 10,
    landmarkerFactory: async () => ({ detectForVideo() { calls++; return calls === 1
      ? new Promise(resolve => setTimeout(() => resolve(eyeFixture()), 25)) : new Promise(() => {}); }, close() { closed++; } }) });
  await h.tracker.enable();
  assert.equal((await h.feed()).reason, 'calibration-needed'); assert.equal(h.tracker.getSnapshot().detectorReady, true);
  assert.equal((await h.feed()).reason, 'detector-timeout'); assert.equal(closed, 1); h.tracker.destroy();
});

test('a second detected face removes the calibrated point and capture stability immediately', async () => {
  const h = trackerHarness(); await h.tracker.enable(); await h.calibrate(); assert.equal((await h.feed()).valid, true);
  const ambiguous = await h.feed({ faceCount: 2 }); assert.equal(ambiguous.reason, 'multiple-faces'); assert.equal(ambiguous.point, null);
  assert.equal(h.samples.at(-1).valid, false); h.tracker.startCalibration(); await h.feed({ faceCount: 2 });
  assert.equal(h.tracker.calibrationSample(TRAIN_TARGETS[0]).reason, 'fresh-eyes-needed'); h.tracker.destroy();
});
