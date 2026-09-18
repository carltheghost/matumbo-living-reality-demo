/**
 * Metadata-only cipher and messaging projections.
 *
 * This module does not encrypt, decrypt, store message content, or manage keys.
 * Its indicators are fictional local simulation state for renderer consumption.
 */

export const CIPHER_SCHEMA_VERSION = 1;
export const CIPHER_SOURCE = "cipher-messaging";

export const SessionIndicator = Object.freeze({
  ESTABLISHING: "establishing",
  PROTECTED: "protected",
  DEGRADED: "degraded",
  CLOSED: "closed",
});

export const MessageEventKind = Object.freeze({
  QUEUED: "queued",
  SENT: "sent",
  DELIVERED: "delivered",
  READ: "read",
  FAILED: "failed",
});

export const RevocationState = Object.freeze({
  ACTIVE: "active",
  PENDING: "pending",
  REVOKED: "revoked",
});

const SESSION_INDICATORS = new Set(Object.values(SessionIndicator));
const MESSAGE_EVENT_KINDS = new Set(Object.values(MessageEventKind));
const REVOCATION_STATES = new Set(Object.values(RevocationState));
const FORBIDDEN_FIELDS = new Set([
  "body",
  "ciphertext",
  "content",
  "credential",
  "key",
  "message",
  "payload",
  "plaintext",
  "privatekey",
  "secret",
  "signature",
  "text",
  "token",
]);

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function requireRecord(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_FIELDS.has(key.toLowerCase())) {
      throw new TypeError(`${field}.${key} is not accepted by the metadata-only projection`);
    }
  }
  return value;
}

function requireEnum(value, allowed, field) {
  if (!allowed.has(value)) throw new TypeError(`Unknown ${field}: ${String(value)}`);
  return value;
}

function requireUniqueIds(records, label) {
  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.id)) throw new TypeError(`Duplicate ${label} id: ${record.id}`);
    seen.add(record.id);
  }
}

function normalizeSession(session) {
  requireRecord(session, "session");
  return Object.freeze({
    id: requireString(session.id, "session.id"),
    kind: "cipher-session-indicator",
    indicator: requireEnum(session.indicator, SESSION_INDICATORS, "session indicator"),
    participantCount: Number.isInteger(session.participantCount) && session.participantCount >= 0
      ? session.participantCount
      : 0,
    simulation: true,
    authority: "none",
  });
}

function normalizeMessageEvent(event) {
  requireRecord(event, "messageEvent");
  return Object.freeze({
    id: requireString(event.id, "messageEvent.id"),
    kind: "message-event-summary",
    sessionId: requireString(event.sessionId, "messageEvent.sessionId"),
    eventKind: requireEnum(event.eventKind, MESSAGE_EVENT_KINDS, "message event kind"),
    occurredAt: requireString(event.occurredAt, "messageEvent.occurredAt"),
    simulation: true,
    contentRetained: false,
  });
}

function normalizeRevocation(revocation) {
  requireRecord(revocation, "revocation");
  return Object.freeze({
    id: requireString(revocation.id, "revocation.id"),
    kind: "cipher-revocation-state",
    sessionId: requireString(revocation.sessionId, "revocation.sessionId"),
    state: requireEnum(revocation.state, REVOCATION_STATES, "revocation state"),
    changedAt: requireString(revocation.changedAt, "revocation.changedAt"),
    simulation: true,
    authority: "none",
  });
}

/** Build a deterministic, metadata-only contribution for the local projection. */
export function createCipherContribution({
  updatedAt,
  sessions = [],
  messageEvents = [],
  revocations = [],
}) {
  requireString(updatedAt, "updatedAt");
  if (![sessions, messageEvents, revocations].every(Array.isArray)) {
    throw new TypeError("sessions, messageEvents, and revocations must be arrays");
  }

  const normalizedSessions = sessions.map(normalizeSession);
  const normalizedEvents = messageEvents.map(normalizeMessageEvent);
  const normalizedRevocations = revocations.map(normalizeRevocation);
  requireUniqueIds(normalizedSessions, "session");
  requireUniqueIds(normalizedEvents, "message event");
  requireUniqueIds(normalizedRevocations, "revocation");

  const sessionIds = new Set(normalizedSessions.map(({ id }) => id));
  for (const record of [...normalizedEvents, ...normalizedRevocations]) {
    if (!sessionIds.has(record.sessionId)) {
      throw new TypeError(`${record.kind} references unknown session: ${record.sessionId}`);
    }
  }

  return Object.freeze({
    schemaVersion: CIPHER_SCHEMA_VERSION,
    source: CIPHER_SOURCE,
    simulation: true,
    updatedAt,
    entities: Object.freeze([
      ...normalizedSessions,
      ...normalizedEvents,
      ...normalizedRevocations,
    ]),
    evidence: Object.freeze([
      Object.freeze({
        id: "cipher-boundary:metadata-only",
        kind: "simulation-boundary",
        status: "enforced",
        plaintextRetained: false,
        cryptographyImplemented: false,
      }),
    ]),
    capabilities: Object.freeze([
      Object.freeze({
        id: "cipher-project-metadata",
        mode: "projection",
        authority: "none",
      }),
      Object.freeze({
        id: "cipher-cryptographic-operations",
        mode: "denied",
        authority: "none",
      }),
    ]),
  });
}
