import test from "node:test";
import assert from "node:assert/strict";

import {
  createHandLens,
  PINCH_ENTER_THRESHOLD,
  PINCH_EXIT_THRESHOLD,
  POSE_DEBOUNCE_MS,
  SMOOTHING_ALPHA,
} from "../src/domains/hand-lens.js";

// ---------------------------------------------------------------------------
// Synthetic landmark helpers
// ---------------------------------------------------------------------------

function point(x, y, z = 0) {
  return { x, y, z };
}

/**
 * Build 21 landmarks from a compact hand description.
 *
 * The synthetic hand uses a deliberately simple 2D geometry. It is not
 * intended to represent every anatomical detail; it gives the detector
 * deterministic landmarks with the geometric relationships it actually uses.
 */
function makeHand({
  handedness = "Right",
  wrist = point(0.50, 0.80),
  fingers = {},
  thumb = point(0.38, 0.50),
} = {}) {
  const landmarks = Array.from({ length: 21 }, () =>
    point(wrist.x, wrist.y, wrist.z),
  );

  landmarks[0] = wrist;

  // Thumb.
  landmarks[1] = point(0.43, 0.70);
  landmarks[2] = point(0.40, 0.62);
  landmarks[3] = point(0.39, 0.55);
  landmarks[4] = thumb;

  /**
   * Finger geometry.
   *
   * MCP is located progressively across the palm.
   * Tip is supplied by the caller.
   */
  const defaults = {
    index: {
      mcp: point(0.46, 0.62),
      tip: point(0.46, 0.25),
    },
    middle: {
      mcp: point(0.50, 0.58),
      tip: point(0.50, 0.18),
    },
    ring: {
      mcp: point(0.54, 0.62),
      tip: point(0.54, 0.25),
    },
    pinky: {
      mcp: point(0.58, 0.66),
      tip: point(0.58, 0.30),
    },
  };

  const fingerIndices = {
    index: [5, 6, 7, 8],
    middle: [9, 10, 11, 12],
    ring: [13, 14, 15, 16],
    pinky: [17, 18, 19, 20],
  };

  for (const [name, indices] of Object.entries(fingerIndices)) {
    const geometry = {
      ...defaults[name],
      ...(fingers[name] ?? {}),
    };

    const [mcp, pip, dip, tip] = indices;

    landmarks[mcp] = geometry.mcp;

    // Intermediate joints are simple interpolations. The classifier only
    // uses MCP and tip, but realistic intermediate points make the fixture
    // easier to inspect/debug.
    landmarks[pip] = point(
      (geometry.mcp.x + geometry.tip.x) / 2,
      (geometry.mcp.y + geometry.tip.y) / 2,
    );

    landmarks[dip] = point(
      geometry.mcp.x * 0.25 + geometry.tip.x * 0.75,
      geometry.mcp.y * 0.25 + geometry.tip.y * 0.75,
    );

    landmarks[tip] = geometry.tip;
  }

  return {
    handedness,
    landmarks,
  };
}

// ---------------------------------------------------------------------------
// Fixture constructors
// ---------------------------------------------------------------------------

function makeOpenPalm(overrides = {}) {
  return makeHand({
    ...overrides,
    fingers: {
      index: {
        mcp: point(0.46, 0.62),
        tip: point(0.46, 0.15),
      },
      middle: {
        mcp: point(0.50, 0.58),
        tip: point(0.50, 0.10),
      },
      ring: {
        mcp: point(0.54, 0.62),
        tip: point(0.54, 0.15),
      },
      pinky: {
        mcp: point(0.58, 0.66),
        tip: point(0.58, 0.20),
      },
    },
  });
}

function makeFist(overrides = {}) {
  return makeHand({
    ...overrides,
    fingers: {
      index: {
        mcp: point(0.46, 0.62),
        tip: point(0.47, 0.57),
      },
      middle: {
        mcp: point(0.50, 0.58),
        tip: point(0.50, 0.54),
      },
      ring: {
        mcp: point(0.54, 0.62),
        tip: point(0.53, 0.58),
      },
      pinky: {
        mcp: point(0.58, 0.66),
        tip: point(0.57, 0.62),
      },
    },
  });
}

function makePointing(overrides = {}) {
  return makeHand({
    ...overrides,
    fingers: {
      index: {
        mcp: point(0.46, 0.62),
        tip: point(0.46, 0.12),
      },
      middle: {
        mcp: point(0.50, 0.58),
        tip: point(0.50, 0.54),
      },
      ring: {
        mcp: point(0.54, 0.62),
        tip: point(0.53, 0.58),
      },
      pinky: {
        mcp: point(0.58, 0.66),
        tip: point(0.57, 0.62),
      },
    },
  });
}

/**
 * Make a pinch hand.
 *
 * The hand size used by the detector is wrist -> middle MCP.
 * Here that distance is approximately:
 *
 *   sqrt((0.5 - 0.5)^2 + (0.58 - 0.80)^2) = 0.22
 *
 * The thumb/index distance can therefore be controlled directly.
 */
function makePinch(distance, overrides = {}) {
  // Overrides win: callers may relocate the whole hand (wrist/thumb).
  const wrist = overrides.wrist ?? point(0.50, 0.80);
  const thumb = overrides.thumb ?? point(0.46 - distance / 2, 0.42);
  const { wrist: _wristOverride, thumb: _thumbOverride, ...rest } = overrides;
  const middleMcp = point(0.50, 0.58);

  const center = point(0.46, 0.42);

  return makeHand({
    ...rest,
    wrist,
    thumb,
    fingers: {
      index: {
        mcp: point(0.46, 0.62),
        tip: point(center.x + distance / 2, center.y),
      },
      middle: {
        mcp: middleMcp,
        tip: point(0.50, 0.18),
      },
      ring: {
        mcp: point(0.54, 0.62),
        tip: point(0.54, 0.20),
      },
      pinky: {
        mcp: point(0.58, 0.66),
        tip: point(0.58, 0.25),
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function eventsOfType(events, type) {
  return events.filter((event) => event.type === type);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("createHandLens returns an isolated update API", () => {
  const lens = createHandLens();

  assert.equal(typeof lens.update, "function");
  assert.deepEqual(lens.update([], 0), []);
});

test("synthetic open palm is classified as open-palm after debounce", () => {
  const lens = createHandLens();
  const hand = makeOpenPalm();

  assert.deepEqual(lens.update([hand], 0), []);

  // Candidate starts here.
  assert.deepEqual(lens.update([hand], 60), []);

  const events = lens.update([hand], POSE_DEBOUNCE_MS + 1);

  const poses = eventsOfType(events, "posechange");

  assert.equal(poses.length, 1);
  assert.equal(poses[0].pose, "open-palm");
  assert.equal(poses[0].previousPose, "unknown");
  assert.equal(poses[0].hand, "Right");
});

test("synthetic fist is classified as fist", () => {
  const lens = createHandLens();
  const fist = makeFist();

  lens.update([fist], 0);
  lens.update([fist], 50);

  const events = lens.update([fist], POSE_DEBOUNCE_MS + 1);

  const pose = events.find((event) => event.type === "posechange");

  assert.ok(pose);
  assert.equal(pose.pose, "fist");
});

test("synthetic pointing hand is classified as pointing", () => {
  const lens = createHandLens();
  const pointing = makePointing();

  lens.update([pointing], 0);
  lens.update([pointing], 50);

  const events = lens.update([pointing], POSE_DEBOUNCE_MS + 1);

  const pose = events.find((event) => event.type === "posechange");

  assert.ok(pose);
  assert.equal(pose.pose, "pointing");
});

test("pinch starts below enter threshold", () => {
  const lens = createHandLens();

  // Hand size ~= 0.22.
  // Use a ratio substantially below the enter threshold.
  const distance = 0.22 * (PINCH_ENTER_THRESHOLD * 0.75);

  const events = lens.update(
    [makePinch(distance)],
    0,
  );

  const starts = eventsOfType(events, "pinchstart");

  assert.equal(starts.length, 1);
  assert.equal(starts[0].hand, "Right");
  assert.equal(starts[0].type, "pinchstart");
});

test("pinch hysteresis does not flicker between enter and exit thresholds", () => {
  const lens = createHandLens();

  const handSize = 0.22;

  const belowEnter =
    handSize * (PINCH_ENTER_THRESHOLD * 0.80);

  const betweenThresholds =
    handSize * (
      (PINCH_ENTER_THRESHOLD + PINCH_EXIT_THRESHOLD) / 2
    );

  const aboveExit =
    handSize * (PINCH_EXIT_THRESHOLD * 1.15);

  let events = lens.update(
    [makePinch(belowEnter)],
    0,
  );

  assert.equal(
    eventsOfType(events, "pinchstart").length,
    1,
  );

  // Still inside the hysteresis band.
  events = lens.update(
    [makePinch(betweenThresholds)],
    20,
  );

  assert.equal(
    eventsOfType(events, "pinchend").length,
    0,
    "pinch must remain active between enter and exit thresholds",
  );

  assert.equal(
    eventsOfType(events, "pinchmove").length,
    1,
  );

  // Move back toward the enter threshold without crossing exit.
  events = lens.update(
    [makePinch(belowEnter * 1.05)],
    40,
  );

  assert.equal(
    eventsOfType(events, "pinchend").length,
    0,
  );

  // Only crossing the larger exit threshold ends the pinch. The smoothed
  // ratio needs a couple of frames to converge past the exit line, so feed
  // the open frame until the pinchend arrives.
  let endAt = -1;
  for (let t = 60; t <= 300; t += 20) {
    events = lens.update(
      [makePinch(aboveExit)],
      t,
    );

    assert.equal(
      eventsOfType(events, "pinchstart").length,
      0,
      "no new pinch may start while the fingers are apart",
    );

    if (eventsOfType(events, "pinchend").length === 1) {
      endAt = t;
      break;
    }
  }

  assert.ok(
    endAt !== -1,
    "pinch must end once the smoothed ratio crosses the exit threshold",
  );
});

test("pinch emits move events while held", () => {
  const lens = createHandLens();
  const handSize = 0.22;

  const tightPinch =
    handSize * (PINCH_ENTER_THRESHOLD * 0.75);

  const events0 = lens.update(
    [makePinch(tightPinch)],
    0,
  );

  assert.equal(
    eventsOfType(events0, "pinchstart").length,
    1,
  );

  const events1 = lens.update(
    [makePinch(tightPinch * 0.9)],
    20,
  );

  const moves = eventsOfType(events1, "pinchmove");

  assert.equal(moves.length, 1);
  assert.equal(moves[0].hand, "Right");
  assert.ok(Number.isFinite(moves[0].x));
  assert.ok(Number.isFinite(moves[0].y));
});

test("pinch ends when the hand disappears", () => {
  const lens = createHandLens();

  const handSize = 0.22;
  const tightPinch =
    handSize * (PINCH_ENTER_THRESHOLD * 0.75);

  const startEvents = lens.update(
    [makePinch(tightPinch)],
    0,
  );

  assert.equal(
    eventsOfType(startEvents, "pinchstart").length,
    1,
  );

  const endEvents = lens.update([], 16);

  const ends = eventsOfType(endEvents, "pinchend");

  assert.equal(ends.length, 1);
  assert.equal(ends[0].hand, "Right");
});

test("smoothing reduces fingertip jitter", () => {
  const lens = createHandLens();
  const handSize = 0.22;
  const tightPinch = handSize * (PINCH_ENTER_THRESHOLD * 0.70);

  // Establish an active pinch; the pinch midpoint is reported from the
  // smoothed landmarks, so it is the observable smoothing probe.
  const startEvents = lens.update([makePinch(tightPinch)], 0);
  assert.equal(eventsOfType(startEvents, "pinchstart").length, 1);
  const baselineX = startEvents.find((e) => e.type === "pinchstart").x;

  // Jitter the index tip +0.10 in x for a single frame. The raw jump is
  // 0.10 on one of the two midpoint landmarks; smoothing (alpha 0.35)
  // must attenuate it well below the raw jump while still following it.
  const jittered = makePinch(tightPinch);
  jittered.landmarks[8] = point(
    jittered.landmarks[8].x + 0.10,
    jittered.landmarks[8].y,
    jittered.landmarks[8].z,
  );

  const events = lens.update([jittered], 16);
  const moves = eventsOfType(events, "pinchmove");
  assert.equal(moves.length, 1, "pinch must stay active through the jitter");

  const observed = Math.abs(moves[0].x - baselineX);
  assert.ok(
    observed < 0.05,
    `expected the 0.10 raw jitter to be attenuated, observed ${observed}`,
  );
  assert.ok(
    observed > 0,
    "the smoothed position must still follow the hand",
  );
});

test("smoothing resets when a hand disappears and reappears", () => {
  const lens = createHandLens();

  const first = makePinch(
    0.22 * (PINCH_ENTER_THRESHOLD * 0.70),
  );

  lens.update([first], 0);

  // Disappearance resets the hand's gesture state.
  const disappearance = lens.update([], 16);

  assert.equal(
    eventsOfType(disappearance, "pinchend").length,
    1,
  );

  // Reappearance far away should begin from its own raw coordinates rather
  // than blending with the old location.
  const reappeared = makePinch(
    0.22 * (PINCH_ENTER_THRESHOLD * 0.70),
    {
      wrist: point(0.90, 0.80),
      thumb: point(0.86, 0.42),
    },
  );

  reappeared.landmarks[8] = point(0.88, 0.42);

  const events = lens.update([reappeared], 32);

  const start = events.find(
    (event) => event.type === "pinchstart",
  );

  assert.ok(start);

  // Reappearing coordinates are accepted directly. There must not be a
  // halfway blend with the previous hand location around x ~= 0.46.
  assert.ok(start.x > 0.80);
});

test("air tap fires once for one downward-and-rebound gesture", () => {
  const lens = createHandLens();

  const base = makePointing();

  // Initial frame.
  lens.update([base], 0);

  // Move index downward quickly.
  const down = makePointing();
  down.landmarks[8] = point(0.46, 0.40);

  let events = lens.update([down], 50);

  assert.equal(
    eventsOfType(events, "tap").length,
    0,
    "downward phase alone must not fire tap",
  );

  // Rebound upward quickly.
  const rebound = makePointing();
  rebound.landmarks[8] = point(0.46, 0.20);

  events = lens.update([rebound], 100);

  const taps = eventsOfType(events, "tap");

  assert.equal(taps.length, 1);
  assert.equal(taps[0].hand, "Right");
  assert.equal(taps[0].finger, "index");

  // Another upward/downward frame should not generate a second tap during
  // the cooldown.
  const extra = makePointing();
  extra.landmarks[8] = point(0.46, 0.15);

  events = lens.update([extra], 120);

  assert.equal(
    eventsOfType(events, "tap").length,
    0,
    "one physical tap must emit exactly one event",
  );
});

test("air tap supports the middle finger", () => {
  const lens = createHandLens();

  const base = makePointing();

  // The pointing fixture has a stable middle finger. Move it explicitly.
  // MediaPipe y grows downward, so a tap drives y up first, then back.
  lens.update([base], 0);

  const down = makePointing();
  down.landmarks[12] = point(0.50, 0.75);

  lens.update([down], 50);

  const rebound = makePointing();
  rebound.landmarks[12] = point(0.50, 0.45);

  const events = lens.update([rebound], 100);

  const taps = eventsOfType(events, "tap");

  assert.equal(taps.length, 1);
  assert.equal(taps[0].finger, "middle");
});

test("air tap does not fire if rebound happens after the allowed window", () => {
  const lens = createHandLens();

  const base = makePointing();
  lens.update([base], 0);

  const down = makePointing();
  down.landmarks[8] = point(0.46, 0.40);

  lens.update([down], 50);

  const late = makePointing();
  late.landmarks[8] = point(0.46, 0.20);

  const events = lens.update([late], 50 + 220 + 1);

  assert.equal(
    eventsOfType(events, "tap").length,
    0,
  );
});

test("pose changes are debounced and do not flicker", () => {
  const lens = createHandLens();

  const open = makeOpenPalm();
  const fist = makeFist();

  // Establish open palm.
  lens.update([open], 0);

  let events = lens.update([open], POSE_DEBOUNCE_MS + 1);

  assert.equal(
    eventsOfType(events, "posechange").length,
    1,
  );

  assert.equal(
    eventsOfType(events, "posechange")[0].pose,
    "open-palm",
  );

  // Brief fist candidate.
  events = lens.update([fist], POSE_DEBOUNCE_MS + 20);

  assert.equal(
    eventsOfType(events, "posechange").length,
    0,
  );

  // Return to open palm before 120 ms has elapsed.
  events = lens.update([open], POSE_DEBOUNCE_MS + 70);

  assert.equal(
    eventsOfType(events, "posechange").length,
    0,
  );

  // Remains open; no false fist event should have escaped.
  events = lens.update([open], POSE_DEBOUNCE_MS + 200);

  const poseChanges = eventsOfType(events, "posechange");

  assert.equal(
    poseChanges.length,
    0,
    "returning to the stable pose before debounce must cancel the candidate",
  );
});

test("pose change fires only after the full debounce interval", () => {
  const lens = createHandLens();

  const open = makeOpenPalm();
  const fist = makeFist();

  // Establish open.
  lens.update([open], 0);
  lens.update([open], POSE_DEBOUNCE_MS + 1);

  // Feed fist frames so the smoothed classifier converges on the new pose.
  // The fist candidate cannot start before the first fist frame, so no
  // posechange may fire within the first POSE_DEBOUNCE_MS of fist frames.
  const startT = POSE_DEBOUNCE_MS + 10;
  let fired = null;
  for (let t = startT; t <= startT + 900; t += 10) {
    const events = lens.update([fist], t);
    const poses = eventsOfType(events, "posechange");
    if (poses.length > 0 && t - startT < POSE_DEBOUNCE_MS) {
      assert.fail(
        `posechange fired ${t - startT}ms after the first fist frame, before the debounce interval`,
      );
    }
    if (poses.length > 0) {
      fired = poses;
      break;
    }
  }

  assert.ok(
    fired,
    "fist posechange must fire once the smoothed pose stabilizes",
  );
  assert.equal(fired.length, 1);
  assert.equal(fired[0].pose, "fist");
  assert.equal(fired[0].previousPose, "open-palm");
});

test("zero, one, and two hands are handled independently", () => {
  const lens = createHandLens();

  const left = makeOpenPalm({
    handedness: "Left",
    wrist: point(0.25, 0.80),
  });

  const right = makeOpenPalm({
    handedness: "Right",
    wrist: point(0.75, 0.80),
  });

  assert.deepEqual(lens.update([], 0), []);

  lens.update([left], 10);

  const twoHandEvents = lens.update(
    [right, left],
    20,
  );

  // No crash and both hands can continue independently.
  assert.ok(Array.isArray(twoHandEvents));

  const later = lens.update(
    [left, right],
    POSE_DEBOUNCE_MS + 30,
  );

  const poseEvents = eventsOfType(
    later,
    "posechange",
  );

  assert.equal(poseEvents.length, 2);

  const hands = new Set(
    poseEvents.map((event) => event.hand),
  );

  assert.deepEqual(
    hands,
    new Set(["Left", "Right"]),
  );
});

test("hand result ordering does not break Left/Right state", () => {
  const lens = createHandLens();

  const left = makeOpenPalm({
    handedness: "Left",
    wrist: point(0.25, 0.80),
  });

  const right = makeFist({
    handedness: "Right",
    wrist: point(0.75, 0.80),
  });

  lens.update([left, right], 0);

  const events = lens.update(
    [right, left],
    POSE_DEBOUNCE_MS + 1,
  );

  const poses = eventsOfType(events, "posechange");

  assert.equal(poses.length, 2);

  const leftPose = poses.find(
    (event) => event.hand === "Left",
  );

  const rightPose = poses.find(
    (event) => event.hand === "Right",
  );

  assert.equal(leftPose.pose, "open-palm");
  assert.equal(rightPose.pose, "fist");
});

test("reappearing hand starts fresh instead of inheriting pinch state", () => {
  const lens = createHandLens();

  const pinch = makePinch(
    0.22 * (PINCH_ENTER_THRESHOLD * 0.70),
  );

  const start = lens.update([pinch], 0);

  assert.equal(
    eventsOfType(start, "pinchstart").length,
    1,
  );

  // Remove hand.
  lens.update([], 20);

  // Reappear as a non-pinching hand.
  const open = makeOpenPalm();

  const events = lens.update([open], 40);

  assert.equal(
    eventsOfType(events, "pinchstart").length,
    0,
    "reappearing hand must not inherit the old pinch state",
  );

  assert.equal(
    eventsOfType(events, "pinchmove").length,
    0,
  );
});

test("invalid hand records are ignored without breaking valid hands", () => {
  const lens = createHandLens();

  const valid = makeOpenPalm();

  const events = lens.update(
    [
      null,
      {},
      {
        handedness: "Right",
        landmarks: [],
      },
      valid,
    ],
    0,
  );

  assert.deepEqual(events, []);

  const later = lens.update(
    [valid],
    POSE_DEBOUNCE_MS + 1,
  );

  assert.equal(
    eventsOfType(later, "posechange").length,
    1,
  );
});

test("separate createHandLens instances do not share gesture state", () => {
  const first = createHandLens();
  const second = createHandLens();

  const handSize = 0.22;
  const pinchDistance =
    handSize * (PINCH_ENTER_THRESHOLD * 0.70);

  const pinch = makePinch(pinchDistance);

  const firstEvents = first.update([pinch], 0);
  const secondEvents = second.update([], 0);

  assert.equal(
    eventsOfType(firstEvents, "pinchstart").length,
    1,
  );

  assert.deepEqual(secondEvents, []);

  // Second instance has no knowledge of first instance's pinch.
  const secondLater = second.update([makeOpenPalm()], 20);

  assert.equal(
    eventsOfType(secondLater, "pinchstart").length,
    0,
  );
});
