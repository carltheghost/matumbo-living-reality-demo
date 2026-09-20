import assert from "node:assert/strict";
import { test } from "node:test";
import { createBlockWorldContribution } from "../src/domains/block-world.js";
import {
  BLOCK_WORLD_CONTENT_NAVIGATION_BOUNDARY,
  BLOCK_WORLD_CONTENT_NAVIGATION_SOURCE,
  createBlockWorldLayer,
  cycleBlockWorldContent,
  resolveBlockWorldContent,
} from "../src/render/block-world.js";

function makeElement(documentRoot, tag = "div") {
  return {
    ownerDocument: documentRoot,
    tagName: tag.toUpperCase(),
    id: "",
    type: tag === "button" ? "button" : undefined,
    className: "",
    dataset: {},
    hidden: false,
    disabled: false,
    tabIndex: -1,
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
    register(id, hidden = false, tag = "div") {
      const element = makeElement(documentRoot, tag);
      element.id = id;
      element.hidden = hidden;
      elements.set(id, element);
      return element;
    },
  };
  [
    ["block-world-console", true], ["block-world-close", false, "button"], ["block-world-replay", false, "button"],
    ["block-world-add", false, "button"], ["block-world-remove", false, "button"], ["block-world-replace", false, "button"],
    ["block-world-open", false, "button"], ["block-world-inspect", false, "button"], ["block-world-status"],
    ["block-world-count"], ["block-world-draft-count"], ["block-world-container-count"], ["block-world-content-count"],
    ["block-world-selection"], ["block-world-list"], ["block-world-palette"], ["block-world-trace"], ["block-world-boundary"],
    ["block-world-inspection"], ["block-world-container-hint", true], ["block-world-content-focus"],
    ["block-world-content-navigation-status"], ["block-world-content-previous", false, "button"], ["block-world-content-next", false, "button"],
    ["block-world-contents"], ["block-world-routes"], ["block-world-navigation-status"], ["block-world-navigation-trace"],
    ["block-world-migration-open", false, "button"], ["block-world-migration-status"],
  ].forEach(([id, hidden, tag]) => documentRoot.register(id, hidden, tag));
  return documentRoot;
}

function fakeThree() {
  class Vector {
    constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  }
  class Group {
    constructor() { this.children = []; this.position = new Vector(); this.visible = true; this.name = ""; }
    add(child) { this.children.push(child); child.parent = this; }
    remove(child) { this.children = this.children.filter((entry) => entry !== child); }
  }
  class Geometry { dispose() {} }
  class Material { dispose() {} }
  class Mesh extends Group {
    constructor(geometry, material) {
      super();
      this.geometry = geometry;
      this.material = material;
      this.rotation = { y: 0 };
      this.scale = { value: 1, setScalar: (value) => { this.scale.value = value; } };
      this.userData = {};
    }
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

function firstOpenableContainer(base) {
  return base.blocks.find((block) => block.container && block.contentCount > 1)
    ?? base.blocks.find((block) => block.container && block.contentCount > 0);
}

test("content resolver and cycling stay inside the existing parent contents", () => {
  const base = createBlockWorldContribution();
  const parent = firstOpenableContainer(base);
  assert.ok(parent);
  const first = resolveBlockWorldContent(parent, parent.contents[0].id);
  assert.equal(first.parentBlockId, parent.id);
  assert.equal(first.contentId, parent.contents[0].id);
  assert.equal(first.index, 0);
  assert.equal(first.count, parent.contents.length);
  assert.equal(first.localOnly, true);
  assert.equal(first.boundary, BLOCK_WORLD_CONTENT_NAVIGATION_BOUNDARY);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(cycleBlockWorldContent(parent, first.contentId, "next").contentId, parent.contents[1].id);
  assert.equal(cycleBlockWorldContent(parent, parent.contents[1].id, "next").contentId, parent.contents[0].id);
  assert.equal(cycleBlockWorldContent(parent, parent.contents[0].id, "previous").contentId, parent.contents[1].id);
  assert.equal(resolveBlockWorldContent(parent, "missing-content"), null);
});

test("rows and inside buttons focus existing content without changing the selected parent", () => {
  const base = createBlockWorldContribution();
  const parent = firstOpenableContainer(base);
  const documentRoot = makeDocument();
  const layer = createBlockWorldLayer({ documentRoot, projection: base, three: null });
  layer.selectBlock(parent.id, "test");
  const rows = documentRoot.getElementById("block-world-contents").children;
  assert.equal(rows.length, parent.contents.length);
  assert.equal(rows[0].tagName, "BUTTON");
  assert.equal(rows[0].dataset.contentId, parent.contents[0].id);
  rows[0].listeners.get("click")({ detail: 1 });
  let snapshot = layer.getSnapshot();
  assert.equal(snapshot.selectedId, parent.id);
  assert.equal(snapshot.contentFocus.parentBlockId, parent.id);
  assert.equal(snapshot.contentFocus.contentId, parent.contents[0].id);
  assert.equal(snapshot.contentFocus.contentLabel, parent.contents[0].label);
  assert.equal(snapshot.contentFocus.contentType, parent.contents[0].contentType);
  assert.equal(snapshot.contentFocus.source, BLOCK_WORLD_CONTENT_NAVIGATION_SOURCE);
  assert.match(documentRoot.getElementById("block-world-content-focus").textContent, new RegExp(parent.contents[0].id));
  assert.match(documentRoot.getElementById("block-world-content-focus").textContent, new RegExp(parent.id));

  documentRoot.getElementById("block-world-content-next").listeners.get("click")({ detail: 1 });
  snapshot = layer.getSnapshot();
  assert.equal(snapshot.selectedId, parent.id);
  assert.equal(snapshot.contentFocus.contentId, parent.contents[1].id);
  documentRoot.getElementById("block-world-content-previous").listeners.get("click")({ detail: 1 });
  assert.equal(layer.getSnapshot().contentFocus.contentId, parent.contents[0].id);
  assert.equal(documentRoot.getElementById("block-world-content-next").disabled, false);
});

test("open and hover peek cubes route clicks to content focus while parent drag remains separate", () => {
  const base = createBlockWorldContribution();
  const parent = firstOpenableContainer(base);
  const documentRoot = makeDocument();
  const three = fakeThree();
  const raycastTargets = [];
  const layer = createBlockWorldLayer({ documentRoot, parent: new three.Group(), three, raycastTargets, projection: base });

  layer.setHoveredBlock(parent.id);
  const hoverMesh = layer.layer.children.find((mesh) => mesh.userData?.blockWorldHoverPreview && mesh.userData?.blockWorldContent);
  assert.ok(hoverMesh);
  assert.equal(raycastTargets.includes(hoverMesh), true);
  const hoverTarget = layer.resolveContentTarget(hoverMesh);
  assert.equal(hoverTarget.parentBlockId, parent.id);
  assert.equal(hoverTarget.contentId, parent.contents[0].id);
  assert.equal(hoverTarget.previewOnly, true);
  layer.selectContent(hoverTarget.parentBlockId, hoverTarget.contentId, "canvas");
  assert.equal(layer.getSnapshot().selectedId, parent.id);
  assert.equal(layer.getSnapshot().contentFocus.contentId, parent.contents[0].id);

  layer.openBlock(true);
  const openMesh = layer.layer.children.find((mesh) => mesh.userData?.blockWorldContent && mesh.userData?.blockWorldOpen === true);
  assert.ok(openMesh);
  const openTarget = layer.resolveContentTarget(openMesh);
  assert.equal(openTarget.opened, true);
  assert.equal(openTarget.contentId, parent.contents[0].id);
  layer.selectContent(openTarget.parentBlockId, openTarget.contentId, "canvas");
  assert.equal(layer.getSnapshot().contentFocus.contentId, parent.contents[0].id);

  layer.openBlock(false);
  assert.equal(layer.getSnapshot().contentFocus, null, "closing parent atomically clears stale content focus");
  layer.selectBlock(parent.id, "reset-test");
  layer.selectContent(parent.id, parent.contents[0].id, "test");
  layer.replay("reset");
  assert.equal(layer.getSnapshot().contentFocus, null, "replay atomically clears stale content focus");
});

test("hover preview exposes a focusable keyboard fallback row without changing canonical state", () => {
  const base = createBlockWorldContribution();
  const parent = firstOpenableContainer(base);
  const documentRoot = makeDocument();
  const layer = createBlockWorldLayer({ documentRoot, projection: base, three: null });

  const before = layer.getSnapshot();
  layer.setHoveredBlock(parent.id);
  const row = documentRoot.getElementById("block-world-contents").children[0];
  assert.equal(row.tagName, "BUTTON");
  assert.equal(row.dataset.previewOnly, "true");
  assert.equal(row.getAttribute("aria-describedby"), "block-world-content-focus");
  row.listeners.get("focus")();
  assert.match(documentRoot.getElementById("block-world-content-focus").textContent, /HOVER PREVIEW FOCUS/);
  assert.match(documentRoot.getElementById("block-world-content-focus").textContent, new RegExp(parent.contents[0].id));
  assert.equal(layer.getSnapshot().selectedId, before.selectedId);
  assert.equal(layer.getSnapshot().contentFocus, null);
});
