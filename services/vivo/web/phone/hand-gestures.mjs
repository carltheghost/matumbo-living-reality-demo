export const MAX_HANDS = 2;
export const MAX_HAND_MISSING_FRAMES = 3;
export const MAX_RESULT_AGE_MS = 300;
const MATCH_DISTANCE = 0.65;
const AMBIGUITY_MARGIN = 0.12;
const LABEL_PENALTY = 4;
const LABEL_BONUS = 0.12;
const xy = p => [Number(p?.x), Number(p?.y)];
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const palmCenter = hand => {
  const indexes = [0, 5, 9, 13, 17];
  return indexes.reduce((out, i) => [out[0] + (Number(hand[i]?.x) || 0) / indexes.length, out[1] + (Number(hand[i]?.y) || 0) / indexes.length], [0, 0]);
};

export function normalizeHandedness(value) {
  const raw = typeof value === 'string' ? value : value?.categoryName || value?.displayName || value?.label;
  if (typeof raw !== 'string') return null;
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'left' || normalized === 'right') return normalized;
  return null;
}

function normalizeDetection(value, detectionIndex, handednesses = []) {
  const object = Array.isArray(value) ? { landmarks: value, handedness: handednesses[detectionIndex] } : (value || {});
  const landmarks = object.landmarks || object.points;
  if (!Array.isArray(landmarks) || landmarks.length !== 21) return null;
  const confidence = Number(object.confidence ?? object.score ?? handednesses[detectionIndex]?.score);
  return {
    landmarks, detectionIndex, handedness: normalizeHandedness(object.handedness || object.handednesses || handednesses[detectionIndex]),
    confidence: Number.isFinite(confidence) ? confidence : null,
  };
}

function predictedCenter(track) {
  const center = Array.isArray(track?.center) ? track.center : [0, 0];
  const velocity = Array.isArray(track?.velocity) ? track.velocity : [0, 0];
  const frames = Math.min(MAX_HAND_MISSING_FRAMES, Math.max(1, Number(track?.missing || 0) + 1));
  return [center[0] + (Number(velocity[0]) || 0) * frames, center[1] + (Number(velocity[1]) || 0) * frames];
}

function trackScore(track, detection) {
  const center = palmCenter(detection.landmarks), distance = d2(center, predictedCenter(track));
  const sameLabel = track?.handedness && detection.handedness && track.handedness === detection.handedness;
  const conflictingLabel = track?.handedness && detection.handedness && track.handedness !== detection.handedness;
  return {
    center, distance, sameLabel, conflictingLabel,
    score: distance + (conflictingLabel ? LABEL_PENALTY : sameLabel ? -LABEL_BONUS : 0),
  };
}

function makeTrack(track, detection, slot) {
  const center = palmCenter(detection.landmarks);
  const prior = Array.isArray(track?.center) ? track.center : null;
  const velocity = prior ? [center[0] - prior[0], center[1] - prior[1]] : [0, 0];
  return {
    id: track?.id || `hand-${slot + 1}`, slot, landmarks: detection.landmarks,
    detectionIndex: detection.detectionIndex, handedness: detection.handedness,
    confidence: detection.confidence, center, velocity, age: Number(track?.age || 0) + 1, missing: 0,
  };
}

function withMatchMeta(matches, { ambiguous = false, ambiguousIds = [], missingIds = [], conflictingIds = [] } = {}) {
  matches.ambiguous = ambiguous;
  matches.ambiguousIds = [...new Set(ambiguousIds.filter(Boolean))];
  matches.missingIds = [...new Set(missingIds.filter(Boolean))];
  matches.conflictingIds = [...new Set(conflictingIds.filter(Boolean))];
  return matches;
}

function initialTracks(detections) {
  const rank = value => value.handedness === 'left' ? 0 : value.handedness === 'right' ? 1 : 2;
  const ordered = detections.slice().sort((a, b) => rank(a) - rank(b) || palmCenter(a.landmarks)[0] - palmCenter(b.landmarks)[0]);
  return withMatchMeta(ordered.slice(0, MAX_HANDS).map((detection, slot) => makeTrack(null, detection, slot)));
}

/**
 * Re-identify two detections between frames. Detector handedness is the first
 * signal; predicted motion and track age keep a short occlusion stable. A
 * near-tie while hands cross is deliberately ambiguous so callers can release
 * ownership instead of transferring a held gesture to the other hand.
 */
export function matchHands(detections, previous = [], { handednesses = [] } = {}) {
  const hands = (detections || []).map((value, index) => normalizeDetection(value, index, handednesses)).filter(Boolean).slice(0, MAX_HANDS);
  const prior = Array.from({ length: MAX_HANDS }, (_, slot) => previous[slot] || null);
  const priorIds = prior.map(track => track?.id).filter(Boolean);
  if (!hands.length) return withMatchMeta([], { missingIds: priorIds });
  if (!prior.some(Boolean)) return initialTracks(hands);

  if (hands.length === 2 && prior.every(Boolean)) {
    const candidates = [[0, 1], [1, 0]].map(permutation => {
      const scored = permutation.map((detectionIndex, slot) => trackScore(prior[slot], hands[detectionIndex]));
      return { permutation, scored, score: scored.reduce((sum, item) => sum + item.score, 0) };
    }).sort((a, b) => a.score - b.score);
    const best = candidates[0], alternate = candidates[1];
    const distinctLabels = hands.every(hand => hand.handedness) && hands[0].handedness !== hands[1].handedness;
    const closeTracks = d2(prior[0].center || [0, 0], prior[1].center || [0, 0]) < 0.42;
    const closeDetections = d2(palmCenter(hands[0].landmarks), palmCenter(hands[1].landmarks)) < 0.2;
    if (!distinctLabels && closeTracks && closeDetections && alternate.score - best.score < AMBIGUITY_MARGIN) {
      return withMatchMeta([], { ambiguous: true, ambiguousIds: priorIds });
    }
    return withMatchMeta(best.permutation.map((detectionIndex, slot) => makeTrack(prior[slot], hands[detectionIndex], slot)));
  }

  if (hands.length === 1) {
    const scored = prior.map((track, slot) => track ? { slot, ...trackScore(track, hands[0]) } : null).filter(Boolean).sort((a, b) => a.score - b.score);
    if (!scored.length) return initialTracks(hands);
    const best = scored[0], alternate = scored[1];
    if (best.conflictingLabel) {
      const exact = scored.find(item => item.sameLabel);
      const conflictingIds = [prior[best.slot]?.id];
      if (exact && exact.slot !== best.slot) {
        return withMatchMeta([makeTrack(prior[exact.slot], hands[0], exact.slot)], {
          missingIds: conflictingIds, conflictingIds,
        });
      }
      const freeSlot = prior.findIndex((track, slot) => !track || slot !== best.slot && (track.missing || 0) > 0);
      if (freeSlot >= 0) {
        return withMatchMeta([makeTrack(null, hands[0], freeSlot)], {
          missingIds: conflictingIds, conflictingIds,
        });
      }
      return withMatchMeta([], { missingIds: conflictingIds, conflictingIds });
    }
    const exactLabel = best.sameLabel && !best.conflictingLabel;
    const closeTracks = alternate && d2(prior[best.slot].center || [0, 0], prior[alternate.slot].center || [0, 0]) < 0.42;
    if (!exactLabel && alternate && closeTracks && alternate.score - best.score < AMBIGUITY_MARGIN) {
      return withMatchMeta([], { ambiguous: true, ambiguousIds: priorIds });
    }
    if (!exactLabel && best.distance > MATCH_DISTANCE) {
      const freeSlot = prior.findIndex((track, slot) => !track || slot !== best.slot && (track.missing || 0) > 0);
      if (freeSlot >= 0) return withMatchMeta([makeTrack(null, hands[0], freeSlot)]);
    }
    return withMatchMeta([makeTrack(prior[best.slot], hands[0], best.slot)], { missingIds: prior.filter((_, slot) => slot !== best.slot).map(track => track?.id) });
  }

  // One tracked hand plus two detections: attach the closest/highest-confidence
  // detection to that track, then give the remaining detection a free slot.
  const trackedSlot = prior.findIndex(Boolean);
  if (trackedSlot < 0) return initialTracks(hands);
  const candidates = hands.map((hand, detectionIndex) => ({ detectionIndex, ...trackScore(prior[trackedSlot], hand) })).sort((a, b) => a.score - b.score);
  const best = candidates[0], alternate = candidates[1];
  if (!best.sameLabel && alternate && !alternate.sameLabel && alternate.score - best.score < AMBIGUITY_MARGIN) {
    return withMatchMeta([], { ambiguous: true, ambiguousIds: priorIds });
  }
  const freeSlot = trackedSlot === 0 ? 1 : 0;
  const result = [makeTrack(prior[trackedSlot], hands[best.detectionIndex], trackedSlot), makeTrack(null, hands[alternate.detectionIndex], freeSlot)];
  return withMatchMeta(result.sort((a, b) => a.slot - b.slot));
}

/** Use all 21 points: five articulated fingers, pinch ratio and useful poses. */
export function describeHand(landmarks) {
  if (!Array.isArray(landmarks) || landmarks.length !== 21) throw new TypeError('A hand frame must contain all 21 landmarks');
  const wrist = xy(landmarks[0]), palm = Math.max(0.001, d2(xy(landmarks[5]), xy(landmarks[17])));
  const extended = (tip, joint) => d2(xy(landmarks[tip]), wrist) > d2(xy(landmarks[joint]), wrist) + palm * 0.05;
  const fingers = {
    thumb: d2(xy(landmarks[4]), xy(landmarks[5])) > d2(xy(landmarks[3]), xy(landmarks[5])) + palm * 0.12,
    index: extended(8, 6), middle: extended(12, 10), ring: extended(16, 14), pinky: extended(20, 18),
  };
  const pinchRatio = d2(xy(landmarks[4]), xy(landmarks[8])) / palm;
  const open = Object.values(fingers).every(Boolean);
  let pose = 'relaxed';
  if (pinchRatio < 0.34) pose = 'pinch';
  else if (open) pose = 'open';
  else if (fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky) pose = 'point';
  else if (fingers.index && fingers.middle && !fingers.ring && !fingers.pinky) pose = 'peace';
  else if (!Object.values(fingers).some(Boolean)) pose = 'fist';
  else if (fingers.thumb && !fingers.index && !fingers.middle && !fingers.ring && !fingers.pinky) pose = 'thumbs-up';
  return { fingers, pinchRatio, palmSize: palm, pose, point: xy(landmarks[8]) };
}

/** Two pinched hands produce stable zoom and roll deltas for the World Eye. */
export function twoHandTransform(a, b, previous = null) {
  if (!a || !b) return null;
  const dx = b[0] - a[0], dy = b[1] - a[1], span = Math.max(1, Math.hypot(dx, dy)), angle = Math.atan2(dy, dx);
  if (!previous) return { midpoint: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], span, angle, scale: 1, rotation: 0 };
  let rotation = angle - previous.angle;
  if (rotation > Math.PI) rotation -= 2 * Math.PI;
  if (rotation < -Math.PI) rotation += 2 * Math.PI;
  return { midpoint: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], span, angle, scale: span / Math.max(1, previous.span), rotation };
}
