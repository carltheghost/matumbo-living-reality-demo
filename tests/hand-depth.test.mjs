/**
 * tests/hand-depth.test.mjs
 *
 * Depth-from-apparent-hand-size: handDepthDelta math + handSize plumbing on
 * pinch events.
 * Run with: node --test tests/hand-depth.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHandLens, handDepthDelta } from "../src/domains/hand-lens.js";

describe("handDepthDelta", () => {
  it("growth → positive (hand appears larger = moved toward camera)", () => {
    assert.ok(handDepthDelta(0.1, 0.12) > 0);
    assert.ok(Math.abs(handDepthDelta(0.1, 0.12) - 0.2) < 1e-9);
  });

  it("shrink → negative", () => {
    assert.ok(handDepthDelta(0.12, 0.1) < 0);
    assert.ok(Math.abs(handDepthDelta(0.1, 0.09) + 0.1) < 1e-9);
  });

  it("no change → 0", () => {
    assert.equal(handDepthDelta(0.1, 0.1), 0);
  });

  it("clamps to [-1, 1]", () => {
    assert.equal(handDepthDelta(0.1, 10), 1);
    assert.equal(handDepthDelta(1.0, 0.0), -1);
    const big = handDepthDelta(0.001, 1);
    assert.ok(big <= 1 && big >= -1);
  });

  it("returns 0 for invalid or non-positive previous size", () => {
    assert.equal(handDepthDelta(0, 0.5), 0);
    assert.equal(handDepthDelta(-1, 0.5), 0);
    assert.equal(handDepthDelta(NaN, 0.5), 0);
    assert.equal(handDepthDelta(Infinity, 0.5), 0);
    assert.equal(handDepthDelta(undefined, 0.5), 0);
    assert.equal(handDepthDelta(null, 0.5), 0);
  });

  it("returns 0 for non-finite current size", () => {
    assert.equal(handDepthDelta(0.1, NaN), 0);
    assert.equal(handDepthDelta(0.1, Infinity), 0);
  });
});

function makeLandmarks(overrides = {}) {
  const points = [];
  for (let i = 0; i < 21; i++) points.push({ x: 0.5, y: 0.5, z: 0 });
  for (const [index, point] of Object.entries(overrides)) {
    points[Number(index)] = { x: point[0], y: point[1], z: point[2] ?? 0 };
  }
  return points;
}

// Pinching hand: thumb tip near index tip relative to hand size
// (wrist → middleMCP).
function pinchingHand(middleMcpX) {
  return {
    handedness: "Left",
    landmarks: makeLandmarks({
      0: [0.5, 0.5], // wrist
      4: [0.5, 0.4], // thumb tip
      8: [0.5, 0.41], // index tip
      9: [middleMcpX, 0.5], // middle MCP → handSize = |middleMcpX - 0.5|
    }),
  };
}

describe("handSize on pinch events", () => {
  it("pinchstart / pinchmove / pinchend carry a finite handSize", () => {
    const lens = createHandLens();
    const start = lens.update([pinchingHand(0.6)], 1000);
    const pinchstart = start.find((e) => e.type === "pinchstart");
    assert.ok(pinchstart, "expected a pinchstart event");
    assert.ok(Number.isFinite(pinchstart.handSize));
    assert.ok(Math.abs(pinchstart.handSize - 0.1) < 1e-9);

    const move = lens.update([pinchingHand(0.6)], 1050);
    const pinchmove = move.find((e) => e.type === "pinchmove");
    assert.ok(pinchmove, "expected a pinchmove event");
    assert.ok(Number.isFinite(pinchmove.handSize));

    // Release the pinch: thumb tip far from the index tip.
    const released = {
      handedness: "Left",
      landmarks: makeLandmarks({
        0: [0.5, 0.5],
        4: [0.1, 0.1],
        8: [0.5, 0.41],
        9: [0.6, 0.5],
      }),
    };
    const end = lens.update([released], 1100);
    const pinchend = end.find((e) => e.type === "pinchend");
    assert.ok(pinchend, "expected a pinchend event");
    assert.ok(Number.isFinite(pinchend.handSize));
  });
});
