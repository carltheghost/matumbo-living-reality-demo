import {
  BLOCK_MIGRATION_BOUNDARY,
  BLOCK_MIGRATION_CONSOLE_SOURCE,
  BLOCK_MIGRATION_MANIFEST,
  BLOCK_MIGRATION_PREVIEW_SOURCE,
  applyBlockMigrationToLocalDraft,
  createBlockMigrationManifest,
  previewBlockMigration,
  resetBlockMigrationDraft,
} from "../domains/block-migration.js";

const freeze = (value) => Object.freeze(value);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (Array.isArray(value)) return freeze(value.map(deepFreeze));
  if (!isRecord(value)) return value;
  return freeze(Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, deepFreeze(entry)])));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function createText(documentRoot, tag, className, value) {
  const element = documentRoot.createElement(tag);
  if (className) element.className = className;
  element.textContent = text(value);
  return element;
}

function manifestFrom(projection) {
  if (projection?.source === BLOCK_MIGRATION_MANIFEST.source && Array.isArray(projection?.entries)) {
    return projection;
  }
  return asArray(projection?.contributions).find((contribution) => (
    contribution?.source === BLOCK_MIGRATION_MANIFEST.source && Array.isArray(contribution?.entries)
  )) ?? BLOCK_MIGRATION_MANIFEST;
}

/**
 * Return the renderer-safe summary of the canonical migration contribution.
 * This function copies no executable values and keeps the boundary visible to
 * any host that wants to render the summary without mounting the console.
 */
export function summarizeBlockMigration(projection) {
  const manifest = manifestFrom(projection);
  return deepFreeze({
    source: BLOCK_MIGRATION_CONSOLE_SOURCE,
    manifestId: manifest.id ?? BLOCK_MIGRATION_MANIFEST.id,
    project: manifest.project ?? "arena-living-reality",
    updatedAt: manifest.updatedAt ?? BLOCK_MIGRATION_MANIFEST.updatedAt,
    entries: asArray(manifest.entries),
    mappings: asArray(manifest.entries),
    counts: manifest.counts ?? { mapped: 0, preserved: 0, deferred: 0 },
    deterministic: manifest.deterministic === true,
    simulation: manifest.simulation === true,
    localOnly: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    boundary: manifest.boundary ?? BLOCK_MIGRATION_BOUNDARY,
  });
}

export const BLOCK_MIGRATION_RENDER_SOURCE = BLOCK_MIGRATION_CONSOLE_SOURCE;
// Re-export the console source so hosts can use one stable import from the
// renderer adapter when wiring intent events.
export { BLOCK_MIGRATION_CONSOLE_SOURCE };

function selectedEntry(summary, id) {
  return summary.entries.find((entry) => entry.id === id || entry.legacyId === id) ?? null;
}

/**
 * Mount the local migration console. It is intentionally a DOM adapter: all
 * state transitions return frozen snapshots and are handed to callbacks, but
 * no action writes a file, evaluates a project, or changes canonical state.
 */
export function createBlockMigrationConsole({
  documentRoot = globalThis.document,
  projection = null,
  manifest = null,
  onSelect = null,
  onShowInCube = null,
  onPreview = null,
  onApply = null,
  onReset = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("Block migration console needs a document-like owner");
  const panel = documentRoot.getElementById("block-migration-console");
  const closeButton = documentRoot.getElementById("block-migration-close");
  const previewButton = documentRoot.getElementById("block-migration-preview");
  const applyButton = documentRoot.getElementById("block-migration-apply");
  const resetButton = documentRoot.getElementById("block-migration-reset");
  const statusEl = documentRoot.getElementById("block-migration-status");
  const countEl = documentRoot.getElementById("block-migration-count");
  const appliedCountEl = documentRoot.getElementById("block-migration-applied-count");
  const selectionEl = documentRoot.getElementById("block-migration-selection");
  const handoffEl = documentRoot.getElementById("block-migration-handoff");
  const listEl = documentRoot.getElementById("block-migration-list");
  const traceEl = documentRoot.getElementById("block-migration-trace");
  const boundaryEl = documentRoot.getElementById("block-migration-boundary");
  if (!panel || !closeButton || !previewButton || !applyButton || !resetButton || !statusEl || !listEl || !traceEl) {
    throw new Error("Block migration console mount points are missing");
  }

  let summary = summarizeBlockMigration(manifest ?? projection);
  let preview = previewBlockMigration(summary.entries);
  let draft = null;
  let selectedId = summary.entries[0]?.id ?? null;
  let opened = panel.hidden !== true;
  let trace = [];

  function setOpen(next, method = "api") {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.classList?.toggle?.("visible", opened);
    panel.setAttribute?.("aria-hidden", String(!opened));
    if (opened && method === "open") listEl.querySelector?.(`[data-migration-id="${selectedId}"]`)?.focus?.({ preventScroll: true });
  }

  function pushTrace(action, details = {}) {
    const entry = deepFreeze({
      action,
      mappingId: details.mappingId ?? selectedId,
      appliedCount: details.appliedCount ?? draft?.draft?.mappingIds?.length ?? 0,
      localOnly: true,
      simulation: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      executable: false,
    });
    trace = [entry, ...trace].slice(0, 8);
  }

  function renderTrace() {
    traceEl.replaceChildren();
    if (!trace.length) {
      traceEl.appendChild(createText(documentRoot, "div", "block-migration-empty", "No migration action yet."));
      return;
    }
    trace.forEach((entry, index) => {
      const label = `${index + 1} · ${String(entry.action).toUpperCase()} · ${entry.mappingId ?? "manifest"} · LOCAL ONLY`;
      traceEl.appendChild(createText(documentRoot, "div", "block-migration-trace-row", label));
    });
  }

  function renderList() {
    listEl.replaceChildren();
    summary.entries.forEach((entry) => {
      // Keep selection and cube handback as separate native controls. A
      // button cannot legally contain another button, and separating them
      // makes the return-to-field affordance reachable on touch and keyboard
      // without duplicating migration state.
      const row = documentRoot.createElement("div");
      row.className = "block-migration-row-wrap";
      row.dataset.migrationId = entry.id;
      const item = documentRoot.createElement("button");
      item.type = "button";
      item.className = "block-migration-row";
      item.dataset.migrationId = entry.id;
      item.setAttribute("aria-pressed", String(entry.id === selectedId));
      const title = createText(documentRoot, "strong", "block-migration-row-title", entry.label);
      const coordinate = entry.block?.coordinate;
      const coordinateText = Array.isArray(coordinate) ? ` · CUBE ${coordinate.join(",")}` : "";
      const meta = createText(documentRoot, "span", "block-migration-row-meta", `${entry.legacyId} → ${entry.targetId ?? "deferred"}${coordinateText}`);
      const status = createText(documentRoot, "span", `block-migration-row-status block-migration-status-${entry.status}`, entry.status.toUpperCase());
      item.append(title, meta, status);
      item.addEventListener("click", () => selectMapping(entry.id, "row"));
      row.appendChild(item);
      const showButton = documentRoot.createElement("button");
      showButton.type = "button";
      showButton.className = "block-migration-show-cube";
      showButton.dataset.migrationId = entry.id;
      showButton.disabled = !entry.block || entry.status === "deferred";
      showButton.setAttribute("aria-label", entry.block
        ? `Show ${entry.label} at cube ${coordinate.join(",")}`
        : `${entry.label} has no cube handoff`);
      showButton.textContent = entry.block ? `SHOW IN CUBE FIELD · ${coordinate.join(",")}` : "DEFERRED · NO CUBE HANDOFF";
      showButton.addEventListener("click", (event) => {
        event?.stopPropagation?.();
        selectMapping(entry.id, "show-in-cube");
        showSelectedInCube("button");
      });
      row.appendChild(showButton);
      listEl.appendChild(row);
    });
    if (!summary.entries.length) listEl.appendChild(createText(documentRoot, "div", "block-migration-empty", "No migration mappings are available."));
  }

  function render() {
    const selected = selectedEntry(summary, selectedId);
    const counts = preview?.counts ?? { mapped: 0, preserved: 0, deferred: 0 };
    if (countEl) countEl.textContent = `${summary.entries.length} mappings · ${counts.mapped + counts.preserved} safe`;
    if (appliedCountEl) appliedCountEl.textContent = text(draft?.draft?.mappingIds?.length ?? 0, "0");
    if (selectionEl) {
      selectionEl.textContent = selected
        ? `${selected.label.toUpperCase()} · ${selected.status.toUpperCase()} · ${selected.targetId ?? "NO TARGET"}${selected.block?.coordinate ? ` · CUBE ${selected.block.coordinate.join(",")}` : " · NO CUBE HANDOFF"}`
        : "SELECT A MAPPING TO INSPECT";
    }
    if (handoffEl) {
      handoffEl.textContent = selected?.block?.coordinate
        ? `SAFE MAPPING READY · CUBE ${selected.block.coordinate.join(",")} · SHOW IN CUBE FIELD TO CONTINUE · MIGRATION BRIDGE REMAINS THE RETURN PATH`
        : selected?.status === "deferred"
          ? "DEFERRED MAPPING · NO CUBE TARGET · EXTERNAL PROJECT SYNC REMAINS DENIED"
          : "SELECT A SAFE MAPPING TO REVEAL ITS CUBE TARGET";
    }
    statusEl.textContent = draft
      ? `DRAFT ACTIVE · ${draft.draft.mappingIds.length} MAPPED · ${draft.draft.deferredMappingIds.length} DEFERRED · NO SYNC`
      : `PREVIEW READY · ${counts.mapped + counts.preserved} SAFE · ${counts.deferred} DEFERRED · NO IMPORT`;
    if (boundaryEl) boundaryEl.textContent = summary.boundary;
    applyButton.disabled = !preview || preview.applyCount === 0;
    previewButton.disabled = summary.entries.length === 0;
    resetButton.disabled = !draft && trace.length === 0;
    renderList();
    renderTrace();
  }

  function selectMapping(id, method = "row") {
    const selected = selectedEntry(summary, id);
    if (!selected) return null;
    selectedId = selected.id;
    const snapshot = deepFreeze({
      source: BLOCK_MIGRATION_CONSOLE_SOURCE,
      action: "select",
      method,
      mapping: selected,
      localOnly: true,
      simulation: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      executable: false,
    });
    pushTrace("select", { mappingId: selected.id });
    render();
    onSelect?.(snapshot);
    return snapshot;
  }

  function showSelectedInCube(method = "button") {
    const selected = selectedEntry(summary, selectedId);
    const coordinate = selected?.block?.coordinate ?? null;
    if (!coordinate) {
      const snapshot = deepFreeze({
        source: BLOCK_MIGRATION_CONSOLE_SOURCE,
        action: "show-in-cube-blocked",
        method,
        mapping: selected,
        coordinate: null,
        reason: selected?.status === "deferred" ? "deferred-mapping" : "no-cube-target",
        blockId: null,
        found: false,
        localOnly: true,
        simulation: true,
        externalImport: false,
        importedCodeExecution: false,
        persistence: false,
        externalNetwork: false,
        executable: false,
      });
      pushTrace("show-in-cube-blocked", { mappingId: selected?.id ?? null });
      render();
      onShowInCube?.(snapshot);
      return snapshot;
    }
    const snapshot = deepFreeze({
      source: BLOCK_MIGRATION_CONSOLE_SOURCE,
      action: "show-in-cube",
      method,
      mapping: selected,
      mappingId: selected.id,
      coordinate,
      block: selected.block,
      blockId: null,
      // The renderer does not own the current Block World draft, so `found`
      // is intentionally left unknown. The host resolves this coordinate
      // against its live draft before selecting a cube; no block is created
      // here.
      found: null,
      returnFeature: "migration",
      localOnly: true,
      simulation: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      executable: false,
    });
    pushTrace("show-in-cube", { mappingId: selected.id });
    render();
    onShowInCube?.(snapshot);
    return snapshot;
  }

  function previewMappings(method = "button") {
    preview = previewBlockMigration(summary.entries);
    draft = null;
    pushTrace("preview", { appliedCount: 0 });
    render();
    const snapshot = deepFreeze({
      source: BLOCK_MIGRATION_CONSOLE_SOURCE,
      action: "preview",
      method,
      preview,
      localOnly: true,
      simulation: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      executable: false,
    });
    onPreview?.(snapshot);
    return snapshot;
  }

  function applyLocalDraft(method = "button") {
    const result = applyBlockMigrationToLocalDraft(preview);
    draft = result;
    pushTrace("apply-local-draft", { appliedCount: result.draft.mappingIds.length });
    render();
    const snapshot = deepFreeze({
      source: BLOCK_MIGRATION_CONSOLE_SOURCE,
      action: "apply-local-draft",
      method,
      result,
      draft: result.draft,
      localOnly: true,
      simulation: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      executable: false,
    });
    onApply?.(snapshot);
    return snapshot;
  }

  function resetLocalDraft(method = "button") {
    const result = resetBlockMigrationDraft(preview);
    draft = null;
    preview = previewBlockMigration(summary.entries);
    pushTrace("reset", { appliedCount: 0 });
    render();
    const snapshot = deepFreeze({
      source: BLOCK_MIGRATION_CONSOLE_SOURCE,
      action: "reset",
      method,
      result,
      localOnly: true,
      simulation: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      executable: false,
    });
    onReset?.(snapshot);
    return snapshot;
  }

  function syncManifest(nextManifest) {
    summary = summarizeBlockMigration(nextManifest);
    preview = previewBlockMigration(summary.entries);
    if (!selectedEntry(summary, selectedId)) selectedId = summary.entries[0]?.id ?? null;
    draft = null;
    render();
    return getSnapshot();
  }

  function getSnapshot() {
    return deepFreeze({
      source: BLOCK_MIGRATION_CONSOLE_SOURCE,
      manifest: summary,
      preview,
      draft,
      selectedId,
      selected: selectedEntry(summary, selectedId),
      opened,
      trace,
      boundary: summary.boundary ?? BLOCK_MIGRATION_BOUNDARY,
      localOnly: true,
      simulation: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      executable: false,
    });
  }

  closeButton.addEventListener("click", () => setOpen(false, "close"));
  previewButton.addEventListener("click", () => previewMappings("button"));
  applyButton.addEventListener("click", () => applyLocalDraft("button"));
  resetButton.addEventListener("click", () => resetLocalDraft("button"));
  documentRoot.addEventListener?.("keydown", (event) => {
    if (event.key === "Escape" && opened) setOpen(false, "escape");
  });

  render();
  setOpen(opened, "initial");

  return Object.freeze({
    open: () => setOpen(true, "open"),
    close: () => setOpen(false, "close"),
    toggle: () => setOpen(!opened, "toggle"),
    selectMapping,
    showInCube: showSelectedInCube,
    showSelectedInCube,
    preview: previewMappings,
    previewMappings,
    apply: applyLocalDraft,
    applyLocalDraft,
    reset: resetLocalDraft,
    resetLocalDraft,
    syncManifest,
    setManifest: syncManifest,
    getSnapshot,
    destroy: () => {},
  });
}

export const createBlockMigrationLayer = createBlockMigrationConsole;
export const createMigrationConsole = createBlockMigrationConsole;

export default createBlockMigrationConsole;
