import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

import {
  GESTURE_LENS_BOUNDARY,
  GESTURE_LENS_CAMERA_STATES,
  GESTURE_LENS_CONSOLE_SOURCE,
  GESTURE_LENS_INTENTS,
  GESTURE_LENS_MAX_TRACE,
  GESTURE_LENS_POSES,
  GESTURE_LENS_SCHEMA_VERSION,
  GESTURE_LENS_SOURCE,
  classifyHandPose,
  classifyTwoHandMotion,
  createGestureLens,
  createGestureLensContribution,
  deriveIntent,
  pointerSampleToFrame,
  syntheticHand,
} from "../src/domains/gesture-lens.js";

import {
  GESTURE_LENS_LONG_PRESS_MS,
  GESTURE_LENS_WHEEL_DEPTH_STEP,
  createGestureLensConsole,
} from "../src/render/gesture-lens.js";

const MOUNT_IDS = [
  "gesture-lens-console",
  "gesture-lens-close",
  "gesture-lens-status",
  "gesture-lens-toggle",
  "gesture-lens-preview-wrap",
  "gesture-lens-preview",
  "gesture-lens-preview-close",
  "gesture-lens-preview-note",
  "gesture-lens-pad",
  "gesture-lens-proxy",
  "gesture-lens-gesture",
  "gesture-lens-grab",
  "gesture-lens-release",
  "gesture-lens-scale-up",
  "gesture-lens-scale-down",
  "gesture-lens-twist-left",
  "gesture-lens-twist-right",
  "gesture-lens-depth-push",
  "gesture-lens-depth-pull",
  "gesture-lens-reset",
  "gesture-lens-trace",
  "gesture-lens-boundary",
];

function frameOf(pose, wrist = { x: 0.5, y: 0.5, z: 0 }, at = 1) {
  return { at, hands: [syntheticHand(wrist, pose)] };
}

// ---------------------------------------------------------------------------
// Pose vocabulary
// ---------------------------------------------------------------------------

test("synthetic open hand classifies as open", () => {
  assert.equal(classifyHandPose(syntheticHand({ x: 0.5, y: 0.5, z: 0 }, "open")), "open");
});

test("synthetic pinch hand classifies as pinch", () => {
  assert.equal(classifyHandPose(syntheticHand({ x: 0.5, y: 0.5, z: 0 }, "pinch")), "pinch");
});

test("synthetic fist classifies as fist (fist wins over pinch geometry)", () => {
  assert.equal(classifyHandPose(syntheticHand({ x: 0.5, y: 0.5, z: 0 }, "fist")), "fist");
});

test("synthetic point hand classifies as point", () => {
  assert.equal(classifyHandPose(syntheticHand({ x: 0.5, y: 0.5, z: 0 }, "point")), "point");
});

test("absent hands classify as absent", () => {
  assert.equal(classifyHandPose(null), "absent");
  assert.equal(classifyHandPose({ present: false }), "absent");
});

test("ambiguous hand classifies as unknown", () => {
  const wrist = { x: 0.5, y: 0.5, z: 0 };
  const hand = {
    present: true,
    wrist,
    tips: {
      // Index half-raised: between the curl and extend thresholds.
      thumb: { x: 0.2, y: 0.4, z: 0 },
      index: { x: 0.5, y: 0.62, z: 0 },
      middle: { x: 0.52, y: 0.54, z: 0 },
      ring: { x: 0.48, y: 0.54, z: 0 },
      pinky: { x: 0.45, y: 0.53, z: 0 },
    },
  };
  assert.equal(classifyHandPose(hand), "unknown");
});

test("pose and intent vocabularies cover the spec", () => {
  for (const pose of ["open", "pinch", "fist", "point"]) {
    assert.ok(GESTURE_LENS_POSES.includes(pose), `missing pose ${pose}`);
  }
  for (const intent of ["proxy-move", "grab", "drag", "scale", "rotate", "release"]) {
    assert.ok(GESTURE_LENS_INTENTS.includes(intent), `missing intent ${intent}`);
  }
  for (const state of ["off", "preview", "denied", "unavailable"]) {
    assert.ok(GESTURE_LENS_CAMERA_STATES.includes(state), `missing camera state ${state}`);
  }
});

// ---------------------------------------------------------------------------
// Single-hand intent derivation
// ---------------------------------------------------------------------------

test("open palm movement derives proxy-move with deltas", () => {
  const prev = frameOf("open", { x: 0.4, y: 0.5, z: 0 }, 1);
  const next = frameOf("open", { x: 0.45, y: 0.55, z: 0.1 }, 2);
  const intent = deriveIntent(prev, next);
  assert.equal(intent.intent, "proxy-move");
  assert.equal(intent.detail.dx, 0.05);
  assert.equal(intent.detail.dy, 0.05);
  assert.equal(intent.detail.dz, 0.1);
});

test("new pinch derives grab, held pinch derives drag", () => {
  const open = frameOf("open", { x: 0.5, y: 0.5, z: 0 }, 1);
  const pinch = frameOf("pinch", { x: 0.5, y: 0.5, z: 0 }, 2);
  assert.equal(deriveIntent(open, pinch).intent, "grab");
  const drag = frameOf("pinch", { x: 0.55, y: 0.5, z: -0.2 }, 3);
  const moved = deriveIntent(pinch, drag);
  assert.equal(moved.intent, "drag");
  assert.equal(moved.detail.dx, 0.05);
  assert.equal(moved.detail.dz, -0.2);
});

test("fist derives release", () => {
  const pinch = frameOf("pinch", { x: 0.5, y: 0.5, z: 0 }, 1);
  const fist = frameOf("fist", { x: 0.5, y: 0.5, z: 0 }, 2);
  assert.equal(deriveIntent(pinch, fist).intent, "release");
});

test("no hands yields a null intent with a reason", () => {
  const intent = deriveIntent(frameOf("open"), { at: 2, hands: [] });
  assert.equal(intent.intent, null);
  assert.equal(intent.detail.reason, "no-hand");
});

// ---------------------------------------------------------------------------
// Two-hand motion: spread = scale, twist = rotate
// ---------------------------------------------------------------------------

function twoHandFrame(ax, ay, bx, by, at = 1) {
  return {
    at,
    hands: [
      syntheticHand({ x: ax, y: ay, z: 0 }, "pinch"),
      syntheticHand({ x: bx, y: by, z: 0 }, "pinch"),
    ],
  };
}

test("two-hand spread classifies as scale with a factor above one", () => {
  const prev = twoHandFrame(0.4, 0.5, 0.6, 0.5, 1);
  const next = twoHandFrame(0.35, 0.5, 0.65, 0.5, 2);
  const motion = classifyTwoHandMotion(prev, next);
  assert.equal(motion.kind, "spread");
  assert.ok(motion.factor > 1, `expected growth factor, got ${motion.factor}`);
  const intent = deriveIntent(prev, next);
  assert.equal(intent.intent, "scale");
  assert.ok(intent.detail.factor > 1);
});

test("two-hand pinch-in classifies as scale with a factor below one", () => {
  const prev = twoHandFrame(0.35, 0.5, 0.65, 0.5, 1);
  const next = twoHandFrame(0.42, 0.5, 0.58, 0.5, 2);
  const motion = classifyTwoHandMotion(prev, next);
  assert.equal(motion.kind, "spread");
  assert.ok(motion.factor < 1, `expected shrink factor, got ${motion.factor}`);
});

test("two-hand twist classifies as rotate with signed degrees", () => {
  const prev = twoHandFrame(0.4, 0.5, 0.6, 0.5, 1);
  const next = twoHandFrame(0.4, 0.45, 0.6, 0.55, 2);
  const motion = classifyTwoHandMotion(prev, next);
  assert.equal(motion.kind, "twist");
  assert.ok(Math.abs(motion.degrees) > 10, `expected twist, got ${motion.degrees}`);
  const intent = deriveIntent(prev, next);
  assert.equal(intent.intent, "rotate");
});

test("sub-threshold two-hand motion yields no intent", () => {
  const prev = twoHandFrame(0.4, 0.5, 0.6, 0.5, 1);
  const next = twoHandFrame(0.401, 0.5, 0.6, 0.5, 2);
  assert.equal(classifyTwoHandMotion(prev, next).kind, null);
});

// ---------------------------------------------------------------------------
// Pointer-sample bridge (the honesty seam: pointer -> frame -> classifier)
// ---------------------------------------------------------------------------

test("pointer sample becomes a one-hand frame in the chosen pose", () => {
  const frame = pointerSampleToFrame({ x: 0.2, y: 0.8, depth: 0.25, mode: "pinch", at: 7 });
  assert.equal(frame.hands.length, 1);
  assert.equal(frame.at, 7);
  assert.equal(classifyHandPose(frame.hands[0]), "pinch");
  assert.equal(frame.hands[0].wrist.z, 0.25);
});

test("two-hand pointer sample becomes two pinch hands", () => {
  const frame = pointerSampleToFrame({ x: 0.4, y: 0.5, twoHand: true, spread: 0.2, skew: 0, at: 3 });
  assert.equal(frame.hands.length, 2);
  assert.equal(classifyHandPose(frame.hands[0]), "pinch");
  assert.equal(classifyHandPose(frame.hands[1]), "pinch");
  assert.ok(frame.hands[1].wrist.x > frame.hands[0].wrist.x);
});

test("unknown pointer mode falls back to open", () => {
  const frame = pointerSampleToFrame({ x: 0.5, y: 0.5, mode: "jazz-hands" });
  assert.equal(classifyHandPose(frame.hands[0]), "open");
});

// ---------------------------------------------------------------------------
// Session: proxy pose tracking, intent counts, bounded trace, snapshots
// ---------------------------------------------------------------------------

test("session tracks the hand proxy pose from pointer samples", () => {
  const lens = createGestureLens();
  lens.notePointerSample({ x: 0.3, y: 0.7, depth: -0.4, mode: "open" });
  const snapshot = lens.getSnapshot();
  assert.equal(snapshot.pose.x, 0.3);
  assert.equal(snapshot.pose.y, 0.7);
  assert.equal(snapshot.pose.z, -0.4);
  assert.equal(snapshot.gesture, "proxy-move");
  assert.equal(snapshot.intents, 1);
});

test("session intent trace stays bounded", () => {
  const lens = createGestureLens();
  for (let i = 0; i < GESTURE_LENS_MAX_TRACE + 10; i += 1) {
    lens.notePointerSample({ x: 0.1 + i * 0.01, y: 0.5, mode: "open" });
  }
  const snapshot = lens.getSnapshot();
  assert.ok(snapshot.trace.length <= GESTURE_LENS_MAX_TRACE);
  assert.ok(snapshot.intents > GESTURE_LENS_MAX_TRACE);
});

test("session snapshot is local-only and non-executable", () => {
  const snapshot = createGestureLens().getSnapshot();
  assert.equal(snapshot.source, GESTURE_LENS_SOURCE);
  assert.equal(snapshot.schemaVersion, GESTURE_LENS_SCHEMA_VERSION);
  assert.equal(snapshot.simulation, true);
  assert.equal(snapshot.localOnly, true);
  assert.equal(snapshot.recording, false);
  assert.equal(snapshot.upload, false);
  assert.equal(snapshot.externalNetwork, false);
  assert.equal(snapshot.executable, false);
  assert.equal(snapshot.cameraDrivenEdits, false);
});

test("session reset clears pose, gesture, and trace", () => {
  const lens = createGestureLens();
  lens.notePointerSample({ x: 0.3, y: 0.7, mode: "pinch" });
  const reset = lens.reset();
  assert.equal(reset.gesture, "none");
  assert.equal(reset.intents, 0);
  assert.deepEqual(reset.trace, []);
  assert.deepEqual(reset.pose, { x: 0.5, y: 0.5, z: 0 });
});

test("projection contribution carries the frozen interface fields", () => {
  const contribution = createGestureLensContribution({ updatedAt: "2026-09-18T00:00:00.000Z" });
  assert.equal(contribution.schemaVersion, GESTURE_LENS_SCHEMA_VERSION);
  assert.equal(contribution.source, GESTURE_LENS_SOURCE);
  assert.equal(contribution.simulation, true);
  assert.equal(contribution.updatedAt, "2026-09-18T00:00:00.000Z");
  assert.ok(Array.isArray(contribution.entities) && contribution.entities.length > 0);
  assert.ok(Array.isArray(contribution.evidence));
  assert.ok(Array.isArray(contribution.capabilities));
  assert.ok(String(contribution.boundary).length > 0);
});

test("boundary copy never claims hardware tracking or recording", () => {
  assert.ok(GESTURE_LENS_BOUNDARY.includes("never recorded"));
  assert.ok(!/world eye/i.test(GESTURE_LENS_BOUNDARY));
});

// ---------------------------------------------------------------------------
// Console renderer (fake DOM): academy pattern + camera lifecycle
// ---------------------------------------------------------------------------

class FakeElement {
  constructor(id) {
    this.id = id;
    this.hidden = true;
    this.textContent = "";
    this.style = {};
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { children.forEach((child) => this.appendChild(child)); }
  replaceChildren(...children) { this.children = [...children]; }
  click() { this.listeners.get("click")?.(); }
  get classList() { return { toggle() {}, add() {}, remove() {} }; }
}

class FakeVideo extends FakeElement {
  constructor(id) {
    super(id);
    this.srcObject = null;
    this.played = false;
    this.paused = false;
  }
  async play() { this.played = true; }
  pause() { this.paused = true; }
}

class FakeDocument {
  constructor() {
    this.elements = new Map();
    for (const id of MOUNT_IDS) {
      this.elements.set(id, id === "gesture-lens-preview" ? new FakeVideo(id) : new FakeElement(id));
    }
    this.listeners = new Map();
    this.created = [];
  }
  getElementById(id) { return this.elements.get(id) ?? null; }
  createElement(tag) {
    const el = new FakeElement(`created-${this.created.length}`);
    el.tag = tag;
    this.created.push(el);
    return el;
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
}

function mountConsole(overrides = {}) {
  const documentRoot = new FakeDocument();
  const events = [];
  const selects = [];
  const lensConsole = createGestureLensConsole({
    documentRoot,
    onGesture: (event) => events.push(event),
    onSelect: (snapshot) => selects.push(snapshot),
    ...overrides,
  });
  const el = (id) => documentRoot.getElementById(id);
  return { documentRoot, lensConsole, events, selects, el };
}

function withNavigator(value, run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const configurable = !descriptor || descriptor.configurable !== false;
  try {
    if (configurable) {
      Object.defineProperty(globalThis, "navigator", {
        value,
        writable: true,
        configurable: true,
        enumerable: true,
      });
    }
    return run();
  } finally {
    if (configurable) {
      if (descriptor) Object.defineProperty(globalThis, "navigator", descriptor);
      else delete globalThis.navigator;
    }
  }
}

test("console throws when mount points are missing", () => {
  assert.throws(
    () => createGestureLensConsole({ documentRoot: { getElementById: () => null } }),
    /gesture-lens-console/
  );
});

test("console starts with the camera off and honest copy", () => {
  const { lensConsole, el } = mountConsole();
  assert.equal(lensConsole.getCameraState(), "off");
  assert.match(el("gesture-lens-status").textContent, /CAMERA OFF/);
  assert.equal(el("gesture-lens-toggle").textContent, "Enable camera preview");
  assert.match(el("gesture-lens-preview-note").textContent, /NOT ANALYZED/);
});

test("console exposes the academy open/close/replay/getSnapshot shape", () => {
  const { lensConsole, el, selects } = mountConsole();
  lensConsole.open("test");
  assert.equal(el("gesture-lens-console").hidden, false);
  const replayed = lensConsole.replay("test");
  assert.equal(replayed.action, "replay");
  assert.equal(replayed.source, GESTURE_LENS_CONSOLE_SOURCE);
  const snapshot = lensConsole.getSnapshot();
  assert.equal(snapshot.camera, "off");
  assert.equal(snapshot.simulation, true);
  assert.equal(snapshot.recording, false);
  lensConsole.close("test");
  assert.equal(el("gesture-lens-console").hidden, true);
  assert.ok(selects.length > 0);
});

test("camera reports unavailable when the device has no media pipeline", async () => {
  const { lensConsole, el } = mountConsole();
  await withNavigator({}, async () => {
    await lensConsole.setCameraEnabled(true, "test");
  });
  assert.equal(lensConsole.getCameraState(), "unavailable");
  assert.match(el("gesture-lens-status").textContent, /NO CAMERA/);
});

test("camera denial leaves the rehearsal pad working", async () => {
  const { lensConsole, el, events } = mountConsole();
  const denied = new Error("Permission denied");
  denied.name = "NotAllowedError";
  await withNavigator({ mediaDevices: { getUserMedia: async () => { throw denied; } } }, async () => {
    await lensConsole.setCameraEnabled(true, "test");
  });
  assert.equal(lensConsole.getCameraState(), "denied");
  assert.match(el("gesture-lens-status").textContent, /BLOCKED/);
  // The pad still classifies pointer input with zero breakage.
  const pad = el("gesture-lens-pad");
  pad.listeners.get("pointerdown")({ clientX: 60, clientY: 40, pointerId: 7 });
  pad.listeners.get("pointerup")({ pointerId: 7 });
  assert.ok(events.some((event) => event.intent === "proxy-move"));
});

test("granted camera shows a local preview and closing kills the stream", async () => {
  const { lensConsole, el } = mountConsole();
  let stopped = 0;
  const stream = { getTracks: () => [{ stop: () => { stopped += 1; } }] };
  await withNavigator({ mediaDevices: { getUserMedia: async () => stream } }, async () => {
    await lensConsole.setCameraEnabled(true, "test");
  });
  assert.equal(lensConsole.getCameraState(), "preview");
  assert.equal(el("gesture-lens-preview").srcObject, stream);
  assert.equal(el("gesture-lens-toggle").textContent, "Stop camera preview");
  // Closing the panel stops every camera track.
  lensConsole.close("test");
  assert.equal(stopped, 1);
  assert.equal(lensConsole.getCameraState(), "off");
  assert.equal(el("gesture-lens-preview").srcObject, null);
});

test("explicit camera toggle off stops the preview", async () => {
  const { lensConsole } = mountConsole();
  let stopped = 0;
  const stream = { getTracks: () => [{ stop: () => { stopped += 1; } }] };
  await withNavigator({ mediaDevices: { getUserMedia: async () => stream } }, async () => {
    await lensConsole.setCameraEnabled(true, "test");
    await lensConsole.setCameraEnabled(false, "test");
  });
  assert.equal(stopped, 1);
  assert.equal(lensConsole.getCameraState(), "off");
});

test("grab and release buttons emit gesture intents", () => {
  const { lensConsole, el, events } = mountConsole();
  lensConsole.open("test");
  el("gesture-lens-grab").click();
  assert.ok(events.some((event) => event.intent === "grab"), "expected a grab intent");
  el("gesture-lens-release").click();
  assert.ok(events.some((event) => event.intent === "release"), "expected a release intent");
  assert.match(el("gesture-lens-gesture").textContent, /RELEASE/);
});

test("scale buttons drive two-hand spread into a scale intent", () => {
  const { el, events } = mountConsole();
  el("gesture-lens-scale-up").click();
  const scale = events.find((event) => event.intent === "scale");
  assert.ok(scale, "expected a scale intent");
  assert.ok(scale.detail.factor > 1, `expected growth, got ${scale.detail.factor}`);
});

test("twist buttons drive two-hand skew into a rotate intent", () => {
  const { el, events } = mountConsole();
  el("gesture-lens-twist-left").click();
  const rotate = events.find((event) => event.intent === "rotate");
  assert.ok(rotate, "expected a rotate intent");
  assert.ok(Math.abs(rotate.detail.degrees) > 10);
});

test("depth buttons push and pull along the depth axis", () => {
  const { el, events } = mountConsole();
  el("gesture-lens-depth-push").click();
  el("gesture-lens-depth-pull").click();
  const drags = events.filter((event) => event.intent === "drag");
  assert.ok(drags.length >= 2, "expected drag intents from depth steps");
  assert.ok(drags.some((drag) => drag.detail.dz < 0), "expected a push (negative dz)");
  assert.ok(drags.some((drag) => drag.detail.dz > 0), "expected a pull (positive dz)");
});

test("rehearsal pad drag classifies through the pointer bridge", () => {
  const { el, events } = mountConsole();
  const pad = el("gesture-lens-pad");
  pad.listeners.get("pointerdown")({ clientX: 30, clientY: 30, pointerId: 3 });
  pad.listeners.get("pointermove")({ clientX: 90, clientY: 60, pointerId: 3 });
  pad.listeners.get("pointerup")({ pointerId: 3 });
  const moves = events.filter((event) => event.intent === "proxy-move");
  assert.ok(moves.length >= 2, "expected pad touch + move intents");
  assert.ok(moves[moves.length - 1].detail.dx > 0, "expected rightward motion");
});

test("reset button clears the session", () => {
  const { lensConsole, el, events } = mountConsole();
  el("gesture-lens-grab").click();
  assert.ok(events.length > 0);
  el("gesture-lens-reset").click();
  assert.match(el("gesture-lens-gesture").textContent, /NONE/);
});

test("console constants match the spec timings", () => {
  assert.equal(GESTURE_LENS_LONG_PRESS_MS, 450);
  assert.ok(GESTURE_LENS_WHEEL_DEPTH_STEP > 0);
});

test("index.html mounts every gesture-lens console mount point", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  for (const id of MOUNT_IDS) {
    assert.ok(html.includes(`id="${id}"`), `index.html mounts #${id}`);
  }
});
