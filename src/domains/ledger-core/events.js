/**
 * Content-addressed domain event envelope (ledger-core).
 *
 * Ported from TumboAgent PR #6 (`matumbo/core/events.py`, tag
 * archive/pr-6-claude-matumbo-master-spec-mz1vv4).
 *
 * Every meaningful state change is describable as an immutable event.
 * Events are content-addressed: the eventId is derived from the payload
 * and metadata, so an identical event produced twice has an identical id —
 * which is the backbone of idempotency.
 *
 * This is a SEPARATE domain-event layer from the tree's SIMFABRIC bus
 * (`src/core/events.js`, synchronous in-memory intent notifications).
 * Nothing here touches that bus.
 */

import { createHash, randomUUID } from "node:crypto";

/**
 * Deterministic JSON: sorted keys, no incidental whitespace.
 * BigInt values are rendered as decimal strings (JSON has no bigint).
 * @param {unknown} obj
 * @returns {string}
 */
export function canonicalJson(obj) {
  return JSON.stringify(sortValue(obj));
}

function sortValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(sortValue);
  if (typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const v = sortValue(value[key]);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  return value;
}

/** SHA-256 hex digest of the canonical JSON of `obj`. */
export function contentHash(obj) {
  return createHash("sha256").update(canonicalJson(obj), "utf8").digest("hex");
}

function requireNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
}

/**
 * @typedef {Object} DomainEvent
 * @property {string} eventId - content-addressed id (derived, not chosen)
 * @property {string} eventType
 * @property {string} aggregateId
 * @property {string} realm
 * @property {string} actorId
 * @property {Record<string, unknown>} payload
 * @property {string} payloadHash
 * @property {string} idempotencyKey
 * @property {number} occurredAt - integer ms since epoch
 * @property {string} correlationId
 * @property {string|null} causationId
 * @property {number} schemaVersion
 * @property {number|null} sequenceNumber - assigned by the log on append
 */

/** Create and freeze a validated, immutable domain event. */
export function createEvent({
  eventType,
  aggregateId,
  realm,
  actorId,
  payload = {},
  idempotencyKey,
  occurredAt = Date.now(),
  correlationId = randomUUID(),
  causationId = null,
  schemaVersion = 1,
  sequenceNumber = null,
}) {
  requireNonEmptyString(eventType, "eventType");
  requireNonEmptyString(aggregateId, "aggregateId");
  requireNonEmptyString(realm, "realm");
  requireNonEmptyString(actorId, "actorId");
  requireNonEmptyString(idempotencyKey, "idempotencyKey");
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("payload must be a plain object");
  }
  if (!Number.isInteger(occurredAt)) {
    throw new TypeError("occurredAt must be integer milliseconds");
  }
  const payloadHash = contentHash(payload);
  const eventId = contentHash({
    event_type: eventType,
    aggregate_id: aggregateId,
    realm,
    actor_id: actorId,
    payload_hash: payloadHash,
    idempotency_key: idempotencyKey,
    occurred_at: occurredAt,
  });
  return Object.freeze({
    eventId,
    eventType,
    aggregateId,
    realm,
    actorId,
    payload: Object.freeze({ ...payload }),
    payloadHash,
    idempotencyKey,
    occurredAt,
    correlationId,
    causationId,
    schemaVersion,
    sequenceNumber,
  });
}

/**
 * Append-only event log with idempotency de-duplication.
 *
 * The contract that matters for correctness: append assigns a monotonic
 * sequence number, and a repeated idempotency key returns the original
 * event instead of appending a duplicate.
 */
export class EventLog {
  constructor() {
    this._events = [];
    this._byIdempotency = new Map();
  }

  /**
   * Append an event. If an event with the same idempotency key was already
   * appended, the original is returned and nothing is duplicated.
   * @param {DomainEvent} event
   * @returns {DomainEvent} the stored event (with sequenceNumber assigned)
   */
  append(event) {
    const existing = this._byIdempotency.get(event.idempotencyKey);
    if (existing !== undefined) return existing;
    const stored = Object.freeze({ ...event, sequenceNumber: this._events.length });
    this._events.push(stored);
    this._byIdempotency.set(stored.idempotencyKey, stored);
    return stored;
  }

  /** Find a previously appended event by idempotency key, if any. */
  findByIdempotencyKey(key) {
    return this._byIdempotency.get(key);
  }

  get length() {
    return this._events.length;
  }

  [Symbol.iterator]() {
    return this._events[Symbol.iterator]();
  }

  /** Full ordered replay of the log. */
  replay() {
    return [...this._events];
  }
}
