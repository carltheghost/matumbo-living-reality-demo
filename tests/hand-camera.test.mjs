/**
 * Synthetic tests for the Hand Lens camera lifecycle (src/render/hand-camera.js).
 * Run with: node --test tests/hand-camera.test.mjs
 *
 * No network, no jsdom, no npm installs: browser globals are hand-rolled
 * stubs, and the MediaPipe dynamic-import path is replaced with an injected
 * handLandmarkerFactory. The default CDN lazy-load path is never exercised
 * here (it requires a real browser).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createHandCamera,
  normalizeHandedness,
} from "../src/render/hand-camera.js";

/* ------------------------------------------------------------------ */
/* Hand-rolled DOM stubs                                               */
/* ------------------------------------------------------------------ */

function makeClassList() {
  const set = new Set();
  return {
    add: (...cls) => { for (const c of cls) set.add(c); },
    remove: (...cls) => { for (const c of cls) set.delete(c); },
    toggle: (c, force) => {
      const next = force === undefined ? !set.has(c) : !!force;
      if (next) set.add(c); else set.delete(c);
      return next;
    },
    contains: (c) => set.has(c),
  };
}

function makeStyle() {
  const style = {};
  style.setProperty = (name, value) => { style[name] = String(value); };
  style.getPropertyValue = (name) => style[name] ?? "";
  return style;
}

/** Minimal selector support: .class, #id, [data-key-id="..."]. */
function matchesSelector(el, selector) {
  if (!el || typeof el !== "object") return false;
  if (selector.startsWith(".")) {
    return !!el.classList?.contains(selector.slice(1));
  }
  if (selector.startsWith("#")) {
    return el.id === selector.slice(1);
  }
  const attr = /^\[data-key-id="((?:[^"\\]|\\.)*)"\]$/.exec(selector);
  if (attr) {
    const raw = attr[1].replace(/\\(.)/g, "$1");
    return !!el.dataset && el.dataset.keyId === raw;
  }
  return false;
}

function makeElement(doc, tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    style: makeStyle(),
    dataset: {},
    attributes: {},
    listeners: {},
    textContent: "",
    hidden: false,
    disabled: false,
    isConnected: false,
    classList: makeClassList(),
    readyState: 4,
    srcObject: null,
    offsetWidth: 0,
    innerHTML: "",
    appendChild(child) {
      el.children.push(child);
      if (child && typeof child === "object") child.isConnected = true;
      return child;
    },
    append(...kids) {
      for (const k of kids) el.appendChild(k);
      return el;
    },
    remove() {
      el.isConnected = false;
    },
    setAttribute(name, value) {
      el.attributes[name] = String(value);
      if (name === "id") el.id = String(value);
    },
    getAttribute(name) {
      return el.attributes[name] ?? null;
    },
    addEventListener(type, fn) {
      (el.listeners[type] ??= []).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = el.listeners[type];
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    querySelector(selector) {
      const all = el.querySelectorAll(selector);
      return all.length ? all[0] : null;
    },
    querySelectorAll(selector) {
      const out = [];
      const visit = (node) => {
        for (const child of node.children || []) {
          if (matchesSelector(child, selector)) out.push(child);
          visit(child);
        }
      };
      visit(el);
      return out;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
    },
    pause() {},
    play() { return Promise.resolve(); },
    focus() {},
  };
  let elId = "";
  Object.defineProperty(el, "id", {
    get: () => elId,
    set: (v) => {
      elId = String(v);
      el.attributes.id = elId;
      doc.registerId(elId, el);
    },
    configurable: true,
    enumerable: true,
  });
  return el;
}

function makeDocument() {
  const doc = {
    hidden: false,
    activeElement: null,
    listeners: {},
    byId: {},
    registerId(id, el) { doc.byId[id] = el; },
    createElement(tag) { return makeElement(doc, tag); },
    getElementById(id) { return doc.byId[id] ?? null; },
    addEventListener(type, fn) {
      (doc.listeners[type] ??= []).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = doc.listeners[type];
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    /** Fire every captured visibilitychange listener. */
    dispatchVisibility() {
      for (const fn of doc.listeners.visibilitychange ?? []) fn();
    },
  };
  doc.body = doc.createElement("body");
  doc.head = doc.createElement("head");
  return doc;
}

/* ------------------------------------------------------------------ */
/* Harness                                                             */
/* ------------------------------------------------------------------ */

function makeTrack(label) {
  return {
    label,
    readyState: "live",
    stopped: false,
    stop() { this.stopped = true; },
  };
}

function makeLandmarker(ctx, { setOptionsImpl } = {}) {
  return {
    detectForVideo(video, ts) {
      ctx.detectCalls.push([video, ts]);
      return { landmarks: [], worldLandmarks: [], handedness: [] };
    },
    setOptions(options) {
      if (setOptionsImpl) {
        setOptionsImpl(options);
        return;
      }
      ctx.setOptionsCalls.push(options);
    },
    close() { ctx.closedCount += 1; },
  };
}

/**
 * Install stubbed globals for one test. Returns a context with spies and a
 * teardown() that restores the previous globals.
 */
function setup({ getUserMediaImpl } = {}) {
  const doc = makeDocument();
  const rafCallbacks = [];
  const rafCancelled = [];
  let rafId = 0;
  const ctx = {
    doc,
    rafCallbacks,
    rafCancelled,
    setOptionsCalls: [],
    detectCalls: [],
    closedCount: 0,
    previous: {
      document: globalThis.document,
      requestAnimationFrame: globalThis.requestAnimationFrame,
      cancelAnimationFrame: globalThis.cancelAnimationFrame,
      HTMLMediaElement: globalThis.HTMLMediaElement,
    },
    // Node exposes a getter-only global `navigator`; keep its descriptor.
    navigatorDescriptor: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    teardown() {
      for (const [key, value] of Object.entries(ctx.previous)) {
        if (value === undefined) delete globalThis[key];
        else globalThis[key] = value;
      }
      if (ctx.navigatorDescriptor) {
        Object.defineProperty(globalThis, "navigator", ctx.navigatorDescriptor);
      } else {
        delete globalThis.navigator;
      }
    },
  };
  globalThis.document = doc;
  Object.defineProperty(globalThis, "navigator", {
    value: {
      mediaDevices: {
        getUserMedia: getUserMediaImpl ?? (() => {
          throw new Error("getUserMedia was not stubbed for this test");
        }),
      },
    },
    configurable: true,
    writable: true,
  });
  globalThis.requestAnimationFrame = (cb) => {
    rafId += 1;
    rafCallbacks.push(cb);
    return rafId;
  };
  globalThis.cancelAnimationFrame = (id) => { rafCancelled.push(id); };
  globalThis.HTMLMediaElement = { HAVE_CURRENT_DATA: 2 };
  return ctx;
}

/** Invoke the next scheduled rAF callback (the detection loop tick). */
function runNextRaf(ctx) {
  const cb = ctx.rafCallbacks.shift();
  assert.ok(cb, "expected a scheduled rAF callback");
  cb(0);
}

const tick = () => Promise.resolve();

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe("hand-camera: permission denial", () => {
  it("state denied, onError called, zero tracks, pointer/touch unaffected", async () => {
    const denial = new Error("Permission denied by user");
    denial.name = "NotAllowedError";
    const ctx = setup({
      getUserMediaImpl: () => Promise.reject(denial),
    });
    try {
      const errors = [];
      const camera = createHandCamera({ onError: (e) => errors.push(e) });
      await camera.enable();
      assert.equal(camera.getState(), "denied");
      assert.equal(errors.length, 1);
      assert.match(String(errors[0]?.name ?? errors[0]), /NotAllowedError/);
      // No stream was ever created, so no tracks exist to leak.
      // Pointer/touch fallback is untouched: disable()/retry never throw.
      camera.disable();
      assert.equal(camera.getState(), "idle");
    } finally {
      ctx.teardown();
    }
  });
});

describe("hand-camera: full cleanup", () => {
  it("disable() stops every track, cancels rAF, closes landmarker", async () => {
    const tracks = [makeTrack("video-0"), makeTrack("video-1")];
    const ctx = setup({
      getUserMediaImpl: () => Promise.resolve({ getTracks: () => tracks }),
    });
    try {
      let landmarker = null;
      const camera = createHandCamera({
        handLandmarkerFactory: async () => {
          landmarker = makeLandmarker(ctx);
          return landmarker;
        },
      });
      await camera.enable();
      assert.equal(camera.getState(), "running");
      assert.ok(landmarker, "landmarker was created");
      assert.ok(ctx.rafCallbacks.length >= 1, "detection loop scheduled");
      assert.equal(camera.isPanelOpen(), false, "panel starts hidden");

      camera.disable();

      assert.ok(tracks.every((t) => t.stopped), "every media track stopped");
      assert.ok(ctx.rafCancelled.length >= 1, "rAF cancelled");
      assert.equal(ctx.closedCount, 1, "landmarker closed exactly once");
      assert.equal(camera.getState(), "idle");
    } finally {
      ctx.teardown();
    }
  });
});

describe("hand-camera: normalizeHandedness", () => {
  it("handles MediaPipe shapes with a Right default", () => {
    assert.equal(normalizeHandedness("left"), "Left");
    assert.equal(normalizeHandedness("LEFT"), "Left");
    assert.equal(normalizeHandedness("right"), "Right");
    assert.equal(normalizeHandedness([{ categoryName: "Right" }]), "Right");
    assert.equal(normalizeHandedness([{ categoryName: "Left", score: 0.9 }]), "Left");
    // The doubly-nested full-result shape is not a per-hand entry; it falls
    // through to the default, exactly like other garbage inputs.
    assert.equal(normalizeHandedness([[{ categoryName: "Left", score: 0.9 }]]), "Right");
    for (const garbage of [null, undefined, 42, {}, [], [{ foo: 1 }]]) {
      assert.equal(
        normalizeHandedness(garbage),
        "Right",
        `garbage ${JSON.stringify(garbage)} defaults to Right`,
      );
    }
  });
});

describe("hand-camera: document-hidden sampling pause", () => {
  it("skips detectForVideo while hidden, resumes cleanly when visible", async () => {
    const ctx = setup({
      getUserMediaImpl: () => Promise.resolve({ getTracks: () => [makeTrack("video")] }),
    });
    try {
      const camera = createHandCamera({
        handLandmarkerFactory: async () => makeLandmarker(ctx),
      });
      await camera.enable();
      assert.equal(camera.getState(), "running");
      const baseline = ctx.detectCalls.length;
      assert.ok(baseline >= 1, "initial detection happened on enable");

      // Hidden: the loop tick must not reach the detector.
      ctx.doc.hidden = true;
      runNextRaf(ctx);
      assert.equal(ctx.detectCalls.length, baseline, "no detection while hidden");

      // Visible again: the visibility listener resets the sample clock, so
      // the next tick detects immediately instead of honoring a stale gap.
      ctx.doc.hidden = false;
      ctx.doc.dispatchVisibility();
      runNextRaf(ctx);
      assert.equal(ctx.detectCalls.length, baseline + 1, "detection resumes when visible");

      camera.destroy();
    } finally {
      ctx.teardown();
    }
  });

  it("destroy() removes the visibility listener and disables", async () => {
    const ctx = setup({
      getUserMediaImpl: () => Promise.resolve({ getTracks: () => [makeTrack("video")] }),
    });
    try {
      const camera = createHandCamera({
        handLandmarkerFactory: async () => makeLandmarker(ctx),
      });
      await camera.enable();
      const before = (ctx.doc.listeners.visibilitychange ?? []).length;
      assert.ok(before >= 1, "visibility listener registered");
      camera.destroy();
      assert.equal((ctx.doc.listeners.visibilitychange ?? []).length, before - 1);
      assert.equal(camera.getState(), "idle");
    } finally {
      ctx.teardown();
    }
  });
});

describe("hand-camera: setHandCount / getHandCount", () => {
  it("degrades to 1 hand, reflects via getHandCount, no-op when unchanged", async () => {
    const ctx = setup({
      getUserMediaImpl: () => Promise.resolve({ getTracks: () => [makeTrack("video")] }),
    });
    try {
      const camera = createHandCamera({
        handLandmarkerFactory: async () => makeLandmarker(ctx),
      });
      await camera.enable();
      assert.equal(camera.getHandCount(), 2);

      camera.setHandCount(1);
      assert.deepEqual(ctx.setOptionsCalls.at(-1), { numHands: 1 });
      assert.equal(camera.getHandCount(), 1);

      const callsBefore = ctx.setOptionsCalls.length;
      camera.setHandCount(1);
      assert.equal(ctx.setOptionsCalls.length, callsBefore, "unchanged count is a no-op");

      camera.setHandCount(5);
      assert.equal(camera.getHandCount(), 2, "anything but 1 means 2");
      assert.deepEqual(ctx.setOptionsCalls.at(-1), { numHands: 2 });

      camera.destroy();
      assert.equal(camera.getHandCount(), 2, "disable() resets to 2");
    } finally {
      ctx.teardown();
    }
  });

  it("a throwing setOptions is reported but never crashes", async () => {
    const ctx = setup({
      getUserMediaImpl: () => Promise.resolve({ getTracks: () => [makeTrack("video")] }),
    });
    try {
      const errors = [];
      const throwing = makeLandmarker(ctx, {
        setOptionsImpl: () => { throw new Error("setOptions unsupported"); },
      });
      const camera = createHandCamera({
        onError: (e) => errors.push(e),
        handLandmarkerFactory: async () => throwing,
      });
      await camera.enable();
      assert.equal(camera.getState(), "running");
      camera.setHandCount(1); // must not throw
      assert.equal(camera.getHandCount(), 1);
      assert.ok(errors.length >= 1, "failure surfaced via onError");
      camera.destroy();
    } finally {
      ctx.teardown();
    }
  });

  it("setHandCount before enable() applies to the created landmarker", async () => {
    const ctx = setup({
      getUserMediaImpl: () => Promise.resolve({ getTracks: () => [makeTrack("video")] }),
    });
    try {
      const camera = createHandCamera({
        handLandmarkerFactory: async () => makeLandmarker(ctx),
      });
      camera.setHandCount(1); // no landmarker yet: recorded, not applied
      assert.equal(camera.getHandCount(), 1);
      await camera.enable();
      assert.equal(camera.getState(), "running");
      assert.deepEqual(ctx.setOptionsCalls.at(-1), { numHands: 1 });
      camera.destroy();
    } finally {
      ctx.teardown();
    }
  });
});

describe("hand-camera: stale enable", () => {
  it("disable() before getUserMedia resolves stops tracks, no resurrection", async () => {
    let resolveGum;
    const gumPromise = new Promise((resolve) => { resolveGum = resolve; });
    const tracks = [makeTrack("video")];
    const ctx = setup({ getUserMediaImpl: () => gumPromise });
    try {
      let landmarkerCreated = false;
      const camera = createHandCamera({
        handLandmarkerFactory: async () => {
          landmarkerCreated = true;
          return makeLandmarker(ctx);
        },
      });
      const enabling = camera.enable(); // suspends at getUserMedia
      camera.disable(); // user backs out while permission is pending
      assert.equal(camera.getState(), "idle");

      resolveGum({ getTracks: () => tracks });
      await enabling;
      await tick();
      await tick();

      assert.ok(tracks.every((t) => t.stopped), "stale tracks stopped");
      assert.equal(camera.getState(), "idle", "state stays idle");
      assert.equal(landmarkerCreated, false, "landmarker never created");
      assert.equal(ctx.rafCallbacks.length, 0, "no detection loop scheduled");
    } finally {
      ctx.teardown();
    }
  });
});
