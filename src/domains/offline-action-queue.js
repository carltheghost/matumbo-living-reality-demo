export function createOfflineActionQueue() {
  let counter = 0;
  const items = [];
  const listeners = new Set();

  function emit(event) {
    for (const listener of listeners) {
      listener(event);
    }
  }

  function enqueue(action = {}) {
    const id = `q${++counter}`;

    const record = {
      id,
      idempotencyKey: action.idempotencyKey ?? id,
      type: action.type,
      payload: action.payload,
      createdAt: action.createdAt,
      attempts: Number.isInteger(action.attempts) && action.attempts >= 0
        ? action.attempts
        : 0,
    };

    items.push(record);
    emit({ type: "enqueued", action: { ...record } });

    return { ...record };
  }

  function peek() {
    return items.length > 0 ? { ...items[0] } : undefined;
  }

  function peekAll() {
    return items.map((item) => ({ ...item }));
  }

  function ack(id) {
    if (items.length === 0 || items[0].id !== id) {
      throw new Error(`Cannot acknowledge non-head or unknown queue id: ${id}`);
    }

    const [removed] = items.splice(0, 1);
    emit({ type: "acknowledged", action: { ...removed } });

    return { ...removed };
  }

  function size() {
    return items.length;
  }

  function clear() {
    const removed = items.splice(0, items.length);
    emit({
      type: "cleared",
      actions: removed.map((item) => ({ ...item })),
    });
  }

  function snapshot() {
    return {
      version: 1,
      counter,
      items: items.map((item) => ({ ...item })),
    };
  }

  function restore(snapshotValue) {
    if (!snapshotValue || typeof snapshotValue !== "object") {
      throw new TypeError("Queue snapshot must be an object");
    }

    if (snapshotValue.version !== 1) {
      throw new Error(`Unsupported queue snapshot version: ${snapshotValue.version}`);
    }

    if (!Number.isInteger(snapshotValue.counter) || snapshotValue.counter < 0) {
      throw new TypeError("Queue snapshot counter must be a non-negative integer");
    }

    if (!Array.isArray(snapshotValue.items)) {
      throw new TypeError("Queue snapshot items must be an array");
    }

    const restoredItems = snapshotValue.items.map((item) => {
      if (!item || typeof item !== "object") {
        throw new TypeError("Queue snapshot contains an invalid action");
      }

      if (typeof item.id !== "string" || typeof item.idempotencyKey !== "string") {
        throw new TypeError("Queue action requires id and idempotencyKey");
      }

      if (typeof item.type !== "string") {
        throw new TypeError("Queue action requires type");
      }

      if (!Number.isInteger(item.attempts) || item.attempts < 0) {
        throw new TypeError("Queue action attempts must be a non-negative integer");
      }

      return {
        id: item.id,
        idempotencyKey: item.idempotencyKey,
        type: item.type,
        payload: item.payload,
        createdAt: item.createdAt,
        attempts: item.attempts,
      };
    });

    counter = snapshotValue.counter;
    items.splice(0, items.length, ...restoredItems);

    emit({
      type: "restored",
      snapshot: snapshot(),
    });

    return snapshot();
  }

  function serialize() {
    return JSON.stringify(snapshot());
  }

  function subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("Queue subscriber must be a function");
    }

    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  }

  return Object.freeze({
    enqueue,
    peek,
    peekAll,
    ack,
    size,
    clear,
    snapshot,
    restore,
    serialize,
    subscribe,
  });
}