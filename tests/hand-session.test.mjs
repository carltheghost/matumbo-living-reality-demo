/**
 * tests/hand-session.test.mjs
 *
 * Session pipeline: governor → hand-lens → depth → gestures → hand-grab →
 * presence/keyboard, with injected stub camera + keyboard factories.
 * Run with: node --test tests/hand-session.test.mjs
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHandLensSession } from "../src/render/hand-session.js";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------
function makeCameraStub() {
  const calls = [];
  let panelOpen = false;
  return {
    calls,
    onHands() {
      calls.push(["onHands"]);
    },
    offHands() {
      calls.push(["offHands"]);
    },
    enable() {
      calls.push(["enable"]);
    },
    disable() {
      calls.push(["disable"]);
    },
    getState: () => "idle",
    setSampleInterval(ms) {
      calls.push(["setSampleInterval", ms]);
    },
    setPanelOpen(open) {
      panelOpen = !!open;
      calls.push(["setPanelOpen", open]);
    },
    isPanelOpen: () => panelOpen,
  };
}

function makeKeyboardStub() {
  const calls = [];
  let visible = true;
  const stub = {
    calls,
    capturedOnKey: null,
    isVisible: () => visible,
    setVisible(v) {
      visible = !!v;
    },
    getKeyRects: () => ({
      "key-a": { left: 100, top: 100, width: 50, height: 50 },
    }),
    pressKey(keyId) {
      calls.push(["pressKey", keyId]);
      return true;
    },
    destroy() {
      calls.push(["destroy"]);
    },
  };
  return stub;
}

function makeDocumentRoot() {
  return {
    getElementById: () => null,
    querySelector: () => null,
    createElement: () => ({
      style: {},
      textContent: "",
      addEventListener() {},
      remove() {},
    }),
    defaultView: { innerWidth: 1280, innerHeight: 800 },
  };
}

function makeSession({ withDom = true } = {}) {
  const cam = makeCameraStub();
  const kb = makeKeyboardStub();
  const intents = [];
  const blockWorld = {
    noteGestureIntent: (event) => intents.push(event),
  };
  const session = createHandLensSession({
    blockWorld,
    documentRoot: withDom ? makeDocumentRoot() : undefined,
    createCamera: () => cam,
    createKeyboard: (options) => {
      kb.capturedOnKey = options.onKey;
      return kb;
    },
  });
  return { session, cam, kb, intents };
}

// ---------------------------------------------------------------------------
// Landmark helpers (21 MediaPipe-style landmarks)
// ---------------------------------------------------------------------------
function makeLandmarks(overrides = {}) {
  const points = [];
  for (let i = 0; i < 21; i++) points.push({ x: 0.5, y: 0.5, z: 0 });
  for (const [index, point] of Object.entries(overrides)) {
    points[Number(index)] = { x: point[0], y: point[1], z: point[2] ?? 0 };
  }
  return points;
}

const LEFT = "Left";

function pinchHand(middleMcpX) {
  return {
    handedness: LEFT,
    landmarks: makeLandmarks({
      0: [0.5, 0.5], // wrist
      4: [0.5, 0.4], // thumb tip
      8: [0.5, 0.41], // index tip
      9: [middleMcpX, 0.5], // middle MCP → handSize = |middleMcpX - 0.5|
    }),
  };
}

function tapHand(indexTipY) {
  return {
    handedness: LEFT,
    landmarks: makeLandmarks({
      0: [0.5, 0.5], // wrist
      4: [0.2, 0.5], // thumb tip (far from index → no pinch)
      8: [0.09, indexTipY], // index tip (the tapping finger)
      9: [0.52, 0.5], // middle MCP
    }),
  };
}

function frame(hand, timestamp) {
  return { hands: [hand], timestamp, latencyMs: 5 };
}

// ---------------------------------------------------------------------------
describe("mount / destroy lifecycle", () => {
  it("mount does NOT call enable (camera stays off until the user opts in)", () => {
    const { session, cam, kb } = makeSession();
    assert.equal(session.mount(), true);
    assert.ok(session.isMounted());
    assert.equal(cam.calls.filter((c) => c[0] === "enable").length, 0);
    assert.ok(cam.calls.some((c) => c[0] === "onHands"));
    assert.equal(session.getCamera(), cam);
    assert.equal(session.getKeyboard(), kb);
    session.destroy();
  });

  it("destroy calls camera.disable + keyboard.destroy", () => {
    const { session, cam, kb } = makeSession();
    session.mount();
    session.destroy();
    assert.ok(!session.isMounted());
    assert.ok(cam.calls.some((c) => c[0] === "disable"));
    assert.ok(kb.calls.some((c) => c[0] === "destroy"));
  });

  it("mount without a documentRoot is a graceful no-op returning false", () => {
    const { session, intents } = makeSession({ withDom: false });
    assert.equal(session.mount(), false);
    assert.ok(!session.isMounted());
    // The pipeline still runs headless: pinch → grab intent.
    session.handleFrame(frame(pinchHand(0.6), 1000));
    const grab = intents.find((e) => e.gesture === "grab");
    assert.ok(grab, "expected a grab intent without DOM");
    session.destroy();
  });
});

describe("frame pipeline", () => {
  it("pinchstart → noteGestureIntent received grab", () => {
    const { session, intents } = makeSession();
    session.mount();
    session.handleFrame(frame(pinchHand(0.6), 1000));
    const grab = intents.find((e) => e.gesture === "grab");
    assert.ok(grab, "expected a grab intent");
    assert.equal(grab.method, "hand-lens");
    assert.equal(grab.hand, LEFT);
    session.destroy();
  });

  it("depth: two pinchmove frames with growing handSize → drag dz > 0", () => {
    const { session, intents } = makeSession();
    session.mount();
    session.handleFrame(frame(pinchHand(0.6), 2000)); // pinchstart, baseline 0.1
    session.handleFrame(frame(pinchHand(0.64), 2050)); // hand grew
    const drag = intents.find((e) => e.gesture === "drag");
    assert.ok(drag, "expected a drag intent");
    assert.ok(
      drag.detail.dz > 0,
      `expected positive dz from hand growth, got ${drag.detail.dz}`,
    );
    session.destroy();
  });

  it("tap with keyboard visible → pressKey called with mapped id", () => {
    const { session, kb } = makeSession();
    session.mount();
    // Two air taps; the second flushes the first through the air-typing
    // pending-tap window (TAP_COMPLETE_MS), producing a char event for the
    // key under the fingertip ("key-a" rect at 100,100 50x50 on a
    // 1280x800 viewport → normalized hit at (0.09, 0.14)).
    const taps = [
      [1000, 0.14],
      [1020, 0.19],
      [1040, 0.14], // tap 1
      [1200, 0.14],
      [1220, 0.19],
      [1240, 0.14], // tap 2 → flushes tap 1
    ];
    for (const [t, y] of taps) {
      session.handleFrame(frame(tapHand(y), t));
    }
    const pressed = kb.calls.filter((c) => c[0] === "pressKey");
    assert.ok(
      pressed.some((c) => c[1] === "key-a"),
      `expected pressKey("key-a"), got ${JSON.stringify(pressed)}`,
    );
    session.destroy();
  });

  it("pointer shift onKey does not break air typing", () => {
    const { session, kb } = makeSession();
    session.mount();
    assert.ok(
      typeof kb.capturedOnKey === "function",
      "keyboard factory received the session onKey hook",
    );
    kb.capturedOnKey({ action: "shift", value: true });
    kb.capturedOnKey({ action: "symbols", value: true });
    session.handleFrame(frame(tapHand(0.14), 3000));
    session.handleFrame(frame(tapHand(0.19), 3020));
    session.handleFrame(frame(tapHand(0.14), 3040));
    session.handleFrame(frame(tapHand(0.19), 3220));
    session.handleFrame(frame(tapHand(0.14), 3240));
    const pressed = kb.calls.filter((c) => c[0] === "pressKey");
    assert.ok(
      pressed.some((c) => c[1] === "key-a"),
      `expected pressKey("key-a") after pointer control keys, got ${JSON.stringify(pressed)}`,
    );
    session.destroy();
  });
});
