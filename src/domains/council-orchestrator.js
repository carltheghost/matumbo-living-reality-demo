/**
 * maTumbo council orchestration slice.
 *
 * This module is deliberately provider-neutral and simulation-only. It
 * coordinates already-authorized local members through narrow adapters, but
 * it never signs in, calls a provider, executes a tool, or grants authority.
 *
 * Existing Bot Plaza/Android authority remains authoritative for bot identity,
 * enabled state, and tool capabilities. A council member record is an
 * explicit user-owned allowlist layered on top of that authority; it cannot
 * elevate it.
 */

export const COUNCIL_SCHEMA_VERSION = 1;
export const COUNCIL_SOURCE = "council-orchestrator";
export const COUNCIL_SIMULATION = true;
export const COUNCIL_BOUNDARY =
  "SIMULATION ONLY: deterministic council orchestration over explicit local/mock adapters. " +
  "No provider login, API key, credential, cookie, external tool, payment, or deployed backend is present. " +
  "Bot messages are untrusted proposals; user authority remains outside this module.";

export const COUNCIL_CAPABILITIES = Object.freeze([
  "council.propose",
  "council.critique",
  "council.synthesize",
  "council.request-action",
]);

export const COUNCIL_ROLES = Object.freeze(["lead", "specialist", "critic"]);
export const COUNCIL_PHASES = Object.freeze(["proposal", "critique", "synthesis"]);
export const COUNCIL_PHASE_CAPABILITIES = Object.freeze({
  proposal: "council.propose",
  critique: "council.critique",
  synthesis: "council.synthesize",
});

export const COUNCIL_DEFAULT_LIMITS = Object.freeze({
  maxMembers: 12,
  maxRounds: 3,
  maxConcurrency: 3,
  requestTimeoutMs: 120,
  maxPromptChars: 2000,
  maxContextChars: 8000,
  maxContributionChars: 1400,
  maxClaimsPerContribution: 12,
  maxUnknownsPerContribution: 12,
  maxActionRequestsPerContribution: 8,
  maxDelegationRequestsPerContribution: 4,
  maxTokensPerCall: 240,
  maxCostUnitsPerCall: 3,
  maxTotalTokens: 1800,
  maxTotalCostUnits: 24,
  maxDelegationDepth: 0,
});

export const COUNCIL_CONNECTION_CATALOG = Object.freeze([
  Object.freeze({
    id: "openai-chatgpt-plan",
    label: "ChatGPT plan / Sign in with ChatGPT",
    route: "registered Sign in with ChatGPT client → eligible Responses request",
    eligibility: "provider registration/eligibility and user consent required",
    status: "manual-setup-required",
    apiKeyEntry: false,
    note: "Only an eligible, registered application can request plan-backed inference; sign-in does not expose conversations or memory.",
  }),
  Object.freeze({
    id: "anthropic-claude",
    label: "Claude account / Console",
    route: "Claude Console API or supported workload/cloud identity",
    eligibility: "Console/cloud setup is separate from a consumer Claude account",
    status: "manual-setup-required",
    apiKeyEntry: false,
    note: "Consumer Claude and Console/API access are separate; no consumer-account bridge is assumed here.",
  }),
  Object.freeze({
    id: "anthropic-claude-plan",
    label: "Claude Agent SDK / plan",
    route: "approved Claude Agent SDK or claude -p local account flow",
    eligibility: "Claude plan eligibility plus provider approval for third-party app usage",
    status: "manual-setup-required",
    apiKeyEntry: false,
    note: "Anthropic documents plan usage for the Agent SDK and claude -p, but unapproved third-party claude.ai login/rate-limit offerings are not assumed; this slice does not attempt either.",
  }),
  Object.freeze({
    id: "google-gemini",
    label: "Gemini API / Google Cloud OAuth",
    route: "Google Cloud OAuth consent → Generative Language API",
    eligibility: "configured Cloud project, API enablement, and consent required",
    status: "manual-setup-required",
    apiKeyEntry: false,
    note: "OAuth requires a configured Google Cloud project and consent; consumer Gemini sign-in is not treated as API entitlement.",
  }),
  Object.freeze({
    id: "google-gemini-cli",
    label: "Gemini CLI / Google sign-in",
    route: "local Gemini CLI Google sign-in → ACP/stdio client",
    eligibility: "user Google account or subscription and provider-defined CLI eligibility",
    status: "manual-setup-required",
    apiKeyEntry: false,
    note: "The official local CLI supports browser sign-in and ACP; this slice does not start the CLI, import cached credentials, or provide a hosted handoff.",
  }),
  Object.freeze({
    id: "xai-grok-cli",
    label: "Grok Build / xAI account",
    route: "official grok login or device auth → ACP/headless CLI",
    eligibility: "user-authenticated Grok account and provider CLI access",
    status: "manual-setup-required",
    apiKeyEntry: false,
    note: "The official CLI documents local cached authentication or an xAI API key; this slice does not automate login, read cached auth, or create a credential.",
  }),
  Object.freeze({
    id: "github-copilot",
    label: "GitHub Copilot SDK / GitHub OAuth",
    route: "registered GitHub OAuth/App → per-user Copilot SDK client",
    eligibility: "each user needs an active Copilot subscription and OAuth grant",
    status: "manual-setup-required",
    apiKeyEntry: false,
    note: "The official Copilot SDK route uses a registered GitHub OAuth/App flow and each user's Copilot subscription; no token is created here.",
  }),
]);

const ROLE_SET = new Set(COUNCIL_ROLES);
const CAPABILITY_SET = new Set(COUNCIL_CAPABILITIES);
const ADAPTER_METHODS = Object.freeze({ proposal: "propose", critique: "critique", synthesis: "synthesize" });
const SENSITIVE_KEY = /(?:secret|token|password|cookie|credential|api[-_]?key|authorization|session|private)/i;
const AUTHORITY_KEY = /(?:authority|authorit(?:y|ies)|capabilit(?:y|ies)|permission(?:s)?|grant(?:s)?|security|entitlement(?:s)?|connection[_-]?status|approved|approval|consent|revok(?:e|ed)|enabled|epoch|role(?:s)?|tool(?:s|[_-]?(?:capabilit(?:y|ies)|calls)?)|subject[_-]?id|account[_-]?id|user[_-]?id|provider[_-]?id)/i;
const CONTEXT_SCOPE_SCHEMAS = Object.freeze({
  "context.public": new Set([
    "brief", "safe", "safeNested", "label", "summary", "title", "description", "text", "question",
    "objective", "goal", "constraints", "constraint", "options", "option", "facts", "fact",
    "observations", "observation", "items", "item", "data", "value", "values", "count", "total",
    "status", "state", "category", "categories", "source", "sources", "sourceRefs", "refs",
    "externalCalls", "mode", "kind", "name", "step", "steps", "plan", "priority", "risk",
    "result", "results", "unknowns", "claims", "nested",
  ]),
  "context.private": new Set([
    "note", "notes", "summary", "details", "text", "question", "objective", "goal", "constraints",
    "constraint", "options", "option", "facts", "fact", "observations", "observation", "items", "item",
    "data", "value", "values", "count", "total", "status", "state", "category", "categories", "source",
    "sources", "sourceRefs", "refs", "mode", "kind", "name", "step", "steps", "plan", "priority", "risk",
    "result", "results", "unknowns", "claims", "nested", "safeNested",
  ]),
});
const ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,95}$/i;
const UNTRUSTED_CONNECTION_STATUSES = new Set(["simulation", "manual-setup-required", "unavailable", "revoked"]);

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
function asText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function cleanText(value, max, field, { required = false } = {}) {
  const text = asText(value).trim().replace(/\s+/g, " ");
  if (required && !text) throw new TypeError(`${field} must be non-empty`);
  if (text.length > max) throw new TypeError(`${field} exceeds ${max} characters`);
  return text;
}

function identifier(value, field) {
  const text = cleanText(value, 96, field, { required: true });
  if (!ID_PATTERN.test(text)) throw new TypeError(`${field} has an invalid id`);
  return text;
}

function uniqueStrings(value, max, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array`);
  return [...new Set(value.map((item) => cleanText(item, 96, field, { required: true })))].slice(0, max);
}

function integer(value, fallback, low, high, field) {
  const candidate = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isInteger(candidate) || candidate < low || candidate > high) {
    throw new TypeError(`${field} must be an integer from ${low} to ${high}`);
  }
  return candidate;
}

function fraction(value, fallback = 0) {
  const candidate = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isFinite(candidate)) return fallback;
  return Math.max(0, Math.min(1, Math.round(candidate * 100) / 100));
}

function nowIso(now) {
  try {
    const raw = typeof now === "function" ? now() : now;
    const date = new Date(raw === undefined || raw === null || raw === "" ? Date.now() : raw);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  } catch {
    // A deterministic test clock is optional.
  }
  return new Date().toISOString();
}

function hash(value) {
  const text = asText(value);
  let result = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    result ^= text.charCodeAt(index);
    result = Math.imul(result, 0x01000193) >>> 0;
  }
  return result.toString(16).padStart(8, "0");
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isForbiddenContextKey(key) {
  return SENSITIVE_KEY.test(key) || AUTHORITY_KEY.test(key);
}

function safeJson(value, depth = 0) {
  if (depth > 4 || value === null || value === undefined) return value ?? null;
  if (typeof value === "string") return value.slice(0, 500);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => safeJson(item, depth + 1));
  if (!isRecord(value)) return null;
  const output = {};
  for (const [key, child] of Object.entries(value).slice(0, 32)) {
    if (isForbiddenContextKey(key)) continue;
    output[key.slice(0, 96)] = safeJson(child, depth + 1);
  }
  return output;
}

function assertCapabilityList(value, field) {
  const capabilities = uniqueStrings(value, COUNCIL_CAPABILITIES.length, field);
  for (const capability of capabilities) {
    if (!CAPABILITY_SET.has(capability)) throw new TypeError(`unknown ${field} capability: ${capability}`);
  }
  return capabilities;
}

function normalizeConnectionStatus(value) {
  const status = asText(value || "simulation").trim();
  if (status === "connected") {
    throw new CouncilError("CONNECTION_EVIDENCE_REQUIRED", "connected status requires authority-owned verified connection evidence");
  }
  return UNTRUSTED_CONNECTION_STATUSES.has(status) ? status : "unavailable";
}

function normalizeConnectionRequest(memberId, value) {
  if (!isRecord(value)) {
    throw new CouncilError("CONNECTION_REQUEST_INVALID", "connection verification requires provider and subject binding");
  }
  return deepFreeze({
    memberId,
    providerId: identifier(value.providerId, "connection request provider id"),
    subjectId: identifier(value.subjectId, "connection request subject id"),
    entitlement: value.entitlement === undefined ? null : cleanText(value.entitlement, 160, "connection request entitlement"),
  });
}

function normalizeConnectionEvidence(value, requested) {
  if (!isRecord(value) || value.verified !== true) {
    throw new CouncilError("CONNECTION_NOT_VERIFIED", "connection evidence was not verified by the authority boundary");
  }
  const normalized = {
    memberId: identifier(value.memberId, "connection evidence member id"),
    providerId: identifier(value.providerId, "connection evidence provider id"),
    subjectId: identifier(value.subjectId, "connection evidence subject id"),
    entitlement: cleanText(value.entitlement, 160, "connection evidence entitlement", { required: true }),
    verifiedAt: cleanText(value.verifiedAt || "", 64, "connection evidence verifiedAt", { required: true }),
    verifiedBy: cleanText(value.verifiedBy || "authority", 96, "connection evidence verifier", { required: true }),
  };
  const mismatch = ["memberId", "providerId", "subjectId"]
    .find((field) => normalized[field] !== requested[field]);
  if (mismatch || (requested.entitlement !== null && normalized.entitlement !== requested.entitlement)) {
    throw new CouncilError("CONNECTION_TARGET_MISMATCH", "verified connection evidence does not match the requested member, provider, subject, or entitlement", {
      requested,
      received: {
        memberId: normalized.memberId,
        providerId: normalized.providerId,
        subjectId: normalized.subjectId,
        entitlement: normalized.entitlement,
      },
    });
  }
  return deepFreeze(normalized);
}

export class CouncilError extends Error {
  constructor(code, message = code, details = null) {
    super(message);
    this.name = "CouncilError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Read-only adapter over the existing Bot Plaza registry. The council never
 * receives the plugin or an action executor, so a council member cannot use
 * this adapter to grant itself tools or bypass Bot Plaza's capability gate.
 */
export function createBotPlazaCouncilAuthority({ registry } = {}) {
  if (!registry || typeof registry.getBot !== "function") {
    throw new TypeError("createBotPlazaCouncilAuthority needs a Bot Plaza registry");
  }

  function mapBot(bot) {
    if (!bot) return null;
    return deepFreeze({
      id: identifier(bot.id, "bot id"),
      name: cleanText(bot.name || bot.id, 96, "bot name", { required: true }),
      enabled: bot.enabled !== false,
      kind: cleanText(bot.kind || "plugin", 32, "bot kind"),
      version: cleanText(bot.version || "", 32, "bot version"),
      authorityCapabilities: uniqueStrings(bot.approvedCapabilities, 64, "authority capabilities"),
      declaredCapabilities: uniqueStrings(bot.declaredCapabilities, 64, "declared capabilities"),
      authoritySource: "bot-plaza",
    });
  }

  return deepFreeze({
    source: "bot-plaza-authority",
    getMember(id) {
      return mapBot(registry.getBot(asText(id)));
    },
    listMembers() {
      if (typeof registry.listBots !== "function") return [];
      return deepFreeze(registry.listBots().map(mapBot).filter(Boolean));
    },
  });
}
/**
 * Explicit user-owned council member registry. `councilCapabilities` are
 * orchestration roles, not tool grants. Tool capabilities are always the
 * intersection of this record and the live authority adapter.
 */
export function createCouncilMemberRegistry({ authority, now = null } = {}) {
  if (!authority || typeof authority.getMember !== "function") {
    throw new TypeError("council member registry needs a read-only authority adapter");
  }
  const members = new Map();
  let version = 0;

  function liveMember(id) {
    return authority.getMember(asText(id));
  }

  function snapshot(id) {
    const record = members.get(asText(id));
    if (!record) return null;
    const live = liveMember(record.id);
    const authorityCapabilities = uniqueStrings(live?.authorityCapabilities, 64, "authority capabilities");
    const effectiveToolCapabilities = record.toolCapabilities.filter((capability) => authorityCapabilities.includes(capability));
    return deepFreeze({
      ...record,
      authorityEnabled: live?.enabled === true,
      authorityCapabilities,
      effectiveToolCapabilities,
      enabled: record.enabled && !record.revoked && live?.enabled === true,
      sourceVersion: version,
    });
  }

  function registerMember(input = {}) {
    const id = identifier(input.id, "member id");
    const live = liveMember(id);
    if (!live) throw new CouncilError("MEMBER_NOT_FOUND", `member ${id} is not present in the authority registry`);
    if (input.connectionEvidence !== undefined) {
      throw new CouncilError("CONNECTION_EVIDENCE_TRUSTED_ONLY", "connection evidence must come from the authority verifier");
    }
    if (members.size >= COUNCIL_DEFAULT_LIMITS.maxMembers && !members.has(id)) {
      throw new CouncilError("MEMBER_LIMIT", "council member limit reached");
    }
    const role = asText(input.role || "specialist").trim();
    if (!ROLE_SET.has(role)) throw new TypeError(`unknown council role: ${role}`);
    const councilCapabilities = assertCapabilityList(input.councilCapabilities, "council");
    const toolCapabilities = uniqueStrings(input.toolCapabilities, 64, "tool");
    const authorityCapabilities = uniqueStrings(live.authorityCapabilities, 64, "authority capabilities");
    const notGranted = toolCapabilities.filter((capability) => !authorityCapabilities.includes(capability));
    const contextScopes = uniqueStrings(input.contextScopes, 16, "context scopes");
    const record = {
      id,
      name: cleanText(input.name || live.name || id, 96, "member name", { required: true }),
      role,
      independenceGroup: cleanText(input.independenceGroup || id, 96, "independence group", { required: true }),
      councilCapabilities,
      toolCapabilities,
      blockedToolCapabilities: notGranted,
      contextScopes,
      connectionStatus: normalizeConnectionStatus(input.connectionStatus),
      connectionEvidence: null,
      userConsent: input.userConsent === true,
      enabled: input.enabled !== false,
      revoked: false,
      epoch: (members.get(id)?.epoch || 0) + 1,
      registeredAt: nowIso(now),
    };
    members.set(id, record);
    version += 1;
    return snapshot(id);
  }

  function requireMember(id) {
    const member = snapshot(id);
    if (!member) throw new CouncilError("MEMBER_NOT_REGISTERED", `member ${id} is not registered with the council`);
    return member;
  }

  function update(id, patch = {}) {
    const current = members.get(asText(id));
    if (!current) throw new CouncilError("MEMBER_NOT_REGISTERED", `member ${id} is not registered with the council`);
    if (patch.connectionEvidence !== undefined) {
      throw new CouncilError("CONNECTION_EVIDENCE_TRUSTED_ONLY", "connection evidence must come from the authority verifier");
    }
    const next = { ...current };
    if (patch.userConsent !== undefined) next.userConsent = patch.userConsent === true;
    if (patch.enabled !== undefined) next.enabled = patch.enabled === true;
    if (patch.contextScopes !== undefined) next.contextScopes = uniqueStrings(patch.contextScopes, 16, "context scopes");
    if (patch.councilCapabilities !== undefined) next.councilCapabilities = assertCapabilityList(patch.councilCapabilities, "council");
    if (patch.toolCapabilities !== undefined) next.toolCapabilities = uniqueStrings(patch.toolCapabilities, 64, "tool");
    if (patch.connectionStatus !== undefined) {
      next.connectionStatus = normalizeConnectionStatus(patch.connectionStatus);
      next.connectionEvidence = null;
    }
    next.epoch += 1;
    members.set(current.id, next);
    version += 1;
    return snapshot(current.id);
  }

  function recordVerifiedConnection(id, evidence) {
    const current = members.get(asText(id));
    if (!current) throw new CouncilError("MEMBER_NOT_REGISTERED", `member ${id} is not registered with the council`);
    if (typeof authority.verifyConnectionEvidence !== "function") {
      throw new CouncilError("CONNECTION_VERIFIER_UNAVAILABLE", "no authority-owned connection verifier is installed");
    }
    const requested = normalizeConnectionRequest(current.id, evidence);
    let verified;
    try {
      verified = authority.verifyConnectionEvidence(requested, evidence);
    } catch (error) {
      throw new CouncilError("CONNECTION_VERIFICATION_FAILED", cleanText(error?.message || error, 240, "connection verification error"));
    }
    const connectionEvidence = normalizeConnectionEvidence(verified, requested);
    const next = {
      ...current,
      connectionStatus: "connected",
      connectionEvidence,
      epoch: current.epoch + 1,
    };
    members.set(current.id, next);
    version += 1;
    return snapshot(current.id);
  }

  function revoke(id, reason = "user revoked member consent") {
    const current = members.get(asText(id));
    if (!current) throw new CouncilError("MEMBER_NOT_REGISTERED", `member ${id} is not registered with the council`);
    current.revoked = true;
    current.userConsent = false;
    current.connectionStatus = "revoked";
    current.connectionEvidence = null;
    current.revocationReason = cleanText(reason, 240, "revocation reason") || "user revoked member consent";
    current.epoch += 1;
    members.set(current.id, current);
    version += 1;
    return snapshot(current.id);
  }

  return deepFreeze({
    source: COUNCIL_SOURCE,
    registerMember,
    update,
    recordVerifiedConnection,
    revoke,
    getMember: snapshot,
    requireMember,
    listMembers() {
      return deepFreeze([...members.keys()].map(snapshot).filter(Boolean));
    },
    getVersion: () => version,
  });
}

function projectContextValue(value, allowedKeys, maxChars, depth = 0) {
  if (depth > 4) return "[redacted:depth-limit]";
  if (typeof value === "string") return value.slice(0, maxChars);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 32).map((item) => projectContextValue(item, allowedKeys, maxChars, depth + 1));
  if (!isRecord(value)) return null;
  const output = {};
  for (const [key, child] of Object.entries(value).slice(0, 64)) {
    if (!allowedKeys.has(key)) continue;
    output[key.slice(0, 96)] = projectContextValue(child, allowedKeys, maxChars, depth + 1);
  }
  return output;
}

function sanitizeTaskContext(value, maxChars) {
  if (!isRecord(value)) return {};
  const output = {};
  for (const [scope, child] of Object.entries(value).slice(0, 24)) {
    const allowedKeys = CONTEXT_SCOPE_SCHEMAS[scope];
    if (!allowedKeys) continue;
    output[scope.slice(0, 96)] = projectContextValue(child, allowedKeys, maxChars);
  }
  return output;
}

function contextForMember(task, member, limits) {
  const taskScopes = task.consent.contextScopesByMember[member.id] || [];
  const scopes = member.contextScopes.filter((scope) => taskScopes.includes(scope));
  const visible = { taskId: task.id, scopes: [...scopes] };
  if (scopes.includes("task.request")) visible.request = task.prompt;
  for (const scope of scopes) {
    if (scope === "task.request") continue;
    if (!Object.prototype.hasOwnProperty.call(task.context, scope)) continue;
    const allowedKeys = CONTEXT_SCOPE_SCHEMAS[scope];
    if (!allowedKeys) continue;
    visible[scope] = projectContextValue(task.context[scope], allowedKeys, limits.maxContextChars);
  }
  visible.redactions = [
    ...Object.keys(task.context).filter((scope) => !scopes.includes(scope)),
    "secrets-and-authority-fields",
    "authority-and-security-fields",
  ];
  return deepFreeze(visible);
}

function publicMember(member) {
  return deepFreeze({
    id: member.id,
    name: member.name,
    role: member.role,
    independenceGroup: member.independenceGroup,
    councilCapabilities: [...member.councilCapabilities],
    effectiveToolCapabilities: [...member.effectiveToolCapabilities],
    connectionStatus: member.connectionStatus,
  });
}

function publicTask(task) {
  return deepFreeze({
    id: task.id,
    leadId: task.leadId,
    specialistIds: [...task.specialistIds],
    criticIds: [...task.criticIds],
    speaker: { ...task.speaker },
    simulation: true,
  });
}

function normalizeBudget(input = {}, limits) {
  const requested = {
    maxTokens: integer(input.maxTokens, 720, 1, 100000, "budget.maxTokens"),
    maxCostUnits: integer(input.maxCostUnits, 12, 1, 100000, "budget.maxCostUnits"),
    maxTokensPerCall: integer(input.maxTokensPerCall, 180, 1, 100000, "budget.maxTokensPerCall"),
    maxCostUnitsPerCall: integer(input.maxCostUnitsPerCall, 2, 1, 100000, "budget.maxCostUnitsPerCall"),
  };
  return deepFreeze({
    requested,
    effective: {
      maxTokens: Math.min(requested.maxTokens, limits.maxTotalTokens),
      maxCostUnits: Math.min(requested.maxCostUnits, limits.maxTotalCostUnits),
      maxTokensPerCall: Math.min(requested.maxTokensPerCall, limits.maxTokensPerCall),
      maxCostUnitsPerCall: Math.min(requested.maxCostUnitsPerCall, limits.maxCostUnitsPerCall),
    },
  });
}
function normalizeMapOfArrays(input, field, normalizer = uniqueStrings) {
  if (input === undefined || input === null) return {};
  if (!isRecord(input)) throw new TypeError(`${field} must be an object`);
  const output = {};
  for (const [key, value] of Object.entries(input).slice(0, 32)) {
    output[identifier(key, `${field} member id`)] = normalizer(value, 32, `${field}.${key}`);
  }
  return output;
}

function normalizeDelegation(input, limits) {
  if (!isRecord(input)) return deepFreeze({ enabled: false, maxDepth: 0, edges: [] });
  const edges = Array.isArray(input.edges) ? input.edges.slice(0, 32).map((edge) => {
    if (!isRecord(edge)) return null;
    return { from: identifier(edge.from, "delegation.from"), to: identifier(edge.to, "delegation.to") };
  }).filter(Boolean) : [];
  return deepFreeze({
    enabled: input.enabled === true,
    maxDepth: Math.min(integer(input.maxDepth, 0, 0, 32, "delegation.maxDepth"), limits.maxDelegationDepth),
    edges,
  });
}

function phaseRound(phase) {
  return phase === "proposal" ? 1 : phase === "critique" ? 2 : 3;
}

function expectedRoleForPhase(phase) {
  return phase === "proposal" ? "specialist" : phase === "critique" ? "critic" : null;
}

function normalizeSpeaker(input, leadId, specialistIds) {
  const speaker = isRecord(input) ? input : { mode: "lead", memberId: leadId };
  const mode = asText(speaker.mode || "lead").trim();
  const memberId = identifier(speaker.memberId || leadId, "speaker member id");
  if (mode === "lead" && memberId !== leadId) throw new CouncilError("SPEAKER_NOT_LEAD", "lead speaker must match leadId");
  if (mode === "approved-specialist" && !specialistIds.includes(memberId)) {
    throw new CouncilError("SPEAKER_NOT_SPECIALIST", "approved specialist speaker must be a listed specialist");
  }
  if (!new Set(["lead", "approved-specialist"]).has(mode)) throw new TypeError("speaker mode must be lead or approved-specialist");
  return deepFreeze({ mode, memberId });
}

function normalizeTask(input, registry, limits, now) {
  const id = identifier(input.id, "task id");
  const prompt = cleanText(input.prompt, limits.maxPromptChars, "task prompt", { required: true });
  const leadId = identifier(input.leadId, "lead id");
  const specialistIds = uniqueStrings(input.specialistIds, limits.maxMembers, "specialist ids");
  const criticIds = uniqueStrings(input.criticIds, limits.maxMembers, "critic ids");
  const participantIds = [...new Set([leadId, ...specialistIds, ...criticIds])];
  if (participantIds.length > limits.maxMembers) throw new CouncilError("MEMBER_LIMIT", "task has too many participants");
  const lead = registry.requireMember(leadId);
  if (lead.role !== "lead") throw new CouncilError("LEAD_ROLE_REQUIRED", "leadId must reference a lead member");
  for (const memberId of specialistIds) {
    if (registry.requireMember(memberId).role !== "specialist") throw new CouncilError("SPECIALIST_ROLE_REQUIRED", `${memberId} must be a specialist`);
  }
  for (const memberId of criticIds) {
    if (registry.requireMember(memberId).role !== "critic") throw new CouncilError("CRITIC_ROLE_REQUIRED", `${memberId} must be a critic`);
  }

  const rawConsent = isRecord(input.consent) ? input.consent : {};
  const approvedMemberIds = uniqueStrings(rawConsent.approvedMemberIds, limits.maxMembers, "consent.approvedMemberIds");
  const capabilitiesByMember = normalizeMapOfArrays(rawConsent.capabilitiesByMember, "consent.capabilitiesByMember", assertCapabilityList);
  const actionCapabilitiesByMember = normalizeMapOfArrays(rawConsent.actionCapabilitiesByMember, "consent.actionCapabilitiesByMember");
  const contextScopesByMember = normalizeMapOfArrays(rawConsent.contextScopesByMember, "consent.contextScopesByMember");
  const consent = {
    granted: rawConsent.granted === true,
    approvedBy: cleanText(rawConsent.approvedBy || "", 96, "consent.approvedBy"),
    approvedAt: cleanText(rawConsent.approvedAt || nowIso(now), 64, "consent.approvedAt", { required: true }),
    approvedMemberIds,
    approvedSpeakerId: rawConsent.approvedSpeakerId ? identifier(rawConsent.approvedSpeakerId, "consent.approvedSpeakerId") : null,
    capabilitiesByMember,
    actionCapabilitiesByMember,
    contextScopesByMember,
  };
  const speaker = normalizeSpeaker(input.speaker, leadId, specialistIds);
  if (speaker.mode === "approved-specialist" && consent.approvedSpeakerId !== speaker.memberId) {
    throw new CouncilError("SPEAKER_CONSENT_REQUIRED", "specialist speaker requires explicit approvedSpeakerId consent");
  }
  const maxRounds = integer(input.maxRounds, limits.maxRounds, 1, limits.maxRounds, "maxRounds");
  const budget = normalizeBudget(input.budget, limits);
  return deepFreeze({
    id,
    prompt,
    leadId,
    specialistIds,
    criticIds,
    speaker,
    consent: deepFreeze(consent),
    context: deepFreeze(sanitizeTaskContext(input.context, limits.maxContextChars)),
    budget,
    maxRounds,
    delegation: normalizeDelegation(input.delegation, limits),
    createdAt: nowIso(now),
  });
}

function contributionForInput(contribution) {
  return deepFreeze({
    contributionId: contribution.contributionId,
    memberId: contribution.provenance.memberId,
    role: contribution.provenance.role,
    phase: contribution.provenance.phase,
    text: contribution.text,
    claims: contribution.claims,
    unknowns: contribution.unknowns,
    actionRequests: contribution.actionRequests.map((request) => ({
      action: request.action,
      effectKey: request.effectKey,
      status: request.status,
    })),
    provenance: {
      contributionId: contribution.contributionId,
      memberId: contribution.provenance.memberId,
      phase: contribution.provenance.phase,
      parentContributionIds: [...contribution.provenance.parentContributionIds],
    },
  });
}

function normalizeClaims(value, limits) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return [];
  return value.slice(0, limits.maxClaimsPerContribution).map((claim, index) => {
    if (!isRecord(claim)) return null;
    const statement = cleanText(claim.statement || claim.text || "", 280, `claim ${index}`, { required: true });
    const stance = ["support", "oppose", "uncertain"].includes(asText(claim.stance)) ? asText(claim.stance) : "uncertain";
    return {
      id: cleanText(claim.id || `claim:${hash(statement)}`, 96, "claim id", { required: true }),
      statement,
      stance,
      confidence: fraction(claim.confidence),
      evidenceRefs: uniqueStrings(claim.evidenceRefs, 8, "claim evidence refs"),
    };
  }).filter(Boolean);
}

function normalizeActionRequests(value, member, task, limits) {
  if (!Array.isArray(value)) return [];
  const taskAllowed = task.consent.actionCapabilitiesByMember[member.id] || [];
  const effectiveTools = new Set(member.effectiveToolCapabilities);
  const seen = new Set();
  return value.slice(0, limits.maxActionRequestsPerContribution).map((request, index) => {
    if (!isRecord(request)) return null;
    const action = cleanText(request.action || "", 96, `action ${index}`, { required: true });
    const params = safeJson(request.params || {});
    const effectKey = cleanText(request.effectKey || `${action}:${hash(JSON.stringify(params))}`, 180, "action effect key", { required: true });
    const duplicate = seen.has(effectKey);
    seen.add(effectKey);
    let status = "proposal-only";
    let reason = null;
    if (!effectiveTools.has(action) || !taskAllowed.includes(action)) {
      status = "rejected";
      reason = "action-capability-not-approved";
    } else if (duplicate) {
      status = "duplicate-effect-request";
      reason = "duplicate-effect-key";
    }
    return { action, params, effectKey, status, reason, executed: false };
  }).filter(Boolean);
}

function normalizeDelegations(value, member, task, limits) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limits.maxDelegationRequestsPerContribution).map((request, index) => {
    if (!isRecord(request)) return null;
    const targetMemberId = cleanText(request.targetMemberId || request.target || "", 96, `delegation ${index} target`, { required: true });
    const path = uniqueStrings(request.path, 16, "delegation path");
    let status = "rejected";
    let reason = "delegation-disabled";
    if (task.delegation.enabled) {
      const edgeAllowed = task.delegation.edges.some((edge) => edge.from === member.id && edge.to === targetMemberId);
      if (!task.consent.approvedMemberIds.includes(targetMemberId)) reason = "unapproved-member";
      else if (path.includes(targetMemberId) || targetMemberId === member.id) reason = "cycle-detected";
      else if (!edgeAllowed) reason = "delegation-edge-not-approved";
      else if (path.length >= task.delegation.maxDepth) reason = "delegation-depth-limit";
      else {
        status = "accepted-for-review";
        reason = null;
      }
    }
    return {
      targetMemberId,
      reason: cleanText(request.reason || "", 240, "delegation reason"),
      path,
      status,
      rejectionReason: reason,
      scheduled: false,
    };
  }).filter(Boolean);
}

function normalizeAdapterResponse(raw, member, task, phase, limits) {
  const value = isRecord(raw) ? raw : { text: raw };
  const responseEnvelope = Array.isArray(value.responses) ? value.responses.slice(0, 4) : null;
  const primary = responseEnvelope && isRecord(responseEnvelope[0]) ? responseEnvelope[0] : value;
  const text = cleanText(primary.text || "", limits.maxContributionChars, "adapter text");
  const claims = normalizeClaims(primary.claims, limits);
  const unknowns = Array.isArray(primary.unknowns)
    ? primary.unknowns.slice(0, limits.maxUnknownsPerContribution).map((item) => cleanText(item, 280, "unknown")).filter(Boolean)
    : [];
  const securityRequests = [];
  for (const field of ["permissions", "grantPermissions", "capabilities", "budget", "toolCalls", "credentials", "secrets"]) {
    if (primary[field] !== undefined) securityRequests.push({ field, status: "ignored-untrusted-input" });
  }
  const actionRequests = normalizeActionRequests(primary.actionRequests, member, task, limits);
  const delegationRequests = normalizeDelegations(primary.delegationRequests, member, task, limits);
  const usage = isRecord(primary.usage) ? {
    outputTokens: Math.max(0, Math.min(100000, Number.isInteger(primary.usage.outputTokens) ? primary.usage.outputTokens : 0)),
    costUnits: Math.max(0, Math.min(100000, Number.isInteger(primary.usage.costUnits) ? primary.usage.costUnits : 0)),
  } : { outputTokens: 0, costUnits: 0 };
  const responseId = cleanText(primary.responseId || primary.idempotencyKey || "", 160, "response id");
  const duplicateResponseIds = responseEnvelope
    ? responseEnvelope.slice(1).map((item) => cleanText(item?.responseId || item?.idempotencyKey || responseId, 160, "duplicate response id"))
    : [];
  return {
    text,
    claims,
    unknowns,
    actionRequests,
    delegationRequests,
    securityRequests,
    usage,
    responseId,
    duplicateResponseIds,
    fingerprint: hash(JSON.stringify({ phase, text, claims, unknowns, actionRequests, delegationRequests })),
  };
}

function emptyReview() {
  return { disagreements: [], unknowns: [], agreementWarnings: [], similarVotesNotProof: true };
}

function buildReview(contributions, records) {
  const claimMap = new Map();
  const unknowns = new Set();
  for (const contribution of contributions) {
    contribution.unknowns.forEach((unknown) => unknowns.add(unknown));
    for (const claim of contribution.claims) {
      const key = claim.id || `statement:${hash(claim.statement.toLowerCase())}`;
      if (!claimMap.has(key)) claimMap.set(key, { claimId: key, statements: new Map(), stances: new Map(), contributors: [] });
      const entry = claimMap.get(key);
      entry.statements.set(claim.statement, (entry.statements.get(claim.statement) || 0) + 1);
      entry.stances.set(claim.stance, (entry.stances.get(claim.stance) || 0) + 1);
      entry.contributors.push({ memberId: contribution.provenance.memberId, independenceGroup: contribution.provenance.independenceGroup, contributionId: contribution.contributionId, stance: claim.stance });
    }
  }
  const disagreements = [];
  const agreementWarnings = [];
  for (const entry of claimMap.values()) {
    const stances = [...entry.stances.keys()];
    const groups = new Set(entry.contributors.map((item) => item.independenceGroup));
    if (stances.includes("support") && stances.includes("oppose")) {
      disagreements.push({
        claimId: entry.claimId,
        statements: [...entry.statements.entries()].map(([statement, count]) => ({ statement, count })),
        contributors: entry.contributors,
        status: "disputed",
        verified: false,
      });
    } else if (entry.contributors.length > 1 && groups.size === 1) {
      agreementWarnings.push({
        claimId: entry.claimId,
        contributors: entry.contributors,
        independenceGroups: [...groups],
        warning: "similar-bot agreement is not proof of truth",
      });
    }
  }
  for (const record of records) {
    if (["failure", "timeout", "fenced", "skipped"].includes(record.status)) {
      unknowns.add(`${record.phase}:${record.memberId}:${record.reason || record.status}`);
    }
  }
  return {
    disagreements,
    unknowns: [...unknowns].slice(0, 64),
    agreementWarnings,
    similarVotesNotProof: true,
    claimCount: claimMap.size,
    verifiedClaimCount: 0,
  };
}

function runWithConcurrency(items, limit, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(items[index], index);
    }
  });
  return Promise.all(runners).then(() => output);
}

function invokeWithTimeout(fn, args, timeoutMs, onLate) {
  let timedOut = false;
  let settled = false;
  let timer = null;
  const work = Promise.resolve().then(fn);
  const observedWork = work.then(
    (value) => {
      if (timedOut || settled) onLate("resolved");
      return { kind: "ok", value };
    },
    (error) => {
      if (timedOut || settled) onLate("rejected");
      return { kind: "error", error };
    },
  );
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      try { args.signal.abort?.(); } catch { /* adapter may ignore abort */ }
      resolve({ kind: "timeout" });
    }, timeoutMs);
  });
  return Promise.race([observedWork, timeout]).finally(() => {
    settled = true;
    if (timer) clearTimeout(timer);
  });
}

function sameStringSet(left = [], right = []) {
  const a = [...new Set(left)].sort();
  const b = [...new Set(right)].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function createUnavailableProviderAdapter({ provider, reason = "manual setup required" } = {}) {
  const providerId = cleanText(provider, 96, "provider", { required: true });
  const explanation = cleanText(reason, 240, "provider reason", { required: true });
  return deepFreeze({
    provider: providerId,
    status: "unavailable",
    simulation: false,
    async propose() { throw new CouncilError("PROVIDER_NOT_CONNECTED", `${providerId} is unavailable: ${explanation}`); },
    async critique() { throw new CouncilError("PROVIDER_NOT_CONNECTED", `${providerId} is unavailable: ${explanation}`); },
    async synthesize() { throw new CouncilError("PROVIDER_NOT_CONNECTED", `${providerId} is unavailable: ${explanation}`); },
  });
}

export function createCouncilOrchestrator({ authority, registry = null, adapters = {}, now = null, limits = {} } = {}) {
  const memberRegistry = registry || createCouncilMemberRegistry({ authority, now });
  const effectiveLimits = deepFreeze({
    ...COUNCIL_DEFAULT_LIMITS,
    ...Object.fromEntries(Object.entries(limits).map(([key, value]) => [key, Number(value)])),
  });
  if (!Number.isInteger(effectiveLimits.maxConcurrency) || effectiveLimits.maxConcurrency < 1) throw new TypeError("maxConcurrency must be positive");
  if (!Number.isInteger(effectiveLimits.maxRounds) || effectiveLimits.maxRounds < 1) throw new TypeError("maxRounds must be positive");
  const tasks = new Map();
  const runs = new Map();
  let taskCounter = 0;
  let runCounter = 0;

  function createTask(input = {}) {
    const taskInput = { ...input, id: input.id || `task:${(++taskCounter).toString(36)}` };
    if (tasks.has(taskInput.id)) throw new CouncilError("TASK_EXISTS", `task ${taskInput.id} already exists`);
    const task = normalizeTask(taskInput, memberRegistry, effectiveLimits, now);
    tasks.set(task.id, task);
    return task;
  }

  function taskGate(task, memberId, phase) {
    const member = memberRegistry.getMember(memberId);
    if (!member) return { ok: false, reason: "member-not-registered" };
    if (!task.consent.granted) return { ok: false, reason: "task-consent-required", member };
    if (!task.consent.approvedMemberIds.includes(memberId)) return { ok: false, reason: "member-not-approved-for-task", member };
    if (!member.userConsent) return { ok: false, reason: "member-consent-required", member };
    if (!member.enabled) return { ok: false, reason: member.revoked ? "member-revoked" : "member-disabled", member };
    const expectedRole = expectedRoleForPhase(phase);
    if (expectedRole && member.role !== expectedRole) return { ok: false, reason: `role-not-allowed:${expectedRole}`, member };
    if (phase === "synthesis") {
      const selectedMode = task.speaker.mode;
      const selectedRole = selectedMode === "lead" ? "lead" : "specialist";
      if (member.role !== selectedRole) return { ok: false, reason: `speaker-role-not-allowed:${selectedRole}`, member };
    }
    const capability = COUNCIL_PHASE_CAPABILITIES[phase];
    if (!member.councilCapabilities.includes(capability)) return { ok: false, reason: "member-capability-not-approved", member };
    if (!(task.consent.capabilitiesByMember[memberId] || []).includes(capability)) return { ok: false, reason: "task-capability-not-approved", member };
    return { ok: true, member, epoch: member.epoch };
  }

  function reservationFor(task, member) {
    return {
      tokens: Math.max(1, Math.min(task.budget.effective.maxTokensPerCall, member.maxOutputTokens || task.budget.effective.maxTokensPerCall)),
      costUnits: Math.max(1, Math.min(task.budget.effective.maxCostUnitsPerCall, member.costUnits || task.budget.effective.maxCostUnitsPerCall)),
    };
  }

  function makeRecord(run, phase, memberId, status, reason = null, extra = {}) {
    return {
      invocationId: extra.invocationId || `invoke:${run.runId}:${phase}:${memberId}:${run.records.length.toString(36)}`,
      taskId: run.task.id,
      runId: run.runId,
      phase,
      round: phaseRound(phase),
      memberId,
      status,
      reason,
      at: nowIso(now),
      ...extra,
    };
  }

  function isCurrent(run, memberId, epoch, expectedEffectiveToolCapabilities = []) {
    if (run.cancelled) return { ok: false, reason: "run-cancelled" };
    if (run.revokedMembers.has(memberId)) return { ok: false, reason: "member-revoked-in-flight" };
    const member = memberRegistry.getMember(memberId);
    if (!member || !member.enabled || !member.userConsent) return { ok: false, reason: "member-revoked-in-flight" };
    if (member.epoch !== epoch) return { ok: false, reason: "member-epoch-changed" };
    if (!sameStringSet(member.effectiveToolCapabilities, expectedEffectiveToolCapabilities)) {
      return { ok: false, reason: "authority-capabilities-changed" };
    }
    return { ok: true };
  }

  function staleContributionReason(run, contribution) {
    const memberId = contribution.provenance.memberId;
    if (run.cancelled) return "run-cancelled";
    if (run.revokedMembers.has(memberId)) return "member-revoked-in-flight";
    const member = memberRegistry.getMember(memberId);
    if (!member) return "member-not-registered";
    if (member.revoked) return "member-revoked-in-flight";
    if (!member.userConsent) return "member-consent-revoked";
    if (!member.enabled) return "member-disabled";
    if (member.epoch !== contribution.provenance.memberEpochAtAdmission) return "member-epoch-changed";
    const expected = contribution.provenance.effectiveToolCapabilitiesAtAdmission || [];
    if (!sameStringSet(member.effectiveToolCapabilities, expected)) return "authority-capabilities-changed";
    return null;
  }

  function fenceStaleContributions(run) {
    for (const contribution of run.contributions) {
      if (run.fencedContributionIds.has(contribution.contributionId)) continue;
      const reason = staleContributionReason(run, contribution);
      if (!reason) continue;
      run.fencedContributionIds.add(contribution.contributionId);
      run.fencedContributionReasons.set(contribution.contributionId, reason);
      for (const record of run.records) {
        if (record.contribution?.contributionId !== contribution.contributionId) continue;
        delete record.contribution;
        record.fencedContributionId = contribution.contributionId;
        record.fencedContribution = true;
        record.fenceReason = reason;
      }
      run.records.push(makeRecord(
        run,
        contribution.provenance.phase,
        contribution.provenance.memberId,
        "fenced",
        reason,
        {
          contributionId: contribution.contributionId,
          staleContributionFence: true,
          staleAuthorityFence: reason === "authority-capabilities-changed",
        },
      ));
      run.events.push({
        type: "stale-contribution-fenced",
        contributionId: contribution.contributionId,
        memberId: contribution.provenance.memberId,
        reason,
        at: nowIso(now),
      });
    }
  }

  function activeContributions(run) {
    fenceStaleContributions(run);
    return run.contributions.filter((contribution) => !run.fencedContributionIds.has(contribution.contributionId));
  }

  async function invokeMember(run, phase, memberId) {
    const gate = taskGate(run.task, memberId, phase);
    const invocationId = `invoke:${run.runId}:${phase}:${memberId}:${run.records.length.toString(36)}`;
    if (!gate.ok) return makeRecord(run, phase, memberId, "skipped", gate.reason, { invocationId });
    if (run.task.maxRounds < phaseRound(phase)) return makeRecord(run, phase, memberId, "skipped", "round-limit", { invocationId });
    if (run.cancelled) return makeRecord(run, phase, memberId, "fenced", "run-cancelled", { invocationId });
    const member = gate.member;
    const baselineCapabilities = run.memberCapabilityBaselines.get(memberId) || [];
    if (!sameStringSet(member.effectiveToolCapabilities, baselineCapabilities)) {
      run.events.push({ type: "authority-capabilities-fenced", invocationId, memberId, phase, at: nowIso(now) });
      return makeRecord(run, phase, memberId, "fenced", "authority-capabilities-changed", { invocationId });
    }
    const reservation = reservationFor(run.task, member);
    if (run.budget.tokensRemaining < reservation.tokens || run.budget.costRemaining < reservation.costUnits) {
      run.budget.exhausted = true;
      return makeRecord(run, phase, memberId, "skipped", "budget-exhausted", { invocationId, reservation });
    }
    run.budget.tokensRemaining -= reservation.tokens;
    run.budget.costRemaining -= reservation.costUnits;
    run.budget.reservedTokens += reservation.tokens;
    run.budget.reservedCostUnits += reservation.costUnits;
    const adapter = adapters[memberId] || adapters[member.connectionStatus] || null;
    const method = adapter?.[ADAPTER_METHODS[phase]];
    if (typeof method !== "function") return makeRecord(run, phase, memberId, "failure", "adapter-unavailable", { invocationId, reservation });
    const controller = new AbortController();
    run.controllers.add(controller);
    const context = contextForMember(run.task, member, effectiveLimits);
    const prior = phase === "critique"
      ? activeContributions(run).filter((entry) => entry.provenance.phase === "proposal").map(contributionForInput)
      : phase === "synthesis"
        ? activeContributions(run).map(contributionForInput)
        : [];
    const args = {
      invocationId,
      task: publicTask(run.task),
      phase,
      round: phaseRound(phase),
      member: publicMember(member),
      context,
      inputs: deepFreeze({ contributions: prior, review: phase === "synthesis" ? buildReview(activeContributions(run), run.records) : null }),
      budget: deepFreeze({ maxOutputTokens: reservation.tokens, maxCostUnits: reservation.costUnits }),
      signal: controller.signal,
    };
    let response;
    try {
      response = await invokeWithTimeout(
        () => method(args),
        { signal: controller },
        effectiveLimits.requestTimeoutMs,
        (lateKind) => run.events.push({ type: "late-result-fenced", invocationId, memberId, phase, lateKind, at: nowIso(now) }),
      );
    } finally {
      run.controllers.delete(controller);
    }
    if (response.kind === "timeout") return makeRecord(run, phase, memberId, "timeout", "adapter-timeout", { invocationId, reservation, lateResultFence: true });
    if (response.kind === "error") {
      const current = isCurrent(run, memberId, gate.epoch, gate.member.effectiveToolCapabilities);
      if (!current.ok && current.reason === "authority-capabilities-changed") {
        run.events.push({ type: "authority-capabilities-fenced", invocationId, memberId, phase, at: nowIso(now) });
      }
      return makeRecord(run, phase, memberId, current.ok ? "failure" : "fenced", current.ok ? "adapter-failure" : current.reason, {
        invocationId,
        reservation,
        detail: cleanText(response.error?.message || response.error || "adapter failure", 240, "adapter failure"),
      });
    }
    const current = isCurrent(run, memberId, gate.epoch, gate.member.effectiveToolCapabilities);
    if (!current.ok) {
      if (current.reason === "authority-capabilities-changed") {
        run.events.push({ type: "authority-capabilities-fenced", invocationId, memberId, phase, at: nowIso(now) });
      }
      return makeRecord(run, phase, memberId, "fenced", current.reason, { invocationId, reservation });
    }
    let normalized;
    try {
      normalized = normalizeAdapterResponse(response.value, member, run.task, phase, effectiveLimits);
    } catch (error) {
      return makeRecord(run, phase, memberId, "failure", "invalid-adapter-response", { invocationId, reservation, detail: cleanText(error?.message, 240, "adapter response") });
    }
    const responseKey = `${memberId}:${phase}:${normalized.responseId || normalized.fingerprint}`;
    if (run.seenResponses.has(responseKey)) return makeRecord(run, phase, memberId, "duplicate", "duplicate-response", { invocationId, reservation, responseKey });
    run.seenResponses.add(responseKey);
    const contributionId = `contribution:${run.runId}:${run.contributions.length.toString(36)}`;
    const contribution = deepFreeze({
      contributionId,
      text: normalized.text,
      claims: normalized.claims,
      unknowns: normalized.unknowns,
      actionRequests: normalized.actionRequests,
      delegationRequests: normalized.delegationRequests,
      securityRequests: normalized.securityRequests,
      usage: {
        reportedTokens: Math.min(normalized.usage.outputTokens, reservation.tokens),
        reportedCostUnits: Math.min(normalized.usage.costUnits, reservation.costUnits),
        reservedTokens: reservation.tokens,
        reservedCostUnits: reservation.costUnits,
      },
      provenance: {
        contributionId,
        taskId: run.task.id,
        runId: run.runId,
        memberId,
        memberName: member.name,
        role: member.role,
        independenceGroup: member.independenceGroup,
        phase,
        round: phaseRound(phase),
        adapter: cleanText(adapter.provider || adapter.id || "mock-adapter", 96, "adapter id"),
        responseId: normalized.responseId || null,
        contextScopes: [...(args.context.scopes || [])],
        memberEpochAtAdmission: member.epoch,
        effectiveToolCapabilitiesAtAdmission: [...member.effectiveToolCapabilities],
        parentContributionIds: prior.map((entry) => entry.contributionId),
        untrusted: true,
        simulation: true,
        receivedAt: nowIso(now),
      },
    });
    const duplicateRecords = normalized.duplicateResponseIds.map((duplicateResponseId) => makeRecord(
      run,
      phase,
      memberId,
      "duplicate",
      "duplicate-response",
      { invocationId, reservation, responseKey: `${memberId}:${phase}:${duplicateResponseId}` },
    ));
    return makeRecord(run, phase, memberId, "accepted", null, { invocationId, reservation, contribution, duplicateRecords });
  }

  async function runPhase(run, phase, memberIds) {
    if (run.cancelled) return [];
    fenceStaleContributions(run);
    const ids = [...new Set(memberIds)];
    const results = await runWithConcurrency(ids, effectiveLimits.maxConcurrency, (memberId) => invokeMember(run, phase, memberId));
    for (const result of results) {
      run.records.push(result);
      if (result.duplicateRecords) run.records.push(...result.duplicateRecords);
      if (result.status === "accepted" && result.contribution) run.contributions.push(result.contribution);
    }
    return results;
  }

  function collectActionRequests(contributions) {
    const requests = [];
    const effects = new Set();
    for (const contribution of contributions) {
      for (const request of contribution.actionRequests) {
        const duplicate = effects.has(request.effectKey);
        effects.add(request.effectKey);
        requests.push({
          ...request,
          status: duplicate ? "duplicate-effect-request" : request.status,
          reason: duplicate ? "duplicate-effect-key" : request.reason,
          sourceContributionId: contribution.contributionId,
          sourceMemberId: contribution.provenance.memberId,
          executed: false,
        });
      }
    }
    return requests;
  }

  async function executeRun(run) {
    const task = run.task;
    const proposalResults = await runPhase(run, "proposal", task.specialistIds);
    if (!run.cancelled) await runPhase(run, "critique", task.criticIds);
    const reviewBeforeSynthesis = buildReview(activeContributions(run), run.records);
    let synthesisResults = [];
    if (!run.cancelled) synthesisResults = await runPhase(run, "synthesis", [task.speaker.memberId]);
    const currentContributions = activeContributions(run);
    const synthesis = currentContributions.find((entry) => entry.provenance.phase === "synthesis" && entry.provenance.memberId === task.speaker.memberId) || null;
    const status = run.cancelled
      ? "cancelled"
      : synthesis
        ? (run.records.some((record) => ["failure", "timeout", "fenced"].includes(record.status)) ? "partial" : "completed")
        : (run.records.some((record) => record.reason === "task-consent-required" || record.reason === "member-not-approved-for-task") ? "blocked" : "partial");
    const review = buildReview(currentContributions, run.records);
    const fencedContributions = run.contributions
      .filter((entry) => run.fencedContributionIds.has(entry.contributionId))
      .map((entry) => ({
        contributionId: entry.contributionId,
        memberId: entry.provenance.memberId,
        phase: entry.provenance.phase,
        reason: run.fencedContributionReasons.get(entry.contributionId) || "stale-contribution",
      }));
    const summarizePhaseRecord = (record) => {
      const contributionId = record.contribution?.contributionId || record.fencedContributionId;
      const fencedReason = contributionId ? run.fencedContributionReasons.get(contributionId) : null;
      return {
        memberId: record.memberId,
        status: fencedReason ? "fenced" : record.status,
        reason: fencedReason || record.reason,
      };
    };
    const finalResponse = synthesis ? {
      speakerId: task.speaker.memberId,
      speakerMode: task.speaker.mode,
      contributionId: synthesis.contributionId,
      text: synthesis.text,
      status: "selected-speaker-only",
    } : null;
    return deepFreeze({
      schemaVersion: COUNCIL_SCHEMA_VERSION,
      source: COUNCIL_SOURCE,
      simulation: true,
      deterministic: true,
      boundary: COUNCIL_BOUNDARY,
      taskId: task.id,
      runId: run.runId,
      status,
      selection: { ...task.speaker },
      proposalResults: proposalResults.map(summarizePhaseRecord),
      synthesisResults: synthesisResults.map(summarizePhaseRecord),
      finalResponse,
      contributions: currentContributions,
      provenance: currentContributions.map((entry) => entry.provenance),
      fencedContributions,
      review,
      budget: {
        configured: task.budget,
        reservedTokens: run.budget.reservedTokens,
        reservedCostUnits: run.budget.reservedCostUnits,
        remainingTokens: run.budget.tokensRemaining,
        remainingCostUnits: run.budget.costRemaining,
        exhausted: run.budget.exhausted,
      },
      pendingActionRequests: collectActionRequests(currentContributions),
      records: [...run.records],
      events: [...run.events],
      unknowns: review.unknowns,
      disagreements: review.disagreements,
      agreementWarnings: review.agreementWarnings,
      similarVotesNotProof: true,
      noExternalEffects: true,
      noCredentials: true,
      noProviderCalls: true,
      reviewBeforeSynthesis,
      completedAt: nowIso(now),
    });
  }

  function startTask(taskId) {
    const task = tasks.get(asText(taskId));
    if (!task) throw new CouncilError("TASK_NOT_FOUND", `task ${taskId} is not known`);
    const runId = `run:${(++runCounter).toString(36)}:${hash(`${task.id}:${runCounter}`)}`;
    const participantIds = [...new Set([task.leadId, ...task.specialistIds, ...task.criticIds])];
    const run = {
      runId,
      task,
      cancelled: false,
      revokedMembers: new Set(),
      controllers: new Set(),
      seenResponses: new Set(),
      fencedContributionIds: new Set(),
      fencedContributionReasons: new Map(),
      memberCapabilityBaselines: new Map(participantIds.map((memberId) => [
        memberId,
        [...(memberRegistry.getMember(memberId)?.effectiveToolCapabilities || [])],
      ])),
      contributions: [],
      records: [],
      events: [],
      budget: {
        tokensRemaining: task.budget.effective.maxTokens,
        costRemaining: task.budget.effective.maxCostUnits,
        reservedTokens: 0,
        reservedCostUnits: 0,
        exhausted: false,
      },
    };
    runs.set(runId, run);
    const promise = executeRun(run).finally(() => {
      run.finished = true;
    });
    return {
      runId,
      taskId: task.id,
      promise,
      cancel(reason = "user cancelled council run") {
        if (run.finished) return false;
        run.cancelled = true;
        run.events.push({ type: "run-cancelled", reason: cleanText(reason, 240, "cancel reason"), at: nowIso(now) });
        for (const controller of run.controllers) {
          try { controller.abort(); } catch { /* adapter may ignore abort */ }
        }
        return true;
      },
      revokeMember(memberId, reason = "user revoked member in flight") {
        if (run.finished) return false;
        const id = identifier(memberId, "revoked member id");
        run.revokedMembers.add(id);
        if (memberRegistry.getMember(id)) memberRegistry.revoke(id, reason);
        run.events.push({ type: "member-revoked", memberId: id, at: nowIso(now) });
        return true;
      },
      snapshot() {
        return deepFreeze({ runId, taskId: task.id, finished: run.finished === true, cancelled: run.cancelled, records: [...run.records] });
      },
    };
  }

  function runTask(taskId) {
    return startTask(taskId).promise;
  }

  function revokeMember(memberId, reason) {
    return memberRegistry.revoke(memberId, reason);
  }

  return deepFreeze({
    source: COUNCIL_SOURCE,
    simulation: true,
    boundary: COUNCIL_BOUNDARY,
    limits: effectiveLimits,
    registry: memberRegistry,
    createTask,
    getTask: (taskId) => tasks.get(asText(taskId)) || null,
    listTasks: () => deepFreeze([...tasks.values()]),
    startTask,
    runTask,
    revokeMember,
    getRun: (runId) => {
      const run = runs.get(asText(runId));
      return run ? deepFreeze({ runId: run.runId, taskId: run.task.id, finished: run.finished === true, cancelled: run.cancelled, records: [...run.records] }) : null;
    },
  });
}
