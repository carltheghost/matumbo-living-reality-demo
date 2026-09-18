/**
 * TUMBO Asset Token projection data. This module models fictional value
 * movement for local presentation only; it cannot execute or authorize
 * financial activity.
 */

export const PAYCORE_SCHEMA_VERSION = 1;
export const PAYCORE_SOURCE = "tumbo-paycore";

// Asset-token spellings are the canonical PAYCORE entity kinds. They are part
// of every newly emitted contribution and are intentionally kept separate from
// the historical compatibility values below.
export const PAYCORE_ENTITY_KINDS = Object.freeze({
  BALANCE: "asset-token-balance-preview",
  FLOW: "asset-token-flow-preview",
});

// Descriptive alias retained for callers that imported the pre-migration name.
// It points at the canonical values, so new callers cannot accidentally emit
// the historical vocabulary.
export const PAYCORE_ASSET_TOKEN_ENTITY_KINDS = PAYCORE_ENTITY_KINDS;

// Historical fixture values are accepted only by the explicit parser boundary
// below. They are never emitted by createPaycoreContribution and never used in
// user-facing copy.
export const PAYCORE_LEGACY_ENTITY_KINDS = Object.freeze({
  BALANCE: "coin-balance-preview",
  FLOW: "coin-flow-preview",
});

const PAYCORE_ENTITY_KIND_COMPATIBILITY = Object.freeze({
  [PAYCORE_ENTITY_KINDS.BALANCE]: PAYCORE_ENTITY_KINDS.BALANCE,
  [PAYCORE_ENTITY_KINDS.FLOW]: PAYCORE_ENTITY_KINDS.FLOW,
  [PAYCORE_LEGACY_ENTITY_KINDS.BALANCE]: PAYCORE_ENTITY_KINDS.BALANCE,
  [PAYCORE_LEGACY_ENTITY_KINDS.FLOW]: PAYCORE_ENTITY_KINDS.FLOW,
});

/**
 * Normalize a PAYCORE entity kind at the compatibility/parser boundary.
 *
 * The domain emits only asset-token kinds. A historical coin-* value is
 * accepted here so saved fixtures can still be replayed, while unknown values
 * return null and are ignored by renderer adapters.
 */
export function normalizePaycoreEntityKind(kind) {
  if (typeof kind !== "string") return null;
  const normalized = kind.trim();
  return Object.hasOwn(PAYCORE_ENTITY_KIND_COMPATIBILITY, normalized)
    ? PAYCORE_ENTITY_KIND_COMPATIBILITY[normalized]
    : null;
}

export const FlowStatus = Object.freeze({
  PREVIEW: "preview",
  BLOCKED: "blocked",
});

const CAPABILITIES = Object.freeze([
  Object.freeze({
    id: "paycore-preview-balances",
    label: "Preview fictional TUMBO Asset Token balances",
    enabled: true,
    mode: "local-projection",
    authority: "none",
  }),
  Object.freeze({
    id: "paycore-preview-flows",
    label: "Preview fictional value flows",
    enabled: true,
    mode: "local-projection",
    authority: "none",
  }),
  Object.freeze({
    id: "paycore-external-financial-action",
    label: "Execute, sign, custody, transfer, or settle value",
    enabled: false,
    mode: "denied",
    authority: "none",
  }),
]);

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function requireAmount(value, field) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} must be a finite, non-negative number`);
  }
  return value;
}

function uniqueById(records, label) {
  const ids = new Set();
  for (const record of records) {
    if (ids.has(record.id)) throw new TypeError(`Duplicate ${label} id: ${record.id}`);
    ids.add(record.id);
  }
}

function normalizeBalance(balance) {
  if (!balance || typeof balance !== "object" || Array.isArray(balance)) {
    throw new TypeError("balance must be an object");
  }

  return Object.freeze({
    id: requireString(balance.id, "balance.id"),
    kind: PAYCORE_ENTITY_KINDS.BALANCE,
    label: requireString(balance.label, "balance.label"),
    unit: requireString(balance.unit, "balance.unit"),
    amount: requireAmount(balance.amount, "balance.amount"),
    simulation: true,
  });
}

function normalizeFlow(flow, balancesById) {
  if (!flow || typeof flow !== "object" || Array.isArray(flow)) {
    throw new TypeError("flow must be an object");
  }

  const id = requireString(flow.id, "flow.id");
  const fromBalanceId = requireString(flow.fromBalanceId, "flow.fromBalanceId");
  const toBalanceId = requireString(flow.toBalanceId, "flow.toBalanceId");
  const amount = requireAmount(flow.amount, "flow.amount");
  const source = balancesById.get(fromBalanceId);
  const destination = balancesById.get(toBalanceId);

  if (!source) throw new TypeError(`Flow references unknown balance: ${fromBalanceId}`);
  if (!destination) throw new TypeError(`Flow references unknown balance: ${toBalanceId}`);
  if (fromBalanceId === toBalanceId) {
    throw new TypeError(`Flow must reference two different balances: ${id}`);
  }
  if (source.unit !== destination.unit) {
    throw new TypeError(`Flow balances must use the same fictional unit: ${id}`);
  }

  const status = amount <= source.amount ? FlowStatus.PREVIEW : FlowStatus.BLOCKED;
  return Object.freeze({
    id,
    kind: PAYCORE_ENTITY_KINDS.FLOW,
    fromBalanceId,
    toBalanceId,
    unit: source.unit,
    amount,
    status,
    simulation: true,
    executable: false,
    reason: status === FlowStatus.BLOCKED ? "insufficient-simulated-balance" : null,
  });
}

/**
 * Build a deterministic local projection. Flows are independent previews and
 * never mutate balances or cause an external side effect.
 */
export function createPaycoreContribution({ updatedAt, balances = [], flows = [] }) {
  requireString(updatedAt, "updatedAt");
  if (!Array.isArray(balances) || !Array.isArray(flows)) {
    throw new TypeError("balances and flows must be arrays");
  }

  const normalizedBalances = balances.map(normalizeBalance);
  uniqueById(normalizedBalances, "balance");
  const balancesById = new Map(normalizedBalances.map((balance) => [balance.id, balance]));
  const normalizedFlows = flows.map((flow) => normalizeFlow(flow, balancesById));
  uniqueById(normalizedFlows, "flow");

  return Object.freeze({
    schemaVersion: PAYCORE_SCHEMA_VERSION,
    source: PAYCORE_SOURCE,
    simulation: true,
    updatedAt,
    entities: Object.freeze([...normalizedBalances, ...normalizedFlows]),
    evidence: Object.freeze([
      Object.freeze({
        id: `paycore-boundary:${updatedAt}`,
        kind: "simulation-boundary",
        status: "enforced",
        simulation: true,
        note: "Preview data only; no financial authority or external execution is available.",
      }),
    ]),
    capabilities: CAPABILITIES,
  });
}

export { CAPABILITIES as PAYCORE_CAPABILITIES };
