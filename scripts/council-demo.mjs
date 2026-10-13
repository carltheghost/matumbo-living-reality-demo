/**
 * Runnable local council demonstration.
 *
 * SIMULATION ONLY: all responders below are deterministic in-process mock
 * adapters. No provider login, API key, credential, cookie, network request,
 * external tool, or action execution occurs.
 */

import {
  COUNCIL_BOUNDARY,
  COUNCIL_CONNECTION_CATALOG,
  createBotPlazaCouncilAuthority,
  createCouncilMemberRegistry,
  createCouncilOrchestrator,
} from "../src/domains/council-orchestrator.js";
import { createBotRegistry } from "../src/domains/bot-plaza.js";

const NOW = "2026-10-13T00:00:00.000Z";

function storage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

function localPlugin(id, name) {
  return {
    id,
    name,
    version: "simulation-1.0.0",
    capabilities: ["world.message-bots", "world.announce"],
    onMessage: () => "local mock plugin; council demo does not use Bot Plaza message delivery",
  };
}

const plaza = createBotRegistry({ storage: storage(), now: () => NOW });
plaza.install(localPlugin("council-lead", "Council Lead"), { approvedCapabilities: ["world.announce"] });
plaza.install(localPlugin("council-scout", "Council Scout"), { approvedCapabilities: ["world.announce"] });
plaza.install(localPlugin("council-critic", "Council Critic"), { approvedCapabilities: [] });

const authority = createBotPlazaCouncilAuthority({ registry: plaza });
const members = createCouncilMemberRegistry({ authority, now: () => NOW });

members.registerMember({
  id: "council-lead",
  role: "lead",
  userConsent: true,
  councilCapabilities: ["council.synthesize"],
  toolCapabilities: ["world.announce"],
  contextScopes: ["task.request", "context.public"],
  independenceGroup: "lead-lane",
  connectionStatus: "simulation",
});
members.registerMember({
  id: "council-scout",
  role: "specialist",
  userConsent: true,
  councilCapabilities: ["council.propose"],
  toolCapabilities: ["world.announce"],
  contextScopes: ["task.request", "context.public"],
  independenceGroup: "mock-research-lane",
  connectionStatus: "simulation",
});
members.registerMember({
  id: "council-critic",
  role: "critic",
  userConsent: true,
  councilCapabilities: ["council.critique"],
  toolCapabilities: [],
  contextScopes: ["task.request", "context.public"],
  independenceGroup: "mock-review-lane",
  connectionStatus: "simulation",
});

const council = createCouncilOrchestrator({
  authority,
  registry: members,
  now: () => NOW,
  adapters: {
    "council-scout": {
      provider: "mock:council-scout",
      async propose() {
        return {
          responseId: "mock-scout-1",
          text: "Keep the first run local and deterministic; ask the user before any provider setup.",
          claims: [{ id: "local-first", statement: "A local rehearsal is the safest first step", stance: "support", confidence: 0.85 }],
          unknowns: ["No external provider entitlement has been checked."],
          actionRequests: [{
            action: "world.announce",
            params: { text: "Council action request — proposal only" },
            effectKey: "demo:announce:local-first",
          }],
          usage: { outputTokens: 32, costUnits: 1 },
        };
      },
    },
    "council-critic": {
      provider: "mock:council-critic",
      async critique() {
        return {
          responseId: "mock-critic-1",
          text: "The bounded rehearsal is useful, but provider eligibility and account consent remain unknown.",
          claims: [{ id: "local-first", statement: "A local rehearsal is the safest first step", stance: "support", confidence: 0.7 }],
          unknowns: ["The user has not selected or authorized a provider route."],
          usage: { outputTokens: 28, costUnits: 1 },
        };
      },
    },
    "council-lead": {
      provider: "mock:council-lead",
      async synthesize() {
        return {
          responseId: "mock-lead-1",
          text: "Simulation synthesis: run the local council now; keep provider connection and any external effects as separate user-approved gates.",
          unknowns: ["No real provider response was requested."],
          usage: { outputTokens: 36, costUnits: 1 },
        };
      },
    },
  },
});

const task = council.createTask({
  id: "task:local-demo",
  prompt: "Choose the safest way to demonstrate a multi-bot council.",
  leadId: "council-lead",
  specialistIds: ["council-scout"],
  criticIds: ["council-critic"],
  context: {
    "context.public": {
      label: "local deterministic rehearsal",
      externalCalls: false,
    },
    secrets: { intentionallyNotVisible: "never passed to adapters" },
  },
  consent: {
    granted: true,
    approvedBy: "demo-user-consent",
    approvedMemberIds: ["council-lead", "council-scout", "council-critic"],
    capabilitiesByMember: {
      "council-lead": ["council.synthesize"],
      "council-scout": ["council.propose"],
      "council-critic": ["council.critique"],
    },
    actionCapabilitiesByMember: { "council-scout": ["world.announce"] },
    contextScopesByMember: {
      "council-lead": ["task.request", "context.public"],
      "council-scout": ["task.request", "context.public"],
      "council-critic": ["task.request", "context.public"],
    },
  },
  budget: { maxTokens: 480, maxCostUnits: 9, maxTokensPerCall: 120, maxCostUnitsPerCall: 2 },
});

const result = await council.runTask(task.id);

console.log("SIMULATION ONLY — deterministic/mock council; no provider sign-in, API key, network, or external action.");
console.log(JSON.stringify({
  boundary: COUNCIL_BOUNDARY,
  connectionStates: COUNCIL_CONNECTION_CATALOG.map(({ id, route, eligibility, status, apiKeyEntry, note }) => ({ id, route, eligibility, status, apiKeyEntry, note })),
  task: { id: result.taskId, status: result.status, selectedSpeaker: result.selection },
  finalResponse: result.finalResponse,
  review: {
    disagreements: result.disagreements,
    unknowns: result.unknowns,
    agreementWarnings: result.agreementWarnings,
    similarVotesNotProof: result.similarVotesNotProof,
  },
  contributions: result.provenance,
  pendingActionRequests: result.pendingActionRequests,
  budget: result.budget,
  noExternalEffects: result.noExternalEffects,
}, null, 2));
