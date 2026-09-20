import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createBlockWorldContribution,
  createBlockWorldDirectManipulationDraft,
} from "../src/domains/block-world.js";
import {
  BLOCK_WORLD_DIRECT_DRAG_THRESHOLD_PX,
  BLOCK_WORLD_DOUBLE_ACTIVATION_DISTANCE_PX,
  BLOCK_WORLD_DOUBLE_ACTIVATION_WINDOW_MS,
  createBlockWorldLayer,
  mapBlockWorldDragDelta,
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
    classList: {
      values: new Set(),
      toggle(name, force) {
        if (force === true) this.values.add(name);
        else if (force === false) this.values.delete(name);
        else if (this.values.has(name)) this.values.delete(name);
        else this.values.add(name);
      },
    },
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
    register(id, hidden = false) {
      const element = makeElement(documentRoot);
      element.id = id;
      element.hidden = hidden;
      elements.set(id, element);
      return element;
    },
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
  ].forEach(([id, hidden]) => documentRoot.register(id, hidden));
  return documentRoot;
}

const CARDINAL = [
  { dx: 1, dy: 0, dz: 0 },
  { dx: -1, dy: 0, dz: 0 },
  { dx: 0, dy: 0, dz: 1 },
  { dx: 0, dy: 0, dz: -1 },
];

function findAdjacent(base, predicate) {
  for (const block of base.blocks) {
    for (const delta of CARDINAL) {
      const coordinate = [block.x + delta.dx, block.y + delta.dy, block.z + delta.dz];
      if (coordinate[0] < 0 || coordinate[0] >= base.dimensions.width
        || coordinate[1] < 0 || coordinate[1] >= base.dimensions.height
        || coordinate[2] < 0 || coordinate[2] >= base.dimensions.depth) continue;
      const occupied = base.blocks.some((other) => other.x === coordinate[0]
        && other.y === coordinate[1] && other.z === coordinate[2]);
      if (predicate({ block, delta, coordinate, occupied })) return { block, delta, coordinate, occupied };
    }
  }
  return null;
}

function eventForDelta(delta, x = 100, y = 100) {
  return delta.dx !== 0
    ? { clientX: x + delta.dx * (BLOCK_WORLD_DIRECT_DRAG_THRESHOLD_PX + 12), clientY: y }
    : { clientX: x, clientY: y + delta.dz * (BLOCK_WORLD_DIRECT_DRAG_THRESHOLD_PX + 12) };
}

test("screen displacement maps to one deterministic axis and keeps clicks below threshold", () => {
  assert.deepEqual(mapBlockWorldDragDelta({ clientX: 10, clientY: 10 }, { clientX: 10 + BLOCK_WORLD_DIRECT_DRAG_THRESHOLD_PX - 1, clientY: 10 }), null);
  assert.deepEqual(mapBlockWorldDragDelta({ clientX: 10, clientY: 10 }, { clientX: 50, clientY: 12 }), { dx: 1, dy: 0, dz: 0 });
  assert.deepEqual(mapBlockWorldDragDelta({ clientX: 10, clientY: 10 }, { clientX: 12, clientY: 50 }), { dx: 0, dy: 0, dz: 1 });
  assert.deepEqual(mapBlockWorldDragDelta({ clientX: 10, clientY: 10 }, { clientX: 8, clientY: -30 }), { dx: 0, dy: 0, dz: -1 });
});

test("domain direct manipulation atomically records Grab, Hold, Place and preserves canonical input", () => {
  const base = createBlockWorldContribution();
  const candidate = findAdjacent(base, ({ occupied }) => !occupied);
  assert.ok(candidate, "fixture should expose an empty cardinal destination");
  const before = JSON.stringify(base);
  const draft = createBlockWorldDirectManipulationDraft(base, candidate.block.id, candidate.delta);
  assert.equal(JSON.stringify(base), before);
  assert.equal(draft.lastEdit.action, "direct-drag");
  assert.equal(draft.lastEdit.transition, "grab>hold>place");
  assert.deepEqual(draft.lastEdit.stages.map((stage) => stage.action), ["grab", "hold", "place"]);
  assert.deepEqual(draft.lastEdit.from, [candidate.block.x, candidate.block.y, candidate.block.z]);
  assert.deepEqual(draft.lastEdit.to, candidate.coordinate);
  assert.equal(draft.holding, false);
  assert.equal(draft.blocks.length, base.blocks.length);
  assert.equal(draft.blocks.some((block) => block.x === candidate.coordinate[0]
    && block.y === candidate.coordinate[1] && block.z === candidate.coordinate[2]), true);
  assert.equal(draft.directManipulation.localOnly, true);
  assert.equal(draft.directManipulation.externalNetwork, false);
  assert.equal(draft.directManipulation.persistence, false);
  assert.equal(draft.directManipulation.executable, false);
  assert.equal(Object.isFrozen(draft), true);
});

test("domain direct manipulation rejects occupied and out-of-bounds destinations without changing the base", () => {
  const base = createBlockWorldContribution();
  const occupied = findAdjacent(base, ({ occupied }) => occupied);
  assert.ok(occupied, "fixture should expose an occupied cardinal destination");
  const before = JSON.stringify(base);
  assert.throws(
    () => createBlockWorldDirectManipulationDraft(base, occupied.block.id, occupied.delta),
    /occupied/,
  );
  assert.equal(JSON.stringify(base), before);
  const edge = base.blocks.find((block) => block.x === 0);
  assert.ok(edge);
  assert.throws(
    () => createBlockWorldDirectManipulationDraft(base, edge.id, { dx: -1, dy: 0, dz: 0 }),
    /bounds/,
  );
  assert.equal(JSON.stringify(base), before);
});

test("renderer direct pointer/touch seam completes one local drag and leaves button fallback available", () => {
  const base = createBlockWorldContribution();
  const candidate = findAdjacent(base, ({ occupied }) => !occupied);
  assert.ok(candidate);
  const documentRoot = makeDocument();
  const events = [];
  const layer = createBlockWorldLayer({
    documentRoot,
    projection: base,
    onDirectManipulation: (snapshot) => events.push(snapshot),
  });
  const start = { clientX: 100, clientY: 100 };
  const end = eventForDelta(candidate.delta, start.clientX, start.clientY);
  const begun = layer.beginDirectManipulation(candidate.block.id, {
    pointerId: 7,
    pointerType: "touch",
    ...start,
  });
  assert.equal(begun.action, "direct-drag-start");
  assert.equal(layer.isDirectManipulating(), true);
  layer.updateDirectManipulation({ pointerId: 7, pointerType: "touch", ...end });
  const completed = layer.completeDirectManipulation({ pointerId: 7, pointerType: "touch", ...end });
  assert.equal(completed.action, "direct-drag");
  assert.equal(completed.pointerType, "touch");
  assert.equal(completed.transition, "grab>hold>place");
  assert.deepEqual(completed.stages.map((stage) => stage.action), ["grab", "hold", "place"]);
  assert.equal(events.length, 1);
  assert.equal(layer.isDirectManipulating(), false);
  assert.equal(layer.getSnapshot().draft.editCount, 1);
  assert.equal(layer.getSnapshot().draft.blocks.length, base.blocks.length);
  assert.equal(JSON.stringify(layer.getSnapshot().canonicalProjection.blocks), JSON.stringify(base.blocks));
  assert.equal(documentRoot.getElementById("block-world-grab").listeners.has("click"), true);
  assert.match(documentRoot.getElementById("block-world-status").textContent, /DRAFT ACTIVE|READY/);
});

test("renderer direct pointer/touch seam reports a blocked drag and keeps both drafts unchanged", () => {
  const base = createBlockWorldContribution();
  const candidate = findAdjacent(base, ({ occupied }) => occupied);
  assert.ok(candidate);
  const documentRoot = makeDocument();
  const layer = createBlockWorldLayer({ documentRoot, projection: base });
  const beforeDraft = JSON.stringify(layer.getSnapshot().draft.blocks);
  const start = { clientX: 100, clientY: 100 };
  const end = eventForDelta(candidate.delta, start.clientX, start.clientY);
  layer.beginDirectManipulation(candidate.block.id, { pointerId: 9, pointerType: "mouse", ...start });
  const result = layer.completeDirectManipulation({ pointerId: 9, pointerType: "mouse", ...end });
  assert.equal(result.action, "direct-drag-rejected");
  assert.equal(JSON.stringify(layer.getSnapshot().draft.blocks), beforeDraft);
  assert.equal(JSON.stringify(layer.getSnapshot().canonicalProjection.blocks), JSON.stringify(base.blocks));
  assert.match(documentRoot.getElementById("block-world-status").textContent, /DIRECT DRAG BLOCKED/);
});

test("renderer field double activation opens and closes a container without a native dblclick path", () => {
  const base = createBlockWorldContribution();
  const container = base.blocks.find((block) => block.container && block.contentCount > 0);
  assert.ok(container, "fixture should include a container with nested contents");
  const documentRoot = makeDocument();
  const events = [];
  const layer = createBlockWorldLayer({
    documentRoot,
    projection: base,
    onOpen: (snapshot, action) => events.push({ snapshot, action }),
  });

  layer.selectBlock(container.id, "test");
  const first = layer.registerFieldTap(container.id, {
    pointerType: "mouse",
    clientX: 200,
    clientY: 120,
    timeStamp: 100,
  });
  assert.equal(first, null, "the first tap only selects");
  assert.equal(layer.getSnapshot().draft.blocks.find((block) => block.id === container.id).open, false);
  assert.ok(layer.getSnapshot().fieldTapCandidate);

  const opened = layer.registerFieldTap(container.id, {
    pointerType: "mouse",
    clientX: 200 + BLOCK_WORLD_DOUBLE_ACTIVATION_DISTANCE_PX - 1,
    clientY: 120,
    timeStamp: 100 + BLOCK_WORLD_DOUBLE_ACTIVATION_WINDOW_MS - 1,
  });
  assert.equal(opened.action, "open");
  assert.equal(opened.fieldActivation, true);
  assert.equal(opened.gesture, "double-click");
  assert.equal(events.length, 1);
  assert.equal(events[0].action, "open");
  const openedBlock = layer.getSnapshot().draft.blocks.find((block) => block.id === container.id);
  assert.equal(openedBlock.open, true);
  assert.equal(openedBlock.contentCount, container.contentCount);
  assert.equal(layer.getSnapshot().fieldTapCandidate, null);

  const third = layer.registerFieldTap(container.id, {
    pointerType: "touch",
    clientX: 200,
    clientY: 120,
    timeStamp: 1000,
  });
  assert.equal(third, null, "a different pointer type starts a new candidate");
  const closed = layer.registerFieldTap(container.id, {
    pointerType: "touch",
    clientX: 202,
    clientY: 121,
    timeStamp: 1100,
  });
  assert.equal(closed.action, "close");
  assert.equal(closed.fieldActivation, true);
  assert.equal(closed.gesture, "double-tap");
  assert.equal(events.length, 2);
  assert.equal(events[1].action, "close");
  assert.equal(layer.getSnapshot().draft.blocks.find((block) => block.id === container.id).open, false);
  assert.deepEqual(layer.getSnapshot().canonicalProjection.blocks, base.blocks);
  assert.equal(layer.getSnapshot().canonicalProjection.worldId, base.worldId);
});

test("renderer field activation ignores stale, distant, cross-block, and solid-cube double taps", () => {
  const base = createBlockWorldContribution();
  const container = base.blocks.find((block) => block.container && block.contentCount > 0);
  const solid = base.blocks.find((block) => !block.canOpen);
  assert.ok(container && solid);
  const documentRoot = makeDocument();
  const layer = createBlockWorldLayer({ documentRoot, projection: base });

  layer.registerFieldTap(container.id, { pointerType: "mouse", clientX: 10, clientY: 10, timeStamp: 0 });
  assert.equal(layer.registerFieldTap(container.id, {
    pointerType: "mouse",
    clientX: 10 + BLOCK_WORLD_DOUBLE_ACTIVATION_DISTANCE_PX + 1,
    clientY: 10,
    timeStamp: 1,
  }), null);
  assert.equal(layer.getSnapshot().draft.blocks.find((block) => block.id === container.id).open, false);

  layer.clearFieldTap();
  layer.registerFieldTap(container.id, { pointerType: "mouse", clientX: 20, clientY: 20, timeStamp: 10 });
  layer.registerFieldTap(solid.id, { pointerType: "mouse", clientX: 20, clientY: 20, timeStamp: 11 });
  assert.equal(layer.getSnapshot().draft.blocks.find((block) => block.id === container.id).open, false);
  assert.equal(layer.getSnapshot().draft.blocks.find((block) => block.id === solid.id).open, false);

  layer.registerFieldTap(container.id, { pointerType: "mouse", clientX: 30, clientY: 30, timeStamp: 100 });
  assert.equal(layer.registerFieldTap(container.id, {
    pointerType: "mouse",
    clientX: 30,
    clientY: 30,
    timeStamp: 100 + BLOCK_WORLD_DOUBLE_ACTIVATION_WINDOW_MS + 1,
  }), null);
  assert.equal(layer.getSnapshot().draft.blocks.find((block) => block.id === container.id).open, false);
});
