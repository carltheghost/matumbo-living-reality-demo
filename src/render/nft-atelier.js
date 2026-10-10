import {
  NFT_ATELIER_BOUNDARY,
  NFT_ATELIER_CONSOLE_SOURCE,
  createNftAtelier,
} from "../domains/nft-atelier.js?v=20261003-skin360";

export { NFT_ATELIER_CONSOLE_SOURCE };
export const NFT_ATELIER_RENDER_SOURCE = NFT_ATELIER_CONSOLE_SOURCE;

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

function traitRow(documentRoot, trait, value) {
  const row = element(documentRoot, "div", "nft-atelier-trait");
  row.append(element(documentRoot, "span", "nft-atelier-trait-name", trait));
  row.append(element(documentRoot, "span", "nft-atelier-trait-value", value));
  return row;
}

export function createNftAtelierConsole({
  documentRoot = globalThis.document,
  windowRoot = globalThis.window ?? globalThis,
  atelier = null,
  onSelect = null,
  onReplay = null,
  onReset = null,
  onChange = null,
} = {}) {
  const panel = documentRoot?.getElementById?.("nft-atelier-console");
  const closeButton = documentRoot?.getElementById?.("nft-atelier-close");
  const statusEl = documentRoot?.getElementById?.("nft-atelier-status");
  const galleryEl = documentRoot?.getElementById?.("nft-atelier-gallery");
  const detailEl = documentRoot?.getElementById?.("nft-atelier-detail");
  const nameInput = documentRoot?.getElementById?.("nft-atelier-name");
  const collectionInput = documentRoot?.getElementById?.("nft-atelier-collection");
  const descriptionInput = documentRoot?.getElementById?.("nft-atelier-description");
  const mintButton = documentRoot?.getElementById?.("nft-atelier-mint");
  const resetButton = documentRoot?.getElementById?.("nft-atelier-reset");
  const traceEl = documentRoot?.getElementById?.("nft-atelier-trace");
  const boundaryEl = documentRoot?.getElementById?.("nft-atelier-boundary");
  if (!panel || !closeButton || !statusEl || !galleryEl || !detailEl || !nameInput
    || !collectionInput || !descriptionInput || !mintButton || !resetButton || !traceEl || !boundaryEl) {
    throw new Error("NFT Atelier console mount points are missing");
  }

  const studio = atelier ?? createNftAtelier();
  let opened = panel.hidden !== true;
  let selectedId = null;
  let feedback = "";
  const backupControls = element(documentRoot, "details", "nft-atelier-backup");
  backupControls.append(element(documentRoot, "summary", "nft-atelier-section-label", "Save or restore your local collection"));
  backupControls.append(element(documentRoot, "p", "nft-atelier-empty", "Export before replacing or resetting a collection. A backup includes your designs and locally burned records. Import replaces the local collection after validation; it does not create a chain asset."));
  const backupInput = element(documentRoot, "textarea", "nft-atelier-text-input");
  backupInput.setAttribute("aria-label", "Atelier backup JSON");
  backupInput.setAttribute("placeholder", "Paste an exported Atelier JSON backup here");
  backupInput.setAttribute("rows", "5");
  backupInput.setAttribute("maxlength", "500000");
  backupInput.setAttribute("style", "width:100%;max-width:100%;min-height:130px;box-sizing:border-box;padding:12px;border:1px solid rgba(255,209,102,.3);border-radius:8px;background:#081521;color:#e7d9b4;font:12px/1.5 ui-monospace,monospace;resize:vertical");
  backupInput.dataset.nftBackup = "true";
  const exportButton = element(documentRoot, "button", "nft-atelier-action", "Export collection backup");
  const importButton = element(documentRoot, "button", "nft-atelier-action", "Replace collection from backup");
  exportButton.type = importButton.type = "button";
  exportButton.dataset.nftExport = "true";
  importButton.dataset.nftImport = "true";
  backupControls.append(exportButton, backupInput, importButton);
  panel.append(backupControls);

  function setFeedback(message) { feedback = String(message); render(); }

  function snapshot(action = "read", method = "api") {
    return deepFreeze({
      source: NFT_ATELIER_CONSOLE_SOURCE,
      action,
      method,
      opened,
      selectedId,
      atelier: studio.getSnapshot(),
      localOnly: true,
      simulation: true,
      persistence: studio.getSnapshot().persistence?.mode === "browser",
      wallet: false,
      chain: false,
      transfer: false,
      externalNetwork: false,
      executable: false,
      boundary: NFT_ATELIER_BOUNDARY,
    });
  }

  function publish(action, method) {
    const next = snapshot(action, method);
    if (action === "select") onSelect?.(next);
    if (action === "replay") onReplay?.(next);
    if (action === "reset") onReset?.(next);
    if (["mint", "burn", "reset", "import"].includes(action)) onChange?.(studio.createContribution(), next);
    return next;
  }

  function renderDetail() {
    detailEl.replaceChildren();
    const piece = selectedId ? studio.get(selectedId) : null;
    if (!piece) {
      detailEl.append(element(documentRoot, "div", "nft-atelier-empty", "Select a piece to inspect its fictional provenance."));
      return;
    }
    // Rendering is a read. Inspection is recorded once for a deliberate selection.
    const view = studio.inspect(piece.id, { record: false });
    const card = element(documentRoot, "div", "nft-atelier-card");
    card.append(element(documentRoot, "div", "nft-atelier-card-id", piece.id));
    card.append(element(documentRoot, "strong", "nft-atelier-card-name", piece.name));
    card.append(element(documentRoot, "div", "nft-atelier-card-meta", `${piece.collection} · ${piece.rarity.toUpperCase()} · ${piece.edition}`));
    if (piece.description) card.append(element(documentRoot, "p", "nft-atelier-card-description", piece.description));
    const traits = element(documentRoot, "div", "nft-atelier-traits");
    piece.attributes.forEach(({ trait, value }) => traits.append(traitRow(documentRoot, trait, value)));
    if (piece.attributes.length) card.append(traits);
    const provenance = element(documentRoot, "div", "nft-atelier-provenance");
    provenance.append(element(documentRoot, "div", "nft-atelier-section-label", "FICTIONAL PROVENANCE"));
    view.provenance.forEach((entry) => {
      provenance.append(element(documentRoot, "div", "nft-atelier-provenance-row", `${entry.event.toUpperCase()} · ${entry.at} · ${entry.note}`));
    });
    card.append(provenance);
    const burnButton = element(documentRoot, "button", "nft-atelier-burn", piece.burned ? "BURNED · VOID LOCALLY" : "Burn (local rehearsal)");
    burnButton.type = "button";
    burnButton.disabled = piece.burned;
    burnButton.addEventListener("click", () => {
      try { studio.burn(piece.id); feedback = `Burned locally: ${piece.name}. The voided design remains in your backup.`; }
      catch (error) { feedback = `Burn blocked: ${error?.message ?? error}`; }
      render();
      publish("burn", "button");
    });
    card.append(burnButton);
    detailEl.append(card);
  }

  function render() {
    const state = studio.getSnapshot();
    const saving = state.persistence ?? { mode: "memory", status: "session-only", error: null };
    const storageLabel = saving.mode === "browser" && ["saved", "restored"].includes(saving.status)
      ? "SAVED IN THIS BROWSER" : saving.status === "held" ? "SAVED COLLECTION HELD" : "IN MEMORY · EXPORT TO KEEP";
    statusEl.textContent = `${feedback ? `${feedback} · ` : ""}${state.minted} PIECES · ${state.burned} BURNED · ${storageLabel}${saving.error ? ` · ${saving.error}` : ""}`;
    statusEl.setAttribute("role", "status");
    galleryEl.replaceChildren();
    if (!state.minted) {
      galleryEl.append(element(documentRoot, "div", "nft-atelier-empty", "The atelier is empty. Mint a fictional piece below."));
    }
    studio.list().forEach((piece) => {
      const button = element(documentRoot, "button", "nft-atelier-piece");
      button.type = "button";
      button.dataset.pieceId = piece.id;
      button.setAttribute("aria-pressed", String(piece.id === selectedId));
      button.append(
        element(documentRoot, "strong", "nft-atelier-piece-name", piece.name),
        element(documentRoot, "span", "nft-atelier-piece-meta", `${piece.collection} · ${piece.rarity.toUpperCase()}`),
        element(documentRoot, "span", "nft-atelier-piece-id", piece.id),
      );
      button.addEventListener("click", () => {
        selectedId = piece.id;
        try { studio.inspect(piece.id); feedback = `Inspecting ${piece.name}. Fictional provenance only.`; }
        catch (error) { feedback = `Inspecting ${piece.name} without editing history: ${error?.message ?? error}`; }
        render();
        publish("select", "button");
      });
      galleryEl.append(button);
    });
    renderDetail();
    traceEl.replaceChildren();
    if (!state.trace.length) traceEl.append(element(documentRoot, "div", "nft-atelier-empty", "No atelier actions yet."));
    [...state.trace].reverse().forEach((entry) => {
      traceEl.append(element(documentRoot, "div", "nft-atelier-trace-row", `${entry.seq} · ${entry.action.toUpperCase()} · ${entry.detail || entry.pieceId}`));
    });
    boundaryEl.textContent = NFT_ATELIER_BOUNDARY;
  }

  function setOpen(next, method = "api") {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.setAttribute("aria-hidden", String(!opened));
    if (opened) render();
    return publish(opened ? "open" : "close", method);
  }

  mintButton.addEventListener("click", () => {
    const name = nameInput.value;
    try {
      const piece = studio.mint({
        name,
        collection: collectionInput.value,
        description: descriptionInput.value,
        attributes: [],
      });
      selectedId = piece.id;
      nameInput.value = "";
      descriptionInput.value = "";
      feedback = `Created ${piece.name}. Fictional collectible only.`;
    } catch (error) {
      feedback = `Create blocked: ${error?.message ?? error}`;
    }
    render();
    publish("mint", "button");
  });

  closeButton.addEventListener("click", () => setOpen(false, "button"));
  resetButton.addEventListener("click", () => {
    try { studio.reset(); selectedId = null; feedback = "Atelier reset. Starter designs restored."; }
    catch (error) { feedback = `Reset blocked: ${error?.message ?? error}`; }
    render();
    publish("reset", "button");
  });
  exportButton.addEventListener("click", () => {
    try {
      const raw = studio.exportState();
      backupInput.value = raw;
      backupControls.open = true;
      if (windowRoot.Blob && windowRoot.URL?.createObjectURL) {
        const url = windowRoot.URL.createObjectURL(new windowRoot.Blob([raw], { type: "application/json" }));
        const link = element(documentRoot, "a");
        link.href = url;
        link.download = "matumbo-atelier-collection.json";
        link.click();
        windowRoot.setTimeout?.(() => windowRoot.URL.revokeObjectURL(url), 1000);
      }
      setFeedback("Collection backup generated. Save the JSON download or copy the backup text.");
      publish("export", "button");
    } catch (error) { setFeedback(`Export blocked: ${error?.message ?? error}`); }
  });
  importButton.addEventListener("click", () => {
    try {
      studio.importState(backupInput.value);
      selectedId = null;
      setFeedback("Collection restored from validated local backup.");
      publish("import", "button");
    } catch (error) { setFeedback(`Import blocked: ${error?.message ?? error}`); }
  });
  render();

  return Object.freeze({
    open: (method = "api") => setOpen(true, method),
    close: (method = "api") => setOpen(false, method),
    reset: (method = "api") => { studio.reset(); selectedId = null; feedback = "Atelier reset. Starter designs restored."; render(); return publish("reset", method); },
    select: (pieceId, method = "api") => { if (!studio.get(pieceId)) return null; studio.inspect(pieceId); selectedId = pieceId; feedback = ""; render(); return publish("select", method); },
    mint: (input, method = "api") => {
      const piece = studio.mint(input);
      selectedId = piece.id;
      feedback = `Created ${piece.name}. Fictional collectible only.`;
      render();
      return publish("mint", method);
    },
    burn: (pieceId, method = "api") => { studio.burn(pieceId); feedback = "Design burned locally; its record remains in your backup."; render(); return publish("burn", method); },
    exportState: () => studio.exportState(),
    importState: (raw, method = "api") => { studio.importState(raw); selectedId = null; feedback = "Collection restored from validated local backup."; render(); return publish("import", method); },
    replay: (method = "api") => publish("replay", method),
    getSnapshot: () => snapshot(),
    createContribution: () => studio.createContribution(),
    boundary: NFT_ATELIER_BOUNDARY,
  });
}

export default createNftAtelierConsole;
