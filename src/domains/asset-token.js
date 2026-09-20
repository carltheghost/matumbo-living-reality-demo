/**
 * TUMBO Asset Token Ω — a deterministic, simulation-only launch projection.
 *
 * This module describes how a fictional asset-token allocation could be
 * visualised when the maTumbo social-experiment / space-explorer demo starts.
 * It is deliberately not an issuer, wallet, custody service, signer,
 * settlement engine, exchange, or financial instrument. Every record emitted
 * here is local projection data and carries a simulation boundary.
 *
 * Supply numbers come from token-config.js (single source of truth).
 * TUMBO_MAX_SUPPLY is undecided and must never be rendered in UI.
 */

import {
  DEMO_REHEARSAL_SUPPLY_UNITS,
  TUMBO_TOTAL_BASIS_POINTS,
  TUMBO_UNIT,
  TUMBO_SYMBOL,
} from "./token-config.js";

export const ASSET_TOKEN_SCHEMA_VERSION = 1;
export const ASSET_TOKEN_SOURCE = "tumbo-asset-token";
export const ASSET_TOKEN_SYMBOL = TUMBO_SYMBOL;
export const ASSET_TOKEN_UNIT = TUMBO_UNIT;
export const ASSET_TOKEN_KIND = "asset-token";
export const ASSET_TOKEN_TOTAL_BASIS_POINTS = TUMBO_TOTAL_BASIS_POINTS;
/** @deprecated Use DEMO_REHEARSAL_SUPPLY_UNITS from token-config; not a public figure. */
export const ASSET_TOKEN_TOTAL_SUPPLY = DEMO_REHEARSAL_SUPPLY_UNITS;
export const ASSET_TOKEN_UPDATED_AT = "2026-09-03T00:00:00.000Z";

const FIXED_SUPPLY = DEMO_REHEARSAL_SUPPLY_UNITS;
const TOTAL_BASIS_POINTS = TUMBO_TOTAL_BASIS_POINTS;

const freeze = (value) => Object.freeze(value);

function freezeAllocation(definition) {
  return freeze({
    ...definition,
    provenance: freeze({ ...definition.provenance }),
  });
}

/**
 * Capabilities describe what the browser may present. Disabled entries are
 * explicit denials, not placeholders for a future implicit authority.
 */
export const ASSET_TOKEN_CAPABILITIES = freeze([
  freeze({
    id: "asset-token.preview-fixed-supply",
    label: "Preview a fixed TUMBO asset-token supply",
    enabled: true,
    mode: "local-projection",
    authority: "none",
    simulationOnly: true,
    executable: false,
  }),
  freeze({
    id: "asset-token.preview-launch-distribution",
    label: "Preview the social-experiment launch allocation",
    enabled: true,
    mode: "local-projection",
    authority: "none",
    simulationOnly: true,
    executable: false,
  }),
  freeze({
    id: "asset-token.live-issuance",
    label: "Issue, mint, or burn a live asset token",
    enabled: false,
    mode: "denied",
    authority: "none",
    status: "denied",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "No live issuance authority exists in the demo.",
  }),
  freeze({
    id: "asset-token.custody",
    label: "Hold or custody assets for a participant",
    enabled: false,
    mode: "denied",
    authority: "none",
    status: "denied",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "The projection never holds participant assets.",
  }),
  freeze({
    id: "asset-token.wallet-connection",
    label: "Connect a wallet or collect an address",
    enabled: false,
    mode: "denied",
    authority: "none",
    status: "denied",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "No wallet, account, or external identity is accepted.",
  }),
  freeze({
    id: "asset-token.signing",
    label: "Sign an asset-token instruction",
    enabled: false,
    mode: "denied",
    authority: "none",
    status: "denied",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "No private key or signing provider is available.",
  }),
  freeze({
    id: "asset-token.settlement",
    label: "Settle or reconcile a real transfer",
    enabled: false,
    mode: "denied",
    authority: "none",
    status: "denied",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "Allocation records are not settlement instructions.",
  }),
  freeze({
    id: "asset-token.external-transfer",
    label: "Transfer tokens to an external recipient",
    enabled: false,
    mode: "denied",
    authority: "none",
    status: "denied",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "Recipient classes are aggregate fictional cohorts only.",
  }),
  freeze({
    id: "asset-token.exchange-listing",
    label: "List or promote the asset token as a market instrument",
    enabled: false,
    mode: "denied",
    authority: "none",
    status: "denied",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "TUMBO-SIM has no market, price, or exchange status.",
  }),
  freeze({
    id: "asset-token.real-money",
    label: "Accept money or represent a financial claim",
    enabled: false,
    mode: "denied",
    authority: "none",
    status: "denied",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "The demo has no money, claim, or financial-instrument authority.",
  }),
]);

export const ASSET_TOKEN_PROVENANCE = freeze({
  source: "local-fixed-fixture",
  version: "asset-token-allocation-v1",
  basis: "deterministic-fixed-supply-basis-point-schedule",
  simulation: true,
  externalSource: false,
  deterministic: true,
});

const makeProvenance = (id, ordinal, basisPoints) => freeze({
  ...ASSET_TOKEN_PROVENANCE,
  id: `asset-token-provenance:${id}`,
  ordinal,
  basisPoints,
  deterministicKey: `${ASSET_TOKEN_SOURCE}:${id}:${basisPoints}:${ordinal}`,
});

const ALLOCATION_DEFINITIONS = [
  {
    id: "allocation:public-social-experiment",
    recipientClass: "public-social-experiment",
    label: "Public social-experiment participants",
    purpose: "Opt-in demo participants exploring the shared Living Reality.",
    basisPoints: 2_500,
  },
  {
    id: "allocation:county-community",
    recipientClass: "county-community",
    label: "County and community cohorts",
    purpose: "Fictional county, city, campus, and community cohorts in the demo.",
    basisPoints: 2_000,
  },
  {
    id: "allocation:organizations",
    recipientClass: "organizations",
    label: "Participating organisations",
    purpose: "Aggregate nonprofit, civic, educational, and research organization cohorts.",
    basisPoints: 1_500,
  },
  {
    id: "allocation:international-public-good",
    recipientClass: "international-public-good-funds",
    label: "International public-good funds",
    purpose: "Fictional cross-border public-good and humanitarian cohorts.",
    basisPoints: 1_500,
  },
  {
    id: "allocation:ecosystem-grants",
    recipientClass: "ecosystem-grants",
    label: "Ecosystem grants",
    purpose: "Local experiment builders, creators, and open research projects.",
    basisPoints: 1_000,
  },
  {
    id: "allocation:treasury-reserve",
    recipientClass: "treasury-reserve",
    label: "Treasury reserve",
    purpose: "A visibly ring-fenced simulation reserve for future demo scenarios.",
    basisPoints: 1_000,
  },
  {
    id: "allocation:operations",
    recipientClass: "operations",
    label: "Demo operations",
    purpose: "Fictional hosting, moderation, accessibility, and observability scenarios.",
    basisPoints: 300,
  },
  {
    id: "allocation:insurance-risk-reserve",
    recipientClass: "insurance-risk-reserve",
    label: "Insurance and risk reserve",
    purpose: "A simulation-only buffer for failure, recovery, and risk rehearsals.",
    basisPoints: 200,
  },
];

function allocationTokenUnits(basisPoints) {
  return (FIXED_SUPPLY * basisPoints) / TOTAL_BASIS_POINTS;
}

/**
 * The canonical allocation schedule. It uses aggregate recipient classes,
 * never addresses or named real-world recipients.
 */
export const ASSET_TOKEN_ALLOCATIONS = freeze(
  ALLOCATION_DEFINITIONS.map((definition, index) => {
    const { id, basisPoints } = definition;
    const tokenUnits = allocationTokenUnits(basisPoints);
    return freezeAllocation({
      ...definition,
      ordinal: index + 1,
      percentage: basisPoints / 100,
      percent: basisPoints / 100,
      tokenUnits,
      units: tokenUnits,
      simulation: true,
      executable: false,
      type: "asset-token-allocation",
      kind: "asset-token-allocation",
      provenance: makeProvenance(id, index + 1, basisPoints),
    });
  }),
);

// Descriptive aliases keep the module easy to consume from projection code.
export const DEFAULT_ASSET_TOKEN_ALLOCATIONS = ASSET_TOKEN_ALLOCATIONS;
export const TUMBO_ASSET_TOKEN_ALLOCATIONS = ASSET_TOKEN_ALLOCATIONS;

const allocationIds = ASSET_TOKEN_ALLOCATIONS.map(({ id }) => id);
const allocationClasses = ASSET_TOKEN_ALLOCATIONS.map(({ recipientClass }) => recipientClass);

export const ASSET_TOKEN_LAUNCH_DISTRIBUTION = freeze({
  id: "distribution:tumbo-demo-launch",
  kind: "asset-token-launch-distribution",
  label: "TUMBO social-experiment launch distribution preview",
  mode: "social-experiment-space-explorer-demo",
  trigger: "demo-launch-preview",
  status: "simulated",
  simulation: true,
  executable: false,
  externalDistribution: false,
  fixedSupply: true,
  totalSupply: FIXED_SUPPLY,
  unit: ASSET_TOKEN_UNIT,
  basisPoints: TOTAL_BASIS_POINTS,
  allocationIds: freeze([...allocationIds]),
  recipientClasses: freeze([...allocationClasses]),
  provenance: freeze({
    ...ASSET_TOKEN_PROVENANCE,
    id: "asset-token-provenance:launch-distribution",
    deterministicKey: `${ASSET_TOKEN_SOURCE}:launch-distribution:v1`,
  }),
  boundary: "No automatic distribution, transfer, custody, or financial activity occurs at launch.",
});

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

function requireBasisPoints(value, field) {
  if (!Number.isInteger(value) || value < 0 || value > TOTAL_BASIS_POINTS) {
    throw new TypeError(`${field} must be an integer between 0 and ${TOTAL_BASIS_POINTS}`);
  }
  return value;
}

function requireFiniteNonNegativeInteger(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a safe non-negative integer`);
  }
  return value;
}

function normalizeAllocations(allocations) {
  if (!Array.isArray(allocations)) {
    throw new TypeError("allocations must be an array");
  }

  const ids = new Set();
  let basisPointTotal = 0;
  let tokenUnitTotal = 0;
  const normalized = allocations.map((allocation, index) => {
    requireRecord(allocation, `allocations[${index}]`);
    const id = requireString(allocation.id, `allocations[${index}].id`);
    const recipientClass = requireString(
      allocation.recipientClass,
      `allocations[${index}].recipientClass`,
    );
    const label = requireString(allocation.label, `allocations[${index}].label`);
    const purpose = requireString(allocation.purpose, `allocations[${index}].purpose`);
    const basisPoints = requireBasisPoints(
      allocation.basisPoints,
      `allocations[${index}].basisPoints`,
    );
    if (ids.has(id)) throw new TypeError(`Duplicate allocation id: ${id}`);
    ids.add(id);

    const tokenUnits = allocationTokenUnits(basisPoints);
    if (!Number.isSafeInteger(tokenUnits)) {
      throw new TypeError(`Allocation units are not integral for ${id}`);
    }
    if ("tokenUnits" in allocation && allocation.tokenUnits !== tokenUnits) {
      throw new TypeError(`tokenUnits do not match basisPoints for ${id}`);
    }

    basisPointTotal += basisPoints;
    tokenUnitTotal += tokenUnits;
    return freezeAllocation({
      id,
      recipientClass,
      label,
      purpose,
      ordinal: index + 1,
      basisPoints,
      percentage: basisPoints / 100,
      percent: basisPoints / 100,
      tokenUnits,
      units: tokenUnits,
      simulation: true,
      executable: false,
      provenance: makeProvenance(id, index + 1, basisPoints),
    });
  });

  if (basisPointTotal !== TOTAL_BASIS_POINTS) {
    throw new TypeError(
      `Allocation basis points must sum to ${TOTAL_BASIS_POINTS}; received ${basisPointTotal}`,
    );
  }
  if (tokenUnitTotal !== FIXED_SUPPLY) {
    throw new TypeError(
      `Allocation token units must sum to ${FIXED_SUPPLY}; received ${tokenUnitTotal}`,
    );
  }
  return freeze(normalized);
}

function createTokenEntity(allocations) {
  return freeze({
    id: "asset-token:tumbo",
    type: ASSET_TOKEN_KIND,
    kind: ASSET_TOKEN_KIND,
    label: "TUMBO Asset Token (simulation only)",
    symbol: ASSET_TOKEN_SYMBOL,
    unit: ASSET_TOKEN_UNIT,
    assetClass: "simulation-only-asset-token",
    fixedSupply: true,
    totalSupply: FIXED_SUPPLY,
    decimals: 0,
    simulation: true,
    fictional: true,
    paymentInstrument: false,
    financialInstrument: false,
    transferable: false,
    issuable: false,
    custodial: false,
    signable: false,
    settleable: false,
    allocationIds: freeze(allocations.map(({ id }) => id)),
    launchDistributionId: ASSET_TOKEN_LAUNCH_DISTRIBUTION.id,
    provenance: ASSET_TOKEN_PROVENANCE,
    authorityBoundary:
      "Projection metadata only; no live issuance, custody, wallet, signing, settlement, transfer, or money authority.",
  });
}

function createLaunchEntity(allocations) {
  return freeze({
    ...ASSET_TOKEN_LAUNCH_DISTRIBUTION,
    allocationIds: freeze(allocations.map(({ id }) => id)),
    recipientClasses: freeze(allocations.map(({ recipientClass }) => recipientClass)),
  });
}

function createEvidence(allocations, updatedAt) {
  const basisPoints = allocations.reduce((total, allocation) => total + allocation.basisPoints, 0);
  const tokenUnits = allocations.reduce((total, allocation) => total + allocation.tokenUnits, 0);
  return freeze([
    freeze({
      id: `asset-token-schedule:${updatedAt}`,
      kind: "allocation-reconciliation",
      status: "verified",
      simulation: true,
      basisPoints,
      expectedBasisPoints: TOTAL_BASIS_POINTS,
      tokenUnits,
      expectedTokenUnits: FIXED_SUPPLY,
      provenance: ASSET_TOKEN_PROVENANCE,
      note: "Integer token units reconcile exactly to the fixed simulated supply.",
    }),
    freeze({
      id: `asset-token-boundary:${updatedAt}`,
      kind: "simulation-boundary",
      status: "enforced",
      simulation: true,
      liveIssuance: false,
      custody: false,
      walletConnection: false,
      signing: false,
      settlement: false,
      externalTransfer: false,
      realMoney: false,
      note:
        "TUMBO is a fictional asset-token projection for a social-experiment / space-explorer demo.",
    }),
    freeze({
      id: `asset-token-provenance:${updatedAt}`,
      kind: "deterministic-provenance",
      status: "declared",
      simulation: true,
      deterministic: true,
      source: ASSET_TOKEN_PROVENANCE.source,
      basis: ASSET_TOKEN_PROVENANCE.basis,
      note: "No external provider, recipient address, price, or market feed is used.",
    }),
  ]);
}

/**
 * Build a deterministic local contribution. The supply is intentionally fixed
 * and cannot be overridden; `updatedAt` changes only projection metadata.
 * Optional allocation definitions are useful for deterministic test fixtures,
 * but they must still reconcile to the same fixed supply and basis-point total.
 */
export function createAssetTokenContribution({
  updatedAt = ASSET_TOKEN_UPDATED_AT,
  totalSupply = FIXED_SUPPLY,
  allocations = ASSET_TOKEN_ALLOCATIONS,
} = {}) {
  requireString(updatedAt, "updatedAt");
  requireFiniteNonNegativeInteger(totalSupply, "totalSupply");
  if (totalSupply !== FIXED_SUPPLY) {
    throw new TypeError(`totalSupply is fixed at ${FIXED_SUPPLY} simulation units`);
  }

  const normalizedAllocations = normalizeAllocations(allocations);
  const token = createTokenEntity(normalizedAllocations);
  const launch = createLaunchEntity(normalizedAllocations);
  const allocationEntities = normalizedAllocations.map((allocation) =>
    freeze({
      ...allocation,
      type: "asset-token-allocation",
      kind: "asset-token-allocation",
      assetTokenId: token.id,
      launchDistributionId: launch.id,
    }),
  );
  const entities = freeze([token, launch, ...allocationEntities]);
  const evidence = createEvidence(normalizedAllocations, updatedAt);

  return freeze({
    schemaVersion: ASSET_TOKEN_SCHEMA_VERSION,
    source: ASSET_TOKEN_SOURCE,
    simulation: true,
    updatedAt,
    kind: "asset-token-projection",
    assetToken: token,
    totalSupply: FIXED_SUPPLY,
    unit: ASSET_TOKEN_UNIT,
    fixedSupply: true,
    launchDistribution: launch,
    allocations: normalizedAllocations,
    entities,
    evidence,
    capabilities: ASSET_TOKEN_CAPABILITIES,
    provenance: ASSET_TOKEN_PROVENANCE,
  });
}

// Naming aliases make the contribution discoverable without changing its
// schema or creating multiple mutable sources of truth.
export const createAssetTokenProjection = createAssetTokenContribution;
export const createTumboAssetTokenContribution = createAssetTokenContribution;

export const assetTokenProjection = createAssetTokenContribution();
export const TUMBO_ASSET_TOKEN_PROJECTION = assetTokenProjection;

export default assetTokenProjection;
