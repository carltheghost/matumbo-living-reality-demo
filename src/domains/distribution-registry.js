/**
 * Deterministic fictional recipient registry for the TUMBO social-experiment
 * launch rehearsal.
 *
 * The registry is intentionally aggregate. It can describe coverage of every
 * county/community cohort, participating organisation cohort, or international
 * public-good fund cohort without storing a person, address, wallet, account,
 * or real-world payment instruction. A launch preview is a pure projection:
 * it creates a replayable event and ledger-shaped records in memory only.
 */

import {
  ASSET_TOKEN_ALLOCATIONS,
  ASSET_TOKEN_PROVENANCE,
  ASSET_TOKEN_SOURCE,
  ASSET_TOKEN_TOTAL_BASIS_POINTS,
  ASSET_TOKEN_TOTAL_SUPPLY,
  ASSET_TOKEN_UNIT,
} from "./asset-token.js";

export const DISTRIBUTION_REGISTRY_SCHEMA_VERSION = 1;
export const DISTRIBUTION_REGISTRY_SOURCE = "tumbo-distribution-registry";
export const DISTRIBUTION_LAUNCH_ID = "distribution:tumbo-demo-launch";
export const DISTRIBUTION_LAUNCH_EVENT_ID = "distribution-event:tumbo-demo-launch";
export const DISTRIBUTION_UPDATED_AT = "2026-09-03T00:00:00.000Z";
export const DISTRIBUTION_REHEARSAL_ACTION_ID = "distribution-action:tumbo-demo-launch-rehearsal";
export const DISTRIBUTION_REHEARSAL_SCHEMA_VERSION = 1;

const freeze = (value) => Object.freeze(value);

const REGISTRY_CAPABILITIES = freeze([
  freeze({
    id: "distribution.preview-aggregate-recipient-cohorts",
    label: "Preview aggregate fictional recipient cohorts",
    enabled: true,
    mode: "local-projection",
    authority: "none",
    simulationOnly: true,
    executable: false,
  }),
  freeze({
    id: "distribution.reconcile-fixed-supply",
    label: "Reconcile the fixed TUMBO-SIM supply and allocation schedule",
    enabled: true,
    mode: "local-projection",
    authority: "none",
    simulationOnly: true,
    executable: false,
  }),
  freeze({
    id: "distribution.external-transfer",
    label: "Send a token to a county, organisation, fund, or person",
    enabled: false,
    mode: "denied",
    authority: "none",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "The registry contains aggregate fictional cohorts only; no recipient address exists.",
  }),
  freeze({
    id: "distribution.wallet-custody",
    label: "Connect a wallet or custody recipient assets",
    enabled: false,
    mode: "denied",
    authority: "none",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "The social-experiment preview never accepts a wallet or account.",
  }),
  freeze({
    id: "distribution.signing-settlement",
    label: "Sign, settle, or publish a distribution instruction",
    enabled: false,
    mode: "denied",
    authority: "none",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "Preview records are not executable settlement instructions.",
  }),
  freeze({
    id: "distribution.real-money",
    label: "Represent money, a claim, or a financial instrument",
    enabled: false,
    mode: "denied",
    authority: "none",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "TUMBO-SIM has no price, value claim, or real-money authority.",
  }),
]);

export const DISTRIBUTION_REGISTRY_CAPABILITIES = REGISTRY_CAPABILITIES;

const CLASS_ALLOCATION_BY_ID = new Map(
  ASSET_TOKEN_ALLOCATIONS.map((allocation) => [allocation.id, allocation]),
);

// Every row is an aggregate fictional cohort. The deterministic registry keys
// are safe to share and deliberately do not identify a real county, company,
// organisation, fund, person, or account.
const REGISTRY_DEFINITIONS = [
  { id: "cohort:public-social:opt-in", registryKey: "cohort:public-social:opt-in", allocationId: "allocation:public-social-experiment", label: "Opt-in social-experiment participants", shareBasisPoints: 1_000, coverage: "all opt-in demo participant cohorts" },
  { id: "cohort:public-social:builders", registryKey: "cohort:public-social:builders", allocationId: "allocation:public-social-experiment", label: "Community builders in the social experiment", shareBasisPoints: 800, coverage: "all fictional builder cohorts" },
  { id: "cohort:public-social:explorers", registryKey: "cohort:public-social:explorers", allocationId: "allocation:public-social-experiment", label: "Space-explorer demo cohorts", shareBasisPoints: 700, coverage: "all fictional explorer cohorts" },
  { id: "cohort:county:alpha", registryKey: "cohort:county:alpha", allocationId: "allocation:county-community", label: "County/community cohort Alpha", shareBasisPoints: 500, coverage: "every fictional county and community in cohort Alpha" },
  { id: "cohort:county:beta", registryKey: "cohort:county:beta", allocationId: "allocation:county-community", label: "County/community cohort Beta", shareBasisPoints: 500, coverage: "every fictional county and community in cohort Beta" },
  { id: "cohort:county:gamma", registryKey: "cohort:county:gamma", allocationId: "allocation:county-community", label: "County/community cohort Gamma", shareBasisPoints: 500, coverage: "every fictional county and community in cohort Gamma" },
  { id: "cohort:county:delta", registryKey: "cohort:county:delta", allocationId: "allocation:county-community", label: "County/community cohort Delta", shareBasisPoints: 500, coverage: "every fictional county and community in cohort Delta" },
  { id: "cohort:organization:civic", registryKey: "cohort:organization:civic", allocationId: "allocation:organizations", label: "Civic and public-service organisations", shareBasisPoints: 500, coverage: "all fictional civic organisation cohorts" },
  { id: "cohort:organization:research", registryKey: "cohort:organization:research", allocationId: "allocation:organizations", label: "Education and research organisations", shareBasisPoints: 500, coverage: "all fictional education and research cohorts" },
  { id: "cohort:organization:community", registryKey: "cohort:organization:community", allocationId: "allocation:organizations", label: "Nonprofit and community organisations", shareBasisPoints: 500, coverage: "all fictional nonprofit and community cohorts" },
  { id: "cohort:fund:public-good", registryKey: "cohort:fund:public-good", allocationId: "allocation:international-public-good", label: "International public-good funds", shareBasisPoints: 500, coverage: "all fictional international public-good fund cohorts" },
  { id: "cohort:fund:humanitarian", registryKey: "cohort:fund:humanitarian", allocationId: "allocation:international-public-good", label: "International humanitarian funds", shareBasisPoints: 500, coverage: "all fictional international humanitarian fund cohorts" },
  { id: "cohort:fund:climate", registryKey: "cohort:fund:climate", allocationId: "allocation:international-public-good", label: "International climate and resilience funds", shareBasisPoints: 500, coverage: "all fictional international climate fund cohorts" },
  { id: "cohort:grant:builders", registryKey: "cohort:grant:builders", allocationId: "allocation:ecosystem-grants", label: "Ecosystem builder grants", shareBasisPoints: 500, coverage: "all fictional local builder grant cohorts" },
  { id: "cohort:grant:creators", registryKey: "cohort:grant:creators", allocationId: "allocation:ecosystem-grants", label: "Ecosystem creator and research grants", shareBasisPoints: 500, coverage: "all fictional creator and open-research grant cohorts" },
  { id: "cohort:reserve:treasury", registryKey: "cohort:reserve:treasury", allocationId: "allocation:treasury-reserve", label: "Treasury reserve", shareBasisPoints: 1_000, coverage: "ring-fenced fictional reserve" },
  { id: "cohort:reserve:operations", registryKey: "cohort:reserve:operations", allocationId: "allocation:operations", label: "Demo operations reserve", shareBasisPoints: 300, coverage: "fictional hosting, moderation, accessibility, and observability reserve" },
  { id: "cohort:reserve:insurance", registryKey: "cohort:reserve:insurance", allocationId: "allocation:insurance-risk-reserve", label: "Insurance and risk reserve", shareBasisPoints: 200, coverage: "fictional failure and recovery rehearsal reserve" },
];

function freezeRecord(record) {
  return freeze({ ...record, provenance: record.provenance ? freeze({ ...record.provenance }) : undefined });
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${field} must be a non-empty string`);
  return value;
}

function requireTimestamp(value, field) {
  requireString(value, field);
  if (!Number.isFinite(Date.parse(value))) throw new TypeError(`${field} must be a valid timestamp`);
  return value;
}

function allocationUnits(basisPoints) {
  const units = (ASSET_TOKEN_TOTAL_SUPPLY * basisPoints) / ASSET_TOKEN_TOTAL_BASIS_POINTS;
  if (!Number.isSafeInteger(units)) throw new TypeError(`Registry share ${basisPoints} does not produce integer units`);
  return units;
}

function validateDefinitions(definitions) {
  if (!Array.isArray(definitions) || definitions.length === 0) throw new TypeError("recipientDefinitions must be a non-empty array");
  const ids = new Set();
  const classTotals = new Map();
  let totalBasisPoints = 0;
  let totalUnits = 0;
  const rows = definitions.map((definition, index) => {
    if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new TypeError(`recipientDefinitions[${index}] must be an object`);
    const id = requireString(definition.id, `recipientDefinitions[${index}].id`);
    const registryKey = requireString(definition.registryKey, `recipientDefinitions[${index}].registryKey`);
    const allocationId = requireString(definition.allocationId, `recipientDefinitions[${index}].allocationId`);
    const allocation = CLASS_ALLOCATION_BY_ID.get(allocationId);
    if (!allocation) throw new TypeError(`recipientDefinitions[${index}] references unknown allocation: ${allocationId}`);
    if (ids.has(id)) throw new TypeError(`Duplicate recipient registry id: ${id}`);
    ids.add(id);
    if (registryKey !== id) throw new TypeError(`registryKey must equal id for deterministic aggregate rows: ${id}`);
    if (!Number.isInteger(definition.shareBasisPoints) || definition.shareBasisPoints <= 0) throw new TypeError(`recipientDefinitions[${index}].shareBasisPoints must be a positive integer`);
    const tokenUnits = allocationUnits(definition.shareBasisPoints);
    const nextClassTotal = (classTotals.get(allocationId) ?? 0) + definition.shareBasisPoints;
    classTotals.set(allocationId, nextClassTotal);
    totalBasisPoints += definition.shareBasisPoints;
    totalUnits += tokenUnits;
    return freezeRecord({
      id,
      kind: "aggregate-recipient-cohort",
      type: "fictional-recipient-registry-entry",
      registryKey,
      allocationId,
      recipientClass: allocation.recipientClass,
      label: requireString(definition.label, `recipientDefinitions[${index}].label`),
      coverage: requireString(definition.coverage, `recipientDefinitions[${index}].coverage`),
      shareBasisPoints: definition.shareBasisPoints,
      percentage: definition.shareBasisPoints / 100,
      percent: definition.shareBasisPoints / 100,
      tokenUnits,
      unit: ASSET_TOKEN_UNIT,
      aggregate: true,
      fictional: true,
      simulation: true,
      externalTransfer: false,
      executable: false,
    });
  });

  for (const allocation of ASSET_TOKEN_ALLOCATIONS) {
    const classTotal = classTotals.get(allocation.id) ?? 0;
    if (classTotal !== allocation.basisPoints) {
      throw new TypeError(`Recipient rows for ${allocation.id} must sum to ${allocation.basisPoints}; received ${classTotal}`);
    }
  }
  if (totalBasisPoints !== ASSET_TOKEN_TOTAL_BASIS_POINTS) throw new TypeError(`Recipient registry basis points must sum to ${ASSET_TOKEN_TOTAL_BASIS_POINTS}; received ${totalBasisPoints}`);
  if (totalUnits !== ASSET_TOKEN_TOTAL_SUPPLY) throw new TypeError(`Recipient registry units must sum to ${ASSET_TOKEN_TOTAL_SUPPLY}; received ${totalUnits}`);
  return freeze(rows);
}

export const DEFAULT_RECIPIENT_DEFINITIONS = freeze(REGISTRY_DEFINITIONS.map((definition) => freeze({ ...definition })));
export const FICTIONAL_RECIPIENT_REGISTRY = validateDefinitions(DEFAULT_RECIPIENT_DEFINITIONS);

/**
 * Collapse the row-level registry into the allocation classes that a viewer
 * can understand at a glance.  The rows remain the canonical aggregate
 * coverage records; this summary is a read-only index over those same rows,
 * never a second schedule.  Keeping the class totals here lets the Launch
 * Kit, Launch Distribution console, and Social Explorer show the exact
 * county/community, organisation, fund, grant, treasury, and operations
 * coverage without re-implementing allocation math in each renderer.
 */
export function summarizeDistributionRegistry(rows = FICTIONAL_RECIPIENT_REGISTRY) {
  if (!Array.isArray(rows)) throw new TypeError("registry rows must be an array");

  const classTotals = new Map();
  rows.forEach((row, index) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new TypeError(`registry[${index}] must be an object`);
    }
    const allocationId = requireString(row.allocationId, `registry[${index}].allocationId`);
    const allocation = CLASS_ALLOCATION_BY_ID.get(allocationId);
    if (!allocation) throw new TypeError(`registry[${index}] references unknown allocation: ${allocationId}`);
    const basisPoints = Number.isSafeInteger(row.shareBasisPoints)
      ? row.shareBasisPoints
      : row.basisPoints;
    const tokenUnits = Number.isSafeInteger(row.tokenUnits)
      ? row.tokenUnits
      : row.units;
    if (!Number.isSafeInteger(basisPoints) || basisPoints <= 0) {
      throw new TypeError(`registry[${index}].basisPoints must be a positive safe integer`);
    }
    if (!Number.isSafeInteger(tokenUnits) || tokenUnits <= 0) {
      throw new TypeError(`registry[${index}].tokenUnits must be a positive safe integer`);
    }
    const current = classTotals.get(allocationId) ?? {
      rowCount: 0,
      basisPoints: 0,
      tokenUnits: 0,
    };
    current.rowCount += 1;
    current.basisPoints += basisPoints;
    current.tokenUnits += tokenUnits;
    classTotals.set(allocationId, current);
  });

  const classes = ASSET_TOKEN_ALLOCATIONS.map((allocation) => {
    const totals = classTotals.get(allocation.id) ?? { rowCount: 0, basisPoints: 0, tokenUnits: 0 };
    const expectedTokenUnits = allocationUnits(allocation.basisPoints);
    return freeze({
      allocationId: allocation.id,
      recipientClass: allocation.recipientClass,
      label: allocation.label,
      purpose: allocation.purpose,
      rowCount: totals.rowCount,
      basisPoints: totals.basisPoints,
      expectedBasisPoints: allocation.basisPoints,
      percentage: totals.basisPoints / 100,
      tokenUnits: totals.tokenUnits,
      expectedTokenUnits,
      unit: ASSET_TOKEN_UNIT,
      complete: totals.rowCount > 0
        && totals.basisPoints === allocation.basisPoints
        && totals.tokenUnits === expectedTokenUnits,
      aggregate: true,
      fictional: true,
      simulation: true,
      executable: false,
      externalTransfer: false,
    });
  });
  const totalBasisPoints = classes.reduce((sum, allocation) => sum + allocation.basisPoints, 0);
  const totalUnits = classes.reduce((sum, allocation) => sum + allocation.tokenUnits, 0);
  const complete = classes.every((allocation) => allocation.complete)
    && totalBasisPoints === ASSET_TOKEN_TOTAL_BASIS_POINTS
    && totalUnits === ASSET_TOKEN_TOTAL_SUPPLY;
  return freeze({
    allocationCount: classes.length,
    registryRowCount: rows.length,
    classes: freeze(classes),
    totalBasisPoints,
    expectedBasisPoints: ASSET_TOKEN_TOTAL_BASIS_POINTS,
    totalUnits,
    expectedUnits: ASSET_TOKEN_TOTAL_SUPPLY,
    totalSupply: ASSET_TOKEN_TOTAL_SUPPLY,
    unit: ASSET_TOKEN_UNIT,
    fixedSupply: true,
    complete,
    aggregate: true,
    fictional: true,
    simulation: true,
    executable: false,
    externalDistribution: false,
    externalTransfer: false,
    boundary: "Read-only aggregate class summary; no recipient, wallet, transfer, custody, signing, or settlement authority exists.",
  });
}

function createRegistryEvidence(rows, updatedAt) {
  const basisPoints = rows.reduce((sum, row) => sum + row.shareBasisPoints, 0);
  const tokenUnits = rows.reduce((sum, row) => sum + row.tokenUnits, 0);
  const classes = [...new Set(rows.map((row) => row.recipientClass))].sort();
  return freeze([
    freeze({
      id: `distribution-registry-reconciliation:${updatedAt}`,
      kind: "recipient-registry-reconciliation",
      status: "verified",
      simulation: true,
      registryEntryCount: rows.length,
      recipientClassCount: classes.length,
      recipientClasses: freeze(classes),
      basisPoints,
      expectedBasisPoints: ASSET_TOKEN_TOTAL_BASIS_POINTS,
      tokenUnits,
      expectedTokenUnits: ASSET_TOKEN_TOTAL_SUPPLY,
      externalAddresses: false,
      note: "Aggregate fictional cohort rows reconcile exactly to the fixed simulated supply.",
    }),
    freeze({
      id: `distribution-registry-boundary:${updatedAt}`,
      kind: "simulation-boundary",
      status: "enforced",
      simulation: true,
      externalTransfer: false,
      walletConnection: false,
      custody: false,
      signing: false,
      settlement: false,
      realMoney: false,
      note: "Launch preview records never become recipient instructions or payments.",
    }),
    freeze({
      id: `distribution-registry-provenance:${updatedAt}`,
      kind: "deterministic-provenance",
      status: "declared",
      simulation: true,
      deterministic: true,
      source: ASSET_TOKEN_PROVENANCE.source,
      version: ASSET_TOKEN_PROVENANCE.version,
      basis: ASSET_TOKEN_PROVENANCE.basis,
      registrySource: DISTRIBUTION_REGISTRY_SOURCE,
      note: "No address, provider, identity registry, price, or market feed is used.",
    }),
  ]);
}

/**
 * Create the pure, replay-safe launch preview event and its distribution
 * records. Calling this twice with the same arguments returns equivalent
 * frozen data and performs no I/O.
 */
export function createLaunchDistributionPreview({
  updatedAt = DISTRIBUTION_UPDATED_AT,
  recipientDefinitions = DEFAULT_RECIPIENT_DEFINITIONS,
  launchId = DISTRIBUTION_LAUNCH_ID,
} = {}) {
  requireTimestamp(updatedAt, "updatedAt");
  requireString(launchId, "launchId");
  const rows = validateDefinitions(recipientDefinitions);
  const allocationSummary = summarizeDistributionRegistry(rows);
  const event = freezeRecord({
    id: launchId === DISTRIBUTION_LAUNCH_ID ? DISTRIBUTION_LAUNCH_EVENT_ID : `distribution-event:${launchId.replace(/[^a-z0-9_-]+/gi, "-")}`,
    kind: "asset-token-launch-distribution-preview",
    launchId,
    trigger: "demo-launch",
    status: "previewed",
    simulation: true,
    fixedSupply: true,
    totalSupply: ASSET_TOKEN_TOTAL_SUPPLY,
    unit: ASSET_TOKEN_UNIT,
    registryEntryCount: rows.length,
    externalDistribution: false,
    externalTransfer: false,
    executable: false,
    occurredAt: updatedAt,
    provenance: {
      ...ASSET_TOKEN_PROVENANCE,
      source: ASSET_TOKEN_SOURCE,
      registrySource: DISTRIBUTION_REGISTRY_SOURCE,
      deterministicKey: `${DISTRIBUTION_REGISTRY_SOURCE}:${launchId}:v1`,
    },
  });
  const records = rows.map((row, index) => freezeRecord({
    id: `distribution-record:${launchId}:${String(index + 1).padStart(2, "0")}`,
    kind: "asset-token-distribution-preview-record",
    launchId,
    launchEventId: event.id,
    registryEntryId: row.id,
    registryKey: row.registryKey,
    recipientClass: row.recipientClass,
    recipientLabel: row.label,
    coverage: row.coverage,
    allocationId: row.allocationId,
    basisPoints: row.shareBasisPoints,
    percentage: row.percent,
    tokenUnits: row.tokenUnits,
    unit: ASSET_TOKEN_UNIT,
    status: "simulated",
    simulation: true,
    fictional: true,
    aggregate: true,
    externalTransfer: false,
    executable: false,
    ordinal: index + 1,
  }));
  const evidence = createRegistryEvidence(rows, updatedAt);
  return freeze({
    schemaVersion: DISTRIBUTION_REGISTRY_SCHEMA_VERSION,
    source: DISTRIBUTION_REGISTRY_SOURCE,
    simulation: true,
    updatedAt,
    kind: "asset-token-distribution-registry-projection",
    launchId,
    launchEvent: event,
    registry: rows,
    records,
    allocationSummary,
    entities: freeze([event, ...rows, ...records]),
    evidence,
    capabilities: REGISTRY_CAPABILITIES,
    totalSupply: ASSET_TOKEN_TOTAL_SUPPLY,
    unit: ASSET_TOKEN_UNIT,
    fixedSupply: true,
    externalDistribution: false,
    provenance: freeze({
      ...ASSET_TOKEN_PROVENANCE,
      registrySource: DISTRIBUTION_REGISTRY_SOURCE,
      deterministicKey: `${DISTRIBUTION_REGISTRY_SOURCE}:${launchId}:v1`,
    }),
  });
}

/**
 * Produce one explicit, inspectable local launch-distribution rehearsal.
 *
 * The preview above is the canonical registry contribution.  This action is
 * a thin, replay-safe receipt over that contribution so a demo launch (or a
 * user button) can visibly prove that every aggregate row and allocation
 * class was checked against the same fixed supply.  It never creates a
 * recipient, address, wallet, instruction, transfer, or mutable state.
 */
export function createLaunchDistributionRehearsal({
  updatedAt = DISTRIBUTION_UPDATED_AT,
  recipientDefinitions = DEFAULT_RECIPIENT_DEFINITIONS,
  launchId = DISTRIBUTION_LAUNCH_ID,
  method = "demo-launch",
} = {}) {
  requireTimestamp(updatedAt, "updatedAt");
  requireString(launchId, "launchId");
  requireString(method, "method");
  const preview = createLaunchDistributionPreview({
    updatedAt,
    recipientDefinitions,
    launchId,
  });
  const allocationSummary = preview.allocationSummary;
  const registryComplete = allocationSummary.complete === true
    && preview.registry.length === preview.records.length
    && preview.registry.length > 0
    && preview.records.every((record) => record.aggregate === true && record.executable === false);
  const classChecks = allocationSummary.classes.map((allocation) => freeze({
    allocationId: allocation.allocationId,
    label: allocation.label,
    recipientClass: allocation.recipientClass,
    rowCount: allocation.rowCount,
    basisPoints: allocation.basisPoints,
    expectedBasisPoints: allocation.expectedBasisPoints,
    tokenUnits: allocation.tokenUnits,
    expectedTokenUnits: allocation.expectedTokenUnits,
    complete: allocation.complete === true,
    aggregate: true,
    fictional: true,
    simulation: true,
    executable: false,
    externalTransfer: false,
  }));
  return freeze({
    schemaVersion: DISTRIBUTION_REHEARSAL_SCHEMA_VERSION,
    source: DISTRIBUTION_REGISTRY_SOURCE,
    actionId: DISTRIBUTION_REHEARSAL_ACTION_ID,
    kind: "asset-token-launch-distribution-rehearsal",
    launchId,
    eventId: preview.launchEvent.id,
    trigger: method,
    status: registryComplete ? "reconciled" : "review",
    simulation: true,
    localOnly: true,
    deterministic: true,
    fixedSupply: true,
    registryComplete,
    registryEntryCount: preview.registry.length,
    allocationClassCount: allocationSummary.allocationCount,
    completeClassCount: classChecks.filter((allocation) => allocation.complete).length,
    totalBasisPoints: allocationSummary.totalBasisPoints,
    expectedBasisPoints: allocationSummary.expectedBasisPoints,
    totalUnits: allocationSummary.totalUnits,
    expectedUnits: allocationSummary.expectedUnits,
    totalSupply: preview.totalSupply,
    unit: preview.unit,
    allocationSummary,
    classChecks: freeze(classChecks),
    registryEntryIds: freeze(preview.registry.map((row) => row.id)),
    previewEvent: preview.launchEvent,
    externalDistribution: false,
    externalTransfer: false,
    walletConnection: false,
    custody: false,
    signing: false,
    settlement: false,
    issuance: false,
    executable: false,
    money: false,
    authority: "none",
    boundary: "Local TUMBO-SIM rehearsal receipt only; all rows are aggregate fictional cohorts and no issuance, no recipient address, wallet, custody, signing, transfer, settlement, money, or persistence exists.",
  });
}

export const DEFAULT_LAUNCH_DISTRIBUTION_PREVIEW = createLaunchDistributionPreview();
export const createDistributionRegistryContribution = createLaunchDistributionPreview;
export const createTumboDistributionRegistryContribution = createLaunchDistributionPreview;

export default DEFAULT_LAUNCH_DISTRIBUTION_PREVIEW;
