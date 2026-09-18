/**
 * Mock evidence and oracle-style interpretations for local projection only.
 * This module never contacts a provider and does not establish that a claim is true.
 */

export const LIVE_GATEWAY_SCHEMA_VERSION = 1;
export const LIVE_GATEWAY_SOURCE = "live-gateway-mock-evidence";

export const DegradedState = Object.freeze({
  NOMINAL: "nominal",
  DEGRADED: "degraded",
  UNAVAILABLE: "unavailable",
});

const DEGRADED_STATES = new Set(Object.values(DegradedState));

export const LIVE_GATEWAY_CAPABILITIES = Object.freeze([
  Object.freeze({
    id: "live-gateway-project-mock-evidence",
    mode: "local-projection",
    enabled: true,
    authority: "none",
  }),
  Object.freeze({
    id: "live-gateway-contact-external-providers",
    mode: "denied",
    enabled: false,
    authority: "none",
  }),
]);

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
  if (!Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${field} must be a valid timestamp`);
  }
  return value;
}

function requireUncertainty(value, field) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new TypeError(`${field} must be a finite number from 0 to 1`);
  }
  return value;
}

function normalizeEvidence(item) {
  requireRecord(item, "evidence");
  const degradedState = item.degradedState ?? DegradedState.NOMINAL;
  if (!DEGRADED_STATES.has(degradedState)) {
    throw new TypeError(`Unknown evidence.degradedState: ${String(degradedState)}`);
  }
  if (degradedState !== DegradedState.NOMINAL) {
    requireString(item.degradedReason, "evidence.degradedReason");
  }

  return Object.freeze({
    id: requireString(item.id, "evidence.id"),
    kind: "mock-evidence-observation",
    subject: requireString(item.subject, "evidence.subject"),
    source: requireString(item.source, "evidence.source"),
    timestamp: requireTimestamp(item.timestamp, "evidence.timestamp"),
    uncertainty: requireUncertainty(item.uncertainty, "evidence.uncertainty"),
    degradedState,
    degradedReason: degradedState === DegradedState.NOMINAL ? null : item.degradedReason,
    simulation: true,
    providerClaim: false,
    truthClaim: false,
  });
}

function normalizeInterpretation(item, evidenceById) {
  requireRecord(item, "interpretation");
  if (!Array.isArray(item.evidenceIds) || item.evidenceIds.length === 0) {
    throw new TypeError("interpretation.evidenceIds must be a non-empty array");
  }
  const evidenceIds = item.evidenceIds.map((id, index) =>
    requireString(id, `interpretation.evidenceIds[${index}]`));
  if (new Set(evidenceIds).size !== evidenceIds.length) {
    throw new TypeError(`Interpretation has duplicate evidence references: ${String(item.id)}`);
  }
  const evidence = evidenceIds.map((id) => {
    const record = evidenceById.get(id);
    if (!record) throw new TypeError(`Interpretation references unknown evidence: ${id}`);
    return record;
  });
  const degraded = evidence.some(({ degradedState }) =>
    degradedState !== DegradedState.NOMINAL);

  return Object.freeze({
    id: requireString(item.id, "interpretation.id"),
    kind: "mock-oracle-interpretation",
    statement: requireString(item.statement, "interpretation.statement"),
    evidenceIds: Object.freeze(evidenceIds),
    uncertainty: Math.max(...evidence.map(({ uncertainty }) => uncertainty)),
    degradedState: degraded ? DegradedState.DEGRADED : DegradedState.NOMINAL,
    basis: "declared-mock-evidence",
    simulation: true,
    truthClaim: false,
    authoritative: false,
  });
}

function requireUniqueIds(records) {
  const ids = new Set();
  for (const record of records) {
    if (ids.has(record.id)) throw new TypeError(`Duplicate record id: ${record.id}`);
    ids.add(record.id);
  }
}

/** Build a deterministic contribution from caller-supplied mock/demo fixtures. */
export function createLiveGatewayContribution({
  updatedAt,
  evidence = [],
  interpretations = [],
}) {
  requireTimestamp(updatedAt, "updatedAt");
  if (!Array.isArray(evidence) || !Array.isArray(interpretations)) {
    throw new TypeError("evidence and interpretations must be arrays");
  }

  const normalizedEvidence = evidence.map(normalizeEvidence);
  requireUniqueIds(normalizedEvidence);
  const evidenceById = new Map(normalizedEvidence.map((item) => [item.id, item]));
  const normalizedInterpretations = interpretations.map((item) =>
    normalizeInterpretation(item, evidenceById));
  requireUniqueIds([...normalizedEvidence, ...normalizedInterpretations]);

  return Object.freeze({
    schemaVersion: LIVE_GATEWAY_SCHEMA_VERSION,
    source: LIVE_GATEWAY_SOURCE,
    simulation: true,
    updatedAt,
    entities: Object.freeze(normalizedInterpretations),
    evidence: Object.freeze([
      ...normalizedEvidence,
      Object.freeze({
        id: `live-gateway-boundary:${updatedAt}`,
        kind: "simulation-boundary",
        source: "local-mock-fixtures",
        timestamp: updatedAt,
        uncertainty: 1,
        degradedState: DegradedState.UNAVAILABLE,
        degradedReason: "external-providers-disabled",
        simulation: true,
        providerCredentials: false,
        liveData: false,
        truthClaim: false,
      }),
    ]),
    capabilities: LIVE_GATEWAY_CAPABILITIES,
  });
}
