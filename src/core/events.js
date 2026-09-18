/**
 * Local intent and projection event contracts for SIMFABRIC.
 * Events are synchronous, in-memory notifications; publishing never executes
 * authority-bearing work or reaches an external system.
 */

export const EVENT_SCHEMA_VERSION = 1;

export const EventType = Object.freeze({
  INTENT_SUBMITTED: "simfabric.intent.submitted",
  INTENT_ACCEPTED: "simfabric.intent.accepted",
  INTENT_REJECTED: "simfabric.intent.rejected",
  PROJECTION_UPDATED: "simfabric.projection.updated",
});

const EVENT_TYPES = new Set(Object.values(EventType));

/**
 * @typedef {Object} SimfabricEvent
 * @property {number} schemaVersion
 * @property {string} type
 * @property {string} source
 * @property {string} occurredAt
 * @property {Readonly<Record<string, unknown>>} payload
 */

function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

/** Create and freeze a validated local SIMFABRIC event. */
export function createEvent({ type, source, occurredAt, payload = {} }) {
  if (!EVENT_TYPES.has(type)) {
    throw new TypeError(`Unknown SIMFABRIC event type: ${String(type)}`);
  }
  requireNonEmptyString(source, "source");
  requireNonEmptyString(occurredAt, "occurredAt");
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("payload must be an object");
  }

  return Object.freeze({
    schemaVersion: EVENT_SCHEMA_VERSION,
    type,
    source,
    occurredAt,
    payload: Object.freeze({ ...payload }),
  });
}

/**
 * Create a synchronous, local-only typed event bus.
 * Listener failures are allowed to surface to the caller for deterministic tests.
 */
export function createEventBus() {
  const listeners = new Map();

  return Object.freeze({
    subscribe(type, listener) {
      if (!EVENT_TYPES.has(type)) {
        throw new TypeError(`Unknown SIMFABRIC event type: ${String(type)}`);
      }
      if (typeof listener !== "function") {
        throw new TypeError("listener must be a function");
      }
      const subscribers = listeners.get(type) ?? new Set();
      subscribers.add(listener);
      listeners.set(type, subscribers);
      return () => subscribers.delete(listener);
    },

    publish(event) {
      if (!event || event.schemaVersion !== EVENT_SCHEMA_VERSION || !EVENT_TYPES.has(event.type)) {
        throw new TypeError("event must be a versioned SIMFABRIC event");
      }
      for (const listener of [...(listeners.get(event.type) ?? [])]) {
        listener(event);
      }
      return event;
    },

    clear() {
      listeners.clear();
    },
  });
}
