import {
  NFT_ATELIER_BOUNDARY,
  NFT_ATELIER_CONSOLE_SOURCE,
  createNftAtelier,
} from "../domains/nft-atelier.js?v=20260922-cache2";

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
  atelier = null,
  onSelect = null,
  onReplay = null,
  onReset = null,
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
      persistence: false,
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
    return next;
  }

  function renderDetail() {
    detailEl.replaceChildren();
    const piece = selectedId ? studio.get(selectedId) : null;
    if (!piece) {
      detailEl.append(element(documentRoot, "div", "nft-atelier-empty", "Select a piece to inspect its fictional provenance."));
      return;
    }
    const view = studio.inspect(piece.id);
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
      studio.burn(piece.id);
      statusEl.textContent = `BURNED · ${piece.name.toUpperCase()} VOIDED IN THIS SESSION`;
      render();
      publish("burn", "button");
    });
    card.append(burnButton);
    detailEl.append(card);
  }

  function render() {
    const state = studio.getSnapshot();
    statusEl.textContent = `${state.minted} PIECES · ${state.burned} BURNED · LOCAL SESSION ONLY`;
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
      statusEl.textContent = `MINTED · ${piece.name.toUpperCase()} · FICTIONAL ONLY`;
    } catch (error) {
      statusEl.textContent = `MINT BLOCKED · ${String(error?.message ?? error).toUpperCase().slice(0, 80)}`;
    }
    render();
    publish("mint", "button");
  });

  closeButton.addEventListener("click", () => setOpen(false, "button"));
  resetButton.addEventListener("click", () => {
    studio.reset();
    selectedId = null;
    statusEl.textContent = "ATELIER RESET · STARTER SET RESTORED · LOCAL SESSION";
    render();
    publish("reset", "button");
  });
  render();

  return Object.freeze({
    open: (method = "api") => setOpen(true, method),
    close: (method = "api") => setOpen(false, method),
    reset: (method = "api") => { studio.reset(); selectedId = null; render(); return publish("reset", method); },
    select: (pieceId, method = "api") => { selectedId = pieceId; render(); return publish("select", method); },
    mint: (input, method = "api") => {
      const piece = studio.mint(input);
      selectedId = piece.id;
      render();
      return publish("mint", method);
    },
    burn: (pieceId, method = "api") => { studio.burn(pieceId); render(); return publish("burn", method); },
    replay: (method = "api") => publish("replay", method),
    getSnapshot: () => snapshot(),
    boundary: NFT_ATELIER_BOUNDARY,
  });
}

export default createNftAtelierConsole;
