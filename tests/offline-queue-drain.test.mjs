import test from "node:test";
import assert from "node:assert/strict";

import { createOfflineActionQueue } from "../src/domains/offline-action-queue.js";
import { createOfflineActionDrain } from "../src/domains/offline-action-drain.js";

test("FIFO order", () => {
  const queue = createOfflineActionQueue();

  queue.enqueue({
    type: "first",
    payload: { value: 1 },
    createdAt: 100,
  });

  queue.enqueue({
    type: "second",
    payload: { value: 2 },
    createdAt: 200,
  });

  queue.enqueue({
    type: "third",
    payload: { value: 3 },
    createdAt: 300,
  });

  assert.deepEqual(
    queue.peekAll().map((action) => action.type),
    ["first", "second", "third"],
  );

  assert.equal(queue.peek().id, "q1");
  assert.equal(queue.size(), 3);
});

test("ack removes head only", () => {
  const queue = createOfflineActionQueue();

  queue.enqueue({
    type: "first",
    payload: {},
    createdAt: 100,
  });

  queue.enqueue({
    type: "second",
    payload: {},
    createdAt: 200,
  });

  assert.throws(
    () => queue.ack("q2"),
    /Cannot acknowledge non-head or unknown queue id/,
  );

  assert.equal(queue.size(), 2);
  assert.equal(queue.peek().id, "q1");

  const acknowledged = queue.ack("q1");

  assert.equal(acknowledged.id, "q1");
  assert.equal(queue.size(), 1);
  assert.equal(queue.peek().id, "q2");

  assert.throws(
    () => queue.ack("does-not-exist"),
    /Cannot acknowledge non-head or unknown queue id/,
  );
});

test("serialize and restore preserve the full queue and id counter", () => {
  const queue = createOfflineActionQueue();

  queue.enqueue({
    type: "alpha",
    payload: { x: 1 },
    createdAt: 111,
    idempotencyKey: "alpha-key",
  });

  queue.enqueue({
    type: "beta",
    payload: { x: 2 },
    createdAt: 222,
    attempts: 3,
  });

  queue.ack("q1");

  const serialized = queue.serialize();

  const restored = createOfflineActionQueue();
  restored.restore(JSON.parse(serialized));

  assert.deepEqual(restored.snapshot(), queue.snapshot());

  const next = restored.enqueue({
    type: "gamma",
    payload: { x: 3 },
    createdAt: 333,
  });

  assert.equal(next.id, "q3");
  assert.equal(restored.peek().id, "q2");
});

test("drain success drains all actions", async () => {
  const queue = createOfflineActionQueue();

  queue.enqueue({ type: "a", payload: {}, createdAt: 1 });
  queue.enqueue({ type: "b", payload: {}, createdAt: 2 });
  queue.enqueue({ type: "c", payload: {}, createdAt: 3 });

  const executed = [];

  const drain = createOfflineActionDrain(queue, {
    execute: async (action) => {
      executed.push(action.id);
      return { ok: true };
    },
  });

  await drain.drain();

  assert.deepEqual(executed, ["q1", "q2", "q3"]);
  assert.equal(queue.size(), 0);

  assert.deepEqual(drain.getStats(), {
    attempted: 3,
    acknowledged: 3,
    retried: 0,
    deadLettered: 0,
    queued: 0,
    deadLetters: 0,
    paused: false,
    draining: false,
  });
});

test("retry-then-success", async () => {
  const queue = createOfflineActionQueue();

  queue.enqueue({
    type: "retryable",
    payload: { value: 42 },
    createdAt: 100,
  });

  const attempts = [];

  const drain = createOfflineActionDrain(queue, {
    execute: async (action) => {
      attempts.push({
        id: action.id,
        attempts: action.attempts,
      });

      if (attempts.length === 1) {
        return {
          ok: false,
          retryable: true,
          error: "temporary failure",
        };
      }

      return { ok: true };
    },
  });

  await drain.drain();

  assert.deepEqual(attempts, [
    { id: "q1", attempts: 0 },
    { id: "q2", attempts: 1 },
  ]);

  assert.equal(queue.size(), 0);
  assert.equal(drain.getStats().attempted, 2);
  assert.equal(drain.getStats().retried, 1);
  assert.equal(drain.getStats().acknowledged, 1);
  assert.equal(drain.getStats().deadLettered, 0);
});

test("permanent failure becomes a dead letter", async () => {
  const queue = createOfflineActionQueue();

  queue.enqueue({
    type: "permanent",
    payload: { value: "bad" },
    createdAt: 500,
  });

  const calls = [];

  const drain = createOfflineActionDrain(queue, {
    execute: async (action) => {
      calls.push(action.id);

      return {
        ok: false,
        retryable: false,
        error: "permanent failure",
      };
    },
  });

  await drain.drain();

  assert.deepEqual(calls, ["q1"]);
  assert.equal(queue.size(), 0);

  const letters = drain.deadLetters();

  assert.equal(letters.length, 1);
  assert.equal(letters[0].action.id, "q1");
  assert.equal(letters[0].action.attempts, 1);
  assert.equal(letters[0].result.ok, false);

  await drain.drain();

  assert.deepEqual(calls, ["q1"]);
  assert.equal(drain.deadLetters().length, 1);
});

test("pause and resume leave unprocessed actions queued", async () => {
  const queue = createOfflineActionQueue();

  queue.enqueue({ type: "a", payload: {}, createdAt: 1 });
  queue.enqueue({ type: "b", payload: {}, createdAt: 2 });
  queue.enqueue({ type: "c", payload: {}, createdAt: 3 });

  const executed = [];

  let releaseFirst;
  const firstActionFinished = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const drain = createOfflineActionDrain(queue, {
    execute: async (action) => {
      executed.push(action.id);

      if (action.id === "q1") {
        drain.pause();
        releaseFirst();
      }

      return { ok: true };
    },
  });

  const draining = drain.drain();

  await firstActionFinished;
  await draining;

  assert.deepEqual(executed, ["q1"]);
  assert.equal(queue.size(), 2);
  assert.equal(queue.peek().id, "q2");
  assert.equal(drain.getStats().paused, true);

  await drain.resume();

  assert.deepEqual(executed, ["q1", "q2", "q3"]);
  assert.equal(queue.size(), 0);
  assert.equal(drain.getStats().paused, false);
});

test("execute is called exactly once per attempt", async () => {
  const queue = createOfflineActionQueue();

  queue.enqueue({
    type: "success",
    payload: {},
    createdAt: 1,
  });

  queue.enqueue({
    type: "retry",
    payload: {},
    createdAt: 2,
  });

  queue.enqueue({
    type: "permanent",
    payload: {},
    createdAt: 3,
  });

  const calls = new Map();

  const drain = createOfflineActionDrain(queue, {
    execute: async (action) => {
      calls.set(action.id, (calls.get(action.id) ?? 0) + 1);

      if (action.type === "retry" && action.attempts === 0) {
        return {
          ok: false,
          retryable: true,
        };
      }

      if (action.type === "permanent") {
        return {
          ok: false,
          retryable: false,
        };
      }

      return { ok: true };
    },
  });

  await drain.drain();

  // Each attempt executes exactly once: q1 ok, q2 fails once then its retry
  // is re-enqueued under a new id (q4) with the same idempotency key, q3 fails
  // permanently.
  assert.equal(calls.get("q1"), 1);
  assert.equal(calls.get("q2"), 1);
  assert.equal(calls.get("q3"), 1);

  assert.equal(queue.size(), 0);
  assert.equal(drain.deadLetters().length, 1);

  const allCalls = [...calls.values()].reduce(
    (total, count) => total + count,
    0,
  );

  assert.equal(allCalls, 4);

  const retryDeadLetterOrSuccess = drain.getStats();
  assert.equal(retryDeadLetterOrSuccess.attempted, 4);
  assert.equal(retryDeadLetterOrSuccess.retried, 1);
  assert.equal(retryDeadLetterOrSuccess.acknowledged, 2);
  assert.equal(retryDeadLetterOrSuccess.deadLettered, 1);
});