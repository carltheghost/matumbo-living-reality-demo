/** Canonical local world-state assembly for domain projection contributions. */

export const WORLD_STATE_SCHEMA_VERSION = 1;

const REQUIRED_FIELDS = [
  "schemaVersion",
  "source",
  "simulation",
  "updatedAt",
  "entities",
  "evidence",
  "capabilities",
];

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateProjectionContribution(contribution) {
  if (!isRecord(contribution)) {
    throw new TypeError("Projection contribution must be an object");
  }
  for (const field of REQUIRED_FIELDS) {
    if (!(field in contribution)) {
      throw new TypeError(`Projection contribution is missing ${field}`);
    }
  }
  if (!Number.isInteger(contribution.schemaVersion) || contribution.schemaVersion < 1) {
    throw new TypeError("schemaVersion must be a positive integer");
  }
  if (typeof contribution.source !== "string" || contribution.source.trim() === "") {
    throw new TypeError("source must be a non-empty string");
  }
  if (contribution.simulation !== true) {
    throw new TypeError("simulation must be true; authoritative contributions are forbidden");
  }
  if (typeof contribution.updatedAt !== "string" || contribution.updatedAt.trim() === "") {
    throw new TypeError("updatedAt must be a non-empty string");
  }
  for (const field of ["entities", "evidence", "capabilities"]) {
    if (!Array.isArray(contribution[field])) {
      throw new TypeError(`${field} must be an array`);
    }
  }
  return contribution;
}

/**
 * Assemble contributions in source order so replay output does not depend on
 * module registration order. A source may contribute exactly once per view.
 */
export function assembleWorldState(contributions = []) {
  if (!Array.isArray(contributions)) {
    throw new TypeError("contributions must be an array");
  }

  const bySource = new Map();
  for (const contribution of contributions) {
    validateProjectionContribution(contribution);
    if (bySource.has(contribution.source)) {
      throw new TypeError(`Duplicate projection source: ${contribution.source}`);
    }
    bySource.set(contribution.source, contribution);
  }

  const ordered = [...bySource.values()].sort((left, right) =>
    left.source.localeCompare(right.source),
  );

  return Object.freeze({
    schemaVersion: WORLD_STATE_SCHEMA_VERSION,
    simulation: true,
    sources: Object.freeze(ordered.map(({ source }) => source)),
    contributions: Object.freeze(ordered),
    entities: Object.freeze(ordered.flatMap(({ entities }) => entities)),
    evidence: Object.freeze(ordered.flatMap(({ evidence }) => evidence)),
    capabilities: Object.freeze(ordered.flatMap(({ capabilities }) => capabilities)),
  });
}

export const SAMPLE_UPDATED_AT = "2025-01-01T00:00:00.000Z";

/** Deterministic, local sample input for renderer wiring and replay tests. */
export const SAMPLE_CONTRIBUTIONS = Object.freeze([
  Object.freeze({
    schemaVersion: 1,
    source: "simfabric.sample",
    simulation: true,
    updatedAt: SAMPLE_UPDATED_AT,
    entities: Object.freeze([
      Object.freeze({ id: "sample-origin", kind: "semantic-anchor", label: "Local Origin" }),
    ]),
    evidence: Object.freeze([
      Object.freeze({ id: "sample-evidence", kind: "fixture", status: "simulated" }),
    ]),
    capabilities: Object.freeze([
      Object.freeze({ id: "sample-observe", mode: "projection", authority: "none" }),
    ]),
  }),
]);

export const SAMPLE_WORLD_STATE = assembleWorldState(SAMPLE_CONTRIBUTIONS);
