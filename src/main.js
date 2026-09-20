import * as THREE from 'three';
import {mountCityJourney,resolveCityRoute} from './render/city-journey.js';
// Reject mixed/unknown City URLs before legacy route bootstrap can act on them.
if(resolveCityRoute(location.search).status==='rejected'){
  const safeUrl=new URL(location.href);safeUrl.search='?feature=reality-lens';history.replaceState(null,'',safeUrl);
}
import { mountCenteredSurfaces } from './render/centered-surfaces.js?v=20260918-compact-chip';
import { createImmersiveSession } from './render/immersive-session.js';
import { createMediaPreview } from './render/media-preview.js';
import { initMobilePanelManager } from './render/mobile-panel-manager.js';
import { mountPhotoMascot } from './render/photo-mascot-mount.js';
import { createPersonStudio } from './render/person-studio.js?v=20260918-avatar-chess';
import { createRealityAssembly } from './render/reality-assembly.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { MANIPULATE_MODES } from './render/manipulate-controls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createLivingRealityProjection } from './core/demo-projection.js?v=20260918-muse2';import'./render/social-mirror-bootstrap.js';
import { createDeviceProjection, readBrowserProjectionPreferences } from './projections/device-projection.js';
import { createDistributionExplorer } from './render/distribution-explorer.js';
import { createLaunchDistributionRehearsal } from './domains/distribution-registry.js?v=20260828-distribution163';
import { createPersonOrganisms } from './render/person-organisms.js';
import { FEATURE_DEFINITIONS, FEATURE_HANDOFF_LINKS, createFeatureNavigator } from './render/feature-navigator.js?v=20260918-muse2';
import { createCubeDive } from './render/cube-dive.js?v=20260919-dive';
import { resolveHandoffHop, resolveHopVessel, resolveNestedDiveTargets } from './domains/cube-dive.js?v=20260919-dive';
import { createLaunchConsole, validateLaunchCohortRoute, validateLaunchCohortCompareRoute } from './render/launch-console.js';
import { LAUNCH_RECEIPT_CONSOLE_SOURCE, createLaunchReceiptConsole } from './render/launch-receipt.js?v=20260827-receipt2';
import { createSocialExplorerConsole } from './render/social-explorer.js?v=20260828-social-pulse1';
import { SOCIAL_PULSE_SOURCE, createUnavailableSocialPulse, fetchSocialPulse } from './domains/social-pulse.js?v=20260828-social-pulse1';
import { LAUNCH_KIT_CONSOLE_SOURCE, createLaunchKitConsole } from './render/launch-kit.js?v=20260827-kit2';
import { createRoomSpaces } from './render/room-spaces.js';
import { CAMERA_INPUT_SOURCE, createCameraInput } from './render/camera-input.js';
import { GESTURE_INPUT_SOURCE, createGestureInput } from './render/gesture-input.js';
import {
  GAZE_HAND_COUPLING_SOURCE,
  GAZE_HAND_COUPLING_BOUNDARY,
  GAZE_HAND_LOCK_TTL_MS,
  createGazeHandCouplingState,
  establishGazeHandLock,
  expireGazeHandLock,
  isFreshGazeHandLock,
  normalizeGazeHandPoint,
  resolveGazeHandAction,
} from './render/gaze-hand-coupling.js?v=20260829-gaze-hand185';
import { createProjectionBridge } from './render/projection-bridge.js';
import { createIntentTimeline } from './render/intent-timeline.js';
import { createBlockWorldLayer } from './render/block-world.js?v=20260918-glass-open';
import { createProjectionSession } from './render/projection-session.js?v=20260830-session218';
import { applyBlockWorldFocusMode } from './render/block-world-focus.js?v=20260827-block-focus1';
import { createBlockWorldQuickActions } from './render/cube-quick-actions.js?v=20260828-cube-actions155';
import { PORTAL_RETURN_SOURCE, createPortalReturnHandoff } from './render/portal-return.js?v=20260827-portal-return1';
import { BLOCK_MIGRATION_SOURCE, resolveBlockMigrationHandback } from './domains/block-migration.js?v=20260827-migration3';
import { createBlockMigrationConsole } from './render/block-migration.js?v=20260826-migration2';
import { MIGRATION_SNAPSHOT_CONSOLE_SOURCE, createMigrationSnapshotConsole } from './render/migration-snapshot.js?v=20260828-snapshot2';
import { BLOCK_WORLD_SNAPSHOT_CONSOLE_SOURCE, createBlockWorldSnapshotConsole } from './render/block-world-snapshot.js?v=20260828-block-snapshot4';
import { BLOCK_WORLD_RUNTIME_SYNC_SOURCE, createBlockWorldRuntimeSync } from './render/block-world-runtime-sync.js?v=20260828-runtime-sync171';
import { ARENA_GAMES_SOURCE, ARENA_GAMES_CONSOLE_SOURCE } from './domains/arena-games.js?v=20260826-arena1';
import { createArenaGamesConsole } from './render/arena-games.js?v=20260826-arena1';
import { mountChessArena } from './render/chess-arena.js?v=20260918-avatar-chess';
import { ACADEMY_CONSOLE_SOURCE, createAcademyConsole } from './render/academy.js?v=20260904-academy1';
import {
  CONTRACTS_MARKETS_SOURCE,
  CONTRACTS_MARKETS_CONTRACT_ROUTE_PARAM,
  CONTRACTS_MARKETS_DRAFT_ROUTE_MAX_LENGTH,
  CONTRACTS_MARKETS_DRAFT_ROUTE_PARAM,
  CONTRACTS_MARKETS_GRAPH_ROUTE_MODE,
  CONTRACTS_MARKETS_GRAPH_ROUTE_PARAM,
  CONTRACTS_MARKETS_SOURCE_RETURN_JOURNEY,
  validateContractsMarketsGraphRoute,
  validateContractDraftRouteState,
} from './domains/contracts-markets.js?v=20260829-contracts-graph185';
import { CONTRACTS_MARKETS_CONSOLE_SOURCE, createContractsMarketsConsole } from './render/contracts-markets.js?v=20260829-contracts-graph185';
import { createUnavailableProtocolEvidence, fetchProtocolEvidence } from './domains/protocol-evidence.js?v=20260828-protocol-evidence1';
import { PROTOCOL_EVIDENCE_CONSOLE_SOURCE, createProtocolEvidenceRail } from './render/protocol-evidence.js?v=20260828-protocol-evidence1';
import { PAYCORE_SOURCE } from './domains/paycore.js?v=20260826-paycore1';
import { PAYCORE_CONSOLE_SOURCE, createPaycoreConsole } from './render/paycore.js?v=20260826-paycore1';
import { T402_SOURCE } from './domains/t402.js?v=20260826-t4021';
import { T402_CONSOLE_SOURCE, createT402Console } from './render/t402.js?v=20260826-t4021';
import { NEURAL_MESH_SOURCE } from './domains/neural-mesh.js?v=20260827-neural1';
import { NEURAL_MESH_CONSOLE_SOURCE, createNeuralMeshConsole } from './render/neural-mesh.js?v=20260827-neural1';
import { MATTER_FORGE_SOURCE } from './domains/matter-forge.js?v=20260827-picture1';
import { PICTURE_MATTER_METADATA_SOURCE, createUnavailablePictureMatterMetadata, fetchPictureMatterMetadata } from './domains/picture-matter-metadata.js?v=20260828-picture-metadata1';
import { PICTURE_MATTER_CONSOLE_SOURCE, createPictureMatterConsole } from './render/picture-matter.js?v=20260828-picture-metadata1';
import { NFT_ATELIER_CONSOLE_SOURCE, createNftAtelierConsole } from './render/nft-atelier.js?v=20260918-nft1';
import { createFrozenRelics } from './domains/frozen-relics.js?v=20260918-fr1';
import { FROZEN_RELICS_CONSOLE_SOURCE, createFrozenRelicsConsole } from './render/frozen-relics.js?v=20260918-fr1';
import { MUSE_AGENT_CONSOLE_SOURCE, createMuseAgentConsole } from './render/muse-agent.js?v=20260918-muse1';
import { BOT_PLAZA_CONSOLE_SOURCE, createBotPlazaConsole } from './render/bot-plaza.js?v=20260918-botplaza1';
import { createBotRegistry, createBotRuntime } from './domains/bot-plaza.js?v=20260918-botplaza1';
import { createProposalQueue } from './domains/bot-plaza.js?v=20260918-ctr2';
import { createOutcomeContracts } from './domains/outcome-contracts.js?v=20260918-ctr2';
import { mountBotPresence } from './render/bot-presence.js?v=20260918-botpresence1';
import { CONTRACT_ATELIER_CONSOLE_SOURCE, createContractAtelierConsole } from './render/contract-atelier.js?v=20260918-ctr1';
import { LUNA_CONSOLE_SOURCE, createLunaCompanionConsole } from './render/luna-companion.js?v=20260918-luna1';
import { WARDROBE_ATELIER_CONSOLE_SOURCE, createWardrobeAtelierConsole } from './render/wardrobe-atelier.js?v=20260918-wdr1';
import { WHITE_PAPER_CONSOLE_SOURCE, createWhitePaperConsole } from './render/white-paper.js?v=20260918-wp1';
import { GESTURE_LENS_CONSOLE_SOURCE, createGestureLensConsole } from './render/gesture-lens.js?v=20260918-gl1';
import { createHandLensSession } from './render/hand-session.js?v=20260920-hand-lens';
import { createStoryModeConsole } from './render/story-mode.js?v=20260920-story1';
import { LEDGER_PROOF_SOURCE } from './domains/ledger-proof.js?v=20260827-ledger1';
import { LEDGER_PROOF_CONSOLE_SOURCE, createLedgerProofConsole } from './render/ledger-proof.js?v=20260827-ledger1';
import { LIVE_GATEWAY_SOURCE } from './domains/live-gateway.js?v=20260827-gateway1';
import { LIVE_GATEWAY_CONSOLE_SOURCE, createLiveGatewayConsole } from './render/live-gateway.js?v=20260901-provider-docs';
import { WORLD_EVENTS_CONSOLE_SOURCE } from './render/world-events.js?v=20260901-reality-lens';
import { createUnavailableWorldEvents, fetchWorldEvents } from './domains/world-events.js?v=20260901-reality-lens';
import { createWorldEventsConsole } from './render/world-events.js?v=20260901-reality-lens';
import { SPORTS_EVENTS_CONSOLE_SOURCE, createSportsEventsConsole } from './render/sports-events.js?v=20260829-sports-return184';
import { createUnavailableSportsEvents, fetchSportsEventDetail, fetchSportsEvents } from './domains/sports-events.js?v=20260829-sports-return184';
import { MULTI_SPORT_EVENTS_CONSOLE_SOURCE, createMultiSportEventsConsole } from './render/multi-sport-events.js?v=20260828-multisport162';
import { createUnavailableMultiSportEvents, fetchMultiSportEventDetail, fetchMultiSportEvents } from './domains/multi-sport-events.js?v=20260828-multisport162';
import { DEVICE_PROJECTION_CONSOLE_SOURCE, createDeviceProjectionConsole } from './render/device-projection.js?v=20260827-device1';
import { ASSET_MARKET_CONSOLE_SOURCE, createAssetMarketConsole } from './render/asset-market.js?v=20260828-asset-market1';
import { createUnavailableAssetMarketEvidence, fetchAssetMarketEvidence } from './domains/asset-market.js?v=20260828-asset-market1';
import { POPULATION_CONTEXT_SOURCE, createUnavailablePopulationContext, fetchPopulationContext } from './domains/population-context.js?v=20260828-population-context1';

const runtimeStatus = globalThis.__MATUMBO_RUNTIME__;
runtimeStatus?.setStage?.('projection', 'Preparing the canonical local world envelope…');
const livingRealityEnvelope = createLivingRealityProjection();
const livingRealityWorld = livingRealityEnvelope.world;
const devicePreferences = readBrowserProjectionPreferences();
const deviceProjection = createDeviceProjection(livingRealityEnvelope, devicePreferences);
window.__SIMFABRIC_PROJECTION__ = livingRealityWorld;
window.__SIMFABRIC_ENVELOPE__ = livingRealityEnvelope;
window.__SIMFABRIC_DEVICE_PROJECTION__ = deviceProjection;
window.SIMFABRIC = Object.freeze({
  getProjection: () => window.__SIMFABRIC_PROJECTION__,
  getEnvelope: () => window.__SIMFABRIC_ENVELOPE__,
  getDeviceProjection: () => window.__SIMFABRIC_DEVICE_PROJECTION__,
});
const projectionBridge = createProjectionBridge();
let featureNavigator = null;
let personStudio = null;
let realityAssembly = null;
let launchConsole = null;
let launchReceipt = null;
let launchKitConsole = null;
let socialExplorer = null;
let publicSocialPulse = createUnavailableSocialPulse();
let populationContext = createUnavailablePopulationContext();
let intentTimeline = null;
let blockWorld = null;
let projectionSession = null;
let cubeQuickActions = null;
// Declared with the other bootstrap state so URL-driven Launch Kit and
// snapshot openers can safely call setBlockWorldPresentation during module
// initialization, before the later renderer helper definitions are reached.
let blockWorldVisibility = null;
let blockWorldEnvironmentVisibility = null;
let blockWorldPresentationActive = false;
// A Portal handoff into any explicit local feature surface keeps the cube field
// as the visible world substrate. This flag is presentation-only: it never
// changes the canonical projection or destination state.
let portalCubeSubstrateActive = false;
let portalReturn = null;
let blockMigration = null;
let migrationSnapshot = null;
let blockWorldSnapshot = null;
let blockWorldRuntimeSync = null;
let arenaGames = null;
let academyConsole = null;
let contractsMarkets = null;
let protocolEvidence = null;
let paycoreConsole = null;
let t402Console = null;
let neuralMeshConsole = null;
let pictureMatterConsole = null;
let pictureMatterMetadata = createUnavailablePictureMatterMetadata();
let nftAtelierConsole = null;
let frozenRelicsVault = null;
let frozenRelicsConsole = null;
let museAgentConsole = null;
let botPlazaRegistry = null;
let botPlazaRuntime = null;
let botPlazaConsole = null;
let storyModeConsole = null;
let botPresence = null;
let contractProposalQueue = null;
let sharedOutcomeDesk = null;
const recentProposalTitles = new Map();
let contractAtelierConsole = null;
let lunaCompanionConsole = null;
let wardrobeAtelierConsole = null;
let whitePaperConsole = null;
let gestureLensConsole = null;
let ledgerProofConsole = null;
let liveGatewayConsole = null;
let worldEventsConsole = null;
let sportsEventsConsole = null;
let multiSportEventsConsole = null;
let assetMarketConsole = null;
let deviceProjectionConsole = null;
let gestureInput = null;
// Sensor coupling state is initialized before the gesture panel mounts. The
// bridge publishes an initial OFF status during construction, so callbacks
// must never observe a temporal-dead-zone value here.
let gazeHandCouplingState = createGazeHandCouplingState({ reason: 'no-gaze' });
let gazeHandCouplingExpiryTimer = null;
let worldEvidenceLayer = null;
const worldEvidenceMeshes = new Set();
let sportsEvidenceLayer = null;
const sportsEvidenceMeshes = new Set();

// Every explicit Portal route keeps the originating cube field as the visible
// world substrate while its local destination surface is open.  The set stays
// finite and renderer-only, matching the domain route registry; Person and
// Block World remain ordinary feature selections rather than portal targets.
const PORTAL_CUBE_SUBSTRATE_FEATURES = new Set([
  'rooms',
  'migration',
  'social-explorer',
  'launch-distribution',
  'asset-token',
  'asset-market',
  'arena',
  'academy',
  'contracts',
  'paycore',
  't402',
  'neural-mesh',
  'picture-matter',
  'nft-atelier',
  'muse-agent',
  'bot-plaza',
  'contract-atelier',
  'ledger',
  'gateway',
  'world-events',
  'sports-events',
  'multi-sport-events',
  'projections',
  'reality-lens',
]);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020407);
scene.fog = new THREE.FogExp2(0x020407, 0.024);

const camera = new THREE.PerspectiveCamera(52, innerWidth/innerHeight, 0.1, 220);
camera.position.set(0, 10, 30);

const isMobile = deviceProjection.presentation.viewport.class === 'compact' || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const reducedMotion = deviceProjection.presentation.accessibility.motion === 'reduced';
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ alpha:true, antialias:!isMobile, powerPreference:isMobile?'low-power':'high-performance' });
} catch (error) {
  // The inline bootstrap in index.html owns the visible recovery surface. A
  // failed WebGL constructor must never be mistaken for a live authority
  // path; report the local failure and let the browser error boundary stop
  // this module cleanly.
  runtimeStatus?.markFailed?.(error, 'WebGL renderer');
  throw error;
}
runtimeStatus?.setStage?.('renderer', 'WebGL renderer online; assembling local organs…');
renderer.setPixelRatio(isMobile ? 1 : Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
document.body.prepend(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = .055;
controls.minDistance = 7;
controls.maxDistance = 65;
controls.target.set(0, 1, 0);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), isMobile ? 0 : 0.75, 0.55, 0.58);
if(!isMobile) composer.addPass(bloom);

scene.add(new THREE.HemisphereLight(0x9eeeff, 0x030508, 0.7));
const key = new THREE.DirectionalLight(0xbdefff, 2.2); key.position.set(8,16,8); scene.add(key);
const rim = new THREE.PointLight(0x62d9ff, 32, 45, 2); rim.position.set(-12,6,-6); scene.add(rim);
const warm = new THREE.PointLight(0xffb866, 18, 30, 2); warm.position.set(14,-2,6); scene.add(warm);

const mats = {
  dark: new THREE.MeshPhysicalMaterial({color:0x111821,metalness:.92,roughness:.26,clearcoat:.65,clearcoatRoughness:.22}),
  metal: new THREE.MeshPhysicalMaterial({color:0x7f97a1,metalness:1,roughness:.2,clearcoat:1}),
  cyan: new THREE.MeshStandardMaterial({color:0x76ecff,emissive:0x32cce9,emissiveIntensity:2.6,metalness:.35,roughness:.18}),
  blue: new THREE.MeshStandardMaterial({color:0x3b83ff,emissive:0x214cdd,emissiveIntensity:2.2,metalness:.4,roughness:.2}),
  gold: new THREE.MeshPhysicalMaterial({color:0xe6b65f,metalness:1,roughness:.18,clearcoat:.8}),
  glass: new THREE.MeshPhysicalMaterial({color:0x69e7ff,transmission:.72,transparent:true,opacity:.34,roughness:.08,metalness:.08,thickness:.7,ior:1.32}),
  crystal: new THREE.MeshPhysicalMaterial({color:0x9feeff,transmission:.38,transparent:true,opacity:.68,roughness:.04,metalness:.18,thickness:1.3,ior:1.5,emissive:0x123b4a,emissiveIntensity:.55}),
  violet: new THREE.MeshStandardMaterial({color:0xb188ff,emissive:0x6539e8,emissiveIntensity:2.1,metalness:.28,roughness:.2}),
  red: new THREE.MeshStandardMaterial({color:0xff6f6f,emissive:0xcf3333,emissiveIntensity:1.8,metalness:.25,roughness:.25}),
  green: new THREE.MeshStandardMaterial({color:0x6dffc0,emissive:0x24be78,emissiveIntensity:1.8,metalness:.25,roughness:.22})
};

const world = new THREE.Group(); scene.add(world);
// Renderer handle for local browser diagnostics only.  It lets a launch
// audit verify that the cube-only presentation actually hides legacy layers;
// it is not a second state store or an external authority surface.
window.__TUMBO_WORLD__ = world;
const organs = [];
const ASSET_TOKEN_ORGAN_ID = 'asset-token';
const LEGACY_ORGAN_ID_ALIASES = Object.freeze({ coin: ASSET_TOKEN_ORGAN_ID });
function resolveOrganById(id) {
  const canonicalId = LEGACY_ORGAN_ID_ALIASES[id] ?? id;
  return organs.find((candidate) => candidate.id === canonicalId) ?? null;
}
const raycastTargets = [];
const mouse = new THREE.Vector2(99,99);
let hovered = null;
let selectedPulse = null;
let hoveredWorldEvidence = null;
let hoveredSportsEvidence = null;
let directPointerKind = null;
let worldEvidenceManipulation = null;
let worldEvidenceLastTap = null;
// Public evidence identity and local cube position are intentionally separate.
// The identity remains in the fetched World Pulse envelope while the marker's
// in-page position lives in this renderer-only map. A portal hand-off can
// therefore restore the same returned record without mutating provider data.
let worldEvidenceFocusedRecordId = null;
let worldEvidenceReturnContext = null;
const worldEvidenceLocalPositions = new Map();
const worldEvidenceOpenIds = new Set();
const worldEvidenceInnerMeshes = new Set();
const personOrganisms = createPersonOrganisms({ parent:world, raycastTargets, isMobile });
const distributionExplorer = createDistributionExplorer({ parent:world, raycastTargets, isMobile });
// Keep the launch map readable as a nearby world layer while preserving the
// existing organ constellation and its projection-only camera semantics.
distributionExplorer.layer.position.set(0, -0.1, -0.8);
// Expose the renderer adapter for local browser diagnostics only. This is a
// frozen projection handle; it does not grant an external launch, wallet, or
// distribution authority.
window.__TUMBO_DISTRIBUTION_EXPLORER__ = distributionExplorer;
// Rooms are a bounded enterable layer over the canonical spatial-rooms
// contribution. The adapter owns only local selection/enter/leave presentation;
// this host emits the corresponding frozen SIMFABRIC intents and camera focus.
const roomSpaces = createRoomSpaces({
  documentRoot: document,
  projection: livingRealityWorld,
  three: THREE,
  parent: world,
  raycastTargets,
  isMobile,
  reducedMotion,
  onSelect: (room) => {
    const target = roomSpaces.getFocusTarget(room.roomId);
    if (target) {
      desiredTarget.copy(target);
      cameraTween = reducedMotion ? .16 : 1;
    }
    projectionBridge.emitIntent('projection.select-room', room.roomId, Object.freeze({
      action: 'select',
      role: room.room?.role ?? 'observer',
      context: room.room?.context ?? 'unknown',
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    }));
  },
  onEnter: (room) => {
    const target = roomSpaces.getFocusTarget(room.roomId);
    if (target) {
      desiredTarget.copy(target);
      cameraTween = reducedMotion ? .16 : 1;
    }
    projectionBridge.emitIntent('projection.enter-room', room.roomId, Object.freeze({
      action: 'enter',
      role: room.room?.role ?? 'observer',
      context: room.room?.context ?? 'unknown',
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    }));
  },
  onLeave: (room) => projectionBridge.emitIntent('projection.leave-room', room.roomId, Object.freeze({
    action: 'leave',
    simulation: true,
    localOnly: true,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  })),
  onReplay: (replay) => projectionBridge.emitIntent('projection.room-enter-leave-replay', replay.roomId, replay),
});
window.__TUMBO_ROOM_SPACES__ = roomSpaces;
// A small voxel/block layer makes the "blocks within blocks" idea directly
// walkable in the local projection.  Its edit callbacks emit frozen intents;
// the adapter keeps the draft separate from the canonical contribution.
blockWorld = createBlockWorldLayer({
  documentRoot: document,
  projection: livingRealityWorld,
  three: THREE,
  parent: world,
  raycastTargets,
  isMobile,
  reducedMotion,
  // Free 3D gizmo manipulation (additive, 2026-09-18): the vendored
  // TransformControls class rides the same local import map as OrbitControls.
  TransformControlsClass: TransformControls,
  camera,
  domElement: renderer.domElement,
  onManipulatorDraggingChange: (dragging) => { controls.enabled = !dragging; },
  // Cube Dive Transport (2026-09-19): a portal cube's double activation dives
  // the camera inside the cube instead of toggling it open; a nested
  // content cube's double-tap dives one level deeper. The host owns the
  // camera flight via the cubeDive renderer below.
  onDiveRequest: (request) => startCubeDive(request),
  onContentDoubleTap: (tap) => diveDeeperIntoContent(tap),
  onSelect: (block, method) => {
    const target = blockWorld.getFocusTarget(block);
    if (target) {
      desiredTarget.copy(target);
      cameraTween = reducedMotion ? .16 : 1;
    }
    // Hover has a preview, but touch and keyboard users need the first select
    // action itself to expose what the focused block contains before opening it.
    showBlockReadout(block, 'select');
    projectionBridge.emitIntent('projection.select-block', block.id, Object.freeze({
      blockType: block.blockType,
      coordinate: block.coordinate,
      method,
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    }));
    try { botPlazaRuntime?.publishWorldEvent('cube.selected', { cubeId: block?.id ?? null, blockType: block?.blockType ?? null, method: String(method ?? '') }); } catch {}
    cubeQuickActions?.refresh?.();
    refreshManipulateButtons();
  },
  onOpen: (snapshot, action) => {
    const block = snapshot?.block;
    const target = blockWorld.getFocusTarget(block);
    if (target) {
      desiredTarget.copy(target);
      cameraTween = reducedMotion ? .16 : 1;
    }
    showBlockReadout(block, action);
    projectionBridge.emitIntent('projection.interact-block', block?.id ?? 'block-world:interaction', Object.freeze({
      action,
      blockId: block?.id ?? null,
      coordinate: block?.coordinate ?? null,
      open: block?.open === true,
      contentCount: block?.contentCount ?? 0,
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    }));
    try { botPlazaRuntime?.publishWorldEvent('cube.opened', { cubeId: block?.id ?? null, action: String(action ?? '') }); } catch {}
    cubeQuickActions?.refresh?.();
  },
  onMove: (snapshot, action) => {
    const block = snapshot?.block;
    const target = blockWorld.getFocusTarget(block);
    if (target) {
      desiredTarget.copy(target);
      cameraTween = reducedMotion ? .16 : 1;
    }
    showBlockReadout(block, action);
    projectionBridge.emitIntent('projection.interact-block', block?.id ?? 'block-world:interaction', Object.freeze({
      action,
      blockId: block?.id ?? null,
      previousCoordinate: snapshot?.previousBlock?.coordinate ?? null,
      coordinate: block?.coordinate ?? null,
      delta: snapshot?.draft?.lastEdit?.delta ?? null,
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    }));
    cubeQuickActions?.refresh?.();
  },
  onInspect: (snapshot) => {
    const block = snapshot?.block;
    showBlockReadout(block, 'inspect');
    projectionBridge.emitIntent('projection.inspect-block-contents', snapshot?.blockId ?? block?.id ?? 'block-world:inspect', Object.freeze({
      contentCount: snapshot?.contentCount ?? 0,
      opened: snapshot?.opened === true,
      contents: snapshot?.contents ?? [],
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    }));
    cubeQuickActions?.refresh?.();
  },
  onContentSelect: (snapshot) => {
    const block = snapshot?.parent ?? snapshot?.content?.parent ?? null;
    const target = blockWorld.getFocusTarget(block);
    if (target) {
      desiredTarget.copy(target);
      cameraTween = reducedMotion ? .16 : 1;
    }
    showBlockReadout(block, 'content-select', snapshot);
    projectionBridge.emitIntent('projection.inspect-block-content', snapshot?.contentId ?? block?.id ?? 'block-world:content', Object.freeze({
      action: snapshot?.action ?? 'select-content',
      parentBlockId: snapshot?.parentBlockId ?? block?.id ?? null,
      parentCoordinate: snapshot?.parentCoordinate ?? block?.coordinate ?? null,
      contentId: snapshot?.contentId ?? null,
      contentLabel: snapshot?.contentLabel ?? null,
      contentType: snapshot?.contentType ?? null,
      contentIndex: snapshot?.contentIndex ?? null,
      contentCount: snapshot?.contentCount ?? 0,
      method: snapshot?.method ?? 'content-row',
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
    }));
    cubeQuickActions?.refresh?.();
  },
  onGrab: (snapshot, action) => {
    const block = snapshot?.heldBlock ?? snapshot?.block;
    const target = blockWorld.getFocusTarget(block);
    if (target) {
      desiredTarget.copy(target);
      cameraTween = reducedMotion ? .16 : 1;
    }
    showBlockReadout(block, action);
    projectionBridge.emitIntent('projection.grab-block', block?.id ?? 'block-world:grab', Object.freeze({
      action,
      blockId: block?.id ?? null,
      coordinate: block?.coordinate ?? null,
      holding: true,
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
    }));
    cubeQuickActions?.refresh?.();
  },
  onHold: (snapshot, action) => {
    const block = snapshot?.heldBlock ?? snapshot?.block;
    const target = blockWorld.getFocusTarget(block);
    if (target) {
      desiredTarget.copy(target);
      cameraTween = reducedMotion ? .16 : 1;
    }
    showBlockReadout(block, action);
    projectionBridge.emitIntent('projection.hold-block', block?.id ?? 'block-world:hold', Object.freeze({
      action,
      blockId: block?.id ?? null,
      coordinate: block?.coordinate ?? null,
      delta: snapshot?.draft?.lastEdit?.delta ?? null,
      holding: true,
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
    }));
    cubeQuickActions?.refresh?.();
  },
  onPlace: (snapshot, action) => {
    const block = snapshot?.placedBlock ?? snapshot?.block;
    const target = blockWorld.getFocusTarget(block);
    if (target) {
      desiredTarget.copy(target);
      cameraTween = reducedMotion ? .16 : 1;
    }
    showBlockReadout(block, action);
    projectionBridge.emitIntent('projection.place-block', block?.id ?? 'block-world:place', Object.freeze({
      action,
      blockId: block?.id ?? null,
      coordinate: block?.coordinate ?? null,
      from: snapshot?.draft?.lastEdit?.from ?? null,
      holding: false,
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
    }));
    cubeQuickActions?.refresh?.();
  },
  onDirectManipulation: (snapshot, action) => {
    const block = snapshot?.placedBlock ?? snapshot?.block;
    const target = blockWorld.getFocusTarget(block);
    if (target) {
      desiredTarget.copy(target);
      cameraTween = reducedMotion ? .16 : 1;
    }
    showBlockReadout(block, action);
    projectionBridge.emitIntent('projection.direct-drag-block', block?.id ?? 'block-world:direct-drag', Object.freeze({
      action,
      blockId: block?.id ?? null,
      previousBlockId: snapshot?.previousBlock?.id ?? null,
      from: snapshot?.from ?? null,
      to: snapshot?.to ?? block?.coordinate ?? null,
      delta: snapshot?.delta ?? null,
      transition: snapshot?.transition ?? 'grab>hold>place',
      pointerType: snapshot?.pointerType ?? 'pointer',
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
    }));
    cubeQuickActions?.refresh?.();
  },
  onNavigate: (snapshot, method) => {
    const sourceBlock = snapshot?.sourceBlock;
    const targetFeature = snapshot?.targetFeature ?? snapshot?.featureId;
    // Capture the public evidence identity before Feature Navigator hides the
    // evidence layer. The provider record stays in the World Pulse envelope;
    // only the renderer-local marker position is carried through the portal.
    captureWorldEvidenceReturnContext();
    showBlockReadout(sourceBlock, 'portal');
    // Keep the camera anchored on the originating portal while the
    // destination console opens. This makes the retained cube substrate the
    // visual context instead of leaving the viewer focused on an old round
    // organ coordinate.
    const sourceTarget = blockWorld?.getFocusTarget(snapshot?.sourceBlockId ?? sourceBlock?.id);
    if (sourceTarget) {
      desiredTarget.copy(sourceTarget);
      desiredCameraPosition.copy(sourceTarget).add(new THREE.Vector3(0, 7.4, 12.8));
      cameraTween = reducedMotion ? .16 : 1;
      cameraPositionTween = reducedMotion ? .16 : 1;
    }
    projectionBridge.emitIntent('projection.portal-navigate', snapshot?.routeId ?? targetFeature ?? 'block-world:portal', Object.freeze({
      action: 'portal-navigate',
      method,
      sourceBlockId: snapshot?.sourceBlockId ?? sourceBlock?.id ?? null,
      sourceCoordinate: snapshot?.sourceCoordinate ?? sourceBlock?.coordinate ?? null,
      targetFeature,
      routeId: snapshot?.routeId ?? null,
      transition: snapshot?.transition ?? 'portal',
      portalTransition: snapshot?.portalTransition ?? null,
      navigationDraft: true,
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
    }));
    // Feature Navigator owns the existing local surfaces. This is a same-page
    // handoff: it closes the focused cube console, opens the destination
    // surface, and leaves the canonical projection untouched.
    portalCubeSubstrateActive = PORTAL_CUBE_SUBSTRATE_FEATURES.has(targetFeature);
    if (targetFeature) featureNavigator?.select(
      targetFeature,
      `block-portal:${snapshot?.sourceBlockId ?? 'unknown'}`,
      { updateLocation: false },
    );
    // Keep the portal contract self-contained as well as navigator-backed:
    // opening a route must visibly open its destination surface even when a
    // host has mounted Feature Navigator in a reduced/static mode. These are
    // existing local consoles only; no route writes a URL or external state.
    const portalSurfaceOpeners = {
      rooms: () => roomSpaces?.open(),
      migration: () => blockMigration?.open(),
      'social-explorer': () => socialExplorer?.open(),
      'launch-distribution': () => launchConsole?.open(),
      'asset-token': () => {
        assetLaunchPanel?.classList.add('portal-destination-visible');
        previewAssetLaunch?.('portal');
      },
      'asset-market': () => openAssetMarket('block-portal:asset-market', false),
      arena: () => arenaGames?.open(),
      contracts: () => contractsMarkets?.open(),
      paycore: () => paycoreConsole?.open(),
      t402: () => t402Console?.open(),
      'neural-mesh': () => neuralMeshConsole?.open(),
      'picture-matter': () => pictureMatterConsole?.open(),
      'nft-atelier': () => nftAtelierConsole?.open(),
      'muse-agent': () => museAgentConsole?.open(),
      'bot-plaza': () => botPlazaConsole?.open(),
      'contract-atelier': () => contractAtelierConsole?.open(),
      'luna-companion': () => lunaCompanionConsole?.open(),
      'wardrobe-atelier': () => wardrobeAtelierConsole?.open(),
      ledger: () => ledgerProofConsole?.open(),
      'sports-events': () => {
        sportsEventsConsole?.open();
        void sportsEventsConsole?.refresh('block-portal:sports-events');
      },
      'multi-sport-events': () => {
        multiSportEventsConsole?.open();
        void multiSportEventsConsole?.refresh('block-portal:multi-sport-events');
      },
      // Gateway hands into the public cross-surface status dashboard. The
      // former local gateway fixture remains mounted for regression coverage
      // but is not presented as live evidence. Feature Navigator already
      // performs the one explicit World Pulse refresh for this handoff, so
      // this self-contained opener only makes the destination visible.
      gateway: () => {
        openLivePublicStatus('block-portal:gateway', false);
      },
      'world-events': () => openWorldEvents('block-portal:world-events', false),
      projections: () => deviceProjectionConsole?.open(),
      'reality-lens': () => setRealityLens?.('world', 'block-portal'),
    };
    portalSurfaceOpeners[targetFeature]?.();
    // Keep the originating cube route visible as a reversible handoff while
    // the destination feature is open. The return rail is intentionally
    // opened after Feature Navigator so its normal feature-selection cleanup
    // cannot hide the newly-created control.
    if (targetFeature) portalReturn?.open(snapshot, method);
  },
  onFeatureNavigate: (featureId, method) => {
    const selected = featureNavigator?.select(featureId, method);
    return selected;
  },
  onDistributionNavigate: (cohortId, method) => {
    globalThis.__TUMBO_LAST_DISTRIBUTION_COHORT__ = cohortId;
    const route = new URL(globalThis.location?.href ?? 'http://matumbo.local/');
    route.searchParams.delete('feature'); route.searchParams.set('panel', 'launch-distribution'); route.searchParams.set('cohort', cohortId);
    globalThis.history?.pushState?.({}, '', route.href);
    featureNavigator?.select('launch-distribution', method, { updateLocation: false });
    const state = validateLaunchCohortRoute({ cohortId, projection: livingRealityWorld });
    launchConsole?.open(); launchConsole?.hydrateCohortRoute?.(state, method, state ? null : 'unknown canonical cohort');
  },
  onMigrationOpen: (snapshot, method) => {
    projectionBridge.emitIntent('projection.open-migration-from-block-world', BLOCK_MIGRATION_SOURCE, Object.freeze({
      action: snapshot?.action ?? 'open-migration-bridge',
      method,
      sourceFeature: snapshot?.sourceFeature ?? 'block-world',
      targetFeature: snapshot?.targetFeature ?? 'migration',
      localOnly: true,
      simulation: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    }));
    // Use the existing Feature Navigator route so the full Migration Bridge
    // opens in place, while keeping the handoff same-page and local-only.
    const selected = featureNavigator?.select('migration', `block-world-migration:${method}`, { updateLocation: false });
    if (!selected) {
      blockWorld?.close();
      blockMigration?.open();
    }
    // A reduced/static host may not run the normal feature-focus branch;
    // explicitly opening the already-mounted console keeps the affordance
    // useful without adding a second migration implementation.
    blockMigration?.open();
  },
  onEdit: (edit) => {
    cubeQuickActions?.refresh?.();
    projectionBridge.emitIntent('projection.edit-block-draft', edit.block ?? 'block-world:draft', edit);
  },
  onReplay: (replay) => projectionBridge.emitIntent('projection.replay-block-world', replay.worldId, replay),
});
// Cube Dive Transport (2026-09-19). A quick second tap on the same portal
// cube transports the camera INSIDE it (field -> diving -> inside) instead
// of toggling a panel: the flight approaches the nearest face, passes
// through with a lightweight flash, and settles inside an inverted
// cube-shell world. The inside HUD offers Dive deeper (nested cubes),
// Next cube -> (resolved through FEATURE_HANDOFF_LINKS, no return to the
// field), and <- Field (restores the saved field pose). Local projection
// only: no network, no storage, no wallet, no custody, no mainnet.
const CUBE_DIVE_ACCENTS = [0x37d9d0, 0x7a5cff, 0xff9d5c, 0x5cb8ff, 0xb8ff5c, 0xff5c8a];
function cubeDiveAccentFor(featureId) {
  const s = String(featureId ?? '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CUBE_DIVE_ACCENTS[h % CUBE_DIVE_ACCENTS.length];
}
function cubeDiveLabelFor(featureId) {
  return FEATURE_DEFINITIONS.find((f) => f?.id === featureId)?.label ?? String(featureId ?? 'cube');
}
function diveStatusNote(message) {
  try {
    const el = document.getElementById('runtime-status-message');
    if (el) el.textContent = message;
  } catch {}
}
let cubeDive = null;

function startCubeDive(request) {
  if (!request || !cubeDive || renderer.xr.isPresenting) return;
  // The tap's drag lifecycle is over; the dive locks input from here.
  controls.enabled = true;
  cameraTween = 0;
  cameraPositionTween = 0;
  const res = cubeDive.beginDive({
    blockId: request.blockId,
    featureId: request.featureId,
    label: request.label ?? cubeDiveLabelFor(request.featureId),
  });
  if (res.ok) blockWorld?.clearFieldTap?.();
}

function cubeDiveVesselBlocks() {
  return blockWorld?.getSnapshot?.().draft?.blocks ?? [];
}

function diveDeeperIntoContent(tap = null) {
  const snap = cubeDive?.getSnapshot();
  const current = snap?.active;
  if (!cubeDive || snap?.state !== 'inside' || !current) return;
  if (tap?.parentBlockId && tap.parentBlockId !== current.blockId) return;
  const vessel = cubeDiveVesselBlocks().find((b) => b?.id === current.blockId);
  const targets = resolveNestedDiveTargets(vessel);
  if (!targets.length) {
    diveStatusNote('NO NESTED CUBES IN THIS CUBE · LOCAL ONLY');
    return;
  }
  const target = (tap?.contentId && targets.find((t) => t.contentId === tap.contentId)) || targets[0];
  // Spring the vessel open so the nested cubes are visible for the descent.
  // Only when the vessel is already selected: selecting it here would fire
  // the onSelect camera tween + readout and fight the dive flight.
  try {
    if (blockWorld?.getSnapshot?.().selectedId === current.blockId) blockWorld?.openBlock?.(true);
  } catch {}
  const worldPos = blockWorld?.getContentWorldPosition?.(current.blockId, target.contentIndex);
  cameraTween = 0;
  cameraPositionTween = 0;
  cubeDive.beginDeeper({
    blockId: current.blockId,
    featureId: current.featureId,
    label: `${current.label} · ${target.label}`,
    contentId: target.contentId,
    contentWorldPos: worldPos ? new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z) : null,
  });
}

function hopToNextCube() {
  const snap = cubeDive?.getSnapshot();
  const current = snap?.active;
  if (!cubeDive || snap?.state !== 'inside' || !current) return;
  const blocks = cubeDiveVesselBlocks();
  const nextFeatureId = resolveHandoffHop({ featureId: current.featureId, handoffLinks: FEATURE_HANDOFF_LINKS });
  if (!nextFeatureId) {
    // Dead end in the handoff graph: resolve back to the field.
    diveStatusNote('NO ONWARD CUBE · RETURNING TO FIELD · LOCAL ONLY');
    cubeDive.beginExit();
    return;
  }
  const vesselId = resolveHopVessel({ blocks, featureId: nextFeatureId, currentBlockId: current.blockId });
  if (!vesselId) {
    cubeDive.beginExit();
    return;
  }
  cameraTween = 0;
  cameraPositionTween = 0;
  cubeDive.beginHop({
    fromBlockId: current.blockId,
    blockId: vesselId,
    featureId: nextFeatureId,
    label: cubeDiveLabelFor(nextFeatureId),
  });
}

function handleCubeDiveEvent(type) {
  if (type === 'dive-deeper-request') diveDeeperIntoContent();
  else if (type === 'hop-next-request') hopToNextCube();
  else if (type === 'exit-field-request') {
    cameraTween = 0;
    cameraPositionTween = 0;
    cubeDive?.beginExit();
  }
}

cubeDive = createCubeDive({
  three: THREE,
  scene,
  camera,
  controls,
  documentRoot: document,
  reducedMotion,
  getBlockCenter: (blockId) => {
    const v = blockWorld?.getFocusTarget?.(blockId);
    return v ? { x: v.x, y: v.y, z: v.z } : null;
  },
  getBlockHalfSize: () => 0.45,
  getFeatureAccent: cubeDiveAccentFor,
  onEvent: handleCubeDiveEvent,
});
// Normal feature panels share the same cube field, so keep a compact action
// rail available without duplicating Block World state or hiding the full
// console behind another navigation step. Every handler below delegates to
// the already-mounted Block World layer.
cubeQuickActions = createBlockWorldQuickActions({
  documentRoot: document,
  getBlockWorldSnapshot: () => blockWorld?.getSnapshot?.() ?? null,
  actions: {
    open: () => {
      const snapshot = blockWorld?.getSnapshot?.();
      const selected = snapshot?.draft?.blocks?.find((block) => block.id === snapshot?.selectedId);
      return blockWorld?.openBlock?.(!(selected?.open === true));
    },
    inspect: () => blockWorld?.inspectBlock?.(),
    'move-left': () => blockWorld?.moveSelected?.({ dx: -1, dy: 0, dz: 0 }),
    grab: () => blockWorld?.grabSelected?.(),
    hold: () => blockWorld?.holdSelected?.({ dx: 1, dy: 0, dz: 0 }),
    place: () => blockWorld?.placeHeld?.(),
    // View controls remain renderer-local. They delegate to the canonical
    // Block World instance and never create a second projection/state owner.
    'depth-3d': () => blockWorld?.setSemanticDepthMode?.('3d', 'quick-action'),
    'depth-4d': () => blockWorld?.setSemanticDepthMode?.('4d', 'quick-action'),
    'depth-5d': () => blockWorld?.setSemanticDepthMode?.('5d', 'quick-action'),
    'linked-previous': () => blockWorld?.navigateLinkedBlock?.('previous', 'quick-action'),
    'linked-next': () => blockWorld?.navigateLinkedBlock?.('next', 'quick-action'),
  },
  onAction: (receipt) => projectionBridge.emitIntent(
    'projection.block-world-quick-action',
    receipt?.source ?? 'block-world-quick-actions',
    Object.freeze({
      ...receipt,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
    }),
  ),
});
window.__TUMBO_BLOCK_WORLD_QUICK_ACTIONS__ = cubeQuickActions;
// Closing the focused cube workspace is also a presentation change: restore
// the organic layers, floor field, and ordinary navigation rails so the next
// view is not left half-hidden or trapped behind the cube-focus flag.
document.getElementById('block-world-close')?.addEventListener('click', () => {
  blockWorldRuntimeSync?.close();
  setBlockWorldPresentation(false);
  setBlockWorldFocusMode(false);
});
window.__TUMBO_BLOCK_WORLD__ = blockWorld;
// Free 3D manipulation toolbar (additive, 2026-09-18). Touch-first: Tumbo has
// no mouse, so these are large touch buttons, not just keyboard shortcuts.
// Every handler delegates to the already-mounted Block World layer.
const manipulateButtons = {
  translate: document.getElementById('block-world-manipulate-move'),
  rotate: document.getElementById('block-world-manipulate-rotate'),
  scale: document.getElementById('block-world-manipulate-stretch'),
};
const manipulateOffButton = document.getElementById('block-world-manipulate-off');
const manipulateStatusEl = document.getElementById('block-world-manipulate-status');
function refreshManipulateButtons() {
  const mode = blockWorld?.getManipulateMode?.() ?? null;
  for (const [key, button] of Object.entries(manipulateButtons)) {
    if (!button) continue;
    button.setAttribute('aria-pressed', String(mode === key));
    button.classList?.toggle?.('active', mode === key);
  }
  if (manipulateStatusEl) {
    manipulateStatusEl.textContent = mode
      ? `MANIPULATE ${mode.toUpperCase()} · TAP A CUBE · DRAG THE GIZMO · LOCAL ONLY`
      : 'MANIPULATE OFF · PICK MOVE, ROTATE, OR STRETCH · LOCAL ONLY';
  }
}
for (const [mode, button] of Object.entries(manipulateButtons)) {
  button?.addEventListener('click', () => {
    blockWorld?.setManipulateMode?.(mode);
    refreshManipulateButtons();
  });
}
manipulateOffButton?.addEventListener('click', () => {
  blockWorld?.setManipulateMode?.(null);
  refreshManipulateButtons();
});
refreshManipulateButtons();
window.__TUMBO_MANIPULATE__ = {
  setMode: (mode) => { const out = blockWorld?.setManipulateMode?.(mode); refreshManipulateButtons(); return out; },
  getMode: () => blockWorld?.getManipulateMode?.() ?? null,
  getSnapshot: () => blockWorld?.getManipulatorSnapshot?.() ?? null,
};

// World Pulse event records and structured UNHCR humanitarian rows are
// projected as cube-only evidence markers inside the existing Block World
// layer. They are rebuilt from fetched provider rows, never from a bundled
// fixture, and disappear completely when a provider returns an
// unavailable/empty state.
worldEvidenceLayer = new THREE.Group();
worldEvidenceLayer.name = 'world-events-evidence-cubes';
worldEvidenceLayer.visible = false;
blockWorld.layer?.add(worldEvidenceLayer);
window.__TUMBO_WORLD_EVENTS_LAYER__ = worldEvidenceLayer;

function stableWorldEvidenceHash(value) {
  let hash = 2166136261;
  for (const character of String(value ?? '')) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function clearWorldEvidenceCubes() {
  hoveredWorldEvidence = null;
  worldEvidenceManipulation = null;
  worldEvidenceLastTap = null;
  for (const mesh of worldEvidenceInnerMeshes) {
    mesh.parent?.remove?.(mesh);
    worldEvidenceLayer?.remove(mesh);
    mesh.geometry?.dispose?.();
    mesh.material?.dispose?.();
  }
  worldEvidenceInnerMeshes.clear();
  for (const mesh of worldEvidenceMeshes) {
    worldEvidenceLayer?.remove(mesh);
    const index = raycastTargets.indexOf(mesh);
    if (index >= 0) raycastTargets.splice(index, 1);
    mesh.geometry?.dispose?.();
    mesh.material?.dispose?.();
  }
  worldEvidenceMeshes.clear();
}

function isHumanitarianEvidenceRecord(record) {
  return record?.providerId === 'unhcr-population'
    || record?.kind === 'public-population-context-observation';
}

function worldEvidenceRecordFor(recordId) {
  const summary = worldEventsConsole?.getSnapshot?.().summary;
  return summary?.records?.find((candidate) => candidate.id === recordId)
    ?? summary?.humanitarian?.records?.find((candidate) => candidate.id === recordId)
    ?? summary?.humanitarianRecords?.find((candidate) => candidate.id === recordId)
    ?? null;
}

function captureWorldEvidenceReturnContext() {
  const record = worldEvidenceRecordFor(worldEvidenceFocusedRecordId);
  const mesh = worldEvidenceMeshFor(worldEvidenceFocusedRecordId);
  if (!record || !mesh) {
    worldEvidenceReturnContext = null;
    return null;
  }
  const context = Object.freeze({
    recordId: record.id,
    providerId: record.providerId ?? null,
    sourceUrl: record.sourceUrl ?? null,
    humanitarian: isHumanitarianEvidenceRecord(record),
    localPosition: Object.freeze({
      x: Number(mesh.position.x.toFixed(4)),
      y: Number(mesh.position.y.toFixed(4)),
      z: Number(mesh.position.z.toFixed(4)),
    }),
    opened: worldEvidenceOpenIds.has(record.id),
  });
  worldEvidenceReturnContext = context;
  return context;
}

function restoreWorldEvidenceReturnContext(method = 'portal-return') {
  const context = worldEvidenceReturnContext;
  // A portal can be opened from the cube field without first selecting an
  // evidence marker. In that case there is no focused record to restore, but
  // the already-fetched projection is still the user's field. Re-show only
  // the cubes represented by the in-memory provider envelope; an unavailable
  // or empty envelope stays empty and never receives synthetic markers.
  if (!context?.recordId) {
    const summary = worldEventsConsole?.getSnapshot?.().summary;
    const records = Array.isArray(summary?.records) ? summary.records : [];
    const humanitarianRecords = Array.isArray(summary?.humanitarian?.records)
      ? summary.humanitarian.records
      : Array.isArray(summary?.humanitarianRecords) ? summary.humanitarianRecords : [];
    if (records.length > 0 || humanitarianRecords.length > 0) {
      worldEvidenceLayer && (worldEvidenceLayer.visible = true);
    }
    return null;
  }
  const record = worldEvidenceRecordFor(context.recordId);
  const mesh = worldEvidenceMeshFor(context.recordId);
  if (!record || !mesh) {
    worldEvidenceReturnContext = null;
    return null;
  }
  const position = context.localPosition;
  if (position && Number.isFinite(position.x) && Number.isFinite(position.y) && Number.isFinite(position.z)) {
    mesh.position.set(position.x, position.y, position.z);
    worldEvidenceLocalPositions.set(record.id, { x: position.x, z: position.z });
  }
  if (context.opened) {
    worldEvidenceOpenIds.add(record.id);
    rebuildWorldEvidenceInnerCubes(record);
  }
  worldEvidenceLayer && (worldEvidenceLayer.visible = true);
  showWorldEvidenceReadout(record, method);
  projectionBridge.emitIntent('projection.restore-world-evidence-context', record.id, Object.freeze({
    action: 'restore',
    method,
    recordId: record.id,
    providerId: record.providerId ?? null,
    sourceUrl: record.sourceUrl ?? null,
    humanitarian: isHumanitarianEvidenceRecord(record),
    localPosition: position ?? null,
    opened: context.opened === true,
    severityStatus: record.severityStatus ?? 'unknown',
    intensityStatus: record.intensityStatus ?? 'unknown',
    simulation: true,
    localOnly: true,
    externalNetwork: false,
    persistence: false,
    executable: false,
  }));
  return context;
}

function formatHumanitarianMetric(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(numeric)
    : 'UNKNOWN';
}

function clampWorldEvidenceField(value) {
  return Math.max(-4.65, Math.min(4.65, Number(value) || 0));
}

function worldEvidencePointerPoint(input = {}) {
  const x = Number(input.clientX ?? input.x);
  const y = Number(input.clientY ?? input.y);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function worldEvidenceDragDelta(start, end, threshold = 18) {
  if (!start || !end) return null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) return null;
  // Keep the move bounded and predictable: one horizontal or depth step per
  // gesture, exactly like the ordinary Block World cubes.
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: dx < 0 ? -0.86 : 0.86, z: 0 }
    : { x: 0, z: dy < 0 ? -0.86 : 0.86 };
}

function worldEvidenceMeshFor(recordId) {
  return [...worldEvidenceMeshes].find((mesh) => mesh.userData?.worldEvidenceRecordId === recordId) ?? null;
}

function removeWorldEvidenceInnerMeshes(recordId) {
  for (const mesh of [...worldEvidenceInnerMeshes]) {
    if (mesh.userData?.worldEvidenceRecordId !== recordId) continue;
    mesh.parent?.remove?.(mesh);
    worldEvidenceLayer?.remove(mesh);
    const index = raycastTargets.indexOf(mesh);
    if (index >= 0) raycastTargets.splice(index, 1);
    mesh.geometry?.dispose?.();
    mesh.material?.dispose?.();
    worldEvidenceInnerMeshes.delete(mesh);
  }
}

function addWorldEvidenceInnerCube(record, label, offset, color, kind) {
  const outer = worldEvidenceMeshFor(record.id);
  if (!outer) return null;
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(.24, .24, .24),
    new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 1.35,
      metalness: .2,
      roughness: .38,
    }),
  );
  cube.position.set(offset.x, offset.y, offset.z);
  cube.userData.worldEvidenceRecordId = record.id;
  cube.userData.worldEvidenceInnerKind = kind;
  cube.userData.worldEvidenceInnerLabel = label;
  // The inner cubes remain ordinary boxes, but are parented to the evidence
  // block so moving the block carries its source/time/place/signal contents
  // with it.
  outer.add(cube);
  worldEvidenceInnerMeshes.add(cube);
  // Nested cubes are valid interaction targets too. Resolving through their
  // parent keeps selection and movement attached to the live evidence block.
  raycastTargets.push(cube);
  return cube;
}

function rebuildWorldEvidenceInnerCubes(record) {
  if (!record?.id) return;
  removeWorldEvidenceInnerMeshes(record.id);
  if (!worldEvidenceOpenIds.has(record.id)) return;
  if (isHumanitarianEvidenceRecord(record)) {
    // Structured UNHCR rows are not event records. Their nested cubes expose
    // only provider-returned source/year/metric fields; no location,
    // severity, brutality, casualty, or intensity value is inferred.
    if (record.sourceUrl) {
      addWorldEvidenceInnerCube(record, 'UNHCR source', { x: -.52, y: .42, z: .08 }, 0xffd27a, 'source');
    }
    if (Number.isInteger(record.observedYear)) {
      addWorldEvidenceInnerCube(record, `year ${record.observedYear}`, { x: 0, y: .62, z: .08 }, 0x9fd6ff, 'year');
    }
    const metrics = Object.entries(record.metrics ?? {})
      .filter(([, value]) => value !== null && value !== undefined && Number.isFinite(Number(value)))
      .slice(0, 4);
    const offsets = [
      { x: -.48, y: .86, z: .08 },
      { x: .48, y: .86, z: .08 },
      { x: -.24, y: 1.1, z: .08 },
      { x: .24, y: 1.1, z: .08 },
    ];
    metrics.forEach(([field, value], index) => {
      const label = `${field.replaceAll('_', ' ')} ${formatHumanitarianMetric(value)}`;
      addWorldEvidenceInnerCube(record, label, offsets[index], 0x76e0c8, `metric:${field}`);
    });
    const outer = worldEvidenceMeshFor(record.id);
    if (outer) outer.userData.worldEvidenceOpen = true;
    return;
  }
  addWorldEvidenceInnerCube(record, 'source', { x: -.52, y: .46, z: .08 }, 0xffd27a, 'source');
  if (record.sourceObservedAt || record.eventTime) {
    addWorldEvidenceInnerCube(record, 'time', { x: 0, y: .62, z: .08 }, 0xff9fbd, 'time');
  }
  if (record.coordinates) {
    addWorldEvidenceInnerCube(record, 'place', { x: .52, y: .46, z: .08 }, 0x91d7ff, 'place');
  }
  const signalLevel = Math.max(0, Math.min(3, Number(record.brutalityLanguageSignal?.level) || 0));
  if (signalLevel > 0) {
    // The signal cube makes the projection inspectable from the inside too:
    // it records that a headline keyword was matched, never that the event's
    // severity or casualties were measured.
    const signalColors = [0, 0xffa85f, 0xff6f85, 0xffd2dc];
    addWorldEvidenceInnerCube(record, 'title-language signal', { x: 0, y: .9, z: .08 }, signalColors[signalLevel], 'signal');
  }
  const outer = worldEvidenceMeshFor(record.id);
  if (outer) outer.userData.worldEvidenceOpen = true;
}

function toggleWorldEvidenceOpen(record, method = 'tap') {
  if (!record?.id) return null;
  if (worldEvidenceOpenIds.has(record.id)) worldEvidenceOpenIds.delete(record.id);
  else worldEvidenceOpenIds.add(record.id);
  rebuildWorldEvidenceInnerCubes(record);
  const opened = worldEvidenceOpenIds.has(record.id);
  const outer = worldEvidenceMeshFor(record.id);
  if (outer) {
    outer.userData.worldEvidenceOpen = opened;
    outer.scale.setScalar(opened ? 1.12 : 1);
  }
  showWorldEvidenceReadout(record, opened ? 'open' : 'close');
  projectionBridge.emitIntent('projection.interact-world-evidence', record.id, Object.freeze({
    action: opened ? 'open' : 'close',
    method,
    recordId: record.id,
    brutalityLanguageSignal: record.brutalityLanguageSignal ?? null,
    humanitarian: isHumanitarianEvidenceRecord(record),
    observedYear: record.observedYear ?? null,
    severityStatus: record.severityStatus ?? 'unknown',
    intensityStatus: record.intensityStatus ?? 'unknown',
    sourceUrl: record.sourceUrl,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
  }));
  return opened;
}

function renderWorldEvidenceCubes(input) {
  if (!worldEvidenceLayer) return;
  clearWorldEvidenceCubes();
  const summary = input?.summary ?? input;
  const records = Array.isArray(summary?.records) ? summary.records : [];
  records.slice(0, 12).forEach((record, index) => {
    if (!record?.id || !record?.sourceUrl || !record?.title) return;
    const brutalityLevel = Math.max(0, Math.min(3, Number(record.brutalityLanguageSignal?.level) || 0));
    const color = [0xffbd68, 0xffa85f, 0xff6f85, 0xffd2dc][brutalityLevel];
    const emissive = [0x7a3e12, 0x8c3c16, 0x8f1735, 0xc42f68][brutalityLevel];
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(.58 + brutalityLevel * .07, .58 + brutalityLevel * .07, .58 + brutalityLevel * .07),
      new THREE.MeshStandardMaterial({
        color,
        emissive,
        emissiveIntensity: 1.05 + brutalityLevel * .28,
        metalness: .35,
        roughness: .24,
        transparent: true,
        opacity: .94,
      }),
    );
    const hash = stableWorldEvidenceHash(record.id);
    const column = index % 6;
    const row = Math.floor(index / 6);
    const jitterX = ((hash & 0xff) / 255 - .5) * .22;
    const jitterZ = (((hash >>> 8) & 0xff) / 255 - .5) * .22;
    const longitude = Number(record.coordinates?.longitude);
    const latitude = Number(record.coordinates?.latitude);
    const hasCoordinates = Number.isFinite(longitude) && Number.isFinite(latitude)
      && longitude >= -180 && longitude <= 180
      && latitude >= -90 && latitude <= 90;
    // Coordinate-bearing records use a compact equirectangular world field;
    // records without a provider coordinate stay on a deterministic
    // "unlocated" shelf so the renderer never invents a place for them.
    const baseX = hasCoordinates
      ? -3.45 + ((longitude + 180) / 360) * 6.9 + jitterX
      : -3.9 + column * 1.55 + jitterX;
    const baseZ = hasCoordinates
      ? -3.35 + ((90 - latitude) / 180) * 6.7 + jitterZ
      : 1.1 + jitterZ;
    const localPosition = worldEvidenceLocalPositions.get(record.id);
    const x = Number.isFinite(localPosition?.x) ? localPosition.x : baseX;
    const z = Number.isFinite(localPosition?.z) ? localPosition.z : baseZ;
    if (!localPosition) worldEvidenceLocalPositions.set(record.id, { x, z });
    // Height and glow are a readable *language signal* from the returned title,
    // not a claim that the event itself has a measurable severity.
    cube.position.set(x, 3.2 + row * 1.2 + brutalityLevel * .18, z);
    cube.userData.worldEvidenceRecordId = record.id;
    cube.userData.worldEvidenceSourceUrl = record.sourceUrl;
    cube.userData.worldEvidenceClassification = record.classification ?? 'public-source observation';
    cube.userData.worldEvidenceCoordinates = record.coordinates ?? null;
    cube.userData.worldEvidenceGeography = hasCoordinates ? 'provider-reported' : 'unavailable';
    cube.userData.worldEvidenceBrutalityLevel = brutalityLevel;
    cube.userData.worldEvidenceBrutalityBand = record.brutalityLanguageSignal?.band ?? 'none';
    cube.userData.worldEvidenceBrutalityTerms = record.brutalityLanguageSignal?.matchedTerms ?? [];
    cube.userData.worldEvidenceOpen = worldEvidenceOpenIds.has(record.id);
    worldEvidenceLayer.add(cube);
    worldEvidenceMeshes.add(cube);
    raycastTargets.push(cube);
    if (worldEvidenceOpenIds.has(record.id)) rebuildWorldEvidenceInnerCubes(record);
  });
  const humanitarianRecords = Array.isArray(summary?.humanitarian?.records)
    ? summary.humanitarian.records
    : Array.isArray(summary?.humanitarianRecords) ? summary.humanitarianRecords : [];
  humanitarianRecords.slice(0, 12).forEach((record, index) => {
    // A row is projected only when the provider supplied its stable id and
    // source URL. Missing rows stay in the panel's explicit no-data state;
    // this renderer never invents a source, coordinate, year, or metric.
    if (!record?.id || !record?.sourceUrl) return;
    const hash = stableWorldEvidenceHash(record.id);
    const column = index % 6;
    const row = Math.floor(index / 6);
    const jitterX = ((hash & 0xff) / 255 - .5) * .22;
    const jitterZ = (((hash >>> 8) & 0xff) / 255 - .5) * .22;
    const baseX = -3.9 + column * 1.55 + jitterX;
    // Keep structured annual rows on their own shelf beside event cubes. The
    // shelf is not a map: UNHCR rows without provider coordinates are never
    // geocoded or assigned a country position by this projection.
    const baseZ = 2.65 + jitterZ;
    const localPosition = worldEvidenceLocalPositions.get(record.id);
    const x = Number.isFinite(localPosition?.x) ? localPosition.x : baseX;
    const z = Number.isFinite(localPosition?.z) ? localPosition.z : baseZ;
    if (!localPosition) worldEvidenceLocalPositions.set(record.id, { x, z });
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(.72, .72, .72),
      new THREE.MeshStandardMaterial({
        color: 0x65d6c7,
        emissive: 0x166b73,
        emissiveIntensity: 1.25,
        metalness: .28,
        roughness: .3,
        transparent: true,
        opacity: .95,
      }),
    );
    cube.position.set(x, 3.0 + row * 1.05, z);
    cube.userData.worldEvidenceRecordId = record.id;
    cube.userData.worldEvidenceKind = 'humanitarian';
    cube.userData.worldEvidenceHumanitarian = true;
    cube.userData.worldEvidenceSourceUrl = record.sourceUrl;
    cube.userData.worldEvidenceCoordinates = null;
    cube.userData.worldEvidenceGeography = record.geographyStatus ?? 'unavailable';
    cube.userData.worldEvidenceObservedYear = record.observedYear ?? null;
    cube.userData.worldEvidenceMetricCount = record.suppliedMetricCount ?? 0;
    cube.userData.worldEvidenceBrutalityLevel = 0;
    cube.userData.worldEvidenceBrutalityBand = 'unknown';
    cube.userData.worldEvidenceSeverityStatus = record.severityStatus ?? 'unknown';
    cube.userData.worldEvidenceIntensityStatus = record.intensityStatus ?? 'unknown';
    cube.userData.worldEvidenceOpen = worldEvidenceOpenIds.has(record.id);
    worldEvidenceLayer.add(cube);
    worldEvidenceMeshes.add(cube);
    raycastTargets.push(cube);
    if (worldEvidenceOpenIds.has(record.id)) rebuildWorldEvidenceInnerCubes(record);
  });
  worldEvidenceLayer.visible = records.length > 0 || humanitarianRecords.length > 0;
}

function resolveWorldEvidenceTarget(object) {
  let current = object;
  while (current) {
    const recordId = current.userData?.worldEvidenceRecordId;
    if (recordId) {
      return worldEvidenceRecordFor(recordId);
    }
    current = current.parent;
  }
  return null;
}

function showWorldEvidenceReadout(record, method = 'select') {
  if (!record) return;
  if (method !== 'hover') worldEvidenceFocusedRecordId = record.id;
  if (isHumanitarianEvidenceRecord(record)) {
    const geography = record.geography;
    const dimensions = [];
    if (geography?.origin) dimensions.push(`origin ${geography.origin.name ?? geography.origin.code ?? 'unknown'}`);
    if (geography?.asylum) dimensions.push(`asylum ${geography.asylum.name ?? geography.asylum.code ?? 'unknown'}`);
    const geographyLabel = dimensions.length ? dimensions.join(' · ') : 'geography unavailable';
    const metrics = Object.entries(record.metrics ?? {})
      .filter(([, value]) => value !== null && value !== undefined && Number.isFinite(Number(value)))
      .slice(0, 6)
      .map(([field, value]) => `${field.replaceAll('_', ' ')} ${formatHumanitarianMetric(value)}`)
      .join(' · ') || 'provider metrics unavailable';
    showReadout({
      eyebrow: 'WORLD PULSE · STRUCTURED HUMANITARIAN EVIDENCE',
      title: record.title ?? 'Annual forced-displacement population observation',
      body: `${record.provider ?? 'UNHCR Refugee Data Finder'} · year ${record.observedYear ?? 'unavailable'} · retrieved ${record.retrievedAt ?? 'unavailable'} · ${metrics} · ${geographyLabel} · event time unavailable · severity unknown · intensity unknown · source URL available in World Pulse; refresh explicitly there for current provider data.`,
      tags: ['UNHCR', 'PUBLIC SOURCE', 'SEVERITY UNKNOWN', 'INTENSITY UNKNOWN', method.toUpperCase()],
    });
    return;
  }
  const sourceLabel = record.provider ?? 'public source';
  const observed = record.sourceObservedAt ?? 'observed time unavailable';
  const eventTime = record.eventTime ?? 'event time unavailable';
  const geography = record.coordinates
    ? `${record.coordinates.latitude.toFixed(2)}°, ${record.coordinates.longitude.toFixed(2)}°`
    : 'location unavailable';
  const brutality = record.brutalityLanguageSignal;
  const brutalityLabel = brutality?.label ?? 'no brutality language signal';
  const brutalityTerms = brutality?.matchedTerms?.length ? ` · matched title terms ${brutality.matchedTerms.join(', ')}` : '';
  showReadout({
    eyebrow: 'WORLD PULSE · PUBLIC EVIDENCE',
    title: record.title,
    body: `${sourceLabel} · ${record.classification ?? 'public-source observation'} · ${brutalityLabel}${brutalityTerms} · retrieved ${record.retrievedAt ?? 'unavailable'} · observed ${observed} · event ${eventTime} · map ${geography} · title signal only, not verified severity · source URL available in World Pulse; refresh explicitly there for current provider data.`,
    tags: ['PUBLIC SOURCE', 'UNCERTAINTY 1.00', method.toUpperCase()],
  });
}

function beginWorldEvidenceManipulation(record, input = {}) {
  if (!record?.id) return null;
  const mesh = worldEvidenceMeshFor(record.id);
  const start = worldEvidencePointerPoint(input);
  if (!mesh || !start) return null;
  worldEvidenceManipulation = {
    recordId: record.id,
    mesh,
    pointerId: Number.isInteger(input.pointerId) ? input.pointerId : null,
    start,
    current: start,
    startPosition: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
  };
  worldEventsConsole?.selectRecord?.(record.id, 'canvas');
  showWorldEvidenceReadout(record, 'select');
  return worldEvidenceManipulation;
}

function updateWorldEvidenceManipulation(input = {}) {
  const gesture = worldEvidenceManipulation;
  if (!gesture) return null;
  if (Number.isInteger(gesture.pointerId) && Number.isInteger(input.pointerId) && input.pointerId !== gesture.pointerId) return null;
  const point = worldEvidencePointerPoint(input);
  if (!point) return null;
  const scale = Math.max(0.006, Math.min(0.018, 12 / Math.max(1, innerWidth)));
  const previewX = clampWorldEvidenceField(gesture.startPosition.x + (point.x - gesture.start.x) * scale);
  const previewZ = clampWorldEvidenceField(gesture.startPosition.z + (point.y - gesture.start.y) * scale);
  gesture.current = point;
  gesture.previewPosition = { x: previewX, y: gesture.startPosition.y, z: previewZ };
  gesture.mesh.position.x = previewX;
  gesture.mesh.position.z = previewZ;
  return gesture;
}

function completeWorldEvidenceManipulation(input = {}, cancelled = false) {
  const gesture = worldEvidenceManipulation;
  if (!gesture) return null;
  if (Number.isInteger(gesture.pointerId) && Number.isInteger(input.pointerId) && input.pointerId !== gesture.pointerId) return null;
  const record = worldEvidenceRecordFor(gesture.recordId);
  const point = worldEvidencePointerPoint(input) ?? gesture.current;
  const delta = cancelled ? null : worldEvidenceDragDelta(gesture.start, point);
  worldEvidenceManipulation = null;
  if (!record) return null;
  if (!delta) {
    // Restore the exact start position for a tap/cancel, then use the same
    // bounded two-tap contract as the ordinary Block World containers.
    gesture.mesh.position.set(gesture.startPosition.x, gesture.startPosition.y, gesture.startPosition.z);
    const previous = worldEvidenceLastTap;
    const now = Date.now();
    const closeEnough = previous
      && previous.recordId === record.id
      && now - previous.timestamp <= 420
      && Math.hypot(point.x - previous.point.x, point.y - previous.point.y) <= 28;
    if (closeEnough) {
      worldEvidenceLastTap = null;
      toggleWorldEvidenceOpen(record, 'double-activate');
    } else if (!cancelled) {
      worldEvidenceLastTap = { recordId: record.id, timestamp: now, point };
      showWorldEvidenceReadout(record, 'select');
    }
    return { action: cancelled ? 'world-evidence-drag-cancel' : 'world-evidence-tap', recordId: record.id, localOnly: true };
  }
  const next = {
    x: clampWorldEvidenceField(gesture.startPosition.x + delta.x),
    y: gesture.startPosition.y,
    z: clampWorldEvidenceField(gesture.startPosition.z + delta.z),
  };
  gesture.mesh.position.set(next.x, next.y, next.z);
  worldEvidenceLocalPositions.set(record.id, { x: next.x, z: next.z });
  worldEvidenceLastTap = null;
  showWorldEvidenceReadout(record, 'move');
  projectionBridge.emitIntent('projection.move-world-evidence', record.id, Object.freeze({
    action: 'move',
    method: 'direct-drag',
    recordId: record.id,
    from: [gesture.startPosition.x, gesture.startPosition.y, gesture.startPosition.z],
    to: [next.x, next.y, next.z],
    delta,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
  }));
  return { action: 'world-evidence-move', recordId: record.id, from: gesture.startPosition, to: next, delta, localOnly: true };
}

// Browser diagnostics and assistive hosts can drive the same local evidence
// affordances without reaching into Three.js objects. This handle is not a
// second state store and exposes no provider, persistence, or transfer API.
window.__TUMBO_WORLD_EVIDENCE__ = Object.freeze({
  open: (recordId, method = 'api') => {
    const record = worldEvidenceRecordFor(recordId);
    return record ? toggleWorldEvidenceOpen(record, method) : null;
  },
  move: (recordId, delta = { x: 0.86, z: 0 }, method = 'api') => {
    const record = worldEvidenceRecordFor(recordId);
    const mesh = worldEvidenceMeshFor(recordId);
    if (!record || !mesh) return null;
    const from = { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z };
    const to = { x: clampWorldEvidenceField(from.x + Number(delta?.x || 0)), y: from.y, z: clampWorldEvidenceField(from.z + Number(delta?.z || 0)) };
    mesh.position.set(to.x, to.y, to.z);
    worldEvidenceLocalPositions.set(recordId, { x: to.x, z: to.z });
    projectionBridge.emitIntent('projection.move-world-evidence', recordId, Object.freeze({ action: 'move', method, recordId, from: [from.x, from.y, from.z], to: [to.x, to.y, to.z], localOnly: true, simulation: true, externalNetwork: false, externalTransfer: false, persistence: false, executable: false }));
    return Object.freeze({ action: 'move', recordId, from, to, localOnly: true });
  },
  getSnapshot: () => Object.freeze({
    focusedRecordId: worldEvidenceFocusedRecordId,
    returnContext: worldEvidenceReturnContext,
    openRecordIds: [...worldEvidenceOpenIds],
    positions: [...worldEvidenceLocalPositions.entries()].map(([id, position]) => Object.freeze({ id, ...position })),
    meshCount: worldEvidenceMeshes.size,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    persistence: false,
    executable: false,
  }),
});

// Tennis records use the same cube-first substrate as World Pulse.  These
// markers are evidence pointers only: the match console remains the source of
// the full player/ranking/set-score record and no round/organic layer is
// introduced into the focused field.
sportsEvidenceLayer = new THREE.Group();
sportsEvidenceLayer.name = 'sports-events-evidence-cubes';
sportsEvidenceLayer.visible = false;
blockWorld.layer?.add(sportsEvidenceLayer);
window.__TUMBO_SPORTS_EVENTS_LAYER__ = sportsEvidenceLayer;

function clearSportsEvidenceCubes() {
  hoveredSportsEvidence = null;
  for (const mesh of sportsEvidenceMeshes) {
    sportsEvidenceLayer?.remove(mesh);
    const index = raycastTargets.indexOf(mesh);
    if (index >= 0) raycastTargets.splice(index, 1);
    mesh.geometry?.dispose?.();
    mesh.material?.dispose?.();
  }
  sportsEvidenceMeshes.clear();
  if (sportsEvidenceLayer) sportsEvidenceLayer.visible = false;
}

function renderSportsEvidenceCubes(input) {
  if (!sportsEvidenceLayer) return;
  clearSportsEvidenceCubes();
  const summary = input?.summary ?? input;
  const records = Array.isArray(summary?.records) ? summary.records : [];
  records.slice(0, 12).forEach((record, index) => {
    if (!record?.id || !record?.sourceUrl) return;
    const cube = new THREE.Mesh(
      new THREE.BoxGeometry(.72, .72, .72),
      new THREE.MeshStandardMaterial({
        color: record.setScores?.length ? 0x6fc7ff : 0x806dff,
        emissive: record.setScores?.length ? 0x1c5e9e : 0x3f247c,
        emissiveIntensity: record.setScores?.length ? 1.55 : 1.1,
        metalness: .32,
        roughness: .25,
        transparent: true,
        opacity: .95,
      }),
    );
    const hash = stableWorldEvidenceHash(record.id);
    const column = index % 6;
    const row = Math.floor(index / 6);
    const jitterX = ((hash & 0xff) / 255 - .5) * .22;
    const jitterZ = (((hash >>> 8) & 0xff) / 255 - .5) * .22;
    cube.position.set(-3.9 + column * 1.55 + jitterX, 1.95 + row * 1.15, -1.05 + jitterZ);
    cube.userData.sportsEvidenceRecordId = record.id;
    cube.userData.sportsEvidenceSourceUrl = record.sourceUrl;
    cube.userData.sportsEvidenceTour = record.tour ?? null;
    cube.userData.sportsEvidenceSetScoreStatus = record.setScoreStatus ?? 'unavailable';
    sportsEvidenceLayer.add(cube);
    sportsEvidenceMeshes.add(cube);
    raycastTargets.push(cube);
  });
  sportsEvidenceLayer.visible = records.length > 0;
}

function resolveSportsEvidenceTarget(object) {
  let current = object;
  while (current) {
    const recordId = current.userData?.sportsEvidenceRecordId;
    if (recordId) {
      return sportsEventsConsole?.getSnapshot?.().summary?.records?.find((record) => record.id === recordId) ?? null;
    }
    current = current.parent;
  }
  return null;
}

function showSportsEvidenceReadout(record, method = 'select') {
  if (!record) return;
  const players = (record.players ?? record.competitors ?? []).map((player) => {
    const rank = Number.isSafeInteger(player.rank) ? ` #${player.rank}` : ' rank unavailable';
    return `${player.name ?? player.displayName ?? 'player unavailable'}${rank}`;
  }).join(' vs ');
  const sets = record.setScores?.length
    ? record.setScores.map((set) => `S${set.set} ${(set.scores ?? []).map((score) => score.displayValue ?? '—').join('–')}`).join(' · ')
    : 'set scores unavailable';
  const status = record.status?.label ?? record.status ?? 'status unavailable';
  const grade = record.dataCompletenessGrade ?? record.dataGrade ?? '—';
  showReadout({
    eyebrow: 'TENNIS EVIDENCE · PUBLIC READ',
    title: `${record.tournament?.label ?? 'Tennis match'} · ${players}`,
    body: `${record.tour?.toUpperCase() ?? 'TENNIS'} · ${status} · ${sets} · retrieved ${record.retrievedAt ?? 'unavailable'} · play-by-play ${record.timeline?.available ? 'provider-reported' : 'unavailable'} · data grade ${grade} (completeness only) · source URL available in Tennis Evidence; refresh explicitly there for current provider data.`,
    tags: ['PUBLIC SOURCE', 'NO ODDS', method.toUpperCase()],
  });
}

// A portal destination needs an obvious same-page way back to the cube field.
// This handoff is presentation-only: the block renderer keeps its canonical
// and local-draft snapshots in memory while Feature Navigator selects the
// existing Block World surface without changing the URL.
portalReturn = createPortalReturnHandoff({
  documentRoot: document,
  onReturn: (snapshot) => {
    projectionBridge.emitIntent('projection.return-to-cube-field', PORTAL_RETURN_SOURCE, Object.freeze({
      action: snapshot.action,
      method: snapshot.method,
      sourceBlockId: snapshot.sourceBlockId,
      sourceCoordinate: snapshot.sourceCoordinate,
      targetFeature: snapshot.targetFeature,
      routeId: snapshot.routeId,
      preservedDraft: snapshot.preservedDraft === true,
      preservedPortalTrace: snapshot.preservedPortalTrace === true,
      simulation: true,
      deterministic: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
    }));
    portalCubeSubstrateActive = false;
    featureNavigator?.select('block-world', 'portal-return', { updateLocation: false });
    blockWorld?.open();
    const target = blockWorld?.getFocusTarget(snapshot.sourceBlockId);
    if (target) {
      desiredTarget.copy(target);
      desiredCameraPosition.copy(target).add(new THREE.Vector3(0, 7.4, 12.8));
      cameraTween = reducedMotion ? .16 : 1;
      cameraPositionTween = reducedMotion ? .16 : 1;
    }
    // Block World focus mode hides World Pulse while a portal destination is
    // open. Restore the exact returned marker and its readout after the
    // canonical cube workspace is back, without refetching or mutating it.
    restoreWorldEvidenceReturnContext('portal-return');
  },
});
window.__TUMBO_PORTAL_RETURN__ = portalReturn;
// The Block World snapshot console is the data-only handoff for moving the
// actual cube grid between page sessions. It reads the current renderer draft
// on demand and hands validated imports back through the block adapter; it
// never replaces the canonical SIMFABRIC contribution.
blockWorldSnapshot = createBlockWorldSnapshotConsole({
  documentRoot: document,
  projection: blockWorld?.getSnapshot?.()?.draft ?? livingRealityWorld,
  getProjection: () => blockWorld?.getSnapshot?.()?.draft ?? livingRealityWorld,
  onOpen: (snapshot) => projectionBridge.emitIntent('projection.open-block-world-snapshot', BLOCK_WORLD_SNAPSHOT_CONSOLE_SOURCE, Object.freeze({
    blockCount: snapshot?.validation?.blockCount ?? 0,
    contentCount: snapshot?.validation?.contentCount ?? 0,
    simulation: true,
    localOnly: true,
    externalImport: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  })),
  onExport: (result) => projectionBridge.emitIntent('projection.export-block-world-snapshot', BLOCK_WORLD_SNAPSHOT_CONSOLE_SOURCE, Object.freeze({
    status: result?.downloadStatus ?? 'unavailable',
    bytes: result?.bytes ?? 0,
    filename: result?.filename ?? null,
    simulation: true,
    localOnly: true,
    externalImport: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  })),
  onLoad: (result) => projectionBridge.emitIntent('projection.load-block-world-snapshot', BLOCK_WORLD_SNAPSHOT_CONSOLE_SOURCE, Object.freeze({
    accepted: result?.accepted === true,
    blockCount: result?.validation?.blockCount ?? 0,
    contentCount: result?.validation?.contentCount ?? 0,
    simulation: true,
    localOnly: true,
    externalImport: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  })),
  onPreview: (result) => projectionBridge.emitIntent('projection.preview-block-world-snapshot', BLOCK_WORLD_SNAPSHOT_CONSOLE_SOURCE, Object.freeze({
    blockCount: result?.blockCount ?? 0,
    contentCount: result?.contentCount ?? 0,
    simulation: true,
    localOnly: true,
    externalImport: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  })),
  onApply: (result) => {
    const applied = result?.accepted === true
      ? blockWorld?.applyProjectionDraft(result.draft, 'block-world-snapshot')
      : null;
    projectionBridge.emitIntent('projection.apply-block-world-snapshot', BLOCK_WORLD_SNAPSHOT_CONSOLE_SOURCE, Object.freeze({
      accepted: result?.accepted === true && Boolean(applied),
      blockCount: applied?.draft?.blockCount ?? result?.blockCount ?? 0,
      contentCount: applied?.draft?.nestedContentCount ?? result?.contentCount ?? 0,
      simulation: true,
      localOnly: true,
      externalImport: false,
      persistence: false,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    }));
    if (!applied) return;
    blockWorldSnapshot?.close();
    featureNavigator?.select('block-world', 'block-world-snapshot');
    const target = blockWorld?.getFocusTarget(applied.selectedBlock ?? applied.block);
    if (target) {
      desiredTarget.copy(target);
      cameraTween = reducedMotion ? .16 : 1;
    }
  },
  onReplay: (result) => projectionBridge.emitIntent('projection.replay-block-world-snapshot', BLOCK_WORLD_SNAPSHOT_CONSOLE_SOURCE, Object.freeze({
    replayCount: result?.replayCount ?? 0,
    accepted: result?.accepted === true,
    simulation: true,
    localOnly: true,
    externalImport: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  })),
  onReset: (result) => projectionBridge.emitIntent('projection.reset-block-world-snapshot', BLOCK_WORLD_SNAPSHOT_CONSOLE_SOURCE, Object.freeze({
    blockCount: result?.validation?.blockCount ?? 0,
    simulation: true,
    localOnly: true,
    externalImport: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  })),
});
window.__TUMBO_BLOCK_WORLD_SNAPSHOT__ = blockWorldSnapshot;
document.getElementById('block-world-snapshot-open')?.addEventListener('click', () => openBlockWorldSnapshotPanel('block-world'));
document.getElementById('block-migration-block-snapshot-open')?.addEventListener('click', () => openBlockWorldSnapshotPanel('migration'));
document.getElementById('block-world-snapshot-close')?.addEventListener('click', () => blockWorld?.open());
// Merge 4 is an optional, explicit loopback bridge for the cube draft. It is
// deliberately separate from canonical SIMFABRIC state: Connect only checks
// the local runtime, Load validates before applying a renderer draft, and Save
// sends one validated snapshot with the server's expected version. Socket
// updates are a review signal; they never overwrite a local draft silently.
blockWorldRuntimeSync = createBlockWorldRuntimeSync({
  documentRoot: document,
  windowLike: globalThis,
  projection: blockWorld?.getSnapshot?.()?.draft ?? livingRealityWorld,
  getProjection: () => blockWorld?.getSnapshot?.()?.draft ?? livingRealityWorld,
  onOpen: () => {
    projectionBridge.emitIntent('projection.open-block-world-runtime-sync', BLOCK_WORLD_RUNTIME_SYNC_SOURCE, Object.freeze({
      action: 'open',
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      persistence: false,
      executable: false,
    }));
  },
  onConnect: (snapshot) => projectionBridge.emitIntent('projection.connect-block-world-runtime', BLOCK_WORLD_RUNTIME_SYNC_SOURCE, Object.freeze({
    action: snapshot?.action ?? 'connect',
    endpoint: snapshot?.endpoint ?? null,
    worldId: snapshot?.worldId ?? null,
    storage: snapshot?.health?.storage ?? null,
    simulation: true,
    localOnly: true,
    externalNetwork: false,
    persistence: false,
    executable: false,
  })),
  onDisconnect: (snapshot) => projectionBridge.emitIntent('projection.disconnect-block-world-runtime', BLOCK_WORLD_RUNTIME_SYNC_SOURCE, Object.freeze({
    action: snapshot?.action ?? 'disconnect',
    endpoint: snapshot?.endpoint ?? null,
    worldId: snapshot?.worldId ?? null,
    simulation: true,
    localOnly: true,
    externalNetwork: false,
    persistence: false,
    executable: false,
  })),
  onLoad: (result) => {
    const applied = result?.accepted === true && result?.snapshot
      ? blockWorld?.applyProjectionDraft(result.snapshot, 'runtime-load')
      : null;
    blockWorldSnapshot?.syncProjection?.(blockWorld?.getSnapshot?.()?.draft ?? livingRealityWorld);
    if (applied) {
      blockWorld?.open();
      const target = blockWorld?.getFocusTarget(applied.selectedBlock ?? applied.block);
      if (target) {
        desiredTarget.copy(target);
        cameraTween = reducedMotion ? .16 : 1;
      }
    }
    projectionBridge.emitIntent('projection.load-block-world-runtime', BLOCK_WORLD_RUNTIME_SYNC_SOURCE, Object.freeze({
      action: result?.action ?? 'load',
      accepted: result?.accepted === true && Boolean(applied),
      endpoint: result?.endpoint ?? null,
      worldId: result?.worldId ?? null,
      version: result?.version ?? null,
      blockCount: result?.validation?.blockCount ?? 0,
      contentCount: result?.validation?.contentCount ?? 0,
      applied: Boolean(applied),
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      persistence: false,
      executable: false,
    }));
  },
  onSave: (result) => projectionBridge.emitIntent('projection.save-block-world-runtime', BLOCK_WORLD_RUNTIME_SYNC_SOURCE, Object.freeze({
    action: result?.action ?? 'save',
    accepted: result?.accepted === true,
    endpoint: result?.endpoint ?? null,
    worldId: result?.worldId ?? null,
    expectedVersion: result?.expectedVersion ?? null,
    version: result?.version ?? null,
    blockCount: result?.validation?.blockCount ?? 0,
    contentCount: result?.validation?.contentCount ?? 0,
    simulation: true,
    localOnly: true,
    externalNetwork: false,
    persistence: true,
    executable: false,
  })),
  onConflict: (result) => projectionBridge.emitIntent('projection.block-world-runtime-conflict', BLOCK_WORLD_RUNTIME_SYNC_SOURCE, Object.freeze({
    action: result?.action ?? 'conflict',
    conflict: true,
    endpoint: result?.endpoint ?? null,
    worldId: result?.worldId ?? null,
    expectedVersion: result?.expectedVersion ?? null,
    currentVersion: result?.currentVersion ?? null,
    simulation: true,
    localOnly: true,
    externalNetwork: false,
    persistence: false,
    executable: false,
  })),
  onRemoteUpdate: (result) => projectionBridge.emitIntent('projection.block-world-runtime-update', BLOCK_WORLD_RUNTIME_SYNC_SOURCE, Object.freeze({
    action: 'remote-update',
    worldId: result?.worldId ?? null,
    version: result?.version ?? null,
    reviewOnly: true,
    localDraftUnchanged: true,
    simulation: true,
    localOnly: true,
    externalNetwork: false,
    persistence: false,
    executable: false,
  })),
  onCopyRoute: (result) => projectionBridge.emitIntent('projection.copy-block-world-runtime-route', BLOCK_WORLD_RUNTIME_SYNC_SOURCE, Object.freeze({
    action: 'copy-local-route',
    status: result?.status ?? 'manual',
    route: result?.route ?? null,
    worldId: result?.worldId ?? null,
    copied: result?.copied === true,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
  })),
});
blockWorldRuntimeSync.syncProjection?.(blockWorld?.getSnapshot?.()?.draft ?? livingRealityWorld);
window.__TUMBO_BLOCK_WORLD_RUNTIME_SYNC__ = blockWorldRuntimeSync;
function setBlockWorldRuntimeSyncLocation(route = '?panel=runtime-sync') {
  if (!globalThis.history?.replaceState || !globalThis.location) return false;
  try {
    const url = new URL(globalThis.location.href);
    url.search = String(route).startsWith('?') ? String(route).slice(1) : String(route);
    url.hash = '';
    globalThis.history.replaceState(null, '', url);
    return true;
  } catch {
    return false;
  }
}

function showBlockWorldRuntimeSyncPanel() {
  setBlockWorldPresentation(true, { cubeFirstUi: true });
  blockMigration?.close();
  migrationSnapshot?.close();
  blockWorldSnapshot?.close();
  blockWorld?.open();
  blockWorldRuntimeSync?.open();
}
function openBlockWorldRuntimeSync(method = 'button', { selectFeature = true, updateLocation = false, route = '?panel=runtime-sync', worldId = null } = {}) {
  if (worldId !== null && worldId !== undefined) blockWorldRuntimeSync?.setWorldId?.(worldId, 'route');
  const canSelectFeature = typeof featureNavigator?.select === 'function';
  if (selectFeature && canSelectFeature && featureNavigator?.getActiveId?.() !== 'runtime-sync') {
    // Selecting the first-class Mission Control route invokes the runtime-sync
    // branch below. That branch calls this helper with selectFeature:false so
    // the handoff cannot recurse or create a second panel.
    featureNavigator.select('runtime-sync', `runtime-sync:${method}`, { updateLocation: false });
  } else {
    showBlockWorldRuntimeSyncPanel();
  }
  if (updateLocation) setBlockWorldRuntimeSyncLocation(route);
}
document.getElementById('block-world-runtime-sync-open')?.addEventListener('click', () => openBlockWorldRuntimeSync('block-world'));
// The migration bridge is a local manifest/preview console. It makes the
// earlier Arena / Living Reality concepts visible and reusable as block
// mappings while keeping filesystem import, code execution, and persistence
// explicitly outside this demo.
blockMigration = createBlockMigrationConsole({
  documentRoot: document,
  projection: livingRealityWorld,
  onShowInCube: (snapshot) => {
    const coordinate = snapshot?.coordinate;
    const blockSnapshot = blockWorld?.getSnapshot?.();
    let handback = null;
    try {
      handback = resolveBlockMigrationHandback(
        blockSnapshot?.draft ?? blockSnapshot?.canonicalProjection ?? null,
        snapshot?.mapping ?? snapshot?.mappingId,
      );
    } catch {
      // The renderer only emits known manifest rows, but keep this host seam
      // fail-closed if a stale or malformed handoff reaches the callback.
      handback = Object.freeze({
        action: 'show-in-cube-blocked',
        coordinate: Array.isArray(coordinate) ? coordinate : null,
        blockId: null,
        found: false,
        reason: 'unknown-migration-entry',
        returnFeature: 'migration',
      });
    }
    const target = handback?.found === true
      ? blockSnapshot?.draft?.blocks?.find((block) => block.id === handback.blockId) ?? null
      : null;
    projectionBridge.emitIntent('projection.show-migration-mapping-in-cube', BLOCK_MIGRATION_SOURCE, Object.freeze({
      action: handback?.action ?? snapshot?.action ?? 'show-in-cube',
      mappingId: handback?.mappingId ?? snapshot?.mappingId ?? snapshot?.mapping?.id ?? null,
      coordinate: handback?.coordinate ?? coordinate ?? null,
      blockId: handback?.blockId ?? target?.id ?? null,
      returnedToCubeField: handback?.found === true && Boolean(target),
      found: handback?.found === true,
      reason: handback?.reason ?? null,
      returnFeature: handback?.returnFeature ?? snapshot?.returnFeature ?? 'migration',
      simulation: true,
      localOnly: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    }));
    if (!target || handback?.found !== true) return;
    blockMigration?.close();
    migrationSnapshot?.close();
    const selected = featureNavigator?.select('block-world', 'migration-show-in-cube', { updateLocation: false });
    if (!selected) blockWorld?.open();
    const selectedSnapshot = blockWorld?.selectBlock?.(target.id, 'migration-show-in-cube');
    showBlockReadout(selectedSnapshot ?? target, 'migration-show-in-cube');
  },
  onSelect: (snapshot) => projectionBridge.emitIntent('projection.select-migration-mapping', snapshot.mapping?.id ?? BLOCK_MIGRATION_SOURCE, Object.freeze({
    legacyId: snapshot.mapping?.legacyId ?? null,
    targetId: snapshot.mapping?.targetId ?? null,
    status: snapshot.mapping?.status ?? null,
    simulation: true,
    localOnly: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  })),
  onPreview: (snapshot) => projectionBridge.emitIntent('projection.preview-migration', BLOCK_MIGRATION_SOURCE, Object.freeze({
    mappingCount: snapshot.preview?.mappings?.length ?? 0,
    applyCount: snapshot.preview?.applyCount ?? 0,
    simulation: true,
    localOnly: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  })),
  onApply: (snapshot) => {
    const blockDraft = blockWorld?.applyMigrationDraft(snapshot.draft?.blockEdits ?? [], 'migration-bridge');
    // Applying the bridge is also a navigable handoff: land on the first safe
    // mapped cube so the user can immediately open/inspect/move it in the
    // field. The migration console still owns the mapping rehearsal; this
    // only resolves an existing local cube after the draft is accepted.
    const firstAppliedEdit = snapshot.draft?.blockEdits?.find?.((edit) => Array.isArray(edit?.coordinate)) ?? null;
    const firstAppliedBlock = (firstAppliedEdit?.coordinate && blockDraft?.draft?.blocks?.find?.((block) => (
      block.x === firstAppliedEdit.coordinate[0]
      && block.y === firstAppliedEdit.coordinate[1]
      && block.z === firstAppliedEdit.coordinate[2]
    ))) ?? null;
    const selectedAppliedBlock = firstAppliedBlock
      ? blockWorld?.selectBlock?.(firstAppliedBlock.id, 'migration-apply-handoff')
      : null;
    projectionBridge.emitIntent('projection.apply-migration-draft', BLOCK_MIGRATION_SOURCE, Object.freeze({
      appliedCount: blockDraft?.appliedMappingIds?.length ?? snapshot.draft?.mappingIds?.length ?? 0,
      deferredCount: blockDraft?.deferredMappingIds?.length ?? snapshot.draft?.deferredMappingIds?.length ?? 0,
      blockCount: blockDraft?.draft?.blockCount ?? blockDraft?.blockCount ?? null,
      blockEditCount: blockDraft?.editCount ?? null,
      selectedBlockId: selectedAppliedBlock?.id ?? firstAppliedBlock?.id ?? null,
      handoff: selectedAppliedBlock ? 'cube-field' : 'none',
      simulation: true,
      localOnly: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    }));
    // Applying a migration draft hands the viewer back to the voxel layer so
    // the old concepts and their current block destination remain visible.
    blockMigration?.close();
    // Keep Mission Control in the same surface as the visible field. Without
    // this, a successful apply opened Block World while the navigator still
    // described Migration Bridge, so subsequent controls/readouts appeared to
    // belong to the wrong feature.
    featureNavigator?.select('block-world', 'migration-apply-handoff', { updateLocation: false });
    blockWorld?.open();
    if (selectedAppliedBlock) showBlockReadout(selectedAppliedBlock, 'migration-apply-handoff');
    const target = blockWorld?.getFocusTarget();
    if (target) {
      desiredTarget.copy(target);
      cameraTween = reducedMotion ? .16 : 1;
    }
  },
  onReset: (snapshot) => projectionBridge.emitIntent('projection.reset-migration-draft', BLOCK_MIGRATION_SOURCE, Object.freeze({
    simulation: true,
    localOnly: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  })),
});
window.__TUMBO_BLOCK_MIGRATION__ = blockMigration;
// The snapshot bridge is the safe, shareable continuation of the migration
// surface: paste a JSON fixture, inspect canonical mappings, and hand only a
// local block draft back to Block World. It never reads files or executes
// imported content.
migrationSnapshot = createMigrationSnapshotConsole({
  documentRoot: document,
  projection: livingRealityWorld,
  onLoad: (snapshot) => projectionBridge.emitIntent('projection.load-migration-snapshot', MIGRATION_SNAPSHOT_CONSOLE_SOURCE, Object.freeze({
    accepted: snapshot.accepted === true,
    valid: snapshot.valid === true,
    mappingCount: snapshot.validation?.mappingCount ?? 0,
    safeCount: snapshot.validation?.safeCount ?? 0,
    errorCount: snapshot.validation?.errors?.length ?? 0,
    simulation: true,
    localOnly: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  })),
  onSelect: (snapshot) => {
    const organ = organs.find((candidate) => candidate.id === 'matchbox');
    if (organ) focusOrgan(organ, `migration-snapshot-select:${snapshot.selectedId}`);
    projectionBridge.emitIntent('projection.select-migration-snapshot-mapping', `${MIGRATION_SNAPSHOT_CONSOLE_SOURCE}:${snapshot.selectedId}`, Object.freeze({
      mappingId: snapshot.selectedId,
      mapping: snapshot.mapping,
      method: snapshot.method,
      simulation: true,
      localOnly: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    }));
  },
  onPreview: (snapshot) => projectionBridge.emitIntent('projection.preview-migration-snapshot', MIGRATION_SNAPSHOT_CONSOLE_SOURCE, Object.freeze({
    accepted: snapshot.accepted === true,
    valid: snapshot.valid === true,
    mappingCount: snapshot.preview?.mappings?.length ?? 0,
    applyCount: snapshot.preview?.applyCount ?? 0,
    simulation: true,
    localOnly: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  })),
  onApply: (snapshot) => {
    const blockDraft = snapshot.accepted === true
      ? blockWorld?.applyMigrationDraft(snapshot.draft?.blockEdits ?? [], 'migration-snapshot')
      : null;
    // A validated user snapshot is still only a local draft, but its safe
    // mappings resolve against the existing cube substrate.  Match the
    // manifest bridge handoff: select the first resolved cube so Apply never
    // strands the viewer in a generic field with the useful result hidden.
    const firstAppliedEdit = snapshot.draft?.blockEdits?.find?.((edit) => Array.isArray(edit?.coordinate)) ?? null;
    const firstAppliedBlock = (firstAppliedEdit?.coordinate && blockDraft?.draft?.blocks?.find?.((block) => (
      block.x === firstAppliedEdit.coordinate[0]
      && block.y === firstAppliedEdit.coordinate[1]
      && block.z === firstAppliedEdit.coordinate[2]
    ))) ?? null;
    const selectedAppliedBlock = firstAppliedBlock
      ? blockWorld?.selectBlock?.(firstAppliedBlock.id, 'migration-snapshot-handoff')
      : null;
    projectionBridge.emitIntent('projection.apply-migration-snapshot', MIGRATION_SNAPSHOT_CONSOLE_SOURCE, Object.freeze({
      accepted: snapshot.accepted === true,
      appliedCount: blockDraft?.appliedMappingIds?.length ?? snapshot.draft?.mappingIds?.length ?? 0,
      deferredCount: blockDraft?.deferredMappingIds?.length ?? snapshot.draft?.deferredMappingIds?.length ?? 0,
      blockCount: blockDraft?.draft?.blockCount ?? blockDraft?.blockCount ?? null,
      blockEditCount: blockDraft?.editCount ?? null,
      selectedBlockId: selectedAppliedBlock?.id ?? firstAppliedBlock?.id ?? null,
      handoff: selectedAppliedBlock ? 'cube-field' : 'none',
      simulation: true,
      localOnly: true,
      externalImport: false,
      importedCodeExecution: false,
      persistence: false,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    }));
    if (snapshot.accepted !== true) return;
    migrationSnapshot?.close();
    blockWorldSnapshot?.close();
    blockWorld?.open();
    // Keep the Mission Control selection in sync with the destination surface
    // so an Apply click is a navigable handoff, not a hidden state change.
    featureNavigator?.select('block-world', 'migration-snapshot', { updateLocation: false });
    if (selectedAppliedBlock) showBlockReadout(selectedAppliedBlock, 'migration-snapshot-handoff');
    const target = blockWorld?.getFocusTarget();
    if (target) {
      desiredTarget.copy(target);
      cameraTween = reducedMotion ? .16 : 1;
    }
  },
  onReplay: (snapshot) => projectionBridge.emitIntent('projection.replay-migration-snapshot', MIGRATION_SNAPSHOT_CONSOLE_SOURCE, Object.freeze({
    accepted: snapshot.accepted === true,
    replayCount: snapshot.replayCount ?? 0,
    appliedCount: snapshot.draft?.mappingIds?.length ?? 0,
    deferredCount: snapshot.draft?.deferredMappingIds?.length ?? 0,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  })),
  onReset: (snapshot) => projectionBridge.emitIntent('projection.reset-migration-snapshot', MIGRATION_SNAPSHOT_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    method: snapshot.method,
    simulation: true,
    localOnly: true,
    externalImport: false,
    importedCodeExecution: false,
    persistence: false,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  })),
  onMerge4Review: (snapshot) => {
    window.__TUMBO_MERGE4_SNAPSHOT__ = Object.freeze({
      action: snapshot.action,
      worldId: snapshot.worldId,
      version: snapshot.version,
      mappedEntityCount: snapshot.mappedEntityCount,
      evidenceCount: snapshot.evidenceCount,
      deferredCount: snapshot.deferred?.length ?? 0,
      valid: snapshot.valid === true,
      adapted: snapshot.adapted === true,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    });
    projectionBridge.emitIntent('projection.review-merge4-snapshot', 'merge4-snapshot-adapter', Object.freeze({
      action: snapshot.action,
      worldId: snapshot.worldId,
      version: snapshot.version,
      mappedEntityCount: snapshot.mappedEntityCount,
      evidenceCount: snapshot.evidenceCount,
      deferredCount: snapshot.deferred?.length ?? 0,
      valid: snapshot.valid === true,
      adapted: snapshot.adapted === true,
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
    }));
  },
});
window.__TUMBO_MIGRATION_SNAPSHOT__ = migrationSnapshot;
document.getElementById('block-migration-snapshot-open')?.addEventListener('click', () => {
  blockMigration?.close();
  migrationSnapshot?.open();
});
document.getElementById('block-migration-merge4-open')?.addEventListener('click', () => {
  blockMigration?.close();
  migrationSnapshot?.open();
  migrationSnapshot?.reviewMerge4Snapshot('migration-bridge');
});
// ARENA is a real local rehearsal surface now: the Game Lab owns three
// deterministic modes, legal action buttons, a bounded event/hash trace, and
// replay/reset.  The host only turns those frozen snapshots into intents and
// camera focus; it never grants multiplayer, reward, wallet, or token power.
arenaGames = createArenaGamesConsole({
  documentRoot: document,
  projection: livingRealityWorld,
  onMode: (snapshot) => {
    const organ = organs.find((candidate) => candidate.id === 'arena');
    if (organ) focusOrgan(organ, `arena-mode:${snapshot.modeId}`);
    projectionBridge.emitIntent('projection.select-arena-mode', `${ARENA_GAMES_SOURCE}:${snapshot.modeId}`, Object.freeze({
      action: snapshot.action,
      modeId: snapshot.modeId,
      modeLabel: snapshot.mode?.label ?? null,
      method: snapshot.method,
      turn: snapshot.state?.turn ?? 0,
      simulation: true,
      deterministic: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
      rewards: false,
      persistence: false,
    }));
  },
  onAction: (snapshot) => {
    const organ = organs.find((candidate) => candidate.id === 'arena');
    if (organ) focusOrgan(organ, `arena-action:${snapshot.result?.actionId ?? 'unknown'}`);
    projectionBridge.emitIntent('projection.arena-game-action', `${ARENA_GAMES_CONSOLE_SOURCE}:${snapshot.modeId}`, Object.freeze({
      action: snapshot.action,
      actionId: snapshot.result?.actionId ?? null,
      modeId: snapshot.modeId,
      accepted: snapshot.accepted === true,
      rejected: snapshot.rejected === true,
      reason: snapshot.result?.reason ?? null,
      turn: snapshot.state?.turn ?? 0,
      hash: snapshot.state?.headHash ?? null,
      method: snapshot.method,
      simulation: true,
      deterministic: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
      rewards: false,
      token: false,
      persistence: false,
    }));
  },
  onReplay: (snapshot) => projectionBridge.emitIntent('projection.replay-arena-game', `${ARENA_GAMES_CONSOLE_SOURCE}:${snapshot.modeId}`, Object.freeze({
    action: snapshot.action,
    modeId: snapshot.modeId,
    eventCount: snapshot.state?.events?.length ?? 0,
    headHash: snapshot.state?.headHash ?? null,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    persistence: false,
  })),
  onReset: (snapshot) => projectionBridge.emitIntent('projection.reset-arena-game', `${ARENA_GAMES_CONSOLE_SOURCE}:${snapshot.modeId}`, Object.freeze({
    action: snapshot.action,
    modeId: snapshot.modeId,
    headHash: snapshot.state?.headHash ?? null,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    persistence: false,
  })),
});
window.__TUMBO_ARENA_GAMES__ = arenaGames;
// A playable chess room is mounted inside the Arena console. Its 3D character
// pieces and accessible board are two views of one chess.js-backed state.
const chessArena = mountChessArena({documentRoot: document, host: document.getElementById('arena-games-console')});
window.__TUMBO_CHESS_ARENA__ = chessArena;
academyConsole = createAcademyConsole({
  documentRoot: document,
  onChange: (snapshot) => projectionBridge.emitIntent('projection.academy-progress', ACADEMY_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    lessonId: snapshot.selectedLesson?.id ?? null,
    completedCount: snapshot.completedCount,
    lessonCount: snapshot.lessonCount,
    xp: snapshot.xp,
    method: snapshot.method,
    localOnly: true,
    simulation: true,
    persistence: false,
    credential: false,
    rewards: false,
    externalNetwork: false,
    executable: false,
  })),
});
window.__TUMBO_ACADEMY__ = academyConsole;
// Contracts + Pools is an inspectable local graph rather than a dead card.
// The adapter only selects and replays already-projected scenarios; it never
// turns a contract, pool, or risk record into a trade or settlement path.
const CONTRACTS_DRAFT_SOURCE_ROUTE = '?build=control4&fresh=20260903-reality-lens&panel=sports-events&journey=contract-detail-source-182';
const SPORTS_SOURCE_RETURN_JOURNEY = CONTRACTS_MARKETS_SOURCE_RETURN_JOURNEY;
const SPORTS_RECORD_ID_PATTERN = /^[a-z0-9:_.-]{1,160}$/i;

function createSportsContractSourceRoute(record = null) {
  if (!globalThis.location) return CONTRACTS_DRAFT_SOURCE_ROUTE;
  try {
    const url = new URL(globalThis.location.href);
    url.searchParams.delete('feature');
    url.searchParams.delete(CONTRACTS_MARKETS_DRAFT_ROUTE_PARAM);
    url.searchParams.delete(CONTRACTS_MARKETS_CONTRACT_ROUTE_PARAM);
    url.searchParams.delete('live');
    url.searchParams.set('panel', record?.sourcePanel === 'multi-sport-events' ? 'multi-sport-events' : 'sports-events');
    url.searchParams.set('journey', 'contract-detail-source-182');
    const recordId = typeof record?.id === 'string' && /^[a-z0-9:_.-]{1,160}$/i.test(record.id)
      ? record.id
      : null;
    if (recordId) url.searchParams.set('record', recordId);
    else url.searchParams.delete('record');
    url.hash = '';
    return `?${url.searchParams.toString()}`;
  } catch {
    return CONTRACTS_DRAFT_SOURCE_ROUTE;
  }
}

function writeContractsDraftRoute(routeState) {
  const validated = validateContractDraftRouteState(routeState);
  if (!validated || !globalThis.history?.pushState || !globalThis.location) return false;
  let serialized;
  try {
    serialized = JSON.stringify(validated);
  } catch {
    return false;
  }
  if (!serialized || serialized.length > CONTRACTS_MARKETS_DRAFT_ROUTE_MAX_LENGTH) return false;
  try {
    const url = new URL(globalThis.location.href);
    url.searchParams.delete('feature');
    url.searchParams.delete('live');
    url.searchParams.set('panel', 'contracts');
    url.searchParams.set(CONTRACTS_MARKETS_CONTRACT_ROUTE_PARAM, validated.contractId);
    url.searchParams.set(CONTRACTS_MARKETS_DRAFT_ROUTE_PARAM, serialized);
    url.hash = '';
    globalThis.history.pushState(null, '', url);
    return true;
  } catch {
    return false;
  }
}

function clearContractsDraftRoute() {
  if (!globalThis.history?.pushState || !globalThis.location) return false;
  try {
    const url = new URL(globalThis.location.href);
    url.searchParams.delete('feature');
    url.searchParams.delete('live');
    url.searchParams.delete(CONTRACTS_MARKETS_DRAFT_ROUTE_PARAM);
    url.searchParams.delete(CONTRACTS_MARKETS_CONTRACT_ROUTE_PARAM);
    url.searchParams.delete('node');
    url.searchParams.set('panel', 'contracts');
    url.hash = '';
    globalThis.history.pushState(null, '', url);
    return true;
  } catch {
    return false;
  }
}

function parseContractsDraftRoute(query) {
  const hasDraft = query?.has?.(CONTRACTS_MARKETS_DRAFT_ROUTE_PARAM) === true;
  const hasContract = query?.has?.(CONTRACTS_MARKETS_CONTRACT_ROUTE_PARAM) === true;
  if (!hasDraft && !hasContract) return Object.freeze({ present: false, state: null, reason: null });
  if (!hasDraft || !hasContract) {
    return Object.freeze({ present: true, state: null, reason: 'contract detail route is missing its bounded draft payload' });
  }
  const serialized = query.get(CONTRACTS_MARKETS_DRAFT_ROUTE_PARAM);
  if (typeof serialized !== 'string' || !serialized || serialized.length > CONTRACTS_MARKETS_DRAFT_ROUTE_MAX_LENGTH) {
    return Object.freeze({ present: true, state: null, reason: 'contract detail route payload exceeds its bound' });
  }
  let parsed;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return Object.freeze({ present: true, state: null, reason: 'contract detail route payload is not valid JSON' });
  }
  const state = validateContractDraftRouteState(parsed);
  if (!state || query.get(CONTRACTS_MARKETS_CONTRACT_ROUTE_PARAM) !== state.contractId) {
    return Object.freeze({ present: true, state: null, reason: 'contract detail route payload failed strict validation' });
  }
  return Object.freeze({ present: true, state, reason: null });
}

function parseContractsGraphRoute(query) {
  const hasRecord = query?.has?.('record') === true;
  const hasGraph = query?.has?.(CONTRACTS_MARKETS_GRAPH_ROUTE_PARAM) === true;
  if (!hasRecord && !hasGraph) return Object.freeze({ present: false, state: null, reason: null });
  const graph = query?.get?.(CONTRACTS_MARKETS_GRAPH_ROUTE_PARAM);
  if (query?.get?.('panel') !== 'contracts' || graph !== CONTRACTS_MARKETS_GRAPH_ROUTE_MODE || !hasRecord) {
    return Object.freeze({ present: true, state: null, reason: 'graph route requires panel=contracts, graph=expanded, and one canonical record id' });
  }
  const state = validateContractsMarketsGraphRoute({
    recordId: query.get('record'),
    graph,
    projection: livingRealityWorld,
  });
  if (!state) {
    return Object.freeze({ present: true, state: null, reason: 'graph route record is malformed, unknown, or not a canonical contract/pool graph node' });
  }
  const node = query.get('node');
  if (node !== null && !['contract', 'pool'].includes(node)) {
    return Object.freeze({ present: true, state: null, reason: 'graph route node target must be contract or pool' });
  }
  return Object.freeze({ present: true, state: Object.freeze({ ...state, node: node ?? null }), reason: null });
}

contractsMarkets = createContractsMarketsConsole({
  documentRoot: document,
  projection: livingRealityWorld,
  onOpenSportsEvidence: ({ method } = {}) => openSportsEvidenceFromContracts(method),
  onSelect: (snapshot) => {
    const organ = organs.find((candidate) => candidate.id === 'contract');
    if (organ) focusOrgan(organ, `contracts-select:${snapshot.recordId}`);
    projectionBridge.emitIntent('projection.select-contract-record', `${CONTRACTS_MARKETS_CONSOLE_SOURCE}:${snapshot.recordId}`, Object.freeze({
      action: snapshot.action,
      recordId: snapshot.recordId,
      kind: snapshot.record?.kind ?? null,
      method: snapshot.method,
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
      settlement: false,
      custody: false,
    }));
  },
  onGraphExpand: (snapshot) => projectionBridge.emitIntent('projection.expand-contracts-markets-graph', CONTRACTS_MARKETS_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    recordId: snapshot.recordId,
    graphStatus: snapshot.graphReadout?.status ?? 'missing',
    nodeIds: snapshot.graphReadout?.nodeIds ?? [],
    completeLinkCount: snapshot.graphReadout?.completeLinkCount ?? 0,
    missingLinkCount: snapshot.graphReadout?.missingLinkCount ?? 0,
    coverageRatio: snapshot.graphReadout?.coverageRatio ?? null,
    riskBand: snapshot.graphReadout?.riskBand ?? null,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    settlement: false,
    custody: false,
  })),
  onReplay: (snapshot) => projectionBridge.emitIntent('projection.replay-contracts-markets', CONTRACTS_MARKETS_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    recordId: snapshot.recordId,
    replayedRecordCount: snapshot.replayedRecordCount,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    settlement: false,
    custody: false,
  })),
  onReset: (snapshot) => projectionBridge.emitIntent('projection.reset-contracts-markets', CONTRACTS_MARKETS_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    recordId: snapshot.recordId,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    settlement: false,
    custody: false,
  })),
  onDraft: (snapshot) => {
    const draft = snapshot.localDraft;
    const sourceRecord = snapshot.sourceRecord;
    if (draft && !['url', 'popstate'].includes(snapshot.method)) {
      writeContractsDraftRoute(snapshot.routeState ?? contractsMarkets?.getDraftRouteState?.());
    }
    const organ = organs.find((candidate) => candidate.id === 'contract');
    if (organ) focusOrgan(organ, `contracts-draft:${snapshot.action}`);
    projectionBridge.emitIntent('projection.contract-pool-draft', `${CONTRACTS_MARKETS_CONSOLE_SOURCE}:${sourceRecord?.id ?? 'none'}`, Object.freeze({
      action: snapshot.action,
      method: snapshot.method,
      sourceRecordId: sourceRecord?.id ?? null,
      sourceUrl: sourceRecord?.sourceUrl ?? null,
      draftId: draft?.id ?? null,
      contractId: draft?.contract?.id ?? null,
      poolId: draft?.pool?.id ?? null,
      provider: draft?.provenance?.provider ?? sourceRecord?.provider ?? null,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
      settlement: false,
      custody: false,
    }));
  },
  onDraftClear: (snapshot) => {
    clearContractsDraftRoute();
    projectionBridge.emitIntent('projection.clear-contract-pool-draft', CONTRACTS_MARKETS_CONSOLE_SOURCE, Object.freeze({
      action: snapshot.action,
      method: snapshot.method,
      sourceRecordId: snapshot.sourceRecord?.id ?? null,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
      settlement: false,
      custody: false,
    }));
  },
  onDraftInspect: (snapshot) => projectionBridge.emitIntent('projection.inspect-contract-pool-draft', `${CONTRACTS_MARKETS_CONSOLE_SOURCE}:${snapshot.localDraft?.id ?? 'none'}`, Object.freeze({
    action: snapshot.action,
    method: snapshot.method,
    sourceRecordId: snapshot.sourceRecord?.id ?? null,
    draftId: snapshot.localDraft?.id ?? null,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
    settlement: false,
    custody: false,
  })),
  onDraftCopy: (snapshot) => projectionBridge.emitIntent('projection.copy-contract-pool-draft-route', `${CONTRACTS_MARKETS_CONSOLE_SOURCE}:${snapshot.localDraft?.id ?? 'none'}`, Object.freeze({
    action: snapshot.action,
    method: snapshot.method,
    draftId: snapshot.localDraft?.id ?? null,
    sourceRecordId: snapshot.sourceRecord?.id ?? null,
    copied: snapshot.copied === true,
    routeLength: typeof snapshot.route === 'string' ? snapshot.route.length : 0,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
    settlement: false,
    custody: false,
  })),
});
window.__TUMBO_CONTRACTS_MARKETS__ = contractsMarkets;
// The fictional contract graph and public protocol observations are separate
// seams. A refresh here is explicit and read-only; provider TVL never becomes
// simulated liquidity, a position, a reserve, or a settlement instruction.
protocolEvidence = createProtocolEvidenceRail({
  documentRoot: document,
  host: document.getElementById('contracts-markets-console'),
  onRefresh: async ({ method, refreshCount }) => {
    const result = await fetchProtocolEvidence();
    protocolEvidence?.sync(result);
    liveGatewayConsole?.syncPublicSourceStatus?.('protocol-evidence', result, { method: 'protocol-evidence-refresh' });
    const summary = result?.records ?? [];
    projectionBridge.emitIntent('projection.refresh-protocol-evidence', `${PROTOCOL_EVIDENCE_CONSOLE_SOURCE}:${method}`, Object.freeze({
      action: 'refresh',
      method,
      refreshCount,
      status: result?.status ?? 'unavailable',
      provider: result?.provider ?? null,
      recordCount: summary.length,
      availableCount: result?.availableCount ?? 0,
      unavailableCount: result?.unavailableCount ?? summary.length,
      retrievedAt: result?.retrievedAt ?? null,
      metric: result?.metric ?? 'current protocol TVL',
      unit: result?.unit ?? 'USD',
      localOnly: true,
      simulation: true,
      liveFetch: result?.liveFetch === true,
      externalNetwork: result?.externalNetwork === true,
      externalSource: true,
      providerCredentials: false,
      truthClaim: false,
      executable: false,
      trade: false,
      settlement: false,
      custody: false,
    }));
    return result;
  },
});
window.__TUMBO_PROTOCOL_EVIDENCE__ = protocolEvidence;
// PAYCORE is a visible value-flow rehearsal over the canonical projection.
// Selecting or replaying a preview never mutates balances and never creates a
// wallet, transfer, custody, signing, or settlement path.
paycoreConsole = createPaycoreConsole({
  documentRoot: document,
  projection: livingRealityWorld,
  onSelect: (snapshot) => {
    const organ = resolveOrganById(ASSET_TOKEN_ORGAN_ID);
    if (organ) focusOrgan(organ, `paycore-select:${snapshot.recordId}`);
    projectionBridge.emitIntent('projection.select-paycore-record', `${PAYCORE_CONSOLE_SOURCE}:${snapshot.recordId}`, Object.freeze({
      action: snapshot.action,
      recordType: snapshot.recordType,
      recordId: snapshot.recordId,
      amount: snapshot.record?.amount ?? null,
      unit: snapshot.record?.unit ?? null,
      status: snapshot.record?.status ?? 'preview',
      method: snapshot.method,
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      executable: false,
      custody: false,
      signing: false,
      settlement: false,
    }));
  },
  onPreview: (snapshot) => projectionBridge.emitIntent('projection.preview-paycore-flow', `${PAYCORE_CONSOLE_SOURCE}:${snapshot.recordId}`, Object.freeze({
    action: snapshot.action,
    recordId: snapshot.recordId,
    amount: snapshot.record?.amount ?? null,
    unit: snapshot.record?.unit ?? null,
    status: snapshot.record?.status ?? 'preview',
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    custody: false,
    signing: false,
    settlement: false,
  })),
  onReplay: (snapshot) => projectionBridge.emitIntent('projection.replay-paycore', PAYCORE_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    recordId: snapshot.recordId,
    recordType: snapshot.recordType,
    replayedRecordCount: snapshot.replayedRecordCount,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    custody: false,
    settlement: false,
  })),
  onReset: (snapshot) => projectionBridge.emitIntent('projection.reset-paycore', PAYCORE_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    recordId: snapshot.recordId,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
    custody: false,
    settlement: false,
  })),
});
window.__TUMBO_PAYCORE__ = paycoreConsole;
// T402 is a visible offer → route → hold rehearsal over the canonical
// projection. Selecting or replaying a stage never moves value and cannot
// create custody, signing, release, transfer, or settlement authority.
t402Console = createT402Console({
  documentRoot: document,
  projection: livingRealityWorld,
  onSelect: (snapshot) => {
    const organ = organs.find((candidate) => candidate.id === 'exchange');
    if (organ) focusOrgan(organ, `t402-select:${snapshot.recordId}`);
    projectionBridge.emitIntent('projection.select-t402-stage', `${T402_CONSOLE_SOURCE}:${snapshot.recordId}`, Object.freeze({
      action: snapshot.action,
      recordId: snapshot.recordId,
      kind: snapshot.record?.kind ?? null,
      method: snapshot.method,
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      custody: false,
      signing: false,
      settlement: false,
      executable: false,
    }));
  },
  onReplay: (snapshot) => projectionBridge.emitIntent('projection.replay-t402-routing', T402_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    recordId: snapshot.recordId,
    sequence: snapshot.sequence,
    replayedRecordCount: snapshot.replayedRecordCount,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    externalTransfer: false,
    custody: false,
    signing: false,
    settlement: false,
    executable: false,
  })),
  onReset: (snapshot) => projectionBridge.emitIntent('projection.reset-t402-routing', T402_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    recordId: snapshot.recordId,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    externalTransfer: false,
    custody: false,
    signing: false,
    settlement: false,
    executable: false,
  })),
});
window.__TUMBO_T402__ = t402Console;
// Neural Mesh is an inspectable advisory graph. It makes Control Tower,
// Oracle, intent, proposal, relationship, and ancestry links clickable while
// keeping autonomous execution, providers, tools, and persistence disabled.
neuralMeshConsole = createNeuralMeshConsole({
  documentRoot: document,
  projection: livingRealityWorld,
  onSelect: (snapshot) => {
    const organ = organs.find((candidate) => candidate.id === 'bots');
    if (organ) focusOrgan(organ, `neural-select:${snapshot.recordId}`);
    projectionBridge.emitIntent('projection.select-neural-record', `${NEURAL_MESH_CONSOLE_SOURCE}:${snapshot.recordId}`, Object.freeze({
      action: snapshot.action,
      recordId: snapshot.recordId,
      recordType: snapshot.recordType,
      method: snapshot.method,
      simulation: true,
      advisoryOnly: true,
      localOnly: true,
      externalNetwork: false,
      providerAccess: false,
      toolAccess: false,
      autonomousExecution: false,
      executable: false,
    }));
  },
  onReplay: (snapshot) => projectionBridge.emitIntent('projection.replay-neural-mesh', NEURAL_MESH_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    recordId: snapshot.recordId,
    recordType: snapshot.recordType,
    sequence: snapshot.sequence,
    sequenceTypes: snapshot.sequenceTypes,
    replayedRecordCount: snapshot.replayedRecordCount,
    method: snapshot.method,
    simulation: true,
    advisoryOnly: true,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    providerAccess: false,
    toolAccess: false,
    autonomousExecution: false,
    executable: false,
  })),
  onReset: (snapshot) => projectionBridge.emitIntent('projection.reset-neural-mesh', NEURAL_MESH_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    recordId: snapshot.recordId,
    recordType: snapshot.recordType,
    method: snapshot.method,
    simulation: true,
    advisoryOnly: true,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    providerAccess: false,
    toolAccess: false,
    autonomousExecution: false,
    executable: false,
  })),
});
window.__TUMBO_NEURAL_MESH__ = neuralMeshConsole;
// Picture Matter makes the word → statement → provenance seam inspectable in
// the same projection. It never downloads or renders image bytes, publishes
// text, or decides truth. The optional public metadata read is explicitly
// host-owned and only runs after the rail's refresh control is activated.
pictureMatterConsole = createPictureMatterConsole({
  documentRoot: document,
  projection: livingRealityWorld,
  metadata: pictureMatterMetadata,
  onSelect: (snapshot) => {
    const organ = organs.find((candidate) => candidate.id === 'proof');
    if (organ) focusOrgan(organ, `picture-matter-select:${snapshot.recordId}`);
    projectionBridge.emitIntent('projection.select-picture-matter-record', `${PICTURE_MATTER_CONSOLE_SOURCE}:${snapshot.recordId}`, Object.freeze({
      action: snapshot.action,
      recordId: snapshot.recordId,
      recordType: snapshot.recordType,
      method: snapshot.method,
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      externalImageFetch: false,
      externalPublishing: false,
      truthDetermination: false,
      assertedTruth: false,
      executable: false,
    }));
  },
  onPathToggle: (snapshot) => projectionBridge.emitIntent('projection.toggle-picture-matter-path', PICTURE_MATTER_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    recordId: snapshot.recordId,
    recordType: snapshot.recordType,
    expanded: snapshot.expanded === true,
    sequence: snapshot.path?.sequence ?? ['word', 'statement', 'provenance'],
    inputId: snapshot.path?.input?.id ?? null,
    statementCount: snapshot.path?.statements?.length ?? 0,
    provenanceCount: snapshot.path?.provenance?.length ?? 0,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    externalImageFetch: false,
    externalPublishing: false,
    truthDetermination: false,
    assertedTruth: false,
    executable: false,
    persistence: false,
  })),
  onMetadataRefresh: async ({ query, limit, method }) => {
    const nextMetadata = await fetchPictureMatterMetadata({ query, limit });
    pictureMatterMetadata = nextMetadata;
    pictureMatterConsole?.setMetadata(nextMetadata);
    liveGatewayConsole?.syncPublicSourceStatus?.('picture-matter', nextMetadata, { method: 'picture-matter-metadata-refresh' });
    projectionBridge.emitIntent('projection.refresh-picture-matter-metadata', PICTURE_MATTER_METADATA_SOURCE, Object.freeze({
      action: 'refresh-metadata',
      method,
      provider: nextMetadata.provider,
      source: nextMetadata.source,
      endpoint: nextMetadata.endpoint,
      query: nextMetadata.query,
      requestedLimit: nextMetadata.requestedLimit,
      returnedCount: nextMetadata.returnedCount,
      retrievedAt: nextMetadata.retrievedAt,
      status: nextMetadata.status,
      providerAvailable: nextMetadata.providerAvailable === true,
      metadataOnly: true,
      imageBytesFetched: false,
      imageBytesStored: false,
      imageBytesRendered: false,
      persistence: false,
      publishing: false,
      identity: false,
      wallet: false,
      token: false,
      authority: false,
      executable: false,
      externalNetwork: nextMetadata.externalNetwork === true,
    }));
    return nextMetadata;
  },
  onReplay: (snapshot) => projectionBridge.emitIntent('projection.replay-picture-matter', PICTURE_MATTER_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    recordId: snapshot.recordId,
    recordType: snapshot.recordType,
    sequence: snapshot.sequence,
    replayedRecordCount: snapshot.replayedRecordCount,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    externalImageFetch: false,
    externalPublishing: false,
    truthDetermination: false,
    assertedTruth: false,
    executable: false,
  })),
  onReset: (snapshot) => projectionBridge.emitIntent('projection.reset-picture-matter', PICTURE_MATTER_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    recordId: snapshot.recordId,
    recordType: snapshot.recordType,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    externalImageFetch: false,
    externalPublishing: false,
    truthDetermination: false,
    assertedTruth: false,
    executable: false,
  })),
});
window.__TUMBO_PICTURE_MATTER__ = pictureMatterConsole;
// NFT Atelier is a standalone fictional collection surface: simulated mints,
// provenance inspection, and local burns. No wallet, chain, transfer, sale,
// custody, or external publication exists.
// Frozen Relics share one vault across the whole page session: the NFT
// Atelier section seals standalone relics, and the Contract Atelier's
// outcome desk mints award NFTs as living relics from the same vault.
frozenRelicsVault = createFrozenRelics({ seed: 'local-relics' });
nftAtelierConsole = createNftAtelierConsole({
  documentRoot: document,
  onSelect: (snapshot) => {
    const organ = organs.find((candidate) => candidate.id === 'proof');
    if (organ) focusOrgan(organ, `nft-atelier-select:${snapshot.selectedId}`);
    projectionBridge.emitIntent('projection.select-nft-piece', `${NFT_ATELIER_CONSOLE_SOURCE}:${snapshot.selectedId}`, Object.freeze({
      action: snapshot.action,
      pieceId: snapshot.selectedId,
      method: snapshot.method,
      simulation: true,
      localOnly: true,
      wallet: false,
      chain: false,
      transfer: false,
      executable: false,
    }));
  },
  onReplay: (snapshot) => projectionBridge.emitIntent('projection.replay-nft-atelier', NFT_ATELIER_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    wallet: false,
    chain: false,
    executable: false,
  })),
  onReset: (snapshot) => projectionBridge.emitIntent('projection.reset-nft-atelier', NFT_ATELIER_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    wallet: false,
    chain: false,
    executable: false,
  })),
});
window.__TUMBO_NFT_ATELIER__ = nftAtelierConsole;
// Frozen Relics live as a section inside the NFT Atelier console: living
// glass cubes with an immutable frozen core and an append-only life.
// Selecting a relic focuses the proof organ — the world's relic aesthetic.
frozenRelicsConsole = createFrozenRelicsConsole({
  documentRoot: document,
  vault: frozenRelicsVault,
  onMint: (snapshot) => {
    const organ = organs.find((candidate) => candidate.id === 'proof');
    if (organ) focusOrgan(organ, `frozen-relics-mint:${snapshot.selectedId}`);
    projectionBridge.emitIntent('projection.mint-frozen-relic', `${FROZEN_RELICS_CONSOLE_SOURCE}:${snapshot.selectedId}`, Object.freeze({
      action: snapshot.action,
      relicId: snapshot.selectedId,
      method: snapshot.method,
      simulation: true,
      localOnly: true,
      wallet: false,
      chain: false,
      sale: false,
      custody: false,
      executable: false,
    }));
  },
  onSelect: (snapshot) => {
    const organ = organs.find((candidate) => candidate.id === 'proof');
    if (organ) focusOrgan(organ, `frozen-relics-select:${snapshot.selectedId}`);
    projectionBridge.emitIntent('projection.select-frozen-relic', `${FROZEN_RELICS_CONSOLE_SOURCE}:${snapshot.selectedId}`, Object.freeze({
      action: snapshot.action,
      relicId: snapshot.selectedId,
      method: snapshot.method,
      simulation: true,
      localOnly: true,
      wallet: false,
      chain: false,
      executable: false,
    }));
  },
  onVerify: (snapshot) => projectionBridge.emitIntent('projection.verify-frozen-relic', `${FROZEN_RELICS_CONSOLE_SOURCE}:${snapshot.selectedId}`, Object.freeze({
    action: snapshot.action,
    relicId: snapshot.selectedId,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    wallet: false,
    chain: false,
    executable: false,
  })),
  onTransfer: (snapshot) => projectionBridge.emitIntent('projection.transfer-frozen-relic', `${FROZEN_RELICS_CONSOLE_SOURCE}:${snapshot.selectedId}`, Object.freeze({
    action: snapshot.action,
    relicId: snapshot.selectedId,
    method: snapshot.method,
    simulation: true,
    localOnly: true,
    wallet: false,
    chain: false,
    custody: false,
    executable: false,
  })),
});
window.__TUMBO_FROZEN_RELICS__ = frozenRelicsConsole;
// Muse Agent is the in-world design companion: anyone opening Matumbo meets
// the agent, adds a local profile (their Muse account tag or another
// account tag — display names only, no login, no token, no external
// linking), and composes deterministic local image/avatar designs. Avatar
// designs dress the Person Studio projection (outfit + hologram tint);
// image designs are copy-ready briefs. No AI service or network is used.
museAgentConsole = createMuseAgentConsole({
  documentRoot: document,
  onApplyAvatar: (design, snapshot) => {
    if (design?.outfitId) {
      try { personStudio?.chooseOutfit?.(design.outfitId); } catch {}
    }
    try { personStudio?.setHologramTint?.(design?.hologramTint ?? null, design?.hologramOpacity ?? 0.96); } catch {}
    projectionBridge.emitIntent('projection.muse-agent-apply-avatar', `${MUSE_AGENT_CONSOLE_SOURCE}:${design?.id ?? 'unknown'}`, Object.freeze({
      action: snapshot.action,
      designId: design?.id ?? null,
      outfitId: design?.outfitId ?? null,
      hologramTint: design?.hologramTint ?? null,
      profileName: design?.profileName ?? null,
      method: snapshot.method,
      simulation: true,
      localOnly: true,
      deterministic: true,
      executable: false,
    }));
  },
  onGenerate: (snapshot, design) => projectionBridge.emitIntent('projection.muse-agent-generate', `${MUSE_AGENT_CONSOLE_SOURCE}:${design?.id ?? 'draft'}`, Object.freeze({
    action: snapshot.action,
    kind: design?.kind ?? null,
    title: design?.title ?? null,
    method: snapshot.method,
    simulation: true,
    localOnly: true,
    deterministic: true,
    executable: false,
  })),
  onProfile: (snapshot, detail) => projectionBridge.emitIntent('projection.muse-agent-profile', `${MUSE_AGENT_CONSOLE_SOURCE}:${detail?.profileId ?? 'unknown'}`, Object.freeze({
    action: snapshot.action,
    profileId: detail?.profileId ?? null,
    method: snapshot.method,
    simulation: true,
    localOnly: true,
    externalAuth: false,
    executable: false,
  })),
  onReplay: (snapshot) => projectionBridge.emitIntent('projection.replay-muse-agent', MUSE_AGENT_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    executable: false,
  })),
});
window.__TUMBO_MUSE_AGENT__ = museAgentConsole;
// Bot Plaza — bring-your-own-bot plugin layer. The in-world agent is now a
// bot: anyone can plug in their own bot, build one with the no-code Bot
// Atelier, chat user↔bot and bot↔bot, and let bots do things in the world
// inside per-bot approved capabilities. 100% browser-local: no network, no
// tokens, no OAuth, no external bot APIs. The Muse Agent plugin ships as the
// built-in default bot.
botPlazaRegistry = createBotRegistry();
// Contract mission part 3b: one shared bot-proposal queue and one shared
// outcome desk. Bots bring outcome contracts to the queue; the Contract
// Atelier console reviews them, and APPROVE opens the book on this desk.
// The queue factory lands with the bot-plaza proposal-queue change, hence
// the guard — without it the atelier simply shows "no proposal queue wired".
contractProposalQueue = typeof createProposalQueue === "function" ? createProposalQueue() : null;
sharedOutcomeDesk = createOutcomeContracts({ seed: "local-outcomes", relicVault: frozenRelicsVault });
window.__TUMBO_PROPOSAL_QUEUE__ = contractProposalQueue;
window.__TUMBO_OUTCOME_DESK__ = sharedOutcomeDesk;
botPlazaRuntime = createBotRuntime({
  registry: botPlazaRegistry,
  proposalQueue: contractProposalQueue,
  onProposal: ({ botId, proposal }) => {
    // Announce the draft like any other bot announcement (same speech-bubble
    // path as the 'world.announce' handler below). Recorded so the bus
    // subscribe can skip the duplicate if the runtime also posts it.
    const title = proposal?.title ?? "a new proposal";
    recentProposalTitles.set(botId, { title: String(title), at: Date.now() });
    botPresence?.speak(botId, `I drafted a contract for your review: ${title}`);
  },
  actionHandlers: {
    'world.announce': ({ botId, params }) => {
      botPresence?.speak(botId, params.text);
      return { announced: true };
    },
    'world.focus-cube': ({ params }) => {
      blockWorld?.setHoveredBlock?.(params.cubeId);
      return { cubeId: params.cubeId };
    },
    'world.select-cube': ({ params }) => {
      blockWorld?.selectBlock?.(params.cubeId, 'bot-plaza');
      botPlazaRuntime.publishWorldEvent('cube.selected', { cubeId: params.cubeId });
      return { cubeId: params.cubeId };
    },
    'world.open-cube': ({ params }) => {
      if (params.cubeId) blockWorld?.selectBlock?.(params.cubeId, 'bot-plaza');
      blockWorld?.openBlock?.(true);
      botPlazaRuntime.publishWorldEvent('cube.opened', { cubeId: params.cubeId ?? null });
      return { cubeId: params.cubeId ?? null };
    },
    'world.move-camera': ({ params }) => {
      const x = Math.max(-60, Math.min(60, Number(params.x) || 0));
      const y = Math.max(1, Math.min(60, Number(params.y) || 10));
      const z = Math.max(-60, Math.min(60, Number(params.z) || 20));
      desiredCameraPosition.set(x, y, z);
      cameraPositionTween = reducedMotion ? .16 : 1;
      return { x, y, z };
    },
    'world.launch-feature': ({ params }) => {
      featureNavigator?.select?.(params.featureId, 'bot-plaza');
      return { featureId: params.featureId };
    },
  },
});
botPlazaConsole = createBotPlazaConsole({
  documentRoot: document,
  registry: botPlazaRegistry,
  runtime: botPlazaRuntime,
  onReplay: (snapshot) => projectionBridge.emitIntent('projection.replay-bot-plaza', BOT_PLAZA_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    executable: false,
  })),
});
window.__TUMBO_BOT_PLAZA__ = { registry: botPlazaRegistry, runtime: botPlazaRuntime, console: botPlazaConsole };
// Story Mode — guided storylines through the world. The planner/player UI is
// the story-mode console; beat navigation resolves here through the feature
// navigator (camera focus + local console) or direct camera flights for
// world-view beats. Local projection only: no network, wallet, custody,
// mainnet, or external execution.
function navigateStoryBeat(beat) {
  if (!beat || typeof beat !== 'object') return;
  const refId = String(beat.refId ?? '');
  try {
    if (beat.kind === 'feature') {
      featureNavigator?.select?.(refId, 'story-mode');
      return;
    }
    if (beat.kind === 'world-view') {
      if (refId === 'giant-block') {
        // Far view: the world merges into one giant pulsing glass block.
        desiredCameraPosition.set(0, 30, 55);
        cameraPositionTween = reducedMotion ? 0.16 : 1;
        return;
      }
      if (refId === 'constellation') {
        featureNavigator?.select?.('block-world', 'story-mode');
        return;
      }
      if (refId === 'tentacles') {
        featureNavigator?.select?.('gateway', 'story-mode');
        return;
      }
      return;
    }
    if (beat.kind === 'contract') {
      featureNavigator?.select?.('contracts', 'story-mode');
      return;
    }
    if (beat.kind === 'relic') {
      // Frozen Relics live as a section inside the NFT Atelier console.
      featureNavigator?.select?.('nft-atelier', 'story-mode');
      return;
    }
    if (beat.kind === 'bot') {
      if (refId && typeof botPlazaConsole?.openWithBot === 'function') {
        botPlazaConsole.openWithBot(refId);
      } else {
        featureNavigator?.select?.('bot-plaza', 'story-mode');
      }
    }
  } catch {
    // Navigation is best-effort; the story HUD always advances regardless.
  }
}
storyModeConsole = createStoryModeConsole({
  documentRoot: document,
  onNavigateBeat: (beat) => navigateStoryBeat(beat),
  onEvent: (type, detail) => {
    void type;
    void detail;
  },
});
window.__TUMBO_STORY_MODE__ = storyModeConsole;
document.getElementById('story-mode-open')?.addEventListener('click', () => storyModeConsole?.open());
// Bot presences live in the 3D world as glass orbs; bot chatter shows as
// speech bubbles above them, and clicking one opens the chat.
botPresence = mountBotPresence({
  documentRoot: document,
  three: THREE,
  scene,
  camera,
  container: document.body,
  getBots: () => botPlazaRegistry.listBots(),
  getRuntime: () => botPlazaRuntime,
  onOrbClick: (botId) => {
    botPlazaConsole?.openWithBot?.(botId);
  },
});
botPlazaRuntime.getBus().subscribe((entry) => {
  if (entry.kind === 'chat' || entry.kind === 'announce' || entry.kind === 'event') {
    if (entry.from !== 'user' && entry.from !== 'world') {
      // Skip the duplicate bubble when the bot runtime both calls onProposal
      // and posts the proposal as an announce-kind bus entry.
      const recent = recentProposalTitles.get(entry.from);
      const duplicate = entry.kind === 'announce' && recent
        && Date.now() - recent.at < 5000
        && typeof entry.text === 'string' && recent.title && entry.text.includes(recent.title);
      if (!duplicate) botPresence?.speak(entry.from, entry.text);
    }
  }
  botPresence?.refresh();
});
// Contract Atelier is a standalone fictional market surface: anyone can open
// a pool, binary, or multi-outcome contract on any topic as the house or a
// player, stake rehearsal credits, and resolve it with TRUE/FALSE, AND, OR,
// or IF/ELSE logic. No wallet, chain, custody, settlement, wagering, or real
// money exists.
contractAtelierConsole = createContractAtelierConsole({
  documentRoot: document,
  // Award NFTs from outcome contracts are minted as Frozen Relics from the
  // shared vault: the claim freezes in the relic core, its life keeps growing.
  relicVault: frozenRelicsVault,
  // Part 3b: the shared bot-proposal queue and the shared outcome desk.
  proposalQueue: contractProposalQueue,
  outcomeDesk: sharedOutcomeDesk,
  onSelect: (snapshot) => {
    const organ = organs.find((candidate) => candidate.id === 'contract');
    if (organ) focusOrgan(organ, `contract-atelier-select:${snapshot.selectedId}`);
    projectionBridge.emitIntent('projection.select-contract', `${CONTRACT_ATELIER_CONSOLE_SOURCE}:${snapshot.selectedId}`, Object.freeze({
      action: snapshot.action,
      contractId: snapshot.selectedId,
      method: snapshot.method,
      simulation: true,
      localOnly: true,
      wallet: false,
      chain: false,
      settlement: false,
      executable: false,
    }));
  },
  onReplay: (snapshot) => projectionBridge.emitIntent('projection.replay-contract-atelier', CONTRACT_ATELIER_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    wallet: false,
    chain: false,
    executable: false,
  })),
  onReset: (snapshot) => projectionBridge.emitIntent('projection.reset-contract-atelier', CONTRACT_ATELIER_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    wallet: false,
    chain: false,
    executable: false,
  })),
});
window.__TUMBO_CONTRACT_ATELIER__ = contractAtelierConsole;
// Luna Companion is a scripted local guide: plain-word navigation, feature
// explanations, and current-context narration. No AI model, no conversation
// service, no network, no memory past this page session. Navigation uses the
// same feature-select path as a click; Luna changes no world state.
lunaCompanionConsole = createLunaCompanionConsole({
  documentRoot: document,
  features: FEATURE_DEFINITIONS,
  getCurrentFeature: () => featureNavigator?.getActiveId?.() ?? null,
  onNavigate: (featureId, snapshot) => {
    featureNavigator?.select(featureId, 'luna');
    projectionBridge.emitIntent('projection.feature-open', `${LUNA_CONSOLE_SOURCE}:${featureId}`, Object.freeze({
      action: snapshot.action,
      featureId,
      method: 'luna',
      simulation: true,
      localOnly: true,
      network: false,
      aiModel: false,
      executable: false,
    }));
  },
  onReplay: (snapshot) => projectionBridge.emitIntent('projection.replay-luna-companion', LUNA_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    network: false,
    aiModel: false,
    executable: false,
  })),
});
window.__TUMBO_LUNA__ = lunaCompanionConsole;
// Wardrobe Atelier is a fictional local outfit studio: browse and design
// simulated looks, equip a look. Starter looks that map to a person-studio
// outfit id also dress the 3D person. No marketplace, ownership, purchase,
// transfer, or external publication exists.
wardrobeAtelierConsole = createWardrobeAtelierConsole({
  atelier: null, // The console creates its own seeded fictional wardrobe.
  onEquip: (outfit, snapshot, event) => {
    // Sync the 3D person appearance when the wardrobe outfit maps to a
    // person-studio outfit id; wardrobe-only looks stay in the atelier.
    const studioOutfitId = outfit?.studioOutfitId ?? event?.studioOutfitId ?? null;
    if (studioOutfitId) {
      try { personStudio?.chooseOutfit?.(studioOutfitId); } catch {}
    }
    projectionBridge.emitIntent('projection.wardrobe-equip', WARDROBE_ATELIER_CONSOLE_SOURCE, Object.freeze({
      action: 'equip',
      outfitId: outfit?.id ?? null,
      outfitName: outfit?.name ?? null,
      studioOutfitId,
      method: snapshot?.method ?? 'button',
      simulation: true,
      localOnly: true,
      network: false,
      executable: false,
    }));
  },
  onReplay: (snapshot) => projectionBridge.emitIntent('projection.replay-wardrobe-atelier', WARDROBE_ATELIER_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    network: false,
    executable: false,
  })),
  onReset: (snapshot) => projectionBridge.emitIntent('projection.reset-wardrobe-atelier', WARDROBE_ATELIER_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    network: false,
    executable: false,
  })),
});
window.__TUMBO_WARDROBE__ = wardrobeAtelierConsole;
// White Paper is the living document console: it composes the vision,
// live feature registry, neural mesh, contracts and ledger state from the
// local projection at open time. Read-only, zero WebGL, zero network, zero
// writes. Feature buttons navigate through the same feature-select path as a
// click; the paper changes no world state.
whitePaperConsole = createWhitePaperConsole({
  documentRoot: document,
  getEnvelope: () => livingRealityWorld,
  getFeatures: () => FEATURE_DEFINITIONS,
  onSelect: (featureId, snapshot) => {
    featureNavigator?.select(featureId, 'white-paper');
    projectionBridge.emitIntent('projection.feature-open', `${WHITE_PAPER_CONSOLE_SOURCE}:${featureId}`, Object.freeze({
      action: snapshot.action,
      featureId,
      method: 'white-paper',
      simulation: true,
      localOnly: true,
      network: false,
      executable: false,
    }));
  },
  onReplay: (snapshot) => projectionBridge.emitIntent('projection.replay-white-paper', WHITE_PAPER_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    network: false,
    executable: false,
  })),
  onSnapshot: (snapshot) => projectionBridge.emitIntent('projection.snapshot-white-paper', WHITE_PAPER_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    method: snapshot.method,
    sectionCount: snapshot.sectionCount,
    featureCount: snapshot.featureCount,
    simulation: true,
    localOnly: true,
    network: false,
    executable: false,
  })),
});
window.__TUMBO_WHITE_PAPER__ = whitePaperConsole;
// Gesture Lens is the local hand-proxy rehearsal console: pointer/touch
// gestures (and an optional camera preview that is never analyzed, recorded,
// or uploaded) steer the 3D world through the block-world manipulation host.
// Gestures change no projection state directly; they drive the same
// manipulate controls as touch input.
gestureLensConsole = createGestureLensConsole({
  documentRoot: document,
  onGesture: (event) => {
    blockWorld?.noteGestureIntent?.(event);
    projectionBridge.emitIntent('projection.gesture-lens-intent', GESTURE_LENS_CONSOLE_SOURCE, Object.freeze({
      action: 'gesture',
      gesture: event?.gesture ?? null,
      method: event?.method ?? 'api',
      simulation: true,
      localOnly: true,
      network: false,
      camera: false,
      executable: false,
    }));
  },
  onReplay: (snapshot) => projectionBridge.emitIntent('projection.replay-gesture-lens', GESTURE_LENS_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    network: false,
    executable: false,
  })),
});
window.__TUMBO_GESTURE_LENS__ = gestureLensConsole;
// Hand Lens session pipeline (2026-09-20): hand-camera → hand-lens →
// hand-gestures → hand-grab → block-world authorities (+ hand presence,
// air keyboard, perf governor, AR-glasses orchestration). The session never
// enables the camera itself — frames stay on-device and the camera starts
// only when the user presses Enable in the hand-lens panel. A session
// failure must never break boot, so creation + mount are guarded.
try {
  const handLensSession = createHandLensSession({
    blockWorld,
    scene,
    camera,
    documentRoot: document,
    onError: (error) => console.warn('[Hand Lens]', error),
  });
  handLensSession.mount();
  window.__TUMBO_HAND_LENS__ = handLensSession;
} catch (error) {
  console.warn('[Hand Lens] session failed to start', error);
}
// Prime Ledger + EchoProof is an inspectable summary surface: balanced
// journal records and declared proof ancestry are linked in-memory only.
ledgerProofConsole = createLedgerProofConsole({
  documentRoot: document,
  projection: livingRealityWorld,
  onSelect: (snapshot) => {
    const organ = organs.find((candidate) => candidate.id === 'ledger');
    if (organ) focusOrgan(organ, `ledger-proof-select:${snapshot.recordId}`);
    projectionBridge.emitIntent('projection.select-ledger-proof-record', `${LEDGER_PROOF_CONSOLE_SOURCE}:${snapshot.recordId}`, Object.freeze({
      action: snapshot.action,
      recordId: snapshot.recordId,
      recordType: snapshot.recordType,
      method: snapshot.method,
      simulation: true,
      authoritative: false,
      localOnly: true,
      externalNetwork: false,
      signing: false,
      settlement: false,
      cryptographicVerification: false,
      executable: false,
    }));
  },
  onReplay: (snapshot) => projectionBridge.emitIntent('projection.replay-ledger-proof', LEDGER_PROOF_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    recordId: snapshot.recordId,
    recordType: snapshot.recordType,
    sequence: snapshot.sequence,
    replayedRecordCount: snapshot.replayedRecordCount,
    method: snapshot.method,
    simulation: true,
    authoritative: false,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    signing: false,
    settlement: false,
    cryptographicVerification: false,
    executable: false,
  })),
  onReset: (snapshot) => projectionBridge.emitIntent('projection.reset-ledger-proof', LEDGER_PROOF_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    recordId: snapshot.recordId,
    recordType: snapshot.recordType,
    method: snapshot.method,
    simulation: true,
    authoritative: false,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    signing: false,
    settlement: false,
    cryptographicVerification: false,
    executable: false,
  })),
});
window.__TUMBO_LEDGER_PROOF__ = ledgerProofConsole;
// Live Gateway owns the public-source status dashboard. The legacy mock
// observation/interpretation fixture remains available to renderer tests, but
// the canonical composition does not mount it. Public rows must come from the
// in-memory envelopes returned by the dedicated source adapters.
liveGatewayConsole = createLiveGatewayConsole({
  documentRoot: document,
  projection: livingRealityWorld,
  includeLegacyFixture: false,
  publicSourceSnapshots: {
    'world-events': createUnavailableWorldEvents({
      reason: 'No World Pulse refresh has completed in this page session; no public rows were fabricated.',
    }),
    'sports-events': createUnavailableSportsEvents({
      reason: 'No Tennis Evidence refresh has completed in this page session; no public rows were fabricated.',
    }),
    'asset-market': createUnavailableAssetMarketEvidence({
      reason: 'No Asset Market refresh has completed in this page session; no public rows were fabricated.',
    }),
    'protocol-evidence': createUnavailableProtocolEvidence({
      reason: 'No Protocol TVL refresh has completed in this page session; no public values were fabricated.',
    }),
    'multi-sport-events': createUnavailableMultiSportEvents({
      reason: 'No Multi-Sport Scoreboards refresh has completed in this page session; no public rows were fabricated.',
    }),
    'social-pulse': createUnavailableSocialPulse({
      reason: 'No Social Pulse refresh has completed in this page session; no fallback or fictional rows were fabricated.',
    }),
    'picture-matter': createUnavailablePictureMatterMetadata({
      reason: 'No Picture Matter metadata refresh has completed in this page session; no fallback image rows were fabricated.',
    }),
  },
  onSelect: (snapshot) => {
    const organ = organs.find((candidate) => candidate.id === 'logo');
    if (organ) focusOrgan(organ, `live-gateway-select:${snapshot.recordId}`);
    projectionBridge.emitIntent('projection.select-live-gateway-record', `${LIVE_GATEWAY_CONSOLE_SOURCE}:${snapshot.recordId}`, Object.freeze({
      action: snapshot.action,
      recordId: snapshot.recordId,
      recordType: snapshot.recordType,
      method: snapshot.method,
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      externalProviders: false,
      providerCredentials: false,
      liveData: false,
      truthClaim: false,
      truthAuthority: 'none',
      executable: false,
    }));
  },
  onReplay: (snapshot) => projectionBridge.emitIntent('projection.replay-live-gateway', LIVE_GATEWAY_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    recordId: snapshot.recordId,
    recordType: snapshot.recordType,
    sequence: snapshot.sequence,
    linkedEvidenceIds: snapshot.linkedEvidenceIds,
    replayedRecordCount: snapshot.replayedRecordCount,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    externalProviders: false,
    providerCredentials: false,
    liveData: false,
    truthClaim: false,
    truthAuthority: 'none',
    executable: false,
  })),
  onReset: (snapshot) => projectionBridge.emitIntent('projection.reset-live-gateway', LIVE_GATEWAY_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    recordId: snapshot.recordId,
    recordType: snapshot.recordType,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    externalProviders: false,
    providerCredentials: false,
    liveData: false,
    truthClaim: false,
    truthAuthority: 'none',
    executable: false,
  })),
  onPublicSourceStatus: (snapshot) => projectionBridge.emitIntent('projection.sync-live-public-source-status', `${LIVE_GATEWAY_CONSOLE_SOURCE}:${snapshot.surfaceId ?? 'all'}`, Object.freeze({
    action: snapshot.action,
    method: snapshot.method,
    surfaceId: snapshot.surfaceId,
    status: snapshot.status,
    statuses: snapshot.statuses,
    latestRetrievedAt: snapshot.publicSourceStatus?.latestRetrievedAt ?? null,
    readyCount: snapshot.publicSourceStatus?.readyCount ?? 0,
    freshCount: snapshot.publicSourceStatus?.freshCount ?? 0,
    partialCount: snapshot.publicSourceStatus?.partialCount ?? 0,
    unavailableCount: snapshot.publicSourceStatus?.unavailableCount ?? 0,
    staleCount: snapshot.publicSourceStatus?.staleCount ?? 0,
    simulation: true,
    localOnly: true,
    externalNetwork: false,
    externalProviders: false,
    providerCredentials: false,
    liveData: false,
    truthClaim: false,
    truthAuthority: 'none',
    executable: false,
    persistence: false,
  })),
  onPublicRefresh: (surfaceId, method = 'status-dashboard') => {
    const refreshMethod = `status-dashboard:${method}`;
    if (surfaceId === 'world-events') {
      if (!worldEventsConsole?.refresh) throw new Error('World Pulse refresh is unavailable');
      return worldEventsConsole.refresh(refreshMethod);
    }
    if (surfaceId === 'sports-events') {
      if (!sportsEventsConsole?.refresh) throw new Error('Tennis Evidence refresh is unavailable');
      return sportsEventsConsole.refresh(refreshMethod);
    }
    if (surfaceId === 'asset-market') {
      if (!assetMarketConsole?.refresh) throw new Error('Asset Market refresh is unavailable');
      return assetMarketConsole.refresh(refreshMethod);
    }
    if (surfaceId === 'protocol-evidence') {
      if (!protocolEvidence?.refresh) throw new Error('Protocol TVL refresh is unavailable');
      return protocolEvidence.refresh(refreshMethod);
    }
    if (surfaceId === 'multi-sport-events') {
      if (!multiSportEventsConsole?.refresh) throw new Error('Multi-Sport Scoreboards refresh is unavailable');
      return multiSportEventsConsole.refresh(refreshMethod);
    }
    if (surfaceId === 'social-pulse') {
      if (!socialExplorer?.refreshPublicPulse) throw new Error('Social Pulse refresh is unavailable');
      return socialExplorer.refreshPublicPulse(refreshMethod);
    }
    if (surfaceId === 'picture-matter') {
      if (!pictureMatterConsole?.refreshMetadata) throw new Error('Picture Matter metadata refresh is unavailable');
      return pictureMatterConsole.refreshMetadata(refreshMethod);
    }
    throw new Error(`Unknown public surface: ${String(surfaceId)}`);
  },
  onPublicRefreshAll: (method = 'status-dashboard') => {
    // The all-sources button delegates to the same finite host batch used by
    // the shareable `live=all` route. The renderer owns only progress and
    // readout state; each fixed adapter still performs its own public refresh.
    return refreshLiveStatusSurfaces(`live-status:${method}`, true);
  },
});
window.__TUMBO_LIVE_GATEWAY__ = liveGatewayConsole;
// Phone / PC / XR is a device-parity inspection surface over the same
// canonical world. It exposes the current presentation metadata and a safe
// fallback profile; it never opens an XR session or claims cross-device sync.
deviceProjectionConsole = createDeviceProjectionConsole({
  documentRoot: document,
  projection: deviceProjection,
  onSelect: (snapshot) => {
    const organ = organs.find((candidate) => candidate.id === 'arena');
    if (organ) focusOrgan(organ, `device-projection-select:${snapshot.deviceId}`);
    projectionBridge.emitIntent('projection.select-device-profile', `${DEVICE_PROJECTION_CONSOLE_SOURCE}:${snapshot.deviceId}`, Object.freeze({
      action: snapshot.action,
      deviceId: snapshot.deviceId,
      method: snapshot.method,
      simulation: true,
      localOnly: true,
      sharedState: false,
      externalNetwork: false,
      xrSession: false,
      parityClaim: false,
      executable: false,
    }));
  },
  onReplay: (snapshot) => projectionBridge.emitIntent('projection.replay-device-profile', DEVICE_PROJECTION_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    deviceId: snapshot.deviceId,
    sequence: snapshot.sequence,
    replayedProfileCount: snapshot.replayedProfileCount,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    sharedState: false,
    externalNetwork: false,
    xrSession: false,
    parityClaim: false,
    executable: false,
  })),
  onReset: (snapshot) => projectionBridge.emitIntent('projection.reset-device-profile', DEVICE_PROJECTION_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    deviceId: snapshot.deviceId,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    sharedState: false,
    externalNetwork: false,
    xrSession: false,
    parityClaim: false,
    executable: false,
  })),
});
window.__TUMBO_DEVICE_PROJECTION__ = deviceProjectionConsole;
let realityLensMode = 'world';
let realityLensPersonId = null;
let hoveredPerson = null;
let hoveredDistribution = null;
let hoveredRoom = null;
let hoveredBlock = null;

function taggedMesh(geometry, material, organ, name='surface'){
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = m.receiveShadow = false;
  m.userData.organ = organ;
  m.userData.partName = name;
  raycastTargets.push(m);
  return m;
}
function ring(r=.9,t=.08,mat=mats.cyan){ return new THREE.Mesh(new THREE.TorusGeometry(r,t,12,80),mat); }
function orb(r=.35,mat=mats.cyan){ return new THREE.Mesh(new THREE.IcosahedronGeometry(r,3),mat); }
function lineLoop(points,color=0x5ce8ff,opacity=.45){
  const g = new THREE.BufferGeometry().setFromPoints(points);
  const m = new THREE.LineBasicMaterial({color,transparent:true,opacity});
  return new THREE.LineLoop(g,m);
}
function addHalo(group,r=2.2){ const h=ring(r,.012,new THREE.MeshBasicMaterial({color:0x7eefff,transparent:true,opacity:.15}));h.rotation.x=Math.PI/2;group.add(h);return h; }
function makePulseParticle(parent, radius, material=mats.cyan, speed=1){
  const p = orb(.055, material); parent.add(p);
  p.userData.pulse = {radius,speed,phase:Math.random()*Math.PI*2};
  return p;
}

// --- Semantic Object Layer -------------------------------------------------
// Words are not HUD labels. Each concept is a small 3D information object
// that grows out of its parent organ and can itself be hovered/unfolded.
const semanticTargets = [];
let hoveredSemantic = null;

function wordTexture(label, size=44, glow='#9ff3ff'){
  const c=document.createElement('canvas'); c.width=512; c.height=128;
  const x=c.getContext('2d'); x.clearRect(0,0,c.width,c.height);
  x.font=`700 ${size}px Inter, Arial, sans-serif`; x.textAlign='center'; x.textBaseline='middle';
  x.shadowColor=glow; x.shadowBlur=18; x.fillStyle='#eafcff';
  x.fillText(label.toUpperCase(),256,64);
  const tx=new THREE.CanvasTexture(c); tx.colorSpace=THREE.SRGBColorSpace; tx.anisotropy=4;
  return tx;
}

function semanticColors(kind='info'){
  if(kind==='authority') return {body:0x60461d,edge:0xffd279,emissive:0x7b5417};
  if(kind==='value') return {body:0x594116,edge:0xffc95f,emissive:0x6f4b12};
  if(kind==='risk') return {body:0x541e24,edge:0xff7e89,emissive:0x681f28};
  if(kind==='autonomy') return {body:0x39215d,edge:0xc39cff,emissive:0x4c2781};
  if(kind==='health') return {body:0x173f32,edge:0x75ffc0,emissive:0x18563f};
  return {body:0x113640,edge:0x8ff2ff,emissive:0x154d59};
}

function miniWord(label, edgeColor){
  const g=new THREE.Group();
  const plateMat=new THREE.MeshStandardMaterial({color:0x0c151b,emissive:edgeColor,emissiveIntensity:.18,metalness:.72,roughness:.28,transparent:true,opacity:.92});
  const plate=new THREE.Mesh(new THREE.BoxGeometry(.72,.20,.065),plateMat); g.add(plate);
  const edges=new THREE.LineSegments(new THREE.EdgesGeometry(plate.geometry),new THREE.LineBasicMaterial({color:edgeColor,transparent:true,opacity:.58}));g.add(edges);
  const text=new THREE.Mesh(new THREE.PlaneGeometry(.62,.14),new THREE.MeshBasicMaterial({map:wordTexture(label,30),transparent:true,depthWrite:false}));
  text.position.z=.036;g.add(text);
  return g;
}

function makeSemanticNode(organ, def, index, count){
  const c=semanticColors(def.kind);
  const node={organ,def,index,root:new THREE.Group(),open:0,targetOpen:0,final:new THREE.Vector3(),micro:[],line:null};
  organ.root.add(node.root);
  organ.semanticNodes ??= [];
  organ.semanticNodes.push(node);

  // Stagger nodes around the organ so the information itself becomes anatomy.
  const angle=(index/Math.max(count,1))*Math.PI*2 - Math.PI*.18;
  const radius=count>4?2.55:2.25;
  node.final.set(Math.cos(angle)*radius, .65 + Math.sin(angle*1.35)*1.05, 1.15 + Math.sin(angle)*.38);

  const plateMat=new THREE.MeshStandardMaterial({color:c.body,emissive:c.emissive,emissiveIntensity:.34,metalness:.82,roughness:.23,transparent:true,opacity:.94});
  const plate=new THREE.Mesh(new THREE.BoxGeometry(1.62,.46,.12),plateMat);
  plate.userData.organ=organ;plate.userData.semantic=node;node.root.add(plate);raycastTargets.push(plate);semanticTargets.push(plate);
  const borderMat=new THREE.LineBasicMaterial({color:c.edge,transparent:true,opacity:.72});
  const border=new THREE.LineSegments(new THREE.EdgesGeometry(plate.geometry),borderMat);node.root.add(border);

  // Semantic words remain little blocks too. Earlier versions used cylinders,
  // polyhedra, and rings here, which made the Reality Lens reintroduce the
  // round-node visual language after the cube field had removed it.
  const sigilEdge = index%3===0 ? .22 : index%3===1 ? .18 : .2;
  const sigilSize=[sigilEdge,sigilEdge,sigilEdge];
  const sigilGeom=new THREE.BoxGeometry(...sigilSize);
  const sigil=new THREE.Mesh(sigilGeom,new THREE.MeshStandardMaterial({color:c.edge,emissive:c.edge,emissiveIntensity:1.3,metalness:.45,roughness:.18}));
  sigil.position.set(-.61,0,.12);sigil.rotation.x=Math.PI/2;sigil.userData.organ=organ;sigil.userData.semantic=node;node.root.add(sigil);raycastTargets.push(sigil);semanticTargets.push(sigil);

  const text=new THREE.Mesh(new THREE.PlaneGeometry(1.18,.29),new THREE.MeshBasicMaterial({map:wordTexture(def.label,40),transparent:true,depthWrite:false}));
  text.position.set(.12,0,.066);text.userData.organ=organ;text.userData.semantic=node;node.root.add(text);raycastTargets.push(text);semanticTargets.push(text);

  // Deeper meaning is another layer of objects, not a paragraph popup.
  (def.tokens||[]).slice(0,3).forEach((token,i)=>{
    const m=miniWord(token,c.edge);m.position.set(.2,0,-.02);m.scale.setScalar(.001);node.root.add(m);node.micro.push(m);
  });

  const lg=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3()]);
  const lm=new THREE.LineBasicMaterial({color:c.edge,transparent:true,opacity:0});
  node.line=new THREE.Line(lg,lm);organ.root.add(node.line);
  node.root.scale.setScalar(.001);node.root.visible=false;
  return node;
}

function attachSemanticObjects(organ, defs){
  defs.forEach((d,i)=>makeSemanticNode(organ,d,i,defs.length));
}

function updateSemanticObjects(organ, dt, t){
  if(!organ.semanticNodes) return;
  const appear=THREE.MathUtils.smoothstep(organ.awake,.14,.74);
  organ.semanticNodes.forEach((node,i)=>{
    node.targetOpen=(hoveredSemantic===node)?1:0;
    node.open=THREE.MathUtils.damp(node.open,node.targetOpen,9,dt);
    node.root.visible=appear>.015;
    const staged=.18+.82*appear;
    node.root.position.copy(node.final).multiplyScalar(staged);
    node.root.position.z += Math.sin(t*.72+i*.9)*.045*appear;
    node.root.scale.setScalar(Math.max(.001,appear*(1+node.open*.09)));
    // Billboard the semantic object toward the camera while keeping it spatial.
    organ.root.getWorldQuaternion(_semanticParentQuat);
    _semanticParentQuat.invert().multiply(camera.quaternion);
    node.root.quaternion.slerp(_semanticParentQuat, .18);
    const plate=node.root.children[0]; if(plate?.material){plate.material.emissiveIntensity=.25+appear*.22+node.open*.8;}
    const border=node.root.children[1]; if(border?.material){border.material.opacity=.22+appear*.5+node.open*.25;}
    const sigil=node.root.children[2]; if(sigil){sigil.rotation.z+=dt*(.5+i*.08);sigil.scale.setScalar(1+node.open*.22);}
    // Information blooms as 3 micro-objects from the semantic word-object.
    node.micro.forEach((m,j)=>{
      const spread=node.open;
      const y=(j-1)*.29;
      m.position.set(1.0+spread*(.38+j*.08), y*spread, -.01+spread*.03);
      m.scale.setScalar(Math.max(.001,spread));
    });
    const pts=node.line.geometry.attributes.position;
    pts.setXYZ(0,0,0,0);pts.setXYZ(1,node.root.position.x,node.root.position.y,node.root.position.z);pts.needsUpdate=true;
    node.line.material.opacity=appear*(.08+node.open*.34);
  });
}
const _semanticParentQuat=new THREE.Quaternion();

function createOrgan({id,title,body,tags,position,scale=1,build}){
  const root = new THREE.Group(); root.position.copy(position); root.scale.setScalar(scale); world.add(root);
  const inner = new THREE.Group(); root.add(inner);
  const organ = {id,title,body,tags,root,inner,awake:0,targetAwake:0,t:Math.random()*10,update:null,parts:[],semanticNodes:[],projectionEntity:null,selectorButton:null};
  organs.push(organ);
  build(organ);
  root.traverse(o=>{ if(o.isMesh){o.userData.organ ??= organ; raycastTargets.includes(o)||raycastTargets.push(o);} });
  return organ;
}

function buildLogo(o){
  const g=o.inner;
  const outer=taggedMesh(new THREE.TorusKnotGeometry(1.25,.16,150,18,2,5),mats.dark,o,'gateway shell');
  outer.scale.y=.82; g.add(outer);
  const halo=taggedMesh(new THREE.TorusGeometry(1.55,.055,10,120),mats.cyan,o,'threshold ring'); halo.rotation.x=Math.PI/2;g.add(halo);
  const core=taggedMesh(new THREE.OctahedronGeometry(.56,2),mats.crystal,o,'identity core');g.add(core);
  const spine=new THREE.Group();g.add(spine);
  for(let i=0;i<6;i++){const r=ring(.42+i*.16,.022,i%2?mats.blue:mats.cyan);r.rotation.set(Math.PI/2,i*.48,i*.23);spine.add(r);o.parts.push(r)}
  addHalo(g,1.95);
  o.update=(dt,t)=>{outer.rotation.y+=dt*.15;halo.rotation.z-=dt*.28;core.rotation.y-=dt*.22;core.scale.setScalar(1+Math.sin(t*2.1)*.035);o.parts.forEach((r,i)=>r.rotation.z+=dt*(.18+i*.027)*(i%2?-1:1));g.position.z=o.awake*.38;spine.scale.setScalar(1+o.awake*.25);outer.scale.z=.82+o.awake*.16;};
}

function buildAssetTokenOrgan(o){
  const g=o.inner;
  const shell=taggedMesh(new THREE.CylinderGeometry(1.45,1.45,.42,96,1,false),mats.gold,o,'reserve shell');shell.rotation.x=Math.PI/2;g.add(shell);
  const face=taggedMesh(new THREE.TorusGeometry(1.12,.12,12,96),mats.dark,o,'outer value ring');face.rotation.x=Math.PI/2;g.add(face);
  const ledger=taggedMesh(new THREE.TorusGeometry(.78,.055,10,96),mats.cyan,o,'ledger ring');ledger.rotation.x=Math.PI/2;g.add(ledger);
  const core=taggedMesh(new THREE.SphereGeometry(.37,48,32),mats.crystal,o,'value core');g.add(core);
  const spokes=new THREE.Group();g.add(spokes);
  for(let i=0;i<12;i++){const a=i/12*Math.PI*2;const b=new THREE.Mesh(new THREE.BoxGeometry(.04,.035,.62),i%3?mats.metal:mats.cyan);b.position.set(Math.cos(a)*.58,Math.sin(a)*.58,0);b.rotation.z=a;b.rotation.x=Math.PI/2;spokes.add(b)}
  const pulses=[];for(let i=0;i<7;i++)pulses.push(makePulseParticle(g,1.12,mats.cyan,.55+i*.035));
  o.update=(dt,t)=>{shell.rotation.z+=dt*.08;face.rotation.z+=dt*.26;ledger.rotation.z-=dt*.43;core.rotation.y+=dt*.32;core.scale.setScalar(1+Math.sin(t*2.6)*.06);spokes.rotation.z-=dt*.16;pulses.forEach((p,i)=>{const q=p.userData.pulse;q.phase+=dt*q.speed;const r=q.radius; p.position.set(Math.cos(q.phase)*r,Math.sin(q.phase)*r,Math.sin(q.phase*3)*.08)}); face.position.z=.22+o.awake*.18;ledger.position.z=.28+o.awake*.28;core.position.z=o.awake*.18;};
}

function buildExchange(o){
  const g=o.inner; const hub=taggedMesh(new THREE.DodecahedronGeometry(.48,1),mats.crystal,o,'routing nucleus');g.add(hub);
  const rings=[];for(let i=0;i<4;i++){const r=taggedMesh(new THREE.TorusGeometry(.78+i*.28,.045,10,100),i%2?mats.blue:mats.cyan,o,'routing orbit');r.rotation.set(i*.44,Math.PI/2+i*.31,i*.22);g.add(r);rings.push(r)}
  const nodes=[];for(let i=0;i<9;i++){const n=taggedMesh(new THREE.SphereGeometry(.11,16,12),i%3?mats.metal:mats.gold,o,'venue node');const a=i/9*Math.PI*2;n.position.set(Math.cos(a)*1.45,Math.sin(a)*.7,Math.sin(a*2)*.65);g.add(n);nodes.push(n)}
  o.update=(dt,t)=>{hub.rotation.y-=dt*.4;rings.forEach((r,i)=>r.rotation.z+=dt*(.22+i*.08)*(i%2?1:-1));nodes.forEach((n,i)=>n.position.y+=Math.sin(t*1.4+i)*.0015*(1+o.awake*2));g.rotation.y+=dt*.035;};
}

function buildMarket(o){
  const g=o.inner;const center=taggedMesh(new THREE.IcosahedronGeometry(.45,1),mats.violet,o,'price discovery core');g.add(center);
  const nodes=[];for(let i=0;i<28;i++){const a=i*2.399963;const r=1+((i%7)/7)*.9;const y=(i%5-.5*4)*.23;const n=taggedMesh(new THREE.OctahedronGeometry(.06+(i%3)*.018),i%4===0?mats.gold:(i%2?mats.cyan:mats.violet),o,'market node');n.position.set(Math.cos(a)*r,y,Math.sin(a)*r);g.add(n);nodes.push(n)}
  const links=new THREE.Group();g.add(links);for(let i=0;i<nodes.length;i++){if(i%2===0){const pts=[nodes[i].position,new THREE.Vector3(0,0,0),nodes[(i+7)%nodes.length].position];const geom=new THREE.BufferGeometry().setFromPoints(pts);links.add(new THREE.Line(geom,new THREE.LineBasicMaterial({color:0x6beaff,transparent:true,opacity:.16})))} }
  o.update=(dt,t)=>{center.rotation.x+=dt*.17;center.rotation.y-=dt*.27;nodes.forEach((n,i)=>{const s=1+Math.sin(t*1.8+i*.7)*.09*(.25+o.awake);n.scale.setScalar(s)});g.rotation.y+=dt*.025;links.rotation.y-=dt*.015;};
}

function buildPool(o){
  const g=o.inner;const bowl=taggedMesh(new THREE.CylinderGeometry(1.28,1.05,.9,64,1,true),mats.glass,o,'collateral vessel');bowl.position.y=-.18;g.add(bowl);
  const liquid=taggedMesh(new THREE.CylinderGeometry(1.04,1.04,.12,64),mats.cyan,o,'liquidity field');liquid.position.y=.19;g.add(liquid);
  const core=taggedMesh(new THREE.SphereGeometry(.35,32,24),mats.green,o,'reserve core');core.position.y=-.1;g.add(core);
  const bands=[];for(let i=0;i<3;i++){const r=ring(.52+i*.24,.02,i===1?mats.gold:mats.cyan);r.rotation.x=Math.PI/2;r.position.y=.26+i*.06;g.add(r);bands.push(r)}
  o.update=(dt,t)=>{liquid.scale.x=liquid.scale.z=1+Math.sin(t*1.5)*.025;core.position.y=-.1+Math.sin(t*1.8)*.09;bands.forEach((r,i)=>r.rotation.z+=dt*(.18+i*.12)*(i%2?-1:1));bowl.scale.y=1+o.awake*.12;liquid.position.y=.19+o.awake*.16;};
}

function buildContract(o){
  const g=o.inner;const frame=taggedMesh(new THREE.BoxGeometry(1.45,1.8,.18),mats.dark,o,'covenant body');frame.rotation.z=.08;g.add(frame);
  const seal=taggedMesh(new THREE.TorusGeometry(.38,.08,12,64),mats.gold,o,'authority seal');seal.position.z=.18;g.add(seal);
  const lock=taggedMesh(new THREE.OctahedronGeometry(.24,1),mats.cyan,o,'execution lock');lock.position.z=.28;g.add(lock);
  const folds=[];for(let i=0;i<4;i++){const s=taggedMesh(new THREE.BoxGeometry(1.22,.025,.025),i%2?mats.blue:mats.cyan,o,'term line');s.position.set(0,.52-i*.34,.22);g.add(s);folds.push(s)}
  o.update=(dt,t)=>{seal.rotation.z+=dt*.18;lock.rotation.y-=dt*.6;frame.rotation.y=Math.sin(t*.55)*.08;folds.forEach((f,i)=>f.position.z=.22+o.awake*(.1+i*.045));seal.position.z=.18+o.awake*.26;lock.position.z=.28+o.awake*.42;};
}

function buildLedger(o){
  const g=o.inner;const spine=taggedMesh(new THREE.CylinderGeometry(.32,.44,3.2,8),mats.crystal,o,'authoritative spine');g.add(spine);
  const slabs=[];for(let i=0;i<9;i++){const slab=taggedMesh(new THREE.BoxGeometry(1.38,.12,.56),i%3===0?mats.gold:mats.metal,o,'journal layer');slab.position.y=-1.35+i*.34;slab.rotation.y=(i%2?1:-1)*.17;g.add(slab);slabs.push(slab)}
  const axis=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,3.7,12),mats.cyan);g.add(axis);
  o.update=(dt,t)=>{spine.rotation.y+=dt*.11;slabs.forEach((s,i)=>{s.rotation.y+=(i%2?1:-1)*dt*.018;s.position.x=Math.sin(t*.45+i)*.03+o.awake*Math.sin(i)*.08});axis.scale.y=1+Math.sin(t*1.4)*.015;};
}

function buildProof(o){
  const g=o.inner;const relic=taggedMesh(new THREE.IcosahedronGeometry(.92,2),mats.crystal,o,'proof relic');g.add(relic);
  const seal=taggedMesh(new THREE.TorusGeometry(1.16,.07,12,96),mats.gold,o,'echo seal');seal.rotation.x=Math.PI/2;g.add(seal);
  const ghosts=[];for(let i=0;i<4;i++){const ghost=taggedMesh(new THREE.IcosahedronGeometry(.92+i*.16,1),new THREE.MeshBasicMaterial({color:0x6eefff,wireframe:true,transparent:true,opacity:.05+i*.02}),o,'echo shell');g.add(ghost);ghosts.push(ghost)}
  o.update=(dt,t)=>{relic.rotation.x+=dt*.09;relic.rotation.y-=dt*.18;seal.rotation.z+=dt*.26;ghosts.forEach((x,i)=>{x.rotation.y+=dt*(.04+i*.025)*(i%2?-1:1);x.scale.setScalar(1+o.awake*.04*i+Math.sin(t*1.2+i)*.012)});};
}

function buildBots(o){
  const g=o.inner;const hive=taggedMesh(new THREE.SphereGeometry(.28,24,16),mats.violet,o,'coordination hive');g.add(hive);
  const bots=[];for(let i=0;i<8;i++){const bot=new THREE.Group();const body=taggedMesh(new THREE.CapsuleGeometry(.11,.22,4,8),i%2?mats.metal:mats.cyan,o,'autonomous actor');bot.add(body);const eye=orb(.045,mats.cyan);eye.position.z=.13;bot.add(eye);g.add(bot);bots.push(bot)}
  o.update=(dt,t)=>{hive.rotation.y-=dt*.27;bots.forEach((b,i)=>{const a=t*(.25+i*.015)+i/8*Math.PI*2;const r=1.0+(i%3)*.2+o.awake*.18;b.position.set(Math.cos(a)*r,Math.sin(a*1.7+i)*.45,Math.sin(a)*r);b.rotation.y=-a+Math.PI/2;});};
}

function buildArena(o){
  const g=o.inner;const floor=taggedMesh(new THREE.CylinderGeometry(1.52,1.8,.3,12),mats.dark,o,'runtime chamber');floor.position.y=-.45;g.add(floor);
  const cage=[];for(let i=0;i<3;i++){const r=taggedMesh(new THREE.TorusGeometry(1.26-i*.18,.045,10,80),i===1?mats.red:mats.cyan,o,'combat orbit');r.rotation.x=Math.PI/2;r.position.y=.02+i*.3;g.add(r);cage.push(r)}
  const fighters=[orb(.19,mats.red),orb(.19,mats.cyan)];fighters[0].position.x=-.65;fighters[1].position.x=.65;g.add(...fighters);
  o.update=(dt,t)=>{cage.forEach((r,i)=>r.rotation.z+=dt*(.18+i*.13)*(i%2?-1:1));fighters[0].position.set(-.55+Math.sin(t*1.4)*.35,.1+Math.sin(t*2.1)*.1,Math.cos(t*1.1)*.3);fighters[1].position.set(.55-Math.sin(t*1.25)*.35,.1+Math.cos(t*2)*.1,-Math.cos(t*1.1)*.3);floor.rotation.y+=dt*.035;};
}

function buildMatchbox(o){
  const g=o.inner;const shell=taggedMesh(new THREE.BoxGeometry(1.9,1.4,1.25),mats.dark,o,'nested container');g.add(shell);
  const edge=taggedMesh(new THREE.BoxGeometry(2.02,1.52,1.37),new THREE.MeshBasicMaterial({color:0x69ecff,wireframe:true,transparent:true,opacity:.22}),o,'matchbox field');g.add(edge);
  const items=[];const names=['Contract','Pool','Position','Treasury','Relic','Bot'];
  for(let i=0;i<6;i++){const geom=i===1?new THREE.SphereGeometry(.18,18,12):i===4?new THREE.OctahedronGeometry(.2,1):new THREE.BoxGeometry(.3,.24,.28);const x=taggedMesh(geom,[mats.gold,mats.green,mats.blue,mats.metal,mats.violet,mats.cyan][i],o,names[i]);x.position.set((i%3-1)*.48,(Math.floor(i/3)-.5)*.45,0);g.add(x);items.push(x)}
  o.update=(dt,t)=>{edge.rotation.y+=dt*.08;items.forEach((x,i)=>{const s=o.awake;const row=Math.floor(i/3)-.5;const col=i%3-1;x.position.x=col*(.48+s*.22);x.position.y=row*(.45+s*.24);x.position.z=s*(.65+Math.sin(i)*.08);x.rotation.y+=dt*(.12+i*.025)*(i%2?-1:1)});shell.scale.z=1-o.awake*.18;};
}

createOrgan({id:'logo',title:'maTumbo Gateway',body:'Identity is not a sticker. It is a spatial threshold into the system. Approach it and its internal rings separate to reveal the living machinery behind the symbol.',tags:['gateway','identity','SIMFABRIC'],position:new THREE.Vector3(0,5.1,0),scale:1.25,build:buildLogo});
createOrgan({id:ASSET_TOKEN_ORGAN_ID,title:'TUMBO Asset Token',body:'A miniature fixed-supply asset-token projection: reserve shell, counter-rotating ledger ring, value core, channels, and circulating simulation pulses.',tags:['asset-token','fixed-supply','TUMBO-SIM'],position:new THREE.Vector3(-6.2,1.8,0),build:buildAssetTokenOrgan});
createOrgan({id:'exchange',title:'Exchange Organ',body:'An orbital routing machine. Venue nodes and routing orbits move on different rhythms, visualizing exchange as flow rather than a table of tickers.',tags:['routing','trading','orbital'],position:new THREE.Vector3(-3.2,1.2,-5.8),build:buildExchange});
createOrgan({id:'market',title:'Market Organ',body:'A living constellation of price-discovery nodes. The market is a changing field of relationships, not a rectangular widget.',tags:['discovery','network','signals'],position:new THREE.Vector3(3.3,1.1,-6.1),build:buildMarket});
createOrgan({id:'pool',title:'Pool Organ',body:'A containment organism for collateral and liquidity. The vessel, reserve core and balance bands visibly breathe as exposure changes.',tags:['collateral','liquidity','containment'],position:new THREE.Vector3(6.4,1.2,-1),build:buildPool});
createOrgan({id:'contract',title:'Contract / Covenant',body:'A folded geometric instrument with a visible authority seal, execution lock and term layers that separate under inspection.',tags:['terms','authority','execution'],position:new THREE.Vector3(6.0,1.25,4.4),build:buildContract});
createOrgan({id:'ledger',title:'Prime Ledger',body:'The authoritative architectural spine. Journal layers orbit an immutable-looking central axis. Rendering is only projection; settlement truth lives outside the renderer.',tags:['authoritative','double-entry','projection'],position:new THREE.Vector3(1.8,1.1,6.7),scale:.9,build:buildLedger});
createOrgan({id:'proof',title:'EchoProof Relic',body:'A sealed luminous relic with echo shells: a spatial receipt/proof object that preserves evidence without pretending the visual layer is the authority.',tags:['receipt','proof','anchor'],position:new THREE.Vector3(-3.5,1.0,6.2),build:buildProof});
createOrgan({id:'bots',title:'Autonomous Actors',body:'Bots are moving inhabitants, not menu items. They orbit a coordination hive and can later be driven by capabilities and live SIMFABRIC state.',tags:['actors','capability','autonomy'],position:new THREE.Vector3(-7.2,1.0,5.0),scale:.92,build:buildBots});
createOrgan({id:'arena',title:'ARENA Runtime',body:'A kinetic runtime chamber. Its rings, actors and state motion make ARENA feel like one organ inside the larger Living Reality—not the whole system.',tags:['runtime','simulation','kinetic'],position:new THREE.Vector3(-7.0,1.0,-5.1),scale:.92,build:buildArena});
createOrgan({id:'matchbox',title:'Matchbox Organ',body:'A nested spatial container. Hovering pulls its internal entities outward—Contract, Pool, Position, Treasury, Relic and Bot—without opening a flat drawer UI.',tags:['nested','container','entities'],position:new THREE.Vector3(0,0.7,-9.4),scale:.88,build:buildMatchbox});

// Every organ grows its own semantic anatomy. These are hoverable 3D objects.
const semanticById={
  logo:[
    {label:'IDENTITY',kind:'authority',detail:'The identity core describes who or what this threshold represents without making the renderer authoritative.',tokens:['SCOPE','BOUND','SIGNAL']},
    {label:'THRESHOLD',kind:'info',detail:'The gateway is a passage between world regions, organs and interaction contexts.',tokens:['ENTER','ROUTE','RETURN']},
    {label:'SIMFABRIC',kind:'autonomy',detail:'The visual organ can later project canonical SIMFABRIC state while remaining presentation-only.',tokens:['STATE','EVENT','PROJECTION']}
  ],
  [ASSET_TOKEN_ORGAN_ID]:[
    {label:'RESERVE',kind:'health',detail:'Reserve state becomes visible as mass, pressure and core behavior rather than a number alone.',tokens:['HEALTH','DEPTH','BUFFER']},
    {label:'LEDGER',kind:'authority',detail:'Ledger linkage is represented by the counter-rotating journal ring; authority still lives outside the renderer.',tokens:['JOURNAL','BALANCE','TRACE']},
    {label:'FLOW',kind:'value',detail:'Value movement travels through visible channels as pulses and routes.',tokens:['IN','OUT','ROUTE']}
  ],
  exchange:[
    {label:'ROUTING',kind:'info',detail:'Routes are spatial paths through venues and liquidity rather than rows in a table.',tokens:['PATH','VENUE','QUOTE']},
    {label:'VENUES',kind:'value',detail:'Venue nodes express alternative execution locations and relationships.',tokens:['SOURCE','DEPTH','SPREAD']},
    {label:'SETTLEMENT',kind:'authority',detail:'A visual settlement object may show status, but cannot authorize settlement.',tokens:['PROOF','COMMIT','RECEIPT']}
  ],
  market:[
    {label:'SIGNALS',kind:'autonomy',detail:'Signals emerge as changing relationships among market nodes.',tokens:['PRICE','VOLUME','TIME']},
    {label:'DISCOVERY',kind:'info',detail:'Price discovery is visualized as the field negotiating a temporary shape.',tokens:['BID','ASK','FIELD']},
    {label:'RELATIONS',kind:'autonomy',detail:'Correlations and dependencies become geometry connecting instruments.',tokens:['LINK','SHIFT','REGIME']}
  ],
  pool:[
    {label:'COLLATERAL',kind:'authority',detail:'Collateral is embodied by the vessel and its bounded capacity.',tokens:['BOUND','QUALITY','CLAIM']},
    {label:'LIQUIDITY',kind:'health',detail:'Liquidity becomes a visible field that can breathe, thin or thicken.',tokens:['DEPTH','FLOW','ACCESS']},
    {label:'EXPOSURE',kind:'risk',detail:'Exposure can deform or stress the containment organ as it approaches limits.',tokens:['USED','LIMIT','STRESS']}
  ],
  contract:[
    {label:'AUTHORITY',kind:'authority',detail:'Who can act, under which capability, scope and proof.',tokens:['PROOF','SCOPE','SIGNER']},
    {label:'CONDITIONS',kind:'info',detail:'Terms are physical layers. Each condition can be inspected as its own semantic object.',tokens:['IF','WHEN','UNTIL']},
    {label:'EXECUTION',kind:'risk',detail:'The execution lock separates proposal from actual commit.',tokens:['CHECK','COMMIT','RECEIPT']}
  ],
  ledger:[
    {label:'JOURNAL',kind:'authority',detail:'Journal layers represent balanced economic records projected into space.',tokens:['DEBIT','CREDIT','ENTRY']},
    {label:'BALANCE',kind:'value',detail:'Balance is an invariant relationship, not merely a glowing number.',tokens:['ASSET','CLAIM','NET']},
    {label:'PROJECTION',kind:'info',detail:'This object is a projection of authoritative state, never the source of settlement truth.',tokens:['STATE','VIEW','TRACE']}
  ],
  proof:[
    {label:'RECEIPT',kind:'authority',detail:'A receipt binds an observed result to evidence.',tokens:['EVENT','RESULT','HASH']},
    {label:'ANCHOR',kind:'value',detail:'Anchoring expresses where proof is fixed or referenced.',tokens:['TIME','ROOT','LINK']},
    {label:'ECHO',kind:'info',detail:'Echo shells show derived traces around the sealed proof relic.',tokens:['TRACE','COPY','HISTORY']}
  ],
  bots:[
    {label:'CAPABILITY',kind:'authority',detail:'An actor may only expose actions permitted by its capability boundary.',tokens:['ALLOW','DENY','SCOPE']},
    {label:'INTENT',kind:'autonomy',detail:'Intent is an expressed goal, not automatic authority to execute.',tokens:['GOAL','PLAN','REQUEST']},
    {label:'COORDINATION',kind:'autonomy',detail:'Actors coordinate through visible relationships and event flow.',tokens:['SEND','WAIT','SYNC']}
  ],
  arena:[
    {label:'RUNTIME',kind:'autonomy',detail:'ARENA is one runtime inside the larger reality.',tokens:['START','STATE','STOP']},
    {label:'STATE',kind:'info',detail:'The chamber expresses current simulation/game state through motion and geometry.',tokens:['FRAME','ACTOR','RULE']},
    {label:'OUTCOME',kind:'value',detail:'Outcomes can be represented and proven without giving the renderer financial authority.',tokens:['RESULT','PROOF','REWARD']}
  ],
  matchbox:[
    {label:'CONTRACT',kind:'authority',detail:'Nested covenant entity.',tokens:['TERMS','LOCK','TRACE']},
    {label:'POOL',kind:'health',detail:'Nested collateral/liquidity entity.',tokens:['DEPTH','RESERVE','LIMIT']},
    {label:'POSITION',kind:'risk',detail:'Nested exposure/ownership state.',tokens:['SIZE','SIDE','RISK']},
    {label:'TREASURY',kind:'value',detail:'Nested reserve/value container.',tokens:['ASSET','FLOW','POLICY']},
    {label:'RELIC',kind:'autonomy',detail:'Nested proof/history artifact.',tokens:['PROOF','TIME','ECHO']},
    {label:'BOT',kind:'autonomy',detail:'Nested autonomous actor.',tokens:['CAP','INTENT','EVENT']}
  ]
};
organs.forEach(o=>attachSemanticObjects(o,semanticById[o.id]||[]));

// SIMFABRIC owns truth; this layer only maps its projection onto the stable
// eleven-organ visual vocabulary. Missing entities retain the baseline study.
function projectionOrganId(entity){
  return entity.organId ?? entity.presentation?.organId ?? entity.projection?.organId ?? entity.id;
}

function applyProjection(projection){
  personOrganisms.syncProjection(projection);
  const assetTokenProjection = Array.isArray(projection?.contributions)
    ? projection.contributions.find((contribution) => contribution?.source === 'tumbo-asset-token')
    : null;
  if (assetTokenProjection) distributionExplorer.syncProjection(assetTokenProjection);
  if (assetTokenProjection) launchReceipt?.syncProjection(projection);
  featureNavigator?.setProjection(projection);
  launchConsole?.setProjection(projection);
  socialExplorer?.setProjection(projection);
  roomSpaces?.setProjection(projection);
  blockWorld?.syncProjection(projection);
  const distribution = Array.isArray(projection?.contributions) ? projection.contributions.find((contribution) => contribution?.source === 'tumbo-distribution-registry') : null;
  blockWorld?.setDistributionCohorts?.(distribution?.registry ?? []);
  if (!blockWorldSnapshot?.getSnapshot?.()?.opened) {
    blockWorldSnapshot?.syncProjection(blockWorld?.getSnapshot?.()?.draft ?? projection);
  }
  const migrationContribution = Array.isArray(projection?.contributions)
    ? projection.contributions.find((contribution) => contribution?.source === BLOCK_MIGRATION_SOURCE)
    : null;
  if (migrationContribution) blockMigration?.syncManifest(migrationContribution);
  if (migrationContribution) migrationSnapshot?.syncProjection(projection);
  const arenaContribution = Array.isArray(projection?.contributions)
    ? projection.contributions.find((contribution) => contribution?.source === ARENA_GAMES_SOURCE)
    : null;
  if (arenaContribution) arenaGames?.syncProjection(arenaContribution);
  const contractsContribution = Array.isArray(projection?.contributions)
    ? projection.contributions.find((contribution) => contribution?.source === CONTRACTS_MARKETS_SOURCE)
    : null;
  if (contractsContribution) contractsMarkets?.syncProjection(contractsContribution);
  const paycoreContribution = Array.isArray(projection?.contributions)
    ? projection.contributions.find((contribution) => contribution?.source === PAYCORE_SOURCE)
    : null;
  if (paycoreContribution) paycoreConsole?.syncProjection(paycoreContribution);
  const t402Contribution = Array.isArray(projection?.contributions)
    ? projection.contributions.find((contribution) => contribution?.source === T402_SOURCE)
    : null;
  if (t402Contribution) t402Console?.syncProjection(t402Contribution);
  const neuralMeshContribution = Array.isArray(projection?.contributions)
    ? projection.contributions.find((contribution) => contribution?.source === NEURAL_MESH_SOURCE)
    : null;
  if (neuralMeshContribution) neuralMeshConsole?.syncProjection(neuralMeshContribution);
  const pictureMatterContribution = Array.isArray(projection?.contributions)
    ? projection.contributions.find((contribution) => contribution?.source === MATTER_FORGE_SOURCE)
    : null;
  if (pictureMatterContribution) pictureMatterConsole?.syncProjection(pictureMatterContribution);
  const ledgerProofContribution = Array.isArray(projection?.contributions)
    ? projection.contributions.find((contribution) => contribution?.source === LEDGER_PROOF_SOURCE)
    : null;
  if (ledgerProofContribution) ledgerProofConsole?.syncProjection(ledgerProofContribution);
  const liveGatewayContribution = Array.isArray(projection?.contributions)
    ? projection.contributions.find((contribution) => contribution?.source === LIVE_GATEWAY_SOURCE)
    : null;
  if (liveGatewayContribution) liveGatewayConsole?.syncProjection(liveGatewayContribution);
  if(!realityLensPersonId)realityLensPersonId=personOrganisms.defaultPersonId();
  const projectedById=new Map(projection.entities.map(entity=>[projectionOrganId(entity),entity]));
  organs.forEach(organ=>{
    const entity=projectedById.get(organ.id);
    if(!entity)return;
    organ.projectionEntity=entity;
    const presentation=entity.presentation ?? entity.projection ?? entity;
    if(typeof presentation.title==='string')organ.title=presentation.title;
    if(typeof presentation.body==='string')organ.body=presentation.body;
    if(Array.isArray(presentation.tags))organ.tags=presentation.tags.filter(tag=>typeof tag==='string');
    if(Array.isArray(presentation.position)&&presentation.position.length>=3){
      const [x,y,z]=presentation.position;
      if([x,y,z].every(Number.isFinite))organ.root.position.set(x,y,z);
    }
    if(typeof presentation.visible==='boolean')organ.root.visible=presentation.visible;
    if(Number.isFinite(presentation.awake))organ.targetAwake=THREE.MathUtils.clamp(presentation.awake,0,1);
    if(organ.selectorButton)organ.selectorButton.textContent=organ.title.replace(' Organ','');
    if(Array.isArray(presentation.semantics)){
      presentation.semantics.forEach(def=>{
        const node=organ.semanticNodes.find(candidate=>candidate.def.label===def.label);
        if(node&&typeof def.detail==='string')node.def={...node.def,...def};
      });
    }
  });
}

// The bridge publishes the initial deterministic world immediately.  Keep the
// renderer subscribed so later local projection replays update people and the
// distribution map without giving the page any authority over the source.
projectionBridge.subscribe(applyProjection);

// Spatial floor field. The grid and horizon rings belong to the organic
// Reality Lens presentation, so the cube workspace can temporarily hide
// them along with the round semantic layers.
const grid = new THREE.GridHelper(38, 38, 0x14303a, 0x081319); grid.position.y=-1.2; scene.add(grid);
grid.material.transparent=true;grid.material.opacity=.33;
const blockWorldHorizonRings=[];
for(let r=5;r<=18;r+=3.2){const h=ring(r,.01,new THREE.MeshBasicMaterial({color:0x204a58,transparent:true,opacity:.12}));h.rotation.x=Math.PI/2;h.position.y=-1.15;scene.add(h);blockWorldHorizonRings.push(h)}

// Star/data dust
const starsGeo=new THREE.BufferGeometry();const arr=[];for(let i=0;i<(isMobile?320:1000);i++){const r=30*Math.cbrt(Math.random());const th=Math.random()*Math.PI*2;const ph=Math.acos(2*Math.random()-1);arr.push(r*Math.sin(ph)*Math.cos(th),r*Math.cos(ph)*.7,r*Math.sin(ph)*Math.sin(th));}starsGeo.setAttribute('position',new THREE.Float32BufferAttribute(arr,3));
scene.add(new THREE.Points(starsGeo,new THREE.PointsMaterial({size:.025,color:0x6bdff5,transparent:true,opacity:.42,sizeAttenuation:true})));

// Secondary selector
const selector=document.getElementById('selector');
organs.forEach(o=>{const b=document.createElement('button');b.textContent=o.title.replace(' Organ','');b.onclick=()=>focusOrgan(o,'selector');o.selectorButton=b;selector.appendChild(b)});

const readout=document.getElementById('readout'), eyebrowEl=document.getElementById('readout-eyebrow'), titleEl=document.getElementById('readout-title'), bodyEl=document.getElementById('readout-body'), metaEl=document.getElementById('readout-meta');
function showReadout(o){eyebrowEl.textContent=o.eyebrow??'ORGAN FIELD';titleEl.textContent=o.title;bodyEl.textContent=o.body;metaEl.innerHTML='';o.tags.forEach(t=>{const s=document.createElement('span');s.className='pill';s.textContent=t;metaEl.appendChild(s)});readout.classList.add('visible')}
function showSemanticReadout(node){eyebrowEl.textContent='SEMANTIC OBJECT';titleEl.textContent=node.def.label;bodyEl.textContent=node.def.detail;metaEl.innerHTML='';(node.def.tokens||[]).forEach(t=>{const s=document.createElement('span');s.className='pill';s.textContent=t;metaEl.appendChild(s)});readout.classList.add('visible')}
function hideReadout(){readout.classList.remove('visible')}

// TUMBO launch surface ------------------------------------------------------
// This panel is a local, deterministic explorer for aggregate allocation
// classes.  It deliberately never renders an address, wallet, price, claim,
// or transfer control.
const assetLaunchPanel=document.getElementById('asset-launch');
const assetLaunchButton=document.getElementById('asset-launch-button');
const assetLaunchStatus=document.getElementById('asset-launch-status');
const assetSupplyEl=document.getElementById('asset-supply');
const assetAllocationCountEl=document.getElementById('asset-allocation-count');
const distributionList=document.getElementById('distribution-list');
const integerFormatter=new Intl.NumberFormat('en-US');

function formatAssetUnits(value){return Number.isSafeInteger(value)?integerFormatter.format(value):'—'}

function showDistributionReadout(target){
  if (portalCubeSubstrateActive || blockWorldPresentationActive) {
    restorePortalCubeReadout('portal');
    return;
  }
  const allocation=target?.allocation;
  if(!allocation)return;
  const percentage=allocation.percent??allocation.percentage??0;
  eyebrowEl.textContent='TUMBO ASSET TOKEN · ALLOCATION PREVIEW';
  titleEl.textContent=allocation.label??allocation.recipientClass??'Aggregate cohort';
  bodyEl.textContent=`${percentage}% of the fixed ${formatAssetUnits(distributionExplorer.getSnapshot().totalSupply)} ${distributionExplorer.getSnapshot().unit} supply · ${formatAssetUnits(allocation.tokenUnits)} units. ${allocation.purpose??'Fictional aggregate cohort in the local demo.'} No transfer occurs.`;
  metaEl.innerHTML='';
  ['simulation only','aggregate cohort','no transfer',`${percentage}%`].forEach((tag)=>{const s=document.createElement('span');s.className='pill';s.textContent=tag;metaEl.appendChild(s)});
  readout.classList.add('visible');
}

function showRoomReadout(room){
  if(!room)return;
  const snapshot=roomSpaces.getSnapshot();
  eyebrowEl.textContent='ROOM SPACE · LOCAL MEMBERSHIP';
  titleEl.textContent=room.label;
  bodyEl.textContent=`${room.context} room · ${room.privacy} · ${room.role} membership. ${snapshot.enteredRoomId===room.id?'You are inside this renderer-only room.':'Select it in Rooms + Messaging to enter locally.'}`;
  metaEl.innerHTML='';
  ['spatial portal',room.role??'observer',`${room.memberCount??0} member`,snapshot.enteredRoomId===room.id?'inside':'outside'].forEach((tag)=>{const s=document.createElement('span');s.className='pill';s.textContent=tag;metaEl.appendChild(s)});
  readout.classList.add('visible');
}

function showBlockReadout(block,action='select',contentFocus=null){
  if(!block)return;
  eyebrowEl.textContent='BLOCK WORLD · LOCAL VOXEL';
  titleEl.textContent=`${block.label} block`;
  const nested=block.container ? `${block.open?'OPEN':'CLOSED'} container with ${block.contentCount??block.contents?.length??0} nested item${(block.contentCount??block.contents?.length??0)===1?'':'s'}` : 'solid cube';
  const actionCopy=action==='gaze-lock'
    ? ' EYE LOCK ARMED: this cube is outlined in red for the short gaze window. Use the same host hand to PINCH, POINT, OPEN, INSPECT, GRAB, HOLD, PLACE, RELEASE, or XR SELECT.'
    : action==='gaze-hand-point'||action==='gaze-hand-point-confirmed'
    ? ' COUPLED POINT CONFIRMED: the hand signal addressed the fresh gaze-locked cube; no cube edit occurred.'
    : action==='gaze-hand-select'
    ? ' COUPLED SELECT CONFIRMED: the hand/XR signal addressed the same fresh gaze-locked cube.'
    : action==='gaze-hand-open'||action==='gaze-hand-already-open'
    ? ' COUPLED OPEN CONFIRMED: the same gaze-locked cube handled the hand signal; its existing contents remain local.'
    : action==='gaze-hand-inspect'
    ? ' COUPLED INSPECT CONFIRMED: the same gaze-locked cube exposed its existing local contents.'
    : action==='gaze-hand-open-unavailable'
    ? ' COUPLED OPEN BLOCKED: this gaze-locked target is not an openable container.'
    : action==='gaze-hand-inspect-unavailable'
    ? ' COUPLED INSPECT BLOCKED: no inspectable contents are present on this gaze-locked target.'
    : action==='gaze-hand-grab'
    ? ' COUPLED GRAB CONFIRMED: this same gaze-locked cube is detached into the local held draft. Use an explicit HOLD delta, then PLACE or RELEASE at its current cell.'
    : action==='gaze-hand-hold'
    ? ' COUPLED HOLD CONFIRMED: the same held cube moved by one sanitized bounded grid step. No hand or camera coordinates were inferred.'
    : action==='gaze-hand-place'
    ? ' COUPLED PLACE CONFIRMED: the same held cube was released into its current bounded empty cell.'
    : action==='gaze-hand-release'
    ? ' COUPLED RELEASE CONFIRMED: the same held cube was placed at its current bounded cell.'
    : action==='gaze-hand-grab-blocked'
    ? ' COUPLED GRAB BLOCKED: place the current held draft before grabbing another cube; the local draft stayed unchanged.'
    : action==='gaze-hand-hold-blocked'
    ? ' COUPLED HOLD BLOCKED: provide a sanitized integer one-step delta while the same gaze-locked cube is held; the local draft stayed unchanged.'
    : action==='gaze-hand-place-blocked'||action==='gaze-hand-release-blocked'
    ? ' COUPLED PLACE BLOCKED: look at the same held gaze target before releasing; the local draft stayed unchanged.'
    : action==='gaze-hand-debounced'
    ? ' COUPLED ACTION DEBOUNCED: keep looking at the same cube and wait for the short action guard.'
    : action==='hover'
    ? block.container
      ? ` HOVER PREVIEW: ${block.contentCount??block.contents?.length??0} nested cube${(block.contentCount??block.contents?.length??0)===1?'':'s'} are revealed immediately; click selects, double-activation opens.`
      : ' HOVER PREVIEW: this solid cube has no nested contents; click selects it.'
    : action==='inspect'?' Contents are shown in the Block World console.':action==='open'?' Lid lifted; nested cubes are visible.':action==='close'?' Lid closed; nested cubes remain inspectable locally.':action==='move'?' Cube moved one bounded grid step.':action==='grab'?' Cube detached into carry mode; use HOLD steps or Place cube.':action==='hold'?' Cube carried one bounded grid step.':action==='place'?' Cube placed back into the local grid.':action==='portal'?' Double-tap this portal cube to dive inside its feature world; choose a local feature surface in the cube console.':' Click it to select.';
  const contentCopy = contentFocus?.contentId
    ? ` Focused nested cube: ${contentFocus.contentLabel ?? 'Nested cube'} · ${contentFocus.contentType ?? 'block-content'} · ID ${contentFocus.contentId} · parent ${contentFocus.parentBlockId ?? block.id}.`
    : '';
  bodyEl.textContent=`Coordinate ${block.x}, ${block.y}, ${block.z}. ${nested}.${actionCopy}${contentCopy} Use Open, Inspect, Move, Grab, Hold, Place, or Release; no sync occurs.`;
  metaEl.innerHTML='';
  ['semantic cube',block.blockType??'stone',block.container?'container':'solid',contentFocus?.contentId?'nested content selected':action==='gaze-lock'?'eye lock · red cue':String(action).startsWith('gaze-hand-')?'eye + hand coupled':action==='hover'?'hover preview only':action==='move'?'moved locally':action==='grab'?'held locally':action==='hold'?'carried locally':action==='place'||action==='release'?'placed locally':'local draft only','no sync'].forEach((tag)=>{const s=document.createElement('span');s.className='pill';s.textContent=tag;metaEl.appendChild(s)});
  readout.classList.add('visible');
}

function renderDistributionPanel(snapshot=distributionExplorer.getSnapshot()){
  if(!snapshot)return;
  if(assetSupplyEl)assetSupplyEl.textContent=formatAssetUnits(snapshot.totalSupply);
  if(assetAllocationCountEl)assetAllocationCountEl.textContent=String(snapshot.allocationCount??0);
  if(assetLaunchStatus){
    const state=snapshot.launchState?.launched?'SIMULATED MAP ACTIVE':'SIMULATED MAP READY';
    assetLaunchStatus.textContent=`${state} · NO WALLET · NO TRANSFER`;
  }
  if(assetLaunchButton)assetLaunchButton.textContent=snapshot.launchState?.launched?'Replay launch preview':'Preview launch map';
  if(!distributionList)return;
  distributionList.replaceChildren();
  (snapshot.allocations??[]).forEach((allocation)=>{
    const item=document.createElement('button');
    item.type='button';
    item.className='distribution-row';
    item.setAttribute('aria-pressed',String(allocation.id===snapshot.selectedAllocationId));
    item.dataset.allocationId=allocation.id;
    item.innerHTML=`<span class="distribution-row-label"></span><span class="distribution-row-value"></span>`;
    item.querySelector('.distribution-row-label').textContent=allocation.label;
    item.querySelector('.distribution-row-value').textContent=`${allocation.percent??allocation.percentage??0}% · ${formatAssetUnits(allocation.tokenUnits)}`;
    item.addEventListener('click',()=>{
      const next=distributionExplorer.selectAllocation(allocation.id);
      showDistributionReadout({id:allocation.id,allocation:next.selectedAllocation??allocation});
      renderDistributionPanel(next);
      projectionBridge.emitIntent('projection.select-distribution',allocation.id,{recipientClass:allocation.recipientClass,simulation:true});
    });
    distributionList.appendChild(item);
  });
  window.__TUMBO_ASSET_TOKEN_LAUNCH__=snapshot;
}

function previewAssetLaunch(method='button'){
  const snapshot=distributionExplorer.setLaunchState({status:'previewed',launched:true});
  renderDistributionPanel(snapshot);
  const selected=snapshot.selectedAllocation;
  if(selected)showDistributionReadout({id:selected.id,allocation:selected});
  projectionBridge.emitIntent('projection.asset-token-launch-preview','distribution:tumbo-demo-launch',{
    method,
    status:'previewed',
    allocationCount:snapshot.allocationCount,
    totalSupply:snapshot.totalSupply,
    simulation:true,
    externalTransfer:false,
  });
  return snapshot;
}

// The intent timeline is a renderer-only observer over the bridge event. It
// is mounted before the first launch reveal so the initial local replay is
// visible alongside later Mission Control, camera, lens, and social actions.
intentTimeline = createIntentTimeline({
  documentRoot: document,
  eventRoot: window,
  projection: livingRealityWorld,
});
window.__TUMBO_INTENT_TIMELINE__ = intentTimeline;

assetLaunchButton?.addEventListener('click',()=>previewAssetLaunch('button'));
renderDistributionPanel();
// The first paint is already a simulated launch preview; the button simply
// replays the local reveal and emits another non-authoritative intent.
previewAssetLaunch('demo-load');

// The full registry console is a separate, scrollable surface from the
// aggregate 3-D allocation map. It consumes the canonical registry
// contribution and can only replay a frozen local preview intent.
launchConsole = createLaunchConsole({
  documentRoot: document,
  projection: livingRealityWorld,
  populationContext,
  onRehearse: (request) => {
    const rehearsal = createLaunchDistributionRehearsal({
      method: request?.trigger ?? 'button',
    });
    const snapshot = distributionExplorer.setLaunchState({
      status: 'previewed',
      launched: true,
    });
    renderDistributionPanel(snapshot);
    // A rehearsal is only complete when its fixed registry can be inspected
    // immediately. Rebuild the deterministic local receipt from the same
    // projection, then hand the viewer to its cohort-level details; no
    // issuance, recipient, transfer, or persistent state is created.
    launchReceipt?.syncProjection(livingRealityWorld);
    launchConsole?.close();
    launchReceipt?.open();
    projectionBridge.emitIntent(
      'projection.launch-distribution-rehearsal',
      rehearsal.actionId,
      Object.freeze({
        launchId: rehearsal.launchId,
        eventId: rehearsal.eventId,
        trigger: rehearsal.trigger,
        status: rehearsal.status,
        registryComplete: rehearsal.registryComplete,
        registryEntryCount: rehearsal.registryEntryCount,
        allocationClassCount: rehearsal.allocationClassCount,
        completeClassCount: rehearsal.completeClassCount,
        totalSupply: rehearsal.totalSupply,
        totalUnits: rehearsal.totalUnits,
        totalBasisPoints: rehearsal.totalBasisPoints,
        simulation: true,
        localOnly: true,
        deterministic: true,
        externalDistribution: false,
        externalTransfer: false,
        walletConnection: false,
        custody: false,
        signing: false,
        settlement: false,
        issuance: false,
        money: false,
        executable: false,
      }),
    );
    return rehearsal;
  },
  onReplay: (replay) => {
    const snapshot = distributionExplorer.setLaunchState({
      status: 'previewed',
      launched: true,
    });
    renderDistributionPanel(snapshot);
    projectionBridge.emitIntent(
      'projection.launch-distribution-console-replay',
      replay.eventId,
      Object.freeze({
        launchId: replay.launchId,
        eventId: replay.eventId,
        replayCount: replay.replayCount,
        rowCount: replay.rowCount,
        totalSupply: replay.totalSupply,
        totalUnits: replay.totalUnits,
        totalBasisPoints: replay.totalBasisPoints,
        status: 'previewed',
        simulation: true,
        executable: false,
        externalTransfer: false,
      }),
    );
  },
  onSelect: (row) => {
    const mapSnapshot = distributionExplorer.selectAllocation(row.allocationId);
    if (mapSnapshot.selectedAllocation) {
      showDistributionReadout({ allocation: mapSnapshot.selectedAllocation });
      renderDistributionPanel(mapSnapshot);
    }
    projectionBridge.emitIntent(
      'projection.inspect-distribution-registry-row',
      row.id,
      Object.freeze({
        allocationId: row.allocationId,
        recipientClass: row.recipientClass,
        basisPoints: row.basisPoints,
        tokenUnits: row.tokenUnits,
        simulation: true,
        executable: false,
        externalTransfer: false,
      }),
    );
  },
  onJourney: (step) => {
    if (step.step === 'reveal') {
      const snapshot = distributionExplorer.setLaunchState({
        status: 'previewed',
        launched: true,
      });
      renderDistributionPanel(snapshot);
    }
    if (step.step === 'registry') {
      launchConsole?.open();
    }
    if (step.step === 'social') {
      // The journey crosses from the registry into the existing Social
      // Explorer surface. Update the one shared feature identity first so
      // future-option actions, cube quick controls, and a return through
      // Mission Control describe the console that is actually visible.
      alignFeatureSurface('social-explorer', 'launch-journey:social');
      launchConsole?.close();
      // This handoff can originate while Mission Control is still open on
      // the Launch Distribution card. Collapse it before opening Social
      // Explorer so the selected social/space controls are not hidden under
      // a stale directory overlay.
      featureNavigator?.close();
      socialExplorer?.open();
    }
    projectionBridge.emitIntent(
      'projection.launch-journey-step',
      `launch-journey:${step.step}`,
      Object.freeze({
        step: step.step,
        index: step.index,
        count: step.count,
        method: step.method,
        simulation: true,
        localOnly: true,
        externalNetwork: false,
        externalTransfer: false,
        executable: false,
      }),
    );
  },
  onPopulationRefresh: async ({ method, refreshCount }) => {
    const result = await fetchPopulationContext();
    populationContext = result;
    launchConsole?.setPopulationContext?.(result);
    projectionBridge.emitIntent(
      'projection.refresh-population-context',
      POPULATION_CONTEXT_SOURCE,
      Object.freeze({
        action: 'refresh',
        method,
        refreshCount,
        provider: result?.provider ?? 'World Bank Indicators API',
        indicator: result?.indicator ?? 'SP.POP.TOTL',
        status: result?.status ?? 'unavailable',
        recordCount: result?.records?.length ?? 0,
        contextCount: result?.contextStatuses?.filter?.((entry) => entry?.status === 'provider-reported').length ?? 0,
        retrievedAt: result?.retrievedAt ?? null,
        publicSource: true,
        metadataOnly: true,
        contextualOnly: true,
        recipientCount: false,
        allocationWeight: false,
        geocoded: false,
        identityResolution: false,
        issuance: false,
        wallet: false,
        transfer: false,
        custody: false,
        signing: false,
        settlement: false,
        externalNetwork: result?.externalNetwork === true,
        simulation: true,
        localOnly: true,
        executable: false,
      }),
    );
    return result;
  },
});
launchConsole.setProjection(livingRealityWorld);
// Rehearse the complete aggregate registry at demo launch so the first
// visible console state has an inspectable reconciliation receipt. This is a
// local projection action and never issues, moves, or publishes anything.
launchConsole.rehearse('demo-launch');
window.__TUMBO_LAUNCH_CONSOLE__ = launchConsole;
window.__TUMBO_POPULATION_CONTEXT__ = Object.freeze({
  getSnapshot: () => populationContext,
  refresh: (method = 'api') => launchConsole?.refreshPopulationContext?.(method),
});
// The launch receipt is an inspectable, shareable summary of the same fixed
// fictional registry. It adds no claim path: selection, replay, and the
// optional user-triggered JSON download only emit local intents.
launchReceipt = createLaunchReceiptConsole({
  documentRoot: document,
  projection: livingRealityWorld,
  onSelect: (snapshot) => {
    const allocationId = snapshot.cohort?.allocationId;
    if (allocationId) {
      const mapSnapshot = distributionExplorer.selectAllocation(allocationId);
      if (mapSnapshot.selectedAllocation) {
        showDistributionReadout({ allocation: mapSnapshot.selectedAllocation });
        renderDistributionPanel(mapSnapshot);
      }
    }
    projectionBridge.emitIntent('projection.select-launch-receipt-cohort', `${LAUNCH_RECEIPT_CONSOLE_SOURCE}:${snapshot.cohortId}`, Object.freeze({
      cohortId: snapshot.cohortId,
      method: snapshot.method,
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      externalDistribution: false,
      custody: false,
      signing: false,
      transfer: false,
      exchange: false,
      persistence: false,
      executable: false,
    }));
  },
  onReplay: (snapshot) => projectionBridge.emitIntent('projection.replay-launch-rehearsal-receipt', LAUNCH_RECEIPT_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    receiptId: snapshot.receiptId,
    cohortId: snapshot.cohortId,
    replayCount: snapshot.replayCount,
    sequence: snapshot.sequence,
    exact: snapshot.exact === true,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    externalDistribution: false,
    custody: false,
    signing: false,
    transfer: false,
    exchange: false,
    persistence: false,
    executable: false,
  })),
  onDownload: (snapshot) => projectionBridge.emitIntent('projection.download-launch-rehearsal-receipt', LAUNCH_RECEIPT_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    method: snapshot.method,
    status: snapshot.status,
    receiptId: snapshot.receiptId,
    filename: snapshot.filename,
    validated: snapshot.validated === true,
    bytes: snapshot.bytes ?? 0,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    externalDistribution: false,
    custody: false,
    signing: false,
    transfer: false,
    exchange: false,
    persistence: false,
    executable: false,
  })),
  onReset: (snapshot) => projectionBridge.emitIntent('projection.reset-launch-rehearsal-receipt', LAUNCH_RECEIPT_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    method: snapshot.method,
    simulation: true,
    localOnly: true,
    externalNetwork: false,
    externalDistribution: false,
    custody: false,
    signing: false,
    transfer: false,
    exchange: false,
    persistence: false,
    executable: false,
  })),
});
window.__TUMBO_LAUNCH_RECEIPT__ = launchReceipt;
document.getElementById('launch-receipt-open')?.addEventListener('click', () => {
  launchKitConsole?.close();
  launchConsole?.close();
  launchReceipt?.open();
});

// Launch Kit is the explicit hand-off for the complete local demo package:
// every route, the fixed fictional allocation manifest, migration mappings,
// social catalog, and device projection metadata live behind one inspectable
// surface.  It is intentionally separate from the registry and receipt so a
// viewer can return to a feature without stacking opaque panels.
function openLaunchKit(method = 'button') {
  // Launch Kit is an auxiliary manifest panel, not a separate competing
  // world.  Its visible substrate is the Reality Lens world field.  Reset a
  // stale feature identity (for example Asset Market) before opening the
  // panel so the shared projection session, cube quick actions, and mounted
  // panel describe the same local handoff.
  alignFeatureSurface('reality-lens', `launch-kit:${method}`);
  featureNavigator?.close();
  cubeQuickActions?.close('launch-kit');
  setBlockWorldFocusMode(true);
  // Launch Kit is still a cube workspace.  Restoring the legacy organic
  // layers here made the hand-off look like the old round demo and left the
  // actual block interaction surface underneath it.  Keep the canonical
  // round layers mounted for projection bookkeeping, but hide them from the
  // visible route so only interactive cubes remain in the world.
  setBlockWorldPresentation(true, { cubeFirstUi: true });
  launchConsole?.close();
  launchReceipt?.close();
  socialExplorer?.close();
  roomSpaces?.close();
  blockWorld?.close();
  blockMigration?.close();
  migrationSnapshot?.close();
  blockWorldSnapshot?.close();
  arenaGames?.close();
  contractsMarkets?.close();
  paycoreConsole?.close();
  t402Console?.close();
  neuralMeshConsole?.close();
  pictureMatterConsole?.close();
  nftAtelierConsole?.close();
  museAgentConsole?.close();
  contractAtelierConsole?.close();
  lunaCompanionConsole?.close();
  wardrobeAtelierConsole?.close();
  whitePaperConsole?.close();
  gestureLensConsole?.close();
  ledgerProofConsole?.close();
  liveGatewayConsole?.close();
  worldEventsConsole?.close();
  sportsEventsConsole?.close();
  multiSportEventsConsole?.close();
  assetMarketConsole?.close();
  deviceProjectionConsole?.close();
  launchKitConsole?.open();
  projectionBridge.emitIntent('projection.open-launch-kit', LAUNCH_KIT_CONSOLE_SOURCE, Object.freeze({
    method,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    executable: false,
  }));
}

launchKitConsole = createLaunchKitConsole({
  documentRoot: document,
  windowLike: globalThis,
  onRoute: (snapshot) => {
    projectionBridge.emitIntent('projection.launch-kit-route', `${LAUNCH_KIT_CONSOLE_SOURCE}:${snapshot.featureId ?? 'mission-control'}`, snapshot);
    if (snapshot.featureId) {
      launchKitConsole?.close();
      if (snapshot.featureId === 'runtime-sync') {
        // Local Cube Sync owns a panel route rather than a generic feature
        // card. Select the first-class Mission Control entry once, then let
        // the bounded helper open the existing loopback bridge and write the
        // explicit panel query. No recursive Launch Kit handoff is involved.
        openBlockWorldRuntimeSync('launch-kit-route', { updateLocation: true, route: snapshot.route });
      } else {
        featureNavigator?.select(snapshot.featureId, 'launch-kit-route');
      }
    } else {
      launchKitConsole?.close();
      featureNavigator?.select('reality-lens', 'launch-kit-mission-control');
    }
  },
  onReplay: (snapshot) => projectionBridge.emitIntent('projection.launch-kit-replay', LAUNCH_KIT_CONSOLE_SOURCE, snapshot),
  onReset: (snapshot) => projectionBridge.emitIntent('projection.reset-launch-kit', LAUNCH_KIT_CONSOLE_SOURCE, snapshot),
  onDownload: (snapshot) => projectionBridge.emitIntent('projection.download-launch-kit', LAUNCH_KIT_CONSOLE_SOURCE, snapshot),
  onCopy: (snapshot) => projectionBridge.emitIntent('projection.copy-launch-kit-link', LAUNCH_KIT_CONSOLE_SOURCE, snapshot),
});
window.__TUMBO_LAUNCH_KIT__ = launchKitConsole;
document.getElementById('launch-kit-open')?.addEventListener('click', () => openLaunchKit('launch-console'));
document.getElementById('social-launch-kit-open')?.addEventListener('click', () => openLaunchKit('social-explorer'));

function alignFeatureSurface(featureId, method = 'surface') {
  featureNavigator?.setActive?.(featureId, `surface:${method}`);
  const definition = FEATURE_DEFINITIONS.find((feature) => feature.id === featureId);
  cubeQuickActions?.setContext?.({
    featureId,
    featureLabel: definition?.label ?? featureId,
    method: `surface:${method}`,
  });
}

function openWorldEvents(method = 'button', refresh = true, options = {}) {
  alignFeatureSurface('world-events', method);
  featureNavigator?.close();
  setBlockWorldFocusMode(true);
  setBlockWorldPresentation(true, { cubeFirstUi: true });
  // A live evidence route must not inherit a stale readout from the fictional
  // allocation preview or another semantic organ. The evidence console and
  // its returned cubes will publish a new readout on explicit selection.
  hideReadout();
  launchKitConsole?.close();
  launchConsole?.close();
  launchReceipt?.close();
  socialExplorer?.close();
  roomSpaces?.close();
  blockWorld?.close();
  blockMigration?.close();
  migrationSnapshot?.close();
  blockWorldSnapshot?.close();
  arenaGames?.close();
  contractsMarkets?.close();
  paycoreConsole?.close();
  t402Console?.close();
  neuralMeshConsole?.close();
  pictureMatterConsole?.close();
  nftAtelierConsole?.close();
  museAgentConsole?.close();
  contractAtelierConsole?.close();
  lunaCompanionConsole?.close();
  wardrobeAtelierConsole?.close();
  whitePaperConsole?.close();
  gestureLensConsole?.close();
  ledgerProofConsole?.close();
  liveGatewayConsole?.close();
  sportsEventsConsole?.close();
  multiSportEventsConsole?.close();
  assetMarketConsole?.close();
  sportsEvidenceLayer && (sportsEvidenceLayer.visible = false);
  deviceProjectionConsole?.close();
  worldEventsConsole?.open();
  if (refresh) {
    // `projection=field` is a shareable presentation preference layered on
    // the same explicit World Pulse read.  Wait for that one refresh before
    // entering the existing projection HUD; failed/empty responses remain in
    // the visible console's honest unavailable state and never fabricate
    // projected cubes. No second provider request is introduced here.
    const refreshPromise = worldEventsConsole?.refresh(method, { query: options.query });
    if (options.signalLens || options.projectField === true) {
      void refreshPromise?.then(() => {
        // A URL lens is still only a presentation filter over the single
        // provider envelope just returned. Unknown values are normalized by
        // the renderer to ALL; no query text reaches a provider or becomes a
        // second provider read.
        if (options.signalLens) worldEventsConsole?.setSignalLens?.(options.signalLens, 'url');
        if (options.projectField === true) worldEventsConsole?.projectField?.('url');
      });
    }
  }
}

// The status dashboard is the default World Gateway / Evidence surface: a
// read-only view over the same in-memory refresh envelopes. It deliberately
// keeps the individual source panels closed so the user can inspect all
// provider states without stacking opaque consoles. A World Pulse refresh
// still projects its returned cubes into the cube field.
//
// `live=all` is a bounded batch over these already-mounted adapters. Keep the
// order explicit and finite so a copied status link cannot turn into an
// unbounded fan-out or a hidden provider registry. Each adapter owns its own
// public endpoint allowlist and fail-closed response normalization.
const LIVE_STATUS_PUBLIC_SURFACE_ORDER = Object.freeze([
  'world-events',
  'sports-events',
  'asset-market',
  'protocol-evidence',
  'multi-sport-events',
  'social-pulse',
  'picture-matter',
]);
let liveStatusBatch = Object.freeze({
  active: false,
  all: false,
  method: null,
  requested: Object.freeze([]),
  completed: Object.freeze([]),
  startedAt: null,
  finishedAt: null,
});
function publishLiveStatusBatch(next) {
  liveStatusBatch = Object.freeze({
    ...next,
    requested: Object.freeze([...(next.requested ?? [])]),
    completed: Object.freeze([...(next.completed ?? [])]),
  });
  return liveStatusBatch;
}
// Browser audits may inspect this local run receipt to verify that the route
// settled each fixed surface once. It contains no provider data or authority;
// the adapters and their status envelopes remain the only source of truth.
window.__TUMBO_LIVE_STATUS_BATCH__ = Object.freeze({
  getSnapshot: () => liveStatusBatch,
});
async function refreshLiveStatusSurfaces(method = 'status-dashboard', all = false) {
  const requested = all
    ? [...LIVE_STATUS_PUBLIC_SURFACE_ORDER]
    : [LIVE_STATUS_PUBLIC_SURFACE_ORDER[0]];
  const startedAt = Date.now();
  publishLiveStatusBatch({
    active: true,
    all: all === true,
    method,
    requested,
    completed: [],
    startedAt,
    finishedAt: null,
  });
  for (const surfaceId of requested) {
    const surfaceStartedAt = Date.now();
    let action = 'refresh-request';
    let reason = null;
    try {
      const result = await liveGatewayConsole?.refreshPublicSource?.(surfaceId, method, { batch: all === true });
      action = result?.action ?? action;
      reason = result?.reason ?? null;
    } catch (error) {
      // `refreshPublicSource` normally settles provider errors itself. Keep a
      // defensive boundary here so one unexpected host failure cannot prevent
      // the later fixed adapters from receiving their own refresh attempt.
      action = 'refresh-failed';
      reason = String(error?.message ?? error ?? 'provider unavailable');
    }
    publishLiveStatusBatch({
      ...liveStatusBatch,
      active: true,
      completed: [
        ...liveStatusBatch.completed,
        Object.freeze({
          surfaceId,
          action,
          reason,
          startedAt: surfaceStartedAt,
          finishedAt: Date.now(),
        }),
      ],
    });
  }
  return publishLiveStatusBatch({
    ...liveStatusBatch,
    active: false,
    finishedAt: Date.now(),
  });
}
function openLivePublicStatus(method = 'button', refresh = true, options = {}) {
  alignFeatureSurface('gateway', method);
  featureNavigator?.close();
  setBlockWorldFocusMode(true);
  setBlockWorldPresentation(true, { cubeFirstUi: true });
  hideReadout();
  launchKitConsole?.close();
  launchConsole?.close();
  launchReceipt?.close();
  socialExplorer?.close();
  roomSpaces?.close();
  blockWorld?.close();
  blockMigration?.close();
  migrationSnapshot?.close();
  blockWorldSnapshot?.close();
  arenaGames?.close();
  contractsMarkets?.close();
  paycoreConsole?.close();
  t402Console?.close();
  neuralMeshConsole?.close();
  pictureMatterConsole?.close();
  nftAtelierConsole?.close();
  museAgentConsole?.close();
  contractAtelierConsole?.close();
  lunaCompanionConsole?.close();
  wardrobeAtelierConsole?.close();
  whitePaperConsole?.close();
  gestureLensConsole?.close();
  ledgerProofConsole?.close();
  worldEventsConsole?.close();
  sportsEventsConsole?.close();
  multiSportEventsConsole?.close();
  assetMarketConsole?.close();
  deviceProjectionConsole?.close();
  worldEvidenceLayer && (worldEvidenceLayer.visible = false);
  sportsEvidenceLayer && (sportsEvidenceLayer.visible = false);
  document.getElementById('live-gateway-console')?.classList.add('public-status-only');
  liveGatewayConsole?.open();
  if (refresh) {
    if (options.all === true) void liveGatewayConsole?.refreshAllPublicSources?.(`live-status:${method}`);
    else void refreshLiveStatusSurfaces(`live-status:${method}`, false);
  }
}

function isAllowlistedSportsProvenanceUrl(value) {
  if (typeof value !== 'string' || value.length > 1024) return false;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const allowlisted = host === 'espn.com' || host.endsWith('.espn.com') || host === 'espncdn.com' || host.endsWith('.espncdn.com');
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.port && allowlisted;
  } catch {
    return false;
  }
}

function parseSportsSourceReturnRoute(query) {
  const journey = query?.get?.('journey');
  if (journey !== SPORTS_SOURCE_RETURN_JOURNEY) {
    return Object.freeze({ strict: false, valid: true, requestedRecordId: null, reason: null });
  }
  const rawRecordId = query?.get?.('record');
  if (typeof rawRecordId !== 'string' || !SPORTS_RECORD_ID_PATTERN.test(rawRecordId)) {
    return Object.freeze({
      strict: true,
      valid: false,
      requestedRecordId: null,
      reason: 'source return route is missing or has a malformed provider record id',
    });
  }
  return Object.freeze({ strict: true, valid: true, requestedRecordId: rawRecordId, reason: null });
}

function selectSportsRecordAfterRouteRefresh(snapshot, requestedRecordId, method = 'route', options = {}) {
  const strict = options?.strict === true;
  const record = snapshot?.summary?.records?.find((candidate) => candidate?.id === requestedRecordId) ?? null;
  if (!record || !isAllowlistedSportsProvenanceUrl(record.sourceUrl)) {
    if (strict) {
      sportsEventsConsole?.setSourceReturnState?.({
        requestedRecordId,
        state: requestedRecordId ? 'missing' : 'invalid',
        reason: record
          ? 'returned record provenance is not an allowlisted HTTPS ESPN URL'
          : 'requested provider record was not returned',
      });
    }
    projectionBridge.emitIntent('projection.return-sports-record-blocked', `${SPORTS_EVENTS_CONSOLE_SOURCE}:${requestedRecordId ?? 'none'}`, Object.freeze({
      action: 'return-sports-record-blocked',
      method,
      requestedRecordId: requestedRecordId ?? null,
      returnedRecordId: record?.id ?? null,
      sourceUrl: record?.sourceUrl ?? null,
      reason: record ? 'returned record provenance is not an allowlisted HTTPS ESPN URL' : 'requested provider record was not returned',
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      executable: false,
    }));
    return false;
  }
  if (strict) {
    sportsEventsConsole?.setSourceReturnState?.({
      requestedRecordId: record.id,
      state: 'matched',
      reason: null,
    });
  }
  sportsEventsConsole?.selectRecord?.(record.id, `route:${method}`);
  return true;
}

function selectMultiSportRecordAfterRouteRefresh(snapshot, requestedRecordId, method = 'route', options = {}) {
  const strict = options?.strict === true;
  const record = snapshot?.summary?.records?.find((candidate) => candidate?.id === requestedRecordId) ?? null;
  if (!record || !isAllowlistedSportsProvenanceUrl(record.sourceUrl)) {
    if (strict) {
      multiSportEventsConsole?.setSourceReturnState?.({
        requestedRecordId,
        state: requestedRecordId ? 'missing' : 'invalid',
        reason: record
          ? 'returned event provenance is not an allowlisted HTTPS ESPN URL'
          : 'requested provider event was not returned',
      });
    }
    projectionBridge.emitIntent('projection.return-multi-sport-record-blocked', `${MULTI_SPORT_EVENTS_CONSOLE_SOURCE}:${requestedRecordId ?? 'none'}`, Object.freeze({
      action: 'return-multi-sport-record-blocked',
      method,
      requestedRecordId: requestedRecordId ?? null,
      returnedRecordId: record?.id ?? null,
      sourceUrl: record?.sourceUrl ?? null,
      reason: record ? 'returned event provenance is not an allowlisted HTTPS ESPN URL' : 'requested provider event was not returned',
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      executable: false,
    }));
    return false;
  }
  if (strict) {
    multiSportEventsConsole?.setSourceReturnState?.({
      requestedRecordId: record.id,
      state: 'matched',
      reason: null,
    });
  }
  multiSportEventsConsole?.selectRecord?.(record.id, `route:${method}`);
  return true;
}

function openSportsEvents(method = 'button', refresh = true, options = {}) {
  // Surface hand-offs such as Contracts → Tennis Evidence must update the
  // navigator identity without re-entering this opener. The low-level
  // setActive seam is presentation-only; this function remains the sole
  // owner of the Sports panel open/refresh sequence.
  alignFeatureSurface('sports-events', method);
  featureNavigator?.close();
  setBlockWorldFocusMode(true);
  setBlockWorldPresentation(true, { cubeFirstUi: true });
  hideReadout();
  launchKitConsole?.close();
  launchConsole?.close();
  launchReceipt?.close();
  socialExplorer?.close();
  roomSpaces?.close();
  blockWorld?.close();
  blockMigration?.close();
  migrationSnapshot?.close();
  blockWorldSnapshot?.close();
  arenaGames?.close();
  contractsMarkets?.close();
  paycoreConsole?.close();
  t402Console?.close();
  neuralMeshConsole?.close();
  pictureMatterConsole?.close();
  nftAtelierConsole?.close();
  museAgentConsole?.close();
  contractAtelierConsole?.close();
  lunaCompanionConsole?.close();
  wardrobeAtelierConsole?.close();
  whitePaperConsole?.close();
  gestureLensConsole?.close();
  ledgerProofConsole?.close();
  liveGatewayConsole?.close();
  worldEventsConsole?.close();
  assetMarketConsole?.close();
  multiSportEventsConsole?.close();
  worldEvidenceLayer && (worldEvidenceLayer.visible = false);
  deviceProjectionConsole?.close();
  sportsEvidenceLayer && (sportsEvidenceLayer.visible = false);
  sportsEventsConsole?.open();
  const strictSourceReturn = options?.sourceReturn === true;
  const requestedRecordId = typeof options?.recordId === 'string' && SPORTS_RECORD_ID_PATTERN.test(options.recordId)
    ? options.recordId
    : null;
  if (strictSourceReturn) {
    sportsEventsConsole?.setSourceReturnState?.({
      requestedRecordId,
      state: requestedRecordId ? 'pending' : 'invalid',
      reason: requestedRecordId ? null : String(options?.reason ?? 'source return route is missing or malformed'),
    });
  }
  if (refresh) {
    // A malformed source-return route fails closed before a provider read. A
    // bounded id still performs the normal Tennis refresh, then must resolve
    // against that exact returned provider row.
    const refreshPromise = strictSourceReturn && !requestedRecordId
      ? null
      : sportsEventsConsole?.refresh(method);
    if (strictSourceReturn && requestedRecordId) {
      void Promise.resolve(refreshPromise).then((snapshot) => {
        selectSportsRecordAfterRouteRefresh(snapshot, requestedRecordId, method, { strict: true });
      });
    } else if (requestedRecordId) {
      void Promise.resolve(refreshPromise).then((snapshot) => {
        selectSportsRecordAfterRouteRefresh(snapshot, requestedRecordId, method);
      });
    }
  } else if ((strictSourceReturn && requestedRecordId) || (!strictSourceReturn && requestedRecordId)) {
    selectSportsRecordAfterRouteRefresh(sportsEventsConsole?.getSnapshot?.(), requestedRecordId, method, { strict: strictSourceReturn });
  }
}

// Contracts starts provider-free by design, but its empty draft state still
// needs an obvious hand-off to the real Tennis Evidence reader. Keep this
// route explicit: it changes only the local URL and then performs the same
// allowlisted public read used by the Sports surface. No row or draft is
// fabricated while the provider is unavailable.
function openSportsEvidenceFromContracts(method = 'contracts-empty-state') {
  if (globalThis.history?.pushState && globalThis.location) {
    try {
      const route = new URL(globalThis.location.href);
      ['feature', 'draft', 'contract', 'record', 'graph', 'node', 'live'].forEach((key) => route.searchParams.delete(key));
      route.searchParams.set('panel', 'sports-events');
      route.searchParams.set('journey', SPORTS_SOURCE_RETURN_JOURNEY);
      route.hash = '';
      globalThis.history.pushState({ panel: 'sports-events', source: 'contracts-empty-state' }, '', route.href);
    } catch {
      // A static host may not expose writable history; the panel still opens.
    }
  }
  openSportsEvents(`contracts:${method}`, true);
  return sportsEventsConsole?.getSnapshot?.() ?? null;
}

function openMultiSportEvents(method = 'button', refresh = true, options = {}) {
  alignFeatureSurface('multi-sport-events', method);
  featureNavigator?.close();
  setBlockWorldFocusMode(true);
  setBlockWorldPresentation(true, { cubeFirstUi: true });
  hideReadout();
  launchKitConsole?.close();
  launchConsole?.close();
  launchReceipt?.close();
  socialExplorer?.close();
  roomSpaces?.close();
  blockWorld?.close();
  blockMigration?.close();
  migrationSnapshot?.close();
  blockWorldSnapshot?.close();
  arenaGames?.close();
  contractsMarkets?.close();
  paycoreConsole?.close();
  t402Console?.close();
  neuralMeshConsole?.close();
  pictureMatterConsole?.close();
  nftAtelierConsole?.close();
  museAgentConsole?.close();
  contractAtelierConsole?.close();
  lunaCompanionConsole?.close();
  wardrobeAtelierConsole?.close();
  whitePaperConsole?.close();
  gestureLensConsole?.close();
  ledgerProofConsole?.close();
  liveGatewayConsole?.close();
  worldEventsConsole?.close();
  sportsEventsConsole?.close();
  assetMarketConsole?.close();
  worldEvidenceLayer && (worldEvidenceLayer.visible = false);
  sportsEvidenceLayer && (sportsEvidenceLayer.visible = false);
  deviceProjectionConsole?.close();
  multiSportEventsConsole?.open();
  const strictSourceReturn = options?.sourceReturn === true;
  const requestedRecordId = typeof options?.recordId === 'string' && SPORTS_RECORD_ID_PATTERN.test(options.recordId)
    ? options.recordId
    : null;
  if (strictSourceReturn) {
    multiSportEventsConsole?.setSourceReturnState?.({
      requestedRecordId,
      state: requestedRecordId ? 'pending' : 'invalid',
      reason: requestedRecordId ? null : String(options?.reason ?? 'source return route is missing or malformed'),
    });
  }
  if (refresh) {
    const refreshPromise = strictSourceReturn && !requestedRecordId
      ? null
      : multiSportEventsConsole?.refresh(method);
    if (strictSourceReturn && requestedRecordId) {
      void Promise.resolve(refreshPromise).then((snapshot) => {
        selectMultiSportRecordAfterRouteRefresh(snapshot, requestedRecordId, method, { strict: true });
      });
    }
  } else if (!refresh && requestedRecordId) {
    selectMultiSportRecordAfterRouteRefresh(multiSportEventsConsole?.getSnapshot?.(), requestedRecordId, method, { strict: strictSourceReturn });
  }
}

function openAssetMarket(method = 'button', refresh = true) {
  alignFeatureSurface('asset-market', method);
  featureNavigator?.close();
  setBlockWorldFocusMode(true);
  setBlockWorldPresentation(true, { cubeFirstUi: true });
  hideReadout();
  launchKitConsole?.close();
  launchConsole?.close();
  launchReceipt?.close();
  socialExplorer?.close();
  roomSpaces?.close();
  blockWorld?.close();
  blockMigration?.close();
  migrationSnapshot?.close();
  blockWorldSnapshot?.close();
  arenaGames?.close();
  contractsMarkets?.close();
  paycoreConsole?.close();
  t402Console?.close();
  neuralMeshConsole?.close();
  pictureMatterConsole?.close();
  nftAtelierConsole?.close();
  museAgentConsole?.close();
  contractAtelierConsole?.close();
  lunaCompanionConsole?.close();
  wardrobeAtelierConsole?.close();
  whitePaperConsole?.close();
  gestureLensConsole?.close();
  ledgerProofConsole?.close();
  liveGatewayConsole?.close();
  worldEventsConsole?.close();
  worldEvidenceLayer && (worldEvidenceLayer.visible = false);
  sportsEventsConsole?.close();
  multiSportEventsConsole?.close();
  sportsEvidenceLayer && (sportsEvidenceLayer.visible = false);
  deviceProjectionConsole?.close();
  assetMarketConsole?.open();
  if (refresh) void assetMarketConsole?.refresh(method);
}

worldEventsConsole = createWorldEventsConsole({
  documentRoot: document,
  data: createUnavailableWorldEvents({
    reason: 'Refresh public sources to request real records; no local fallback data is used.',
  }),
  onRefresh: async ({ query }) => {
    // ReliefWeb is not part of the default endpoint list. If a host has a
    // pre-approved app identity, it can be supplied out-of-band; never turn
    // an arbitrary URL query value into a provider identity.
    const configuredAppName = globalThis.__TUMBO_RELIEFWEB_APPNAME__ ?? null;
    const result = await fetchWorldEvents({
      query,
      appName: configuredAppName,
    });
    liveGatewayConsole?.syncPublicSourceStatus?.('world-events', result, { method: 'world-pulse-refresh' });
    renderWorldEvidenceCubes(result);
    return result;
  },
  onSelect: (snapshot) => {
    if (snapshot?.method === 'projection-band' && snapshot.recordId) {
      // Projection-band controls select the first returned match through the
      // same local camera seam used by cube/evidence focus. No provider read
      // or canonical state mutation occurs here.
      focusWorldEvidenceRecord(snapshot.recordId, 'projection-band');
    }
    showWorldEvidenceReadout(snapshot.record, 'select');
    projectionBridge.emitIntent('projection.select-world-event-evidence', snapshot.recordId ?? WORLD_EVENTS_CONSOLE_SOURCE, Object.freeze({
      provider: snapshot.record?.provider ?? null,
      sourceUrl: snapshot.record?.sourceUrl ?? null,
      classification: snapshot.record?.classification ?? null,
      sourceObservedAt: snapshot.record?.sourceObservedAt ?? null,
      eventTime: snapshot.record?.eventTime ?? null,
      uncertainty: snapshot.record?.uncertainty ?? 1,
      liveFetch: snapshot.summary?.liveFetch === true,
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      executable: false,
    }));
  },
  onReplay: (snapshot) => projectionBridge.emitIntent('projection.replay-world-event-evidence', snapshot.recordId ?? WORLD_EVENTS_CONSOLE_SOURCE, snapshot),
  onReset: (snapshot) => {
    clearWorldEvidenceCubes();
    projectionBridge.emitIntent('projection.reset-world-event-evidence', WORLD_EVENTS_CONSOLE_SOURCE, snapshot);
  },
  onFilter: (snapshot) => {
    // The lens is a presentation-only view over the already fetched envelope.
    // Keep the canonical response intact and rebuild only the visible cube
    // evidence list; an empty lens therefore renders no fabricated cubes.
    const visibleRecords = Array.isArray(snapshot.visibleRecords)
      ? snapshot.visibleRecords
      : Array.isArray(snapshot.records)
        ? snapshot.records
        : [];
    renderWorldEvidenceCubes({
      ...(snapshot.summary ?? {}),
      records: visibleRecords,
      recordCount: visibleRecords.length,
    });
    projectionBridge.emitIntent('projection.filter-world-event-evidence', snapshot.signalLens ?? 'all', Object.freeze({
      signalLens: snapshot.signalLens ?? 'all',
      geographyLens: snapshot.geographyLens ?? 'all',
      mapCellId: snapshot.mapCellId ?? 'all',
      mapCellLabel: snapshot.mapCellLabel ?? 'ALL',
      visibleRecordCount: visibleRecords.length,
      mappedRecordCount: visibleRecords.filter((record) => record?.geographyStatus === 'provider-reported').length,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      executable: false,
    }));
  },
  onProject: (snapshot) => {
    // Projection is a presentation-only handoff. Reuse the local evidence
    // bounds and camera tween so a direct World Pulse link lands on the live
    // cube field instead of leaving it at the far whole-world framing.
    focusWorldEvidenceField(snapshot?.method ?? 'world-pulse-project');
  },
});
window.__TUMBO_WORLD_EVENTS__ = worldEventsConsole;
document.getElementById('world-events-open')?.addEventListener('click', () => openWorldEvents('launch-kit-world-pulse'));
document.getElementById('world-events-status-open')?.addEventListener('click', () => openLivePublicStatus('world-pulse-status'));
sportsEventsConsole = createSportsEventsConsole({
  documentRoot: document,
  data: createUnavailableSportsEvents(),
  onRefresh: async ({ tours }) => {
    const result = await fetchSportsEvents({ tours });
    liveGatewayConsole?.syncPublicSourceStatus?.('sports-events', result, { method: 'tennis-evidence-refresh' });
    renderSportsEvidenceCubes(result);
    return result;
  },
  onInspect: async ({ record, method }) => {
    const result = await fetchSportsEventDetail({ record });
    if (result?.record) {
      showSportsEvidenceReadout(result.record, 'detail');
      projectionBridge.emitIntent('projection.inspect-sports-detail', result.record.id ?? SPORTS_EVENTS_CONSOLE_SOURCE, Object.freeze({
        tour: result.record.tour ?? null,
        matchId: result.record.matchId ?? null,
        sourceUrl: result.sourceUrl ?? null,
        timelineStatus: result.record.timelineStatus ?? 'unavailable',
        timelinePoints: result.record.timeline?.points?.length ?? 0,
        requestCount: result.requestCount ?? 0,
        method: method ?? 'button',
        liveFetch: result.liveFetch === true,
        simulation: true,
        localOnly: true,
        externalNetwork: result.externalNetwork === true,
        executable: false,
      }));
    }
    return result;
  },
  onSelect: (snapshot) => {
    showSportsEvidenceReadout(snapshot.record, 'select');
    projectionBridge.emitIntent('projection.select-sports-evidence', snapshot.recordId ?? SPORTS_EVENTS_CONSOLE_SOURCE, Object.freeze({
      tour: snapshot.record?.tour ?? null,
      matchId: snapshot.record?.matchId ?? null,
      sourceUrl: snapshot.record?.sourceUrl ?? null,
      setScoreStatus: snapshot.record?.setScoreStatus ?? 'unavailable',
      timelineAvailable: snapshot.record?.timeline?.available === true,
      dataGrade: snapshot.record?.dataGrade ?? null,
      gradeKind: 'data-completeness',
      liveFetch: snapshot.summary?.liveFetch === true,
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      executable: false,
    }));
  },
  onOpenContractDraft: ({ record, method }) => {
    // A selected public match is a provenance handoff only. The Contracts +
    // Pools surface builds an in-memory draft and never writes into the
    // canonical projection or opens an execution/settlement path.
    if (!record?.id || !record?.sourceUrl) return null;
    const sourceRoute = createSportsContractSourceRoute(record);
    // The visible console, quick-action context, and shared session must all
    // agree on the destination. Previously this handoff opened Contracts
    // while leaving Mission Control's active feature as Tennis Evidence.
    // That split made the next action/readout describe the wrong surface.
    alignFeatureSurface('contracts', `sports-contract-draft:${method ?? 'button'}`);
    sportsEventsConsole?.close();
    sportsEvidenceLayer && (sportsEvidenceLayer.visible = false);
    featureNavigator?.close();
    contractsMarkets?.open();
    const prepared = contractsMarkets?.prepareDraft?.(record, `sports:${method ?? 'button'}`, { sourceRoute });
    // The handoff is addressable as soon as a real provider row is selected:
    // create the bounded local application entity with its default labels,
    // then let the Contracts callback write the validated payload into the
    // URL. This remains an in-memory rehearsal and never touches the
    // canonical projection or a provider.
    const created = prepared?.action === 'prepare-draft'
      ? contractsMarkets?.createDraft?.(`sports:${method ?? 'button'}`)
      : null;
    projectionBridge.emitIntent('projection.open-contract-pool-draft', `${SPORTS_EVENTS_CONSOLE_SOURCE}:${record?.id ?? 'none'}`, Object.freeze({
      action: 'open-contract-pool-draft',
      method: method ?? 'button',
      sourceRecordId: record?.id ?? null,
      sourceUrl: record?.sourceUrl ?? null,
      provider: record?.provider ?? null,
      draftId: created?.localDraft?.id ?? null,
      contractId: created?.localDraft?.contract?.id ?? null,
      poolId: created?.localDraft?.pool?.id ?? null,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
      settlement: false,
      custody: false,
    }));
  },
  onReplay: (snapshot) => projectionBridge.emitIntent('projection.replay-sports-evidence', snapshot.recordId ?? SPORTS_EVENTS_CONSOLE_SOURCE, snapshot),
  onReset: (snapshot) => {
    clearSportsEvidenceCubes();
    projectionBridge.emitIntent('projection.reset-sports-evidence', SPORTS_EVENTS_CONSOLE_SOURCE, snapshot);
  },
});
window.__TUMBO_SPORTS_EVENTS__ = sportsEventsConsole;
document.getElementById('sports-events-open')?.addEventListener('click', () => openSportsEvents('launch-kit-tennis'));
multiSportEventsConsole = createMultiSportEventsConsole({
  documentRoot: document,
  data: createUnavailableMultiSportEvents({
    reason: 'Refresh public scoreboards to request real soccer, NBA, and NFL rows; no local fallback data is used.',
  }),
  onRefresh: async () => {
    const result = await fetchMultiSportEvents();
    liveGatewayConsole?.syncPublicSourceStatus?.('multi-sport-events', result, { method: 'multi-sport-refresh' });
    return result;
  },
  onInspect: async ({ record, method }) => {
    const result = await fetchMultiSportEventDetail({ record });
    if (result?.record) {
      projectionBridge.emitIntent('projection.inspect-multi-sport-detail', result.record.id ?? MULTI_SPORT_EVENTS_CONSOLE_SOURCE, Object.freeze({
        sport: result.record.sport ?? null,
        league: result.record.league ?? null,
        eventId: result.record.eventId ?? null,
        competitionId: result.record.competition?.id ?? null,
        sourceUrl: result.sourceUrl ?? null,
        playerContextCount: result.record.publicDetail?.players?.length ?? 0,
        periodCount: result.record.publicDetail?.periods?.length ?? 0,
        playCount: result.record.publicDetail?.timeline?.length ?? 0,
        detailCompletenessGrade: result.record.publicDetail?.detailCompletenessGrade ?? null,
        detailCompletenessPercent: result.record.publicDetail?.detailCompletenessPercent ?? 0,
        requestCount: result.requestCount ?? 0,
        method: method ?? 'button',
        liveFetch: result.liveFetch === true,
        simulation: true,
        localOnly: true,
        externalNetwork: result.externalNetwork === true,
        executable: false,
      }));
    }
    return result;
  },
  onSelect: (snapshot) => {
    projectionBridge.emitIntent('projection.select-multi-sport-evidence', snapshot.recordId ?? MULTI_SPORT_EVENTS_CONSOLE_SOURCE, Object.freeze({
      sport: snapshot.record?.sport ?? null,
      league: snapshot.record?.league ?? null,
      competitionId: snapshot.record?.competition?.id ?? null,
      sourceUrl: snapshot.record?.sourceUrl ?? null,
      scoreStatus: snapshot.record?.scoreStatus ?? 'unavailable',
      dataGrade: snapshot.record?.dataCompletenessGrade ?? null,
      gradeKind: 'data-completeness',
      liveFetch: snapshot.summary?.liveFetch === true,
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      executable: false,
    }));
  },
  onOpenContractDraft: ({ record, method }) => {
    if (!record?.id || !record?.sourceUrl) return null;
    const sourceRoute = createSportsContractSourceRoute(record);
    alignFeatureSurface('contracts', `multi-sport-contract-draft:${method ?? 'button'}`);
    multiSportEventsConsole?.close();
    featureNavigator?.close();
    contractsMarkets?.open();
    const prepared = contractsMarkets?.prepareDraft?.(record, `multi-sport:${method ?? 'button'}`, { sourceRoute });
    const created = prepared?.action === 'prepare-draft' ? contractsMarkets?.createDraft?.(`multi-sport:${method ?? 'button'}`) : null;
    projectionBridge.emitIntent('projection.open-contract-pool-draft', `${MULTI_SPORT_EVENTS_CONSOLE_SOURCE}:${record.id}`, Object.freeze({
      action: 'open-contract-pool-draft', method: method ?? 'button', sourceRecordId: record.id, sourceUrl: record.sourceUrl,
      provider: record.provider ?? null, draftId: created?.localDraft?.id ?? null, contractId: created?.localDraft?.contract?.id ?? null,
      poolId: created?.localDraft?.pool?.id ?? null, localOnly: true, simulation: true, externalNetwork: false,
      externalTransfer: false, persistence: false, executable: false, settlement: false, custody: false,
    }));
  },
  onReplay: (snapshot) => projectionBridge.emitIntent('projection.replay-multi-sport-evidence', snapshot.recordId ?? MULTI_SPORT_EVENTS_CONSOLE_SOURCE, snapshot),
  onReset: (snapshot) => projectionBridge.emitIntent('projection.reset-multi-sport-evidence', MULTI_SPORT_EVENTS_CONSOLE_SOURCE, snapshot),
});
window.__TUMBO_MULTI_SPORT_EVENTS__ = multiSportEventsConsole;
document.getElementById('multi-sport-events-open')?.addEventListener('click', () => openMultiSportEvents('launch-kit-multi-sport'));
assetMarketConsole = createAssetMarketConsole({
  documentRoot: document,
  data: createUnavailableAssetMarketEvidence({
    reason: 'Refresh public market sources to request real peer rows; no local fallback data is used.',
  }),
  onRefresh: async ({ assetIds }) => {
    const result = await fetchAssetMarketEvidence({ assetIds });
    liveGatewayConsole?.syncPublicSourceStatus?.('asset-market', result, { method: 'asset-market-refresh' });
    return result;
  },
  onSelect: (snapshot) => {
    const organ = resolveOrganById('market');
    if (organ) focusOrgan(organ, `asset-market-select:${snapshot.recordId}`);
    projectionBridge.emitIntent('projection.select-asset-market-evidence', snapshot.recordId ?? ASSET_MARKET_CONSOLE_SOURCE, Object.freeze({
      assetId: snapshot.record?.assetId ?? null,
      symbol: snapshot.record?.symbol ?? null,
      sourceUrl: snapshot.record?.sourceUrl ?? null,
      dataCompletenessGrade: snapshot.record?.dataCompletenessGrade ?? null,
      liveFetch: snapshot.summary?.liveFetch === true,
      simulation: true,
      localOnly: true,
      externalNetwork: false,
      executable: false,
      trading: false,
      custody: false,
      settlement: false,
    }));
  },
  onReplay: (snapshot) => projectionBridge.emitIntent('projection.replay-asset-market-evidence', ASSET_MARKET_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    recordId: snapshot.recordId,
    recordCount: snapshot.recordCount,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    executable: false,
    trading: false,
    custody: false,
    settlement: false,
  })),
  onReset: (snapshot) => projectionBridge.emitIntent('projection.reset-asset-market-evidence', ASSET_MARKET_CONSOLE_SOURCE, Object.freeze({
    action: snapshot.action,
    recordId: snapshot.recordId,
    method: snapshot.method,
    simulation: true,
    deterministic: true,
    localOnly: true,
    externalNetwork: false,
    executable: false,
    trading: false,
    custody: false,
    settlement: false,
  })),
});
window.__TUMBO_ASSET_MARKET__ = assetMarketConsole;
document.getElementById('asset-market-open')?.addEventListener('click', () => openAssetMarket('launch-kit-asset-market'));
if (new URLSearchParams(globalThis.location?.search ?? '').get('panel') === 'launch-kit') {
  // `panel=launch-kit` is a shareable inspection link for the complete local
  // handoff.  It intentionally omits a feature query so Mission Control does
  // not replace the requested panel during its initial URL selection.
  openLaunchKit('url');
}
// The social explorer is a local catalog over fictional rooms, creator cards,
// discovery signals, and frozen rehearsal intents. It deliberately remains a
// separate console from the asset-token registry so the two domains share the
// canonical projection without inventing a second schedule or transfer path.
socialExplorer = createSocialExplorerConsole({
  documentRoot: document,
  projection: livingRealityWorld,
  publicPulse: publicSocialPulse,
  onReplay: (replay) => {
    projectionBridge.emitIntent(
      'projection.social-explorer-rehearsal-replay',
      replay.rehearsalId,
      Object.freeze({
        explorerId: replay.explorerId,
        rehearsalId: replay.rehearsalId,
        replayCount: replay.replayCount,
        status: 'replayed',
        stepCount: replay.steps.length,
        simulation: true,
        deterministic: true,
        localOnly: true,
        externalNetwork: false,
        externalTransfer: false,
        executable: false,
      }),
    );
  },
  onSelect: (entry) => {
    const focusId = entry.selectedKind === 'room' && entry.id === 'social-room:allocation-atlas'
      ? ASSET_TOKEN_ORGAN_ID
      : 'market';
    const organ = resolveOrganById(focusId);
    if (organ) focusOrgan(organ, 'social-explorer-selection');
    projectionBridge.emitIntent(
      'projection.inspect-social-explorer-entry',
      entry.id,
      Object.freeze({
        selectedKind: entry.selectedKind,
        mode: entry.mode,
        simulation: true,
        localOnly: true,
        externalNetwork: false,
        externalTransfer: false,
        executable: false,
      }),
    );
  },
  onAction: (action) => {
    const focusId = action.intent === 'allocate-preview' ? ASSET_TOKEN_ORGAN_ID : 'market';
    const organ = organs.find((candidate) => candidate.id === focusId);
    if (organ) focusOrgan(organ, `social-action:${action.intent}`);
    if (action.accepted !== false && action.intent === 'allocate-preview') {
      // The Social Explorer flow lands on the existing Launch Distribution
      // console. Keep Mission Control and the shared cube-action context on
      // that destination before hiding the social panel; otherwise the
      // registry visibly opens while the active feature still claims Social
      // Explorer, which makes the allocation rehearsal appear stranded.
      alignFeatureSurface('launch-distribution', 'social-action:allocate-preview');
      const snapshot = distributionExplorer.setLaunchState({
        status: 'previewed',
        launched: true,
      });
      renderDistributionPanel(snapshot);
      socialExplorer?.close();
      featureNavigator?.close();
      launchConsole?.open();
      launchConsole?.setJourneyStep?.('registry', 'social-action');
    }
    projectionBridge.emitIntent(
      'projection.social-explorer-action',
      action.id,
      Object.freeze({
        intent: action.intent,
        targetId: action.targetId,
        assetLaunchId: action.assetLaunchId ?? null,
        accepted: action.accepted !== false,
        rejected: action.rejected === true,
        reason: action.reason ?? null,
        stepIndex: action.flow?.stepIndex ?? action.stepIndex ?? null,
        nextIntent: action.flow?.nextIntent ?? action.nextIntent ?? null,
        flowComplete: action.flow?.complete === true || action.flowComplete === true,
        method: action.method,
        simulation: true,
        deterministic: true,
        localOnly: true,
        externalNetwork: false,
        externalTransfer: false,
        executable: false,
        walletConnection: false,
        recipientAuthority: false,
        price: false,
        market: false,
        settlement: false,
      }),
    );
  },
  onReset: (reset) => projectionBridge.emitIntent(
    'projection.social-explorer-flow-reset',
    SOCIAL_EXPLORER_CONSOLE_SOURCE,
    Object.freeze({
      action: reset.action ?? 'reset',
      method: reset.method,
      previousStepIndex: reset.previousStepIndex ?? 0,
      stepIndex: reset.flow?.stepIndex ?? 0,
      simulation: true,
      deterministic: true,
      localOnly: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
    }),
  ),
  onPublicPulseRefresh: async ({ actor, limit, method }) => {
    const nextPulse = await fetchSocialPulse({ actor, limit });
    publicSocialPulse = nextPulse;
    socialExplorer?.setPublicPulse(nextPulse);
    liveGatewayConsole?.syncPublicSourceStatus?.('social-pulse', nextPulse, { method: 'social-pulse-refresh' });
    projectionBridge.emitIntent(
      'projection.refresh-social-public-pulse',
      SOCIAL_PULSE_SOURCE,
      Object.freeze({
        action: 'refresh-public-pulse',
        method,
        provider: nextPulse.provider,
        source: nextPulse.source,
        endpoint: nextPulse.endpoint,
        actor: nextPulse.actor,
        requestedLimit: nextPulse.requestedLimit,
        returnedCount: nextPulse.returnedCount,
        retrievedAt: nextPulse.retrievedAt,
        status: nextPulse.status,
        providerAvailable: nextPulse.providerAvailable === true,
        publicSource: true,
        untrusted: true,
        metadataOnly: true,
        mediaBytesFetched: false,
        mediaBytesStored: false,
        mediaBytesRendered: false,
        authentication: false,
        identityResolution: false,
        posting: false,
        persistence: false,
        publishing: false,
        recipient: false,
        wallet: false,
        token: false,
        transfer: false,
        settlement: false,
        authority: false,
        executable: false,
        externalNetwork: nextPulse.externalNetwork === true,
      }),
    );
    return nextPulse;
  },
  onLaunchPlan: (event) => {
    const plan = event?.launchPlan ?? {};
    // Keep the two-mode launch story observable in the same local intent
    // timeline as the existing social flow.  This is a presentation receipt,
    // never an enrollment, recipient, issuance, or transfer instruction.
    document.body?.setAttribute?.('data-social-launch-mode', String(plan.modeId ?? 'social-experiment'));
    // The space-explorer mode is a real local route hand-off, not just a
    // label change in the social console.  Selecting it moves the viewer to
    // the existing cube-first Block World surface while preserving the same
    // canonical projection and avoiding a URL write or external navigation.
    if (event?.action === 'select-launch-mode'
      && event?.accepted !== false
      && plan.modeId === 'space-explorer') {
      featureNavigator?.select('block-world', 'social-launch-space-mode', { updateLocation: false });
      // The social card grid must not remain as a stale overlay on top of the
      // cube-first Space Explorer. This is a same-page presentation handoff;
      // both surfaces continue to read the one local projection.
      socialExplorer?.close();
      blockWorld?.open();
      projectionBridge.emitIntent(
        'projection.social-launch-space-route',
        'space-explorer',
        Object.freeze({
          modeId: plan.modeId,
          targetFeature: 'block-world',
          route: '?feature=block-world',
          method: event?.method ?? 'button',
          simulation: true,
          deterministic: true,
          localOnly: true,
          externalNetwork: false,
          externalTransfer: false,
          persistence: false,
          executable: false,
        }),
      );
    }
    projectionBridge.emitIntent(
      'projection.social-launch-plan',
      plan.id ?? 'social-launch-plan:tumbo-demo-launch',
      Object.freeze({
        action: event?.action ?? 'launch-plan',
        method: event?.method ?? 'api',
        modeId: plan.modeId ?? null,
        phaseId: event?.phaseId ?? null,
        phaseIndex: plan.phaseIndex ?? 0,
        nextPhaseId: plan.nextPhaseId ?? null,
        phaseCount: plan.phaseCount ?? 0,
        accepted: event?.accepted !== false,
        rejected: event?.rejected === true,
        reason: event?.reason ?? null,
        participation: plan.participation ?? 'opt-in',
        participationPolicy: plan.participationPolicy ?? 'opt-in-only',
        participationStatus: plan.participationStatus ?? 'opt-in-not-recorded',
        distributionStatus: plan.distributionStatus ?? 'preview-only',
        simulation: true,
        deterministic: true,
        localOnly: true,
        externalNetwork: false,
        externalTransfer: false,
        persistence: false,
        walletConnection: false,
        recipientAuthority: false,
        signing: false,
        custody: false,
        settlement: false,
        executable: false,
      }),
    );
  },
});
socialExplorer.setProjection(livingRealityWorld);
window.__TUMBO_SOCIAL_EXPLORER__ = socialExplorer;

const desiredTarget=new THREE.Vector3(); let cameraTween=0;
const desiredCameraPosition=camera.position.clone(); let cameraPositionTween=0;
let cameraMotion={dx:0,dy:0,magnitude:0};
const cameraMotionOffset=new THREE.Vector3();
const cameraMotionSpherical=new THREE.Spherical();

// World Pulse projection keeps the returned provider envelope in the existing
// evidence cubes, then focuses that same local group. This diagnostic/focus
// seam exposes only renderer pose and bounds; it never adds provider calls,
// persistence, recognition, or an execution path.
function getWorldEvidenceFieldCameraSnapshot() {
  if (!worldEvidenceLayer?.visible || worldEvidenceMeshes.size === 0) {
    return Object.freeze({
      available: false,
      visible: false,
      meshCount: worldEvidenceMeshes.size,
      innerMeshCount: worldEvidenceInnerMeshes.size,
      reason: 'No returned World Pulse evidence cubes are visible.',
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      executable: false,
    });
  }
  worldEvidenceLayer.updateWorldMatrix?.(true, true);
  const bounds = new THREE.Box3().setFromObject(worldEvidenceLayer);
  if (bounds.isEmpty()) {
    return Object.freeze({
      available: false,
      visible: false,
      meshCount: worldEvidenceMeshes.size,
      innerMeshCount: worldEvidenceInnerMeshes.size,
      reason: 'Returned evidence group has no measurable bounds.',
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      executable: false,
    });
  }
  camera.updateMatrixWorld?.();
  const { min, max } = bounds;
  const corners = [
    new THREE.Vector3(min.x, min.y, min.z),
    new THREE.Vector3(min.x, min.y, max.z),
    new THREE.Vector3(min.x, max.y, min.z),
    new THREE.Vector3(min.x, max.y, max.z),
    new THREE.Vector3(max.x, min.y, min.z),
    new THREE.Vector3(max.x, min.y, max.z),
    new THREE.Vector3(max.x, max.y, min.z),
    new THREE.Vector3(max.x, max.y, max.z),
  ];
  const projected = corners.map((corner) => corner.project(camera));
  const ndcMinX = Math.min(...projected.map((corner) => corner.x));
  const ndcMaxX = Math.max(...projected.map((corner) => corner.x));
  const ndcMinY = Math.min(...projected.map((corner) => corner.y));
  const ndcMaxY = Math.max(...projected.map((corner) => corner.y));
  const clippedMinX = Math.max(-1, ndcMinX);
  const clippedMaxX = Math.min(1, ndcMaxX);
  const clippedMinY = Math.max(-1, ndcMinY);
  const clippedMaxY = Math.min(1, ndcMaxY);
  const onScreenCorners = projected.filter((corner) => (
    corner.z >= -1 && corner.z <= 1
      && corner.x >= -1 && corner.x <= 1
      && corner.y >= -1 && corner.y <= 1
  )).length;
  const point = (value) => Object.freeze({
    x: Number(value.x.toFixed(4)),
    y: Number(value.y.toFixed(4)),
    z: Number(value.z.toFixed(4)),
  });
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  return Object.freeze({
    available: true,
    visible: true,
    meshCount: worldEvidenceMeshes.size,
    innerMeshCount: worldEvidenceInnerMeshes.size,
    bounds: Object.freeze({ min: point(min), max: point(max), center: point(center), size: point(size) }),
    ndcBounds: Object.freeze({
      minX: Number(ndcMinX.toFixed(4)),
      maxX: Number(ndcMaxX.toFixed(4)),
      minY: Number(ndcMinY.toFixed(4)),
      maxY: Number(ndcMaxY.toFixed(4)),
    }),
    viewportCoverage: Object.freeze({
      width: Number(Math.max(0, (clippedMaxX - clippedMinX) / 2).toFixed(4)),
      height: Number(Math.max(0, (clippedMaxY - clippedMinY) / 2).toFixed(4)),
    }),
    onScreenCorners,
    cameraDistance: Number(camera.position.distanceTo(controls.target).toFixed(4)),
    cameraPosition: point(camera.position),
    target: point(controls.target),
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    executable: false,
  });
}

window.__TUMBO_WORLD_EVENTS_CAMERA__ = Object.freeze({
  getSnapshot: getWorldEvidenceFieldCameraSnapshot,
});

function focusWorldEvidenceField(method = 'world-pulse-project') {
  const field = getWorldEvidenceFieldCameraSnapshot();
  if (!field.available) return false;
  const center = new THREE.Vector3(field.bounds.center.x, field.bounds.center.y, field.bounds.center.z);
  const horizontalSpan = Math.max(field.bounds.size.x, field.bounds.size.z, 4);
  // Match the existing portal/cube focus offset while adapting the distance
  // to the returned field's actual world bounds. The clamp keeps small live
  // envelopes legible without allowing an oversized response to fill the
  // camera, and it is still entirely a local camera move.
  const distance = THREE.MathUtils.clamp(horizontalSpan * 1.5, 11.2, 15.4);
  const elevation = THREE.MathUtils.clamp(field.bounds.size.y * .8 + 5.7, 7.4, 10.5);
  desiredTarget.copy(center);
  desiredCameraPosition.copy(center).add(new THREE.Vector3(0, elevation, distance));
  cameraTween = reducedMotion ? .16 : 1;
  cameraPositionTween = reducedMotion ? .16 : 1;
  projectionBridge.emitIntent('projection.focus-world-evidence-field', WORLD_EVENTS_CONSOLE_SOURCE, Object.freeze({
    action: 'focus-world-evidence-field',
    method,
    meshCount: field.meshCount,
    innerMeshCount: field.innerMeshCount,
    bounds: field.bounds,
    cameraDistance: Number(desiredCameraPosition.distanceTo(desiredTarget).toFixed(4)),
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
  }));
  return true;
}

function focusWorldEvidenceRecord(recordId, method = 'world-pulse-band') {
  const record = worldEvidenceRecordFor(recordId);
  const mesh = worldEvidenceMeshFor(recordId);
  if (!record || !mesh) return false;
  const target = new THREE.Vector3();
  mesh.getWorldPosition(target);
  desiredTarget.copy(target);
  // Reuse the established cube/portal focus offset so a band selection is a
  // camera handoff only; the returned provider identity remains untouched.
  desiredCameraPosition.copy(target).add(new THREE.Vector3(0, 7.4, 12.8));
  cameraTween = reducedMotion ? .16 : 1;
  cameraPositionTween = reducedMotion ? .16 : 1;
  projectionBridge.emitIntent('projection.focus-world-evidence-record', recordId, Object.freeze({
    action: 'focus-world-evidence-record',
    method,
    recordId,
    providerId: record.providerId ?? null,
    sourceUrl: record.sourceUrl ?? null,
    localOnly: true,
    simulation: true,
    externalNetwork: false,
    externalTransfer: false,
    persistence: false,
    executable: false,
  }));
  return true;
}

const subEl=document.getElementById('sub');
const lensButtons=[...document.querySelectorAll('[data-lens-mode]')];
const lensDescriptions={
  world:{title:'Reality Lens Ω · Whole',body:'The whole Living Reality reads as one spatial organism. People are compact, persistent population signatures inside the same simulation-only projection.',tags:['whole','population','simulation']},
  population:{title:'Reality Lens Ω · Population',body:'Individual Person Ω organisms separate from the population field. Their color, structure and rhythm are stable world signatures—not real-world identity claims.',tags:['people','visual-genomes','consent']},
  detail:{title:'Reality Lens Ω · Identity Anatomy',body:'One fictional, consented person expands into an identity nucleus, semantic cells, consent halo and memory lattice. The renderer still has no identity authority.',tags:['identity-anatomy','local-only','no-authority']}
};
function showPersonReadout(person){
  const entity=person.entity;
  const attributes=entity.attributes??{};
  const genome=entity.presentation?.visualGenome??{};
  eyebrowEl.textContent='PERSON Ω · LOCAL SIMULATION';
  titleEl.textContent=attributes.displayName??entity.id;
  bodyEl.textContent=`${entity.presentation?.summary??'Fictional local person projection.'} ${genome.shapeFamily??'modular form'} / ${genome.motionPattern??'living'} rhythm.`;
  metaEl.innerHTML='';
  ['fictional fixture',attributes.presence??'present',entity.consent?.displayName?.granted===true?'consent projected':'consent unavailable',genome.connectionStyle??'local relation'].forEach(t=>{const s=document.createElement('span');s.className='pill';s.textContent=t;metaEl.appendChild(s)});
  readout.classList.add('visible');
}
function updateRealityLensControls(){
  lensButtons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.lensMode===realityLensMode)));
  const modeCopy=lensDescriptions[realityLensMode];
  subEl.textContent=`Reality Lens Ω / ${modeCopy.title.split(' · ')[1].toLowerCase()} projection`;
}
function setRealityLens(mode,method='lens-control'){
  if(!lensDescriptions[mode])return;
  realityLensMode=mode;
  if(!realityLensPersonId)realityLensPersonId=personOrganisms.defaultPersonId();
  const cubeTarget = blockWorldPresentationActive ? blockWorld?.getFocusTarget?.() : null;
  desiredTarget.copy(cubeTarget ?? personOrganisms.getFocusTarget(realityLensMode,realityLensPersonId));
  cameraTween=reducedMotion ? .16 : 1;
  if(cubeTarget)desiredCameraPosition.copy(cubeTarget).add(new THREE.Vector3(0,7.4,12.8));
  else if(realityLensMode==='world')desiredCameraPosition.set(0,10,30);
  else if(realityLensMode==='population')desiredCameraPosition.set(0,5.7,17.2);
  else desiredCameraPosition.copy(desiredTarget).add(new THREE.Vector3(0,2.65,8.4));
  cameraPositionTween=reducedMotion ? .16 : 1;
  updateRealityLensControls();
  const selected=personOrganisms.getPerson(realityLensPersonId);
  // When the cube substrate owns the scene, do not leave a hidden round
  // person as the HUD target. The semantic lens controls still change their
  // local mode, but the visible readout stays anchored to the selected cube.
  if (cubeTarget) restorePortalCubeReadout(method);
  else if(realityLensMode==='detail'&&selected)showPersonReadout(selected);
  else{
    const copy=lensDescriptions[realityLensMode];
    eyebrowEl.textContent='SEMANTIC ZOOM';titleEl.textContent=copy.title;bodyEl.textContent=copy.body;metaEl.innerHTML='';copy.tags.forEach(t=>{const s=document.createElement('span');s.className='pill';s.textContent=t;metaEl.appendChild(s)});readout.classList.add('visible');
  }
  projectionBridge.emitIntent('projection.reality-lens',`reality-lens:${realityLensMode}`,{mode:realityLensMode,method,personId:realityLensPersonId});
}
lensButtons.forEach(button=>button.addEventListener('click',()=>setRealityLens(button.dataset.lensMode,'lens-control')));
addEventListener('keydown',event=>{
  // Free 3D manipulation shortcuts (additive, 2026-09-18). T/R/S switch the
  // gizmo mode only while a manipulate mode is armed, so `r` keeps its
  // camera-reset meaning everywhere else; Escape always disarms.
  const manipulateArmed = blockWorld?.getManipulateMode?.() ?? null;
  if(event.key==='Escape'&&manipulateArmed){
    blockWorld?.setManipulateMode?.(null);
    refreshManipulateButtons();
    return;
  }
  const shortcutKey=event.key.toLowerCase();
  if(manipulateArmed&&!event.repeat&&!/input|textarea|select/i.test(event.target?.tagName??'')&&['t','r','s'].includes(shortcutKey)){
    const mode=shortcutKey==='t'?'translate':shortcutKey==='r'?'rotate':'scale';
    if(MANIPULATE_MODES.includes(mode)){
      blockWorld?.setManipulateMode?.(mode);
      refreshManipulateButtons();
      return;
    }
  }
  if(event.key.toLowerCase()==='r'&&!event.repeat&&!/input|textarea|select/i.test(event.target?.tagName??'')){
    document.getElementById('camera-reset')?.click();
    return;
  }
  if(event.key.toLowerCase()!=='l'||event.repeat)return;
  const order=['world','population','detail'];
  const next=order[(order.indexOf(realityLensMode)+1)%order.length];
  setRealityLens(next,'keyboard');
});
updateRealityLensControls();
// A Lens URL is a shareable presentation preference, never a canonical state
// mutation. It also gives a repeatable way to inspect each semantic scale.
const lensQuery=new URLSearchParams(location.search);
const requestedPersonId=lensQuery.get('person');
if(requestedPersonId&&personOrganisms.getPerson(requestedPersonId))realityLensPersonId=requestedPersonId;
const personRouteQuery=new URLSearchParams(globalThis.location?.search??'');
const personRouteId=personRouteQuery.get('person');
if(personRouteQuery.get('panel')==='person'){
  const person=personRouteId?personOrganisms.getPerson(personRouteId):null;
  if(person){ realityLensPersonId=person.id; setRealityLens('detail','person-route'); showPersonReadout(person); }
  else { realityLensPersonId=null; eyebrowEl.textContent='PERSON ROUTE REJECTED'; titleEl.textContent='NO PERSON DATA'; bodyEl.textContent='Malformed or unknown canonical profile ID. NO PROFILE FABRICATED.'; readout.classList.add('visible'); }
}
globalThis.addEventListener?.('popstate',()=>{const q=new URLSearchParams(globalThis.location?.search??'');if(q.get('panel')!=='person')return;const person=q.get('person')?personOrganisms.getPerson(q.get('person')):null;if(person){realityLensPersonId=person.id;setRealityLens('detail','person-popstate');showPersonReadout(person)}else{realityLensPersonId=null;eyebrowEl.textContent='PERSON ROUTE REJECTED';titleEl.textContent='NO PERSON DATA';bodyEl.textContent='Malformed or unknown canonical profile ID. NO PROFILE FABRICATED.';readout.classList.add('visible')}});
const requestedLensMode=lensQuery.get('lens');
if(requestedLensMode)setRealityLens(requestedLensMode,'url');
function focusOrgan(o,method='spatial'){
  // Portal destinations retain the cube field as the visible substrate. Any
  // destination callback that tries to focus an organ must therefore leave
  // the camera and HUD anchored to the originating cube instead of exposing
  // a hidden round layer as stale context.
  if (portalCubeSubstrateActive || blockWorldPresentationActive) {
    restorePortalCubeReadout(method);
    return;
  }
  const p=new THREE.Vector3();o.root.getWorldPosition(p);desiredTarget.copy(p);cameraTween=1;selectedPulse=o;showReadout(o);o.targetAwake=1;
  projectionBridge.emitIntent('projection.focus',o.id,{method,entityId:o.projectionEntity?.id ?? o.id});
}

function isPortalCubeSubstrateHandoff(featureId, method) {
  return portalCubeSubstrateActive
    && PORTAL_CUBE_SUBSTRATE_FEATURES.has(featureId)
    && String(method ?? '').startsWith('block-portal:');
}

// A portal destination may still execute its normal feature-selection branch,
// but its round-organ focus is deliberately hidden while the cube field stays
// visible. Restore the originating cube's readout after that branch so the HUD
// never claims that a hidden market/organ is the active visual context.
function restorePortalCubeReadout(method = 'portal') {
  const snapshot = blockWorld?.getSnapshot?.();
  const blocks = snapshot?.draft?.blocks ?? [];
  const methodText = String(method ?? '');
  const sourceId = methodText.startsWith('block-portal:')
    ? methodText.slice('block-portal:'.length)
    : null;
  const sourceBlock = blocks.find((block) => block.id === sourceId)
    ?? blocks.find((block) => block.id === snapshot?.selectedId);
  if (!sourceBlock) return false;
  const target = blockWorld?.getFocusTarget(sourceBlock);
  if (target) {
    desiredTarget.copy(target);
    desiredCameraPosition.copy(target).add(new THREE.Vector3(0, 7.4, 12.8));
    cameraTween = reducedMotion ? .16 : 1;
    cameraPositionTween = reducedMotion ? .16 : 1;
  }
  showBlockReadout(sourceBlock, 'portal');
  return true;
}

// Block World is an explicit cube workspace. Keep the other semantic layers
// mounted for the canonical projection, but temporarily hide them while the
// user is working inside the voxel field so round organism/market geometry
// cannot obscure the selected cube. Visibility is restored when the user
// leaves the feature; no canonical projection values are changed.
function setBlockWorldPresentation(active, options = {}){
  blockWorldPresentationActive=Boolean(active);
  const cubeFirstUi = options?.cubeFirstUi !== false;
  // The cube workspace is a presentation mode, not a second state store.
  // Mark the document so the legacy round selector rails can get out of the
  // way while the user is manipulating cubes. The feature directory itself
  // is still reachable through the small OPEN FEATURES control.
  document.body?.classList.toggle('cube-first-mode', blockWorldPresentationActive);
  // Normal feature routes retain their own controls while still projecting
  // the cube field as the default world layer. Block World and Portal routes
  // additionally collapse the legacy rails for an unobstructed field.
  if (blockWorldPresentationActive && !cubeFirstUi) {
    document.body?.classList.remove('cube-first-mode');
  }
  document.body?.classList.toggle('cube-substrate-mode', blockWorldPresentationActive);
  const portalAssetDestination = assetLaunchPanel?.classList.contains('portal-destination-visible') === true;
  assetLaunchPanel?.classList.toggle(
    'cube-first-hidden',
    blockWorldPresentationActive && cubeFirstUi && !portalAssetDestination,
  );
  if(active){
    if(renderer?.domElement?.style) renderer.domElement.style.touchAction='none';
    if(!blockWorldVisibility) {
      blockWorldVisibility=new Map(world.children.map(child=>[child,child.visible]));
      world.children.forEach(child=>{child.visible=child===blockWorld?.layer;});
    }
    if(blockWorld?.layer)blockWorld.layer.visible=true;
    if(!blockWorldEnvironmentVisibility){
      blockWorldEnvironmentVisibility=new Map([grid,...blockWorldHorizonRings].map(child=>[child,child.visible]));
      blockWorldEnvironmentVisibility.forEach((visible,child)=>{child.visible=false;});
    }
    return;
  }
  blockWorld?.cancelDirectManipulation?.('block-world-closed');
  blockWorld?.setGazeLockedBlock?.(null, { reason: 'presentation-closed' });
  controls.enabled=true;
  if(renderer?.domElement?.style) renderer.domElement.style.touchAction='';
  if(blockWorldVisibility){
    blockWorldVisibility.forEach((visible,child)=>{child.visible=visible;});
    blockWorldVisibility=null;
  }
  if(blockWorldEnvironmentVisibility){
    blockWorldEnvironmentVisibility.forEach((visible,child)=>{child.visible=visible;});
    blockWorldEnvironmentVisibility=null;
  }
  document.body?.classList.remove('cube-substrate-mode');
  assetLaunchPanel?.classList.remove('cube-first-hidden');
}

// Cube-first mode is a DOM presentation handoff layered on top of the same
// local renderer state. Mission Control stays reachable through the small
// feature toggle, while generic organ controls and the asset preview leave
// the focused cube field unobstructed. Selecting another feature clears this
// flag and the navigator reopens its directory as usual.
function setBlockWorldFocusMode(active) {
  const state = applyBlockWorldFocusMode({ documentRoot: document, active });
  if (state.active) featureNavigator?.close();
  return state;
}

function openBlockWorldSnapshotPanel(method = 'button') {
  setBlockWorldPresentation(true);
  featureNavigator?.select('block-world', `snapshot:${method}`);
  blockMigration?.close();
  migrationSnapshot?.close();
  blockWorldRuntimeSync?.close();
  blockWorld?.close();
  blockWorldSnapshot?.open();
}

// Camera motion is an optional local input adapter. It receives only bounded
// frame-difference vectors; no frame, face, identity, or recording state is
// ever passed into the canonical projection.
const blockWorldCameraOpenButton = document.getElementById('block-world-camera-open');
const blockWorldCameraStatus = document.getElementById('block-world-camera-status');
const blockWorldCameraStatusCopy = Object.freeze({
  off: 'CAMERA OFF · MOUSE / TRACKPAD READY',
  requesting: 'REQUESTING CAMERA PERMISSION · MOTION ONLY',
  active: 'CAMERA MOTION ACTIVE · ORBIT ONLY · NO CUBE EDITS · NO FRAMES STORED',
  unsupported: 'CAMERA UNAVAILABLE · MOUSE / TRACKPAD READY',
  denied: 'CAMERA PERMISSION DENIED · MOUSE / TRACKPAD READY',
  error: 'CAMERA INPUT ERROR · MOUSE / TRACKPAD READY',
});
function syncBlockWorldCameraStatus(snapshot) {
  if (!snapshot) return;
  const status = String(snapshot.status ?? 'off');
  if (blockWorldCameraStatus) {
    blockWorldCameraStatus.dataset.cameraState = status;
    blockWorldCameraStatus.textContent = blockWorldCameraStatusCopy[status] ?? 'CAMERA INPUT OFF';
  }
  blockWorldCameraOpenButton?.setAttribute('aria-expanded', String(snapshot.opened === true));
}

const cameraInput=createCameraInput({
  documentRoot:document,
  onMotion:(motion)=>{
    cameraMotion={
      dx:THREE.MathUtils.clamp(motion.dx,-1,1),
      dy:THREE.MathUtils.clamp(motion.dy,-1,1),
      magnitude:THREE.MathUtils.clamp(motion.magnitude,0,1),
    };
    projectionBridge.emitIntent('projection.camera-motion',CAMERA_INPUT_SOURCE,Object.freeze({
      dx:cameraMotion.dx,
      dy:cameraMotion.dy,
      magnitude:cameraMotion.magnitude,
      sample:motion.sample,
      source:CAMERA_INPUT_SOURCE,
      simulation:true,
      localOnly:true,
      motionOnly:true,
      biometric:false,
      recording:false,
      externalNetwork:false,
    }));
  },
  onStatus:(status)=>{
    syncBlockWorldCameraStatus(status);
    projectionBridge.emitIntent('projection.camera-input-status',CAMERA_INPUT_SOURCE,status);
  },
});
window.__TUMBO_CAMERA_INPUT__=cameraInput;
// Phone eye/hand controls stay a capability-aware companion to the camera
// panel. The bridge forwards only bounded local pose metadata into the same
// camera-motion accumulator; it never owns a cube action or a sensor frame.
gestureInput=createGestureInput({
  documentRoot:document,
  requestImmersive:()=>immersiveSession.start('immersive-ar'),
  onGesture:(gesture)=>{
    cameraMotion={
      dx:THREE.MathUtils.clamp(gesture.pose?.dx ?? 0,-1,1),
      dy:THREE.MathUtils.clamp(gesture.pose?.dy ?? 0,-1,1),
      magnitude:THREE.MathUtils.clamp(gesture.pose?.magnitude ?? 0,0,1),
    };
    const cubeFocus = applyGestureCubeFocus(gesture);
    projectionBridge.emitIntent('projection.gesture-input',GESTURE_INPUT_SOURCE,Object.freeze({
      mode:gesture.mode,
      inputSource:gesture.inputSource ?? null,
      gesture:gesture.gesture ?? null,
      nativeHandGesture:gesture.nativeHandGesture ?? gesture.gesture ?? null,
      pose:gesture.pose ?? null,
      pointProvided:gesture.pointProvided !== false,
      cubeFocus: cubeFocus
        ? Object.freeze({
          action: cubeFocus.action,
          targetBlockId: cubeFocus.targetBlockId,
          targetCoordinate: cubeFocus.targetCoordinate,
          normalized: cubeFocus.normalized,
          couplingSource: cubeFocus.couplingSource ?? GAZE_HAND_COUPLING_SOURCE,
          gazeLockActive: cubeFocus.gazeLockActive === true,
          gazeLockReason: cubeFocus.gazeLockReason ?? null,
          gazeLockExpiresAt: cubeFocus.gazeLockExpiresAt ?? null,
          handReusedGazePoint: cubeFocus.handReusedGazePoint === true,
          localOnly: true,
          cameraDrivenBlockEdits: false,
        })
        : null,
      sample:gesture.sample ?? null,
      capabilities:gesture.capabilities ?? null,
      simulation:true,
      localOnly:true,
      motionOnly:true,
      biometric:false,
      landmarks:false,
      recording:false,
      externalNetwork:false,
      externalTransfer:false,
      persistence:false,
      executable:false,
      cameraDrivenBlockEdits:false,
    }));
  },
  onStatus:(status)=>{
    if (status?.active === false) {
      if (gazeHandCouplingExpiryTimer !== null) {
        globalThis.clearTimeout?.(gazeHandCouplingExpiryTimer);
        gazeHandCouplingExpiryTimer = null;
      }
      gazeHandCouplingState = createGazeHandCouplingState({ reason: 'input-stopped' });
    }
    projectionBridge.emitIntent('projection.gesture-input-status',GESTURE_INPUT_SOURCE,status);
    updateGestureCouplingStatus({ reason: status?.active === false ? 'input-stopped' : null });
  },
});
window.__TUMBO_GESTURE_INPUT__=gestureInput;
// Read-only browser diagnostics make the camera-to-orbit seam observable in
// an audit without exposing the mutable Three.js camera or granting any
// authority.  The snapshot contains only numeric pose/motion metadata and
// explicitly records that cube edits remain outside camera input.
function getCameraNavigationSnapshot() {
  return Object.freeze({
    source: CAMERA_INPUT_SOURCE,
    active: cameraInput.getSnapshot().active === true,
    position: Object.freeze({
      x: Number(camera.position.x.toFixed(4)),
      y: Number(camera.position.y.toFixed(4)),
      z: Number(camera.position.z.toFixed(4)),
    }),
    target: Object.freeze({
      x: Number(controls.target.x.toFixed(4)),
      y: Number(controls.target.y.toFixed(4)),
      z: Number(controls.target.z.toFixed(4)),
    }),
    motion: Object.freeze({
      dx: Number(cameraMotion.dx.toFixed(4)),
      dy: Number(cameraMotion.dy.toFixed(4)),
      magnitude: Number(cameraMotion.magnitude.toFixed(4)),
    }),
    controlsEnabled: controls.enabled === true,
    gesture: gestureInput?.getSnapshot?.() ?? null,
    gestureCubeFocus: gestureCubeFocusState,
    worldEvidenceField: getWorldEvidenceFieldCameraSnapshot(),
    localOnly: true,
    motionOnly: true,
    cameraDrivenBlockEdits: false,
    recording: false,
    externalNetwork: false,
    externalTransfer: false,
  });
}
window.__TUMBO_CAMERA_NAVIGATION__=Object.freeze({ getSnapshot: getCameraNavigationSnapshot });
syncBlockWorldCameraStatus(cameraInput.getSnapshot());
blockWorldCameraOpenButton?.addEventListener('click', () => {
  cubeQuickActions?.close('camera');
  cameraInput.open();
  syncBlockWorldCameraStatus(cameraInput.getSnapshot());
});
document.getElementById('camera-input-open')?.addEventListener('click', () => {
  // This button is mounted in Mission Control, so opening the local device
  // companion must also replace any stale feature identity. Otherwise the
  // visible Camera panel can leave the shared session and cube quick-actions
  // labeled as the previously selected Contracts/Migration surface.
  alignFeatureSurface('projections', 'camera-input-button');
  featureNavigator?.close();
  cubeQuickActions?.close('camera');
  cameraInput.open();
  syncBlockWorldCameraStatus(cameraInput.getSnapshot());
});
document.getElementById('gesture-input-open')?.addEventListener('click', () => {
  alignFeatureSurface('projections', 'gesture-input-button');
  featureNavigator?.close();
  cubeQuickActions?.close('gesture');
  cameraInput.open();
  gestureInput?.open();
  syncBlockWorldCameraStatus(cameraInput.getSnapshot());
});
document.getElementById('camera-input-close')?.addEventListener('click', () => {
  gestureInput?.close();
  syncBlockWorldCameraStatus(cameraInput.getSnapshot());
});
// The camera panel has its own explicit reset affordance. Reuse the canonical
// camera reset handler so this action only returns the viewpoint to the default
// cube-field framing; it never changes a block or the canonical projection.
document.getElementById('camera-input-reset')?.addEventListener('click', () => {
  document.getElementById('camera-reset')?.click();
  syncBlockWorldCameraStatus(cameraInput.getSnapshot());
});
if (new URLSearchParams(globalThis.location?.search ?? '').get('panel') === 'camera') {
  // A shareable camera-control link opens the consent panel but never grants
  // the browser camera permission automatically; enabling motion remains an
  // explicit user action. Keep this route on the same cube substrate as the
  // rest of the interaction surface so legacy round semantic layers cannot
  // obscure the camera-controlled blocks.
  setBlockWorldPresentation(true, { cubeFirstUi: true });
  cameraInput.open();
  syncBlockWorldCameraStatus(cameraInput.getSnapshot());
}
const gestureRouteQuery = new URLSearchParams(globalThis.location?.search ?? '');
if (gestureRouteQuery.get('panel') === 'gesture'
  || (gestureRouteQuery.get('panel') === 'camera' && gestureRouteQuery.get('gestures') === '1')) {
  // Gesture routes open the linked camera consent surface and the local
  // capability panel, but never auto-enable a permission-bearing sensor.
  setBlockWorldPresentation(true, { cubeFirstUi: true });
  cameraInput.open();
  gestureInput.open();
  syncBlockWorldCameraStatus(cameraInput.getSnapshot());
}

// Mission Control turns the domain vocabulary into explicit, openable views.
// The navigator never owns state; it asks this renderer to focus a nearby
// organ while its DOM detail card reads from the canonical projection.
featureNavigator = createFeatureNavigator({
  documentRoot: document,
  projection: livingRealityWorld,
  deviceProjection,
  onFocus: (feature, method) => {
    personStudio?.close();
    realityAssembly?.close();
    try { botPlazaRuntime?.publishWorldEvent('feature.entered', { featureId: feature?.id ?? null, method: String(method ?? '') }); } catch {}
    if (feature?.id !== 'bot-plaza') botPlazaConsole?.close();
    const genericUserSelection = method === 'button'
      || method === 'keyboard'
      || method === 'feature-navigator'
      || method === 'feature-block';
    // Selecting a feature is a local navigation action. Provider reads belong
    // to explicit panel/live routes or a visible refresh control, never to a
    // generic feature handoff (including URL/popstate restoration).
    const genericNoAutoRefresh = ['button', 'keyboard', 'feature-navigator', 'feature-block', 'url', 'launch-kit-route', 'popstate'].includes(String(method));
    if (genericUserSelection && globalThis.history?.pushState && globalThis.location) {
      const route = new URL(globalThis.location.href);
      ['panel','draft','contract','record','graph','journey','live','city'].forEach((key) => route.searchParams.delete(key));
      route.searchParams.set('feature', feature.id);
      globalThis.history.pushState({ feature: feature.id }, '', route.href);
      globalThis.dispatchEvent(new Event('city-journey:route-left'));
    }
    // Every feature selection starts by dismissing the gateway evidence layer;
    // its dedicated branch below reopens it after the world focus is updated.
    liveGatewayConsole?.close();
    deviceProjectionConsole?.close();
    portalReturn?.close('feature-select');
    migrationSnapshot?.close();
    blockWorldSnapshot?.close();
    blockWorldRuntimeSync?.close();
    launchReceipt?.close();
    launchKitConsole?.close();
    cameraInput?.close();
    gestureInput?.close();
    sportsEventsConsole?.close();
    multiSportEventsConsole?.close();
    assetMarketConsole?.close();
    if (feature.id !== 'academy') academyConsole?.close('feature-select');
    if (feature.id !== 'world-events' && feature.id !== 'gateway') worldEvidenceLayer && (worldEvidenceLayer.visible = false);
    if (feature.id !== 'sports-events') sportsEvidenceLayer && (sportsEvidenceLayer.visible = false);
    syncBlockWorldCameraStatus(cameraInput?.getSnapshot?.());
    const portalMethod = String(method ?? '').startsWith('block-portal:');
    // A normal Mission Control selection starts a new presentation context;
    // only the explicit cube-portal handoff may retain the cube substrate.
    if (!portalMethod) portalCubeSubstrateActive = false;
    if (!portalMethod && method !== 'portal-return') worldEvidenceReturnContext = null;
    const preserveCubeSubstrate = isPortalCubeSubstrateHandoff(feature.id, method);
    // Both the plain Block World route and a Portal destination are cube-first
    // views: collapse the directory and hide unrelated rounded overlays while
    // keeping the feature toggle and destination/return controls available.
    setBlockWorldFocusMode(feature.id === 'block-world' || feature.id === 'runtime-sync' || preserveCubeSubstrate);
    assetLaunchPanel?.classList.toggle(
      'portal-destination-visible',
      preserveCubeSubstrate && feature.id === 'asset-token',
    );
    // The allocation preview belongs to the Asset Token route. Keep it out
    // of unrelated cube-backed feature surfaces so the block field and the
    // selected route console remain the only active panels in that view.
    assetLaunchPanel?.classList.toggle(
      'asset-route-hidden',
      feature.id !== 'asset-token',
    );
    // Every normal route now projects the cube field as its visual substrate;
    // only the explicit Block World/Portal routes collapse legacy DOM rails.
    setBlockWorldPresentation(true, {
      cubeFirstUi: feature.id === 'block-world' || feature.id === 'runtime-sync' || preserveCubeSubstrate,
    });
    cubeQuickActions?.setVisible(
      // Keep the rail mounted over feature and portal surfaces. The six cube
      // actions plus semantic-depth/linked controls all delegate to the same
      // canonical Block World state, so a handoff never strands navigation.
      feature.id !== 'block-world',
      { featureId: feature.id, featureLabel: feature.label, method },
    );
    // Selecting the cube workspace is an intentional handoff from Mission
    // Control into the field. Close the directory after the handoff so the
    // cubes receive the available screen area; OPEN FEATURES / F can reopen
    // it whenever navigation is needed.
    if (feature.id === 'block-world' && !portalMethod) featureNavigator?.close();
    if (feature.id === 'reality-lens') {
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
      setRealityLens('world', `feature:${method}`);
      realityAssembly?.open();
      featureNavigator?.close();
      if (preserveCubeSubstrate) restorePortalCubeReadout(method);
      return;
    }
    if (feature.id === 'person') {
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
      setRealityLens('detail', `feature:${method}`);
      if (!new URLSearchParams(location.search).has('person')) {
        personStudio?.open();
        featureNavigator?.close();
      }
      if (preserveCubeSubstrate) restorePortalCubeReadout(method);
      return;
    }
    if (feature.id === 'launch-distribution') {
      // Keep the right-side consoles mutually exclusive so a feature click
      // never leaves two opaque panels stacked over the world.  The feature
      // navigator stays open as the stable way back to every other surface.
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
      launchConsole?.open();
    } else if (feature.id === 'social-explorer') {
      // Social Explorer and the launch registry are alternate local views;
      // close the previous console before opening the requested one.
      launchConsole?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
      socialExplorer?.open();
    } else if (feature.id === 'rooms') {
      // Rooms are a third mutually exclusive local surface.  The portal layer
      // remains in the world while its enter/leave console is open.
      launchConsole?.close();
      socialExplorer?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
      roomSpaces?.open();
    } else if (feature.id === 'block-world') {
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
      blockWorld?.open();
      const target = blockWorld?.getFocusTarget();
      if (target) {
        desiredTarget.copy(target);
        desiredCameraPosition.copy(target).add(new THREE.Vector3(0, 7.4, 12.8));
        cameraTween = reducedMotion ? .16 : 1;
        cameraPositionTween = reducedMotion ? .16 : 1;
      }
      const selectedBlockSnapshot = blockWorld?.getSnapshot?.();
      const selectedBlock = selectedBlockSnapshot?.draft?.blocks?.find((block) => block.id === selectedBlockSnapshot.selectedId);
      if (selectedBlock) showBlockReadout(selectedBlock, 'select');
      return;
    } else if (feature.id === 'runtime-sync') {
      // Local Cube Sync is a first-class Mission Control route, but its
      // panel is still the existing explicit loopback bridge. Open it through
      // the low-level helper so this onFocus callback cannot recurse back into
      // Mission Control or stack a duplicate console.
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
      openBlockWorldRuntimeSync(`feature:${method}`, { selectFeature: false });
      featureNavigator?.close();
      return;
    } else if (feature.id === 'asset-market') {
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      migrationSnapshot?.close();
      blockWorldSnapshot?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      liveGatewayConsole?.close();
      worldEventsConsole?.close();
      worldEvidenceLayer && (worldEvidenceLayer.visible = false);
      sportsEventsConsole?.close();
      sportsEvidenceLayer && (sportsEvidenceLayer.visible = false);
      deviceProjectionConsole?.close();
      featureNavigator?.close();
      assetMarketConsole?.open();
      if (!genericNoAutoRefresh) void assetMarketConsole?.refresh(`feature:${method}`);
    } else if (feature.id === 'migration') {
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
      blockMigration?.open();
    } else if (feature.id === 'arena') {
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.open();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
    } else if (feature.id === 'academy') {
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
      featureNavigator?.close();
      academyConsole?.open(`feature:${method}`);
    } else if (feature.id === 'contracts') {
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.open();
      // Mission Control is a navigation directory, not a second surface.
      // Leaving it open here covers the left half of the canvas and prevents
      // pointer/touch cube drags from reaching the shared Block World layer.
      // The always-visible feature toggle remains the return path.
      featureNavigator?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
    } else if (feature.id === 'paycore') {
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.open();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
    } else if (feature.id === 't402') {
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.open();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
    } else if (feature.id === 'neural-mesh') {
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.open();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
    } else if (feature.id === 'picture-matter') {
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.open();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
    } else if (feature.id === 'nft-atelier') {
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.open();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
    } else if (feature.id === 'muse-agent') {
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.open();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
      botPlazaConsole?.close();
    } else if (feature.id === 'bot-plaza') {
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      botPlazaConsole?.open();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
    } else if (feature.id === 'contract-atelier') {
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.open();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
    } else if (feature.id === 'luna-companion') {
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.open();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
    } else if (feature.id === 'wardrobe-atelier') {
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.open();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
    } else if (feature.id === 'white-paper') {
      // White Paper is a read-only document console: it composes the live
      // feature registry, neural mesh, contracts and ledger state from the
      // local projection. Zero WebGL, zero network, zero writes.
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.open();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
    } else if (feature.id === 'gesture-lens') {
      // Gesture Lens is a local hand-proxy rehearsal surface: pointer/touch
      // gestures steer the 3D world through the manipulation host. Camera is
      // off by default, local preview only, never analyzed or recorded.
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.open();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
    } else if (feature.id === 'ledger') {
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.open();
      sportsEventsConsole?.close();
    } else if (feature.id === 'gateway') {
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
      // World Gateway / Evidence is public-read-first. The old local gateway
      // fixture remains mounted only for compatibility tests and is hidden by
      // the public-status-only presentation. During navigator bootstrap the
      // feature callback runs before `featureNavigator` receives its object;
      // defer the one URL refresh until after bootstrap so this path cannot
      // issue duplicate provider requests.
      openLivePublicStatus(`feature-gateway:${method}`, !genericNoAutoRefresh && featureNavigator !== null);
    } else if (feature.id === 'world-events') {
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      liveGatewayConsole?.close();
      featureNavigator?.close();
      worldEventsConsole?.open();
      if (!genericNoAutoRefresh) void worldEventsConsole?.refresh(`feature:${method}`);
    } else if (feature.id === 'sports-events') {
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      liveGatewayConsole?.close();
      worldEventsConsole?.close();
      featureNavigator?.close();
      sportsEvidenceLayer && (sportsEvidenceLayer.visible = true);
      sportsEventsConsole?.open();
      if (!genericNoAutoRefresh) void sportsEventsConsole?.refresh(`feature:${method}`);
    } else if (feature.id === 'multi-sport-events') {
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      liveGatewayConsole?.close();
      worldEventsConsole?.close();
      sportsEventsConsole?.close();
      featureNavigator?.close();
      // Multi-sport evidence is a cube-backed readout; keep the legacy round
      // semantic layers hidden while this panel is open.
      setBlockWorldPresentation(true, { cubeFirstUi: true });
      multiSportEventsConsole?.open();
      if (!genericNoAutoRefresh) void multiSportEventsConsole?.refresh(`feature:${method}`);
    } else if (feature.id === 'projections') {
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      liveGatewayConsole?.close();
      deviceProjectionConsole?.open();
      sportsEventsConsole?.close();
    } else {
      // Returning to any other feature should dismiss a prior right-side
      // console so it cannot obscure the selected organ or the navigator.
      launchConsole?.close();
      socialExplorer?.close();
      roomSpaces?.close();
      blockWorld?.close();
      blockMigration?.close();
      arenaGames?.close();
      contractsMarkets?.close();
      paycoreConsole?.close();
      t402Console?.close();
      neuralMeshConsole?.close();
      pictureMatterConsole?.close();
      nftAtelierConsole?.close();
      museAgentConsole?.close();
      contractAtelierConsole?.close();
      lunaCompanionConsole?.close();
      wardrobeAtelierConsole?.close();
      whitePaperConsole?.close();
      gestureLensConsole?.close();
      ledgerProofConsole?.close();
      sportsEventsConsole?.close();
    }
    if (preserveCubeSubstrate) {
      // The destination console is open, but the cube substrate is the visual
      // world. Do not focus or read out the hidden round organ for this route.
      restorePortalCubeReadout(method);
      return;
    }
    const organ = organs.find((candidate) => candidate.id === feature.focusOrganId);
    if (organ) focusOrgan(organ, `feature:${method}`);
  },
  onIntent: (feature, method) => {
    if (feature.id === 'asset-token' && method === 'replay') previewAssetLaunch('feature-navigator');
    if (feature.id === 'asset-market' && method === 'replay') assetMarketConsole?.replay('feature-navigator');
    if (feature.id === 'launch-distribution' && method === 'replay') launchConsole?.replay('feature-navigator');
    if (feature.id === 'social-explorer' && method === 'replay') socialExplorer?.replay('feature-navigator');
    if (feature.id === 'rooms' && method === 'replay') roomSpaces?.replay('feature-navigator');
    if (feature.id === 'block-world' && method === 'replay') blockWorld?.replay('feature-navigator');
    if (feature.id === 'migration' && method === 'replay') blockMigration?.preview('feature-navigator');
    if (feature.id === 'sports-events' && method === 'replay') sportsEventsConsole?.replay('feature-navigator');
    if (feature.id === 'multi-sport-events' && method === 'replay') multiSportEventsConsole?.replay('feature-navigator');
    if (feature.id === 'arena' && method === 'replay') arenaGames?.replay('feature-navigator');
    if (feature.id === 'academy' && method === 'replay') academyConsole?.replay('feature-navigator');
    if (feature.id === 'contracts' && method === 'replay') contractsMarkets?.replay('feature-navigator');
    if (feature.id === 'paycore' && method === 'replay') paycoreConsole?.replay('feature-navigator');
    if (feature.id === 't402' && method === 'replay') t402Console?.replay('feature-navigator');
    if (feature.id === 'neural-mesh' && method === 'replay') neuralMeshConsole?.replay('feature-navigator');
    if (feature.id === 'picture-matter' && method === 'replay') pictureMatterConsole?.replay('feature-navigator');
    if (feature.id === 'nft-atelier' && method === 'replay') nftAtelierConsole?.replay('feature-navigator');
    if (feature.id === 'muse-agent' && method === 'replay') museAgentConsole?.replay('feature-navigator');
    if (feature.id === 'bot-plaza' && method === 'replay') botPlazaConsole?.replay('feature-navigator');
    if (feature.id === 'contract-atelier' && method === 'replay') contractAtelierConsole?.replay('feature-navigator');
    if (feature.id === 'luna-companion' && method === 'replay') lunaCompanionConsole?.replay('feature-navigator');
    if (feature.id === 'wardrobe-atelier' && method === 'replay') wardrobeAtelierConsole?.replay('feature-navigator');
    if (feature.id === 'white-paper' && method === 'replay') whitePaperConsole?.replay('feature-navigator');
    if (feature.id === 'gesture-lens' && method === 'replay') gestureLensConsole?.replay('feature-navigator');
    if (feature.id === 'ledger' && method === 'replay') ledgerProofConsole?.replay('feature-navigator');
    if (feature.id === 'gateway' && method === 'replay') liveGatewayConsole?.replay('feature-navigator');
    if (feature.id === 'world-events' && method === 'replay') worldEventsConsole?.replay('feature-navigator');
    if (feature.id === 'projections' && method === 'replay') deviceProjectionConsole?.replay('feature-navigator');
    projectionBridge.emitIntent('projection.feature-open', `feature:${feature.id}`, {
      method,
      simulation: true,
      sources: feature.sources,
    });
  },
});
window.__TUMBO_FEATURE_NAVIGATOR__ = featureNavigator;
featureNavigator.setProjection(livingRealityWorld);
blockWorld?.setFeatureInventory?.(FEATURE_DEFINITIONS);
featureNavigator.setDeviceProjection(deviceProjection);
// The navigator reads `feature` during construction, before this assigned
// reference exists. Replay a direct feature handoff now that route surfaces
// can close Mission Control and expose their controls. `url` is explicitly
// provider-free, so this never turns an ordinary link into a silent provider read.
const requestedFeatureAfterNavigatorMount = new URLSearchParams(globalThis.location?.search ?? '').get('feature');
if (requestedFeatureAfterNavigatorMount) {
  featureNavigator.select(requestedFeatureAfterNavigatorMount, 'url', { updateLocation: false });
}
// One read-only session envelope lets the cube field and every feature panel
// describe the same projection at the same moment. The renderer-specific
// modules remain the owners of their local interaction state; this adapter
// only reads their snapshots on demand and never writes back into them.
projectionSession = createProjectionSession({
  getProjection: () => projectionBridge.getSnapshot?.() ?? livingRealityWorld,
  getProjectionEnvelope: () => livingRealityEnvelope,
  getActiveFeature: () => featureNavigator?.getSnapshot?.(),
  getFeatureDefinition: () => {
    const activeId = featureNavigator?.getSnapshot?.()?.activeId;
    return FEATURE_DEFINITIONS.find((feature) => feature.id === activeId) ?? null;
  },
  getBlockWorldSnapshot: () => blockWorld?.getSnapshot?.(),
  getSportsSnapshot: () => sportsEventsConsole?.getSnapshot?.(),
  getContractsSnapshot: () => contractsMarkets?.getSnapshot?.(),
  // Person Ω contributes only route/lens presentation metadata to the shared
  // session. Profile attributes and visual-genome details remain in their
  // owners and are never copied into this observability seam.
  getPersonSnapshot: () => {
    const studio=personStudio?.getSnapshot();
    if(studio?.approved || studio?.opened) return {
      source:'person-studio',opened:studio.opened,selectedId:studio.avatar?.identity.personId??null,
      avatarId:studio.avatar?.identity.avatarId??null,appearanceVersion:studio.avatar?.appearance.version??null,
      companionId:studio.companionId,roomId:studio.roomId,lensMode:'embodied',profileCount:studio.approved?1:0,
      fictional:false,localOnly:true,simulation:false,
    };
    const selected = realityLensPersonId
      ? personOrganisms?.getPerson?.(realityLensPersonId) ?? null
      : null;
    const activeId = featureNavigator?.getSnapshot?.()?.activeId;
    return {
      source: 'person-organisms',
      opened: activeId === 'person' || activeId === 'reality-lens',
      selectedId: selected?.id ?? null,
      lensMode: realityLensMode,
      profileCount: Number.isInteger(personOrganisms?.count) ? personOrganisms.count : 0,
      fictional: true,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
    };
  },
  // World Pulse keeps public-read ownership in its console. This getter makes
  // its selected/projection/provenance state visible beside cube and feature
  // state without issuing a request or caching provider records here.
  getWorldEventsSnapshot: () => worldEventsConsole?.getSnapshot?.(),
  // Rooms remains the sole owner of local selection and enter/leave state.
  // The session reads that bounded snapshot on demand without exposing room
  // metadata or any message content.
  getRoomsSnapshot: () => roomSpaces?.getSnapshot?.(),
  // Device Projection owns this fallback/capability snapshot. The shared
  // session only observes it; it never requests an XR session or device data.
  getDeviceProjectionSnapshot: () => deviceProjectionConsole?.getSnapshot?.(),
  // Gesture and gaze-hand owners may retain bounded raycast diagnostics for
  // their own local interaction. The session sanitizer exposes status/action
  // metadata only and drops every point, coordinate, target, frame, landmark,
  // or identity-bearing field.
  getGestureSnapshot: () => gestureInput?.getSnapshot?.(),
  getGazeHandSnapshot: () => gazeHandCouplingState,
  // Asset Market retains ownership of its explicit public-read envelope. This
  // session facet is a price-free observation of its current selection and
  // unlisted native-asset boundary; it never refreshes or trades.
  getAssetMarketSnapshot: () => assetMarketConsole?.getSnapshot?.(),
  // Launch Distribution remains a deterministic aggregate rehearsal. The
  // session reads its existing console snapshot without creating recipients,
  // allocation instructions, wallets, issuance, or transfer state.
  getLaunchDistributionSnapshot: () => launchConsole?.getSnapshot?.(),
  // Launch Kit remains a local manifest/export console. Its session facet is
  // summary-only and cannot publish, issue, transfer, or persist anything.
  getLaunchKitSnapshot: () => launchKitConsole?.getSnapshot?.(),
  // Live Gateway owns its public-source controls and status observations. The
  // session reads a compact summary only and cannot initiate a provider call.
  getLiveGatewaySnapshot: () => liveGatewayConsole?.getSnapshot?.(),
  // Protocol Evidence remains a separate provider-evidence rail. Its session
  // facet observes aggregate availability only; it cannot refresh, write, or
  // turn provider observations into simulated pool state.
  getProtocolEvidenceSnapshot: () => protocolEvidence?.getSnapshot?.(),
  // Social Explorer owns its local rehearsal and public Social Pulse envelope.
  // The session observes a bounded aggregate only; it cannot post, publish,
  // retain cross-user state, or request the provider.
  getSocialExplorerSnapshot: () => socialExplorer?.getSnapshot?.(),
  // Block Migration owns manifest selection and explicit local-preview work.
  // The session can observe readiness but never applies a draft or imports.
  getBlockMigrationSnapshot: () => blockMigration?.getSnapshot?.(),
  // Migration Snapshot retains all user-supplied JSON and preview rows. This
  // read-only session facet sees validation totals only and cannot load, apply,
  // replay, import, or persist a snapshot.
  getMigrationSnapshot: () => migrationSnapshot?.getSnapshot?.(),
  // Arena owns its deterministic local game state. The session reads a compact
  // status summary only and cannot take a turn, replay/reset, or join a game.
  getArenaGamesSnapshot: () => arenaGames?.getSnapshot?.(),
  // PAYCORE remains a fictional asset-token preview owner. This session read
  // cannot inspect amounts or initiate a transfer, signing, custody, or flow.
  getAssetTokenSnapshot: () => paycoreConsole?.getSnapshot?.(),
  getT402Snapshot: () => t402Console?.getSnapshot?.(),
  getNeuralMeshSnapshot: () => neuralMeshConsole?.getSnapshot?.(),
  // Picture Matter retains local fixture content and metadata source details.
  // The session reads aggregate metadata-only state and cannot request, render,
  // store, publish, or identify from an image.
  getPictureMatterSnapshot: () => pictureMatterConsole?.getSnapshot?.(),
  getLedgerProofSnapshot: () => ledgerProofConsole?.getSnapshot?.(),
  getMultiSportEventsSnapshot: () => multiSportEventsConsole?.getSnapshot?.(),
  getBlockWorldSnapshotConsole: () => blockWorldSnapshot?.getSnapshot?.(),
  getBlockWorldRuntimeSyncSnapshot: () => blockWorldRuntimeSync?.getSnapshot?.(),
  getPopulationContextSnapshot: () => populationContext,
  getLaunchReceiptSnapshot: () => launchReceipt?.getSnapshot?.(),
  getDistributionExplorerSnapshot: () => distributionExplorer?.getSnapshot?.(),
  getIntentTimelineSnapshot: () => intentTimeline?.getSnapshot?.(),
  // The session also indexes every mounted console as a parallel facet. Each
  // renderer keeps ownership of its own snapshot; this map is read on demand
  // and only exposes compact surface/readiness metadata to host tooling.
  getSurfaceSnapshots: () => ({
    rooms: roomSpaces?.getSnapshot?.(),
    person: {
      source: 'person-organisms',
      opened: featureNavigator?.getSnapshot?.()?.activeId === 'person',
      selectedId: realityLensPersonId ?? null,
      lensMode: realityLensMode,
      profileCount: Number.isInteger(personOrganisms?.count) ? personOrganisms.count : 0,
      fictional: true,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
    },
    "reality-lens": {
      source: 'person-organisms',
      opened: featureNavigator?.getSnapshot?.()?.activeId === 'reality-lens',
      selectedId: realityLensPersonId ?? null,
      lensMode: realityLensMode,
      profileCount: Number.isInteger(personOrganisms?.count) ? personOrganisms.count : 0,
      fictional: true,
      localOnly: true,
      simulation: true,
      externalNetwork: false,
      externalTransfer: false,
      persistence: false,
      executable: false,
    },
    migration: blockMigration?.getSnapshot?.(),
    "migration-snapshot": migrationSnapshot?.getSnapshot?.(),
    "runtime-sync": blockWorldRuntimeSync?.getSnapshot?.(),
    "block-world-snapshot": blockWorldSnapshot?.getSnapshot?.(),
    arena: arenaGames?.getSnapshot?.(),
    academy: academyConsole?.getSnapshot?.(),
    paycore: paycoreConsole?.getSnapshot?.(),
    t402: t402Console?.getSnapshot?.(),
    "neural-mesh": neuralMeshConsole?.getSnapshot?.(),
    "picture-matter": pictureMatterConsole?.getSnapshot?.(),
    "nft-atelier": nftAtelierConsole?.getSnapshot?.(),
    "muse-agent": museAgentConsole?.getSnapshot?.(),
    "bot-plaza": botPlazaConsole?.getSnapshot?.(),
    "contract-atelier": contractAtelierConsole?.getSnapshot?.(),
    "luna-companion": lunaCompanionConsole?.getSnapshot?.(),
    "wardrobe-atelier": wardrobeAtelierConsole?.getSnapshot?.(),
    ledger: ledgerProofConsole?.getSnapshot?.(),
    gateway: liveGatewayConsole?.getSnapshot?.(),
    "protocol-evidence": protocolEvidence?.getSnapshot?.(),
    "world-events": worldEventsConsole?.getSnapshot?.(),
    "sports-events": sportsEventsConsole?.getSnapshot?.(),
    "multi-sport-events": multiSportEventsConsole?.getSnapshot?.(),
    "asset-market": assetMarketConsole?.getSnapshot?.(),
    "social-explorer": socialExplorer?.getSnapshot?.(),
    projections: deviceProjectionConsole?.getSnapshot?.(),
    // Camera and gesture controls are parallel local facets of the same
    // projection session. Their snapshots contain only bounded pose/motion
    // metadata; raw frames, landmarks, and permission-bearing handles never
    // enter the session envelope.
    "camera-input": cameraInput?.getSnapshot?.(),
    "gesture-input": gestureInput?.getSnapshot?.(),
    "camera-navigation": getCameraNavigationSnapshot(),
    // The feature route opens the launch console; the Three.js distribution
    // layer is only its visual projection. Reading the console here keeps the
    // mounted surface facet aligned with the state the user can actually
    // open/navigate, while the visual layer remains available separately.
    "launch-distribution": launchConsole?.getSnapshot?.(),
    "launch-kit": launchKitConsole?.getSnapshot?.(),
    "distribution-explorer": distributionExplorer?.getSnapshot?.(),
  }),
  getRoute: () => globalThis.location?.href ?? null,
  eventTarget: globalThis.window,
  observeEvents: true,
});
window.__TUMBO_PROJECTION_SESSION__ = projectionSession;
// Re-apply a Person deep link after the canonical projection has been synced;
// the early route pass can occur before Person renderer entities exist.
if (personRouteQuery.get('panel') === 'person') {
  const hydratedPerson = personRouteQuery.get('person') ? personOrganisms.getPerson(personRouteQuery.get('person')) : null;
  if (hydratedPerson) { realityLensPersonId = hydratedPerson.id; setRealityLens('detail', 'person-route-hydrated'); showPersonReadout(hydratedPerson); }
  else { realityLensPersonId = null; eyebrowEl.textContent = 'PERSON ROUTE REJECTED'; titleEl.textContent = 'NO PERSON DATA'; bodyEl.textContent = 'Malformed or unknown canonical profile ID. NO PROFILE FABRICATED.'; readout.classList.add('visible'); }
}
// `createFeatureNavigator` invokes the requested feature callback during its
// own construction, before the assigned navigator reference exists. Complete
// the Gateway URL handoff now that Mission Control can be closed reliably,
// issuing the single public World Pulse refresh from the final route state.
if (new URLSearchParams(globalThis.location?.search ?? '').get('feature') === 'gateway') {
  openLivePublicStatus('url', true);
}
const socialLaunchQuery = new URLSearchParams(globalThis.location?.search ?? '');
const requestedSocialMode = socialLaunchQuery.get('mode');
const requestedSocialLive = socialLaunchQuery.get('live') === 'public';
const requestedSocialPanel = socialLaunchQuery.get('panel') === 'social-explorer'
  || socialLaunchQuery.get('feature') === 'social-explorer';
if (requestedSocialPanel) {
  // A shareable social/space link opens the same local console.  `mode` only
  // chooses the in-memory launch-plan presentation; it never enrolls anyone
  // or records consent.
  featureNavigator.select('social-explorer', 'url', { updateLocation: false });
  socialExplorer?.open();
  if (requestedSocialMode) socialExplorer?.selectLaunchMode(requestedSocialMode, 'url');
  // `live=public` is the shareable explicit-refresh route. Normal panel opens
  // make no provider request; this query is the only URL-driven request and is
  // equivalent to activating the rail's Refresh public pulse control.
  if (requestedSocialLive) {
    document.body?.setAttribute?.('data-social-live', 'public');
    void socialExplorer?.refreshPublicPulse?.('url');
  }
}
// The no-query landing view is deliberately cube-first.  The focused Block
// World is the interaction surface users can open, inspect, move, carry, and
// route from; Reality Lens remains available as an explicit semantic view.
const initialLandingQuery = new URLSearchParams(globalThis.location?.search ?? '');
const initialLandingHash = String(globalThis.location?.hash ?? '');
if (!initialLandingQuery.get('feature') && !initialLandingQuery.get('panel') && !initialLandingHash) {
  featureNavigator.select('block-world', 'default', { updateLocation: false });
  featureNavigator.close();
} else if (initialLandingQuery.get('feature') === 'block-world' && !initialLandingQuery.get('panel')) {
  // URL-driven cube links should open directly into the field as well. The
  // directory remains available from OPEN FEATURES / F, but it must not cover
  // the cubes on first paint.
  featureNavigator.close();
} else if (initialLandingQuery.get('feature') === 'runtime-sync' && !initialLandingQuery.get('panel')) {
  // The runtime-sync feature callback runs during navigator construction,
  // before the assigned navigator reference exists. Close the directory now
  // that the first-class Local Cube Sync route is fully mounted.
  featureNavigator.close();
}
if (initialLandingQuery.get('panel') === 'block-world') {
  // The explicit panel alias is a shareable cube-first entry point. Route it
  // through the same feature focus seam, then dismiss Mission Control so the
  // interactive cube console is visible on first paint.
  featureNavigator.select('block-world', 'url', { updateLocation: false });
  featureNavigator.close();
  blockWorld?.open();
}
if (initialLandingQuery.get('feature') === 'multi-sport-events' && !initialLandingQuery.get('panel')) {
  // The Launch Kit exposes a relative feature route as well as the dedicated
  // panel URL. Resolve that route through the same first-class navigator seam
  // so a copied local link opens the cube-backed public readout.
  featureNavigator.select('multi-sport-events', 'url', { updateLocation: false });
}
if (initialLandingQuery.get('feature') === 'world-events' && !initialLandingQuery.get('panel')) {
  // Like Tennis Evidence, a generic World Pulse feature link is provider-free
  // and must still receive the cube-first presentation cleanup after Mission
  // Control has mounted.  The dedicated panel route below remains the one
  // explicit URL-triggered public read; this route only exposes the honest
  // unavailable/previous-envelope console and its visible refresh control.
  openWorldEvents('feature-url', false);
}
if (initialLandingQuery.get('feature') === 'sports-events' && !initialLandingQuery.get('panel')) {
  // The feature URL is a direct Tennis Evidence entry point. The navigator
  // opens the same console during bootstrap, but once its reference exists we
  // must run the dedicated Sports opener. That puts the route into the same
  // cube-first presentation, clears a stale organ readout, and performs the
  // same mutually-exclusive panel cleanup as the explicit panel route.
  // `false` keeps a generic feature link provider-free: the visible refresh
  // button remains the explicit public ATP/WTA read.
  openSportsEvents('feature-url', false);
}
if (initialLandingQuery.get('feature') === 'launch-kit' && !initialLandingQuery.get('panel')) {
  // The directory exposes Launch Kit as a feature route as well as a panel
  // route. Resolve the copied feature URL into the complete local handoff so
  // it does not leave the viewer on an apparently inert cube-only screen.
  openLaunchKit('feature-url');
}
const blockActionQuery = new URLSearchParams(globalThis.location?.search ?? '');
if (blockActionQuery.get('feature') === 'block-world' && ['open', 'inspect', 'portal'].includes(blockActionQuery.get('block'))) {
  const blockSnapshot = blockWorld?.getSnapshot?.();
  const blocks = blockSnapshot?.draft?.blocks ?? [];
  // A copied `block=open` link has no prior pointer or directory selection.
  // Resolve its target from the one existing local draft before opening, so
  // cold-load behavior is deterministic rather than depending on whichever
  // cube happened to be selected while the renderer booted. `blockId` is the
  // explicit share-link target; the aliases keep old hand-authored links
  // harmless without creating another state store or a new cube.
  const requestedBlockId = blockActionQuery.get('blockId')
    ?? blockActionQuery.get('blockTarget')
    ?? blockActionQuery.get('target');
  const explicitBlock = requestedBlockId
    ? blocks.find((block) => block.id === requestedBlockId)
    : null;
  const defaultContainer = blocks.find((block) => block.canOpen && block.container)
    ?? blocks.find((block) => block.container)
    ?? blocks[0]
    ?? null;
  const selectedBlock = blockActionQuery.get('block') === 'portal'
    ? blocks.find((block) => block.blockType === 'portal')
    : explicitBlock ?? defaultContainer;
  if (selectedBlock) {
    blockWorld.selectBlock(selectedBlock.id, 'url');
    if (blockActionQuery.get('block') === 'open') blockWorld.openBlock(true);
    else if (blockActionQuery.get('block') === 'inspect') blockWorld.inspectBlock();
  }
}
if (blockActionQuery.get('panel') === 'block-snapshot') {
  openBlockWorldSnapshotPanel('url');
}
const blockWorldRuntimeRouteQuery = new URLSearchParams(globalThis.location?.search ?? '');
if (blockWorldRuntimeRouteQuery.get('panel') === 'runtime-sync') {
  // Runtime sync is never implicit: this URL only opens the local bridge;
  // Connect, Load, Save, and the optional socket remain user actions.
  openBlockWorldRuntimeSync('url', { worldId: blockWorldRuntimeRouteQuery.get('world') });
}
const launchKitRouteQuery = new URLSearchParams(globalThis.location?.search ?? '');
if (launchKitRouteQuery.get('feature') === 'launch-kit') {
  // Keep the complete handoff readable on first load; the kit has its own
  // route directory and can reopen Mission Control when a route is chosen.
  // The feature navigator may have just honored the cube-first `feature`
  // query and closed this panel during its initial focus callback, so reopen
  // it after that URL selection has settled. `feature=launch-kit` is a
  // supported deep-link alias for people who discover the kit from the
  // feature directory rather than an older panel URL.
  openLaunchKit('feature-url');
} else if (launchKitRouteQuery.get('panel') === 'launch-kit') {
  // `panel=launch-kit` was opened before all consoles had mounted. Re-open
  // its already-created panel after the rest of the route setup finishes,
  // without emitting a duplicate launch intent.
  featureNavigator.close();
  launchKitConsole?.open();
}
const launchDistributionRouteQuery = new URLSearchParams(globalThis.location?.search ?? '');
const launchDistributionPanelRoute = launchDistributionRouteQuery.get('panel') === 'launch-distribution';
const launchDistributionPopulationRoute = launchDistributionRouteQuery.get('live') === 'population';
const launchDistributionCohortId = launchDistributionRouteQuery.get('cohort');
const launchDistributionCompare = launchDistributionRouteQuery.get('compare');
if (launchDistributionPanelRoute || (launchDistributionRouteQuery.get('feature') === 'launch-distribution' && launchDistributionPopulationRoute)) {
  // The panel alias is a first-class shareable entry point for the complete
  // local registry. A plain panel route only opens the existing renderer;
  // population context remains opt-in and is the only URL-triggered read.
  featureNavigator.select('launch-distribution', 'url', { updateLocation: false });
  if (launchDistributionPanelRoute) featureNavigator.close();
  launchConsole?.open();
  if (launchDistributionPanelRoute && launchDistributionCohortId !== null) {
    const routeState = validateLaunchCohortRoute({ cohortId: launchDistributionCohortId, projection: livingRealityWorld });
    launchConsole?.hydrateCohortRoute(routeState, 'url', routeState ? null : 'cohort ID is malformed, unknown, or not in the canonical registry');
  }
  if (launchDistributionPanelRoute && launchDistributionCompare !== null) launchConsole?.hydrateCompareRoute?.(validateLaunchCohortCompareRoute({ compare: launchDistributionCompare, projection: livingRealityWorld }), 'url');
  if (launchDistributionPopulationRoute) {
    // Population context is metadata-only and must stay separate from the
    // fictional registry; this is the sole refresh call for the route.
    void launchConsole?.refreshPopulationContext?.('url');
  }
}
if (new URLSearchParams(globalThis.location?.search ?? '').get('panel') === 'world-events') {
  // World Pulse is an explicit live-source request.  Opening this shareable
  // route performs one public read; an unavailable provider yields an empty
  // state instead of falling back to bundled records.
  const worldQuery = new URLSearchParams(globalThis.location?.search ?? '').get('worldQuery');
  const worldProjection = new URLSearchParams(globalThis.location?.search ?? '').get('projection');
  const worldSignal = new URLSearchParams(globalThis.location?.search ?? '').get('signal');
  openWorldEvents('url', true, {
    query: worldQuery,
    projectField: worldProjection === 'field' || worldProjection === 'live',
    signalLens: worldSignal,
  });
}
const liveStatusRouteQuery = new URLSearchParams(globalThis.location?.search ?? '');
if (liveStatusRouteQuery.get('panel') === 'live-status') {
  // Plain `panel=live-status` keeps the original World Pulse-only behavior.
  // `live=all` is the explicit shareable batch route: it settles the existing
  // fixed adapters one at a time in LIVE_STATUS_PUBLIC_SURFACE_ORDER so each
  // status row gets one provider refresh, with failures kept visible and no
  // fallback/mock rows introduced.
  const refreshAll = liveStatusRouteQuery.get('live')?.toLowerCase() === 'all';
  openLivePublicStatus('url', true, { all: refreshAll });
}
const sportsRouteQuery = new URLSearchParams(globalThis.location?.search ?? '');
if (sportsRouteQuery.get('panel') === 'sports-events') {
  // Tennis Evidence is an explicit public-source request. Opening this
  // shareable route performs one ATP/WTA read and keeps the cube field as the
  // only visible world substrate.
  const sourceReturn = parseSportsSourceReturnRoute(sportsRouteQuery);
  openSportsEvents('url', sourceReturn.strict ? sourceReturn.valid : true, {
    recordId: sourceReturn.requestedRecordId ?? sportsRouteQuery.get('record'),
    sourceReturn: sourceReturn.strict,
    reason: sourceReturn.reason,
  });
}
if (new URLSearchParams(globalThis.location?.search ?? '').get('panel') === 'multi-sport-events') {
  // The multi-sport route is an explicit public-source request. Opening this
  // shareable link performs one bounded read of the fixed soccer, NBA, and
  // NFL scoreboards and keeps the cube field as the visible world substrate.
  // A Contracts return is stricter: it restores only its exact eligible ESPN
  // event and leaves a visible no-data state if that event no longer returns.
  const sourceReturn = parseSportsSourceReturnRoute(new URLSearchParams(globalThis.location?.search ?? ''));
  openMultiSportEvents('url', sourceReturn.strict ? sourceReturn.valid : true, {
    recordId: sourceReturn.requestedRecordId ?? new URLSearchParams(globalThis.location?.search ?? '').get('record'),
    sourceReturn: sourceReturn.strict,
    reason: sourceReturn.reason,
  });
}
const pictureMatterRouteQuery = new URLSearchParams(globalThis.location?.search ?? '');
if (pictureMatterRouteQuery.get('panel') === 'picture-matter') {
  // This shareable route keeps Mission Control out of the way and only makes
  // a public image-metadata request when `live=metadata` is explicit. The
  // query is bounded by the renderer/domain before it reaches Wikimedia.
  featureNavigator.select('picture-matter', 'url', { updateLocation: false });
  featureNavigator.close();
  pictureMatterConsole?.open();
  const pictureQuery = pictureMatterRouteQuery.get('pictureQuery');
  if (pictureQuery) pictureMatterConsole?.setMetadataQuery(pictureQuery);
  if (pictureMatterRouteQuery.get('live') === 'metadata') {
    void pictureMatterConsole?.refreshMetadata('url');
  }
}
function applyContractsRoute(method = 'url') {
  const query = new URLSearchParams(globalThis.location?.search ?? '');
  const draftRoute = parseContractsDraftRoute(query);
  const graphRoute = parseContractsGraphRoute(query);
  const contractsPanel = query.get('panel') === 'contracts';
  const contractsFeature = query.get('feature') === 'contracts';
  const protocolRoute = query.get('feature') === 'contracts' && query.get('live') === 'protocols';
  if (!contractsPanel && !contractsFeature && !protocolRoute && !draftRoute.present && !graphRoute.present) return false;
  featureNavigator.select('contracts', method, { updateLocation: false });
  if (graphRoute.present) {
    // The canonical graph route is an addressable local projection only. The
    // route validator resolves its id against the existing contribution, so a
    // cold load never fetches providers or fabricates an unknown node.
    featureNavigator.close();
    contractsMarkets?.open();
    contractsMarkets?.hydrateGraphRouteState?.(graphRoute.state, method, graphRoute.reason);
  } else if (draftRoute.present) {
    // A contract-detail URL is a self-contained local application entity.
    // Hydration consumes only the bounded payload and deliberately skips the
    // public protocol rail, so a cold reload/popstate cannot make a provider
    // request or silently replace the selected sports record.
    featureNavigator.close();
    contractsMarkets?.open();
    contractsMarkets?.hydrateDraftRouteState?.(draftRoute.state, method);
  } else {
    if (method === 'popstate') contractsMarkets?.reset?.(method);
    // Plain panel=contracts is deliberately provider-free. The public protocol
    // rail is the sole explicit exception and requires feature=contracts plus
    // live=protocols; it never changes the fictional contract graph.
    // Keep Mission Control as a directory while this console is open. On a
    // cold `?feature=contracts` load the initial navigator focus happens before
    // its variable is assigned, so the Contracts branch cannot close it; this
    // route pass is the first reliable point at which the shared cube canvas
    // is no longer covered by the directory surface.
    featureNavigator.close();
    if (protocolRoute && method === 'url') void protocolEvidence?.refresh('url');
  }
  return true;
}

applyContractsRoute('url');

globalThis.addEventListener?.('popstate', () => {
  const query = new URLSearchParams(globalThis.location?.search ?? '');
  if (query.get('feature') === 'block-world') {
    featureNavigator?.select?.('block-world', 'popstate');
    const cohortId = globalThis.__TUMBO_LAST_DISTRIBUTION_COHORT__;
    if (cohortId) setTimeout(() => blockWorld?.focusDistributionCohort?.(cohortId), 0);
  } else if (query.get('panel') === 'contracts' || query.has(CONTRACTS_MARKETS_DRAFT_ROUTE_PARAM) || query.has(CONTRACTS_MARKETS_CONTRACT_ROUTE_PARAM) || query.has(CONTRACTS_MARKETS_GRAPH_ROUTE_PARAM) || (query.get('feature') === 'contracts' && query.get('live') === 'protocols')) {
    applyContractsRoute('popstate');
  } else if (query.get('panel') === 'sports-events') {
    const sourceReturn = parseSportsSourceReturnRoute(query);
    openSportsEvents('popstate', sourceReturn.strict ? sourceReturn.valid : true, {
      recordId: sourceReturn.requestedRecordId ?? query.get('record'),
      sourceReturn: sourceReturn.strict,
      reason: sourceReturn.reason,
    });
  }
});
if (new URLSearchParams(globalThis.location?.search ?? '').get('panel') === 'asset-market') {
  // Asset Market Evidence is an explicit public-source request. TUMBO-SIM is
  // never sent as a lookup id; only the fixed peer set is read.
  openAssetMarket('url');
}
if (personRouteQuery.get('panel') === 'person') {
  const finalPerson = personRouteQuery.get('person') ? personOrganisms.getPerson(personRouteQuery.get('person')) : null;
  if (finalPerson) { realityLensPersonId = finalPerson.id; showPersonReadout(finalPerson); }
  else { eyebrowEl.textContent='PERSON ROUTE REJECTED'; titleEl.textContent='NO PERSON DATA'; bodyEl.textContent='Malformed or unknown canonical profile ID. NO PROFILE FABRICATED.'; readout.classList.add('visible'); }
}
if (new URLSearchParams(globalThis.location?.search ?? '').get('panel') === 'camera'
  || new URLSearchParams(globalThis.location?.search ?? '').get('panel') === 'gesture') {
  // The camera link is a focused consent surface; reopen Mission Control with
  // the F key when the viewer wants to choose another feature.
  // Camera and gesture panels are local device-presentation companions. Once
  // Mission Control exists, discard any stale feature identity before hiding
  // it so the shared projection session and cube quick actions identify the
  // same Phone / PC / XR context as the visible consent surface.
  alignFeatureSurface('projections', 'device-input-route');
  featureNavigator.close();
}
document.getElementById('camera-reset')?.addEventListener('click', () => {
  selectedPulse = null;
  realityLensPersonId = personOrganisms.defaultPersonId();
  setRealityLens('world', 'camera-reset');
  desiredTarget.set(0, 1, 0);
  desiredCameraPosition.set(0, 10, 30);
  cameraTween = reducedMotion ? .16 : 1;
  cameraPositionTween = reducedMotion ? .16 : 1;
  cameraMotion={dx:0,dy:0,magnitude:0};
});

function updateMouseFromPointer(event) {
  if (!Number.isFinite(event?.clientX) || !Number.isFinite(event?.clientY)) return;
  mouse.x=event.clientX/innerWidth*2-1;
  mouse.y=-(event.clientY/innerHeight)*2+1;
}
addEventListener('pointermove',updateMouseFromPointer);
addEventListener('pointerleave',()=>mouse.set(99,99));

const raycaster=new THREE.Raycaster();
// Raycast hits can include meshes whose layer root is hidden (e.g. Reality
// Assembly nodes when the assembly UI is inactive). Three.js does not skip
// those, so taps would be swallowed by invisible geometry. Filter to the
// first hit that is actually visible in the world (2026-09-20).
function isWorldVisible(object) {
  let node = object;
  while (node) {
    if (node.visible === false) return false;
    node = node.parent;
  }
  return true;
}
function raycastVisibleTargets() {
  const hits = raycaster.intersectObjects(raycastTargets, false);
  for (const hit of hits) {
    if (isWorldVisible(hit.object)) return hit;
  }
  return null;
}
const clock=new THREE.Clock();
const GESTURE_CUBE_FOCUS_SOURCE = 'gesture-cube-focus';
const GESTURE_CUBE_FOCUS_BOUNDARY = 'Optional host gaze establishes a short target lock; native-hand pinch/point/open/inspect or XR-hand select can address that same local cube only while the lock is fresh. Explicit native-hand grab/hold/place/release can address only that fresh same-target local held draft; hold accepts only a bounded integer one-step delta and release places at the held coordinate. No raw frames, landmarks, identity, recording, upload, network, storage, inferred coordinates, arbitrary movement, wallet, token, settlement, or camera-driven edits are accepted.';
const GAZE_HAND_CUBE_FOCUS_BOUNDARY = `${GAZE_HAND_COUPLING_BOUNDARY} Renderer raycasts remain local and verify the same block id before applying a semantic action.`;
let gestureCubeFocusState = Object.freeze({
  source: GESTURE_CUBE_FOCUS_SOURCE,
  active: false,
  inputSource: null,
  gesture: null,
  action: 'idle',
  targetBlockId: null,
  targetCoordinate: null,
  targetOpen: false,
  targetContainer: false,
  normalized: null,
  carryAction: null,
  carryDelta: null,
  holding: false,
  heldBlockId: null,
  localOnly: true,
  simulation: true,
  motionOnly: true,
  cameraDrivenBlockEdits: false,
  externalNetwork: false,
  persistence: false,
  boundary: GESTURE_CUBE_FOCUS_BOUNDARY,
});
let lastGesturePinchAt = -Infinity;
let lastGestureActionAt = -Infinity;
const lastGestureCarryAt = new Map();

function gestureInputNow() {
  const performanceNow = Number(globalThis.performance?.now?.());
  return Number.isFinite(performanceNow) ? performanceNow : Date.now();
}

function setGestureCouplingStatus(text, state = 'info') {
  const copy = String(text || 'GAZE + HAND OFF · LOOK THEN PINCH / GRAB').slice(0, 180);
  gestureInput?.setCouplingStatus?.(copy, { state });
  const element = document.getElementById('gesture-input-coupling-status');
  if (element) {
    element.textContent = copy;
    element.dataset.couplingState = String(state);
  }
}

function expireGestureCouplingLock(now = gestureInputNow(), reason = null) {
  gazeHandCouplingState = expireGazeHandLock(gazeHandCouplingState, now);
  if (reason && gazeHandCouplingState.reason !== reason && !gazeHandCouplingState.lockActive) {
    gazeHandCouplingState = createGazeHandCouplingState({ now, reason });
  }
  return gazeHandCouplingState;
}

function scheduleGestureCouplingExpiry() {
  if (gazeHandCouplingExpiryTimer !== null) {
    globalThis.clearTimeout?.(gazeHandCouplingExpiryTimer);
    gazeHandCouplingExpiryTimer = null;
  }
  if (!gazeHandCouplingState.lockActive || !Number.isFinite(Number(gazeHandCouplingState.expiresAt))) return;
  const delay = Math.max(0, Number(gazeHandCouplingState.expiresAt) - gestureInputNow() + 8);
  if (typeof globalThis.setTimeout !== 'function') return;
  gazeHandCouplingExpiryTimer = globalThis.setTimeout(() => {
    gazeHandCouplingExpiryTimer = null;
    const expired = expireGestureCouplingLock(gestureInputNow());
    if (!expired.lockActive) {
      blockWorld?.setGazeLockedBlock?.(null, { reason: 'gaze-expired' });
      setGestureCouplingStatus('GAZE LOCK EXPIRED · LOOK AGAIN BEFORE USING YOUR HAND', 'expired');
    }
  }, delay);
}

function updateGestureCouplingStatus({ reason = null, action = null } = {}) {
  const now = gestureInputNow();
  const lock = expireGestureCouplingLock(now, reason);
  const gestureSnapshot = gestureInput?.getSnapshot?.() ?? null;
  const active = gestureSnapshot?.active === true;
  const gazeReady = gestureSnapshot?.capabilities?.gaze === 'active';
  const handReady = gestureSnapshot?.capabilities?.nativeHand === 'active'
    || gestureSnapshot?.capabilities?.handTracking === 'active';
  if (!active) {
    setGestureCouplingStatus('GAZE + HAND OFF · ENABLE PHONE GESTURES · LOOK THEN PINCH / GRAB', 'off');
    return lock;
  }
  if (lock.lockActive && isFreshGazeHandLock(lock, now)) {
    const remaining = Math.max(0, Math.ceil(Number(lock.expiresAt) - now));
    const actionCopy = action && action !== 'hover' ? ` · ${String(action).toUpperCase()}` : '';
    setGestureCouplingStatus(`GAZE LOCK · ${lock.targetBlockId} · ${remaining}MS · LOOK THEN PINCH / POINT / OPEN / INSPECT / GRAB / HOLD / PLACE / RELEASE / XR SELECT${actionCopy}`, 'locked');
    return lock;
  }
  if (reason === 'gaze-expired' || lock.reason === 'gaze-expired') {
    setGestureCouplingStatus('GAZE LOCK EXPIRED · LOOK AGAIN BEFORE USING YOUR HAND', 'expired');
    return lock;
  }
  if (reason === 'gaze-required') {
    setGestureCouplingStatus('GAZE REQUIRED · LOOK AT A CUBE THEN PINCH / OPEN / INSPECT / GRAB / HOLD / PLACE / RELEASE / XR SELECT', 'blocked');
    return lock;
  }
  if (reason === 'target-mismatch') {
    setGestureCouplingStatus('HAND POINT MISSED GAZED CUBE · LOOK AGAIN', 'blocked');
    return lock;
  }
  if (reason === 'carry-required') {
    setGestureCouplingStatus('CARRY BLOCKED · GRAB FIRST, THEN LOOK AT THE SAME HELD CUBE', 'blocked');
    return lock;
  }
  if (reason === 'carry-target-mismatch') {
    setGestureCouplingStatus('CARRY BLOCKED · HAND ACTION MUST ADDRESS THE SAME HELD GAZE TARGET', 'blocked');
    return lock;
  }
  if (reason === 'carry-blocked') {
    setGestureCouplingStatus('CARRY BLOCKED · HOLD DELTA / DESTINATION REJECTED · LOCAL DRAFT UNCHANGED', 'blocked');
    return lock;
  }
  if (gazeReady && handReady) {
    setGestureCouplingStatus('GAZE + HAND READY · LOOK THEN PINCH / POINT / OPEN / INSPECT / GRAB / HOLD / PLACE / RELEASE / XR SELECT', 'ready');
  } else if (gazeReady) {
    setGestureCouplingStatus('GAZE READY · HAND HOST UNAVAILABLE · TOUCH / POINTER FALLBACK', 'partial');
  } else if (handReady) {
    setGestureCouplingStatus('HAND READY · LOOK FIRST TO ARM A CUBE BEFORE GRAB / HOLD / PLACE', 'partial');
  } else {
    setGestureCouplingStatus('GAZE + HAND WAITING FOR SUPPORTED HOST · LOOK THEN PINCH / GRAB', 'partial');
  }
  return lock;
}

function setGestureFocusEmpty(inputSource, gestureKind, normalized, action = 'empty-field', extra = {}) {
  if (action !== 'target-mismatch') {
    blockWorld?.setGazeLockedBlock?.(null, { reason: action });
  }
  hoveredBlock = null;
  blockWorld?.setHoveredBlock?.(null);
  gestureCubeFocusState = Object.freeze({
    source: GESTURE_CUBE_FOCUS_SOURCE,
    active: true,
    inputSource,
    gesture: gestureKind,
    action,
    targetBlockId: null,
    targetCoordinate: null,
    targetOpen: false,
    targetContainer: false,
    normalized,
    carryAction: null,
    carryDelta: null,
    holding: false,
    heldBlockId: null,
    pointProvided: extra.pointProvided !== false,
    gazeLockActive: gazeHandCouplingState.lockActive === true,
    gazeLockReason: gazeHandCouplingState.reason,
    handReusedGazePoint: extra.handReusedGazePoint === true,
    localOnly: true,
    simulation: true,
    motionOnly: true,
    cameraDrivenBlockEdits: false,
    externalNetwork: false,
    persistence: false,
    boundary: GAZE_HAND_CUBE_FOCUS_BOUNDARY,
  });
  return gestureCubeFocusState;
}

function boundedGestureCoordinate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(-1, Math.min(1, numeric));
}

/**
 * Feed only an explicitly supplied, already-sanitized host gaze/native-hand
 * point into the same local raycast path as pointer hover. This keeps phone
 * eye/finger control useful when a host has those capabilities while leaving
 * the browser fallback and canonical block state untouched. A pinch selects
 * an existing cube; deliberate native-hand open/inspect gestures may reveal
 * or inspect that cube's existing contents. Explicit native-hand Grab, Hold,
 * Place, and Release may continue only the same local held draft: Hold takes a
 * sanitized bounded grid delta and Release places at the current held cell.
 * They never infer a destination, use a camera frame, or reach external state.
 */
function applyGestureCubeFocus(gesture) {
  const inputSource = String(gesture?.inputSource ?? '').trim().toLowerCase();
  if (!['host-gaze', 'native-hand', 'xr-hand'].includes(inputSource)) return null;
  const nativeHandInput = inputSource === 'native-hand';
  const xrHandInput = inputSource === 'xr-hand';
  const nativeHandActions = ['pinch', 'open', 'inspect'];
  const nativeHandCarryActions = ['grab', 'hold', 'place', 'release'];
  const xrHandActions = ['select'];
  if (!blockWorldPresentationActive || !blockWorld) return null;
  const gestureKind = typeof gesture?.gesture === 'string' ? gesture.gesture.trim().toLowerCase() : null;
  const pointProvided = gesture?.pointProvided !== false;
  const rawPoint = pointProvided
    ? normalizeGazeHandPoint({ x: gesture?.pose?.x, y: gesture?.pose?.y })
    : null;
  const now = gestureInputNow();

  // Gaze is the only sensor sample that can arm a target. It must raycast to
  // an existing cube; hovering empty space clears the previous lock.
  if (inputSource === 'host-gaze') {
    if (!rawPoint) {
      gazeHandCouplingState = createGazeHandCouplingState({ now, reason: 'gaze-point-missing' });
      scheduleGestureCouplingExpiry();
      updateGestureCouplingStatus({ reason: 'gaze-required' });
      return setGestureFocusEmpty(inputSource, gestureKind, null, 'gaze-point-missing', { pointProvided: false });
    }
    mouse.set(rawPoint.x, rawPoint.y);
    raycaster.setFromCamera(mouse, camera);
    const hit = raycastVisibleTargets()?.object;
    const target = blockWorld.resolveTarget(hit);
    if (!target) {
      gazeHandCouplingState = createGazeHandCouplingState({ now, reason: 'gaze-empty-field' });
      scheduleGestureCouplingExpiry();
      updateGestureCouplingStatus({ reason: 'gaze-required' });
      return setGestureFocusEmpty(inputSource, gestureKind, rawPoint, 'gaze-empty-field');
    }
    gazeHandCouplingState = establishGazeHandLock({
      targetBlockId: target.id,
      targetCoordinate: target.coordinate ?? [target.x, target.y, target.z],
      normalized: rawPoint,
      now,
      ttlMs: GAZE_HAND_LOCK_TTL_MS,
    });
    blockWorld.setGazeLockedBlock?.(target.id, {
      normalized: rawPoint,
      expiresAt: gazeHandCouplingState.expiresAt,
      action: 'gaze-lock',
      reason: gazeHandCouplingState.reason,
    });
    scheduleGestureCouplingExpiry();
    hoveredBlock = target;
    blockWorld.setHoveredBlock(target.id);
    if (!portalCubeSubstrateActive) showBlockReadout(target, 'gaze-lock');
    const nextSnapshot = blockWorld.getSnapshot?.();
    const nextTarget = nextSnapshot?.draft?.blocks?.find((block) => block.id === target.id) ?? target;
    gestureCubeFocusState = Object.freeze({
      source: GESTURE_CUBE_FOCUS_SOURCE,
      couplingSource: GAZE_HAND_COUPLING_SOURCE,
      active: true,
      inputSource,
      gesture: null,
      action: 'gaze-lock',
      targetBlockId: target.id,
      targetCoordinate: Array.isArray(target.coordinate) ? [...target.coordinate] : [target.x, target.y, target.z],
      targetOpen: nextTarget.open === true,
      targetContainer: nextTarget.container === true,
      normalized: { ...rawPoint },
      pointProvided: true,
      gazeLockActive: true,
      gazeLockReason: gazeHandCouplingState.reason,
      gazeLockExpiresAt: gazeHandCouplingState.expiresAt,
      handReusedGazePoint: false,
      localOnly: true,
      simulation: true,
      motionOnly: true,
      cameraDrivenBlockEdits: false,
      externalNetwork: false,
      persistence: false,
      boundary: GAZE_HAND_CUBE_FOCUS_BOUNDARY,
    });
    updateGestureCouplingStatus({ action: 'gaze-lock' });
    return gestureCubeFocusState;
  }

  // A native hand sample is inert until a fresh gaze lock exists. The helper
  // returns the lock point when the hand host omitted coordinates; a supplied
  // point is still raycast and must resolve to the same locked block id.
  const resolution = resolveGazeHandAction({
    state: gazeHandCouplingState,
    gesture: gestureKind,
    normalized: rawPoint,
    now,
  });
  if (!resolution.allowed) {
    gazeHandCouplingState = expireGestureCouplingLock(now, resolution.reason);
    updateGestureCouplingStatus({ reason: resolution.reason });
    return setGestureFocusEmpty(inputSource, gestureKind, null, resolution.reason === 'gaze-expired' ? 'gaze-expired' : 'gaze-required', {
      pointProvided,
      handReusedGazePoint: false,
    });
  }
  const point = resolution.normalized;
  mouse.set(point.x, point.y);
  raycaster.setFromCamera(mouse, camera);
  const hit = raycastVisibleTargets()?.object;
  let target = blockWorld.resolveTarget(hit);
  // A hand sample without coordinates intentionally reuses the fresh gaze
  // point. Presentation easing, hover lift, or an opened lid can move a
  // neighbouring mesh under that pixel between frames; the already-authorized
  // lock id is therefore authoritative for the no-coordinate hand signal.
  // Explicit hand coordinates still take the strict raycast/same-target path
  // below and are rejected when they address another cube.
  if (resolution.reuseGazePoint && (!target || target.id !== resolution.targetBlockId)) {
    const snapshot = blockWorld.getSnapshot?.();
    const lockedTarget = snapshot?.draft?.blocks?.find((block) => block.id === resolution.targetBlockId)
      ?? (snapshot?.draft?.heldBlock?.id === resolution.targetBlockId ? snapshot.draft.heldBlock : null)
      ?? (snapshot?.heldBlock?.id === resolution.targetBlockId ? snapshot.heldBlock : null);
    if (lockedTarget) target = lockedTarget;
  }
  if (!target || target.id !== resolution.targetBlockId) {
    updateGestureCouplingStatus({ reason: 'target-mismatch' });
    return setGestureFocusEmpty(inputSource, gestureKind, point, 'target-mismatch', {
      pointProvided,
      handReusedGazePoint: resolution.reuseGazePoint,
    });
  }

  hoveredBlock = target;
  blockWorld.setHoveredBlock(target.id);
  if (!portalCubeSubstrateActive) showBlockReadout(target, 'gaze-hand-hover');
  let action = gestureKind === 'point' ? 'point-confirmed' : 'hover';
  let carryResult = null;
  let carryFailureReason = null;
  if (nativeHandInput && nativeHandActions.includes(gestureKind) && gestureKind === 'pinch') {
    if (now - lastGesturePinchAt >= 280) {
      lastGesturePinchAt = now;
      blockWorld.selectBlock(target.id, 'gesture-pinch');
      action = 'select';
    } else {
      action = 'debounced';
    }
  } else if (nativeHandInput && nativeHandActions.includes(gestureKind) && ['open', 'inspect'].includes(gestureKind)) {
    if (now - lastGestureActionAt < 480) {
      action = 'debounced';
    } else {
      lastGestureActionAt = now;
      blockWorld.selectBlock(target.id, `gesture-${gestureKind}`);
      if (gestureKind === 'open') {
        const opened = target.container === true && target.canOpen !== false && target.open !== true
          ? blockWorld.openBlock(true)
          : null;
        action = opened?.action === 'open'
          ? 'open'
          : target.container === true && target.open === true
            ? 'already-open'
            : 'open-unavailable';
      } else {
        const inspected = blockWorld.inspectBlock();
        action = inspected ? 'inspect' : 'inspect-unavailable';
      }
    }
  } else if (nativeHandInput && nativeHandCarryActions.includes(gestureKind)) {
    const lastCarryAt = Number(lastGestureCarryAt.get(gestureKind) ?? -Infinity);
    if (now - lastCarryAt < 320) {
      action = 'debounced';
    } else {
      const worldBefore = blockWorld.getSnapshot?.() ?? {};
      const draftBefore = worldBefore.draft ?? {};
      const heldBefore = draftBefore.heldBlock ?? worldBefore.heldBlock ?? null;
      const holdingBefore = draftBefore.holding === true || worldBefore.holding === true;
      const heldTarget = holdingBefore && heldBefore?.id === target.id;
      const needsHeld = ['hold', 'place', 'release'].includes(gestureKind);
      const holdDeltaProvided = gesture?.holdDeltaProvided === true;
      const holdDelta = gesture?.holdDelta;

      // Carry is intentionally explicit and stateful: Grab can only detach
      // the fresh gaze target, while Hold/Place/Release can only continue the
      // same local held draft. Hold never derives a grid destination from a
      // camera/hand pose; it accepts only a sanitized integer one-step delta.
      if (gestureKind === 'hold' && (!holdDeltaProvided || !holdDelta)) {
        action = 'hold-blocked';
        carryFailureReason = 'carry-blocked';
      } else if ((gestureKind === 'grab' && holdingBefore) || (needsHeld && !heldTarget)) {
        action = `${gestureKind}-blocked`;
        carryFailureReason = needsHeld && holdingBefore ? 'carry-target-mismatch' : 'carry-required';
      } else {
        lastGestureCarryAt.set(gestureKind, now);
        blockWorld.selectBlock(target.id, `gesture-${gestureKind}`);
        if (gestureKind === 'grab') carryResult = blockWorld.grabSelected?.();
        else if (gestureKind === 'hold') carryResult = blockWorld.holdSelected?.(holdDelta);
        else carryResult = blockWorld.placeHeld?.();
        if (carryResult) {
          action = gestureKind === 'release' ? 'release' : gestureKind;
        } else {
          action = `${gestureKind}-blocked`;
          carryFailureReason = 'carry-blocked';
        }
      }
    }
  } else if (xrHandInput && xrHandActions.includes(gestureKind)) {
    if (now - lastGesturePinchAt >= 280) {
      lastGesturePinchAt = now;
      blockWorld.selectBlock(target.id, 'gesture-xr-select');
      action = 'select';
    } else {
      action = 'debounced';
    }
  }
  const nextSnapshot = blockWorld.getSnapshot?.();
  const nextTarget = nextSnapshot?.draft?.blocks?.find((block) => block.id === target.id)
    ?? (nextSnapshot?.draft?.heldBlock?.id === target.id ? nextSnapshot.draft.heldBlock : null)
    ?? (carryResult?.heldBlock?.id === target.id ? carryResult.heldBlock : null)
    ?? (carryResult?.placedBlock ?? null)
    ?? target;
  // Placement assigns the existing Block World coordinate-derived id at the
  // new cell. Keep the fresh lock diagnostic pointed at that returned local
  // block so a subsequent explicit gesture cannot address the detached id.
  const effectiveTargetId = nextTarget?.id ?? target.id;
  gazeHandCouplingState = Object.freeze({
    ...gazeHandCouplingState,
    targetBlockId: effectiveTargetId,
    targetCoordinate: Array.isArray(nextTarget?.coordinate)
      ? [...nextTarget.coordinate]
      : gazeHandCouplingState.targetCoordinate,
    lastAction: action,
    now,
  });
  blockWorld.setGazeLockedBlock?.(effectiveTargetId, {
    normalized: point,
    expiresAt: gazeHandCouplingState.expiresAt,
    action,
    reason: gazeHandCouplingState.reason,
  });
  if (!portalCubeSubstrateActive) showBlockReadout(nextTarget, `gaze-hand-${action}`);
  gestureCubeFocusState = Object.freeze({
    source: GESTURE_CUBE_FOCUS_SOURCE,
    couplingSource: GAZE_HAND_COUPLING_SOURCE,
    active: true,
    inputSource,
    gesture: gestureKind,
    action,
    targetBlockId: effectiveTargetId,
    targetCoordinate: Array.isArray(nextTarget?.coordinate) ? [...nextTarget.coordinate] : [nextTarget.x, nextTarget.y, nextTarget.z],
    targetOpen: nextTarget.open === true,
    targetContainer: nextTarget.container === true,
    normalized: { ...point },
    carryAction: nativeHandCarryActions.includes(gestureKind) ? gestureKind : null,
    carryDelta: gestureKind === 'hold' ? (gesture?.holdDelta ?? null) : null,
    holding: nextSnapshot?.holding === true,
    heldBlockId: nextSnapshot?.draft?.heldBlock?.id ?? nextSnapshot?.heldBlock?.id ?? null,
    pointProvided,
    gazeLockActive: isFreshGazeHandLock(gazeHandCouplingState, now),
    gazeLockReason: gazeHandCouplingState.reason,
    gazeLockExpiresAt: gazeHandCouplingState.expiresAt,
    handReusedGazePoint: resolution.reuseGazePoint,
    localOnly: true,
    simulation: true,
    motionOnly: true,
    cameraDrivenBlockEdits: false,
    externalNetwork: false,
    persistence: false,
    boundary: GAZE_HAND_CUBE_FOCUS_BOUNDARY,
  });
  updateGestureCouplingStatus(carryFailureReason ? { reason: carryFailureReason, action } : { action });
  return gestureCubeFocusState;
}

window.__TUMBO_GESTURE_CUBE_FOCUS__ = Object.freeze({
  source: GESTURE_CUBE_FOCUS_SOURCE,
  boundary: GESTURE_CUBE_FOCUS_BOUNDARY,
  getSnapshot: () => gestureCubeFocusState,
});
window.__TUMBO_GAZE_HAND_COUPLING__ = Object.freeze({
  source: GAZE_HAND_COUPLING_SOURCE,
  lockTtlMs: GAZE_HAND_LOCK_TTL_MS,
  boundary: GAZE_HAND_CUBE_FOCUS_BOUNDARY,
  getSnapshot: () => gazeHandCouplingState,
  isFresh: () => isFreshGazeHandLock(gazeHandCouplingState, gestureInputNow()),
});
let directPointerActive = false;
let directPointerId = null;

function directPointerMatches(event) {
  if (!directPointerActive) return false;
  if (directPointerId === null || !Number.isInteger(event?.pointerId)) return true;
  return event.pointerId === directPointerId;
}

function finishDirectPointer(event, cancelled = false) {
  if (!directPointerMatches(event)) return;
  const pointerId = directPointerId;
  const input = {
    pointerId,
    pointerType: event?.pointerType,
    clientX: event?.clientX,
    clientY: event?.clientY,
    timeStamp: event?.timeStamp,
  };
  const pointerKind = directPointerKind;
  const result = pointerKind === 'world-evidence'
    ? completeWorldEvidenceManipulation(input, cancelled)
    : cancelled
      ? blockWorld?.cancelDirectManipulation('pointer-cancel')
      : blockWorld?.completeDirectManipulation(input);
  // A below-threshold pointer-up is a tap candidate. A quick second tap on
  // the same portal cube dives the camera inside it (Cube Dive Transport);
  // on another container it toggles open/close through the normal local
  // contract; a completed/rejected drag clears any pending candidate. There
  // is intentionally no native `dblclick` listener, so one gesture cannot
  // fire both a browser and renderer path.
  if (pointerKind !== 'world-evidence') {
    if (cancelled) blockWorld?.clearFieldTap?.();
    else if (result?.action === 'direct-drag-cancel') blockWorld?.registerFieldTap?.(result.blockId, input);
    else blockWorld?.clearFieldTap?.();
  }
  directPointerActive = false;
  directPointerId = null;
  directPointerKind = null;
  // A dive locks OrbitControls from its own start; don't clobber the lock.
  if (!cubeDive?.isActive()) controls.enabled = true;
  try {
    if (Number.isInteger(pointerId)) renderer.domElement.releasePointerCapture?.(pointerId);
  } catch {
    // Pointer capture may already have been released by the browser.
  }
  event?.preventDefault?.();
  event?.stopPropagation?.();
}

// Capture-phase listeners run before OrbitControls' target listeners. A cube
// drag therefore owns the pointer only for the duration of the direct local
// gesture; empty-canvas motion continues to orbit the camera normally.
renderer.domElement.addEventListener('pointerdown',event=>{
  if (personStudio?.active || realityAssembly?.active) return;
  // Cube Dive Transport owns the pointer while a dive/exit flight runs.
  if (cubeDive?.isActive()) return;
  // While a manipulate mode is armed the gizmo owns pointer drags; the
  // grid-based direct drag stays out of the way (additive, 2026-09-18).
  if (blockWorld?.getManipulateMode?.()) return;
  if (!blockWorldPresentationActive || (Number.isInteger(event.button) && event.button > 0)) return;
  updateMouseFromPointer(event);
  raycaster.setFromCamera(mouse,camera);
  const hitObject = raycastVisibleTargets()?.object;
  const sportsEvidence = sportsEvidenceLayer?.visible ? resolveSportsEvidenceTarget(hitObject) : null;
  if (sportsEvidence) {
    sportsEventsConsole?.selectRecord?.(sportsEvidence.id, 'canvas');
    event.preventDefault?.();
    event.stopPropagation?.();
    return;
  }
  const evidence = worldEvidenceLayer?.visible ? resolveWorldEvidenceTarget(hitObject) : null;
  if (evidence) {
    const startedEvidence = beginWorldEvidenceManipulation(evidence, {
      pointerId: Number.isInteger(event.pointerId) ? event.pointerId : null,
      pointerType: event.pointerType ?? 'pointer',
      clientX: event.clientX,
      clientY: event.clientY,
    });
    if (!startedEvidence) worldEventsConsole?.selectRecord?.(evidence.id, 'canvas');
    else {
      directPointerKind = 'world-evidence';
      directPointerActive = true;
      directPointerId = Number.isInteger(event.pointerId) ? event.pointerId : null;
      controls.enabled = false;
      try {
        if (Number.isInteger(directPointerId)) renderer.domElement.setPointerCapture?.(directPointerId);
      } catch {
        // Pointer capture is an enhancement; the local state machine still
        // owns the gesture when a host does not implement it.
      }
    }
    event.preventDefault?.();
    event.stopPropagation?.();
    return;
  }
  const contentTarget = blockWorld?.resolveContentTarget?.(hitObject);
  if (contentTarget) {
    blockWorld.selectContent?.(contentTarget.parentBlockId, contentTarget.contentId, event?.detail === 0 ? 'keyboard' : 'canvas', {
      pointerType: event.pointerType,
      clientX: event.clientX,
      clientY: event.clientY,
      timeStamp: event.timeStamp,
    });
    event.preventDefault?.();
    event.stopPropagation?.();
    return;
  }
  const block = blockWorld?.resolveTarget(hitObject);
  if (!block) return;
  const started = blockWorld?.beginDirectManipulation(block.id, {
    pointerId: Number.isInteger(event.pointerId) ? event.pointerId : null,
    pointerType: event.pointerType ?? 'pointer',
    clientX: event.clientX,
    clientY: event.clientY,
  });
  if (!started) return;
  directPointerKind = 'block';
  directPointerActive = true;
  directPointerId = Number.isInteger(event.pointerId) ? event.pointerId : null;
  controls.enabled = false;
  try {
    if (Number.isInteger(directPointerId)) renderer.domElement.setPointerCapture?.(directPointerId);
  } catch {
    // Pointer capture is an enhancement; the local state machine still owns
    // the gesture when a host does not implement it.
  }
  event.preventDefault?.();
  event.stopPropagation?.();
}, { capture:true });

renderer.domElement.addEventListener('pointermove',event=>{
  if (!directPointerMatches(event)) return;
  updateMouseFromPointer(event);
  if (directPointerKind === 'world-evidence') {
    updateWorldEvidenceManipulation({
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      clientX: event.clientX,
      clientY: event.clientY,
    });
  } else {
    blockWorld?.updateDirectManipulation({
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      clientX: event.clientX,
      clientY: event.clientY,
    });
  }
  event.preventDefault?.();
  event.stopPropagation?.();
}, { capture:true });

renderer.domElement.addEventListener('pointerup',event=>finishDirectPointer(event), { capture:true });
renderer.domElement.addEventListener('pointercancel',event=>finishDirectPointer(event,true), { capture:true });
// Pointer capture is supported by current browsers, but the window fallback
// keeps a drag from getting stranded when a host omits capture or the pointer
// leaves the canvas before release.
addEventListener('pointerup',event=>finishDirectPointer(event), { capture:true });
addEventListener('pointercancel',event=>finishDirectPointer(event,true), { capture:true });

addEventListener('pointerdown',event=>{
  // A click on a block selects it when no direct drag was started. Direct
  // pointer/touch drags are intercepted in the capture-phase listener above;
  // orbit gestures remain owned by OrbitControls everywhere else.
  if(event.target!==renderer.domElement)return;
  if(personStudio?.active || realityAssembly?.active)return;
  raycaster.setFromCamera(mouse,camera);
  const hitObject = raycastVisibleTargets()?.object;
  const sportsEvidence = sportsEvidenceLayer?.visible ? resolveSportsEvidenceTarget(hitObject) : null;
  if (sportsEvidence) {
    sportsEventsConsole?.selectRecord?.(sportsEvidence.id, 'canvas');
    return;
  }
  const evidence = worldEvidenceLayer?.visible ? resolveWorldEvidenceTarget(hitObject) : null;
  if (evidence) {
    worldEventsConsole?.selectRecord?.(evidence.id, 'canvas');
    return;
  }
  const contentTarget = blockWorld?.resolveContentTarget?.(hitObject);
  if (contentTarget) {
    blockWorld.selectContent?.(contentTarget.parentBlockId, contentTarget.contentId, 'canvas', {
      pointerType: event.pointerType,
      clientX: event.clientX,
      clientY: event.clientY,
      timeStamp: event.timeStamp,
    });
    return;
  }
  const block = blockWorld?.resolveTarget(hitObject);
  if (block) {
    blockWorld.selectBlock(block.id, 'canvas');
    return;
  }
  if (blockWorldPresentationActive) return;
  const room=roomSpaces.resolveTarget(hitObject);
  if(room)roomSpaces.selectRoom(room.id,'canvas');
  // Clicking empty space detaches the gizmo; the armed mode stays so the next
  // selection re-attaches (additive, 2026-09-18).
  if(blockWorld?.getManipulateMode?.())blockWorld?.detachManipulator?.('empty-space');
});
const immersiveSession = createImmersiveSession({THREE,renderer,scene,camera,controls,targets:raycastTargets,onSelect:(object)=>{
  if(realityAssembly?.active && realityAssembly.selectObject(object))return;
  if(personStudio?.active && personStudio.selectObject(object))return;
  const content=blockWorld?.resolveContentTarget?.(object);
  if(content){blockWorld.selectContent(content.parentBlockId,content.contentId,'xr');return;}
  const block=blockWorld?.resolveTarget(object);
  if(block){blockWorld.selectBlock(block.id,'xr');blockWorld.openBlock(true);return;}
  const sports=resolveSportsEvidenceTarget(object);
  if(sports){sportsEventsConsole?.selectRecord?.(sports.id,'xr');return;}
  const room=roomSpaces.resolveTarget(object);if(room)roomSpaces.selectRoom(room.id,'xr');
}});
const mediaPreview = createMediaPreview();
// Narrow viewports: one floating panel at a time; collapses the camera/audio
// preview and city dropdown when a console opens, and hides the bottom hint
// bar while a console is up. Desktop layout is untouched.
initMobilePanelManager();
// Photo mascot: the comic "You" mascot. Starts closed and materializes only
// when the MASCOT HUD button is pressed. Photos preload lazily on first open,
// never at boot; the presence is draggable with a persisted position. The
// mount never throws: without WebGL it resolves to { presence: null }.
let mascotHandle=null;
try{
  const mountMascot=mountPhotoMascot({
    scene,
    camera,
    hudRoot:document.getElementById('hud'),
    canvas:renderer.domElement,
    onOpenPanel:()=>{
      // Mobile single-panel rule: close other floating panels when the mascot opens.
      try{
        if(window.matchMedia&&window.matchMedia('(max-width:700px)').matches){
          document.querySelectorAll('aside.open, aside.visible').forEach((el)=>{
            el.classList.remove('open');
            el.classList.remove('visible');
          });
        }
      }catch{/* non-fatal */}
    },
  });
  mountMascot().then((handle)=>{mascotHandle=handle;}).catch((mountError)=>{
    // A rejected mascot mount must never surface as an unhandled rejection
    // (which the boot banner would report as a module failure). The mount
    // degrades internally; this just keeps the rejection observed.
    try{console.warn('[photo-mascot] mount degraded:', mountError?.message || mountError);}catch{/* non-fatal */}
  });
}catch{/* the mount degrades internally; this is belt-and-braces */}
if(typeof window!=='undefined'){
  window.addEventListener('beforeunload',()=>{try{mascotHandle?.unmount();}catch{/* non-fatal */}});
}
function animate(){
  const rawDt=Math.min(clock.getDelta(),.035),dt=rawDt*(reducedMotion?.22:1),t=clock.elapsedTime;
  if(realityAssembly?.active){
    realityAssembly.update(dt,t);
    if(!renderer.xr.isPresenting)controls.update();
    if(isMobile || renderer.xr.isPresenting)renderer.render(scene,camera);else composer.render();
    return;
  }
  if(personStudio?.active){
    personStudio.update(dt,t);
    if(!renderer.xr.isPresenting)controls.update();
    if(isMobile || renderer.xr.isPresenting)renderer.render(scene,camera);else composer.render();
    return;
  }
  raycaster.setFromCamera(mouse,camera); const hit=raycastVisibleTargets();
  const nextContent = blockWorldPresentationActive
    ? blockWorld?.resolveContentTarget?.(hit?.object)
    : null;
  if (nextContent) blockWorld?.setHoveredContent?.(nextContent.parentBlockId, nextContent.contentId);
  else if (blockWorldPresentationActive) blockWorld?.setHoveredContent?.(null, null);
  const nextBlock=blockWorld?.resolveTarget(hit?.object);
  const nextSportsEvidence = blockWorldPresentationActive && sportsEvidenceLayer?.visible
    ? resolveSportsEvidenceTarget(hit?.object)
    : null;
  if (nextSportsEvidence?.id !== hoveredSportsEvidence?.id) {
    hoveredSportsEvidence = nextSportsEvidence;
    if (nextSportsEvidence) showSportsEvidenceReadout(nextSportsEvidence, 'hover');
  }
  const nextWorldEvidence = blockWorldPresentationActive && worldEvidenceLayer?.visible
    ? resolveWorldEvidenceTarget(hit?.object)
    : null;
  if (nextWorldEvidence?.id !== hoveredWorldEvidence?.id) {
    hoveredWorldEvidence = nextWorldEvidence;
    if (nextWorldEvidence) showWorldEvidenceReadout(nextWorldEvidence, 'hover');
  }
  // Live World Pulse cubes carry a small, bounded pulse derived from the
  // returned title-language signal. This keeps the projection alive without
  // implying that the renderer has measured real-world severity.
  if (worldEvidenceLayer?.visible) {
    worldEvidenceMeshes.forEach((mesh) => {
      const level = Math.max(0, Math.min(3, Number(mesh.userData?.worldEvidenceBrutalityLevel) || 0));
      const base = 1 + level * 0.035;
      const pulse = !reducedMotion && level > 0 ? 1 + Math.sin(t * (1.4 + level * 0.35) + level) * 0.045 : 1;
      const openScale = mesh.userData?.worldEvidenceOpen ? 1.12 : 1;
      mesh.scale.setScalar(openScale * base * pulse);
      if (!reducedMotion && level > 1) mesh.rotation.y += dt * (0.025 + level * 0.012);
    });
  }
  if(nextBlock?.id!==hoveredBlock?.id){
    hoveredBlock=nextBlock;
    blockWorld?.setHoveredBlock(nextBlock?.id ?? null);
    if(nextBlock){
      // While a portal destination is open, the originating Portal cube owns
      // the HUD/readout. Hovering another cube is inspection-only and must not
      // replace that intentional source selection; explicit cube actions still
      // call showBlockReadout through the Block World interaction callbacks.
      if (!portalCubeSubstrateActive) showBlockReadout(nextBlock, 'hover');
      projectionBridge.emitIntent('projection.inspect-block',nextBlock.id,{blockType:nextBlock.blockType,coordinate:nextBlock.coordinate,simulation:true,localOnly:true});
    }
  }
  let nextDistribution=null;
  let nextRoom=null;
  let nextSemantic=null;
  let next=null;
  let nextPerson=null;
  if(!blockWorldPresentationActive){
    nextDistribution=distributionExplorer.resolveTarget(hit?.object);
    if(nextDistribution?.id!==hoveredDistribution?.id){
      hoveredDistribution=nextDistribution;
      if(nextDistribution){
        distributionExplorer.selectAllocation(nextDistribution.id);
        showDistributionReadout(nextDistribution);
        renderDistributionPanel(distributionExplorer.getSnapshot());
        projectionBridge.emitIntent('projection.inspect-distribution',nextDistribution.id,{recipientClass:nextDistribution.allocation?.recipientClass??null});
      }
    }
    nextRoom=roomSpaces.resolveTarget(hit?.object);
    if(nextRoom?.id!==hoveredRoom?.id){
      hoveredRoom=nextRoom;
      roomSpaces.setHoveredRoom(nextRoom?.id ?? null);
      if(nextRoom){
        showRoomReadout(nextRoom);
        projectionBridge.emitIntent('projection.inspect-room',nextRoom.id,{context:nextRoom.context,role:nextRoom.role,simulation:true,localOnly:true});
      }
    }
    nextSemantic=hit?.object?.userData?.semantic || null;
    next=nextSemantic?.organ || hit?.object?.userData?.organ || null;
    nextPerson=personOrganisms.resolvePerson(hit?.object);
    if(nextPerson!==hoveredPerson){
      const previouslyHoveredPerson=hoveredPerson;
      hoveredPerson=nextPerson;
      if(hoveredPerson){
        realityLensPersonId=hoveredPerson.id;
        showPersonReadout(hoveredPerson);
        projectionBridge.emitIntent('projection.inspect-person',hoveredPerson.id,{visualGenome:hoveredPerson.genome?.identitySeed??null});
      }else if(previouslyHoveredPerson&&!nextSemantic&&!next&&!selectedPulse&&!nextRoom){hideReadout();}
    }
    if(nextSemantic!==hoveredSemantic){
      hoveredSemantic=nextSemantic;
      if(hoveredSemantic){hoveredSemantic.organ.targetAwake=1;showSemanticReadout(hoveredSemantic);projectionBridge.emitIntent('projection.inspect-semantic',hoveredSemantic.organ.id,{semantic:hoveredSemantic.def.label})}
      else if(next) showReadout(next);
    }
    if(next!==hovered){ if(hovered && hovered!==selectedPulse)hovered.targetAwake=0; hovered=next; if(hovered){hovered.targetAwake=1;if(!hoveredSemantic&&!nextRoom)showReadout(hovered)} else if(!selectedPulse&&!nextPerson&&!nextDistribution&&!nextRoom){hoveredSemantic=null;hideReadout();} }
  } else {
    // Invisible canonical layers are not interactive while the cube workspace
    // is active; only block hover/select/open/move behavior remains live.
    hoveredDistribution=null;
    hoveredRoom=null;
    hoveredPerson=null;
    hoveredSemantic=null;
    hovered=null;
    selectedPulse=null;
  }
  // Proximity itself can wake an object, no pointer required.
  let prox=null,proxD=999; if(!blockWorldPresentationActive)organs.forEach(o=>{const p=new THREE.Vector3();o.root.getWorldPosition(p);const d=p.distanceTo(camera.position);if(d<6.2&&d<proxD){prox=o;proxD=d}});
  organs.forEach(o=>{if(o!==hovered&&o!==selectedPulse&&o!==prox)o.targetAwake=0;if(o===prox)o.targetAwake=Math.max(o.targetAwake,.72);o.awake=THREE.MathUtils.damp(o.awake,o.targetAwake,6,dt);o.t+=dt;o.update?.(dt,t);updateSemanticObjects(o,dt,t);});
  personOrganisms.update(dt,t,{mode:realityLensMode,selectedId:realityLensPersonId,hoveredId:hoveredPerson?.id,reducedMotion});
  distributionExplorer.update(dt,t,{hoveredId:hoveredDistribution?.id??null,reducedMotion});
  roomSpaces.update(dt,t,{hoveredId:hoveredRoom?.id??null,reducedMotion});
  blockWorld?.update(dt,t,{
    hoveredId:hoveredBlock?.id??null,
    cameraPosition:{x:camera.position.x,y:camera.position.y,z:camera.position.z},
    proximityRadius:14,
    reducedMotion,
  });
  if(prox && !hovered && !selectedPulse && !hoveredSemantic&&!hoveredPerson&&!hoveredDistribution&&!hoveredRoom)showReadout(prox);
  // Cube Dive Transport drives the camera itself while a flight is active.
  // The generic tweens below are zeroed when a dive starts, so they never
  // fight the flight.
  cubeDive?.update(dt);
  if(!renderer.xr.isPresenting && cameraTween>0){cameraTween=Math.max(0,cameraTween-dt*1.5);controls.target.lerp(desiredTarget,1-Math.pow(.001,dt));}
  if(!renderer.xr.isPresenting && cameraPositionTween>0){cameraPositionTween=Math.max(0,cameraPositionTween-dt*1.5);camera.position.lerp(desiredCameraPosition,1-Math.pow(.001,dt));}
  if(!renderer.xr.isPresenting && (cameraInput?.getSnapshot().active || gestureInput?.getSnapshot?.().active) && cameraMotion.magnitude>0.001){
    cameraMotionOffset.copy(camera.position).sub(controls.target);
    cameraMotionSpherical.setFromVector3(cameraMotionOffset);
    cameraMotionSpherical.theta-=cameraMotion.dx*dt*1.8;
    cameraMotionSpherical.phi=THREE.MathUtils.clamp(cameraMotionSpherical.phi+cameraMotion.dy*dt*1.05,.28,Math.PI-.28);
    cameraMotionOffset.setFromSpherical(cameraMotionSpherical);
    camera.position.copy(controls.target).add(cameraMotionOffset);
    cameraMotion={
      dx:THREE.MathUtils.damp(cameraMotion.dx,0,5,dt),
      dy:THREE.MathUtils.damp(cameraMotion.dy,0,5,dt),
      magnitude:THREE.MathUtils.damp(cameraMotion.magnitude,0,5,dt),
    };
  }
  if(!renderer.xr.isPresenting)controls.update();
  if(isMobile || renderer.xr.isPresenting) renderer.render(scene,camera); else composer.render();
}
personStudio=createPersonStudio({THREE,renderer,scene,camera,controls,world,targets:raycastTargets,reducedMotion,
  onNavigate:(id)=>{featureNavigator.select(id,'button');featureNavigator.close();},
  onFrame:()=>{cameraTween=0;cameraPositionTween=0;},
  onIntent:(type,detail)=>projectionBridge.emitIntent(type,'person-studio',detail),
});
window.__TUMBO_PERSON_STUDIO__=personStudio;
realityAssembly=createRealityAssembly({THREE,renderer,scene,camera,controls,world,targets:raycastTargets,features:FEATURE_DEFINITIONS,reducedMotion,environmentTexture:personStudio.getEnvironmentTexture(),
  onNavigate:(id)=>{featureNavigator.select(id,'button');featureNavigator.close();},
  onFrame:()=>{cameraTween=0;cameraPositionTween=0;},
  readFeature:(id)=>{
    if(id==='person'){const state=personStudio.getSnapshot();return {summary:state.approved?'Approved local avatar and saved wardrobe are connected. No cloud account is implied.':'Reference-built local avatar is available for explicit approval.'};}
    if(id==='multi-sport-events'){const state=multiSportEventsConsole?.getSnapshot();return {summary:state?.summary?.records?.length?`${state.summary.records.length} public records currently loaded. Open Sports for timestamps and source evidence.`:'No public sports records loaded in this session. Open Sports and explicitly refresh a provider.'};}
    if(id==='world-events'){const state=worldEventsConsole?.getSnapshot();return {summary:state?.summary?.records?.length?`${state.summary.records.length} provider observations loaded; inspect their provenance in World Pulse.`:'Open World Pulse to request current source observations. The designed city geometry is not a real-world measurement.'};}
    return {summary:'This cube points to the existing feature owner. Inspect that feature for its local state, capability gates and provider evidence.'};
  },
});
window.__TUMBO_REALITY_ASSEMBLY__=realityAssembly;
document.addEventListener('person-studio:enter-vr',()=>immersiveSession.start('immersive-vr'));
if(featureNavigator.getSnapshot().activeId==='person'&&!new URLSearchParams(location.search).has('person'))personStudio.open();
if(featureNavigator.getSnapshot().activeId==='reality-lens')realityAssembly.open();
renderer.setAnimationLoop(animate);
// URL-derived City navigation reuses the existing feature owner and avoids provider refresh.
const cityJourney=mountCityJourney({navigate:(id,method)=>{featureNavigator.select(id,method||'popstate');featureNavigator.close();}});
runtimeStatus?.markReady?.({ featureCount:featureNavigator?.getSnapshot?.().featureCount ?? 23 });
mountCenteredSurfaces();

addEventListener('pagehide',()=>{
  cameraInput?.destroy();
  gestureInput?.destroy();
  mediaPreview.destroy();
  immersiveSession.destroy();
  personStudio.destroy();
  realityAssembly.destroy();
  cityJourney.destroy();
},{once:true});

addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setPixelRatio(isMobile?1:Math.min(devicePixelRatio,1.5));renderer.setSize(innerWidth,innerHeight);if(!isMobile)composer.setSize(innerWidth,innerHeight);});
