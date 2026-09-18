/**
 * ARENA / Game Lab — a deterministic local rehearsal of the old world-games
 * concepts.  The game state is deliberately small and data-only: it can be
 * projected into the Living Reality scene, but it is not a service, reward
 * system, wallet, token, network session, or imported game runtime.
 */

export const ARENA_GAMES_SCHEMA_VERSION = 1;
export const ARENA_GAMES_SOURCE = "arena-games";
export const ARENA_GAMES_UPDATED_AT = "2025-01-01T00:00:00.000Z";
export const ARENA_GAMES_ACTION_SOURCE = "arena-games-action";
export const ARENA_GAMES_REPLAY_SOURCE = "arena-games-replay";
export const ARENA_GAMES_RESET_SOURCE = "arena-games-reset";
export const ARENA_GAMES_CONSOLE_SOURCE = "arena-games-console";
export const ARENA_GAMES_GENESIS_HASH = "00000000";
export const ARENA_GAMES_HASH_ALGORITHM = "stable-fnv1a32-not-cryptographic";

export const ARENA_GAMES_BOUNDARY =
  "ARENA is a local game rehearsal. No network, multiplayer service, reward, wallet, token, persistence, imported code, identity, or external execution is active.";

const GAME_STATUS = Object.freeze({ READY: "ready", RUNNING: "running", COMPLETE: "complete" });
const MAX_TRACE = 32;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    value.forEach((entry) => deepFreeze(entry));
    return Object.freeze(value);
  }
  if (!isRecord(value)) return value;
  Object.values(value).forEach((entry) => deepFreeze(entry));
  return Object.freeze(value);
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(`${field} must be a non-empty string`);
  return value;
}

function requireModeId(value) {
  const id = requireString(value, "modeId");
  if (!MODE_BY_ID.has(id)) throw new TypeError(`Unknown ARENA mode: ${id}`);
  return id;
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (!isRecord(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(",")}}`;
}

/** Stable, bounded hash for a visible local event chain; not a cryptographic proof. */
function hashEvent(previousHash, event) {
  const input = `${previousHash}|${stableValue(event)}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export const hashArenaGameEvent = hashEvent;
export const serializeArenaGameValue = stableValue;

function eventPayload(event) {
  return {
    seq: event?.seq,
    modeId: event?.modeId,
    actionId: event?.actionId,
    accepted: event?.accepted,
    reason: event?.reason ?? null,
    turn: event?.turn,
    before: valuesForSnapshot(event?.before),
    after: valuesForSnapshot(event?.after),
  };
}

/** Check the visible local chain; this is tamper-evident-ish metadata, not proof. */
export function verifyArenaGameEventChain(events, genesisHash = ARENA_GAMES_GENESIS_HASH) {
  if (!Array.isArray(events) || typeof genesisHash !== "string") return false;
  let previousHash = genesisHash;
  for (const event of events) {
    if (!isRecord(event) || event.previousHash !== previousHash) return false;
    const expected = hashEvent(previousHash, eventPayload(event));
    if (event.hash !== expected || event.eventHash !== expected) return false;
    previousHash = expected;
  }
  return true;
}

export const isArenaGameChainValid = verifyArenaGameEventChain;

function action(id, label, description) {
  return Object.freeze({ id, label, description });
}

export const ARENA_GAME_MODES = Object.freeze([
  Object.freeze({
    id: "nebula-rally",
    label: "Nebula Rally",
    subtitle: "Boost a survey craft through a seven-sector lane.",
    objective: "Reach sector 7 before the six-turn rehearsal ends.",
    maxTurns: 6,
    actions: Object.freeze([
      action("boost", "Boost", "Advance two sectors and spend one energy."),
      action("drift", "Drift", "Advance one sector without spending energy."),
      action("scan", "Scan", "Hold position and recover one energy."),
    ]),
  }),
  Object.freeze({
    id: "chrono-grid",
    label: "Chrono Grid",
    subtitle: "Navigate a compact grid without leaving its boundary.",
    objective: "Reach coordinate (2, 2) before the six-step rehearsal ends.",
    maxTurns: 6,
    actions: Object.freeze([
      action("north", "North", "Move one cell toward the north edge."),
      action("east", "East", "Move one cell toward the east edge."),
      action("south", "South", "Move one cell toward the south edge."),
      action("west", "West", "Move one cell toward the west edge."),
      action("stabilize", "Stabilize", "Hold position and restore one stability point."),
    ]),
  }),
  Object.freeze({
    id: "orbital-duel",
    label: "Orbital Duel",
    subtitle: "Charge, shield, and pulse against a fictional rival orbit.",
    objective: "Reduce the rival shield to zero before six rounds elapse.",
    maxTurns: 6,
    actions: Object.freeze([
      action("charge", "Charge", "Gain one charge for a later pulse."),
      action("shield", "Shield", "Raise your shield by one, up to three."),
      action("pulse", "Pulse", "Spend two charge to reduce the rival shield by two."),
    ]),
  }),
]);

export const ARENA_GAMES_MODES = ARENA_GAME_MODES;
export const ARENA_GAME_STATUS = GAME_STATUS;
const MODE_BY_ID = new Map(ARENA_GAME_MODES.map((mode) => [mode.id, mode]));

export const ARENA_GAMES_CAPABILITIES = deepFreeze([
  {
    id: "arena-games.inspect",
    label: "Inspect local game state",
    enabled: true,
    mode: "local-projection",
    authority: "none",
    simulationOnly: true,
    executable: false,
  },
  {
    id: "arena-games.action",
    label: "Advance a validated local turn",
    enabled: true,
    mode: "local-state-transition",
    authority: "none",
    simulationOnly: true,
    executable: false,
  },
  {
    id: "arena-games.replay",
    label: "Replay an in-memory action trace",
    enabled: true,
    mode: "local-replay",
    authority: "none",
    simulationOnly: true,
    executable: false,
  },
  {
    id: "arena-games.network",
    label: "Join a remote game or multiplayer service",
    enabled: false,
    mode: "denied",
    authority: "none",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "This Game Lab has no network or multiplayer authority.",
  },
  {
    id: "arena-games.rewards",
    label: "Issue rewards, tokens, or value",
    enabled: false,
    mode: "denied",
    authority: "none",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "Scores and outcomes are local rehearsal data only.",
  },
  {
    id: "arena-games.imported-runtime",
    label: "Run code from an imported game project",
    enabled: false,
    mode: "denied",
    authority: "none",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "The bridge contains fixed data and transition rules only.",
  },
  {
    id: "arena-games.persistence",
    label: "Persist a match or player identity",
    enabled: false,
    mode: "denied",
    authority: "none",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "State is in-memory for this page/session only.",
  },
]);

function modeDefinition(modeId) {
  return MODE_BY_ID.get(requireModeId(modeId));
}

function initialValues(modeId) {
  if (modeId === "nebula-rally") return { progress: 0, energy: 3, target: 7 };
  if (modeId === "chrono-grid") return { position: [0, 0], target: [2, 2], stability: 3, gridSize: 3 };
  return { shield: 2, rivalShield: 6, charge: 0, maxShield: 3 };
}

function valuesForSnapshot(values) {
  return isRecord(values) ? { ...values, position: Array.isArray(values.position) ? [...values.position] : values.position, target: Array.isArray(values.target) ? [...values.target] : values.target } : {};
}

function eventBase(state, actionId, accepted, reason = null, before = null, after = null) {
  return {
    seq: state.events.length + 1,
    modeId: state.modeId,
    actionId,
    accepted,
    reason,
    turn: state.turn,
    before: before ?? valuesForSnapshot(state.values),
    after: after ?? valuesForSnapshot(state.values),
  };
}

function withEvent(state, event) {
  const previousHash = state.headHash;
  const hash = hashEvent(previousHash, event);
  const entry = deepFreeze({
    ...event,
    previousHash,
    hash,
    previousEventHash: previousHash,
    eventHash: hash,
    hashAlgorithm: ARENA_GAMES_HASH_ALGORITHM,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  });
  return { entry, events: [...state.events, entry], headHash: hash };
}

function modeComplete(modeId, values, turn) {
  if (modeId === "nebula-rally") return values.progress >= values.target || turn >= 6;
  if (modeId === "chrono-grid") return (values.position[0] === values.target[0] && values.position[1] === values.target[1]) || turn >= 6;
  return values.rivalShield <= 0 || turn >= 6;
}

function deriveStatus(modeId, values, turn, accepted) {
  if (modeComplete(modeId, values, turn)) return GAME_STATUS.COMPLETE;
  return accepted || turn > 0 ? GAME_STATUS.RUNNING : GAME_STATUS.READY;
}

function legalActionDescriptors(state) {
  const mode = modeDefinition(state.modeId);
  const values = state.values;
  return mode.actions.map((definition) => {
    let enabled = state.status !== GAME_STATUS.COMPLETE;
    let reason = enabled ? "legal" : "match is complete";
    if (enabled && state.modeId === "nebula-rally" && definition.id === "boost" && values.energy < 1) {
      enabled = false;
      reason = "requires one energy";
    }
    if (enabled && state.modeId === "chrono-grid") {
      const [x, y] = values.position;
      const out = (definition.id === "north" && y >= values.gridSize - 1)
        || (definition.id === "east" && x >= values.gridSize - 1)
        || (definition.id === "south" && y <= 0)
        || (definition.id === "west" && x <= 0);
      if (out) {
        enabled = false;
        reason = "would leave the grid";
      }
    }
    if (enabled && state.modeId === "orbital-duel" && definition.id === "pulse" && values.charge < 2) {
      enabled = false;
      reason = "requires two charge";
    }
    return deepFreeze({ id: definition.id, label: definition.label, description: definition.description, enabled, reason });
  });
}

function createState(modeId, overrides = {}) {
  const mode = modeDefinition(modeId);
  const values = valuesForSnapshot(overrides.values ?? initialValues(mode.id));
  const state = {
    schemaVersion: ARENA_GAMES_SCHEMA_VERSION,
    source: ARENA_GAMES_SOURCE,
    sessionId: `arena-session:${mode.id}`,
    modeId: mode.id,
    modeLabel: mode.label,
    objective: mode.objective,
    turn: Number.isSafeInteger(overrides.turn) ? overrides.turn : 0,
    step: Number.isSafeInteger(overrides.step) ? overrides.step : Number.isSafeInteger(overrides.turn) ? overrides.turn : 0,
    status: overrides.status ?? GAME_STATUS.READY,
    values,
    events: Array.isArray(overrides.events) ? [...overrides.events] : [],
    headHash: overrides.headHash ?? ARENA_GAMES_GENESIS_HASH,
    lastAction: overrides.lastAction ?? null,
    lastEvent: overrides.lastEvent ?? null,
    rejectedActionCount: Number.isSafeInteger(overrides.rejectedActionCount) ? overrides.rejectedActionCount : 0,
    localOnly: true,
    simulation: true,
    fictional: true,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    persistence: false,
  };
  state.legalActions = legalActionDescriptors(state);
  // Aliases keep the chain discoverable to renderer and test hosts without
  // creating another mutable array or second source of truth.
  state.eventChain = state.events;
  state.hashChain = state.events;
  state.lastHash = state.headHash;
  state.hashChainValid = verifyArenaGameEventChain(state.events, ARENA_GAMES_GENESIS_HASH);
  return deepFreeze(state);
}

export function createArenaGameState(modeId = "nebula-rally") {
  return createState(modeId);
}

export const createArenaSession = createArenaGameState;

function actionIdFrom(input) {
  if (typeof input === "string") return input;
  if (isRecord(input)) {
    if (typeof input.id === "string") return input.id;
    if (typeof input.actionId === "string") return input.actionId;
    if (typeof input.action === "string") return input.action;
    if (typeof input.type === "string") return input.type;
  }
  return String(input ?? "");
}

function transitionValues(modeId, values, actionId) {
  const next = valuesForSnapshot(values);
  if (modeId === "nebula-rally") {
    if (actionId === "boost") { next.progress = Math.min(next.target, next.progress + 2); next.energy -= 1; }
    if (actionId === "drift") next.progress = Math.min(next.target, next.progress + 1);
    if (actionId === "scan") next.energy = Math.min(3, next.energy + 1);
  } else if (modeId === "chrono-grid") {
    const [x, y] = next.position;
    if (actionId === "north") next.position = [x, Math.min(next.gridSize - 1, y + 1)];
    if (actionId === "east") next.position = [Math.min(next.gridSize - 1, x + 1), y];
    if (actionId === "south") next.position = [x, Math.max(0, y - 1)];
    if (actionId === "west") next.position = [Math.max(0, x - 1), y];
    if (actionId === "stabilize") next.stability = Math.min(3, next.stability + 1);
    if (actionId !== "stabilize") next.stability = Math.max(0, next.stability - 1);
  } else {
    if (actionId === "charge") next.charge = Math.min(4, next.charge + 1);
    if (actionId === "shield") next.shield = Math.min(next.maxShield, next.shield + 1);
    if (actionId === "pulse") { next.charge -= 2; next.rivalShield = Math.max(0, next.rivalShield - 2); }
  }
  return next;
}

function rejection(state, actionId, reason) {
  const event = eventBase(state, actionId || "unknown", false, reason);
  const chained = withEvent(state, event);
  const next = createState(state.modeId, {
    ...state,
    events: chained.events,
    headHash: chained.headHash,
    lastAction: actionId || "unknown",
    lastEvent: chained.entry,
    rejectedActionCount: state.rejectedActionCount + 1,
  });
  return deepFreeze({
    source: ARENA_GAMES_ACTION_SOURCE,
    actionId: actionId || "unknown",
    accepted: false,
    rejected: true,
    reason,
    previousState: state,
    state: next,
    event: chained.entry,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  });
}

/** Validate first, then atomically return a new state and chained event. */
export function applyArenaGameAction(state, input) {
  if (typeof state === "string") state = createArenaGameState(state);
  if (!isRecord(state) || typeof state.modeId !== "string" || !isRecord(state.values)) {
    throw new TypeError("state must be an ARENA game state");
  }
  const modeId = requireModeId(state.modeId);
  const actionId = actionIdFrom(input);
  const definition = modeDefinition(modeId).actions.find((candidate) => candidate.id === actionId);
  if (!definition) return rejection(state, actionId, "unknown action for this mode");
  if (state.status === GAME_STATUS.COMPLETE) return rejection(state, actionId, "match is complete");
  const legal = legalActionDescriptors(state).find((candidate) => candidate.id === actionId);
  if (!legal?.enabled) return rejection(state, actionId, legal?.reason ?? "action is not legal in the current state");

  const before = valuesForSnapshot(state.values);
  const after = transitionValues(modeId, before, actionId);
  const turn = state.turn + 1;
  const status = deriveStatus(modeId, after, turn, true);
  const event = eventBase(state, actionId, true, null, before, after);
  event.turn = turn;
  const chained = withEvent(state, event);
  const next = createState(modeId, {
    ...state,
    turn,
    step: turn,
    status,
    values: after,
    events: chained.events,
    headHash: chained.headHash,
    lastAction: actionId,
    lastEvent: chained.entry,
  });
  return deepFreeze({
    source: ARENA_GAMES_ACTION_SOURCE,
    actionId,
    accepted: true,
    rejected: false,
    previousState: state,
    state: next,
    event: chained.entry,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  });
}

export const advanceArenaGame = applyArenaGameAction;
export const actionArenaGame = applyArenaGameAction;

function actionsFromReplay(input, maybeActions) {
  if (Array.isArray(input)) return { modeId: "nebula-rally", actions: input };
  if (typeof input === "string") return { modeId: input, actions: Array.isArray(maybeActions) ? maybeActions : [] };
  if (isRecord(input)) {
    return {
      modeId: input.modeId ?? input.state?.modeId ?? "nebula-rally",
      actions: input.actions
        ?? input.actionIds
        ?? input.events?.map((event) => event?.actionId)
        ?? input.state?.events?.map((event) => event?.actionId)
        ?? [],
    };
  }
  return { modeId: "nebula-rally", actions: [] };
}

export function replayArenaGame(input = "nebula-rally", maybeActions = []) {
  const { modeId, actions } = actionsFromReplay(input, maybeActions);
  let state = createArenaGameState(modeId);
  const results = [];
  const requested = Array.isArray(actions) ? actions : [];
  requested.slice(0, MAX_TRACE).forEach((candidate) => {
    const result = applyArenaGameAction(state, candidate);
    results.push(result);
    state = result.state;
  });
  return deepFreeze({
    source: ARENA_GAMES_REPLAY_SOURCE,
    modeId: state.modeId,
    actionIds: Object.freeze(requested.slice(0, MAX_TRACE).map(actionIdFrom)),
    results: Object.freeze(results),
    state,
    acceptedCount: results.filter((result) => result.accepted).length,
    rejectedCount: results.filter((result) => !result.accepted).length,
    eventCount: state.events.length,
    headHash: state.headHash,
    deterministic: true,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    persistence: false,
    boundary: ARENA_GAMES_BOUNDARY,
  });
}

export const replayArenaSession = replayArenaGame;

export function resetArenaGame(input = "nebula-rally") {
  const modeId = typeof input === "string" ? input : input?.modeId ?? "nebula-rally";
  return deepFreeze({
    source: ARENA_GAMES_RESET_SOURCE,
    modeId: requireModeId(modeId),
    state: createArenaGameState(modeId),
    action: "reset",
    deterministic: true,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    persistence: false,
    boundary: ARENA_GAMES_BOUNDARY,
  });
}

export const resetArenaSession = resetArenaGame;

function modeEntity(mode) {
  return {
    id: `arena-mode:${mode.id}`,
    kind: "arena-game-mode",
    modeId: mode.id,
    label: mode.label,
    subtitle: mode.subtitle,
    objective: mode.objective,
    maxTurns: mode.maxTurns,
    actionIds: mode.actions.map(({ id }) => id),
    simulation: true,
    fictional: true,
    localOnly: true,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  };
}

/** Build the canonical projection contribution consumed by later render integration. */
export function createArenaGamesContribution({ updatedAt = ARENA_GAMES_UPDATED_AT } = {}) {
  requireString(updatedAt, "updatedAt");
  const modes = ARENA_GAME_MODES.map(modeEntity);
  const sessions = ARENA_GAME_MODES.map((mode) => createArenaGameState(mode.id));
  const entities = [...modes, ...sessions.map((session) => ({
    id: session.sessionId,
    kind: "arena-game-session",
    modeId: session.modeId,
    status: session.status,
    turn: session.turn,
    values: session.values,
    headHash: session.headHash,
    simulation: true,
    fictional: true,
    localOnly: true,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  }))];
  return deepFreeze({
    schemaVersion: ARENA_GAMES_SCHEMA_VERSION,
    source: ARENA_GAMES_SOURCE,
    kind: "arena-games-projection",
    updatedAt,
    modes: ARENA_GAME_MODES,
    sessions,
    entities,
    evidence: [
      {
        id: `arena-games-layout:${updatedAt}`,
        kind: "deterministic-game-lab",
        status: "declared",
        modeCount: ARENA_GAME_MODES.length,
        hashAlgorithm: ARENA_GAMES_HASH_ALGORITHM,
        simulation: true,
        deterministic: true,
      },
      {
        id: `arena-games-boundary:${updatedAt}`,
        kind: "simulation-boundary",
        status: "enforced",
        network: false,
        multiplayer: false,
        rewards: false,
        wallet: false,
        token: false,
        persistence: false,
        importedCode: false,
        executable: false,
      },
    ],
    capabilities: ARENA_GAMES_CAPABILITIES,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
    boundary: ARENA_GAMES_BOUNDARY,
  });
}

export const createArenaGamesProjection = createArenaGamesContribution;
export const DEFAULT_ARENA_GAMES = createArenaGamesContribution();
export const ARENA_GAMES_PROJECTION = DEFAULT_ARENA_GAMES;

export default DEFAULT_ARENA_GAMES;
