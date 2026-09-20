import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  createBlockWorldContribution,
  createBlockWorldGrabDraft,
  createBlockWorldHoldDraft,
  createBlockWorldPlaceDraft,
} from "../src/domains/block-world.js";
import {
  GAZE_HAND_ALLOWED_GESTURES,
  GAZE_HAND_CARRY_GESTURES,
  GAZE_HAND_COUPLING_BOUNDARY,
  establishGazeHandLock,
  resolveGazeHandAction,
} from "../src/render/gaze-hand-coupling.js";
import { createGestureInput } from "../src/render/gesture-input.js";

class FakeElement {
  constructor() {
    this.hidden = true;
    this.listeners = new Map();
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.classList = { toggle() {} };
    this.textContent = "";
    this.pointerCaptures = new Set();
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  toggleAttribute(name, force) {
    if (force) this.attributes.set(name, "");
    else this.attributes.delete(name);
  }
  focus() {}
  setPointerCapture(pointerId) { this.pointerCaptures.add(pointerId); }
  releasePointerCapture(pointerId) { this.pointerCaptures.delete(pointerId); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 80 }; }
}

function makeDocument() {
  const ids = [
    "gesture-input-panel",
    "gesture-input-open",
    "gesture-input-close",
    "gesture-input-toggle",
    "gesture-input-reset",
    "gesture-input-stop",
    "gesture-input-calibrate",
    "gesture-input-status",
    "gesture-input-capabilities",
    "gesture-input-mode",
    "gesture-input-calibration-status",
    "gesture-input-samples",
    "gesture-input-pad",
  ];
  const nodes = new Map(ids.map((id) => [id, new FakeElement()]));
  return {
    nodes,
    getElementById(id) { return nodes.get(id) ?? null; },
    createElement() { return new FakeElement(); },
    addEventListener() {},
  };
}

test("fresh gaze carry contract allows only explicit same-target actions", () => {
  assert.deepEqual(GAZE_HAND_CARRY_GESTURES, ["grab", "hold", "place", "release"]);
  assert.deepEqual(GAZE_HAND_ALLOWED_GESTURES.slice(-4), GAZE_HAND_CARRY_GESTURES);
  assert.match(GAZE_HAND_COUPLING_BOUNDARY, /same-target local held draft/i);
  assert.match(GAZE_HAND_COUPLING_BOUNDARY, /without inferring a destination/i);

  const lock = establishGazeHandLock({
    targetBlockId: "block:0:0:0",
    targetCoordinate: [0, 0, 0],
    normalized: { x: 0.1, y: -0.2 },
    now: 100,
  });
  for (const gesture of GAZE_HAND_CARRY_GESTURES) {
    const resolved = resolveGazeHandAction({ state: lock, gesture, now: 200 });
    assert.equal(resolved.allowed, true);
    assert.equal(resolved.targetBlockId, lock.targetBlockId);
    assert.equal(resolved.sameTargetRequired, true);
    assert.equal(resolved.reuseGazePoint, true);
  }
  const stale = resolveGazeHandAction({ state: lock, gesture: "place", now: lock.expiresAt });
  assert.equal(stale.allowed, false);
  assert.equal(stale.reason, "gaze-expired");
});

test("local block Grab -> Hold -> Place accepts one explicit step and rejects invalid drafts atomically", () => {
  const base = createBlockWorldContribution({
    width: 3,
    depth: 3,
    blocks: [{ x: 0, y: 0, z: 0, type: "stone" }],
  });
  const target = base.blocks[0];
  const grabbed = createBlockWorldGrabDraft(base, target.id);
  assert.equal(grabbed.holding, true);
  assert.equal(grabbed.heldBlock.id, target.id);
  const grabbedBeforeReject = JSON.stringify(grabbed);

  assert.throws(
    () => createBlockWorldHoldDraft(grabbed, { blockId: "block:99:0:99", delta: { dx: 1, dy: 0, dz: 0 } }),
    /currently held block/,
  );
  assert.equal(JSON.stringify(grabbed), grabbedBeforeReject);
  assert.throws(
    () => createBlockWorldHoldDraft(grabbed, { blockId: target.id, delta: { dx: 2, dy: 0, dz: 0 } }),
    /between -1 and 1/,
  );
  assert.equal(JSON.stringify(grabbed), grabbedBeforeReject);

  const held = createBlockWorldHoldDraft(grabbed, { blockId: target.id, delta: { dx: 1, dy: 0, dz: 0 } });
  assert.deepEqual(held.heldCoordinate, [1, 0, 0]);
  assert.deepEqual(held.lastEdit.delta, [1, 0, 0]);
  const placed = createBlockWorldPlaceDraft(held);
  assert.equal(placed.holding, false);
  assert.equal(placed.heldBlock, null);
  assert.ok(placed.blocks.some((block) => block.coordinate.join(",") === "1,0,0"));
  assert.equal(placed.releasedBlock.id, target.id);
});

test("native hand carry samples expose only bounded deltas and coarse names", async () => {
  const documentRoot = makeDocument();
  const events = [];
  let onGesture = null;
  const host = {
    supported: true,
    async start(options) {
      onGesture = options.onGesture;
      return { stop() {} };
    },
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "__TUMBO_NATIVE_HAND_TRACKER__");
  Object.defineProperty(globalThis, "__TUMBO_NATIVE_HAND_TRACKER__", { configurable: true, value: host });
  try {
    const bridge = createGestureInput({ documentRoot, onGesture: (event) => events.push(event) });
    await bridge.enable("test");
    onGesture({
      gesture: "HOLD",
      x: 0.4,
      y: -0.2,
      holdDelta: { dx: 1, dy: 0, dz: 0 },
      frames: [{ pixels: "raw" }],
      joints: [{ x: 1, y: 2, z: 3 }],
      identity: "must-not-cross-boundary",
    });
    const valid = events.at(-1);
    assert.equal(valid.gesture, "hold");
    assert.equal(valid.holdDeltaProvided, true);
    assert.deepEqual(valid.holdDelta, { dx: 1, dy: 0, dz: 0 });
    assert.equal(Object.hasOwn(valid, "frames"), false);
    assert.equal(Object.hasOwn(valid, "joints"), false);
    assert.equal(Object.hasOwn(valid, "identity"), false);

    onGesture({ gesture: "hold", holdDelta: { dx: 2, dy: 0, dz: 0 } });
    const invalid = events.at(-1);
    assert.equal(invalid.gesture, "hold");
    assert.equal(invalid.holdDeltaProvided, true);
    assert.equal(invalid.holdDelta, null);

    onGesture({ gesture: "release" });
    assert.equal(events.at(-1).gesture, "release");
    assert.equal(events.at(-1).holdDelta, null);
    bridge.disable("test-stop");
  } finally {
    if (previous) Object.defineProperty(globalThis, "__TUMBO_NATIVE_HAND_TRACKER__", previous);
    else delete globalThis.__TUMBO_NATIVE_HAND_TRACKER__;
  }
});

test("main, renderer, and input source expose the bounded manipulation seam", async () => {
  const [main, input, blockWorld] = await Promise.all([
    readFile(new URL("../src/main.js", import.meta.url), "utf8"),
    readFile(new URL("../src/render/gesture-input.js", import.meta.url), "utf8"),
    readFile(new URL("../src/render/block-world.js", import.meta.url), "utf8"),
  ]);
  assert.match(main, /nativeHandCarryActions/);
  assert.match(main, /blockWorld\.grabSelected/);
  assert.match(main, /blockWorld\.holdSelected/);
  assert.match(main, /blockWorld\.placeHeld/);
  assert.match(main, /carry-target-mismatch|carry-required/);
  assert.match(main, /holdDeltaProvided/);
  assert.match(main, /same local held draft/i);
  assert.match(input, /sanitizeCarryDelta/);
  assert.match(input, /holdDeltaProvided/);
  assert.match(input, /Math\.abs\(value\) <= 1/);
  assert.match(blockWorld, /heldBlock\(\)\?\.id !== gazeLockedId/);
  assert.match(blockWorld, /heldBlock\(\)\?\.id === candidate/);
  assert.doesNotMatch(main, /cameraDrivenBlockEdits:\s*true/);
  assert.doesNotMatch(input, /fetch\s*\(|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB/);
});
