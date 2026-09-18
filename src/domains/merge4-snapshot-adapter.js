/**
 * Safe, renderer-independent adapter for a Merge 4 world snapshot.
 *
 * Merge 4 stores a richer server world (`state.fabric`, rooms, messages,
 * events, ledger, and proof records). This adapter accepts only an in-memory
 * JSON value and reduces it to a local SIMFABRIC projection envelope. It is a
 * migration/review seam, never a server client: it does not read files,
 * contact the API, persist state, execute imported values, or move assets.
 */
import { createProjectionEnvelope } from "../core/view-state.js";

export const MERGE4_SNAPSHOT_ADAPTER_SOURCE = "merge4-snapshot-adapter";
export const MERGE4_SNAPSHOT_SCHEMA_VERSION = 1;
export const MERGE4_SNAPSHOT_BOUNDARY =
  "Merge 4 snapshots are accepted as in-memory JSON only; mapped records are local SIMFABRIC projections and never become server state, live messages, settlement, token distribution, or executable code.";

export const MERGE4_SNAPSHOT_LIMITS = Object.freeze({
  maxTextLength: 256_000,
  maxRecordsPerCollection: 512,
  maxEntityCount: 512,
  maxTotalNodes: 8_000,
});

const FORBIDDEN_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "run",
  "execute",
  "eval",
  "code",
  "script",
  "module",
  "import",
  "command",
  "writefile",
  "readfile",
  "fetch",
  "websocket",
]);

const COLLECTIONS = Object.freeze(["ledger", "usedEvidence", "events", "rooms", "messages", "proofs"]);
const RECEIPT_FLAGS = Object.freeze({
  simulation: true,
  localOnly: true,
  externalNetwork: false,
  externalImport: false,
  importedCodeExecution: false,
  persistence: false,
  externalTransfer: false,
  wallet: false,
  custody: false,
  signing: false,
  settlement: false,
  executable: false,
});

const freeze = (value) => Object.freeze(value);
function isPlainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function isRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function text(value, fallback = "") { return value === null || value === undefined ? fallback : String(value); }
function cleanText(value, fallback, max = 160) {
  const output = text(value, fallback).trim();
  return output ? output.slice(0, max) : fallback;
}
function safeInteger(value, fallback = 0) { return Number.isSafeInteger(value) ? value : fallback; }
function safeNumber(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function errorRecord(code, path, message) { return { code, path, message }; }
function warningRecord(code, path, message) { return { code, path, message }; }

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach(deepFreeze);
    return freeze(value);
  }
  if (isRecord(value)) {
    Object.values(value).forEach(deepFreeze);
    return freeze(value);
  }
  return value;
}

/** Copy JSON data without invoking getters or retaining caller references. */
function copyJson(value, path, errors, seen, counters) {
  counters.nodes += 1;
  if (counters.nodes > MERGE4_SNAPSHOT_LIMITS.maxTotalNodes) {
    errors.push(errorRecord("snapshot-too-complex", path || "$", `Snapshot exceeds ${MERGE4_SNAPSHOT_LIMITS.maxTotalNodes} data nodes.`));
    return null;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) errors.push(errorRecord("non-finite-number", path || "$", `${path || "$"} must be a finite JSON number.`));
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    errors.push(errorRecord("non-json-value", path || "$", `${path || "$"} contains a non-JSON value.`));
    return null;
  }
  if (!Array.isArray(value) && !isPlainRecord(value)) {
    errors.push(errorRecord("non-plain-value", path || "$", `${path || "$"} must contain plain JSON data.`));
    return null;
  }
  if (seen.has(value)) {
    errors.push(errorRecord("cyclic-value", path || "$", `${path || "$"} contains a cyclic reference.`));
    return null;
  }
  seen.add(value);
  let output;
  if (Array.isArray(value)) {
    output = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) {
        errors.push(errorRecord("non-json-value", `${path}[${index}]`, `${path}[${index}] must be plain JSON data.`));
        output.push(null);
      } else {
        output.push(copyJson(descriptor.value, `${path}[${index}]`, errors, seen, counters));
      }
    }
  } else {
    output = {};
    Object.keys(Object.getOwnPropertyDescriptors(value)).forEach((key) => {
      const childPath = path ? `${path}.${key}` : key;
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        errors.push(errorRecord("forbidden-field", childPath, `${childPath} is not accepted in a safe snapshot.`));
        return;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) {
        errors.push(errorRecord("accessor-field", childPath, `${childPath} must be a data property; getters are not invoked.`));
        return;
      }
      output[key] = copyJson(descriptor.value, childPath, errors, seen, counters);
    });
  }
  seen.delete(value);
  return output;
}

function parseInput(input) {
  if (typeof input !== "string") return { value: input, errors: [] };
  if (input.length > MERGE4_SNAPSHOT_LIMITS.maxTextLength) return { value: null, errors: [errorRecord("snapshot-too-large", "$", `Snapshot JSON exceeds ${MERGE4_SNAPSHOT_LIMITS.maxTextLength} characters.`)] };
  if (!input.trim()) return { value: null, errors: [errorRecord("empty-snapshot", "$", "Snapshot JSON is empty.")] };
  try { return { value: JSON.parse(input), errors: [] }; }
  catch (error) { return { value: null, errors: [errorRecord("invalid-json", "$", `Snapshot JSON could not be parsed: ${text(error?.message, "syntax error")}`)] }; }
}

function requireCollection(state, key, errors) {
  if (!Array.isArray(state[key])) {
    errors.push(errorRecord("collection-required", `state.${key}`, `state.${key} must be an array.`));
    return [];
  }
  if (state[key].length > MERGE4_SNAPSHOT_LIMITS.maxRecordsPerCollection) errors.push(errorRecord("collection-too-large", `state.${key}`, `state.${key} may contain at most ${MERGE4_SNAPSHOT_LIMITS.maxRecordsPerCollection} records.`));
  return state[key];
}

function validateLedger(ledger, errors) {
  const journals = new Map();
  ledger.forEach((leg, index) => {
    const path = `state.ledger[${index}]`;
    if (!isPlainRecord(leg)) { errors.push(errorRecord("ledger-shape", path, `${path} must be an object.`)); return; }
    const journalId = cleanText(leg.journalId, "", 120);
    const side = text(leg.side).toUpperCase();
    const amount = leg.amount;
    if (!journalId) errors.push(errorRecord("ledger-journal", `${path}.journalId`, `${path}.journalId is required.`));
    if (side !== "DEBIT" && side !== "CREDIT") errors.push(errorRecord("ledger-side", `${path}.side`, `${path}.side must be DEBIT or CREDIT.`));
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) errors.push(errorRecord("ledger-amount", `${path}.amount`, `${path}.amount must be a finite non-negative number.`));
    const totals = journals.get(journalId) ?? { debit: 0, credit: 0 };
    if (side === "DEBIT") totals.debit += safeNumber(amount);
    if (side === "CREDIT") totals.credit += safeNumber(amount);
    journals.set(journalId, totals);
  });
  journals.forEach((totals, journalId) => {
    if (Math.abs(totals.debit - totals.credit) > 1e-8) errors.push(errorRecord("ledger-unbalanced", `state.ledger.${journalId}`, `Journal ${journalId} is unbalanced.`));
  });
  return journals;
}

function validateSnapshotShape(snapshot, errors, warnings) {
  if (!isPlainRecord(snapshot)) { errors.push(errorRecord("snapshot-shape", "$", "Snapshot must be a plain JSON object.")); return null; }
  const worldId = cleanText(snapshot.worldId, "", 80);
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(worldId)) errors.push(errorRecord("world-id", "worldId", "worldId must contain 1–80 letters, numbers, dots, underscores, or hyphens."));
  if (!Number.isSafeInteger(snapshot.version) || snapshot.version < 0) errors.push(errorRecord("version", "version", "version must be a non-negative safe integer."));
  if (typeof snapshot.updatedAt !== "string" || !snapshot.updatedAt.trim()) errors.push(errorRecord("updated-at", "updatedAt", "updatedAt must be a non-empty string."));
  if (!isPlainRecord(snapshot.state)) { errors.push(errorRecord("state-shape", "state", "state must be a plain JSON object.")); return null; }
  const state = snapshot.state;
  if (!isPlainRecord(state.fabric)) errors.push(errorRecord("fabric-shape", "state.fabric", "state.fabric must be a plain JSON object."));
  const fabric = isPlainRecord(state.fabric) ? state.fabric : {};
  if (!isPlainRecord(fabric.entities)) errors.push(errorRecord("entities-shape", "state.fabric.entities", "state.fabric.entities must be an object map."));
  if (!Array.isArray(fabric.relations)) errors.push(errorRecord("relations-shape", "state.fabric.relations", "state.fabric.relations must be an array."));
  const collections = Object.fromEntries(COLLECTIONS.map((key) => [key, requireCollection(state, key, errors)]));
  validateLedger(collections.ledger, errors);
  const evidence = new Set();
  collections.usedEvidence.forEach((fingerprint, index) => {
    if (typeof fingerprint !== "string" || !fingerprint.trim()) errors.push(errorRecord("evidence-value", `state.usedEvidence[${index}]`, "Evidence fingerprints must be non-empty strings."));
    if (evidence.has(fingerprint)) errors.push(errorRecord("duplicate-evidence", `state.usedEvidence[${index}]`, `Duplicate consumed evidence fingerprint: ${fingerprint}.`));
    evidence.add(fingerprint);
  });
  if (asArray(fabric.relations).length > MERGE4_SNAPSHOT_LIMITS.maxRecordsPerCollection) errors.push(errorRecord("collection-too-large", "state.fabric.relations", `state.fabric.relations may contain at most ${MERGE4_SNAPSHOT_LIMITS.maxRecordsPerCollection} records.`));
  const entityCount = isPlainRecord(fabric.entities) ? Object.keys(fabric.entities).length : 0;
  if (entityCount > MERGE4_SNAPSHOT_LIMITS.maxEntityCount) errors.push(errorRecord("entity-count", "state.fabric.entities", `state.fabric.entities may contain at most ${MERGE4_SNAPSHOT_LIMITS.maxEntityCount} records.`));
  ["label", "description", "notes"].forEach((key) => { if (key in snapshot) warnings.push(warningRecord("ignored-metadata", key, `${key} is display metadata and is ignored.`)); });
  return { worldId, state, fabric, collections };
}

export function validateMerge4Snapshot(input) {
  const parsed = parseInput(input);
  const errors = [...parsed.errors];
  const warnings = [];
  let snapshot = null;
  let shape = null;
  if (!errors.length) {
    snapshot = copyJson(parsed.value, "", errors, new WeakSet(), { nodes: 0 });
    if (!errors.length) shape = validateSnapshotShape(snapshot, errors, warnings);
  }
  const result = {
    source: MERGE4_SNAPSHOT_ADAPTER_SOURCE,
    schemaVersion: MERGE4_SNAPSHOT_SCHEMA_VERSION,
    valid: errors.length === 0,
    snapshot: errors.length === 0 ? deepFreeze(snapshot) : null,
    worldId: shape?.worldId ?? null,
    version: shape ? safeInteger(shape.state?.version, safeInteger(snapshot?.version, 0)) : 0,
    errors,
    warnings,
    ...RECEIPT_FLAGS,
    authority: "none",
    boundary: MERGE4_SNAPSHOT_BOUNDARY,
  };
  return deepFreeze(result);
}

function idFor(worldId, kind, value, index) {
  const token = cleanText(value, `${kind}-${index + 1}`, 100).replace(/[^A-Za-z0-9._:-]/g, "-");
  return `${MERGE4_SNAPSHOT_ADAPTER_SOURCE}:${worldId}:${kind}:${token}`;
}

function mapEntity(worldId, entity, key, index) {
  const sourceId = cleanText(entity?.id ?? key, `entity-${index + 1}`, 100);
  return {
    id: idFor(worldId, "entity", sourceId, index),
    kind: `merge4-${cleanText(entity?.type, "world-entity", 60).toLowerCase()}`,
    label: cleanText(entity?.label ?? entity?.name ?? sourceId, sourceId, 140),
    legacyId: sourceId,
    version: safeInteger(entity?.version, 1),
    state: cleanText(entity?.state, "projected", 80),
    simulation: true,
    localOnly: true,
  };
}
function mapRoom(worldId, room, index) {
  const sourceId = cleanText(room?.id, `room-${index + 1}`, 100);
  return { id: idFor(worldId, "room", sourceId, index), kind: "spatial-room", label: cleanText(room?.label ?? room?.name ?? sourceId, sourceId, 140), legacyId: sourceId, roomType: cleanText(room?.type, "room", 60), state: cleanText(room?.state, "ACTIVE", 60), simulation: true, localOnly: true };
}
function mapRelation(worldId, relation, index) {
  const sourceId = cleanText(relation?.id ?? relation?.key, `relation-${index + 1}`, 100);
  return { id: idFor(worldId, "relation", sourceId, index), kind: "neural-relation", label: `${cleanText(relation?.from, "unknown", 70)} → ${cleanText(relation?.to, "unknown", 70)}`, legacyId: sourceId, relationType: cleanText(relation?.type, "related", 70), simulation: true, localOnly: true };
}
function mapEvent(worldId, event, index) {
  const sourceId = cleanText(event?.id ?? event?.eventId, `event-${index + 1}`, 100);
  return { id: idFor(worldId, "event", sourceId, index), kind: "event-fabric-record", label: cleanText(event?.type ?? sourceId, sourceId, 140), legacyId: sourceId, state: "simulated", simulation: true, localOnly: true };
}
function mapMessage(worldId, message, index) {
  const sourceId = cleanText(message?.id ?? message?.messageId, `message-${index + 1}`, 100);
  return { id: idFor(worldId, "message", sourceId, index), kind: "encrypted-message-metadata", label: `Sealed message ${sourceId}`, legacyId: sourceId, roomId: cleanText(message?.roomId, "unknown", 100), algorithm: cleanText(message?.algorithm, "AES-GCM", 40), state: cleanText(message?.state, "SEALED", 40), simulation: true, localOnly: true };
}
function mapProof(worldId, proof, index) {
  const sourceId = cleanText(proof?.hash ?? proof?.id, `proof-${index + 1}`, 120);
  return { id: idFor(worldId, "proof", sourceId, index), kind: "echo-proof-record", label: `Declared proof ${sourceId}`, legacyId: sourceId, journalId: cleanText(proof?.journalId, "unknown", 100), state: "declared", simulation: true, localOnly: true };
}

function mapSnapshot(validated) {
  const { snapshot, worldId } = validated;
  const { state } = snapshot;
  const { fabric } = state;
  const collections = Object.fromEntries(COLLECTIONS.map((key) => [key, asArray(state?.[key])]));
  const entities = [];
  Object.entries(fabric.entities ?? {}).forEach(([key, entity], index) => { if (isPlainRecord(entity)) entities.push(mapEntity(worldId, entity, key, index)); });
  asArray(fabric.relations).forEach((relation, index) => { if (isPlainRecord(relation)) entities.push(mapRelation(worldId, relation, index)); });
  collections.rooms.forEach((room, index) => { if (isPlainRecord(room)) entities.push(mapRoom(worldId, room, index)); });
  collections.events.forEach((event, index) => { if (isPlainRecord(event)) entities.push(mapEvent(worldId, event, index)); });
  collections.messages.forEach((message, index) => { if (isPlainRecord(message)) entities.push(mapMessage(worldId, message, index)); });
  collections.proofs.forEach((proof, index) => { if (isPlainRecord(proof)) entities.push(mapProof(worldId, proof, index)); });

  const journals = new Map();
  collections.ledger.forEach((leg) => {
    if (!isPlainRecord(leg)) return;
    const id = cleanText(leg.journalId, "unknown", 100);
    const totals = journals.get(id) ?? { debit: 0, credit: 0 };
    if (text(leg.side).toUpperCase() === "DEBIT") totals.debit += safeNumber(leg.amount);
    if (text(leg.side).toUpperCase() === "CREDIT") totals.credit += safeNumber(leg.amount);
    journals.set(id, totals);
  });
  journals.forEach((totals, journalId) => entities.push({ id: idFor(worldId, "journal", journalId, entities.length), kind: "prime-ledger-journal", label: `Journal ${journalId}`, legacyId: journalId, state: Math.abs(totals.debit - totals.credit) <= 1e-8 ? "BALANCED" : "REVIEW", simulation: true, localOnly: true }));

  const evidence = [
    ...collections.usedEvidence.map((fingerprint, index) => ({ id: idFor(worldId, "consumed-evidence", fingerprint, index), kind: "merge4-consumed-evidence", fingerprint: cleanText(fingerprint, "unknown", 180), status: "simulated" })),
    ...collections.events.map((event, index) => ({ id: idFor(worldId, "event-evidence", event?.id ?? event?.eventId, index), kind: "merge4-event-evidence", status: "simulated" })),
  ];
  const capabilities = [
    { id: `${MERGE4_SNAPSHOT_ADAPTER_SOURCE}:inspect`, mode: "projection", authority: "none", enabled: true },
    { id: `${MERGE4_SNAPSHOT_ADAPTER_SOURCE}:migrate-local-draft`, mode: "local-review", authority: "none", enabled: true },
    { id: `${MERGE4_SNAPSHOT_ADAPTER_SOURCE}:server-write`, mode: "denied", authority: "none", enabled: false },
  ];
  const contribution = deepFreeze({ schemaVersion: MERGE4_SNAPSHOT_SCHEMA_VERSION, source: MERGE4_SNAPSHOT_ADAPTER_SOURCE, simulation: true, updatedAt: snapshot.updatedAt, entities: deepFreeze(entities), evidence: deepFreeze(evidence), capabilities: deepFreeze(capabilities) });
  const envelope = createProjectionEnvelope({ contributions: [contribution], projectedAt: snapshot.updatedAt });
  const deferred = [
    { path: "state.messages", count: collections.messages.length, reason: "ciphertext and recipient delivery are summarized as metadata only; no message content is opened or sent." },
    { path: "state.ledger", count: collections.ledger.length, reason: "balanced journal legs are summarized; no settlement or value movement is executed." },
    { path: "state.proofs", count: collections.proofs.length, reason: "proof ancestry is declared locally; production cryptographic verification is unavailable." },
    { path: "serverVersion", count: 1, reason: "the Merge 4 version is review metadata; this adapter never writes back to the server." },
  ].map(deepFreeze);
  return deepFreeze({ contribution, envelope, deferred, mappedEntityCount: entities.length, evidenceCount: evidence.length, capabilityCount: capabilities.length, worldId, version: safeInteger(snapshot.version), updatedAt: snapshot.updatedAt });
}

export function adaptMerge4Snapshot(input) {
  const validation = validateMerge4Snapshot(input);
  if (!validation.valid) return deepFreeze({ ...validation, adapted: false, mapping: null, deferred: [], mappedEntityCount: 0, evidenceCount: 0, capabilityCount: 0 });
  const mapping = mapSnapshot(validation);
  return deepFreeze({ ...validation, adapted: true, mapping, deferred: mapping.deferred, envelope: mapping.envelope, contribution: mapping.contribution, mappedEntityCount: mapping.mappedEntityCount, evidenceCount: mapping.evidenceCount, capabilityCount: mapping.capabilityCount });
}

export const previewMerge4Snapshot = adaptMerge4Snapshot;
export const migrateMerge4Snapshot = adaptMerge4Snapshot;

export function serializeMerge4Snapshot(snapshot) {
  return JSON.stringify(snapshot, null, 2);
}

export function summarizeMerge4Snapshot(input) {
  const result = adaptMerge4Snapshot(input);
  return deepFreeze({ source: MERGE4_SNAPSHOT_ADAPTER_SOURCE, valid: result.valid, adapted: result.adapted, worldId: result.worldId, version: result.version, mappedEntityCount: result.mappedEntityCount, evidenceCount: result.evidenceCount, deferredCount: result.deferred?.length ?? 0, capabilityCount: result.capabilityCount, errors: result.errors, warnings: result.warnings, ...RECEIPT_FLAGS, boundary: MERGE4_SNAPSHOT_BOUNDARY });
}

export const DEFAULT_MERGE4_SNAPSHOT = deepFreeze({ worldId: "demo", version: 3, updatedAt: "2025-01-01T00:00:00.000Z", state: { usedEvidence: ["fixture:evidence:1"], events: [{ id: "event:demo:1", type: "WORLD_REHEARSAL" }], fabric: { entities: { "entity:origin": { id: "entity:origin", type: "ORIGIN", label: "Merge 4 Origin", version: 1, state: "ACTIVE" } }, relations: [{ id: "relation:origin:observer", from: "entity:origin", to: "entity:observer", type: "OBSERVES" }] }, rooms: [{ id: "room:observatory", type: "OBSERVATORY", state: "ACTIVE" }], messages: [{ id: "message:sealed:1", roomId: "room:observatory", algorithm: "AES-GCM", state: "SEALED" }], ledger: [{ journalId: "journal:demo", side: "DEBIT", account: "demo:source", amount: 10 }, { journalId: "journal:demo", side: "CREDIT", account: "demo:destination", amount: 10 }], proofs: [{ hash: "proof:demo:1", journalId: "journal:demo" }] } });

export default adaptMerge4Snapshot;
