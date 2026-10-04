import {
  WARDROBE_ATELIER_BOUNDARY,
  WARDROBE_ATELIER_CONSOLE_SOURCE,
  WARDROBE_ATELIER_MAX_IMPORT_BYTES,
  WARDROBE_ERROR_IMMUTABLE,
  createWardrobeAtelier,
} from "../domains/wardrobe-atelier.js?v=20261003-skin360";

export { WARDROBE_ATELIER_CONSOLE_SOURCE };
export const WARDROBE_RENDER_SOURCE = WARDROBE_ATELIER_CONSOLE_SOURCE;
export const WARDROBE_STORAGE_KEY = "matumbo.wardrobe-atelier.v2";

const deepFreeze = (value) => {
  if (Array.isArray(value)) value.forEach(deepFreeze);
  else if (value && typeof value === "object") Object.values(value).forEach(deepFreeze);
  return value && typeof value === "object" ? Object.freeze(value) : value;
};

function element(documentRoot, tag, className, value) {
  const node = documentRoot.createElement(tag);
  if (className) node.className = className;
  if (value !== undefined) node.textContent = String(value);
  return node;
}

function paletteSwatches(documentRoot, palette) {
  const wrap = element(documentRoot, "span", "wardrobe-atelier-swatches");
  const colors = String(palette ?? "").match(/#[0-9a-fA-F]{6}/g) ?? [];
  colors.slice(0, 4).forEach((color) => {
    const swatch = element(documentRoot, "span", "wardrobe-atelier-swatch");
    swatch.setAttribute("style", `background:${color}`);
    swatch.setAttribute("aria-hidden", "true");
    wrap.append(swatch);
  });
  return wrap;
}

export function createWardrobeAtelierConsole({
  documentRoot = globalThis.document,
  atelier = null,
  onEquip = null,
  onReplay = null,
  onReset = null,
  onChange = null,
  storage = undefined,
} = {}) {
  const panel = documentRoot?.getElementById?.("wardrobe-atelier-console");
  const closeButton = documentRoot?.getElementById?.("wardrobe-atelier-close");
  const statusEl = documentRoot?.getElementById?.("wardrobe-atelier-status");
  const gridEl = documentRoot?.getElementById?.("wardrobe-atelier-grid");
  const detailEl = documentRoot?.getElementById?.("wardrobe-atelier-detail");
  const formEl = documentRoot?.getElementById?.("wardrobe-atelier-form");
  const nameInput = documentRoot?.getElementById?.("wardrobe-atelier-name");
  const paletteInput = documentRoot?.getElementById?.("wardrobe-atelier-palette");
  const motifInput = documentRoot?.getElementById?.("wardrobe-atelier-motif");
  const descriptionInput = documentRoot?.getElementById?.("wardrobe-atelier-description");
  const createButton = documentRoot?.getElementById?.("wardrobe-atelier-create");
  const resetButton = documentRoot?.getElementById?.("wardrobe-atelier-reset");
  const traceEl = documentRoot?.getElementById?.("wardrobe-atelier-trace");
  const boundaryEl = documentRoot?.getElementById?.("wardrobe-atelier-boundary");
  if (!panel || !closeButton || !statusEl || !gridEl || !detailEl || !formEl
    || !nameInput || !paletteInput || !motifInput || !descriptionInput
    || !createButton || !resetButton || !traceEl || !boundaryEl) {
    throw new Error("Wardrobe Atelier console mount points are missing");
  }

  const studio = atelier ?? createWardrobeAtelier();
  let opened = panel.hidden !== true;
  let selectedId = null;
  let statusMessage = "", storageError = "", saved = false, invalidSaved = false, storageReadError = false, lastSavedRaw = null, needsPersonSync = false;
  let store = storage;
  if (store === undefined) {
    try { store = documentRoot.defaultView?.localStorage ?? globalThis.localStorage ?? null; }
    catch { store = null; storageError = "Browser storage is unavailable; designs remain in memory. Export a backup."; }
  }

  function message(value) { statusMessage = value; render(); }
  function checkWritable() {
    if (!store) return true;
    try {
      if (store.getItem(WARDROBE_STORAGE_KEY) !== lastSavedRaw) {
        storageError = "A newer wardrobe is saved in another tab. Export this session or reload saved wardrobe before editing.";
        saved = false;render();return false;
      }
      storageReadError = false;
    } catch { storageError = "Cannot read browser storage; changes remain in memory. Export a backup.";saved = false;storageReadError = true; }
    return true;
  }
  function persist(replaceInvalid = false) {
    saved = false;
    if (!store || !checkWritable() || storageReadError || (invalidSaved && !replaceInvalid)) return false;
    try {
      const raw = JSON.stringify({ version: 1, source: "wardrobe-local-workspace", atelier: studio.exportState(), selectedId });
      if (new TextEncoder().encode(raw).length > WARDROBE_ATELIER_MAX_IMPORT_BYTES) throw new RangeError("Wardrobe backup exceeds 512 KiB");
      store.setItem(WARDROBE_STORAGE_KEY, raw);
      lastSavedRaw = raw;storageError = "";invalidSaved = false;saved = true;return true;
    } catch (error) { storageError = `NOT SAVED · ${error.message}. Designs remain in memory; export a backup.`;return false; }
  }
  function decodeBackup(value) {
    const raw = typeof value === "string" ? value : JSON.stringify(value);
    if (new TextEncoder().encode(raw).length > WARDROBE_ATELIER_MAX_IMPORT_BYTES) throw new RangeError("Wardrobe backup exceeds 512 KiB");
    const data = typeof value === "string" ? JSON.parse(value) : value;
    if (data?.source === "wardrobe-local-workspace") {
      if (data.version !== 1 || !data.atelier) throw new TypeError("Unsupported wardrobe workspace backup");
      return data;
    }
    return { atelier: data, selectedId: data?.equippedId ?? null };
  }
  function restoreBackup(value) {
    const data = decodeBackup(value);
    studio.importState(data.atelier);
    const priorSelected = data.atelier.outfits.find(outfit => outfit.id === data.selectedId);
    selectedId = studio.getOutfit(data.selectedId)?.id
      ?? (priorSelected?.origin === "starter" ? studio.listOutfits().find(outfit => outfit.key === priorSelected.key && outfit.origin === "starter")?.id : null)
      ?? studio.getEquipped()?.id ?? null;
    needsPersonSync = true;
  }
  function loadSaved(method = "api", initial = false) {
    if (!store) { if (!initial) message("Browser storage is unavailable; import a JSON backup instead.");return null; }
    let raw = null;
    try {
      raw = store.getItem(WARDROBE_STORAGE_KEY);
      if (!raw) { lastSavedRaw = raw;if (!initial) message("No saved wardrobe yet. Create a design or import a backup.");return null; }
      restoreBackup(raw);
      lastSavedRaw = raw;storageError = "";invalidSaved = false;saved = true;
      statusMessage = "SAVED WARDROBE RESTORED";
      if (!initial) { render();synchronizeEquipped(method);return publish("restore", method); }
    } catch (error) {
      if (initial) { lastSavedRaw = raw;invalidSaved = raw !== null; }
      storageError = `Stored wardrobe could not be loaded: ${error.message}. Current designs were preserved. Reset or import a valid backup to replace it.`;
      saved = false;if (!initial) render();return null;
    }
  }
  loadSaved("initial", true);

  const backups = element(documentRoot, "details", "wardrobe-atelier-backups");
  backups.append(element(documentRoot, "summary", "wardrobe-atelier-section-label", "Saved designs & backups"));
  const backupStyle = element(documentRoot, "style");
  backupStyle.textContent = ".wardrobe-atelier-backups{padding:10px;border:1px solid rgba(125,210,240,.22);border-radius:8px;background:rgba(5,20,30,.4)}.wardrobe-atelier-backups summary{cursor:pointer;min-height:28px;color:#c6eeff}.wardrobe-atelier-backups .wardrobe-atelier-card-actions{margin:8px 0}.wardrobe-atelier-backups label{display:grid;gap:8px;color:#accbd8;font-size:11px}.wardrobe-atelier-backups input{max-width:100%;color:#d9f5ff;min-height:40px}.wardrobe-atelier-backups input::file-selector-button{padding:8px;border-radius:6px;border:1px solid #6589a0;background:#143246;color:#eef7ff}";
  backups.append(backupStyle);
  const backupTools = element(documentRoot, "div", "wardrobe-atelier-card-actions");
  const exportButton = element(documentRoot, "button", "wardrobe-atelier-customize", "Export wardrobe JSON");exportButton.type = "button";
  const reloadButton = element(documentRoot, "button", "wardrobe-atelier-customize", "Reload saved wardrobe");reloadButton.type = "button";
  const importLabel = element(documentRoot, "label", "wardrobe-atelier-section-label", "Import wardrobe JSON (max 512 KiB)");
  const importInput = element(documentRoot, "input");importInput.type = "file";importInput.accept = ".json,application/json";importInput.setAttribute("aria-label", "Import wardrobe JSON");
  importLabel.append(importInput);backupTools.append(exportButton, reloadButton);backups.append(backupTools, importLabel);
  panel.append(backups);

  function snapshot(action = "read", method = "api") {
    return deepFreeze({
      source: WARDROBE_ATELIER_CONSOLE_SOURCE,
      action,
      method,
      opened,
      selectedId,
      atelier: studio.getSnapshot(),
      localOnly: true,
      simulation: true,
      persistence: saved,
      storageAvailable: Boolean(store),
      storageError,
      marketplace: false,
      purchase: false,
      transfer: false,
      externalNetwork: false,
      executable: false,
      boundary: WARDROBE_ATELIER_BOUNDARY,
    });
  }

  function publish(action, method) {
    const next = snapshot(action, method);
    if (["create", "equip", "delete", "customize", "reset", "import", "restore", "replay"].includes(action)) {
      try { onChange?.(studio.createContribution()); }
      catch { statusMessage += " · WORLD PROJECTION SYNC SKIPPED";render(); }
    }
    if (action === "replay") onReplay?.(next);
    if (action === "reset") onReset?.(next);
    return next;
  }

  function synchronizeEquipped(method, event = null, next = null) {
    const equipped = studio.getEquipped();
    if (!equipped) { needsPersonSync = false;return false; }
    // A consumer may still be restoring its own saved appearance. Retain the
    // pending selection until it explicitly accepts the sync; retries read
    // the equipped outfit without manufacturing another wardrobe event.
    needsPersonSync = true;
    try {
      needsPersonSync = onEquip?.(equipped, next ?? snapshot("equip", method), event) === false;
      return !needsPersonSync;
    } catch { statusMessage += " · PERSON SYNC SKIPPED";render();return false; }
  }

  function equipSelected(method = "button") {
    if (!checkWritable()) return null;
    // A dangling selection (outfit deleted elsewhere) fails deterministically
    // instead of silently equipping something the user did not pick.
    if (selectedId && !studio.getOutfit(selectedId)) {
      selectedId = null;
      render();
      message("OUTFIT NOT FOUND · SELECTION CLEARED");
      return null;
    }
    const outfit = selectedId ? studio.getOutfit(selectedId) : studio.getEquipped();
    if (!outfit) {
      message("NOTHING TO EQUIP · SELECT AN OUTFIT FIRST");
      return null;
    }
    // Atomic swap, indicator only: the current look stays visible until the
    // domain commits the new one in a single synchronous step.
    const { outfit: equipped, event } = studio.equipOutfit(outfit.id);
    persist();message(`EQUIPPED · ${equipped.name.toUpperCase()} · LOCAL PREVIEW ONLY`);
    const next = publish("equip", method);
    synchronizeEquipped(method, event, next);
    return next;
  }

  function deleteSelected(method = "button") {
    if (!checkWritable()) return null;
    const outfit = selectedId ? studio.getOutfit(selectedId) : null;
    if (!outfit) {
      message("NOTHING TO DELETE · SELECT AN OUTFIT FIRST");
      return null;
    }
    try {
      const { deleted, outfit: equipped, event } = studio.deleteOutfit(outfit.id);
      selectedId = null;
      if (event) {
        statusMessage = `DELETED · ${deleted.name.toUpperCase()} · ${equipped.name.toUpperCase()} EQUIPPED INSTEAD · LOCAL ONLY`;
      } else {
        statusMessage = `DELETED · ${deleted.name.toUpperCase()} · LOCAL ONLY`;
      }
      persist();render();
      if (event) synchronizeEquipped(method, event);
      return publish("delete", method);
    } catch (error) {
      if (error?.code === WARDROBE_ERROR_IMMUTABLE) {
        statusMessage = "SYSTEM LOOK · CANNOT DELETE · CUSTOMIZE TO MAKE YOUR OWN";
      } else {
        statusMessage = `DELETE BLOCKED · ${String(error?.message ?? error).toUpperCase().slice(0, 120)}`;
      }
      render();
      return null;
    }
  }

  function customizeSelected(method = "button") {
    if (!checkWritable()) return null;
    const outfit = selectedId ? studio.getOutfit(selectedId) : null;
    if (!outfit) {
      message("NOTHING TO CUSTOMIZE · SELECT AN OUTFIT FIRST");
      return null;
    }
    try {
      const derived = studio.customizeOutfit(outfit.id);
      selectedId = derived.id;
      persist();statusMessage = `CUSTOMIZED · ${derived.name.toUpperCase()} · YOUR DESIGN · FICTIONAL ONLY`;
      render();
      return publish("customize", method);
    } catch (error) {
      statusMessage = `CUSTOMIZE BLOCKED · ${String(error?.message ?? error).toUpperCase().slice(0, 120)}`;
      render();
      return null;
    }
  }

  function renderDetail() {
    detailEl.replaceChildren();
    const outfit = selectedId ? studio.getOutfit(selectedId) : null;
    if (!outfit) {
      detailEl.append(element(documentRoot, "div", "wardrobe-atelier-empty", "Select an outfit to inspect it, or equip it straight from the gallery."));
      return;
    }
    const card = element(documentRoot, "div", "wardrobe-atelier-card");
    card.append(element(documentRoot, "div", "wardrobe-atelier-card-id", outfit.id));
    const nameRow = element(documentRoot, "div", "wardrobe-atelier-card-namerow");
    nameRow.append(element(documentRoot, "strong", "wardrobe-atelier-card-name", outfit.name));
    nameRow.append(paletteSwatches(documentRoot, outfit.palette));
    card.append(nameRow);
    card.append(element(documentRoot, "div", "wardrobe-atelier-card-meta", `${outfit.motif.toUpperCase()} · ${outfit.palette}`));
    card.append(element(documentRoot, "div", "wardrobe-atelier-card-origin",
      outfit.origin === "starter" ? "SYSTEM LOOK · IMMUTABLE" : "YOUR DESIGN · CUSTOM"));
    if (outfit.description) card.append(element(documentRoot, "p", "wardrobe-atelier-card-description", outfit.description));
    if (outfit.pieces.length) {
      const pieces = element(documentRoot, "div", "wardrobe-atelier-pieces");
      pieces.append(element(documentRoot, "div", "wardrobe-atelier-section-label", "PIECES"));
      outfit.pieces.forEach((piece) => pieces.append(element(documentRoot, "div", "wardrobe-atelier-piece-row", piece)));
      card.append(pieces);
    }
    if (outfit.studioOutfitId) {
      card.append(element(documentRoot, "div", "wardrobe-atelier-studio-note", "Maps to a Person Studio look — equipping also dresses the 3D person."));
    }
    const actions = element(documentRoot, "div", "wardrobe-atelier-card-actions");
    const equipButton = element(documentRoot, "button", "wardrobe-atelier-equip", outfit.equipped ? "EQUIPPED · WEARING NOW" : "Equip this look");
    equipButton.type = "button";
    equipButton.disabled = outfit.equipped;
    equipButton.addEventListener("click", () => equipSelected("button"));
    actions.append(equipButton);
    const customizeButton = element(documentRoot, "button", "wardrobe-atelier-customize", "Customize · make your own");
    customizeButton.type = "button";
    customizeButton.addEventListener("click", () => customizeSelected("button"));
    actions.append(customizeButton);
    if (outfit.origin !== "starter") {
      const deleteButton = element(documentRoot, "button", "wardrobe-atelier-delete", "Delete this design");
      deleteButton.type = "button";
      deleteButton.addEventListener("click", () => deleteSelected("button"));
      actions.append(deleteButton);
    }
    card.append(actions);
    detailEl.append(card);
  }

  function render() {
    const state = studio.getSnapshot();
    const equippedName = state.equipped?.name ?? "none";
    statusEl.textContent = `${statusMessage ? statusMessage + " · " : ""}${state.outfitCount} OUTFITS · WEARING ${equippedName.toUpperCase()} · ${saved ? "SAVED IN THIS BROWSER" : "IN MEMORY"}${storageError ? " · " + storageError : ""}`;
    gridEl.replaceChildren();
    if (!state.outfitCount) {
      gridEl.append(element(documentRoot, "div", "wardrobe-atelier-empty", "The wardrobe is empty. Design a fictional look below."));
    }
    studio.listOutfits().forEach((outfit) => {
      const button = element(documentRoot, "button", "wardrobe-atelier-outfit");
      button.type = "button";
      button.dataset.outfitId = outfit.id;
      button.setAttribute("aria-pressed", String(outfit.id === selectedId));
      button.append(
        element(documentRoot, "strong", "wardrobe-atelier-outfit-name", outfit.name),
        paletteSwatches(documentRoot, outfit.palette),
        element(documentRoot, "span", "wardrobe-atelier-outfit-meta", `${outfit.motif}${outfit.equipped ? " · WEARING" : ""}`),
      );
      button.addEventListener("click", () => {
        selectedId = outfit.id;
        statusMessage = "";persist();
        render();
        publish("select", "button");
      });
      gridEl.append(button);
    });
    renderDetail();
    traceEl.replaceChildren();
    if (!state.trace.length) traceEl.append(element(documentRoot, "div", "wardrobe-atelier-empty", "No wardrobe actions yet."));
    [...state.trace].reverse().forEach((entry) => {
      traceEl.append(element(documentRoot, "div", "wardrobe-atelier-trace-row", `${entry.seq} · ${entry.action.toUpperCase()} · ${entry.detail || entry.outfitId}`));
    });
    boundaryEl.textContent = WARDROBE_ATELIER_BOUNDARY;
  }

  function setOpen(next, method = "api") {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.setAttribute("aria-hidden", String(!opened));
    if (opened) { render();if (needsPersonSync) synchronizeEquipped(method); }
    return publish(opened ? "open" : "close", method);
  }

  function create(input, method = "api") {
    if (!checkWritable()) return null;
    try {
      const outfit = studio.createOutfit(input);
      selectedId = outfit.id;
      persist();message(`DESIGNED · ${outfit.name.toUpperCase()} · FICTIONAL ONLY`);
      return publish("create", method);
    } catch (error) {
      message(`DESIGN BLOCKED · ${String(error?.message ?? error).toUpperCase().slice(0, 120)}`);
      if (method !== "button") throw error;
      return null;
    }
  }
  createButton.addEventListener("click", () => {
    const result = create({ name: nameInput.value, palette: paletteInput.value, motif: motifInput.value, description: descriptionInput.value, pieces: [] }, "button");
    if (result) nameInput.value = paletteInput.value = motifInput.value = descriptionInput.value = "";
  });

  function reset(method = "api") {
    if (!checkWritable()) return null;
    studio.reset();selectedId = null;persist(true);
    message("WARDROBE RESET · STARTER SET RESTORED");synchronizeEquipped(method);
    return publish("reset", method);
  }
  function importBackup(value, method = "api") {
    if (!checkWritable()) return null;
    try {
      restoreBackup(value);persist(true);message("WARDROBE BACKUP IMPORTED");synchronizeEquipped(method);
      return publish("import", method);
    } catch (error) { message(`IMPORT BLOCKED · ${error.message}`);if (method !== "button") throw error;return null; }
  }
  function exportBackup() { return deepFreeze({ version: 1, source: "wardrobe-local-workspace", atelier: studio.exportState(), selectedId }); }
  exportButton.addEventListener("click", () => {
    let url = null;
    const view = documentRoot.defaultView ?? globalThis, urlApi = view.URL ?? globalThis.URL;
    try {
      const BlobType = view.Blob ?? globalThis.Blob;
      url = urlApi.createObjectURL(new BlobType([JSON.stringify(exportBackup())], { type: "application/json" }));
      const anchor = element(documentRoot, "a");anchor.href = url;anchor.download = "matumbo-wardrobe.json";
      documentRoot.body?.append?.(anchor);anchor.click();anchor.remove?.();
      message("WARDROBE JSON EXPORTED · KEEP THE FILE AS YOUR BACKUP");
    } catch (error) { message(`EXPORT FAILED · ${error.message}`); }
    finally { if (url) (view.setTimeout ?? globalThis.setTimeout)(() => urlApi.revokeObjectURL(url), 1000); }
  });
  reloadButton.addEventListener("click", () => loadSaved("button"));
  importInput.addEventListener("change", async () => {
    const file = importInput.files?.[0];if (!file) return;
    try { if (file.size > WARDROBE_ATELIER_MAX_IMPORT_BYTES) throw new RangeError("Wardrobe backup exceeds 512 KiB");importBackup(await file.text(), "button"); }
    catch (error) { message(`IMPORT BLOCKED · ${error.message}`); }
    finally { importInput.value = ""; }
  });

  closeButton.addEventListener("click", () => setOpen(false, "button"));
  resetButton.addEventListener("click", () => reset("button"));
  render();

  return Object.freeze({
    open: (method = "api") => setOpen(true, method),
    close: (method = "api") => setOpen(false, method),
    reset,
    select: (outfitId, method = "api") => { selectedId = outfitId;statusMessage = "";persist();render();return publish("select", method); },
    create,
    equip: (outfitId = selectedId, method = "api") => {
      if (outfitId) selectedId = outfitId;
      return equipSelected(method);
    },
    delete: (outfitId = selectedId, method = "api") => {
      if (outfitId) selectedId = outfitId;
      return deleteSelected(method);
    },
    customize: (outfitId = selectedId, method = "api") => {
      if (outfitId) selectedId = outfitId;
      return customizeSelected(method);
    },
    replay: (method = "api") => {
      if (!checkWritable()) return null;
      studio.importState(studio.exportState());persist();message("WARDROBE REBUILT · YOUR DESIGNS PRESERVED");synchronizeEquipped(method);return publish("replay", method);
    },
    exportBackup,
    importBackup,
    reloadSaved: loadSaved,
    syncEquipped: (method = "api") => needsPersonSync ? synchronizeEquipped(method) : false,
    createContribution: () => studio.createContribution(),
    getSnapshot: () => snapshot(),
    boundary: WARDROBE_ATELIER_BOUNDARY,
  });
}

export default createWardrobeAtelierConsole;
