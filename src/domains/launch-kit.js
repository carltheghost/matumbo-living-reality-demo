/**
 * Portable local Launch Kit for the maTumbo social-experiment / space-
 * explorer demo.
 *
 * The kit is a deterministic manifest, not a deployment script or a token
 * distribution instruction. It packages the already-verified local surfaces
 * so a person can understand what the demo contains and reproduce the same
 * projection without receiving a wallet, recipient list, secret, or command.
 */

import {
  ASSET_TOKEN_ALLOCATIONS,
  ASSET_TOKEN_KIND,
  ASSET_TOKEN_SOURCE,
  ASSET_TOKEN_TOTAL_BASIS_POINTS,
  ASSET_TOKEN_TOTAL_SUPPLY,
  ASSET_TOKEN_UNIT,
} from "./asset-token.js?v=20260922-cache2";
import {
  DISTRIBUTION_REGISTRY_SOURCE,
  FICTIONAL_RECIPIENT_REGISTRY,
  summarizeDistributionRegistry,
} from "./distribution-registry.js?v=20260922-cache2";
import {
  BLOCK_MIGRATION_MANIFEST_ID,
  BLOCK_MIGRATION_MANIFEST,
} from "./block-migration.js?v=20260922-cache2";
import {
  DEFAULT_SOCIAL_EXPLORER_PROJECTION,
  SOCIAL_EXPLORER_ID,
  SOCIAL_EXPLORER_REHEARSAL_ID,
} from "./social-explorer.js?v=20260922-cache2";

export const LAUNCH_KIT_SCHEMA_VERSION = 1;
export const LAUNCH_KIT_SOURCE = "matumbo-launch-kit";
export const LAUNCH_KIT_ID = "launch-kit:tumbo-space-explorer-v1";
export const LAUNCH_KIT_UPDATED_AT = "2025-01-01T00:00:00.000Z";
export const LAUNCH_KIT_KIND = "matumbo-social-experiment-launch-kit";
export const LAUNCH_KIT_DOWNLOAD_FILENAME = "matumbo-space-explorer-launch-kit.json";
export const LAUNCH_KIT_MAX_JSON_BYTES = 256_000;

const freeze = (value) => Object.freeze(value);

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((entry) => deepFreeze(entry, seen));
  return Object.freeze(value);
}

const boundary = freeze({
  localOnly: true,
  simulation: true,
  deterministic: true,
  executable: false,
  externalNetwork: false,
  externalTransfer: false,
  providerCredentials: false,
  liveData: false,
  walletConnection: false,
  recipientAddresses: false,
  identityCollection: false,
  issuance: false,
  custody: false,
  signing: false,
  settlement: false,
  market: false,
  realMoney: false,
  persistence: false,
});

/**
 * This list mirrors the visible Mission Control routes without importing a
 * renderer module into the domain layer. Each route is a local URL hint only;
 * it is never fetched or executed by this module.
 */
export const LAUNCH_KIT_FEATURES = freeze([
  ["reality-lens", "Reality Lens Ω", "semantic zoom"],
  ["person", "Person Ω", "visual genomes"],
  ["rooms", "Rooms + Messaging", "space + cipher"],
  ["block-world", "Block World / Fabric", "voxel space"],
  ["runtime-sync", "Local Cube Sync", "Merge 4 runtime"],
  ["migration", "Migration Bridge", "old project → blocks"],
  ["asset-token", "TUMBO Asset Token", "fixed allocation"],
  ["asset-market", "Asset Market Evidence", "public market read"],
  ["launch-distribution", "Launch Distribution", "social experiment"],
  ["social-explorer", "Social Explorer / Re-market", "discover → reuse"],
  ["paycore", "PAYCORE Asset-token Balances", "value preview"],
  ["contracts", "Contracts + Pools", "covenant rehearsal"],
  ["ledger", "Prime Ledger + EchoProof", "journal + ancestry"],
  ["t402", "T402 Value Routing", "offer → route → hold"],
  ["agent", "Agent", "guide · design · bots · mesh"],
  ["picture-matter", "Picture Matter", "word → statement"],
  ["gateway", "World Gateway / Evidence", "public-source boundary"],
  ["world-events", "World Events / Evidence", "public-source pulse"],
  ["sports-events", "Tennis Evidence / ATP · WTA", "public sports read"],
  ["multi-sport-events", "Multi-Sport Scoreboards", "public sports read"],
  ["arena", "ARENA / Game Lab", "playable rehearsal"],
  ["academy", "Financial Academy", "learn → test → progress"],
  ["projections", "Phone / PC / XR", "one canonical view"],
].map(([id, label, kicker], index) => freeze({
  ordinal: index + 1,
  id,
  label,
  kicker,
    route: id === "runtime-sync" ? "?panel=runtime-sync" : `?feature=${id}`,
  localOnly: true,
  simulation: true,
  executable: false,
})));

const DEVICE_PROFILES = freeze([
  freeze({ id: "phone", label: "Phone", viewport: "compact", input: "touch", motion: "reduced-capable", xr: "fallback-only" }),
  freeze({ id: "pc", label: "PC", viewport: "expanded", input: "pointer + keyboard", motion: "full-capable", xr: "fallback-only" }),
  freeze({ id: "xr", label: "VR / AR / XR", viewport: "expanded", input: "xr-unknown", motion: "not-tested", xr: "not-tested" }),
]);

function requireString(value, field, maxLength = 4_096) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  if (value.length > maxLength) throw new RangeError(`${field} exceeds the local manifest limit`);
  return value;
}

function requireInteger(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`${field} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function requireTimestamp(value, field) {
  requireString(value, field, 128);
  if (!Number.isFinite(Date.parse(value))) throw new TypeError(`${field} must be a valid timestamp`);
  return value;
}

function copyAllocation(allocation) {
  return freeze({
    id: requireString(allocation.id, "allocation.id"),
    ordinal: requireInteger(allocation.ordinal, "allocation.ordinal", 1),
    recipientClass: requireString(allocation.recipientClass, "allocation.recipientClass"),
    label: requireString(allocation.label, "allocation.label"),
    purpose: requireString(allocation.purpose, "allocation.purpose"),
    basisPoints: requireInteger(allocation.basisPoints, "allocation.basisPoints", 1),
    percentage: allocation.percent,
    tokenUnits: requireInteger(allocation.tokenUnits, "allocation.tokenUnits"),
    unit: ASSET_TOKEN_UNIT,
    aggregate: true,
    fictional: true,
    simulation: true,
    executable: false,
  });
}

function copyRegistryEntry(entry) {
  return freeze({
    id: requireString(entry.id, "registry.id"),
    registryKey: requireString(entry.registryKey, "registry.registryKey"),
    allocationId: requireString(entry.allocationId, "registry.allocationId"),
    recipientClass: requireString(entry.recipientClass, "registry.recipientClass"),
    label: requireString(entry.label, "registry.label"),
    coverage: requireString(entry.coverage, "registry.coverage"),
    basisPoints: requireInteger(entry.shareBasisPoints, "registry.shareBasisPoints", 1),
    percentage: entry.percent,
    tokenUnits: requireInteger(entry.tokenUnits, "registry.tokenUnits"),
    unit: ASSET_TOKEN_UNIT,
    aggregate: true,
    fictional: true,
    simulation: true,
    externalTransfer: false,
    executable: false,
  });
}

function copyMigrationEntry(entry) {
  return freeze({
    id: requireString(entry.id, "migration.id"),
    legacyId: requireString(entry.legacyId, "migration.legacyId"),
    label: requireString(entry.label, "migration.label"),
    mappingStatus: requireString(entry.mappingStatus, "migration.mappingStatus"),
    mappingKind: requireString(entry.mappingKind, "migration.mappingKind"),
    targetId: entry.targetId === null ? null : requireString(entry.targetId, "migration.targetId"),
    safeToApply: entry.mappingStatus !== "deferred",
    localOnly: true,
    simulation: true,
    executable: false,
  });
}

function copySocialEntries(entries, fields) {
  return freeze(entries.map((entry, index) => freeze({
    ordinal: index + 1,
    id: requireString(entry.id, `social.${fields[0]}.id`),
    label: requireString(entry.label, `social.${fields[0]}.label`),
    mode: requireString(entry.mode ?? entry.signal ?? entry.intent ?? "local-preview", `social.${fields[0]}.mode`),
    targetId: requireString(entry.targetId ?? entry.roomId ?? "aggregate-local", `social.${fields[0]}.targetId`),
    localOnly: true,
    simulation: true,
    executable: false,
  })));
}

function socialManifest() {
  const projection = DEFAULT_SOCIAL_EXPLORER_PROJECTION;
  return freeze({
    id: SOCIAL_EXPLORER_ID,
    rehearsalId: SOCIAL_EXPLORER_REHEARSAL_ID,
    rooms: copySocialEntries(projection.rooms ?? [], ["rooms"]),
    creatorCards: copySocialEntries(projection.creatorCards ?? [], ["creatorCards"]),
    discoverySignals: copySocialEntries(projection.discoverySignals ?? [], ["discoverySignals"]),
    actions: copySocialEntries(projection.rehearsalActions ?? [], ["actions"]),
    steps: freeze((projection.rehearsal?.steps ?? []).map((step, index) => freeze({
      ordinal: Number.isInteger(step.ordinal) ? step.ordinal : index + 1,
      intent: requireString(step.intent, "social.steps.intent"),
      targetId: requireString(step.targetId, "social.steps.targetId"),
      status: requireString(step.status, "social.steps.status"),
      localOnly: true,
      simulation: true,
      executable: false,
    }))),
    localOnly: true,
    simulation: true,
    executable: false,
  });
}

/**
 * Build the portable manifest from the canonical frozen local fixtures.
 * Calling this repeatedly is pure and deterministic.
 */
export function createLaunchKit({
  updatedAt = LAUNCH_KIT_UPDATED_AT,
  features = LAUNCH_KIT_FEATURES,
  allocations = ASSET_TOKEN_ALLOCATIONS,
  registry = FICTIONAL_RECIPIENT_REGISTRY,
  migration = BLOCK_MIGRATION_MANIFEST,
  social = socialManifest(),
  devices = DEVICE_PROFILES,
} = {}) {
  requireTimestamp(updatedAt, "updatedAt");
  if (!Array.isArray(features) || !Array.isArray(allocations) || !Array.isArray(registry)) {
    throw new TypeError("features, allocations, and registry must be arrays");
  }
  if (!migration || typeof migration !== "object" || !Array.isArray(migration.entries)) {
    throw new TypeError("migration must contain an entries array");
  }
  const featureRows = features.map((feature, index) => freeze({
    ordinal: index + 1,
    id: requireString(feature.id, `features[${index}].id`),
    label: requireString(feature.label, `features[${index}].label`),
    kicker: requireString(feature.kicker, `features[${index}].kicker`),
    route: requireString(feature.route ?? `?feature=${feature.id}`, `features[${index}].route`, 256),
    localOnly: true,
    simulation: true,
    executable: false,
  }));
  const allocationRows = allocations.map(copyAllocation);
  const registryRows = registry.map(copyRegistryEntry);
  const allocationSummary = summarizeDistributionRegistry(registryRows);
  const migrationRows = migration.entries.map(copyMigrationEntry);
  const socialRows = socialManifestFrom(social);
  const deviceRows = devices.map((device, index) => freeze({
    ordinal: index + 1,
    id: requireString(device.id, `devices[${index}].id`),
    label: requireString(device.label, `devices[${index}].label`),
    viewport: requireString(device.viewport, `devices[${index}].viewport`),
    input: requireString(device.input, `devices[${index}].input`),
    motion: requireString(device.motion, `devices[${index}].motion`),
    xr: requireString(device.xr, `devices[${index}].xr`),
    localOnly: true,
    simulation: true,
    executable: false,
  }));
  const allocationBasisPoints = allocationRows.reduce((sum, row) => sum + row.basisPoints, 0);
  const allocationUnits = allocationRows.reduce((sum, row) => sum + row.tokenUnits, 0);
  const registryBasisPoints = registryRows.reduce((sum, row) => sum + row.basisPoints, 0);
  const registryUnits = registryRows.reduce((sum, row) => sum + row.tokenUnits, 0);
  return deepFreeze({
    schemaVersion: LAUNCH_KIT_SCHEMA_VERSION,
    source: LAUNCH_KIT_SOURCE,
    id: LAUNCH_KIT_ID,
    kind: LAUNCH_KIT_KIND,
    updatedAt,
    deterministic: true,
    simulation: true,
    localOnly: true,
    executable: false,
    token: {
      kind: ASSET_TOKEN_KIND,
      source: ASSET_TOKEN_SOURCE,
      symbol: "TUMBO",
      unit: ASSET_TOKEN_UNIT,
      totalSupply: ASSET_TOKEN_TOTAL_SUPPLY,
      totalBasisPoints: ASSET_TOKEN_TOTAL_BASIS_POINTS,
      allocationCount: allocationRows.length,
      allocations: allocationRows,
      allocationBasisPoints,
      allocationUnits,
      registrySource: DISTRIBUTION_REGISTRY_SOURCE,
      registryCount: registryRows.length,
      registry: registryRows,
      registryBasisPoints,
      registryUnits,
      allocationSummary,
      externalDistribution: false,
      walletConnection: false,
      recipientAddresses: false,
      issuance: false,
      custody: false,
      signing: false,
      settlement: false,
      market: false,
      realMoney: false,
    },
    features: featureRows,
    migration: {
      manifestId: BLOCK_MIGRATION_MANIFEST_ID,
      project: "arena-living-reality",
      entryCount: migrationRows.length,
      entries: migrationRows,
      deferredCount: migrationRows.filter((entry) => !entry.safeToApply).length,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
    },
    social: socialRows,
    devices: deviceRows,
    boundary,
    capabilities: freeze([
      freeze({ id: "launch-kit.preview", mode: "local-projection", enabled: true, authority: "none", executable: false }),
      freeze({ id: "launch-kit.download-json", mode: "user-triggered-local-export", enabled: true, authority: "none", executable: false }),
      freeze({ id: "launch-kit.external-launch", mode: "denied", enabled: false, denied: true, authority: "none", executable: false, reason: "The kit is a local manifest; it cannot launch services or send records." }),
      freeze({ id: "launch-kit.real-distribution", mode: "denied", enabled: false, denied: true, authority: "none", executable: false, reason: "TUMBO-SIM is fictional and the kit contains no recipient or wallet authority." }),
    ]),
  });
}

function socialManifestFrom(social) {
  if (!social || typeof social !== "object") throw new TypeError("social must be an object");
  const rows = (key, label) => copySocialEntries(Array.isArray(social[key]) ? social[key] : [], [label]);
  const steps = freeze((Array.isArray(social.steps) ? social.steps : []).map((step, index) => freeze({
    ordinal: Number.isInteger(step.ordinal) ? step.ordinal : index + 1,
    intent: requireString(step.intent, "social.steps.intent"),
    targetId: requireString(step.targetId, "social.steps.targetId"),
    status: requireString(step.status, "social.steps.status"),
    localOnly: true,
    simulation: true,
    executable: false,
  })));
  return freeze({
    id: requireString(social.id ?? SOCIAL_EXPLORER_ID, "social.id"),
    rehearsalId: requireString(social.rehearsalId ?? SOCIAL_EXPLORER_REHEARSAL_ID, "social.rehearsalId"),
    rooms: rows("rooms", "rooms"),
    creatorCards: rows("creatorCards", "creatorCards"),
    discoverySignals: rows("discoverySignals", "discoverySignals"),
    actions: rows("actions", "actions"),
    steps,
    roomCount: rows("rooms", "rooms").length,
    creatorCardCount: rows("creatorCards", "creatorCards").length,
    discoverySignalCount: rows("discoverySignals", "discoverySignals").length,
    actionCount: rows("actions", "actions").length,
    stepCount: steps.length,
    localOnly: true,
    simulation: true,
    executable: false,
  });
}

const FORBIDDEN_KEYS = new Set([
  "address", "addresses", "account", "accounts", "wallet", "wallets", "privatekey", "privatekeys",
  "secret", "secrets", "password", "credential", "credentials", "signature", "signatures",
  "command", "commands", "script", "scripts", "exec", "execute", "function", "eval",
  "networkrequest", "transferinstruction", "settlementinstruction", "mintinstruction",
]);

function assertSafeGraph(value, path = "launchKit", seen = new WeakSet(), depth = 0) {
  if (depth > 10) throw new RangeError(`${path} exceeds the local manifest depth limit`);
  if (value === null || value === undefined) return;
  if (["function", "symbol", "bigint"].includes(typeof value)) throw new TypeError(`${path} contains an unsupported value`);
  if (typeof value === "string") {
    if (value.length > 16_384) throw new RangeError(`${path} contains an oversized string`);
    return;
  }
  if (typeof value !== "object") return;
  if (seen.has(value)) throw new TypeError(`${path} must not contain cycles`);
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > 512) throw new RangeError(`${path} contains too many entries`);
    value.forEach((entry, index) => assertSafeGraph(entry, `${path}[${index}]`, seen, depth + 1));
    seen.delete(value);
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${path} must contain plain objects`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (FORBIDDEN_KEYS.has(normalized)) throw new TypeError(`${path}.${key} is not accepted by the local manifest`);
    if (!Object.prototype.hasOwnProperty.call(descriptor, "value")) throw new TypeError(`${path}.${key} must not be a getter or setter`);
    assertSafeGraph(descriptor.value, `${path}.${key}`, seen, depth + 1);
  }
  seen.delete(value);
}

function requireBoolean(value, field, expected) {
  if (value !== expected) throw new TypeError(`${field} must be ${expected}`);
  return value;
}

function validateFeatureRows(features) {
  if (!Array.isArray(features) || features.length !== LAUNCH_KIT_FEATURES.length) throw new TypeError("features must contain all local routes");
  const ids = new Set();
  features.forEach((feature, index) => {
    requireString(feature.id, `features[${index}].id`, 128);
    if (ids.has(feature.id)) throw new TypeError(`Duplicate feature id: ${feature.id}`);
    ids.add(feature.id);
    requireString(feature.label, `features[${index}].label`);
    requireString(feature.kicker, `features[${index}].kicker`);
    requireString(feature.route, `features[${index}].route`, 256);
    requireBoolean(feature.localOnly, `features[${index}].localOnly`, true);
    requireBoolean(feature.executable, `features[${index}].executable`, false);
  });
}

function validateRows(rows, field, expectedCount, expectedBasisPoints, expectedUnits) {
  if (!Array.isArray(rows) || rows.length !== expectedCount) throw new TypeError(`${field} must contain ${expectedCount} rows`);
  const ids = new Set();
  let basisPoints = 0;
  let units = 0;
  rows.forEach((row, index) => {
    requireString(row.id, `${field}[${index}].id`);
    if (ids.has(row.id)) throw new TypeError(`Duplicate ${field} id: ${row.id}`);
    ids.add(row.id);
    basisPoints += requireInteger(row.basisPoints, `${field}[${index}].basisPoints`);
    units += requireInteger(row.tokenUnits, `${field}[${index}].tokenUnits`);
    requireBoolean(row.aggregate, `${field}[${index}].aggregate`, true);
    requireBoolean(row.fictional, `${field}[${index}].fictional`, true);
    requireBoolean(row.simulation, `${field}[${index}].simulation`, true);
    requireBoolean(row.executable, `${field}[${index}].executable`, false);
  });
  if (basisPoints !== expectedBasisPoints) throw new TypeError(`${field} basis points must sum to ${expectedBasisPoints}; received ${basisPoints}`);
  if (units !== expectedUnits) throw new TypeError(`${field} units must sum to ${expectedUnits}; received ${units}`);
}

/** Validate a parsed Launch Kit payload without invoking caller code. */
export function validateLaunchKit(input) {
  assertSafeGraph(input);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("launchKit must be an object");
  if (input.schemaVersion !== LAUNCH_KIT_SCHEMA_VERSION) throw new TypeError("Unsupported Launch Kit schemaVersion");
  if (input.source !== LAUNCH_KIT_SOURCE || input.id !== LAUNCH_KIT_ID || input.kind !== LAUNCH_KIT_KIND) throw new TypeError("Launch Kit identity is invalid");
  requireTimestamp(input.updatedAt, "updatedAt");
  requireBoolean(input.deterministic, "deterministic", true);
  requireBoolean(input.simulation, "simulation", true);
  requireBoolean(input.localOnly, "localOnly", true);
  requireBoolean(input.executable, "executable", false);
  validateFeatureRows(input.features);
  const token = input.token;
  if (!token || typeof token !== "object") throw new TypeError("token section is required");
  if (token.unit !== ASSET_TOKEN_UNIT || token.totalSupply !== ASSET_TOKEN_TOTAL_SUPPLY || token.totalBasisPoints !== ASSET_TOKEN_TOTAL_BASIS_POINTS) throw new TypeError("token fixed supply is invalid");
  validateRows(token.allocations, "token.allocations", ASSET_TOKEN_ALLOCATIONS.length, ASSET_TOKEN_TOTAL_BASIS_POINTS, ASSET_TOKEN_TOTAL_SUPPLY);
  validateRows(token.registry, "token.registry", FICTIONAL_RECIPIENT_REGISTRY.length, ASSET_TOKEN_TOTAL_BASIS_POINTS, ASSET_TOKEN_TOTAL_SUPPLY);
  if (!token.allocationSummary || !Array.isArray(token.allocationSummary.classes)) {
    throw new TypeError("token allocation summary is required");
  }
  if (token.allocationSummary.classes.length !== ASSET_TOKEN_ALLOCATIONS.length
    || token.allocationSummary.complete !== true
    || token.allocationSummary.totalBasisPoints !== ASSET_TOKEN_TOTAL_BASIS_POINTS
    || token.allocationSummary.totalUnits !== ASSET_TOKEN_TOTAL_SUPPLY
    || token.allocationSummary.expectedBasisPoints !== ASSET_TOKEN_TOTAL_BASIS_POINTS
    || token.allocationSummary.expectedUnits !== ASSET_TOKEN_TOTAL_SUPPLY) {
    throw new TypeError("token allocation summary does not reconcile");
  }
  token.allocationSummary.classes.forEach((allocation, index) => {
    requireString(allocation.allocationId, `token.allocationSummary.classes[${index}].allocationId`);
    requireString(allocation.label, `token.allocationSummary.classes[${index}].label`);
    requireBoolean(allocation.complete, `token.allocationSummary.classes[${index}].complete`, true);
    requireBoolean(allocation.aggregate, `token.allocationSummary.classes[${index}].aggregate`, true);
    requireBoolean(allocation.fictional, `token.allocationSummary.classes[${index}].fictional`, true);
    requireBoolean(allocation.simulation, `token.allocationSummary.classes[${index}].simulation`, true);
    requireBoolean(allocation.executable, `token.allocationSummary.classes[${index}].executable`, false);
  });
  requireBoolean(token.externalDistribution, "token.externalDistribution", false);
  requireBoolean(token.walletConnection, "token.walletConnection", false);
  requireBoolean(token.recipientAddresses, "token.recipientAddresses", false);
  requireBoolean(token.issuance, "token.issuance", false);
  requireBoolean(token.custody, "token.custody", false);
  requireBoolean(token.signing, "token.signing", false);
  requireBoolean(token.settlement, "token.settlement", false);
  requireBoolean(token.market, "token.market", false);
  requireBoolean(token.realMoney, "token.realMoney", false);
  if (!input.migration || input.migration.manifestId !== BLOCK_MIGRATION_MANIFEST_ID || !Array.isArray(input.migration.entries)) throw new TypeError("migration section is invalid");
  input.migration.entries.forEach((entry, index) => {
    requireString(entry.id, `migration.entries[${index}].id`);
    requireString(entry.legacyId, `migration.entries[${index}].legacyId`);
    requireBoolean(entry.localOnly, `migration.entries[${index}].localOnly`, true);
    requireBoolean(entry.executable, `migration.entries[${index}].executable`, false);
  });
  if (!input.social || !Array.isArray(input.social.rooms) || !Array.isArray(input.social.creatorCards) || !Array.isArray(input.social.discoverySignals) || !Array.isArray(input.social.actions) || !Array.isArray(input.social.steps)) throw new TypeError("social section is invalid");
  if (!Array.isArray(input.devices) || input.devices.length < 3) throw new TypeError("devices must include phone, PC, and XR profiles");
  if (!input.boundary || typeof input.boundary !== "object") throw new TypeError("boundary section is required");
  Object.entries(boundary).forEach(([key, expected]) => requireBoolean(input.boundary[key], `boundary.${key}`, expected));
  if (JSON.stringify(input).length > LAUNCH_KIT_MAX_JSON_BYTES) throw new RangeError("Launch Kit JSON exceeds the local export limit");
  return deepFreeze(input);
}

export function serializeLaunchKit(input = createLaunchKit()) {
  const valid = validateLaunchKit(input);
  return JSON.stringify(valid, null, 2);
}

export function summarizeLaunchKit(input = createLaunchKit()) {
  const valid = validateLaunchKit(input);
  return deepFreeze({
    id: valid.id,
    source: valid.source,
    featureCount: valid.features.length,
    allocationCount: valid.token.allocations.length,
    registryCount: valid.token.registry.length,
    migrationCount: valid.migration.entries.length,
    deferredMigrationCount: valid.migration.deferredCount,
    socialRoomCount: valid.social.roomCount,
    socialCreatorCardCount: valid.social.creatorCardCount,
    socialDiscoverySignalCount: valid.social.discoverySignalCount,
    socialActionCount: valid.social.actionCount,
    deviceCount: valid.devices.length,
    totalSupply: valid.token.totalSupply,
    totalBasisPoints: valid.token.totalBasisPoints,
    allocationClassCount: valid.token.allocationSummary.classes.length,
    allocationComplete: valid.token.allocationSummary.complete,
    registryBasisPoints: valid.token.registryBasisPoints,
    registryUnits: valid.token.registryUnits,
    unit: valid.token.unit,
    localOnly: true,
    simulation: true,
    executable: false,
  });
}

export const DEFAULT_LAUNCH_KIT = createLaunchKit();
export const LAUNCH_KIT = DEFAULT_LAUNCH_KIT;
