import {
  BLOCK_TYPES,
  BLOCK_WORLD_ID,
  BLOCK_WORLD_MAX_HEIGHT,
  BLOCK_WORLD_SCHEMA_VERSION,
  BLOCK_WORLD_SOURCE,
  BLOCK_WORLD_UPDATED_AT,
  DEFAULT_BLOCK_WORLD,
  createBlockWorldContribution,
} from "./block-world.js?v=20260922-cache2";

export const BLOCK_WORLD_SNAPSHOT_SCHEMA_VERSION = 1;
export const BLOCK_WORLD_SNAPSHOT_SOURCE = "block-world-snapshot";
export const BLOCK_WORLD_SNAPSHOT_KIND = "block-world-snapshot";
export const BLOCK_WORLD_SNAPSHOT_MAX_TEXT_LENGTH = 200_000;
export const BLOCK_WORLD_SNAPSHOT_MAX_BLOCKS = 512;
export const BLOCK_WORLD_SNAPSHOT_MAX_CONTENTS = 1_024;
export const BLOCK_WORLD_SNAPSHOT_MAX_DIMENSION = 64;
export const BLOCK_WORLD_SNAPSHOT_MAX_STRING_LENGTH = 512;
export const BLOCK_WORLD_SNAPSHOT_MAX_CONTENT_OFFSET = 16;

export const BLOCK_WORLD_SNAPSHOT_BOUNDARY =
  "Block snapshots are data-only local drafts. One user-selected bounded .json file may be read in memory only; arbitrary filesystem paths, imported code, network contact, persistence, wallet access, asset movement, and external-world publishing remain unavailable.";

export const BLOCK_WORLD_SNAPSHOT_CAPABILITIES = Object.freeze([
  Object.freeze({
    id: "block-world.snapshot-export",
    label: "Export a deterministic Block World JSON snapshot",
    enabled: true,
    mode: "local-json",
    authority: "none",
    simulationOnly: true,
    executable: false,
  }),
  Object.freeze({
    id: "block-world.snapshot-import",
    label: "Validate and apply pasted or user-selected local Block World JSON",
    enabled: true,
    mode: "local-draft",
    authority: "none",
    simulationOnly: true,
    executable: false,
  }),
  Object.freeze({
    id: "block-world.snapshot-external-import",
    label: "Read an arbitrary file or project package",
    enabled: false,
    mode: "denied",
    authority: "none",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "The snapshot surface never opens arbitrary files or packages; its one explicit JSON chooser is read in memory only.",
  }),
  Object.freeze({
    id: "block-world.snapshot-persistence",
    label: "Persist or synchronize a migrated world",
    enabled: false,
    mode: "denied",
    authority: "none",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "Imported snapshots live only in the current page session.",
  }),
]);

const freeze = (value) => Object.freeze(value);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const BLOCK_TYPE_SET = new Set(Object.keys(BLOCK_TYPES));
const EXECUTABLE_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "function",
  "module",
  "command",
  "script",
  "eval",
  "execute",
  "code",
  "path",
  "file",
  "url",
]);
const BOUNDARY_FIELDS = Object.freeze([
  "simulation",
  "localOnly",
  "externalImport",
  "importedCodeExecution",
  "persistence",
  "externalNetwork",
  "externalTransfer",
  "executable",
]);

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  if (Array.isArray(value)) value.forEach((entry) => deepFreeze(entry, seen));
  else Object.values(value).forEach((entry) => deepFreeze(entry, seen));
  return freeze(value);
}

function errorRecord(code, path, message) {
  return freeze({ code, path, message });
}

function warningRecord(code, path, message) {
  return freeze({ code, path, message });
}

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function boundedString(value, path, errors, fallback = "") {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string" || value.trim() === "") {
    errors.push(errorRecord("string-required", path, `${path} must be a non-empty string.`));
    return fallback;
  }
  if (value.length > BLOCK_WORLD_SNAPSHOT_MAX_STRING_LENGTH) {
    errors.push(errorRecord("string-too-large", path, `${path} exceeds ${BLOCK_WORLD_SNAPSHOT_MAX_STRING_LENGTH} characters.`));
  }
  return value.trim();
}

function integer(value, path, errors, { minimum = 0, maximum = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    errors.push(errorRecord("integer-range", path, `${path} must be an integer between ${minimum} and ${maximum}.`));
    return minimum;
  }
  return value;
}

function copyJsonValue(value, path, seen, errors) {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    if (typeof value === "string" && value.length > BLOCK_WORLD_SNAPSHOT_MAX_STRING_LENGTH) {
      errors.push(errorRecord("string-too-large", path, `${path} exceeds ${BLOCK_WORLD_SNAPSHOT_MAX_STRING_LENGTH} characters.`));
    }
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) errors.push(errorRecord("non-finite-number", path, `${path} must be a finite JSON number.`));
    return Number.isFinite(value) ? value : null;
  }
  if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    errors.push(errorRecord("non-json-value", path, `${path} must contain plain JSON data.`));
    return null;
  }
  if (seen.has(value)) {
    errors.push(errorRecord("cyclic-value", path, `${path} contains a cyclic or shared object reference.`));
    return null;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const copy = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || descriptor.get || descriptor.set) {
        errors.push(errorRecord("getter-backed-value", `${path}[${index}]`, `${path}[${index}] must be a data property.`));
        copy.push(null);
      } else {
        copy.push(copyJsonValue(descriptor.value, `${path}[${index}]`, seen, errors));
      }
    }
    Reflect.ownKeys(value).forEach((key) => {
      if (key === "length" || (typeof key === "string" && /^(0|[1-9][0-9]*)$/.test(key))) return;
      errors.push(errorRecord("unexpected-array-field", `${path}.${String(key)}`, `${path} may contain indexed JSON values only.`));
    });
    return copy;
  }
  if (!isRecord(value)) {
    errors.push(errorRecord("non-json-object", path, `${path} must be a plain JSON object.`));
    return null;
  }
  const copy = {};
  Reflect.ownKeys(value).forEach((key) => {
    if (typeof key !== "string") {
      errors.push(errorRecord("symbol-key", path, `${path} must not contain symbol keys.`));
      return;
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    const childPath = path === "$" ? `$.${key}` : `${path}.${key}`;
    if (!descriptor || descriptor.get || descriptor.set) {
      errors.push(errorRecord("getter-backed-value", childPath, `${childPath} must be a data property.`));
      return;
    }
    if (EXECUTABLE_KEYS.has(key)) {
      errors.push(errorRecord("executable-field", childPath, `${childPath} is not accepted in a data-only snapshot.`));
      return;
    }
    const child = copyJsonValue(descriptor.value, childPath, seen, errors);
    copy[key] = child;
    if (key === "executable" && child !== false) {
      errors.push(errorRecord("executable-field", childPath, `${childPath} must be false.`));
    }
  });
  return copy;
}

function parseInput(input, errors) {
  if (typeof input === "string") {
    if (input.length > BLOCK_WORLD_SNAPSHOT_MAX_TEXT_LENGTH) {
      errors.push(errorRecord("snapshot-too-large", "$", `Snapshot JSON exceeds ${BLOCK_WORLD_SNAPSHOT_MAX_TEXT_LENGTH} characters.`));
      return null;
    }
    if (!input.trim()) {
      errors.push(errorRecord("empty-snapshot", "$", "Snapshot JSON is empty."));
      return null;
    }
    try {
      return JSON.parse(input);
    } catch (error) {
      errors.push(errorRecord("invalid-json", "$", `Snapshot JSON could not be parsed: ${error?.message ?? "syntax error"}.`));
      return null;
    }
  }
  if (!input || typeof input !== "object") {
    errors.push(errorRecord("snapshot-type", "$", "Snapshot must be a JSON string or plain object."));
    return null;
  }
  return input;
}

function flagErrors(record, errors) {
  BOUNDARY_FIELDS.forEach((field) => {
    if (!hasOwn(record, field)) return;
    const expected = ["simulation", "localOnly"].includes(field) ? true : false;
    if (record[field] !== expected) {
      errors.push(errorRecord("boundary-violation", `$.${field}`, `$.${field} must be ${String(expected)} for a local snapshot.`));
    }
  });
}

function normalizeContents(rawContents, blockType, path, errors, contentCountRef) {
  if (!Array.isArray(rawContents)) {
    errors.push(errorRecord("contents-shape", path, `${path} must be an array.`));
    return [];
  }
  if (rawContents.length > BLOCK_WORLD_SNAPSHOT_MAX_CONTENTS) {
    errors.push(errorRecord("contents-too-large", path, `${path} exceeds ${BLOCK_WORLD_SNAPSHOT_MAX_CONTENTS} nested items.`));
  }
  const contents = rawContents.slice(0, BLOCK_WORLD_SNAPSHOT_MAX_CONTENTS).map((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      errors.push(errorRecord("content-shape", entryPath, `${entryPath} must be an object.`));
      return { contentType: "invalid-content", label: "Invalid content", blockType, offset: [0, 1, 0] };
    }
    const contentType = boundedString(entry.contentType ?? entry.type, `${entryPath}.contentType`, errors, "block-content");
    const label = boundedString(entry.label ?? contentType, `${entryPath}.label`, errors, contentType);
    const nestedType = entry.blockType ?? blockType;
    if (!BLOCK_TYPE_SET.has(nestedType)) {
      errors.push(errorRecord("unknown-block-type", `${entryPath}.blockType`, `${entryPath}.blockType is not a known block type.`));
    }
    const rawOffset = entry.offset ?? [0, 1 + index, 0];
    if (!Array.isArray(rawOffset) || rawOffset.length !== 3 || !rawOffset.every(Number.isSafeInteger)) {
      errors.push(errorRecord("offset-shape", `${entryPath}.offset`, `${entryPath}.offset must be an integer [x, y, z] offset.`));
    }
    const offset = Array.isArray(rawOffset) && rawOffset.length === 3 && rawOffset.every(Number.isSafeInteger)
      ? rawOffset.map((value, axis) => integer(value, `${entryPath}.offset[${axis}]`, errors, { minimum: -BLOCK_WORLD_SNAPSHOT_MAX_CONTENT_OFFSET, maximum: BLOCK_WORLD_SNAPSHOT_MAX_CONTENT_OFFSET }))
      : [0, 1, 0];
    contentCountRef.count += 1;
    return { contentType, label, blockType: BLOCK_TYPE_SET.has(nestedType) ? nestedType : blockType, offset };
  });
  return contents;
}

function normalizeSnapshotRecord(record, errors, warnings) {
  if (!isRecord(record)) {
    errors.push(errorRecord("snapshot-shape", "$", "Snapshot must be a plain JSON object."));
    return null;
  }
  if (record.schemaVersion !== undefined && record.schemaVersion !== BLOCK_WORLD_SNAPSHOT_SCHEMA_VERSION) {
    errors.push(errorRecord("schema-version", "$.schemaVersion", `Only snapshot schema ${BLOCK_WORLD_SNAPSHOT_SCHEMA_VERSION} is supported.`));
  }
  if (record.source !== undefined && ![BLOCK_WORLD_SNAPSHOT_SOURCE, BLOCK_WORLD_SOURCE].includes(record.source)) {
    errors.push(errorRecord("source", "$.source", "Snapshot source must be block-world-snapshot or semantic-block-fabric."));
  }
  if (record.kind !== undefined && record.kind !== BLOCK_WORLD_SNAPSHOT_KIND && record.kind !== "semantic-block-world-projection") {
    errors.push(errorRecord("kind", "$.kind", "Snapshot kind is not a supported Block World envelope."));
  }
  flagErrors(record, errors);

  const worldId = boundedString(record.worldId, "$.worldId", errors, BLOCK_WORLD_ID);
  const updatedAt = boundedString(record.updatedAt, "$.updatedAt", errors, BLOCK_WORLD_UPDATED_AT);
  const dimensions = isRecord(record.dimensions) ? record.dimensions : null;
  if (!dimensions) errors.push(errorRecord("dimensions-shape", "$.dimensions", "Snapshot dimensions must be an object."));
  const width = integer(dimensions?.width, "$.dimensions.width", errors, { minimum: 1, maximum: BLOCK_WORLD_SNAPSHOT_MAX_DIMENSION });
  const depth = integer(dimensions?.depth, "$.dimensions.depth", errors, { minimum: 1, maximum: BLOCK_WORLD_SNAPSHOT_MAX_DIMENSION });
  const height = integer(dimensions?.height ?? BLOCK_WORLD_MAX_HEIGHT, "$.dimensions.height", errors, { minimum: 1, maximum: BLOCK_WORLD_MAX_HEIGHT });
  const rawBlocks = Array.isArray(record.blocks) ? record.blocks : record.entities;
  if (!Array.isArray(rawBlocks)) errors.push(errorRecord("blocks-shape", "$.blocks", "Snapshot blocks must be an array."));
  const sourceBlocks = Array.isArray(rawBlocks) ? rawBlocks : [];
  if (sourceBlocks.length > BLOCK_WORLD_SNAPSHOT_MAX_BLOCKS) {
    errors.push(errorRecord("blocks-too-large", "$.blocks", `Snapshot exceeds ${BLOCK_WORLD_SNAPSHOT_MAX_BLOCKS} blocks.`));
  }
  const seenCoordinates = new Set();
  const contentCountRef = { count: 0 };
  const blocks = sourceBlocks.slice(0, BLOCK_WORLD_SNAPSHOT_MAX_BLOCKS).map((entry, index) => {
    const path = `$.blocks[${index}]`;
    if (!isRecord(entry)) {
      errors.push(errorRecord("block-shape", path, `${path} must be an object.`));
      return { x: 0, y: 0, z: index % Math.max(depth, 1), blockType: "stone", container: false, open: false, contents: [] };
    }
    const x = integer(entry.x, `${path}.x`, errors, { minimum: 0, maximum: width - 1 });
    const y = integer(entry.y, `${path}.y`, errors, { minimum: 0, maximum: Math.min(height, BLOCK_WORLD_MAX_HEIGHT) - 1 });
    const z = integer(entry.z, `${path}.z`, errors, { minimum: 0, maximum: depth - 1 });
    const coordinateKey = `${x}:${y}:${z}`;
    if (seenCoordinates.has(coordinateKey)) errors.push(errorRecord("duplicate-coordinate", path, `${path} duplicates block coordinate ${coordinateKey}.`));
    seenCoordinates.add(coordinateKey);
    const blockType = entry.blockType ?? entry.type;
    if (!BLOCK_TYPE_SET.has(blockType)) errors.push(errorRecord("unknown-block-type", `${path}.blockType`, `${path}.blockType is not a known block type.`));
    const safeBlockType = BLOCK_TYPE_SET.has(blockType) ? blockType : "stone";
    const contentCountBefore = contentCountRef.count;
    const contents = normalizeContents(entry.contents ?? [], safeBlockType, `${path}.contents`, errors, contentCountRef);
    const container = entry.container === undefined ? contents.length > 0 : entry.container === true;
    if (!container && contents.length > 0) errors.push(errorRecord("container-required", `${path}.container`, `${path} must be a container when nested contents are present.`));
    const open = entry.open === true;
    if (open && (!container || contents.length === 0)) errors.push(errorRecord("open-state", `${path}.open`, `${path}.open requires a container with nested contents.`));
    if (Number.isInteger(entry.contentCount) && entry.contentCount !== contents.length) {
      errors.push(errorRecord("content-count", `${path}.contentCount`, `${path}.contentCount must match the nested contents array.`));
    }
    if (contentCountRef.count - contentCountBefore > BLOCK_WORLD_SNAPSHOT_MAX_CONTENTS) {
      warnings.push(warningRecord("contents-limit", `${path}.contents`, "Nested content was truncated to the supported limit."));
    }
    return {
      x,
      y,
      z,
      blockType: safeBlockType,
      container,
      open: open && container && contents.length > 0,
      contents,
    };
  });
  if (contentCountRef.count > BLOCK_WORLD_SNAPSHOT_MAX_CONTENTS) {
    errors.push(errorRecord("nested-items-too-large", "$.blocks", `Snapshot exceeds ${BLOCK_WORLD_SNAPSHOT_MAX_CONTENTS} nested items.`));
  }
  const safeBlocks = blocks.sort((a, b) => `${a.x}:${a.y}:${a.z}`.localeCompare(`${b.x}:${b.y}:${b.z}`));
  const snapshot = {
    schemaVersion: BLOCK_WORLD_SNAPSHOT_SCHEMA_VERSION,
    source: BLOCK_WORLD_SNAPSHOT_SOURCE,
    kind: BLOCK_WORLD_SNAPSHOT_KIND,
    worldId,
    updatedAt,
    dimensions: { width, depth, height },
    blocks: safeBlocks,
    blockCount: safeBlocks.length,
    contentCount: contentCountRef.count,
    localDraft: record.localDraft === true,
    simulation: true,
    localOnly: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    capabilities: BLOCK_WORLD_SNAPSHOT_CAPABILITIES,
    boundary: BLOCK_WORLD_SNAPSHOT_BOUNDARY,
    provenance: {
      source: BLOCK_WORLD_SNAPSHOT_SOURCE,
      version: BLOCK_WORLD_SNAPSHOT_SCHEMA_VERSION,
      basis: "deterministic Block World data-only snapshot",
      sourceSchemaVersion: BLOCK_WORLD_SCHEMA_VERSION,
      deterministicKey: `${BLOCK_WORLD_SNAPSHOT_SOURCE}:${worldId}:${width}x${depth}x${height}`,
    },
  };
  return deepFreeze(snapshot);
}

function blockProjectionFrom(input) {
  if (!input || typeof input !== "object") return DEFAULT_BLOCK_WORLD;
  if (input.source === BLOCK_WORLD_SOURCE && Array.isArray(input.blocks)) return input;
  const contribution = Array.isArray(input.contributions)
    ? input.contributions.find((candidate) => candidate?.source === BLOCK_WORLD_SOURCE && Array.isArray(candidate.blocks))
    : null;
  return contribution ?? input;
}

/** Create a safe, deterministic snapshot from a Block World projection. */
export function createBlockWorldSnapshot(projection = DEFAULT_BLOCK_WORLD) {
  const source = blockProjectionFrom(projection);
  const validation = validateBlockWorldSnapshot({
    schemaVersion: BLOCK_WORLD_SNAPSHOT_SCHEMA_VERSION,
    source: BLOCK_WORLD_SOURCE,
    kind: "semantic-block-world-projection",
    worldId: source.worldId ?? BLOCK_WORLD_ID,
    updatedAt: source.updatedAt ?? BLOCK_WORLD_UPDATED_AT,
    dimensions: source.dimensions ?? { width: 9, depth: 9, height: BLOCK_WORLD_MAX_HEIGHT },
    blocks: source.blocks ?? source.entities ?? [],
    localDraft: source.localDraft === true,
    simulation: true,
    localOnly: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  });
  if (!validation.valid) throw new TypeError(`Cannot snapshot Block World: ${validation.errors[0]?.message ?? "invalid projection"}`);
  return validation.snapshot;
}

export function serializeBlockWorldSnapshot(input = DEFAULT_BLOCK_WORLD_SNAPSHOT) {
  const snapshot = input?.kind === BLOCK_WORLD_SNAPSHOT_KIND
    ? validateBlockWorldSnapshot(input)
    : { valid: true, snapshot: createBlockWorldSnapshot(input) };
  if (!snapshot.valid || !snapshot.snapshot) throw new TypeError(`Cannot serialize Block World snapshot: ${snapshot.errors?.[0]?.message ?? "invalid snapshot"}`);
  return JSON.stringify(snapshot.snapshot, null, 2);
}

/** Validate a JSON string or plain data object without invoking accessors. */
export function validateBlockWorldSnapshot(input = DEFAULT_BLOCK_WORLD_SNAPSHOT) {
  const errors = [];
  const warnings = [];
  const parsed = parseInput(input, errors);
  let copied = null;
  if (parsed !== null) copied = copyJsonValue(parsed, "$", new WeakSet(), errors);
  const snapshot = errors.length === 0 ? normalizeSnapshotRecord(copied, errors, warnings) : null;
  return deepFreeze({
    valid: errors.length === 0 && Boolean(snapshot),
    snapshot: errors.length === 0 ? snapshot : null,
    errors,
    warnings,
    blockCount: snapshot?.blockCount ?? 0,
    contentCount: snapshot?.contentCount ?? 0,
    dimensions: snapshot?.dimensions ?? null,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    boundary: BLOCK_WORLD_SNAPSHOT_BOUNDARY,
  });
}

export const parseBlockWorldSnapshot = validateBlockWorldSnapshot;

/** Apply a validated snapshot to a new immutable renderer-only draft. */
export function applyBlockWorldSnapshot(base = DEFAULT_BLOCK_WORLD, input = DEFAULT_BLOCK_WORLD_SNAPSHOT) {
  const validation = validateBlockWorldSnapshot(input);
  if (!validation.valid) throw new TypeError(`Cannot apply Block World snapshot: ${validation.errors[0]?.message ?? "invalid snapshot"}`);
  const current = base && typeof base === "object" && Array.isArray(base.blocks) ? base : DEFAULT_BLOCK_WORLD;
  const snapshot = validation.snapshot;
  const next = createBlockWorldContribution({
    updatedAt: current.updatedAt ?? snapshot.updatedAt,
    worldId: current.worldId ?? snapshot.worldId,
    width: snapshot.dimensions.width,
    depth: snapshot.dimensions.depth,
    blocks: snapshot.blocks,
  });
  return deepFreeze({
    ...next,
    localDraft: true,
    fictional: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    editCount: (Number.isInteger(current.editCount) ? current.editCount : 0) + 1,
    lastEdit: {
      action: "import-snapshot",
      source: BLOCK_WORLD_SNAPSHOT_SOURCE,
      snapshotWorldId: snapshot.worldId,
      blockCount: snapshot.blockCount,
      contentCount: snapshot.contentCount,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    },
    snapshotBoundary: BLOCK_WORLD_SNAPSHOT_BOUNDARY,
  });
}

export const importBlockWorldSnapshot = applyBlockWorldSnapshot;
export const createBlockWorldSnapshotDraft = applyBlockWorldSnapshot;

export const DEFAULT_BLOCK_WORLD_SNAPSHOT = createBlockWorldSnapshot(DEFAULT_BLOCK_WORLD);

export default DEFAULT_BLOCK_WORLD_SNAPSHOT;
