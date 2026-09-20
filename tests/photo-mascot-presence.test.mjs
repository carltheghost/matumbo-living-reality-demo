// tests/photo-mascot-presence.test.mjs
//
// DOM-free tests for src/render/photo-mascot-presence.js.
//
// "three", the photo-mascot builder, the motion system, and the photo set are
// replaced with minimal stubs through ./stubs/loader.mjs (node:module
// customization hooks), so no DOM, WebGL, or real photo assets are needed.
//
// Run: node --test tests/photo-mascot-presence.test.mjs

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./stubs/loader.mjs", import.meta.url));

const { createPhotoMascotPresence } = await import("../src/render/photo-mascot-presence.js");
const THREE = await import("three");
const builderStub = await import("./stubs/photo-mascot.mjs");
const motionStub = await import("./stubs/mascot-motion.mjs");
const photoSetStub = await import("./stubs/photo-mascot-set.mjs");

const STORAGE_KEY = "tumbo-mascot-presence-pos";

// -- Minimal DOM / browser-environment stubs -------------------------------

function makeEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      const set = listeners.get(type);
      if (set) set.delete(fn);
    },
    dispatchEvent(evt) {
      const set = listeners.get(evt.type);
      if (set) for (const fn of [...set]) fn.call(this, evt);
      return true;
    },
    __listenerCount(type) {
      const set = listeners.get(type);
      return set ? set.size : 0;
    },
  };
}

function makeElement(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    style: {},
    children: [],
    removed: false,
    ...makeEventTarget(),
    setAttribute() {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    remove() {
      this.removed = true;
    },
    click() {
      this.dispatchEvent({ type: "click", target: this, stopPropagation() {} });
    },
  };
}

function makeDocument() {
  return {
    ...makeEventTarget(),
    createElement: (tag) => makeElement(tag),
    body: makeElement("body"),
  };
}

function makeLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => {
      m.set(k, String(v));
    },
    removeItem: (k) => {
      m.delete(k);
    },
    clear: () => {
      m.clear();
    },
  };
}

function makeScene() {
  const added = [];
  return {
    added,
    add(o) {
      added.push(o);
    },
    remove(o) {
      const i = added.indexOf(o);
      if (i >= 0) added.splice(i, 1);
    },
  };
}

function makeCamera() {
  return {
    position: new THREE.Vector3(0, 1.6, 0),
    getWorldDirection(v) {
      return v.set(0, 0, -1);
    },
    // Fixed NDC projection so chip layout is deterministic in tests.
    projectVector(v) {
      v.set(0.25, 0.1, 0.5);
      return v;
    },
  };
}

function makeHud(doc) {
  return {
    ownerDocument: doc,
    children: [],
    appendChild(c) {
      this.children.push(c);
      return c;
    },
  };
}

// -- Fixture ----------------------------------------------------------------

let doc;
let hudRoot;
let scene;
let camera;
let canvas;
let api;
let mobileMatches;

function create(options = {}) {
  api = createPhotoMascotPresence({ scene, camera, hudRoot, ...options });
  return api;
}

beforeEach(() => {
  builderStub.__reset();
  motionStub.__reset();
  photoSetStub.__reset();
  THREE.Raycaster.__hits = [];
  THREE.Raycaster.__planeResult = null;
  mobileMatches = false;

  globalThis.localStorage = makeLocalStorage();
  globalThis.matchMedia = () => ({
    matches: mobileMatches,
    addEventListener() {},
    removeEventListener() {},
  });
  globalThis.innerWidth = 1024;
  globalThis.innerHeight = 768;

  doc = makeDocument();
  canvas = makeElement("canvas");
  scene = makeScene();
  camera = makeCamera();
  hudRoot = makeHud(doc);
  api = null;
});

afterEach(() => {
  try {
    if (api) api.dispose();
  } catch {
    // Never fail teardown.
  }
  api = null;
  delete globalThis.localStorage;
  delete globalThis.matchMedia;
  delete globalThis.innerWidth;
  delete globalThis.innerHeight;
});

// -- Tests -------------------------------------------------------------------

test("singleton: second call returns the existing instance", () => {
  const a = create();
  const b = createPhotoMascotPresence({ scene, camera, hudRoot });
  assert.equal(a, b);
});

test("starts closed and hidden", () => {
  const p = create();
  assert.equal(p.isOpen(), false);
  const chip = hudRoot.children[0];
  assert.ok(chip, "close chip is created up front");
  assert.equal(chip.style.display, "none");
});

test("open/close/toggle control visibility", () => {
  const p = create();
  p.open();
  assert.equal(p.isOpen(), true);
  const group = builderStub.lastBuiltGroup();
  assert.ok(group, "mascot is built lazily on open");
  assert.equal(group.visible, true);
  assert.ok(scene.added.includes(group));

  p.close();
  assert.equal(p.isOpen(), false);
  assert.equal(group.visible, false);

  assert.equal(p.toggle(), true);
  assert.equal(p.isOpen(), true);
  assert.equal(p.toggle(), false);
  assert.equal(p.isOpen(), false);
});

test("position persists across drags and restores on open", () => {
  globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: 1.5, y: 2.5, z: -3.5 }));
  const p = create();
  p.open();
  const group = builderStub.lastBuiltGroup();
  assert.deepStrictEqual(
    [group.position.x, group.position.y, group.position.z],
    [1.5, 2.5, -3.5]
  );

  // Simulate a drag: pointerdown hits the mascot, move past the click
  // threshold, pointerup. Grab offset is zero (hit point == position).
  THREE.Raycaster.__hits = [{ point: new THREE.Vector3(1.5, 2.5, -3.5) }];
  THREE.Raycaster.__planeResult = new THREE.Vector3(2, 3, -4);
  doc.dispatchEvent({ type: "pointerdown", target: canvas, clientX: 100, clientY: 100, pointerId: 7, button: 0 });
  doc.dispatchEvent({ type: "pointermove", target: canvas, clientX: 140, clientY: 100, pointerId: 7 });
  doc.dispatchEvent({ type: "pointerup", target: canvas, clientX: 140, clientY: 100, pointerId: 7 });

  assert.deepStrictEqual(
    [group.position.x, group.position.y, group.position.z],
    [2, 3, -4]
  );
  const stored = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY));
  assert.deepStrictEqual([stored.x, stored.y, stored.z], [2, 3, -4]);

  // A fresh instance restores the persisted position on open.
  p.dispose();
  const p2 = create();
  p2.open();
  const group2 = builderStub.lastBuiltGroup();
  assert.deepStrictEqual(
    [group2.position.x, group2.position.y, group2.position.z],
    [2, 3, -4]
  );
});

test("click without drag triggers wave; drag does not", () => {
  const p = create();
  p.open();
  THREE.Raycaster.__hits = [{ point: new THREE.Vector3(0, 0, 0) }];
  THREE.Raycaster.__planeResult = new THREE.Vector3(0, 0, 0);

  // Click: down + up with (almost) no movement.
  doc.dispatchEvent({ type: "pointerdown", target: canvas, clientX: 200, clientY: 200, pointerId: 9, button: 0 });
  doc.dispatchEvent({ type: "pointerup", target: canvas, clientX: 202, clientY: 201, pointerId: 9 });
  assert.deepStrictEqual(motionStub.calls.trigger, ["wave"]);

  // Drag: down, move past the click threshold, up — no wave.
  motionStub.calls.trigger.length = 0;
  doc.dispatchEvent({ type: "pointerdown", target: canvas, clientX: 200, clientY: 200, pointerId: 10, button: 0 });
  doc.dispatchEvent({ type: "pointermove", target: canvas, clientX: 300, clientY: 200, pointerId: 10 });
  doc.dispatchEvent({ type: "pointerup", target: canvas, clientX: 300, clientY: 200, pointerId: 10 });
  assert.deepStrictEqual(motionStub.calls.trigger, []);
});

test("pointerdown on non-canvas targets is ignored", () => {
  const p = create();
  p.open();
  THREE.Raycaster.__hits = [{ point: new THREE.Vector3(0, 0, 0) }];
  const panel = makeElement("div");
  doc.dispatchEvent({ type: "pointerdown", target: panel, clientX: 200, clientY: 200, pointerId: 11, button: 0 });
  doc.dispatchEvent({ type: "pointerup", target: panel, clientX: 200, clientY: 200, pointerId: 11 });
  assert.deepStrictEqual(motionStub.calls.trigger, []);
});

test("Escape closes the presence", () => {
  const p = create();
  p.open();
  assert.equal(p.isOpen(), true);
  doc.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(p.isOpen(), false);
});

test("close chip closes the presence", () => {
  const p = create();
  p.open();
  const chip = hudRoot.children[0];
  chip.click();
  assert.equal(p.isOpen(), false);
  assert.equal(chip.style.display, "none");
});

test("dispose removes everything and clears the singleton", () => {
  const p = create();
  p.open();
  const group = builderStub.lastBuiltGroup();
  const chip = hudRoot.children[0];
  assert.ok(scene.added.includes(group));

  p.dispose();

  assert.equal(p.isOpen(), false);
  assert.ok(!scene.added.includes(group), "group removed from scene");
  assert.equal(chip.removed, true);
  assert.equal(builderStub.calls.disposed, 1);
  assert.equal(doc.__listenerCount("pointerdown"), 0);
  assert.equal(doc.__listenerCount("pointermove"), 0);
  assert.equal(doc.__listenerCount("pointerup"), 0);
  assert.equal(doc.__listenerCount("keydown"), 0);

  api = createPhotoMascotPresence({ scene, camera, hudRoot });
  assert.notEqual(api, p);
});

test("mobile: onOpen fires on open (one-floating-panel rule)", () => {
  mobileMatches = true;
  let calls = 0;
  const p = create({ onOpen: () => { calls += 1; } });
  p.open();
  assert.equal(calls, 1);
  p.close();
  p.open();
  assert.equal(calls, 2);
});

test("desktop: onOpen does not fire", () => {
  mobileMatches = false;
  let calls = 0;
  const p = create({ onOpen: () => { calls += 1; } });
  p.open();
  assert.equal(calls, 0);
});

test("update applies the motion sample and faces the camera", () => {
  const p = create();
  p.open();
  p.update(1.25, 0.016);
  assert.equal(motionStub.calls.sample, 1);
  assert.equal(builderStub.calls.applyMotion.length, 1);
  assert.deepStrictEqual(builderStub.calls.applyMotion[0], motionStub.lastSample);
  assert.equal(builderStub.calls.faceCamera.length, 1);
  assert.equal(builderStub.calls.faceCamera[0], camera);
  const chip = hudRoot.children[0];
  assert.equal(chip.style.display, "block");
});

test("update is a safe no-op while closed", () => {
  const p = create();
  p.update(1.25, 0.016); // must not throw
  assert.equal(motionStub.calls.sample, 0);
});

test("setLook syncs the photo set and re-subscribes the builder texture", () => {
  const p = create();
  p.open();
  p.setLook("look-3");
  assert.equal(photoSetStub.getMascotLook(), "look-3");
  // The presence maps the look id to the photo texture URL for the builder.
  assert.ok(builderStub.calls.setLook.includes("look-3.png"));
  assert.equal(p.getLook(), "look-3");
});

test("setTilt is a safe no-op before open and forwards to the builder after open", () => {
  const p = create();
  p.setTilt(0.5, -0.25); // must not throw before the lazy build
  assert.deepStrictEqual(builderStub.calls.setTilt, []);
  p.open();
  p.setTilt(0.5, -0.25);
  assert.deepStrictEqual(builderStub.calls.setTilt, [[0.5, -0.25]]);
});

test("corrupt stored position is ignored", () => {
  globalThis.localStorage.setItem(STORAGE_KEY, "not-json{");
  const p = create();
  p.open(); // must not throw
  const group = builderStub.lastBuiltGroup();
  assert.ok(Number.isFinite(group.position.x));
  assert.ok(Number.isFinite(group.position.y));
  assert.ok(Number.isFinite(group.position.z));
});
