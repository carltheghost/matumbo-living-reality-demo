import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createWorkerHandDetector } from "../src/render/hand-detector.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function harness({ init = true } = {}) {
  const listeners = {};
  const messages = [];
  let terminations = 0;
  const worker = {
    addEventListener(type, callback) { (listeners[type] ??= new Set()).add(callback); },
    removeEventListener(type, callback) { listeners[type]?.delete(callback); },
    postMessage(message, transfers) {
      messages.push({ message, transfers });
      if (message.type === "init" && init) queueMicrotask(() => respond(message.id, { delegate: "CPU-worker" }));
      if (message.type === "options") queueMicrotask(() => respond(message.id, null));
    },
    terminate() { terminations += 1; },
  };
  function respond(id, result) { for (const fn of listeners.message || []) fn({ data: { id, result } }); }
  return { worker, messages, respond, listeners, get terminations() { return terminations; } };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe("worker cancellation and cold model deadline", () => {
  it("an abort signal terminates a silent initializing worker immediately", async () => {
    const ctx = harness({ init: false });
    const controller = new AbortController();
    const creating = createWorkerHandDetector({ workerFactory: () => ctx.worker, signal: controller.signal });
    const rejected = assert.rejects(creating, { name: "AbortError" });
    controller.abort();
    await rejected;
    assert.equal(ctx.terminations, 1);
    assert.equal(ctx.listeners.message.size, 0);
  });

  it("permits bounded cold landmark warmup, then uses the shorter steady deadline", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const ctx = harness();
    const detector = await createWorkerHandDetector({
      workerFactory: () => ctx.worker, bitmapFactory: async () => ({ close() {} }),
      frameTimeoutMs: 20, coldFrameTimeoutMs: 40,
    });
    try {
      const cold = detector.detectForVideo({}, 100);
      await flush();
      t.mock.timers.tick(30);
      assert.equal(ctx.terminations, 0, "cold inference gets longer than the steady deadline");
      ctx.respond(ctx.messages.at(-1).message.id, { landmarks: [Array.from({ length: 21 }, () => ({ x: 0.2, y: 0.3, z: 0 }))] });
      assert.equal((await cold).landmarks[0].length, 21);
      const steady = detector.detectForVideo({}, 200);
      const rejected = assert.rejects(steady, { code: "hand_frame_timeout" });
      await flush();
      t.mock.timers.tick(20);
      await rejected;
      assert.equal(ctx.terminations, 1);
    } finally { detector.close(); }
  });
});

describe("worker hand detector lifecycle", () => {
  it("initializes the production model contract and allows only one transferable sample at a time", async () => {
    const ctx = harness();
    let captures = 0, bitmapClosed = 0;
    const bitmap = { close() { bitmapClosed += 1; } };
    const detector = await createWorkerHandDetector({
      runtimeUrl: "/local/runtime.mjs", wasmPath: "/local/wasm/", modelPath: "/local/hand.task", numHands: 1,
      workerFactory: () => ctx.worker,
      bitmapFactory: async () => { captures += 1; return bitmap; },
    });
    try {
      assert.equal(detector.delegate, "CPU-worker");
      assert.equal(ctx.messages[0].message.numHands, 1);
      assert.equal(ctx.messages[0].message.modelPath, "/local/hand.task");
      const first = detector.detectForVideo({}, 100);
      await flush();
      assert.equal(await detector.detectForVideo({}, 101), null);
      assert.equal(captures, 1);
      const pending = ctx.messages.at(-1);
      assert.deepEqual(pending.transfers, [bitmap]);
      assert.equal(pending.message.timestamp, 100);
      bitmap.close(); // transfer ownership is released by the worker
      ctx.respond(pending.message.id, { landmarks: [], handedness: [] });
      assert.deepEqual(await first, { landmarks: [], handedness: [] });
      assert.equal(bitmapClosed, 1);
      await detector.setOptions({ numHands: 2 });
      assert.equal(ctx.messages.at(-1).message.type, "options");
    } finally { detector.close(); }
    assert.equal(ctx.terminations, 1);
    assert.equal(ctx.listeners.message.size, 0);
  });

  it("closing during bitmap capture disposes the late bitmap without posting it", async () => {
    const ctx = harness(), capture = deferred();
    let closed = 0;
    const detector = await createWorkerHandDetector({ workerFactory: () => ctx.worker, bitmapFactory: () => capture.promise });
    const detecting = detector.detectForVideo({}, 100);
    detector.close();
    capture.resolve({ close() { closed += 1; } });
    assert.equal(await detecting, null);
    assert.equal(closed, 1);
    assert.equal(ctx.messages.length, 1, "only initialization was posted");
  });

  it("close settles a pending inference and removes message/error handlers", async () => {
    const ctx = harness();
    const detector = await createWorkerHandDetector({ workerFactory: () => ctx.worker, bitmapFactory: async () => ({ close() {} }) });
    const detecting = detector.detectForVideo({}, 100);
    await flush();
    detector.close();
    await assert.rejects(detecting, { name: "AbortError" });
    assert.equal(ctx.listeners.error.size, 0);
    assert.equal(ctx.listeners.messageerror.size, 0);
    detector.close();
    assert.equal(ctx.terminations, 1);
  });

  it("bounds a silent worker initialization and terminates it", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const ctx = harness({ init: false });
    const creating = createWorkerHandDetector({ workerFactory: () => ctx.worker, initTimeoutMs: 20 });
    const rejected = assert.rejects(creating, { code: "model_timeout" });
    t.mock.timers.tick(20);
    await rejected;
    assert.equal(ctx.terminations, 1);
    assert.equal(ctx.listeners.message.size, 0);
  });

  it("bounds an unresponsive inference and prevents subsequent worker requests", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const ctx = harness();
    const detector = await createWorkerHandDetector({
      workerFactory: () => ctx.worker, bitmapFactory: async () => ({ close() {} }), frameTimeoutMs: 20,
    });
    const detecting = detector.detectForVideo({}, 100);
    const rejected = assert.rejects(detecting, { code: "hand_frame_timeout" });
    await flush();
    t.mock.timers.tick(20);
    await rejected;
    assert.equal(ctx.terminations, 1);
    assert.equal(await detector.detectForVideo({}, 200), null);
    assert.equal(ctx.messages.length, 2);
  });
});
