import { stableHash } from "../domains/surface-semantic-field.js";

export const UNIVERSAL_ENTITY_SCHEMA = "matumbo.universal-entity";
export const UNIVERSAL_ENTITY_VERSION = 1;

export const ENTITY_KINDS = Object.freeze([
  "contract",
  "slip",
  "contractor",
  "person",
  "pool",
  "position",
  "proof",
  "ledger",
  "room",
  "message",
  "bot",
  "treasury",
  "market",
  "event",
  "artifact",
  "token",
  "gateway",
  "media",
  "generic",
]);

export const GEOMETRY_FAMILIES = Object.freeze([
  "contract-shell",
  "slip-capsule",
  "person-vessel",
  "pool-ring",
  "position-spire",
  "proof-crystal",
  "ledger-block",
  "room-shell",
  "message-fold",
  "bot-orb",
  "treasury-vault",
  "market-ring",
  "event-orb",
  "artifact-stone",
  "token-coin",
  "gateway-ring",
  "media-orb",
  "generic-body",
]);

const FEATURE_KIND = Object.freeze({
  "contracts": "contract",
  "contract-atelier": "contract",
  "paycore": "ledger",
  "ledger": "ledger",
  "t402": "gateway",
  "asset-token": "token",
  "asset-market": "market",
  "launch-distribution": "event",
  "person": "person",
  "rooms": "room",
  "social-explorer": "room",
  "social-mirror": "media",
  "youtube": "media",
  "agent": "bot",
  "neural-mesh": "bot",
  "muse-agent": "bot",
  "bot-plaza": "bot",
  "luna-companion": "person",
  "picture-matter": "artifact",
  "nft-atelier": "artifact",
  "wardrobe-atelier": "artifact",
  "white-paper": "artifact",
  "gesture-lens": "artifact",
  "gateway": "gateway",
  "world-events": "event",
  "sports-events": "event",
  "multi-sport-events": "event",
  "arena": "event",
  "chess": "event",
  "web-ai": "bot",
  "academy": "artifact",
  "projections": "gateway",
  "reality-lens": "gateway",
  "block-world": "artifact",
  "runtime-sync": "gateway",
  "migration": "gateway",
});

const GROUP_KIND = Object.freeze({
  system: "artifact",
  identity: "person",
  social: "room",
  media: "media",
  simulation: "contract",
  creative: "artifact",
  intelligence: "bot",
  knowledge: "artifact",
  interface: "gateway",
  world: "event",
  sport: "event",
  play: "event",
});

const KIND_GEOMETRY = Object.freeze({
  contract: "contract-shell",
  slip: "slip-capsule",
  contractor: "person-vessel",
  person: "person-vessel",
  pool: "pool-ring",
  position: "position-spire",
  proof: "proof-crystal",
  ledger: "ledger-block",
  room: "room-shell",
  message: "message-fold",
  bot: "bot-orb",
  treasury: "treasury-vault",
  market: "market-ring",
  event: "event-orb",
  artifact: "artifact-stone",
  token: "token-coin",
  gateway: "gateway-ring",
  media: "media-orb",
  generic: "generic-body",
});

const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) freeze(item);
  return Object.freeze(value);
}

function deterministic01(seed) {
  return stableHash(String(seed)) / 0xffffffff;
}

function safeScalar(value, fallback = "") {
  return value == null ? fallback : typeof value === "object" ? JSON.stringify(value) : String(value);
}

function normalizeMetrics(metrics = {}) {
  const result = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
    else if (typeof value === "string" || typeof value === "boolean") result[key] = value;
  }
  return result;
}

function normalizeRelations(relations = []) {
  return [...new Set((Array.isArray(relations) ? relations : []).map(String).filter(Boolean))].slice(0, 16);
}

function defaultStateForKind(kind) {
  if (kind === "contract") return "draft";
  if (kind === "slip") return "attached";
  if (kind === "proof") return "verified";
  if (kind === "ledger") return "balanced";
  if (kind === "pool") return "open";
  if (kind === "bot") return "advisory";
  if (kind === "event") return "observed";
  return "live";
}

export function geometryFamilyForKind(kind) {
  const resolved = ENTITY_KINDS.includes(kind) ? kind : "generic";
  return KIND_GEOMETRY[resolved] ?? KIND_GEOMETRY.generic;
}

export function inferEntityKind(input = {}) {
  const explicit = String(input.kind ?? input.type ?? "").toLowerCase();
  if (ENTITY_KINDS.includes(explicit)) return explicit;
  const featureId = String(input.featureId ?? input.id ?? "").toLowerCase();
  if (FEATURE_KIND[featureId]) return FEATURE_KIND[featureId];
  const group = String(input.group ?? "").toLowerCase();
  return GROUP_KIND[group] ?? "generic";
}

export function normalizeUniversalEntity(input = {}) {
  const kind = inferEntityKind(input);
  const id = String(input.id ?? `${kind}-entity`);
  const title = String(input.title ?? input.label ?? id);
  const status = String(input.status ?? defaultStateForKind(kind));
  const geometryFamily = GEOMETRY_FAMILIES.includes(input.geometryFamily)
    ? input.geometryFamily
    : geometryFamilyForKind(kind);

  const entity = {
    schema: UNIVERSAL_ENTITY_SCHEMA,
    version: UNIVERSAL_ENTITY_VERSION,
    id,
    kind,
    title,
    summary: String(input.summary ?? input.description ?? ""),
    status,
    geometryFamily,
    priority: clamp(input.priority ?? .72),
    metrics: normalizeMetrics(input.metrics),
    relations: normalizeRelations(input.relations),
    actions: Array.isArray(input.actions) ? input.actions.map(String).slice(0, 8) : ["inspect"],
    provenance: Array.isArray(input.provenance) ? input.provenance.map(String).slice(0, 16) : [],
    accent: input.accent ?? null,
    source: input.source ?? null,
    content: Array.isArray(input.content) ? input.content.map(block => ({ ...block })) : [],
    interactionState: {
      selected: Boolean(input.interactionState?.selected),
      focused: Boolean(input.interactionState?.focused),
      expanded: Boolean(input.interactionState?.expanded),
      alert: Boolean(input.interactionState?.alert),
      sleeping: Boolean(input.interactionState?.sleeping),
    },
  };

  return freeze(entity);
}

export function entitySemanticContent(entityInput) {
  const entity = normalizeUniversalEntity(entityInput);
  const metrics = Object.entries(entity.metrics).slice(0, 3);
  const relations = entity.relations.slice(0, 4);

  const blocks = [
    {
      id: "identity",
      label: entity.kind.toUpperCase(),
      value: entity.title,
      priority: 1,
      kind: "identity",
      state: entity.status,
      action: entity.actions[0] ?? "inspect",
      provenance: entity.provenance,
    },
    {
      id: "state",
      label: "STATE",
      value: entity.status,
      priority: .92,
      kind: "state",
      state: entity.status,
      action: "focus",
      provenance: entity.provenance,
    },
  ];

  metrics.forEach(([key, value], index) => {
    blocks.push({
      id: `metric-${index + 1}`,
      label: String(key).replace(/[-_]+/g, " ").toUpperCase(),
      value: safeScalar(value),
      priority: .82 - index * .06,
      kind: "metric",
      state: entity.status,
      action: "inspect",
      provenance: entity.provenance,
    });
  });

  if (relations.length) {
    blocks.push({
      id: "relations",
      label: "RELATIONS",
      value: relations.join(" · "),
      priority: .72,
      kind: "relation",
      state: entity.status,
      action: "trace",
      provenance: entity.provenance,
    });
  }

  if (entity.summary) {
    blocks.push({
      id: "summary",
      label: "DETAIL",
      value: entity.summary,
      priority: .68,
      kind: "detail",
      state: entity.status,
      action: entity.actions[1] ?? "expand",
      provenance: entity.provenance,
    });
  }

  for (const block of entity.content) {
    if (!block?.id) continue;
    blocks.push({
      id: String(block.id),
      label: String(block.label ?? block.id).toUpperCase(),
      value: block.value ?? block.text ?? "",
      priority: clamp(block.priority ?? .62),
      kind: block.kind ?? "data",
      state: block.state ?? entity.status,
      action: block.action ?? "inspect",
      provenance: [...entity.provenance, ...(block.provenance ?? [])],
    });
  }

  return freeze(blocks.slice(0, 12));
}

function deterministicMetrics(feature) {
  const seed = feature.id;
  const activity = Math.round(38 + deterministic01(`${seed}:activity`) * 61);
  const links = Math.round(2 + deterministic01(`${seed}:links`) * 18);
  const depth = Math.round(1 + deterministic01(`${seed}:depth`) * 6);
  return { activity, links, depth };
}

export function featureToPrimaryEntity(feature, regionId = "explore") {
  const kind = inferEntityKind({ featureId: feature.id, group: feature.group });
  return normalizeUniversalEntity({
    id: `${regionId}:${feature.id}`,
    featureId: feature.id,
    kind,
    title: feature.label,
    summary: feature.summary,
    status: defaultStateForKind(kind),
    metrics: deterministicMetrics(feature),
    relations: [regionId, feature.group, "shared-universe"],
    actions: ["inspect", "expand", "trace"],
    provenance: ["ivlens-feature-catalog", `feature:${feature.id}`],
    accent: feature.accent,
    source: { regionId, featureId: feature.id },
  });
}

export function featureToCompanionEntities(feature, regionId = "explore") {
  const primary = featureToPrimaryEntity(feature, regionId);
  const suffix = feature.id.replace(/[^a-z0-9-]/gi, "-");
  const result = [primary];

  if (primary.kind === "contract") {
    result.push(normalizeUniversalEntity({
      id: `${regionId}:${suffix}:slip`,
      kind: "slip",
      title: "Covenant Slip",
      summary: "Receipt, value, state, evidence and ancestry attached to this contract object.",
      status: "attached",
      metrics: { receipts: 3, evidence: 2, revision: 1 },
      relations: [primary.id, `${regionId}:contractor`],
      provenance: ["derived-companion", primary.id],
    }));
    result.push(normalizeUniversalEntity({
      id: `${regionId}:${suffix}:contractor`,
      kind: "contractor",
      title: "Contractor / Participant",
      summary: "Participant identity, role and permissions expressed as a living object rather than a card.",
      status: "active",
      metrics: { role: "participant", approvals: 1, obligations: 2 },
      relations: [primary.id],
      provenance: ["derived-companion", primary.id],
    }));
  } else if (primary.kind === "person" || primary.kind === "room") {
    result.push(normalizeUniversalEntity({
      id: `${regionId}:${suffix}:message`,
      kind: "message",
      title: "Message / Statement",
      summary: "Local statement attached to this space.",
      status: "local",
      metrics: { messages: 4, unread: 1 },
      relations: [primary.id],
      provenance: ["derived-companion", primary.id],
    }));
    result.push(normalizeUniversalEntity({
      id: `${regionId}:${suffix}:slip`,
      kind: "slip",
      title: "Consent Slip",
      summary: "Consent and provenance state belonging to the same object network.",
      status: "attached",
      metrics: { consent: "yes", revision: 1 },
      relations: [primary.id],
      provenance: ["derived-companion", primary.id],
    }));
  } else if (primary.kind === "bot") {
    result.push(normalizeUniversalEntity({
      id: `${regionId}:${suffix}:slip`,
      kind: "slip",
      title: "Agent Action Slip",
      summary: "Bounded local proposal/receipt state for the agent.",
      status: "advisory",
      metrics: { proposals: 3, applied: 0 },
      relations: [primary.id],
      provenance: ["derived-companion", primary.id],
    }));
    result.push(normalizeUniversalEntity({
      id: `${regionId}:${suffix}:proof`,
      kind: "proof",
      title: "Evidence / Provenance",
      summary: "Visible ancestry for the current advisory projection.",
      status: "verified",
      metrics: { sources: 2, ancestry: 4 },
      relations: [primary.id],
      provenance: ["derived-companion", primary.id],
    }));
  } else if (primary.kind === "event" || primary.kind === "market") {
    result.push(normalizeUniversalEntity({
      id: `${regionId}:${suffix}:position`,
      kind: "position",
      title: "Observed Position",
      summary: "A bounded local position/evidence view with no execution authority.",
      status: "observed",
      metrics: { confidence: "local", evidence: 3 },
      relations: [primary.id],
      provenance: ["derived-companion", primary.id],
    }));
    result.push(normalizeUniversalEntity({
      id: `${regionId}:${suffix}:proof`,
      kind: "proof",
      title: "Evidence",
      summary: "Evidence object linked to the event/market projection.",
      status: "verified",
      metrics: { sources: 3, revision: 1 },
      relations: [primary.id],
      provenance: ["derived-companion", primary.id],
    }));
  } else {
    result.push(normalizeUniversalEntity({
      id: `${regionId}:${suffix}:slip`,
      kind: "slip",
      title: "State Slip",
      summary: "Portable semantic state attached to the object.",
      status: "attached",
      metrics: { revision: 1, links: 2 },
      relations: [primary.id],
      provenance: ["derived-companion", primary.id],
    }));
    result.push(normalizeUniversalEntity({
      id: `${regionId}:${suffix}:proof`,
      kind: "proof",
      title: "Provenance",
      summary: "Evidence and ancestry linked to the object surface.",
      status: "verified",
      metrics: { sources: 2, ancestry: 3 },
      relations: [primary.id],
      provenance: ["derived-companion", primary.id],
    }));
  }

  return freeze(result);
}

export function supportsUniversalEntity(input) {
  const entity = normalizeUniversalEntity(input);
  return ENTITY_KINDS.includes(entity.kind) && GEOMETRY_FAMILIES.includes(entity.geometryFamily);
}
