import {
  MUSE_AGENT_BOUNDARY,
  MUSE_AGENT_CONSOLE_SOURCE,
  MUSE_AGENT_PROVIDERS,
  createMuseAgent,
} from "../domains/muse-agent.js?v=20260922-cache2";

export { MUSE_AGENT_BOUNDARY, MUSE_AGENT_CONSOLE_SOURCE };
export const MUSE_AGENT_RENDER_SOURCE = MUSE_AGENT_CONSOLE_SOURCE;

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

function specRow(documentRoot, label, value) {
  const row = element(documentRoot, "div", "muse-agent-spec");
  row.append(element(documentRoot, "span", "muse-agent-spec-label", label));
  row.append(element(documentRoot, "span", "muse-agent-spec-value", value));
  return row;
}

function paletteSwatches(documentRoot, colors) {
  const wrap = element(documentRoot, "div", "muse-agent-swatches");
  colors.forEach((color) => {
    const swatch = element(documentRoot, "span", "muse-agent-swatch");
    swatch.setAttribute("title", color);
    swatch.style = { background: color };
    // The fake DOM in tests may not implement CSSStyleDeclaration; the real
    // browser path sets the attribute instead when style assignment fails.
    try {
      if (swatch.style && typeof swatch.style === "object") swatch.style.background = color;
    } catch { /* presentation only */ }
    swatch.setAttribute("data-color", color);
    wrap.append(swatch);
  });
  return wrap;
}

export function createMuseAgentConsole({
  documentRoot = globalThis.document,
  agent = null,
  onApplyAvatar = null,
  onGenerate = null,
  onProfile = null,
  onReplay = null,
} = {}) {
  const panel = documentRoot?.getElementById?.("muse-agent-console");
  const closeButton = documentRoot?.getElementById?.("muse-agent-close");
  const statusEl = documentRoot?.getElementById?.("muse-agent-status");
  const profilesEl = documentRoot?.getElementById?.("muse-agent-profiles");
  const nameInput = documentRoot?.getElementById?.("muse-agent-name");
  const providerSelect = documentRoot?.getElementById?.("muse-agent-provider");
  const addButton = documentRoot?.getElementById?.("muse-agent-add");
  const kindSelect = documentRoot?.getElementById?.("muse-agent-kind");
  const promptInput = documentRoot?.getElementById?.("muse-agent-prompt");
  const generateButton = documentRoot?.getElementById?.("muse-agent-generate");
  const resultEl = documentRoot?.getElementById?.("muse-agent-result");
  const galleryEl = documentRoot?.getElementById?.("muse-agent-gallery");
  const boundaryEl = documentRoot?.getElementById?.("muse-agent-boundary");
  if (!panel || !closeButton || !statusEl || !profilesEl || !nameInput || !providerSelect
    || !addButton || !kindSelect || !promptInput || !generateButton || !resultEl
    || !galleryEl || !boundaryEl) {
    throw new Error("Muse Agent console mount points are missing");
  }

  const companion = agent ?? createMuseAgent();
  let opened = panel.hidden !== true;
  let draft = null;

  function snapshot(action = "read", method = "api") {
    return deepFreeze({
      source: MUSE_AGENT_CONSOLE_SOURCE,
      action,
      method,
      opened,
      activeProfileName: companion.getActiveProfile()?.displayName ?? null,
      agent: companion.getSnapshot(),
      localOnly: true,
      simulation: true,
      deterministic: true,
      externalNetwork: false,
      externalAuth: false,
      aiService: false,
      persistence: "local-storage-only",
      executable: false,
      boundary: MUSE_AGENT_BOUNDARY,
    });
  }

  function publish(action, method, extra = null) {
    const next = snapshot(action, method);
    if (action === "generate") onGenerate?.(next, extra);
    if (action === "apply-avatar") onApplyAvatar?.(extra, next);
    if (action === "profile") onProfile?.(next, extra);
    if (action === "replay") onReplay?.(next);
    return next;
  }

  function renderProfiles() {
    profilesEl.replaceChildren();
    companion.listProfiles().forEach((profile) => {
      const button = element(documentRoot, "button", "muse-agent-profile");
      button.type = "button";
      const active = companion.getActiveProfile()?.id === profile.id;
      button.setAttribute("aria-pressed", String(active));
      button.append(
        element(documentRoot, "strong", "muse-agent-profile-name", profile.displayName),
        element(documentRoot, "span", "muse-agent-profile-meta", `${profile.providerLabel} · local only`),
      );
      button.addEventListener("click", () => {
        companion.selectProfile(profile.id);
        statusEl.textContent = `PROFILE ACTIVE · ${profile.displayName.toUpperCase()} · LOCAL ONLY`;
        render();
        publish("profile", "button", { profileId: profile.id });
      });
      profilesEl.append(button);
    });
  }

  function renderResult() {
    resultEl.replaceChildren();
    if (!draft) {
      resultEl.append(element(documentRoot, "div", "muse-agent-empty", "Describe a look or an image — the agent composes a deterministic local design."));
      return;
    }
    const card = element(documentRoot, "div", "muse-agent-card");
    card.append(element(documentRoot, "div", "muse-agent-card-kicker", `${draft.kind.toUpperCase()} DESIGN · ${draft.profileName}`));
    card.append(element(documentRoot, "strong", "muse-agent-card-title", draft.title));
    card.append(paletteSwatches(documentRoot, draft.palette.colors));
    card.append(specRow(documentRoot, "Palette", draft.palette.name));
    card.append(specRow(documentRoot, "Style", draft.style.name));
    card.append(specRow(documentRoot, "Mood", draft.mood.name));
    if (draft.kind === "avatar") {
      card.append(specRow(documentRoot, "Outfit", draft.outfitName));
      card.append(specRow(documentRoot, "Room light", draft.roomName));
      card.append(specRow(documentRoot, "Companion", draft.companion));
      card.append(specRow(documentRoot, "Hologram tint", draft.hologramTint));
      const actions = element(documentRoot, "div", "muse-agent-actions");
      const applyButton = element(documentRoot, "button", "muse-agent-apply", "Apply to Person Studio");
      applyButton.type = "button";
      applyButton.addEventListener("click", () => {
        const saved = companion.getDesign(draft.id) ?? companion.save(draft);
        companion.markApplied(saved.id);
        render();
        statusEl.textContent = `APPLIED · ${saved.title.toUpperCase()} DRESSED ON THE PERSON STUDIO HOLOGRAM`;
        publish("apply-avatar", "button", saved);
      });
      const saveButton = element(documentRoot, "button", "muse-agent-save", "Save design");
      saveButton.type = "button";
      saveButton.addEventListener("click", () => {
        const saved = companion.save(draft);
        draft = saved;
        render();
        statusEl.textContent = `SAVED · ${saved.title.toUpperCase()} · LOCAL GALLERY`;
        publish("generate", "button", saved);
      });
      actions.append(applyButton, saveButton);
      card.append(actions);
    } else {
      card.append(specRow(documentRoot, "Aspect", draft.aspect));
      card.append(element(documentRoot, "p", "muse-agent-brief", draft.brief));
      const actions = element(documentRoot, "div", "muse-agent-actions");
      const saveButton = element(documentRoot, "button", "muse-agent-save", "Save brief");
      saveButton.type = "button";
      saveButton.addEventListener("click", () => {
        const saved = companion.save(draft);
        draft = saved;
        render();
        statusEl.textContent = `SAVED · ${saved.title.toUpperCase()} · LOCAL GALLERY`;
        publish("generate", "button", saved);
      });
      actions.append(saveButton);
      card.append(actions);
    }
    resultEl.append(card);
  }

  function renderGallery() {
    galleryEl.replaceChildren();
    const designs = companion.listDesigns();
    if (!designs.length) {
      galleryEl.append(element(documentRoot, "div", "muse-agent-empty", "No saved designs yet. Generate one above."));
      return;
    }
    [...designs].reverse().forEach((design) => {
      const button = element(documentRoot, "button", "muse-agent-design");
      button.type = "button";
      button.dataset.designId = design.id;
      button.append(
        element(documentRoot, "strong", "muse-agent-design-title", design.title),
        element(documentRoot, "span", "muse-agent-design-meta", `${design.kind.toUpperCase()} · ${design.profileName}${design.applied ? " · APPLIED" : ""}`),
      );
      button.addEventListener("click", () => {
        if (design.kind === "avatar") {
          companion.markApplied(design.id);
          render();
          statusEl.textContent = `APPLIED · ${design.title.toUpperCase()} DRESSED ON THE PERSON STUDIO HOLOGRAM`;
          publish("apply-avatar", "button", design);
        } else {
          draft = design;
          render();
          statusEl.textContent = `BRIEF LOADED · ${design.title.toUpperCase()}`;
          publish("generate", "button", design);
        }
      });
      galleryEl.append(button);
    });
  }

  function render() {
    const state = companion.getSnapshot();
    const active = companion.getActiveProfile();
    statusEl.textContent = `MUSE AGENT READY · ${state.profiles.length} LOCAL PROFILE${state.profiles.length === 1 ? "" : "S"} · ${state.designs.length} SAVED DESIGN${state.designs.length === 1 ? "" : "S"}`;
    if (active) statusEl.textContent += ` · DESIGNING AS ${active.displayName.toUpperCase()}`;
    renderProfiles();
    renderResult();
    renderGallery();
    boundaryEl.textContent = MUSE_AGENT_BOUNDARY;
  }

  function setOpen(next, method = "api") {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.setAttribute("aria-hidden", String(!opened));
    if (opened) render();
    return publish(opened ? "open" : "close", method);
  }

  // The provider select is populated from the domain's provider registry so
  // "Muse" and "Other account" stay in sync with the boundary contract.
  providerSelect.replaceChildren();
  MUSE_AGENT_PROVIDERS.forEach((provider) => {
    const option = element(documentRoot, "option", null, provider.label);
    option.value = provider.id;
    providerSelect.append(option);
  });

  addButton.addEventListener("click", () => {
    try {
      const profile = companion.addProfile({ displayName: nameInput.value, provider: providerSelect.value });
      nameInput.value = "";
      statusEl.textContent = `PROFILE ADDED · ${profile.displayName.toUpperCase()} · LOCAL ONLY · NO LOGIN`;
      render();
      publish("profile", "button", { profileId: profile.id });
    } catch (error) {
      statusEl.textContent = `PROFILE BLOCKED · ${String(error?.message ?? error).toUpperCase().slice(0, 80)}`;
    }
  });

  generateButton.addEventListener("click", () => {
    try {
      draft = companion.generate({ kind: kindSelect.value, prompt: promptInput.value });
      render();
      statusEl.textContent = `DESIGNED · ${draft.title.toUpperCase()} · DETERMINISTIC · LOCAL`;
      publish("generate", "button", draft);
    } catch (error) {
      render();
      statusEl.textContent = `DESIGN BLOCKED · ${String(error?.message ?? error).toUpperCase().slice(0, 80)}`;
    }
  });

  closeButton.addEventListener("click", () => setOpen(false, "button"));
  render();

  return Object.freeze({
    open: (method = "api") => setOpen(true, method),
    close: (method = "api") => setOpen(false, method),
    replay: (method = "api") => publish("replay", method),
    generate: (input, method = "api") => {
      draft = companion.generate(input);
      render();
      return publish("generate", method, draft);
    },
    addProfile: (input, method = "api") => {
      const profile = companion.addProfile(input);
      render();
      return publish("profile", method, { profileId: profile.id });
    },
    getSnapshot: () => snapshot(),
    boundary: MUSE_AGENT_BOUNDARY,
  });
}

export default createMuseAgentConsole;
