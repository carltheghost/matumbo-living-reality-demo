/**
 * Social Explorer / Re-market rehearsal console.
 *
 * This is a DOM adapter over the frozen `social-explorer-rehearsal`
 * contribution. It presents fictional aggregate cards and replays a local
 * intent trace. A host may also provide a separate, explicit public-pulse
 * envelope; this adapter only displays that envelope and never performs a
 * network request, posting, identity, recipient, market, wallet, or transfer
 * action.
 */

import {
  SOCIAL_EXPLORER_FLOW_INTENTS,
  SOCIAL_EXPLORER_LAUNCH_MODES,
  SOCIAL_EXPLORER_LAUNCH_PHASES,
  SOCIAL_EXPLORER_LAUNCH_PHASE_IDS,
  advanceSocialExplorerFlow,
  advanceSocialExplorerLaunchPhase,
  createSocialExplorerFlowDraft,
  createSocialExplorerLaunchPlan,
  resetSocialExplorerFlow,
  resetSocialExplorerLaunchPlan,
  selectSocialExplorerLaunchMode,
} from "../domains/social-explorer.js?v=20260922-cache2";

export const SOCIAL_EXPLORER_CONSOLE_SOURCE = "social-explorer-rehearsal";
export const DEFAULT_SOCIAL_EXPLORER_ID = "social-explorer:demo";
export const DEFAULT_SOCIAL_REHEARSAL_ID = "social-rehearsal:tumbo-demo-launch";

const integerFormatter = new Intl.NumberFormat("en-US");

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeText(value, fallback = "—") {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

function freezeSnapshot(value) {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => freezeSnapshot(entry)));
  if (!isRecord(value)) return value;
  return Object.freeze(
    Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, freezeSnapshot(entry)])),
  );
}

function normalizeEntry(entry, kind, index) {
  return {
    id: safeText(entry?.id, `${kind}-${index + 1}`),
    kind,
    label: safeText(entry?.label, `${kind} ${index + 1}`),
    mode: safeText(entry?.mode ?? entry?.signal ?? entry?.intent, "local"),
    intent: safeText(entry?.intent ?? entry?.signal ?? entry?.mode, "local-preview"),
    targetId: safeText(entry?.targetId ?? entry?.roomId, "aggregate local room"),
    assetLaunchId: entry?.assetLaunchId ? safeText(entry.assetLaunchId) : null,
    roomId: safeText(entry?.roomId, "aggregate local room"),
    summary: safeText(entry?.summary, "Fictional local projection record."),
    status: safeText(entry?.status, "frozen-preview"),
    simulation: entry?.simulation === true,
    fictional: entry?.fictional === true,
    aggregate: entry?.aggregate === true,
    externalNetwork: entry?.externalNetwork === true,
    externalTransfer: entry?.externalTransfer === true,
    executable: entry?.executable === true,
  };
}

function findContribution(projection) {
  if (projection?.source === SOCIAL_EXPLORER_CONSOLE_SOURCE) return projection;
  return asArray(projection?.contributions).find(
    (contribution) => contribution?.source === SOCIAL_EXPLORER_CONSOLE_SOURCE,
  ) ?? null;
}

function findContributionBySource(projection, source) {
  if (projection?.source === source) return projection;
  return asArray(projection?.contributions).find((contribution) => contribution?.source === source) ?? null;
}

function summarizeAllocationPreview(projection) {
  const contribution = findContributionBySource(projection, "tumbo-distribution-registry");
  const rows = asArray(contribution?.registry);
  const totalBasisPoints = rows.reduce((total, row) => {
    const basisPoints = Number.isSafeInteger(row?.shareBasisPoints)
      ? row.shareBasisPoints
      : Number.isSafeInteger(row?.basisPoints)
        ? row.basisPoints
        : 0;
    return total + basisPoints;
  }, 0);
  const totalUnits = rows.reduce((total, row) => {
    const units = Number.isSafeInteger(row?.tokenUnits)
      ? row.tokenUnits
      : Number.isSafeInteger(row?.units)
        ? row.units
        : 0;
    return total + units;
  }, 0);
  const canonicalSummary = isRecord(contribution?.allocationSummary)
    ? contribution.allocationSummary
    : null;
  const allocationClasses = asArray(canonicalSummary?.classes).map((allocation, index) => ({
    allocationId: safeText(allocation?.allocationId, `allocation-${index + 1}`),
    recipientClass: safeText(allocation?.recipientClass, "aggregate fictional cohort"),
    label: safeText(allocation?.label, `Allocation class ${index + 1}`),
    rowCount: Number.isSafeInteger(allocation?.rowCount) ? allocation.rowCount : 0,
    basisPoints: Number.isSafeInteger(allocation?.basisPoints) ? allocation.basisPoints : 0,
    expectedBasisPoints: Number.isSafeInteger(allocation?.expectedBasisPoints)
      ? allocation.expectedBasisPoints
      : 0,
    tokenUnits: Number.isSafeInteger(allocation?.tokenUnits) ? allocation.tokenUnits : 0,
    expectedTokenUnits: Number.isSafeInteger(allocation?.expectedTokenUnits)
      ? allocation.expectedTokenUnits
      : 0,
    complete: allocation?.complete === true,
    aggregate: true,
    fictional: true,
    simulation: true,
    executable: false,
    externalTransfer: false,
  }));
  const expectedBasisPoints = Number.isSafeInteger(canonicalSummary?.expectedBasisPoints)
    ? canonicalSummary.expectedBasisPoints
    : 10_000;
  const expectedUnits = Number.isSafeInteger(canonicalSummary?.expectedUnits)
    ? canonicalSummary.expectedUnits
    : Number.isSafeInteger(contribution?.totalSupply)
      ? contribution.totalSupply
      : 1_000_000_000;
  return freezeSnapshot({
    available: rows.length > 0,
    launchId: safeText(contribution?.launchId ?? contribution?.launchEvent?.launchId, "distribution:tumbo-demo-launch"),
    unit: safeText(contribution?.unit, "TUMBO-SIM"),
    classCount: allocationClasses.length,
    allocationClasses,
    rowCount: rows.length,
    totalBasisPoints,
    expectedBasisPoints,
    totalUnits,
    expectedUnits,
    complete: canonicalSummary?.complete === true
      || (rows.length > 0 && totalBasisPoints === expectedBasisPoints && totalUnits === expectedUnits),
    status: safeText(contribution?.launchEvent?.status, "previewed"),
    simulation: contribution?.simulation === true,
    aggregate: rows.every((row) => row?.aggregate === true),
    localOnly: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
  });
}

function normalizeLaunchMode(mode, index) {
  const fallback = SOCIAL_EXPLORER_LAUNCH_MODES[index] ?? SOCIAL_EXPLORER_LAUNCH_MODES[0];
  return {
    id: safeText(mode?.id, fallback?.id ?? `launch-mode-${index + 1}`),
    modeId: safeText(mode?.modeId ?? mode?.id, fallback?.modeId ?? fallback?.id ?? `launch-mode-${index + 1}`),
    label: safeText(mode?.label, fallback?.label ?? `Launch mode ${index + 1}`),
    summary: safeText(mode?.summary, fallback?.summary ?? "Local launch rehearsal mode."),
    route: safeText(mode?.route, fallback?.route ?? "social-explorer"),
    participation: safeText(mode?.participation, "opt-in"),
    participationPolicy: safeText(mode?.participationPolicy, "opt-in-only"),
    participantStatus: safeText(mode?.participantStatus, "not-enrolled"),
    optIn: mode?.optIn !== false,
    optInOnly: mode?.optInOnly !== false,
    optInRequired: mode?.optInRequired !== false,
    status: safeText(mode?.status, "available-preview"),
    simulation: mode?.simulation !== false,
    fictional: mode?.fictional !== false,
    aggregate: mode?.aggregate !== false,
    deterministic: mode?.deterministic !== false,
    localOnly: mode?.localOnly !== false,
    externalNetwork: mode?.externalNetwork === true,
    externalTransfer: mode?.externalTransfer === true,
    persistence: mode?.persistence === true,
    executable: mode?.executable === true,
  };
}

function normalizeLaunchPhase(phase, index) {
  const fallback = SOCIAL_EXPLORER_LAUNCH_PHASES[index] ?? SOCIAL_EXPLORER_LAUNCH_PHASES[0];
  return {
    id: safeText(phase?.id, fallback?.id ?? `launch-phase-${index + 1}`),
    phaseId: safeText(phase?.phaseId ?? phase?.id, fallback?.phaseId ?? fallback?.id ?? `launch-phase-${index + 1}`),
    ordinal: Number.isInteger(phase?.ordinal) ? phase.ordinal : index + 1,
    label: safeText(phase?.label, fallback?.label ?? `Launch phase ${index + 1}`),
    intent: safeText(phase?.intent, fallback?.intent ?? "local-preview"),
    summary: safeText(phase?.summary, fallback?.summary ?? "Local launch-plan phase."),
    status: safeText(phase?.status, "frozen-preview"),
    simulation: phase?.simulation !== false,
    fictional: phase?.fictional !== false,
    aggregate: phase?.aggregate !== false,
    deterministic: phase?.deterministic !== false,
    localOnly: phase?.localOnly !== false,
    externalNetwork: phase?.externalNetwork === true,
    externalTransfer: phase?.externalTransfer === true,
    persistence: phase?.persistence === true,
    executable: phase?.executable === true,
  };
}

/**
 * Normalize the domain launch-plan projection for renderer consumption.  It
 * intentionally carries only a canonical allocation reference and never
 * copies registry rows or performs allocation math.
 */
export function summarizeSocialExplorerLaunchPlan(projection) {
  const contribution = findContribution(projection);
  const fallback = createSocialExplorerLaunchPlan();
  const sourcePlan = isRecord(contribution?.launchPlan) ? contribution.launchPlan : fallback;
  const modes = (asArray(sourcePlan.modes).length ? sourcePlan.modes : SOCIAL_EXPLORER_LAUNCH_MODES)
    .map(normalizeLaunchMode);
  const phases = (asArray(sourcePlan.phases).length ? sourcePlan.phases : SOCIAL_EXPLORER_LAUNCH_PHASES)
    .map(normalizeLaunchPhase);
  const modeId = safeText(sourcePlan.modeId, modes[0]?.id ?? "social-experiment");
  const selectedMode = modes.find((mode) => mode.id === modeId) ?? modes[0] ?? null;
  const allocation = isRecord(sourcePlan.allocationPreview) ? sourcePlan.allocationPreview : fallback.allocationPreview;
  return freezeSnapshot({
    source: safeText(sourcePlan.source, "social-explorer-launch-plan"),
    kind: safeText(sourcePlan.kind, "social-explorer-launch-plan"),
    id: safeText(sourcePlan.id, "social-launch-plan:tumbo-demo-launch"),
    schemaVersion: Number.isInteger(sourcePlan.schemaVersion) ? sourcePlan.schemaVersion : 1,
    updatedAt: safeText(sourcePlan.updatedAt, "2025-01-01T00:00:00.000Z"),
    modeId,
    mode: selectedMode,
    modes,
    phases,
    phaseSequence: asArray(sourcePlan.phaseSequence).length
      ? sourcePlan.phaseSequence.map((phaseId) => safeText(phaseId))
      : phases.map((phase) => phase.id),
    completedPhaseIds: asArray(sourcePlan.completedPhaseIds).map((phaseId) => safeText(phaseId)),
    nextPhaseId: sourcePlan.nextPhaseId === null || sourcePlan.nextPhaseId === undefined
      ? null
      : safeText(sourcePlan.nextPhaseId),
    phaseIndex: Number.isInteger(sourcePlan.phaseIndex) ? sourcePlan.phaseIndex : 0,
    phaseCount: Number.isInteger(sourcePlan.phaseCount) ? sourcePlan.phaseCount : phases.length,
    complete: sourcePlan.complete === true,
    replayCount: Number.isSafeInteger(sourcePlan.replayCount) && sourcePlan.replayCount >= 0
      ? sourcePlan.replayCount
      : 0,
    participation: safeText(sourcePlan.participation, "opt-in"),
    participationPolicy: safeText(sourcePlan.participationPolicy, "opt-in-only"),
    participationStatus: safeText(sourcePlan.participationStatus, "opt-in-not-recorded"),
    optIn: sourcePlan.optIn !== false,
    optInOnly: sourcePlan.optInOnly !== false,
    optInRequired: sourcePlan.optInRequired !== false,
    distributionStatus: safeText(sourcePlan.distributionStatus, "preview-only"),
    status: safeText(sourcePlan.status, "local-launch-preview"),
    allocationPreview: freezeSnapshot({
      source: safeText(allocation.source, "tumbo-distribution-registry"),
      launchId: safeText(allocation.launchId, "distribution:tumbo-demo-launch"),
      status: safeText(allocation.status, "preview-only"),
      distributionStatus: safeText(allocation.distributionStatus, "preview-only"),
      canonical: allocation.canonical !== false,
      duplicateSchedule: allocation.duplicateSchedule === true,
      scheduleOwnedBy: safeText(allocation.scheduleOwnedBy, "tumbo-distribution-registry"),
      localOnly: allocation.localOnly !== false,
      simulation: allocation.simulation !== false,
      aggregate: allocation.aggregate !== false,
      fictional: allocation.fictional !== false,
      externalNetwork: allocation.externalNetwork === true,
      externalTransfer: allocation.externalTransfer === true,
      persistence: allocation.persistence === true,
      executable: allocation.executable === true,
    }),
    simulation: sourcePlan.simulation !== false,
    fictional: sourcePlan.fictional !== false,
    aggregate: sourcePlan.aggregate !== false,
    deterministic: sourcePlan.deterministic !== false,
    localOnly: sourcePlan.localOnly !== false,
    externalNetwork: sourcePlan.externalNetwork === true,
    externalTransfer: sourcePlan.externalTransfer === true,
    persistence: sourcePlan.persistence === true,
    walletConnection: sourcePlan.walletConnection === true,
    recipientAuthority: sourcePlan.recipientAuthority === true,
    signing: sourcePlan.signing === true,
    custody: sourcePlan.custody === true,
    settlement: sourcePlan.settlement === true,
    executable: sourcePlan.executable === true,
  });
}

/**
 * Read the canonical social-explorer contribution into a deterministic UI
 * summary.  This helper is pure and intentionally easy to exercise without a
 * browser.
 */
export function summarizeSocialExplorer(projection) {
  const contribution = findContribution(projection);
  const rooms = asArray(contribution?.rooms).map((entry, index) => normalizeEntry(entry, "room", index));
  const creatorCards = asArray(contribution?.creatorCards).map((entry, index) => normalizeEntry(entry, "creator-card", index));
  const discoverySignals = asArray(contribution?.discoverySignals).map((entry, index) => normalizeEntry(entry, "discovery-signal", index));
  const rehearsalActions = asArray(contribution?.rehearsalActions).map((entry, index) => normalizeEntry(entry, "rehearsal-action", index));
  const steps = asArray(contribution?.rehearsal?.steps).map((step, index) => ({
    ordinal: Number.isInteger(step?.ordinal) ? step.ordinal : index + 1,
    intent: safeText(step?.intent, "local-preview"),
    targetId: safeText(step?.targetId, "aggregate local room"),
    status: safeText(step?.status, "frozen-preview"),
    simulation: step?.simulation !== false,
    localOnly: step?.localOnly !== false,
    externalNetwork: step?.externalNetwork === true,
    externalTransfer: step?.externalTransfer === true,
    executable: step?.executable === true,
  }));
  return freezeSnapshot({
    source: contribution?.source ?? SOCIAL_EXPLORER_CONSOLE_SOURCE,
    id: safeText(contribution?.id, DEFAULT_SOCIAL_EXPLORER_ID),
    rehearsalId: safeText(contribution?.rehearsal?.id, DEFAULT_SOCIAL_REHEARSAL_ID),
    updatedAt: safeText(contribution?.updatedAt),
    rooms,
    creatorCards,
    discoverySignals,
    rehearsalActions,
    steps,
    roomCount: rooms.length,
    creatorCardCount: creatorCards.length,
    discoverySignalCount: discoverySignals.length,
    actionCount: rehearsalActions.length,
    stepCount: steps.length,
    flowIntents: SOCIAL_EXPLORER_FLOW_INTENTS,
    flowStepCount: SOCIAL_EXPLORER_FLOW_INTENTS.length,
    launchPlan: summarizeSocialExplorerLaunchPlan(projection),
    allocationPreview: summarizeAllocationPreview(projection),
    simulation: contribution?.simulation === true,
    deterministic: contribution?.deterministic === true,
    localOnly: contribution?.rehearsal?.localOnly === true,
    externalNetwork: contribution?.rehearsal?.externalNetwork === true,
    externalTransfer: contribution?.rehearsal?.externalTransfer === true,
    executable: contribution?.rehearsal?.executable === true,
    capabilities: asArray(contribution?.capabilities),
    evidence: asArray(contribution?.evidence),
    boundary: safeText(
      contribution?.boundary,
      "Local social-explorer rehearsal only; no network, market, wallet, transfer, settlement, or money path exists.",
    ),
  });
}

function createText(documentRoot, tag, className, value) {
  const element = documentRoot.createElement(tag);
  if (className) element.className = className;
  element.textContent = safeText(value);
  return element;
}

function formatCount(value) {
  return Number.isSafeInteger(value) ? integerFormatter.format(value) : "—";
}

function entryDetail(entry) {
  return `${entry.mode} · ${entry.status}`;
}

const DEFAULT_PUBLIC_PULSE_BOUNDARY =
  "Public Bluesky author-feed observations only. Content is untrusted and provider-attributed; no authentication, identity resolution, posting, media bytes, storage, recipient, wallet, token, transfer, settlement, or authority path exists.";

function normalizePublicPulse(value) {
  const source = isRecord(value) ? value : {};
  const records = asArray(source.records)
    .filter((record) => isRecord(record) && safeText(record.text, "").trim())
    .slice(0, 8)
    .map((record, index) => ({
      id: safeText(record.id, `public-social-observation-${index + 1}`),
      kind: safeText(record.kind, "public-social-observation"),
      provider: safeText(record.provider, "Bluesky public AppView"),
      authorHandle: safeText(record.authorHandle, "public author"),
      authorDisplayName: safeText(record.authorDisplayName, record.authorHandle ?? "public author"),
      text: safeText(record.text, "public text unavailable"),
      publishedAt: safeText(record.publishedAt, "time unavailable"),
      indexedAt: safeText(record.indexedAt, "time unavailable"),
      sourceUrl: safeText(record.sourceUrl, "source unavailable"),
      postUri: safeText(record.postUri, "provider URI unavailable"),
      replyCount: Number.isSafeInteger(record.replyCount) ? record.replyCount : 0,
      repostCount: Number.isSafeInteger(record.repostCount) ? record.repostCount : 0,
      likeCount: Number.isSafeInteger(record.likeCount) ? record.likeCount : 0,
      quoteCount: Number.isSafeInteger(record.quoteCount) ? record.quoteCount : 0,
      retrievedAt: safeText(record.retrievedAt, source.retrievedAt ?? "time unavailable"),
      publicSource: true,
      untrusted: true,
      metadataOnly: true,
      mediaPresent: record.mediaPresent === true,
      mediaBytesFetched: false,
      mediaBytesStored: false,
      mediaBytesRendered: false,
      identityResolution: false,
      authentication: false,
      posting: false,
      persistence: false,
      recipient: false,
      wallet: false,
      token: false,
      transfer: false,
      settlement: false,
      authority: false,
      executable: false,
    }));
  const status = source.status === "ready" && records.length ? "ready" : "unavailable";
  return freezeSnapshot({
    schemaVersion: Number.isSafeInteger(source.schemaVersion) ? source.schemaVersion : 1,
    source: safeText(source.source, "public-social-pulse-bluesky"),
    provider: safeText(source.provider, "Bluesky public AppView"),
    endpoint: safeText(source.endpoint, "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed"),
    documentation: safeText(source.documentation, "https://docs.bsky.app/docs/api/app-bsky-feed-get-author-feed"),
    actor: safeText(source.actor, "atproto.com"),
    requestUrl: source.requestUrl ?? null,
    requestedLimit: Number.isSafeInteger(source.requestedLimit) ? source.requestedLimit : 8,
    retrievedAt: safeText(source.retrievedAt, "not retrieved"),
    status,
    providerAvailable: source.providerAvailable === true,
    returnedCount: records.length,
    records,
    unavailableReason: status === "ready" ? null : safeText(source.unavailableReason, "No public social pulse refresh has completed; no fallback rows were fabricated."),
    publicSource: true,
    untrusted: true,
    metadataOnly: true,
    mediaBytesFetched: false,
    mediaBytesStored: false,
    mediaBytesRendered: false,
    identityResolution: false,
    authentication: false,
    posting: false,
    persistence: false,
    recipient: false,
    wallet: false,
    token: false,
    transfer: false,
    settlement: false,
    authority: false,
    executable: false,
    externalNetwork: source.externalNetwork === true,
    localProjection: true,
    boundary: safeText(source.boundary, DEFAULT_PUBLIC_PULSE_BOUNDARY),
  });
}

/**
 * Mount the local social-explorer console into the HUD.  The host receives
 * frozen replay/select metadata so it can focus the 3-D projection and emit a
 * `simfabric:intent`; this adapter never mutates canonical state.
 */
export function createSocialExplorerConsole({
  documentRoot = globalThis.document,
  projection = null,
  publicPulse = null,
  onReplay = null,
  onSelect = null,
  onAction = null,
  onReset = null,
  onLaunchPlan = null,
  onPublicPulseRefresh = null,
} = {}) {
  if (!documentRoot?.getElementById) throw new Error("Social explorer needs a document-like owner");
  const panel = documentRoot.getElementById("social-explorer-console");
  const closeButton = documentRoot.getElementById("social-explorer-close");
  const replayButton = documentRoot.getElementById("social-explorer-replay");
  const resetButton = documentRoot.getElementById("social-explorer-reset");
  const nextButton = documentRoot.getElementById("social-explorer-flow-next");
  const statusEl = documentRoot.getElementById("social-explorer-status");
  const roomCountEl = documentRoot.getElementById("social-explorer-room-count");
  const cardCountEl = documentRoot.getElementById("social-explorer-card-count");
  const signalCountEl = documentRoot.getElementById("social-explorer-signal-count");
  const actionCountEl = documentRoot.getElementById("social-explorer-action-count");
  const roomsList = documentRoot.getElementById("social-explorer-rooms");
  const cardsList = documentRoot.getElementById("social-explorer-cards");
  const signalsList = documentRoot.getElementById("social-explorer-signals");
  const actionsList = documentRoot.getElementById("social-explorer-actions");
  const actionStatusEl = documentRoot.getElementById("social-explorer-action-status");
  const traceList = documentRoot.getElementById("social-explorer-trace");
  const selectionEl = documentRoot.getElementById("social-explorer-selection");
  const boundaryEl = documentRoot.getElementById("social-explorer-boundary");
  const flowStatusEl = documentRoot.getElementById("social-explorer-flow-status");
  const flowStepsList = documentRoot.getElementById("social-explorer-flow-steps");
  const allocationPreviewEl = documentRoot.getElementById("social-explorer-allocation-preview");
  // Launch-plan mounts are optional so the domain/API can be exercised by a
  // host that has not yet added the two-mode controls to its markup.
  const launchModesList = documentRoot.getElementById("social-explorer-launch-modes");
  const launchPhasesList = documentRoot.getElementById("social-explorer-launch-phases");
  const launchStatusEl = documentRoot.getElementById("social-explorer-launch-status");
  const launchNextButton = documentRoot.getElementById("social-explorer-launch-next");
  const launchResetButton = documentRoot.getElementById("social-explorer-launch-reset");
  const launchParticipationEl = documentRoot.getElementById("social-explorer-launch-participation");
  const launchAllocationEl = documentRoot.getElementById("social-explorer-launch-allocation");
  // Public-pulse mounts are optional so older social-explorer embed hosts can
  // continue to render the fictional catalog without adding the read-only
  // provider rail.
  const publicPulseStatusEl = documentRoot.getElementById("social-explorer-public-pulse-status");
  const publicPulseSummaryEl = documentRoot.getElementById("social-explorer-public-pulse-summary");
  const publicPulseRefreshButton = documentRoot.getElementById("social-explorer-public-pulse-refresh");
  const publicPulseRecordsEl = documentRoot.getElementById("social-explorer-public-pulse-records");
  const publicPulseBoundaryEl = documentRoot.getElementById("social-explorer-public-pulse-boundary");
  if (!panel || !closeButton || !replayButton || !statusEl || !roomsList || !cardsList || !signalsList || !actionsList || !traceList) {
    throw new Error("Social explorer console mount points are missing");
  }

  let currentProjection = projection;
  let summary = summarizeSocialExplorer(currentProjection);
  let selectedKind = "room";
  let selectedId = summary.rooms[0]?.id ?? null;
  let opened = panel.hidden !== true;
  let replayCount = 0;
  let lastReplay = null;
  let lastAction = null;
  let flow = createSocialExplorerFlowDraft();
  let lastFlowEvent = null;
  let launchPlan = createSocialExplorerLaunchPlan({ modeId: summary.launchPlan?.modeId ?? "social-experiment" });
  let launchPlanTrace = [];
  let lastLaunchPlanEvent = null;
  let publicPulseSnapshot = normalizePublicPulse(publicPulse);
  let publicPulseRefreshing = false;

  function setOpen(next, method = "api") {
    opened = Boolean(next);
    panel.hidden = !opened;
    panel.classList.toggle("visible", opened);
    panel.setAttribute("aria-hidden", String(!opened));
    if (opened && method === "open") replayButton.focus({ preventScroll: true });
  }

  function selectedEntry() {
    const entries = {
      room: summary.rooms,
      "creator-card": summary.creatorCards,
      "discovery-signal": summary.discoverySignals,
      "rehearsal-action": summary.rehearsalActions,
    }[selectedKind] ?? [];
    return entries.find((entry) => entry.id === selectedId) ?? null;
  }

  function renderEntryList(list, entries, kind) {
    list.replaceChildren();
    entries.forEach((entry) => {
      const item = documentRoot.createElement("button");
      item.type = "button";
      item.className = "social-explorer-entry";
      item.dataset.entryId = entry.id;
      item.dataset.entryKind = kind;
      item.setAttribute("aria-pressed", String(entry.id === selectedId && kind === selectedKind));
      const copy = documentRoot.createElement("span");
      copy.className = "social-explorer-entry-copy";
      copy.append(
        createText(documentRoot, "strong", "social-explorer-entry-title", entry.label),
        createText(documentRoot, "span", "social-explorer-entry-meta", entryDetail(entry)),
      );
      item.append(
        copy,
        createText(documentRoot, "span", "social-explorer-entry-summary", entry.summary),
      );
      item.addEventListener("click", () => select(kind, entry.id, "row"));
      list.appendChild(item);
    });
    if (!entries.length) {
      list.appendChild(createText(documentRoot, "div", "social-explorer-empty", "No fictional entries are available in this projection."));
    }
  }

  function renderTrace() {
    traceList.replaceChildren();
    const steps = lastFlowEvent?.rejected
      ? [{ ordinal: "!", intent: lastFlowEvent.attemptedIntent, status: `rejected · ${lastFlowEvent.reason}` }, ...summary.steps]
      : lastAction
        ? [{ ordinal: "A", intent: lastAction.intent, status: "acted locally" }, ...summary.steps]
        : summary.steps;
    steps.forEach((step) => {
      const row = documentRoot.createElement("div");
      row.className = "social-explorer-trace-step";
      const state = lastReplay ? `replayed #${replayCount}` : step.status;
      row.append(
        createText(documentRoot, "b", "social-explorer-trace-number", `${step.ordinal}`),
        createText(documentRoot, "span", "social-explorer-trace-intent", step.intent),
        createText(documentRoot, "span", "social-explorer-trace-state", state),
      );
      traceList.appendChild(row);
    });
  }

  function actionForIntent(intent) {
    return summary.rehearsalActions.find((action) => action.intent === intent) ?? null;
  }

  function renderFlow() {
    const completed = new Set(flow.completedIntents);
    const next = flow.nextIntent;
    if (flowStatusEl) {
      flowStatusEl.textContent = lastFlowEvent?.rejected
        ? `FLOW BLOCKED · ${lastFlowEvent.reason ?? "run the next step"} · LOCAL ONLY`
        : flow.complete
          ? `COMPLETE · ${flow.stepCount}/${flow.stepCount} · ALLOCATION PREVIEW READY · LOCAL ONLY`
          : `NEXT · ${(next ?? "reset").toUpperCase()} · ${flow.stepIndex}/${flow.stepCount} COMPLETE · LOCAL ONLY`;
    }
    if (flowStepsList) {
      flowStepsList.replaceChildren();
      SOCIAL_EXPLORER_FLOW_INTENTS.forEach((intent, index) => {
        const action = actionForIntent(intent);
        const step = documentRoot.createElement("div");
        step.className = "social-explorer-flow-step";
        step.dataset.intent = intent;
        step.dataset.flowState = completed.has(intent)
          ? "complete"
          : next === intent
            ? "next"
            : "locked";
        step.setAttribute("aria-current", next === intent ? "step" : "false");
        step.append(
          createText(documentRoot, "b", "social-explorer-flow-index", `${index + 1}`),
          createText(documentRoot, "span", "social-explorer-flow-copy", action?.label ?? intent),
          createText(documentRoot, "span", "social-explorer-flow-state", completed.has(intent) ? "done" : next === intent ? "next" : "queued"),
        );
        flowStepsList.appendChild(step);
      });
    }
    if (nextButton) {
      const action = actionForIntent(next);
      nextButton.disabled = !action;
      nextButton.textContent = action ? `Run next · ${action.intent}` : "Flow complete · reset to run again";
      nextButton.title = action?.summary ?? "Reset the local flow to run it again.";
    }
    if (resetButton) resetButton.disabled = flow.stepIndex === 0 && replayCount === 0 && !lastAction && !lastReplay;
    if (allocationPreviewEl) {
      const preview = summary.allocationPreview;
      allocationPreviewEl.textContent = flow.complete
        ? preview.available
          ? `ALLOCATE-PREVIEW READY · TUMBO asset-token · ${preview.classCount} allocation classes · ${preview.rowCount} aggregate rows · ${formatCount(preview.totalBasisPoints)}/${formatCount(preview.expectedBasisPoints)} BP · ${formatCount(preview.totalUnits)}/${formatCount(preview.expectedUnits)} ${preview.unit} units · ${preview.complete ? "RECONCILED" : "REVIEW"} · LOCAL ONLY`
          : "ALLOCATE-PREVIEW READY · TUMBO asset-token registry is not present in this projection · LOCAL ONLY"
        : `TUMBO asset-token ALLOCATE-PREVIEW LOCKED · complete ${SOCIAL_EXPLORER_FLOW_INTENTS.length - flow.stepIndex} remaining local step${SOCIAL_EXPLORER_FLOW_INTENTS.length - flow.stepIndex === 1 ? "" : "s"}`;
    }
  }

  function appendLaunchPlanTrace(event) {
    // Keep a bounded immutable local trace.  Reset/replay append records so a
    // host can inspect what happened without persistence or external events.
    launchPlanTrace = [...launchPlanTrace, freezeSnapshot(event)].slice(-32);
  }

  function renderLaunchPlan() {
    const launchSummary = summary.launchPlan;
    const completed = new Set(launchPlan.completedPhaseIds);
    const next = launchPlan.nextPhaseId;
    const rejected = lastLaunchPlanEvent?.rejected === true;
    const selectedMode = launchSummary.modes.find((mode) => mode.id === launchPlan.modeId)
      ?? launchSummary.mode;

    if (launchStatusEl) {
      launchStatusEl.textContent = rejected
        ? `LAUNCH PLAN BLOCKED · ${lastLaunchPlanEvent.reason ?? "choose the next phase"} · LOCAL ONLY`
        : launchPlan.complete
          ? `COMPLETE · ${launchPlan.phaseCount}/${launchPlan.phaseCount} · ${selectedMode?.label ?? launchPlan.modeId} · PREVIEW ONLY`
          : `NEXT · ${(next ?? "reset").toUpperCase()} · ${launchPlan.phaseIndex}/${launchPlan.phaseCount} COMPLETE · ${selectedMode?.label ?? launchPlan.modeId} · LOCAL ONLY`;
    }
    if (launchParticipationEl) {
      launchParticipationEl.textContent = `PARTICIPATION · ${launchPlan.participationPolicy.toUpperCase()} · ${launchPlan.participationStatus.toUpperCase()} · LOCAL ONLY`;
    }
    if (launchAllocationEl) {
      const allocation = launchPlan.allocationPreview;
      launchAllocationEl.textContent = `TUMBO ASSET-TOKEN · ${allocation.status.toUpperCase()} · ${allocation.source} · ${allocation.launchId} · NO TRANSFER`;
    }
    if (launchModesList) {
      launchModesList.replaceChildren();
      launchSummary.modes.forEach((mode) => {
        const item = documentRoot.createElement("button");
        item.type = "button";
        item.className = "social-explorer-launch-mode";
        item.dataset.modeId = mode.id;
        item.setAttribute("aria-pressed", String(mode.id === launchPlan.modeId));
        item.title = `${mode.summary} Participation is opt-in only.`;
        item.append(
          createText(documentRoot, "strong", "social-explorer-launch-mode-title", mode.label),
          createText(documentRoot, "span", "social-explorer-launch-mode-meta", `${mode.participationPolicy} · ${mode.participantStatus}`),
          createText(documentRoot, "span", "social-explorer-launch-mode-summary", mode.summary),
        );
        item.addEventListener("click", () => selectLaunchMode(mode.id, "button"));
        launchModesList.appendChild(item);
      });
    }
    if (launchPhasesList) {
      launchPhasesList.replaceChildren();
      launchSummary.phases.forEach((phase, index) => {
        const complete = completed.has(phase.id);
        const isNext = next === phase.id;
        const item = documentRoot.createElement("button");
        item.type = "button";
        item.className = "social-explorer-launch-phase";
        item.dataset.phaseId = phase.id;
        item.dataset.launchState = complete ? "complete" : isNext ? "next" : "queued";
        item.disabled = !isNext;
        item.setAttribute("aria-current", isNext ? "step" : "false");
        item.title = isNext
          ? phase.summary
          : complete
            ? "This local phase is complete. Reset the launch plan to rehearse it again."
            : `Run ${next ?? "reset"} first`;
        item.append(
          createText(documentRoot, "b", "social-explorer-launch-phase-index", `${index + 1}`),
          createText(documentRoot, "span", "social-explorer-launch-phase-copy", phase.label),
          createText(documentRoot, "span", "social-explorer-launch-phase-state", complete ? "done" : isNext ? "next" : "queued"),
        );
        item.addEventListener("click", () => advanceLaunchPhase(phase.id, "button"));
        launchPhasesList.appendChild(item);
      });
    }
    if (launchNextButton) {
      const phase = launchSummary.phases.find((candidate) => candidate.id === next);
      launchNextButton.disabled = !phase;
      launchNextButton.textContent = phase ? `Run next · ${phase.id}` : "Plan complete · reset to run again";
      launchNextButton.title = phase?.summary ?? "Reset the local launch plan to run it again.";
    }
    if (launchResetButton) {
      launchResetButton.disabled = launchPlan.phaseIndex === 0 && launchPlanTrace.length === 0;
    }
  }

  function renderActions() {
    actionsList.replaceChildren();
    summary.rehearsalActions.forEach((action) => {
      const item = documentRoot.createElement("button");
      item.type = "button";
      item.className = "social-explorer-action";
      item.dataset.actionId = action.id;
      item.dataset.intent = action.intent;
      item.disabled = Boolean(flow.nextIntent && action.intent !== flow.nextIntent);
      item.title = item.disabled ? `Run ${flow.nextIntent} first` : action.summary;
      item.setAttribute("aria-pressed", String(lastAction?.id === action.id));
      item.append(
        createText(documentRoot, "strong", "social-explorer-action-title", action.label),
        createText(documentRoot, "span", "social-explorer-action-meta", `${action.intent} · local rehearsal`),
      );
      item.addEventListener("click", () => act(action.id, "button"));
      actionsList.appendChild(item);
    });
    if (!summary.rehearsalActions.length) {
      actionsList.appendChild(createText(documentRoot, "div", "social-explorer-empty", "No local rehearsal actions are available in this projection."));
    }
    if (actionStatusEl) {
      actionStatusEl.textContent = lastFlowEvent?.rejected
        ? `BLOCKED · ${lastFlowEvent.reason.toUpperCase()} · LOCAL ONLY`
        : lastAction
          ? `${lastAction.intent.toUpperCase()} · ${lastAction.label} · ${lastAction.accepted === false ? "BLOCKED" : "LOCAL ONLY"}`
          : "Choose an action to rehearse the social flow locally.";
    }
  }

  function renderPublicPulseRecord(record, index) {
    const item = documentRoot.createElement("article");
    item.className = "social-explorer-public-pulse-record";
    item.setAttribute("role", "listitem");
    item.append(
      createText(documentRoot, "strong", "social-explorer-public-pulse-record-title", `${index + 1}. ${record.authorDisplayName} · @${record.authorHandle}`),
      createText(documentRoot, "p", "social-explorer-public-pulse-record-text", record.text),
      createText(documentRoot, "span", "social-explorer-public-pulse-record-meta", `POSTED · ${record.publishedAt} · INDEXED · ${record.indexedAt} · REPLIES ${formatCount(record.replyCount)} · REPOSTS ${formatCount(record.repostCount)} · LIKES ${formatCount(record.likeCount)}`),
      createText(documentRoot, "span", "social-explorer-public-pulse-record-source", `PUBLIC SOURCE · ${record.sourceUrl}`),
      createText(documentRoot, "span", "social-explorer-public-pulse-record-boundary", record.mediaPresent ? "MEDIA REFERENCE OMITTED · TEXT/METADATA ONLY · UNTRUSTED" : "TEXT/METADATA ONLY · UNTRUSTED PUBLIC OBSERVATION"),
    );
    return item;
  }

  function renderPublicPulse() {
    const pulse = publicPulseSnapshot;
    const records = asArray(pulse.records);
    if (publicPulseStatusEl) {
      publicPulseStatusEl.textContent = publicPulseRefreshing
        ? `REQUESTING · ${pulse.provider.toUpperCase()} · PUBLIC READ ONLY`
        : pulse.status === "ready"
          ? `READY · ${pulse.provider.toUpperCase()} · ${records.length} RETURNED · UNTRUSTED OBSERVATION`
          : `UNAVAILABLE · ${pulse.provider.toUpperCase()} · ${records.length} RETURNED`;
    }
    if (publicPulseSummaryEl) {
      publicPulseSummaryEl.textContent = [
        `PROVIDER · ${pulse.provider}`,
        `ACTOR ALLOWLIST · @${pulse.actor}`,
        `RETRIEVED · ${pulse.retrievedAt}`,
        `RETURNED · ${records.length}/${pulse.requestedLimit}`,
        `SOURCE · ${pulse.source}`,
      ].join(" · ");
    }
    if (publicPulseRecordsEl) {
      publicPulseRecordsEl.replaceChildren();
      if (!records.length) {
        publicPulseRecordsEl.appendChild(createText(
          documentRoot,
          "div",
          "social-explorer-empty",
          pulse.unavailableReason ?? "No public social observations are available. Refresh explicitly to request the provider.",
        ));
      } else {
        records.forEach((record, index) => publicPulseRecordsEl.appendChild(renderPublicPulseRecord(record, index)));
      }
    }
    if (publicPulseBoundaryEl) publicPulseBoundaryEl.textContent = pulse.boundary;
    if (publicPulseRefreshButton) publicPulseRefreshButton.disabled = publicPulseRefreshing;
  }

  function unavailablePublicPulse(reason) {
    return normalizePublicPulse({
      source: "public-social-pulse-bluesky",
      provider: "Bluesky public AppView",
      endpoint: "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed",
      documentation: "https://docs.bsky.app/docs/api/app-bsky-feed-get-author-feed",
      actor: publicPulseSnapshot.actor,
      requestedLimit: publicPulseSnapshot.requestedLimit,
      retrievedAt: "not retrieved",
      status: "unavailable",
      providerAvailable: false,
      externalNetwork: false,
      unavailableReason: safeText(reason, "Public social pulse is unavailable; no fallback rows were fabricated."),
    });
  }

  function render() {
    summary = summarizeSocialExplorer(currentProjection);
    const available = [
      ["room", summary.rooms],
      ["creator-card", summary.creatorCards],
      ["discovery-signal", summary.discoverySignals],
      ["rehearsal-action", summary.rehearsalActions],
    ];
    const stillSelected = available.some(([, entries]) => entries.some((entry) => entry.id === selectedId));
    if (!stillSelected) {
      selectedKind = "room";
      selectedId = summary.rooms[0]?.id ?? null;
    }
    if (roomCountEl) roomCountEl.textContent = formatCount(summary.roomCount);
    if (cardCountEl) cardCountEl.textContent = formatCount(summary.creatorCardCount);
    if (signalCountEl) signalCountEl.textContent = formatCount(summary.discoverySignalCount);
    if (actionCountEl) actionCountEl.textContent = formatCount(summary.actionCount);
    statusEl.textContent = lastReplay
      ? `REPLAYED · LOCAL REHEARSAL #${replayCount} · NO NETWORK`
      : flow.complete
        ? "COMPLETE · ALLOCATION PREVIEW READY · LOCAL ONLY"
        : `READY · STEP ${flow.stepIndex + 1}/${flow.stepCount} · NO NETWORK`;
    if (boundaryEl) boundaryEl.textContent = summary.boundary;
    renderEntryList(roomsList, summary.rooms, "room");
    renderEntryList(cardsList, summary.creatorCards, "creator-card");
    renderEntryList(signalsList, summary.discoverySignals, "discovery-signal");
    renderLaunchPlan();
    renderFlow();
    renderActions();
    renderPublicPulse();
    renderTrace();
    const entry = selectedEntry();
    if (selectionEl) {
      selectionEl.textContent = entry
        ? `${entry.label} · ${entryDetail(entry)} · LOCAL ONLY`
        : "Select a fictional room, card, or signal to inspect it.";
    }
  }

  function select(kind, id, method = "row") {
    const entries = {
      room: summary.rooms,
      "creator-card": summary.creatorCards,
      "discovery-signal": summary.discoverySignals,
      "rehearsal-action": summary.rehearsalActions,
    }[kind] ?? [];
    const entry = entries.find((candidate) => candidate.id === id);
    if (!entry) return null;
    selectedKind = kind;
    selectedId = id;
    render();
    const snapshot = freezeSnapshot({
      ...entry,
      selectedKind: kind,
      selected: true,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
      method,
    });
    onSelect?.(snapshot, method);
    return snapshot;
  }

  function replay(method = "button") {
    replayCount += 1;
    flow = createSocialExplorerFlowDraft({
      completedIntents: SOCIAL_EXPLORER_FLOW_INTENTS,
      replayCount,
    });
    lastFlowEvent = flow;
    lastAction = null;
    lastReplay = freezeSnapshot({
      rehearsalId: summary.rehearsalId,
      explorerId: summary.id,
      replayCount,
      status: "replayed",
      steps: summary.steps.map((step) => ({ ...step, status: "replayed", replayCount })),
      flow,
      simulation: true,
      deterministic: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
      method,
    });
    render();
    onReplay?.(lastReplay);
    return lastReplay;
  }

  function act(id, method = "button") {
    const action = summary.rehearsalActions.find((candidate) => candidate.id === id);
    if (!action) return null;
    const nextFlow = advanceSocialExplorerFlow(flow, action.intent);
    selectedKind = "rehearsal-action";
    selectedId = action.id;
    if (nextFlow.rejected) {
      lastFlowEvent = nextFlow;
      lastAction = freezeSnapshot({
        ...action,
        action: "flow-action-rejected",
        selectedKind: "rehearsal-action",
        selected: false,
        accepted: false,
        rejected: true,
        reason: nextFlow.reason,
        attemptedIntent: nextFlow.attemptedIntent,
        method,
        flow: nextFlow,
        localOnly: true,
        simulation: true,
        deterministic: true,
        externalNetwork: false,
        externalTransfer: false,
        executable: false,
        walletConnection: false,
        recipientAuthority: false,
        price: false,
        market: false,
        settlement: false,
      });
      render();
      onAction?.(lastAction);
      return lastAction;
    }
    flow = nextFlow;
    lastFlowEvent = nextFlow;
    lastAction = freezeSnapshot({
      ...action,
      action: "flow-action",
      selectedKind: "rehearsal-action",
      selected: true,
      accepted: true,
      rejected: false,
      stepIndex: flow.stepIndex,
      stepCount: flow.stepCount,
      completedIntents: flow.completedIntents,
      nextIntent: flow.nextIntent,
      method,
      flow,
      localOnly: true,
      simulation: true,
      deterministic: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
      walletConnection: false,
      recipientAuthority: false,
      price: false,
      market: false,
      settlement: false,
    });
    render();
    onAction?.(lastAction);
    return lastAction;
  }

  function next(method = "button") {
    const action = actionForIntent(flow.nextIntent);
    if (!action) {
      const complete = freezeSnapshot({
        source: SOCIAL_EXPLORER_CONSOLE_SOURCE,
        action: "flow-complete",
        accepted: false,
        rejected: true,
        reason: "social flow is complete; reset before running it again",
        flow,
        method,
        localOnly: true,
        simulation: true,
        deterministic: true,
        externalNetwork: false,
        externalTransfer: false,
        executable: false,
      });
      lastFlowEvent = complete;
      lastAction = complete;
      render();
      return complete;
    }
    return act(action.id, method);
  }

  function reset(method = "button") {
    const previousFlow = flow;
    flow = resetSocialExplorerFlow(previousFlow);
    replayCount = 0;
    lastReplay = null;
    lastAction = null;
    const snapshot = freezeSnapshot({
      source: SOCIAL_EXPLORER_CONSOLE_SOURCE,
      action: "reset",
      method,
      previousStepIndex: previousFlow.stepIndex,
      flow,
      replayCount,
      localOnly: true,
      simulation: true,
      deterministic: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    lastFlowEvent = snapshot;
    render();
    onReset?.(snapshot);
    return snapshot;
  }

  function emitLaunchPlanEvent({
    action,
    method,
    previous,
    next,
    result = next,
    requestedModeId = null,
    requestedPhaseId = null,
  }) {
    const rejected = result.rejected === true;
    const accepted = !rejected;
    const snapshot = freezeSnapshot({
      source: SOCIAL_EXPLORER_CONSOLE_SOURCE,
      action,
      method,
      modeId: next.modeId,
      previousModeId: previous?.modeId ?? null,
      phaseId: requestedPhaseId,
      attemptedModeId: result.attemptedModeId ?? requestedModeId,
      attemptedPhaseId: result.attemptedPhaseId ?? requestedPhaseId,
      accepted,
      rejected,
      reason: result.reason ?? null,
      launchPlan: next,
      localOnly: true,
      simulation: true,
      deterministic: true,
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
    lastLaunchPlanEvent = snapshot;
    appendLaunchPlanTrace(snapshot);
    render();
    onLaunchPlan?.(snapshot);
    return snapshot;
  }

  /** Select one of the two local, opt-in rehearsal modes without enrollment. */
  function selectLaunchMode(modeId, method = "api") {
    const previous = launchPlan;
    const requested = String(modeId ?? "");
    const next = selectSocialExplorerLaunchMode(previous, requested);
    if (next.rejected !== true) launchPlan = next;
    return emitLaunchPlanEvent({
      action: "select-launch-mode",
      method,
      previous,
      next: next.rejected === true ? previous : next,
      result: next,
      requestedModeId: requested,
    });
  }

  /** Advance one ordered launch phase; skipped phases are rejected atomically. */
  function advanceLaunchPhase(phaseId = launchPlan.nextPhaseId, method = "api") {
    const previous = launchPlan;
    const requested = phaseId === undefined ? launchPlan.nextPhaseId : phaseId;
    const next = advanceSocialExplorerLaunchPhase(previous, requested);
    if (next.rejected !== true) launchPlan = next;
    return emitLaunchPlanEvent({
      action: "advance-launch-phase",
      method,
      previous,
      next: next.rejected === true ? previous : next,
      result: next,
      requestedPhaseId: requested,
    });
  }

  /** Reset the launch cursor while retaining the in-memory replay trace. */
  function resetLaunchPlan(method = "api") {
    const previous = launchPlan;
    const next = resetSocialExplorerLaunchPlan(previous);
    launchPlan = next;
    return emitLaunchPlanEvent({
      action: "reset-launch-plan",
      method,
      previous,
      next,
    });
  }

  /** Replay every launch phase locally and append the replay to the trace. */
  function replayLaunchPlan(method = "button") {
    const previous = launchPlan;
    const next = createSocialExplorerLaunchPlan({
      modeId: previous.modeId,
      completedPhaseIds: SOCIAL_EXPLORER_LAUNCH_PHASE_IDS,
      replayCount: previous.replayCount + 1,
      updatedAt: previous.updatedAt,
    });
    launchPlan = next;
    return emitLaunchPlanEvent({
      action: "replay-launch-plan",
      method,
      previous,
      next,
    });
  }

  function setProjection(nextProjection) {
    currentProjection = nextProjection ?? currentProjection;
    render();
    return getSnapshot();
  }

  function setPublicPulse(nextPulse) {
    publicPulseSnapshot = normalizePublicPulse(nextPulse);
    render();
    return getSnapshot();
  }

  function refreshPublicPulse(method = "button") {
    publicPulseRefreshing = true;
    renderPublicPulse();
    let request;
    try {
      request = typeof onPublicPulseRefresh === "function"
        ? onPublicPulseRefresh({ actor: publicPulseSnapshot.actor, limit: publicPulseSnapshot.requestedLimit, method })
        : unavailablePublicPulse("No host public-pulse refresh is connected; no fallback rows were fabricated.");
    } catch (error) {
      request = Promise.reject(error);
    }
    return Promise.resolve(request)
      .then((nextPulse) => setPublicPulse(nextPulse ?? unavailablePublicPulse("Host public-pulse refresh returned no envelope; no fallback rows were fabricated.")))
      .catch((error) => setPublicPulse(unavailablePublicPulse(`Public social pulse failed: ${safeText(error?.message, error)}`)))
      .finally(() => {
        publicPulseRefreshing = false;
        renderPublicPulse();
      });
  }

  function getSnapshot() {
    return freezeSnapshot({
      ...summary,
      selectedKind,
      selectedId,
      opened,
      replayCount,
      lastReplay,
      lastAction,
      flow,
      flowDraft: flow,
      nextIntent: flow.nextIntent,
      completedIntents: flow.completedIntents,
      lastFlowEvent,
      launchPlan,
      launchModeId: launchPlan.modeId,
      launchNextPhaseId: launchPlan.nextPhaseId,
      launchCompletedPhaseIds: launchPlan.completedPhaseIds,
      launchPlanTrace,
      lastLaunchPlanEvent,
      publicPulse: publicPulseSnapshot,
      publicPulseRefreshing,
      participation: launchPlan.participation,
      participationPolicy: launchPlan.participationPolicy,
      participationStatus: launchPlan.participationStatus,
      distributionStatus: launchPlan.distributionStatus,
      localOnly: true,
      deterministic: true,
    });
  }

  closeButton.addEventListener("click", () => setOpen(false, "close"));
  replayButton.addEventListener("click", () => replay("button"));
  nextButton?.addEventListener("click", () => next("button"));
  resetButton?.addEventListener("click", () => reset("button"));
  launchNextButton?.addEventListener("click", () => advanceLaunchPhase(undefined, "button"));
  launchResetButton?.addEventListener("click", () => resetLaunchPlan("button"));
  publicPulseRefreshButton?.addEventListener("click", () => { void refreshPublicPulse("button"); });
  documentRoot.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && opened) setOpen(false, "escape");
  });

  render();
  setOpen(opened, "initial");

  return Object.freeze({
    open: () => setOpen(true, "open"),
    close: () => setOpen(false, "close"),
    toggle: () => setOpen(!opened, "toggle"),
    replay,
    replayLaunchPlan,
    next,
    advance: next,
    reset,
    selectLaunchMode,
    advanceLaunchPhase,
    resetLaunchPlan,
    act,
    select,
    refreshPublicPulse,
    setPublicPulse,
    setProjection,
    getSnapshot,
  });
}

export default createSocialExplorerConsole;
