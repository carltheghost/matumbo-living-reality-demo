import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  GAZE_HAND_ALLOWED_GESTURES,
  GAZE_HAND_COUPLING_BOUNDARY,
  GAZE_HAND_LOCK_TTL_MS,
  createGazeHandCouplingState,
  establishGazeHandLock,
  expireGazeHandLock,
  isFreshGazeHandLock,
  normalizeGazeHandPoint,
  resolveGazeHandAction,
} from "../src/render/gaze-hand-coupling.js";

const ROOT = new URL("../", import.meta.url);

test("gaze lock is bounded, immutable, and expires quickly", () => {
  const point = normalizeGazeHandPoint({ x: 2, y: -2 });
  assert.deepEqual(point, { x: 1, y: -1 });
  assert.equal(Object.isFrozen(point), true);
  const lock = establishGazeHandLock({
    targetBlockId: "block-world:rooms",
    targetCoordinate: [1, 2, 3],
    normalized: point,
    now: 1_000,
  });
  assert.equal(lock.lockActive, true);
  assert.equal(lock.expiresAt, 1_000 + GAZE_HAND_LOCK_TTL_MS);
  assert.equal(isFreshGazeHandLock(lock, 1_001), true);
  assert.equal(isFreshGazeHandLock(lock, lock.expiresAt), false);
  const expired = expireGazeHandLock(lock, lock.expiresAt + 1);
  assert.equal(expired.lockActive, false);
  assert.equal(expired.reason, "gaze-expired");
  assert.equal(expired.targetBlockId, lock.targetBlockId, "expired state retains diagnostic target only");
  assert.equal(Object.isFrozen(expired), true);
});

test("fresh hand actions reuse a missing hand point and require the same target", () => {
  const lock = establishGazeHandLock({
    targetBlockId: "block-world:rooms",
    targetCoordinate: [1, 2, 3],
    normalized: { x: 0.2, y: -0.3 },
    now: 50,
  });
  for (const gesture of GAZE_HAND_ALLOWED_GESTURES) {
    const resolved = resolveGazeHandAction({ state: lock, gesture, now: 100 });
    assert.equal(resolved.allowed, true);
    assert.equal(resolved.targetBlockId, lock.targetBlockId);
    assert.deepEqual(resolved.normalized, lock.normalized);
    assert.equal(resolved.reuseGazePoint, true);
    assert.equal(resolved.sameTargetRequired, true);
  }
  const handPoint = resolveGazeHandAction({
    state: lock,
    gesture: "pinch",
    normalized: { x: -0.5, y: 0.4 },
    now: 100,
  });
  assert.equal(handPoint.allowed, true);
  assert.equal(handPoint.reuseGazePoint, false);
  assert.deepEqual(handPoint.normalized, { x: -0.5, y: 0.4 });
});

test("stale or absent gaze blocks native-hand actions", () => {
  const noLock = resolveGazeHandAction({
    state: createGazeHandCouplingState({ now: 0 }),
    gesture: "pinch",
    now: 1,
  });
  assert.equal(noLock.allowed, false);
  assert.equal(noLock.reason, "gaze-required");
  const lock = establishGazeHandLock({ targetBlockId: "cube", normalized: { x: 0, y: 0 }, now: 10, ttlMs: 20 });
  const stale = resolveGazeHandAction({ state: lock, gesture: "open", now: 30 });
  assert.equal(stale.allowed, false);
  assert.equal(stale.reason, "gaze-expired");
  const unsupported = resolveGazeHandAction({ state: lock, gesture: "wave", now: 11 });
  assert.equal(unsupported.allowed, false);
  assert.equal(unsupported.reason, "gesture-unsupported");
});

test("coupling source and main bridge retain the sensor boundary", async () => {
  const source = await readFile(new URL("../src/render/gaze-hand-coupling.js", import.meta.url), "utf8");
  const input = await readFile(new URL("../src/render/gesture-input.js", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(source, /GAZE_HAND_LOCK_TTL_MS/);
  assert.match(source, /resolveGazeHandAction/);
  assert.match(source, /No raw frames.*landmarks.*identity.*recording.*network.*storage/i);
  assert.match(input, /pointProvided/);
  assert.match(main, /gaze-hand-coupling/i);
  assert.match(main, /gaze-required|gaze-expired/);
  assert.match(main, /gesture-input-coupling-status/);
  assert.match(html, /GAZE \+ HAND/);
  assert.match(html, /LOOK THEN PINCH/i);
  assert.doesNotMatch(source, /fetch\s*\(|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB/);
  assert.equal(GAZE_HAND_COUPLING_BOUNDARY.includes("wallet"), true);
});
