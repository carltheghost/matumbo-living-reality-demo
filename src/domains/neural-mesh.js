/**
 * Deterministic advisory-agent and neural-mesh projections for local display.
 * This module cannot invoke models, tools, providers, or authority-bearing work.
 */

export const NEURAL_MESH_SCHEMA_VERSION = 1;
export const NEURAL_MESH_SOURCE = "skynet-neural-mesh";

export const ProposalStatus = Object.freeze({
  DRAFT: "draft",
  PROPOSED: "proposed",
  DISMISSED: "dismissed",
});

export const RelationshipKind = Object.freeze({
  ADVISES: "advises",
  COLLABORATES: "collaborates",
  OBSERVES: "observes",
});

export const NEURAL_MESH_CAPABILITIES = Object.freeze([
  Object.freeze({
    id: "neural-mesh-project-advisory-state",
    mode: "local-projection",
    enabled: true,
    authority: "none",
  }),
  Object.freeze({
    id: "neural-mesh-autonomous-execution",
    mode: "denied",
    enabled: false,
    authority: "none",
  }),
  Object.freeze({
    id: "neural-mesh-external-model-or-tool-access",
    mode: "denied",
    enabled: false,
    authority: "none",
  }),
]);

const PROPOSAL_STATUSES = new Set(Object.values(ProposalStatus));
const RELATIONSHIP_KINDS = new Set(Object.values(RelationshipKind));

function requireRecord(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${field} must be an object`);
  }
  return value;
}

function requireString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value;
}

function requireEnum(value, values, field) {
  if (!values.has(value)) throw new TypeError(`Unknown ${field}: ${String(value)}`);
  return value;
}

function requireKnownAgent(agentId, agentsById, field) {
  requireString(agentId, field);
  if (!agentsById.has(agentId)) throw new TypeError(`${field} references unknown agent: ${agentId}`);
  return agentId;
}

function addUnique(entity, ids) {
  if (ids.has(entity.id)) throw new TypeError(`Duplicate entity id: ${entity.id}`);
  ids.add(entity.id);
  return entity;
}

function normalizeAgent(agent) {
  requireRecord(agent, "agent");
  return Object.freeze({
    id: requireString(agent.id, "agent.id"),
    kind: "advisory-agent",
    label: requireString(agent.label, "agent.label"),
    role: requireString(agent.role, "agent.role"),
    simulation: true,
    advisoryOnly: true,
    executionAuthority: "none",
  });
}

function normalizeIntent(intent, agentsById) {
  requireRecord(intent, "intent");
  return Object.freeze({
    id: requireString(intent.id, "intent.id"),
    kind: "advisory-intent",
    agentId: requireKnownAgent(intent.agentId, agentsById, "intent.agentId"),
    summary: requireString(intent.summary, "intent.summary"),
    simulation: true,
    advisoryOnly: true,
    executable: false,
  });
}

function normalizeProposal(proposal, agentsById, intentsById) {
  requireRecord(proposal, "proposal");
  const intentId = requireString(proposal.intentId, "proposal.intentId");
  if (!intentsById.has(intentId)) {
    throw new TypeError(`proposal.intentId references unknown intent: ${intentId}`);
  }
  return Object.freeze({
    id: requireString(proposal.id, "proposal.id"),
    kind: "advisory-proposal",
    agentId: requireKnownAgent(proposal.agentId, agentsById, "proposal.agentId"),
    intentId,
    summary: requireString(proposal.summary, "proposal.summary"),
    status: requireEnum(proposal.status, PROPOSAL_STATUSES, "proposal status"),
    simulation: true,
    advisoryOnly: true,
    executable: false,
    requiresHumanDecision: true,
  });
}

function normalizeRelationship(relationship, agentsById) {
  requireRecord(relationship, "relationship");
  const fromAgentId = requireKnownAgent(
    relationship.fromAgentId, agentsById, "relationship.fromAgentId");
  const toAgentId = requireKnownAgent(
    relationship.toAgentId, agentsById, "relationship.toAgentId");
  if (fromAgentId === toAgentId) throw new TypeError("relationship agents must be distinct");
  return Object.freeze({
    id: requireString(relationship.id, "relationship.id"),
    kind: "agent-relationship",
    relationship: requireEnum(
      relationship.relationship, RELATIONSHIP_KINDS, "relationship kind"),
    fromAgentId,
    toAgentId,
    simulation: true,
    authority: "none",
  });
}

function normalizeAncestry(link, agentsById) {
  requireRecord(link, "ancestry");
  const ancestorAgentId = requireKnownAgent(
    link.ancestorAgentId, agentsById, "ancestry.ancestorAgentId");
  const descendantAgentId = requireKnownAgent(
    link.descendantAgentId, agentsById, "ancestry.descendantAgentId");
  if (ancestorAgentId === descendantAgentId) throw new TypeError("ancestry agents must be distinct");
  return Object.freeze({
    id: requireString(link.id, "ancestry.id"),
    kind: "agent-ancestry",
    ancestorAgentId,
    descendantAgentId,
    basis: requireString(link.basis, "ancestry.basis"),
    simulation: true,
    identityAuthority: "none",
  });
}

/** Build a pure, side-effect-free advisory neural-mesh contribution. */
export function createNeuralMeshContribution({
  updatedAt,
  agents = [],
  intents = [],
  proposals = [],
  relationships = [],
  ancestry = [],
}) {
  requireString(updatedAt, "updatedAt");
  if (![agents, intents, proposals, relationships, ancestry].every(Array.isArray)) {
    throw new TypeError("agents, intents, proposals, relationships, and ancestry must be arrays");
  }

  const ids = new Set();
  const normalizedAgents = agents.map((item) => addUnique(normalizeAgent(item), ids));
  const agentsById = new Map(normalizedAgents.map((item) => [item.id, item]));
  const normalizedIntents = intents.map((item) => addUnique(normalizeIntent(item, agentsById), ids));
  const intentsById = new Map(normalizedIntents.map((item) => [item.id, item]));
  const normalizedProposals = proposals.map((item) =>
    addUnique(normalizeProposal(item, agentsById, intentsById), ids));
  const normalizedRelationships = relationships.map((item) =>
    addUnique(normalizeRelationship(item, agentsById), ids));
  const normalizedAncestry = ancestry.map((item) =>
    addUnique(normalizeAncestry(item, agentsById), ids));

  return Object.freeze({
    schemaVersion: NEURAL_MESH_SCHEMA_VERSION,
    source: NEURAL_MESH_SOURCE,
    simulation: true,
    updatedAt,
    entities: Object.freeze([
      ...normalizedAgents,
      ...normalizedIntents,
      ...normalizedProposals,
      ...normalizedRelationships,
      ...normalizedAncestry,
    ]),
    evidence: Object.freeze([
      Object.freeze({
        id: `neural-mesh-boundary:${updatedAt}`,
        kind: "capability-boundary",
        status: "enforced",
        simulation: true,
        executionAuthority: "none",
        externalProviders: "none",
        note: "Advisory local projection only; human decisions are never executed by this module.",
      }),
    ]),
    capabilities: NEURAL_MESH_CAPABILITIES,
  });
}
