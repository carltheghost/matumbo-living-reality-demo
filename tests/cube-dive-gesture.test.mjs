import assert from "node:assert/strict";
import { test } from "node:test";
import { createBlockWorldContribution } from "../src/domains/block-world.js";
import {
  BLOCK_WORLD_DOUBLE_ACTIVATION_WINDOW_MS,
  createBlockWorldLayer,
} from "../src/render/block-world.js";
import { CUBE_DIVE_DOUBLE_TAP_WINDOW_MS } from "../src/domains/cube-dive.js";

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
    classList: { toggle() {}, add() {}, remove() {}, contains() { return false; } },
    append(...children) { children.forEach((child) => this.appendChild(child)); },
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    setAttribute(name, value) { this.attributes.set(name, String(value)); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
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
    "block-world-console", "block-world-close", "block-world-replay",
    "block-world-add", "block-world-remove", "block-world-replace",
    "block-world-open", "block-world-inspect",
    "block-world-move-left", "block-world-move-right",
    "block-world-move-forward", "block-world-move-back",
    "block-world-move-up", "block-world-move-down",
    "block-world-grab",
    "block-world-hold-left", "block-world-hold-right",
    "block-world-hold-forward", "block-world-hold-back",
    "block-world-hold-up", "block-world-hold-down",
    "block-world-place", "block-world-status",
    "block-world-count", "block-world-draft-count", "block-world-container-count",
    "block-world-content-count", "block-world-selection", "block-world-list",
    "block-world-palette", "block-world-trace", "block-world-boundary",
    "block-world-inspection", "block-world-contents", "block-world-routes",
    "block-world-navigation-status", "block-world-navigation-trace",
    "block-world-content-previous", "block-world-content-next",
    "block-world-content-navigation-status",
  ].forEach((id) => {
    const element = makeElement(documentRoot);
    element.id = id;
    elements.set(id, element);
  });
  return documentRoot;
}

function firstPortal(base) {
  return base.blocks.find((block) => block.blockType === "portal");
}

function firstNonPortalContainer(base) {
  return base.blocks.find((block) => block.container === true && block.contentCount > 0 && block.blockType !== "portal");
}

test("a quick second tap on a portal cube requests a dive, not a toggle", () => {
  const base = createBlockWorldContribution();
  const portal = firstPortal(base);
  assert.ok(portal);
  const dives = [];
  const layer = createBlockWorldLayer({
    documentRoot: makeDocument(),
    projection: base,
    three: null,
    onDiveRequest: (request) => dives.push(request),
  });
  const openBefore = layer.getSnapshot().draft.blocks.find((b) => b.id === portal.id).open;
  assert.equal(layer.registerFieldTap(portal.id, { pointerType: "touch", timeStamp: 1000, clientX: 50, clientY: 50 }), null);
  assert.equal(
    layer.registerFieldTap(portal.id, { pointerType: "touch", timeStamp: 1000 + CUBE_DIVE_DOUBLE_TAP_WINDOW_MS - 50, clientX: 51, clientY: 50 }),
    null,
    "the dive routes through onDiveRequest; registerFieldTap itself returns null",
  );
  assert.equal(dives.length, 1);
  assert.equal(dives[0].blockId, portal.id);
  assert.ok(dives[0].featureId, "the dive request carries the bound feature");
  assert.equal(dives[0].method, "double-tap");
  assert.equal(dives[0].simulation, true);
  assert.equal(dives[0].externalTransfer, false);
  const draft = layer.getSnapshot().draft;
  assert.equal(draft.blocks.find((b) => b.id === portal.id).open, openBefore, "no toggle happened");
  assert.equal(draft.editCount, 0, "no local edit was committed by the dive gesture");
});

test("a portal second tap outside the 350ms dive window does not dive", () => {
  const base = createBlockWorldContribution();
  const portal = firstPortal(base);
  const dives = [];
  const layer = createBlockWorldLayer({
    documentRoot: makeDocument(),
    projection: base,
    three: null,
    onDiveRequest: (request) => dives.push(request),
  });
  layer.registerFieldTap(portal.id, { pointerType: "mouse", timeStamp: 1000, clientX: 50, clientY: 50 });
  // Inside the legacy 420ms toggle window but past the 350ms dive window:
  // portal cubes reserve double activation for the dive, so nothing fires.
  assert.equal(
    layer.registerFieldTap(portal.id, { pointerType: "mouse", timeStamp: 1000 + CUBE_DIVE_DOUBLE_TAP_WINDOW_MS + 40, clientX: 50, clientY: 50 }),
    null,
  );
  assert.equal(dives.length, 0);
  assert.equal(layer.getSnapshot().draft.editCount, 0);
});

test("portal dive needs the same pointer type and a nearby second tap", () => {
  const base = createBlockWorldContribution();
  const portal = firstPortal(base);
  const dives = [];
  const layer = createBlockWorldLayer({
    documentRoot: makeDocument(),
    projection: base,
    three: null,
    onDiveRequest: (request) => dives.push(request),
  });
  layer.registerFieldTap(portal.id, { pointerType: "touch", timeStamp: 1000, clientX: 50, clientY: 50 });
  assert.equal(layer.registerFieldTap(portal.id, { pointerType: "mouse", timeStamp: 1100, clientX: 50, clientY: 50 }), null);
  assert.equal(dives.length, 0, "different pointer type starts a new sequence");
  layer.registerFieldTap(portal.id, { pointerType: "touch", timeStamp: 2000, clientX: 50, clientY: 50 });
  assert.equal(layer.registerFieldTap(portal.id, { pointerType: "touch", timeStamp: 2100, clientX: 500, clientY: 500 }), null);
  assert.equal(dives.length, 0, "a far second tap does not dive");
});

test("a drag can never seed or trigger a dive", () => {
  const base = createBlockWorldContribution();
  const portal = firstPortal(base);
  const dives = [];
  const layer = createBlockWorldLayer({
    documentRoot: makeDocument(),
    projection: base,
    three: null,
    onDiveRequest: (request) => dives.push(request),
  });
  layer.beginDirectManipulation(portal.id, { pointerId: 3, pointerType: "touch", clientX: 50, clientY: 50, timeStamp: 1000 });
  const done = layer.completeDirectManipulation({ pointerId: 3, pointerType: "touch", clientX: 52, clientY: 51, timeStamp: 1100 });
  assert.ok(["direct-drag", "direct-drag-cancel", "direct-drag-rejected"].includes(done.action));
  // Simulate the host calling registerFieldTap only for below-threshold taps;
  // a real drag path clears the candidate instead.
  layer.clearFieldTap();
  assert.equal(layer.getSnapshot().fieldTapCandidate, null);
  assert.equal(dives.length, 0);
});

test("non-portal containers keep the double-tap toggle contract", () => {
  const base = createBlockWorldContribution();
  const container = firstNonPortalContainer(base);
  assert.ok(container);
  const dives = [];
  const layer = createBlockWorldLayer({
    documentRoot: makeDocument(),
    projection: base,
    three: null,
    onDiveRequest: (request) => dives.push(request),
  });
  layer.registerFieldTap(container.id, { pointerType: "touch", timeStamp: 1000, clientX: 40, clientY: 40 });
  const opened = layer.registerFieldTap(container.id, { pointerType: "touch", timeStamp: 1200, clientX: 40, clientY: 40 });
  assert.equal(opened.action, "open");
  assert.equal(dives.length, 0, "containers never dive");
  // Explicit open/close API and buttons are untouched.
  assert.equal(typeof layer.openBlock, "function");
  assert.equal(typeof layer.toggleBlock, "function");
});

test("double-tapping a nested content cube requests a deeper dive", () => {
  const base = createBlockWorldContribution();
  const container = firstNonPortalContainer(base);
  assert.ok(container);
  const contentId = container.contents[0].id;
  const deeper = [];
  const layer = createBlockWorldLayer({
    documentRoot: makeDocument(),
    projection: base,
    three: null,
    onContentDoubleTap: (tap) => deeper.push(tap),
  });
  const input = (t) => ({ pointerType: "touch", timeStamp: t, clientX: 60, clientY: 60 });
  layer.selectContent(container.id, contentId, "canvas", input(1000));
  assert.equal(deeper.length, 0, "first tap only selects");
  layer.selectContent(container.id, contentId, "canvas", input(1150));
  assert.equal(deeper.length, 1);
  assert.equal(deeper[0].parentBlockId, container.id);
  assert.equal(deeper[0].contentId, contentId);
  assert.equal(deeper[0].method, "double-tap");
  assert.equal(deeper[0].simulation, true);
  // Button/keyboard content navigation never dives.
  layer.selectContent(container.id, contentId, "content-next");
  layer.selectContent(container.id, contentId, "content-next");
  assert.equal(deeper.length, 1);
});

test("content world positions are deterministic presentation math", () => {
  const base = createBlockWorldContribution();
  const container = firstNonPortalContainer(base);
  const layer = createBlockWorldLayer({ documentRoot: makeDocument(), projection: base, three: null });
  const a = layer.getContentWorldPosition(container.id, 0);
  const b = layer.getContentWorldPosition(container.id, 0);
  assert.deepEqual(a, b);
  assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.z));
  assert.equal(a.parentBlockId, container.id);
  assert.equal(layer.getContentWorldPosition("missing:block", 0), null);
});

test("no native dblclick listener is used for dive gestures", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/render/block-world.js", import.meta.url), "utf8"));
  assert.ok(!/addEventListener\(\s*["']dblclick["']/.test(source), "renderer must not listen for native dblclick");
  assert.ok(source.includes("CUBE_DIVE_DOUBLE_TAP_WINDOW_MS"), "dive window constant is wired");
  assert.ok(
    1000 + BLOCK_WORLD_DOUBLE_ACTIVATION_WINDOW_MS > 1000 + CUBE_DIVE_DOUBLE_TAP_WINDOW_MS,
    "the dive window is tighter than the legacy toggle window",
  );
});
