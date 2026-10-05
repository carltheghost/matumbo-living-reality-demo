/** Explicit opt-in FaceLandmarker on frames owned by the shared camera.
 * No getUserMedia, own video loop, recording, identity, uploads or persistence.
 * Real detection runs in a worker; injected detectors are synthetic test seams.
 * https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js
 */
import { createEyeGazeEstimator, EYE_GAZE_LIMITS } from '../domains/eye-gaze.js';

export const EYE_TRACKER_ASSETS = Object.freeze({
  moduleUrl: new URL('../../vendor/mediapipe-tasks-vision-1.0.1/vision_bundle.mjs', import.meta.url).href,
  // FilesetResolver appends its own slash; keep the strict static route canonical.
  wasmUrl: new URL('../../vendor/mediapipe-tasks-vision-1.0.1/wasm/', import.meta.url).href.replace(/\/+$/, ''),
  modelUrl: new URL('../../assets/models/vision/face_landmarker.task', import.meta.url).href,
});
export const EYE_TRACKER_LOAD_TIMEOUT_MS = 30_000;
export const EYE_TRACKER_MODEL_OPTIONS = Object.freeze({ runningMode: 'VIDEO', numFaces: 2,
  minFaceDetectionConfidence: .7, minFacePresenceConfidence: .7, minTrackingConfidence: .7,
  outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true });
const finite = value => typeof value === 'number' && Number.isFinite(value);
const close = detector => { try { Promise.resolve(detector?.close?.()).catch(() => {}); } catch {} };
const safeCall = (callback, value) => { try { callback?.(value); } catch {} };

function workerDetector({ delegate, assets, options }) {
  if (typeof Worker !== 'function' || typeof createImageBitmap !== 'function') throw new Error('worker-camera-processing-unavailable');
  // Tasks1.0.1 WASM glue installs ModuleFactory via importScripts. A classic
  // worker supports that path; its entry dynamically imports the local ESM API.
  const worker = new Worker(new URL('./eye-detector-worker.js', import.meta.url));
  let serial = 0, closed = false;
  const pending = new Map();
  const stop = () => {
    if (closed) return; closed = true; worker.terminate();
    for (const { reject } of pending.values()) reject(new Error('detector-closed'));
    pending.clear();
  };
  const request = (type, data = {}, transfer = []) => new Promise((resolve, reject) => {
    if (closed) { reject(new Error('detector-closed')); return; }
    const id = ++serial; pending.set(id, { resolve, reject });
    try { worker.postMessage({ id, type, ...data }, transfer); }
    catch (error) { pending.delete(id); reject(error); }
  });
  worker.onmessage = event => {
    const task = pending.get(event.data?.id); if (!task) return;
    pending.delete(event.data.id);
    if (event.data.error) task.reject(new Error(event.data.error)); else task.resolve(event.data.result);
  };
  worker.onerror = () => { for (const task of pending.values()) task.reject(new Error('local-detector-worker-failed')); pending.clear(); stop(); };
  const initialized = request('init', { delegate, assets, options }).then(() => ({ worker: true,
    async detectForVideo(video, timestamp) {
      const bitmap = await createImageBitmap(video);
      if (closed) { bitmap.close(); throw new Error('detector-closed'); }
      try { return await request('frame', { bitmap, timestamp }, [bitmap]); }
      catch (error) { try { bitmap.close(); } catch {} throw error; }
    }, close: stop }));
  // Expose immediate cleanup to the bounded loader, including initialization stalls.
  initialized.close = stop;
  return initialized;
}

/** processFrame accepts {video,timestamp,source:{kind,mirrored,id?,generation?}}.
 * Targets are screen fractions in [0,1]. Samples also include Three.js NDC.
 * Nine training captures and five separate validation captures are required.
 * Each capture consumes >=6 fresh stable frames; only training captures fit.
 */
export function createEyeTracker({ onSample, onStatus, landmarkerFactory = workerDetector,
  now = () => performance.now(), viewport = () => ({ width: globalThis.innerWidth || 1, height: globalThis.innerHeight || 1 }),
  assets = EYE_TRACKER_ASSETS, loadTimeoutMs = EYE_TRACKER_LOAD_TIMEOUT_MS, detectionTimeoutMs = 1500,
  coldFrameTimeoutMs = 10_000, sampleIntervalMs = 80 } = {}) {
  const estimator = createEyeGazeEstimator({ now });
  let enabled = false, destroyed = false, state = 'disabled', reason = 'eyes-disabled', detector = null, delegate = null;
  let lifecycle = 0, sourceGeneration = 0, lastFrameAt = null, lastTimestamp = -Infinity, lastDetectedAt = -Infinity;
  let contextKey = null, context = null, source = null, busy = false, cold = true, loadController = null, enablePromise = null, watchdog = null;
  const videoIds = new WeakMap(); let nextVideoId = 0;
  function checkStale() {
    const view = viewport();
    if (enabled && context && (view?.width !== context.viewportWidth || view?.height !== context.viewportHeight)) {
      context = { ...context, viewportWidth: view?.width, viewportHeight: view?.height };
      contextKey = JSON.stringify(context); sourceGeneration++; estimator.setContext(context);
      reason = 'viewport-changed'; safeCall(onSample, estimator.invalidate(reason)); notify();
    }
    if (enabled && lastFrameAt !== null && now() - lastFrameAt > EYE_GAZE_LIMITS.staleMs && reason !== 'stale-frame') {
      reason = 'stale-frame'; safeCall(onSample, estimator.invalidate(reason)); notify();
    }
  }
  function getSnapshot() {
    const observed = estimator.getSnapshot();
    return Object.freeze({ enabled, state, reason, detectorReady: Boolean(detector), delegate,
      sourceRunning: enabled && lastFrameAt !== null && now() - lastFrameAt <= EYE_GAZE_LIMITS.staleMs,
      source: source ? Object.freeze({ kind: source.kind, mirrored: source.mirrored }) : null,
      sample: observed.sample, calibration: observed.calibration, processing: busy,
      localOnly: true, framesUploaded: false, recording: false, persistence: false, identityRecognition: false,
      estimateKind: 'empirically-calibrated-RGB-screen-gaze', measuredAccuracy: false, workerExecution: detector?.worker === true });
  }
  function notify() { safeCall(onStatus, getSnapshot()); }
  function emit(sample) { reason = sample.reason; safeCall(onSample, sample); notify(); return sample; }
  function bounded(promise, timeoutMs, signal, message) {
    let timer, listener;
    const interrupted = new Promise((_, reject) => {
      listener = () => reject(new Error('operation-cancelled'));
      if (signal?.aborted) { listener(); return; }
      signal?.addEventListener('abort', listener, { once: true });
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([promise, interrupted]).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', listener); });
  }
  async function enable() {
    if (destroyed) return false;
    if (detector && enabled) return true;
    if (enablePromise) return enablePromise;
    enabled = true; state = 'loading'; reason = 'loading-local-face-model';
    const token = ++lifecycle; loadController = new AbortController(); const signal = loadController.signal;
    notify(); const deadline = now() + Math.max(1, Math.min(60_000, loadTimeoutMs));
    enablePromise = (async () => {
      for (const candidateDelegate of ['GPU', 'CPU']) {
        let candidatePromise, accepted = false, abandoned = false;
        try {
          const remaining = deadline - now(); if (remaining <= 0) throw new Error('model-load-timeout');
          candidatePromise = landmarkerFactory({ delegate: candidateDelegate, assets, signal, options: EYE_TRACKER_MODEL_OPTIONS });
          Promise.resolve(candidatePromise).then(candidate => { if (abandoned || token !== lifecycle || destroyed) close(candidate); }).catch(() => {});
          const candidate = await bounded(Promise.resolve(candidatePromise), remaining, signal, 'model-load-timeout');
          if (!enabled || destroyed || token !== lifecycle) { close(candidate); return false; }
          if (typeof candidate?.detectForVideo !== 'function') { close(candidate); throw new Error('invalid-local-face-detector'); }
          accepted = true; detector = candidate; cold = true; delegate = candidateDelegate; state = 'ready'; reason = 'camera-frames-needed';
          watchdog = setInterval(checkStale, 100); watchdog?.unref?.(); notify(); return true;
        } catch (error) {
          abandoned = true;
          if (!accepted) close(candidatePromise);
          if (!enabled || destroyed || token !== lifecycle || signal.aborted) return false;
          if (candidateDelegate === 'CPU' || error.message === 'model-load-timeout') { state = 'error'; reason = error.message === 'model-load-timeout' ? 'model-load-timeout' : 'local-face-model-unavailable'; emit(estimator.invalidate(reason)); return false; }
        }
      }
      return false;
    })();
    try { return await enablePromise; } finally { if (token === lifecycle) { enablePromise = null; loadController = null; } }
  }
  function disable() {
    enabled = false; lifecycle++; sourceGeneration++; loadController?.abort(); loadController = null; enablePromise = null;
    clearInterval(watchdog); watchdog = null; close(detector); detector = null; delegate = null; busy = false;
    lastFrameAt = null; lastTimestamp = -Infinity; lastDetectedAt = -Infinity; contextKey = null; context = null; source = null;
    estimator.clearCalibration('eyes-disabled'); state = destroyed ? 'destroyed' : 'disabled'; emit(estimator.invalidate('eyes-disabled'));
  }
  async function processFrame(payload) {
    if (!enabled || destroyed || !detector) return null;
    const video = payload?.video, timestamp = payload?.timestamp, view = viewport();
    if (!video || !finite(timestamp) || !finite(video.videoWidth) || !finite(video.videoHeight) || video.videoWidth <= 0 || video.videoHeight <= 0 || (video.readyState ?? 2) < 2
      || !finite(view?.width) || !finite(view?.height) || view.width <= 0 || view.height <= 0) return emit(estimator.invalidate('video-frame-unavailable'));
    if (!videoIds.has(video)) videoIds.set(video, ++nextVideoId);
    const nextSource = { kind: String(payload.source?.kind ?? 'camera').slice(0, 32), mirrored: payload.source?.mirrored === true };
    const nextContext = { ...nextSource, sourceId: String(payload.source?.id ?? ''), sourceGeneration: String(payload.source?.generation ?? ''),
      videoId: videoIds.get(video), videoWidth: video.videoWidth, videoHeight: video.videoHeight, viewportWidth: view.width, viewportHeight: view.height };
    const key = JSON.stringify(nextContext);
    if (key !== contextKey) { sourceGeneration++; estimator.setContext(nextContext); contextKey = key; lastTimestamp = -Infinity; lastDetectedAt = -Infinity; emit(estimator.invalidate('source-or-viewport-updated')); }
    context = nextContext;
    source = nextSource; lastFrameAt = now();
    if (timestamp <= lastTimestamp) return emit(estimator.invalidate('non-monotonic-frame'));
    lastTimestamp = timestamp;
    if (busy || timestamp - lastDetectedAt < Math.max(40, sampleIntervalMs)) return null;
    const token = lifecycle, generation = sourceGeneration, currentDetector = detector;
    busy = true; lastDetectedAt = timestamp;
    try {
      // Face/iris subgraphs may compile shaders only once a face is present.
      // Until that first detection, permit bounded cold startup; stale results
      // still cannot produce a pointer or enter a calibration capture.
      const timeoutMs = cold ? coldFrameTimeoutMs : detectionTimeoutMs;
      const result = await bounded(Promise.resolve().then(() => currentDetector.detectForVideo(video, timestamp)), Math.max(10, Math.min(15_000, timeoutMs)), null, 'detector-timeout');
      if (destroyed || !enabled || token !== lifecycle || generation !== sourceGeneration) return null;
      if (result?.faceLandmarks?.length) cold = false;
      return emit(estimator.update(result, timestamp, nextContext));
    } catch (error) {
      if (destroyed || !enabled || token !== lifecycle || generation !== sourceGeneration) return null;
      if (error.message === 'detector-timeout') { close(detector); detector = null; state = 'error'; }
      return emit(estimator.invalidate(error.message === 'detector-timeout' ? 'detector-timeout' : 'face-detection-failed'));
    } finally { if (token === lifecycle) busy = false; }
  }
  function calibrationAction(action, argument) {
    if (!enabled || !detector || destroyed) return { accepted: false, reason: 'eye-detector-not-ready' };
    const result = estimator[action](argument);
    if (action !== 'calibrationSample') emit(estimator.getSnapshot().sample); else notify();
    return result;
  }
  return Object.freeze({ enable, disable, processFrame,
    getSnapshot() { checkStale(); return getSnapshot(); },
    startCalibration: () => calibrationAction('startCalibration'),
    calibrationSample: target => calibrationAction('calibrationSample', target),
    finishCalibration: () => calibrationAction('finishCalibration'),
    clearCalibration: () => { const result = estimator.clearCalibration(); emit(estimator.invalidate('calibration-cleared')); return result; },
    destroy() { if (!destroyed) { destroyed = true; disable(); } } });
}
