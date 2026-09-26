/**
 * economic-timeline.js — deterministic local ancestry chain.
 *
 * The checksum is deliberately labelled non-cryptographic. It is useful for
 * replay ordering and tamper detection in a demo, but it is not EchoProof and
 * must never be presented as cryptographic finality.
 */

export const ECONOMIC_TIMELINE_SCHEMA_VERSION = 1;
export const ECONOMIC_TIMELINE_SOURCE = "matumbo-economic-timeline";

function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
}

function checksum(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function createEconomicTimeline() {
  const events = [];

  function append({ type, source, payload = {} } = {}) {
    const eventType = String(type ?? "").trim();
    if (!eventType) throw new Error("Timeline event type is required");
    const previousChecksum = events.at(-1)?.checksum ?? "GENESIS";
    const base = Object.freeze({
      sequence: events.length + 1,
      type: eventType,
      source: String(source ?? ECONOMIC_TIMELINE_SOURCE),
      previousChecksum,
      payload,
    });
    const event = Object.freeze({
      ...base,
      checksum: checksum(stable(base)),
    });
    events.push(event);
    return event;
  }

  function verify() {
    let previous = "GENESIS";
    for (const event of events) {
      if (event.previousChecksum !== previous) return false;
      const { checksum: recorded, ...base } = event;
      if (checksum(stable(base)) !== recorded) return false;
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

  return Object.freeze({ append, verify, snapshot });
}

export default Object.freeze({
  ECONOMIC_TIMELINE_SCHEMA_VERSION,
  ECONOMIC_TIMELINE_SOURCE,
  createEconomicTimeline,
});
