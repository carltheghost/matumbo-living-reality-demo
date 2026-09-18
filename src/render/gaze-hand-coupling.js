/**
 * Short-lived, capability-aware gaze + hand coupling.
 *
 * A host may provide a sanitized gaze point and a later coarse native-hand
 * gesture. This module only keeps the tiny address needed to couple those
 * two samples: a normalized point, a stable local block id, and an expiry
 * time. It never receives frames, landmarks, identity, or sensor handles.
 * The renderer is responsible for raycasting the point and deciding which
 * existing local select/open/inspect or bounded Grab -> Hold -> Place draft
 * operation is allowed.
 */

export const GAZE_HAND_COUPLING_SOURCE = "gaze-hand-coupling";
export const GAZE_HAND_LOCK_TTL_MS = 1800;
export const GAZE_HAND_CARRY_GESTURES = Object.freeze(["grab", "hold", "place", "release"]);
export const GAZE_HAND_ALLOWED_GESTURES = Object.freeze([
  "pinch",
  "point",
  "open",
  "inspect",
  "select",
  ...GAZE_HAND_CARRY_GESTURES,
]);
export const GAZE_HAND_COUPLING_BOUNDARY = "Fresh host gaze establishes a short local target lock; native-hand pinch/point/open/inspect or XR-hand select may address that same existing cube only while the lock is fresh. Explicit native-hand grab/hold/place/release may use only that fresh same-target local held draft; hold is a bounded one-step delta and release places at the held coordinate without inferring a destination. No raw frames, landmarks, identity, recording, upload, network, storage, arbitrary movement, wallet, token, settlement, or external execution.";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function freeze(value) {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => freeze(entry)));
  if (!isRecord(value)) return value;
  return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freeze(entry)])));
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function safeNow(value = Date.now()) {
  const number = finite(value);
  return number === null ? 0 : number;
}

export function normalizeGazeHandPoint(point) {
  const x = finite(point?.x);
  const y = finite(point?.y);
  if (x === null || y === null) return null;
  return freeze({
    x: Math.max(-1, Math.min(1, x)),
    y: Math.max(-1, Math.min(1, y)),
  });
}

function safeCoordinate(coordinate) {
  if (!Array.isArray(coordinate) || coordinate.length !== 3) return null;
  const values = coordinate.map((value) => finite(value));
  return values.every((value) => value !== null) ? values : null;
}

export function createGazeHandCouplingState({ now = 0, reason = "no-gaze" } = {}) {
  return freeze({
    source: GAZE_HAND_COUPLING_SOURCE,
    lockActive: false,
    targetBlockId: null,
    targetCoordinate: null,
    normalized: null,
    acquiredAt: null,
    expiresAt: null,
    lastAction: "idle",
    reason: String(reason),
    now: safeNow(now),
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    persistence: false,
    executable: false,
    boundary: GAZE_HAND_COUPLING_BOUNDARY,
  });
}

/** Establish a new lock only when both a block id and a bounded point exist. */
export function establishGazeHandLock({
  targetBlockId,
  targetCoordinate = null,
  normalized,
  now = Date.now(),
  ttlMs = GAZE_HAND_LOCK_TTL_MS,
} = {}) {
  const point = normalizeGazeHandPoint(normalized);
  const id = typeof targetBlockId === "string" && targetBlockId.trim() ? targetBlockId.trim() : null;
  const timestamp = safeNow(now);
  const ttl = finite(ttlMs);
  if (!id || !point || ttl === null || ttl <= 0) {
    return createGazeHandCouplingState({ now: timestamp, reason: "gaze-target-missing" });
  }
  return freeze({
    source: GAZE_HAND_COUPLING_SOURCE,
    lockActive: true,
    targetBlockId: id,
    targetCoordinate: safeCoordinate(targetCoordinate),
    normalized: point,
    acquiredAt: timestamp,
    expiresAt: timestamp + Math.min(10_000, Math.max(1, ttl)),
    lastAction: "gaze-lock",
    reason: "fresh-gaze",
    now: timestamp,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    persistence: false,
    executable: false,
    boundary: GAZE_HAND_COUPLING_BOUNDARY,
  });
}

export function isFreshGazeHandLock(state, now = Date.now()) {
  const timestamp = safeNow(now);
  return state?.lockActive === true
    && typeof state?.targetBlockId === "string"
    && normalizeGazeHandPoint(state?.normalized) !== null
    && Number.isFinite(Number(state?.expiresAt))
    && Number(state.expiresAt) > timestamp;
}

export function expireGazeHandLock(state, now = Date.now()) {
  const timestamp = safeNow(now);
  if (!state?.lockActive || isFreshGazeHandLock(state, timestamp)) return state ?? createGazeHandCouplingState({ now: timestamp });
  return freeze({
    ...createGazeHandCouplingState({ now: timestamp, reason: "gaze-expired" }),
    targetBlockId: state?.targetBlockId ?? null,
    targetCoordinate: safeCoordinate(state?.targetCoordinate),
    normalized: normalizeGazeHandPoint(state?.normalized),
    acquiredAt: Number.isFinite(Number(state?.acquiredAt)) ? Number(state.acquiredAt) : null,
    expiresAt: Number.isFinite(Number(state?.expiresAt)) ? Number(state.expiresAt) : null,
    lastAction: "gaze-expired",
  });
}

/**
 * Resolve whether a native-hand sample may address the locked cube. A missing
 * hand point deliberately reuses the fresh gaze point; a supplied hand point
 * is returned for a renderer raycast, which must still verify the same block
 * id before applying an action.
 */
export function resolveGazeHandAction({ state, gesture, normalized = null, now = Date.now() } = {}) {
  const kind = typeof gesture === "string" ? gesture.trim().toLowerCase() : "";
  const point = normalizeGazeHandPoint(normalized);
  const fresh = isFreshGazeHandLock(state, now);
  if (!GAZE_HAND_ALLOWED_GESTURES.includes(kind)) {
    return freeze({
      allowed: false,
      reason: "gesture-unsupported",
      gesture: kind || null,
      targetBlockId: null,
      normalized: null,
      reuseGazePoint: false,
      sameTargetRequired: true,
      source: GAZE_HAND_COUPLING_SOURCE,
      boundary: GAZE_HAND_COUPLING_BOUNDARY,
    });
  }
  if (!fresh) {
    return freeze({
      allowed: false,
      reason: state?.lockActive || state?.reason === "gaze-expired" ? "gaze-expired" : "gaze-required",
      gesture: kind,
      targetBlockId: null,
      normalized: null,
      reuseGazePoint: false,
      sameTargetRequired: true,
      source: GAZE_HAND_COUPLING_SOURCE,
      boundary: GAZE_HAND_COUPLING_BOUNDARY,
    });
  }
  return freeze({
    allowed: true,
    reason: "gaze-hand-coupled",
    gesture: kind,
    targetBlockId: state.targetBlockId,
    normalized: point ?? state.normalized,
    reuseGazePoint: point === null,
    sameTargetRequired: true,
    source: GAZE_HAND_COUPLING_SOURCE,
    boundary: GAZE_HAND_COUPLING_BOUNDARY,
  });
}

export default Object.freeze({
  GAZE_HAND_COUPLING_SOURCE,
  GAZE_HAND_LOCK_TTL_MS,
  GAZE_HAND_CARRY_GESTURES,
  GAZE_HAND_ALLOWED_GESTURES,
  GAZE_HAND_COUPLING_BOUNDARY,
  normalizeGazeHandPoint,
  createGazeHandCouplingState,
  establishGazeHandLock,
  isFreshGazeHandLock,
  expireGazeHandLock,
  resolveGazeHandAction,
});
