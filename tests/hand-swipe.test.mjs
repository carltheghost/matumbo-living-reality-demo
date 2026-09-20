/**
 * tests/hand-swipe.test.mjs
 *
 * Swipe accumulation behaviour of src/domains/hand-gestures.js:
 * fast open-palm motion + quick stop with enough travel emits exactly one
 * swipe with the dominant direction; the tracker is consumed (no dupes),
 * cancelled by pinch, and never armed by slow drift.
 *
 * Run with: node --test tests/hand-swipe.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createHandGestures,
  SWIPE_VELOCITY_THRESHOLD,
  SWIPE_STOP_VELOCITY,
  SWIPE_MIN_DISTANCE,
} from "../src/domains/hand-gestures.js";

// ---------------------------------------------------------------------------
// Event helpers
// ---------------------------------------------------------------------------

function openPalm(hand, x, y) {
  return { type: "posechange", hand, pose: "open-palm", x, y };
}

function move(hand, x, y) {
  return { type: "move", hand, x, y };
}

function pinchStart(hand, x, y) {
  return { type: "pinchstart", hand, x, y };
}

function swipes(events) {
  return events.filter((e) => e.type === "swipe");
}

/**
 * Drive a rightward open-palm swipe through the gesture state machine.
 *
 * Fast phase: 0.024 units per 16 ms = 1.5 u/s (> SWIPE_VELOCITY_THRESHOLD).
 * Stop phase: hold position so the pairwise speed collapses.
 * Total travel is ~0.26 (>= SWIPE_MIN_DISTANCE), total time ~224 ms.
 */
function driveFastSwipe(g) {
  const out = [];
  out.push(...g.update([openPalm("Right", 0.2, 0.5)], 0));

  let x = 0.2;
  for (let k = 1; k <= 11; k++) {
    x += 0.024;
    out.push(...g.update([move("Right", x, 0.5)], k * 16));
  }

  for (let k = 12; k <= 14; k++) {
    out.push(...g.update([move("Right", x, 0.5)], k * 16));
  }

  return { out, stopX: x, endT: 14 * 16 };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("swipe accumulation", () => {
  it("fast motion + stop emits exactly one swipe with the dominant direction", () => {
    assert.ok(
      SWIPE_VELOCITY_THRESHOLD < 1.5,
      "fixture assumes the threshold is below the fixture speed",
    );

    const g = createHandGestures();
    const { out, stopX } = driveFastSwipe(g);
    const found = swipes(out);

    assert.equal(found.length, 1, "exactly one swipe per physical swipe");
    assert.equal(found[0].direction, "right");
    assert.equal(found[0].hand, "Right");
    assert.ok(
      Math.abs(found[0].x - stopX) < 1e-9,
      `swipe x (${found[0].x}) should be the stop position`,
    );
    assert.ok(
      stopX - 0.2 >= SWIPE_MIN_DISTANCE,
      "fixture must travel past the minimum distance",
    );
  });

  it("continuing to move after a swipe emits no second swipe", () => {
    const g = createHandGestures();
    const { endT, stopX } = driveFastSwipe(g);

    let later = [];
    for (let k = 15; k <= 25; k++) {
      later.push(...g.update([move("Right", stopX, 0.5)], endT + (k - 14) * 16));
    }

    assert.equal(swipes(later).length, 0, "the tracker is consumed after firing");
  });

  it("a pinchstart during an in-progress swipe cancels the tracker", () => {
    const g = createHandGestures();
    const out = [];

    out.push(...g.update([openPalm("Right", 0.2, 0.5)], 0));

    // Fast phase only: never reach the stop while unpinched.
    for (let k = 1; k <= 8; k++) {
      out.push(...g.update([move("Right", 0.2 + 0.024 * k, 0.5)], k * 16));
    }

    // Pinch mid-swipe: cancels the swipe tracker.
    out.push(...g.update([pinchStart("Right", 0.392, 0.5)], 9 * 16));

    // Even a full stop afterwards must not swipe.
    for (let k = 10; k <= 16; k++) {
      out.push(...g.update([move("Right", 0.392, 0.5)], k * 16));
    }

    assert.equal(
      swipes(out).length,
      0,
      "pinch must cancel an in-progress swipe",
    );
  });

  it("slow drift below the velocity threshold never swipes", () => {
    const g = createHandGestures();
    const out = [];

    out.push(...g.update([openPalm("Right", 0.2, 0.5)], 0));

    // 0.008 units per 16 ms = 0.5 u/s: well under the 1.4 u/s threshold,
    // but with enough travel (0.144) that a velocity-less detector would fire.
    for (let k = 1; k <= 18; k++) {
      out.push(...g.update([move("Right", 0.2 + 0.008 * k, 0.5)], k * 16));
    }

    // Come to a full stop.
    for (let k = 19; k <= 22; k++) {
      out.push(...g.update([move("Right", 0.2 + 0.008 * 18, 0.5)], k * 16));
    }

    assert.ok(
      0.2 + 0.008 * 18 - 0.2 >= SWIPE_MIN_DISTANCE,
      "fixture must travel far enough to isolate the velocity gate",
    );
    assert.equal(swipes(out).length, 0, "slow drift must not swipe");
  });

  it("vertical-dominant motion reports the vertical direction", () => {
    const g = createHandGestures();
    const out = [];

    out.push(...g.update([openPalm("Right", 0.5, 0.6)], 0));

    // Downward: y grows downward in normalized space.
    let y = 0.6;
    for (let k = 1; k <= 8; k++) {
      y += 0.024;
      out.push(...g.update([move("Right", 0.5, y)], k * 16));
    }
    for (let k = 9; k <= 11; k++) {
      out.push(...g.update([move("Right", 0.5, y)], k * 16));
    }

    const found = swipes(out);
    assert.equal(found.length, 1);
    assert.equal(found[0].direction, "down");
  });
});
