/**
 * tests/hand-dive-timing.test.mjs
 *
 * Dive-timing contract between the semantic gesture layer and the field
 * authority.
 *
 * The hand semantic layer (src/domains/hand-gestures.js) emits `dive` when
 * two pointing pinches land within DOUBLE_PINCH_WINDOW_MS (400 ms).
 * hand-grab routes that hint to registerGestureFieldTap with the gesture
 * POSE — it never authorizes entry itself.
 *
 * IMPORTANT — why a 351–400 ms semantic dive is safe: the field authority
 * (registerFieldTap in src/render/block-world.js) applies its OWN double
 * window, CUBE_DIVE_DOUBLE_TAP_WINDOW_MS = 350 ms (src/domains/cube-dive.js),
 * inside resolveDiveBinding. A semantic dive hint that arrives 351–400 ms
 * after the first pinch therefore degrades to a plain re-select at the
 * field layer — never a false dive entry. Hand code only ever supplies a
 * hint; the field authority owns the final timing decision.
 *
 * Run with: node --test tests/hand-dive-timing.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createHandGestures,
  DOUBLE_PINCH_WINDOW_MS,
} from "../src/domains/hand-gestures.js";
import { createHandGrab } from "../src/render/hand-grab.js";
import { CUBE_DIVE_DOUBLE_TAP_WINDOW_MS } from "../src/domains/cube-dive.js";

describe("dive timing: semantic window vs field authority window", () => {
  it("documents the two windows", () => {
    assert.equal(DOUBLE_PINCH_WINDOW_MS, 400);
    assert.equal(CUBE_DIVE_DOUBLE_TAP_WINDOW_MS, 350);
    assert.ok(
      DOUBLE_PINCH_WINDOW_MS > CUBE_DIVE_DOUBLE_TAP_WINDOW_MS,
      "the semantic window is wider than the field authority window, " +
        "so late hints degrade to select instead of diving",
    );
  });

  it("two pointing pinches 375ms apart → gestures emit dive; handGrab routes it to registerGestureFieldTap with a pose", () => {
    let now = 0;
    const fieldTaps = [];
    const grab = createHandGrab({
      noteGestureIntent: () => {},
      registerGestureFieldTap: (pose, input) =>
        fieldTaps.push({ pose, input }),
      getViewport: () => ({ w: 1000, h: 800 }),
      nowMs: () => now,
    });
    const gestures = createHandGestures();

    function feed(events, t) {
      now = t;
      const out = gestures.update(events, t);
      grab.handleGestureEvents(out);
      return out;
    }

    const pointing = (x, y) => ({
      type: "posechange",
      hand: "Left",
      pose: "pointing",
      x,
      y,
    });

    feed([pointing(0.3, 0.5)], 0);
    const first = feed(
      [{ type: "pinchstart", hand: "Left", x: 0.3, y: 0.5 }],
      100,
    );
    assert.ok(
      !first.some((e) => e.type === "dive"),
      "first pinch alone is not a dive",
    );

    const afterFirstEnd = feed(
      [{ type: "pinchend", hand: "Left", x: 0.3, y: 0.5 }],
      150,
    );
    const firstSelect = afterFirstEnd.find((e) => e.type === "select");
    assert.ok(firstSelect, "quick pointing pinch still selects");
    assert.equal(
      firstSelect.hand,
      "Left",
      "select carries the hand (hand-lens.js addition)",
    );

    // Second pinch 375 ms after the first — inside the 400 ms semantic
    // window, outside the 350 ms field window. The gesture layer emits the
    // dive HINT; the field authority decides entry vs re-select.
    const second = feed(
      [{ type: "pinchstart", hand: "Left", x: 0.7, y: 0.5 }],
      475,
    );
    const dive = second.find((e) => e.type === "dive");
    assert.ok(dive, "expected a dive event at 375 ms");
    assert.equal(dive.hand, "Left");
    assert.equal(dive.x, 0.7);

    // handGrab routed: first the plain select, then the dive hint — both
    // through registerGestureFieldTap with the gesture pose, never null.
    assert.equal(fieldTaps.length, 2);
    assert.deepEqual(fieldTaps[1].pose, { x: 0.7, y: 0.5 });
    assert.equal(fieldTaps[1].input.pointerType, "hand");

    // The second pinch's trailing select is suppressed (same hand, within
    // the dive/select suppression window) — no duplicate field tap.
    feed([{ type: "pinchend", hand: "Left", x: 0.7, y: 0.5 }], 525);
    assert.equal(fieldTaps.length, 2);
  });
});
