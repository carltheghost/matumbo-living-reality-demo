/**
 * tests/photo-mascot-mount.test.mjs - Reality Lens Ω
 *
 * DOM-free tests for src/render/photo-mascot-mount.js (node:test + node:assert).
 * No jsdom, no browser: Image/document/rAF/canvas are hand-rolled stubs.
 *
 * The mount module's imports are routed through ./photo-mascot-stubs.mjs:
 *   "three"                  -> minimal stub
 *   photo-mascot-presence.js -> instrumented fake (GPT-M4 API shape)
 *   photo-mascot-set.js      -> REAL module, so preloadPhotos laziness is genuine
 *
 * Run: node --test tests/photo-mascot-mount.test.mjs
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register("./photo-mascot-stubs.mjs", import.meta.url);

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

let imageConstructions = 0;

class StubImage {
  constructor() {
    imageConstructions += 1;
    this.__src = "";
    this.onload = null;
    this.onerror = null;
    this.complete = false;
    this.__listeners = new Map();
  }
  set src(value) {
    this.__src = String(value);
    queueMicrotask(() => {
      this.complete = true;
      const fns = [...(this.__listeners.get("load") || [])];
      if (typeof this.onload === "function") fns.push(this.onload);
      for (const fn of fns) {
        try {
          fn.call(this, { type: "load", target: this });
        } catch {
          // A stub listener must never break preloading.
        }
      }
    });
  }
  get src() {
    return this.__src;
  }
  addEventListener(type, fn) {
    if (!this.__listeners.has(type)) this.__listeners.set(type, []);
    this.__listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const arr = this.__listeners.get(type) || [];
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
  decode() {
    return Promise.resolve();
  }
}

function makeStubButton() {
  const listeners = new Map();
  const classSet = new Set();
  const button = {
    tagName: "BUTTON",
    type: "",
    textContent: "",
    style: {},
    parentNode: null,
    __removed: false,
    __attributes: {},
    __listenerCount(type) {
      return (listeners.get(type) || []).length;
    },
    click() {
      const fns = [...(listeners.get("click") || [])];
      for (const fn of fns) fn({ type: "click", preventDefault() {} });
    },
  };
  button.classList = {
    add(...names) {
      for (const n of names) classSet.add(n);
    },
    remove(...names) {
      for (const n of names) classSet.delete(n);
    },
    toggle(name, force) {
      const on = force === undefined ? !classSet.has(name) : !!force;
      if (on) classSet.add(name);
      else classSet.delete(name);
      return on;
    },
    contains(name) {
      return classSet.has(name);
    },
  };
  button.setAttribute = (key, value) => {
    button.__attributes[String(key)] = String(value);
  };
  button.getAttribute = (key) => {
    const k = String(key);
    return Object.prototype.hasOwnProperty.call(button.__attributes, k)
      ? button.__attributes[k]
      : null;
  };
  button.addEventListener = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  };
  button.removeEventListener = (type, fn) => {
    const arr = listeners.get(type) || [];
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  };
  button.remove = () => {
    button.__removed = true;
    if (button.parentNode && typeof button.parentNode.removeChild === "function") {
      button.parentNode.removeChild(button);
    }
  };
  return button;
}

function makeStubElement(tagName) {
  const listeners = new Map();
  const el = {
    tagName: String(tagName).toUpperCase(),
    style: {},
    children: [],
    parentNode: null,
    textContent: "",
  };
  el.classList = {
    add() {},
    remove() {},
    toggle() {
      return false;
    },
    contains() {
      return false;
    },
  };
  el.setAttribute = () => {};
  el.getAttribute = () => null;
  el.addEventListener = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, []);
    listeners.get(type).push(fn);
  };
  el.removeEventListener = (type, fn) => {
    const arr = listeners.get(type) || [];
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  };
  el.appendChild = (child) => {
    el.children.push(child);
    child.parentNode = el;
    return child;
  };
  el.removeChild = (child) => {
    el.children = el.children.filter((c) => c !== child);
    child.parentNode = null;
    return child;
  };
  el.remove = () => {
    if (el.parentNode && typeof el.parentNode.removeChild === "function") {
      el.parentNode.removeChild(el);
    }
  };
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 });
  el.querySelector = () => null;
  return el;
}

const stubDocument = {
  createElement(tag) {
    return String(tag).toLowerCase() === "button"
      ? makeStubButton()
      : makeStubElement(tag);
  },
  querySelector() {
    return null;
  },
  body: makeStubElement("body"),
};

function makeHudRoot() {
  return makeStubElement("div");
}

function makeStubCanvas(width, height) {
  const w = width || 800;
  const h = height || 600;
  const listeners = new Map();
  return {
    getBoundingClientRect() {
      return { left: 0, top: 0, width: w, height: h };
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = listeners.get(type) || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    __listenerCount(type) {
      return (listeners.get(type) || []).length;
    },
    firePointerMove(clientX, clientY) {
      const fns = [...(listeners.get("pointermove") || [])];
      for (const fn of fns) fn({ type: "pointermove", clientX, clientY });
    },
  };
}

// requestAnimationFrame stub: one-shot callbacks, like the real thing.
let rafNextId = 0;
const rafPending = new Map();
const rafCancelled = [];

function installRafStubs() {
  rafNextId = 0;
  rafPending.clear();
  rafCancelled.length = 0;
  globalThis.requestAnimationFrame = (cb) => {
    rafNextId += 1;
    const id = rafNextId;
    rafPending.set(id, (...args) => {
      rafPending.delete(id);
      cb(...args);
    });
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    rafCancelled.push(id);
    rafPending.delete(id);
  };
}

function resetState() {
  imageConstructions = 0;
  globalThis.__createdPresences = [];
  globalThis.__photoMascotFactoryShouldThrow = false;
  installRafStubs();
}

async function waitFor(condition, timeoutMs) {
  const limit = timeoutMs || 2000;
  const start = Date.now();
  for (;;) {
    if (condition()) return;
    if (Date.now() - start > limit) throw new Error("waitFor: condition not met in time");
    await new Promise((r) => setTimeout(r, 5));
  }
}

function latestPresence() {
  const list = globalThis.__createdPresences || [];
  return list[list.length - 1];
}

function callsOf(presence, name) {
  return presence.__calls.filter((c) => c[0] === name);
}

// Install globals, then load the module under test.
globalThis.Image = StubImage;
globalThis.document = stubDocument;

const { mountPhotoMascot } = await import("../src/render/photo-mascot-mount.js");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetState();
});

test("mountPhotoMascot() never throws at boot, even with no arguments", () => {
  const mount = mountPhotoMascot();
  assert.equal(typeof mount, "function");
});

test("mount resolves { presence: null } with a warning when scene is missing", async () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    const mount = mountPhotoMascot({ scene: null, camera: {}, hudRoot: makeHudRoot() });
    const result = await mount();
    assert.equal(result.presence, null);
    assert.equal(typeof result.unmount, "function");
    assert.equal(typeof result.tick, "function");
    assert.equal((globalThis.__createdPresences || []).length, 0);
    result.unmount();
    result.tick(0, 0);
    assert.ok(
      warnings.some((w) => w.includes("[photo-mascot-mount]")),
      "expected a [photo-mascot-mount] warning"
    );
  } finally {
    console.warn = originalWarn;
  }
});

test("mount resolves { presence: null } when camera is missing", async () => {
  const result = await mountPhotoMascot({ scene: {}, camera: null })();
  assert.equal(result.presence, null);
  result.unmount();
});

test("mount degrades gracefully when the presence factory throws", async () => {
  globalThis.__photoMascotFactoryShouldThrow = true;
  try {
    const result = await mountPhotoMascot({
      scene: {},
      camera: {},
      hudRoot: makeHudRoot(),
      canvas: makeStubCanvas(),
    })();
    assert.equal(result.presence, null);
    result.unmount();
  } finally {
    globalThis.__photoMascotFactoryShouldThrow = false;
  }
});

test("mount is lazy: no Image constructions before the first open", async () => {
  const hudRoot = makeHudRoot();
  const canvas = makeStubCanvas();
  const { presence, unmount } = await mountPhotoMascot({
    scene: {},
    camera: {},
    hudRoot,
    canvas,
  })();
  try {
    assert.ok(presence, "presence should be created at mount");
    assert.equal(imageConstructions, 0, "preloadPhotos must not run at boot");

    hudRoot.children[0].click(); // first open -> lazy preload
    await waitFor(() => imageConstructions > 0);
    await waitFor(() => callsOf(presence, "open").length === 1);
  } finally {
    unmount();
  }
});

test("exactly one presence is created with the given scene and camera", async () => {
  const scene = { __tag: "scene" };
  const camera = { __tag: "camera" };
  const { unmount } = await mountPhotoMascot({
    scene,
    camera,
    hudRoot: makeHudRoot(),
    canvas: makeStubCanvas(),
  })();
  try {
    assert.equal((globalThis.__createdPresences || []).length, 1);
    const args = latestPresence().__args;
    assert.equal(args.scene, scene);
    assert.equal(args.camera, camera);
  } finally {
    unmount();
  }
});

test("HUD button toggles the presence and notifies onOpenPanel", async () => {
  const hudRoot = makeHudRoot();
  const canvas = makeStubCanvas();
  const openedPanels = [];
  const { presence, unmount } = await mountPhotoMascot({
    scene: {},
    camera: {},
    hudRoot,
    canvas,
    onOpenPanel: (id) => openedPanels.push(id),
  })();
  try {
    const button = hudRoot.children[0];
    assert.equal(button.tagName, "BUTTON");
    assert.equal(button.textContent, "MASCOT");
    assert.equal(button.getAttribute("aria-label"), "Toggle mascot");
    assert.equal(button.style.minWidth, "44px");
    assert.equal(button.style.minHeight, "44px");
    assert.equal(button.getAttribute("aria-pressed"), "false");

    button.click();
    await waitFor(() => callsOf(presence, "open").length === 1);
    assert.deepStrictEqual(openedPanels, ["mascot"]);
    assert.equal(button.getAttribute("aria-pressed"), "true");
    const imagesAfterFirstOpen = imageConstructions;

    button.click();
    await waitFor(() => callsOf(presence, "close").length === 1);
    assert.equal(button.getAttribute("aria-pressed"), "false");

    button.click();
    await waitFor(() => callsOf(presence, "open").length === 2);
    assert.equal(
      imageConstructions,
      imagesAfterFirstOpen,
      "photos must not preload again on the second open"
    );
  } finally {
    unmount();
  }
});

test("pointermove over the canvas feeds setTilt with normalized coords", async () => {
  const hudRoot = makeHudRoot();
  const canvas = makeStubCanvas(800, 600);
  const { presence, unmount } = await mountPhotoMascot({
    scene: {},
    camera: {},
    hudRoot,
    canvas,
  })();
  try {
    canvas.firePointerMove(400, 300);
    assert.equal(callsOf(presence, "setTilt").length, 0, "no tilt while closed");

    hudRoot.children[0].click();
    await waitFor(() => callsOf(presence, "open").length === 1);

    canvas.firePointerMove(600, 150);
    const tilts = callsOf(presence, "setTilt");
    assert.ok(tilts.length > 0, "setTilt should be fed while open");
    const last = tilts[tilts.length - 1];
    assert.equal(last[1], 0.5); // (600 / 800) * 2 - 1
    assert.equal(last[2], 0.5); // -(((150 / 600) * 2 - 1))
  } finally {
    unmount();
  }
});

test("unmount stops the loop, disposes the presence, and removes the button", async () => {
  const hudRoot = makeHudRoot();
  const canvas = makeStubCanvas();
  const handle = await mountPhotoMascot({
    scene: {},
    camera: {},
    hudRoot,
    canvas,
  })();
  const presence = handle.presence;
  const button = hudRoot.children[0];

  assert.equal(rafPending.size, 1, "rAF loop should be scheduled at mount");

  const frameId = [...rafPending.keys()][0];
  const frameFn = rafPending.get(frameId);
  frameFn(1000); // drive one frame manually: t = 1s
  const updates = callsOf(presence, "update");
  assert.ok(updates.length > 0, "presence.update should be driven by the loop");
  assert.equal(updates[updates.length - 1][1], 1);

  handle.unmount();

  assert.equal(rafCancelled.length, 1, "the pending rAF should be cancelled");
  assert.equal(rafPending.size, 0, "no frames should remain scheduled");
  assert.equal(presence.__disposed, true, "presence should be disposed");
  assert.equal(button.__removed, true, "HUD button should be removed");
  assert.equal(canvas.__listenerCount("pointermove"), 0, "tilt listener should be removed");

  const updatesBefore = callsOf(presence, "update").length;
  frameFn(2000); // stale frame after unmount must be a no-op
  assert.equal(callsOf(presence, "update").length, updatesBefore);

  handle.unmount(); // idempotent
});

test("an external tick registrar drives presence.update instead of rAF", async () => {
  const hudRoot = makeHudRoot();
  const canvas = makeStubCanvas();
  const registered = [];
  const released = [];
  const handle = await mountPhotoMascot({
    scene: {},
    camera: {},
    hudRoot,
    canvas,
    tick: (fn) => {
      registered.push(fn);
      return () => released.push(true);
    },
  })();
  try {
    assert.equal(registered.length, 1);
    assert.equal(rafPending.size, 0, "no internal rAF when an external tick is provided");

    registered[0](2.5, 0.016);
    assert.ok(
      callsOf(handle.presence, "update").some((c) => c[1] === 2.5 && c[2] === 0.016),
      "external tick should drive presence.update"
    );

    handle.tick(3, 0.032);
    assert.ok(
      callsOf(handle.presence, "update").some((c) => c[1] === 3 && c[2] === 0.032),
      "handle.tick should drive presence.update manually"
    );

    handle.unmount();
    assert.equal(released.length, 1, "external tick should be released on unmount");
  } finally {
    handle.unmount();
  }
});

test("mount works without hudRoot (button skipped, presence still mounts)", async () => {
  const { presence, unmount } = await mountPhotoMascot({
    scene: {},
    camera: {},
    canvas: makeStubCanvas(),
  })();
  try {
    assert.ok(presence);
  } finally {
    unmount();
  }
});
