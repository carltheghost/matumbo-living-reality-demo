import {
  ARENA_GAMES_BOUNDARY,
  ARENA_GAMES_CONSOLE_SOURCE,
  ARENA_GAMES_SOURCE,
  DEFAULT_ARENA_GAMES,
  applyArenaGameAction,
  createArenaGameState,
  createArenaGamesContribution,
  replayArenaGame,
  resetArenaGame,
} from "../domains/arena-games.js";

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

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function createText(documentRoot, tag, className, value) {
  const element = documentRoot.createElement(tag);
  if (className) element.className = className;
  element.textContent = text(value);
  return element;
}

function contributionFrom(projection) {
  if (projection?.source === ARENA_GAMES_SOURCE) return projection;
  return asArray(projection?.contributions).find((contribution) => contribution?.source === ARENA_GAMES_SOURCE)
    ?? DEFAULT_ARENA_GAMES;
}

/** Read the canonical arena contribution into a small renderer-safe summary. */
export function summarizeArenaGames(projection) {
  const contribution = contributionFrom(projection);
  return deepFreeze({
    source: ARENA_GAMES_SOURCE,
    updatedAt: contribution.updatedAt,
    modes: asArray(contribution.modes),
    sessions: asArray(contribution.sessions),
    modeCount: asArray(contribution.modes).length,
    deterministic: contribution.deterministic === true,
    simulation: contribution.simulation === true,
    localOnly: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
    boundary: contribution.boundary ?? ARENA_GAMES_BOUNDARY,
  });
}

export { ARENA_GAMES_CONSOLE_SOURCE };
export const ARENA_GAMES_RENDER_SOURCE = ARENA_GAMES_CONSOLE_SOURCE;

function modeFrom(summary, modeId) {
  return summary.modes.find((mode) => mode.id === modeId) ?? null;
}

function actionLabel(state, actionId) {
  return state.legalActions.find((action) => action.id === actionId)?.label ?? actionId;
}

/**
 * Mount the local Game Lab console. This adapter owns only page-session state;
 * callbacks receive frozen snapshots for the host to turn into renderer
 * intents. No callback is allowed to become an execution path here.
 */
export function createArenaGamesConsole({
  documentRoot = globalThis.document,
  projection = null,
  onMode = null,
  onSelect = null,
  onAction = null,
  onReplay = null,
  onReset = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("ARENA Game Lab needs a document-like owner");
  const panel = documentRoot.getElementById("arena-games-console");
  const closeButton = documentRoot.getElementById("arena-games-close");
  const modeList = documentRoot.getElementById("arena-games-modes");
  const actionList = documentRoot.getElementById("arena-games-actions");
  const replayButton = documentRoot.getElementById("arena-games-replay");
  const resetButton = documentRoot.getElementById("arena-games-reset");
  const statusEl = documentRoot.getElementById("arena-games-status");
  const currentEl = documentRoot.getElementById("arena-games-current");
  const turnEl = documentRoot.getElementById("arena-games-turn");
  const hashEl = documentRoot.getElementById("arena-games-hash");
  const traceEl = documentRoot.getElementById("arena-games-trace");
  const boundaryEl = documentRoot.getElementById("arena-games-boundary");
  if (!panel || !closeButton || !modeList || !actionList || !replayButton || !resetButton || !statusEl || !currentEl || !traceEl) {
    throw new Error("ARENA Game Lab mount points are missing");
  }

  let summary = summarizeArenaGames(projection);
  let selectedModeId = summary.modes[0]?.id ?? "nebula-rally";
  const sessions = new Map(summary.modes.map((mode) => [mode.id, createArenaGameState(mode.id)]));
  let opened = panel.hidden !== true;
  let trace = [];

  function state() {
    return sessions.get(selectedModeId) ?? createArenaGameState(selectedModeId);
  }

  function setOpen(next, method = "api") {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.classList?.toggle?.("visible", opened);
    panel.setAttribute?.("aria-hidden", String(!opened));
    if (opened && method === "open") modeList.querySelector?.(`[data-mode-id="${selectedModeId}"]`)?.focus?.({ preventScroll: true });
  }

  function pushTrace(entry) {
    trace = [deepFreeze({
      ...entry,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    }), ...trace].slice(0, 12);
  }

  function renderTrace() {
    traceEl.replaceChildren();
    if (!trace.length) {
      traceEl.appendChild(createText(documentRoot, "div", "arena-games-empty", "No local action yet. Select a mode and choose a legal action."));
      return;
    }
    trace.forEach((entry, index) => {
      const verdict = entry.accepted === false ? `REJECTED · ${entry.reason}` : "ACCEPTED";
      traceEl.appendChild(createText(documentRoot, "div", "arena-games-trace-row", `${index + 1} · ${String(entry.actionId).toUpperCase()} · ${verdict} · ${entry.hash ?? "NO HASH"}`));
    });
  }

  function renderModes() {
    modeList.replaceChildren();
    summary.modes.forEach((mode) => {
      const button = documentRoot.createElement("button");
      button.type = "button";
      button.className = "arena-games-mode";
      button.dataset.modeId = mode.id;
      button.setAttribute("aria-pressed", String(mode.id === selectedModeId));
      button.append(
        createText(documentRoot, "strong", "arena-games-mode-title", mode.label),
        createText(documentRoot, "span", "arena-games-mode-meta", mode.subtitle),
      );
      button.addEventListener("click", () => selectMode(mode.id, "button"));
      modeList.appendChild(button);
    });
  }

  function renderActions() {
    actionList.replaceChildren();
    const current = state();
    current.legalActions.forEach((action) => {
      const button = documentRoot.createElement("button");
      button.type = "button";
      button.className = "arena-games-action";
      button.dataset.actionId = action.id;
      button.disabled = !action.enabled;
      button.title = action.description;
      button.append(
        createText(documentRoot, "strong", "arena-games-action-title", action.label),
        createText(documentRoot, "span", "arena-games-action-meta", action.reason),
      );
      button.addEventListener("click", () => act(action.id, "button"));
      actionList.appendChild(button);
    });
  }

  function renderCurrent() {
    const current = state();
    const mode = modeFrom(summary, selectedModeId);
    currentEl.textContent = `${mode?.label ?? current.modeLabel} · ${current.status.toUpperCase()} · ${JSON.stringify(current.values)}`;
    if (turnEl) turnEl.textContent = `${current.turn} / ${mode?.maxTurns ?? "—"}`;
    if (hashEl) hashEl.textContent = `${current.headHash} · ${ARENA_GAMES_HASH_ALGORITHM_LABEL}`;
    statusEl.textContent = current.status === "complete"
      ? `COMPLETE · ${current.turn} TURN${current.turn === 1 ? "" : "S"} · REPLAY OR RESET LOCALLY`
      : current.rejectedActionCount
        ? `READY · ${current.rejectedActionCount} REJECTED ACTION${current.rejectedActionCount === 1 ? "" : "S"} SURFACED · LOCAL ONLY`
        : `READY · ${current.turn} TURN${current.turn === 1 ? "" : "S"} · LOCAL ONLY`;
    if (boundaryEl) boundaryEl.textContent = summary.boundary;
    replayButton.disabled = current.events.length === 0;
    resetButton.disabled = current.events.length === 0;
  }

  function render() {
    renderModes();
    renderActions();
    renderCurrent();
    renderTrace();
  }

  function selectMode(modeId, method = "button") {
    const mode = modeFrom(summary, modeId);
    if (!mode) return null;
    selectedModeId = mode.id;
    if (!sessions.has(mode.id)) sessions.set(mode.id, createArenaGameState(mode.id));
    const snapshot = deepFreeze({
      source: ARENA_GAMES_CONSOLE_SOURCE,
      action: "select-mode",
      method,
      modeId: mode.id,
      mode,
      state: state(),
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    pushTrace({ actionId: `mode:${mode.id}`, accepted: true, hash: state().headHash });
    render();
    onMode?.(snapshot);
    if (onSelect && onSelect !== onMode) onSelect(snapshot);
    return snapshot;
  }

  function act(actionId, method = "button") {
    const current = state();
    const result = applyArenaGameAction(current, actionId);
    sessions.set(selectedModeId, result.state);
    pushTrace({ actionId: result.actionId, accepted: result.accepted, reason: result.reason, hash: result.event.hash });
    render();
    const snapshot = deepFreeze({
      source: ARENA_GAMES_CONSOLE_SOURCE,
      action: "game-action",
      method,
      modeId: selectedModeId,
      result,
      state: result.state,
      accepted: result.accepted,
      rejected: result.rejected,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    onAction?.(snapshot);
    return snapshot;
  }

  function replay(method = "button") {
    const current = state();
    const actionIds = current.events.map((event) => event.actionId);
    const result = replayArenaGame(selectedModeId, actionIds);
    sessions.set(selectedModeId, result.state);
    pushTrace({ actionId: "replay", accepted: true, hash: result.headHash });
    render();
    const snapshot = deepFreeze({
      source: ARENA_GAMES_CONSOLE_SOURCE,
      action: "replay",
      method,
      modeId: selectedModeId,
      result,
      state: result.state,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    onReplay?.(snapshot);
    return snapshot;
  }

  function reset(method = "button") {
    const result = resetArenaGame(selectedModeId);
    sessions.set(selectedModeId, result.state);
    pushTrace({ actionId: "reset", accepted: true, hash: result.state.headHash });
    render();
    const snapshot = deepFreeze({
      source: ARENA_GAMES_CONSOLE_SOURCE,
      action: "reset",
      method,
      modeId: selectedModeId,
      result,
      state: result.state,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    onReset?.(snapshot);
    return snapshot;
  }

  function syncProjection(nextProjection) {
    summary = summarizeArenaGames(nextProjection);
    summary.modes.forEach((mode) => {
      if (!sessions.has(mode.id)) sessions.set(mode.id, createArenaGameState(mode.id));
    });
    if (!modeFrom(summary, selectedModeId)) selectedModeId = summary.modes[0]?.id ?? "nebula-rally";
    render();
    return getSnapshot();
  }

  function getSnapshot() {
    const current = state();
    return deepFreeze({
      source: ARENA_GAMES_CONSOLE_SOURCE,
      summary,
      modeId: selectedModeId,
      state: current,
      opened,
      trace,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
      boundary: summary.boundary ?? ARENA_GAMES_BOUNDARY,
    });
  }

  closeButton.addEventListener("click", () => setOpen(false, "close"));
  replayButton.addEventListener("click", () => replay("button"));
  resetButton.addEventListener("click", () => reset("button"));
  documentRoot.addEventListener?.("keydown", (event) => {
    if (event.key === "Escape" && opened) setOpen(false, "escape");
  });

  render();
  setOpen(opened, "initial");

  return Object.freeze({
    open: () => setOpen(true, "open"),
    close: () => setOpen(false, "close"),
    toggle: () => setOpen(!opened, "toggle"),
    selectMode,
    action: act,
    act,
    replay,
    reset,
    syncProjection,
    setProjection: syncProjection,
    getSnapshot,
    destroy: () => {},
  });
}

// Keep the hash label in one renderer constant so a future visual host can
// replace the copy without changing the domain's intentionally non-crypto
// event chain.
const ARENA_GAMES_HASH_ALGORITHM_LABEL = "stable local chain";

export const createArenaGamesLayer = createArenaGamesConsole;
export const createGameLabConsole = createArenaGamesConsole;
export const createArenaGameConsole = createArenaGamesConsole;
export const createArenaGamesRenderer = createArenaGamesConsole;

export default createArenaGamesConsole;
