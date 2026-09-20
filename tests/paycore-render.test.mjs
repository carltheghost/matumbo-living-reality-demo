import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLivingRealityProjection } from "../src/core/demo-projection.js";
import {
  PAYCORE_ASSET_TOKEN_ENTITY_KINDS,
  createPaycoreContribution,
  PAYCORE_ENTITY_KINDS,
  PAYCORE_LEGACY_ENTITY_KINDS,
  PAYCORE_SOURCE,
  normalizePaycoreEntityKind,
} from "../src/domains/paycore.js";
import {
  PAYCORE_CONSOLE_SOURCE,
  createPaycoreConsole,
  summarizePaycore,
} from "../src/render/paycore.js";

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
    ["paycore-console", true],
    ["paycore-console-close"],
    ["paycore-console-replay"],
    ["paycore-console-reset"],
    ["paycore-console-status"],
    ["paycore-console-summary"],
    ["paycore-console-current"],
    ["paycore-console-balances"],
    ["paycore-console-flows"],
    ["paycore-console-trace"],
    ["paycore-console-boundary"],
  ].forEach(([id, hidden]) => {
    const element = makeElement(documentRoot);
    element.id = id;
    element.hidden = hidden === true;
    elements.set(id, element);
  });
  return documentRoot;
}

test("PAYCORE summary joins balances and flow previews without mutation authority", () => {
  const summary = summarizePaycore(createLivingRealityProjection().world);
  assert.equal(summary.source, PAYCORE_SOURCE);
  assert.equal(summary.balanceCount, 2);
  assert.equal(summary.flowCount, 1);
  assert.equal(summary.recordCount, 3);
  assert.equal(summary.flows[0].from, "Local Participant");
  assert.equal(summary.flows[0].to, "Simulation Pool");
  assert.equal(summary.flows[0].status, "preview");
  assert.equal(summary.localOnly, true);
  assert.equal(summary.externalTransfer, false);
  assert.equal(summary.executable, false);
  assert.equal(Object.isFrozen(summary), true);
  assert.deepEqual(summary.balances.map((record) => record.kind), [PAYCORE_ENTITY_KINDS.BALANCE, PAYCORE_ENTITY_KINDS.BALANCE]);
  assert.deepEqual(summary.flows.map((record) => record.kind), [PAYCORE_ENTITY_KINDS.FLOW]);
});

test("PAYCORE emits canonical asset-token kinds and normalizes historical aliases", () => {
  const contribution = createPaycoreContribution({
    updatedAt: "2026-08-27T00:00:00.000Z",
    balances: [
      { id: "local", label: "Local Participant", unit: "TUMBO-SIM", amount: 12 },
      { id: "pool", label: "Simulation Pool", unit: "TUMBO-SIM", amount: 20 },
    ],
    flows: [{ id: "flow", fromBalanceId: "local", toBalanceId: "pool", amount: 2 }],
  });
  assert.deepEqual(contribution.entities.map((entity) => entity.kind), [
    PAYCORE_ASSET_TOKEN_ENTITY_KINDS.BALANCE,
    PAYCORE_ASSET_TOKEN_ENTITY_KINDS.BALANCE,
    PAYCORE_ASSET_TOKEN_ENTITY_KINDS.FLOW,
  ]);

  const aliasSummary = summarizePaycore({
    source: PAYCORE_SOURCE,
    simulation: true,
    updatedAt: contribution.updatedAt,
    entities: [
      { id: "legacy-local", kind: PAYCORE_LEGACY_ENTITY_KINDS.BALANCE, label: "Legacy fixture", unit: "TUMBO-SIM", amount: 1 },
      { id: "legacy-pool", kind: PAYCORE_LEGACY_ENTITY_KINDS.BALANCE, label: "Legacy pool", unit: "TUMBO-SIM", amount: 2 },
      { id: "legacy-flow", kind: PAYCORE_LEGACY_ENTITY_KINDS.FLOW, fromBalanceId: "legacy-local", toBalanceId: "legacy-pool", unit: "TUMBO-SIM", amount: 1, status: "preview" },
      { id: "canonical-local", kind: PAYCORE_ASSET_TOKEN_ENTITY_KINDS.BALANCE, label: "Canonical fixture", unit: "TUMBO-SIM", amount: 3 },
      { id: "ignored", kind: "unknown-kind", label: "Should not render", unit: "TUMBO-SIM", amount: 4 },
    ],
  });
  assert.equal(aliasSummary.balanceCount, 3);
  assert.equal(aliasSummary.flowCount, 1);
  assert.equal(aliasSummary.recordCount, 4, "unknown entity kinds are excluded from the rendered record count");
  assert.equal(aliasSummary.balances.every((record) => record.kind === PAYCORE_ENTITY_KINDS.BALANCE), true);
  assert.equal(aliasSummary.flows.every((record) => record.kind === PAYCORE_ENTITY_KINDS.FLOW), true);
  assert.equal(normalizePaycoreEntityKind(PAYCORE_LEGACY_ENTITY_KINDS.BALANCE), PAYCORE_ENTITY_KINDS.BALANCE);
  assert.equal(normalizePaycoreEntityKind(PAYCORE_LEGACY_ENTITY_KINDS.FLOW), PAYCORE_ENTITY_KINDS.FLOW);
  assert.equal(normalizePaycoreEntityKind("unknown-kind"), null);
});

test("PAYCORE console selects and replays local flow previews, then resets", () => {
  const projection = createLivingRealityProjection().world;
  const before = JSON.stringify(projection);
  const documentRoot = makeDocument();
  const callbacks = [];
  const adapter = createPaycoreConsole({
    documentRoot,
    projection,
    onSelect: (snapshot) => callbacks.push(snapshot),
    onPreview: (snapshot) => callbacks.push(snapshot),
    onReplay: (snapshot) => callbacks.push(snapshot),
    onReset: (snapshot) => callbacks.push(snapshot),
  });
  const selected = adapter.selectFlow("paycore:preview-flow", "test");
  assert.equal(selected.source, PAYCORE_CONSOLE_SOURCE);
  assert.equal(selected.recordType, "flow");
  assert.equal(adapter.getSnapshot().selectedId, "paycore:preview-flow");
  const replay = adapter.replay("test");
  assert.equal(replay.action, "replay");
  assert.equal(replay.record.status, "preview");
  adapter.reset("test");
  assert.equal(adapter.getSnapshot().trace.length, 0);
  assert.equal(callbacks.map((item) => item.action).join(","), "select,preview-flow,replay,reset");
  assert.equal(callbacks.every((item) => item.localOnly === true && item.simulation === true), true);
  assert.equal(callbacks.every((item) => item.externalNetwork === false && item.executable === false), true);
  assert.equal(JSON.stringify(projection), before);
});

test("PAYCORE console markup exposes balances, flows, and a local-only boundary", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/render/paycore.js", import.meta.url), "utf8");
  for (const id of [
    "paycore-console",
    "paycore-console-close",
    "paycore-console-replay",
    "paycore-console-reset",
    "paycore-console-status",
    "paycore-console-summary",
    "paycore-console-current",
    "paycore-console-balances",
    "paycore-console-flows",
    "paycore-console-trace",
    "paycore-console-boundary",
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /PAYCORE/i);
  assert.match(source, /function previewFlow\(/);
  assert.match(source, /function replay\(/);
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
  assert.doesNotMatch(source, /new\s+WebSocket/i);
  assert.doesNotMatch(source, /navigator\.sendBeacon/i);
});

test("PAYCORE visible labels stay asset-token-first", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const navigatorSource = await readFile(new URL("../src/render/feature-navigator.js", import.meta.url), "utf8");
  const rendererSource = await readFile(new URL("../src/render/paycore.js", import.meta.url), "utf8");
  assert.match(html, /PAYCORE Asset-token Balances/);
  assert.match(html, /Fictional PAYCORE asset-token balances/i);
  assert.match(html, /READY · SELECT AN ASSET-TOKEN BALANCE OR FLOW PREVIEW/);
  assert.match(navigatorSource, /label: "PAYCORE Asset-token Balances"/);
  assert.match(navigatorSource, /asset-token balance previews/i);
  assert.match(rendererSource, /ASSET-TOKEN BALANCE PREVIEW ONLY/);
  assert.match(rendererSource, /ASSET-TOKEN FLOW/);
  assert.doesNotMatch(html, /\bcoin\b/i);
});
