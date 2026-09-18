/**
 * Fictional contract and market-state projections for local presentation.
 * Nothing in this module is a price quote, trade, legal contract, custody
 * record, or instruction to an external financial or blockchain system.
 */

export const CONTRACTS_MARKETS_SCHEMA_VERSION = 1;
export const CONTRACTS_MARKETS_SOURCE = "contracts-markets";
export const CONTRACTS_MARKETS_REHEARSAL_SOURCE = "contracts-markets-local-draft";
export const CONTRACTS_MARKETS_DRAFT_MAX_LABEL_LENGTH = 96;
export const CONTRACTS_MARKETS_DRAFT_ROUTE_VERSION = 1;
export const CONTRACTS_MARKETS_DRAFT_ROUTE_PARAM = "draft";
export const CONTRACTS_MARKETS_CONTRACT_ROUTE_PARAM = "contract";
export const CONTRACTS_MARKETS_DRAFT_ROUTE_MAX_LENGTH = 4096;
export const CONTRACTS_MARKETS_DRAFT_ROUTE_MAX_ID_LENGTH = 160;
export const CONTRACTS_MARKETS_DRAFT_ROUTE_MAX_SOURCE_ROUTE_LENGTH = 320;
export const CONTRACTS_MARKETS_SOURCE_RETURN_JOURNEY = "contract-detail-source-182";
export const CONTRACTS_MARKETS_GRAPH_ROUTE_PARAM = "graph";
export const CONTRACTS_MARKETS_GRAPH_ROUTE_MODE = "expanded";
export const CONTRACTS_MARKETS_ALLOWED_PROVENANCE_HOSTS = Object.freeze([
  "espn.com",
  "espncdn.com",
]);

export const ContractState = Object.freeze({
  PROPOSED: "proposed",
  SIMULATED: "simulated",
  CLOSED: "closed",
});

export const PositionSide = Object.freeze({
  LONG: "long",
  SHORT: "short",
  NEUTRAL: "neutral",
});

export const RiskBand = Object.freeze({
  LOW: "low",
  ELEVATED: "elevated",
  HIGH: "high",
});

const CONTRACT_STATES = new Set(Object.values(ContractState));
const POSITION_SIDES = new Set(Object.values(PositionSide));

function routeString(value, field, maximum, { allowEmpty = false } = {}) {
  if (typeof value !== "string") throw new TypeError(`${field} must be a string`);
  const normalized = value.trim();
  if (!allowEmpty && !normalized) throw new TypeError(`${field} must be a non-empty string`);
  if (normalized.length > maximum) throw new TypeError(`${field} exceeds the route limit`);
  return normalized;
}

function routeId(value, field) {
  const normalized = routeString(value, field, CONTRACTS_MARKETS_DRAFT_ROUTE_MAX_ID_LENGTH);
  if (!/^[a-z0-9:_.-]+$/i.test(normalized)) throw new TypeError(`${field} contains unsupported characters`);
  return normalized;
}

function routeLabel(value, field) {
  return routeString(value, field, CONTRACTS_MARKETS_DRAFT_MAX_LABEL_LENGTH);
}

function routeSourceUrl(value) {
  const raw = routeString(value, "sourceUrl", 1024);
  let parsed;
  try { parsed = new URL(raw); } catch { throw new TypeError("sourceUrl must be a valid URL"); }
  const host = parsed.hostname.toLowerCase();
  const allowlisted = CONTRACTS_MARKETS_ALLOWED_PROVENANCE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port || !allowlisted) {
    throw new TypeError("sourceUrl must be an allowlisted https provider URL");
  }
  return parsed.toString();
}

function routeSourceRoute(value, expectedRecordId = null) {
  const raw = routeString(value, "sourceRoute", CONTRACTS_MARKETS_DRAFT_ROUTE_MAX_SOURCE_ROUTE_LENGTH);
  if (!raw.startsWith("?")) throw new TypeError("sourceRoute must be a relative query route");
  let parsed;
  try { parsed = new URL(raw, "http://matumbo.local"); } catch { throw new TypeError("sourceRoute is malformed"); }
  if (parsed.origin !== "http://matumbo.local"
    || parsed.hash
    || !["sports-events", "multi-sport-events"].includes(parsed.searchParams.get("panel"))
    || parsed.searchParams.get("journey") !== CONTRACTS_MARKETS_SOURCE_RETURN_JOURNEY) {
    throw new TypeError("sourceRoute must target a supported public-sports panel");
  }
  // A detail route must be able to return to the exact provider row that
  // created it.  Requiring the bounded record id here prevents a valid-looking
  // panel-only back-link from silently selecting the first refreshed row.
  if (expectedRecordId !== null && parsed.searchParams.get("record") !== expectedRecordId) {
    throw new TypeError("sourceRoute must identify the source sports record");
  }
  return raw;
}

function routePlayers(value) {
  if (!Array.isArray(value) || value.length !== 2) throw new TypeError("players must contain exactly two provider records");
  return value.map((player, index) => {
    if (!player || typeof player !== "object" || Array.isArray(player)) throw new TypeError(`players[${index}] must be an object`);
    const id = player.id === null || player.id === undefined ? null : routeId(player.id, `players[${index}].id`);
    const name = routeLabel(player.name, `players[${index}].name`);
    const rank = player.rank === null || player.rank === undefined ? null : Number(player.rank);
    if (rank !== null && (!Number.isSafeInteger(rank) || rank < 1)) throw new TypeError(`players[${index}].rank is invalid`);
    return { id, name, rank };
  });
}

/**
 * Validate the small URL payload used to reopen a local sports contract
 * draft. This is intentionally stricter than the renderer's display helper:
 * route state must be bounded, allowlisted, and self-consistent rather than
 * silently truncated or repaired.
 */
export function validateContractDraftRouteState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    // Enforce the URL payload bound here too, so direct hydration callers
    // cannot bypass the parser's length guard with a large in-memory object.
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string" || serialized.length > CONTRACTS_MARKETS_DRAFT_ROUTE_MAX_LENGTH) {
      throw new TypeError("draft route payload exceeds its bound");
    }
    const allowedKeys = new Set([
      "version", "kind", "draftId", "contractId", "poolId", "sourceRecordId",
      "sourceTitle", "tour", "provider", "sourceUrl", "retrievedAt", "players",
      "contractLabel", "poolLabel", "lifecycleState", "sourceRoute",
    ]);
    if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw new TypeError("unknown route field");
    if (value.version !== CONTRACTS_MARKETS_DRAFT_ROUTE_VERSION || value.kind !== "contract-detail-route") {
      throw new TypeError("unsupported draft route version");
    }
    const draftId = routeId(value.draftId, "draftId");
    const contractId = routeId(value.contractId, "contractId");
    const poolId = routeId(value.poolId, "poolId");
    const sourceRecordId = routeId(value.sourceRecordId, "sourceRecordId");
    const sourceTitle = routeLabel(value.sourceTitle, "sourceTitle");
    const tour = routeLabel(value.tour, "tour");
    const provider = routeLabel(value.provider, "provider");
    const sourceUrl = routeSourceUrl(value.sourceUrl);
    const retrievedAt = value.retrievedAt === null || value.retrievedAt === undefined
      ? null
      : routeString(value.retrievedAt, "retrievedAt", 80);
    if (retrievedAt !== null && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(retrievedAt) || !Number.isFinite(Date.parse(retrievedAt)))) {
      throw new TypeError("retrievedAt must be a bounded ISO timestamp");
    }
    const players = routePlayers(value.players);
    const contractLabel = routeLabel(value.contractLabel, "contractLabel");
    const poolLabel = routeLabel(value.poolLabel, "poolLabel");
    if (!CONTRACT_STATES.has(value.lifecycleState)) throw new TypeError("unsupported lifecycle state");
    const sourceRoute = routeSourceRoute(value.sourceRoute, sourceRecordId);
    const expectedSlug = draftSlug(sourceRecordId);
    if (draftId !== `rehearsal:${expectedSlug}` || contractId !== `contract:draft:${expectedSlug}` || poolId !== `pool:draft:${expectedSlug}`) {
      throw new TypeError("draft route IDs do not match source record");
    }
    return freezeDraft({
      version: CONTRACTS_MARKETS_DRAFT_ROUTE_VERSION,
      kind: "contract-detail-route",
      draftId,
      contractId,
      poolId,
      sourceRecordId,
      sourceTitle,
      tour,
      provider,
      sourceUrl,
      retrievedAt,
      players,
      contractLabel,
      poolLabel,
      lifecycleState: value.lifecycleState,
      sourceRoute,
    });
  } catch {
    return null;
  }
}

/** Return a frozen route payload from an already-created local draft. */
export function createContractDraftRouteState({ draft, sourceRoute } = {}) {
  if (!draft || typeof draft !== "object") return null;
  return validateContractDraftRouteState({
    version: CONTRACTS_MARKETS_DRAFT_ROUTE_VERSION,
    kind: "contract-detail-route",
    draftId: draft.id,
    contractId: draft.contract?.id,
    poolId: draft.pool?.id,
    sourceRecordId: draft.sourceRecord?.id,
    sourceTitle: draft.sourceRecord?.title,
    tour: draft.sourceRecord?.tour,
    provider: draft.sourceRecord?.provider,
    sourceUrl: draft.sourceRecord?.sourceUrl,
    retrievedAt: draft.sourceRecord?.retrievedAt ?? null,
    players: draft.sourceRecord?.players ?? draft.players,
    contractLabel: draft.contract?.label,
    poolLabel: draft.pool?.label,
    lifecycleState: draft.contract?.state ?? ContractState.PROPOSED,
    sourceRoute,
  });
}

function freezeDraft(value) {
  if (Array.isArray(value)) {
    value.forEach((entry) => freezeDraft(entry));
    return Object.freeze(value);
  }
  if (!value || typeof value !== "object") return value;
  Object.values(value).forEach((entry) => freezeDraft(entry));
  return Object.freeze(value);
}

function boundedDraftLabel(value, field, fallback) {
  const label = value === undefined || value === null || value === ""
    ? fallback
    : requireString(value, field);
  return label.trim().slice(0, CONTRACTS_MARKETS_DRAFT_MAX_LABEL_LENGTH);
}

function draftSlug(value) {
  return String(value).trim().replace(/[^a-z0-9:_-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "record";
}

function draftPlayers(record) {
  const players = Array.isArray(record.players)
    ? record.players
    : Array.isArray(record.competitors) ? record.competitors : [];
  return players.slice(0, 2).map((player) => freezeDraft({
    id: typeof player?.id === "string" ? player.id : null,
    name: typeof player?.name === "string"
      ? player.name.slice(0, CONTRACTS_MARKETS_DRAFT_MAX_LABEL_LENGTH)
      : typeof player?.displayName === "string"
        ? player.displayName.slice(0, CONTRACTS_MARKETS_DRAFT_MAX_LABEL_LENGTH)
        : "Player unavailable",
    rank: Number.isSafeInteger(player?.rank) ? player.rank : null,
  }));
}

export const CONTRACTS_MARKETS_CAPABILITIES = Object.freeze([
  Object.freeze({
    id: "contracts-markets-project-scenarios",
    mode: "local-projection",
    enabled: true,
    authority: "none",
  }),
  Object.freeze({
    id: "contracts-markets-execute-or-settle",
    mode: "denied",
    enabled: false,
    authority: "none",
  }),
]);

/**
 * Build a data-only contract/pool rehearsal from one explicitly selected
 * public sports record. This is intentionally separate from the canonical
 * contracts contribution: it never mutates the projection, creates a price,
 * assigns liquidity, or grants any execution/settlement authority.
 */
export function createContractPoolRehearsal({ record, contractLabel, poolLabel, lifecycleState = ContractState.PROPOSED, lifecycleReason = null } = {}) {
  requireRecord(record, "record");
  const sourceRecordId = requireString(record.id, "record.id");
  const sourceUrl = requireString(record.sourceUrl, "record.sourceUrl");
  if (!/^https:\/\//i.test(sourceUrl)) {
    throw new TypeError("record.sourceUrl must be an https URL");
  }
  const allowlistedSourceUrl = routeSourceUrl(sourceUrl);
  const normalizedLifecycleState = requireEnum(lifecycleState, CONTRACT_STATES, "lifecycle state");
  const sourceTitle = boundedDraftLabel(record.title, "record.title", "Selected public record");
  const tour = boundedDraftLabel(record.tour, "record.tour", "SPORTS").toUpperCase();
  if (!(tour === "ATP" || tour === "WTA" || tour === "SPORTS")) {
    throw new TypeError("record.tour must be ATP, WTA, or SPORTS");
  }
  const slug = draftSlug(sourceRecordId);
  const defaultContractLabel = `${tour} · ${sourceTitle} · local contract rehearsal`;
  const defaultPoolLabel = `${tour} · observation pool · local rehearsal`;
  const players = draftPlayers(record);
  if (players.length !== 2 || players.some((player) => !player.name || player.name === "Player unavailable")) {
    throw new TypeError("record.players must contain two provider player names");
  }
  const sourceRecord = freezeDraft({
    id: sourceRecordId,
    title: sourceTitle,
    tour,
    provider: typeof record.provider === "string" ? record.provider.slice(0, CONTRACTS_MARKETS_DRAFT_MAX_LABEL_LENGTH) : "Public provider",
    sourceUrl: allowlistedSourceUrl,
    retrievedAt: typeof record.retrievedAt === "string" ? record.retrievedAt : null,
    players,
  });
  const contract = freezeDraft({
    id: `contract:draft:${slug}`,
    kind: "contract-scenario",
    label: boundedDraftLabel(contractLabel, "contractLabel", defaultContractLabel),
    state: normalizedLifecycleState,
    sourceRecordId,
    eventTitle: sourceTitle,
    tour,
    simulation: true,
    legallyBinding: false,
    executable: false,
    localOnly: true,
  });
  const pool = freezeDraft({
    id: `pool:draft:${slug}`,
    kind: "pool-scenario",
    label: boundedDraftLabel(poolLabel, "poolLabel", defaultPoolLabel),
    unit: "TUMBO-SIM",
    sourceRecordId,
    liquidityStatus: "not-configured",
    simulation: true,
    executable: false,
    localOnly: true,
  });
  return freezeDraft({
    schemaVersion: CONTRACTS_MARKETS_SCHEMA_VERSION,
    source: CONTRACTS_MARKETS_REHEARSAL_SOURCE,
    kind: "contract-pool-local-draft",
    id: `rehearsal:${slug}`,
    sourceRecord,
    contract,
    pool,
    players,
    lifecycle: freezeDraft({
      state: normalizedLifecycleState,
      transition: normalizedLifecycleState === ContractState.CLOSED ? "closed" : "created",
      reason: typeof lifecycleReason === "string" && lifecycleReason.trim() ? lifecycleReason.trim().slice(0, CONTRACTS_MARKETS_DRAFT_MAX_LABEL_LENGTH) : null,
      localOnly: true,
    }),
    provenance: freezeDraft({
      provider: sourceRecord.provider,
      sourceUrl: allowlistedSourceUrl,
      sourceRecordId,
      retrievedAt: sourceRecord.retrievedAt,
      publicRead: true,
    }),
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
    settlement: false,
    custody: false,
    boundary: "Local draft only. Public sports provenance is carried for inspection; no odds, wager, liquidity, wallet, custody, signing, settlement, or market authority is created.",
  });
}

export const createLocalContractPoolDraft = createContractPoolRehearsal;

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

function requireAmount(value, field) {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${field} must be a finite, non-negative number`);
  }
  return value;
}

function requireEnum(value, allowed, field) {
  if (!allowed.has(value)) throw new TypeError(`Unknown ${field}: ${String(value)}`);
  return value;
}

function requireUniqueIds(records, label, allIds) {
  for (const record of records) {
    if (allIds.has(record.id)) throw new TypeError(`Duplicate ${label} id: ${record.id}`);
    allIds.add(record.id);
  }
}

function normalizeContract(contract) {
  requireRecord(contract, "contract");
  return Object.freeze({
    id: requireString(contract.id, "contract.id"),
    kind: "contract-scenario",
    label: requireString(contract.label, "contract.label"),
    state: requireEnum(contract.state, CONTRACT_STATES, "contract state"),
    simulation: true,
    legallyBinding: false,
    executable: false,
  });
}

function normalizePool(pool) {
  requireRecord(pool, "pool");
  return Object.freeze({
    id: requireString(pool.id, "pool.id"),
    kind: "pool-scenario",
    label: requireString(pool.label, "pool.label"),
    unit: requireString(pool.unit, "pool.unit"),
    simulatedLiquidity: requireAmount(pool.simulatedLiquidity, "pool.simulatedLiquidity"),
    simulation: true,
    executable: false,
  });
}

function normalizeCollateral(collateral, poolsById) {
  requireRecord(collateral, "collateral");
  const poolId = requireString(collateral.poolId, "collateral.poolId");
  const pool = poolsById.get(poolId);
  if (!pool) throw new TypeError(`Collateral references unknown pool: ${poolId}`);
  return Object.freeze({
    id: requireString(collateral.id, "collateral.id"),
    kind: "collateral-scenario",
    poolId,
    unit: pool.unit,
    simulatedValue: requireAmount(collateral.simulatedValue, "collateral.simulatedValue"),
    simulation: true,
    custody: false,
  });
}

function normalizePosition(position, contractsById, poolsById, collateralById) {
  requireRecord(position, "position");
  const contractId = requireString(position.contractId, "position.contractId");
  const poolId = requireString(position.poolId, "position.poolId");
  const collateralId = requireString(position.collateralId, "position.collateralId");
  if (!contractsById.has(contractId)) {
    throw new TypeError(`Position references unknown contract: ${contractId}`);
  }
  if (!poolsById.has(poolId)) throw new TypeError(`Position references unknown pool: ${poolId}`);
  const collateral = collateralById.get(collateralId);
  if (!collateral) throw new TypeError(`Position references unknown collateral: ${collateralId}`);
  if (collateral.poolId !== poolId) {
    throw new TypeError(`Position collateral must belong to its pool: ${position.id}`);
  }

  return Object.freeze({
    id: requireString(position.id, "position.id"),
    kind: "position-scenario",
    contractId,
    poolId,
    collateralId,
    side: requireEnum(position.side, POSITION_SIDES, "position side"),
    simulatedExposure: requireAmount(position.simulatedExposure, "position.simulatedExposure"),
    simulation: true,
    executable: false,
  });
}

function projectRisk(position, collateral) {
  const coverageRatio = position.simulatedExposure === 0
    ? null
    : collateral.simulatedValue / position.simulatedExposure;
  const band = coverageRatio === null || coverageRatio >= 1.5
    ? RiskBand.LOW
    : coverageRatio >= 1
      ? RiskBand.ELEVATED
      : RiskBand.HIGH;

  return Object.freeze({
    id: `risk:${position.id}`,
    kind: "risk-scenario",
    positionId: position.id,
    collateralId: collateral.id,
    coverageRatio,
    band,
    basis: "deterministic-simulated-collateral-coverage",
    simulation: true,
    marketClaim: false,
  });
}

function graphRecordList(projection) {
  if (Array.isArray(projection)) return projection;
  if (!projection || typeof projection !== "object") return [];
  if (Array.isArray(projection.entities)) return projection.entities;
  if (Array.isArray(projection.records)) return projection.records;
  if (Array.isArray(projection.contributions)) {
    const contribution = projection.contributions.find((candidate) => candidate?.source === CONTRACTS_MARKETS_SOURCE);
    return Array.isArray(contribution?.entities) ? contribution.entities : [];
  }
  return [];
}

function graphRecordMap(records, kind) {
  return new Map(records.filter((record) => record?.kind === kind && typeof record.id === "string")
    .map((record) => [record.id, record]));
}

const GRAPH_ROUTE_RECORD_KINDS = new Set([
  "contract-scenario",
  "pool-scenario",
  "collateral-scenario",
  "position-scenario",
]);

function graphCoverageRatio(position, collateral, risk) {
  if (Number.isFinite(risk?.coverageRatio)) return risk.coverageRatio;
  if (!Number.isFinite(position?.simulatedExposure) || !Number.isFinite(collateral?.simulatedValue)) return null;
  if (position.simulatedExposure === 0) return null;
  return collateral.simulatedValue / position.simulatedExposure;
}

function graphRiskBand(coverageRatio) {
  if (!Number.isFinite(coverageRatio)) return null;
  if (coverageRatio >= 1.5) return RiskBand.LOW;
  if (coverageRatio >= 1) return RiskBand.ELEVATED;
  return RiskBand.HIGH;
}

function graphLink(fromId, toId, kind, expectedKind) {
  return {
    id: `${kind}:${fromId}:${toId ?? "missing"}`,
    fromId,
    toId: toId ?? null,
    kind,
    expectedKind,
    status: toId ? "complete" : "missing",
    simulation: true,
    localOnly: true,
    executable: false,
  };
}

function graphChainStatus(links) {
  const statuses = links.map((link) => link.status);
  if (!statuses.length || statuses.every((status) => status === "missing")) return "missing";
  if (statuses.every((status) => status === "complete")) return "complete";
  return "partial";
}

function graphPathRecords(contract, pool, collateral, position, risk) {
  return [contract, pool, collateral, position, risk].filter(Boolean);
}

/**
 * Resolve the canonical contract → pool → collateral → position → risk chain
 * into a frozen, inspectable graph. Missing references remain visible as
 * explicit links/statuses; this function never repairs data or creates a
 * market/settlement record. Coverage and risk fields are deterministic
 * calculations over the existing fictional scenario values only.
 */
export function createContractsMarketsGraph(projection) {
  const graphKinds = new Set([
    "contract-scenario",
    "pool-scenario",
    "collateral-scenario",
    "position-scenario",
    "risk-scenario",
  ]);
  const records = graphRecordList(projection).filter((record) => graphKinds.has(record?.kind));
  const contracts = graphRecordMap(records, "contract-scenario");
  const pools = graphRecordMap(records, "pool-scenario");
  const collateral = graphRecordMap(records, "collateral-scenario");
  const positions = graphRecordMap(records, "position-scenario");
  const risks = graphRecordMap(records, "risk-scenario");
  const chains = [];
  const linkedIds = new Set();

  [...contracts.values()].forEach((contract) => {
    const contractPositions = [...positions.values()].filter((position) => position.contractId === contract.id);
    const candidates = contractPositions.length ? contractPositions : [null];
    candidates.forEach((position) => {
      const pool = position ? pools.get(position.poolId) ?? null : null;
      const linkedCollateral = position ? collateral.get(position.collateralId) ?? null : null;
      const risk = position
        ? [...risks.values()].find((candidate) => candidate.positionId === position.id
          && (!linkedCollateral || candidate.collateralId === linkedCollateral.id)) ?? null
        : null;
      const links = [
        graphLink(contract.id, position?.id ?? null, "contract-position", "position-scenario"),
        graphLink(position?.id ?? contract.id, pool?.id ?? null, "position-pool", "pool-scenario"),
        graphLink(position?.id ?? contract.id, linkedCollateral?.id ?? null, "position-collateral", "collateral-scenario"),
        graphLink(position?.id ?? contract.id, risk?.id ?? null, "position-risk", "risk-scenario"),
      ];
      const coverageRatio = graphCoverageRatio(position, linkedCollateral, risk);
      const riskBand = risk?.band ?? graphRiskBand(coverageRatio);
      const path = graphPathRecords(contract, pool, linkedCollateral, position, risk);
      path.forEach((record) => linkedIds.add(record.id));
      chains.push({
        id: `chain:${contract.id}:${position?.id ?? "missing"}`,
        contractId: contract.id,
        poolId: pool?.id ?? null,
        collateralId: linkedCollateral?.id ?? null,
        positionId: position?.id ?? null,
        riskId: risk?.id ?? null,
        nodeIds: path.map((record) => record.id),
        path,
        links,
        status: graphChainStatus(links),
        completeLinkCount: links.filter((link) => link.status === "complete").length,
        missingLinkCount: links.filter((link) => link.status === "missing").length,
        coverageRatio,
        coverageStatus: coverageRatio === null ? "not-computable" : coverageRatio >= 1 ? "covered" : "under-covered",
        riskBand,
        riskStatus: risk ? "complete" : riskBand ? "derived-local" : "missing",
        riskSource: risk ? "canonical-risk-scenario" : riskBand ? "position-collateral-calculation" : null,
        simulation: true,
        localOnly: true,
        executable: false,
      });
    });
  });

  const orphanNodes = records.filter((record) => record?.id && !linkedIds.has(record.id)).map((record) => ({
    id: `orphan:${record.id}`,
    nodeIds: [record.id],
    record,
    status: "missing",
    links: [],
    coverageRatio: null,
    coverageStatus: "not-computable",
    riskBand: record.kind === "risk-scenario" ? record.band ?? null : null,
    riskStatus: "missing",
    simulation: true,
    localOnly: true,
    executable: false,
  }));
  const completeChains = chains.filter((chain) => chain.status === "complete").length;
  const partialChains = chains.filter((chain) => chain.status === "partial").length;
  const missingChains = chains.filter((chain) => chain.status === "missing").length;
  const bands = { low: 0, elevated: 0, high: 0, unknown: 0 };
  chains.forEach((chain) => {
    if (chain.riskBand && Object.prototype.hasOwnProperty.call(bands, chain.riskBand)) bands[chain.riskBand] += 1;
    else bands.unknown += 1;
  });
  const status = chains.length === 0 || (missingChains === chains.length && partialChains === 0)
    ? "missing"
    : completeChains === chains.length && orphanNodes.length === 0 ? "complete" : "partial";
  const frozenChains = chains.map((chain) => Object.freeze({
    ...chain,
    nodeIds: Object.freeze([...chain.nodeIds]),
    path: Object.freeze([...chain.path]),
    links: Object.freeze(chain.links.map((link) => Object.freeze({ ...link }))),
  }));
  const frozenOrphanNodes = orphanNodes.map((node) => Object.freeze({
    ...node,
    nodeIds: Object.freeze([...node.nodeIds]),
    links: Object.freeze([]),
  }));
  const frozenReadouts = [...frozenChains, ...frozenOrphanNodes];
  const frozenLinks = frozenChains.flatMap((chain) => chain.links);
  return Object.freeze({
    schemaVersion: CONTRACTS_MARKETS_SCHEMA_VERSION,
    source: `${CONTRACTS_MARKETS_SOURCE}-graph`,
    kind: "contracts-markets-linked-graph",
    status,
    records: Object.freeze(records),
    nodes: Object.freeze(records),
    chains: Object.freeze(frozenChains),
    readouts: Object.freeze(frozenReadouts),
    orphanNodes: Object.freeze(frozenOrphanNodes),
    links: Object.freeze(frozenLinks),
    coverage: Object.freeze({
      totalChains: chains.length,
      completeChains,
      partialChains,
      missingChains,
      completeRatio: chains.length ? completeChains / chains.length : 0,
    }),
    risk: Object.freeze({ bands: Object.freeze(bands), totalChains: chains.length }),
    simulation: true,
    localOnly: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
    boundary: "Deterministic local graph of fictional contract scenarios; no market, trade, wallet, custody, signing, settlement, or legal authority.",
  });
}

/**
 * Validate one addressable graph route against the canonical contribution.
 * The route can point only at an existing contract, pool, collateral, or
 * position record. Derived risk rows are deliberately not route targets, and
 * no missing node is synthesized for an unknown id.
 */
export function validateContractsMarketsGraphRoute({ recordId, graph, projection } = {}) {
  if (graph !== CONTRACTS_MARKETS_GRAPH_ROUTE_MODE) return null;
  let normalizedId;
  try {
    normalizedId = routeId(recordId, "recordId");
  } catch {
    return null;
  }
  const records = graphRecordList(projection).filter((record) => GRAPH_ROUTE_RECORD_KINDS.has(record?.kind));
  const record = records.find((candidate) => candidate?.id === normalizedId);
  if (!record) return null;
  const linkedGraph = createContractsMarketsGraph(projection);
  const graphReadout = linkedGraph.readouts.find((readout) => readout.nodeIds?.includes(normalizedId)) ?? null;
  if (!graphReadout) return null;
  return Object.freeze({
    recordId: normalizedId,
    graph: CONTRACTS_MARKETS_GRAPH_ROUTE_MODE,
    recordKind: record.kind,
    graphReadout,
  });
}

export const createContractsMarketsLinkedGraph = createContractsMarketsGraph;

/** Build a deterministic, side-effect-free local projection contribution. */
export function createContractsMarketsContribution({
  updatedAt,
  contracts = [],
  pools = [],
  collateral = [],
  positions = [],
}) {
  requireString(updatedAt, "updatedAt");
  if (![contracts, pools, collateral, positions].every(Array.isArray)) {
    throw new TypeError("contracts, pools, collateral, and positions must be arrays");
  }

  const normalizedContracts = contracts.map(normalizeContract);
  const normalizedPools = pools.map(normalizePool);
  const allIds = new Set();
  requireUniqueIds(normalizedContracts, "entity", allIds);
  requireUniqueIds(normalizedPools, "entity", allIds);

  const contractsById = new Map(normalizedContracts.map((item) => [item.id, item]));
  const poolsById = new Map(normalizedPools.map((item) => [item.id, item]));
  const normalizedCollateral = collateral.map((item) => normalizeCollateral(item, poolsById));
  requireUniqueIds(normalizedCollateral, "entity", allIds);
  const collateralById = new Map(normalizedCollateral.map((item) => [item.id, item]));
  const normalizedPositions = positions.map((item) =>
    normalizePosition(item, contractsById, poolsById, collateralById));
  requireUniqueIds(normalizedPositions, "entity", allIds);
  const risks = normalizedPositions.map((position) =>
    projectRisk(position, collateralById.get(position.collateralId)));
  requireUniqueIds(risks, "derived risk", allIds);

  return Object.freeze({
    schemaVersion: CONTRACTS_MARKETS_SCHEMA_VERSION,
    source: CONTRACTS_MARKETS_SOURCE,
    simulation: true,
    updatedAt,
    entities: Object.freeze([
      ...normalizedContracts,
      ...normalizedPools,
      ...normalizedCollateral,
      ...normalizedPositions,
      ...risks,
    ]),
    evidence: Object.freeze([
      Object.freeze({
        id: `contracts-markets-boundary:${updatedAt}`,
        kind: "simulation-boundary",
        status: "enforced",
        simulation: true,
        marketDataSource: "none",
        note: "Fictional local scenarios only; no trade, custody, signing, settlement, or market claim.",
      }),
    ]),
    capabilities: CONTRACTS_MARKETS_CAPABILITIES,
  });
}
