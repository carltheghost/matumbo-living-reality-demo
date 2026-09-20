/**
 * tests/hand-gestures.test.mjs
 *
 * Synthetic event sequences proving the four required behaviours
 * plus a few edge-case guards.  Run with:
 *   node --test tests/hand-gestures.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createHandGestures,
  OPEN_PALM_HOLD_MS,
  DOUBLE_PINCH_WINDOW_MS,
  SWIPE_VELOCITY_THRESHOLD,
} from "../src/domains/hand-gestures.js";
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function pose(hand, pose, x = 0.5, y = 0.5) {
  return { type: "posechange", hand, pose, x, y };
}
function pinchStart(hand, x, y) {
  return { type: "pinchstart", hand, x, y };
}
function pinchMove(hand, x, y) {
  return { type: "pinchmove", hand, x, y };
}
function pinchEnd(hand, x, y) {
  return { type: "pinchend", hand, x, y };
}
// ---------------------------------------------------------------------------
// 1. Two-hand scale factor math
// ---------------------------------------------------------------------------
describe("two-hand scale", () => {
  it("emits factor relative to distance at second-pinch start", () => {
    const g = createHandGestures();
    const events = [];
    // both hands become pinched – baseline distance = 0.2
    events.push(
      ...g.update(
        [
          pose("Left", "fist"),
          pose("Right", "fist"),
          pinchStart("Left", 0.4, 0.5),
          pinchStart("Right", 0.6, 0.5), // dist = 0.2
        ],
        1000
      )
    );
    // move farther – new dist = 0.4 → factor 2.0
    const scaleEvents = g.update(
      [
        pinchMove("Left", 0.3, 0.5),
        pinchMove("Right", 0.7, 0.5), // dist = 0.4
      ],
      1050
    );
    const scale = scaleEvents.find((e) => e.type === "scale");
    assert.ok(scale, "expected a scale event");
    assert.ok(Math.abs(scale.factor - 2.0) < 0.01, `factor was ${scale.factor}`);
  });
  it("also emits rotate when the vector twists", () => {
    const g = createHandGestures();
    g.update(
      [
        pinchStart("Left", 0.4, 0.5),
        pinchStart("Right", 0.6, 0.5),
      ],
      1000
    );
    // rotate 90° clockwise around midpoint
    const rotEvents = g.update(
      [
        pinchMove("Left", 0.5, 0.4),
        pinchMove("Right", 0.5, 0.6),
      ],
      1050
    );
    const rot = rotEvents.find((e) => e.type === "rotate");
    assert.ok(rot, "expected a rotate event");
    // roughly ±π/2
    assert.ok(Math.abs(Math.abs(rot.radians) - Math.PI / 2) < 0.15);
  });
});
// ---------------------------------------------------------------------------
// 2. Swipe direction detection
// ---------------------------------------------------------------------------
describe("swipe", () => {
  it("detects a fast left-to-right open-palm swipe", () => {
    const g = createHandGestures();
    // establish open-palm
    g.update([pose("Right", "open-palm", 0.2, 0.5)], 2000);
    // accelerate rightward over ~100 ms
    const t0 = 2000;
    g.update([pose("Right", "open-palm", 0.25, 0.5)], t0 + 30);
    g.update([pose("Right", "open-palm", 0.40, 0.5)], t0 + 60);
    g.update([pose("Right", "open-palm", 0.55, 0.5)], t0 + 90);
    // then stop
    const stopEvents = g.update(
      [pose("Right", "open-palm", 0.58, 0.5)],
      t0 + 160
    );
    const swipe = stopEvents.find((e) => e.type === "swipe");
    assert.ok(swipe, "expected swipe event");
    assert.equal(swipe.direction, "right");
  });
  it("detects an upward swipe", () => {
    const g = createHandGestures();
    g.update([pose("Left", "open-palm", 0.5, 0.7)], 3000);
    const t0 = 3000;
    g.update([pose("Left", "open-palm", 0.5, 0.55)], t0 + 40);
    g.update([pose("Left", "open-palm", 0.5, 0.40)], t0 + 80);
    const stopEvents = g.update(
      [pose("Left", "open-palm", 0.5, 0.38)],
      t0 + 150
    );
    const swipe = stopEvents.find((e) => e.type === "swipe");
    assert.ok(swipe);
    assert.equal(swipe.direction, "up");
  });
});
// ---------------------------------------------------------------------------
// 3. Double-pinch dive window (399 ms fires, 401 ms does not)
// ---------------------------------------------------------------------------
describe("double-pinch dive", () => {
  it("fires dive when second pinch arrives at 399 ms while pointing", () => {
    const g = createHandGestures();
    const t0 = 5000;
    // first pinch while pointing
    g.update(
      [pose("Right", "pointing"), pinchStart("Right", 0.5, 0.5)],
      t0
    );
    g.update([pinchEnd("Right", 0.5, 0.5)], t0 + 50);
    // second pinch 399 ms later
    const diveEvents = g.update(
      [pose("Right", "pointing"), pinchStart("Right", 0.51, 0.5)],
      t0 + 399
    );
    const dive = diveEvents.find((e) => e.type === "dive");
    assert.ok(dive, "expected dive at 399 ms");
  });
  it("does NOT fire dive when second pinch arrives at 401 ms", () => {
    const g = createHandGestures();
    const t0 = 6000;
    g.update(
      [pose("Left", "pointing"), pinchStart("Left", 0.5, 0.5)],
      t0
    );
    g.update([pinchEnd("Left", 0.5, 0.5)], t0 + 40);
    const events = g.update(
      [pose("Left", "pointing"), pinchStart("Left", 0.5, 0.5)],
      t0 + 401
    );
    const dive = events.find((e) => e.type === "dive");
    assert.equal(dive, undefined, "must not emit dive at 401 ms");
  });
  it("does not chain a third pinch into a second dive", () => {
    const g = createHandGestures();
    const t0 = 6500;
    g.update([pose("Right", "pointing"), pinchStart("Right", 0.5, 0.5)], t0);
    g.update([pinchEnd("Right", 0.5, 0.5)], t0 + 50);
    const second = g.update(
      [pose("Right", "pointing"), pinchStart("Right", 0.5, 0.5)], t0 + 200);
    assert.ok(second.find((e) => e.type === "dive"), "second pinch dives");
    g.update([pinchEnd("Right", 0.5, 0.5)], t0 + 250);
    const third = g.update(
      [pose("Right", "pointing"), pinchStart("Right", 0.5, 0.5)], t0 + 300);
    assert.equal(third.find((e) => e.type === "dive"), undefined,
      "third pinch must not chain another dive");
  });
});
// ---------------------------------------------------------------------------
// 4. release-all timing
// ---------------------------------------------------------------------------
describe("release-all", () => {
  it("emits release-all after open-palm held for OPEN_PALM_HOLD_MS", () => {
    const g = createHandGestures();
    const t0 = 8000;
    g.update([pose("Left", "open-palm", 0.5, 0.5)], t0);
    // still holding, but not yet long enough
    let events = g.update([], t0 + OPEN_PALM_HOLD_MS - 1);
    assert.equal(
      events.find((e) => e.type === "release-all"),
      undefined
    );
    // exactly at threshold
    events = g.update([], t0 + OPEN_PALM_HOLD_MS);
    const rel = events.find((e) => e.type === "release-all");
    assert.ok(rel, "expected release-all");
  });
  it("does not emit again while the same open-palm continues", () => {
    const g = createHandGestures();
    const t0 = 9000;
    g.update([pose("Right", "open-palm")], t0);
    g.update([], t0 + OPEN_PALM_HOLD_MS); // first emission
    const later = g.update([], t0 + OPEN_PALM_HOLD_MS + 200);
    assert.equal(
      later.find((e) => e.type === "release-all"),
      undefined,
      "must not duplicate release-all"
    );
  });
  it("is cancelled by a pinch", () => {
    const g = createHandGestures();
    const t0 = 10000;
    g.update([pose("Left", "open-palm")], t0);
    g.update([pinchStart("Left", 0.5, 0.5)], t0 + 100);
    const events = g.update([], t0 + OPEN_PALM_HOLD_MS + 50);
    assert.equal(
      events.find((e) => e.type === "release-all"),
      undefined
    );
  });
});
// ---------------------------------------------------------------------------
// Extra robustness: select & no-duplicate
// ---------------------------------------------------------------------------
describe("select", () => {
  it("emits select on a quick stationary pinch while pointing", () => {
    const g = createHandGestures();
    const t0 = 11000;
    g.update([pose("Right", "pointing")], t0);
    g.update([pinchStart("Right", 0.4, 0.6)], t0 + 10);
    const endEvents = g.update(
      [pinchEnd("Right", 0.4, 0.6)],
      t0 + 80
    );
    const sel = endEvents.find((e) => e.type === "select");
    assert.ok(sel);
    assert.equal(sel.x, 0.4);
    assert.equal(sel.y, 0.6);
  });
  it("suppresses select when the pinch moved", () => {
    const g = createHandGestures();
    const t0 = 12000;
    g.update([pose("Left", "pointing")], t0);
    g.update([pinchStart("Left", 0.3, 0.3)], t0 + 5);
    g.update([pinchMove("Left", 0.45, 0.3)], t0 + 40); // moved
    const endEvents = g.update([pinchEnd("Left", 0.45, 0.3)], t0 + 90);
    assert.equal(
      endEvents.find((e) => e.type === "select"),
      undefined
    );
  });
});
