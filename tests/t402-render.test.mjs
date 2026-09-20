import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createLivingRealityProjection } from "../src/core/demo-projection.js";
import { T402_SOURCE } from "../src/domains/t402.js";
import {
  T402_CONSOLE_SOURCE,
  createT402Console,
  summarizeT402,
} from "../src/render/t402.js";

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
    ["t402-console", true],
    ["t402-console-close"],
    ["t402-console-replay"],
    ["t402-console-reset"],
    ["t402-console-status"],
    ["t402-console-summary"],
    ["t402-console-current"],
    ["t402-console-offers"],
    ["t402-console-routes"],
    ["t402-console-escrows"],
    ["t402-console-denials"],
    ["t402-console-trace"],
    ["t402-console-boundary"],
  ].forEach(([id, hidden]) => {
    const element = makeElement(documentRoot);
    element.id = id;
    element.hidden = hidden === true;
    elements.set(id, element);
  });
  return documentRoot;
}

test("T402 summary exposes offer, route, hold, and denied movement stages", () => {
  const summary = summarizeT402(createLivingRealityProjection().world);
  assert.equal(summary.source, T402_SOURCE);
  assert.equal(summary.offerCount, 1);
  assert.equal(summary.routeCount, 1);
  assert.equal(summary.escrowCount, 1);
  assert.equal(summary.denialCount, 1);
  assert.equal(summary.recordCount, 4);
  assert.equal(summary.routes[0].from, "profile:local-participant");
  assert.equal(summary.routes[0].to, "room:reality");
  assert.equal(summary.denials[0].status, "denied");
  assert.equal(summary.localOnly, true);
  assert.equal(summary.externalTransfer, false);
  assert.equal(summary.custody, false);
  assert.equal(summary.executable, false);
  assert.equal(Object.isFrozen(summary), true);
});

test("T402 console selects, replays, and resets local route rehearsal", () => {
  const projection = createLivingRealityProjection().world;
  const before = JSON.stringify(projection);
  const documentRoot = makeDocument();
  const callbacks = [];
  const adapter = createT402Console({
    documentRoot,
    projection,
    onSelect: (snapshot) => callbacks.push(snapshot),
    onReplay: (snapshot) => callbacks.push(snapshot),
    onReset: (snapshot) => callbacks.push(snapshot),
  });
  const selected = adapter.selectRoute("route:demo", "test");
  assert.equal(selected.source, T402_CONSOLE_SOURCE);
  assert.equal(selected.record.kind, "t402-route-rehearsal");
  assert.equal(adapter.getSnapshot().selectedId, "route:demo");
  const replay = adapter.replay("test");
  assert.equal(replay.action, "replay");
  assert.deepEqual(replay.sequence, ["offer", "route", "hold"]);
  assert.equal(replay.replayedRecordCount, 4);
  adapter.reset("test");
  assert.equal(adapter.getSnapshot().trace.length, 0);
  assert.equal(callbacks.map((item) => item.action).join(","), "select,replay,reset");
  assert.equal(callbacks.every((item) => item.localOnly === true && item.simulation === true), true);
  assert.equal(callbacks.every((item) => item.externalNetwork === false && item.executable === false), true);
  assert.equal(JSON.stringify(projection), before);
});

test("T402 console markup exposes all stages and no network execution path", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/render/t402.js", import.meta.url), "utf8");
  for (const id of [
    "t402-console",
    "t402-console-close",
    "t402-console-replay",
    "t402-console-reset",
    "t402-console-status",
    "t402-console-summary",
    "t402-console-current",
    "t402-console-offers",
    "t402-console-routes",
    "t402-console-escrows",
    "t402-console-denials",
    "t402-console-trace",
    "t402-console-boundary",
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /T402 Value Routing/i);
  assert.match(source, /function selectRecord\(/);
  assert.match(source, /function replay\(/);
  assert.doesNotMatch(source, /\bfetch\s*\(/i);
  assert.doesNotMatch(source, /new\s+WebSocket/i);
  assert.doesNotMatch(source, /navigator\.sendBeacon/i);
});
