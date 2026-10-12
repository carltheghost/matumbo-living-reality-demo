/**
 * Phone-owned adapter from the existing 21-landmark output to independent
 * material contacts. It is pure data mapping: it does not start a camera,
 * infer a hand, or make a real-device accuracy claim.
 */

export const PHONE_FINGER_IDS = Object.freeze(['thumb', 'index', 'middle', 'ring', 'pinky']);
export const PHONE_FINGERTIP_LANDMARKS = Object.freeze({ thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 });

function pointOf(value, label) {
  const point = Array.isArray(value) ? value : [value?.x, value?.y];
  if (!Array.isArray(point) || point.length < 2 || !Number.isFinite(Number(point[0])) || !Number.isFinite(Number(point[1]))) {
    throw new TypeError(`${label} must contain a finite screen point.`);
  }
  return [Number(point[0]), Number(point[1])];
}

function identity(value, fallback, label) {
  const raw = value ?? fallback;
  if (raw === null || raw === undefined) throw new TypeError(`${label} is required.`);
  const result = String(raw);
  if (!result || result.length > 160 || /[\u0000-\u001f\u007f]/.test(result)) throw new TypeError(`${label} must be a bounded identity.`);
  return result;
}

export function mapFingertipLandmarks({ handId, landmarks, sessionId = 'synthetic-hand-session', generation = 1 } = {}) {
  const resolvedHandId = identity(handId, null, 'handId');
  if (!Array.isArray(landmarks) || landmarks.length !== 21) throw new TypeError('A hand must provide exactly 21 landmarks.');
  const resolvedSessionId = identity(sessionId, 'synthetic-hand-session', 'sessionId');
  const resolvedGeneration = Number(generation);
  if (!Number.isSafeInteger(resolvedGeneration) || resolvedGeneration < 1) throw new TypeError('Hand generation must be a positive integer.');
  return PHONE_FINGER_IDS.map(fingerId => {
    const landmarkIndex = PHONE_FINGERTIP_LANDMARKS[fingerId];
    const point = pointOf(landmarks[landmarkIndex], `landmarks[${landmarkIndex}]`);
    const sourceId = `${resolvedHandId}:${fingerId}`;
    return {
      contactId: `finger:${sourceId}`,
      handId: resolvedHandId,
      fingerId,
      landmarkIndex,
      point,
      source: {
        kind: 'finger', sourceId, parentSourceId: resolvedHandId,
        fingerId, sessionId: resolvedSessionId, generation: resolvedGeneration,
      },
    };
  });
}

export function mapHandsToFingertips(hands, options = {}) {
  if (!Array.isArray(hands)) throw new TypeError('Hands must be an array.');
  return hands.flatMap((hand, slot) => mapFingertipLandmarks({
    handId: hand?.id ?? `hand-${slot + 1}`,
    landmarks: hand?.screenLandmarks || hand?.landmarks || hand,
    sessionId: options.sessionId ?? hand?.sessionId,
    generation: options.generation ?? hand?.generation ?? 1,
  }));
}
