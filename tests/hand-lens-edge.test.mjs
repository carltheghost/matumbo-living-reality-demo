/**
 * tests/hand-lens-edge.test.mjs
 *
 * Edge behaviour of src/domains/hand-lens.js:
 * zero hands, mid-pinch disappearance/reappearance, and handedness
 * normalization. Uses the same synthetic-landmark helper pattern as
 * tests/hand-lens.test.mjs.
 *
 * Run with: node --test tests/hand-lens-edge.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  createHandLens,
  PINCH_ENTER_THRESHOLD,
} from "../src/domains/hand-lens.js";

// ---------------------------------------------------------------------------
// Synthetic landmark helpers (copied pattern from hand-lens.test.mjs)
// ---------------------------------------------------------------------------

function point(x, y, z = 0) {
  return { x, y, z };
}

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

  landmarks[1] = point(0.43, 0.70);
  landmarks[2] = point(0.40, 0.62);
  landmarks[3] = point(0.39, 0.55);
  landmarks[4] = thumb;

  const defaults = {
    index: { mcp: point(0.46, 0.62), tip: point(0.46, 0.25) },
    middle: { mcp: point(0.50, 0.58), tip: point(0.50, 0.18) },
    ring: { mcp: point(0.54, 0.62), tip: point(0.54, 0.25) },
    pinky: { mcp: point(0.58, 0.66), tip: point(0.58, 0.30) },
  };

  const fingerIndices = {
    index: [5, 6, 7, 8],
    middle: [9, 10, 11, 12],
    ring: [13, 14, 15, 16],
    pinky: [17, 18, 19, 20],
  };

  for (const [name, indices] of Object.entries(fingerIndices)) {
    const geometry = { ...defaults[name], ...(fingers[name] ?? {}) };
    const [mcp, pip, dip, tip] = indices;

    landmarks[mcp] = geometry.mcp;
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

  return { handedness, landmarks };
}

/**
 * Make a pinch hand. Hand size (wrist -> middle MCP) is approximately 0.22,
 * so the thumb/index distance maps directly to the pinch ratio.
 */
function makePinch(distance, overrides = {}) {
  const wrist = overrides.wrist ?? point(0.50, 0.80);
  const thumb = overrides.thumb ?? point(0.46 - distance / 2, 0.42);
  const { wrist: _w, thumb: _t, ...rest } = overrides;
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
      middle: { mcp: middleMcp, tip: point(0.50, 0.18) },
      ring: { mcp: point(0.54, 0.62), tip: point(0.54, 0.20) },
      pinky: { mcp: point(0.58, 0.66), tip: point(0.58, 0.25) },
    },
  });
}

const TIGHT_PINCH = 0.22 * (PINCH_ENTER_THRESHOLD * 0.70);

function eventsOfType(events, type) {
  return events.filter((event) => event.type === type);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("update([]) emits no events and never throws", () => {
  const lens = createHandLens();

  assert.doesNotThrow(() => {
    assert.deepEqual(lens.update([], 0), []);
    assert.deepEqual(lens.update([], 1000), []);
  });
});

test("empty frames between active frames keep working", () => {
  const lens = createHandLens();

  // A hand pinches, disappears, and stays gone: exactly one pinchend.
  const start = lens.update([makePinch(TIGHT_PINCH)], 0);
  assert.equal(eventsOfType(start, "pinchstart").length, 1);

  const gone = lens.update([], 50);
  assert.deepEqual(
    gone.map((e) => e.type),
    ["pinchend"],
    "mid-pinch disappearance must emit exactly one pinchend",
  );

  // Staying gone must not repeat the pinchend.
  const stillGone = lens.update([], 100);
  assert.deepEqual(stillGone, []);
});

test("reappearing while pinching starts fresh (pinchstart, not pinchmove)", () => {
  const lens = createHandLens();

  const start = lens.update([makePinch(TIGHT_PINCH)], 0);
  assert.equal(eventsOfType(start, "pinchstart").length, 1);

  lens.update([], 50); // disappearance -> pinchend

  // Reappear already pinching: fresh state, so this is a new pinchstart.
  // A stale state would have produced pinchmove (or nothing).
  const back = lens.update([makePinch(TIGHT_PINCH)], 100);

  const pinchEvents = back.filter((e) => e.type.startsWith("pinch"));
  assert.equal(pinchEvents.length, 1, "exactly one pinch event on reappear");
  assert.equal(pinchEvents[0].type, "pinchstart");
  assert.equal(pinchEvents[0].hand, "Right");
  assert.equal(
    eventsOfType(back, "pinchmove").length,
    0,
    "no pinchmove may leak from the discarded state",
  );
});

test('handedness "left" (lowercase) is ignored', () => {
  const lens = createHandLens();

  const events = lens.update(
    [makePinch(TIGHT_PINCH, { handedness: "left" })],
    0,
  );

  assert.deepEqual(events, [], "lowercase handedness must not be tracked");
});

test('handedness "CENTER" is ignored', () => {
  const lens = createHandLens();

  const events = lens.update(
    [makePinch(TIGHT_PINCH, { handedness: "CENTER" })],
    0,
  );

  assert.deepEqual(events, [], "non Left/Right handedness must not be tracked");
});

test("valid Left and Right hands are tracked separately", () => {
  const lens = createHandLens();

  const events = lens.update(
    [
      makePinch(TIGHT_PINCH, { handedness: "Left" }),
      makePinch(TIGHT_PINCH, { handedness: "Right" }),
    ],
    0,
  );

  const starts = eventsOfType(events, "pinchstart");
  assert.equal(starts.length, 2, "both hands must start pinching independently");
  assert.deepEqual(
    new Set(starts.map((e) => e.hand)),
    new Set(["Left", "Right"]),
  );
});

test("an invalid hand never poisons a valid hand in the same frame", () => {
  const lens = createHandLens();

  const events = lens.update(
    [
      makePinch(TIGHT_PINCH, { handedness: "left" }),
      makePinch(TIGHT_PINCH, { handedness: "Right" }),
      { handedness: "Right", landmarks: [{ x: 0, y: 0 }] },
    ],
    0,
  );

  const starts = eventsOfType(events, "pinchstart");
  assert.equal(starts.length, 1);
  assert.equal(starts[0].hand, "Right");
});
