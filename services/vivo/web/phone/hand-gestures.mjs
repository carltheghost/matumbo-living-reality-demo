const xy = p => [Number(p?.x), Number(p?.y)];
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const palmCenter = hand => {
  const indexes = [0, 5, 9, 13, 17];
  return indexes.reduce((out, i) => [out[0] + (Number(hand[i]?.x) || 0) / indexes.length, out[1] + (Number(hand[i]?.y) || 0) / indexes.length], [0, 0]);
};

/** Re-identify two detections between frames without depending on model order. */
export function matchHands(detections, previous = []) {
  const hands = (detections || []).filter(hand => Array.isArray(hand) && hand.length === 21);
  if (hands.length > 2) hands.length = 2;
  if (!previous.some(Boolean)) return hands.map((landmarks, detectionIndex) => ({ id: `hand-${detectionIndex + 1}`, slot: detectionIndex, landmarks, detectionIndex })).sort((a, b) => palmCenter(a.landmarks)[0] - palmCenter(b.landmarks)[0]).map((hand, slot) => ({ ...hand, id: `hand-${slot + 1}`, slot }));
  if (hands.length === 1) {
    const center = palmCenter(hands[0]);
    let best = 0, score = Infinity;
    previous.forEach((prior, slot) => { if (!prior) return; const next = d2(center, prior.center); if (next < score) { score = next; best = slot; } });
    if (score > 0.28) best = previous[0] ? 1 : 0;
    return [{ id: `hand-${best + 1}`, slot: best, landmarks: hands[0], detectionIndex: 0 }];
  }
  if (hands.length === 2) {
    const centers = hands.map(palmCenter), candidates = [];
    for (const permutation of [[0, 1], [1, 0]]) {
      let score = 0;
      for (let slot = 0; slot < 2; slot++) if (previous[slot]) score += d2(centers[permutation[slot]], previous[slot].center); else score += 0.15;
      candidates.push({ permutation, score });
    }
    const best = candidates.sort((a, b) => a.score - b.score)[0].permutation;
    return best.map((handIndex, slot) => ({ id: `hand-${slot + 1}`, slot, landmarks: hands[handIndex], detectionIndex: handIndex }));
  }
  return [];
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
