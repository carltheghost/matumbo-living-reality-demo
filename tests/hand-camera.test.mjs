/**
 * Synthetic tests for the Hand Lens camera lifecycle (src/render/hand-camera.js).
 * Run with: node --test tests/hand-camera.test.mjs
 *
 * No network, no jsdom, no npm installs: browser globals are hand-rolled
 * stubs, and the MediaPipe dynamic-import path is replaced with an injected
 * handLandmarkerFactory. The production local worker/model path is exercised
 * by the separate browser harness, not by these lifecycle tests.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createHandCamera,
  normalizeHandedness,
  HAND_RESULT_MAX_AGE_MS,
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
    currentTime: 0,
    videoWidth: 640,
    videoHeight: 480,
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
    removeAttribute(name) { delete el.attributes[name]; if (name === "src") el.src = ""; },
    replaceChildren(...children) { el.children = []; el.append(...children); },
    addEventListener(type, fn) {
      (el.listeners[type] ??= []).push(fn);
    },
    removeEventListener(type, fn) {
      const arr = el.listeners[type];
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    dispatch(type) { for (const fn of [...(el.listeners[type] || [])]) fn({ target: el }); },
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
    load() {},
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
    listeners: {},
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
    removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((item) => item !== fn); },
    dispatch(type) { for (const fn of [...(this.listeners[type] || [])]) fn(); },
    getSettings() { return { facingMode: "user" }; },
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
function setup({ getUserMediaImpl, enumerateDevicesImpl, secureContext = true, now } = {}) {
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
      isSecureContext: globalThis.isSecureContext,
      performance: globalThis.performance,
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
        ...(enumerateDevicesImpl ? { enumerateDevices: enumerateDevicesImpl } : {}),
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
  globalThis.isSecureContext = secureContext;
  if (typeof now === "function") globalThis.performance = { now };
  return ctx;
}

/** Invoke the next scheduled rAF callback (the detection loop tick). */
function runNextRaf(ctx) {
  const cb = ctx.rafCallbacks.shift();
  assert.ok(cb, "expected a scheduled rAF callback");
  cb(0);
}

const tick = () => Promise.resolve();

describe("hand-camera: synchronous cancellation at state notifications", () => {
  it("stop from the requesting notification prevents opening a camera prompt", async () => {
    let gum = 0;
    const ctx = setup({ getUserMediaImpl: async () => { gum += 1; return { getTracks: () => [makeTrack("RGB")] }; } });
    const camera = createHandCamera();
    camera.onStateChange((snapshot) => { if (snapshot.state === "requesting") camera.stop(); });
    try {
      await camera.enable();
      assert.equal(gum, 0);
      assert.equal(camera.getState(), "idle");
    } finally { camera.destroy(); ctx.teardown(); }
  });

  it("disabling hands at the loading notification prevents model creation while retaining video", async () => {
    let models = 0;
    const track = makeTrack("RGB");
    const ctx = setup({ getUserMediaImpl: async () => ({ getTracks: () => [track] }) });
    const camera = createHandCamera({ handLandmarkerFactory: async () => { models += 1; return makeLandmarker(ctx); } });
    camera.onStateChange((snapshot) => { if (snapshot.handModel.state === "loading") camera.setHandDetectionEnabled(false); });
    try {
      await camera.enable();
      assert.equal(models, 0);
      assert.equal(camera.getState(), "running");
      assert.equal(camera.getSnapshot().handModel.state, "disabled");
      assert.equal(track.stopped, false);
    } finally { camera.destroy(); ctx.teardown(); }
  });
});

describe("hand-camera: late inference does not resurrect controls", () => {
  it("old positive model results cancel hands universally while fresh video and subsequent detections continue", async () => {
    let time = 0, detections = 0;
    const late = deferred();
    const positive = { landmarks: [Array.from({ length: 21 }, () => ({ x: 0.2, y: 0.4, z: 0 }))], handedness: [[{ categoryName: "Right" }]] };
    const ctx = setup({ now: () => time, getUserMediaImpl: async () => ({ getTracks: () => [makeTrack("RGB")] }) });
    const camera = createHandCamera({ handLandmarkerFactory: async () => ({
      ...makeLandmarker(ctx),
      detectForVideo: () => ++detections === 1 ? { landmarks: [] } : detections === 2 ? late.promise : positive,
    }) });
    const hands = [], frames = [];
    camera.onHands((frame) => hands.push(frame));
    camera.onVideoFrame((frame) => frames.push(frame));
    try {
      await camera.enable();
      const preview = ctx.doc.getElementById("hand-lens-preview");
      time = 100; preview.currentTime = 0.04; runNextRaf(ctx);
      assert.equal(detections, 2);
      time = 150; preview.currentTime = 0.08; runNextRaf(ctx);
      assert.equal(frames.length, 3, "eyes receive fresh source frames while hand inference is pending");
      time = 100 + HAND_RESULT_MAX_AGE_MS + 1;
      late.resolve(positive); await flush();
      assert.equal(hands.some((frame) => frame.hands.length > 0), false);
      assert.deepEqual(hands.at(-1).hands, []);
      assert.equal(hands.at(-1).stale, true);
      assert.equal(hands.at(-1).timestamp, time, "cancellation uses current time, not the old capture time");
      assert.equal(hands.at(-1).latencyMs, HAND_RESULT_MAX_AGE_MS + 1);
      assert.equal(camera.getSnapshot().handModel.state, "ready");
      assert.equal(camera.getState(), "running");
      time += 50; preview.currentTime = 0.12; runNextRaf(ctx); await flush();
      assert.equal(hands.at(-1).hands[0].landmarks.length, 21, "fresh subsequent results still work");
      assert.equal(hands.at(-1).stale, undefined);
    } finally { camera.destroy(); ctx.teardown(); }
  });

  it("pause releases hands and suppresses an inference finishing while paused", async () => {
    const late = deferred();
    const ctx = setup({ getUserMediaImpl: async () => ({ getTracks: () => [makeTrack("RGB")] }) });
    let detections = 0;
    const camera = createHandCamera({ handLandmarkerFactory: async () => ({
      ...makeLandmarker(ctx),
      detectForVideo: () => ++detections === 1 ? { landmarks: [] } : late.promise,
    }) });
    const hands = [];
    camera.onHands((frame) => hands.push(frame));
    try {
      await camera.enable();
      const preview = ctx.doc.getElementById("hand-lens-preview");
      ctx.doc.dispatchVisibility(); preview.currentTime = 0.04; runNextRaf(ctx);
      assert.equal(detections, 2);
      camera.pause();
      late.resolve({ landmarks: [[{ x: 0.1, y: 0.2, z: 0 }]] });
      await flush();
      assert.equal(camera.getState(), "paused");
      assert.equal(hands.some((frame) => frame.hands.length > 0), false);
      assert.equal(camera.getSnapshot().handModel.state, "ready");
    } finally { camera.destroy(); ctx.teardown(); }
  });
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const videoFile = () => new Blob(["local video fixture"], { type: "video/webm" });

describe("hand-camera: source controls and privacy", () => {
  it("selection/panel opening are inert, device choices omit persistent IDs, close retains the panel", async () => {
    let requests = 0, models = 0;
    const ctx = setup({
      getUserMediaImpl: () => { requests += 1; return Promise.resolve({ getTracks: () => [makeTrack("USB camera")] }); },
      enumerateDevicesImpl: async () => [
        { kind: "audioinput", deviceId: "private-mic-id", label: "Microphone" },
        { kind: "videoinput", deviceId: "private-usb-id", label: "USB webcam" },
      ],
    });
    const camera = createHandCamera({ handLandmarkerFactory: async () => { models += 1; return makeLandmarker(ctx); } });
    try {
      const panel = camera.getPanelElement();
      camera.setPanelOpen(true);
      const choices = await camera.refreshDevices();
      assert.deepEqual(choices.map((choice) => choice.label), ["USB webcam"]);
      await camera.selectCamera({ deviceId: choices[0].key });
      assert.equal(requests, 0);
      assert.equal(models, 0);
      assert.equal(camera.getState(), "idle");
      assert.doesNotMatch(JSON.stringify(camera.getSnapshot()), /private-usb-id|private-mic-id|deviceId|srcObject/);
      ctx.doc.getElementById("hand-lens-close").dispatch("click");
      assert.equal(camera.getPanelElement(), panel);
      assert.equal(camera.isPanelOpen(), false);
      camera.setPanelOpen(true);
      assert.equal(camera.getPanelElement(), panel);
    } finally { camera.destroy(); ctx.teardown(); }
  });

  it("switching camera releases the old device, requests no microphone, and maps mirror coordinates once", async () => {
    const calls = [], tracks = [];
    const rawPoint = { x: 0.2, y: 0.4, z: 0.1 };
    const ctx = setup({ getUserMediaImpl: async (constraints) => {
      calls.push(constraints);
      const track = makeTrack("Camera " + calls.length);
      track.getSettings = () => ({ facingMode: constraints.video.facingMode?.exact || constraints.video.facingMode?.ideal || "user" });
      tracks.push(track);
      return { getTracks: () => [track] };
    } });
    const camera = createHandCamera({ handLandmarkerFactory: async () => ({
      ...makeLandmarker(ctx),
      detectForVideo: () => ({ landmarks: [[rawPoint]], handedness: [[{ categoryName: "Right" }]] }),
    }) });
    const hands = [];
    camera.onHands((frame) => { if (frame.hands.length) hands.push(frame); });
    try {
      await camera.enable();
      const initialSource = camera.getSnapshot().source.id;
      assert.equal(hands.at(-1).hands[0].landmarks[0].x, 0.8);
      assert.equal(hands.at(-1).source.coordinates, "normalized-display");
      assert.equal(rawPoint.x, 0.2, "the model output is not mutated");
      await camera.selectCamera({ facingMode: "environment" });
      assert.equal(tracks[0].stopped, true);
      assert.equal(tracks[1].stopped, false);
      assert.equal(calls[1].audio, false);
      assert.equal(calls[1].video.facingMode.exact, "environment");
      assert.equal(camera.getSnapshot().source.mirrored, false);
      assert.notEqual(camera.getSnapshot().source.id, initialSource);
      assert.equal(hands.at(-1).hands[0].landmarks[0].x, 0.2);
      assert.equal(ctx.doc.getElementById("hand-lens-preview").style.transform, "none");
    } finally { camera.destroy(); ctx.teardown(); }
  });

  it("ephemeral camera options resolve privately to exact device constraints", async () => {
    let constraints;
    const unknownFacingTrack = makeTrack("USB");
    unknownFacingTrack.getSettings = () => ({});
    const ctx = setup({
      enumerateDevicesImpl: async () => [{ kind: "videoinput", deviceId: "private-device", label: "USB" }],
      getUserMediaImpl: async (input) => { constraints = input; return { getTracks: () => [unknownFacingTrack] }; },
    });
    const camera = createHandCamera({ handLandmarkerFactory: async () => makeLandmarker(ctx) });
    try {
      const [choice] = await camera.refreshDevices();
      await camera.selectCamera({ deviceId: choice.key });
      await camera.enable();
      assert.deepEqual(constraints.video.deviceId, { exact: "private-device" });
      assert.equal(constraints.audio, false);
      assert.doesNotMatch(JSON.stringify(camera.getSnapshot()), /private-device/);
      assert.equal(camera.getSnapshot().source.facingMode, null, "unknown physical orientation is not labeled front or rear");
      assert.equal(camera.getSnapshot().source.requestedFacingMode, null);
      assert.equal(camera.getSnapshot().source.deviceLabel, "USB");
      assert.equal(camera.getSnapshot().source.mirrored, true, "manual webcams preserve the default mirror convention");
    } finally { camera.destroy(); ctx.teardown(); }
  });

  it("Rear requests exact environment and reports an unavailable rear camera without silently opening the front", async () => {
    const requests = [];
    const ctx = setup({ getUserMediaImpl: async (constraints) => {
      requests.push(constraints);
      throw Object.assign(new Error("No environment-facing device"), { name: "OverconstrainedError", constraint: "facingMode" });
    } });
    const camera = createHandCamera();
    try {
      await camera.selectCamera({ facingMode: "environment" });
      assert.equal(requests.length, 0, "source selection stays opt-in");
      await camera.enable();
      assert.equal(requests.length, 1, "no implicit fallback to a different camera");
      assert.deepEqual(requests[0].video.facingMode, { exact: "environment" });
      assert.equal(requests[0].audio, false);
      assert.equal(camera.getSnapshot().diagnostic.code, "camera_selection_unavailable");
      assert.match(camera.getSnapshot().diagnostic.message, /rear camera.*unavailable.*Front.*named camera/i);
      assert.equal(camera.getState(), "error");
      assert.equal(camera.getSnapshot().source.facingMode, null);
    } finally { camera.destroy(); ctx.teardown(); }
  });

  it("a successful exact Rear request remains unmirrored without inventing track orientation", async () => {
    const track = makeTrack("Camera");
    track.getSettings = () => ({});
    const ctx = setup({ getUserMediaImpl: async () => ({ getTracks: () => [track] }) });
    const camera = createHandCamera();
    try {
      camera.setHandDetectionEnabled(false);
      await camera.selectCamera({ facingMode: "environment" });
      await camera.enable();
      assert.equal(camera.getState(), "running");
      assert.equal(camera.getSnapshot().source.facingMode, null);
      assert.equal(camera.getSnapshot().source.requestedFacingMode, "environment");
      assert.equal(camera.getSnapshot().source.mirrored, false);
    } finally { camera.destroy(); ctx.teardown(); }
  });

  it("choosing the Front/default device option clears an earlier Rear constraint", async () => {
    const requests = [];
    const ctx = setup({ getUserMediaImpl: async (constraints) => {
      requests.push(constraints); return { getTracks: () => [makeTrack("RGB")] };
    } });
    const camera = createHandCamera();
    try {
      camera.setHandDetectionEnabled(false);
      await camera.selectCamera({ facingMode: "environment" });
      const selector = ctx.doc.getElementById("hand-lens-camera-select");
      selector.value = ""; selector.dispatch("change");
      await camera.enable();
      assert.equal(requests.length, 1);
      assert.deepEqual(requests[0].video.facingMode, { ideal: "user" });
      assert.equal(requests[0].video.deviceId, undefined);
      assert.equal(camera.getSnapshot().source.requestedFacingMode, "user");
    } finally { camera.destroy(); ctx.teardown(); }
  });
});

describe("hand-camera: independently sampled local frame hooks", () => {
  it("emits once per decoded frame, independent of disabled hands and subscriber lifetime", async () => {
    let models = 0;
    const ctx = setup({ getUserMediaImpl: async () => ({ getTracks: () => [makeTrack("RGB")] }) });
    const camera = createHandCamera({ handLandmarkerFactory: async () => { models += 1; return makeLandmarker(ctx); } });
    const frames = [];
    const unsubscribe = camera.onVideoFrame((frame) => frames.push(frame));
    try {
      camera.setHandDetectionEnabled(false);
      await camera.enable();
      assert.equal(camera.getState(), "running");
      assert.equal(camera.getSnapshot().handModel.state, "disabled");
      assert.equal(models, 0);
      assert.equal(frames.length, 1);
      runNextRaf(ctx);
      assert.equal(frames.length, 1, "same video currentTime cannot emit again");
      const preview = ctx.doc.getElementById("hand-lens-preview");
      preview.currentTime = 0.04;
      runNextRaf(ctx);
      assert.equal(frames.length, 2);
      assert.equal(frames[0].video, preview);
      assert.equal(frames[0].source.kind, "camera");
      assert.equal(typeof frames[0].timestamp, "number");
      assert.doesNotMatch(JSON.stringify(camera.getSnapshot()), /srcObject|HTMLVIDEO|RGB.*deviceId/);
      unsubscribe();
      preview.currentTime = 0.08; runNextRaf(ctx);
      assert.equal(frames.length, 2);
    } finally { camera.destroy(); ctx.teardown(); }
  });

  it("uses requestVideoFrameCallback, deduplicates presentedFrames and cancels it on stop", async () => {
    const ctx = setup({ getUserMediaImpl: async () => ({ getTracks: () => [makeTrack("RGB")] }) });
    const originalCreate = ctx.doc.createElement;
    const callbacks = new Map(), cancelled = [];
    let id = 0;
    ctx.doc.createElement = (tag) => {
      const element = originalCreate(tag);
      if (tag === "video") {
        element.requestVideoFrameCallback = (callback) => { const next = ++id; callbacks.set(next, callback); return next; };
        element.cancelVideoFrameCallback = (handle) => { cancelled.push(handle); callbacks.delete(handle); };
      }
      return element;
    };
    const camera = createHandCamera();
    const frames = [];
    camera.onVideoFrame((frame) => frames.push(frame));
    try {
      camera.setHandDetectionEnabled(false);
      await camera.enable();
      assert.equal(ctx.rafCallbacks.length, 0);
      const deliver = (presentedFrames) => {
        const [key, callback] = callbacks.entries().next().value;
        callbacks.delete(key);
        callback(100, { presentedFrames, mediaTime: presentedFrames / 30 });
      };
      deliver(1); deliver(1); deliver(2);
      assert.equal(frames.length, 2);
      camera.stop();
      assert.equal(callbacks.size, 0);
      assert.equal(cancelled.length, 1);
    } finally { camera.destroy(); ctx.teardown(); }
  });

  it("frame hooks keep flowing during model loading/failure and hand sampling throttle", async () => {
    const model = deferred();
    const ctx = setup({ getUserMediaImpl: async () => ({ getTracks: () => [makeTrack("RGB")] }) });
    const camera = createHandCamera({ handLandmarkerFactory: () => model.promise });
    const frames = [];
    camera.onVideoFrame((frame) => frames.push(frame));
    try {
      const enabling = camera.enable();
      await flush();
      assert.equal(camera.getState(), "running");
      assert.equal(camera.getSnapshot().handModel.state, "loading");
      const preview = ctx.doc.getElementById("hand-lens-preview");
      preview.currentTime = 0.04; runNextRaf(ctx);
      assert.equal(frames.length, 2);
      model.reject(new Error("Model unavailable"));
      await enabling;
      assert.equal(camera.getState(), "running");
      assert.equal(camera.getSnapshot().handModel.state, "error");
      camera.setSampleInterval(500);
      preview.currentTime = 0.08; runNextRaf(ctx);
      assert.equal(frames.length, 3);
    } finally { camera.destroy(); ctx.teardown(); }
  });
});

describe("hand-camera: bounded cancellation and late resources", () => {
  it("stop settles an ignored permission prompt; its late stream cannot replace/stop a newer one", async () => {
    const old = deferred();
    const staleTrack = makeTrack("stale"), currentTrack = makeTrack("current");
    let calls = 0;
    const ctx = setup({ getUserMediaImpl: () => ++calls === 1 ? old.promise : Promise.resolve({ getTracks: () => [currentTrack] }) });
    const camera = createHandCamera({ handLandmarkerFactory: async () => makeLandmarker(ctx) });
    try {
      const starting = camera.enable();
      camera.stop();
      await starting;
      assert.equal(camera.getState(), "idle");
      await camera.enable();
      const sourceId = camera.getSnapshot().source.id;
      old.resolve({ getTracks: () => [staleTrack] });
      await flush();
      assert.equal(staleTrack.stopped, true);
      assert.equal(currentTrack.stopped, false);
      assert.equal(camera.getState(), "running");
      assert.equal(camera.getSnapshot().source.id, sourceId);
    } finally { camera.destroy(); ctx.teardown(); }
  });

  it("camera deadline restores controls and closes an uncooperative late stream", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const old = deferred(), track = makeTrack("late");
    const ctx = setup({ getUserMediaImpl: () => old.promise });
    const camera = createHandCamera({ timeouts: { camera: 20 } });
    try {
      const starting = camera.enable();
      t.mock.timers.tick(20);
      await starting;
      assert.equal(camera.getState(), "error");
      assert.equal(camera.getSnapshot().diagnostic.code, "camera_timeout");
      assert.equal(ctx.doc.getElementById("hand-lens-enable").disabled, false);
      old.resolve({ getTracks: () => [track] });
      await flush();
      assert.equal(track.stopped, true);
      assert.equal(camera.getState(), "error");
    } finally { camera.destroy(); ctx.teardown(); }
  });

  it("model deadline keeps local video running and closes a detector which initializes late", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const late = deferred();
    const ctx = setup({ getUserMediaImpl: async () => ({ getTracks: () => [makeTrack("RGB")] }) });
    const camera = createHandCamera({ handLandmarkerFactory: () => late.promise, timeouts: { model: 20 } });
    try {
      const starting = camera.enable();
      await flush();
      assert.equal(camera.getSnapshot().handModel.state, "loading");
      t.mock.timers.tick(20);
      await starting;
      assert.equal(camera.getState(), "running");
      assert.equal(camera.getSnapshot().handModel.errorCode, "model_timeout");
      late.resolve(makeLandmarker(ctx));
      await flush();
      assert.equal(ctx.closedCount, 1);
      assert.equal(camera.getSnapshot().handModel.state, "error");
    } finally { camera.destroy(); ctx.teardown(); }
  });

  it("disabling hands settles pending model startup without stopping the source or keeping its late detector", async () => {
    const late = deferred();
    const track = makeTrack("RGB");
    const ctx = setup({ getUserMediaImpl: async () => ({ getTracks: () => [track] }) });
    const camera = createHandCamera({ handLandmarkerFactory: () => late.promise });
    const releaseFrames = [];
    camera.onHands((frame) => releaseFrames.push(frame));
    try {
      const starting = camera.enable();
      await flush();
      camera.setHandDetectionEnabled(false);
      await starting;
      assert.equal(camera.getState(), "running");
      assert.equal(camera.getSnapshot().handModel.state, "disabled");
      assert.equal(track.stopped, false);
      assert.equal(releaseFrames.at(-1).hands.length, 0);
      late.resolve(makeLandmarker(ctx));
      await flush();
      assert.equal(ctx.closedCount, 1);
      assert.equal(camera.getSnapshot().handModel.state, "disabled");
    } finally { camera.destroy(); ctx.teardown(); }
  });

  it("a playback deadline stops the acquired stream before a late play resolution", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const playback = deferred(), track = makeTrack("RGB");
    const ctx = setup({ getUserMediaImpl: async () => ({ getTracks: () => [track] }) });
    const originalCreate = ctx.doc.createElement;
    ctx.doc.createElement = (tag) => {
      const element = originalCreate(tag);
      if (tag === "video") element.play = () => playback.promise;
      return element;
    };
    const camera = createHandCamera({ timeouts: { playback: 20 } });
    try {
      const starting = camera.enable();
      await flush();
      t.mock.timers.tick(20);
      await starting;
      assert.equal(camera.getSnapshot().diagnostic.code, "playback_timeout");
      assert.equal(track.stopped, true);
      playback.resolve(); await flush();
      assert.equal(camera.getState(), "error");
    } finally { camera.destroy(); ctx.teardown(); }
  });

  it("a pending enumeration is cancelled at stop and cannot publish stale device labels", async () => {
    const enumeration = deferred();
    const ctx = setup({ enumerateDevicesImpl: () => enumeration.promise });
    const camera = createHandCamera();
    try {
      const refreshing = camera.refreshDevices();
      camera.stop();
      await refreshing;
      enumeration.resolve([{ kind: "videoinput", deviceId: "late-id", label: "late label" }]);
      await flush();
      assert.deepEqual(camera.getSnapshot().devices, []);
    } finally { camera.destroy(); ctx.teardown(); }
  });
});

describe("hand-camera: local files and capture loss", () => {
  it("an initially muted track reports unavailable capture and emits no frames until unmute", async () => {
    const track = makeTrack("RGB");
    track.muted = true;
    const ctx = setup({ getUserMediaImpl: async () => ({ getTracks: () => [track] }) });
    const camera = createHandCamera({ handLandmarkerFactory: async () => makeLandmarker(ctx) });
    const frames = [];
    camera.onVideoFrame((frame) => frames.push(frame));
    try {
      await camera.enable();
      assert.equal(camera.getState(), "running", "the source stream exists independently of frame availability");
      assert.equal(camera.getSnapshot().source.available, false);
      assert.equal(camera.getSnapshot().source.playing, false);
      assert.equal(camera.getSnapshot().diagnostic.code, "camera_muted");
      assert.match(camera.getSnapshot().diagnostic.message, /temporarily unavailable.*shutter/i);
      assert.equal(frames.length, 0);
      assert.equal(ctx.detectCalls.length, 0);
      const mutedId = camera.getSnapshot().source.id;
      track.muted = false; track.dispatch("unmute");
      const preview = ctx.doc.getElementById("hand-lens-preview");
      preview.currentTime = 0.04; runNextRaf(ctx); await flush();
      assert.equal(camera.getSnapshot().source.available, true);
      assert.equal(camera.getSnapshot().source.playing, true);
      assert.notEqual(camera.getSnapshot().source.id, mutedId);
      assert.equal(frames.length, 1);
      assert.equal(ctx.detectCalls.length, 1);
    } finally { camera.destroy(); ctx.teardown(); }
  });

  it("local file input requires no camera permission, supports pause/resume and revokes URLs at end", async () => {
    let gum = 0;
    const ctx = setup({ secureContext: false, getUserMediaImpl: () => { gum += 1; throw new Error("must not access camera"); } });
    const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
    const urls = [], revoked = [];
    URL.createObjectURL = () => { const url = "blob:local-" + (urls.length + 1); urls.push(url); return url; };
    URL.revokeObjectURL = (url) => revoked.push(url);
    const camera = createHandCamera({ handLandmarkerFactory: async () => makeLandmarker(ctx) });
    try {
      await camera.setSourceFile(videoFile());
      assert.equal(urls.length, 0, "selection is not playback consent");
      await camera.enable();
      assert.equal(gum, 0);
      assert.equal(camera.getSnapshot().source.kind, "video-file");
      assert.equal(camera.getSnapshot().source.mirrored, false);
      const preview = ctx.doc.getElementById("hand-lens-preview");
      assert.equal(preview.src, urls[0]);
      assert.equal(preview.muted, true);
      assert.equal(preview.srcObject, null);
      camera.pause();
      assert.equal(camera.getState(), "paused");
      await camera.play();
      assert.equal(camera.getState(), "running");
      preview.dispatch("ended");
      assert.equal(camera.getState(), "ended");
      assert.deepEqual(revoked, urls);
      assert.equal(preview.src, "");
      assert.equal(ctx.closedCount, 1);
      assert.doesNotMatch(JSON.stringify(camera.getSnapshot()), /blob:|fixture|fileName/);
      await camera.enable();
      assert.equal(urls.length, 2, "explicit replay gets a fresh temporary URL");
    } finally {
      camera.destroy(); URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; ctx.teardown();
    }
  });

  it("invalid files are rejected before replacing the active source", async () => {
    const track = makeTrack("RGB");
    const ctx = setup({ getUserMediaImpl: async () => ({ getTracks: () => [track] }) });
    const camera = createHandCamera({ handLandmarkerFactory: async () => makeLandmarker(ctx) });
    try {
      await camera.enable();
      assert.throws(() => camera.setSourceFile(new Blob(["text"], { type: "text/plain" })), /local video/);
      assert.equal(camera.getState(), "running");
      assert.equal(track.stopped, false);
    } finally { camera.destroy(); ctx.teardown(); }
  });

  it("camera mute pauses samples and releases hands; unmute and disconnect update source revisions", async () => {
    const track = makeTrack("RGB");
    const ctx = setup({ getUserMediaImpl: async () => ({ getTracks: () => [track] }) });
    const camera = createHandCamera({ handLandmarkerFactory: async () => makeLandmarker(ctx) });
    const frames = [], hands = [];
    camera.onVideoFrame((frame) => frames.push(frame));
    camera.onHands((frame) => hands.push(frame));
    try {
      await camera.enable();
      const oldRevision = camera.getSnapshot().source.id;
      track.dispatch("mute");
      assert.equal(camera.getSnapshot().source.available, false);
      assert.notEqual(camera.getSnapshot().source.id, oldRevision);
      assert.deepEqual(hands.at(-1).hands, []);
      const preview = ctx.doc.getElementById("hand-lens-preview");
      const before = frames.length;
      preview.currentTime = 0.04; runNextRaf(ctx);
      assert.equal(frames.length, before);
      track.dispatch("unmute");
      preview.currentTime = 0.08; runNextRaf(ctx);
      assert.equal(frames.length, before + 1);
      track.dispatch("ended");
      assert.equal(camera.getState(), "error");
      assert.equal(camera.getSnapshot().diagnostic.code, "camera_lost");
      assert.equal(track.stopped, true);
      assert.equal(track.listeners.ended.length, 0);
      assert.deepEqual(hands.at(-1).hands, []);
    } finally { camera.destroy(); ctx.teardown(); }
  });

  it("diagnostics distinguish insecure origin, permission, missing camera and busy hardware", async () => {
    for (const [name, expected] of [["NotAllowedError", "permission_denied"], ["NotFoundError", "no_camera"], ["NotReadableError", "camera_busy"]]) {
      const ctx = setup({ getUserMediaImpl: async () => { throw Object.assign(new Error(name), { name }); } });
      const camera = createHandCamera();
      try { await camera.enable(); assert.equal(camera.getSnapshot().diagnostic.code, expected); }
      finally { camera.destroy(); ctx.teardown(); }
    }
    let calls = 0;
    const ctx = setup({ secureContext: false, getUserMediaImpl: async () => { calls += 1; } });
    const camera = createHandCamera();
    try {
      await camera.enable();
      assert.equal(calls, 0);
      assert.equal(camera.getSnapshot().diagnostic.code, "insecure_origin");
      assert.match(camera.getSnapshot().diagnostic.message, /HTTPS.*phone/i);
    } finally { camera.destroy(); ctx.teardown(); }
  });

  it("destroy is inert to later starts and removes all owned DOM/listeners", async () => {
    let gum = 0;
    const ctx = setup({ getUserMediaImpl: async () => { gum += 1; return { getTracks: () => [makeTrack("RGB")] }; } });
    const camera = createHandCamera();
    try {
      const panel = camera.getPanelElement();
      camera.destroy();
      await camera.enable();
      camera.setPanelOpen(true);
      assert.equal(gum, 0);
      assert.equal(panel.isConnected, false);
      assert.equal(camera.getPanelElement(), null);
      assert.equal(ctx.doc.listeners.visibilitychange.length, 0);
    } finally { ctx.teardown(); }
  });
});

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
      // A resumed source must provide a newly decoded frame. Redisplaying
      // the same frame no longer reruns the detector at screen refresh rate.
      ctx.doc.getElementById("hand-lens-preview").currentTime += 1 / 30;
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
