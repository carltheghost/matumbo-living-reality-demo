/**
 * Bot Plaza — bring-your-own-bot plugin system for Living Reality.
 *
 * Anyone can plug a bot into the world: the built-in Muse Agent, a no-code
 * bot built in the Bot Atelier, or a plugin object installed at runtime.
 * Bots chat with the user, message each other, receive world events, and —
 * only inside per-bot user-approved capabilities — DO STUFF in the world
 * through the World Action API.
 *
 * Hard boundaries (project law):
 * - 100% in-browser. No network, no tokens, no OAuth, no external bot APIs,
 *   no credentials of any kind. A bot is local code + local data.
 * - Bots are advisory/projection actors. The World Action API only drives
 *   renderer-local presentation (focus/select/open cubes, camera, feature
 *   consoles, local journal entries, local DRAFT proposals, announcements).
 * - No wallet, ledger, signing, settlement, identity authority, or external
 *   execution exists anywhere in this module.
 */

import { createMuseAgent, designFromPrompt } from "./muse-agent.js";

export const BOT_PLAZA_SCHEMA_VERSION = 1;
export const BOT_PLAZA_SOURCE = "bot-plaza";
export const BOT_PLAZA_CONSOLE_SOURCE = "bot-plaza-console";
export const BOT_PLAZA_UPDATED_AT = "2026-09-18T00:00:00.000Z";
export const BOT_PLAZA_STORAGE_KEY = "matumbo.bot-plaza.v1";
export const BOT_PLAZA_MAX_BOTS = 12;
export const BOT_PLAZA_MAX_NAME = 40;
export const BOT_PLAZA_MAX_TEXT = 500;
export const BOT_PLAZA_MAX_RULES = 24;
export const BOT_PLAZA_MAX_JOURNAL = 100;
export const BOT_PLAZA_MAX_DRAFTS = 50;
export const BOT_PLAZA_MAX_LOG = 120;
export const BOT_PLAZA_MAX_BOT_HOPS = 5;

export const BOT_PLAZA_BOUNDARY =
  "Bot Plaza runs 100% in this browser. No network, no tokens, no OAuth, no external bot APIs, no accounts. " +
  "Bots are local scripted plugins: they chat, react to world events, and act only inside capabilities you approve per bot. " +
  "World actions are renderer-local presentation only — no wallet, ledger, signing, settlement, identity authority, or external execution.";

const freeze = (value) => {
  if (Array.isArray(value)) value.forEach(freeze);
  else if (value && typeof value === "object") Object.values(value).forEach(freeze);
  return value && typeof value === "object" ? Object.freeze(value) : value;
};

function safeText(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function boundedText(value, max, field) {
  const text = safeText(value).trim().replace(/\s+/g, " ");
  if (!text) throw new TypeError(`${field} must be a non-empty string`);
  if (text.length > max) throw new TypeError(`${field} is too long (max ${max})`);
  return text;
}

/** Deterministic FNV-1a hash; same input always yields the same id. */
export function hashBotPlazaSeed(value) {
  const text = safeText(value, "bot-plaza");
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function nowIso(now) {
  try {
    const value = typeof now === "function" ? now() : now;
    if (value === null || value === undefined || value === "") return new Date().toISOString();
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  } catch {
    // Fall through; tests inject `now`.
  }
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Capability catalog: every world action maps to one capability id. A bot can
// only invoke actions whose capability the user approved for that bot.
// `chat.reply` is implicit — every enabled bot may answer messages.
// ---------------------------------------------------------------------------

export const BOT_CAPABILITIES = freeze([
  { id: "world.announce", label: "Announce", description: "Speak announcements the whole plaza can see." },
  { id: "world.message-bots", label: "Talk to bots", description: "Send messages to other bots in the plaza." },
  { id: "world.focus-cube", label: "Focus cubes", description: "Highlight a cube in the 3D world." },
  { id: "world.select-cube", label: "Select cubes", description: "Select a cube in the 3D world." },
  { id: "world.open-cube", label: "Open cubes", description: "Open a cube and reveal its interior." },
  { id: "world.move-camera", label: "Move camera", description: "Glide the camera to a new viewpoint." },
  { id: "world.launch-feature", label: "Launch features", description: "Open feature consoles by name." },
  { id: "world.post-journal", label: "Post journal entries", description: "Write entries into the plaza journal (local)." },
  { id: "world.draft-contract", label: "Draft proposals", description: "Draft meme/contract proposals from world events. Drafts only — nothing executes." },
  { id: "world.propose-contracts", label: "Propose contracts", description: "Draft structured outcome-contract proposals and bring them to you for review in the Contract Atelier. Proposals only — nothing executes until you approve them." },
]);

const CAPABILITY_IDS = new Set(BOT_CAPABILITIES.map((entry) => entry.id));

// World actions and the capability each one requires.
export const BOT_WORLD_ACTIONS = freeze({
  "world.announce": { capability: "world.announce", params: ["text"] },
  "world.focus-cube": { capability: "world.focus-cube", params: ["cubeId"] },
  "world.select-cube": { capability: "world.select-cube", params: ["cubeId"] },
  "world.open-cube": { capability: "world.open-cube", params: ["cubeId"] },
  "world.move-camera": { capability: "world.move-camera", params: ["x", "y", "z"] },
  "world.launch-feature": { capability: "world.launch-feature", params: ["featureId"] },
  "world.post-journal": { capability: "world.post-journal", params: ["text"] },
  "world.draft-contract": { capability: "world.draft-contract", params: ["title", "body"] },
  "world.propose-contract": {
    capability: "world.propose-contracts",
    params: ["title", "eventLabel", "outcomes", "minStake", "maxStake", "sourceNotes", "researchNotes", "expiresMinutes"],
  },
});

export const BOT_WORLD_EVENT_TYPES = freeze([
  "feature.entered",
  "cube.selected",
  "cube.opened",
  "journal.committed",
  "chat.message",
  "bot.joined",
  "bot.enabled",
  "bot.disabled",
]);

const WORLD_EVENT_TYPES = new Set(BOT_WORLD_EVENT_TYPES);

export const BOT_AVATARS = freeze([
  { id: "you-photo-mascot", label: "You · photo mascot", kind: "image", src: "assets/avatar/photo-mascot/tumbo-hoodie.png" },
  { id: "orb-teal", label: "Teal orb", kind: "orb", color: "#2fe8d4" },
  { id: "orb-violet", label: "Violet orb", kind: "orb", color: "#8b46ff" },
  { id: "orb-gold", label: "Gold orb", kind: "orb", color: "#ffd166" },
  { id: "orb-rose", label: "Rose orb", kind: "orb", color: "#ff6f85" },
  { id: "avatar-bust", label: "maTumbo portrait", kind: "image", src: "assets/avatar/ai/media-generation-avatar-bust-portrait-0-3449d6c0-4b91-456d-93ee-1f0693803645.webp" },
  { id: "avatar-full", label: "maTumbo full look", kind: "image", src: "assets/avatar/avatar.webp" },
  { id: "piece-pawn", label: "Pawn piece", kind: "image", src: "assets/avatar/piece-pawn.webp" },
  { id: "piece-queen", label: "Queen piece", kind: "image", src: "assets/avatar/piece-queen.webp" },
]);

const AVATAR_IDS = new Set(BOT_AVATARS.map((entry) => entry.id));

function validAvatar(avatarId) {
  return AVATAR_IDS.has(safeText(avatarId)) ? safeText(avatarId) : "orb-teal";
}

// ---------------------------------------------------------------------------
// Plugin interface validation. A bot plugin is:
// { id, name, avatar, version, description?, capabilities: [...],
//   onMessage(ctx, msg), onEvent?(ctx, event) }
// ---------------------------------------------------------------------------

const BOT_ID_PATTERN = /^[a-z0-9-]{1,32}$/;

export function validateBotPlugin(plugin) {
  if (!plugin || typeof plugin !== "object" || Array.isArray(plugin)) {
    throw new TypeError("bot plugin must be an object");
  }
  const id = safeText(plugin.id).trim().toLowerCase();
  if (!BOT_ID_PATTERN.test(id)) throw new TypeError("bot plugin id must be 1-32 lowercase letters, digits, or dashes");
  const name = boundedText(plugin.name, BOT_PLAZA_MAX_NAME, "bot plugin name");
  const version = safeText(plugin.version ?? "1.0.0").trim().slice(0, 24) || "1.0.0";
  const description = safeText(plugin.description ?? "").trim().replace(/\s+/g, " ").slice(0, 280);
  if (!Array.isArray(plugin.capabilities)) throw new TypeError("bot plugin capabilities must be an array");
  const capabilities = [...new Set(plugin.capabilities.map((entry) => safeText(entry).trim()))];
  for (const capability of capabilities) {
    if (!CAPABILITY_IDS.has(capability)) throw new TypeError(`unknown capability: ${capability}`);
  }
  if (typeof plugin.onMessage !== "function") throw new TypeError("bot plugin onMessage must be a function");
  if (plugin.onEvent !== undefined && plugin.onEvent !== null && typeof plugin.onEvent !== "function") {
    throw new TypeError("bot plugin onEvent must be a function");
  }
  return freeze({
    id,
    name,
    avatar: validAvatar(plugin.avatar),
    version,
    description,
    capabilities,
    onMessage: plugin.onMessage,
    onEvent: plugin.onEvent ?? null,
  });
}

// ---------------------------------------------------------------------------
// Bot Atelier: no-code bot authoring. Rules compile into a plugin.
// rule = { trigger: {kind:'message-contains'|'message-matches'|'world-event',
//                     text?, eventType?},
//          reply: template, actions?: [{action, params}] }
// Templates: {user} {bot} {event} {text}
// ---------------------------------------------------------------------------

const ATELIER_TRIGGER_KINDS = new Set(["message-contains", "message-matches", "world-event"]);

export function validateAtelierRule(rule) {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) throw new TypeError("atelier rule must be an object");
  const trigger = rule.trigger;
  if (!trigger || typeof trigger !== "object") throw new TypeError("atelier rule needs a trigger");
  const kind = safeText(trigger.kind);
  if (!ATELIER_TRIGGER_KINDS.has(kind)) throw new TypeError(`unknown trigger kind: ${kind}`);
  let text = "";
  let eventType = null;
  if (kind === "world-event") {
    eventType = safeText(trigger.eventType);
    if (!WORLD_EVENT_TYPES.has(eventType)) throw new TypeError(`unknown world event type: ${eventType}`);
  } else {
    text = boundedText(trigger.text, 120, "rule match text");
    if (kind === "message-matches") {
      try {
        new RegExp(text, "i");
      } catch {
        throw new TypeError("rule match text is not a valid pattern");
      }
    }
  }
  const reply = boundedText(rule.reply, BOT_PLAZA_MAX_TEXT, "rule reply");
  const actions = [];
  for (const entry of rule.actions ?? []) {
    if (!entry || typeof entry !== "object") throw new TypeError("rule action must be an object");
    const action = safeText(entry.action);
    const spec = BOT_WORLD_ACTIONS[action];
    if (!spec) throw new TypeError(`unknown rule action: ${action}`);
    const params = {};
    for (const key of spec.params) params[key] = safeText(entry.params?.[key] ?? "").slice(0, 500);
    actions.push(freeze({ action, params: freeze(params) }));
  }
  return freeze({
    id: `rule:${hashBotPlazaSeed(`${kind}:${text}:${eventType}:${reply}`).slice(0, 8)}`,
    trigger: freeze({ kind, text, eventType }),
    reply,
    actions: freeze(actions),
  });
}

function applyTemplate(template, values) {
  return safeText(template).replace(/\{(user|bot|event|text)\}/g, (match, key) => safeText(values[key] ?? match));
}

function ruleMatchesMessage(rule, text) {
  const trigger = rule.trigger;
  if (trigger.kind === "message-contains") return safeText(text).toLowerCase().includes(trigger.text.toLowerCase());
  if (trigger.kind === "message-matches") {
    try {
      return new RegExp(trigger.text, "i").test(safeText(text));
    } catch {
      return false;
    }
  }
  return false;
}

/** Compile atelier data into a validated bot plugin (deterministic). */
export function compileAtelierBot({ name, avatar = "orb-teal", personality = "", rules = [], capabilities = [], version = "1.0.0" }) {
  const cleanName = boundedText(name, BOT_PLAZA_MAX_NAME, "bot name");
  const cleanPersonality = safeText(personality).trim().replace(/\s+/g, " ").slice(0, 500);
  if (!Array.isArray(rules)) throw new TypeError("atelier rules must be an array");
  if (rules.length > BOT_PLAZA_MAX_RULES) throw new TypeError("too many atelier rules");
  const compiled = rules.map(validateAtelierRule);
  const id = `atelier-${hashBotPlazaSeed(cleanName.toLowerCase()).slice(0, 8)}`;

  function fireRule(ctx, rule, values) {
    const text = applyTemplate(rule.reply, values);
    for (const entry of rule.actions) ctx.act(entry.action, entry.params);
    return text;
  }

  function onMessage(ctx, msg) {
    const values = { user: ctx.userName ?? "you", bot: cleanName, text: msg.text, event: "" };
    for (const rule of compiled) {
      if ((rule.trigger.kind === "message-contains" || rule.trigger.kind === "message-matches") && ruleMatchesMessage(rule, msg.text)) {
        return fireRule(ctx, rule, values);
      }
    }
    if (cleanPersonality) return `I'm ${cleanName}. ${cleanPersonality}`;
    return `I'm ${cleanName}. Teach me replies in the Bot Atelier — give me trigger words and I'll answer.`;
  }

  function onEvent(ctx, event) {
    const values = { user: ctx.userName ?? "you", bot: cleanName, text: "", event: event.type };
    for (const rule of compiled) {
      if (rule.trigger.kind === "world-event" && rule.trigger.eventType === event.type) {
        return fireRule(ctx, rule, values);
      }
    }
    return null;
  }

  return validateBotPlugin({
    id,
    name: cleanName,
    avatar: validAvatar(avatar),
    version,
    description: cleanPersonality || `A hand-built plaza bot.`,
    capabilities,
    onMessage,
    onEvent,
  });
}

// ---------------------------------------------------------------------------
// Built-in default: the Muse Agent as a plaza bot. Its design-companion
// behavior is preserved — "design: <prompt>" produces a deterministic
// local design spec, exactly like its own console.
// ---------------------------------------------------------------------------

export function createMuseAgentBotPlugin({ seed = "bot-plaza" } = {}) {
  const agent = createMuseAgent({ seed: `${seed}:plaza-bot`, storage: null });

  function onMessage(ctx, msg) {
    const text = safeText(msg.text).trim();
    const lower = text.toLowerCase();
    if (/^(design|avatar|image)\s*:/i.test(text)) {
      const kind = lower.startsWith("image") ? "image" : "avatar";
      const prompt = text.replace(/^(design|avatar|image)\s*:/i, "").trim();
      if (!prompt) return "Give me a prompt after design: — e.g. design: violet voyager emblem.";
      try {
        const spec = designFromPrompt({ kind, prompt, seed: `${seed}:plaza` });
        const draft = { ...spec, id: `plaza-design:${spec.seed.slice(0, 8)}` };
        agent.save({ ...draft, profileId: "plaza", profileName: ctx.userName ?? "you", provider: "muse", createdAt: new Date().toISOString(), applied: false });
        return `${spec.title} — ${spec.brief}`;
      } catch {
        return "That prompt didn't work — keep it under 280 characters.";
      }
    }
    if (/\bhelp\b/i.test(lower)) {
      return "I'm the Muse Agent. Say design: <your idea> and I'll compose a deterministic local design spec. I also hang out with the other bots here.";
    }
    if (/\b(hello|hi|hey|yo)\b/i.test(lower)) {
      return `Hey ${ctx.userName ?? "you"} — I'm the Muse Agent. Try design: obsidian voyager avatar.`;
    }
    if (/\bwho are you\b/i.test(lower)) {
      return "I'm the Muse Agent, a local design companion. I live in the Bot Plaza now — everything I do stays in this browser.";
    }
    return "I design things. Say design: followed by your idea, or ask for help.";
  }

  function onEvent() {
    return null;
  }

  return validateBotPlugin({
    id: "muse-agent",
    name: "Muse Agent",
    avatar: "orb-teal",
    version: "2.0.0",
    description: "The in-world design companion — deterministic local avatar and image designs. Default plaza resident.",
    capabilities: ["world.announce", "world.message-bots"],
    onMessage,
    onEvent,
  });
}

// ---------------------------------------------------------------------------
// Message bus: user↔bot, bot→user announcements, bot↔bot. Synchronous,
// in-memory, fully local. Every delivery is recorded in the activity log.
// ---------------------------------------------------------------------------

export function createMessageBus({ now = null, maxLog = BOT_PLAZA_MAX_LOG } = {}) {
  const subscribers = new Set();
  let log = [];
  let counter = 0;

  function record(entry) {
    counter += 1;
    const recordEntry = freeze({
      id: `msg:${counter.toString(36)}:${hashBotPlazaSeed(`${counter}:${entry.from}:${entry.to}:${entry.text}`).slice(0, 6)}`,
      from: safeText(entry.from),
      to: safeText(entry.to),
      text: safeText(entry.text).slice(0, BOT_PLAZA_MAX_TEXT * 2),
      kind: ["chat", "announce", "event", "system"].includes(entry.kind) ? entry.kind : "chat",
      at: nowIso(now),
    });
    log = [...log.slice(-(maxLog - 1)), recordEntry];
    for (const subscriber of [...subscribers]) {
      try {
        subscriber(recordEntry);
      } catch {
        // A failing subscriber never breaks the bus.
      }
    }
    return recordEntry;
  }

  return freeze({
    post(entry) {
      return record(entry);
    },
    subscribe(fn) {
      if (typeof fn !== "function") throw new TypeError("subscriber must be a function");
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    getLog() {
      return freeze([...log]);
    },
    clear() {
      log = [];
    },
  });
}

// ---------------------------------------------------------------------------
// Contract proposal queue: bots draft STRUCTURED outcome-contract proposals
// and bring them to the user for review (Contract Atelier → Contracts for
// your review). A proposal is not a contract: it only becomes one when the
// user approves it elsewhere. 100% local: simulated TUMBO points only, no
// network, no live sports API — bots learn about events from user chat or
// built-in local knowledge only.
// ---------------------------------------------------------------------------

export const BOT_PROPOSAL_STORAGE_KEY = "tumbo.contract-proposals.v1";
export const BOT_PROPOSAL_SCHEMA_VERSION = 1;
export const BOT_PROPOSAL_MAX_TITLE = 96;
export const BOT_PROPOSAL_MAX_EVENT_LABEL = 160;
export const BOT_PROPOSAL_MAX_EVENT_ID = 160;
export const BOT_PROPOSAL_MAX_OUTCOMES = 12;
export const BOT_PROPOSAL_MAX_OUTCOME_LABEL = 80;
export const BOT_PROPOSAL_MAX_NOTES = 2000;
export const BOT_PROPOSAL_DEFAULT_TTL_MS = 72 * 3600 * 1000; // 72h

const BOT_PROPOSAL_EVENT_ID_PATTERN = /^[a-z0-9:_.\-]{1,160}$/;
const BOT_PROPOSAL_FINAL_STATUSES = new Set(["approved", "dismissed", "expired"]);
const BOT_PROPOSAL_EDITABLE_FIELDS = new Set([
  "title", "eventLabel", "outcomes", "minStake", "maxStake", "sourceNotes", "researchNotes", "expiresAt",
]);

function proposalText(value, min, max, field) {
  const text = safeText(value).trim().replace(/\s+/g, " ");
  if (text.length < min) throw new TypeError(`${field} must be at least ${min} character${min === 1 ? "" : "s"}`);
  if (text.length > max) throw new TypeError(`${field} is too long (max ${max})`);
  return text;
}

function normalizeOutcomeLabel(value) {
  const text = safeText(value).trim().replace(/\s+/g, " ");
  if (!text) throw new TypeError("outcome labels must be non-empty");
  if (text.length > BOT_PROPOSAL_MAX_OUTCOME_LABEL) {
    throw new TypeError(`outcome label is too long (max ${BOT_PROPOSAL_MAX_OUTCOME_LABEL})`);
  }
  return text;
}

function validateProposalOutcomes(value) {
  if (!Array.isArray(value)) throw new TypeError("outcomes must be an array");
  const seen = new Set();
  const labels = [];
  for (const entry of value) {
    const label = normalizeOutcomeLabel(entry);
    const key = label.toLowerCase();
    if (seen.has(key)) throw new TypeError(`duplicate outcome: ${label}`);
    seen.add(key);
    labels.push(label);
  }
  if (labels.length < 2) throw new TypeError("a proposal needs at least 2 distinct outcomes");
  if (labels.length > BOT_PROPOSAL_MAX_OUTCOMES) throw new TypeError(`too many outcomes (max ${BOT_PROPOSAL_MAX_OUTCOMES})`);
  return labels;
}

function validateProposalStake(value, field) {
  if (value === undefined || value === null || value === "") return undefined;
  const amount = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(amount) || amount <= 0) throw new TypeError(`${field} must be a positive integer (cents)`);
  if (amount > Number.MAX_SAFE_INTEGER) throw new TypeError(`${field} is too large`);
  return amount;
}

function validateProposalEventId(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const text = safeText(value).trim();
  if (!BOT_PROPOSAL_EVENT_ID_PATTERN.test(text)) {
    throw new TypeError("eventId must be 1-160 chars of a-z 0-9 : _ . -");
  }
  return text;
}

function validateProposalNotes(value, field) {
  if (value === undefined || value === null || value === "") return undefined;
  const text = safeText(value);
  if (text.length > BOT_PROPOSAL_MAX_NOTES) throw new TypeError(`${field} is too long (max ${BOT_PROPOSAL_MAX_NOTES})`);
  return text;
}

function proposalNowMs(now) {
  const iso = nowIso(now);
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Date.now() : ms;
}

function validateProposalExpiresAt(value, now) {
  const nowMs = proposalNowMs(now);
  if (value === undefined || value === null || value === "") {
    return new Date(nowMs + BOT_PROPOSAL_DEFAULT_TTL_MS).toISOString();
  }
  const text = safeText(value).trim();
  const ms = Date.parse(text);
  if (Number.isNaN(ms)) throw new TypeError("expiresAt must be a valid ISO date string");
  if (ms <= nowMs) throw new TypeError("expiresAt must be in the future");
  return new Date(ms).toISOString();
}

function readProposalStore(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(BOT_PROPOSAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.proposals)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeProposalStore(storage, state) {
  if (!storage) return;
  try {
    storage.setItem(BOT_PROPOSAL_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode etc: the in-memory copy still works.
  }
}

export function createProposalQueue({ storage = null, now = null } = {}) {
  const store = storage ?? (() => { try { return globalThis.localStorage; } catch { return null; } })();
  const subscribers = new Set();
  let proposals = [];
  let counter = 0;

  function notify() {
    for (const subscriber of [...subscribers]) {
      try {
        subscriber();
      } catch {
        // A failing subscriber never breaks the queue.
      }
    }
  }

  function persist() {
    writeProposalStore(store, {
      schemaVersion: BOT_PROPOSAL_SCHEMA_VERSION,
      counter,
      proposals: proposals.map((proposal) => ({
        ...proposal,
        outcomes: [...proposal.outcomes],
        history: proposal.history.map((entry) => ({ ...entry })),
      })),
    });
  }

  function stamp(proposal) {
    return freeze({
      ...proposal,
      outcomes: freeze([...proposal.outcomes]),
      history: freeze(proposal.history.map((entry) => freeze({ ...entry }))),
    });
  }

  function indexOf(id) {
    return proposals.findIndex((proposal) => proposal.id === safeText(id));
  }

  function sweepExpired() {
    const nowMs = proposalNowMs(now);
    let changed = false;
    proposals = proposals.map((proposal) => {
      if (proposal.status !== "pending") return proposal;
      if (Date.parse(proposal.expiresAt) > nowMs) return proposal;
      changed = true;
      return {
        ...proposal,
        status: "expired",
        history: [...proposal.history, { status: "expired", at: nowIso(now), note: "expired without review", by: null }],
      };
    });
    if (changed) {
      persist();
      notify();
    }
    return changed;
  }

  function submitProposal({ botId, botName }, proposal) {
    if (!proposal || typeof proposal !== "object") throw new TypeError("proposal must be an object");
    const id = safeText(botId).trim();
    if (!id) throw new TypeError("proposal needs a botId");
    const title = proposalText(proposal.title, 1, BOT_PROPOSAL_MAX_TITLE, "title");
    const eventLabel = proposalText(proposal.eventLabel, 1, BOT_PROPOSAL_MAX_EVENT_LABEL, "eventLabel");
    const eventId = validateProposalEventId(proposal.eventId);
    const outcomes = validateProposalOutcomes(proposal.outcomes);
    const minStake = validateProposalStake(proposal.minStake, "minStake");
    const maxStake = validateProposalStake(proposal.maxStake, "maxStake");
    if (minStake !== undefined && maxStake !== undefined && minStake > maxStake) {
      throw new TypeError("minStake cannot be larger than maxStake");
    }
    const sourceNotes = validateProposalNotes(proposal.sourceNotes, "sourceNotes");
    const researchNotes = validateProposalNotes(proposal.researchNotes, "researchNotes");
    const expiresAt = validateProposalExpiresAt(proposal.expiresAt, now);
    counter += 1;
    const at = nowIso(now);
    const entry = {
      id: `proposal:${counter.toString(36)}:${hashBotPlazaSeed(`${counter}:${title}:${id}`).slice(0, 6)}`,
      botId: id,
      botName: safeText(botName ?? "").trim().slice(0, BOT_PLAZA_MAX_NAME) || id,
      title,
      eventLabel,
      eventId,
      outcomes,
      minStake,
      maxStake,
      sourceNotes,
      researchNotes,
      expiresAt,
      status: "pending",
      createdAt: at,
      history: [{ status: "pending", at, note: "submitted for review", by: safeText(botName ?? id).slice(0, BOT_PLAZA_MAX_NAME) }],
    };
    proposals = [...proposals, entry];
    persist();
    notify();
    return stamp(entry);
  }

  function getProposals({ status } = {}) {
    sweepExpired();
    const wanted = status === undefined || status === null ? null : safeText(status);
    if (wanted !== null && !BOT_PROPOSAL_FINAL_STATUSES.has(wanted) && wanted !== "pending") {
      throw new TypeError(`unknown proposal status: ${wanted}`);
    }
    const list = wanted === null ? proposals : proposals.filter((proposal) => proposal.status === wanted);
    return freeze(list.map(stamp));
  }

  function getProposal(id) {
    sweepExpired();
    const index = indexOf(id);
    return index < 0 ? null : stamp(proposals[index]);
  }

  function updateProposal(id, patch, { by } = {}) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new TypeError("patch must be an object");
    const index = indexOf(id);
    if (index < 0) throw new TypeError("unknown proposal id");
    const current = proposals[index];
    if (current.status !== "pending") throw new TypeError("only pending proposals can be edited");
    const fields = Object.keys(patch);
    if (!fields.length) throw new TypeError("patch is empty");
    for (const field of fields) {
      if (!BOT_PROPOSAL_EDITABLE_FIELDS.has(field)) throw new TypeError(`cannot change field: ${field}`);
    }
    const next = { ...current };
    if (fields.includes("title")) next.title = proposalText(patch.title, 1, BOT_PROPOSAL_MAX_TITLE, "title");
    if (fields.includes("eventLabel")) next.eventLabel = proposalText(patch.eventLabel, 1, BOT_PROPOSAL_MAX_EVENT_LABEL, "eventLabel");
    if (fields.includes("outcomes")) next.outcomes = validateProposalOutcomes(patch.outcomes);
    if (fields.includes("minStake")) next.minStake = validateProposalStake(patch.minStake, "minStake");
    if (fields.includes("maxStake")) next.maxStake = validateProposalStake(patch.maxStake, "maxStake");
    if (next.minStake !== undefined && next.maxStake !== undefined && next.minStake > next.maxStake) {
      throw new TypeError("minStake cannot be larger than maxStake");
    }
    if (fields.includes("sourceNotes")) next.sourceNotes = validateProposalNotes(patch.sourceNotes, "sourceNotes");
    if (fields.includes("researchNotes")) next.researchNotes = validateProposalNotes(patch.researchNotes, "researchNotes");
    if (fields.includes("expiresAt")) next.expiresAt = validateProposalExpiresAt(patch.expiresAt, now);
    next.history = [...current.history, {
      status: "pending",
      at: nowIso(now),
      note: `edited: ${fields.join(", ")}`,
      by: by === undefined || by === null ? null : safeText(by).slice(0, BOT_PLAZA_MAX_NAME),
    }];
    proposals = proposals.map((proposal, i) => (i === index ? next : proposal));
    persist();
    notify();
    return stamp(next);
  }

  function setProposalStatus(id, status, { by, note } = {}) {
    const wanted = safeText(status);
    if (!BOT_PROPOSAL_FINAL_STATUSES.has(wanted) || wanted === "expired") {
      throw new TypeError('status must be "approved" or "dismissed"');
    }
    const index = indexOf(id);
    if (index < 0) throw new TypeError("unknown proposal id");
    const current = proposals[index];
    if (current.status !== "pending") throw new TypeError("only pending proposals can be approved or dismissed");
    const entry = {
      ...current,
      status: wanted,
      history: [...current.history, {
        status: wanted,
        at: nowIso(now),
        note: safeText(note ?? "").trim().slice(0, 280) || (wanted === "approved" ? "approved by reviewer" : "dismissed by reviewer"),
        by: by === undefined || by === null ? null : safeText(by).slice(0, BOT_PLAZA_MAX_NAME),
      }],
    };
    proposals = proposals.map((proposal, i) => (i === index ? entry : proposal));
    persist();
    notify();
    return stamp(entry);
  }

  function dismissProposal(id, { by } = {}) {
    return setProposalStatus(id, "dismissed", { by });
  }

  function clear() {
    proposals = [];
    counter = 0;
    persist();
    notify();
  }

  // Restore persisted proposals; expired pendings are marked on the way in.
  const stored = readProposalStore(store);
  if (stored) {
    try {
      counter = Number.isInteger(stored.counter) && stored.counter >= 0 ? stored.counter : 0;
      proposals = stored.proposals
        .filter((entry) => entry && typeof entry.id === "string" && typeof entry.title === "string")
        .map((entry) => ({
          id: entry.id,
          botId: safeText(entry.botId),
          botName: safeText(entry.botName),
          title: entry.title,
          eventLabel: safeText(entry.eventLabel),
          eventId: entry.eventId ?? undefined,
          outcomes: Array.isArray(entry.outcomes) ? entry.outcomes.map((label) => safeText(label)) : [],
          minStake: entry.minStake,
          maxStake: entry.maxStake,
          sourceNotes: entry.sourceNotes ?? undefined,
          researchNotes: entry.researchNotes ?? undefined,
          expiresAt: entry.expiresAt,
          status: BOT_PROPOSAL_FINAL_STATUSES.has(entry.status) || entry.status === "pending" ? entry.status : "pending",
          createdAt: entry.createdAt,
          history: Array.isArray(entry.history) ? entry.history.map((item) => ({
            status: safeText(item?.status),
            at: safeText(item?.at),
            note: safeText(item?.note),
            by: item?.by ?? null,
          })) : [],
        }));
      sweepExpired();
    } catch {
      // Corrupt storage never breaks the queue; it starts clean.
    }
  }

  return freeze({
    submitProposal,
    getProposals,
    getProposal,
    updateProposal,
    setProposalStatus,
    dismissProposal,
    clear,
    subscribe(fn) {
      if (typeof fn !== "function") throw new TypeError("subscriber must be a function");
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    source: BOT_PLAZA_SOURCE,
  });
}

// ---------------------------------------------------------------------------
// Proposal review ranking: "Contracts for your review" display order.
// ---------------------------------------------------------------------------
// A proposal is review-ready when it is concrete: linked to a real event,
// with well-formed outcomes, bounded stakes, and research attached. The
// ranking is a deterministic, documented heuristic for DISPLAY ORDER ONLY —
// the queue itself keeps submission order, and the renderer falls back to
// submission order if ranking ever throws. Pure: no queue mutation.
const PROPOSAL_READINESS_WEIGHTS = freeze({
  base: 0.30, // submitted and pending review
  eventLinked: 0.25, // eventId present: a concrete event, not a vague idea
  outcomesRich: 0.15, // 3+ distinct outcomes: a well-formed market
  outcomesBinary: 0.08, // exactly 2 outcomes: reviewable, less expressive
  stakeBounds: 0.10, // minStake and/or maxStake defined
  sourceNotes: 0.08, // source notes attached
  researchNotes: 0.08, // research notes attached
  expiresSoon: 0.06, // expires within 24h of `now`: needs eyes first
});
const PROPOSAL_REVIEW_SOON_MS = 24 * 3600 * 1000;

function reviewNowMs(now) {
  if (now === null || now === undefined) return null;
  if (typeof now === "number" && Number.isFinite(now)) return now;
  if (now instanceof Date && !Number.isNaN(now.getTime())) return now.getTime();
  const ms = Date.parse(safeText(now));
  return Number.isNaN(ms) ? null : ms;
}

function scoreProposalReadiness(proposal, nowMs) {
  const reasons = ["pending review"];
  let score = PROPOSAL_READINESS_WEIGHTS.base;
  const entry = proposal && typeof proposal === "object" ? proposal : {};
  if (safeText(entry.eventId).trim()) {
    score += PROPOSAL_READINESS_WEIGHTS.eventLinked;
    reasons.push("linked to an event");
  }
  const outcomes = Array.isArray(entry.outcomes) ? entry.outcomes : [];
  if (outcomes.length >= 3) {
    score += PROPOSAL_READINESS_WEIGHTS.outcomesRich;
    reasons.push(`${outcomes.length} outcomes defined`);
  } else if (outcomes.length === 2) {
    score += PROPOSAL_READINESS_WEIGHTS.outcomesBinary;
    reasons.push("binary outcomes");
  }
  if (entry.minStake !== undefined && entry.minStake !== null
    || entry.maxStake !== undefined && entry.maxStake !== null) {
    score += PROPOSAL_READINESS_WEIGHTS.stakeBounds;
    reasons.push("stake bounds set");
  }
  if (safeText(entry.sourceNotes).trim()) {
    score += PROPOSAL_READINESS_WEIGHTS.sourceNotes;
    reasons.push("source notes attached");
  }
  if (safeText(entry.researchNotes).trim()) {
    score += PROPOSAL_READINESS_WEIGHTS.researchNotes;
    reasons.push("research notes attached");
  }
  if (nowMs !== null) {
    const expiresMs = Date.parse(safeText(entry.expiresAt));
    if (!Number.isNaN(expiresMs) && expiresMs > nowMs
      && expiresMs - nowMs <= PROPOSAL_REVIEW_SOON_MS) {
      score += PROPOSAL_READINESS_WEIGHTS.expiresSoon;
      reasons.push("expires soon");
    }
  }
  return { readiness: Math.min(1, Math.max(0, score)), reasons };
}

function proposalListFrom(source) {
  if (source && typeof source.getProposals === "function") {
    return source.getProposals({ status: "pending" });
  }
  if (Array.isArray(source)) return source;
  throw new TypeError("rankProposalsForReview needs a proposal queue or a proposal array");
}

export function rankProposalsForReview(source, { now = null } = {}) {
  const list = proposalListFrom(source);
  const nowMs = reviewNowMs(now);
  const scored = list.map((proposal, index) => {
    const { readiness, reasons } = scoreProposalReadiness(proposal, nowMs);
    const entry = proposal && typeof proposal === "object" ? proposal : {};
    return {
      proposal,
      readiness,
      reasons,
      index,
      createdAt: safeText(entry.createdAt),
      id: safeText(entry.id),
    };
  });
  scored.sort((a, b) => (
    b.readiness - a.readiness
    || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    || a.index - b.index
  ));
  return freeze(scored.map(({ proposal, readiness, reasons }) => freeze({
    proposal,
    readiness,
    reasons: freeze([...reasons]),
  })));
}

// ---------------------------------------------------------------------------
// Intent router: turns a raw user message into a typed routing decision.
// ---------------------------------------------------------------------------
// Pure text classification over the installed bots — no messages are sent,
// no capabilities are exercised, nothing executes. Ambiguity is surfaced as
// a clarification decision the renderer can ask about; the router itself
// never guesses past the evidence. A token that names a bot belongs to bot
// resolution and is never double-counted as an intent keyword.
const INTENT_ROUTER_KEYWORDS = freeze({
  draft_contract: ["contract", "contracts", "draft", "propose", "proposal"],
  scout: ["scout", "scouting", "research", "investigate"],
});
const INTENT_ROUTER_LABELS = freeze({
  draft_contract: "a contract draft",
  scout: "scouting",
});

function tokenizeRouterText(value) {
  return safeText(value).toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 2);
}

export function createIntentRouter({ registry = null, now = null } = {}) {
  if (!registry || typeof registry.listBots !== "function") {
    throw new TypeError("createIntentRouter needs a bot registry");
  }

  function matchBots(tokens, text) {
    const tokenSet = new Set(tokens);
    const lowered = safeText(text).toLowerCase();
    return registry.listBots().filter((bot) => {
      const name = safeText(bot?.name).toLowerCase();
      if (name && lowered.includes(name)) return true;
      return tokenizeRouterText(bot?.name).some((token) => token.length >= 3 && tokenSet.has(token));
    });
  }

  async function route(text) {
    const tokens = tokenizeRouterText(text);
    const matched = matchBots(tokens, text);
    const botNameTokens = new Set();
    for (const bot of matched) {
      for (const token of tokenizeRouterText(bot?.name)) botNameTokens.add(token);
    }
    const intentTokens = tokens.filter((token) => !botNameTokens.has(token));
    const hits = Object.keys(INTENT_ROUTER_KEYWORDS).filter((intent) => (
      INTENT_ROUTER_KEYWORDS[intent].some((keyword) => intentTokens.includes(keyword))
    ));
    const intent = hits.length >= 1 ? hits[0] : "chat";
    if (matched.length > 1) {
      const names = matched.map((bot) => safeText(bot?.name) || safeText(bot?.id)).join(" or ");
      return freeze({
        intent,
        botId: null,
        clarify: true,
        clarificationText: `Not sure which bot you meant — ${names}?`,
      });
    }
    if (hits.length > 1) {
      const labels = hits.map((entry) => INTENT_ROUTER_LABELS[entry] ?? entry).join(" or ");
      return freeze({
        intent,
        botId: null,
        clarify: true,
        clarificationText: `I wasn't sure what you wanted — ${labels}? Say a little more.`,
      });
    }
    return freeze({
      intent,
      botId: matched.length === 1 ? safeText(matched[0]?.id) : null,
      clarify: false,
      clarificationText: null,
    });
  }

  return freeze({ route, source: BOT_PLAZA_SOURCE });
}

// ---------------------------------------------------------------------------
// Bot Atelier templates: one-click starting points for no-code bots. A
// template pre-fills the atelier form; the user still reviews and approves
// every capability before plugging the bot in.
// ---------------------------------------------------------------------------

export const BOT_ATELIER_TEMPLATES = freeze([
  freeze({
    id: "contract-scout",
    label: "Contract scout",
    description: "Sports/events contract scout: spots contract ideas, asks for the missing details, and drafts structured outcome-contract proposals for your review.",
    prefill: freeze({
      name: "Contract Scout",
      avatar: "orb-gold",
      personality: "A sharp sports-and-events contract scout. I watch for contract ideas, ask for the missing details, and draft structured outcome-contract proposals for your review. I never fetch live data — I only use what you tell me or what I already know. Nothing executes until you approve it.",
      rules: freeze([
        freeze({
          trigger: freeze({ kind: "message-contains", text: "scout" }),
          reply: "Scouting, {user}. Give me the event, the outcomes, and a stake range — I'll draft a structured proposal you can review in the Contract Atelier.",
          actions: freeze([]),
        }),
        freeze({
          trigger: freeze({ kind: "message-contains", text: "contract" }),
          reply: "On it, {user}. Tell me: which event, which outcomes, and a stake range — or say “scout it” and I'll draft a proposal from what you've told me.",
          actions: freeze([]),
        }),
        freeze({
          trigger: freeze({ kind: "world-event", eventType: "journal.committed" }),
          reply: "Saw the journal land — if that's an event worth a contract, say “scout it” and I'll draft a proposal for your review.",
          actions: freeze([]),
        }),
      ]),
      capabilities: freeze(["world.propose-contracts", "world.post-journal", "world.message-bots"]),
    }),
  }),
]);

export function getAtelierTemplate(id) {
  const template = BOT_ATELIER_TEMPLATES.find((entry) => entry.id === safeText(id));
  return template ?? null;
}

// ---------------------------------------------------------------------------
// World Action API: capability-gated. Handlers are injected by the host
// (renderer wiring); in tests they are mocks. An action outside the bot's
// approved capabilities is refused — never executed.
// ---------------------------------------------------------------------------

export function createWorldActionExecutor({ handlers = {} } = {}) {
  function execute({ botId, approvedCapabilities, action, params = {} }) {
    const spec = BOT_WORLD_ACTIONS[action];
    if (!spec) return freeze({ ok: false, reason: "unknown-action", action });
    if (!approvedCapabilities.includes(spec.capability)) {
      return freeze({ ok: false, reason: "capability-not-approved", action, capability: spec.capability });
    }
    const handler = handlers[action];
    if (typeof handler !== "function") {
      return freeze({ ok: false, reason: "no-handler", action });
    }
    try {
      const cleaned = {};
      for (const key of spec.params) cleaned[key] = safeText(params[key] ?? "");
      const result = handler({ botId, params: freeze(cleaned) });
      return freeze({ ok: true, action, result: result ?? null });
    } catch (error) {
      return freeze({ ok: false, reason: "handler-error", action, detail: safeText(error?.message).slice(0, 200) });
    }
  }

  return freeze({ execute });
}

// ---------------------------------------------------------------------------
// Registry: install / enable / disable / remove + per-bot capability
// approval, persisted to localStorage (functions never persist).
// ---------------------------------------------------------------------------

function readStored(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(BOT_PLAZA_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.bots)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStored(storage, state) {
  if (!storage) return;
  try {
    storage.setItem(BOT_PLAZA_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode etc: the session copy still works.
  }
}

export function createBotRegistry({ storage = null, now = null } = {}) {
  const store = storage ?? (() => { try { return globalThis.localStorage; } catch { return null; } })();
  const bots = new Map(); // id -> { record, plugin }
  const stored = readStored(store);

  function persist() {
    writeStored(store, {
      schemaVersion: BOT_PLAZA_SCHEMA_VERSION,
      bots: [...bots.values()].map(({ record }) => record).filter((record) => record.persisted),
    });
  }

  function recordOf(plugin, { kind, approvedCapabilities, enabled, persisted, atelierData = null }) {
    return freeze({
      id: plugin.id,
      name: plugin.name,
      avatar: plugin.avatar,
      version: plugin.version,
      description: plugin.description,
      kind,
      declaredCapabilities: plugin.capabilities,
      approvedCapabilities: freeze([...new Set(approvedCapabilities.filter((entry) => plugin.capabilities.includes(entry)))]),
      enabled: enabled !== false,
      persisted: persisted !== false,
      createdAt: nowIso(now),
      atelierData: atelierData ? freeze(atelierData) : null,
    });
  }

  function install(plugin, { kind = "plugin", approvedCapabilities = [], enabled = true, persisted = true, atelierData = null } = {}) {
    const valid = validateBotPlugin(plugin);
    if (bots.size >= BOT_PLAZA_MAX_BOTS && !bots.has(valid.id)) throw new TypeError("bot plaza is full");
    if (!["builtin", "atelier", "plugin"].includes(kind)) throw new TypeError("unknown bot kind");
    bots.set(valid.id, { record: recordOf(valid, { kind, approvedCapabilities, enabled, persisted, atelierData }), plugin: valid });
    persist();
    return getBot(valid.id);
  }

  function installAtelierBot(data, { approvedCapabilities = [], enabled = true } = {}) {
    const plugin = compileAtelierBot(data);
    const atelierData = freeze({
      name: plugin.name,
      avatar: plugin.avatar,
      personality: safeText(data.personality).trim().replace(/\s+/g, " ").slice(0, 500),
      rules: (data.rules ?? []).map(validateAtelierRule).map((rule) => ({
        trigger: { ...rule.trigger },
        reply: rule.reply,
        actions: rule.actions.map((entry) => ({ action: entry.action, params: { ...entry.params } })),
      })),
      capabilities: [...plugin.capabilities],
      version: plugin.version,
    });
    return install(plugin, { kind: "atelier", approvedCapabilities, enabled, persisted: true, atelierData });
  }

  function remove(id) {
    const key = safeText(id);
    const entry = bots.get(key);
    if (!entry) throw new TypeError("unknown bot id");
    if (entry.record.kind === "builtin") throw new TypeError("the built-in bot cannot be removed");
    bots.delete(key);
    persist();
    return true;
  }

  function setEnabled(id, enabled) {
    const entry = bots.get(safeText(id));
    if (!entry) throw new TypeError("unknown bot id");
    bots.set(entry.record.id, { ...entry, record: freeze({ ...entry.record, enabled: enabled === true }) });
    persist();
    return getBot(entry.record.id);
  }

  function approveCapabilities(id, capabilities) {
    const entry = bots.get(safeText(id));
    if (!entry) throw new TypeError("unknown bot id");
    const approved = [...new Set((capabilities ?? []).map((c) => safeText(c)))].filter((c) => entry.plugin.capabilities.includes(c));
    bots.set(entry.record.id, { ...entry, record: freeze({ ...entry.record, approvedCapabilities: freeze(approved) }) });
    persist();
    return getBot(entry.record.id);
  }

  function getBot(id) {
    const entry = bots.get(safeText(id));
    if (!entry) return null;
    return freeze({ ...entry.record });
  }

  function getPlugin(id) {
    return bots.get(safeText(id))?.plugin ?? null;
  }

  function listBots() {
    return freeze([...bots.values()].map(({ record }) => freeze({ ...record })));
  }

  function listEnabled() {
    return freeze(listBots().filter((record) => record.enabled));
  }

  // Restore persisted bots. Builtins recompile from their factory; atelier
  // bots recompile from stored data. Session-only plugins are not restored.
  if (stored) {
    try {
      for (const record of stored.bots.slice(0, BOT_PLAZA_MAX_BOTS)) {
        if (!record || typeof record.id !== "string") continue;
        try {
          if (record.kind === "builtin" && record.id === "muse-agent") {
            const plugin = createMuseAgentBotPlugin();
            bots.set(plugin.id, { record: recordOf(plugin, { kind: "builtin", approvedCapabilities: record.approvedCapabilities ?? [], enabled: record.enabled !== false, persisted: true }), plugin });
          } else if (record.kind === "atelier" && record.atelierData) {
            const plugin = compileAtelierBot({ ...record.atelierData, capabilities: record.atelierData.capabilities ?? [] });
            bots.set(plugin.id, { record: recordOf(plugin, { kind: "atelier", approvedCapabilities: record.approvedCapabilities ?? [], enabled: record.enabled !== false, persisted: true, atelierData: record.atelierData }), plugin });
          }
        } catch {
          // A bot that no longer compiles is skipped, never fatal.
        }
      }
    } catch {
      // Corrupt storage never breaks the plaza; it starts clean.
    }
  }

  if (!bots.has("muse-agent")) {
    install(createMuseAgentBotPlugin(), { kind: "builtin", approvedCapabilities: ["world.announce", "world.message-bots"], enabled: true, persisted: true });
  }

  return freeze({
    install,
    installAtelierBot,
    remove,
    setEnabled,
    approveCapabilities,
    getBot,
    getPlugin,
    listBots,
    listEnabled,
    source: BOT_PLAZA_SOURCE,
  });
}

// ---------------------------------------------------------------------------
// Runtime: routes user messages to bots, delivers bot-to-bot messages,
// publishes world events, and hosts the plaza journal + contract drafts.
// ---------------------------------------------------------------------------

export function createBotRuntime({ registry, bus = null, actionExecutor = null, actionHandlers = {}, now = null, userName = "you", proposalQueue = null, onProposal = null } = {}) {
  if (!registry) throw new TypeError("bot runtime needs a registry");
  const messageBus = bus ?? createMessageBus({ now });
  const contractQueue = proposalQueue ?? createProposalQueue({ now });
  const proposalHandler = typeof onProposal === "function" ? onProposal : null;
  const executor = actionExecutor ?? createWorldActionExecutor({
    handlers: {
      "world.post-journal": ({ botId, params }) => postJournalEntry(botId, params.text),
      "world.draft-contract": ({ botId, params }) => draftContractProposal(botId, params),
      "world.propose-contract": ({ botId, params }) => proposeContractProposal(botId, params),
      ...actionHandlers,
    },
  });
  let journal = [];
  let drafts = [];
  let journalCounter = 0;
  let draftCounter = 0;

  function activity(kind, from, to, text) {
    return messageBus.post({ from, to, text, kind });
  }

  function makeCtx(bot, { from = "user", depth = 0 } = {}) {
    const approved = bot.approvedCapabilities;
    return freeze({
      bot: freeze({ id: bot.id, name: bot.name }),
      userName,
      reply(text) {
        const clean = boundedText(text, BOT_PLAZA_MAX_TEXT * 2, "reply");
        return messageBus.post({ from: bot.id, to: from === "user" ? "user" : from, text: clean, kind: "chat" });
      },
      send(targetBotId, text) {
        if (!approved.includes("world.message-bots")) {
          activity("system", bot.id, "plaza", `${bot.name} tried to message another bot without the Talk to bots capability.`);
          return null;
        }
        const clean = boundedText(text, BOT_PLAZA_MAX_TEXT * 2, "bot message");
        return tellBot(targetBotId, clean, { from: bot.id, depth: depth + 1 });
      },
      announce(text) {
        const clean = boundedText(text, BOT_PLAZA_MAX_TEXT * 2, "announcement");
        const result = executor.execute({ botId: bot.id, approvedCapabilities: approved, action: "world.announce", params: { text: clean } });
        if (result.ok) messageBus.post({ from: bot.id, to: "plaza", text: clean, kind: "announce" });
        return result;
      },
      act(action, params) {
        const result = executor.execute({ botId: bot.id, approvedCapabilities: approved, action, params });
        activity("system", bot.id, "plaza",
          result.ok ? `${bot.name} did ${action}.` : `${bot.name} tried ${action} — ${result.reason}.`);
        return result;
      },
      journal(text) {
        return postJournalEntry(bot.id, text);
      },
      draftContract({ title, body, fromEvent = null }) {
        return draftContractProposal(bot.id, { title, body, fromEvent });
      },
    });
  }

  function tellBot(botId, text, { from = "user", depth = 0 } = {}) {
    const id = safeText(botId);
    if (depth > BOT_PLAZA_MAX_BOT_HOPS) {
      activity("system", id, "plaza", "A bot conversation chain hit the hop limit and stopped.");
      return null;
    }
    const bot = registry.getBot(id);
    const plugin = registry.getPlugin(id);
    if (!bot || !plugin) {
      if (from === "user") activity("system", "plaza", "user", `No bot named "${id}" is here.`);
      return null;
    }
    if (!bot.enabled) {
      if (from === "user") activity("system", "plaza", "user", `${bot.name} is disabled right now.`);
      return null;
    }
    const clean = safeText(text).slice(0, BOT_PLAZA_MAX_TEXT * 2);
    if (from === "user") messageBus.post({ from: "user", to: id, text: clean, kind: "chat" });
    else messageBus.post({ from, to: id, text: clean, kind: "chat" });
    const ctx = makeCtx(bot, { from, depth });
    try {
      const reply = plugin.onMessage(ctx, freeze({ from, to: id, text: clean, at: nowIso(now) }));
      if (typeof reply === "string" && reply.trim()) ctx.reply(reply);
      return freeze({ ok: true, bot: id });
    } catch (error) {
      activity("system", id, "plaza", `${bot.name} stumbled: ${safeText(error?.message).slice(0, 120)}`);
      return freeze({ ok: false, bot: id, reason: "bot-error" });
    }
  }

  function publishWorldEvent(type, payload = {}) {
    const eventType = safeText(type);
    if (!WORLD_EVENT_TYPES.has(eventType)) throw new TypeError(`unknown world event type: ${eventType}`);
    const event = freeze({ type: eventType, payload: freeze({ ...(payload ?? {}) }), at: nowIso(now) });
    activity("event", "world", "plaza", `${eventType}`);
    for (const bot of registry.listEnabled()) {
      const plugin = registry.getPlugin(bot.id);
      if (!plugin?.onEvent) continue;
      const ctx = makeCtx(bot, { from: "world" });
      try {
        const reply = plugin.onEvent(ctx, event);
        if (typeof reply === "string" && reply.trim()) {
          messageBus.post({ from: bot.id, to: "plaza", text: reply, kind: "event" });
        }
      } catch {
        // One bot's event handler never breaks the plaza.
      }
    }
    return event;
  }

  function postJournalEntry(botId, text) {
    const bot = registry.getBot(safeText(botId));
    if (!bot) throw new TypeError("unknown bot id");
    if (!bot.approvedCapabilities.includes("world.post-journal")) {
      return freeze({ ok: false, reason: "capability-not-approved", capability: "world.post-journal" });
    }
    const entry = recordJournalEntry(bot.id, bot.name, text);
    if (!entry) throw new TypeError("journal entry text is invalid");
    return freeze({ ok: true, entry });
  }

  // The runtime's own bookkeeping write — not a bot action, so it never goes
  // through the capability gate (e.g. a contract-scout that proposed a
  // contract announces it in the journal without needing world.post-journal).
  function recordJournalEntry(botId, botName, text) {
    let clean;
    try {
      clean = boundedText(text, BOT_PLAZA_MAX_TEXT * 2, "journal entry");
    } catch {
      return null;
    }
    journalCounter += 1;
    const entry = freeze({
      id: `journal:${journalCounter.toString(36)}:${hashBotPlazaSeed(`${journalCounter}:${clean}`).slice(0, 6)}`,
      botId: safeText(botId),
      botName: safeText(botName),
      text: clean,
      at: nowIso(now),
    });
    journal = [...journal.slice(-(BOT_PLAZA_MAX_JOURNAL - 1)), entry];
    activity("event", safeText(botId), "plaza", `${safeText(botName)} posted a journal entry.`);
    return entry;
  }

  function draftContractProposal(botId, { title, body, fromEvent = null }) {
    const bot = registry.getBot(safeText(botId));
    if (!bot) throw new TypeError("unknown bot id");
    if (!bot.approvedCapabilities.includes("world.draft-contract")) {
      return freeze({ ok: false, reason: "capability-not-approved", capability: "world.draft-contract" });
    }
    const cleanTitle = boundedText(title, 120, "draft title");
    const cleanBody = boundedText(body, BOT_PLAZA_MAX_TEXT * 2, "draft body");
    draftCounter += 1;
    const draft = freeze({
      id: `draft:${draftCounter.toString(36)}:${hashBotPlazaSeed(`${draftCounter}:${cleanTitle}`).slice(0, 6)}`,
      botId: bot.id,
      botName: bot.name,
      title: cleanTitle,
      body: cleanBody,
      fromEvent: fromEvent ? safeText(fromEvent).slice(0, 120) : null,
      status: "draft",
      at: nowIso(now),
    });
    drafts = [...drafts.slice(-(BOT_PLAZA_MAX_DRAFTS - 1)), draft];
    activity("event", bot.id, "plaza", `${bot.name} drafted a proposal: ${cleanTitle} (DRAFT — nothing executes).`);
    return freeze({ ok: true, draft });
  }

  // -------------------------------------------------------------------------
  // world.propose-contract: a bot drafts a STRUCTURED outcome-contract
  // proposal and brings it to the user for review. String params come in
  // from the World Action API; outcomes arrive comma/semicolon-separated.
  // Bots learn about events from user chat or built-in local knowledge —
  // this path never calls a sports API or any network.
  // -------------------------------------------------------------------------

  function parseProposalOutcomesParam(value) {
    const raw = Array.isArray(value) ? value : safeText(value).split(/[,;]/);
    return raw.map((entry) => safeText(entry).trim().replace(/\s+/g, " ")).filter((entry) => entry.length > 0);
  }

  function parseProposalStakeParam(value) {
    const text = safeText(value).trim();
    if (!text) return undefined;
    const amount = Number(text);
    if (!Number.isInteger(amount) || amount <= 0) throw new TypeError("stake must be a positive integer (cents)");
    return amount;
  }

  function parseExpiresMinutesParam(value) {
    const text = safeText(value).trim();
    if (!text) return 4320; // default: 72h
    const minutes = Number(text);
    if (!Number.isInteger(minutes)) throw new TypeError("expiresMinutes must be an integer");
    return Math.min(43200, Math.max(5, minutes)); // clamp 5m .. 30d
  }

  function proposeContractProposal(botId, params) {
    const bot = registry.getBot(safeText(botId));
    if (!bot) throw new TypeError("unknown bot id");
    if (!bot.approvedCapabilities.includes("world.propose-contracts")) {
      return freeze({ ok: false, reason: "capability-not-approved", capability: "world.propose-contracts" });
    }
    let draft;
    try {
      const title = safeText(params?.title).trim();
      if (!title) throw new TypeError("title is required");
      const eventLabel = safeText(params?.eventLabel).trim();
      if (!eventLabel) throw new TypeError("eventLabel is required");
      const outcomes = parseProposalOutcomesParam(params?.outcomes);
      const minStake = parseProposalStakeParam(params?.minStake);
      const maxStake = parseProposalStakeParam(params?.maxStake);
      const sourceNotes = safeText(params?.sourceNotes ?? "").trim() || undefined;
      const researchNotes = safeText(params?.researchNotes ?? "").trim() || undefined;
      const expiresMinutes = parseExpiresMinutesParam(params?.expiresMinutes);
      draft = {
        title,
        eventLabel,
        eventId: safeText(params?.eventId ?? "").trim() || undefined,
        outcomes,
        minStake,
        maxStake,
        sourceNotes,
        researchNotes,
        expiresAt: new Date(proposalNowMs(now) + expiresMinutes * 60 * 1000).toISOString(),
      };
    } catch (error) {
      return freeze({ ok: false, reason: "invalid-params", detail: safeText(error?.message).slice(0, 200) });
    }
    let proposal;
    try {
      proposal = contractQueue.submitProposal({ botId: bot.id, botName: bot.name }, draft);
    } catch (error) {
      return freeze({ ok: false, reason: "invalid-params", detail: safeText(error?.message).slice(0, 200) });
    }
    activity("event", bot.id, "plaza", `${bot.name} proposed a contract for your review: ${proposal.title}`);
    recordJournalEntry(bot.id, bot.name, `proposed a contract for your review: ${proposal.title}`);
    if (proposalHandler) {
      try {
        proposalHandler(proposal, freeze({ botId: bot.id, botName: bot.name }));
      } catch {
        // A host notification failure never fails the proposal.
      }
    }
    return freeze({ ok: true, proposal });
  }

  function getJournal() {
    return freeze([...journal]);
  }

  function getDrafts() {
    return freeze([...drafts]);
  }

  return freeze({
    tellBot,
    publishWorldEvent,
    postJournalEntry,
    draftContractProposal,
    getJournal,
    getDrafts,
    getProposalQueue: () => contractQueue,
    getBus: () => messageBus,
    source: BOT_PLAZA_SOURCE,
  });
}

// ---------------------------------------------------------------------------
// Projection contribution (typed, per INTERFACES.md freeze).
// ---------------------------------------------------------------------------

export function createBotPlazaContribution({ registry = null, updatedAt = BOT_PLAZA_UPDATED_AT } = {}) {
  const bots = registry ? registry.listBots() : [];
  return freeze({
    schemaVersion: BOT_PLAZA_SCHEMA_VERSION,
    source: BOT_PLAZA_SOURCE,
    updatedAt,
    simulation: true,
    localOnly: true,
    deterministic: true,
    entities: bots.map((bot) => ({
      id: bot.id,
      kind: "plaza-bot",
      label: bot.name,
      enabled: bot.enabled,
      avatar: bot.avatar,
      simulation: true,
    })),
    evidence: [{
      id: "bot-plaza:local-bots",
      kind: "local-bot-registry",
      botIds: bots.map((bot) => bot.id),
      status: "local",
    }],
    capabilities: [
      { id: "bot-plaza.chat", mode: "local", authority: "none", executable: false },
      { id: "bot-plaza.world-actions", mode: "capability-gated-local", authority: "none", executable: false },
    ],
    boundary: BOT_PLAZA_BOUNDARY,
  });
}

export default createBotRegistry;
