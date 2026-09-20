import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  GESTURE_INPUT_SOURCE,
  HAND_CALIBRATION_SOURCE,
  createGestureInput,
} from "../src/render/gesture-input.js";

const ROOT = new URL("../", import.meta.url);

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

test("gesture bridge is off by default, uses touch fallback, and emits bounded local pose", async () => {
  const documentRoot = makeDocument();
  const gestures = [];
  const bridge = createGestureInput({ documentRoot, onGesture: (gesture) => gestures.push(gesture) });
  const before = bridge.getSnapshot();
  assert.equal(before.source, GESTURE_INPUT_SOURCE);
  assert.equal(before.active, false);
  assert.equal(before.status, "off");
  assert.equal(before.capabilities.touchPointer, "available");
  assert.equal(before.capabilities.gaze, "unavailable");
  assert.equal(before.capabilities.nativeHand, "unavailable");
  assert.equal(before.capabilities.handTracking, "unavailable");
  assert.equal(before.localOnly, true);
  assert.equal(before.motionOnly, true);
  assert.equal(before.landmarks, false);
  assert.equal(before.recording, false);
  assert.equal(before.externalNetwork, false);
  assert.equal(before.cameraDrivenBlockEdits, false);
  assert.equal(before.calibration.source, HAND_CALIBRATION_SOURCE);
  assert.equal(before.calibration.status, "idle");
  assert.equal(before.calibration.landmarks, false);
  assert.equal(before.calibration.cameraDrivenBlockEdits, false);

  await bridge.enable("test");
  assert.equal(bridge.getSnapshot().active, true);
  assert.equal(bridge.getSnapshot().mode, "touch-pointer");
  assert.match(bridge.getSnapshot().status, /partial|unavailable/i);

  const pad = documentRoot.nodes.get("gesture-input-pad");
  pad.listeners.get("pointerdown")({ pointerId: 1, pointerType: "touch", clientX: 20, clientY: 40 });
  pad.listeners.get("pointermove")({ pointerId: 1, pointerType: "touch", clientX: 90, clientY: 5 });
  assert.equal(gestures.length >= 1, true);
  assert.equal(gestures.at(-1).inputSource, "touch");
  assert.ok(gestures.at(-1).pose.dx >= -1 && gestures.at(-1).pose.dx <= 1);
  assert.ok(gestures.at(-1).pose.dy >= -1 && gestures.at(-1).pose.dy <= 1);
  assert.equal(gestures.at(-1).landmarks, false);
  assert.equal(gestures.at(-1).localOnly, true);
  assert.equal(gestures.at(-1).externalNetwork, false);

  bridge.reset("test-reset");
  assert.equal(bridge.getSnapshot().samples, 0);
  bridge.disable("test-stop");
  assert.equal(bridge.getSnapshot().active, false);
  assert.equal(bridge.getSnapshot().status, "off");
});

test("native hand host is explicit, coarse-only, and strips raw payload fields", async () => {
  const documentRoot = makeDocument();
  const gestures = [];
  let startCalls = 0;
  let stopCalls = 0;
  let onGesture = null;
  const host = {
    supported: true,
    async start(options) {
      startCalls += 1;
      onGesture = options.onGesture;
      return { stop() { stopCalls += 1; } };
    },
  };
  const previousNativeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "__TUMBO_NATIVE_HAND_TRACKER__");
  const previousShortDescriptor = Object.getOwnPropertyDescriptor(globalThis, "__TUMBO_HAND_TRACKER__");
  Object.defineProperty(globalThis, "__TUMBO_NATIVE_HAND_TRACKER__", { configurable: true, value: host });
  try {
    const bridge = createGestureInput({ documentRoot, onGesture: (gesture) => gestures.push(gesture) });
    assert.equal(bridge.getSnapshot().capabilities.nativeHand, "unrequested");
    assert.equal(startCalls, 0, "native host must not start during mount");
    await bridge.enable("button");
    assert.equal(startCalls, 1, "native host starts only after explicit enable");
    assert.equal(bridge.getSnapshot().mode, "native-hand");
    assert.equal(bridge.getSnapshot().capabilities.nativeHand, "active");

    onGesture({
      gesture: "PINCH",
      x: 2,
      y: -2,
      dx: 1.5,
      dy: -1.5,
      frames: [{ pixels: "raw" }],
      joints: [{ x: 999, y: 999, z: 999 }],
      identity: "must-not-cross-boundary",
    });
    const event = gestures.at(-1);
    assert.equal(event.gesture, "pinch");
    assert.equal(event.nativeHandGesture, "pinch");
    assert.equal(event.inputSource, "native-hand");
    assert.equal(event.pointProvided, true);
    assert.deepEqual(event.pose, {
      x: 1,
      y: -1,
      dx: 1,
      dy: -1,
      magnitude: 1,
      pointerType: "native-hand",
    });
    assert.equal(Object.hasOwn(event, "frames"), false);
    assert.equal(Object.hasOwn(event, "joints"), false);
    assert.equal(Object.hasOwn(event, "identity"), false);
    assert.equal(event.landmarks, false);
    assert.equal(event.localOnly, true);
    assert.equal(event.motionOnly, true);
    assert.equal(event.cameraDrivenBlockEdits, false);

    onGesture({ gesture: "inspect" });
    const gazeReuseCandidate = gestures.at(-1);
    assert.equal(gazeReuseCandidate.pointProvided, false, "missing hand coordinates stay distinguishable from center point");
    assert.deepEqual(gazeReuseCandidate.pose, {
      x: 0,
      y: 0,
      dx: 0,
      dy: 0,
      magnitude: 0,
      pointerType: "native-hand",
    });

    const sampleCount = bridge.getSnapshot().samples;
    onGesture({ gesture: "wave", x: 0, y: 0, dx: 0, dy: 0 });
    assert.equal(bridge.getSnapshot().samples, sampleCount, "unknown host gestures are ignored");
    bridge.disable("button");
    assert.equal(stopCalls, 1);
    assert.equal(bridge.getSnapshot().active, false);
  } finally {
    if (previousNativeDescriptor) Object.defineProperty(globalThis, "__TUMBO_NATIVE_HAND_TRACKER__", previousNativeDescriptor);
    else delete globalThis.__TUMBO_NATIVE_HAND_TRACKER__;
    if (previousShortDescriptor) Object.defineProperty(globalThis, "__TUMBO_HAND_TRACKER__", previousShortDescriptor);
    else delete globalThis.__TUMBO_HAND_TRACKER__;
  }
});

test("hand calibration is explicit and completes only on a sanitized hand signal", async () => {
  const documentRoot = makeDocument();
  const gestures = [];
  let onGesture = null;
  let startCalls = 0;
  const host = {
    supported: true,
    async start(options) {
      startCalls += 1;
      onGesture = options.onGesture;
      return { stop() {} };
    },
  };
  const previousDescriptor = Object.getOwnPropertyDescriptor(globalThis, "__TUMBO_NATIVE_HAND_TRACKER__");
  Object.defineProperty(globalThis, "__TUMBO_NATIVE_HAND_TRACKER__", { configurable: true, value: host });
  try {
    const bridge = createGestureInput({ documentRoot, onGesture: (gesture) => gestures.push(gesture) });
    assert.equal(bridge.getSnapshot().calibration.status, "idle");
    await bridge.enable("button");
    assert.equal(startCalls, 1);
    assert.equal(bridge.getSnapshot().calibration.status, "ready");

    const waiting = bridge.calibrateHand("test");
    assert.equal(waiting.calibration.status, "waiting");
    assert.match(documentRoot.nodes.get("gesture-input-calibration-status").textContent, /SHOW ONE PINCH/i);
    onGesture({ gesture: "point", x: 0, y: 0 });
    assert.equal(bridge.getSnapshot().calibration.status, "waiting", "point must not complete calibration");
    onGesture({
      gesture: "PINCH",
      x: 0.2,
      y: -0.1,
      frames: [{ pixels: "raw" }],
      joints: [{ x: 9, y: 9, z: 9 }],
      identity: "must-not-cross-boundary",
    });
    const complete = bridge.getSnapshot();
    assert.equal(complete.calibration.status, "complete");
    assert.equal(complete.calibration.inputSource, "native-hand");
    assert.equal(complete.calibration.gesture, "pinch");
    assert.equal(complete.calibration.sampleCount, 1);
    assert.equal(complete.calibration.source, HAND_CALIBRATION_SOURCE);
    assert.equal(complete.calibration.landmarks, false);
    assert.equal(complete.calibration.localOnly, true);
    assert.equal(complete.calibration.cameraDrivenBlockEdits, false);
    assert.equal(Object.hasOwn(complete.calibration, "frames"), false);
    assert.equal(Object.hasOwn(complete.calibration, "joints"), false);
    assert.equal(Object.hasOwn(complete.calibration, "identity"), false);
    assert.equal(gestures.at(-1).gesture, "pinch");
    bridge.reset("test-reset");
    assert.equal(bridge.getSnapshot().calibration.status, "ready");
    bridge.disable("test-stop");
    assert.equal(bridge.getSnapshot().calibration.status, "idle");
  } finally {
    if (previousDescriptor) Object.defineProperty(globalThis, "__TUMBO_NATIVE_HAND_TRACKER__", previousDescriptor);
    else delete globalThis.__TUMBO_NATIVE_HAND_TRACKER__;
  }
});

test("XR hand tracking is requested only after explicit enable and never exposes landmarks", async () => {
  const documentRoot = makeDocument();
  let supportedCalls = 0;
  let sessionCalls = 0;
  let endCalls = 0;
  const session = {
    enabledFeatures: ["hand-tracking"],
    inputSources: [{ hand: {}, handedness: "right", gamepad: { axes: [0.4, -0.2] } }],
    addEventListener() {},
    removeEventListener() {},
    async end() { endCalls += 1; },
  };
  const previousNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      xr: {
        async isSessionSupported() { supportedCalls += 1; return true; },
        async requestSession() { sessionCalls += 1; return session; },
      },
    },
  });
  try {
    const bridge = createGestureInput({ documentRoot });
    assert.equal(supportedCalls, 0, "capability checks must not request an XR session during mount");
    assert.equal(sessionCalls, 0, "XR permission must wait for explicit enable");
    await bridge.enable("button");
    assert.equal(supportedCalls, 1);
    assert.equal(sessionCalls, 1);
    assert.equal(bridge.getSnapshot().mode, "xr-hand");
    assert.equal(bridge.getSnapshot().capabilities.handTracking, "active");
    assert.equal(bridge.getSnapshot().landmarks, false);
    assert.equal(bridge.getSnapshot().biometric, false);
    bridge.disable("button");
    assert.equal(endCalls, 1);
  } finally {
    if (previousNavigatorDescriptor) Object.defineProperty(globalThis, "navigator", previousNavigatorDescriptor);
    else delete globalThis.navigator;
  }
});

test("gesture route is linked, capability-aware, and bounded to local viewpoint input", async () => {
  const html = await readFile(new URL("index.html", ROOT), "utf8");
  const main = await readFile(new URL("src/main.js", ROOT), "utf8");
  const source = await readFile(new URL("src/render/gesture-input.js", ROOT), "utf8");
  for (const id of [
    "gesture-input-panel",
    "gesture-input-open",
    "gesture-input-toggle",
    "gesture-input-reset",
    "gesture-input-stop",
    "gesture-input-status",
    "gesture-input-capabilities",
    "gesture-input-pad",
    "gesture-input-boundary",
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /Touch and pointer remain the phone fallback/i);
  assert.match(html, /native hand or XR hand.*coarse pinch, point, open/i);
  assert.match(html, /supported host.*gaze/i);
  assert.match(html, /No camera hand landmarks are fabricated/i);
  assert.match(html, /Phone Gestures · Viewpoint \+ Hand/i);
  assert.match(html, /gesture-input-calibrate/);
  assert.match(html, /gesture-input-calibration-status/);
  assert.match(html, /Press Calibrate hand \/ finger, then show one sanitized native pinch or XR-hand select/i);
  assert.match(source, /__TUMBO_GAZE_TRACKER__/);
  assert.match(source, /__TUMBO_NATIVE_HAND_TRACKER__/);
  assert.match(source, /__TUMBO_HAND_TRACKER__/);
  assert.match(source, /NATIVE_HAND_GESTURES\s*=\s*new Set\(\["pinch",\s*"point",\s*"open",\s*"inspect",\s*"grab",\s*"hold",\s*"place",\s*"release"\]\)/);
  assert.match(source, /sanitizeNativeHandSample/);
  assert.match(source, /optionalFeatures:\s*\["hand-tracking"\]/);
  assert.match(source, /requestSession\("immersive-ar"/);
  assert.match(source, /getSnapshot/);
  assert.doesNotMatch(source, /fetch\s*\(|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(source, /face\s*(recognition|detection)|biometric\s*inference/i);
  assert.match(source, /landmarks:\s*false/);
  assert.match(source, /HAND_CALIBRATION_SOURCE/);
  assert.match(source, /calibrateHand/);
  assert.match(source, /HAND CALIBRATION WAITING/);
  assert.match(source, /HAND CALIBRATION COMPLETE/);
  assert.match(main, /GESTURE_INPUT_SOURCE/);
  assert.match(main, /createGestureInput/);
  assert.match(main, /__TUMBO_GESTURE_INPUT__/);
  assert.match(main, /projection\.gesture-input/);
  assert.match(main, /gestureRouteQuery\.get\('panel'\) === 'gesture'/);
  assert.match(main, /gestures.*=== '1'/);
  assert.match(main, /gestureInput\.open\(\)/);
  assert.match(main, /cameraDrivenBlockEdits:false/);
});
