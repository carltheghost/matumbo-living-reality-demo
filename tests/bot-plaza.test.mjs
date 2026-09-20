import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BOT_ATELIER_TEMPLATES,
  BOT_CAPABILITIES,
  BOT_PLAZA_BOUNDARY,
  BOT_PLAZA_MAX_BOT_HOPS,
  BOT_WORLD_ACTIONS,
  BOT_WORLD_EVENT_TYPES,
  compileAtelierBot,
  createBotRegistry,
  createBotRuntime,
  createMessageBus,
  createMuseAgentBotPlugin,
  createProposalQueue,
  createWorldActionExecutor,
  createIntentRouter,
  getAtelierTemplate,
  rankProposalsForReview,
  validateAtelierRule,
  validateBotPlugin,
} from "../src/domains/bot-plaza.js";
import { createBotPlazaConsole } from "../src/render/bot-plaza.js";

const FIXED_NOW = "2026-09-18T12:00:00.000Z";
const now = () => FIXED_NOW;

function fakeStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
  };
}

function echoPlugin(overrides = {}) {
  return {
    id: "echo-bot",
    name: "Echo",
    avatar: "orb-violet",
    version: "1.0.0",
    capabilities: ["world.announce", "world.message-bots"],
    onMessage: (ctx, msg) => `echo: ${msg.text}`,
    onEvent: () => null,
    ...overrides,
  };
}

function registryWith(storage = fakeStorage()) {
  const registry = createBotRegistry({ storage, now });
  const bus = createMessageBus({ now });
  const runtime = createBotRuntime({ registry, bus, now });
  return { registry, bus, runtime, storage };
}

// ---------------------------------------------------------------------------
// Plugin validation
// ---------------------------------------------------------------------------

test("validateBotPlugin accepts a well-formed plugin", () => {
  const plugin = validateBotPlugin(echoPlugin());
  assert.equal(plugin.id, "echo-bot");
  assert.equal(plugin.name, "Echo");
  assert.ok(Object.isFrozen(plugin));
});

test("validateBotPlugin rejects malformed plugins", () => {
  assert.throws(() => validateBotPlugin(null), TypeError);
  assert.throws(() => validateBotPlugin({ ...echoPlugin(), id: "Bad ID!" }), TypeError);
  assert.throws(() => validateBotPlugin({ ...echoPlugin(), name: "  " }), TypeError);
  assert.throws(() => validateBotPlugin({ ...echoPlugin(), capabilities: ["world.fly"] }), TypeError);
  assert.throws(() => validateBotPlugin({ ...echoPlugin(), onMessage: "nope" }), TypeError);
  assert.throws(() => validateBotPlugin({ ...echoPlugin(), onEvent: 42 }), TypeError);
  // Unknown avatar falls back to the default orb instead of throwing.
  assert.equal(validateBotPlugin({ ...echoPlugin(), avatar: "nope" }).avatar, "orb-teal");
});

// ---------------------------------------------------------------------------
// Registry: install / enable / disable / remove + capability approval
// ---------------------------------------------------------------------------

test("registry ships the built-in Muse Agent enabled by default", () => {
  const { registry } = registryWith();
  const bot = registry.getBot("muse-agent");
  assert.ok(bot, "muse-agent present");
  assert.equal(bot.enabled, true);
  assert.equal(bot.kind, "builtin");
  assert.deepEqual(bot.approvedCapabilities, ["world.announce", "world.message-bots"]);
});

test("registry install / enable / disable / remove", () => {
  const { registry } = registryWith();
  const installed = registry.install(echoPlugin(), { approvedCapabilities: ["world.announce"] });
  assert.equal(installed.enabled, true);
  assert.deepEqual(installed.approvedCapabilities, ["world.announce"]);
  // Approving an undeclared capability is silently dropped.
  const approved = registry.approveCapabilities("echo-bot", ["world.announce", "world.launch-feature"]);
  assert.deepEqual(approved.approvedCapabilities, ["world.announce"]);
  registry.setEnabled("echo-bot", false);
  assert.equal(registry.getBot("echo-bot").enabled, false);
  assert.equal(registry.listEnabled().some((bot) => bot.id === "echo-bot"), false);
  registry.setEnabled("echo-bot", true);
  assert.equal(registry.remove("echo-bot"), true);
  assert.equal(registry.getBot("echo-bot"), null);
  assert.throws(() => registry.remove("muse-agent"), TypeError);
  assert.throws(() => registry.setEnabled("ghost", true), TypeError);
});

test("registry persists bots across restarts (round-trip)", () => {
  const storage = fakeStorage();
  const first = createBotRegistry({ storage, now });
  first.installAtelierBot({
    name: "Helper",
    avatar: "orb-gold",
    personality: "Cheerful helper.",
    rules: [{ trigger: { kind: "message-contains", text: "hello" }, reply: "Hi {user}!", actions: [] }],
    capabilities: ["world.announce"],
  }, { approvedCapabilities: ["world.announce"], enabled: true });
  first.setEnabled("muse-agent", false);

  const second = createBotRegistry({ storage, now });
  const helper = second.listBots().find((bot) => bot.name === "Helper");
  assert.ok(helper, "atelier bot restored");
  assert.equal(helper.kind, "atelier");
  assert.equal(helper.enabled, true);
  assert.deepEqual(helper.approvedCapabilities, ["world.announce"]);
  assert.equal(second.getBot("muse-agent").enabled, false);
  // The restored atelier bot still answers from its rules.
  const runtime = createBotRuntime({ registry: second, now });
  runtime.tellBot(helper.id, "well hello there", { from: "user" });
  const log = runtime.getBus().getLog();
  assert.ok(log.some((entry) => entry.from === helper.id && entry.text === "Hi you!"));
});

// ---------------------------------------------------------------------------
// Message routing: user→bot and bot→bot
// ---------------------------------------------------------------------------

test("user→bot routing delivers messages and records replies", () => {
  const { runtime, bus } = registryWith();
  runtime.tellBot("muse-agent", "design: violet voyager emblem", { from: "user" });
  const log = bus.getLog();
  assert.ok(log.some((entry) => entry.from === "user" && entry.to === "muse-agent"));
  const reply = log.find((entry) => entry.from === "muse-agent" && entry.to === "user");
  assert.ok(reply, "bot replied to the user");
  assert.match(reply.text, /Violet/i);
});

test("bot→bot messaging works with the capability, blocked without it", () => {
  const { registry, runtime, bus } = registryWith();
  registry.install(echoPlugin({ id: "chatter", name: "Chatter", onMessage: (ctx, msg) => { ctx.send("muse-agent", "hey muse"); return null; } }),
    { approvedCapabilities: ["world.message-bots"] });
  registry.install(echoPlugin({ id: "quiet", name: "Quiet", onMessage: (ctx) => { ctx.send("muse-agent", "you can't hear me"); return null; } }),
    { approvedCapabilities: [] });
  runtime.tellBot("chatter", "go", { from: "user" });
  runtime.tellBot("quiet", "go", { from: "user" });
  const log = bus.getLog();
  assert.ok(log.some((entry) => entry.from === "chatter" && entry.to === "muse-agent"), "bot-to-bot delivered");
  assert.ok(log.some((entry) => entry.kind === "system" && /without the Talk to bots capability/.test(entry.text)),
    "missing capability is reported, not executed");
  assert.ok(!log.some((entry) => entry.from === "quiet" && entry.to === "muse-agent"), "blocked message never delivered");
});

test("bot-to-bot chains stop at the hop limit", () => {
  const { registry, runtime, bus } = registryWith();
  const pinger = (id, target) => echoPlugin({
    id, name: id,
    onMessage: (ctx) => { ctx.send(target, "ping"); return null; },
  });
  registry.install(pinger("ping-a", "ping-b"), { approvedCapabilities: ["world.message-bots"] });
  registry.install(pinger("ping-b", "ping-a"), { approvedCapabilities: ["world.message-bots"] });
  runtime.tellBot("ping-a", "start", { from: "user" });
  const deliveries = bus.getLog().filter((entry) => entry.kind === "chat" && entry.from !== "user").length;
  assert.ok(deliveries <= BOT_PLAZA_MAX_BOT_HOPS + 2, `chain bounded (saw ${deliveries})`);
  assert.ok(bus.getLog().some((entry) => /hop limit/.test(entry.text)));
});

test("a failing bot never breaks the plaza", () => {
  const { registry, runtime, bus } = registryWith();
  registry.install(echoPlugin({ id: "crash", name: "Crash", onMessage: () => { throw new Error("boom"); } }));
  const result = runtime.tellBot("crash", "hello", { from: "user" });
  assert.equal(result.ok, false);
  assert.ok(bus.getLog().some((entry) => entry.kind === "system" && /stumbled/.test(entry.text)));
});

// ---------------------------------------------------------------------------
// Capability gating on the World Action API
// ---------------------------------------------------------------------------

test("world actions require the approved capability", () => {
  const seen = [];
  const executor = createWorldActionExecutor({ handlers: { "world.announce": ({ params }) => { seen.push(params.text); return "ok"; } } });
  const denied = executor.execute({ botId: "b", approvedCapabilities: [], action: "world.announce", params: { text: "hi" } });
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, "capability-not-approved");
  assert.equal(seen.length, 0);
  const allowed = executor.execute({ botId: "b", approvedCapabilities: ["world.announce"], action: "world.announce", params: { text: "hi" } });
  assert.equal(allowed.ok, true);
  assert.deepEqual(seen, ["hi"]);
  assert.equal(executor.execute({ botId: "b", approvedCapabilities: [], action: "world.fly" }).reason, "unknown-action");
  assert.equal(executor.execute({ botId: "b", approvedCapabilities: ["world.focus-cube"], action: "world.focus-cube" }).reason, "no-handler");
});

test("bot ctx.act is gated the same way", () => {
  const { registry, runtime, bus } = registryWith();
  const calls = [];
  const gated = createWorldActionExecutor({ handlers: { "world.focus-cube": ({ params }) => { calls.push(params.cubeId); } } });
  const runtime2 = createBotRuntime({ registry, bus, actionExecutor: gated, now });
  registry.install(echoPlugin({
    id: "doer", name: "Doer",
    onMessage: (ctx) => { ctx.act("world.focus-cube", { cubeId: "arena" }); return "done"; },
  }), { approvedCapabilities: [] });
  runtime2.tellBot("doer", "go", { from: "user" });
  assert.equal(calls.length, 0, "unapproved action never reached the handler");
  assert.ok(bus.getLog().some((entry) => /capability-not-approved/.test(entry.text)));
});

// ---------------------------------------------------------------------------
// Atelier rule engine
// ---------------------------------------------------------------------------

test("validateAtelierRule rejects bad triggers and actions", () => {
  assert.throws(() => validateAtelierRule({ trigger: { kind: "nope" }, reply: "hi" }), TypeError);
  assert.throws(() => validateAtelierRule({ trigger: { kind: "world-event", eventType: "nope" }, reply: "hi" }), TypeError);
  assert.throws(() => validateAtelierRule({ trigger: { kind: "message-matches", text: "(unclosed" }, reply: "hi" }), TypeError);
  assert.throws(() => validateAtelierRule({ trigger: { kind: "message-contains", text: "hi" }, reply: "   " }), TypeError);
  assert.throws(() => validateAtelierRule({
    trigger: { kind: "message-contains", text: "hi" }, reply: "yo",
    actions: [{ action: "world.fly", params: {} }],
  }), TypeError);
});

test("atelier bot answers from rules and fires rule actions", () => {
  const { registry, runtime, bus } = registryWith();
  const fired = [];
  const gated = createWorldActionExecutor({ handlers: { "world.announce": ({ params }) => { fired.push(params.text); } } });
  const runtime2 = createBotRuntime({ registry, bus, actionExecutor: gated, now });
  const bot = registry.installAtelierBot({
    name: "Greeter",
    personality: "Warm.",
    rules: [{
      trigger: { kind: "message-contains", text: "hello" },
      reply: "Hey {user}! Welcome to the plaza.",
      actions: [{ action: "world.announce", params: { text: "Everyone say hi!" } }],
    }],
    capabilities: ["world.announce"],
  }, { approvedCapabilities: ["world.announce"] });
  runtime2.tellBot(bot.id, "well HELLO there", { from: "user" });
  const log = bus.getLog();
  assert.ok(log.some((entry) => entry.from === bot.id && entry.text === "Hey you! Welcome to the plaza."), "template reply with {user}");
  assert.deepEqual(fired, ["Everyone say hi!"], "rule action executed through the gate");
  // No rule matches → personality fallback.
  runtime2.tellBot(bot.id, "something random", { from: "user" });
  assert.ok(bus.getLog().some((entry) => entry.from === bot.id && /I'm Greeter\. Warm\./.test(entry.text)));
});

test("atelier bot reacts to world events", () => {
  const { registry, runtime, bus } = registryWith();
  const bot = registry.installAtelierBot({
    name: "Watcher",
    rules: [{
      trigger: { kind: "world-event", eventType: "feature.entered" },
      reply: "Ooh, {event} happened.",
      actions: [],
    }],
    capabilities: [],
  });
  runtime.publishWorldEvent("feature.entered", { featureId: "arena" });
  assert.ok(bus.getLog().some((entry) => entry.from === bot.id && entry.text === "Ooh, feature.entered happened."));
  assert.throws(() => runtime.publishWorldEvent("not-a-real-event"), TypeError);
});

test("compileAtelierBot ids are deterministic", () => {
  const a = compileAtelierBot({ name: "Same", rules: [] });
  const b = compileAtelierBot({ name: "Same", rules: [] });
  assert.equal(a.id, b.id);
});

// ---------------------------------------------------------------------------
// Journal + drafts (capability-gated, local)
// ---------------------------------------------------------------------------

test("journal posts and contract drafts are gated and local", () => {
  const { registry, runtime } = registryWith();
  const bot = registry.installAtelierBot({ name: "Scribe", rules: [], capabilities: ["world.post-journal", "world.draft-contract"] },
    { approvedCapabilities: ["world.post-journal"] });
  const posted = runtime.postJournalEntry(bot.id, "Today the plaza was quiet.");
  assert.equal(posted.ok, true);
  assert.equal(runtime.getJournal().length, 1);
  const draftDenied = runtime.draftContractProposal(bot.id, { title: "T", body: "B" });
  assert.equal(draftDenied.ok, false);
  assert.equal(draftDenied.reason, "capability-not-approved");
  registry.approveCapabilities(bot.id, ["world.post-journal", "world.draft-contract"]);
  const drafted = runtime.draftContractProposal(bot.id, { title: "Meme Monday", body: "A proposal.", fromEvent: "feature.entered" });
  assert.equal(drafted.ok, true);
  assert.equal(drafted.draft.status, "draft");
  assert.equal(runtime.getDrafts().length, 1);
});

// ---------------------------------------------------------------------------
// Built-in Muse Agent bot
// ---------------------------------------------------------------------------

test("muse agent bot answers design prompts deterministically", () => {
  const a = createMuseAgentBotPlugin();
  const b = createMuseAgentBotPlugin();
  const replies = [];
  const ctx = { userName: "you", reply: (text) => replies.push(text) };
  const first = a.onMessage(ctx, { text: "design: obsidian voyager" });
  const second = b.onMessage(ctx, { text: "design: obsidian voyager" });
  assert.equal(first, second);
  assert.match(first, /obsidian/i);
  assert.ok(a.onEvent(ctx, { type: "feature.entered" }) === null);
});

// ---------------------------------------------------------------------------
// Console smoke test (fake DOM)
// ---------------------------------------------------------------------------

function makeElement(documentRoot, tag = "div") {
  const el = {
    ownerDocument: documentRoot,
    tagName: tag.toUpperCase(),
    id: "",
    className: "",
    hidden: false,
    disabled: false,
    textContent: "",
    value: "",
    type: "",
    checked: false,
    style: {},
    children: [],
    listeners: new Map(),
    attributes: new Map(),
    append(...children) { children.forEach((child) => this.appendChild(child)); return this; },
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    prepend(...children) { children.reverse().forEach((child) => this.children.unshift(child)); return this; },
    insertBefore(child, ref) {
      const index = this.children.indexOf(ref);
      if (index < 0) this.children.push(child);
      else this.children.splice(index, 0, child);
      child.parentNode = this;
      return child;
    },
    replaceChildren(...children) { this.children = children; },
    remove() { },
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    querySelectorAll(selector) {
      const found = [];
      const walk = (node) => {
        for (const child of node.children ?? []) {
          if (selector === "input[type=checkbox]" && child.tagName === "INPUT" && child.type === "checkbox") found.push(child);
          if (selector === "input[type=checkbox]:checked" && child.tagName === "INPUT" && child.type === "checkbox" && child.checked) found.push(child);
          walk(child);
        }
      };
      walk(this);
      return found;
    },
    click() { this.listeners.get("click")?.({}); },
  };
  return el;
}

function makeDocument() {
  const elements = new Map();
  const documentRoot = {
    createElement(tag) { return makeElement(documentRoot, tag); },
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener() {},
    register(id, hidden = false) {
      const el = makeElement(documentRoot);
      el.id = id;
      el.hidden = hidden;
      elements.set(id, el);
      return el;
    },
  };
  [
    "bot-plaza-console", "bot-plaza-close", "bot-plaza-status", "bot-plaza-roster",
    "bot-plaza-chat-with", "bot-plaza-chat-log", "bot-plaza-input", "bot-plaza-send",
    "bot-plaza-activity", "bot-plaza-atelier-name", "bot-plaza-atelier-avatar",
    "bot-plaza-atelier-personality", "bot-plaza-atelier-rules", "bot-plaza-rule-kind",
    "bot-plaza-rule-match", "bot-plaza-rule-event", "bot-plaza-rule-reply",
    "bot-plaza-rule-action", "bot-plaza-rule-params", "bot-plaza-rule-add",
    "bot-plaza-atelier-caps", "bot-plaza-atelier-create", "bot-plaza-caps",
    "bot-plaza-journal", "bot-plaza-drafts", "bot-plaza-boundary",
  ].forEach((id) => documentRoot.register(id, id === "bot-plaza-console"));
  // Mirror the real atelier markup: inputs nested inside labels inside a
  // section, so the template picker can insert itself above the name field.
  const atelierSection = makeElement(documentRoot, "section");
  for (const id of ["bot-plaza-atelier-name", "bot-plaza-atelier-avatar", "bot-plaza-atelier-personality"]) {
    const label = makeElement(documentRoot, "label");
    label.appendChild(elements.get(id));
    atelierSection.appendChild(label);
  }
  const stage = makeElement(documentRoot, "div");
  stage.appendChild(atelierSection);
  documentRoot.atelierSection = atelierSection;
  return documentRoot;
}

test("bot plaza console opens, chats, and builds an atelier bot", () => {
  const documentRoot = makeDocument();
  const { registry, runtime } = registryWith();
  const plaza = createBotPlazaConsole({ documentRoot, registry, runtime });
  assert.ok(documentRoot.getElementById("bot-plaza-boundary").textContent.includes("100% in this browser"));
  plaza.open();
  assert.equal(documentRoot.getElementById("bot-plaza-console").hidden, false);
  const snapshot = plaza.getSnapshot();
  assert.equal(snapshot.opened, true);
  assert.ok(snapshot.bots.some((bot) => bot.id === "muse-agent"));

  // Chat with the built-in bot.
  documentRoot.getElementById("bot-plaza-input").value = "design: ember gold";
  documentRoot.getElementById("bot-plaza-send").click();
  const chatText = documentRoot.getElementById("bot-plaza-chat-log").children
    .map((row) => row.children.map((child) => child.textContent).join("")).join(" ");
  assert.match(chatText, /Ember Gold/i);

  // Build a no-code bot in the atelier.
  documentRoot.getElementById("bot-plaza-atelier-name").value = "Testy";
  documentRoot.getElementById("bot-plaza-rule-kind").value = "message-contains";
  documentRoot.getElementById("bot-plaza-rule-match").value = "ping";
  documentRoot.getElementById("bot-plaza-rule-reply").value = "pong {user}";
  documentRoot.getElementById("bot-plaza-rule-add").click();
  documentRoot.getElementById("bot-plaza-atelier-create").click();
  const testy = registry.listBots().find((bot) => bot.name === "Testy");
  assert.ok(testy, "atelier bot installed");
  runtime.tellBot(testy.id, "ping please", { from: "user" });
  assert.ok(runtime.getBus().getLog().some((entry) => entry.from === testy.id && entry.text === "pong you"));

  // openWithBot selects the bot and opens the console.
  plaza.close();
  plaza.openWithBot(testy.id);
  assert.equal(plaza.getSnapshot().selectedBotId, testy.id);
  assert.ok(BOT_PLAZA_BOUNDARY.length > 0 && BOT_CAPABILITIES.length > 0 && BOT_WORLD_ACTIONS && BOT_WORLD_EVENT_TYPES.length > 0);
});

// ---------------------------------------------------------------------------
// Contract proposal queue
// ---------------------------------------------------------------------------

function validProposal(overrides = {}) {
  return {
    title: "Rivals vs City",
    eventLabel: "Rivals vs City — tomorrow night",
    eventId: "match:rivals-vs-city-2026-09-19",
    outcomes: ["Rivals win", "City win", "Draw"],
    minStake: 100,
    maxStake: 5000,
    sourceNotes: "User said Rivals are at home.",
    researchNotes: "Both sides healthy per user.",
    ...overrides,
  };
}

test("proposals start pending with a default 72h expiry", () => {
  const queue = createProposalQueue({ now });
  const proposal = queue.submitProposal({ botId: "scout", botName: "Scout" }, validProposal({ expiresAt: undefined }));
  assert.equal(proposal.status, "pending");
  assert.equal(proposal.expiresAt, "2026-09-21T12:00:00.000Z");
  assert.equal(proposal.history.length, 1);
  assert.equal(proposal.history[0].status, "pending");
  assert.ok(Object.isFrozen(proposal));
  assert.ok(Object.isFrozen(proposal.outcomes));
  assert.deepEqual(queue.getProposals().map((entry) => entry.id), [proposal.id]);
  assert.equal(queue.getProposal(proposal.id).title, "Rivals vs City");
  assert.equal(queue.getProposal("nope"), null);
});

test("proposal validation rejects bad submissions", () => {
  const queue = createProposalQueue({ now });
  const submitter = (overrides) => queue.submitProposal({ botId: "scout" }, validProposal(overrides));
  assert.throws(() => submitter({ title: "  " }), TypeError);
  assert.throws(() => submitter({ title: "x".repeat(97) }), TypeError);
  assert.throws(() => submitter({ eventLabel: "" }), TypeError);
  assert.throws(() => submitter({ eventLabel: "x".repeat(161) }), TypeError);
  assert.throws(() => submitter({ eventId: "Bad Event Id!" }), TypeError);
  assert.throws(() => submitter({ eventId: "x".repeat(161) }), TypeError);
  assert.throws(() => submitter({ outcomes: ["only-one"] }), TypeError);
  assert.throws(() => submitter({ outcomes: ["Rivals", "rivals"] }), TypeError);
  assert.throws(() => submitter({ outcomes: "not-an-array" }), TypeError);
  assert.throws(() => submitter({ outcomes: ["", " "] }), TypeError);
  assert.throws(() => submitter({ minStake: 0 }), TypeError);
  assert.throws(() => submitter({ minStake: -5 }), TypeError);
  assert.throws(() => submitter({ minStake: 1.5 }), TypeError);
  assert.throws(() => submitter({ minStake: 6000, maxStake: 5000 }), TypeError);
  assert.throws(() => submitter({ sourceNotes: "x".repeat(2001) }), TypeError);
  assert.throws(() => submitter({ researchNotes: "x".repeat(2001) }), TypeError);
  assert.throws(() => submitter({ expiresAt: "2026-09-18T11:00:00.000Z" }), TypeError);
  assert.throws(() => submitter({ expiresAt: "not-a-date" }), TypeError);
  assert.equal(queue.getProposals().length, 0, "no invalid proposal was stored");
  // Optionals can be omitted entirely.
  const minimal = queue.submitProposal({ botId: "scout" }, {
    title: "T", eventLabel: "E", outcomes: ["A", "B"],
  });
  assert.equal(minimal.eventId, undefined);
  assert.equal(minimal.minStake, undefined);
  assert.equal(minimal.sourceNotes, undefined);
});

test("approve / dismiss transitions with history", () => {
  const queue = createProposalQueue({ now });
  const proposal = queue.submitProposal({ botId: "scout" }, validProposal());
  const approved = queue.setProposalStatus(proposal.id, "approved", { by: "reviewer", note: "looks good" });
  assert.equal(approved.status, "approved");
  assert.equal(approved.history.length, 2);
  assert.equal(approved.history[1].note, "looks good");
  assert.equal(approved.history[1].by, "reviewer");
  assert.equal(queue.getProposals({ status: "approved" }).length, 1);
  assert.equal(queue.getProposals({ status: "pending" }).length, 0);
  // Terminal states are terminal.
  assert.throws(() => queue.setProposalStatus(proposal.id, "dismissed"), TypeError);
  assert.throws(() => queue.updateProposal(proposal.id, { title: "x" }), TypeError);
  const second = queue.submitProposal({ botId: "scout" }, validProposal({ title: "Second" }));
  const dismissed = queue.dismissProposal(second.id, { by: "reviewer" });
  assert.equal(dismissed.status, "dismissed");
  assert.match(dismissed.history.at(-1).note, /dismissed by reviewer/);
  // Only approved/dismissed are allowed from pending.
  const third = queue.submitProposal({ botId: "scout" }, validProposal({ title: "Third" }));
  assert.throws(() => queue.setProposalStatus(third.id, "expired"), TypeError);
  assert.throws(() => queue.setProposalStatus(third.id, "pending"), TypeError);
  assert.throws(() => queue.setProposalStatus("ghost", "approved"), TypeError);
  assert.throws(() => queue.getProposals({ status: "bogus" }), TypeError);
});

test("propose → edit → approve keeps a full edit history", () => {
  const queue = createProposalQueue({ now });
  const proposal = queue.submitProposal({ botId: "scout" }, validProposal());
  const edited = queue.updateProposal(proposal.id, {
    title: "Rivals vs City — updated",
    outcomes: ["Rivals win", "City win", "Draw", "Abandoned"],
    maxStake: 9000,
  }, { by: "reviewer" });
  assert.equal(edited.title, "Rivals vs City — updated");
  assert.deepEqual(edited.outcomes, ["Rivals win", "City win", "Draw", "Abandoned"]);
  assert.equal(edited.maxStake, 9000);
  assert.equal(edited.history.length, 2);
  assert.match(edited.history[1].note, /title, outcomes, maxStake/);
  assert.equal(edited.history[1].by, "reviewer");
  assert.equal(edited.status, "pending");
  const approved = queue.setProposalStatus(proposal.id, "approved", { by: "reviewer" });
  assert.equal(approved.history.length, 3);
  assert.deepEqual(approved.history.map((entry) => entry.status), ["pending", "pending", "approved"]);
  // Illegal edits throw.
  assert.throws(() => queue.updateProposal(proposal.id, { status: "approved" }), TypeError);
  assert.throws(() => queue.updateProposal(proposal.id, { id: "hacked" }), TypeError);
  assert.throws(() => queue.updateProposal(proposal.id, {}, { by: "reviewer" }), TypeError);
  assert.throws(() => queue.updateProposal("ghost", { title: "x" }), TypeError);
  const pending = queue.submitProposal({ botId: "scout" }, validProposal({ title: "Fourth" }));
  assert.throws(() => queue.updateProposal(pending.id, { outcomes: ["only"] }), TypeError);
  assert.throws(() => queue.updateProposal(pending.id, { expiresAt: "2020-01-01T00:00:00.000Z" }), TypeError);
});

test("expired proposals are auto-marked on read and on load", () => {
  const storage = fakeStorage();
  const queue = createProposalQueue({ storage, now: () => "2026-09-18T12:00:00.000Z" });
  const proposal = queue.submitProposal({ botId: "scout" }, validProposal({ expiresAt: "2026-09-18T13:00:00.000Z" }));
  assert.equal(queue.getProposals({ status: "pending" }).length, 1);
  // A later read marks it expired with a history entry.
  const later = createProposalQueue({ storage, now: () => "2026-09-19T12:00:00.000Z" });
  assert.equal(later.getProposals({ status: "pending" }).length, 0);
  const expired = later.getProposal(proposal.id);
  assert.equal(expired.status, "expired");
  assert.equal(expired.history.at(-1).status, "expired");
  assert.match(expired.history.at(-1).note, /expired/);
  assert.equal(later.getProposals({ status: "expired" }).length, 1);
});

test("proposal queue persists across restarts (round-trip)", () => {
  const storage = fakeStorage();
  const first = createProposalQueue({ storage, now });
  const proposal = first.submitProposal({ botId: "scout", botName: "Scout" }, validProposal());
  first.setProposalStatus(proposal.id, "approved", { by: "reviewer" });
  first.submitProposal({ botId: "scout" }, validProposal({ title: "Still pending" }));

  const second = createProposalQueue({ storage, now });
  assert.equal(second.getProposals().length, 2);
  const restored = second.getProposal(proposal.id);
  assert.equal(restored.status, "approved");
  assert.equal(restored.history.length, 2);
  assert.deepEqual(restored.outcomes, ["Rivals win", "City win", "Draw"]);
  assert.equal(restored.botName, "Scout");
  // Corrupt storage never breaks the queue.
  storage.setItem("tumbo.contract-proposals.v1", "{not json");
  const third = createProposalQueue({ storage, now });
  assert.equal(third.getProposals().length, 0);
});

test("proposal queue subscribe fires on every change", () => {
  const queue = createProposalQueue({ now });
  let fires = 0;
  const unsubscribe = queue.subscribe(() => { fires += 1; });
  const proposal = queue.submitProposal({ botId: "scout" }, validProposal());
  assert.equal(fires, 1);
  queue.updateProposal(proposal.id, { title: "Edited" });
  assert.equal(fires, 2);
  queue.dismissProposal(proposal.id);
  assert.equal(fires, 3);
  unsubscribe();
  queue.clear();
  assert.equal(fires, 3);
  assert.throws(() => queue.subscribe("nope"), TypeError);
});

// ---------------------------------------------------------------------------
// world.propose-contract action (capability-gated, local only)
// ---------------------------------------------------------------------------

function runtimeWithScout({ capabilities = ["world.propose-contracts"], onProposal = null } = {}) {
  const storage = fakeStorage();
  const registry = createBotRegistry({ storage, now });
  const bus = createMessageBus({ now });
  const proposed = [];
  const runtime = createBotRuntime({
    registry, bus, now,
    onProposal: onProposal ?? ((proposal, bot) => proposed.push({ proposal, bot })),
  });
  const bot = registry.install(echoPlugin({
    id: "scout",
    name: "Scout",
    capabilities,
    onMessage: (ctx, msg) => {
      ctx.act("world.propose-contract", JSON.parse(msg.text));
      return "scouted";
    },
  }), { approvedCapabilities: capabilities });
  return { registry, bus, runtime, proposed, bot };
}

test("world.propose-contract stores a proposal, journals, and notifies the host", () => {
  const { runtime, bus, proposed, bot } = runtimeWithScout();
  runtime.tellBot(bot.id, JSON.stringify({
    title: "Big Game",
    eventLabel: "Rivals vs City — tomorrow",
    outcomes: "Rivals; City, Draw",
    minStake: "100",
    maxStake: "5000",
    sourceNotes: "user tip",
    expiresMinutes: "60",
  }), { from: "user" });
  const queue = runtime.getProposalQueue();
  const proposals = queue.getProposals();
  assert.equal(proposals.length, 1);
  const proposal = proposals[0];
  assert.equal(proposal.status, "pending");
  assert.deepEqual(proposal.outcomes, ["Rivals", "City", "Draw"]);
  assert.equal(proposal.minStake, 100);
  assert.equal(proposal.maxStake, 5000);
  assert.equal(proposal.expiresAt, "2026-09-18T13:00:00.000Z");
  // Plaza activity message + journal entry.
  const log = bus.getLog();
  assert.ok(log.some((entry) => entry.text.includes("proposed a contract for your review: Big Game")));
  assert.ok(runtime.getJournal().some((entry) => entry.text === "proposed a contract for your review: Big Game"));
  // Host notification.
  assert.equal(proposed.length, 1);
  assert.equal(proposed[0].proposal.title, "Big Game");
  assert.equal(proposed[0].bot.botId, "scout");
  assert.equal(proposed[0].bot.botName, "Scout");
});

test("world.propose-contract is denied without the capability", () => {
  const storage = fakeStorage();
  const registry = createBotRegistry({ storage, now });
  const bus = createMessageBus({ now });
  const runtime = createBotRuntime({ registry, bus, now });
  registry.install(echoPlugin({
    id: "sneaky", name: "Sneaky", capabilities: ["world.propose-contracts"],
    onMessage: (ctx) => ctx.act("world.propose-contract", { title: "T", eventLabel: "E", outcomes: "A, B" }),
  }), { approvedCapabilities: [] });
  runtime.tellBot("sneaky", "go", { from: "user" });
  assert.equal(runtime.getProposalQueue().getProposals().length, 0);
  assert.ok(bus.getLog().some((entry) => /capability-not-approved/.test(entry.text)));
});

test("world.propose-contract rejects malformed params", () => {
  const { registry, runtime, proposed } = runtimeWithScout();
  const results = [];
  registry.install(echoPlugin({
    id: "clumsy", name: "Clumsy", capabilities: ["world.propose-contracts"],
    onMessage: (ctx, msg) => {
      results.push(ctx.act("world.propose-contract", JSON.parse(msg.text)));
      return null;
    },
  }), { approvedCapabilities: ["world.propose-contracts"] });
  const send = (params) => runtime.tellBot("clumsy", JSON.stringify(params), { from: "user" });
  send({ title: "T", eventLabel: "E", outcomes: "Only one" });
  send({ title: "T", eventLabel: "E", outcomes: "Rivals, rivals" });
  send({ title: "T", eventLabel: "E", outcomes: "A, B", minStake: "abc" });
  send({ title: "T", eventLabel: "E", outcomes: "A, B", minStake: "500", maxStake: "100" });
  send({ title: "", eventLabel: "E", outcomes: "A, B" });
  send({ title: "T", eventLabel: "", outcomes: "A, B" });
  assert.equal(results.length, 6);
  for (const result of results) {
    assert.equal(result.ok, true, "the action itself executed");
    assert.equal(result.result.ok, false);
    assert.equal(result.result.reason, "invalid-params");
  }
  assert.equal(runtime.getProposalQueue().getProposals().length, 0);
  assert.equal(proposed.length, 0);
});

test("world.propose-contract clamps expiresMinutes and defaults sanely", () => {
  const { registry, runtime } = runtimeWithScout();
  registry.install(echoPlugin({
    id: "timer", name: "Timer", capabilities: ["world.propose-contracts"],
    onMessage: (ctx, msg) => {
      ctx.act("world.propose-contract", JSON.parse(msg.text));
      return null;
    },
  }), { approvedCapabilities: ["world.propose-contracts"] });
  const queue = runtime.getProposalQueue();
  runtime.tellBot("timer", JSON.stringify({ title: "Far", eventLabel: "E", outcomes: "A, B", expiresMinutes: "999999" }), { from: "user" });
  runtime.tellBot("timer", JSON.stringify({ title: "Defaulted", eventLabel: "E", outcomes: "A, B" }), { from: "user" });
  const far = queue.getProposals().find((entry) => entry.title === "Far");
  const def = queue.getProposals().find((entry) => entry.title === "Defaulted");
  assert.equal(far.expiresAt, new Date(Date.parse("2026-09-18T12:00:00.000Z") + 43200 * 60000).toISOString());
  assert.equal(def.expiresAt, "2026-09-21T12:00:00.000Z");
});

test("the old world.draft-contract action still works", () => {
  const { registry, runtime } = registryWith();
  registry.install(echoPlugin({
    id: "drafter", name: "Drafter", capabilities: ["world.draft-contract"],
    onMessage: (ctx) => {
      ctx.act("world.draft-contract", { title: "Meme Monday", body: "A proposal." });
      return null;
    },
  }), { approvedCapabilities: ["world.draft-contract"] });
  runtime.tellBot("drafter", "go", { from: "user" });
  const drafts = runtime.getDrafts();
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].title, "Meme Monday");
  assert.equal(drafts[0].status, "draft");
});

test("createBotRuntime accepts a shared proposal queue", () => {
  const shared = createProposalQueue({ now });
  const { registry } = registryWith();
  const runtime = createBotRuntime({ registry, now, proposalQueue: shared });
  assert.equal(runtime.getProposalQueue(), shared);
  const fallback = createBotRuntime({ registry, now });
  assert.ok(fallback.getProposalQueue());
  assert.notEqual(fallback.getProposalQueue(), shared);
});

// ---------------------------------------------------------------------------
// Contract scout atelier template
// ---------------------------------------------------------------------------

test("contract scout template declares propose-contracts and compiles", () => {
  const template = getAtelierTemplate("contract-scout");
  assert.ok(template, "template exists");
  assert.equal(template.label, "Contract scout");
  assert.ok(BOT_ATELIER_TEMPLATES.some((entry) => entry.id === "contract-scout"));
  assert.ok(template.prefill.capabilities.includes("world.propose-contracts"));
  assert.ok(template.prefill.personality.includes("contract scout"));
  const plugin = compileAtelierBot({
    name: template.prefill.name,
    avatar: template.prefill.avatar,
    personality: template.prefill.personality,
    rules: template.prefill.rules,
    capabilities: template.prefill.capabilities,
  });
  assert.ok(plugin.capabilities.includes("world.propose-contracts"));
  assert.equal(getAtelierTemplate("nope"), null);
});

test("contract scout template bot answers and pitches proposals", () => {
  const template = getAtelierTemplate("contract-scout");
  const { registry, runtime, bus } = registryWith();
  const bot = registry.installAtelierBot({
    name: template.prefill.name,
    avatar: template.prefill.avatar,
    personality: template.prefill.personality,
    rules: template.prefill.rules,
    capabilities: template.prefill.capabilities,
  }, { approvedCapabilities: [] }); // NOT auto-approved: the user approves powers as today
  assert.deepEqual(bot.approvedCapabilities, []);
  runtime.tellBot(bot.id, "hey scout it", { from: "user" });
  const log = bus.getLog();
  assert.ok(log.some((entry) => entry.from === bot.id && /Scouting/.test(entry.text)));
});

// ---------------------------------------------------------------------------
// Console renders proposals
// ---------------------------------------------------------------------------

test("bot plaza console renders contract proposals in the drafts section", () => {
  const documentRoot = makeDocument();
  const { registry, runtime } = registryWith();
  const queue = runtime.getProposalQueue();
  queue.submitProposal({ botId: "muse-agent", botName: "Muse Agent" }, {
    title: "Big Game",
    eventLabel: "Rivals vs City — tomorrow",
    outcomes: ["Rivals win", "City win"],
    minStake: 100,
    maxStake: 5000,
    sourceNotes: "User said Rivals at home.",
  });
  createBotPlazaConsole({ documentRoot, registry, runtime });
  const textOf = (node) => (node.textContent ?? "") + (node.children ?? []).map(textOf).join("\n");
  const text = textOf(documentRoot.getElementById("bot-plaza-drafts"));
  assert.match(text, /PROPOSAL · PENDING · Big Game/);
  assert.match(text, /Rivals vs City — tomorrow/);
  assert.match(text, /Rivals win · City win/);
  assert.match(text, /TUMBO pts/);
  assert.match(text, /User said Rivals at home\./);
  assert.match(text, /Muse Agent/);
  assert.match(text, /expires in/);
  assert.match(text, /Review in Contract Atelier → Contracts for your review/);
});

test("atelier template picker pre-fills the contract scout", () => {
  const documentRoot = makeDocument();
  const { registry, runtime } = registryWith();
  createBotPlazaConsole({ documentRoot, registry, runtime });
  const section = documentRoot.atelierSection;
  const pickerLabel = section.children.find((child) =>
    child.children?.some((grandchild) => grandchild.tagName === "SELECT"));
  assert.ok(pickerLabel, "template picker mounted above the atelier name field");
  const select = pickerLabel.children.find((child) => child.tagName === "SELECT");
  const scoutOption = select.children.find((child) => child.value === "contract-scout");
  assert.ok(scoutOption, "contract scout is a template choice");
  select.value = "contract-scout";
  select.listeners.get("change")?.({});
  assert.equal(documentRoot.getElementById("bot-plaza-atelier-name").value, "Contract Scout");
  assert.match(documentRoot.getElementById("bot-plaza-atelier-personality").value, /contract scout/);
  const checked = documentRoot.getElementById("bot-plaza-atelier-caps")
    .querySelectorAll("input[type=checkbox]:checked").map((box) => box.value);
  assert.ok(checked.includes("world.propose-contracts"));
});

// ---------------------------------------------------------------------------
// TypeSafe judgment integration (additive)
// ---------------------------------------------------------------------------

function proposalAuthoredBot(registry, name) {
  const plugin = compileAtelierBot({
    name,
    capabilities: ["world.propose-contracts"],
    rules: [],
  });
  return registry.install(plugin, { approvedCapabilities: ["world.propose-contracts"] });
}

test("rankProposalsForReview orders pending proposals by readiness, highest first", () => {
  const { registry, runtime } = registryWith();
  const scout = proposalAuthoredBot(registry, "Contract Scout");
  const queue = runtime.getProposalQueue();
  const sparse = queue.submitProposal({ botId: scout.id, botName: scout.name }, {
    title: "Sparse",
    eventLabel: "Some event",
    outcomes: ["A wins", "B wins"],
  });
  const rich = queue.submitProposal({ botId: scout.id, botName: scout.name }, {
    title: "Rich derby contract",
    eventLabel: "City derby — Saturday",
    eventId: "soccer:derby-2026",
    outcomes: ["Home win", "Draw", "Away win"],
    minStake: 100,
    maxStake: 1000,
    sourceNotes: "journal entry",
    researchNotes: "form checked",
  });
  const ranked = rankProposalsForReview(queue, { now: Date.parse(FIXED_NOW) });
  assert.ok(Object.isFrozen(ranked));
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].proposal.id, rich.id);
  assert.equal(ranked[1].proposal.id, sparse.id);
  assert.ok(ranked[0].readiness > ranked[1].readiness);
  assert.ok(Array.isArray(ranked[0].reasons) && ranked[0].reasons.length > 0);
  // Queue internals untouched: submission order preserved.
  const stored = queue.getProposals({ status: "pending" });
  assert.equal(stored[0].id, sparse.id);
  assert.equal(stored[1].id, rich.id);
});

test("rankProposalsForReview accepts a plain proposal array and rejects junk", () => {
  const ranked = rankProposalsForReview([
    { title: "T", eventLabel: "E", outcomes: ["a", "b"], status: "pending" },
  ]);
  assert.equal(ranked.length, 1);
  assert.ok(ranked[0].readiness >= 0 && ranked[0].readiness <= 1);
  assert.throws(() => rankProposalsForReview(null), TypeError);
  assert.throws(() => rankProposalsForReview({}), TypeError);
});

test("createIntentRouter routes a clear message to intent + bot, executing nothing", async () => {
  const { registry } = registryWith();
  proposalAuthoredBot(registry, "Contract Scout");
  const router = createIntentRouter({ registry, now });
  const decided = await router.route("hey Contract Scout, draft a contract on the derby");
  assert.equal(decided.intent, "draft_contract");
  assert.equal(decided.clarify, false);
  assert.equal(decided.clarificationText, null);
  assert.ok(decided.botId, "a named bot resolves");
  assert.ok(Object.isFrozen(decided));
});

test("createIntentRouter clarifies on ambiguous intent", async () => {
  const { registry } = registryWith();
  const router = createIntentRouter({ registry, now });
  const decided = await router.route("draft a contract and scout it");
  assert.equal(decided.clarify, true);
  assert.equal(decided.botId, null);
  assert.match(decided.clarificationText, /wasn't sure/);
});

test("createIntentRouter asks which bot when two bots are equally named", async () => {
  const { registry } = registryWith();
  proposalAuthoredBot(registry, "Alpha Scout");
  proposalAuthoredBot(registry, "Beta Scout");
  const router = createIntentRouter({ registry, now });
  const decided = await router.route("hey scout, draft a contract");
  assert.equal(decided.intent, "draft_contract");
  assert.equal(decided.clarify, true);
  assert.match(decided.clarificationText, /which bot/);
});

test("createIntentRouter resolves the named bot on a unique name-token match", async () => {
  const { registry } = registryWith();
  const scout = proposalAuthoredBot(registry, "Contract Scout");
  const router = createIntentRouter({ registry, now });
  // "contract" is a distinctive token of the bot's name: a unique match
  // resolves to that bot rather than asking.
  const decided = await router.route("draft a contract on the derby");
  assert.equal(decided.intent, "draft_contract");
  assert.equal(decided.clarify, false);
  assert.equal(decided.botId, scout.id);
});

test("createIntentRouter resolves no botId when no bot is named", async () => {
  const { registry } = registryWith();
  proposalAuthoredBot(registry, "Contract Scout");
  const router = createIntentRouter({ registry, now });
  const decided = await router.route("hello there");
  assert.equal(decided.intent, "chat");
  assert.equal(decided.clarify, false);
  assert.equal(decided.botId, null);
});

test("createIntentRouter needs a registry", () => {
  assert.throws(() => createIntentRouter(), TypeError);
  assert.throws(() => createIntentRouter({ registry: {} }), TypeError);
});
