/**
 * Gesture Lens domain — deterministic gesture-intent classification for the
 * Living Reality projection.
 *
 * Tumbo's vision: steer the 3D world with mid-air hand gestures — open palm
 * moves a hand proxy, pinch grabs, pinch-drag moves in 3D including depth,
 * two-hand spread stretches, two-hand twist rotates, fist releases.
 *
 * HONESTY NOTE (read before wiring a camera): in this build the classifier
 * runs on normalized hand-proxy frames. The live rehearsal pad turns
 * pointer/touch samples into the same synthetic frame shape a vendored
 * on-device landmark model would produce later, so the whole pipeline —
 * classification, intent derivation, proxy mapping — is exercised and tested
 * with no camera at all. The optional camera preview is a local
 * <video> preview only: it is never analyzed, recorded, uploaded, or sent
 * anywhere. Nothing here claims real hand-tracking hardware support.
 *
 * Everything is local simulation/projection data. Gesture intents reshape
 * presentation transforms only; they never touch wallet, ledger, contracts,
 * PAYCORE, T402, network, custody, mainnet, settlement, or real money.
 * Reality Lens Ω naming only — World Eye stays retired.
 */

export const GESTURE_LENS_SCHEMA_VERSION = 1;
export const GESTURE_LENS_SOURCE = "gesture-lens";
export const GESTURE_LENS_CONSOLE_SOURCE = "gesture-lens-console";
export const GESTURE_LENS_UPDATED_AT = "2026-09-18T00:00:00.000Z";

export const GESTURE_LENS_BOUNDARY =
  "Gesture Lens is a local rehearsal surface. Hand proxies in this build are driven by pointer/touch on the rehearsal pad — no camera analysis runs. The optional camera preview is on-device only: it is never recorded, analyzed, uploaded, or sent anywhere. Closing the preview stops the camera. Touch controls always work, with or without a camera. Gesture intents reshape the local projection only: no wallet, ledger, contracts, network, custody, mainnet, settlement, or real money.";

export const GESTURE_LENS_POSES = Object.freeze([
  "open",
  "pinch",
  "fist",
  "point",
  "unknown",
  "absent",
  "none",
]);

export const GESTURE_LENS_INTENTS = Object.freeze([
  "proxy-move",
  "grab",
  "drag",
  "scale",
  "rotate",
  "release",
]);

export const GESTURE_LENS_CAMERA_STATES = Object.freeze([
  "off",
  "preview",
  "denied",
  "unavailable",
  "error",
]);

// Deterministic classifier thresholds. Coordinates are normalized: x/y in
// [0, 1] across the frame, z in [-1, 1] where positive z is toward the
// viewer (pull) and negative z is away (push / depth).
export const GESTURE_LENS_PINCH_DISTANCE = 0.06;
export const GESTURE_LENS_CURL_DISTANCE = 0.1;
export const GESTURE_LENS_EXTEND_DISTANCE = 0.18;
export const GESTURE_LENS_SPREAD_DELTA_MIN = 0.03;
export const GESTURE_LENS_TWIST_DEGREES_MIN = 10;
export const GESTURE_LENS_MAX_TRACE = 24;

const FINGERS = Object.freeze(["thumb", "index", "middle", "ring", "pinky"]);
const CURL_FINGERS = Object.freeze(["index", "middle", "ring", "pinky"]);

function freeze(value) {
  if (Array.isArray(value)) value.forEach(freeze);
  else if (value && typeof value === "object") Object.values(value).forEach(freeze);
  return value && typeof value === "object" ? Object.freeze(value) : value;
}

function clamp(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  return Math.min(maximum, Math.max(minimum, number));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function round3(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 1000) / 1000;
}

function point3(point, fallback = { x: 0.5, y: 0.5, z: 0 }) {
  if (!point || typeof point !== "object") return { ...fallback };
  return {
    x: clamp01(point.x ?? fallback.x),
    y: clamp01(point.y ?? fallback.y),
    z: clamp(point.z ?? fallback.z, -1, 1),
  };
}

function distance3(a, b) {
  const pa = point3(a);
  const pb = point3(b);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
}

function presentHands(frame) {
  const hands = frame?.hands;
  if (!Array.isArray(hands)) return [];
  return hands.filter((hand) => hand && hand.present !== false);
}

function intentRecord(intent, detail = {}, at = 0) {
  return freeze({
    intent: intent ?? null,
    detail: freeze({ ...detail }),
    at: Number.isFinite(Number(at)) ? Number(at) : 0,
  });
}

/**
 * Build one synthetic hand at a normalized wrist position in a named pose.
 * Used by the rehearsal pad (pointer → frame bridge) and by tests; the pose
 * geometry is deliberately simple and documented, not a biometric claim.
 */
export function syntheticHand(wrist, pose = "open") {
  const base = point3(wrist);
  const tips = {};
  const place = (name, dx, dy, dz = 0) => {
    tips[name] = {
      x: clamp01(base.x + dx),
      y: clamp01(base.y + dy),
      z: clamp(base.z + dz, -1, 1),
    };
  };
  switch (pose) {
    case "fist":
      // Every fingertip curled into the palm: all tips near the wrist.
      FINGERS.forEach((finger, index) => place(finger, 0.02 + index * 0.006, 0.015));
      break;
    case "pinch":
      // Thumb and index tips nearly touching; the rest extended.
      place("thumb", 0.055, 0.055);
      place("index", 0.07, 0.07);
      place("middle", 0.0, 0.27);
      place("ring", -0.05, 0.25);
      place("pinky", -0.1, 0.2);
      break;
    case "point":
      // Index extended, everything else curled.
      place("thumb", 0.12, 0.02);
      place("index", 0.05, 0.25);
      place("middle", 0.02, 0.05);
      place("ring", -0.02, 0.05);
      place("pinky", -0.05, 0.04);
      break;
    case "open":
    default:
      // Open palm: all five tips fanned out from the wrist.
      place("thumb", 0.18, -0.02);
      place("index", 0.05, 0.25);
      place("middle", 0.0, 0.27);
      place("ring", -0.05, 0.25);
      place("pinky", -0.1, 0.2);
      break;
  }
  return freeze({ present: true, wrist: base, tips: freeze(tips) });
}

/**
 * Classify one hand into open / pinch / fist / point / unknown / absent.
 * Deterministic thresholds only — no ML beyond the frame producer.
 */
export function classifyHandPose(hand) {
  if (!hand || hand.present === false) return "absent";
  const wrist = point3(hand.wrist);
  const tips = hand.tips ?? {};
  const tipDistance = (name) => distance3(tips[name] ?? wrist, wrist);
  const curled = CURL_FINGERS.filter((finger) => tipDistance(finger) < GESTURE_LENS_CURL_DISTANCE).length;
  const extended = CURL_FINGERS.filter((finger) => tipDistance(finger) > GESTURE_LENS_EXTEND_DISTANCE).length;
  // Fist first: a fist also brings thumb and index tips close together.
  if (curled === CURL_FINGERS.length) return "fist";
  if (distance3(tips.thumb ?? wrist, tips.index ?? wrist) < GESTURE_LENS_PINCH_DISTANCE) return "pinch";
  if (extended === CURL_FINGERS.length) return "open";
  if (tipDistance("index") > GESTURE_LENS_EXTEND_DISTANCE && curled === CURL_FINGERS.length - 1) return "point";
  return "unknown";
}

/**
 * Classify two-hand relative motion between two frames into spread (scale)
 * or twist (rotate). Returns { kind: null } when neither passes threshold.
 * Spread wins ties deterministically.
 */
export function classifyTwoHandMotion(prevFrame, frame) {
  const prev = presentHands(prevFrame);
  const now = presentHands(frame);
  if (prev.length < 2 || now.length < 2) return { kind: null };
  const prevA = point3(prev[0].wrist);
  const prevB = point3(prev[1].wrist);
  const nowA = point3(now[0].wrist);
  const nowB = point3(now[1].wrist);
  const distPrev = Math.hypot(prevB.x - prevA.x, prevB.y - prevA.y, prevB.z - prevA.z);
  const distNow = Math.hypot(nowB.x - nowA.x, nowB.y - nowA.y, nowB.z - nowA.z);
  const spreadDelta = distNow - distPrev;
  const anglePrev = Math.atan2(prevB.y - prevA.y, prevB.x - prevA.x);
  const angleNow = Math.atan2(nowB.y - nowA.y, nowB.x - nowA.x);
  let twistDegrees = ((angleNow - anglePrev) * 180) / Math.PI;
  twistDegrees = ((twistDegrees + 540) % 360) - 180;
  const spreadScore = Math.abs(spreadDelta) / Math.max(distPrev, 1e-6);
  const twistScore = Math.abs(twistDegrees) / 45;
  if (Math.abs(spreadDelta) > GESTURE_LENS_SPREAD_DELTA_MIN && spreadScore >= twistScore) {
    return {
      kind: "spread",
      factor: distNow / Math.max(distPrev, 1e-6),
      delta: spreadDelta,
    };
  }
  if (Math.abs(twistDegrees) > GESTURE_LENS_TWIST_DEGREES_MIN) {
    return { kind: "twist", degrees: twistDegrees };
  }
  return { kind: null };
}

/**
 * Derive one gesture intent from the transition between two frames.
 * Single hand: open/point → proxy-move, pinch → grab then drag, fist →
 * release. Two hands: spread → scale, twist → rotate.
 */
export function deriveIntent(prevFrame, frame) {
  const at = Number(frame?.at ?? 0);
  const hands = presentHands(frame);
  if (hands.length >= 2) {
    const two = classifyTwoHandMotion(prevFrame, frame);
    if (two.kind === "spread") return intentRecord("scale", { factor: round3(two.factor), delta: round3(two.delta) }, at);
    if (two.kind === "twist") return intentRecord("rotate", { degrees: round3(two.degrees) }, at);
    return intentRecord(null, { reason: "two-hand-hold" }, at);
  }
  if (hands.length === 0) return intentRecord(null, { reason: "no-hand" }, at);
  const pose = classifyHandPose(hands[0]);
  const prevHands = presentHands(prevFrame);
  const prevPose = prevHands.length > 0 ? classifyHandPose(prevHands[0]) : "absent";
  const wrist = point3(hands[0].wrist);
  const prevWrist = prevHands.length > 0 ? point3(prevHands[0].wrist) : wrist;
  const dx = round3(wrist.x - prevWrist.x);
  const dy = round3(wrist.y - prevWrist.y);
  const dz = round3(wrist.z - prevWrist.z);
  switch (pose) {
    case "open":
      return intentRecord("proxy-move", { dx, dy, dz }, at);
    case "point":
      return intentRecord("proxy-move", { dx, dy, dz, precise: true }, at);
    case "pinch":
      return prevPose === "pinch"
        ? intentRecord("drag", { dx, dy, dz }, at)
        : intentRecord("grab", {}, at);
    case "fist":
      return intentRecord("release", {}, at);
    default:
      return intentRecord(null, { reason: `pose-${pose}` }, at);
  }
}

/**
 * Turn a rehearsal-pad pointer sample into the synthetic frame shape the
 * classifier consumes. This is the honesty seam: pointer/touch is the input
 * in this build, and it travels the exact pipeline a landmark frame would.
 *
 * sample: { x, y (0..1), depth (-1..1), mode: 'open'|'pinch'|'fist'|'point',
 *           twoHand: bool, spread (0..1), skew (-1..1), at }
 */
export function pointerSampleToFrame(sample = {}) {
  const x = clamp01(sample.x ?? 0.5);
  const y = clamp01(sample.y ?? 0.5);
  const z = clamp(Number(sample.depth ?? 0), -1, 1);
  const at = Number.isFinite(Number(sample.at)) ? Number(sample.at) : 0;
  const mode = sample.mode === "pinch" || sample.mode === "fist" || sample.mode === "point" ? sample.mode : "open";
  if (sample.twoHand === true) {
    const spreadX = 0.08 + clamp01(Number(sample.spread ?? 0.15)) * 0.3;
    const skewY = clamp(Number(sample.skew ?? 0), -1, 1) * 0.3;
    return freeze({
      at,
      proxy: true,
      hands: [
        syntheticHand({ x, y, z }, "pinch"),
        syntheticHand({ x: clamp01(x + spreadX), y: clamp01(y + skewY), z }, "pinch"),
      ],
    });
  }
  return freeze({ at, proxy: true, hands: [syntheticHand({ x, y, z }, mode)] });
}

function nowMs(now) {
  try {
    const value = typeof now === "function" ? now() : now;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  } catch {
    // Fall through to the wall clock; tests inject `now`.
  }
  return Date.now();
}

/**
 * Gesture Lens session: feeds frames through the classifier, tracks the
 * hand-proxy pose, and keeps a bounded intent trace. Pure local state.
 */
export function createGestureLens({ now = null } = {}) {
  let prevFrame = null;
  let pose = { x: 0.5, y: 0.5, z: 0 };
  let gesture = "none";
  let intents = 0;
  const trace = [];

  function pushTrace(record) {
    trace.push(record);
    while (trace.length > GESTURE_LENS_MAX_TRACE) trace.shift();
  }

  function noteFrame(frame) {
    const safe = frame && typeof frame === "object" ? frame : { at: nowMs(now), hands: [] };
    const result = deriveIntent(prevFrame, safe);
    prevFrame = safe;
    const hands = presentHands(safe);
    if (hands.length > 0 && hands[0].wrist) {
      const wrist = point3(hands[0].wrist);
      pose = { x: wrist.x, y: wrist.y, z: wrist.z };
    }
    gesture = result.intent ?? result.detail?.reason ?? "none";
    if (result.intent) {
      intents += 1;
      pushTrace({ ...result, gesture: result.intent });
    }
    return result;
  }

  function notePointerSample(sample = {}) {
    return noteFrame(pointerSampleToFrame({ ...sample, at: nowMs(now) }));
  }

  function getSnapshot() {
    return freeze({
      source: GESTURE_LENS_SOURCE,
      schemaVersion: GESTURE_LENS_SCHEMA_VERSION,
      gesture,
      pose: { ...pose },
      intents,
      trace: trace.map((entry) => ({ ...entry })),
      simulation: true,
      localOnly: true,
      recording: false,
      upload: false,
      externalNetwork: false,
      executable: false,
      cameraDrivenEdits: false,
      boundary: GESTURE_LENS_BOUNDARY,
    });
  }

  function reset() {
    prevFrame = null;
    pose = { x: 0.5, y: 0.5, z: 0 };
    gesture = "none";
    intents = 0;
    trace.length = 0;
    return getSnapshot();
  }

  function createContribution() {
    return freeze({
      schemaVersion: GESTURE_LENS_SCHEMA_VERSION,
      source: GESTURE_LENS_SOURCE,
      updatedAt: GESTURE_LENS_UPDATED_AT,
      simulation: true,
      entities: [
        {
          id: "gesture-lens:lens",
          kind: "gesture-lens",
          label: "Gesture Lens rehearsal surface",
          simulation: true,
        },
        {
          id: "gesture-lens:proxy",
          kind: "gesture-proxy",
          label: "Hand proxy cursor",
          simulation: true,
        },
        {
          id: "gesture-lens:pad",
          kind: "gesture-pad",
          label: "Rehearsal touch pad",
          simulation: true,
        },
      ],
      evidence: [
        {
          id: "gesture-lens:local-pipeline",
          kind: "simulated-gesture-pipeline",
          status: "local",
          note: "Classifier and intent derivation run on-device on synthetic proxy frames. No camera analysis in this build.",
        },
      ],
      capabilities: [
        { id: "gesture-lens.classify", mode: "local-rehearsal", authority: "none", executable: false },
        { id: "gesture-lens.preview", mode: "local-preview", authority: "none", executable: false },
      ],
      boundary: GESTURE_LENS_BOUNDARY,
    });
  }

  return freeze({
    noteFrame,
    notePointerSample,
    getSnapshot,
    reset,
    createContribution,
    source: GESTURE_LENS_SOURCE,
    boundary: GESTURE_LENS_BOUNDARY,
  });
}

export function createGestureLensContribution({ updatedAt = GESTURE_LENS_UPDATED_AT } = {}) {
  const lens = createGestureLens();
  const contribution = lens.createContribution();
  return freeze({ ...contribution, updatedAt });
}

export default createGestureLens;
