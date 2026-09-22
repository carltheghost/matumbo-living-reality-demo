import {
  FROZEN_RELICS_BOUNDARY,
  FROZEN_RELICS_CONSOLE_SOURCE,
  FROZEN_RELICS_FORM,
  createFrozenRelics,
} from "../domains/frozen-relics.js?v=20260922-cache2";

export { FROZEN_RELICS_CONSOLE_SOURCE };
export const FROZEN_RELICS_RENDER_SOURCE = FROZEN_RELICS_CONSOLE_SOURCE;

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

function kvRow(documentRoot, key, value) {
  const row = element(documentRoot, "div", "frozen-relics-kv");
  row.append(element(documentRoot, "span", "frozen-relics-kv-name", key));
  row.append(element(documentRoot, "span", "frozen-relics-kv-value", value));
  return row;
}

/** A small glass cube in the world's cube language: gold edges, cyan glass. */
function glassCube(documentRoot) {
  const cube = element(documentRoot, "div", "frozen-relics-cube");
  cube.setAttribute("aria-hidden", "true");
  for (let face = 0; face < 6; face += 1) {
    cube.append(element(documentRoot, "i", `frozen-relics-face frozen-relics-face-${face}`));
  }
  return cube;
}

/**
 * Frozen Relics console: a section inside the NFT Atelier console. Mint
 * living glass-cube relics, inspect the frozen core vs the evolving life,
 * prove the core hasn't changed, and transfer relics locally.
 */
export function createFrozenRelicsConsole({
  documentRoot = globalThis.document,
  vault = null,
  onMint = null,
  onSelect = null,
  onVerify = null,
  onTransfer = null,
} = {}) {
  const statusEl = documentRoot?.getElementById?.("frozen-relics-status");
  const galleryEl = documentRoot?.getElementById?.("frozen-relics-gallery");
  const detailEl = documentRoot?.getElementById?.("frozen-relics-detail");
  const nameInput = documentRoot?.getElementById?.("frozen-relics-name");
  const originInput = documentRoot?.getElementById?.("frozen-relics-origin");
  const creatorInput = documentRoot?.getElementById?.("frozen-relics-creator");
  const amountInput = documentRoot?.getElementById?.("frozen-relics-amount");
  const mintButton = documentRoot?.getElementById?.("frozen-relics-mint");
  const boundaryEl = documentRoot?.getElementById?.("frozen-relics-boundary");
  if (!statusEl || !galleryEl || !detailEl || !nameInput || !originInput
    || !creatorInput || !amountInput || !mintButton || !boundaryEl) {
    throw new Error("Frozen Relics console mount points are missing");
  }

  const relics = vault ?? createFrozenRelics();
  let selectedId = null;

  function snapshot(action = "read", method = "api") {
    return deepFreeze({
      source: FROZEN_RELICS_CONSOLE_SOURCE,
      action,
      method,
      selectedId,
      vault: relics.getSnapshot(),
      localOnly: true,
      simulation: true,
      persistence: false,
      wallet: false,
      chain: false,
      sale: false,
      custody: false,
      externalNetwork: false,
      executable: false,
      boundary: FROZEN_RELICS_BOUNDARY,
    });
  }

  function publish(action, method) {
    const next = snapshot(action, method);
    if (action === "mint") onMint?.(next);
    if (action === "select") onSelect?.(next);
    if (action === "verify") onVerify?.(next);
    if (action === "transfer") onTransfer?.(next);
    return next;
  }

  function renderDetail() {
    detailEl.replaceChildren();
    const relic = selectedId ? relics.getRelic(selectedId) : null;
    if (!relic) {
      detailEl.append(element(documentRoot, "div", "frozen-relics-empty", "Select a relic to inspect its frozen core and its living history."));
      return;
    }
    const card = element(documentRoot, "div", "frozen-relics-card");
    const head = element(documentRoot, "div", "frozen-relics-card-head");
    head.append(glassCube(documentRoot));
    const titleBox = element(documentRoot, "div", null);
    titleBox.append(element(documentRoot, "strong", "frozen-relics-card-name", relic.name));
    titleBox.append(element(documentRoot, "div", "frozen-relics-card-id", relic.id));
    head.append(titleBox);
    card.append(head);
    card.append(element(documentRoot, "div", "frozen-relics-card-meta",
      `${FROZEN_RELICS_FORM.toUpperCase()} · STAGE ${relic.life.stage.toUpperCase()} · PATINA ${relic.life.patina.toUpperCase()}`));

    // ---- The frozen core: immutable law ----
    const core = element(documentRoot, "div", "frozen-relics-core");
    core.append(element(documentRoot, "div", "frozen-relics-section-label", "FROZEN CORE · CANNOT CHANGE"));
    core.append(kvRow(documentRoot, "origin", relic.frozenCore.origin));
    core.append(kvRow(documentRoot, "creator", relic.frozenCore.creator));
    core.append(kvRow(documentRoot, "sealed at", relic.frozenCore.mintedAt));
    Object.entries(relic.frozenCore.terms).forEach(([key, value]) => {
      core.append(kvRow(documentRoot, `term · ${key}`, String(value)));
    });
    core.append(kvRow(documentRoot, "genesis hash", relic.frozenCore.genesisHash));
    const verifyButton = element(documentRoot, "button", "frozen-relics-verify", "Prove it hasn't changed");
    verifyButton.type = "button";
    verifyButton.addEventListener("click", () => {
      try {
        const verdict = relics.verifyFrozenCore(relic.id);
        statusEl.textContent = verdict.ok
          ? `CORE VERIFIED · ${relic.name.toUpperCase()} · GENESIS ${verdict.genesisHash}`
          : `CORE MISMATCH · ${relic.name.toUpperCase()} · INVESTIGATE`;
      } catch (error) {
        statusEl.textContent = `VERIFY BLOCKED · ${String(error?.message ?? error).toUpperCase().slice(0, 80)}`;
      }
      publish("verify", "button");
    });
    core.append(verifyButton);
    card.append(core);

    // ---- The evolving envelope: the relic lives ----
    const life = element(documentRoot, "div", "frozen-relics-life");
    life.append(element(documentRoot, "div", "frozen-relics-section-label", "LIVING ENVELOPE · KEEPS GROWING"));
    life.append(kvRow(documentRoot, "holder", relic.life.holder));
    life.append(kvRow(documentRoot, "stage", `${relic.life.stage} · ${relic.life.patina}`));
    life.append(kvRow(documentRoot, "status", relic.life.claimed ? "claimed · spent · the life is complete" : "alive · evolving"));
    const history = element(documentRoot, "div", "frozen-relics-history");
    history.append(element(documentRoot, "div", "frozen-relics-section-label", "LIFE HISTORY · APPEND-ONLY"));
    if (!relic.life.history.length) {
      history.append(element(documentRoot, "div", "frozen-relics-empty", "No life events yet."));
    }
    relic.life.history.forEach((entry) => {
      history.append(element(documentRoot, "div", "frozen-relics-history-row",
        `${entry.seq} · ${entry.kind.toUpperCase()} · ${entry.at} · ${entry.detail}`));
    });
    life.append(history);
    if (relic.life.annotations.length) {
      const notes = element(documentRoot, "div", "frozen-relics-history");
      notes.append(element(documentRoot, "div", "frozen-relics-section-label", "ANNOTATIONS · APPEND-ONLY"));
      relic.life.annotations.forEach((annotation) => {
        notes.append(element(documentRoot, "div", "frozen-relics-history-row",
          `${annotation.seq} · ${annotation.at} · ${annotation.note}`));
      });
      life.append(notes);
    }
    if (!relic.life.claimed) {
      const transferRow = element(documentRoot, "div", "frozen-relics-transfer");
      const toInput = element(documentRoot, "input", "frozen-relics-text-input");
      toInput.type = "text";
      toInput.placeholder = "Transfer to holder name";
      toInput.setAttribute("aria-label", "Transfer relic to holder");
      const transferButton = element(documentRoot, "button", "frozen-relics-action", "Transfer relic (local)");
      transferButton.type = "button";
      transferButton.addEventListener("click", () => {
        try {
          relics.recordRelicTransfer({ relicId: relic.id, toHolder: toInput.value });
          statusEl.textContent = `TRANSFERRED · ${relic.name.toUpperCase()} → ${toInput.value.toUpperCase()} · CORE UNTOUCHED`;
          toInput.value = "";
        } catch (error) {
          statusEl.textContent = `TRANSFER BLOCKED · ${String(error?.message ?? error).toUpperCase().slice(0, 80)}`;
        }
        render();
        publish("transfer", "button");
      });
      transferRow.append(toInput, transferButton);
      life.append(transferRow);
    }
    card.append(life);
    detailEl.append(card);
  }

  function render() {
    const state = relics.getSnapshot();
    statusEl.textContent = `${state.relics} RELICS · ${state.claimed} CLAIMED · LOCAL SESSION ONLY`;
    galleryEl.replaceChildren();
    if (!state.relics) {
      galleryEl.append(element(documentRoot, "div", "frozen-relics-empty", "No relics yet. Seal one below — its core freezes forever, its life keeps growing."));
    }
    relics.listRelics().forEach((relic) => {
      const button = element(documentRoot, "button", "frozen-relics-piece");
      button.type = "button";
      button.dataset.relicId = relic.id;
      button.setAttribute("aria-pressed", String(relic.id === selectedId));
      button.append(glassCube(documentRoot));
      const label = element(documentRoot, "span", "frozen-relics-piece-label");
      label.append(
        element(documentRoot, "strong", "frozen-relics-piece-name", relic.name),
        element(documentRoot, "span", "frozen-relics-piece-meta", `${relic.life.stage.toUpperCase()} · ${relic.life.holder}`),
        element(documentRoot, "span", "frozen-relics-piece-id", relic.id),
      );
      button.append(label);
      button.addEventListener("click", () => {
        selectedId = relic.id;
        render();
        publish("select", "button");
      });
      galleryEl.append(button);
    });
    renderDetail();
    boundaryEl.textContent = FROZEN_RELICS_BOUNDARY;
  }

  mintButton.addEventListener("click", () => {
    const amount = Number(amountInput.value);
    try {
      const relic = relics.mintRelic({
        name: nameInput.value,
        origin: originInput.value || "atelier:hand-sealed",
        creator: creatorInput.value || "atelier",
        terms: Number.isFinite(amount) && amount > 0
          ? { claimAmount: String(Math.round(amount * 100) / 100), unit: "simulated TUMBO points" }
          : { note: "a study in frozen light" },
        holder: "atelier",
      });
      selectedId = relic.id;
      nameInput.value = "";
      originInput.value = "";
      creatorInput.value = "";
      amountInput.value = "";
      statusEl.textContent = `SEALED · ${relic.name.toUpperCase()} · CORE FROZEN FOREVER`;
    } catch (error) {
      statusEl.textContent = `MINT BLOCKED · ${String(error?.message ?? error).toUpperCase().slice(0, 80)}`;
    }
    render();
    publish("mint", "button");
  });

  render();

  return Object.freeze({
    select: (relicId, method = "api") => { selectedId = relicId; render(); return publish("select", method); },
    mint: (input, method = "api") => {
      const relic = relics.mintRelic(input);
      selectedId = relic.id;
      render();
      return publish("mint", method);
    },
    verify: (relicId, method = "api") => {
      const verdict = relics.verifyFrozenCore(relicId ?? selectedId);
      render();
      publish("verify", method);
      return verdict;
    },
    transfer: (relicId, toHolder, method = "api") => {
      const updated = relics.recordRelicTransfer({ relicId: relicId ?? selectedId, toHolder });
      render();
      publish("transfer", method);
      return updated;
    },
    witness: (relicId, kind, detail, method = "api") => {
      const event = relics.witness({ relicId: relicId ?? selectedId, kind, detail });
      render();
      return event;
    },
    getSnapshot: () => snapshot(),
    boundary: FROZEN_RELICS_BOUNDARY,
  });
}

export default createFrozenRelicsConsole;
