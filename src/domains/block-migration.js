/**
 * Local bridge for concepts that existed in the earlier Arena / Living
 * Reality prototypes.
 *
 * The bridge is deliberately a data-only seam. It describes how a handful of
 * legacy concepts line up with the current projection, then creates an
 * in-memory preview or local draft. It never opens a legacy file, evaluates a
 * module, contacts a provider, or mutates the canonical world projection.
 */

export const BLOCK_MIGRATION_SCHEMA_VERSION = 1;
export const BLOCK_MIGRATION_SOURCE = "block-migration-bridge";
export const BLOCK_MIGRATION_MANIFEST_ID = "migration:arena-living-reality-v1";
export const BLOCK_MIGRATION_UPDATED_AT = "2025-01-01T00:00:00.000Z";
export const BLOCK_MIGRATION_PREVIEW_SOURCE = "block-migration-preview";
export const BLOCK_MIGRATION_DRAFT_SOURCE = "block-migration-local-draft";
export const BLOCK_MIGRATION_CONSOLE_SOURCE = "block-migration-console";
export const BLOCK_MIGRATION_HANDBACK_SOURCE = "block-migration-handback";
export const BLOCK_MIGRATION_SNAPSHOT_SOURCE = "block-migration-user-snapshot";
export const BLOCK_MIGRATION_SNAPSHOT_PREVIEW_SOURCE = "block-migration-user-preview";
export const BLOCK_MIGRATION_SNAPSHOT_SCHEMA_VERSION = 1;
export const BLOCK_MIGRATION_SNAPSHOT_LIMITS = Object.freeze({
  maxTextLength: 64_000,
  maxEntries: 64,
  maxNodes: 2_048,
});
export const BLOCK_MIGRATION_STATUSES = Object.freeze(["mapped", "preserved", "deferred"]);

export const BLOCK_MIGRATION_BOUNDARY =
  "Local mapping only. No filesystem import, imported-code execution, persistence, network, identity, live chain, token, wallet, transfer, or external execution is active.";

const STATUS_SET = new Set(BLOCK_MIGRATION_STATUSES);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach((entry) => deepFreeze(entry));
    return Object.freeze(value);
  }
  if (!isRecord(value)) return value;
  Object.values(value).forEach((entry) => deepFreeze(entry));
  return Object.freeze(value);
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function requireStatus(value, field = "status") {
  if (!STATUS_SET.has(value)) throw new TypeError(`${field} must be mapped, preserved, or deferred`);
  return value;
}

function safeInteger(value, fallback = 0) {
  return Number.isSafeInteger(value) ? value : fallback;
}

function cloneCoordinate(value, field) {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((entry) => Number.isInteger(entry))) {
    throw new TypeError(`${field} must be an integer [x, y, z] coordinate`);
  }
  return Object.freeze([...value]);
}

function freezeStrings(value, field) {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  return Object.freeze(value.map((entry, index) => requireString(entry, `${field}[${index}]`)));
}

function mappingRecord(definition) {
  const status = requireStatus(definition.status);
  const block = definition.block
    ? {
        blockType: requireString(definition.block.blockType, `${definition.id}.block.blockType`),
        coordinate: cloneCoordinate(definition.block.coordinate, `${definition.id}.block.coordinate`),
      }
    : null;
  const record = {
    id: requireString(definition.id, "manifest entry id"),
    legacyId: requireString(definition.legacyId, "manifest entry legacyId"),
    label: requireString(definition.label, "manifest entry label"),
    sourceProject: "arena-living-reality",
    sourceKind: requireString(definition.sourceKind, `${definition.id}.sourceKind`),
    targetId: definition.targetId === null ? null : requireString(definition.targetId, `${definition.id}.targetId`),
    targetKind: requireString(definition.targetKind, `${definition.id}.targetKind`),
    status,
    mappingStatus: status,
    mappingKind: requireString(definition.mappingKind, `${definition.id}.mappingKind`),
    rationale: requireString(definition.rationale, `${definition.id}.rationale`),
    block,
    preservedConcepts: freezeStrings(definition.preservedConcepts ?? [], `${definition.id}.preservedConcepts`),
    deferredCapabilities: freezeStrings(definition.deferredCapabilities ?? [], `${definition.id}.deferredCapabilities`),
    simulation: true,
    fictional: true,
    localOnly: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  };
  return deepFreeze(record);
}

const MANIFEST_DEFINITIONS = [
  {
    id: "migration:world-scene-layout",
    legacyId: "world-scene-layout",
    label: "World Scene Layout",
    sourceKind: "scene-layout",
    targetId: "semantic-block-fabric",
    targetKind: "semantic-block-world",
    status: "mapped",
    mappingKind: "scene-to-semantic-block-grid",
    rationale: "The old scene graph becomes a deterministic block grid and remains a renderer projection.",
    block: { blockType: "portal", coordinate: [4, 0, 4] },
    preservedConcepts: ["nested scene regions", "stable camera anchors"],
    deferredCapabilities: ["external scene package loading"],
  },
  {
    id: "migration:world-games",
    legacyId: "world-games",
    label: "World Games",
    sourceKind: "game-organ",
    targetId: "arena",
    targetKind: "arena-runtime-organ",
    status: "preserved",
    mappingKind: "runtime-organ-preservation",
    rationale: "Game-room motion and outcome semantics stay inside the local ARENA organ until a separate game adapter exists.",
    block: { blockType: "crystal", coordinate: [2, 0, 4] },
    preservedConcepts: ["actors", "state motion", "outcome semantics"],
    deferredCapabilities: ["live game service", "networked multiplayer"],
  },
  {
    id: "migration:world-contracts",
    legacyId: "world-contracts",
    label: "World Contracts",
    sourceKind: "contract-scenario",
    targetId: "contracts-markets",
    targetKind: "contract-market-projection",
    status: "mapped",
    mappingKind: "contract-scenario-to-domain-record",
    rationale: "Contract and pool concepts map to the existing fictional contracts projection without becoming executable agreements.",
    block: { blockType: "stone", coordinate: [6, 0, 4] },
    preservedConcepts: ["covenant", "pool", "risk rehearsal"],
    deferredCapabilities: ["binding agreement", "settlement"],
  },
  {
    id: "migration:arena-room",
    legacyId: "arena-room",
    label: "Arena Room",
    sourceKind: "room-container",
    targetId: "spatial-rooms",
    targetKind: "spatial-room",
    status: "mapped",
    mappingKind: "room-container-to-spatial-room",
    rationale: "The Arena room concept maps to a membership-scoped room portal and stays enterable only in local presentation state.",
    block: { blockType: "portal", coordinate: [4, 0, 2] },
    preservedConcepts: ["room boundary", "membership scope", "portal entry"],
    deferredCapabilities: ["remote room membership", "message transport"],
  },
  {
    id: "migration:semantic-block-concepts",
    legacyId: "semantic-block-concepts",
    label: "Semantic Block Concepts",
    sourceKind: "semantic-block-fabric",
    targetId: "semantic-block-fabric",
    targetKind: "semantic-block-world",
    status: "preserved",
    mappingKind: "block-fabric-preservation",
    rationale: "Nested blocks, coordinates, and provenance are already represented by the current local block fabric.",
    block: { blockType: "wood", coordinate: [4, 1, 4] },
    preservedConcepts: ["nested blocks", "coordinates", "provenance"],
    deferredCapabilities: ["cross-project block import", "persistent world editing"],
  },
  {
    id: "migration:external-project-sync",
    legacyId: "external-project-sync",
    label: "External Project Sync",
    sourceKind: "provider-bridge",
    targetId: null,
    targetKind: "none",
    status: "deferred",
    mappingKind: "explicit-boundary-deferral",
    rationale: "External files, providers, identities, and imported runtime code need a separately authorized adapter and are not part of this demo.",
    block: null,
    preservedConcepts: [],
    deferredCapabilities: ["filesystem access", "imported-code execution", "network sync", "identity handoff"],
  },
];

export const BLOCK_MIGRATION_ENTRIES = Object.freeze(MANIFEST_DEFINITIONS.map(mappingRecord));

function statusCounts(entries) {
  return deepFreeze(BLOCK_MIGRATION_STATUSES.reduce((counts, status) => {
    counts[status] = entries.filter((entry) => entry.status === status).length;
    return counts;
  }, { mapped: 0, preserved: 0, deferred: 0 }));
}

export const BLOCK_MIGRATION_CAPABILITIES = deepFreeze([
  {
    id: "block-migration.inspect-manifest",
    label: "Inspect deterministic legacy-to-current mappings",
    enabled: true,
    mode: "local-projection",
    authority: "none",
    simulationOnly: true,
    executable: false,
  },
  {
    id: "block-migration.preview",
    label: "Preview safe mappings before applying a draft",
    enabled: true,
    mode: "in-memory-preview",
    authority: "none",
    simulationOnly: true,
    executable: false,
  },
  {
    id: "block-migration.apply-local-draft",
    label: "Apply mapped concepts to a local draft",
    enabled: true,
    mode: "local-draft",
    authority: "none",
    simulationOnly: true,
    executable: false,
  },
  {
    id: "block-migration.external-import",
    label: "Read a legacy file or package",
    enabled: false,
    mode: "denied",
    authority: "none",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "This bridge accepts only the fixed in-memory manifest.",
  },
  {
    id: "block-migration.imported-code-execution",
    label: "Run code from an imported project",
    enabled: false,
    mode: "denied",
    authority: "none",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "Mappings contain data only; no imported code is evaluated.",
  },
  {
    id: "block-migration.persistence",
    label: "Persist or publish a migrated draft",
    enabled: false,
    mode: "denied",
    authority: "none",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "The local draft exists only in the current page/session memory.",
  },
]);

export function createBlockMigrationManifest({
  updatedAt = BLOCK_MIGRATION_UPDATED_AT,
} = {}) {
  requireString(updatedAt, "updatedAt");
  const entries = BLOCK_MIGRATION_ENTRIES.map((entry) => entry);
  const counts = statusCounts(entries);
  return deepFreeze({
    schemaVersion: BLOCK_MIGRATION_SCHEMA_VERSION,
    source: BLOCK_MIGRATION_SOURCE,
    id: BLOCK_MIGRATION_MANIFEST_ID,
    kind: "block-migration-manifest",
    project: "arena-living-reality",
    updatedAt,
    deterministic: true,
    simulation: true,
    fictional: true,
    localOnly: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    entries: Object.freeze(entries),
    entities: Object.freeze(entries),
    mappings: Object.freeze(entries),
    counts,
    statusCounts: counts,
    capabilities: BLOCK_MIGRATION_CAPABILITIES,
    evidence: Object.freeze([
      {
        id: `${BLOCK_MIGRATION_MANIFEST_ID}:deterministic`,
        kind: "deterministic-manifest",
        status: "declared",
        entryCount: entries.length,
        statuses: counts,
        simulation: true,
        deterministic: true,
      },
      {
        id: `${BLOCK_MIGRATION_MANIFEST_ID}:boundary`,
        kind: "migration-boundary",
        status: "enforced",
        externalImport: false,
        importedCodeExecution: false,
        persistence: false,
        externalNetwork: false,
        externalTransfer: false,
        executable: false,
      },
    ]),
    provenance: {
      source: BLOCK_MIGRATION_SOURCE,
      version: BLOCK_MIGRATION_SCHEMA_VERSION,
      basis: "fixed Arena / Living Reality concept manifest",
      deterministicKey: `${BLOCK_MIGRATION_SOURCE}:${BLOCK_MIGRATION_MANIFEST_ID}`,
    },
    boundary: BLOCK_MIGRATION_BOUNDARY,
  });
}

export const BLOCK_MIGRATION_MANIFEST = createBlockMigrationManifest();
export const DEFAULT_BLOCK_MIGRATION_MANIFEST = BLOCK_MIGRATION_MANIFEST;
export const BLOCK_MIGRATION_PROJECTION = BLOCK_MIGRATION_MANIFEST;

function migrationIdentifier(value) {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (!isRecord(value)) return null;
  const candidate = value.mappingId ?? value.id ?? value.legacyId;
  return typeof candidate === "string" && candidate.trim() !== "" ? candidate.trim() : null;
}

function migrationEntryFor(value) {
  const identifier = migrationIdentifier(value);
  if (!identifier) return null;
  return BLOCK_MIGRATION_ENTRIES.find((entry) => (
    entry.id === identifier
      || entry.legacyId === identifier
      || `preview:${entry.id}` === identifier
  )) ?? null;
}

function projectionBlockList(projection) {
  if (Array.isArray(projection)) return projection;
  if (!isRecord(projection)) return [];
  if (Array.isArray(projection.blocks)) return projection.blocks;
  if (Array.isArray(projection.entities)) return projection.entities;
  if (Array.isArray(projection.draft?.blocks)) return projection.draft.blocks;
  if (Array.isArray(projection.projection?.blocks)) return projection.projection.blocks;
  if (Array.isArray(projection.contributions)) {
    const contribution = projection.contributions.find((candidate) => (
      isRecord(candidate)
        && (candidate.source === "semantic-block-fabric" || Array.isArray(candidate.blocks))
        && Array.isArray(candidate.blocks ?? candidate.entities)
    ));
    return contribution ? (contribution.blocks ?? contribution.entities) : [];
  }
  return [];
}

function handbackCoordinate(entry) {
  const coordinate = entry?.block?.coordinate;
  return Array.isArray(coordinate) && coordinate.length === 3 && coordinate.every(Number.isInteger)
    ? [...coordinate]
    : null;
}

/**
 * Resolve one known migration row against the existing Block World cube
 * substrate without creating or mutating a block.  This is the domain-level
 * continuity contract used by the renderer handoff: a mapped/preserved row
 * carries a deterministic coordinate, while deferred rows stay denied and
 * report no cube target.  The returned record is safe to render or emit as a
 * local intent and never reads files, runs code, contacts a provider, or
 * persists a draft.
 */
export function resolveBlockMigrationHandback(projection, mapping) {
  const entry = migrationEntryFor(mapping);
  if (!entry) throw new TypeError("Unknown migration entry for cube handback");
  const coordinate = handbackCoordinate(entry);
  const blocks = projectionBlockList(projection);
  const target = coordinate
    ? blocks.find((block) => (
      isRecord(block)
        && block.x === coordinate[0]
        && block.y === coordinate[1]
        && block.z === coordinate[2]
    )) ?? null
    : null;
  const reason = entry.status === "deferred"
    ? "deferred-mapping"
    : !coordinate
      ? "no-cube-target"
      : target
        ? null
        : "cube-not-found-in-current-draft";
  return deepFreeze({
    source: BLOCK_MIGRATION_HANDBACK_SOURCE,
    kind: "block-migration-handback",
    action: target ? "show-in-cube" : "show-in-cube-blocked",
    mappingId: entry.id,
    legacyId: entry.legacyId,
    label: entry.label,
    status: entry.status,
    targetId: entry.targetId,
    targetKind: entry.targetKind,
    coordinate,
    block: entry.block,
    blockId: typeof target?.id === "string" ? target.id : null,
    found: Boolean(target),
    reason,
    returnFeature: "migration",
    localOnly: true,
    simulation: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    boundary: BLOCK_MIGRATION_BOUNDARY,
  });
}

export const createBlockMigrationHandback = resolveBlockMigrationHandback;
export const resolveMigrationToBlock = resolveBlockMigrationHandback;

const SNAPSHOT_FORBIDDEN_KEYS = new Set([
  "__proto__", "constructor", "prototype", "run", "execute", "eval", "code",
  "script", "module", "import", "command", "writefile", "readfile", "fetch", "websocket",
]);

function isPlainRecord(value) {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function snapshotError(code, path, message) {
  return { code, path, message };
}

function copySnapshotJson(value, path, errors, seen, counters) {
  counters.nodes += 1;
  if (counters.nodes > BLOCK_MIGRATION_SNAPSHOT_LIMITS.maxNodes) {
    errors.push(snapshotError("snapshot-too-complex", path || "$", `Snapshot exceeds ${BLOCK_MIGRATION_SNAPSHOT_LIMITS.maxNodes} data nodes.`));
    return null;
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) errors.push(snapshotError("non-finite-number", path || "$", `${path || "$"} must be a finite JSON number.`));
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    errors.push(snapshotError("non-json-value", path || "$", `${path || "$"} contains a non-JSON value.`));
    return null;
  }
  if (!Array.isArray(value) && !isPlainRecord(value)) {
    errors.push(snapshotError("non-plain-value", path || "$", `${path || "$"} must contain plain JSON data.`));
    return null;
  }
  if (seen.has(value)) {
    errors.push(snapshotError("cyclic-value", path || "$", `${path || "$"} contains a cyclic reference.`));
    return null;
  }
  seen.add(value);
  let output;
  if (Array.isArray(value)) {
    output = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) {
        errors.push(snapshotError("accessor-field", `${path}[${index}]`, `${path}[${index}] must be a data property.`));
        output.push(null);
      } else {
        output.push(copySnapshotJson(descriptor.value, `${path}[${index}]`, errors, seen, counters));
      }
    }
  } else {
    output = {};
    Object.keys(Object.getOwnPropertyDescriptors(value)).forEach((key) => {
      const childPath = path ? `${path}.${key}` : key;
      if (SNAPSHOT_FORBIDDEN_KEYS.has(key.toLowerCase())) {
        errors.push(snapshotError("forbidden-field", childPath, `${childPath} is not accepted in a safe snapshot.`));
        return;
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) {
        errors.push(snapshotError("accessor-field", childPath, `${childPath} must be a data property.`));
        return;
      }
      output[key] = copySnapshotJson(descriptor.value, childPath, errors, seen, counters);
    });
  }
  seen.delete(value);
  return output;
}

function parseUserSnapshot(input) {
  if (typeof input !== "string") return { value: input, errors: [] };
  if (input.length > BLOCK_MIGRATION_SNAPSHOT_LIMITS.maxTextLength) {
    return { value: null, errors: [snapshotError("snapshot-too-large", "$", `Snapshot JSON exceeds ${BLOCK_MIGRATION_SNAPSHOT_LIMITS.maxTextLength} characters.`)] };
  }
  if (!input.trim()) return { value: null, errors: [snapshotError("empty-snapshot", "$", "Snapshot JSON is empty.")] };
  try {
    return { value: JSON.parse(input), errors: [] };
  } catch (error) {
    return { value: null, errors: [snapshotError("invalid-json", "$", `Snapshot JSON could not be parsed: ${String(error?.message ?? "syntax error")}`)] };
  }
}

function sameCoordinate(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === 3 && right.length === 3
    && left.every((value, index) => value === right[index]);
}

function userSnapshotEntries(snapshot, errors) {
  const entries = Array.isArray(snapshot?.entries)
    ? snapshot.entries
    : Array.isArray(snapshot?.mappings) ? snapshot.mappings : null;
  if (!entries) {
    errors.push(snapshotError("entries-required", "entries", "Snapshot must contain an entries or mappings array."));
    return [];
  }
  if (entries.length > BLOCK_MIGRATION_SNAPSHOT_LIMITS.maxEntries) {
    errors.push(snapshotError("entries-too-large", "entries", `Snapshot may contain at most ${BLOCK_MIGRATION_SNAPSHOT_LIMITS.maxEntries} entries.`));
  }
  return entries.slice(0, BLOCK_MIGRATION_SNAPSHOT_LIMITS.maxEntries);
}

function normalizeUserSnapshotEntry(entry, index, errors) {
  const path = `entries[${index}]`;
  if (!isPlainRecord(entry)) {
    errors.push(snapshotError("entry-shape", path, `${path} must be a plain JSON object.`));
    return null;
  }
  const identifier = migrationIdentifier(entry);
  const base = migrationEntryFor(identifier);
  if (!identifier || !base) {
    errors.push(snapshotError("unknown-entry", `${path}.id`, `${path} must reference a known legacy migration id.`));
    return null;
  }
  if (entry.status !== undefined && entry.status !== base.status) {
    errors.push(snapshotError("status-mismatch", `${path}.status`, `${path}.status must match the fixed manifest status.`));
  }
  if (entry.blockType !== undefined && entry.blockType !== base.block?.blockType) {
    errors.push(snapshotError("block-type-mismatch", `${path}.blockType`, `${path}.blockType must match the fixed manifest block type.`));
  }
  if (entry.coordinate !== undefined) {
    const coordinateMatches = base.block?.coordinate
      ? sameCoordinate(entry.coordinate, base.block.coordinate)
      : entry.coordinate === null;
    if (!coordinateMatches) errors.push(snapshotError("coordinate-mismatch", `${path}.coordinate`, `${path}.coordinate must match the fixed manifest coordinate.`));
  }
  if (entry.targetId !== undefined && entry.targetId !== base.targetId) {
    errors.push(snapshotError("target-mismatch", `${path}.targetId`, `${path}.targetId must match the fixed manifest target.`));
  }
  const label = entry.label === undefined ? base.label : requireString(entry.label, `${path}.label`);
  return { base, sourceId: identifier, label };
}

/**
 * Validate a user-supplied legacy snapshot held in memory (or a JSON string).
 * Only known manifest identifiers are accepted; manifest status, block type,
 * and coordinates remain authoritative so a caller cannot invent a cube.
 * Accessors, cycles, forbidden executable fields, oversized input, and
 * malformed rows fail closed without invoking or retaining caller values.
 */
export function validateBlockMigrationSnapshot(input) {
  const parsed = parseUserSnapshot(input);
  const errors = [...parsed.errors];
  let copied = null;
  if (!errors.length) copied = copySnapshotJson(parsed.value, "", errors, new WeakSet(), { nodes: 0 });
  if (!errors.length && !isPlainRecord(copied)) errors.push(snapshotError("snapshot-shape", "$", "Snapshot must be a plain JSON object."));
  const snapshotId = isPlainRecord(copied) ? copied.snapshotId ?? copied.id : null;
  if (!errors.length && (typeof snapshotId !== "string" || !/^[A-Za-z0-9._:-]{1,96}$/.test(snapshotId))) {
    errors.push(snapshotError("snapshot-id", "snapshotId", "snapshotId must contain 1–96 safe identifier characters."));
  }
  const updatedAt = isPlainRecord(copied) ? copied.updatedAt : null;
  if (!errors.length && (typeof updatedAt !== "string" || !updatedAt.trim())) {
    errors.push(snapshotError("updated-at", "updatedAt", "updatedAt must be a non-empty string."));
  }
  if (!errors.length && copied.schemaVersion !== BLOCK_MIGRATION_SNAPSHOT_SCHEMA_VERSION) {
    errors.push(snapshotError("schema-version", "schemaVersion", `schemaVersion must be ${BLOCK_MIGRATION_SNAPSHOT_SCHEMA_VERSION}.`));
  }
  const normalized = [];
  const seen = new Set();
  if (!errors.length) {
    userSnapshotEntries(copied, errors).forEach((entry, index) => {
      const normalizedEntry = normalizeUserSnapshotEntry(entry, index, errors);
      if (!normalizedEntry) return;
      if (seen.has(normalizedEntry.base.id)) {
        errors.push(snapshotError("duplicate-entry", `entries[${index}]`, `Duplicate migration entry: ${normalizedEntry.base.id}.`));
        return;
      }
      seen.add(normalizedEntry.base.id);
      normalized.push(normalizedEntry);
    });
  }
  const snapshot = errors.length
    ? null
    : deepFreeze({
      schemaVersion: BLOCK_MIGRATION_SNAPSHOT_SCHEMA_VERSION,
      snapshotId,
      updatedAt,
      entries: normalized.map(({ base, sourceId, label }) => deepFreeze({
        id: base.id,
        legacyId: base.legacyId,
        sourceId,
        label,
        status: base.status,
        blockType: base.block?.blockType ?? null,
        coordinate: base.block?.coordinate ?? null,
      })),
    });
  return deepFreeze({
    source: BLOCK_MIGRATION_SNAPSHOT_SOURCE,
    schemaVersion: BLOCK_MIGRATION_SNAPSHOT_SCHEMA_VERSION,
    valid: errors.length === 0,
    snapshot,
    normalizedEntries: snapshot?.entries ?? [],
    errors,
    simulation: true,
    localOnly: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    boundary: BLOCK_MIGRATION_BOUNDARY,
  });
}

/** Build a mapped/deferred preview from a validated, user-supplied snapshot. */
export function previewBlockMigrationSnapshot(input) {
  const validation = validateBlockMigrationSnapshot(input);
  if (!validation.valid) return deepFreeze({
    source: BLOCK_MIGRATION_SNAPSHOT_PREVIEW_SOURCE,
    kind: "block-migration-user-preview",
    action: "preview-blocked",
    valid: false,
    validation,
    snapshot: null,
    rows: [],
    mappings: [],
    mappedRows: [],
    deferredRows: [],
    counts: { mapped: 0, preserved: 0, deferred: 0 },
    applyCount: 0,
    simulation: true,
    localOnly: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    boundary: BLOCK_MIGRATION_BOUNDARY,
  });
  const rows = validation.snapshot.entries.map((entry, index) => {
    const base = migrationEntryFor(entry.id);
    const patch = draftPatch(base, index + 1);
    return deepFreeze({
      id: `snapshot:${validation.snapshot.snapshotId}:${base.id}`,
      mappingId: base.id,
      legacyId: base.legacyId,
      sourceId: entry.sourceId,
      label: entry.label,
      targetId: base.targetId,
      targetKind: base.targetKind,
      status: base.status,
      mappingStatus: base.status,
      action: base.status === "deferred" ? "defer" : base.status === "mapped" ? "map" : "preserve",
      safeToApply: base.status !== "deferred",
      coordinate: base.block?.coordinate ?? null,
      block: base.block,
      sourceEntry: base,
      draftPatch: patch,
      simulation: true,
      localOnly: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
  });
  const counts = statusCounts(rows);
  const mappedRows = rows.filter((row) => row.status !== "deferred");
  const deferredRows = rows.filter((row) => row.status === "deferred");
  return deepFreeze({
    source: BLOCK_MIGRATION_SNAPSHOT_PREVIEW_SOURCE,
    kind: "block-migration-user-preview",
    action: "preview",
    valid: true,
    validation,
    snapshot: validation.snapshot,
    rows,
    mappings: rows,
    mappedRows,
    deferredRows,
    counts,
    mappedCount: mappedRows.length,
    preservedCount: rows.filter((row) => row.status === "preserved").length,
    deferredCount: deferredRows.length,
    applyCount: mappedRows.length,
    draftPatches: rows.map((row) => row.draftPatch).filter(Boolean),
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    boundary: BLOCK_MIGRATION_BOUNDARY,
  });
}

export const validateLegacyBlockMigrationSnapshot = validateBlockMigrationSnapshot;
export const previewLegacyBlockMigrationSnapshot = previewBlockMigrationSnapshot;

function manifestEntries(input) {
  if (input === undefined || input === null) return BLOCK_MIGRATION_MANIFEST.entries;
  if (Array.isArray(input)) return input;
  if (isRecord(input)) {
    if (Array.isArray(input.entries)) return input.entries;
    if (Array.isArray(input.mappings)) return input.mappings;
    if (isRecord(input.manifest)) return manifestEntries(input.manifest);
    if (isRecord(input.projection)) return manifestEntries(input.projection);
  }
  throw new TypeError("migration input must contain an entries or mappings array");
}

function normalizeEntry(entry, index) {
  if (!isRecord(entry)) throw new TypeError(`migration entry ${index} must be an object`);
  const base = BLOCK_MIGRATION_ENTRIES.find((candidate) => candidate.id === entry.id || candidate.legacyId === entry.legacyId);
  if (!base) throw new TypeError(`Unknown migration entry: ${String(entry.id ?? entry.legacyId)}`);
  // Copy only the manifest fields. Any function, module reference, command,
  // path, or other extra value supplied by a caller is intentionally ignored.
  return base;
}

function normalizeEntries(input) {
  const entries = manifestEntries(input).map(normalizeEntry);
  const seen = new Set();
  entries.forEach((entry) => {
    if (seen.has(entry.id)) throw new TypeError(`Duplicate migration entry: ${entry.id}`);
    seen.add(entry.id);
  });
  return entries;
}

function selectedEntries(entries, options = {}) {
  const requestedIds = Array.isArray(options.includeIds)
    ? new Set(options.includeIds.map((id) => String(id)))
    : null;
  const requestedStatuses = Array.isArray(options.statuses)
    ? new Set(options.statuses.map((status) => requireStatus(status, "options.statuses")))
    : null;
  return entries.filter((entry) => (
    (!requestedIds || requestedIds.has(entry.id) || requestedIds.has(entry.legacyId))
    && (!requestedStatuses || requestedStatuses.has(entry.status))
  ));
}

function draftPatch(entry, ordinal) {
  if (entry.status === "deferred" || !entry.block) return null;
  return deepFreeze({
    id: `migration-block:${entry.legacyId}`,
    ordinal,
    action: entry.status === "mapped" ? "map" : "preserve",
    sourceId: entry.legacyId,
    targetId: entry.targetId,
    targetKind: entry.targetKind,
    blockType: entry.block.blockType,
    coordinate: entry.block.coordinate,
    localOnly: true,
    simulation: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  });
}

function previewFromEntries(entries) {
  const mappings = entries.map((entry, index) => deepFreeze({
    id: `preview:${entry.id}`,
    mappingId: entry.id,
    legacyId: entry.legacyId,
    label: entry.label,
    targetId: entry.targetId,
    targetKind: entry.targetKind,
    status: entry.status,
    mappingStatus: entry.status,
    action: entry.status === "deferred" ? "defer" : entry.status === "mapped" ? "map" : "preserve",
    safeToApply: entry.status !== "deferred",
    sourceEntry: entry,
    draftPatch: draftPatch(entry, index + 1),
    simulation: true,
    localOnly: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  }));
  const counts = statusCounts(entries);
  const draftPatches = mappings.filter((mapping) => mapping.draftPatch).map((mapping) => mapping.draftPatch);
  return deepFreeze({
    schemaVersion: BLOCK_MIGRATION_SCHEMA_VERSION,
    source: BLOCK_MIGRATION_PREVIEW_SOURCE,
    id: `${BLOCK_MIGRATION_MANIFEST_ID}:preview`,
    kind: "block-migration-preview",
    manifestId: BLOCK_MIGRATION_MANIFEST_ID,
    project: "arena-living-reality",
    mappings,
    entries: mappings,
    rows: mappings,
    draftPatches: Object.freeze(draftPatches),
    counts,
    statusCounts: counts,
    mappedCount: counts.mapped,
    preservedCount: counts.preserved,
    deferredCount: counts.deferred,
    applyCount: draftPatches.length,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    boundary: BLOCK_MIGRATION_BOUNDARY,
  });
}

/**
 * Create an immutable preview from the fixed manifest. Callers may pass the
 * manifest, its entries, or includeIds/statuses options. Unknown fields are
 * ignored; no supplied callback, module, path, or command is ever executed.
 */
export function previewBlockMigration(input = BLOCK_MIGRATION_MANIFEST, options = {}) {
  // Also accept previewBlockMigration({ includeIds, statuses }) as a friendly
  // options-only form while retaining the manifest as the source of truth.
  let manifestInput = input;
  let selection = options;
  if (isRecord(input) && !Array.isArray(input.entries) && !Array.isArray(input.mappings)
    && !isRecord(input.manifest) && !isRecord(input.projection)
    && ("includeIds" in input || "statuses" in input)) {
    manifestInput = BLOCK_MIGRATION_MANIFEST;
    selection = input;
  }
  const entries = selectedEntries(normalizeEntries(manifestInput), selection);
  return previewFromEntries(entries);
}

export const createBlockMigrationPreview = previewBlockMigration;
export const previewMigration = previewBlockMigration;

function previewInput(input, options) {
  if (isRecord(input) && input.source === BLOCK_MIGRATION_PREVIEW_SOURCE && Array.isArray(input.mappings)) {
    return input;
  }
  return previewBlockMigration(input, options);
}

/**
 * Apply the safe rows in a preview to a new in-memory local draft. The base
 * input is never mutated and deferred rows are never converted into edits.
 */
export function applyBlockMigrationToLocalDraft(input = BLOCK_MIGRATION_MANIFEST, options = {}) {
  const preview = previewInput(input, options);
  const requestedIds = Array.isArray(options.includeIds)
    ? new Set(options.includeIds.map((id) => String(id)))
    : null;
  const requestedStatuses = Array.isArray(options.statuses)
    ? new Set(options.statuses.map((status) => requireStatus(status, "options.statuses")))
    : null;
  const mappings = preview.mappings.filter((mapping) => (
    mapping.safeToApply
    && (!requestedIds || requestedIds.has(mapping.mappingId) || requestedIds.has(mapping.legacyId))
    && (!requestedStatuses || requestedStatuses.has(mapping.status))
  ));
  const deferred = preview.mappings.filter((mapping) => !mapping.safeToApply);
  const previousDraft = isRecord(options.localDraft) ? options.localDraft : null;
  const revision = safeInteger(previousDraft?.revision, 0) + 1;
  const draft = deepFreeze({
    id: `${BLOCK_MIGRATION_DRAFT_SOURCE}:${preview.manifestId}`,
    source: BLOCK_MIGRATION_DRAFT_SOURCE,
    kind: "semantic-block-migration-draft",
    manifestId: preview.manifestId,
    revision,
    status: "local-only",
    mappingIds: Object.freeze(mappings.map((mapping) => mapping.mappingId)),
    deferredMappingIds: Object.freeze(deferred.map((mapping) => mapping.mappingId)),
    blockEdits: Object.freeze(mappings.map((mapping) => mapping.draftPatch).filter(Boolean)),
    localDraft: true,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    boundary: BLOCK_MIGRATION_BOUNDARY,
  });
  return deepFreeze({
    schemaVersion: BLOCK_MIGRATION_SCHEMA_VERSION,
    source: BLOCK_MIGRATION_DRAFT_SOURCE,
    kind: "block-migration-apply",
    action: "apply-local-draft",
    manifestId: preview.manifestId,
    preview,
    mappings: preview.mappings,
    draft,
    localDraft: draft,
    appliedMappingIds: draft.mappingIds,
    deferredMappingIds: draft.deferredMappingIds,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    boundary: BLOCK_MIGRATION_BOUNDARY,
  });
}

export const applyMigrationToLocalDraft = applyBlockMigrationToLocalDraft;
export const createBlockMigrationDraft = applyBlockMigrationToLocalDraft;

export function resetBlockMigrationDraft(input = BLOCK_MIGRATION_MANIFEST) {
  const preview = previewInput(input);
  const empty = deepFreeze({
    id: `${BLOCK_MIGRATION_DRAFT_SOURCE}:${preview.manifestId}`,
    source: BLOCK_MIGRATION_DRAFT_SOURCE,
    kind: "semantic-block-migration-draft",
    manifestId: preview.manifestId,
    revision: 0,
    status: "reset",
    mappingIds: Object.freeze([]),
    deferredMappingIds: Object.freeze(preview.mappings.map((mapping) => mapping.mappingId)),
    blockEdits: Object.freeze([]),
    localDraft: true,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    boundary: BLOCK_MIGRATION_BOUNDARY,
  });
  return deepFreeze({
    schemaVersion: BLOCK_MIGRATION_SCHEMA_VERSION,
    source: BLOCK_MIGRATION_DRAFT_SOURCE,
    kind: "block-migration-reset",
    action: "reset-local-draft",
    manifestId: preview.manifestId,
    draft: empty,
    localDraft: empty,
    appliedMappingIds: empty.mappingIds,
    deferredMappingIds: empty.deferredMappingIds,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    boundary: BLOCK_MIGRATION_BOUNDARY,
  });
}

export const resetMigrationDraft = resetBlockMigrationDraft;

export default BLOCK_MIGRATION_MANIFEST;
