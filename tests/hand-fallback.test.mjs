/**
 * tests/hand-fallback.test.mjs
 *
 * No-camera fallback: the hand manipulation path (lens -> gestures -> grab)
 * must work with zero camera modules present.
 *
 * Run with: node --test tests/hand-fallback.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createHandLens, POSE_DEBOUNCE_MS } from "../src/domains/hand-lens.js";
import {
  createHandGestures,
  OPEN_PALM_HOLD_MS,
} from "../src/domains/hand-gestures.js";
import { createHandGrab } from "../src/render/hand-grab.js";

// ---------------------------------------------------------------------------
// Minimal synthetic open palm (compact version of the hand-lens helper pattern)
// ---------------------------------------------------------------------------

function point(x, y, z = 0) {
  return { x, y, z };
}

function makeOpenPalm(handedness = "Right") {
  const wrist = point(0.5, 0.8);
  const landmarks = Array.from({ length: 21 }, () => point(wrist.x, wrist.y));
  landmarks[0] = wrist;
  const fingerTips = {
    8: point(0.46, 0.15),
    12: point(0.5, 0.1),
    16: point(0.54, 0.15),
    20: point(0.58, 0.2),
  };
  const fingerMcps = {
    5: point(0.46, 0.62),
    9: point(0.5, 0.58),
    13: point(0.54, 0.62),
    17: point(0.58, 0.66),
  };
  for (const [i, p] of Object.entries(fingerTips)) landmarks[i] = p;
  for (const [i, p] of Object.entries(fingerMcps)) landmarks[i] = p;
  landmarks[4] = point(0.38, 0.5); // thumb tip
  return { handedness, landmarks };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("swipe intent reaches noteGestureIntent with no camera modules", () => {
  const intents = [];
  const grab = createHandGrab({
    noteGestureIntent: (event) => intents.push(event),
  });

  grab.handleGestureEvents([
    { type: "swipe", direction: "left", hand: "Right", x: 0.5, y: 0.5 },
  ]);

  assert.equal(intents.length, 1, "swipe must become a traceable intent");
  assert.equal(intents[0].gesture, "swipe");
  assert.equal(intents[0].detail.action, "swipe");
  assert.equal(intents[0].detail.direction, "left");
  assert.equal(intents[0].hand, "Right");
  assert.equal(intents[0].method, "hand-lens");
});

test("select falls back to registerFieldTap(null, input) when registerGestureFieldTap is absent", () => {
  const calls = [];
  // NOTE: only { noteGestureIntent, registerFieldTap } are provided here,
  // per the additive registerGestureFieldTap sibling change.
  const grab = createHandGrab({
    noteGestureIntent: () => {},
    registerFieldTap: (target, input) => calls.push([target, input]),
  });

  grab.handleGestureEvents([{ type: "select", hand: "Right", x: 0.5, y: 0.5 }]);

  assert.equal(calls.length, 1, "select must reach the field authority");
  assert.equal(calls[0][0], null, "fallback target must be null");
  assert.equal(calls[0][1].pointerType, "hand");
  assert.equal(calls[0][1].clientX, 0.5);
  assert.equal(calls[0][1].clientY, 0.5);
});

test("dive hint also falls back to registerFieldTap(null, input)", () => {
  const calls = [];
  const grab = createHandGrab({
    registerFieldTap: (target, input) => calls.push([target, input]),
  });

  grab.handleGestureEvents([{ type: "dive", hand: "Left", x: 0.25, y: 0.75 }]);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], null);
  assert.equal(calls[0][1].pointerType, "hand");
});

test("pure-domain pipeline: lens + gestures run on synthetic frames with no camera", () => {
  const lens = createHandLens();
  const gestures = createHandGestures();
  const hand = makeOpenPalm();

  const lensEvents = lens.update([hand], 0);
  assert.deepEqual(lensEvents, [], "first frame only arms the pose candidate");

  const lensEvents2 = lens.update([hand], POSE_DEBOUNCE_MS + 1);
  const poses = lensEvents2.filter((e) => e.type === "posechange");
  assert.equal(poses.length, 1, "synthetic open palm must classify");
  assert.equal(poses[0].pose, "open-palm");

  // Feed both frames through the gesture layer (it consumes posechange;
  // it only emits the coarser vocabulary).
  gestures.update(lensEvents, 0);
  gestures.update(lensEvents2, POSE_DEBOUNCE_MS + 1);

  // Hold the palm past the release-all threshold: the gesture layer must
  // complete the whole pipeline with zero camera involvement.
  const t = POSE_DEBOUNCE_MS + 1 + OPEN_PALM_HOLD_MS + 10;
  const later = gestures.update([], t);
  const release = later.filter((e) => e.type === "release-all");

  assert.equal(release.length, 1, "open-palm hold must yield release-all");
});

test("handleHandLensEvents needs no camera either (grab intent only)", () => {
  const intents = [];
  const grab = createHandGrab({
    noteGestureIntent: (event) => intents.push(event),
  });

  grab.handleHandLensEvents([
    { type: "pinchstart", hand: "Right", x: 0.4, y: 0.4 },
    { type: "pinchmove", hand: "Right", x: 0.45, y: 0.4 },
    { type: "pinchend", hand: "Right", x: 0.45, y: 0.4 },
  ]);

  assert.deepEqual(
    intents.map((i) => i.gesture),
    ["grab", "drag", "release"],
  );
  assert.ok(intents.every((i) => i.method === "hand-lens"));
});
