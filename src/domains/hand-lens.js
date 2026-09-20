/**
 * Hand Lens domain logic.
 *
 * Pure, dependency-free ES module.
 *
 * Input:
 *   hands = [
 *     {
 *       landmarks: [{ x, y, z }, ... 21],
 *       handedness: "Left" | "Right"
 *     }
 *   ]
 *
 * Output:
 *   Array of events:
 *     {
 *       type: "pinchstart" | "pinchmove" | "pinchend" |
 *             "tap" | "posechange",
 *       hand: "Left" | "Right",
 *       x,
 *       y,
 *       ...
 *     }
 *
 * Coordinates are normalized to the MediaPipe image space:
 *   x: 0..1
 *   y: 0..1
 *   z: MediaPipe normalized depth
 *
 * This module intentionally knows nothing about:
 *   - cameras
 *   - MediaPipe
 *   - DOM
 *   - Three.js
 *   - network
 *   - rendering
 */

// ---------------------------------------------------------------------------
// Landmark indices
// ---------------------------------------------------------------------------

export const WRIST = 0;
export const THUMB_TIP = 4;
export const INDEX_MCP = 5;
export const INDEX_TIP = 8;
export const MIDDLE_MCP = 9;
export const MIDDLE_TIP = 12;
export const RING_MCP = 13;
export const RING_TIP = 16;
export const PINKY_MCP = 17;
export const PINKY_TIP = 20;

// Fingers used by the pose classifier.
// Thumb is intentionally excluded because its geometry varies considerably
// with palm orientation and hand rotation.
export const FINGER_PAIRS = Object.freeze([
  Object.freeze({ name: "index", tip: INDEX_TIP, mcp: INDEX_MCP }),
  Object.freeze({ name: "middle", tip: MIDDLE_TIP, mcp: MIDDLE_MCP }),
  Object.freeze({ name: "ring", tip: RING_TIP, mcp: RING_MCP }),
  Object.freeze({ name: "pinky", tip: PINKY_TIP, mcp: PINKY_MCP }),
]);

// ---------------------------------------------------------------------------
// Smoothing
// ---------------------------------------------------------------------------

/**
 * Exponential smoothing factor.
 *
 * Higher values follow the camera more closely.
 * Lower values remove more jitter.
 */
export const SMOOTHING_ALPHA = 0.35;

// ---------------------------------------------------------------------------
// Pinch thresholds
// ---------------------------------------------------------------------------

/**
 * Pinch distance is:
 *
 *   distance(thumbTip, indexTip)
 *   --------------------------------
 *   distance(wrist, middleMCP)
 *
 * The enter threshold must be smaller than the exit threshold to create
 * hysteresis and prevent rapid start/end flickering near the boundary.
 */
export const PINCH_ENTER_THRESHOLD = 0.42;
export const PINCH_EXIT_THRESHOLD = 0.52;

// ---------------------------------------------------------------------------
// Pose classification
// ---------------------------------------------------------------------------

/**
 * A finger is considered extended when:
 *
 *   distance(tip, MCP) / distance(MCP, wrist)
 *
 * is at or above this value.
 */
export const FINGER_EXTENDED_RATIO = 1.0;

/**
 * A finger is considered curled when the same ratio is at or below this.
 */
export const FINGER_CURLED_RATIO = 0.75;

/**
 * Pose must remain the same candidate for approximately this long before
 * becoming the stable pose.
 */
export const POSE_DEBOUNCE_MS = 120;

// ---------------------------------------------------------------------------
// Air tap
// ---------------------------------------------------------------------------

/**
 * Minimum downward fingertip velocity in normalized coordinates / second.
 *
 * MediaPipe's y axis increases downward, so a positive y velocity is a
 * downward movement.
 */
export const TAP_DOWNWARD_VELOCITY = 1.2;

/**
 * Minimum upward rebound velocity in normalized coordinates / second.
 */
export const TAP_REBOUND_VELOCITY = 0.45;

/**
 * A rebound must happen within this interval after the downward movement.
 */
export const TAP_REBOUND_WINDOW_MS = 220;

/**
 * Prevents a single physical tap from generating multiple events while
 * the fingertip is still oscillating.
 */
export const TAP_COOLDOWN_MS = 100;

/**
 * Ignore impossibly large time gaps. This is useful if a tab is suspended
 * or the caller accidentally skips a large portion of time.
 */
export const MAX_FRAME_DELTA_MS = 250;

// ---------------------------------------------------------------------------
// Generic geometry helpers
// ---------------------------------------------------------------------------

function distance2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;

  return Math.hypot(dx, dy);
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

// ---------------------------------------------------------------------------
// Depth from apparent hand size (additive, 2026-09-20)
//
// A hand that appears larger has moved toward the camera. The session keeps
// a per-hand baseline of `handSize` (wrist→middleMCP, normalized units) and
// converts consecutive pinch frames into a bounded depth delta.
// ---------------------------------------------------------------------------

/**
 * Relative change of apparent hand size, clamped to [-1, 1].
 *
 * Positive = the hand appears larger = it moved toward the camera.
 * Returns 0 for a non-finite or non-positive previous size (no baseline to
 * compare against), and for a non-finite current size.
 *
 * @param {number} previousSize
 * @param {number} currentSize
 * @returns {number}
 */
export function handDepthDelta(previousSize, currentSize) {
  const prev = Number(previousSize);
  const curr = Number(currentSize);
  if (!Number.isFinite(prev) || prev <= 0) return 0;
  if (!Number.isFinite(curr)) return 0;
  const delta = (curr - prev) / prev;
  if (!Number.isFinite(delta)) return 0;
  return Math.min(1, Math.max(-1, delta));
}

function isValidLandmark(point) {
  return (
    point &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    Number.isFinite(point.z ?? 0)
  );
}

function validHand(hand) {
  return (
    hand &&
    (hand.handedness === "Left" || hand.handedness === "Right") &&
    Array.isArray(hand.landmarks) &&
    hand.landmarks.length >= 21 &&
    hand.landmarks.every(isValidLandmark)
  );
}

// ---------------------------------------------------------------------------
// Hand matching
// ---------------------------------------------------------------------------

/**
 * Get a compact hand position used for matching.
 *
 * Wrist is intentionally used because it is relatively stable compared
 * with fingertips during gestures.
 */
function handAnchor(hand) {
  return hand.landmarks[WRIST];
}

/**
 * Match current hands to previous states.
 *
 * MediaPipe generally supplies Left/Right consistently, but this still
 * performs proximity matching so a hand disappearing/reappearing or
 * reordered result array doesn't accidentally inherit another hand's state.
 */
function matchHands(hands, states) {
  const matches = [];
  const usedStates = new Set();

  for (const hand of hands) {
    let bestState = null;
    let bestDistance = Infinity;

    for (const state of states) {
      if (usedStates.has(state)) continue;
      if (state.handedness !== hand.handedness) continue;

      const currentAnchor = handAnchor(hand);
      const previousAnchor = state.lastRawAnchor;

      const distance = previousAnchor
        ? distance2D(currentAnchor, previousAnchor)
        : Infinity;

      if (distance < bestDistance) {
        bestDistance = distance;
        bestState = state;
      }
    }

    if (bestState) {
      usedStates.add(bestState);
      matches.push({ hand, state: bestState });
    } else {
      matches.push({ hand, state: null });
    }
  }

  return matches;
}

// ---------------------------------------------------------------------------
// Smoothing
// ---------------------------------------------------------------------------

function smoothLandmarks(previous, current) {
  if (!previous) {
    return current.map((point) => ({
      x: point.x,
      y: point.y,
      z: point.z ?? 0,
    }));
  }

  return current.map((point, index) => {
    const old = previous[index];

    if (!old) {
      return {
        x: point.x,
        y: point.y,
        z: point.z ?? 0,
      };
    }

    return {
      x: old.x + (point.x - old.x) * SMOOTHING_ALPHA,
      y: old.y + (point.y - old.y) * SMOOTHING_ALPHA,
      z: old.z + ((point.z ?? 0) - old.z) * SMOOTHING_ALPHA,
    };
  });
}

// ---------------------------------------------------------------------------
// Pinch
// ---------------------------------------------------------------------------

function getPinchMetrics(landmarks) {
  const thumb = landmarks[THUMB_TIP];
  const index = landmarks[INDEX_TIP];
  const wrist = landmarks[WRIST];
  const middleMcp = landmarks[MIDDLE_MCP];

  const handSize = distance2D(wrist, middleMcp);

  if (handSize <= Number.EPSILON) {
    return {
      ratio: Infinity,
      point: midpoint(thumb, index),
      handSize,
    };
  }

  const pinchDistance = distance2D(thumb, index);

  return {
    ratio: pinchDistance / handSize,
    point: midpoint(thumb, index),
    handSize,
  };
}

function updatePinch(state, nowMs) {
  const metrics = getPinchMetrics(state.smoothedLandmarks);
  const wasPinching = state.pinching;

  let isPinching = wasPinching;

  if (!wasPinching && metrics.ratio <= PINCH_ENTER_THRESHOLD) {
    isPinching = true;
  } else if (wasPinching && metrics.ratio >= PINCH_EXIT_THRESHOLD) {
    isPinching = false;
  }

  state.pinching = isPinching;

  if (!wasPinching && isPinching) {
    return {
      type: "pinchstart",
      hand: state.handedness,
      x: metrics.point.x,
      y: metrics.point.y,
      ratio: metrics.ratio,
      handSize: metrics.handSize,
      timestamp: nowMs,
    };
  }

  if (wasPinching && !isPinching) {
    return {
      type: "pinchend",
      hand: state.handedness,
      x: metrics.point.x,
      y: metrics.point.y,
      ratio: metrics.ratio,
      handSize: metrics.handSize,
      timestamp: nowMs,
    };
  }

  if (isPinching) {
    return {
      type: "pinchmove",
      hand: state.handedness,
      x: metrics.point.x,
      y: metrics.point.y,
      ratio: metrics.ratio,
      handSize: metrics.handSize,
      timestamp: nowMs,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Pose classification
// ---------------------------------------------------------------------------

function fingerRatio(landmarks, tipIndex, mcpIndex) {
  const tip = landmarks[tipIndex];
  const mcp = landmarks[mcpIndex];
  const wrist = landmarks[WRIST];

  const denominator = distance2D(mcp, wrist);

  if (denominator <= Number.EPSILON) {
    return 0;
  }

  return distance2D(tip, mcp) / denominator;
}

function classifyPose(landmarks) {
  const ratios = FINGER_PAIRS.map((finger) => ({
    name: finger.name,
    ratio: fingerRatio(landmarks, finger.tip, finger.mcp),
  }));

  const extended = ratios.filter(
    (finger) => finger.ratio >= FINGER_EXTENDED_RATIO,
  ).length;

  const curled = ratios.filter(
    (finger) => finger.ratio <= FINGER_CURLED_RATIO,
  ).length;

  const index = ratios[0];
  const nonIndex = ratios.slice(1);

  // Open palm:
  // All four primary fingers extended.
  if (extended === 4) {
    return "open-palm";
  }

  // Fist:
  // All four primary fingers curled.
  if (curled === 4) {
    return "fist";
  }

  // Pointing:
  // Index is extended while at least two of the other fingers are curled.
  if (
    index.ratio >= FINGER_EXTENDED_RATIO &&
    nonIndex.filter((finger) => finger.ratio <= FINGER_CURLED_RATIO).length >= 2
  ) {
    return "pointing";
  }

  return "unknown";
}

function updatePose(state, nowMs) {
  const pose = classifyPose(state.smoothedLandmarks);

  if (pose === state.stablePose) {
    state.poseCandidate = pose;
    state.poseCandidateSince = nowMs;
    return null;
  }

  if (pose !== state.poseCandidate) {
    state.poseCandidate = pose;
    state.poseCandidateSince = nowMs;
    return null;
  }

  if (
    state.poseCandidateSince != null &&
    nowMs - state.poseCandidateSince >= POSE_DEBOUNCE_MS
  ) {
    const previousPose = state.stablePose;
    state.stablePose = pose;

    return {
      type: "posechange",
      hand: state.handedness,
      x: state.smoothedLandmarks[INDEX_TIP].x,
      y: state.smoothedLandmarks[INDEX_TIP].y,
      pose,
      previousPose,
      timestamp: nowMs,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Air tap
// ---------------------------------------------------------------------------

function updateTapFinger(state, fingerName, tipIndex, rawLandmarks, nowMs) {
  // Tap velocity is measured on RAW fingertip positions. Smoothing smears
  // the fast down/up transient across frames, so real taps would never
  // reach the velocity thresholds on smoothed data. Pinch and pose
  // intentionally stay on smoothed landmarks for stability.
  const raw = rawLandmarks[tipIndex];
  const point = { x: raw.x, y: raw.y };
  const tracker = state.tap[fingerName];

  if (!tracker.previousPoint || tracker.previousTime == null) {
    tracker.previousPoint = { x: point.x, y: point.y };
    tracker.previousTime = nowMs;
    return null;
  }

  const dt = nowMs - tracker.previousTime;

  if (dt <= 0 || dt > MAX_FRAME_DELTA_MS) {
    tracker.previousPoint = { x: point.x, y: point.y };
    tracker.previousTime = nowMs;
    return null;
  }

  const velocityY = ((point.y - tracker.previousPoint.y) / dt) * 1000;

  tracker.previousPoint = {
    x: point.x,
    y: point.y,
  };
  tracker.previousTime = nowMs;

  // Cooldown prevents a single tap from producing multiple events.
  if (nowMs - tracker.lastTapAt < TAP_COOLDOWN_MS) {
    return null;
  }

  // Phase 1: detect the fast downward motion.
  if (!tracker.armed && velocityY >= TAP_DOWNWARD_VELOCITY) {
    tracker.armed = true;
    tracker.downwardAt = nowMs;
    tracker.downwardY = point.y;
    return null;
  }

  if (!tracker.armed) {
    return null;
  }

  // If the rebound window expires before an upward movement, cancel.
  if (nowMs - tracker.downwardAt > TAP_REBOUND_WINDOW_MS) {
    tracker.armed = false;
    tracker.downwardAt = null;
    tracker.downwardY = null;
    return null;
  }

  // Phase 2: detect the upward rebound.
  if (velocityY <= -TAP_REBOUND_VELOCITY) {
    tracker.armed = false;
    tracker.lastTapAt = nowMs;

    return {
      type: "tap",
      hand: state.handedness,
      finger: fingerName,
      x: point.x,
      y: point.y,
      timestamp: nowMs,
    };
  }

  return null;
}

function updateTap(state, rawLandmarks, nowMs) {
  // Both index and middle fingers can independently create an air tap.
  const indexTap = updateTapFinger(
    state,
    "index",
    INDEX_TIP,
    rawLandmarks,
    nowMs,
  );

  const middleTap = updateTapFinger(
    state,
    "middle",
    MIDDLE_TIP,
    rawLandmarks,
    nowMs,
  );

  return indexTap ?? middleTap;
}

// ---------------------------------------------------------------------------
// State construction
// ---------------------------------------------------------------------------

function createState(handedness, landmarks, nowMs) {
  return {
    handedness,

    // Smoothing state.
    smoothedLandmarks: landmarks.map((point) => ({
      x: point.x,
      y: point.y,
      z: point.z ?? 0,
    })),

    // Raw anchor is retained for hand matching.
    lastRawAnchor: {
      x: landmarks[WRIST].x,
      y: landmarks[WRIST].y,
      z: landmarks[WRIST].z ?? 0,
    },

    // Pinch state.
    pinching: false,

    // Pose state.
    stablePose: "unknown",
    poseCandidate: "unknown",
    poseCandidateSince: nowMs,

    // Tap state.
    tap: {
      index: {
        previousPoint: null,
        previousTime: null,
        armed: false,
        downwardAt: null,
        downwardY: null,
        lastTapAt: -Infinity,
      },

      middle: {
        previousPoint: null,
        previousTime: null,
        armed: false,
        downwardAt: null,
        downwardY: null,
        lastTapAt: -Infinity,
      },
    },

    // Used to detect disappearance/reappearance.
    lastSeenAt: nowMs,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create an isolated Hand Lens state machine.
 *
 * Every call creates independent smoothing, pinch, pose and tap state.
 */
export function createHandLens() {
  /**
   * Active hand states.
   *
   * Normally there will be one Left and one Right state.
   * Keeping an array makes the matching logic resilient to result ordering
   * and unusual duplicate handedness results.
   */
  let states = [];

  /**
   * Hands seen during the previous update.
   *
   * This is used to determine whether a hand disappeared and should therefore
   * be reset instead of smoothing across the disappearance.
   */
  let previousSeenHandedness = new Set();

  /**
   * Update the detector with one MediaPipe-style frame.
   *
   * @param {Array} hands
   * @param {number} nowMs
   * @returns {Array<object>}
   */
  function update(hands, nowMs) {
    if (!Number.isFinite(nowMs)) {
      throw new TypeError("nowMs must be a finite number");
    }

    if (!Array.isArray(hands)) {
      throw new TypeError("hands must be an array");
    }

    // Invalid hand records are ignored rather than allowing one malformed
    // MediaPipe result to break the entire gesture pipeline.
    const validHands = hands.filter(validHand);

    const currentSeenHandedness = new Set(
      validHands.map((hand) => hand.handedness),
    );

    // Any previous state whose handedness disappeared must not be allowed to
    // survive into a later reappearance. We still emit pinchend immediately
    // for an active pinch before discarding it.
    const events = [];

    for (const state of states) {
      if (
        !currentSeenHandedness.has(state.handedness) &&
        previousSeenHandedness.has(state.handedness)
      ) {
        if (state.pinching) {
          const point = state.smoothedLandmarks[INDEX_TIP];
          const endedSize = getPinchMetrics(state.smoothedLandmarks).handSize;

          events.push({
            type: "pinchend",
            hand: state.handedness,
            x: point.x,
            y: point.y,
            ratio: Infinity,
            handSize: endedSize,
            timestamp: nowMs,
          });
        }
      }
    }

    // Discard states for hands that disappeared.
    states = states.filter((state) =>
      currentSeenHandedness.has(state.handedness),
    );

    const matches = matchHands(validHands, states);

    const nextStates = [];

    for (const { hand, state: matchedState } of matches) {
      let state = matchedState;

      // No matching state means this is a new/reappeared hand.
      //
      // IMPORTANT:
      // Start smoothing directly from the new frame. Never blend it with
      // stale landmarks from the previous appearance.
      // Detectors still run on this first frame: a hand that appears
      // already pinching must report pinchstart immediately rather than
      // silently dropping the gesture for one frame.
      if (!state) {
        state = createState(hand.handedness, hand.landmarks, nowMs);
      }

      // Smooth landmarks.
      state.smoothedLandmarks = smoothLandmarks(
        state.smoothedLandmarks,
        hand.landmarks,
      );

      state.lastRawAnchor = {
        x: hand.landmarks[WRIST].x,
        y: hand.landmarks[WRIST].y,
        z: hand.landmarks[WRIST].z ?? 0,
      };

      state.lastSeenAt = nowMs;

      // Gesture detectors operate on smoothed coordinates.
      const pinchEvent = updatePinch(state, nowMs);
      if (pinchEvent) {
        events.push(pinchEvent);
      }

      const poseEvent = updatePose(state, nowMs);
      if (poseEvent) {
        events.push(poseEvent);
      }

      const tapEvent = updateTap(state, hand.landmarks, nowMs);
      if (tapEvent) {
        events.push(tapEvent);
      }

      nextStates.push(state);
    }

    states = nextStates;

    previousSeenHandedness = currentSeenHandedness;

    return events;
  }

  return {
    update,
  };
}

// ---------------------------------------------------------------------------
// Default export
// ---------------------------------------------------------------------------

export default {
  createHandLens,
  handDepthDelta,

  WRIST,
  THUMB_TIP,
  INDEX_MCP,
  INDEX_TIP,
  MIDDLE_MCP,
  MIDDLE_TIP,
  RING_MCP,
  RING_TIP,
  PINKY_MCP,
  PINKY_TIP,

  FINGER_PAIRS,

  SMOOTHING_ALPHA,

  PINCH_ENTER_THRESHOLD,
  PINCH_EXIT_THRESHOLD,

  FINGER_EXTENDED_RATIO,
  FINGER_CURLED_RATIO,
  POSE_DEBOUNCE_MS,

  TAP_DOWNWARD_VELOCITY,
  TAP_REBOUND_VELOCITY,
  TAP_REBOUND_WINDOW_MS,
  TAP_COOLDOWN_MS,
  MAX_FRAME_DELTA_MS,
};
