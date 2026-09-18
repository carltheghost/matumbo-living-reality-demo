import {
  WARDROBE_ATELIER_BOUNDARY,
  WARDROBE_ATELIER_CONSOLE_SOURCE,
  WARDROBE_ERROR_IMMUTABLE,
  createWardrobeAtelier,
} from "../domains/wardrobe-atelier.js";

export { WARDROBE_ATELIER_CONSOLE_SOURCE };
export const WARDROBE_RENDER_SOURCE = WARDROBE_ATELIER_CONSOLE_SOURCE;

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
      persistence: false,
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
    if (action === "replay") onReplay?.(next);
    if (action === "reset") onReset?.(next);
    return next;
  }

  function equipSelected(method = "button") {
    // A dangling selection (outfit deleted elsewhere) fails deterministically
    // instead of silently equipping something the user did not pick.
    if (selectedId && !studio.getOutfit(selectedId)) {
      selectedId = null;
      render();
      statusEl.textContent = "OUTFIT NOT FOUND · SELECTION CLEARED";
      return null;
    }
    const outfit = selectedId ? studio.getOutfit(selectedId) : studio.getEquipped();
    if (!outfit) {
      statusEl.textContent = "NOTHING TO EQUIP · SELECT AN OUTFIT FIRST";
      return null;
    }
    // Atomic swap, indicator only: the current look stays visible until the
    // domain commits the new one in a single synchronous step.
    statusEl.textContent = `APPEARANCE CHANGING · ${outfit.name.toUpperCase()} · …`;
    const { outfit: equipped, event } = studio.equipOutfit(outfit.id);
    render();
    statusEl.textContent = `EQUIPPED · ${equipped.name.toUpperCase()} · LOCAL PREVIEW ONLY`;
    const next = snapshot("equip", method);
    try {
      onEquip?.(equipped, next, event);
    } catch {
      // Render failures degrade visually without corrupting wardrobe state:
      // the domain already committed; only the person-studio sync is skipped.
      statusEl.textContent = `EQUIPPED · ${equipped.name.toUpperCase()} · PERSON SYNC SKIPPED`;
    }
    return next;
  }

  function deleteSelected(method = "button") {
    const outfit = selectedId ? studio.getOutfit(selectedId) : null;
    if (!outfit) {
      statusEl.textContent = "NOTHING TO DELETE · SELECT AN OUTFIT FIRST";
      return null;
    }
    try {
      const { deleted, outfit: equipped, event } = studio.deleteOutfit(outfit.id);
      selectedId = null;
      if (event) {
        statusEl.textContent = `DELETED · ${deleted.name.toUpperCase()} · ${equipped.name.toUpperCase()} EQUIPPED INSTEAD · LOCAL ONLY`;
      } else {
        statusEl.textContent = `DELETED · ${deleted.name.toUpperCase()} · LOCAL ONLY`;
      }
      render();
      return publish("delete", method);
    } catch (error) {
      if (error?.code === WARDROBE_ERROR_IMMUTABLE) {
        statusEl.textContent = "SYSTEM LOOK · CANNOT DELETE · CUSTOMIZE TO MAKE YOUR OWN";
      } else {
        statusEl.textContent = `DELETE BLOCKED · ${String(error?.message ?? error).toUpperCase().slice(0, 80)}`;
      }
      render();
      return null;
    }
  }

  function customizeSelected(method = "button") {
    const outfit = selectedId ? studio.getOutfit(selectedId) : null;
    if (!outfit) {
      statusEl.textContent = "NOTHING TO CUSTOMIZE · SELECT AN OUTFIT FIRST";
      return null;
    }
    try {
      const derived = studio.customizeOutfit(outfit.id);
      selectedId = derived.id;
      statusEl.textContent = `CUSTOMIZED · ${derived.name.toUpperCase()} · YOUR DESIGN · FICTIONAL ONLY`;
      render();
      return publish("customize", method);
    } catch (error) {
      statusEl.textContent = `CUSTOMIZE BLOCKED · ${String(error?.message ?? error).toUpperCase().slice(0, 80)}`;
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
    statusEl.textContent = `${state.outfitCount} OUTFITS · WEARING ${equippedName.toUpperCase()} · LOCAL SESSION ONLY`;
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
    if (opened) render();
    return publish(opened ? "open" : "close", method);
  }

  createButton.addEventListener("click", () => {
    try {
      const outfit = studio.createOutfit({
        name: nameInput.value,
        palette: paletteInput.value,
        motif: motifInput.value,
        description: descriptionInput.value,
        pieces: [],
      });
      selectedId = outfit.id;
      nameInput.value = "";
      paletteInput.value = "";
      motifInput.value = "";
      descriptionInput.value = "";
      statusEl.textContent = `DESIGNED · ${outfit.name.toUpperCase()} · FICTIONAL ONLY`;
    } catch (error) {
      statusEl.textContent = `DESIGN BLOCKED · ${String(error?.message ?? error).toUpperCase().slice(0, 80)}`;
    }
    render();
    publish("create", "button");
  });

  closeButton.addEventListener("click", () => setOpen(false, "button"));
  resetButton.addEventListener("click", () => {
    studio.reset();
    selectedId = null;
    statusEl.textContent = "WARDROBE RESET · STARTER SET RESTORED · LOCAL SESSION";
    render();
    publish("reset", "button");
  });
  render();

  return Object.freeze({
    open: (method = "api") => setOpen(true, method),
    close: (method = "api") => setOpen(false, method),
    reset: (method = "api") => { studio.reset(); selectedId = null; render(); return publish("reset", method); },
    select: (outfitId, method = "api") => { selectedId = outfitId; render(); return publish("select", method); },
    create: (input, method = "api") => {
      const outfit = studio.createOutfit(input);
      selectedId = outfit.id;
      render();
      return publish("create", method);
    },
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
    replay: (method = "api") => publish("replay", method),
    getSnapshot: () => snapshot(),
    boundary: WARDROBE_ATELIER_BOUNDARY,
  });
}

export default createWardrobeAtelierConsole;
