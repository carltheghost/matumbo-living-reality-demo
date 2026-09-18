/**
 * White Paper — read-only living-document aggregator.
 *
 * This module owns no state and never writes. It reads the typed projection
 * contributions already assembled in a SIMFABRIC envelope (the same envelope
 * the 3D world renders) plus the navigator's feature registry, and composes
 * them into a deterministic document object: frozen vision text, live
 * sections, frozen boundaries.
 *
 * Missing or malformed contributions never break composition: the affected
 * section renders as "not yet live" instead.
 */

export const WHITE_PAPER_SOURCE = "white-paper-document";
export const WHITE_PAPER_CONSOLE_SOURCE = "white-paper-console";
export const WHITE_PAPER_SCHEMA_VERSION = 1;
export const WHITE_PAPER_UPDATED_AT = "2026-09-18T00:00:00.000Z";

export const WHITE_PAPER_BOUNDARY =
  "The white paper is a read-only document. It never changes system state; feature rows navigate only. No wallet, chain, custody, mainnet, real money, wagering, network fetch, or external execution exists here.";

export const WHITE_PAPER_VISION =
  "maTumbo Living Reality is a single local runtime that turns abstract systems — contracts, ledgers, rooms, identities, markets — into navigable space. The 3D world is a projection of local state: everything visible is computed on this machine, from this machine's data. This paper is the same living system rendered as a readable document instead of 3D: every number and status below is composed from the same typed projection contributions the 3D world uses. No separate data source, no forked truth. Don't display information. Materialize it.";

export const WHITE_PAPER_BOUNDARIES = Object.freeze([
  "Local simulation only. Nothing here is a wallet, a chain, custody, or settlement.",
  "No real money, no wagering, no mainnet. Rehearsal credits are fictional and zero-valued.",
  "Luna runs on a deterministic local grammar — no cloud AI, no network.",
  "The camera layer processes video on-device only. Camera off by default; no recording, no upload.",
  "The 3D world is a projection. It is never authority over money, identity, or agreements.",
  "Reality Lens Ω is the system-scale semantic zoom.",
]);

export const WHITE_PAPER_SECTIONS = Object.freeze([
  Object.freeze({ id: "vision", title: "What this is", kind: "frozen" }),
  Object.freeze({ id: "features", title: "Live feature registry", kind: "live" }),
  Object.freeze({ id: "neural-mesh", title: "Neural mesh now", kind: "live" }),
  Object.freeze({ id: "contracts-ledger", title: "Contracts & ledger now", kind: "live" }),
  Object.freeze({ id: "rooms-people", title: "Rooms & people now", kind: "live" }),
  Object.freeze({ id: "boundaries", title: "Hard boundaries", kind: "frozen" }),
]);

const NOT_YET_LIVE = "not yet live";

const freeze = (value) => {
  if (Array.isArray(value)) value.forEach(freeze);
  else if (value && typeof value === "object") Object.values(value).forEach(freeze);
  return value && typeof value === "object" ? Object.freeze(value) : value;
};

const asArray = (value) => (Array.isArray(value) ? value : []);

const contributionBySource = (envelope) => {
  const map = new Map();
  const contributions = asArray(envelope?.world?.contributions);
  for (const contribution of contributions) {
    if (contribution && typeof contribution.source === "string" && !map.has(contribution.source)) {
      map.set(contribution.source, contribution);
    }
  }
  return map;
};

const liveSection = (id, title, body) =>
  freeze({ id, title, kind: "live", status: "live", ...body });

const notYetLiveSection = (id, title, note) =>
  freeze({ id, title, kind: "live", status: NOT_YET_LIVE, asOf: null, note });

function summarizeFeatures(features) {
  const list = asArray(features)
    .filter((feature) => feature && typeof feature.id === "string")
    .map((feature) => freeze({
      id: feature.id,
      label: String(feature.label ?? feature.id),
      kicker: String(feature.kicker ?? ""),
      description: String(feature.description ?? ""),
      boundary: String(feature.boundary ?? ""),
    }));
  if (!list.length) return null;
  return { count: list.length, features: list };
}

function summarizeNeuralMesh(contribution) {
  if (!contribution) return null;
  const entities = asArray(contribution.entities);
  const ofKind = (kind) => entities.filter((entity) => entity?.kind === kind);
  const agents = ofKind("advisory-agent").map((agent) => freeze({
    id: String(agent.id ?? "agent:unknown"),
    label: String(agent.label ?? agent.id ?? "agent"),
    role: String(agent.role ?? "advisory"),
  }));
  return {
    asOf: contribution.updatedAt ?? null,
    agents,
    intentCount: ofKind("advisory-intent").length,
    proposalCount: ofKind("advisory-proposal").length,
    relationshipCount: ofKind("agent-relationship").length,
    ancestryCount: ofKind("agent-ancestry").length,
  };
}

function summarizeContractsLedger(contractAtelier, ledgerProof) {
  if (!contractAtelier && !ledgerProof) return null;
  const contracts = contractAtelier
    ? {
        asOf: contractAtelier.updatedAt ?? null,
        open: asArray(contractAtelier.entities).filter((entity) => entity?.status === "open").length,
        resolved: asArray(contractAtelier.entities).filter((entity) => entity?.status === "resolved").length,
        contracts: asArray(contractAtelier.entities).map((entity) => freeze({
          id: String(entity.id ?? "contract:unknown"),
          title: String(entity.label ?? entity.id ?? "contract"),
          type: String(entity.marketType ?? "binary"),
          role: String(entity.role ?? "player"),
          topic: String(entity.topic ?? "custom"),
          status: String(entity.status ?? "open"),
        })),
      }
    : null;
  const ledger = ledgerProof
    ? {
        asOf: ledgerProof.updatedAt ?? null,
        records: asArray(ledgerProof.entities)
          .filter((entity) => entity?.kind === "balanced-record-summary")
          .map((entity) => freeze({
            id: String(entity.id ?? "ledger:unknown"),
            label: String(entity.label ?? entity.id ?? "record"),
            unit: String(entity.unit ?? "TUMBO-SIM"),
            status: String(entity.status ?? "unknown"),
          })),
        proofCount: asArray(ledgerProof.entities).filter((entity) => entity?.kind === "proof-summary").length,
        authoritative: false,
      }
    : null;
  return { contracts, ledger };
}

function summarizeRoomsPeople(rooms, profile) {
  if (!rooms && !profile) return null;
  const roomList = rooms
    ? asArray(rooms.entities)
      .filter((entity) => entity?.kind === "spatial-room")
      .map((entity) => freeze({
        id: String(entity.id ?? "room:unknown"),
        label: String(entity.label ?? entity.id ?? "room"),
        context: String(entity.context ?? "private"),
      }))
    : [];
  const membershipCount = rooms
    ? asArray(rooms.entities).filter((entity) => entity?.kind === "room-membership").length
    : 0;
  const person = profile
    ? freeze({
        source: String(profile.source ?? "person-profile"),
        asOf: profile.updatedAt ?? null,
        entityCount: asArray(profile.entities).length,
      })
    : null;
  return {
    asOf: rooms?.updatedAt ?? null,
    rooms: roomList,
    membershipCount,
    person,
  };
}

/**
 * Compose the living document from a projection envelope and the navigator's
 * feature registry. Pure, deterministic, deeply frozen. Never throws on
 * missing input — absent contributions become "not yet live" sections.
 */
export function createWhitePaperDocument({ envelope = null, features = [] } = {}) {
  const bySource = contributionBySource(envelope);
  const projectedAt = typeof envelope?.projectedAt === "string" ? envelope.projectedAt : null;

  const featureSummary = summarizeFeatures(features);
  const meshSummary = summarizeNeuralMesh(bySource.get("skynet-neural-mesh"));
  const contractsLedger = summarizeContractsLedger(
    bySource.get("contract-atelier"),
    bySource.get("prime-ledger-echoproof"),
  );
  const roomsPeople = summarizeRoomsPeople(
    bySource.get("spatial-rooms"),
    bySource.get("person-profile"),
  );

  const sections = [
    freeze({ id: "vision", title: "What this is", kind: "frozen", body: WHITE_PAPER_VISION }),
    featureSummary
      ? liveSection("features", "Live feature registry", featureSummary)
      : notYetLiveSection("features", "Live feature registry", "The feature registry is not attached in this context."),
    meshSummary
      ? liveSection("neural-mesh", "Neural mesh now", meshSummary)
      : notYetLiveSection("neural-mesh", "Neural mesh now", "The neural-mesh contribution is not present in this projection."),
    contractsLedger
      ? liveSection("contracts-ledger", "Contracts & ledger now", contractsLedger)
      : notYetLiveSection("contracts-ledger", "Contracts & ledger now", "Contract and ledger contributions are not present in this projection."),
    roomsPeople
      ? liveSection("rooms-people", "Rooms & people now", roomsPeople)
      : notYetLiveSection("rooms-people", "Rooms & people now", "Room and profile contributions are not present in this projection."),
    freeze({ id: "boundaries", title: "Hard boundaries", kind: "frozen", items: WHITE_PAPER_BOUNDARIES }),
  ];

  const liveCount = sections.filter((section) => section.status === "live").length;

  return freeze({
    schemaVersion: WHITE_PAPER_SCHEMA_VERSION,
    source: WHITE_PAPER_SOURCE,
    simulation: true,
    localOnly: true,
    generatedFrom: freeze({
      projectedAt,
      sources: freeze([...bySource.keys()].sort()),
    }),
    sectionCount: sections.length,
    liveSectionCount: liveCount,
    sections,
    boundary: WHITE_PAPER_BOUNDARY,
  });
}

/**
 * The white paper's own projection contribution: document section metadata
 * only — never the composed text. Lets the 3D inventory and Mission Control
 * see the paper as a first-class surface without forking its content.
 */
export function createWhitePaperContribution({ updatedAt = WHITE_PAPER_UPDATED_AT } = {}) {
  return freeze({
    schemaVersion: WHITE_PAPER_SCHEMA_VERSION,
    source: WHITE_PAPER_SOURCE,
    simulation: true,
    updatedAt,
    entities: WHITE_PAPER_SECTIONS.map((section) => freeze({
      id: `white-paper-section:${section.id}`,
      kind: "document-section",
      label: section.title,
      sectionKind: section.kind,
      simulation: true,
    })),
    evidence: freeze([
      freeze({
        id: "white-paper:read-only",
        kind: "document-boundary",
        note: "Read-only aggregation over sibling contributions; owns no state.",
      }),
    ]),
    capabilities: freeze([
      freeze({ id: "white-paper.read", mode: "document", authority: "none", executable: false }),
    ]),
    boundary: WHITE_PAPER_BOUNDARY,
  });
}

export default createWhitePaperDocument;
