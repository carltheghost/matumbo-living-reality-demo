import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createBlockWorldContribution } from "../src/domains/block-world.js";
import {
  BLOCK_WORLD_DOUBLE_ACTIVATION_DISTANCE_PX,
  BLOCK_WORLD_DOUBLE_ACTIVATION_WINDOW_MS,
  createBlockWorldLayer,
} from "../src/render/block-world.js";

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
    ["block-world-console", true],
    ["block-world-close"],
    ["block-world-replay"],
    ["block-world-add"],
    ["block-world-remove"],
    ["block-world-replace"],
    ["block-world-open"],
    ["block-world-inspect"],
    ["block-world-move-left"],
    ["block-world-move-right"],
    ["block-world-move-forward"],
    ["block-world-move-back"],
    ["block-world-move-up"],
    ["block-world-move-down"],
    ["block-world-grab"],
    ["block-world-hold-left"],
    ["block-world-hold-right"],
    ["block-world-hold-forward"],
    ["block-world-hold-back"],
    ["block-world-hold-up"],
    ["block-world-hold-down"],
    ["block-world-place"],
    ["block-world-status"],
    ["block-world-count"],
    ["block-world-draft-count"],
    ["block-world-container-count"],
    ["block-world-content-count"],
    ["block-world-selection"],
    ["block-world-list"],
    ["block-world-palette"],
    ["block-world-trace"],
    ["block-world-boundary"],
    ["block-world-inspection"],
    ["block-world-contents"],
    ["block-world-routes"],
    ["block-world-navigation-status"],
    ["block-world-navigation-trace"],
  ].forEach(([id, hidden]) => {
    const element = makeElement(documentRoot);
    element.id = id;
    element.hidden = hidden === true;
    elements.set(id, element);
  });
  return documentRoot;
}

function firstContainer(projection) {
  return projection.blocks.find((block) => block.container === true && block.contentCount > 0);
}

function firstSolid(projection) {
  return projection.blocks.find((block) => block.container !== true);
}

function hasEmptyCardinalCell(projection, block) {
  const deltas = [
    { dx: 1, dy: 0, dz: 0 },
    { dx: -1, dy: 0, dz: 0 },
    { dx: 0, dy: 0, dz: 1 },
    { dx: 0, dy: 0, dz: -1 },
  ];
  return deltas.find((delta) => {
    const x = block.x + delta.dx;
    const y = block.y + delta.dy;
    const z = block.z + delta.dz;
    return x >= 0 && x < projection.dimensions.width
      && y >= 0 && y < projection.dimensions.height
      && z >= 0 && z < projection.dimensions.depth
      && !projection.blocks.some((candidate) => candidate.x === x && candidate.y === y && candidate.z === z);
  }) ?? null;
}

test("container field double activation toggles once for mouse and touch", () => {
  const base = createBlockWorldContribution();
  const container = firstContainer(base);
  assert.ok(container);
  const layer = createBlockWorldLayer({ documentRoot: makeDocument(), projection: base, three: null });

  assert.equal(layer.registerFieldTap(container.id, { pointerType: "mouse", timeStamp: 100, clientX: 40, clientY: 40 }), null);
  assert.equal(layer.getSnapshot().selectedId, container.id);
  assert.equal(layer.getSnapshot().draft.blocks.find((block) => block.id === container.id).open, false);

  const opened = layer.registerFieldTap(container.id, { pointerType: "mouse", timeStamp: 260, clientX: 41, clientY: 40 });
  assert.equal(opened.action, "open");
  assert.equal(opened.gesture, "double-click");
  assert.equal(layer.getSnapshot().draft.blocks.find((block) => block.id === container.id).open, true);

  const closed = layer.registerFieldTap(container.id, { pointerType: "touch", timeStamp: 500, clientX: 40, clientY: 40 });
  assert.equal(closed, null, "a different pointer type starts a new tap sequence");
  const touchClose = layer.registerFieldTap(container.id, { pointerType: "touch", timeStamp: 650, clientX: 40, clientY: 40 });
  assert.equal(touchClose.action, "close");
  assert.equal(touchClose.gesture, "double-tap");
  assert.equal(layer.getSnapshot().draft.blocks.find((block) => block.id === container.id).open, false);
});

test("a short field click only selects and stale taps never open a container", () => {
  const base = createBlockWorldContribution();
  const container = firstContainer(base);
  const layer = createBlockWorldLayer({ documentRoot: makeDocument(), projection: base, three: null });

  layer.selectBlock(container.id, "canvas");
  const first = layer.registerFieldTap(container.id, { pointerType: "mouse", timeStamp: 10, clientX: 20, clientY: 20 });
  assert.equal(first, null);
  assert.equal(layer.getSnapshot().draft.localDraft, false);
  assert.equal(layer.getSnapshot().draft.editCount, 0);
  assert.equal(layer.getSnapshot().draft.blocks.find((block) => block.id === container.id).open, false);
  assert.equal(layer.getSnapshot().fieldTapCandidate.blockId, container.id);

  const stale = layer.registerFieldTap(container.id, {
    pointerType: "mouse",
    timeStamp: 10 + BLOCK_WORLD_DOUBLE_ACTIVATION_WINDOW_MS + 1,
    clientX: 20,
    clientY: 20,
  });
  assert.equal(stale, null);
  assert.equal(layer.getSnapshot().draft.editCount, 0);
  assert.equal(layer.getSnapshot().draft.blocks.find((block) => block.id === container.id).open, false);
});

test("a drag remains a one-step move and cannot become a field double activation", () => {
  const base = createBlockWorldContribution();
  const block = base.blocks.find((candidate) => hasEmptyCardinalCell(base, candidate));
  assert.ok(block);
  const delta = hasEmptyCardinalCell(base, block);
  assert.ok(delta);
  const layer = createBlockWorldLayer({ documentRoot: makeDocument(), projection: base, three: null });
  layer.beginDirectManipulation(block.id, { pointerId: 7, pointerType: "mouse", clientX: 10, clientY: 10, timeStamp: 100 });
  layer.updateDirectManipulation({ pointerId: 7, pointerType: "mouse", clientX: delta.dx ? 60 : 10, clientY: delta.dz ? 60 : 10 });
  const moved = layer.completeDirectManipulation({ pointerId: 7, pointerType: "mouse", clientX: delta.dx ? 60 : 10, clientY: delta.dz ? 60 : 10, timeStamp: 180 });
  assert.equal(moved.action, "direct-drag");
  assert.equal(moved.transition, "grab>hold>place");
  assert.equal(layer.getSnapshot().draft.openContainerCount, 0);
  assert.equal(layer.getSnapshot().fieldTapCandidate, null);
  assert.equal(layer.getSnapshot().trace.some((entry) => ["open", "close"].includes(entry.action)), false);
});

test("solid, malformed, and unknown field double activations are inert and local", () => {
  const base = createBlockWorldContribution();
  const solid = firstSolid(base);
  const before = JSON.stringify(base);
  const layer = createBlockWorldLayer({ documentRoot: makeDocument(), projection: base, three: null });

  assert.equal(layer.activateFieldDouble(solid.id), null);
  assert.match(layer.getSnapshot().boundary, /No filesystem import/i);
  assert.match(layer.getSnapshot().draft.blocks.find((block) => block.id === solid.id).blockType, /water|grass|stone|wood|crystal|portal/);
  assert.equal(layer.registerFieldTap(solid.id, { pointerType: "touch", timeStamp: 0, clientX: 5, clientY: 5 }), null);
  assert.equal(layer.registerFieldTap(solid.id, { pointerType: "touch", timeStamp: 100, clientX: 5, clientY: 5 }), null);
  assert.equal(layer.activateFieldDouble("missing:block"), null);
  assert.equal(layer.getSnapshot().draft.editCount, 0);
  assert.equal(JSON.stringify(base), before);
  assert.ok(BLOCK_WORLD_DOUBLE_ACTIVATION_DISTANCE_PX > 0);
});

test("the canvas pointer seam promotes only below-threshold taps and has no duplicate dblclick listener", async () => {
  const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(source, /result\?\.action === ['"]direct-drag-cancel['"]/);
  assert.match(source, /registerFieldTap/);
  assert.doesNotMatch(source, /addEventListener\(\s*['"]dblclick['"]/i);
});
