import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COUNCIL_BOUNDARY,
  COUNCIL_CAPABILITIES,
  COUNCIL_CONNECTION_CATALOG,
  COUNCIL_SIMULATION,
  createBotPlazaCouncilAuthority,
  createCouncilMemberRegistry,
  createCouncilOrchestrator,
} from "../src/domains/council-orchestrator.js";
import { createBotRegistry } from "../src/domains/bot-plaza.js";

const FIXED_NOW = "2026-10-13T00:00:00.000Z";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function fakeAuthority(memberIds = ["lead", "scout", "critic", "unapproved"]) {
  const states = new Map(memberIds.map((id) => [id, {
    id,
    name: id[0].toUpperCase() + id.slice(1),
    enabled: true,
    authorityCapabilities: ["world.message-bots"],
    declaredCapabilities: ["world.message-bots"],
    kind: "mock",
    version: "1.0.0",
  }]));
  return {
    states,
    getMember(id) {
      const state = states.get(id);
      return state ? clone(state) : null;
    },
    listMembers() {
      return [...states.values()].map(clone);
    },
  };
}

function memberDefinition(id, role, overrides = {}) {
  return {
    id,
    role,
    userConsent: true,
    councilCapabilities: [...COUNCIL_CAPABILITIES],
    toolCapabilities: [],
    contextScopes: ["task.request", "context.public"],
    independenceGroup: `${id}-group`,
    connectionStatus: "simulation",
    ...overrides,
  };
}

function makeCouncil({ authority = fakeAuthority(), adapters = {}, limits = {} } = {}) {
  const registry = createCouncilMemberRegistry({ authority, now: () => FIXED_NOW });
  registry.registerMember(memberDefinition("lead", "lead", { independenceGroup: "lead-lane" }));
  registry.registerMember(memberDefinition("scout", "specialist", { independenceGroup: "research-lane" }));
  registry.registerMember(memberDefinition("critic", "critic", { independenceGroup: "review-lane" }));
  registry.registerMember(memberDefinition("unapproved", "specialist", { independenceGroup: "research-lane" }));
  const council = createCouncilOrchestrator({
    authority,
    registry,
    adapters,
    now: () => FIXED_NOW,
    limits,
  });
  return { authority, registry, council };
}

function taskInput(overrides = {}) {
  return {
    id: "task:demo",
    prompt: "Decide which local demo direction is safest.",
    leadId: "lead",
    specialistIds: ["scout"],
    criticIds: ["critic"],
    context: {
      "context.public": { brief: "public demo context", safe: true },
      "context.private": { privateNote: "should never be sent" },
      secrets: { apiKey: "should never be sent" },
    },
    consent: {
      granted: true,
      approvedBy: "user",
      approvedMemberIds: ["lead", "scout", "critic"],
      capabilitiesByMember: {
        lead: ["council.synthesize"],
        scout: ["council.propose"],
        critic: ["council.critique"],
      },
      contextScopesByMember: {
        lead: ["task.request", "context.public"],
        scout: ["task.request", "context.public"],
        critic: ["task.request", "context.public"],
      },
    },
    budget: {
      maxTokens: 720,
      maxCostUnits: 12,
      maxTokensPerCall: 80,
      maxCostUnitsPerCall: 1,
    },
    ...overrides,
  };
}

function deterministicAdapters(observed = []) {
  return {
    scout: {
      provider: "mock:scout",
      async propose(args) {
        observed.push({ memberId: args.member.id, phase: args.phase, context: clone(args.context), task: clone(args.task) });
        return {
          responseId: "scout-response-1",
          text: "The local deterministic path is the safest starting point.",
          claims: [{ id: "direction", statement: "The local path is safest", stance: "support", confidence: 0.7 }],
          unknowns: ["No real provider entitlement has been verified."],
          actionRequests: [{ action: "world.announce", params: { text: "please announce" }, effectKey: "announce:demo" }],
          permissions: ["council.synthesize"],
          budget: { maxTokens: 999999 },
          usage: { outputTokens: 24, costUnits: 1 },
        };
      },
    },
    critic: {
      provider: "mock:critic",
      async critique(args) {
        observed.push({ memberId: args.member.id, phase: args.phase, inputs: clone(args.inputs), context: clone(args.context), task: clone(args.task) });
        return {
          responseId: "critic-response-1",
          text: "The proposal is bounded, but entitlement and external effects remain unknown.",
          claims: [{ id: "direction", statement: "The local path is safest", stance: "oppose", confidence: 0.45 }],
          unknowns: ["Whether any selected provider supports this agency is unknown."],
          usage: { outputTokens: 20, costUnits: 1 },
        };
      },
    },
    lead: {
      provider: "mock:lead",
      async synthesize(args) {
        observed.push({ memberId: args.member.id, phase: args.phase, inputs: clone(args.inputs), context: clone(args.context), task: clone(args.task) });
        return {
          responseId: "lead-response-1",
          text: "Simulation synthesis: keep the local council bounded and gate providers separately.",
          unknowns: ["Provider setup remains a separate user decision."],
          usage: { outputTokens: 28, costUnits: 1 },
        };
      },
    },
  };
}

test("the existing Bot Plaza authority remains the source of member identity and tool grants", () => {
  const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const plaza = createBotRegistry({ storage, now: () => FIXED_NOW });
  const authority = createBotPlazaCouncilAuthority({ registry: plaza });
  const muse = authority.getMember("muse-agent");
  assert.equal(muse.authoritySource, "bot-plaza");
  assert.deepEqual(muse.authorityCapabilities, ["world.announce", "world.message-bots"]);
  assert.equal(authority.getMember("missing"), null);
});

test("unapproved members and task capabilities never receive an adapter call", async () => {
  const calls = [];
  const { council } = makeCouncil({ adapters: deterministicAdapters(calls) });
  const task = council.createTask(taskInput({
    specialistIds: ["unapproved"],
    consent: {
      ...taskInput().consent,
      approvedMemberIds: ["lead", "critic"],
      capabilitiesByMember: { lead: ["council.synthesize"], critic: ["council.critique"] },
    },
  }));
  const result = await council.runTask(task.id);
  assert.equal(calls.some((call) => call.memberId === "unapproved"), false);
  assert.ok(result.records.some((record) => record.memberId === "unapproved" && record.reason === "member-not-approved-for-task"));
  assert.equal(result.finalResponse.speakerId, "lead");
});

test("per-bot consent is a separate gate from task membership", async () => {
  const calls = [];
  const { council, registry } = makeCouncil({ adapters: deterministicAdapters(calls) });
  registry.update("scout", { userConsent: false });
  const task = council.createTask(taskInput());
  const result = await council.runTask(task.id);
  assert.equal(calls.some((call) => call.memberId === "scout"), false);
  assert.ok(result.records.some((record) => record.memberId === "scout" && record.reason === "member-consent-required"));
});

test("context is allowlisted per member and authority/secrets never enter adapter input", async () => {
  const observed = [];
  const { council } = makeCouncil({ adapters: deterministicAdapters(observed) });
  const task = council.createTask(taskInput());
  const result = await council.runTask(task.id);
  assert.equal(result.status, "completed");
  for (const call of observed) {
    assert.equal(call.task.prompt, undefined);
    assert.equal(call.context.request, "Decide which local demo direction is safest.");
    assert.equal(call.context["context.public"].safe, true);
    assert.equal(call.context["context.private"], undefined);
    assert.equal(call.context.secrets, undefined);
    assert.ok(call.context.redactions.includes("context.private"));
    assert.ok(call.context.redactions.includes("secrets-and-authority-fields"));
  }
});

test("critic disagreement, unknowns, provenance, and similar-vote warning survive synthesis", async () => {
  const { council } = makeCouncil({ adapters: deterministicAdapters() });
  const task = council.createTask(taskInput());
  const result = await council.runTask(task.id);
  assert.equal(result.finalResponse.speakerId, "lead");
  assert.equal(result.finalResponse.status, "selected-speaker-only");
  assert.ok(result.disagreements.some((entry) => entry.claimId === "direction"));
  assert.ok(result.unknowns.some((entry) => entry.includes("provider entitlement")));
  assert.equal(result.similarVotesNotProof, true);
  assert.equal(result.provenance.length, result.contributions.length);
  assert.ok(result.contributions.every((entry) => entry.provenance.untrusted && entry.provenance.simulation));
});

test("budget exhaustion prevents later phases and adapter budget requests cannot raise it", async () => {
  const calls = [];
  const { council } = makeCouncil({ adapters: deterministicAdapters(calls) });
  const task = council.createTask(taskInput({
    budget: { maxTokens: 80, maxCostUnits: 12, maxTokensPerCall: 80, maxCostUnitsPerCall: 1 },
  }));
  const result = await council.runTask(task.id);
  assert.equal(result.budget.configured.effective.maxTokens, 80);
  assert.equal(result.budget.reservedTokens, 80);
  assert.equal(result.budget.exhausted, true);
  assert.ok(result.records.some((record) => record.reason === "budget-exhausted"));
  assert.equal(result.budget.remainingTokens, 0);
  assert.equal(result.contributions[0].securityRequests[0].field, "permissions");
  assert.equal(calls.filter((call) => call.phase === "synthesis").length, 0);
});

test("bounded concurrency and timeout/failure records are visible", async () => {
  let active = 0;
  let peak = 0;
  const adapters = deterministicAdapters();
  adapters.scout.propose = async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 4));
    active -= 1;
    return { responseId: "slow", text: "slow proposal" };
  };
  adapters.critic.critique = async () => { throw new Error("mock failure"); };
  adapters.lead.synthesize = async () => new Promise(() => {});
  const { council } = makeCouncil({ adapters, limits: { maxConcurrency: 1, requestTimeoutMs: 8 } });
  const task = council.createTask(taskInput());
  const result = await council.runTask(task.id);
  assert.equal(peak, 1);
  assert.ok(result.records.some((record) => record.status === "failure" && record.reason === "adapter-failure"));
  assert.ok(result.records.some((record) => record.status === "timeout" && record.reason === "adapter-timeout"));
  assert.equal(result.noExternalEffects, true);
});

test("cycle requests are rejected and never schedule a new member", async () => {
  const calls = [];
  const adapters = deterministicAdapters(calls);
  adapters.scout.propose = async () => ({
    responseId: "cycle",
    text: "I want to delegate back to myself.",
    delegationRequests: [{ targetMemberId: "scout", path: ["scout"], reason: "recursive request" }],
  });
  const { council } = makeCouncil({ adapters, limits: { maxDelegationDepth: 3 } });
  const task = council.createTask(taskInput({
    delegation: { enabled: true, maxDepth: 3, edges: [{ from: "scout", to: "scout" }] },
  }));
  const result = await council.runTask(task.id);
  const scout = result.contributions.find((entry) => entry.provenance.memberId === "scout");
  assert.equal(scout.delegationRequests[0].status, "rejected");
  assert.equal(scout.delegationRequests[0].rejectionReason, "cycle-detected");
  assert.equal(calls.filter((call) => call.memberId === "scout").length, 0);
});

test("duplicate response envelopes and duplicate effect keys are fenced", async () => {
  const adapters = deterministicAdapters();
  adapters.scout.propose = async () => ({
    responses: [
      { responseId: "same", text: "one", actionRequests: [
        { action: "world.announce", params: {}, effectKey: "same-effect" },
        { action: "world.announce", params: {}, effectKey: "same-effect" },
      ] },
      { responseId: "same", text: "duplicate", actionRequests: [{ action: "world.announce", params: {}, effectKey: "same-effect" }] },
    ],
  });
  const { council, registry, authority } = makeCouncil({ adapters });
  authority.states.get("scout").authorityCapabilities = ["world.announce"];
  registry.update("scout", { toolCapabilities: ["world.announce"] });
  const input = taskInput();
  input.consent.actionCapabilitiesByMember = { scout: ["world.announce"] };
  const task = council.createTask(input);
  const result = await council.runTask(task.id);
  assert.ok(result.records.some((record) => record.status === "duplicate" && record.reason === "duplicate-response"));
  assert.equal(result.pendingActionRequests.length, 2);
  assert.ok(result.pendingActionRequests.every((request) => request.executed === false));
  assert.ok(result.pendingActionRequests.some((request) => request.status === "duplicate-effect-request"));
});

test("revocation in flight fences a late member result", async () => {
  let resolveScout;
  const adapters = deterministicAdapters();
  adapters.scout.propose = () => new Promise((resolve) => { resolveScout = resolve; });
  const { council } = makeCouncil({ adapters, limits: { requestTimeoutMs: 80 } });
  const task = council.createTask(taskInput());
  const handle = council.startTask(task.id);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(typeof resolveScout, "function");
  handle.revokeMember("scout");
  resolveScout({ responseId: "late", text: "must be fenced" });
  const result = await handle.promise;
  assert.equal(result.contributions.some((entry) => entry.provenance.memberId === "scout"), false);
  assert.ok(result.records.some((record) => record.memberId === "scout" && record.status === "fenced"));
});

test("cancellation fences in-flight results and does not run later phases", async () => {
  let resolveScout;
  const adapters = deterministicAdapters();
  adapters.scout.propose = () => new Promise((resolve) => { resolveScout = resolve; });
  const { council } = makeCouncil({ adapters, limits: { requestTimeoutMs: 80 } });
  const task = council.createTask(taskInput());
  const handle = council.startTask(task.id);
  await new Promise((resolve) => setTimeout(resolve, 0));
  handle.cancel("user stopped council");
  resolveScout({ responseId: "cancelled", text: "must not be delivered" });
  const result = await handle.promise;
  assert.equal(result.status, "cancelled");
  assert.equal(result.finalResponse, null);
  assert.ok(result.records.some((record) => record.status === "fenced" && record.reason === "run-cancelled"));
  assert.equal(result.records.some((record) => record.phase === "critique" || record.phase === "synthesis"), false);
});

test("approved specialist can be selected explicitly, while a rogue speaker field is ignored", async () => {
  const adapters = deterministicAdapters();
  adapters.scout.synthesize = async () => ({
    responseId: "specialist-final",
    speakerId: "rogue-member",
    text: "Specialist synthesis, explicitly approved by the user.",
  });
  const { council } = makeCouncil({ adapters });
  const consent = taskInput().consent;
  const task = council.createTask(taskInput({
    speaker: { mode: "approved-specialist", memberId: "scout" },
    consent: { ...consent, approvedSpeakerId: "scout", capabilitiesByMember: { ...consent.capabilitiesByMember, scout: ["council.propose", "council.synthesize"] } },
  }));
  const result = await council.runTask(task.id);
  assert.equal(result.finalResponse.speakerId, "scout");
  assert.equal(result.finalResponse.text, "Specialist synthesis, explicitly approved by the user.");
});

test("provider connection catalog is honest and visibly pending, never a fake login", () => {
  assert.equal(COUNCIL_SIMULATION, true);
  assert.match(COUNCIL_BOUNDARY, /No provider login/);
  assert.deepEqual(COUNCIL_CONNECTION_CATALOG.map((entry) => entry.status), [
    "manual-setup-required",
    "manual-setup-required",
    "manual-setup-required",
    "manual-setup-required",
    "manual-setup-required",
    "manual-setup-required",
    "manual-setup-required",
  ]);
  assert.ok(COUNCIL_CONNECTION_CATALOG.every((entry) => entry.apiKeyEntry === false));
});
