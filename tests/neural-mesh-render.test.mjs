import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLivingRealityProjection } from "../src/core/demo-projection.js";
import { NEURAL_MESH_SOURCE } from "../src/domains/neural-mesh.js";
import {
  NEURAL_MESH_CONSOLE_SOURCE,
  createNeuralMeshConsole,
  summarizeNeuralMesh,
} from "../src/render/neural-mesh.js";

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
    children: [],
    listeners: new Map(),
    attributes: new Map(),
    classList: { toggle() {} },
    append(...children) { children.forEach((child) => this.appendChild(child)); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    focus() {},
  };
}

function makeDocument() {
  const elements = new Map();
  const documentRoot = {
    createElement(tag) { return makeElement(documentRoot, tag); },
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener() {},
  };
  [
    ["neural-mesh-console", true],
    ["neural-mesh-close"],
    ["neural-mesh-replay"],
    ["neural-mesh-reset"],
    ["neural-mesh-status"],
    ["neural-mesh-summary"],
    ["neural-mesh-current"],
    ["neural-mesh-agents"],
    ["neural-mesh-intents"],
    ["neural-mesh-proposals"],
    ["neural-mesh-relationships"],
    ["neural-mesh-ancestry"],
    ["neural-mesh-trace"],
    ["neural-mesh-boundary"],
  ].forEach(([id, hidden]) => {
    const element = makeElement(documentRoot);
    element.id = id;
    element.hidden = hidden === true;
    elements.set(id, element);
  });
  return documentRoot;
}

test("Neural Mesh summary joins the Control Tower, Oracle, intent, and proposal graph", () => {
  const summary = summarizeNeuralMesh(createLivingRealityProjection().world);
  assert.equal(summary.source, NEURAL_MESH_SOURCE);
  assert.equal(summary.agentCount, 2);
  assert.equal(summary.intentCount, 1);
  assert.equal(summary.proposalCount, 1);
  assert.equal(summary.relationshipCount, 1);
  assert.equal(summary.ancestryCount, 1);
  assert.equal(summary.recordCount, 6);
  assert.equal(summary.agents.find((agent) => agent.id === "agent:control")?.label, "Control Tower");
  assert.equal(summary.agents.find((agent) => agent.id === "agent:oracle")?.label, "Oracle");
  assert.equal(summary.relationships[0].displayLabel, "Control Tower → Oracle");
  assert.equal(summary.relationships[0].relationship, "observes");
  assert.equal(summary.intents[0].agentLabel, "Control Tower");
  assert.equal(summary.proposals[0].intentSummary, "Inspect the local world projection");
  assert.equal(summary.proposals[0].status, "proposed");
  assert.equal(summary.localOnly, true);
  assert.equal(summary.advisoryOnly, true);
  assert.equal(summary.autonomousExecution, false);
  assert.equal(summary.providerAccess, false);
  assert.equal(summary.toolAccess, false);
  assert.equal(summary.executable, false);
  assert.equal(Object.isFrozen(summary), true);
  assert.equal(Object.isFrozen(summary.relationships[0]), true);
});

test("Neural Mesh console selects and replays advisory links in memory", () => {
  const projection = createLivingRealityProjection().world;
  const before = JSON.stringify(projection);
  const documentRoot = makeDocument();
  const callbacks = [];
  const adapter = createNeuralMeshConsole({
    documentRoot,
    projection,
    onSelect: (snapshot) => callbacks.push(snapshot),
    onAgent: (snapshot) => callbacks.push(snapshot),
    onIntent: (snapshot) => callbacks.push(snapshot),
    onProposal: (snapshot) => callbacks.push(snapshot),
    onRelationship: (snapshot) => callbacks.push(snapshot),
    onAncestry: (snapshot) => callbacks.push(snapshot),
    onReplay: (snapshot) => callbacks.push(snapshot),
    onReset: (snapshot) => callbacks.push(snapshot),
  });

  const relation = adapter.selectRelationship("relation:control-oracle", "test");
  assert.equal(relation.source, NEURAL_MESH_CONSOLE_SOURCE);
  assert.equal(relation.recordType, "relationship");
  assert.equal(relation.record.displayLabel, "Control Tower → Oracle");
  assert.equal(adapter.getSnapshot().selectedId, "relation:control-oracle");

  const replay = adapter.replay("test");
  assert.equal(replay.action, "replay");
  assert.deepEqual(replay.sequence, ["agent:control", "relation:control-oracle", "agent:oracle"]);
  assert.deepEqual(replay.sequenceTypes, ["agent", "relationship", "agent"]);
  assert.equal(replay.replayedRecordCount, 6);

  const proposal = adapter.selectProposal("proposal:inspect", "test");
  assert.equal(proposal.recordType, "proposal");
  assert.equal(proposal.record.intentId, "intent:inspect");
  const proposalReplay = adapter.replay("test");
  assert.deepEqual(proposalReplay.sequence, ["intent:inspect", "proposal:inspect"]);

  const ancestry = adapter.selectAncestry("ancestry:oracle", "test");
  assert.equal(ancestry.recordType, "ancestry");
  assert.equal(ancestry.record.descendantLabel, "Oracle");

  adapter.reset("test");
  assert.equal(adapter.getSnapshot().trace.length, 0);
  assert.equal(callbacks.filter((item) => item.action === "select").length, 6);
  assert.equal(callbacks.filter((item) => item.action === "replay").length, 2);
  assert.equal(callbacks.at(-1).action, "reset");
  assert.equal(callbacks.every((item) => item.localOnly === true && item.simulation === true), true);
  assert.equal(callbacks.every((item) => item.externalNetwork === false && item.executable === false), true);
  assert.equal(JSON.stringify(projection), before);
});

test("Neural Mesh console exposes every graph stage and no execution path", async () => {
  const source = await readFile(new URL("../src/render/neural-mesh.js", import.meta.url), "utf8");
  for (const id of [
    "neural-mesh-console",
    "neural-mesh-close",
    "neural-mesh-replay",
    "neural-mesh-reset",
    "neural-mesh-status",
    "neural-mesh-summary",
    "neural-mesh-current",
    "neural-mesh-agents",
    "neural-mesh-intents",
    "neural-mesh-proposals",
    "neural-mesh-relationships",
    "neural-mesh-ancestry",
    "neural-mesh-trace",
    "neural-mesh-boundary",
  ]) assert.match(source, new RegExp(id.replaceAll("-", "\\-")));
  assert.match(source, /Control Tower/);
  assert.match(source, /Oracle/);
  assert.match(source, /function selectRecord\(/);
  assert.match(source, /function replay\(/);
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
  assert.doesNotMatch(source, /new\s+WebSocket/i);
  assert.doesNotMatch(source, /navigator\.sendBeacon/i);
});
