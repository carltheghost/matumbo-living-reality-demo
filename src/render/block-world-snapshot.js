import {
  BLOCK_WORLD_SNAPSHOT_BOUNDARY,
  BLOCK_WORLD_SNAPSHOT_MAX_TEXT_LENGTH,
  BLOCK_WORLD_SNAPSHOT_SOURCE,
  createBlockWorldSnapshot,
  serializeBlockWorldSnapshot,
  validateBlockWorldSnapshot,
  applyBlockWorldSnapshot,
} from "../domains/block-world-snapshot.js";

export const BLOCK_WORLD_SNAPSHOT_CONSOLE_SOURCE = "block-world-snapshot-console";
export const BLOCK_WORLD_SNAPSHOT_RENDER_SOURCE = BLOCK_WORLD_SNAPSHOT_CONSOLE_SOURCE;
export const BLOCK_WORLD_SNAPSHOT_DOWNLOAD_FILENAME = "matumbo-block-world-snapshot.json";
export const BLOCK_WORLD_SNAPSHOT_FILE_ACCEPT = ".json,application/json";
export const BLOCK_WORLD_SNAPSHOT_FILE_MAX_BYTES = BLOCK_WORLD_SNAPSHOT_MAX_TEXT_LENGTH;
export const BLOCK_WORLD_SNAPSHOT_DOM_IDS = Object.freeze({
  panel: "block-world-snapshot-console",
  close: "block-world-snapshot-close",
  export: "block-world-snapshot-export",
  load: "block-world-snapshot-load",
  preview: "block-world-snapshot-preview",
  apply: "block-world-snapshot-apply",
  replay: "block-world-snapshot-replay",
  reset: "block-world-snapshot-reset",
  input: "block-world-snapshot-input",
  fileInput: "block-world-snapshot-file",
  status: "block-world-snapshot-status",
  blockCount: "block-world-snapshot-block-count",
  contentCount: "block-world-snapshot-content-count",
  validation: "block-world-snapshot-validation",
  json: "block-world-snapshot-json",
  trace: "block-world-snapshot-trace",
  boundary: "block-world-snapshot-boundary",
});

const LOCAL_FLAGS = Object.freeze({
  simulation: true,
  localOnly: true,
  externalImport: false,
  importedCodeExecution: false,
  persistence: false,
  externalNetwork: false,
  externalTransfer: false,
  executable: false,
  authority: "none",
});

const freeze = (value) => Object.freeze(value);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
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
  return Object.freeze({
    valid: false,
    snapshot: null,
    errors: Object.freeze([{ code, path: "$file", message }]),
    warnings: Object.freeze([]),
    blockCount: 0,
    contentCount: 0,
    dimensions: null,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    boundary: BLOCK_WORLD_SNAPSHOT_BOUNDARY,
  });
}

function clone(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return null;
  seen.add(value);
  const result = Array.isArray(value)
    ? value.map((entry) => clone(entry, seen))
    : Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, clone(entry, seen)]));
  seen.delete(value);
  return freeze(result);
}

function makeText(documentRoot, tag, className, value) {
  const element = documentRoot.createElement(tag);
  if (className) element.className = className;
  element.textContent = text(value);
  return element;
}

function requireElements(documentRoot) {
  const elements = Object.fromEntries(Object.entries(BLOCK_WORLD_SNAPSHOT_DOM_IDS).map(([key, id]) => [key, documentRoot.getElementById(id)]));
  const required = ["panel", "close", "export", "load", "preview", "apply", "replay", "reset", "input", "fileInput", "status", "blockCount", "contentCount", "validation", "json", "trace", "boundary"];
  const missing = required.filter((key) => !elements[key]);
  if (missing.length) throw new Error(`Block World snapshot mount points are missing: ${missing.join(", ")}`);
  return elements;
}

/**
 * Mount the data-only Block World snapshot surface. The adapter owns no
 * canonical state: it validates pasted or user-selected local JSON and asks
 * the host to apply the returned immutable draft to the renderer-only Block
 * World layer. File text is read in memory only; paths and file names are not
 * retained.
 */
export function createBlockWorldSnapshotConsole({
  documentRoot = globalThis.document,
  projection = null,
  getProjection = null,
  onOpen = null,
  onExport = null,
  onLoad = null,
  onPreview = null,
  onApply = null,
  onReplay = null,
  onReset = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("Block World snapshot console needs a document-like owner");
  const elements = requireElements(documentRoot);
  const {
    panel,
    close: closeButton,
    export: exportButton,
    load: loadButton,
    preview: previewButton,
    apply: applyButton,
    replay: replayButton,
    reset: resetButton,
    input: inputEl,
    fileInput,
    status: statusEl,
    blockCount: blockCountEl,
    contentCount: contentCountEl,
    validation: validationEl,
    json: jsonEl,
    trace: traceEl,
    boundary: boundaryEl,
  } = elements;

  let currentProjection = projection;
  let opened = panel.hidden !== true;
  let validation = validateBlockWorldSnapshot(createBlockWorldSnapshot(currentProjection));
  let activeSnapshot = validation.snapshot;
  let previewSnapshot = null;
  let appliedDraft = null;
  let trace = [];
  let replayCount = 0;
  let lastExport = null;
  let lastFileImport = null;

  function readProjection() {
    const next = typeof getProjection === "function" ? getProjection() : currentProjection;
    if (next?.draft && Array.isArray(next.draft.blocks)) return next.draft;
    return next ?? currentProjection;
  }

  function addTrace(action, detail = "") {
    trace = freeze([{ action, detail, localOnly: true }, ...trace].slice(0, 12).map((entry) => clone(entry)));
  }

  function setOpen(next, method = "api") {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.classList?.toggle?.("visible", opened);
    panel.setAttribute?.("aria-hidden", String(!opened));
    if (opened && method === "open") onOpen?.(getSnapshot());
  }

  function renderValidation() {
    validationEl.replaceChildren();
    if (validation.valid) {
      validationEl.appendChild(makeText(documentRoot, "div", "block-world-snapshot-valid", `VALID SNAPSHOT · ${validation.blockCount} BLOCKS · ${validation.contentCount} NESTED ITEMS`));
      asArray(validation.warnings).forEach((warning) => validationEl.appendChild(makeText(documentRoot, "div", "block-world-snapshot-warning", `WARNING · ${warning.message}`)));
      return;
    }
    asArray(validation.errors).forEach((error) => validationEl.appendChild(makeText(documentRoot, "div", "block-world-snapshot-error", `ERROR · ${error.path} · ${error.message}`)));
  }

  function renderTrace() {
    traceEl.replaceChildren();
    if (!trace.length) {
      traceEl.appendChild(makeText(documentRoot, "div", "block-world-snapshot-empty", "No snapshot actions yet."));
      return;
    }
    trace.forEach((entry, index) => traceEl.appendChild(makeText(documentRoot, "div", "block-world-snapshot-trace-row", `${index + 1} · ${String(entry.action).toUpperCase()} · ${entry.detail || "LOCAL ONLY"}`)));
  }

  function render() {
    blockCountEl.textContent = text(validation.blockCount, "0");
    contentCountEl.textContent = text(validation.contentCount, "0");
    statusEl.textContent = validation.valid
      ? appliedDraft
        ? `DRAFT APPLIED · ${validation.blockCount} BLOCKS · LOCAL ONLY`
        : previewSnapshot
          ? `PREVIEW READY · ${validation.blockCount} BLOCKS · LOCAL ONLY`
          : lastFileImport?.status === "reading"
            ? "READING LOCAL JSON · IN MEMORY ONLY"
            : lastFileImport?.status === "accepted"
              ? `FILE LOADED · ${validation.blockCount} BLOCKS · IN MEMORY ONLY`
          : lastExport
            ? `EXPORTED · ${validation.blockCount} BLOCKS · ${lastExport.downloadStatus === "downloaded" ? "DOWNLOAD READY" : "COPY JSON READY"} · LOCAL ONLY`
            : "READY · PASTE OR EXPORT A BLOCK SNAPSHOT · LOCAL ONLY"
      : lastFileImport?.status === "rejected"
        ? `FILE REJECTED · ${lastFileImport.reason ?? "FIX THE DATA-ONLY ERRORS"}`
        : "SNAPSHOT REJECTED · FIX THE DATA-ONLY ERRORS";
    jsonEl.textContent = validation.valid && activeSnapshot ? serializeBlockWorldSnapshot(activeSnapshot) : "Load a valid data-only Block World snapshot to show its canonical JSON.";
    boundaryEl.textContent = BLOCK_WORLD_SNAPSHOT_BOUNDARY;
    loadButton.disabled = !inputEl.value.trim();
    previewButton.disabled = !validation.valid;
    applyButton.disabled = !validation.valid;
    replayButton.disabled = !validation.valid;
    exportButton.disabled = !readProjection();
    renderValidation();
    renderTrace();
  }

  function loadSnapshot(value = inputEl.value, method = "button", details = null) {
    validation = validateBlockWorldSnapshot(value);
    activeSnapshot = validation.snapshot;
    previewSnapshot = null;
    appliedDraft = null;
    lastExport = null;
    lastFileImport = details?.fileImport ?? null;
    addTrace("load", validation.valid ? `${validation.blockCount} blocks` : "rejected");
    render();
    const result = clone({
      source: BLOCK_WORLD_SNAPSHOT_CONSOLE_SOURCE,
      action: "load",
      method,
      ...(details ?? {}),
      accepted: validation.valid,
      valid: validation.valid,
      validation,
      snapshot: activeSnapshot,
      ...LOCAL_FLAGS,
      boundary: BLOCK_WORLD_SNAPSHOT_BOUNDARY,
    });
    onLoad?.(result);
    return result;
  }

  function rejectFile(fileMeta, reason, code = "file-rejected", method = "file") {
    validation = fileValidationError(reason, code);
    activeSnapshot = null;
    previewSnapshot = null;
    appliedDraft = null;
    lastExport = null;
    lastFileImport = clone({
      status: "rejected",
      reason,
      code,
      bytes: fileMeta?.size ?? null,
      mime: fileMeta?.mime ?? null,
      readInMemory: false,
      localOnly: true,
    });
    addTrace("file-rejected", reason);
    render();
    const result = clone({
      source: BLOCK_WORLD_SNAPSHOT_CONSOLE_SOURCE,
      action: "file-load",
      method,
      accepted: false,
      valid: false,
      validation,
      file: lastFileImport,
      ...LOCAL_FLAGS,
      boundary: BLOCK_WORLD_SNAPSHOT_BOUNDARY,
    });
    onLoad?.(result);
    return result;
  }

  /** Read one user-selected JSON file in memory, then use the same validator
   * and local-draft path as pasted text. Paths and file names never enter the
   * returned snapshot or trace. */
  async function loadFile(file, method = "file") {
    const metadata = fileInfo(file);
    if (!file || !metadata.accepted) {
      return rejectFile(metadata, "Choose a .json file or application/json document.", "file-type", method);
    }
    if (metadata.size !== null && metadata.size > BLOCK_WORLD_SNAPSHOT_FILE_MAX_BYTES) {
      return rejectFile(metadata, `JSON file exceeds ${BLOCK_WORLD_SNAPSHOT_FILE_MAX_BYTES} bytes.`, "file-too-large", method);
    }
    if (typeof file.text !== "function") {
      return rejectFile(metadata, "This browser cannot read the selected JSON file in memory.", "file-read-unavailable", method);
    }
    lastFileImport = clone({ status: "reading", bytes: metadata.size, mime: metadata.mime, readInMemory: true, localOnly: true });
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
    if (payload.length > BLOCK_WORLD_SNAPSHOT_FILE_MAX_BYTES) {
      return rejectFile({ ...metadata, size: payload.length }, `JSON file exceeds ${BLOCK_WORLD_SNAPSHOT_FILE_MAX_BYTES} characters.`, "file-too-large", method);
    }
    inputEl.value = payload;
    const result = loadSnapshot(payload, method, {
      fileImport: {
        status: "accepted",
        bytes: payload.length,
        mime: metadata.mime,
        readInMemory: true,
        localOnly: true,
      },
      readInMemory: true,
    });
    return result;
  }

  function preview(method = "button") {
    if (!validation.valid) loadSnapshot(inputEl.value, "preview");
    if (!validation.valid || !activeSnapshot) return loadSnapshot(inputEl.value, method);
    previewSnapshot = clone({
      source: BLOCK_WORLD_SNAPSHOT_CONSOLE_SOURCE,
      action: "preview",
      snapshot: activeSnapshot,
      blockCount: validation.blockCount,
      contentCount: validation.contentCount,
      ...LOCAL_FLAGS,
      boundary: BLOCK_WORLD_SNAPSHOT_BOUNDARY,
    });
    addTrace("preview", `${validation.blockCount} blocks`);
    render();
    const result = clone({ ...previewSnapshot, method });
    onPreview?.(result);
    return result;
  }

  function apply(method = "button") {
    if (!validation.valid || !activeSnapshot) {
      const rejected = clone({ source: BLOCK_WORLD_SNAPSHOT_CONSOLE_SOURCE, action: "apply-local-draft", method, accepted: false, valid: validation.valid, validation, ...LOCAL_FLAGS, boundary: BLOCK_WORLD_SNAPSHOT_BOUNDARY });
      onApply?.(rejected);
      return rejected;
    }
    try {
      appliedDraft = applyBlockWorldSnapshot(readProjection(), activeSnapshot);
    } catch (error) {
      const rejected = clone({ source: BLOCK_WORLD_SNAPSHOT_CONSOLE_SOURCE, action: "apply-local-draft", method, accepted: false, valid: false, validation: { ...validation, valid: false, errors: [{ code: "apply-failed", path: "$", message: error.message }] }, ...LOCAL_FLAGS, boundary: BLOCK_WORLD_SNAPSHOT_BOUNDARY });
      statusEl.textContent = `APPLY BLOCKED · ${error.message} · LOCAL ONLY`;
      onApply?.(rejected);
      return rejected;
    }
    addTrace("apply-local-draft", `${appliedDraft.blocks.length} blocks`);
    render();
    const result = clone({
      source: BLOCK_WORLD_SNAPSHOT_CONSOLE_SOURCE,
      action: "apply-local-draft",
      method,
      accepted: true,
      valid: true,
      validation,
      snapshot: activeSnapshot,
      draft: appliedDraft,
      blockCount: appliedDraft.blocks.length,
      contentCount: appliedDraft.nestedContentCount,
      ...LOCAL_FLAGS,
      boundary: BLOCK_WORLD_SNAPSHOT_BOUNDARY,
    });
    onApply?.(result);
    return result;
  }

  function replay(method = "button") {
    replayCount += 1;
    appliedDraft = validation.valid && activeSnapshot ? applyBlockWorldSnapshot(readProjection(), activeSnapshot) : null;
    addTrace("replay", `run ${replayCount}`);
    render();
    const result = clone({ source: BLOCK_WORLD_SNAPSHOT_CONSOLE_SOURCE, action: "replay", method, replayCount, accepted: Boolean(appliedDraft), snapshot: activeSnapshot, draft: appliedDraft, ...LOCAL_FLAGS, boundary: BLOCK_WORLD_SNAPSHOT_BOUNDARY });
    onReplay?.(result);
    return result;
  }

  function reset(method = "button") {
    const nextSnapshot = createBlockWorldSnapshot(readProjection());
    validation = validateBlockWorldSnapshot(nextSnapshot);
    activeSnapshot = validation.snapshot;
    previewSnapshot = null;
    appliedDraft = null;
    lastExport = null;
    lastFileImport = null;
    replayCount = 0;
    inputEl.value = serializeBlockWorldSnapshot(activeSnapshot);
    addTrace("reset", "current projection");
    render();
    const result = clone({ source: BLOCK_WORLD_SNAPSHOT_CONSOLE_SOURCE, action: "reset", method, snapshot: activeSnapshot, validation, ...LOCAL_FLAGS, boundary: BLOCK_WORLD_SNAPSHOT_BOUNDARY });
    onReset?.(result);
    return result;
  }

  function exportSnapshot(method = "button") {
    const snapshot = createBlockWorldSnapshot(readProjection());
    const payload = serializeBlockWorldSnapshot(snapshot);
    inputEl.value = payload;
    validation = validateBlockWorldSnapshot(payload);
    activeSnapshot = validation.snapshot;
    previewSnapshot = null;
    appliedDraft = null;
    let downloadStatus = "unavailable";
    let reason = "browser-download-unavailable";
    try {
      const BlobCtor = globalThis.Blob;
      const URLApi = globalThis.URL;
      if (typeof BlobCtor !== "function" || !URLApi || typeof URLApi.createObjectURL !== "function") throw new Error("download APIs unavailable");
      const anchor = documentRoot.createElement("a");
      if (!anchor || typeof anchor.click !== "function") throw new Error("download anchor unavailable");
      const objectUrl = URLApi.createObjectURL(new BlobCtor([payload], { type: "application/json" }));
      anchor.href = objectUrl;
      anchor.download = BLOCK_WORLD_SNAPSHOT_DOWNLOAD_FILENAME;
      anchor.setAttribute?.("download", BLOCK_WORLD_SNAPSHOT_DOWNLOAD_FILENAME);
      anchor.click();
      URLApi.revokeObjectURL?.(objectUrl);
      downloadStatus = "downloaded";
      reason = "user-triggered-local-json";
    } catch {
      // The JSON remains in the textarea so an unsupported browser can still
      // copy it manually; no external upload or file read is attempted.
    }
    lastExport = clone({ source: BLOCK_WORLD_SNAPSHOT_CONSOLE_SOURCE, action: "export", method, filename: BLOCK_WORLD_SNAPSHOT_DOWNLOAD_FILENAME, bytes: payload.length, downloadStatus, reason, validated: validation.valid, ...LOCAL_FLAGS, boundary: BLOCK_WORLD_SNAPSHOT_BOUNDARY });
    addTrace("export", `${payload.length} bytes · ${downloadStatus}`);
    render();
    onExport?.(lastExport);
    return clone({ ...lastExport, snapshot: activeSnapshot, payload });
  }

  function syncProjection(nextProjection) {
    currentProjection = nextProjection;
    if (!appliedDraft) reset("sync");
    return getSnapshot();
  }

  function getSnapshot() {
    return clone({
      source: BLOCK_WORLD_SNAPSHOT_CONSOLE_SOURCE,
      snapshotSource: BLOCK_WORLD_SNAPSHOT_SOURCE,
      opened,
      snapshot: activeSnapshot,
      validation,
      preview: previewSnapshot,
      draft: appliedDraft,
      input: inputEl.value,
      trace,
      replayCount,
      lastExport,
      lastFileImport,
      ...LOCAL_FLAGS,
      boundary: BLOCK_WORLD_SNAPSHOT_BOUNDARY,
    });
  }

  closeButton.addEventListener("click", () => setOpen(false, "close"));
  exportButton.addEventListener("click", () => exportSnapshot("button"));
  loadButton.addEventListener("click", () => loadSnapshot(inputEl.value, "button"));
  fileInput.addEventListener?.("change", () => {
    const file = fileInput.files?.[0] ?? null;
    // Clear the picker immediately so the same file can be selected again;
    // the File object remains available to the in-memory read below.
    try { fileInput.value = ""; } catch { /* best effort */ }
    void loadFile(file, "file");
  });
  previewButton.addEventListener("click", () => preview("button"));
  applyButton.addEventListener("click", () => apply("button"));
  replayButton.addEventListener("click", () => replay("button"));
  resetButton.addEventListener("click", () => reset("button"));
  inputEl.addEventListener?.("input", () => { statusEl.textContent = "JSON CHANGED · PRESS LOAD JSON TO VALIDATE"; });
  if (!inputEl.value) inputEl.value = serializeBlockWorldSnapshot(activeSnapshot);
  boundaryEl.textContent = BLOCK_WORLD_SNAPSHOT_BOUNDARY;
  render();
  setOpen(opened);

  return freeze({
    open: () => setOpen(true, "api"),
    close: () => setOpen(false, "api"),
    toggle: () => setOpen(!opened, "api"),
    exportSnapshot,
    export: exportSnapshot,
    loadSnapshot,
    load: loadSnapshot,
    loadFile,
    importFile: loadFile,
    preview,
    apply,
    replay,
    reset,
    syncProjection,
    setProjection: syncProjection,
    getSnapshot,
  });
}

export const createBlockWorldSnapshotLayer = createBlockWorldSnapshotConsole;
export const createBlockSnapshotConsole = createBlockWorldSnapshotConsole;

export default createBlockWorldSnapshotConsole;
