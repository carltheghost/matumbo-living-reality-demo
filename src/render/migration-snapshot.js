/**
 * Safe user-supplied snapshot adapter for the block migration bridge.
 *
 * A snapshot is deliberately a small JSON fixture containing known migration
 * entry ids. It is parsed and validated in memory, then handed to the domain
 * migration helpers for a preview/local draft. A user-selected JSON file may
 * be read as text in memory, but this module never exposes a path, imports a
 * package, evaluates code, contacts a provider, or mutates the canonical
 * projection.
 */
import {
  BLOCK_MIGRATION_BOUNDARY,
  BLOCK_MIGRATION_ENTRIES,
  BLOCK_MIGRATION_MANIFEST,
  BLOCK_MIGRATION_PREVIEW_SOURCE,
  BLOCK_MIGRATION_SOURCE,
  applyBlockMigrationToLocalDraft,
  previewBlockMigration,
  resetBlockMigrationDraft,
} from "../domains/block-migration.js";
import {
  DEFAULT_MERGE4_SNAPSHOT,
  MERGE4_SNAPSHOT_ADAPTER_SOURCE,
  adaptMerge4Snapshot,
  serializeMerge4Snapshot,
} from "../domains/merge4-snapshot-adapter.js";

export const MIGRATION_SNAPSHOT_CONSOLE_SOURCE = "block-migration-snapshot-console";
export const MIGRATION_SNAPSHOT_RENDER_SOURCE = MIGRATION_SNAPSHOT_CONSOLE_SOURCE;
export const MIGRATION_SNAPSHOT_SCHEMA_VERSION = 1;
export const MIGRATION_SNAPSHOT_BOUNDARY =
  `${BLOCK_MIGRATION_BOUNDARY} One explicit user-selected bounded .json file may be read in memory only; arbitrary filesystem paths, packages, uploads, and imported code remain unavailable. User snapshots are JSON fixtures only; executable fields are rejected.`;
export const MIGRATION_SNAPSHOT_FILE_ACCEPT = ".json,application/json";
export const MIGRATION_SNAPSHOT_MAX_FILE_BYTES = 256_000;

/** Stable mount ids for the host page. */
export const MIGRATION_SNAPSHOT_DOM_IDS = Object.freeze({
  panel: "migration-snapshot-console",
  close: "migration-snapshot-close",
  input: "migration-snapshot-input",
  load: "migration-snapshot-load",
  preview: "migration-snapshot-preview",
  apply: "migration-snapshot-apply",
  replay: "migration-snapshot-replay",
  reset: "migration-snapshot-reset",
  status: "migration-snapshot-status",
  fileInput: "migration-snapshot-file",
  mappingCount: "migration-snapshot-mapping-count",
  safeCount: "migration-snapshot-safe-count",
  draftCount: "migration-snapshot-draft-count",
  selection: "migration-snapshot-selection",
  validation: "migration-snapshot-validation",
  list: "migration-snapshot-list",
  trace: "migration-snapshot-trace",
  boundary: "migration-snapshot-boundary",
  merge4Review: "migration-snapshot-merge4-review",
  merge4Status: "migration-snapshot-merge4-status",
  merge4Summary: "migration-snapshot-merge4-summary",
  merge4Records: "migration-snapshot-merge4-records",
});

const integerFormatter = new Intl.NumberFormat("en-US");
const MAX_SNAPSHOT_ENTRIES = 64;
const MAX_SNAPSHOT_TEXT_LENGTH = MIGRATION_SNAPSHOT_MAX_FILE_BYTES;
const FORBIDDEN_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "run",
  "execute",
  "eval",
  "code",
  "script",
  "module",
  "import",
  "command",
]);
const KNOWN_ENTRIES = Object.freeze(BLOCK_MIGRATION_ENTRIES.map((entry) => ({
  id: entry.id,
  legacyId: entry.legacyId,
})));
const KNOWN_ID_SET = new Set(KNOWN_ENTRIES.flatMap((entry) => [entry.id, entry.legacyId]));

const freeze = (value) => Object.freeze(value);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach((entry) => deepFreeze(entry));
    return freeze(value);
  }
  if (!isRecord(value)) return value;
  Object.values(value).forEach((entry) => deepFreeze(entry));
  return freeze(value);
}

function text(value, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function fileInfo(file) {
  const name = typeof file?.name === "string" ? file.name.replace(/^.*[\\/]/, "") : "";
  const mime = typeof file?.type === "string" ? file.type.split(";", 1)[0].trim().toLowerCase() : "";
  const size = Number.isFinite(file?.size) && file.size >= 0 ? file.size : null;
  const extensionAccepted = /\.json$/i.test(name);
  const mimeAccepted = mime === "application/json";
  return Object.freeze({
    accepted: extensionAccepted || mimeAccepted,
    extensionAccepted,
    mimeAccepted,
    mime: mime || null,
    size,
  });
}

function fileValidationError(message, code = "file-rejected") {
  return deepFreeze({
    source: MIGRATION_SNAPSHOT_CONSOLE_SOURCE,
    schemaVersion: MIGRATION_SNAPSHOT_SCHEMA_VERSION,
    valid: false,
    snapshot: null,
    preview: null,
    errors: [errorRecord(code, "$file", message)],
    warnings: [],
    inputType: "local-json-file",
    mappingCount: 0,
    safeCount: 0,
    deferredCount: 0,
    localOnly: true,
    simulation: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    boundary: MIGRATION_SNAPSHOT_BOUNDARY,
  });
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function formatCount(value) {
  return Number.isSafeInteger(value) ? integerFormatter.format(value) : "0";
}

function errorRecord(code, path, message) {
  return {
    code,
    path,
    message,
  };
}

function warningRecord(code, path, message) {
  return {
    code,
    path,
    message,
  };
}

function defaultFixture() {
  return {
    source: "block-migration-snapshot",
    schemaVersion: MIGRATION_SNAPSHOT_SCHEMA_VERSION,
    entries: BLOCK_MIGRATION_ENTRIES.map(({ id }) => ({ id })),
  };
}

export const DEFAULT_MIGRATION_SNAPSHOT = createMigrationSnapshotFixture();

/**
 * Return a compact fixture suitable for a textarea or a shareable local
 * preview.  It intentionally includes ids only; canonical labels, targets,
 * and block coordinates remain owned by the migration domain.
 */
export function createMigrationSnapshotFixture(entries = BLOCK_MIGRATION_ENTRIES) {
  const selected = asArray(entries).map((entry) => ({ id: entry?.id ?? entry?.legacyId }));
  return deepFreeze({
    source: "block-migration-snapshot",
    schemaVersion: MIGRATION_SNAPSHOT_SCHEMA_VERSION,
    entries: selected,
  });
}

export function serializeMigrationSnapshot(snapshot = defaultFixture()) {
  return JSON.stringify(snapshot, null, 2);
}

/**
 * Copy a user value while proving it is JSON-like.  Functions, symbols,
 * class instances, cyclic objects, and executable-looking keys are rejected;
 * none of them are invoked or evaluated.
 */
function copyJsonValue(value, path, errors, seen, warnings) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) errors.push(errorRecord("non-finite-number", path, `${path} must be a finite JSON number.`));
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
    errors.push(errorRecord("non-json-value", path, `${path} contains a value that is not valid JSON data.`));
    return null;
  }
  if (!Array.isArray(value) && !isRecord(value)) {
    errors.push(errorRecord("non-json-object", path, `${path} must contain plain JSON data.`));
    return null;
  }
  if (seen.has(value)) {
    errors.push(errorRecord("cyclic-value", path, `${path} contains a cyclic reference.`));
    return null;
  }
  seen.add(value);
  let copy;
  if (Array.isArray(value)) {
    copy = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !("value" in descriptor)) {
        errors.push(errorRecord("non-json-value", `${path}[${index}]`, `${path}[${index}] must be plain JSON data.`));
        copy.push(null);
      } else {
        copy.push(copyJsonValue(descriptor.value, `${path}[${index}]`, errors, seen, warnings));
      }
    }
  } else {
    copy = {};
    Object.keys(Object.getOwnPropertyDescriptors(value)).forEach((key) => {
      const childPath = path ? `${path}.${key}` : key;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        errors.push(errorRecord("forbidden-field", childPath, `${childPath} is not accepted in a safe snapshot fixture.`));
        return;
      }
      if (!descriptor || !("value" in descriptor)) {
        errors.push(errorRecord("non-json-value", childPath, `${childPath} must be plain JSON data.`));
        return;
      }
      copy[key] = copyJsonValue(descriptor.value, childPath, errors, seen, warnings);
    });
  }
  seen.delete(value);
  return copy;
}

function parseInput(input) {
  if (typeof input === "string") {
    if (input.length > MAX_SNAPSHOT_TEXT_LENGTH) {
      return { value: null, errors: [errorRecord("snapshot-too-large", "$", `Snapshot JSON exceeds ${MAX_SNAPSHOT_TEXT_LENGTH} characters.`)], warnings: [] };
    }
    if (!input.trim()) {
      return { value: null, errors: [errorRecord("empty-snapshot", "$", "Snapshot JSON is empty.")], warnings: [] };
    }
    try {
      return { value: JSON.parse(input), errors: [], warnings: [] };
    } catch (error) {
      return {
        value: null,
        errors: [errorRecord("invalid-json", "$", `Snapshot JSON could not be parsed: ${text(error?.message, "syntax error")}`)],
        warnings: [],
      };
    }
  }
  return { value: input, errors: [], warnings: [] };
}

function entryIdentifier(entry) {
  if (!isRecord(entry)) return null;
  if (typeof entry.id === "string" && entry.id.trim()) return entry.id;
  if (typeof entry.legacyId === "string" && entry.legacyId.trim()) return entry.legacyId;
  return null;
}

function findEntries(snapshot) {
  if (!isRecord(snapshot)) return { entries: null, field: null };
  if (Array.isArray(snapshot.entries)) return { entries: snapshot.entries, field: "entries" };
  if (Array.isArray(snapshot.mappings)) return { entries: snapshot.mappings, field: "mappings" };
  return { entries: null, field: null };
}

/**
 * Parse and validate a fixture without touching the current page state.  The
 * returned preview is generated by the canonical migration domain and only
 * contains safe, known entries.  Callers can therefore show validation errors
 * before any local draft is created.
 */
export function validateMigrationSnapshot(input = defaultFixture()) {
  const parsed = parseInput(input);
  const errors = [...parsed.errors];
  const warnings = [...parsed.warnings];
  let snapshot = null;

  if (!errors.length) {
    const seen = new WeakSet();
    snapshot = copyJsonValue(parsed.value, "", errors, seen, warnings);
  }
  if (!errors.length && !isRecord(snapshot)) {
    errors.push(errorRecord("snapshot-shape", "$", "Snapshot must be a JSON object."));
  }
  if (!errors.length && Array.isArray(snapshot)) {
    errors.push(errorRecord("snapshot-shape", "$", "Snapshot must be a JSON object, not an array."));
  }

  const entrySet = findEntries(snapshot);
  if (!errors.length && !entrySet.entries) {
    errors.push(errorRecord("entries-required", "entries", "Snapshot must contain an entries or mappings array."));
  }
  if (!errors.length && entrySet.entries.length > MAX_SNAPSHOT_ENTRIES) {
    errors.push(errorRecord("too-many-entries", entrySet.field, `Snapshot may contain at most ${MAX_SNAPSHOT_ENTRIES} entries.`));
  }
  if (!errors.length && snapshot.schemaVersion !== undefined
    && snapshot.schemaVersion !== MIGRATION_SNAPSHOT_SCHEMA_VERSION) {
    errors.push(errorRecord("schema-version", "schemaVersion", `Only snapshot schema version ${MIGRATION_SNAPSHOT_SCHEMA_VERSION} is supported.`));
  }

  const seenIds = new Set();
  if (!errors.length) {
    entrySet.entries.forEach((entry, index) => {
      const path = `${entrySet.field}[${index}]`;
      if (!isRecord(entry)) {
        errors.push(errorRecord("entry-shape", path, `${path} must be a JSON object.`));
        return;
      }
      const id = entryIdentifier(entry);
      if (!id) {
        errors.push(errorRecord("entry-id-required", path, `${path} needs a known id or legacyId.`));
        return;
      }
      if (!KNOWN_ID_SET.has(id)) {
        errors.push(errorRecord("unknown-entry", `${path}.id`, `Unknown migration entry: ${id}.`));
        return;
      }
      const canonical = KNOWN_ENTRIES.find((candidate) => candidate.id === id || candidate.legacyId === id);
      const canonicalId = canonical?.id ?? id;
      if (seenIds.has(canonicalId)) {
        errors.push(errorRecord("duplicate-entry", path, `Duplicate migration entry: ${id}.`));
        return;
      }
      seenIds.add(canonicalId);
    });
  }

  // Additional top-level metadata is harmless display data, but only domain
  // owned ids are carried into the preview.  Make that explicit to callers.
  if (!errors.length && isRecord(snapshot)) {
    ["label", "description", "notes"].forEach((key) => {
      if (key in snapshot) warnings.push(warningRecord("ignored-metadata", key, `${key} is display metadata and is not migrated.`));
    });
  }

  let preview = null;
  if (!errors.length) {
    try {
      preview = previewBlockMigration(snapshot);
    } catch (error) {
      errors.push(errorRecord("domain-validation", "$", text(error?.message, "Migration domain rejected the snapshot.")));
    }
  }

  const result = {
    source: MIGRATION_SNAPSHOT_CONSOLE_SOURCE,
    schemaVersion: MIGRATION_SNAPSHOT_SCHEMA_VERSION,
    valid: errors.length === 0,
    snapshot: errors.length === 0 ? deepFreeze(snapshot) : null,
    preview: errors.length === 0 ? preview : null,
    errors,
    warnings,
    inputType: typeof input === "string" ? "json-text" : "json-object",
    mappingCount: preview?.mappings?.length ?? 0,
    safeCount: preview?.applyCount ?? 0,
    deferredCount: preview?.deferredCount ?? 0,
    localOnly: true,
    simulation: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    boundary: MIGRATION_SNAPSHOT_BOUNDARY,
  };
  return deepFreeze(result);
}

/** Alias used by hosts that prefer a parser-shaped name. */
export const parseMigrationSnapshot = validateMigrationSnapshot;

/**
 * Summarize a migration contribution or fixture.  This is pure and useful to
 * hosts that want to render counts without mounting the console.
 */
export function summarizeMigrationSnapshot(input = defaultFixture()) {
  const contribution = input?.source === BLOCK_MIGRATION_SOURCE || Array.isArray(input?.contributions)
    ? contributionFixture(input)
    : null;
  const validation = validateMigrationSnapshot(contribution ?? input);
  return deepFreeze({
    ...validation,
    records: asArray(validation.preview?.mappings),
    source: MIGRATION_SNAPSHOT_CONSOLE_SOURCE,
  });
}

function createText(documentRoot, tag, className, value) {
  const element = documentRoot.createElement(tag);
  if (className) element.className = className;
  element.textContent = text(value);
  return element;
}

function selectedMapping(preview, id) {
  return asArray(preview?.mappings).find((mapping) => mapping.mappingId === id || mapping.id === id || mapping.legacyId === id) ?? null;
}

function contributionFixture(projection) {
  if (projection?.source === BLOCK_MIGRATION_SOURCE && Array.isArray(projection.entries)) return createMigrationSnapshotFixture(projection.entries);
  const contribution = asArray(projection?.contributions).find((entry) => entry?.source === BLOCK_MIGRATION_SOURCE);
  return contribution ? createMigrationSnapshotFixture(contribution.entries) : null;
}

/**
 * Mount the safe snapshot console.  All callbacks receive frozen metadata and
 * are the only seam through which a host may hand a local draft to Block
 * World.  The adapter itself never mutates canonical state.
 */
export function createMigrationSnapshotConsole({
  documentRoot = globalThis.document,
  projection = null,
  snapshot = null,
  onLoad = null,
  onSelect = null,
  onPreview = null,
  onApply = null,
  onReplay = null,
  onReset = null,
  onMerge4Review = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("Migration snapshot console needs a document-like owner");
  const panel = documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.panel);
  const closeButton = documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.close);
  const inputEl = documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.input);
  const loadButton = documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.load);
  const previewButton = documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.preview);
  const applyButton = documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.apply);
  const replayButton = documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.replay);
  const resetButton = documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.reset);
  const fileInput = documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.fileInput);
  const statusEl = documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.status);
  const mappingCountEl = documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.mappingCount);
  const safeCountEl = documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.safeCount);
  const draftCountEl = documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.draftCount);
  const selectionEl = documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.selection);
  const validationEl = documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.validation);
  const listEl = documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.list);
  const traceEl = documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.trace);
  const boundaryEl = documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.boundary);
  const merge4ReviewButton = documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.merge4Review);
  const merge4StatusEl = documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.merge4Status);
  const merge4SummaryEl = documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.merge4Summary);
  const merge4RecordsEl = documentRoot.getElementById(MIGRATION_SNAPSHOT_DOM_IDS.merge4Records);
  if (!panel || !closeButton || !inputEl || !loadButton || !previewButton || !applyButton || !replayButton || !resetButton || !fileInput || !statusEl || !validationEl || !listEl || !traceEl) {
    throw new Error("Migration snapshot console mount points are missing");
  }

  const projectionFixture = contributionFixture(projection);
  const initialInput = snapshot ?? projectionFixture ?? defaultFixture();
  let validation = validateMigrationSnapshot(initialInput);
  // Never retain an arbitrary object reference from a failed validation.  A
  // caller could hand us a cyclic object or a getter-backed object; the only
  // state that survives validation is JSON text or the sanitized frozen copy.
  let activeInput = validation.valid
    ? validation.snapshot
    : typeof initialInput === "string" ? initialInput : null;
  let preview = validation.preview;
  let draft = null;
  let selectedId = preview?.mappings?.[0]?.mappingId ?? null;
  let opened = panel.hidden !== true;
  let trace = [];
  let replayCount = 0;
  let merge4Review = null;
  let lastFileImport = null;

  function setOpen(next, method = "api") {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.classList?.toggle?.("visible", opened);
    panel.setAttribute?.("aria-hidden", String(!opened));
    if (opened && method === "open") inputEl.focus?.({ preventScroll: true });
  }

  function pushTrace(action, details = {}) {
    const entry = deepFreeze({
      action,
      mappingId: details.mappingId ?? selectedId,
      accepted: details.accepted !== false,
      valid: details.valid !== false,
      errorCount: details.errorCount ?? validation.errors.length,
      appliedCount: details.appliedCount ?? draft?.draft?.mappingIds?.length ?? 0,
      localOnly: true,
      simulation: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    trace = [entry, ...trace].slice(0, 12);
  }

  function renderValidation() {
    validationEl.replaceChildren();
    if (validation.valid) {
      validationEl.appendChild(createText(documentRoot, "div", "migration-snapshot-valid", `VALID JSON SNAPSHOT · ${formatCount(validation.mappingCount)} mappings · ${formatCount(validation.safeCount)} safe`));
      validation.warnings.forEach((warning) => validationEl.appendChild(createText(documentRoot, "div", "migration-snapshot-warning", `WARNING · ${warning.message}`)));
      return;
    }
    validation.errors.forEach((error) => validationEl.appendChild(createText(documentRoot, "div", "migration-snapshot-error", `ERROR · ${error.path} · ${error.message}`)));
    validation.warnings.forEach((warning) => validationEl.appendChild(createText(documentRoot, "div", "migration-snapshot-warning", `WARNING · ${warning.message}`)));
  }

  function renderList() {
    listEl.replaceChildren();
    asArray(preview?.mappings).forEach((mapping) => {
      const item = documentRoot.createElement("button");
      item.type = "button";
      item.className = "migration-snapshot-row";
      item.dataset.mappingId = mapping.mappingId;
      item.setAttribute?.("aria-pressed", String(mapping.mappingId === selectedId));
      item.append(
        createText(documentRoot, "strong", "migration-snapshot-row-title", mapping.label),
        createText(documentRoot, "span", "migration-snapshot-row-meta", `${mapping.legacyId} → ${mapping.targetId ?? "deferred"}`),
        createText(documentRoot, "span", `migration-snapshot-row-status migration-snapshot-status-${mapping.status}`, mapping.status.toUpperCase()),
      );
      item.addEventListener("click", () => selectMapping(mapping.mappingId, "row"));
      listEl.appendChild(item);
    });
    if (!preview?.mappings?.length) listEl.appendChild(createText(documentRoot, "div", "migration-snapshot-empty", "Load a valid JSON snapshot to reveal mappings."));
  }

  function renderTrace() {
    traceEl.replaceChildren();
    if (!trace.length) {
      traceEl.appendChild(createText(documentRoot, "div", "migration-snapshot-empty", "No snapshot action yet."));
      return;
    }
    trace.forEach((entry, index) => {
      const verdict = entry.accepted === false ? "REJECTED" : entry.action === "load" && entry.valid === false ? "INVALID" : "LOCAL";
      traceEl.appendChild(createText(documentRoot, "div", "migration-snapshot-trace-row", `${index + 1} · ${String(entry.action).toUpperCase()} · ${verdict} · ${entry.appliedCount} DRAFT MAPPINGS`));
    });
  }

  function renderMerge4Review() {
    if (merge4StatusEl) {
      merge4StatusEl.textContent = merge4Review
        ? merge4Review.valid
          ? `READY · ${formatCount(merge4Review.mappedEntityCount)} MAPPED · ${formatCount(merge4Review.evidenceCount)} EVIDENCE · LOCAL ONLY`
          : `REJECTED · ${formatCount(merge4Review.errors?.length ?? 0)} ISSUE${(merge4Review.errors?.length ?? 0) === 1 ? "" : "S"} · NO SERVER WRITE`
        : "NOT REVIEWED · MERGE 4 ADAPTER STAGED";
    }
    if (merge4SummaryEl) {
      merge4SummaryEl.textContent = merge4Review?.valid
        ? `${merge4Review.worldId} · server version ${merge4Review.version} · ${formatCount(merge4Review.deferredCount ?? merge4Review.deferred?.length ?? 0)} deferred records · authority none`
        : "Review the staged Merge 4 fixture to see its safe projection boundary.";
    }
    if (!merge4RecordsEl) return;
    merge4RecordsEl.replaceChildren();
    if (!merge4Review?.valid) {
      merge4RecordsEl.appendChild(createText(documentRoot, "div", "migration-snapshot-empty", "No Merge 4 records reviewed yet."));
      return;
    }
    const mapped = asArray(merge4Review.mapping?.contribution?.entities).slice(0, 8);
    mapped.forEach((entry) => merge4RecordsEl.appendChild(createText(documentRoot, "div", "migration-snapshot-trace-row", `MAPPED · ${entry.kind} · ${entry.label}`)));
    asArray(merge4Review.deferred).forEach((entry) => merge4RecordsEl.appendChild(createText(documentRoot, "div", "migration-snapshot-trace-row migration-snapshot-merge4-deferred", `DEFERRED · ${entry.path} · ${entry.reason}`)));
  }

  function render() {
    if (inputEl.value === "" && validation.valid) inputEl.value = serializeMigrationSnapshot(validation.snapshot);
    if (mappingCountEl) mappingCountEl.textContent = formatCount(validation.mappingCount);
    if (safeCountEl) safeCountEl.textContent = formatCount(validation.safeCount);
    if (draftCountEl) draftCountEl.textContent = formatCount(draft?.draft?.mappingIds?.length ?? 0);
    if (selectionEl) {
      const selected = selectedMapping(preview, selectedId);
      selectionEl.textContent = selected
        ? `${selected.label.toUpperCase()} · ${selected.status.toUpperCase()} · ${selected.targetId ?? "NO TARGET"}`
        : validation.valid ? "SELECT A MAPPING TO INSPECT" : "VALIDATE A SNAPSHOT BEFORE SELECTING";
    }
    statusEl.textContent = validation.valid
      ? draft
        ? `DRAFT ACTIVE · ${draft.draft.mappingIds.length} MAPPED · ${draft.draft.deferredMappingIds.length} DEFERRED · NO SYNC`
        : lastFileImport?.status === "reading"
          ? "READING LOCAL JSON · IN MEMORY ONLY"
          : lastFileImport?.status === "accepted"
            ? `FILE LOADED · ${formatCount(validation.mappingCount)} MAPPINGS · IN MEMORY ONLY`
            : `READY · ${formatCount(validation.safeCount)} SAFE · LOCAL SNAPSHOT · NO IMPORT`
      : lastFileImport?.status === "rejected"
        ? `FILE REJECTED · ${lastFileImport.reason ?? "FIX THE VALIDATION ERRORS"}`
        : `VALIDATION ERROR · ${validation.errors.length} ISSUE${validation.errors.length === 1 ? "" : "S"} · NO APPLY`;
    if (boundaryEl) boundaryEl.textContent = MIGRATION_SNAPSHOT_BOUNDARY;
    previewButton.disabled = !validation.valid;
    applyButton.disabled = !validation.valid || !preview || preview.applyCount === 0;
    replayButton.disabled = !validation.valid || !preview;
    resetButton.disabled = !draft && !trace.length && validation.valid;
    renderValidation();
    renderList();
    renderTrace();
    renderMerge4Review();
  }

  function reviewMerge4Snapshot(method = "button") {
    const adapted = adaptMerge4Snapshot(DEFAULT_MERGE4_SNAPSHOT);
    merge4Review = deepFreeze({
      ...adapted,
      action: "merge4-review",
      method,
      serializedSnapshot: adapted.valid ? serializeMerge4Snapshot(adapted.snapshot) : null,
    });
    pushTrace("merge4-review", { accepted: adapted.valid, valid: adapted.valid, errorCount: adapted.errors?.length ?? 0, appliedCount: 0 });
    render();
    const result = deepFreeze({
      ...merge4Review,
      source: MERGE4_SNAPSHOT_ADAPTER_SOURCE,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    onMerge4Review?.(result);
    return result;
  }

  function selectMapping(id, method = "row") {
    const mapping = selectedMapping(preview, id);
    if (!mapping) return null;
    selectedId = mapping.mappingId;
    pushTrace("select", { mappingId: selectedId });
    render();
    const result = deepFreeze({
      source: MIGRATION_SNAPSHOT_CONSOLE_SOURCE,
      action: "select",
      method,
      mapping,
      selectedId,
      localOnly: true,
      simulation: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    onSelect?.(result);
    return result;
  }

  function loadSnapshot(input = inputEl.value, method = "input", details = null) {
    const nextValidation = validateMigrationSnapshot(input);
    validation = nextValidation;
    activeInput = nextValidation.valid
      ? nextValidation.snapshot
      : typeof input === "string" ? input : null;
    preview = nextValidation.preview;
    draft = null;
    lastFileImport = details?.fileImport ?? null;
    selectedId = preview?.mappings?.[0]?.mappingId ?? null;
    pushTrace("load", { valid: nextValidation.valid, accepted: nextValidation.valid, errorCount: nextValidation.errors.length, appliedCount: 0 });
    render();
    const result = deepFreeze({
      source: MIGRATION_SNAPSHOT_CONSOLE_SOURCE,
      action: "load",
      method,
      ...(details ?? {}),
      validation: nextValidation,
      preview,
      accepted: nextValidation.valid,
      valid: nextValidation.valid,
      localOnly: true,
      simulation: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    onLoad?.(result);
    return result;
  }

  function rejectFile(fileMeta, reason, code = "file-rejected", method = "file") {
    validation = fileValidationError(reason, code);
    activeInput = null;
    preview = null;
    draft = null;
    selectedId = null;
    lastFileImport = deepFreeze({
      status: "rejected",
      reason,
      code,
      bytes: fileMeta?.size ?? null,
      mime: fileMeta?.mime ?? null,
      readInMemory: false,
      localOnly: true,
    });
    pushTrace("file-rejected", { accepted: false, valid: false, errorCount: validation.errors.length, appliedCount: 0 });
    render();
    const result = deepFreeze({
      source: MIGRATION_SNAPSHOT_CONSOLE_SOURCE,
      action: "file-load",
      method,
      accepted: false,
      valid: false,
      validation,
      file: lastFileImport,
      localOnly: true,
      simulation: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    onLoad?.(result);
    return result;
  }

  /** Read only the selected JSON file's text in memory, then reuse the
   * existing migration validator and preview path. File names and paths are
   * intentionally discarded. */
  async function loadFile(file, method = "file") {
    const metadata = fileInfo(file);
    if (!file || !metadata.accepted) {
      return rejectFile(metadata, "Choose a .json file or application/json document.", "file-type", method);
    }
    if (metadata.size !== null && metadata.size > MIGRATION_SNAPSHOT_MAX_FILE_BYTES) {
      return rejectFile(metadata, `JSON file exceeds ${MIGRATION_SNAPSHOT_MAX_FILE_BYTES} bytes.`, "file-too-large", method);
    }
    if (typeof file.text !== "function") {
      return rejectFile(metadata, "This browser cannot read the selected JSON file in memory.", "file-read-unavailable", method);
    }
    lastFileImport = deepFreeze({ status: "reading", bytes: metadata.size, mime: metadata.mime, readInMemory: true, localOnly: true });
    render();
    let payload;
    try {
      payload = await file.text();
    } catch {
      return rejectFile(metadata, "The selected JSON file could not be read in memory.", "file-read-failed", method);
    }
    if (typeof payload !== "string") {
      return rejectFile(metadata, "The selected file did not provide JSON text.", "file-text-invalid", method);
    }
    if (payload.length > MIGRATION_SNAPSHOT_MAX_FILE_BYTES) {
      return rejectFile({ ...metadata, size: payload.length }, `JSON file exceeds ${MIGRATION_SNAPSHOT_MAX_FILE_BYTES} characters.`, "file-too-large", method);
    }
    inputEl.value = payload;
    return loadSnapshot(payload, method, {
      fileImport: {
        status: "accepted",
        bytes: payload.length,
        mime: metadata.mime,
        readInMemory: true,
        localOnly: true,
      },
      readInMemory: true,
    });
  }

  function previewMappings(method = "button") {
    if (!validation.valid || !validation.snapshot) {
      const result = deepFreeze({ source: MIGRATION_SNAPSHOT_CONSOLE_SOURCE, action: "preview", method, accepted: false, valid: false, validation, localOnly: true, simulation: true, externalImport: false, importedCodeExecution: false, persistence: false, externalNetwork: false, executable: false });
      pushTrace("preview", { accepted: false, valid: false, errorCount: validation.errors.length });
      render();
      onPreview?.(result);
      return result;
    }
    preview = previewBlockMigration(validation.snapshot);
    draft = null;
    pushTrace("preview", { appliedCount: 0 });
    render();
    const result = deepFreeze({
      source: MIGRATION_SNAPSHOT_CONSOLE_SOURCE,
      action: "preview",
      method,
      preview,
      validation,
      accepted: true,
      valid: true,
      localOnly: true,
      simulation: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    onPreview?.(result);
    return result;
  }

  function applyLocalDraft(method = "button") {
    if (!validation.valid || !preview) {
      const result = deepFreeze({ source: MIGRATION_SNAPSHOT_CONSOLE_SOURCE, action: "apply", method, accepted: false, valid: false, validation, draft: null, localOnly: true, simulation: true, externalImport: false, importedCodeExecution: false, persistence: false, externalNetwork: false, executable: false });
      pushTrace("apply", { accepted: false, valid: false, errorCount: validation.errors.length });
      render();
      onApply?.(result);
      return result;
    }
    const resultDraft = applyBlockMigrationToLocalDraft(preview);
    draft = resultDraft;
    pushTrace("apply", { appliedCount: resultDraft.draft.mappingIds.length });
    render();
    const result = deepFreeze({
      source: MIGRATION_SNAPSHOT_CONSOLE_SOURCE,
      action: "apply-local-draft",
      method,
      preview,
      result: resultDraft,
      draft: resultDraft.draft,
      accepted: true,
      valid: true,
      localOnly: true,
      simulation: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    onApply?.(result);
    return result;
  }

  function replaySnapshot(method = "button") {
    if (!validation.valid || !preview) {
      const result = deepFreeze({ source: MIGRATION_SNAPSHOT_CONSOLE_SOURCE, action: "replay", method, accepted: false, valid: false, validation, draft: null, replayCount, localOnly: true, simulation: true, externalImport: false, importedCodeExecution: false, persistence: false, externalNetwork: false, executable: false });
      pushTrace("replay", { accepted: false, valid: false, errorCount: validation.errors.length });
      render();
      onReplay?.(result);
      return result;
    }
    const replayPreview = previewBlockMigration(validation.snapshot);
    const resultDraft = applyBlockMigrationToLocalDraft(replayPreview);
    preview = replayPreview;
    draft = resultDraft;
    replayCount += 1;
    pushTrace("replay", { appliedCount: resultDraft.draft.mappingIds.length });
    render();
    const result = deepFreeze({
      source: MIGRATION_SNAPSHOT_CONSOLE_SOURCE,
      action: "replay",
      method,
      preview: replayPreview,
      result: resultDraft,
      draft: resultDraft.draft,
      replayCount,
      merge4Review,
      accepted: true,
      valid: true,
      localOnly: true,
      simulation: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      executable: false,
    });
    onReplay?.(result);
    return result;
  }

  function resetLocalDraft(method = "button") {
    let resultDraft;
    if (validation.valid && preview) resultDraft = resetBlockMigrationDraft(preview);
    else {
      activeInput = defaultFixture();
      validation = validateMigrationSnapshot(activeInput);
      preview = validation.preview;
      resultDraft = resetBlockMigrationDraft(preview);
      inputEl.value = serializeMigrationSnapshot(validation.snapshot);
    }
    draft = null;
    lastFileImport = null;
    selectedId = preview?.mappings?.[0]?.mappingId ?? null;
    pushTrace("reset", { appliedCount: 0 });
    render();
    const result = deepFreeze({
      source: MIGRATION_SNAPSHOT_CONSOLE_SOURCE,
      action: "reset",
      method,
      result: resultDraft,
      preview,
      validation,
      accepted: true,
      valid: validation.valid,
      localOnly: true,
      simulation: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      executable: false,
    });
    onReset?.(result);
    return result;
  }

  function syncProjection(nextProjection) {
    const nextFixture = contributionFixture(nextProjection);
    if (!nextFixture) return getSnapshot();
    return loadSnapshot(nextFixture, "projection");
  }

  function getSnapshot() {
    return deepFreeze({
      source: MIGRATION_SNAPSHOT_CONSOLE_SOURCE,
      activeInput,
      validation,
      preview,
      draft,
      selectedId,
      selected: selectedMapping(preview, selectedId),
      opened,
      trace,
      replayCount,
      merge4Review,
      lastFileImport,
      localOnly: true,
      simulation: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
      boundary: MIGRATION_SNAPSHOT_BOUNDARY,
    });
  }

  closeButton.addEventListener("click", () => setOpen(false, "close"));
  loadButton.addEventListener("click", () => loadSnapshot(inputEl.value, "button"));
  fileInput.addEventListener?.("change", () => {
    const file = fileInput.files?.[0] ?? null;
    // Clear the picker immediately so the same file can be chosen again;
    // the File object remains available to the in-memory read below.
    try { fileInput.value = ""; } catch { /* best effort */ }
    void loadFile(file, "file");
  });
  previewButton.addEventListener("click", () => previewMappings("button"));
  applyButton.addEventListener("click", () => applyLocalDraft("button"));
  replayButton.addEventListener("click", () => replaySnapshot("button"));
  resetButton.addEventListener("click", () => resetLocalDraft("button"));
  merge4ReviewButton?.addEventListener("click", () => reviewMerge4Snapshot("button"));
  documentRoot.addEventListener?.("keydown", (event) => {
    if (event.key === "Escape" && opened) setOpen(false, "escape");
  });

  render();
  setOpen(opened, "initial");

  return Object.freeze({
    open: () => setOpen(true, "open"),
    close: () => setOpen(false, "close"),
    toggle: () => setOpen(!opened, "toggle"),
    loadSnapshot,
    load: loadSnapshot,
    loadFile,
    importFile: loadFile,
    setSnapshot: loadSnapshot,
    validate: (input) => validateMigrationSnapshot(input),
    selectMapping,
    preview: previewMappings,
    previewMappings,
    apply: applyLocalDraft,
    applyLocalDraft,
    replay: replaySnapshot,
    replaySnapshot,
    reset: resetLocalDraft,
    resetLocalDraft,
    reviewMerge4Snapshot,
    reviewMerge4: reviewMerge4Snapshot,
    syncProjection,
    setProjection: syncProjection,
    getSnapshot,
    destroy: () => {},
  });
}

export const createBlockMigrationSnapshotConsole = createMigrationSnapshotConsole;
export const createMigrationSnapshotLayer = createMigrationSnapshotConsole;
export const createSnapshotMigrationConsole = createMigrationSnapshotConsole;

export default createMigrationSnapshotConsole;
