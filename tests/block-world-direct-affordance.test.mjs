import assert from "node:assert/strict";
import { test } from "node:test";
import { createBlockWorldContribution } from "../src/domains/block-world.js";
import {
  BLOCK_WORLD_DIRECT_DRAG_THRESHOLD_PX,
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
    ["block-world-console", true], ["block-world-close"], ["block-world-replay"],
    ["block-world-add"], ["block-world-remove"], ["block-world-replace"],
    ["block-world-open"], ["block-world-inspect"], ["block-world-move-left"],
    ["block-world-move-right"], ["block-world-move-forward"], ["block-world-move-back"],
    ["block-world-move-up"], ["block-world-move-down"], ["block-world-grab"],
    ["block-world-hold-left"], ["block-world-hold-right"], ["block-world-hold-forward"],
    ["block-world-hold-back"], ["block-world-hold-up"], ["block-world-hold-down"],
    ["block-world-place"], ["block-world-status"], ["block-world-count"],
    ["block-world-draft-count"], ["block-world-container-count"], ["block-world-content-count"],
    ["block-world-selection"], ["block-world-list"], ["block-world-palette"],
    ["block-world-trace"], ["block-world-boundary"], ["block-world-inspection"],
    ["block-world-container-hint"], ["block-world-contents"], ["block-world-routes"],
    ["block-world-navigation-status"], ["block-world-navigation-trace"],
    ["block-world-migration-open"], ["block-world-migration-status"],
  ].forEach(([id, hidden]) => documentRoot.register(id, hidden));
  return documentRoot;
}

function fakeThree() {
  class Vector {
    constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  }
  class Group {
    constructor() {
      this.children = [];
      this.position = new Vector();
      this.rotation = { y: 0 };
      this.scale = { value: 1, setScalar: (value) => { this.scale.value = value; } };
      this.visible = true;
      this.name = "";
      this.userData = {};
    }
    add(child) { this.children.push(child); child.parent = this; }
    remove(child) { this.children = this.children.filter((entry) => entry !== child); }
  }
  class Geometry { dispose() {} }
  class Material { dispose() {} }
  class Mesh extends Group {
    constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; }
  }
  class LineSegments extends Mesh {}
  return {
    Group,
    BoxGeometry: Geometry,
    EdgesGeometry: Geometry,
    LineSegments,
    LineBasicMaterial: Material,
    Mesh,
    MeshStandardMaterial: Material,
  };
}

function findAdjacent(base, predicate) {
  const deltas = [
    { dx: 1, dy: 0, dz: 0 }, { dx: -1, dy: 0, dz: 0 },
    { dx: 0, dy: 0, dz: 1 }, { dx: 0, dy: 0, dz: -1 },
  ];
  for (const block of base.blocks) {
    for (const delta of deltas) {
      const coordinate = [block.x + delta.dx, block.y + delta.dy, block.z + delta.dz];
      if (coordinate[0] < 0 || coordinate[0] >= base.dimensions.width
        || coordinate[1] < 0 || coordinate[1] >= base.dimensions.height
        || coordinate[2] < 0 || coordinate[2] >= base.dimensions.depth) continue;
      const occupied = base.blocks.some((other) => other.x === coordinate[0]
        && other.y === coordinate[1] && other.z === coordinate[2]);
      if (predicate({ block, delta, coordinate, occupied })) return { block, delta, coordinate };
    }
  }
  return null;
}

test("selected cube readout teaches drag and double activation", () => {
  const base = createBlockWorldContribution();
  const container = base.blocks.find((block) => block.container && block.contentCount > 0);
  assert.ok(container);
  const documentRoot = makeDocument();
  const layer = createBlockWorldLayer({ documentRoot, projection: base });

  layer.selectBlock(container.id, "test");
  const selection = documentRoot.getElementById("block-world-selection").textContent;
  assert.match(selection, /DRAG TO MOVE/);
  assert.match(selection, /DOUBLE-ACTIVATE TO OPEN/);
  assert.match(documentRoot.getElementById("block-world-container-hint").textContent, /OPEN CUBE OR DOUBLE-ACTIVATE/);
});

test("direct drag exposes a transient cube preview and clears it after placement", () => {
  const base = createBlockWorldContribution();
  const candidate = findAdjacent(base, ({ occupied }) => !occupied);
  assert.ok(candidate);
  const documentRoot = makeDocument();
  const three = fakeThree();
  const parent = new three.Group();
  const raycastTargets = [];
  const layer = createBlockWorldLayer({ documentRoot, parent, three, raycastTargets, projection: base });
  const start = { clientX: 100, clientY: 100 };
  const end = candidate.delta.dx
    ? { clientX: start.clientX + candidate.delta.dx * (BLOCK_WORLD_DIRECT_DRAG_THRESHOLD_PX + 12), clientY: start.clientY }
    : { clientX: start.clientX, clientY: start.clientY + candidate.delta.dz * (BLOCK_WORLD_DIRECT_DRAG_THRESHOLD_PX + 12) };

  const begun = layer.beginDirectManipulation(candidate.block.id, {
    pointerId: 3,
    pointerType: "mouse",
    ...start,
  });
  assert.equal(begun.action, "direct-drag-start");
  let preview = layer.layer.children.find((child) => child.userData?.blockWorldDragPreview === true);
  assert.ok(preview);
  assert.equal(preview.userData.blockWorldPreviewState, "DRAG READY · MOVE TO PREVIEW · RELEASE TO PLACE");
  assert.equal(raycastTargets.includes(preview), false);

  layer.updateDirectManipulation({ pointerId: 3, pointerType: "mouse", ...end });
  preview = layer.layer.children.find((child) => child.userData?.blockWorldDragPreview === true);
  assert.ok(preview);
  assert.deepEqual(preview.userData.blockWorldPreviewDelta, [candidate.delta.dx, candidate.delta.dy, candidate.delta.dz]);
  assert.equal(preview.userData.blockWorldPreviewState, "DRAG PREVIEW ACTIVE · RELEASE TO PLACE");
  assert.match(documentRoot.getElementById("block-world-status").textContent, /PREVIEW ACTIVE/);
  assert.match(documentRoot.getElementById("block-world-selection").textContent, /DRAG PREVIEW ACTIVE/);

  const completed = layer.completeDirectManipulation({ pointerId: 3, pointerType: "mouse", ...end });
  assert.equal(completed.action, "direct-drag");
  assert.equal(layer.layer.children.some((child) => child.userData?.blockWorldDragPreview === true), false);
  assert.equal(layer.getSnapshot().draft.blocks.some((block) => block.x === candidate.coordinate[0]
    && block.y === candidate.coordinate[1] && block.z === candidate.coordinate[2]), true);
  assert.equal(layer.getSnapshot().canonicalProjection.blocks.some((block) => block.id === candidate.block.id
    && block.x === candidate.block.x && block.y === candidate.block.y && block.z === candidate.block.z), true);
});

test("direct drag affordance remains cube-only and local-only", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../src/render/block-world.js", import.meta.url), "utf8");
  assert.match(source, /block-world-direct-drag-preview/);
  assert.match(source, /DRAG TO MOVE/);
  assert.match(source, /DOUBLE-ACTIVATE TO OPEN/);
  assert.doesNotMatch(source, /(?:SphereGeometry|CircleGeometry|TorusGeometry)/);
  assert.match(source, /localOnly: true/);
  assert.match(source, /externalNetwork: false/);
  assert.match(source, /executable: false/);
});
