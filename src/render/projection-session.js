/**
 * Read-only composition of the canonical projection and the active renderer
 * slices.  This module is an observation seam, not another state owner:
 * every value is read from the owning projection/console getter at snapshot
 * time, then copied and frozen for consumers.
 */

export const PROJECTION_SESSION_SCHEMA_VERSION = 1;
export const PROJECTION_SESSION_SOURCE = "simfabric.projection-session";
export const PROJECTION_SESSION_EVENT = "simfabric:projection-session";
export const PROJECTION_SESSION_BOUNDARY =
  "One read-only local projection session composes canonical projection identity with feature, cube, sports, and contracts views. Domain modules remain state owners; no wallet, token issuance, transfer, signing, custody, wagering, liquidity, settlement, persistence, sensor, or external execution authority is added.";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function read(getter, fallback = null) {
  try {
    if (typeof getter === "function") return getter() ?? fallback;
    return getter ?? fallback;
  } catch {
    // A missing optional renderer must not make the composed read fail.  The
    // absence is represented as null/empty data rather than fabricated state.
    return fallback;
  }
}

/** Copy an owner snapshot so callers cannot mutate a referenced domain value. */
function cloneAndFreeze(value, seen = new WeakMap()) {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return seen.get(value);
  const copy = Array.isArray(value) ? [] : {};
  seen.set(value, copy);
  if (Array.isArray(value)) {
    value.forEach((entry) => copy.push(cloneAndFreeze(entry, seen)));
  } else {
    Object.entries(value).forEach(([key, entry]) => {
      copy[key] = cloneAndFreeze(entry, seen);
    });
  }
  return Object.freeze(copy);
}

function blockById(blocks, id) {
  return typeof id === "string"
    ? blocks.find((block) => block?.id === id) ?? null
    : null;
}

function featureSlice(featureSnapshot, featureDefinition = null) {
  const activeId = typeof featureSnapshot?.activeId === "string"
    ? featureSnapshot.activeId
    : null;
  const definition = isRecord(featureDefinition) ? featureDefinition : null;
  return {
    id: activeId,
    activeId,
    label: definition?.label ?? null,
    kicker: definition?.kicker ?? null,
    description: definition?.description ?? null,
    boundary: definition?.boundary ?? null,
    open: featureSnapshot?.open === true,
    featureCount: Number.isInteger(featureSnapshot?.featureCount)
      ? featureSnapshot.featureCount
      : 0,
  };
}

function cubeSlice(snapshot) {
  const draft = isRecord(snapshot?.draft) ? snapshot.draft : null;
  const blocks = asArray(draft?.blocks);
  const selectedId = typeof snapshot?.selectedId === "string" ? snapshot.selectedId : null;
  const hoveredId = typeof snapshot?.hoveredId === "string" ? snapshot.hoveredId : null;
  const heldBlock = isRecord(snapshot?.heldBlock) ? snapshot.heldBlock : null;
  const selectedBlock = blockById(blocks, selectedId);
  const hoveredBlock = blockById(blocks, hoveredId);
  const heldId = typeof heldBlock?.id === "string"
    ? heldBlock.id
    : typeof snapshot?.heldBlockId === "string"
      ? snapshot.heldBlockId
      : null;

  return {
    source: snapshot?.source ?? null,
    worldId: snapshot?.worldId ?? draft?.worldId ?? null,
    selectedId,
    selectedBlock,
    hoveredId,
    hoveredBlock,
    heldId,
    heldBlock,
    // `fieldOpen` describes the console; `selectedCubeOpen` describes the
    // selected cube. They can be true/false independently in one snapshot.
    opened: snapshot?.opened === true,
    fieldOpen: snapshot?.opened === true,
    selectedCubeOpen: selectedBlock ? selectedBlock.open === true : null,
    open: selectedBlock ? selectedBlock.open === true : null,
    holding: snapshot?.holding === true || Boolean(heldBlock),
    heldCoordinate: snapshot?.heldCoordinate ?? heldBlock?.coordinate ?? null,
    contentFocus: snapshot?.contentFocus ?? null,
    hoveredContent: snapshot?.hoveredContent ?? null,
    semanticDepth: snapshot?.semanticDepth ?? null,
    directManipulation: snapshot?.directManipulation ?? null,
    navigation: snapshot?.lastNavigation ?? snapshot?.navigation ?? null,
    proximity: snapshot?.proximity ?? null,
    canonical: {
      blockCount: Number.isInteger(snapshot?.blockCount)
        ? snapshot.blockCount
        : blocks.length,
      editCount: Number.isInteger(snapshot?.editCount)
        ? snapshot.editCount
        : Number.isInteger(draft?.editCount)
          ? draft.editCount
          : 0,
      localDraft: snapshot?.localDraft === true || draft?.localDraft === true,
      blockIds: blocks.map((block) => block?.id).filter((id) => typeof id === "string"),
    },
  };
}

function sportsSlice(snapshot) {
  const summary = isRecord(snapshot?.summary) ? snapshot.summary : {};
  const records = asArray(summary.records);
  const selectedId = typeof snapshot?.selectedId === "string" ? snapshot.selectedId : null;
  const selectedRecord = snapshot?.selectedRecord
    ?? records.find((record) => record?.id === selectedId)
    ?? null;
  return {
    source: snapshot?.source ?? null,
    opened: snapshot?.opened === true,
    loading: snapshot?.loading === true,
    selectedId,
    selectedRecord,
    // Keep provider/source return state explicit so an absent record cannot be
    // mistaken for a fabricated local match.
    sourceReturn: snapshot?.sourceReturn ?? null,
    liveFetch: snapshot?.liveFetch === true,
    recordCount: Number.isInteger(summary.recordCount) ? summary.recordCount : records.length,
    status: summary.status ?? snapshot?.status ?? null,
    provider: summary.provider ?? snapshot?.provider ?? null,
    noFabrication: selectedRecord === null,
  };
}

function contractsSlice(snapshot) {
  const summary = isRecord(snapshot?.summary) ? snapshot.summary : {};
  const records = asArray(summary.records);
  const selectedId = typeof snapshot?.selectedId === "string" ? snapshot.selectedId : null;
  const selectedRecord = snapshot?.selectedRecord
    ?? records.find((record) => record?.id === selectedId)
    ?? null;
  const selectedKind = typeof selectedRecord?.kind === "string" ? selectedRecord.kind : null;
  const localDraft = isRecord(snapshot?.localDraft) ? snapshot.localDraft : null;
  const graph = isRecord(snapshot?.graph) ? snapshot.graph : isRecord(summary?.graph) ? summary.graph : {};
  return {
    source: snapshot?.source ?? null,
    opened: snapshot?.opened === true,
    selectedId,
    selectedRecord: selectedRecord ? {
      id: typeof selectedRecord.id === "string" ? selectedRecord.id : null,
      kind: selectedKind,
      label: typeof selectedRecord.label === "string" ? selectedRecord.label : null,
    } : null,
    selectedContractId: selectedKind === "contract-scenario" ? selectedId : null,
    selectedPoolId: selectedKind === "pool-scenario" ? selectedId : null,
    graph: {
      nodeCount: Number.isInteger(graph.nodeCount) ? graph.nodeCount : 0,
      edgeCount: Number.isInteger(graph.edgeCount) ? graph.edgeCount : 0,
      readoutCount: Array.isArray(graph.readouts) ? graph.readouts.length : 0,
    },
    draftRouteError: snapshot?.draftRouteError ?? null,
    localDraft: localDraft ? {
      id: typeof localDraft.id === "string" ? localDraft.id : null,
      status: typeof localDraft.lifecycle?.state === "string"
        ? localDraft.lifecycle.state
        : typeof localDraft.contract?.state === "string" ? localDraft.contract.state : null,
      localOnly: localDraft.localOnly !== false,
    } : null,
    // Alias makes the distinction visible in UI/debug tooling: this is a
    // local draft, not a contract authority or execution instruction.
    draft: localDraft ? { id: typeof localDraft.id === "string" ? localDraft.id : null } : null,
    recordCount: Number.isInteger(summary.recordCount) ? summary.recordCount : records.length,
    localOnly: snapshot?.localOnly === true,
    simulation: snapshot?.simulation === true,
    fictional: true,
    betting: false,
    wagering: false,
    funds: false,
    custody: false,
    signing: false,
    settlement: false,
    externalExecution: false,
    authority: "none",
    noFabrication: selectedRecord === null,
  };
}

// Person Ω is a renderer-owned visual projection, not an identity store. Keep
// this session facet deliberately small: it exposes route/lens selection state
// and canonical fixture counts without copying a profile, visual genome, or
// any other personal presentation fields into a second surface.
function personSlice(snapshot) {
  return {
    source: snapshot?.source ?? null,
    avatarId:typeof snapshot?.avatarId==='string'?snapshot.avatarId:null,
    appearanceVersion:Number.isSafeInteger(snapshot?.appearanceVersion)?snapshot.appearanceVersion:null,
    companionId:typeof snapshot?.companionId==='string'?snapshot.companionId:null,
    roomId:typeof snapshot?.roomId==='string'?snapshot.roomId:null,
    opened: snapshot?.opened === true,
    selectedId: typeof snapshot?.selectedId === "string" ? snapshot.selectedId : null,
    lensMode: typeof snapshot?.lensMode === "string" ? snapshot.lensMode : null,
    profileCount: Number.isInteger(snapshot?.profileCount) ? snapshot.profileCount : 0,
    fictional: snapshot?.fictional === true,
    localOnly: snapshot?.localOnly === true,
    simulation: snapshot?.simulation === true,
    // A missing selected id stays explicit. The session never substitutes a
    // profile or makes a selection on behalf of the Person renderer.
    noFabrication: typeof snapshot?.selectedId !== "string",
  };
}

// World Pulse remains owned by its public-evidence console. The composed
// session carries only the current inspection/provenance envelope so consumers
// can distinguish returned public records from an explicit unavailable state
// without triggering a fetch or retaining a second copy of provider data.
function worldEventsSlice(snapshot) {
  const summary = isRecord(snapshot?.summary) ? snapshot.summary : {};
  const records = asArray(summary.records);
  const selectedId = typeof snapshot?.selectedId === "string" ? snapshot.selectedId : null;
  const selectedRecord = snapshot?.selectedRecord
    ?? records.find((record) => record?.id === selectedId)
    ?? null;
  const sources = asArray(summary.sources).map((source) => ({
    provider: typeof source?.provider === "string" ? source.provider : null,
    available: source?.available === true,
    recordCount: Number.isInteger(source?.recordCount) ? source.recordCount : 0,
    reason: typeof source?.reason === "string" ? source.reason : null,
  }));
  return {
    source: snapshot?.source ?? null,
    opened: snapshot?.opened === true,
    projected: snapshot?.projected === true,
    loading: snapshot?.loading === true,
    selectedId,
    selectedRecord,
    status: typeof summary.status === "string" ? summary.status : null,
    returnedRecordCount: Number.isInteger(snapshot?.returnedRecordCount)
      ? snapshot.returnedRecordCount
      : records.length,
    visibleRecordCount: Number.isInteger(snapshot?.visibleRecordCount)
      ? snapshot.visibleRecordCount
      : records.length,
    sourceAvailability: sources,
    liveFetch: snapshot?.liveFetch === true,
    localOnly: snapshot?.localOnly === true,
    simulation: snapshot?.simulation === true,
    truthClaim: false,
    noFabrication: selectedRecord === null,
  };
}

// Rooms + Messaging owns its local selection/enter/leave presentation. The
// composed session deliberately carries only IDs, aggregate counts, and the
// existing no-content boundary; room metadata and any message content remain
// with the owning renderer/domain contribution.
function roomsSlice(snapshot) {
  const message = isRecord(snapshot?.message) ? snapshot.message : {};
  const roomCount = Number.isInteger(snapshot?.roomCount) ? snapshot.roomCount : 0;
  return {
    source: snapshot?.source ?? null,
    opened: snapshot?.opened === true,
    selectedId: typeof snapshot?.selectedId === "string" ? snapshot.selectedId : null,
    enteredRoomId: typeof snapshot?.enteredRoomId === "string" ? snapshot.enteredRoomId : null,
    hoveredRoomId: typeof snapshot?.hoveredRoomId === "string" ? snapshot.hoveredRoomId : null,
    roomCount,
    membershipCount: Number.isInteger(snapshot?.membershipCount) ? snapshot.membershipCount : 0,
    replayCount: Number.isInteger(snapshot?.replayCount) ? snapshot.replayCount : 0,
    messageContentRetained: message.contentRetained === true,
    cryptographyImplemented: message.cryptographyImplemented === true,
    localOnly: snapshot?.localOnly === true,
    simulation: snapshot?.simulation === true,
    noFabrication: roomCount === 0,
  };
}

// Phone / PC / XR is a local presentation capability surface. Preserve the
// selected bounded profile and fallback status without exposing browser device
// details or implying that an XR session, shared state, or parity host exists.
function deviceProjectionSlice(snapshot) {
  const summary = isRecord(snapshot?.summary) ? snapshot.summary : {};
  const devices = asArray(summary.devices);
  const selectedId = typeof snapshot?.selectedId === "string" ? snapshot.selectedId : null;
  const selected = isRecord(snapshot?.selectedDevice)
    ? snapshot.selectedDevice
    : devices.find((device) => device?.id === selectedId) ?? null;
  const xr = isRecord(summary.xr) ? summary.xr : {};
  return {
    source: snapshot?.source ?? null,
    opened: snapshot?.opened === true,
    selectedId,
    selectedDevice: selected ? {
      id: typeof selected.id === "string" ? selected.id : null,
      status: typeof selected.status === "string" ? selected.status : null,
      mode: typeof selected.mode === "string" ? selected.mode : null,
      xr: selected.xr === true,
    } : null,
    deviceCount: devices.length,
    xrStatus: typeof xr.status === "string" ? xr.status : null,
    xrSession: snapshot?.xrSession === true || summary.xrSession === true,
    parityClaim: snapshot?.parityClaim === true || summary.parityClaim === true,
    sharedState: snapshot?.sharedState === true || summary.sharedState === true,
    localOnly: snapshot?.localOnly === true,
    simulation: snapshot?.simulation === true,
    noFabrication: devices.length === 0,
  };
}

// Gesture input and gaze-hand coupling are optional capability bridges. Their
// owner snapshots may contain bounded pose/target diagnostics, but the shared
// session intentionally publishes only coarse status, capability, calibration,
// and action metadata—never points, coordinates, frames, landmarks, or IDs.
function gestureSlice(snapshot, couplingSnapshot) {
  const capabilities = isRecord(snapshot?.capabilities) ? snapshot.capabilities : {};
  const calibration = isRecord(snapshot?.calibration) ? snapshot.calibration : {};
  return {
    source: snapshot?.source ?? null,
    status: typeof snapshot?.status === "string" ? snapshot.status : "unavailable",
    active: snapshot?.active === true,
    opened: snapshot?.opened === true,
    mode: typeof snapshot?.mode === "string" ? snapshot.mode : null,
    sampleCount: Number.isInteger(snapshot?.samples) ? snapshot.samples : 0,
    lastGesture: typeof snapshot?.gesture === "string" ? snapshot.gesture : null,
    capabilities: {
      touchPointer: typeof capabilities.touchPointer === "string" ? capabilities.touchPointer : "unavailable",
      orientation: typeof capabilities.orientation === "string" ? capabilities.orientation : "unavailable",
      gaze: typeof capabilities.gaze === "string" ? capabilities.gaze : "unavailable",
      nativeHand: typeof capabilities.nativeHand === "string" ? capabilities.nativeHand : "unavailable",
      handTracking: typeof capabilities.handTracking === "string" ? capabilities.handTracking : "unavailable",
    },
    calibration: {
      status: typeof calibration.status === "string" ? calibration.status : "unavailable",
      inputSource: typeof calibration.inputSource === "string" ? calibration.inputSource : null,
      gesture: typeof calibration.gesture === "string" ? calibration.gesture : null,
      sampleCount: Number.isInteger(calibration.sampleCount) ? calibration.sampleCount : 0,
    },
    coupling: {
      source: couplingSnapshot?.source ?? null,
      lockActive: couplingSnapshot?.lockActive === true,
      lastAction: typeof couplingSnapshot?.lastAction === "string" ? couplingSnapshot.lastAction : "idle",
      reason: typeof couplingSnapshot?.reason === "string" ? couplingSnapshot.reason : "unavailable",
      expiryScheduled: Number.isFinite(Number(couplingSnapshot?.expiresAt)),
    },
    localOnly: snapshot?.localOnly === true && couplingSnapshot?.localOnly !== false,
    simulation: snapshot?.simulation === true && couplingSnapshot?.simulation !== false,
    biometric: false,
    landmarks: false,
    recording: false,
    externalNetwork: false,
    persistence: false,
    executable: false,
    noFabrication: snapshot == null,
  };
}

// Asset Market owns public-read observations. The session carries selection,
// availability, and provenance only: it deliberately excludes all price and
// market metric fields, while keeping the native TUMBO-SIM unlisted/no-trading
// declaration explicit.
function assetMarketSlice(snapshot) {
  const summary = isRecord(snapshot?.summary) ? snapshot.summary : {};
  const records = asArray(summary.records);
  const selectedId = typeof snapshot?.selectedId === "string" ? snapshot.selectedId : null;
  const selected = isRecord(snapshot?.selectedRecord)
    ? snapshot.selectedRecord
    : records.find((record) => record?.id === selectedId) ?? null;
  const nativeAsset = isRecord(snapshot?.nativeAsset) ? snapshot.nativeAsset : {};
  const sources = asArray(summary.sources).map((source) => ({
    provider: typeof source?.provider === "string" ? source.provider : null,
    available: source?.available === true,
    recordCount: Number.isInteger(source?.recordCount) ? source.recordCount : 0,
    reason: typeof source?.reason === "string" ? source.reason : null,
  }));
  return {
    source: snapshot?.source ?? null,
    opened: snapshot?.opened === true,
    loading: snapshot?.loading === true,
    selectedId,
    selectedRecord: selected ? {
      id: typeof selected.id === "string" ? selected.id : null,
      assetId: typeof selected.assetId === "string" ? selected.assetId : null,
      symbol: typeof selected.symbol === "string" ? selected.symbol : null,
      sourceUrl: typeof selected.sourceUrl === "string" ? selected.sourceUrl : null,
      dataCompletenessGrade: typeof selected.dataCompletenessGrade === "string"
        ? selected.dataCompletenessGrade
        : null,
    } : null,
    status: typeof summary.status === "string" ? summary.status : "unavailable",
    recordCount: Number.isInteger(summary.recordCount) ? summary.recordCount : records.length,
    sourceAvailability: sources,
    liveFetch: snapshot?.liveFetch === true,
    nativeAsset: {
      id: typeof nativeAsset.id === "string" ? nativeAsset.id : null,
      symbol: typeof nativeAsset.symbol === "string" ? nativeAsset.symbol : null,
      listingStatus: typeof nativeAsset.listingStatus === "string" ? nativeAsset.listingStatus : null,
      listed: nativeAsset.listed === true,
      marketDataAvailable: nativeAsset.marketDataAvailable === true,
      priceStatus: typeof nativeAsset.priceStatus === "string" ? nativeAsset.priceStatus : null,
      marketStatus: typeof nativeAsset.marketStatus === "string" ? nativeAsset.marketStatus : null,
    },
    localOnly: snapshot?.localOnly === true,
    simulation: snapshot?.simulation === true,
    truthClaim: false,
    trading: false,
    custody: false,
    settlement: false,
    noFabrication: selected === null,
  };
}

// Launch Distribution is an aggregate fictional rehearsal. This facet exposes
// reconciliation and selected-cohort route state without carrying allocation
// instructions, recipient details, or any issuance/transfer capability.
function launchDistributionSlice(snapshot) {
  const cohort = isRecord(snapshot?.selectedCohort) ? snapshot.selectedCohort : {};
  const rehearsal = isRecord(snapshot?.lastRehearsal) ? snapshot.lastRehearsal : null;
  return {
    source: snapshot?.source ?? null,
    opened: snapshot?.opened === true,
    selectedId: typeof snapshot?.selectedId === "string" ? snapshot.selectedId : null,
    selectedCohort: snapshot?.selectedId ? {
      id: typeof cohort.id === "string" ? cohort.id : null,
      recipientClass: typeof cohort.recipientClass === "string" ? cohort.recipientClass : null,
      aggregate: cohort.aggregate === true,
      fictional: cohort.fictional === true,
    } : null,
    routeError: typeof snapshot?.routeError === "string" ? snapshot.routeError : null,
    coverageLens: typeof snapshot?.coverageLens === "string" ? snapshot.coverageLens : null,
    rowCount: Number.isInteger(snapshot?.rowCount) ? snapshot.rowCount : 0,
    visibleRowCount: Number.isInteger(snapshot?.visibleRowCount) ? snapshot.visibleRowCount : 0,
    allocationClassCount: Array.isArray(snapshot?.allocationClasses) ? snapshot.allocationClasses.length : 0,
    reconciliation: {
      basisPointsComplete: Number.isInteger(snapshot?.totalBasisPoints)
        && Number.isInteger(snapshot?.expectedBasisPoints)
        && snapshot.totalBasisPoints === snapshot.expectedBasisPoints,
      unitsComplete: Number.isInteger(snapshot?.totalUnits)
        && Number.isInteger(snapshot?.expectedUnits)
        && snapshot.totalUnits === snapshot.expectedUnits,
    },
    rehearsal: rehearsal ? {
      status: typeof rehearsal.status === "string" ? rehearsal.status : null,
      registryComplete: rehearsal.registryComplete === true,
      registryEntryCount: Number.isInteger(rehearsal.registryEntryCount) ? rehearsal.registryEntryCount : 0,
      completeClassCount: Number.isInteger(rehearsal.completeClassCount) ? rehearsal.completeClassCount : 0,
    } : null,
    rehearsalCount: Number.isInteger(snapshot?.rehearsalCount) ? snapshot.rehearsalCount : 0,
    journeyStep: typeof snapshot?.journeyStep === "string" ? snapshot.journeyStep : null,
    localOnly: snapshot?.localOnly === true,
    deterministic: snapshot?.deterministic === true,
    simulation: true,
    fictional: true,
    aggregate: true,
    issuance: false,
    externalTransfer: false,
    walletConnection: false,
    custody: false,
    signing: false,
    settlement: false,
    executable: false,
    noFabrication: Number.isInteger(snapshot?.rowCount) ? snapshot.rowCount === 0 : true,
  };
}

// Launch Kit is a deterministic local manifest and user-triggered local export
// surface. The session keeps compact catalog and action statuses, never the
// manifest payload, copied URL, or a claim that the kit was published.
function launchKitSlice(snapshot) {
  const summary = isRecord(snapshot?.summary) ? snapshot.summary : {};
  const download = isRecord(snapshot?.lastDownload) ? snapshot.lastDownload : null;
  const replay = isRecord(snapshot?.lastReplay) ? snapshot.lastReplay : null;
  return {
    source: snapshot?.source ?? null,
    opened: snapshot?.opened === true,
    selectedRouteId: typeof snapshot?.selectedRouteId === "string" ? snapshot.selectedRouteId : null,
    featureCount: Number.isInteger(summary.featureCount) ? summary.featureCount : 0,
    allocationCount: Number.isInteger(summary.allocationCount) ? summary.allocationCount : 0,
    registryCount: Number.isInteger(summary.registryCount) ? summary.registryCount : 0,
    migrationCount: Number.isInteger(summary.migrationCount) ? summary.migrationCount : 0,
    socialActionCount: Number.isInteger(summary.socialActionCount) ? summary.socialActionCount : 0,
    copyStatus: typeof snapshot?.copyStatus === "string" ? snapshot.copyStatus : "manual",
    download: download ? {
      status: typeof download.status === "string" ? download.status : null,
      validated: download.validated === true,
      bytes: Number.isInteger(download.bytes) ? download.bytes : 0,
    } : null,
    replayCount: Number.isInteger(snapshot?.replayCount) ? snapshot.replayCount : 0,
    replayed: replay !== null,
    localOnly: snapshot?.localOnly === true,
    deterministic: true,
    simulation: snapshot?.simulation === true,
    fictional: true,
    publication: false,
    issuance: false,
    walletConnection: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
    noFabrication: Number.isInteger(summary.featureCount) ? summary.featureCount === 0 : true,
  };
}

// Live Gateway is an observation/status console, not a public-data owner or
// authority service. Preserve only aggregate canonical/public-status counts
// and the selected local record identity; provider records, URLs, and refresh
// controls stay with the existing console.
function liveGatewaySlice(snapshot) {
  const summary = isRecord(snapshot?.summary) ? snapshot.summary : {};
  const publicStatus = isRecord(snapshot?.publicSourceStatus) ? snapshot.publicSourceStatus : {};
  return {
    source: snapshot?.source ?? null,
    opened: snapshot?.opened === true,
    selectedType: typeof snapshot?.selectedType === "string" ? snapshot.selectedType : null,
    selectedId: typeof snapshot?.selectedId === "string" ? snapshot.selectedId : null,
    evidenceCount: Number.isInteger(summary.evidenceCount) ? summary.evidenceCount : 0,
    interpretationCount: Number.isInteger(summary.interpretationCount) ? summary.interpretationCount : 0,
    recordCount: Number.isInteger(summary.recordCount) ? summary.recordCount : 0,
    capabilityCount: Number.isInteger(summary.capabilityCount) ? summary.capabilityCount : 0,
    publicStatus: {
      status: typeof publicStatus.status === "string" ? publicStatus.status : "unavailable",
      surfaceCount: Number.isInteger(publicStatus.surfaceCount) ? publicStatus.surfaceCount : 0,
      providerCount: Number.isInteger(publicStatus.providerCount) ? publicStatus.providerCount : 0,
      readyCount: Number.isInteger(publicStatus.readyCount) ? publicStatus.readyCount : 0,
      partialCount: Number.isInteger(publicStatus.partialCount) ? publicStatus.partialCount : 0,
      unavailableCount: Number.isInteger(publicStatus.unavailableCount) ? publicStatus.unavailableCount : 0,
      staleCount: Number.isInteger(publicStatus.staleCount) ? publicStatus.staleCount : 0,
    },
    batchActive: snapshot?.publicRefreshBatchActive === true,
    autoRefreshEnabled: snapshot?.publicRefreshAutoEnabled === true,
    autoRefreshTickCount: Number.isInteger(snapshot?.publicRefreshAutoTickCount)
      ? snapshot.publicRefreshAutoTickCount
      : 0,
    localOnly: snapshot?.localOnly === true,
    simulation: snapshot?.simulation === true,
    truthClaim: false,
    authority: "none",
    externalExecution: false,
    noFabrication: Number.isInteger(summary.recordCount) ? summary.recordCount === 0 : true,
  };
}

// Protocol Evidence owns its explicit public-provider readout. The shared
// session may expose only its selection slot and aggregate evidence state;
// provider rows, TVL values, source URLs, timestamps, and refresh controls
// remain exclusively with the rail and are never promoted into authority.
function protocolEvidenceSlice(snapshot) {
  const summary = isRecord(snapshot?.summary) ? snapshot.summary : {};
  return {
    source: snapshot?.source ?? null,
    opened: snapshot?.opened === true,
    loading: snapshot?.loading === true,
    selectedId: typeof snapshot?.selectedId === "string" ? snapshot.selectedId : null,
    status: typeof summary.status === "string" ? summary.status : "unavailable",
    provider: typeof summary.provider === "string" ? summary.provider : null,
    metric: typeof summary.metric === "string" ? summary.metric : null,
    unit: typeof summary.unit === "string" ? summary.unit : null,
    recordCount: Number.isInteger(summary.recordCount) ? summary.recordCount : 0,
    availableCount: Number.isInteger(summary.availableCount) ? summary.availableCount : 0,
    unavailableCount: Number.isInteger(summary.unavailableCount) ? summary.unavailableCount : 0,
    providerCount: Number.isInteger(summary.providerCount) ? summary.providerCount : 0,
    providerAvailable: summary.providerAvailable === true,
    providerUnavailable: summary.providerUnavailable === true,
    refreshCount: Number.isInteger(snapshot?.refreshCount) ? snapshot.refreshCount : 0,
    localOnly: snapshot?.localOnly === true,
    simulation: snapshot?.simulation === true,
    evidenceOnly: true,
    truthClaim: false,
    authority: "none",
    externalWrite: false,
    executable: false,
    noFabrication: Number.isInteger(summary.recordCount) ? summary.recordCount === 0 : true,
  };
}

// Social Explorer owns both its fictional local rehearsal catalog and the
// separately bounded public Social Pulse envelope. The session keeps only
// aggregate counts and the local selection cursor: public posts, author
// identity, text, URLs, and provider request details never leave the owner.
function socialExplorerSlice(snapshot) {
  const pulse = isRecord(snapshot?.publicPulse) ? snapshot.publicPulse : {};
  return {
    source: snapshot?.source ?? null,
    opened: snapshot?.opened === true,
    selectedKind: typeof snapshot?.selectedKind === "string" ? snapshot.selectedKind : null,
    selectedId: typeof snapshot?.selectedId === "string" ? snapshot.selectedId : null,
    roomCount: Number.isInteger(snapshot?.roomCount) ? snapshot.roomCount : 0,
    creatorCardCount: Number.isInteger(snapshot?.creatorCardCount) ? snapshot.creatorCardCount : 0,
    discoverySignalCount: Number.isInteger(snapshot?.discoverySignalCount) ? snapshot.discoverySignalCount : 0,
    actionCount: Number.isInteger(snapshot?.actionCount) ? snapshot.actionCount : 0,
    replayCount: Number.isInteger(snapshot?.replayCount) ? snapshot.replayCount : 0,
    publicPulse: {
      source: typeof pulse.source === "string" ? pulse.source : null,
      provider: typeof pulse.provider === "string" ? pulse.provider : null,
      status: typeof pulse.status === "string" ? pulse.status : "unavailable",
      returnedCount: Number.isInteger(pulse.returnedCount) ? pulse.returnedCount : 0,
      requestedLimit: Number.isInteger(pulse.requestedLimit) ? pulse.requestedLimit : 0,
      providerAvailable: pulse.providerAvailable === true,
      publicSource: pulse.publicSource === true,
      untrusted: pulse.untrusted === true,
      metadataOnly: pulse.metadataOnly === true,
      refreshing: snapshot?.publicPulseRefreshing === true,
    },
    localOnly: snapshot?.localOnly === true,
    deterministic: snapshot?.deterministic === true,
    simulation: snapshot?.simulation === true,
    evidenceOnly: true,
    truthClaim: false,
    publication: false,
    crossUserState: false,
    persistence: false,
    externalWrite: false,
    authority: "none",
    executable: false,
    noFabrication: Number.isInteger(pulse.returnedCount) ? pulse.returnedCount === 0 : true,
  };
}

// Block Migration owns its manifest, preview, and explicit local-draft action.
// The session presents a compact readiness envelope only: no mapping entries,
// coordinates, draft payload, trace, or apply control is duplicated here.
function blockMigrationSlice(snapshot) {
  const manifest = isRecord(snapshot?.manifest) ? snapshot.manifest : {};
  const preview = isRecord(snapshot?.preview) ? snapshot.preview : null;
  const draft = isRecord(snapshot?.draft?.draft) ? snapshot.draft.draft : {};
  const counts = isRecord(manifest?.counts) ? manifest.counts : isRecord(manifest?.statusCounts) ? manifest.statusCounts : {};
  const previewCounts = isRecord(preview?.counts) ? preview.counts : {};
  return {
    source: snapshot?.source ?? null,
    opened: snapshot?.opened === true,
    selectedId: typeof snapshot?.selectedId === "string" ? snapshot.selectedId : null,
    manifestId: typeof manifest.id === "string" ? manifest.id : null,
    mappingCount: Array.isArray(manifest.entries) ? manifest.entries.length : 0,
    statusCounts: {
      mapped: Number.isInteger(counts.mapped) ? counts.mapped : 0,
      preserved: Number.isInteger(counts.preserved) ? counts.preserved : 0,
      deferred: Number.isInteger(counts.deferred) ? counts.deferred : 0,
    },
    preview: {
      mappingCount: Number.isInteger(preview.mappingCount) ? preview.mappingCount : 0,
      safeCount: Number.isInteger(preview.safeCount)
        ? preview.safeCount
        : (Number.isInteger(previewCounts.mapped) ? previewCounts.mapped : 0)
          + (Number.isInteger(previewCounts.preserved) ? previewCounts.preserved : 0),
      deferredCount: Number.isInteger(previewCounts.deferred) ? previewCounts.deferred : 0,
      applyCount: Number.isInteger(preview.applyCount) ? preview.applyCount : 0,
    },
    localDraftActive: snapshot?.draft != null,
    localDraftMappingCount: Array.isArray(draft.mappingIds) ? draft.mappingIds.length : 0,
    localOnly: snapshot?.localOnly === true,
    simulation: snapshot?.simulation === true,
    deterministic: manifest.deterministic === true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalExecution: false,
    authority: "none",
    // An explicit owner action may create a local in-memory draft. Observing
    // this facet never invokes it and provides no command to invoke it.
    applyOnRead: false,
    executable: false,
    noFabrication: Array.isArray(manifest.entries) ? manifest.entries.length === 0 : true,
  };
}

// Migration Snapshot is the owner of in-memory snapshot validation and local
// preview/replay. Publish only its compact validation envelope and selection;
// never copy supplied JSON, mapping rows, coordinates, file metadata, traces,
// Merge 4 details, drafts, or any control surface into the canonical session.
function migrationSnapshotSlice(snapshot) {
  const validation = isRecord(snapshot?.validation) ? snapshot.validation : {};
  const preview = isRecord(snapshot?.preview) ? snapshot.preview : null;
  const draft = isRecord(snapshot?.draft?.draft) ? snapshot.draft.draft : {};
  return {
    source: snapshot?.source ?? null,
    opened: snapshot?.opened === true,
    selectedId: typeof snapshot?.selectedId === "string" ? snapshot.selectedId : null,
    valid: validation.valid === true,
    mappingCount: Number.isInteger(validation.mappingCount) ? validation.mappingCount : 0,
    safeCount: Number.isInteger(validation.safeCount) ? validation.safeCount : 0,
    deferredCount: Number.isInteger(validation.deferredCount) ? validation.deferredCount : 0,
    errorCount: Array.isArray(validation.errors) ? validation.errors.length : 0,
    warningCount: Array.isArray(validation.warnings) ? validation.warnings.length : 0,
    previewReady: preview !== null,
    previewApplyCount: Number.isInteger(preview?.applyCount) ? preview.applyCount : 0,
    localDraftActive: snapshot?.draft != null,
    localDraftMappingCount: Array.isArray(draft.mappingIds) ? draft.mappingIds.length : 0,
    replayCount: Number.isInteger(snapshot?.replayCount) ? snapshot.replayCount : 0,
    localOnly: snapshot?.localOnly === true,
    simulation: snapshot?.simulation === true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalExecution: false,
    authority: "none",
    applyOnRead: false,
    executable: false,
    noFabrication: validation.valid !== true && preview === null,
  };
}

// Arena Games owns the deterministic local game state and its event trace.
// Share only a selected-mode/readiness envelope; never game values, legal
// action descriptors, events, hashes, player/session details, or controls.
function arenaGamesSlice(snapshot) {
  const summary = isRecord(snapshot?.summary) ? snapshot.summary : {};
  const state = isRecord(snapshot?.state) ? snapshot.state : {};
  return {
    source: snapshot?.source ?? null,
    opened: snapshot?.opened === true,
    selectedModeId: typeof snapshot?.modeId === "string" ? snapshot.modeId : null,
    modeCount: Number.isInteger(summary.modeCount)
      ? summary.modeCount
      : Array.isArray(summary.modes) ? summary.modes.length : 0,
    sessionCount: Array.isArray(summary.sessions) ? summary.sessions.length : 0,
    status: typeof state.status === "string" ? state.status : "unavailable",
    turn: Number.isInteger(state.turn) ? state.turn : 0,
    eventCount: Array.isArray(state.events) ? state.events.length : 0,
    rejectedActionCount: Number.isInteger(state.rejectedActionCount) ? state.rejectedActionCount : 0,
    hashChainValid: state.hashChainValid === true,
    traceCount: Array.isArray(snapshot?.trace) ? snapshot.trace.length : 0,
    localOnly: snapshot?.localOnly === true,
    simulation: snapshot?.simulation === true,
    deterministic: summary.deterministic === true,
    multiplayer: false,
    rewards: false,
    wallet: false,
    token: false,
    persistence: false,
    externalExecution: false,
    authority: "none",
    executable: false,
    noFabrication: typeof snapshot?.modeId !== "string",
  };
}

// PAYCORE owns fictional asset-token balance/flow previews. The session keeps
// selection and aggregate preview status only, never amounts, labels, routes,
// or the trace that could be mistaken for a financial instruction.
function assetTokenSlice(snapshot) {
  const summary = isRecord(snapshot?.summary) ? snapshot.summary : {};
  return {
    source: snapshot?.source ?? null,
    opened: snapshot?.opened === true,
    selectedType: typeof snapshot?.selectedType === "string" ? snapshot.selectedType : null,
    selectedId: typeof snapshot?.selectedId === "string" ? snapshot.selectedId : null,
    balancePreviewCount: Number.isInteger(summary.balanceCount) ? summary.balanceCount : 0,
    flowPreviewCount: Number.isInteger(summary.flowCount) ? summary.flowCount : 0,
    recordCount: Number.isInteger(summary.recordCount) ? summary.recordCount : 0,
    evidenceCount: Number.isInteger(summary.evidenceCount) ? summary.evidenceCount : 0,
    capabilityCount: Number.isInteger(summary.capabilityCount) ? summary.capabilityCount : 0,
    traceCount: Array.isArray(snapshot?.trace) ? snapshot.trace.length : 0,
    localOnly: snapshot?.localOnly === true,
    simulation: snapshot?.simulation === true,
    assetTokenTerminology: true,
    legacyCoinAliasesParserOnly: true,
    balances: false,
    addresses: false,
    transfer: false,
    signing: false,
    custody: false,
    settlement: false,
    execution: false,
    authority: "none",
    noFabrication: typeof snapshot?.selectedId !== "string",
  };
}

function t402Slice(snapshot) {
  const summary = isRecord(snapshot?.summary) ? snapshot.summary : {};
  return {
    source: snapshot?.source ?? null, opened: snapshot?.opened === true,
    selectedId: typeof snapshot?.selectedId === "string" ? snapshot.selectedId : null,
    recordCount: Number.isInteger(summary.recordCount) ? summary.recordCount : 0,
    evidenceCount: Number.isInteger(summary.evidenceCount) ? summary.evidenceCount : 0,
    capabilityCount: Number.isInteger(summary.capabilityCount) ? summary.capabilityCount : 0,
    traceCount: Array.isArray(snapshot?.trace) ? snapshot.trace.length : 0,
    localOnly: snapshot?.localOnly === true, simulation: snapshot?.simulation === true,
    protocolObservation: true, fabricatedNetworkData: false, paymentExecution: false,
    signing: false, settlement: false, custody: false, transfer: false, authority: "none",
    noFabrication: typeof snapshot?.selectedId !== "string",
  };
}

function neuralMeshSlice(snapshot) {
  const summary = isRecord(snapshot?.summary) ? snapshot.summary : {};
  return {
    source: snapshot?.source ?? null, opened: snapshot?.opened === true,
    selectedType: typeof snapshot?.selectedType === "string" ? snapshot.selectedType : null,
    selectedId: typeof snapshot?.selectedId === "string" ? snapshot.selectedId : null,
    recordCount: Number.isInteger(summary.recordCount) ? summary.recordCount : 0,
    agentCount: Array.isArray(summary.agents) ? summary.agents.length : 0,
    intentCount: Array.isArray(summary.intents) ? summary.intents.length : 0,
    proposalCount: Array.isArray(summary.proposals) ? summary.proposals.length : 0,
    relationshipCount: Array.isArray(summary.relationships) ? summary.relationships.length : 0,
    evidenceCount: Number.isInteger(summary.evidenceCount) ? summary.evidenceCount : 0,
    traceCount: Array.isArray(snapshot?.trace) ? snapshot.trace.length : 0,
    localOnly: snapshot?.localOnly === true, simulation: snapshot?.simulation === true,
    advisoryOnly: true, identityAuthority: "none", biometric: false, rawTrace: false,
    externalExecution: false, noFabrication: typeof snapshot?.selectedId !== "string",
  };
}

// Picture Matter owns word/image fixtures, statement interpretation, and any
// metadata-only public-read envelope. Publish only aggregate readiness and a
// local selection cursor: bytes, URLs, thumbnails, records, and paths stay
// with the owner and cannot become identity or publication state.
function pictureMatterSlice(snapshot) {
  const summary = isRecord(snapshot?.summary) ? snapshot.summary : {};
  const metadata = isRecord(snapshot?.metadata) ? snapshot.metadata : {};
  return {
    source: snapshot?.source ?? null, opened: snapshot?.opened === true,
    selectedType: typeof snapshot?.selectedType === "string" ? snapshot.selectedType : null,
    selectedId: typeof snapshot?.selectedId === "string" ? snapshot.selectedId : null,
    wordObjectCount: Number.isInteger(summary.wordCount) ? summary.wordCount : 0,
    localImageCount: Number.isInteger(summary.localImageCount) ? summary.localImageCount : 0,
    statementCount: Number.isInteger(summary.statementCount) ? summary.statementCount : 0,
    provenanceCount: Number.isInteger(summary.provenanceCount) ? summary.provenanceCount : 0,
    evidenceCount: Number.isInteger(summary.evidenceCount) ? summary.evidenceCount : 0,
    metadata: {
      status: typeof metadata.status === "string" ? metadata.status : "unavailable",
      returnedCount: Number.isInteger(metadata.returnedCount) ? metadata.returnedCount : 0,
      requestedLimit: Number.isInteger(metadata.requestedLimit) ? metadata.requestedLimit : 0,
      providerAvailable: metadata.providerAvailable === true,
      metadataOnly: metadata.metadataOnly === true,
      refreshing: snapshot?.metadataRefreshing === true,
    },
    localOnly: snapshot?.localOnly === true, simulation: snapshot?.simulation === true,
    evidenceOnly: true, imageBytes: false, storage: false, publishing: false,
    identity: false, biometric: false, token: false, authority: "none",
    externalExecution: false, noFabrication: typeof snapshot?.selectedId !== "string",
  };
}

function ledgerProofSlice(snapshot) {
  const summary = isRecord(snapshot?.summary) ? snapshot.summary : {};
  return {
    source: snapshot?.source ?? null, opened: snapshot?.opened === true,
    selectedType: typeof snapshot?.selectedType === "string" ? snapshot.selectedType : null,
    selectedId: typeof snapshot?.selectedId === "string" ? snapshot.selectedId : null,
    ledgerCount: Number.isInteger(summary.ledgerCount) ? summary.ledgerCount : 0,
    proofCount: Number.isInteger(summary.proofCount) ? summary.proofCount : 0,
    balancedCount: Number.isInteger(summary.balancedCount) ? summary.balancedCount : 0,
    ancestryEdgeCount: Number.isInteger(summary.ancestryEdgeCount) ? summary.ancestryEdgeCount : 0,
    recordCount: Number.isInteger(summary.recordCount) ? summary.recordCount : 0,
    evidenceCount: Number.isInteger(summary.evidenceCount) ? summary.evidenceCount : 0,
    capabilityCount: Number.isInteger(summary.capabilityCount) ? summary.capabilityCount : 0,
    localOnly: snapshot?.localOnly === true, simulation: snapshot?.simulation === true,
    evidenceOnly: true, authoritative: false, signing: false, settlement: false,
    custody: false, externalExecution: false, authority: "none",
    noFabrication: typeof snapshot?.selectedId !== "string",
  };
}

function multiSportEventsSlice(snapshot) {
  const summary = isRecord(snapshot?.summary) ? snapshot.summary : {};
  const sources = asArray(summary.sources).map((source) => ({ provider: typeof source?.provider === "string" ? source.provider : null, available: source?.available === true, recordCount: Number.isInteger(source?.recordCount) ? source.recordCount : 0 }));
  return {
    source: snapshot?.source ?? null, opened: snapshot?.opened === true,
    selectedId: typeof snapshot?.selectedId === "string" ? snapshot.selectedId : null,
    status: typeof summary.status === "string" ? summary.status : "unavailable",
    recordCount: Number.isInteger(summary.recordCount) ? summary.recordCount : 0,
    providerCount: Number.isInteger(summary.providerCount) ? summary.providerCount : 0,
    availableProviderCount: Number.isInteger(summary.availableProviderCount) ? summary.availableProviderCount : 0,
    sourceAvailability: sources, liveFetch: snapshot?.liveFetch === true || summary.liveFetch === true,
    truthClaim: false, evidenceOnly: true, wagering: false, financialExecution: false,
    localOnly: snapshot?.localOnly === true, simulation: snapshot?.simulation === true,
    noFabrication: typeof snapshot?.selectedId !== "string",
  };
}

function blockWorldSnapshotSlice(snapshot) {
  const validation = isRecord(snapshot?.validation) ? snapshot.validation : {};
  return {
    source: snapshot?.source ?? null, opened: snapshot?.opened === true,
    selectedId: typeof snapshot?.selectedId === "string" ? snapshot.selectedId : null,
    valid: validation.valid === true,
    blockCount: Number.isInteger(validation.blockCount) ? validation.blockCount : 0,
    errorCount: Array.isArray(validation.errors) ? validation.errors.length : 0,
    warningCount: Array.isArray(validation.warnings) ? validation.warnings.length : 0,
    previewReady: snapshot?.preview != null, localDraftActive: snapshot?.draft != null,
    replayCount: Number.isInteger(snapshot?.replayCount) ? snapshot.replayCount : 0,
    exported: snapshot?.lastExport != null, localOnly: snapshot?.localOnly === true,
    simulation: snapshot?.simulation === true, import: false, persistence: false,
    externalExecution: false, noFabrication: validation.valid !== true && snapshot?.preview == null,
  };
}

function runtimeSyncSlice(snapshot) {
  const validation = isRecord(snapshot?.validation) ? snapshot.validation : {};
  return { source: snapshot?.source ?? null, opened: snapshot?.opened === true,
    worldId: typeof snapshot?.worldId === "string" ? snapshot.worldId : null,
    status: typeof snapshot?.status === "string" ? snapshot.status : "unavailable",
    connectionState: typeof snapshot?.connectionState === "string" ? snapshot.connectionState : "unavailable",
    serverVersion: typeof snapshot?.serverVersion === "string" ? snapshot.serverVersion : null,
    remoteVersion: typeof snapshot?.remoteVersion === "string" ? snapshot.remoteVersion : null,
    requiresReload: snapshot?.requiresReload === true, busy: snapshot?.busy === true,
    reconnectAttempts: Number.isInteger(snapshot?.reconnectAttempts) ? snapshot.reconnectAttempts : 0,
    reconnectTimerActive: snapshot?.reconnectTimerActive === true, socketOpen: snapshot?.socketOpen === true,
    validation: { valid: validation.valid === true, errorCount: Array.isArray(validation.errors) ? validation.errors.length : 0 },
    localOnly: snapshot?.localOnly === true, simulation: snapshot?.simulation === true,
    persistence: false, import: false, executable: false, externalExecution: false,
    noFabrication: typeof snapshot?.worldId !== "string" };
}

function populationContextSlice(snapshot) {
  const summary = isRecord(snapshot?.summary) ? snapshot.summary : snapshot ?? {};
  return { source: snapshot?.source ?? null, selectedId: typeof snapshot?.selectedId === "string" ? snapshot.selectedId : null,
    status: typeof summary.status === "string" ? summary.status : "unavailable", provider: typeof summary.provider === "string" ? summary.provider : null,
    recordCount: Number.isInteger(summary.recordCount) ? summary.recordCount : 0,
    availableCount: Number.isInteger(summary.availableCount) ? summary.availableCount : 0,
    providerAvailable: summary.providerAvailable === true, providerUnavailable: summary.providerUnavailable === true,
    liveFetch: summary.liveFetch === true, metadataOnly: summary.metadataOnly === true,
    truthClaim: false, authority: "none", externalExecution: false, persistence: false,
    noFabrication: typeof snapshot?.selectedId !== "string" };
}

function launchReceiptSlice(snapshot) {
  const receipt = isRecord(snapshot?.receipt) ? snapshot.receipt : {};
  const totals = isRecord(receipt?.allocationTotals) ? receipt.allocationTotals : {};
  return { source: snapshot?.source ?? null, opened: snapshot?.opened === true,
    selectedId: typeof snapshot?.selectedId === "string" ? snapshot.selectedId : null,
    cohortCount: Number.isInteger(receipt.cohortCount) ? receipt.cohortCount : 0,
    reconciliationExact: totals.exact === true, replayCount: Number.isInteger(snapshot?.replayCount) ? snapshot.replayCount : 0,
    replayed: snapshot?.lastReplay != null, downloaded: snapshot?.lastDownload?.status === "downloaded",
    localOnly: snapshot?.localOnly === true, simulation: snapshot?.simulation === true,
    publication: false, distributionExecution: false, wallet: false, transfer: false,
    signing: false, custody: false, settlement: false, authority: "none",
    noFabrication: typeof snapshot?.selectedId !== "string" };
}

function distributionExplorerSlice(snapshot) {
  const launch = isRecord(snapshot?.launchState) ? snapshot.launchState : {};
  return { source: snapshot?.source ?? null, selectedId: typeof snapshot?.selectedAllocationId === "string" ? snapshot.selectedAllocationId : null,
    allocationCount: Number.isInteger(snapshot?.allocationCount) ? snapshot.allocationCount : 0,
    unit: typeof snapshot?.unit === "string" ? snapshot.unit : null,
    totalSupply: Number.isFinite(snapshot?.totalSupply) ? snapshot.totalSupply : null,
    launchReady: launch.launched === true || launch.status === "previewed", deterministic: snapshot?.deterministic === true,
    localOnly: snapshot?.localOnly === true, fictional: true, issuance: false, externalTransfer: false,
    settlement: false, externalWrite: false, wallet: false, custody: false, signing: false,
    authority: "none", noFabrication: typeof snapshot?.selectedAllocationId !== "string" };
}

function intentTimelineSlice(snapshot) {
  return { source: snapshot?.source ?? null, opened: snapshot?.opened === true,
    selectedId: typeof snapshot?.selectedId === "string" ? snapshot.selectedId : null,
    count: Number.isInteger(snapshot?.count) ? snapshot.count : 0,
    sequence: Number.isInteger(snapshot?.sequence) ? snapshot.sequence : 0,
    clearCount: Number.isInteger(snapshot?.clearCount) ? snapshot.clearCount : 0,
    replayCount: Number.isInteger(snapshot?.replayCount) ? snapshot.replayCount : 0,
    replayed: snapshot?.lastReplay != null, bound: snapshot?.bound === true,
    projectionSchemaVersion: Number.isInteger(snapshot?.projectionSchemaVersion) ? snapshot.projectionSchemaVersion : null,
    localOnly: snapshot?.localOnly === true, simulation: snapshot?.simulation === true,
    advisoryOnly: true, persistence: false, externalTransfer: false, externalExecution: false,
    noFabrication: typeof snapshot?.selectedId !== "string" };
}

// A compact index for mounted feature consoles. This deliberately exposes
// presentation/readiness state only; the renderer-specific snapshots remain
// the owners of their interaction details. Keeping the index compact also
// means a host can inspect every route without accidentally treating this
// session as a second domain store.
function mountedSurfaceSlice(surfaceSnapshots) {
  const input = isRecord(surfaceSnapshots) ? surfaceSnapshots : {};
  const surfaces = {};
  Object.entries(input).forEach(([id, snapshot]) => {
    const value = isRecord(snapshot) ? snapshot : null;
    surfaces[id] = {
      // Preserve the owner-provided provenance/readiness signals in the
      // compact index.  Provider-backed routes must remain distinguishable
      // from local-only consoles when a host inspects the single session.
      source: typeof value?.source === "string" ? value.source : null,
      mounted: value !== null,
      opened: value?.opened === true || value?.open === true,
      loading: value?.loading === true,
      selectedId: typeof value?.selectedId === "string" ? value.selectedId : null,
      status: typeof value?.status === "string"
        ? value.status
        : typeof value?.summary?.status === "string" ? value.summary.status : null,
      recordCount: Number.isInteger(value?.recordCount)
        ? value.recordCount
        : Number.isInteger(value?.summary?.recordCount) ? value.summary.recordCount : null,
      liveFetch: value?.liveFetch === true,
      externalSource: value?.externalSource === true,
      providerAvailable: value?.providerAvailable === true
        || value?.summary?.providerAvailable === true,
      providerUnavailable: value?.providerUnavailable === true
        || value?.summary?.providerUnavailable === true,
      reason: typeof value?.reason === "string"
        ? value.reason
        : typeof value?.summary?.reason === "string" ? value.summary.reason : null,
      localOnly: value?.localOnly === true || value?.externalNetwork === false,
      simulation: value?.simulation === true,
    };
  });
  return surfaces;
}

// Keep a small, derived index next to the per-surface facets.  This is useful
// to host tooling that needs to answer "what is mounted/open right now?"
// without walking renderer-specific state or inventing a second registry.
// The index is rebuilt from the same owner snapshots for every read.
function mountedSurfaceSummary(surfaces, activeFeatureId = null) {
  const input = isRecord(surfaces) ? surfaces : {};
  const ids = Object.keys(input);
  const mountedIds = ids.filter((id) => input[id]?.mounted === true);
  const openedIds = mountedIds.filter((id) => input[id]?.opened === true);
  return {
    ids,
    mountedIds,
    openedIds,
    mountedCount: mountedIds.length,
    openedCount: openedIds.length,
    activeId: typeof activeFeatureId === "string" ? activeFeatureId : null,
    activeMounted: typeof activeFeatureId === "string"
      ? input[activeFeatureId]?.mounted === true
      : false,
    activeOpened: typeof activeFeatureId === "string"
      ? input[activeFeatureId]?.opened === true
      : false,
  };
}

function surfaceIsOpen(activeId, cube, sports, contracts, person, worldEvents, rooms, deviceProjection, gesture, assetMarket, launchDistribution, launchKit, liveGateway, protocolEvidence, socialExplorer, blockMigration, migrationSnapshot, arenaGames, assetToken, t402, neuralMesh, pictureMatter, ledgerProof, multiSportEvents, navigatorOpen) {
  if (activeId === "block-world" || activeId === "runtime-sync") return cube.fieldOpen;
  if (activeId === "sports-events") return sports.opened;
  if (activeId === "contracts") return contracts.opened;
  if (activeId === "person" || activeId === "reality-lens") return person.opened;
  if (activeId === "world-events") return worldEvents.opened || worldEvents.projected;
  if (activeId === "rooms") return rooms.opened;
  if (activeId === "projections") return deviceProjection.opened;
  if (activeId === "gesture") return gesture.opened;
  if (activeId === "asset-market") return assetMarket.opened;
  if (activeId === "launch-distribution") return launchDistribution.opened;
  if (activeId === "launch-kit") return launchKit.opened;
  if (activeId === "gateway") return liveGateway.opened;
  if (activeId === "protocol-evidence") return protocolEvidence.opened;
  if (activeId === "social-explorer") return socialExplorer.opened;
  if (activeId === "migration") return blockMigration.opened;
  if (activeId === "migration-snapshot") return migrationSnapshot.opened;
  if (activeId === "arena") return arenaGames.opened;
  if (activeId === "paycore" || activeId === "asset-token") return assetToken.opened;
  if (activeId === "t402") return t402.opened;
  if (activeId === "neural-mesh") return neuralMesh.opened;
  if (activeId === "picture-matter") return pictureMatter.opened;
  if (activeId === "ledger") return ledgerProof.opened;
  if (activeId === "multi-sport-events") return multiSportEvents.opened;
  // Most feature panels do not have a dedicated getter in this narrow
  // session seam; the navigator's open state remains the honest fallback.
  return navigatorOpen;
}

function projectionIdentity(projection, envelope, cubeSnapshot) {
  const world = isRecord(projection) ? projection : {};
  const sourceEnvelope = isRecord(envelope) ? envelope : {};
  const sources = asArray(world.sources);
  const entities = asArray(world.entities);
  const evidence = asArray(world.evidence);
  const capabilities = asArray(world.capabilities);
  const worldId = world.worldId ?? cubeSnapshot?.worldId ?? cubeSnapshot?.draft?.worldId ?? null;
  return {
    schemaVersion: sourceEnvelope.schemaVersion ?? world.schemaVersion ?? null,
    envelopeKind: sourceEnvelope.kind ?? null,
    worldSchemaVersion: world.schemaVersion ?? null,
    worldId,
    source: world.source ?? null,
    kind: world.kind ?? null,
    projectedAt: sourceEnvelope.projectedAt ?? null,
    updatedAt: world.updatedAt ?? sourceEnvelope.projectedAt ?? null,
    simulation: world.simulation === true || sourceEnvelope.simulation === true,
    authority: sourceEnvelope.authority ?? "none",
    sources,
    entityCount: entities.length,
    evidenceCount: evidence.length,
    capabilityCount: capabilities.length,
  };
}

/**
 * Compose owner snapshots into one immutable, inspectable session envelope.
 * `getSnapshot` always reads current owner values; no domain value is cached
 * or mutated here. Optional event observation only notifies subscribers.
 */
export function createProjectionSession({
  getProjection = () => null,
  getProjectionEnvelope = () => null,
  getActiveFeature = () => null,
  getFeatureDefinition = () => null,
  getBlockWorldSnapshot = () => null,
  getSportsSnapshot = () => null,
  getContractsSnapshot = () => null,
  getPersonSnapshot = () => null,
  getWorldEventsSnapshot = () => null,
  getRoomsSnapshot = () => null,
  getDeviceProjectionSnapshot = () => null,
  getGestureSnapshot = () => null,
  getGazeHandSnapshot = () => null,
  getAssetMarketSnapshot = () => null,
  getLaunchDistributionSnapshot = () => null,
  getLaunchKitSnapshot = () => null,
  getLiveGatewaySnapshot = () => null,
  getProtocolEvidenceSnapshot = () => null,
  getSocialExplorerSnapshot = () => null,
  getBlockMigrationSnapshot = () => null,
  getMigrationSnapshot = () => null,
  getArenaGamesSnapshot = () => null,
  getAssetTokenSnapshot = () => null,
  getT402Snapshot = () => null,
  getNeuralMeshSnapshot = () => null,
  getPictureMatterSnapshot = () => null,
  getLedgerProofSnapshot = () => null,
  getMultiSportEventsSnapshot = () => null,
  getBlockWorldSnapshotConsole = () => null,
  getBlockWorldRuntimeSyncSnapshot = () => null,
  getPopulationContextSnapshot = () => null,
  getLaunchReceiptSnapshot = () => null,
  getDistributionExplorerSnapshot = () => null,
  getIntentTimelineSnapshot = () => null,
  getSurfaceSnapshots = () => ({}),
  getRoute = () => null,
  eventTarget = null,
  observeEvents = false,
} = {}) {
  const listeners = new Set();
  const observedEvents = ["simfabric:projection", "simfabric:intent"];

  function getSnapshot() {
    const projection = read(getProjection);
    const envelope = read(getProjectionEnvelope);
    const featureSnapshot = read(getActiveFeature);
    const featureDefinition = read(getFeatureDefinition, null);
    const blockWorldSnapshot = read(getBlockWorldSnapshot);
    const sportsSnapshot = read(getSportsSnapshot);
    const contractsSnapshot = read(getContractsSnapshot);
    const personSnapshot = read(getPersonSnapshot);
    const worldEventsSnapshot = read(getWorldEventsSnapshot);
    const roomsSnapshot = read(getRoomsSnapshot);
    const deviceProjectionSnapshot = read(getDeviceProjectionSnapshot);
    const gestureSnapshot = read(getGestureSnapshot);
    const gazeHandSnapshot = read(getGazeHandSnapshot);
    const assetMarketSnapshot = read(getAssetMarketSnapshot);
    const launchDistributionSnapshot = read(getLaunchDistributionSnapshot);
    const launchKitSnapshot = read(getLaunchKitSnapshot);
    const liveGatewaySnapshot = read(getLiveGatewaySnapshot);
    const protocolEvidenceSnapshot = read(getProtocolEvidenceSnapshot);
    const socialExplorerSnapshot = read(getSocialExplorerSnapshot);
    const blockMigrationSnapshot = read(getBlockMigrationSnapshot);
    const migrationSnapshotOwner = read(getMigrationSnapshot);
    const arenaGamesSnapshot = read(getArenaGamesSnapshot);
    const assetTokenSnapshot = read(getAssetTokenSnapshot);
    const t402Snapshot = read(getT402Snapshot);
    const neuralMeshSnapshot = read(getNeuralMeshSnapshot);
    const pictureMatterSnapshot = read(getPictureMatterSnapshot);
    const ledgerProofSnapshot = read(getLedgerProofSnapshot);
    const multiSportEventsSnapshot = read(getMultiSportEventsSnapshot);
    const blockWorldSnapshotConsole = read(getBlockWorldSnapshotConsole);
    const runtimeSyncOwner = read(getBlockWorldRuntimeSyncSnapshot);
    const populationContextOwner = read(getPopulationContextSnapshot);
    const launchReceiptOwner = read(getLaunchReceiptSnapshot);
    const distributionExplorerOwner = read(getDistributionExplorerSnapshot);
    const intentTimelineOwner = read(getIntentTimelineSnapshot);
    const surfaceSnapshots = read(getSurfaceSnapshots, {});
    const cube = cubeSlice(blockWorldSnapshot);
    const sports = sportsSlice(sportsSnapshot);
    const contracts = contractsSlice(contractsSnapshot);
    const person = personSlice(personSnapshot);
    const worldEvents = worldEventsSlice(worldEventsSnapshot);
    const rooms = roomsSlice(roomsSnapshot);
    const deviceProjection = deviceProjectionSlice(deviceProjectionSnapshot);
    const gesture = gestureSlice(gestureSnapshot, gazeHandSnapshot);
    const assetMarket = assetMarketSlice(assetMarketSnapshot);
    const launchDistribution = launchDistributionSlice(launchDistributionSnapshot);
    const launchKit = launchKitSlice(launchKitSnapshot);
    const liveGateway = liveGatewaySlice(liveGatewaySnapshot);
    const protocolEvidence = protocolEvidenceSlice(protocolEvidenceSnapshot);
    const socialExplorer = socialExplorerSlice(socialExplorerSnapshot);
    const blockMigration = blockMigrationSlice(blockMigrationSnapshot);
    const migrationSnapshot = migrationSnapshotSlice(migrationSnapshotOwner);
    const arenaGames = arenaGamesSlice(arenaGamesSnapshot);
    const assetToken = assetTokenSlice(assetTokenSnapshot);
    const t402 = t402Slice(t402Snapshot);
    const neuralMesh = neuralMeshSlice(neuralMeshSnapshot);
    const pictureMatter = pictureMatterSlice(pictureMatterSnapshot);
    const ledgerProof = ledgerProofSlice(ledgerProofSnapshot);
    const multiSportEvents = multiSportEventsSlice(multiSportEventsSnapshot);
    const blockWorldSnapshotConsoleSlice = blockWorldSnapshotSlice(blockWorldSnapshotConsole);
    const runtimeSync = runtimeSyncSlice(runtimeSyncOwner);
    const populationContext = populationContextSlice(populationContextOwner);
    const launchReceipt = launchReceiptSlice(launchReceiptOwner);
    const distributionExplorer = distributionExplorerSlice(distributionExplorerOwner);
    const intentTimeline = intentTimelineSlice(intentTimelineOwner);
    const activeFeature = featureSlice(featureSnapshot, featureDefinition);
    activeFeature.navigatorOpen = activeFeature.open;
    activeFeature.surfaceOpen = surfaceIsOpen(
      activeFeature.id,
      cube,
      sports,
      contracts,
      person,
      worldEvents,
      rooms,
      deviceProjection,
      gesture,
      assetMarket,
      launchDistribution,
      launchKit,
      liveGateway,
      protocolEvidence,
      socialExplorer,
      blockMigration,
      migrationSnapshot,
      arenaGames,
      assetToken,
      t402,
      neuralMesh,
      pictureMatter,
      ledgerProof,
      multiSportEvents,
      blockWorldSnapshotConsoleSlice,
      activeFeature.open,
    );
    const canonicalProjection = projectionIdentity(projection, envelope, blockWorldSnapshot);
    const surfaces = mountedSurfaceSlice(surfaceSnapshots);
    const snapshot = {
      schemaVersion: PROJECTION_SESSION_SCHEMA_VERSION,
      source: PROJECTION_SESSION_SOURCE,
      stateModel: "one-composed-read-only-projection-session",
      canonicalProjection,
      // `projection` is an explicit alias for callers that treat the
      // canonical identity as the session's primary state envelope.
      projection: canonicalProjection,
      activeFeature,
      cube,
      sports,
      contracts,
      person,
      worldEvents,
      rooms,
      deviceProjection,
      gesture,
      assetMarket,
      launchDistribution,
      launchKit,
      liveGateway,
      protocolEvidence,
      socialExplorer,
      blockMigration,
      migrationSnapshot,
      arenaGames,
      assetToken,
      t402,
      neuralMesh,
      pictureMatter,
      ledgerProof,
      multiSportEvents,
      blockWorldSnapshot: blockWorldSnapshotConsoleSlice,
      runtimeSync,
      populationContext,
      launchReceipt,
      distributionExplorer,
      intentTimeline,
      // All mounted feature consoles are represented as parallel facets of
      // this same read-only session. Missing optional consoles are explicit
      // and never replaced with fabricated records.
      surfaces,
      surfaceSummary: mountedSurfaceSummary(surfaces, activeFeature.id),
      // Stable top-level aliases help small host integrations without making
      // them reach into the renderer-specific slices.
      selectedSportsRecord: sports.selectedRecord,
      localContractsDraft: contracts.localDraft,
      selectedContractId: contracts.selectedContractId,
      selectedPoolId: contracts.selectedPoolId,
      selectedPersonId: person.selectedId,
      selectedWorldEvent: worldEvents.selectedRecord,
      enteredRoomId: rooms.enteredRoomId,
      selectedDeviceProfileId: deviceProjection.selectedId,
      gestureCapability: gesture,
      selectedAssetMarketRecord: assetMarket.selectedRecord,
      selectedLaunchCohortId: launchDistribution.selectedId,
      selectedLaunchKitRouteId: launchKit.selectedRouteId,
      selectedLiveGatewayRecordId: liveGateway.selectedId,
      selectedProtocolEvidenceId: protocolEvidence.selectedId,
      selectedSocialExplorerId: socialExplorer.selectedId,
      selectedMigrationId: blockMigration.selectedId,
      selectedMigrationSnapshotMappingId: migrationSnapshot.selectedId,
      selectedArenaModeId: arenaGames.selectedModeId,
      selectedAssetTokenId: assetToken.selectedId,
      selectedT402RecordId: t402.selectedId,
      selectedNeuralMeshId: neuralMesh.selectedId,
      selectedPictureMatterId: pictureMatter.selectedId,
      selectedLedgerProofId: ledgerProof.selectedId,
      selectedMultiSportEventId: multiSportEvents.selectedId,
      selectedBlockWorldSnapshotId: blockWorldSnapshotConsoleSlice.selectedId,
      selectedRuntimeWorldId: runtimeSync.worldId,
      selectedPopulationContextId: populationContext.selectedId,
      selectedLaunchReceiptId: launchReceipt.selectedId,
      selectedDistributionAllocationId: distributionExplorer.selectedId,
      selectedIntentTimelineId: intentTimeline.selectedId,
      route: read(getRoute),
      observedAt: new Date().toISOString(),
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
      boundary: PROJECTION_SESSION_BOUNDARY,
    };
    return cloneAndFreeze(snapshot);
  }

  function notify(reason = "manual") {
    const snapshot = getSnapshot();
    const detail = cloneAndFreeze({ reason, snapshot });
    listeners.forEach((listener) => {
      try { listener(snapshot, reason); } catch { /* observers are isolated */ }
    });
    if (eventTarget?.dispatchEvent && typeof globalThis.CustomEvent === "function") {
      try {
        eventTarget.dispatchEvent(new globalThis.CustomEvent(PROJECTION_SESSION_EVENT, { detail }));
      } catch { /* static/fallback hosts may not construct CustomEvent */ }
    }
    return snapshot;
  }

  const eventHandlers = new Map();
  if (observeEvents && eventTarget?.addEventListener) {
    observedEvents.forEach((eventName) => {
      const handler = () => notify(eventName);
      eventHandlers.set(eventName, handler);
      eventTarget.addEventListener(eventName, handler);
    });
  }

  function subscribe(listener) {
    if (typeof listener !== "function") return () => {};
    listeners.add(listener);
    try { listener(getSnapshot(), "subscribe"); } catch { /* observer isolation */ }
    return () => listeners.delete(listener);
  }

  return Object.freeze({
    getSnapshot,
    read: getSnapshot,
    notify,
    refresh: () => notify("refresh"),
    subscribe,
    destroy: () => {
      eventHandlers.forEach((handler, eventName) => eventTarget?.removeEventListener?.(eventName, handler));
      eventHandlers.clear();
      listeners.clear();
    },
    source: PROJECTION_SESSION_SOURCE,
    boundary: PROJECTION_SESSION_BOUNDARY,
  });
}

export default createProjectionSession;
