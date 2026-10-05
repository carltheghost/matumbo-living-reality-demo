/** Empirical RGB gaze calibration. No identity, metric eye pose or stored sensor data.
 * Google explicitly distinguishes iris localization from gaze direction:
 * https://research.google/blog/mediapipe-iris-real-time-iris-tracking-depth-estimation/
 * This adapter learns a screen mapping from explicit targets and separate holdouts.
 */
export const EYE_GAZE_LIMITS = Object.freeze({ staleMs: 350, stableWindowMs: 600, minStableFrames: 6,
  minStableSpanMs: 200, minQuality: .65, minTrainTargets: 9, minValidationTargets: 5,
  maxCaptures: 32, maxHoldoutRmse: .10, maxHoldoutError: .18 });
const clamp = (n, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const finite = n => typeof n === 'number' && Number.isFinite(n);
const mean = values => values.reduce((sum, n) => sum + n, 0) / values.length;
const invalid = reason => ({ valid: false, reason, quality: 0, point: null, normalized: null });
const freeze = value => Object.freeze(value);
const std = values => { const m = mean(values); return Math.sqrt(mean(values.map(n => (n - m) ** 2))); };

/** Official eye/iris topology: google-ai-edge/mediapipe face_landmarks_connections.ts. */
export function extractEyeFeatures(result, { videoWidth = 640, videoHeight = 480 } = {}) {
  if (!Array.isArray(result?.faceLandmarks) || result.faceLandmarks.length !== 1) return invalid(result?.faceLandmarks?.length ? 'multiple-faces' : 'no-face');
  const landmarks = result.faceLandmarks[0];
  if (!Array.isArray(landmarks) || landmarks.length < 478) return invalid('iris-landmarks-missing');
  // Tasks applies confidence thresholds internally; scores are checked only when
  // actually supplied. Geometry quality below is a heuristic, not a probability.
  for (const score of [result.faceDetectionConfidence, result.facePresenceConfidence]) {
    if (score !== undefined && (!finite(score) || score < .7 || score > 1)) return invalid('low-confidence');
  }
  const aspect = videoWidth / videoHeight;
  if (!finite(aspect) || aspect < .25 || aspect > 4) return invalid('invalid-video-geometry');
  const point = index => {
    const p = landmarks[index];
    if (!p || !finite(p.x) || !finite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return null;
    return { x: p.x * aspect, y: p.y };
  };
  const eyes = [];
  for (const [first, second, top, bottom, iris, ring] of [[33, 133, 159, 145, 468, [469, 470, 471, 472]], [362, 263, 386, 374, 473, [474, 475, 476, 477]]]) {
    const a = point(first), b = point(second), upper = point(top), lower = point(bottom), center = point(iris), rim = ring.map(point);
    if ([a, b, upper, lower, center, ...rim].some(p => !p)) return invalid('invalid-eye-geometry');
    const dx = b.x - a.x, dy = b.y - a.y, width = Math.hypot(dx, dy);
    if (width < .018 || width > aspect * .4 || dx <= 0) return invalid('invalid-eye-geometry');
    const horizontal = ((center.x - a.x) * dx + (center.y - a.y) * dy) / width ** 2;
    const mid = { x: (upper.x + lower.x) / 2, y: (upper.y + lower.y) / 2 };
    const vertical = (-(center.x - mid.x) * dy + (center.y - mid.y) * dx) / width ** 2;
    const openness = Math.abs(-(lower.x - upper.x) * dy + (lower.y - upper.y) * dx) / width ** 2;
    const radius = mean(rim.map(p => Math.hypot(p.x - center.x, p.y - center.y))) / width;
    if (openness < .10) return invalid('eyes-closed');
    if (horizontal < .05 || horizontal > .95 || Math.abs(vertical) > .30 || radius < .04 || radius > .28 || openness > .65) return invalid('invalid-iris-geometry');
    eyes.push({ horizontal, vertical, openness, radius, center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } });
  }
  const blink = result.faceBlendshapes?.[0]?.categories?.filter(c => ['eyeBlinkLeft', 'eyeBlinkRight'].includes(c.categoryName)) ?? [];
  if (blink.some(c => !finite(c.score) || c.score < 0 || c.score > 1 || c.score >= .5)) return invalid('eyes-closed');
  if (Math.abs(eyes[0].horizontal - eyes[1].horizontal) > .22 || Math.abs(eyes[0].vertical - eyes[1].vertical) > .15) return invalid('inconsistent-eyes');
  const eyeDistance = Math.hypot(eyes[1].center.x - eyes[0].center.x, eyes[1].center.y - eyes[0].center.y);
  const nose = point(1);
  if (!nose || eyeDistance < .06 || eyeDistance > aspect * .8) return invalid('invalid-face-geometry');
  const center = { x: mean(eyes.map(e => e.center.x)), y: mean(eyes.map(e => e.center.y)) };
  let yaw = (nose.x - center.x) / eyeDistance, pitch = (nose.y - center.y) / eyeDistance;
  const matrix = result.facialTransformationMatrixes?.[0]?.data;
  if (matrix !== undefined) {
    if (matrix.length !== 16 || !Array.from(matrix).every(finite)) return invalid('invalid-head-pose');
    const length = Math.hypot(matrix[8], matrix[9], matrix[10]);
    if (length < .001) return invalid('invalid-head-pose');
    yaw = matrix[8] / length; pitch = matrix[9] / length;
    if (Math.abs(yaw) > .65 || Math.abs(pitch) > .65) return invalid('head-pose-out-of-range');
  }
  const quality = clamp(Math.min(...eyes.map(e => (e.openness - .08) / .12)) * (blink.length === 2 ? 1 : .85));
  return { valid: quality >= EYE_GAZE_LIMITS.minQuality, reason: quality >= EYE_GAZE_LIMITS.minQuality ? 'eye-features-ready' : 'low-eye-quality', quality,
    features: [mean(eyes.map(e => e.horizontal)), mean(eyes.map(e => e.vertical)), yaw, pitch],
    geometry: { centerX: center.x / aspect, centerY: center.y, scale: eyeDistance / aspect }, confidenceSource: 'task-thresholds-and-eye-geometry' };
}

function solve(matrix, values) {
  const rows = matrix.map((row, i) => [...row, values[i]]), n = rows.length;
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let i = column + 1; i < n; i++) if (Math.abs(rows[i][column]) > Math.abs(rows[pivot][column])) pivot = i;
    if (Math.abs(rows[pivot][column]) < 1e-9) throw new Error('degenerate-calibration');
    [rows[pivot], rows[column]] = [rows[column], rows[pivot]];
    const divisor = rows[column][column]; for (let j = column; j <= n; j++) rows[column][j] /= divisor;
    for (let i = 0; i < n; i++) if (i !== column) { const factor = rows[i][column]; for (let j = column; j <= n; j++) rows[i][j] -= factor * rows[column][j]; }
  }
  return rows.map(row => row[n]);
}
const rowFor = (features, fit) => [1, ...fit.active.map(i => (features[i] - fit.means[i]) / fit.scales[i])];
const predict = (features, fit) => { const row = rowFor(features, fit); return { x: row.reduce((v, n, i) => v + n * fit.x[i], 0), y: row.reduce((v, n, i) => v + n * fit.y[i], 0) }; };
function fitMapping(train) {
  const means = [0, 1, 2, 3].map(i => mean(train.map(s => s.features[i]))), scales = [0, 1, 2, 3].map(i => std(train.map(s => s.features[i])));
  if (scales[0] < .015 || scales[1] < .008) throw new Error('insufficient-eye-variation');
  const covariance = mean(train.map(s => (s.features[0] - means[0]) * (s.features[1] - means[1])));
  if (Math.abs(covariance / (scales[0] * scales[1])) > .97) throw new Error('degenerate-calibration');
  const fit = { means, scales, active: [0, 1, 2, 3].filter(i => scales[i] > .001) };
  const rows = train.map(s => rowFor(s.features, fit)), n = rows[0].length;
  const matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => rows.reduce((v, row) => v + row[i] * row[j], 0) + (i === j && i > 0 ? .002 : 0)));
  fit.x = solve(matrix, Array.from({ length: n }, (_, i) => rows.reduce((v, row, k) => v + row[i] * train[k].target.x, 0)));
  fit.y = solve(matrix, Array.from({ length: n }, (_, i) => rows.reduce((v, row, k) => v + row[i] * train[k].target.y, 0)));
  fit.ranges = [0, 1, 2, 3].map(i => ({ min: Math.min(...train.map(s => s.features[i])), max: Math.max(...train.map(s => s.features[i])) }));
  fit.geometry = { centerX: mean(train.map(s => s.geometry.centerX)), centerY: mean(train.map(s => s.geometry.centerY)), scale: mean(train.map(s => s.geometry.scale)) };
  return fit;
}
function covered(samples, grid = false) {
  if (!samples.length) return false;
  const x = samples.map(s => s.target.x), y = samples.map(s => s.target.y);
  if (Math.max(...x) - Math.min(...x) < (grid ? .65 : .3) || Math.max(...y) - Math.min(...y) < (grid ? .65 : .3)) return false;
  return !grid || new Set(samples.map(s => `${Math.min(2, Math.floor(s.target.x * 3))}:${Math.min(2, Math.floor(s.target.y * 3))}`)).size === 9;
}

/** Small in-memory estimator; sample history and coefficients never leave this owner. */
export function createEyeGazeEstimator({ now = () => performance.now() } = {}) {
  let context = null, contextKey = null, recent = [], latest = null, fitted = null, smoothed = null;
  let captures = [], calibration = { status: 'uncalibrated', reason: 'calibration-needed', metrics: null };
  let sample = { ...invalid('calibration-needed'), timestamp: null };
  const calibrationSnapshot = () => freeze({ ...calibration, trainTargets: captures.filter(s => s.phase === 'train').length,
    validationTargets: captures.filter(s => s.phase === 'validate').length, calibrated: Boolean(fitted) });
  function clearCalibration(reason = 'calibration-cleared') {
    captures = []; fitted = null; recent = []; smoothed = null; latest = null;
    calibration = { status: 'uncalibrated', reason, metrics: null }; sample = { ...invalid(reason), timestamp: now() };
    return calibrationSnapshot();
  }
  function setContext(next) {
    const key = JSON.stringify(next);
    if (contextKey !== null && contextKey !== key) clearCalibration(context?.viewportWidth !== next.viewportWidth || context?.viewportHeight !== next.viewportHeight ? 'viewport-changed' : 'source-changed');
    context = { ...next }; contextKey = key;
  }
  function invalidate(reason = 'tracking-lost', timestamp = now()) {
    latest = null; recent = []; smoothed = null; sample = { ...invalid(reason), timestamp }; return freeze({ ...sample });
  }
  function update(result, timestamp, nextContext) {
    setContext(nextContext);
    if (!finite(timestamp) || now() - timestamp > EYE_GAZE_LIMITS.staleMs || timestamp > now()) return invalidate('stale-frame', now());
    const observation = extractEyeFeatures(result, nextContext);
    if (!observation.valid) return invalidate(observation.reason, timestamp);
    latest = { ...observation, timestamp }; recent.push(latest); recent = recent.filter(s => timestamp - s.timestamp <= EYE_GAZE_LIMITS.stableWindowMs).slice(-24);
    if (!fitted) { sample = { ...invalid(calibration.status === 'collecting' ? 'calibrating' : calibration.reason), quality: observation.quality, timestamp }; return freeze({ ...sample }); }
    const g = fitted.geometry, current = observation.geometry;
    if (Math.hypot(current.centerX - g.centerX, current.centerY - g.centerY) > .10 || current.scale / g.scale < .75 || current.scale / g.scale > 1.33) return invalidate('head-moved-recalibrate', timestamp);
    if (observation.features.some((n, i) => { const range = fitted.ranges[i], margin = i < 2 ? Math.max(.02, (range.max - range.min) * .25) : .10; return n < range.min - margin || n > range.max + margin; })) return invalidate('outside-calibrated-pose', timestamp);
    const point = predict(observation.features, fitted);
    if (!finite(point.x) || !finite(point.y) || point.x < -.1 || point.x > 1.1 || point.y < -.1 || point.y > 1.1) return invalidate('outside-screen', timestamp);
    const alpha = smoothed ? 1 - Math.exp(-Math.max(0, timestamp - smoothed.timestamp) / 100) : 1;
    smoothed = { x: clamp(smoothed ? smoothed.x + alpha * (point.x - smoothed.x) : point.x), y: clamp(smoothed ? smoothed.y + alpha * (point.y - smoothed.y) : point.y), timestamp };
    const quality = clamp(observation.quality * (1 - calibration.metrics.holdoutRmse * 3));
    sample = { valid: true, reason: 'calibrated-estimate', quality, timestamp, point: freeze({ x: smoothed.x, y: smoothed.y }),
      normalized: freeze({ x: 2 * smoothed.x - 1, y: 1 - 2 * smoothed.y }), confidenceSource: observation.confidenceSource };
    return freeze({ ...sample });
  }
  function calibrationSample(target) {
    const phase = target?.phase ?? 'train';
    const reject = reason => freeze({ ...calibrationSnapshot(), accepted: false, reason, phase });
    if (calibration.status !== 'collecting') return reject('calibration-not-started');
    if (!['train', 'validate'].includes(phase) || !finite(target?.x) || !finite(target?.y) || target.x < 0 || target.x > 1 || target.y < 0 || target.y > 1) return reject('invalid-target');
    if (!latest || now() - latest.timestamp > EYE_GAZE_LIMITS.staleMs || now() < latest.timestamp) return reject('fresh-eyes-needed');
    if (captures.length >= EYE_GAZE_LIMITS.maxCaptures) return reject('calibration-limit');
    if (captures.some(s => s.phase === phase && Math.hypot(s.target.x - target.x, s.target.y - target.y) < .02)) return reject('target-already-captured');
    if (recent.length < EYE_GAZE_LIMITS.minStableFrames || latest.timestamp - recent[0].timestamp < EYE_GAZE_LIMITS.minStableSpanMs) return reject('hold-still');
    const jitter = [0, 1, 2, 3].map(i => std(recent.map(s => s.features[i])));
    if (jitter.some((n, i) => n > (i < 2 ? .025 : .018))) return reject('eyes-not-stable');
    if (['centerX', 'centerY', 'scale'].some(key => std(recent.map(s => s.geometry[key])) > .008)) return reject('head-not-stable');
    const features = [0, 1, 2, 3].map(i => mean(recent.map(s => s.features[i])));
    captures.push({ phase, target: { x: target.x, y: target.y }, features, geometry: { ...latest.geometry } }); recent = [];
    return freeze({ ...calibrationSnapshot(), accepted: true, reason: 'target-captured', phase, target: freeze({ x: target.x, y: target.y }) });
  }
  function finishCalibration() {
    const train = captures.filter(s => s.phase === 'train'), validation = captures.filter(s => s.phase === 'validate');
    const reject = reason => { fitted = null; invalidate(reason); calibration = { status: 'rejected', reason, metrics: null }; return freeze({ accepted: false, ...calibrationSnapshot() }); };
    if (calibration.status !== 'collecting') return reject('calibration-not-started');
    if (train.length < EYE_GAZE_LIMITS.minTrainTargets || validation.length < EYE_GAZE_LIMITS.minValidationTargets) return reject('more-targets-needed');
    if (!covered(train, true) || !covered(validation)) return reject('insufficient-target-coverage');
    let candidate;
    try { candidate = fitMapping(train); } catch (error) { return reject(error.message); }
    const errors = validation.map(s => { const p = predict(s.features, candidate); return Math.hypot(p.x - s.target.x, p.y - s.target.y); });
    const holdoutRmse = Math.sqrt(mean(errors.map(e => e * e))), maxHoldoutError = Math.max(...errors);
    const metrics = freeze({ holdoutRmse, maxHoldoutError, validationTargets: validation.length, trainTargets: train.length, units: 'normalized-screen-distance', measuredAccuracy: false });
    if (holdoutRmse > EYE_GAZE_LIMITS.maxHoldoutRmse || maxHoldoutError > EYE_GAZE_LIMITS.maxHoldoutError) { fitted = null; invalidate('holdout-error-too-high'); calibration = { status: 'rejected', reason: 'holdout-error-too-high', metrics }; return freeze({ accepted: false, ...calibrationSnapshot() }); }
    fitted = candidate; smoothed = null; recent = []; calibration = { status: 'calibrated', reason: 'holdout-validated', metrics };
    sample = { ...invalid('fresh-calibrated-frame-needed'), timestamp: now() };
    return freeze({ accepted: true, ...calibrationSnapshot() });
  }
  return freeze({ update, invalidate, setContext, clearCalibration, calibrationSample, finishCalibration,
    startCalibration() { clearCalibration('calibration-started'); calibration.status = 'collecting'; return freeze({ accepted: true, ...calibrationSnapshot() }); },
    getSnapshot() { if (sample.valid && now() - sample.timestamp > EYE_GAZE_LIMITS.staleMs) invalidate('stale-frame'); return freeze({ sample: freeze({ ...sample }), calibration: calibrationSnapshot() }); } });
}
