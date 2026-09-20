import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PROJECTION_SESSION_BOUNDARY,
  PROJECTION_SESSION_EVENT,
  PROJECTION_SESSION_SOURCE,
  createProjectionSession,
} from "../src/render/projection-session.js";

function fixtureState() {
  return {
    projection: {
      schemaVersion: 1,
      source: "simfabric.world-state",
      kind: "simfabric.world-state",
      simulation: true,
      updatedAt: "2026-08-30T00:00:00.000Z",
      worldId: "block-world:demo",
      sources: ["tumbo-asset-token", "contracts-markets"],
      entities: [{ id: "entity:demo" }],
      evidence: [{ id: "evidence:demo" }],
      capabilities: [{ id: "capability:observe" }],
    },
    envelope: {
      schemaVersion: 1,
      kind: "simfabric.projection-envelope",
      projectedAt: "2026-08-30T00:00:00.000Z",
      simulation: true,
      authority: "none",
    },
    feature: { activeId: "contracts", open: true, featureCount: 22 },
    featureDefinition: {
      id: "contracts",
      label: "Contracts + Pools",
      kicker: "markets",
      description: "Inspect the local graph.",
      boundary: "Local only.",
    },
    cube: {
      source: "block-world",
      worldId: "block-world:demo",
      selectedId: "cube:selected",
      hoveredId: "cube:hovered",
      opened: true,
      holding: true,
      heldCoordinate: [2, 0, 1],
      heldBlock: { id: "cube:held", label: "Held Cube", coordinate: [2, 0, 1] },
      draft: {
        worldId: "block-world:demo",
        localDraft: true,
        editCount: 2,
        blocks: [
          { id: "cube:selected", label: "Selected Cube", open: true },
          { id: "cube:hovered", label: "Hovered Cube", open: false },
        ],
      },
      semanticDepth: {
        mode: "4d",
        axes: [{ blockId: "cube:selected", nestedContentDepth: 1, linkedNeighborDegree: 2 }],
      },
      directManipulation: null,
      lastNavigation: { action: "linked-next", targetBlockId: "cube:hovered" },
    },
    sports: {
      source: "sports-events-console",
      opened: false,
      loading: false,
      selectedId: "sports:match-1",
      selectedRecord: {
        id: "sports:match-1",
        title: "Public Tennis Record",
        provider: "ESPN",
        sourceUrl: "https://www.espn.com/tennis/",
      },
      summary: { recordCount: 1, records: [{ id: "sports:match-1" }], liveFetch: true },
      liveFetch: true,
    },
    contracts: {
      source: "contracts-markets-console",
      opened: true,
      selectedId: "contract:demo",
      selectedRecord: { id: "contract:demo", kind: "contract-scenario", label: "Local Contract", unsafeTerms: "must-not-leak" },
      summary: { recordCount: 2, records: [{ id: "contract:demo" }, { id: "pool:demo" }] },
      localDraft: {
        id: "draft:demo",
        contract: { id: "contract:draft", state: "proposed", terms: "must-not-leak" },
        pool: { id: "pool:draft", state: "proposed" },
      },
      graph: { nodeCount: 3, edgeCount: 2, readouts: [{ id: "must-not-leak" }] },
    },
    person: {
      source: "person-organisms",
      opened: false,
      selectedId: "profile:mira-vale",
      lensMode: "detail",
      profileCount: 4,
      fictional: true,
      localOnly: true,
      simulation: true,
    },
    worldEvents: {
      source: "world-events-console",
      opened: false,
      projected: true,
      loading: false,
      selectedId: "world:returned-1",
      selectedRecord: {
        id: "world:returned-1",
        title: "Returned public observation",
        provider: "Public source",
      },
      returnedRecordCount: 1,
      visibleRecordCount: 1,
      liveFetch: true,
      localOnly: true,
      simulation: true,
      summary: {
        status: "ready",
        recordCount: 1,
        records: [{ id: "world:returned-1" }],
        sources: [{ provider: "Public source", available: true, recordCount: 1 }],
      },
    },
    rooms: {
      source: "spatial-rooms",
      opened: true,
      selectedId: "room:reality",
      enteredRoomId: "room:reality",
      hoveredRoomId: "room:market",
      roomCount: 2,
      membershipCount: 2,
      replayCount: 1,
      message: { contentRetained: false, cryptographyImplemented: false },
      localOnly: true,
      simulation: true,
    },
    deviceProjection: {
      source: "device-projection-console",
      opened: true,
      selectedId: "xr",
      selectedDevice: { id: "xr", status: "fallback-only", mode: "not-tested", xr: false },
      localOnly: true,
      simulation: true,
      sharedState: false,
      xrSession: false,
      parityClaim: false,
      summary: {
        devices: [
          { id: "phone", status: "fallback-ready", mode: "compact", xr: false },
          { id: "pc", status: "fallback-ready", mode: "expanded", xr: false },
          { id: "xr", status: "fallback-only", mode: "not-tested", xr: false },
        ],
        xr: { status: "not-tested" },
      },
    },
    gesture: {
      source: "gesture-input",
      status: "active",
      active: true,
      opened: true,
      mode: "native-hand",
      samples: 2,
      gesture: "pinch",
      capabilities: { touchPointer: "available", orientation: "unavailable", gaze: "active", nativeHand: "active", handTracking: "unavailable" },
      calibration: { status: "complete", inputSource: "native-hand", gesture: "pinch", sampleCount: 1 },
      pose: { x: 0.25, y: -0.25 },
      localOnly: true,
      simulation: true,
    },
    gazeHand: {
      source: "gaze-hand-coupling",
      lockActive: true,
      targetBlockId: "block:hidden-from-session",
      targetCoordinate: [1, 2, 3],
      normalized: { x: 0.25, y: -0.25 },
      lastAction: "gaze-lock",
      reason: "fresh-gaze",
      expiresAt: 1800,
      localOnly: true,
      simulation: true,
    },
    assetMarket: {
      source: "asset-market-evidence-console",
      opened: true,
      loading: false,
      selectedId: "coingecko:bitcoin",
      selectedRecord: {
        id: "coingecko:bitcoin", assetId: "bitcoin", symbol: "BTC", sourceUrl: "https://www.coingecko.com/en/coins/bitcoin", dataCompletenessGrade: "complete", currentPrice: 999999,
      },
      liveFetch: true,
      localOnly: true,
      simulation: true,
      nativeAsset: { id: "tumbo-sim", symbol: "TUMBO-SIM", listingStatus: "unlisted", listed: false, marketDataAvailable: false, priceStatus: "not-provided", marketStatus: "not-a-market-instrument" },
      summary: {
        status: "ready", recordCount: 1, records: [{ id: "coingecko:bitcoin" }],
        sources: [{ provider: "CoinGecko", available: true, recordCount: 1 }],
      },
    },
    launchDistribution: {
      source: "tumbo-distribution-registry",
      opened: true,
      selectedId: "cohort:county:demo",
      selectedCohort: { id: "cohort:county:demo", recipientClass: "county-community", aggregate: true, fictional: true, recipientAddress: "must-not-leak" },
      coverageLens: "county-community",
      rowCount: 18,
      visibleRowCount: 4,
      allocationClasses: [{ id: "county" }, { id: "operations" }],
      totalBasisPoints: 10000,
      expectedBasisPoints: 10000,
      totalUnits: 1000000000,
      expectedUnits: 1000000000,
      rehearsalCount: 1,
      lastRehearsal: { status: "reconciled", registryComplete: true, registryEntryCount: 18, completeClassCount: 8, recipientAddress: "must-not-leak" },
      journeyStep: "rehearse",
      localOnly: true,
      deterministic: true,
    },
    distributionExplorer: {
      source: "distribution-explorer-console",
      selectedAllocationId: "allocation:county-demo",
      allocationCount: 8,
      unit: "TUMBO-SIM",
      totalSupply: 1000000000,
      deterministic: true,
      localOnly: true,
      selectedAllocation: { recipient: "must-not-leak", amount: 999 },
      allocations: [{ recipient: "must-not-leak" }],
      launchState: { status: "previewed" },
      hoveredAllocation: { recipient: "must-not-leak" },
    },
    intentTimeline: { source: "intent-timeline", opened: true, count: 5, sequence: 9, clearCount: 1, replayCount: 2, lastReplay: { text: "must-not-leak" }, bound: true, projectionSchemaVersion: 3, localOnly: true, simulation: true, entries: [{ text: "must-not-leak", actor: "must-not-leak" }] },
    launchKit: {
      source: "launch-kit-console",
      opened: true,
      selectedRouteId: "runtime-sync",
      copyStatus: "copied",
      replayCount: 1,
      lastReplay: { action: "replay" },
      lastDownload: { status: "downloaded", validated: true, bytes: 245 },
      localOnly: true,
      simulation: true,
      localLaunchRoute: "https://must-not-leak.example/",
      kit: { unsafePayload: "must-not-leak" },
      summary: { featureCount: 22, allocationCount: 8, registryCount: 18, migrationCount: 6, socialActionCount: 4 },
    },
    launchReceipt: {
      source: "launch-receipt-console",
      opened: true,
      selectedId: "cohort:county:demo",
      localOnly: true,
      simulation: true,
      receipt: { cohortCount: 8, allocationTotals: { exact: true }, cohorts: [{ recipient: "must-not-leak" }] },
      replayCount: 2,
      lastReplay: { trace: "must-not-leak" },
      lastDownload: { status: "downloaded", bytes: 999, fileName: "must-not-leak" },
      serializedReceipt: "must-not-leak",
    },
    liveGateway: {
      source: "live-gateway-console",
      opened: true,
      selectedType: "evidence",
      selectedId: "gateway:record-1",
      selectedRecord: { id: "gateway:record-1", sourceUrl: "https://must-not-leak.example/" },
      publicRefreshBatchActive: false,
      publicRefreshAutoEnabled: false,
      publicRefreshAutoTickCount: 0,
      localOnly: true,
      simulation: true,
      summary: { evidenceCount: 1, interpretationCount: 1, recordCount: 2, capabilityCount: 3 },
      publicSourceStatus: { status: "partial", surfaceCount: 7, providerCount: 8, readyCount: 5, partialCount: 1, unavailableCount: 1, staleCount: 1 },
    },
    protocolEvidence: {
      source: "protocol-evidence-console",
      opened: true,
      loading: false,
      selectedId: "protocol:aave",
      refreshCount: 2,
      localOnly: true,
      simulation: true,
      summary: {
        status: "partial", provider: "DeFiLlama public API", metric: "current protocol TVL", unit: "USD",
        recordCount: 4, availableCount: 3, unavailableCount: 1, providerCount: 4,
        providerAvailable: true, providerUnavailable: false,
        records: [{ id: "protocol:aave", currentTvl: 999999, sourceUrl: "https://must-not-leak.example/" }],
        sources: [{ provider: "DeFiLlama public API", sourceUrl: "https://must-not-leak.example/" }],
      },
    },
    socialExplorer: {
      source: "social-explorer-console",
      opened: true,
      selectedKind: "room",
      selectedId: "social-room:allocation-atlas",
      roomCount: 3,
      creatorCardCount: 2,
      discoverySignalCount: 4,
      actionCount: 5,
      replayCount: 1,
      localOnly: true,
      deterministic: true,
      simulation: true,
      publicPulseRefreshing: false,
      publicPulse: {
        source: "public-social-pulse-bluesky", provider: "Bluesky public AppView", status: "ready",
        returnedCount: 2, requestedLimit: 8, providerAvailable: true, publicSource: true,
        untrusted: true, metadataOnly: true,
        actor: "must-not-leak.example", requestUrl: "https://must-not-leak.example/",
        records: [{ id: "bluesky:post:hidden", text: "must-not-leak", sourceUrl: "https://must-not-leak.example/" }],
      },
    },
    blockMigration: {
      source: "block-migration-console",
      opened: true,
      selectedId: "migration:world-contracts",
      localOnly: true,
      simulation: true,
      manifest: {
        id: "migration:arena-living-reality-v1", deterministic: true,
        entries: [{ id: "migration:world-contracts", coordinate: [6, 0, 4] }],
        counts: { mapped: 4, preserved: 1, deferred: 1 },
      },
      preview: { mappingCount: 6, applyCount: 5, counts: { mapped: 4, preserved: 1, deferred: 1 }, mappings: [{ mappingId: "migration:world-contracts", coordinate: [6, 0, 4] }] },
      draft: { draft: { mappingIds: ["migration:world-contracts"], unsafePayload: "must-not-leak" } },
      trace: [{ action: "apply-local-draft" }],
    },
    migrationSnapshot: {
      source: "migration-snapshot-console",
      opened: true,
      selectedId: "migration:world-contracts",
      replayCount: 1,
      localOnly: true,
      simulation: true,
      activeInput: { entries: [{ id: "must-not-leak" }] },
      validation: {
        valid: true, mappingCount: 2, safeCount: 1, deferredCount: 1,
        errors: [], warnings: [{ message: "ignored metadata" }],
        snapshot: { entries: [{ id: "must-not-leak" }] },
      },
      preview: { applyCount: 1, mappings: [{ mappingId: "migration:world-contracts", coordinate: [6, 0, 4] }] },
      draft: { draft: { mappingIds: ["migration:world-contracts"], unsafePayload: "must-not-leak" } },
      trace: [{ action: "replay" }],
      lastFileImport: { fileName: "must-not-leak.json" },
    },
    arenaGames: {
      source: "arena-games-console",
      opened: true,
      modeId: "nebula-rally",
      localOnly: true,
      simulation: true,
      summary: { modeCount: 3, deterministic: true, modes: [{ id: "nebula-rally" }], sessions: [{ id: "arena-session:nebula-rally" }] },
      state: {
        status: "running", turn: 2, rejectedActionCount: 1, hashChainValid: true,
        events: [{ actionId: "boost", hash: "must-not-leak" }], values: { hidden: "must-not-leak" },
        legalActions: [{ id: "boost" }], headHash: "must-not-leak",
      },
      trace: [{ actionId: "boost", hash: "must-not-leak" }],
    },
    assetToken: {
      source: "paycore-console", opened: true, selectedType: "flow", selectedId: "flow:preview-1",
      localOnly: true, simulation: true, trace: [{ recordId: "must-not-leak" }],
      selectedRecord: { id: "flow:preview-1", amount: 999, fromBalanceId: "must-not-leak" },
      summary: { balanceCount: 2, flowCount: 1, recordCount: 3, evidenceCount: 1, capabilityCount: 3 },
    },
    t402: { source: "t402-console", opened: true, selectedId: "t402:route-1", localOnly: true, simulation: true, trace: [{}], selectedRecord: { amount: 999 }, summary: { recordCount: 3, evidenceCount: 1, capabilityCount: 2 } },
    neuralMesh: { source: "neural-mesh-console", opened: true, selectedType: "agent", selectedId: "agent:control", localOnly: true, simulation: true, trace: [{}], selectedRecord: { identity: "must-not-leak" }, summary: { recordCount: 5, agents: [{}], intents: [{}], proposals: [{}], relationships: [{}], evidenceCount: 1 } },
    pictureMatter: { source: "picture-matter-console", opened: true, selectedType: "input", selectedId: "image:local-1", localOnly: true, simulation: true, selectedRecord: { sourceUrl: "https://must-not-leak", thumbnailUrl: "https://must-not-leak", imageBytes: "must-not-leak" }, metadataRefreshing: false, summary: { wordCount: 2, localImageCount: 1, statementCount: 3, provenanceCount: 2, evidenceCount: 1 }, metadata: { status: "ready", returnedCount: 1, requestedLimit: 4, providerAvailable: true, metadataOnly: true, records: [{ sourceUrl: "https://must-not-leak", thumbnailUrl: "https://must-not-leak" }] } },
    ledgerProof: { source: "ledger-proof-console", opened: true, selectedType: "proof", selectedId: "proof:1", localOnly: true, simulation: true, selectedRecord: { hash: "must-not-leak", signature: "must-not-leak", sourceUrl: "https://must-not-leak" }, trace: [{ receipt: "must-not-leak" }], summary: { ledgerCount: 2, proofCount: 3, balancedCount: 2, ancestryEdgeCount: 4, recordCount: 5, evidenceCount: 1, capabilityCount: 2 } },
    multiSportEvents: { source: "multi-sport-events-console", opened: true, selectedId: "nba:1", localOnly: true, simulation: true, liveFetch: true, selectedRecord: { player: "must-not-leak", sourceUrl: "https://must-not-leak" }, summary: { status: "partial", recordCount: 2, providerCount: 3, availableProviderCount: 2, liveFetch: true, sources: [{ provider: "ESPN", available: true, recordCount: 2, sourceUrl: "https://must-not-leak" }] } },
    populationContext: { source: "population-context", selectedId: "population:demo", selectedRecord: { name: "must-not-leak", coordinates: [1, 2] }, summary: { status: "ready", provider: "World Bank", recordCount: 3, availableCount: 3, providerAvailable: true, providerUnavailable: false, liveFetch: true, metadataOnly: true }, rows: [{ url: "https://must-not-leak", coordinates: [1, 2], personalData: "must-not-leak" }] },
    blockWorldRuntimeSync: { source: "block-world-runtime-sync-console", opened: true, worldId: "block-world:demo", status: "connected", connectionState: "ready", serverVersion: "v1", remoteVersion: "v1", requiresReload: false, busy: false, reconnectAttempts: 2, reconnectTimerActive: false, socketOpen: true, localOnly: true, simulation: true, validation: { valid: true, errors: [] }, endpoint: "https://must-not-leak", remoteUpdate: { blocks: [{ coordinate: [9, 9, 9] }] }, trace: [{ secret: "must-not-leak" }] },
    route: "http://localhost:8080/?feature=contracts",
  };
}

function createFixtureSession(state = fixtureState(), options = {}) {
  return createProjectionSession({
    getProjection: () => state.projection,
    getProjectionEnvelope: () => state.envelope,
    getActiveFeature: () => state.feature,
    getFeatureDefinition: () => state.featureDefinition,
    getBlockWorldSnapshot: () => state.cube,
    getSportsSnapshot: () => state.sports,
    getContractsSnapshot: () => state.contracts,
    getPersonSnapshot: () => state.person,
    getWorldEventsSnapshot: () => state.worldEvents,
    getRoomsSnapshot: () => state.rooms,
    getDeviceProjectionSnapshot: () => state.deviceProjection,
    getGestureSnapshot: () => state.gesture,
    getGazeHandSnapshot: () => state.gazeHand,
    getAssetMarketSnapshot: () => state.assetMarket,
    getLaunchDistributionSnapshot: () => state.launchDistribution,
    getDistributionExplorerSnapshot: () => state.distributionExplorer,
    getIntentTimelineSnapshot: () => state.intentTimeline,
    getLaunchKitSnapshot: () => state.launchKit,
    getLaunchReceiptSnapshot: () => state.launchReceipt,
    getLiveGatewaySnapshot: () => state.liveGateway,
    getProtocolEvidenceSnapshot: () => state.protocolEvidence,
    getSocialExplorerSnapshot: () => state.socialExplorer,
    getBlockMigrationSnapshot: () => state.blockMigration,
    getMigrationSnapshot: () => state.migrationSnapshot,
    getArenaGamesSnapshot: () => state.arenaGames,
    getAssetTokenSnapshot: () => state.assetToken,
    getT402Snapshot: () => state.t402,
    getNeuralMeshSnapshot: () => state.neuralMesh,
    getPictureMatterSnapshot: () => state.pictureMatter,
    getLedgerProofSnapshot: () => state.ledgerProof,
    getMultiSportEventsSnapshot: () => state.multiSportEvents,
    getPopulationContextSnapshot: () => state.populationContext,
    getBlockWorldRuntimeSyncSnapshot: () => state.blockWorldRuntimeSync,
    getSurfaceSnapshots: () => state.surfaces ?? {},
    getRoute: () => state.route,
    ...options,
  });
}

test("projection session composes canonical identity and simultaneous owner slices", () => {
  const state = fixtureState();
  state.surfaces = {
    rooms: { opened: true, localOnly: true, simulation: true },
    "sports-events": state.sports,
    contracts: state.contracts,
    gateway: { opened: false, loading: true, status: "FETCHING PUBLIC SOURCES" },
    "asset-market": {
      source: "asset-market-evidence-console",
      opened: false,
      summary: {
        status: "partial",
        recordCount: 1,
        providerAvailable: true,
        providerUnavailable: false,
        reason: "Provider response omitted: ethereum.",
      },
      liveFetch: true,
      externalSource: true,
      localOnly: true,
      simulation: true,
    },
    "missing-optional": null,
  };
  const session = createFixtureSession(state);
  const snapshot = session.getSnapshot();

  assert.equal(snapshot.source, PROJECTION_SESSION_SOURCE);
  assert.equal(snapshot.stateModel, "one-composed-read-only-projection-session");
  assert.equal(snapshot.canonicalProjection.worldId, "block-world:demo");
  assert.equal(snapshot.canonicalProjection.entityCount, 1);
  assert.equal(snapshot.canonicalProjection.evidenceCount, 1);
  assert.deepEqual(snapshot.canonicalProjection.sources, ["tumbo-asset-token", "contracts-markets"]);
  assert.equal(snapshot.activeFeature.id, "contracts");
  assert.equal(snapshot.activeFeature.label, "Contracts + Pools");
  assert.equal(snapshot.activeFeature.navigatorOpen, true);
  assert.equal(snapshot.activeFeature.surfaceOpen, true);
  assert.equal(snapshot.cube.selectedId, "cube:selected");
  assert.equal(snapshot.cube.hoveredId, "cube:hovered");
  assert.equal(snapshot.cube.heldId, "cube:held");
  assert.equal(snapshot.cube.fieldOpen, true);
  assert.equal(snapshot.cube.selectedCubeOpen, true);
  assert.equal(snapshot.cube.semanticDepth.mode, "4d");
  assert.equal(snapshot.sports.selectedRecord.id, "sports:match-1");
  assert.equal(snapshot.contracts.localDraft.id, "draft:demo");
  assert.equal(snapshot.contracts.selectedContractId, "contract:demo");
  assert.equal(snapshot.contracts.selectedPoolId, null);
  assert.equal(snapshot.contracts.graph.nodeCount, 3);
  assert.equal(snapshot.contracts.betting, false);
  assert.equal(snapshot.contracts.authority, "none");
  assert.equal(Object.hasOwn(snapshot.contracts.selectedRecord, "unsafeTerms"), false);
  assert.equal(snapshot.selectedSportsRecord.id, "sports:match-1");
  assert.equal(snapshot.localContractsDraft.id, "draft:demo");
  assert.equal(snapshot.selectedContractId, "contract:demo");
  assert.equal(snapshot.selectedPoolId, null);
  assert.equal(snapshot.person.source, "person-organisms");
  assert.equal(snapshot.person.opened, false);
  assert.equal(snapshot.person.selectedId, "profile:mira-vale");
  assert.equal(snapshot.person.lensMode, "detail");
  assert.equal(snapshot.person.profileCount, 4);
  assert.equal(snapshot.person.fictional, true);
  assert.equal(snapshot.person.localOnly, true);
  assert.equal(snapshot.selectedPersonId, "profile:mira-vale");
  assert.equal(snapshot.worldEvents.projected, true);
  assert.equal(snapshot.worldEvents.selectedId, "world:returned-1");
  assert.equal(snapshot.worldEvents.returnedRecordCount, 1);
  assert.equal(snapshot.worldEvents.sourceAvailability[0].available, true);
  assert.equal(snapshot.selectedWorldEvent.id, "world:returned-1");
  assert.equal(snapshot.rooms.opened, true);
  assert.equal(snapshot.rooms.enteredRoomId, "room:reality");
  assert.equal(snapshot.rooms.roomCount, 2);
  assert.equal(snapshot.rooms.messageContentRetained, false);
  assert.equal(snapshot.rooms.cryptographyImplemented, false);
  assert.equal(snapshot.enteredRoomId, "room:reality");
  assert.equal(snapshot.deviceProjection.selectedId, "xr");
  assert.equal(snapshot.deviceProjection.selectedDevice.status, "fallback-only");
  assert.equal(snapshot.deviceProjection.deviceCount, 3);
  assert.equal(snapshot.deviceProjection.xrStatus, "not-tested");
  assert.equal(snapshot.deviceProjection.xrSession, false);
  assert.equal(snapshot.selectedDeviceProfileId, "xr");
  assert.equal(snapshot.gesture.active, true);
  assert.equal(snapshot.gesture.lastGesture, "pinch");
  assert.equal(snapshot.gesture.capabilities.nativeHand, "active");
  assert.equal(snapshot.gesture.calibration.status, "complete");
  assert.equal(snapshot.gesture.coupling.lockActive, true);
  assert.equal(Object.hasOwn(snapshot.gesture, "pose"), false);
  assert.equal(Object.hasOwn(snapshot.gesture.coupling, "targetBlockId"), false);
  assert.equal(snapshot.gestureCapability, snapshot.gesture);
  assert.equal(snapshot.assetMarket.selectedId, "coingecko:bitcoin");
  assert.equal(snapshot.assetMarket.selectedRecord.assetId, "bitcoin");
  assert.equal(Object.hasOwn(snapshot.assetMarket.selectedRecord, "currentPrice"), false);
  assert.equal(snapshot.assetMarket.nativeAsset.listingStatus, "unlisted");
  assert.equal(snapshot.assetMarket.nativeAsset.marketDataAvailable, false);
  assert.equal(snapshot.assetMarket.trading, false);
  assert.equal(snapshot.selectedAssetMarketRecord.id, "coingecko:bitcoin");
  assert.equal(snapshot.launchDistribution.selectedId, "cohort:county:demo");
  assert.equal(snapshot.launchDistribution.selectedCohort.recipientClass, "county-community");
  assert.equal(Object.hasOwn(snapshot.launchDistribution.selectedCohort, "recipientAddress"), false);
  assert.equal(snapshot.launchDistribution.rowCount, 18);
  assert.equal(snapshot.launchDistribution.reconciliation.basisPointsComplete, true);
  assert.equal(snapshot.launchDistribution.rehearsal.registryComplete, true);
  assert.equal(snapshot.launchDistribution.externalTransfer, false);
  assert.equal(snapshot.selectedLaunchCohortId, "cohort:county:demo");
  assert.equal(snapshot.distributionExplorer.selectedId, "allocation:county-demo");
  assert.equal(snapshot.distributionExplorer.allocationCount, 8);
  assert.equal(snapshot.distributionExplorer.unit, "TUMBO-SIM");
  assert.equal(snapshot.distributionExplorer.totalSupply, 1000000000);
  assert.equal(snapshot.distributionExplorer.launchReady, true);
  assert.equal(snapshot.distributionExplorer.issuance, false);
  assert.equal(snapshot.distributionExplorer.externalTransfer, false);
  assert.equal(snapshot.distributionExplorer.authority, "none");
  assert.equal(Object.hasOwn(snapshot.distributionExplorer, "selectedAllocation"), false);
  assert.equal(Object.hasOwn(snapshot.distributionExplorer, "allocations"), false);
  assert.equal(Object.hasOwn(snapshot.distributionExplorer, "hoveredAllocation"), false);
  assert.equal(snapshot.selectedDistributionAllocationId, "allocation:county-demo");
  assert.equal(snapshot.intentTimeline.count, 5);
  assert.equal(snapshot.intentTimeline.sequence, 9);
  assert.equal(snapshot.intentTimeline.clearCount, 1);
  assert.equal(snapshot.intentTimeline.replayCount, 2);
  assert.equal(snapshot.intentTimeline.replayed, true);
  assert.equal(snapshot.intentTimeline.bound, true);
  assert.equal(snapshot.intentTimeline.advisoryOnly, true);
  assert.equal(snapshot.intentTimeline.externalExecution, false);
  assert.equal(snapshot.intentTimeline.selectedId, null);
  assert.equal(Object.hasOwn(snapshot.intentTimeline, "entries"), false);
  assert.equal(Object.hasOwn(snapshot.intentTimeline, "lastReplay"), false);
  assert.equal(snapshot.selectedIntentTimelineId, null);
  assert.equal(snapshot.launchKit.selectedRouteId, "runtime-sync");
  assert.equal(snapshot.launchKit.featureCount, 22);
  assert.equal(snapshot.launchKit.copyStatus, "copied");
  assert.equal(snapshot.launchKit.download.validated, true);
  assert.equal(snapshot.launchKit.publication, false);
  assert.equal(Object.hasOwn(snapshot.launchKit, "localLaunchRoute"), false);
  assert.equal(Object.hasOwn(snapshot.launchKit, "kit"), false);
  assert.equal(snapshot.selectedLaunchKitRouteId, "runtime-sync");
  assert.equal(snapshot.launchReceipt.selectedId, "cohort:county:demo");
  assert.equal(snapshot.launchReceipt.cohortCount, 8);
  assert.equal(snapshot.launchReceipt.reconciliationExact, true);
  assert.equal(snapshot.launchReceipt.replayCount, 2);
  assert.equal(snapshot.launchReceipt.replayed, true);
  assert.equal(snapshot.launchReceipt.downloaded, true);
  assert.equal(snapshot.launchReceipt.publication, false);
  assert.equal(snapshot.launchReceipt.distributionExecution, false);
  assert.equal(snapshot.launchReceipt.wallet, false);
  assert.equal(snapshot.launchReceipt.authority, "none");
  assert.equal(Object.hasOwn(snapshot.launchReceipt, "receipt"), false);
  assert.equal(Object.hasOwn(snapshot.launchReceipt, "serializedReceipt"), false);
  assert.equal(snapshot.selectedLaunchReceiptId, "cohort:county:demo");
  assert.equal(snapshot.liveGateway.selectedId, "gateway:record-1");
  assert.equal(snapshot.liveGateway.recordCount, 2);
  assert.equal(snapshot.liveGateway.publicStatus.surfaceCount, 7);
  assert.equal(snapshot.liveGateway.publicStatus.unavailableCount, 1);
  assert.equal(Object.hasOwn(snapshot.liveGateway, "selectedRecord"), false);
  assert.equal(snapshot.liveGateway.authority, "none");
  assert.equal(snapshot.selectedLiveGatewayRecordId, "gateway:record-1");
  assert.equal(snapshot.protocolEvidence.selectedId, "protocol:aave");
  assert.equal(snapshot.protocolEvidence.status, "partial");
  assert.equal(snapshot.protocolEvidence.recordCount, 4);
  assert.equal(snapshot.protocolEvidence.availableCount, 3);
  assert.equal(snapshot.protocolEvidence.provider, "DeFiLlama public API");
  assert.equal(snapshot.protocolEvidence.truthClaim, false);
  assert.equal(snapshot.protocolEvidence.authority, "none");
  assert.equal(Object.hasOwn(snapshot.protocolEvidence, "records"), false);
  assert.equal(Object.hasOwn(snapshot.protocolEvidence, "sources"), false);
  assert.equal(snapshot.selectedProtocolEvidenceId, "protocol:aave");
  assert.equal(snapshot.socialExplorer.selectedId, "social-room:allocation-atlas");
  assert.equal(snapshot.socialExplorer.roomCount, 3);
  assert.equal(snapshot.socialExplorer.publicPulse.status, "ready");
  assert.equal(snapshot.socialExplorer.publicPulse.returnedCount, 2);
  assert.equal(snapshot.socialExplorer.publicPulse.untrusted, true);
  assert.equal(Object.hasOwn(snapshot.socialExplorer.publicPulse, "records"), false);
  assert.equal(Object.hasOwn(snapshot.socialExplorer.publicPulse, "actor"), false);
  assert.equal(snapshot.socialExplorer.publication, false);
  assert.equal(snapshot.socialExplorer.crossUserState, false);
  assert.equal(snapshot.selectedSocialExplorerId, "social-room:allocation-atlas");
  assert.equal(snapshot.blockMigration.selectedId, "migration:world-contracts");
  assert.equal(snapshot.blockMigration.mappingCount, 1);
  assert.equal(snapshot.blockMigration.statusCounts.deferred, 1);
  assert.equal(snapshot.blockMigration.preview.safeCount, 5);
  assert.equal(snapshot.blockMigration.localDraftActive, true);
  assert.equal(snapshot.blockMigration.localDraftMappingCount, 1);
  assert.equal(snapshot.blockMigration.applyOnRead, false);
  assert.equal(snapshot.blockMigration.authority, "none");
  assert.equal(Object.hasOwn(snapshot.blockMigration, "draft"), false);
  assert.equal(Object.hasOwn(snapshot.blockMigration.preview, "mappings"), false);
  assert.equal(snapshot.selectedMigrationId, "migration:world-contracts");
  assert.equal(snapshot.migrationSnapshot.selectedId, "migration:world-contracts");
  assert.equal(snapshot.migrationSnapshot.valid, true);
  assert.equal(snapshot.migrationSnapshot.mappingCount, 2);
  assert.equal(snapshot.migrationSnapshot.safeCount, 1);
  assert.equal(snapshot.migrationSnapshot.warningCount, 1);
  assert.equal(snapshot.migrationSnapshot.previewApplyCount, 1);
  assert.equal(snapshot.migrationSnapshot.localDraftMappingCount, 1);
  assert.equal(snapshot.migrationSnapshot.applyOnRead, false);
  assert.equal(Object.hasOwn(snapshot.migrationSnapshot, "activeInput"), false);
  assert.equal(Object.hasOwn(snapshot.migrationSnapshot, "trace"), false);
  assert.equal(Object.hasOwn(snapshot.migrationSnapshot, "lastFileImport"), false);
  assert.equal(snapshot.selectedMigrationSnapshotMappingId, "migration:world-contracts");
  assert.equal(snapshot.arenaGames.selectedModeId, "nebula-rally");
  assert.equal(snapshot.arenaGames.modeCount, 3);
  assert.equal(snapshot.arenaGames.status, "running");
  assert.equal(snapshot.arenaGames.eventCount, 1);
  assert.equal(snapshot.arenaGames.hashChainValid, true);
  assert.equal(snapshot.arenaGames.rewards, false);
  assert.equal(snapshot.arenaGames.authority, "none");
  assert.equal(Object.hasOwn(snapshot.arenaGames, "state"), false);
  assert.equal(snapshot.selectedArenaModeId, "nebula-rally");
  assert.equal(snapshot.assetToken.selectedId, "flow:preview-1");
  assert.equal(snapshot.assetToken.flowPreviewCount, 1);
  assert.equal(snapshot.assetToken.assetTokenTerminology, true);
  assert.equal(snapshot.assetToken.legacyCoinAliasesParserOnly, true);
  assert.equal(snapshot.assetToken.transfer, false);
  assert.equal(Object.hasOwn(snapshot.assetToken, "selectedRecord"), false);
  assert.equal(snapshot.selectedAssetTokenId, "flow:preview-1");
  assert.equal(snapshot.t402.selectedId, "t402:route-1");
  assert.equal(snapshot.t402.paymentExecution, false);
  assert.equal(Object.hasOwn(snapshot.t402, "selectedRecord"), false);
  assert.equal(snapshot.selectedT402RecordId, "t402:route-1");
  assert.equal(snapshot.neuralMesh.selectedId, "agent:control");
  assert.equal(snapshot.neuralMesh.advisoryOnly, true);
  assert.equal(snapshot.neuralMesh.biometric, false);
  assert.equal(Object.hasOwn(snapshot.neuralMesh, "selectedRecord"), false);
  assert.equal(snapshot.selectedNeuralMeshId, "agent:control");
  assert.equal(snapshot.pictureMatter.selectedId, "image:local-1");
  assert.equal(snapshot.pictureMatter.localImageCount, 1);
  assert.equal(snapshot.pictureMatter.metadata.returnedCount, 1);
  assert.equal(snapshot.pictureMatter.imageBytes, false);
  assert.equal(snapshot.pictureMatter.storage, false);
  assert.equal(snapshot.pictureMatter.publishing, false);
  assert.equal(snapshot.pictureMatter.identity, false);
  assert.equal(snapshot.pictureMatter.biometric, false);
  assert.equal(snapshot.pictureMatter.token, false);
  assert.equal(Object.hasOwn(snapshot.pictureMatter, "selectedRecord"), false);
  assert.equal(Object.hasOwn(snapshot.pictureMatter.metadata, "records"), false);
  assert.equal(snapshot.selectedPictureMatterId, "image:local-1");
  assert.equal(snapshot.ledgerProof.selectedId, "proof:1");
  assert.equal(snapshot.ledgerProof.proofCount, 3);
  assert.equal(snapshot.ledgerProof.ancestryEdgeCount, 4);
  assert.equal(snapshot.ledgerProof.evidenceOnly, true);
  assert.equal(snapshot.ledgerProof.signing, false);
  assert.equal(snapshot.ledgerProof.settlement, false);
  assert.equal(snapshot.ledgerProof.custody, false);
  assert.equal(Object.hasOwn(snapshot.ledgerProof, "selectedRecord"), false);
  assert.equal(Object.hasOwn(snapshot.ledgerProof, "trace"), false);
  assert.equal(snapshot.selectedLedgerProofId, "proof:1");
  assert.equal(snapshot.multiSportEvents.selectedId, "nba:1");
  assert.equal(snapshot.multiSportEvents.availableProviderCount, 2);
  assert.equal(snapshot.multiSportEvents.truthClaim, false);
  assert.equal(snapshot.multiSportEvents.wagering, false);
  assert.equal(Object.hasOwn(snapshot.multiSportEvents, "selectedRecord"), false);
  assert.equal(Object.hasOwn(snapshot.multiSportEvents.sourceAvailability[0], "sourceUrl"), false);
  assert.equal(snapshot.selectedMultiSportEventId, "nba:1");
  assert.equal(snapshot.populationContext.selectedId, "population:demo");
  assert.equal(snapshot.populationContext.status, "ready");
  assert.equal(snapshot.populationContext.provider, "World Bank");
  assert.equal(snapshot.populationContext.recordCount, 3);
  assert.equal(snapshot.populationContext.availableCount, 3);
  assert.equal(snapshot.populationContext.metadataOnly, true);
  assert.equal(snapshot.populationContext.truthClaim, false);
  assert.equal(snapshot.populationContext.authority, "none");
  assert.equal(Object.hasOwn(snapshot.populationContext, "rows"), false);
  assert.equal(Object.hasOwn(snapshot.populationContext, "selectedRecord"), false);
  assert.equal(snapshot.selectedPopulationContextId, "population:demo");
  assert.equal(snapshot.runtimeSync.worldId, "block-world:demo");
  assert.equal(snapshot.runtimeSync.status, "connected");
  assert.equal(snapshot.runtimeSync.connectionState, "ready");
  assert.equal(snapshot.runtimeSync.socketOpen, true);
  assert.equal(snapshot.runtimeSync.persistence, false);
  assert.equal(snapshot.runtimeSync.import, false);
  assert.equal(snapshot.runtimeSync.executable, false);
  assert.equal(Object.hasOwn(snapshot.runtimeSync, "endpoint"), false);
  assert.equal(Object.hasOwn(snapshot.runtimeSync, "remoteUpdate"), false);
  assert.equal(Object.hasOwn(snapshot.runtimeSync, "trace"), false);
  assert.equal(snapshot.selectedRuntimeWorldId, "block-world:demo");
  assert.equal(snapshot.surfaces.rooms.opened, true);
  assert.equal(snapshot.surfaces.rooms.localOnly, true);
  assert.equal(snapshot.surfaces["sports-events"].selectedId, "sports:match-1");
  assert.equal(snapshot.surfaces.gateway.loading, true);
  assert.equal(snapshot.surfaces["asset-market"].source, "asset-market-evidence-console");
  assert.equal(snapshot.surfaces["asset-market"].liveFetch, true);
  assert.equal(snapshot.surfaces["asset-market"].externalSource, true);
  assert.equal(snapshot.surfaces["asset-market"].providerAvailable, true);
  assert.equal(snapshot.surfaces["asset-market"].providerUnavailable, false);
  assert.equal(snapshot.surfaces["asset-market"].reason, "Provider response omitted: ethereum.");
  assert.equal(snapshot.surfaces["missing-optional"].mounted, false);
  assert.equal(snapshot.surfaceSummary.activeId, "contracts");
  assert.equal(snapshot.surfaceSummary.activeMounted, true);
  assert.equal(snapshot.surfaceSummary.activeOpened, true);
  assert.deepEqual(snapshot.surfaceSummary.openedIds, ["rooms", "contracts"]);
  assert.equal(snapshot.surfaceSummary.mountedCount, 5);
  assert.equal(snapshot.surfaceSummary.openedCount, 2);
  assert.equal(snapshot.route, "http://localhost:8080/?feature=contracts");
  assert.equal(snapshot.localOnly, true);
  assert.equal(snapshot.simulation, true);
  assert.equal(snapshot.externalNetwork, false);
  assert.equal(snapshot.executable, false);
  assert.match(snapshot.boundary, /read-only local projection session/i);
  assert.equal(snapshot.boundary, PROJECTION_SESSION_BOUNDARY);
});

test("projection session is deeply immutable and reads owner changes on demand", () => {
  const state = fixtureState();
  const session = createFixtureSession(state);
  const first = session.getSnapshot();
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.cube), true);
  assert.equal(Object.isFrozen(first.cube.semanticDepth), true);
  assert.equal(Object.isFrozen(first.contracts.localDraft), true);
  assert.throws(() => { first.activeFeature.id = "sports-events"; }, TypeError);
  assert.throws(() => { first.cube.semanticDepth.mode = "5d"; }, TypeError);

  // The next read reflects each owner’s current value; the session has no
  // mutable duplicate that needs to be synchronized manually.
  state.feature = { ...state.feature, activeId: "sports-events" };
  state.cube = { ...state.cube, selectedId: "cube:hovered", opened: false };
  state.sports = { ...state.sports, selectedId: null, selectedRecord: null };
  state.contracts = { ...state.contracts, selectedId: null, selectedRecord: null, localDraft: null };
  state.person = { ...state.person, selectedId: null, lensMode: "world" };
  state.worldEvents = { ...state.worldEvents, selectedId: null, selectedRecord: null, projected: false };
  state.rooms = { ...state.rooms, enteredRoomId: null, roomCount: 0 };
  state.deviceProjection = { ...state.deviceProjection, selectedId: null, selectedDevice: null, summary: { ...state.deviceProjection.summary, devices: [] } };
  state.gesture = null;
  state.gazeHand = null;
  state.assetMarket = { ...state.assetMarket, selectedId: null, selectedRecord: null, summary: { ...state.assetMarket.summary, records: [], recordCount: 0, status: "unavailable" } };
  state.launchDistribution = { ...state.launchDistribution, selectedId: null, rowCount: 0, selectedCohort: null };
  state.distributionExplorer = null;
  state.intentTimeline = null;
  state.launchKit = { ...state.launchKit, selectedRouteId: null, summary: { ...state.launchKit.summary, featureCount: 0 } };
  state.launchReceipt = null;
  state.liveGateway = { ...state.liveGateway, selectedId: null, summary: { ...state.liveGateway.summary, recordCount: 0 } };
  state.protocolEvidence = { ...state.protocolEvidence, selectedId: null, summary: { ...state.protocolEvidence.summary, recordCount: 0, availableCount: 0, unavailableCount: 0 } };
  state.socialExplorer = { ...state.socialExplorer, selectedId: null, publicPulse: { ...state.socialExplorer.publicPulse, returnedCount: 0, records: [] } };
  state.blockMigration = { ...state.blockMigration, selectedId: null, manifest: { ...state.blockMigration.manifest, entries: [] } };
  state.migrationSnapshot = { ...state.migrationSnapshot, selectedId: null, validation: { ...state.migrationSnapshot.validation, valid: false, errors: [{ code: "invalid" }] }, preview: null, draft: null };
  state.arenaGames = { ...state.arenaGames, modeId: null, state: { ...state.arenaGames.state, events: [] } };
  state.assetToken = { ...state.assetToken, selectedId: null };
  state.t402 = { ...state.t402, selectedId: null };
  state.neuralMesh = { ...state.neuralMesh, selectedId: null };
  state.pictureMatter = { ...state.pictureMatter, selectedId: null };
  state.ledgerProof = { ...state.ledgerProof, selectedId: null };
  state.multiSportEvents = { ...state.multiSportEvents, selectedId: null };
  state.blockWorldRuntimeSync = null;
  state.populationContext = null;
  state.surfaces = { rooms: { opened: false }, "sports-events": state.sports };
  const second = session.read();
  assert.equal(second.activeFeature.id, "sports-events");
  assert.equal(second.cube.selectedId, "cube:hovered");
  assert.equal(second.cube.fieldOpen, false);
  assert.equal(second.sports.selectedRecord, null);
  assert.equal(second.contracts.localDraft, null);
  assert.equal(second.selectedSportsRecord, null);
  assert.equal(second.localContractsDraft, null);
  assert.equal(second.selectedContractId, null);
  assert.equal(second.selectedPoolId, null);
  assert.equal(second.person.selectedId, null);
  assert.equal(second.person.lensMode, "world");
  assert.equal(second.person.noFabrication, true);
  assert.equal(second.selectedPersonId, null);
  assert.equal(second.worldEvents.selectedRecord, null);
  assert.equal(second.worldEvents.noFabrication, true);
  assert.equal(second.selectedWorldEvent, null);
  assert.equal(second.rooms.enteredRoomId, null);
  assert.equal(second.rooms.noFabrication, true);
  assert.equal(second.enteredRoomId, null);
  assert.equal(second.deviceProjection.selectedDevice, null);
  assert.equal(second.deviceProjection.noFabrication, true);
  assert.equal(second.selectedDeviceProfileId, null);
  assert.equal(second.gesture.active, false);
  assert.equal(second.gesture.noFabrication, true);
  assert.equal(second.gesture.coupling.lockActive, false);
  assert.equal(second.assetMarket.selectedRecord, null);
  assert.equal(second.assetMarket.noFabrication, true);
  assert.equal(second.selectedAssetMarketRecord, null);
  assert.equal(second.launchDistribution.selectedCohort, null);
  assert.equal(second.launchDistribution.noFabrication, true);
  assert.equal(second.selectedLaunchCohortId, null);
  assert.equal(second.distributionExplorer.selectedId, null);
  assert.equal(second.distributionExplorer.noFabrication, true);
  assert.equal(second.selectedDistributionAllocationId, null);
  assert.equal(second.launchKit.noFabrication, true);
  assert.equal(second.selectedLaunchKitRouteId, null);
  assert.equal(second.launchReceipt.selectedId, null);
  assert.equal(second.launchReceipt.noFabrication, true);
  assert.equal(second.selectedLaunchReceiptId, null);
  assert.equal(second.liveGateway.noFabrication, true);
  assert.equal(second.selectedLiveGatewayRecordId, null);
  assert.equal(second.protocolEvidence.noFabrication, true);
  assert.equal(second.selectedProtocolEvidenceId, null);
  assert.equal(second.socialExplorer.noFabrication, true);
  assert.equal(second.selectedSocialExplorerId, null);
  assert.equal(second.blockMigration.noFabrication, true);
  assert.equal(second.selectedMigrationId, null);
  assert.equal(second.migrationSnapshot.noFabrication, true);
  assert.equal(second.selectedMigrationSnapshotMappingId, null);
  assert.equal(second.arenaGames.noFabrication, true);
  assert.equal(second.selectedArenaModeId, null);
  assert.equal(second.assetToken.noFabrication, true);
  assert.equal(second.selectedAssetTokenId, null);
  assert.equal(second.t402.noFabrication, true);
  assert.equal(second.selectedT402RecordId, null);
  assert.equal(second.neuralMesh.noFabrication, true);
  assert.equal(second.selectedNeuralMeshId, null);
  assert.equal(second.pictureMatter.noFabrication, true);
  assert.equal(second.selectedPictureMatterId, null);
  assert.equal(second.ledgerProof.noFabrication, true);
  assert.equal(second.selectedLedgerProofId, null);
  assert.equal(second.multiSportEvents.noFabrication, true);
  assert.equal(second.selectedMultiSportEventId, null);
  assert.equal(second.runtimeSync.worldId, null);
  assert.equal(second.runtimeSync.status, "unavailable");
  assert.equal(second.runtimeSync.noFabrication, true);
  assert.equal(second.selectedRuntimeWorldId, null);
  assert.equal(second.populationContext.selectedId, null);
  assert.equal(second.populationContext.noFabrication, true);
  assert.equal(second.selectedPopulationContextId, null);
  assert.equal(second.surfaces.rooms.opened, false);
  assert.equal(second.surfaces["sports-events"].selectedId, null);
  assert.equal(second.surfaceSummary.activeId, "sports-events");
  assert.equal(second.surfaceSummary.activeMounted, true);
  assert.equal(second.surfaceSummary.activeOpened, false);
});

test("projection session can notify local observers without granting authority", () => {
  const state = fixtureState();
  const events = [];
  const target = new EventTarget();
  target.addEventListener(PROJECTION_SESSION_EVENT, (event) => events.push(event.detail));
  const session = createFixtureSession(state, { eventTarget: target, observeEvents: true });
  const notifications = [];
  const unsubscribe = session.subscribe((snapshot, reason) => notifications.push({ snapshot, reason }));
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].reason, "subscribe");

  target.dispatchEvent(new Event("simfabric:intent"));
  assert.equal(notifications.length, 2);
  assert.equal(notifications[1].snapshot.activeFeature.id, "contracts");
  assert.equal(events.length, 1);
  assert.equal(events[0].snapshot.source, PROJECTION_SESSION_SOURCE);
  assert.equal(events[0].snapshot.externalTransfer, false);
  unsubscribe();
  target.dispatchEvent(new Event("simfabric:projection"));
  assert.equal(notifications.length, 2);
  session.destroy();
});

test("mounted launch surface can expose its console state separately from its visual layer", () => {
  const state = fixtureState();
  state.feature = { activeId: "launch-distribution", open: true, featureCount: 22 };
  state.surfaces = {
    "launch-distribution": {
      opened: true,
      journeyStep: "social",
      localOnly: true,
      simulation: true,
    },
    "distribution-explorer": {
      kind: "distribution-explorer-projection",
      selectedAllocationId: "allocation-county-community",
      allocationCount: 8,
      localOnly: true,
      simulation: true,
    },
  };
  const snapshot = createFixtureSession(state).getSnapshot();

  assert.equal(snapshot.activeFeature.id, "launch-distribution");
  assert.equal(snapshot.surfaces["launch-distribution"].opened, true);
  assert.equal(snapshot.surfaces["launch-distribution"].selectedId, null);
  assert.equal(snapshot.surfaces["distribution-explorer"].mounted, true);
  assert.equal(snapshot.surfaces["distribution-explorer"].opened, false);
  assert.equal(snapshot.surfaces["distribution-explorer"].localOnly, true);
});
