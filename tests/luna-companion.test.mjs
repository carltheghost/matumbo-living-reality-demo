import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LUNA_BOUNDARY,
  LUNA_CONSOLE_SOURCE,
  LUNA_MAX_HISTORY,
  LUNA_MAX_MESSAGE_LENGTH,
  LUNA_SCHEMA_VERSION,
  LUNA_SOURCE,
  createLunaCompanion,
  createLunaCompanionContribution,
  hashLunaSeed,
} from "../src/domains/luna-companion.js";
import { createLunaCompanionConsole } from "../src/render/luna-companion.js";
import { createLivingRealityProjection } from "../src/core/demo-projection.js";
import { FEATURE_DEFINITIONS } from "../src/render/feature-navigator.js";

const FIXED_NOW = "2026-09-18T12:00:00.000Z";

const TEST_FEATURES = [
  { id: "arena", label: "ARENA / Game Lab", kicker: "playable rehearsal", description: "Open the local Game Lab.", boundary: "Local rehearsal only." },
  { id: "nft-atelier", label: "NFT Atelier", kicker: "mint · collect · inspect", description: "Mint fictional collectibles.", boundary: "No wallet or chain." },
  { id: "paycore", label: "PAYCORE Asset-token Balances", kicker: "value preview", description: "See local balance previews.", boundary: "Projection only." },
];

function luna() {
  return createLunaCompanion({ seed: "test-seed", now: () => FIXED_NOW, features: TEST_FEATURES });
}

test("navigate resolves plain-word commands to feature ids", () => {
  const guide = luna();
  const first = guide.respond({ text: "take me to the nft atelier" });
  assert.equal(first.intent, "navigate");
  assert.equal(first.featureId, "nft-atelier");
  assert.ok(first.reply.includes("NFT Atelier"));
  assert.ok(Object.isFrozen(first));
  const second = guide.respond({ text: "open arena" });
  assert.equal(second.intent, "navigate");
  assert.equal(second.featureId, "arena");
  const third = guide.respond({ text: "SHOW ME paycore" });
  assert.equal(third.intent, "navigate");
  assert.equal(third.featureId, "paycore");
});

test("weak fuzzy matches ask with suggestions instead of navigating (R1)", () => {
  const guide = canonLuna();
  const result = guide.respond({ text: "take me to the moon" });
  assert.equal(result.intent, "clarify");
  assert.equal(result.featureId, null);
  assert.ok(result.askOptions.length >= 1 && result.askOptions.length <= 3);
  assert.ok(result.reply.startsWith("Did you mean"));
  assert.ok(Object.isFrozen(result.askOptions));
});

test("verb with no recognized target falls back naming the target, never inventing one", () => {
  const guide = luna();
  const result = guide.respond({ text: "open sesame" });
  assert.equal(result.intent, "fallback");
  assert.equal(result.featureId, null);
  assert.ok(result.reply.includes('"sesame"'));
  assert.ok(result.reply.includes("don't have access"));
});

test("explain returns the feature description plus its boundary", () => {
  const guide = luna();
  const result = guide.respond({ text: "what is paycore" });
  assert.equal(result.intent, "explain");
  assert.equal(result.featureId, "paycore");
  assert.ok(result.reply.includes("See local balance previews."));
  assert.ok(result.reply.includes("Projection only."));
});

test("context narrates the current feature from the caller-supplied feature", () => {
  const guide = luna();
  const result = guide.respond({ text: "where am I?", currentFeature: TEST_FEATURES[0] });
  assert.equal(result.intent, "context");
  assert.equal(result.featureId, "arena");
  assert.ok(result.reply.includes("ARENA / Game Lab"));
  assert.ok(result.reply.includes("playable rehearsal"));
  assert.ok(result.reply.includes("Local rehearsal only."));
  const place = guide.respond({ text: "What is this place?", currentFeature: TEST_FEATURES[1] });
  assert.equal(place.intent, "context");
  assert.equal(place.featureId, "nft-atelier");
});

test("help, greet, and fallback intents return non-empty scripted replies", () => {
  const guide = luna();
  const help = guide.respond({ text: "what can you do?" });
  assert.equal(help.intent, "help");
  assert.ok(help.reply.includes(LUNA_BOUNDARY));
  const greet = guide.respond({ text: "hello" });
  assert.equal(greet.intent, "greet");
  assert.ok(greet.reply.toLowerCase().includes("not an ai"));
  const fallback = guide.respond({ text: "blorple snazz" });
  assert.equal(fallback.intent, "fallback");
  assert.ok(fallback.reply.includes("I didn't catch that"));
});

test("sensitive topics get the fallback plus a boundary reminder", () => {
  const guide = luna();
  const result = guide.respond({ text: "should I invest in crypto" });
  assert.equal(result.intent, "fallback");
  assert.ok(result.reply.includes(LUNA_BOUNDARY));
});

test("empty input is a help request, not a failure; oversized input is truncated with a note", () => {
  const guide = luna();
  const empty = guide.respond({ text: "   " });
  assert.equal(empty.intent, "help");
  assert.ok(empty.reply.includes("I'm ready."));
  const missing = guide.respond({});
  assert.equal(missing.intent, "help");
  const long = guide.respond({ text: "x".repeat(500) });
  assert.ok(long.reply.includes("trimmed"));
  assert.equal(guide.history().at(-2).text.length, LUNA_MAX_MESSAGE_LENGTH);
});

test("same seed and input produce identical reply objects", () => {
  const first = luna().respond({ text: "take me to the arena" });
  const second = luna().respond({ text: "take me to the arena" });
  assert.deepEqual(first, second);
  assert.equal(hashLunaSeed("abc"), hashLunaSeed("abc"));
  assert.notEqual(hashLunaSeed("abc"), hashLunaSeed("abd"));
});

test("history is bounded and clear() resets history, trace, and intents", () => {
  const guide = luna();
  for (let i = 0; i < LUNA_MAX_HISTORY + 10; i += 1) guide.respond({ text: "hello" });
  assert.ok(guide.history().length <= LUNA_MAX_HISTORY);
  assert.ok(guide.getSnapshot().turns <= LUNA_MAX_HISTORY);
  guide.clear();
  assert.deepEqual(guide.history(), []);
  assert.deepEqual(guide.getSnapshot().trace, []);
  assert.deepEqual(guide.getSnapshot().intents, {
    navigate: 0, explain: 0, context: 0, help: 0, greet: 0, clarify: 0, undo: 0, fallback: 0,
  });
});

test("snapshot and contribution carry simulation-only flags", () => {
  const guide = luna();
  guide.respond({ text: "open arena" });
  const snapshot = guide.getSnapshot();
  assert.equal(snapshot.schemaVersion, LUNA_SCHEMA_VERSION);
  assert.equal(snapshot.source, LUNA_SOURCE);
  assert.equal(snapshot.simulation, true);
  assert.equal(snapshot.localOnly, true);
  assert.equal(snapshot.network, false);
  assert.equal(snapshot.persistence, false);
  assert.equal(snapshot.aiModel, false);
  assert.equal(snapshot.intents.navigate, 1);
  assert.ok(snapshot.trace.length >= 1);
  const contribution = guide.createContribution();
  assert.equal(contribution.source, LUNA_SOURCE);
  assert.deepEqual(contribution.entities, [{ id: "luna-companion", kind: "companion-guide", simulation: true }]);
  assert.equal(contribution.capabilities[0].authority, "none");
  assert.equal(contribution.capabilities[0].executable, false);
  const factory = createLunaCompanionContribution({ updatedAt: FIXED_NOW });
  assert.equal(factory.source, LUNA_SOURCE);
  assert.equal(factory.updatedAt, FIXED_NOW);
});

test("luna-companion resolves inside the canonical projection sources", () => {
  const projection = createLivingRealityProjection({ projectedAt: FIXED_NOW });
  assert.ok(projection.world.sources.includes("luna-companion"));
  const entity = projection.world.entities.find((entry) => entry.id === "luna-companion");
  assert.ok(entity);
  assert.equal(entity.simulation, true);
});

test("console source constant matches the feature wiring contract", () => {
  assert.equal(LUNA_CONSOLE_SOURCE, "luna-companion-console");
});

function fakeDocument(missing = []) {
  const ids = [
    "luna-companion-console", "luna-companion-head", "luna-companion-title",
    "luna-companion-close", "luna-companion-status", "luna-companion-log",
    "luna-companion-chips", "luna-companion-input", "luna-companion-send",
    "luna-companion-speak", "luna-companion-trace", "luna-companion-boundary",
  ].filter((id) => !missing.includes(id));
  const makeEl = (id) => ({
    id,
    children: [],
    dataset: {},
    value: "",
    textContent: "",
    hidden: true,
    disabled: false,
    append(...nodes) { this.children.push(...nodes); return this; },
    replaceChildren() { this.children = []; },
    addEventListener(type, fn) { this[`on_${type}`] = fn; },
    setAttribute() {},
    scrollIntoView() {},
  });
  const byId = new Map(ids.map((id) => [id, makeEl(id)]));
  return {
    createElement: (tag) => makeEl(tag),
    getElementById: (id) => byId.get(id) ?? null,
    __byId: byId,
  };
}

test("console mounts on the expected mount points and rejects missing ones", () => {
  const documentRoot = fakeDocument();
  const guide = luna();
  const api = createLunaCompanionConsole({
    documentRoot,
    companion: guide,
    features: TEST_FEATURES,
    getCurrentFeature: () => "arena",
  });
  const snapshot = api.getSnapshot();
  assert.equal(snapshot.source, LUNA_CONSOLE_SOURCE);
  assert.equal(snapshot.boundary, LUNA_BOUNDARY);
  assert.equal(snapshot.network, false);
  assert.equal(snapshot.aiModel, false);
  assert.equal(snapshot.persistence, false);
  assert.throws(() => createLunaCompanionConsole({ documentRoot: fakeDocument(["luna-companion-log"]) }),
    /Luna companion console mount points are missing/);
});

test("console send flow appends turns, fires onNavigate, and replays", () => {
  const documentRoot = fakeDocument();
  const guide = luna();
  const navigated = [];
  const replayed = [];
  const api = createLunaCompanionConsole({
    documentRoot,
    companion: guide,
    features: TEST_FEATURES,
    getCurrentFeature: () => "arena",
    onNavigate: (featureId, snapshot) => navigated.push([featureId, snapshot]),
    onReplay: (snapshot) => replayed.push(snapshot),
  });
  api.open();
  const logEl = documentRoot.getElementById("luna-companion-log");
  const before = logEl.children.length;
  // Drive the send path through the wired send button handler.
  documentRoot.getElementById("luna-companion-input").value = "open arena";
  documentRoot.getElementById("luna-companion-send").on_click();
  assert.ok(logEl.children.length >= before + 2, "user + luna turns are appended");
  assert.deepEqual(navigated[0][0], "arena");
  assert.equal(navigated[0][1].source, LUNA_CONSOLE_SOURCE);
  api.replay();
  assert.equal(replayed.length, 1);
  assert.equal(replayed[0].action, "replay");
});

test("console chips fill the input and send; speak toggle is a safe no-op without speechSynthesis", () => {
  const documentRoot = fakeDocument();
  const guide = luna();
  const navigated = [];
  const api = createLunaCompanionConsole({
    documentRoot,
    companion: guide,
    features: TEST_FEATURES,
    getCurrentFeature: () => "arena",
    onNavigate: (featureId) => navigated.push(featureId),
  });
  api.open();
  const chipsEl = documentRoot.getElementById("luna-companion-chips");
  assert.equal(chipsEl.children.length, 4);
  const surprise = chipsEl.children.find((chip) => chip.dataset.chip === "surprise");
  surprise.on_click();
  assert.ok(documentRoot.getElementById("luna-companion-input").value.startsWith("take me to the "));
  assert.equal(navigated.length, 1);
  // No speechSynthesis in this host: toggling must not throw and text still works.
  assert.equal(typeof globalThis.speechSynthesis, "undefined");
  api.toggleSpeak();
  assert.equal(api.getSnapshot().speakOn, true);
  documentRoot.getElementById("luna-companion-input").value = "hello";
  documentRoot.getElementById("luna-companion-send").on_click();
  api.toggleSpeak();
  assert.equal(api.getSnapshot().speakOn, false);
});

test("navigator definitions include luna-companion with its boundary", () => {
  const definition = FEATURE_DEFINITIONS.find((feature) => feature.id === "luna-companion");
  assert.ok(definition);
  assert.equal(definition.label, "Luna Companion");
  assert.ok(definition.boundary.includes("No AI model"));
});

test("null clock uses the wall clock instead of the 1970 epoch", () => {
  const companion = createLunaCompanion({ seed: "epoch-check", now: null, features: TEST_FEATURES });
  const result = companion.respond({ text: "hello" });
  assert.ok(!result.at.startsWith("1970-01-01"), "timestamp must not be the unix epoch");
  const year = Number(result.at.slice(0, 4));
  assert.ok(year >= 2026, "timestamp must be the wall clock");
});

/* ------------------------------------------------------------------ */
/* Adversarial input review (2026-09-18) — one test per review input.  */
/* Uses the canonical FEATURE_DEFINITIONS registry.                    */
/* ------------------------------------------------------------------ */

function canonLuna() {
  return createLunaCompanion({
    seed: "adversarial",
    now: () => FIXED_NOW,
    features: FEATURE_DEFINITIONS,
  });
}

test("adversarial 1: typo navigates with a confirmation phrase", () => {
  const result = canonLuna().respond({ text: "take me to contrct atelier" });
  assert.equal(result.intent, "navigate");
  assert.equal(result.featureId, "contract-atelier");
  assert.equal(result.reply, "I think you mean Contract Atelier. Taking you there.");
  assert.equal(result.intentTrace.chosenFeature, "contract-atelier");
  assert.ok(result.intentTrace.confidence >= 0.72 && result.intentTrace.confidence < 0.99);
});

test("adversarial 2: 'pool' is ambiguous and asks, never navigates", () => {
  const result = canonLuna().respond({ text: "pool" });
  assert.equal(result.intent, "clarify");
  assert.equal(result.featureId, null);
  assert.deepEqual(result.askOptions, ["Contract Atelier", "Asset Market Evidence"]);
  assert.ok(result.reply.includes("multiple places"));
  assert.ok(result.reply.includes('"Contract Atelier"'));
});

test("adversarial 3: 'market' asks with the alias-conflict table, substring never decides", () => {
  const result = canonLuna().respond({ text: "market" });
  assert.equal(result.intent, "clarify");
  assert.equal(result.featureId, null);
  // Only registry-present features are offered; exchange/treasury are not invented.
  assert.deepEqual(result.askOptions, ["Asset Market Evidence"]);
  assert.ok(result.reply.includes("multiple places"));
});

test("adversarial 4: multi-intent asks for order, never executes two navigations", () => {
  const result = canonLuna().respond({ text: "open pool and explain ledger" });
  assert.equal(result.intent, "clarify");
  assert.equal(result.featureId, null);
  assert.equal(
    result.reply,
    "Which should I do first — open pool or explain Prime Ledger + EchoProof?",
  );
  assert.equal(result.thenNavigate, null);
});

test("adversarial 5: empty and whitespace-only input is a help request", () => {
  for (const text of ["", "     "]) {
    const result = canonLuna().respond({ text });
    assert.equal(result.intent, "help");
    assert.equal(result.featureId, null);
    assert.ok(result.reply.includes("I'm ready."));
  }
});

test("adversarial 6: 5000-char ramble keeps first-sentence priority and still navigates", () => {
  const ramble = `take me to NFT Atelier because ${"it is great ".repeat(500)}`;
  assert.ok(ramble.length > 5000);
  const result = canonLuna().respond({ text: ramble });
  assert.equal(result.intent, "navigate");
  assert.equal(result.featureId, "nft-atelier");
  assert.ok(result.reply.includes("I understood the first part:"));
  assert.ok(result.reply.includes("Opening NFT Atelier"));
});

test("adversarial 7: verb alone never navigates", () => {
  const result = canonLuna().respond({ text: "open sesame" });
  assert.equal(result.intent, "fallback");
  assert.equal(result.featureId, null);
  assert.ok(result.reply.includes('"sesame"'));
});

test("adversarial 8: passive explain forms explain, never navigate", () => {
  const result = canonLuna().respond({
    text: "I want to learn about the NFT Atelier before I visit it",
  });
  assert.equal(result.intent, "explain");
  assert.equal(result.featureId, "nft-atelier");
  assert.ok(result.reply.startsWith("NFT Atelier —"));
});

test("adversarial 9: 'person' alias collision asks instead of guessing", () => {
  const result = canonLuna().respond({ text: "person" });
  assert.equal(result.intent, "clarify");
  assert.equal(result.featureId, null);
  assert.deepEqual(result.askOptions, ["Person Ω", "Wardrobe Atelier"]);
  assert.ok(result.reply.includes('"Person Ω"'));
  assert.ok(result.reply.includes('"Wardrobe Atelier"'));
});

test("adversarial 10: unknown destinations get guidance, never invented", () => {
  const result = canonLuna().respond({ text: "go to the secret admin panel" });
  assert.equal(result.intent, "fallback");
  assert.equal(result.featureId, null);
  assert.ok(result.reply.includes("secret admin panel"));
  assert.ok(result.reply.includes("available features"));
});

test("adversarial 11: 'where am I' with no feature names the starting view honestly", () => {
  const result = canonLuna().respond({ text: "where am I" });
  assert.equal(result.intent, "context");
  assert.equal(result.featureId, null);
  assert.ok(result.reply.includes("Living Reality starting view"));
  assert.ok(!result.reply.includes("You are in"), "must not claim a feature without confirmation");
});

test("adversarial 12: filler words are stripped before parsing", () => {
  const result = canonLuna().respond({ text: "can you take me nft thing place" });
  assert.equal(result.intent, "navigate");
  assert.equal(result.featureId, "nft-atelier");
  assert.equal(result.reply, "I think you mean NFT Atelier. Taking you there.");
  assert.equal(result.intentTrace.normalizedInput, "take me nft thing place");
});

test("explain-before-open explains now and offers the navigation after", () => {
  const result = canonLuna().respond({ text: "explain the ledger and open the arena" });
  assert.equal(result.intent, "explain");
  assert.equal(result.featureId, "ledger");
  assert.ok(result.reply.startsWith("Prime Ledger + EchoProof —"));
  assert.deepEqual(result.thenNavigate, { id: "arena", label: "ARENA / Game Lab" });
  assert.ok(result.reply.includes('Say "open ARENA / Game Lab".'));
});

test("undo returns to the previous feature for the session", () => {
  const guide = canonLuna();
  const none = guide.respond({ text: "no, not that one" });
  assert.equal(none.intent, "undo");
  assert.equal(none.featureId, null);
  assert.ok(none.reply.includes("nothing to undo"));
  guide.respond({ text: "open arena" });
  guide.respond({ text: "take me to nft atelier" });
  const back = guide.respond({ text: "undo that" });
  assert.equal(back.intent, "undo");
  assert.equal(back.featureId, "arena");
  assert.ok(back.reply.includes("Going back to ARENA / Game Lab"));
  const forth = guide.respond({ text: "no, not that one" });
  assert.equal(forth.featureId, "nft-atelier");
});

test("intent trace carries input, normalized input, candidates, choice, and confidence", () => {
  const result = canonLuna().respond({ text: "take me to contrct atelier" });
  const trace = result.intentTrace;
  assert.equal(trace.input, "take me to contrct atelier");
  assert.equal(trace.normalizedInput, "take me to contrct atelier");
  assert.equal(trace.intent, "navigate");
  assert.ok(trace.candidateFeatures.includes("contract-atelier"));
  assert.equal(trace.chosenFeature, "contract-atelier");
  assert.ok(trace.confidence > 0 && trace.confidence < 1);
  assert.ok(Object.isFrozen(trace));
  assert.ok(Object.isFrozen(result));
});

test("intent counts track clarify and undo alongside the classic intents", () => {
  const guide = canonLuna();
  guide.respond({ text: "pool" });
  guide.respond({ text: "open arena" });
  guide.respond({ text: "undo that" });
  const intents = guide.getSnapshot().intents;
  assert.equal(intents.clarify, 1);
  assert.equal(intents.navigate, 1);
  assert.equal(intents.undo, 1);
});

test("console renders disambiguation chips and chip taps navigate exactly", () => {
  const documentRoot = fakeDocument();
  const guide = canonLuna();
  const navigated = [];
  const api = createLunaCompanionConsole({
    documentRoot,
    companion: guide,
    features: FEATURE_DEFINITIONS,
    getCurrentFeature: () => null,
    onNavigate: (featureId) => navigated.push(featureId),
  });
  api.open();
  const chipsEl = documentRoot.getElementById("luna-companion-chips");
  const staticCount = chipsEl.children.length;
  documentRoot.getElementById("luna-companion-input").value = "pool";
  documentRoot.getElementById("luna-companion-send").on_click();
  assert.ok(chipsEl.children.length > staticCount, "option chips appear for clarify replies");
  const optionsRow = chipsEl.children[chipsEl.children.length - 1];
  const optionChip = optionsRow.children.find(
    (chip) => chip.dataset.option === "disambiguate",
  );
  assert.ok(optionChip, "disambiguation chip exists");
  optionChip.on_click();
  assert.deepEqual(navigated, ["contract-atelier"]);
});

test("console renders the explain-before-open follow-up chip", () => {
  const documentRoot = fakeDocument();
  const guide = canonLuna();
  const navigated = [];
  const api = createLunaCompanionConsole({
    documentRoot,
    companion: guide,
    features: FEATURE_DEFINITIONS,
    getCurrentFeature: () => null,
    onNavigate: (featureId) => navigated.push(featureId),
  });
  api.open();
  documentRoot.getElementById("luna-companion-input").value = "explain the ledger and open the arena";
  documentRoot.getElementById("luna-companion-send").on_click();
  assert.deepEqual(navigated, [], "explain does not navigate by itself");
  const chipsEl = documentRoot.getElementById("luna-companion-chips");
  const optionsRow = chipsEl.children[chipsEl.children.length - 1];
  const followUp = optionsRow.children.find((chip) => chip.dataset.option === "then-navigate");
  assert.ok(followUp, "follow-up chip exists");
  followUp.on_click();
  assert.deepEqual(navigated, ["arena"]);
});

test("console undo navigates back through onNavigate", () => {
  const documentRoot = fakeDocument();
  const guide = canonLuna();
  const navigated = [];
  const api = createLunaCompanionConsole({
    documentRoot,
    companion: guide,
    features: FEATURE_DEFINITIONS,
    getCurrentFeature: () => null,
    onNavigate: (featureId) => navigated.push(featureId),
  });
  api.open();
  const inputEl = documentRoot.getElementById("luna-companion-input");
  const sendEl = documentRoot.getElementById("luna-companion-send");
  inputEl.value = "open arena";
  sendEl.on_click();
  inputEl.value = "open nft-atelier";
  sendEl.on_click();
  inputEl.value = "undo that";
  sendEl.on_click();
  assert.deepEqual(navigated, ["arena", "nft-atelier", "arena"]);
});

test("console empty send answers with help instead of stalling", () => {
  const documentRoot = fakeDocument();
  const guide = canonLuna();
  const api = createLunaCompanionConsole({
    documentRoot,
    companion: guide,
    features: FEATURE_DEFINITIONS,
    getCurrentFeature: () => null,
  });
  api.open();
  const logEl = documentRoot.getElementById("luna-companion-log");
  const before = logEl.children.length;
  documentRoot.getElementById("luna-companion-input").value = "   ";
  documentRoot.getElementById("luna-companion-send").on_click();
  assert.ok(logEl.children.length >= before + 2, "help reply is appended for empty input");
  const lastTurn = logEl.children[logEl.children.length - 1];
  const textEl = lastTurn.children.find((child) => child.className === "luna-companion-turn-text");
  assert.ok(textEl.textContent.includes("I'm ready."));
});
