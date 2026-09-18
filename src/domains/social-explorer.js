/**
 * Social Explorer / Re-market rehearsal Ω.
 *
 * This contribution describes how a fictional community could discover,
 * discuss, create, and preview reuse of a shared Living Reality.  It is a
 * frozen local catalog, not a social network, marketplace, recipient list, or
 * asset-transfer engine.  Every card, room, signal, and action is aggregate
 * or fictional and carries an explicit simulation boundary.
 */

export const SOCIAL_EXPLORER_SCHEMA_VERSION = 1;
export const SOCIAL_EXPLORER_SOURCE = "social-explorer-rehearsal";
export const SOCIAL_EXPLORER_KIND = "social-explorer-rehearsal";
export const SOCIAL_EXPLORER_UPDATED_AT = "2025-01-01T00:00:00.000Z";
export const SOCIAL_EXPLORER_ID = "social-explorer:demo";
export const SOCIAL_EXPLORER_REHEARSAL_ID = "social-rehearsal:tumbo-demo-launch";
export const SOCIAL_EXPLORER_ASSET_LAUNCH_ID = "distribution:tumbo-demo-launch";
/**
 * The social destination is intentionally a four-step local route rather
 * than four unrelated buttons. Keeping the order in the domain means the
 * renderer can reject an out-of-order click without inventing a second
 * source of truth.
 */
export const SOCIAL_EXPLORER_FLOW_INTENTS = Object.freeze([
  "discover",
  "discuss",
  "create",
  "allocate-preview",
]);
export const SOCIAL_EXPLORER_FLOW_SEQUENCE = SOCIAL_EXPLORER_FLOW_INTENTS;
export const SOCIAL_EXPLORER_FLOW_SOURCE = "social-explorer-flow";

const freeze = (value) => {
  if (Array.isArray(value)) {
    value.forEach(freeze);
    return Object.freeze(value);
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  }
  return value;
};

const localRecord = (record) => freeze({
  ...record,
  source: SOCIAL_EXPLORER_SOURCE,
  simulation: true,
  fictional: true,
  aggregate: true,
  authority: "none",
  externalNetwork: false,
  externalTransfer: false,
  executable: false,
});

/**
 * The launch-plan projection is a second, deliberately small cursor layered
 * over the social catalog.  It describes two ways to rehearse the same local
 * route; it is not a participation registry, an onboarding service, or an
 * allocation engine.  Keeping the mode and phase order here lets every
 * renderer consume one immutable launch story without inventing its own
 * sequence.
 */
export const SOCIAL_EXPLORER_LAUNCH_PLAN_SCHEMA_VERSION = 1;
export const SOCIAL_EXPLORER_LAUNCH_PLAN_SOURCE = "social-explorer-launch-plan";
export const SOCIAL_EXPLORER_LAUNCH_PLAN_KIND = "social-explorer-launch-plan";
export const SOCIAL_EXPLORER_LAUNCH_PLAN_ID = "social-launch-plan:tumbo-demo-launch";

const LAUNCH_MODE_DEFINITIONS = [
  {
    id: "social-experiment",
    label: "Social experiment",
    summary: "Opt in to a local discovery and community-reuse rehearsal.",
    route: "social-explorer",
    participation: "opt-in",
  },
  {
    id: "space-explorer",
    label: "Space explorer",
    summary: "Opt in to a local space-first route through rooms and nested blocks.",
    route: "space-explorer",
    participation: "opt-in",
  },
];

const LAUNCH_PHASE_DEFINITIONS = [
  {
    id: "opt-in",
    ordinal: 1,
    label: "Choose an opt-in mode",
    intent: "select-mode",
    summary: "Pick a rehearsal mode; no participant enrollment or identity is recorded.",
  },
  {
    id: "explore",
    ordinal: 2,
    label: "Explore the local route",
    intent: "explore",
    summary: "Browse fictional rooms, signals, and nested space locally.",
  },
  {
    id: "create",
    ordinal: 3,
    label: "Create a local artifact",
    intent: "create",
    summary: "Compose a fictional community artifact without publishing or sending it.",
  },
  {
    id: "allocate-preview",
    ordinal: 4,
    label: "Preview TUMBO allocation",
    intent: "allocate-preview",
    summary: "Read the canonical TUMBO asset-token schedule as preview-only data.",
  },
];

export const SOCIAL_EXPLORER_LAUNCH_MODES = freeze(
  LAUNCH_MODE_DEFINITIONS.map((mode) => ({
    ...mode,
    modeId: mode.id,
    status: "available-preview",
    optIn: true,
    optInOnly: true,
    optInRequired: true,
    participationPolicy: "opt-in-only",
    participantStatus: "not-enrolled",
    simulation: true,
    fictional: true,
    aggregate: true,
    deterministic: true,
    localOnly: true,
    authority: "none",
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
  })),
);
export const SOCIAL_EXPLORER_LAUNCH_PLAN_MODES = SOCIAL_EXPLORER_LAUNCH_MODES;

export const SOCIAL_EXPLORER_LAUNCH_PHASES = freeze(
  LAUNCH_PHASE_DEFINITIONS.map((phase) => ({
    ...phase,
    phaseId: phase.id,
    status: "frozen-preview",
    simulation: true,
    fictional: true,
    aggregate: true,
    deterministic: true,
    localOnly: true,
    authority: "none",
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
  })),
);
export const SOCIAL_EXPLORER_LAUNCH_PLAN_PHASES = SOCIAL_EXPLORER_LAUNCH_PHASES;
export const SOCIAL_EXPLORER_LAUNCH_PHASE_IDS = Object.freeze(
  SOCIAL_EXPLORER_LAUNCH_PHASES.map((phase) => phase.id),
);

const launchPlanRecord = (record) => freeze({
  ...record,
  source: SOCIAL_EXPLORER_LAUNCH_PLAN_SOURCE,
  simulation: true,
  fictional: true,
  aggregate: true,
  deterministic: true,
  localOnly: true,
  authority: "none",
  externalNetwork: false,
  externalTransfer: false,
  persistence: false,
  walletConnection: false,
  recipientAuthority: false,
  signing: false,
  custody: false,
  settlement: false,
  executable: false,
});

function normalizeLaunchModeId(value) {
  const modeId = String(value ?? "");
  if (!SOCIAL_EXPLORER_LAUNCH_MODES.some((mode) => mode.id === modeId)) {
    throw new RangeError(`unknown social explorer launch mode: ${modeId || "empty"}`);
  }
  return modeId;
}

function normalizeLaunchPhaseIds(value) {
  if (!Array.isArray(value)) throw new TypeError("completedPhaseIds must be an array");
  const phaseIds = value.map((phaseId) => String(phaseId));
  if (phaseIds.length > SOCIAL_EXPLORER_LAUNCH_PHASE_IDS.length) {
    throw new RangeError("social explorer launch plan cannot exceed four phases");
  }
  phaseIds.forEach((phaseId, index) => {
    if (phaseId !== SOCIAL_EXPLORER_LAUNCH_PHASE_IDS[index]) {
      throw new RangeError(
        `social explorer launch plan expected ${SOCIAL_EXPLORER_LAUNCH_PHASE_IDS[index] ?? "reset"} at phase ${index + 1}`,
      );
    }
  });
  return phaseIds;
}

function safeReplayCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function canonicalAllocationPreviewReference() {
  return freeze({
    source: "tumbo-distribution-registry",
    launchId: SOCIAL_EXPLORER_ASSET_LAUNCH_ID,
    status: "preview-only",
    distributionStatus: "preview-only",
    canonical: true,
    duplicateSchedule: false,
    scheduleOwnedBy: "tumbo-distribution-registry",
    localOnly: true,
    simulation: true,
    aggregate: true,
    fictional: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
  });
}

/**
 * Build the immutable two-mode launch-plan cursor.  The allocation field is
 * only a reference to the canonical registry contribution; this function
 * intentionally contains no rows, percentages, units, recipients, or
 * transfer instructions.
 */
export function createSocialExplorerLaunchPlan({
  modeId = "social-experiment",
  completedPhaseIds = [],
  replayCount = 0,
  updatedAt = SOCIAL_EXPLORER_UPDATED_AT,
} = {}) {
  requireTimestamp(updatedAt);
  const selectedModeId = normalizeLaunchModeId(modeId);
  const completed = normalizeLaunchPhaseIds(completedPhaseIds);
  const nextPhaseId = SOCIAL_EXPLORER_LAUNCH_PHASE_IDS[completed.length] ?? null;
  const selectedMode = SOCIAL_EXPLORER_LAUNCH_MODES.find((mode) => mode.id === selectedModeId);
  return launchPlanRecord({
    schemaVersion: SOCIAL_EXPLORER_LAUNCH_PLAN_SCHEMA_VERSION,
    kind: SOCIAL_EXPLORER_LAUNCH_PLAN_KIND,
    id: SOCIAL_EXPLORER_LAUNCH_PLAN_ID,
    updatedAt,
    modeId: selectedModeId,
    selectedModeId,
    mode: selectedMode,
    modes: SOCIAL_EXPLORER_LAUNCH_MODES,
    phases: SOCIAL_EXPLORER_LAUNCH_PHASES,
    phaseSequence: SOCIAL_EXPLORER_LAUNCH_PHASE_IDS,
    phaseIds: SOCIAL_EXPLORER_LAUNCH_PHASE_IDS,
    completedPhaseIds: completed,
    nextPhaseId,
    phaseIndex: completed.length,
    phaseCount: SOCIAL_EXPLORER_LAUNCH_PHASE_IDS.length,
    complete: nextPhaseId === null,
    replayCount: safeReplayCount(replayCount),
    participation: "opt-in",
    participationPolicy: "opt-in-only",
    participationStatus: "opt-in-not-recorded",
    optIn: true,
    optInOnly: true,
    optInRequired: true,
    distributionStatus: "preview-only",
    status: nextPhaseId === null ? "preview-only-distribution-ready" : "local-launch-preview",
    allocationPreview: canonicalAllocationPreviewReference(),
    accepted: true,
    rejected: false,
  });
}

export const createSocialExplorerLaunchPlanDraft = createSocialExplorerLaunchPlan;
export const createSocialExplorerLaunchPlanProjection = createSocialExplorerLaunchPlan;

function normalizeLaunchPlan(plan) {
  return createSocialExplorerLaunchPlan({
    modeId: plan?.modeId ?? "social-experiment",
    completedPhaseIds: plan?.completedPhaseIds ?? [],
    replayCount: plan?.replayCount ?? 0,
    updatedAt: plan?.updatedAt ?? SOCIAL_EXPLORER_UPDATED_AT,
  });
}

/** Select a mode and start that mode's local phase cursor from the beginning. */
export function selectSocialExplorerLaunchMode(plan, modeId) {
  const current = normalizeLaunchPlan(plan);
  const requested = String(modeId ?? "");
  if (!SOCIAL_EXPLORER_LAUNCH_MODES.some((mode) => mode.id === requested)) {
    return launchPlanRecord({
      ...current,
      attemptedModeId: requested,
      action: "select-mode",
      accepted: false,
      rejected: true,
      reason: `unknown social explorer launch mode: ${requested || "empty"}`,
    });
  }
  return createSocialExplorerLaunchPlan({
    modeId: requested,
    completedPhaseIds: [],
    replayCount: current.replayCount,
    updatedAt: current.updatedAt,
  });
}

/** Advance only when the requested phase is the next ordered local phase. */
export function advanceSocialExplorerLaunchPhase(plan, phaseId) {
  const current = normalizeLaunchPlan(plan);
  const requested = String(phaseId ?? "");
  if (current.nextPhaseId !== requested) {
    return launchPlanRecord({
      ...current,
      attemptedPhaseId: requested,
      action: "advance-phase",
      accepted: false,
      rejected: true,
      reason: current.nextPhaseId
        ? `next launch phase is ${current.nextPhaseId}`
        : "social explorer launch plan is complete; reset before running it again",
    });
  }
  return createSocialExplorerLaunchPlan({
    modeId: current.modeId,
    completedPhaseIds: [...current.completedPhaseIds, requested],
    replayCount: current.replayCount,
    updatedAt: current.updatedAt,
  });
}

export const advanceSocialExplorerLaunchPlan = advanceSocialExplorerLaunchPhase;

export function resetSocialExplorerLaunchPlan(plan = {}) {
  const current = normalizeLaunchPlan(plan);
  return launchPlanRecord({
    ...createSocialExplorerLaunchPlan({ modeId: current.modeId, updatedAt: current.updatedAt }),
    action: "reset",
    previousPhaseIndex: current.phaseIndex,
  });
}

/**
 * Capability records make the boundary visible in the feature navigator and
 * social-explorer console.  The two enabled capabilities only read/replay
 * immutable projection data; all external or financial paths are denied.
 */
export const SOCIAL_EXPLORER_CAPABILITIES = freeze([
  {
    id: "social-explorer.browse-fictional-cards",
    label: "Browse fictional rooms, creator cards, and discovery signals",
    enabled: true,
    mode: "local-projection",
    authority: "none",
    simulationOnly: true,
    executable: false,
  },
  {
    id: "social-explorer.replay-local-rehearsal",
    label: "Replay a frozen discover → discuss → create → allocate-preview trace",
    enabled: true,
    mode: "local-rehearsal",
    authority: "none",
    simulationOnly: true,
    executable: false,
  },
  {
    id: "social-explorer.external-network",
    label: "Connect to a social network or provider",
    enabled: false,
    mode: "denied",
    authority: "none",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "The explorer has no fetch, WebSocket, provider, or network path.",
  },
  {
    id: "social-explorer.real-recipient",
    label: "Create a real person, county, or organisation recipient",
    enabled: false,
    mode: "denied",
    authority: "none",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "Cards are fictional aggregate cohorts and never become recipients.",
  },
  {
    id: "social-explorer.market-action",
    label: "Show a price, trading pair, buy/sell action, or return promise",
    enabled: false,
    mode: "denied",
    authority: "none",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "Re-market means community reuse rehearsal only; no market exists.",
  },
  {
    id: "social-explorer.asset-transfer",
    label: "Allocate, transfer, custody, or settle a live asset",
    enabled: false,
    mode: "denied",
    authority: "none",
    denied: true,
    simulationOnly: true,
    executable: false,
    reason: "Allocate-preview is a local intent linked to the fixed registry only.",
  },
]);

const ROOM_DEFINITIONS = [
  {
    id: "social-room:discovery-lounge",
    kind: "social-explorer-room",
    type: "room",
    label: "Discovery Lounge",
    mode: "discover",
    summary: "Browse fictional community stories connected to the local world.",
    affordances: ["discover", "discuss"],
  },
  {
    id: "social-room:creator-studio",
    kind: "social-explorer-room",
    type: "room",
    label: "Creator Studio",
    mode: "create",
    summary: "Rehearse how a creator or community card becomes a shareable local artifact.",
    affordances: ["discover", "create"],
  },
  {
    id: "social-room:community-table",
    kind: "social-explorer-room",
    type: "room",
    label: "Community Table",
    mode: "discuss",
    summary: "Discuss a shared experiment with aggregate fictional participants.",
    affordances: ["discuss", "create"],
  },
  {
    id: "social-room:allocation-atlas",
    kind: "social-explorer-room",
    type: "room",
    label: "Allocation Atlas",
    mode: "allocate-preview",
    summary: "Preview how communities could reuse the fixed launch story locally.",
    affordances: ["discover", "allocate-preview"],
  },
];

const CREATOR_CARD_DEFINITIONS = [
  {
    id: "creator-card:river-commons",
    kind: "creator-community-card",
    type: "creator-card",
    label: "River Commons Studio",
    roomId: "social-room:creator-studio",
    theme: "water stewardship stories",
    format: "story capsule",
    summary: "A fictional maker cohort turning local observations into a shared visual story.",
  },
  {
    id: "creator-card:northline-makers",
    kind: "creator-community-card",
    type: "creator-card",
    label: "Northline Makers",
    roomId: "social-room:creator-studio",
    theme: "repair and making",
    format: "how-to constellation",
    summary: "A fictional community card for practical, remixable maker notes.",
  },
  {
    id: "creator-card:open-atlas",
    kind: "creator-community-card",
    type: "creator-card",
    label: "Open Atlas Club",
    roomId: "social-room:discovery-lounge",
    theme: "place-based discovery",
    format: "explorer route",
    summary: "A fictional explorer cohort linking rooms, evidence, and questions.",
  },
  {
    id: "creator-card:civic-signals",
    kind: "creator-community-card",
    type: "creator-card",
    label: "Civic Signals Lab",
    roomId: "social-room:community-table",
    theme: "public-good experiments",
    format: "discussion brief",
    summary: "A fictional civic cohort comparing community questions without asserting facts.",
  },
  {
    id: "creator-card:night-garden",
    kind: "creator-community-card",
    type: "creator-card",
    label: "Night Garden Collective",
    roomId: "social-room:community-table",
    theme: "care and accessibility",
    format: "care map",
    summary: "A fictional care cohort rehearsing accessible participation in the same world.",
  },
  {
    id: "creator-card:commons-research",
    kind: "creator-community-card",
    type: "creator-card",
    label: "Commons Research Desk",
    roomId: "social-room:allocation-atlas",
    theme: "allocation questions",
    format: "allocation-preview note",
    summary: "A fictional research cohort asking how a fixed demo schedule could be reused.",
  },
];

const DISCOVERY_SIGNAL_DEFINITIONS = [
  {
    id: "discovery-signal:room-crossover",
    kind: "discovery-signal",
    type: "signal",
    label: "Room crossover",
    signal: "discover",
    roomId: "social-room:discovery-lounge",
    cardIds: ["creator-card:open-atlas", "creator-card:river-commons"],
    summary: "A local cue connects an explorer route to a community story.",
  },
  {
    id: "discovery-signal:question-thread",
    kind: "discovery-signal",
    type: "signal",
    label: "Question thread",
    signal: "discuss",
    roomId: "social-room:community-table",
    cardIds: ["creator-card:civic-signals", "creator-card:night-garden"],
    summary: "A fictional prompt invites discussion before any artifact is created.",
  },
  {
    id: "discovery-signal:remix-invitation",
    kind: "discovery-signal",
    type: "signal",
    label: "Remix invitation",
    signal: "create",
    roomId: "social-room:creator-studio",
    cardIds: ["creator-card:northline-makers", "creator-card:river-commons"],
    summary: "A local cue proposes a community remix without publishing externally.",
  },
  {
    id: "discovery-signal:allocation-story",
    kind: "discovery-signal",
    type: "signal",
    label: "Allocation story",
    signal: "allocate-preview",
    roomId: "social-room:allocation-atlas",
    cardIds: ["creator-card:commons-research", "creator-card:civic-signals"],
    summary: "A fixed-schedule story is shown as a reuse question, never a transfer.",
  },
  {
    id: "discovery-signal:care-check",
    kind: "discovery-signal",
    type: "signal",
    label: "Care check",
    signal: "discuss",
    roomId: "social-room:community-table",
    cardIds: ["creator-card:night-garden"],
    summary: "A local accessibility cue keeps participation opt-in and fictional.",
  },
  {
    id: "discovery-signal:shared-question",
    kind: "discovery-signal",
    type: "signal",
    label: "Shared question",
    signal: "discover",
    roomId: "social-room:discovery-lounge",
    cardIds: ["creator-card:open-atlas", "creator-card:commons-research"],
    summary: "A fictional cohort asks what to explore next in the local scene.",
  },
];

const REHEARSAL_ACTION_DEFINITIONS = [
  {
    id: "social-action:discover",
    kind: "social-explorer-intent",
    type: "local-rehearsal-action",
    label: "Discover a community story",
    intent: "discover",
    targetId: "social-room:discovery-lounge",
    summary: "Reveal one fictional discovery signal in the local explorer.",
  },
  {
    id: "social-action:discuss",
    kind: "social-explorer-intent",
    type: "local-rehearsal-action",
    label: "Discuss the shared question",
    intent: "discuss",
    targetId: "social-room:community-table",
    summary: "Open a discussion cue without sending a message or contacting a provider.",
  },
  {
    id: "social-action:create",
    kind: "social-explorer-intent",
    type: "local-rehearsal-action",
    label: "Create a remix preview",
    intent: "create",
    targetId: "social-room:creator-studio",
    summary: "Compose a fictional community artifact inside the browser projection.",
  },
  {
    id: "social-action:allocate-preview",
    kind: "social-explorer-intent",
    type: "local-rehearsal-action",
    label: "Preview community reuse",
    intent: "allocate-preview",
    targetId: "social-room:allocation-atlas",
    assetLaunchId: SOCIAL_EXPLORER_ASSET_LAUNCH_ID,
    summary: "Link back to the fixed launch registry as a local reuse question only.",
  },
];

function withOrdinal(definition, ordinal) {
  return localRecord({
    ...definition,
    ordinal,
    status: "frozen-preview",
    deterministic: true,
  });
}

export const SOCIAL_EXPLORER_ROOMS = freeze(
  ROOM_DEFINITIONS.map((definition, index) => withOrdinal(definition, index + 1)),
);
export const SOCIAL_EXPLORER_CREATOR_CARDS = freeze(
  CREATOR_CARD_DEFINITIONS.map((definition, index) => withOrdinal(definition, index + 1)),
);
export const SOCIAL_EXPLORER_DISCOVERY_SIGNALS = freeze(
  DISCOVERY_SIGNAL_DEFINITIONS.map((definition, index) => withOrdinal(definition, index + 1)),
);
export const SOCIAL_EXPLORER_REHEARSAL_ACTIONS = freeze(
  REHEARSAL_ACTION_DEFINITIONS.map((definition, index) => withOrdinal(definition, index + 1)),
);

const allEntities = (rooms, creatorCards, discoverySignals, rehearsalActions) => freeze([
  ...rooms,
  ...creatorCards,
  ...discoverySignals,
  ...rehearsalActions,
]);

function requireTimestamp(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError("updatedAt must be a non-empty string");
  }
  return value;
}

function createEvidence({ updatedAt, rooms, creatorCards, discoverySignals, rehearsalActions }) {
  return freeze([
    {
      id: `social-explorer-catalog:${updatedAt}`,
      kind: "social-explorer-catalog-reconciliation",
      status: "verified",
      simulation: true,
      deterministic: true,
      roomCount: rooms.length,
      creatorCardCount: creatorCards.length,
      discoverySignalCount: discoverySignals.length,
      actionCount: rehearsalActions.length,
      externalNetwork: false,
      note: "The frozen local catalog joins rooms, creator cards, signals, and actions without external records.",
    },
    {
      id: `social-explorer-boundary:${updatedAt}`,
      kind: "simulation-boundary",
      status: "enforced",
      simulation: true,
      network: false,
      provider: false,
      wallet: false,
      signing: false,
      custody: false,
      settlement: false,
      externalTransfer: false,
      realMoney: false,
      note: "Discover, discuss, create, and allocate-preview are local intents; no network or financial action occurs.",
    },
    {
      id: `social-explorer-provenance:${updatedAt}`,
      kind: "deterministic-provenance",
      status: "declared",
      simulation: true,
      deterministic: true,
      source: "local-fixed-fixture",
      version: "social-explorer-rehearsal-v1",
      note: "All entries are fictional aggregate fixtures; no person, provider, price, or market feed is used.",
    },
  ]);
}

/**
 * Compose the frozen social-explorer contribution.  Calling this function
 * repeatedly with the same timestamp returns deeply equivalent immutable data
 * and performs no I/O.
 */
export function createSocialExplorerContribution({
  updatedAt = SOCIAL_EXPLORER_UPDATED_AT,
} = {}) {
  requireTimestamp(updatedAt);
  const rooms = SOCIAL_EXPLORER_ROOMS;
  const creatorCards = SOCIAL_EXPLORER_CREATOR_CARDS;
  const discoverySignals = SOCIAL_EXPLORER_DISCOVERY_SIGNALS;
  const rehearsalActions = SOCIAL_EXPLORER_REHEARSAL_ACTIONS;
  const entities = allEntities(rooms, creatorCards, discoverySignals, rehearsalActions);
  const launchPlan = createSocialExplorerLaunchPlan({ updatedAt });
  const rehearsal = {
    id: SOCIAL_EXPLORER_REHEARSAL_ID,
    status: "ready",
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    assetLaunchId: SOCIAL_EXPLORER_ASSET_LAUNCH_ID,
    steps: [
      { ordinal: 1, intent: "discover", status: "frozen-preview", targetId: "social-room:discovery-lounge" },
      { ordinal: 2, intent: "discuss", status: "frozen-preview", targetId: "social-room:community-table" },
      { ordinal: 3, intent: "create", status: "frozen-preview", targetId: "social-room:creator-studio" },
      { ordinal: 4, intent: "allocate-preview", status: "frozen-preview", targetId: "social-room:allocation-atlas" },
    ],
  };
  return freeze({
    schemaVersion: SOCIAL_EXPLORER_SCHEMA_VERSION,
    source: SOCIAL_EXPLORER_SOURCE,
    kind: SOCIAL_EXPLORER_KIND,
    id: SOCIAL_EXPLORER_ID,
    updatedAt,
    simulation: true,
    fictional: true,
    aggregate: true,
    deterministic: true,
    rooms,
    creatorCards,
    discoverySignals,
    rehearsalActions,
    rehearsal,
    launchPlan,
    entities,
    evidence: createEvidence({ updatedAt, rooms, creatorCards, discoverySignals, rehearsalActions }),
    capabilities: SOCIAL_EXPLORER_CAPABILITIES,
    provenance: {
      source: "local-fixed-fixture",
      version: "social-explorer-rehearsal-v1",
      deterministicKey: `${SOCIAL_EXPLORER_SOURCE}:${SOCIAL_EXPLORER_ID}:v1`,
      assetLaunchId: SOCIAL_EXPLORER_ASSET_LAUNCH_ID,
    },
    boundary: "Local social-explorer rehearsal only. No fetch, WebSocket, provider, recipient, price, market, wallet, transfer, settlement, or money path exists.",
  });
}

export const createSocialExplorerProjection = createSocialExplorerContribution;
export const createTumboSocialExplorerContribution = createSocialExplorerContribution;
export const socialExplorerProjection = createSocialExplorerContribution();
export const DEFAULT_SOCIAL_EXPLORER_PROJECTION = socialExplorerProjection;

function normalizeFlowIntents(value) {
  if (!Array.isArray(value)) throw new TypeError("completedIntents must be an array");
  const intents = value.map((intent) => String(intent));
  if (intents.length > SOCIAL_EXPLORER_FLOW_INTENTS.length) {
    throw new RangeError("social explorer flow cannot exceed four steps");
  }
  intents.forEach((intent, index) => {
    if (intent !== SOCIAL_EXPLORER_FLOW_INTENTS[index]) {
      throw new RangeError(`social explorer flow expected ${SOCIAL_EXPLORER_FLOW_INTENTS[index] ?? "reset"} at step ${index + 1}`);
    }
  });
  return intents;
}

/**
 * Build an immutable renderer-owned flow cursor. This is a projection draft,
 * not a workflow engine: it has no recipient, provider, persistence, or
 * transfer authority and performs no I/O.
 */
export function createSocialExplorerFlowDraft({ completedIntents = [], replayCount = 0 } = {}) {
  const completed = normalizeFlowIntents(completedIntents);
  const safeReplayCount = Number.isSafeInteger(replayCount) && replayCount >= 0 ? replayCount : 0;
  const nextIntent = SOCIAL_EXPLORER_FLOW_INTENTS[completed.length] ?? null;
  return freeze({
    source: SOCIAL_EXPLORER_FLOW_SOURCE,
    kind: "social-explorer-flow-draft",
    completedIntents: completed,
    nextIntent,
    stepIndex: completed.length,
    stepCount: SOCIAL_EXPLORER_FLOW_INTENTS.length,
    complete: nextIntent === null,
    replayCount: safeReplayCount,
    accepted: true,
    rejected: false,
    localOnly: true,
    simulation: true,
    deterministic: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
  });
}

/** Advance the local cursor only when the requested action is the next step. */
export function advanceSocialExplorerFlow(flow, intent) {
  const current = createSocialExplorerFlowDraft({
    completedIntents: flow?.completedIntents ?? [],
    replayCount: flow?.replayCount ?? 0,
  });
  const requested = String(intent ?? "");
  if (current.nextIntent !== requested) {
    return freeze({
      ...current,
      attemptedIntent: requested,
      accepted: false,
      rejected: true,
      reason: current.nextIntent
        ? `next social step is ${current.nextIntent}`
        : "social flow is complete; reset before running it again",
    });
  }
  return createSocialExplorerFlowDraft({
    completedIntents: [...current.completedIntents, requested],
    replayCount: current.replayCount,
  });
}

export function resetSocialExplorerFlow(flow = {}) {
  return freeze({
    ...createSocialExplorerFlowDraft({ replayCount: 0 }),
    action: "reset",
    previousStepIndex: Number.isSafeInteger(flow?.stepIndex) ? flow.stepIndex : 0,
  });
}

export default socialExplorerProjection;
