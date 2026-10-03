/**
 * economic-timeline.js — deterministic local ancestry chain.
 *
 * The checksum is deliberately labelled non-cryptographic. It is useful for
 * replay ordering and tamper detection in a demo, but it is not EchoProof and
 * must never be presented as cryptographic finality.
 */

export const ECONOMIC_TIMELINE_SCHEMA_VERSION = 1;
export const ECONOMIC_TIMELINE_SOURCE = "matumbo-economic-timeline";

export function stableEconomicString(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableEconomicString).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableEconomicString(value[key])}`).join(",")}}`;
}

export function economicChecksum(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Copy bounded JSON metadata before sealing it; no caller-owned references. */
export function sealEconomicMetadata(value, depth = 0, seen = new Set()) {
  if (depth > 24) throw new Error("Economic metadata nesting exceeds the limit");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > 8192) throw new Error("Economic metadata text exceeds the limit");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Economic metadata must contain finite numbers");
    return value;
  }
  if (!value || typeof value !== "object" || seen.has(value)) throw new Error("Economic metadata must be acyclic JSON");
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error("Economic metadata must be plain JSON");
  seen.add(value);
  if (Object.keys(value).length > (Array.isArray(value) ? 100000 : 2000)) throw new Error("Economic metadata fields exceed the limit");
  const result = Array.isArray(value) ? value.map(item => sealEconomicMetadata(item, depth + 1, seen)) : Object.fromEntries(Object.keys(value).map(key => {
    if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("Economic metadata field is forbidden");
    return [key, sealEconomicMetadata(value[key], depth + 1, seen)];
  }));
  seen.delete(value);
  return Object.freeze(result);
}

// The runtime wraps payloads as bundle.timeline.events[index].payload (four
// levels). Keep a valid timeline export within its stricter shared JSON bounds.
function validateTimelinePayload(value, depth = 0) {
  if (depth > 14) throw new Error("Timeline payload nesting exceeds the shared export limit");
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    if (value.length > 4000) throw new Error("Timeline payload rows exceed the shared export limit");
    for (let index = 0; index < value.length; index++) {
      if (!Object.hasOwn(value, index)) throw new Error("Timeline payload arrays must not contain missing entries");
      validateTimelinePayload(value[index], depth + 1);
    }
  } else {
    if (Object.keys(value).length > 100) throw new Error("Timeline payload fields exceed the shared export limit");
    for (const item of Object.values(value)) validateTimelinePayload(item, depth + 1);
  }
}

function validateTimelineEvent(event) {
  const fields = ['sequence', 'type', 'source', 'previousChecksum', 'payload', 'checksum'];
  if (!event || Object.keys(event).some(key => !fields.includes(key)) || typeof event.type !== 'string' || !event.type.trim() || typeof event.source !== 'string') throw new Error("Invalid timeline event metadata");
  sealEconomicMetadata(event.type);
  sealEconomicMetadata(event.source);
  validateTimelinePayload(event.payload);
}

const TIMELINE_EXPORT_OVERHEAD = JSON.stringify({
  schemaVersion: ECONOMIC_TIMELINE_SCHEMA_VERSION,
  source: ECONOMIC_TIMELINE_SOURCE,
  events: [],
  verifiedLocalChain: false,
  checksumType: 'fnv1a-32-demo',
  cryptographicProof: false,
  localOnly: true,
  simulation: true,
}).length;

export function createEconomicTimeline({
  maxEvents = 10000,
  maxExportChars = 1_000_000
} = {}) {
  if (!Number.isSafeInteger(maxEvents) || maxEvents < 1 || maxEvents > 100000) throw new Error("Invalid timeline event limit");
  if (!Number.isSafeInteger(maxExportChars) || maxExportChars < 1000 || maxExportChars > 1_000_000) throw new Error("Invalid timeline export limit");
  let events = [];
  let exportChars = TIMELINE_EXPORT_OVERHEAD;

  function append({
    type,
    source,
    payload = {}
  } = {}) {
    const eventType = String(type ?? "").trim();
    if (!eventType) throw new Error("Timeline event type is required");
    if (events.length >= maxEvents) throw new Error("Economic timeline is full; export before continuing");
    const previousChecksum = events.at(-1)?.checksum ?? "GENESIS";
    const base = Object.freeze({
      sequence: events.length + 1,
      type: eventType,
      source: String(source ?? ECONOMIC_TIMELINE_SOURCE),
      previousChecksum,
      payload: sealEconomicMetadata(payload),
    });
    const event = Object.freeze({
      ...base,
      checksum: economicChecksum(stableEconomicString(base)),
    });
    validateTimelineEvent(event);
    const nextChars = exportChars + JSON.stringify(event).length + (events.length ? 1 : 0);
    if (nextChars > maxExportChars) throw new Error("Economic timeline export capacity reached; export before continuing");
    events.push(event);
    exportChars = nextChars;
    return event;
  }

  function verify() {
    let previous = "GENESIS";
    for (const [index, event] of events.entries()) {
      if (event.previousChecksum !== previous) return false;
      const {
        checksum: recorded,
        ...base
      } = event;
      if (economicChecksum(stableEconomicString(base)) !== recorded || event.sequence !== index + 1 || typeof event.type !== "string" || !event.type.trim()) return false;
      previous = recorded;
    }
    return true;
  }

  function snapshot() {
    return Object.freeze({
      schemaVersion: ECONOMIC_TIMELINE_SCHEMA_VERSION,
      source: ECONOMIC_TIMELINE_SOURCE,
      events: Object.freeze([...events]),
      verifiedLocalChain: verify(),
      checksumType: "fnv1a-32-demo",
      cryptographicProof: false,
      localOnly: true,
      simulation: true,
    });
  }

  function exportState() {
    return snapshot();
  }

  function importState(input) {
    const data = sealEconomicMetadata(input);
    if (data.schemaVersion !== ECONOMIC_TIMELINE_SCHEMA_VERSION || data.source !== ECONOMIC_TIMELINE_SOURCE || !Array.isArray(data.events) || data.events.length > maxEvents) throw new Error("Invalid economic timeline state");
    let nextChars = TIMELINE_EXPORT_OVERHEAD;
    for (const [index, event] of data.events.entries()) {
      validateTimelineEvent(event);
      nextChars += JSON.stringify(event).length + (index ? 1 : 0);
      if (nextChars > maxExportChars) throw new Error("Economic timeline export capacity reached");
    }
    const previous = events;
    events = [...data.events];
    if (!verify()) {
      events = previous;
      throw new Error("Economic timeline chain is invalid");
    }
    exportChars = nextChars;
    return snapshot();
  }
  return Object.freeze({
    append,
    verify,
    snapshot,
    exportState,
    importState
  });
}

export default Object.freeze({
  ECONOMIC_TIMELINE_SCHEMA_VERSION,
  ECONOMIC_TIMELINE_SOURCE,
  createEconomicTimeline,
});
