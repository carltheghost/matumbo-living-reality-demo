import assert from "node:assert/strict";
import { test } from "node:test";
import { MUSE_AGENT_BOUNDARY, createMuseAgentConsole } from "../src/render/muse-agent.js";
import { createMuseAgent } from "../src/domains/muse-agent.js";

function makeElement(documentRoot, tag = "div") {
  return {
    ownerDocument: documentRoot,
    tagName: tag.toUpperCase(),
    id: "",
    className: "",
    dataset: {},
    hidden: false,
    disabled: false,
    textContent: "",
    value: "",
    type: "",
    style: {},
    children: [],
    listeners: new Map(),
    attributes: new Map(),
    append(...children) { children.forEach((child) => this.appendChild(child)); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    click() { this.listeners.get("click")?.({}); },
    focus() {},
  };
}

function makeDocument() {
  const elements = new Map();
  const documentRoot = {
    createElement(tag) { return makeElement(documentRoot, tag); },
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener() {},
    register(id, hidden = false) {
      const element = makeElement(documentRoot);
      element.id = id;
      element.hidden = hidden;
      elements.set(id, element);
      return element;
    },
  };
  [
    ["muse-agent-console", true], ["muse-agent-close"], ["muse-agent-status"],
    ["muse-agent-profiles"], ["muse-agent-name"], ["muse-agent-provider"],
    ["muse-agent-add"], ["muse-agent-kind"], ["muse-agent-prompt"],
    ["muse-agent-generate"], ["muse-agent-result"], ["muse-agent-gallery"],
    ["muse-agent-boundary"],
  ].forEach(([id, hidden]) => documentRoot.register(id, hidden));
  return documentRoot;
}

function fakeStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
  };
}

function mount(hooks = {}) {
  const documentRoot = makeDocument();
  const agent = createMuseAgent({ storage: fakeStorage(), seed: "console-test", now: () => "2026-09-18T12:00:00.000Z" });
  const applied = [];
  const generated = [];
  const profiles = [];
  const consoleApi = createMuseAgentConsole({
    documentRoot,
    agent,
    onApplyAvatar: (design, snapshot) => { applied.push({ design, snapshot }); hooks.onApplyAvatar?.(design, snapshot); },
    onGenerate: (snapshot, design) => { generated.push({ snapshot, design }); },
    onProfile: (snapshot, detail) => { profiles.push({ snapshot, detail }); },
    onReplay: (snapshot) => hooks.onReplay?.(snapshot),
  });
  return { documentRoot, agent, consoleApi, applied, generated, profiles };
}

test("console requires every mount point", () => {
  const documentRoot = makeDocument();
  documentRoot.getElementById("muse-agent-prompt").id = "renamed";
  // Simulate a missing mount by deleting it from the registry lookup.
  const broken = {
    ...documentRoot,
    getElementById: (id) => (id === "muse-agent-generate" ? null : documentRoot.getElementById(id)),
  };
  assert.throws(() => createMuseAgentConsole({ documentRoot: broken }), /mount points are missing/);
});

test("opening greets with the guest profile and the boundary", () => {
  const { documentRoot, consoleApi } = mount();
  const snapshot = consoleApi.open("test");
  assert.equal(snapshot.opened, true);
  assert.equal(snapshot.action, "open");
  assert.equal(snapshot.externalNetwork, false);
  assert.equal(snapshot.externalAuth, false);
  assert.equal(snapshot.aiService, false);
  assert.equal(snapshot.boundary, MUSE_AGENT_BOUNDARY);
  assert.match(documentRoot.getElementById("muse-agent-status").textContent, /DESIGNING AS GUEST/);
  assert.match(documentRoot.getElementById("muse-agent-boundary").textContent, /local display names only/);
  assert.equal(documentRoot.getElementById("muse-agent-console").hidden, false);
  consoleApi.close("test");
  assert.equal(documentRoot.getElementById("muse-agent-console").hidden, true);
});

test("adding a profile switches the designing identity", () => {
  const { documentRoot, agent, profiles } = mount();
  documentRoot.getElementById("muse-agent-name").value = "Tumbo";
  documentRoot.getElementById("muse-agent-provider").value = "muse";
  documentRoot.getElementById("muse-agent-add").click();
  assert.equal(agent.getActiveProfile().displayName, "Tumbo");
  assert.equal(profiles.length, 1);
  assert.match(documentRoot.getElementById("muse-agent-status").textContent, /DESIGNING AS TUMBO/);
  // Empty names are blocked with a status message, not a crash.
  documentRoot.getElementById("muse-agent-name").value = "   ";
  documentRoot.getElementById("muse-agent-add").click();
  assert.match(documentRoot.getElementById("muse-agent-status").textContent, /PROFILE BLOCKED/);
});

test("generating an avatar design renders a spec card", () => {
  const { documentRoot, generated } = mount();
  documentRoot.getElementById("muse-agent-kind").value = "avatar";
  documentRoot.getElementById("muse-agent-prompt").value = "royal crimson champion";
  documentRoot.getElementById("muse-agent-generate").click();
  assert.equal(generated.length, 1);
  const card = documentRoot.getElementById("muse-agent-result").children[0];
  assert.ok(card);
  const text = JSON.stringify(card, (key, value) => (key === "listeners" || key === "ownerDocument" ? undefined : value));
  assert.match(text, /AVATAR DESIGN/);
  assert.match(text, /Oxblood/);
  assert.match(documentRoot.getElementById("muse-agent-status").textContent, /DESIGNED/);
  // Empty prompts are blocked with a status message.
  documentRoot.getElementById("muse-agent-prompt").value = "  ";
  documentRoot.getElementById("muse-agent-generate").click();
  assert.match(documentRoot.getElementById("muse-agent-status").textContent, /DESIGN BLOCKED/);
});

test("applying an avatar design fires the host apply hook with the spec", () => {
  const { documentRoot, applied, agent } = mount();
  documentRoot.getElementById("muse-agent-kind").value = "avatar";
  documentRoot.getElementById("muse-agent-prompt").value = "golden hologram champion";
  documentRoot.getElementById("muse-agent-generate").click();
  const card = documentRoot.getElementById("muse-agent-result").children[0];
  const actions = card.children.find((node) => node.className === "muse-agent-actions");
  assert.ok(actions);
  const applyButton = actions.children[0];
  assert.ok(applyButton);
  applyButton.click();
  assert.equal(applied.length, 1);
  assert.equal(applied[0].design.kind, "avatar");
  assert.ok(applied[0].design.outfitId);
  assert.ok(applied[0].design.hologramTint);
  assert.equal(agent.getDesign(applied[0].design.id)?.applied, true);
  assert.match(documentRoot.getElementById("muse-agent-status").textContent, /APPLIED/);
});

test("image designs save briefs to the gallery and reload on click", () => {
  const { documentRoot, agent } = mount();
  documentRoot.getElementById("muse-agent-kind").value = "image";
  documentRoot.getElementById("muse-agent-prompt").value = "violet nebula portrait";
  documentRoot.getElementById("muse-agent-generate").click();
  const card = documentRoot.getElementById("muse-agent-result").children[0];
  const actions = card.children.find((node) => node.className === "muse-agent-actions");
  assert.ok(actions);
  actions.children[0].click();
  assert.equal(agent.listDesigns().length, 1);
  const galleryButton = documentRoot.getElementById("muse-agent-gallery").children[0];
  assert.ok(galleryButton);
  galleryButton.click();
  assert.match(documentRoot.getElementById("muse-agent-status").textContent, /BRIEF LOADED/);
});

test("snapshot is frozen and replay publishes", () => {
  const seen = [];
  const { consoleApi } = mount({ onReplay: (snapshot) => seen.push(snapshot) });
  const snapshot = consoleApi.getSnapshot();
  assert.ok(Object.isFrozen(snapshot));
  assert.equal(snapshot.source, "muse-agent-console");
  consoleApi.replay("test");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].action, "replay");
});
