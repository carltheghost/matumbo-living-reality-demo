import {
  LUNA_BOUNDARY,
  LUNA_CONSOLE_SOURCE,
  createLunaCompanion,
} from "../domains/luna-companion.js?v=20260922-cache2";

export { LUNA_CONSOLE_SOURCE };
export const LUNA_RENDER_SOURCE = LUNA_CONSOLE_SOURCE;

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

const WELCOME_TEXT = "Hello! I'm Luna — a scripted local guide, not an AI. Talk to me in plain words: I'll open any feature by name, explain what each place does, and tell you where you are. I forget everything when this page closes.";

export function createLunaCompanionConsole({
  documentRoot = globalThis.document,
  companion = null,
  features = [],
  getCurrentFeature = null,
  onNavigate = null,
  onReplay = null,
} = {}) {
  const panel = documentRoot?.getElementById?.("luna-companion-console");
  const closeButton = documentRoot?.getElementById?.("luna-companion-close");
  const statusEl = documentRoot?.getElementById?.("luna-companion-status");
  const logEl = documentRoot?.getElementById?.("luna-companion-log");
  const chipsEl = documentRoot?.getElementById?.("luna-companion-chips");
  const inputEl = documentRoot?.getElementById?.("luna-companion-input");
  const sendButton = documentRoot?.getElementById?.("luna-companion-send");
  const speakButton = documentRoot?.getElementById?.("luna-companion-speak");
  const traceEl = documentRoot?.getElementById?.("luna-companion-trace");
  const boundaryEl = documentRoot?.getElementById?.("luna-companion-boundary");
  if (!panel || !closeButton || !statusEl || !logEl || !chipsEl || !inputEl
    || !sendButton || !speakButton || !traceEl || !boundaryEl) {
    throw new Error("Luna companion console mount points are missing");
  }

  const featureList = Array.isArray(features) ? features.slice() : [];
  const luna = companion ?? createLunaCompanion({ features: featureList });
  const visitedIds = new Set();
  let opened = panel.hidden !== true;
  let speakOn = false;
  let welcomed = false;

  function snapshot(action = "read", method = "api") {
    return deepFreeze({
      source: LUNA_CONSOLE_SOURCE,
      action,
      method,
      opened,
      speakOn,
      visited: [...visitedIds],
      companion: luna.getSnapshot(),
      localOnly: true,
      simulation: true,
      persistence: false,
      network: false,
      aiModel: false,
      executable: false,
      boundary: LUNA_BOUNDARY,
    });
  }

  function publish(action, method) {
    const next = snapshot(action, method);
    if (action === "replay") onReplay?.(next);
    return next;
  }

  function currentFeature() {
    const id = typeof getCurrentFeature === "function" ? getCurrentFeature() : null;
    if (!id) return null;
    return featureList.find((feature) => feature.id === id) ?? null;
  }

  function appendTurn(role, text) {
    const bubble = element(documentRoot, "div", `luna-companion-turn luna-companion-turn-${role}`);
    bubble.append(element(documentRoot, "span", "luna-companion-turn-role", role === "user" ? "YOU" : "LUNA"));
    bubble.append(element(documentRoot, "p", "luna-companion-turn-text", text));
    logEl.append(bubble);
    if (typeof bubble.scrollIntoView === "function") {
      try { bubble.scrollIntoView({ block: "nearest" }); } catch { /* non-visual hosts */ }
    }
  }

  function renderTrace() {
    traceEl.replaceChildren();
    const entries = luna.getSnapshot().trace;
    if (!entries.length) {
      traceEl.append(element(documentRoot, "div", "luna-companion-empty", "No conversation yet. Say hello."));
      return;
    }
    [...entries].reverse().forEach((entry) => {
      const confidence = typeof entry.confidence === "number" && entry.confidence > 0
        ? ` · ${Math.round(entry.confidence * 100)}%`
        : "";
      const label = entry.featureId
        ? `${entry.intent.toUpperCase()} → ${entry.featureId}${confidence}`
        : `${entry.intent.toUpperCase()}${confidence}`;
      traceEl.append(element(documentRoot, "div", "luna-companion-trace-row", `${entry.seq} · ${label}`));
    });
  }

  let optionsRow = null;

  function ensureOptionsRow() {
    if (optionsRow) return optionsRow;
    optionsRow = element(documentRoot, "div", "luna-companion-options");
    chipsEl.append(optionsRow);
    return optionsRow;
  }

  /**
   * Surface Luna's follow-ups as tappable chips: disambiguation options for
   * clarify replies, and the "open next" offer for explain-before-open.
   * Clicking an option sends it as an exact command — never a guess.
   */
  function renderOptions(result) {
    if (optionsRow) optionsRow.replaceChildren();
    const options = Array.isArray(result?.askOptions) ? result.askOptions.filter(Boolean) : [];
    const followUp = result?.thenNavigate?.label ? result.thenNavigate : null;
    if (!options.length && !followUp) return;
    const row = ensureOptionsRow();
    row.replaceChildren();
    options.slice(0, 3).forEach((label) => {
      const chip = element(documentRoot, "button", "luna-companion-chip luna-companion-chip-option", label);
      chip.type = "button";
      chip.dataset.option = "disambiguate";
      chip.addEventListener("click", () => send(`open ${label}`));
      row.append(chip);
    });
    if (followUp) {
      const chip = element(documentRoot, "button", "luna-companion-chip luna-companion-chip-option", `Open ${followUp.label} →`);
      chip.type = "button";
      chip.dataset.option = "then-navigate";
      chip.addEventListener("click", () => send(`open ${followUp.label}`));
      row.append(chip);
    }
  }

  function renderStatus() {
    const turns = luna.getSnapshot().turns;
    statusEl.textContent = turns
      ? `${turns} TURNS · SCRIPTED LOCAL GUIDE · NO MEMORY PAST THIS SESSION`
      : "READY · SCRIPTED LOCAL GUIDE · SAY HELLO";
  }

  function speak(text) {
    if (!speakOn) return;
    try {
      const synth = globalThis.speechSynthesis;
      if (!synth || typeof synth.speak !== "function") return;
      synth.cancel();
      const utterance = new globalThis.SpeechSynthesisUtterance(safeSlice(text));
      synth.speak(utterance);
    } catch {
      // Speech output is best-effort; text always works.
    }
  }

  function safeSlice(text) {
    return String(text ?? "").slice(0, 500);
  }

  function send(text) {
    const raw = String(text ?? "").trim();
    let result;
    try {
      // Empty input is a help request, not a failure: Luna answers it.
      result = luna.respond({ text: raw, currentFeature: currentFeature() });
    } catch (error) {
      statusEl.textContent = `LUNA PAUSED · ${String(error?.message ?? error).toUpperCase().slice(0, 80)}`;
      return null;
    }
    appendTurn("user", raw.length > 240 ? `${raw.slice(0, 240)}…` : raw);
    appendTurn("luna", result.reply);
    renderOptions(result);
    if ((result.intent === "navigate" || result.intent === "undo") && result.featureId) {
      visitedIds.add(result.featureId);
      statusEl.textContent = `NAVIGATING · ${result.featureId.toUpperCase()} · SAME AS CLICKING`;
      const next = snapshot("navigate", "chat");
      onNavigate?.(result.featureId, next);
    } else {
      statusEl.textContent = `${result.intent.toUpperCase()} · LOCAL SCRIPT · NO NETWORK`;
      publish("message", "chat");
    }
    speak(result.reply);
    renderTrace();
    return result;
  }

  function sendInput() {
    const value = inputEl.value;
    inputEl.value = "";
    send(value);
  }

  function chipCommand(kind) {
    if (kind === "place") return "what is this place?";
    if (kind === "abilities") return "what can you do?";
    const suggestion = luna.suggestUnvisited(kind === "surprise" ? [...visitedIds] : []);
    if (!suggestion) return "take me to the arena";
    return `take me to the ${suggestion.label}`;
  }

  const CHIPS = [
    { kind: "somewhere", label: "Take me somewhere" },
    { kind: "place", label: "What is this place?" },
    { kind: "surprise", label: "Surprise me" },
    { kind: "abilities", label: "What can you do?" },
  ];

  function renderChips() {
    chipsEl.replaceChildren();
    CHIPS.forEach(({ kind, label }) => {
      const chip = element(documentRoot, "button", "luna-companion-chip", label);
      chip.type = "button";
      chip.dataset.chip = kind;
      chip.addEventListener("click", () => {
        const command = chipCommand(kind);
        inputEl.value = command;
        send(command);
      });
      chipsEl.append(chip);
    });
  }

  function setOpen(next, method = "api") {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.setAttribute("aria-hidden", String(!opened));
    if (opened) {
      if (!welcomed) {
        welcomed = true;
        appendTurn("luna", WELCOME_TEXT);
      }
      renderStatus();
      renderTrace();
      boundaryEl.textContent = LUNA_BOUNDARY;
    }
    return publish(opened ? "open" : "close", method);
  }

  function setSpeak(next) {
    speakOn = Boolean(next);
    speakButton.setAttribute("aria-pressed", String(speakOn));
    speakButton.textContent = speakOn ? "Voice: on" : "Voice: off";
    if (!speakOn) {
      try { globalThis.speechSynthesis?.cancel?.(); } catch { /* silent */ }
    }
    return publish("speak", "button");
  }

  sendButton.addEventListener("click", sendInput);
  inputEl.addEventListener("keydown", (event) => {
    if (event?.key === "Enter") sendInput();
  });
  closeButton.addEventListener("click", () => setOpen(false, "button"));
  speakButton.addEventListener("click", () => setSpeak(!speakOn));
  speakButton.setAttribute("aria-pressed", "false");
  speakButton.textContent = "Voice: off";

  renderChips();
  boundaryEl.textContent = LUNA_BOUNDARY;
  renderStatus();
  renderTrace();

  return Object.freeze({
    open: (method = "api") => setOpen(true, method),
    close: (method = "api") => setOpen(false, method),
    send: (text, method = "api") => {
      const result = send(text);
      return result ? publish("send", method) : null;
    },
    replay: (method = "api") => publish("replay", method),
    toggleSpeak: (method = "api") => setSpeak(!speakOn),
    getSnapshot: () => snapshot(),
    boundary: LUNA_BOUNDARY,
  });
}

export default createLunaCompanionConsole;
