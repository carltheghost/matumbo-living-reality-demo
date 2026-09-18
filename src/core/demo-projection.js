import { createProjectionEnvelope } from "./view-state.js";
import { createCipherContribution } from "../domains/cipher.js";
import { createContractsMarketsContribution } from "../domains/contracts-markets.js";
import { createAssetTokenContribution } from "../domains/asset-token.js";
import { createLaunchDistributionPreview } from "../domains/distribution-registry.js";
import { createLedgerProofContribution } from "../domains/ledger-proof.js";
import { createLiveGatewayContribution } from "../domains/live-gateway.js";
import { createMatterForgeContribution } from "../domains/matter-forge.js";
import { createNeuralMeshContribution } from "../domains/neural-mesh.js";
import { createPaycoreContribution } from "../domains/paycore.js";
import { profileProjection } from "../domains/profile.js";
import { createRoomsContribution } from "../domains/rooms.js";
import { createSocialExplorerContribution } from "../domains/social-explorer.js";
import { createT402Contribution } from "../domains/t402.js";
import { createBlockWorldContribution } from "../domains/block-world.js";
import { createBlockMigrationManifest } from "../domains/block-migration.js";
import { createArenaGamesContribution } from "../domains/arena-games.js";
import { createAcademyContribution } from "../domains/academy.js";
import { createNftAtelierContribution } from "../domains/nft-atelier.js";
import { createMuseAgentContribution } from "../domains/muse-agent.js";
import { createContractAtelierContribution } from "../domains/contract-atelier.js";
import { createLunaCompanionContribution } from "../domains/luna-companion.js";
import { createWardrobeAtelierContribution } from "../domains/wardrobe-atelier.js";
import { createWhitePaperContribution } from "../domains/white-paper.js";
import { createGestureLensContribution } from "../domains/gesture-lens.js";

export const LIVING_REALITY_SAMPLE_TIME = "2025-01-01T00:00:00.000Z";

const provenance = (source, note) => ({
  source,
  timestamp: LIVING_REALITY_SAMPLE_TIME,
  uncertainty: 0.2,
  degraded: false,
  note,
});

/**
 * Compose every role-owned contribution into one deterministic local world.
 * This is the Control 1 integration seam: domains retain ownership of their
 * own records while SIMFABRIC owns ordering, replay, and renderer projection.
 */
export function createLivingRealityProjection({ projectedAt = LIVING_REALITY_SAMPLE_TIME } = {}) {
  const rooms = createRoomsContribution({
    updatedAt: projectedAt,
    viewerId: "profile:local-participant",
    rooms: [
      { id: "room:reality", label: "Living Reality Chamber", context: "private" },
      { id: "room:market", label: "Market Observatory", context: "market" },
    ],
    memberships: [
      { id: "membership:reality", roomId: "room:reality", memberId: "profile:local-participant", role: "owner" },
      { id: "membership:market", roomId: "room:market", memberId: "profile:local-participant", role: "observer" },
    ],
  });

  const cipher = createCipherContribution({
    updatedAt: projectedAt,
    sessions: [{ id: "cipher:session", indicator: "protected", participantCount: 2 }],
    messageEvents: [{ id: "cipher:event", sessionId: "cipher:session", eventKind: "delivered", occurredAt: projectedAt }],
    revocations: [{ id: "cipher:revocation", sessionId: "cipher:session", state: "active", changedAt: projectedAt }],
  });

  const paycore = createPaycoreContribution({
    updatedAt: projectedAt,
    balances: [
      { id: "paycore:local", label: "Local Participant", unit: "TUMBO-SIM", amount: 120 },
      { id: "paycore:pool", label: "Simulation Pool", unit: "TUMBO-SIM", amount: 500 },
    ],
    flows: [{ id: "paycore:preview-flow", fromBalanceId: "paycore:local", toBalanceId: "paycore:pool", amount: 12 }],
  });

  // TUMBO is represented as one deterministic, simulation-only asset-token
  // contribution.  It is projection metadata for the browser explorer; it
  // does not issue, custody, sign, settle, price, or transfer anything.
  const assetToken = createAssetTokenContribution({
    updatedAt: projectedAt,
  });

  // The recipient registry is a separate, deterministic projection source.
  // It expands the fixed asset-token schedule into aggregate fictional rows
  // for the launch console without creating recipient addresses or execution
  // authority.  Keeping this as its own contribution lets the renderer join
  // it by source while preserving one canonical schedule in the domain.
  const distributionRegistry = createLaunchDistributionPreview({
    updatedAt: projectedAt,
  });

  // The social explorer is a deterministic catalog layered on top of the
  // same launch story. It contributes fictional rooms, creator/community
  // cards, discovery signals, and frozen local rehearsal intents; it does not
  // introduce a second token schedule or any external recipient authority.
  const socialExplorer = createSocialExplorerContribution({
    updatedAt: projectedAt,
  });

  // The block-world layer is a semantic voxel projection over the same
  // canonical envelope. It is deliberately a local fixture: its renderer may
  // edit a draft, but the contribution never grants persistence or external
  // build authority.
  const blockWorld = createBlockWorldContribution({
    updatedAt: projectedAt,
  });

  // The migration bridge is a fixed, data-only manifest of concepts from the
  // earlier Arena / Living Reality prototypes. It gives the browser a safe
  // preview seam without reading files, executing imported code, or mutating
  // the canonical block projection.
  const blockMigration = createBlockMigrationManifest({
    updatedAt: projectedAt,
  });

  // ARENA is a first-class local game-lab contribution rather than an
  // organ-only label. Its deterministic modes and frozen starting sessions
  // are projected into the same envelope so Mission Control can open and
  // rehearse them without introducing a network or reward authority.
  const arenaGames = createArenaGamesContribution({
    updatedAt: projectedAt,
  });

  // Academy restores the connected product's guided learning path as a
  // first-class projection contribution. Answers and demo XP remain owned by
  // the page-session console; the canonical contribution is the fixed path.
  const academy = createAcademyContribution({ updatedAt: projectedAt });
  const nftAtelier = createNftAtelierContribution({ updatedAt: projectedAt });
  const museAgent = createMuseAgentContribution({ updatedAt: projectedAt });
  const contractAtelier = createContractAtelierContribution({ updatedAt: projectedAt });
  const lunaCompanion = createLunaCompanionContribution({ updatedAt: projectedAt });
  const wardrobeAtelier = createWardrobeAtelierContribution({ updatedAt: projectedAt });
  // White paper: document-section metadata only, never composed text. The
  // living document is composed read-only from the envelope at render time.
  const whitePaper = createWhitePaperContribution({ updatedAt: projectedAt });
  // Gesture Lens: pose/intent schema metadata only — the console is a local
  // rehearsal surface and the projection records only its vocabulary.
  const gestureLens = createGestureLensContribution({ updatedAt: projectedAt });

  const contracts = createContractsMarketsContribution({
    updatedAt: projectedAt,
    contracts: [{ id: "contract:demo", label: "Covenant rehearsal", state: "simulated" }],
    pools: [{ id: "pool:demo", label: "Reality Pool", unit: "TUMBO-SIM", simulatedLiquidity: 1000 }],
    collateral: [{ id: "collateral:demo", poolId: "pool:demo", simulatedValue: 80 }],
    positions: [{ id: "position:demo", contractId: "contract:demo", poolId: "pool:demo", collateralId: "collateral:demo", side: "long", simulatedExposure: 50 }],
  });

  const ledger = createLedgerProofContribution({
    updatedAt: projectedAt,
    ledgerRecords: [{
      id: "ledger:demo",
      label: "Local rehearsal journal",
      unit: "TUMBO-SIM",
      entries: [
        { account: "simulation-source", side: "debit", amount: 12 },
        { account: "simulation-pool", side: "credit", amount: 12 },
      ],
    }],
    proofs: [
      { id: "proof:root", label: "Declared local root", parentIds: [] },
      { id: "proof:projection", label: "Projection receipt", parentIds: ["proof:root"] },
    ],
  });

  const t402 = createT402Contribution({
    updatedAt: projectedAt,
    offers: [{ id: "offer:demo", label: "Compute rehearsal", unit: "TUMBO-SIM", simulatedAmount: 4, state: "open" }],
    routes: [{ id: "route:demo", offerId: "offer:demo", from: "profile:local-participant", to: "room:reality" }],
    escrowRehearsals: [{ id: "escrow:demo", routeId: "route:demo", state: "simulated-held" }],
    liveMovementRequests: [{ id: "live-denial:demo", action: "settle" }],
  });

  const neuralMesh = createNeuralMeshContribution({
    updatedAt: projectedAt,
    agents: [
      { id: "agent:control", label: "Control Tower", role: "coordination" },
      { id: "agent:oracle", label: "Oracle", role: "mock evidence" },
    ],
    intents: [{ id: "intent:inspect", agentId: "agent:control", summary: "Inspect the local world projection" }],
    proposals: [{ id: "proposal:inspect", agentId: "agent:control", intentId: "intent:inspect", summary: "Show projection provenance", status: "proposed" }],
    relationships: [{ id: "relation:control-oracle", relationship: "observes", fromAgentId: "agent:control", toAgentId: "agent:oracle" }],
    ancestry: [{ id: "ancestry:oracle", ancestorAgentId: "agent:control", descendantAgentId: "agent:oracle", basis: "declared local role map" }],
  });

  const matterForge = createMatterForgeContribution({
    updatedAt: projectedAt,
    inputs: [{
      id: "matter:word:reality",
      kind: "word-object",
      word: "reality",
      organId: "organ:reality-view",
      provenance: provenance("local-fixture", "Semantic fixture for the renderer"),
    }],
    statements: [{
      id: "statement:reality",
      kind: "interpretation",
      inputId: "matter:word:reality",
      text: "A local projection can make meaning spatial without claiming final truth.",
      provenance: provenance("local-fixture", "Interpretive statement, not a fact claim"),
    }],
  });

  const gateway = createLiveGatewayContribution({
    updatedAt: projectedAt,
    evidence: [{
      id: "gateway:evidence:demo",
      subject: "organ:reality-view",
      source: "DEMO_PROVIDER_BOUNDARY",
      timestamp: projectedAt,
      uncertainty: 0.35,
    }],
    interpretations: [{
      id: "gateway:interpretation:demo",
      statement: "The local demo evidence is available but not authoritative.",
      evidenceIds: ["gateway:evidence:demo"],
    }],
  });

  return createProjectionEnvelope({
    projectedAt,
    contributions: [
      profileProjection,
      rooms,
      cipher,
      paycore,
      assetToken,
      distributionRegistry,
      socialExplorer,
      blockWorld,
      blockMigration,
      arenaGames,
      academy,
      nftAtelier,
      museAgent,
      contractAtelier,
      lunaCompanion,
      wardrobeAtelier,
      whitePaper,
      gestureLens,
      contracts,
      ledger,
      t402,
      neuralMesh,
      matterForge,
      gateway,
    ],
  });
}

export const SAMPLE_LIVING_REALITY_PROJECTION = createLivingRealityProjection();
