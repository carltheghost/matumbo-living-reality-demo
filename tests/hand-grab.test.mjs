/**
 * tests/hand-grab.test.mjs
 *
 * Adapter contract: Hand Lens events → block-world authorities.
 * Run with: node --test tests/hand-grab.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createHandGrab,
  DRAG_WORLD_UNITS,
  DEPTH_WORLD_UNITS,
  DIVE_SELECT_SUPPRESS_MS,
} from "../src/render/hand-grab.js";

function makeHarness({ withGestureTap = true } = {}) {
  let now = 0;
  const intents = [];
  const gestureTaps = [];
  const legacyTaps = [];
  const options = {
    noteGestureIntent: (event) => intents.push(event),
    registerFieldTap: (target, input) => legacyTaps.push({ target, input }),
    getViewport: () => ({ w: 1000, h: 800 }),
    nowMs: () => now,
  };
  if (withGestureTap) {
    options.registerGestureFieldTap = (pose, input) =>
      gestureTaps.push({ pose, input });
  }
  const grab = createHandGrab(options);
  return {
    grab,
    intents,
    gestureTaps,
    legacyTaps,
    setNow: (t) => {
      now = t;
    },
  };
}

describe("low-level pinch routing", () => {
  it("pinchstart → grab intent via noteGestureIntent", () => {
    const h = makeHarness();
    h.grab.handleHandLensEvents([
      { type: "pinchstart", hand: "Left", x: 0.5, y: 0.5 },
    ]);
    assert.equal(h.intents.length, 1);
    assert.equal(h.intents[0].gesture, "grab");
    assert.equal(h.intents[0].detail.action, "grab");
    assert.equal(h.intents[0].method, "hand-lens");
    assert.equal(h.intents[0].hand, "Left");
    assert.deepEqual(h.intents[0].pose, { x: 0.5, y: 0.5 });
  });

  it("pinchmove diffs absolute positions into drag deltas (dx*DRAG_WORLD_UNITS) and depthDelta→dz", () => {
    const h = makeHarness();
    h.grab.handleHandLensEvents([
      { type: "pinchstart", hand: "Right", x: 0.5, y: 0.5 },
      { type: "pinchmove", hand: "Right", x: 0.6, y: 0.55, depthDelta: 0.07 },
    ]);
    const drag = h.intents.find((e) => e.gesture === "drag");
    assert.ok(drag, "expected a drag intent");
    assert.ok(Math.abs(drag.detail.dx - 0.1 * DRAG_WORLD_UNITS) < 1e-9);
    assert.ok(Math.abs(drag.detail.dy - 0.05 * DRAG_WORLD_UNITS) < 1e-9);
    assert.ok(Math.abs(drag.detail.dz - 0.07 * DEPTH_WORLD_UNITS) < 1e-9);
    assert.ok(drag.detail.dz > 0, "growing hand → positive dz");
    // A second identical frame diffs to zero motion.
    h.grab.handleHandLensEvents([
      { type: "pinchmove", hand: "Right", x: 0.6, y: 0.55, depthDelta: 0 },
    ]);
    const last = h.intents[h.intents.length - 1];
    assert.equal(last.detail.dx, 0);
    assert.equal(last.detail.dy, 0);
    assert.equal(last.detail.dz, 0);
  });

  it("pinchend → release intent", () => {
    const h = makeHarness();
    h.grab.handleHandLensEvents([
      { type: "pinchstart", hand: "Left", x: 0.5, y: 0.5 },
      { type: "pinchend", hand: "Left", x: 0.5, y: 0.5 },
    ]);
    const release = h.intents.find((e) => e.gesture === "release");
    assert.ok(release, "expected a release intent");
    assert.equal(release.detail.action, "release");
  });
});

describe("two-hand gesture routing", () => {
  it("scale: cumulative factor → incremental factor", () => {
    const h = makeHarness();
    h.grab.handleGestureEvents([{ type: "scale", factor: 2 }]);
    h.grab.handleGestureEvents([{ type: "scale", factor: 4 }]);
    const scales = h.intents.filter((e) => e.gesture === "scale");
    assert.equal(scales.length, 2);
    assert.equal(scales[0].detail.factor, 1); // first frame: no baseline
    assert.ok(Math.abs(scales[1].detail.factor - 2) < 1e-9); // 4 / 2
  });

  it("rotate: cumulative radians → delta degrees", () => {
    const h = makeHarness();
    h.grab.handleGestureEvents([{ type: "rotate", radians: Math.PI / 2 }]);
    h.grab.handleGestureEvents([{ type: "rotate", radians: Math.PI }]);
    const rotates = h.intents.filter((e) => e.gesture === "rotate");
    assert.equal(rotates.length, 2);
    assert.equal(rotates[0].detail.degrees, 0); // first frame: no baseline
    assert.ok(Math.abs(rotates[1].detail.degrees - 90) < 1e-9);
  });

  it("release-all → release intent with reason", () => {
    const h = makeHarness();
    h.grab.handleGestureEvents([{ type: "release-all", hand: "Left" }]);
    assert.equal(h.intents.length, 1);
    assert.equal(h.intents[0].gesture, "release");
    assert.equal(h.intents[0].detail.reason, "release-all");
  });

  it("swipe → unmapped intent (no invented handoff authority)", () => {
    const h = makeHarness();
    h.grab.handleGestureEvents([
      { type: "swipe", direction: "right", hand: "Left", x: 0.5, y: 0.5 },
    ]);
    assert.equal(h.intents.length, 1);
    assert.equal(h.intents[0].gesture, "swipe");
    assert.equal(h.intents[0].detail.action, "swipe");
    assert.equal(h.intents[0].detail.direction, "right");
  });
});

describe("dive / select field routing", () => {
  it("dive → registerGestureFieldTap called with a POSE (never null target, never a fabricated blockId)", () => {
    const h = makeHarness();
    h.grab.handleGestureEvents([
      { type: "dive", hand: "Left", x: 0.7, y: 0.5 },
    ]);
    assert.equal(h.gestureTaps.length, 1);
    // The pose is the normalized gesture position — the field authority
    // raycasts the actual cube itself; hand code invents no blockId.
    assert.deepEqual(h.gestureTaps[0].pose, { x: 0.7, y: 0.5 });
    assert.equal(h.gestureTaps[0].input.pointerType, "hand");
    assert.equal(h.legacyTaps.length, 0);
  });

  it("select after a dive (same hand, within window) is suppressed", () => {
    const h = makeHarness();
    h.setNow(0);
    h.grab.handleGestureEvents([
      { type: "dive", hand: "Left", x: 0.5, y: 0.5 },
    ]);
    assert.equal(h.gestureTaps.length, 1);
    h.setNow(DIVE_SELECT_SUPPRESS_MS - 1);
    h.grab.handleGestureEvents([
      { type: "select", hand: "Left", x: 0.5, y: 0.5 },
    ]);
    assert.equal(
      h.gestureTaps.length,
      1,
      "trailing select of the diving hand is suppressed",
    );
  });

  it("select for the other hand passes through", () => {
    const h = makeHarness();
    h.setNow(0);
    h.grab.handleGestureEvents([
      { type: "dive", hand: "Left", x: 0.5, y: 0.5 },
    ]);
    h.setNow(DIVE_SELECT_SUPPRESS_MS - 1);
    h.grab.handleGestureEvents([
      { type: "select", hand: "Right", x: 0.2, y: 0.2 },
    ]);
    assert.equal(h.gestureTaps.length, 2);
    assert.deepEqual(h.gestureTaps[1].pose, { x: 0.2, y: 0.2 });
  });

  it("plain select → registerGestureFieldTap with the gesture pose", () => {
    const h = makeHarness();
    h.grab.handleGestureEvents([
      { type: "select", hand: "Right", x: 0.25, y: 0.75 },
    ]);
    assert.equal(h.gestureTaps.length, 1);
    assert.deepEqual(h.gestureTaps[0].pose, { x: 0.25, y: 0.75 });
  });

  it("falls back to registerFieldTap(null, ...) when registerGestureFieldTap is not provided", () => {
    const h = makeHarness({ withGestureTap: false });
    h.setNow(0);
    h.grab.handleGestureEvents([
      { type: "dive", hand: "Left", x: 0.7, y: 0.5 },
    ]);
    // Move past the dive/select suppression window so the select is routed.
    h.setNow(DIVE_SELECT_SUPPRESS_MS + 1);
    h.grab.handleGestureEvents([
      { type: "select", hand: "Left", x: 0.7, y: 0.5 },
    ]);
    assert.equal(h.gestureTaps.length, 0);
    assert.equal(h.legacyTaps.length, 2);
    assert.equal(h.legacyTaps[0].target, null);
    assert.equal(h.legacyTaps[0].input.pointerType, "hand");
  });
});
