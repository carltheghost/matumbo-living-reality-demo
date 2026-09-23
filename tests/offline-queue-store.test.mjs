JavaScript
import test from 'node:test';
import assert from 'node:assert/strict';

import { createOfflineActionQueue } from '../src/domains/offline-action-queue.js';
import { createOfflineQueueStore } from '../src/domains/offline-queue-store.js';

function createMemoryStorage() {
  const values = new Map();

  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },

    setItem(key, value) {
      values.set(key, String(value));
    },

    removeItem(key) {
      values.delete(key);
    }
  };
}

function createQueue() {
  return createOfflineActionQueue();
}

function enqueue(queue, action, timestamp, idempotencyKey) {
  queue.enqueue({
    action,
    timestamp,
    idempotencyKey
  });
}

test('saves and restores FIFO order and attempts', () => {
  const storage = createMemoryStorage();
  const queue = createQueue();

  enqueue(queue, 'first', 100, 'idem-first');
  enqueue(queue, 'second', 200, 'idem-second');
  enqueue(queue, 'third', 300, 'idem-third');

  const original = queue.snapshot();

  if (Array.isArray(original)) {
    original[0].attempts = 2;
    original[1].attempts = 4;
    original[2].attempts = 1;
  } else if (Array.isArray(original.items)) {
    original.items[0].attempts = 2;
    original.items[1].attempts = 4;
    original.items[2].attempts = 1;
  } else if (Array.isArray(original.actions)) {
    original.actions[0].attempts = 2;
    original.actions[1].attempts = 4;
    original.actions[2].attempts = 1;
  } else {
    throw new TypeError('unsupported queue snapshot shape');
  }

  queue.restore(original);

  const store = createOfflineQueueStore(queue, storage);
  assert.equal(store.save(), true);

  const restoredQueue = createQueue();
  const restoredStore = createOfflineQueueStore(restoredQueue, storage);

  const count = restoredStore.load();

  assert.equal(count, 3);

  const restored = restoredQueue.snapshot();
  const items = Array.isArray(restored)
    ? restored
    : Array.isArray(restored.items)
      ? restored.items
      : restored.actions;

  assert.ok(Array.isArray(items));
  assert.deepEqual(
    items.map((item) => item.action),
    ['first', 'second', 'third']
  );
  assert.deepEqual(
    items.map((item) => item.attempts),
    [2, 4, 1]
  );
});

test('load returns zero with empty storage', () => {
  const storage = createMemoryStorage();
  const queue = createQueue();
  const store = createOfflineQueueStore(queue, storage);

  assert.equal(store.load(), 0);
});

test('corrupt JSON throws', () => {
  const storage = createMemoryStorage();
  const queue = createQueue();

  storage.setItem(
    'reality-lens:offline-queue:v1',
    '{not-valid-json'
  );

  const store = createOfflineQueueStore(queue, storage);

  assert.throws(
    () => store.load(),
    SyntaxError
  );
});

test('bad snapshot shape throws', () => {
  const storage = createMemoryStorage();
  const queue = createQueue();

  storage.setItem(
    'reality-lens:offline-queue:v1',
    JSON.stringify(['not', 'a', 'queue', 'snapshot'])
  );

  const store = createOfflineQueueStore(queue, storage);

  assert.throws(
    () => store.load(),
    TypeError
  );
});

test('idempotency keys survive the round-trip', () => {
  const storage = createMemoryStorage();
  const queue = createQueue();

  enqueue(queue, 'alpha', 100, 'idempotency-alpha');
  enqueue(queue, 'beta', 200, 'idempotency-beta');
  enqueue(queue, 'gamma', 300, 'idempotency-gamma');

  const store = createOfflineQueueStore(queue, storage);
  store.save();

  const restoredQueue = createQueue();
  const restoredStore = createOfflineQueueStore(restoredQueue, storage);

  assert.equal(restoredStore.load(), 3);

  const restored = restoredQueue.snapshot();
  const items = Array.isArray(restored)
    ? restored
    : Array.isArray(restored.items)
      ? restored.items
      : restored.actions;

  assert.deepEqual(
    items.map((item) => item.idempotencyKey),
    [
      'idempotency-alpha',
      'idempotency-beta',
      'idempotency-gamma'
    ]
  );
});