/** Deterministic, local-only Picture Matter and Statement Forge projection. */

export const MATTER_FORGE_SCHEMA_VERSION = 1;
export const MATTER_FORGE_SOURCE = "picture-matter-statement-forge";

export const MatterInputKind = Object.freeze({
  WORD_OBJECT: "word-object",
  LOCAL_IMAGE: "local-image",
});

export const StatementKind = Object.freeze({
  INTERPRETATION: "interpretation",
  FACT_CLAIM: "fact-claim",
});

export const MATTER_FORGE_CAPABILITIES = Object.freeze([
  Object.freeze({
    id: "matter-forge.local-materialization",
    mode: "local-projection",
    enabled: true,
    authority: "none",
  }),
  Object.freeze({
    id: "matter-forge.external-image-fetch",
    mode: "denied",
    enabled: false,
    authority: "none",
  }),
  Object.freeze({
    id: "matter-forge.truth-determination",
    mode: "denied",
    enabled: false,
    authority: "none",
  }),
  Object.freeze({
    id: "matter-forge.external-publishing",
    mode: "denied",
    enabled: false,
    authority: "none",
  }),
]);

const INPUT_KINDS = new Set(Object.values(MatterInputKind));
const STATEMENT_KINDS = new Set(Object.values(StatementKind));
const REMOTE_REFERENCE = /^(?:https?|ftp|data):/i;

function requireRecord(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function requireTimestamp(value, field) {
  requireString(value, field);
  if (Number.isNaN(Date.parse(value))) throw new TypeError(`${field} must be an ISO timestamp`);
  return value;
}

function requireUncertainty(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${field} must be a number from 0 to 1`);
  }
  return value;
}

function normalizeProvenance(provenance, field) {
  requireRecord(provenance, field);
  return Object.freeze({
    source: requireString(provenance.source, `${field}.source`),
    timestamp: requireTimestamp(provenance.timestamp, `${field}.timestamp`),
    uncertainty: requireUncertainty(provenance.uncertainty, `${field}.uncertainty`),
    degraded: provenance.degraded === true,
    note: provenance.note == null ? null : requireString(provenance.note, `${field}.note`),
  });
}

function rejectExternalImageFields(input) {
  for (const field of ["url", "uri", "src", "sourceUrl", "provider"]) {
    if (field in input) throw new TypeError(`image.${field} is forbidden; images must stay local`);
  }
}

function normalizeInput(input) {
  requireRecord(input, "input");
  const id = requireString(input.id, "input.id");
  const kind = requireString(input.kind, "input.kind");
  if (!INPUT_KINDS.has(kind)) throw new TypeError(`Unknown input.kind: ${kind}`);
  const provenance = normalizeProvenance(input.provenance, `input(${id}).provenance`);

  if (kind === MatterInputKind.WORD_OBJECT) {
    return Object.freeze({
      id,
      kind,
      word: requireString(input.word, `input(${id}).word`),
      organId: input.organId == null ? null : requireString(input.organId, `input(${id}).organId`),
      provenance,
      simulation: true,
    });
  }

  rejectExternalImageFields(input);
  const localRef = requireString(input.localRef, `input(${id}).localRef`);
  if (REMOTE_REFERENCE.test(localRef) || !localRef.startsWith("local:")) {
    throw new TypeError(`input(${id}).localRef must use the local: scheme`);
  }
  if (!Number.isInteger(input.byteLength) || input.byteLength < 0) {
    throw new TypeError(`input(${id}).byteLength must be a non-negative integer`);
  }
  const mimeType = requireString(input.mimeType, `input(${id}).mimeType`);
  if (!mimeType.startsWith("image/")) {
    throw new TypeError(`input(${id}).mimeType must be an image media type`);
  }
  return Object.freeze({
    id,
    kind,
    localRef,
    name: requireString(input.name, `input(${id}).name`),
    mimeType,
    byteLength: input.byteLength,
    contentIncluded: false,
    provenance,
    simulation: true,
  });
}

function normalizeStatement(statement, inputIds) {
  requireRecord(statement, "statement");
  const id = requireString(statement.id, "statement.id");
  const kind = requireString(statement.kind, `statement(${id}).kind`);
  if (!STATEMENT_KINDS.has(kind)) throw new TypeError(`Unknown statement.kind: ${kind}`);
  const inputId = requireString(statement.inputId, `statement(${id}).inputId`);
  if (!inputIds.has(inputId)) {
    throw new TypeError(`statement(${id}).inputId references unknown input: ${inputId}`);
  }

  return Object.freeze({
    id,
    kind,
    inputId,
    text: requireString(statement.text, `statement(${id}).text`),
    truthStatus: kind === StatementKind.INTERPRETATION ? "not-applicable" : "unverified",
    assertedAsTruth: false,
    provenance: normalizeProvenance(statement.provenance, `statement(${id}).provenance`),
    simulation: true,
  });
}

function addUnique(entity, ids) {
  if (ids.has(entity.id)) throw new TypeError(`Duplicate entity id: ${entity.id}`);
  ids.add(entity.id);
  return entity;
}

/**
 * Build a side-effect-free contribution. Image bytes remain outside projection
 * state; only a caller-supplied `local:` reference and inert metadata survive.
 * Fact-shaped text is represented as an unverified claim, never as truth.
 */
export function createMatterForgeContribution({ updatedAt, inputs = [], statements = [] }) {
  requireTimestamp(updatedAt, "updatedAt");
  if (!Array.isArray(inputs) || !Array.isArray(statements)) {
    throw new TypeError("inputs and statements must be arrays");
  }

  const ids = new Set();
  const normalizedInputs = inputs.map((input) => addUnique(normalizeInput(input), ids));
  const inputIds = new Set(normalizedInputs.map(({ id }) => id));
  const normalizedStatements = statements.map((statement) =>
    addUnique(normalizeStatement(statement, inputIds), ids));
  const allEntities = Object.freeze([...normalizedInputs, ...normalizedStatements]);

  return Object.freeze({
    schemaVersion: MATTER_FORGE_SCHEMA_VERSION,
    source: MATTER_FORGE_SOURCE,
    simulation: true,
    updatedAt,
    entities: allEntities,
    evidence: Object.freeze(allEntities.map((entity) => Object.freeze({
      id: `matter-forge-evidence:${entity.id}`,
      kind: "provenance-record",
      entityId: entity.id,
      source: entity.provenance.source,
      timestamp: entity.provenance.timestamp,
      uncertainty: entity.provenance.uncertainty,
      degraded: entity.provenance.degraded,
      simulation: true,
      truthAuthority: "none",
    }))),
    capabilities: MATTER_FORGE_CAPABILITIES,
  });
}

export default createMatterForgeContribution;
