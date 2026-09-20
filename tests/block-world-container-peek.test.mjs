import assert from "node:assert/strict";
import { test } from "node:test";
import { createBlockWorldContribution } from "../src/domains/block-world.js";
import {
  BLOCK_WORLD_CONTAINER_BLOOM_ANGLE,
  BLOCK_WORLD_CONTAINER_BLOOM_RADIUS,
  BLOCK_WORLD_CONTAINER_PEEK_FRONT,
  BLOCK_WORLD_CONTAINER_PEEK_LIFT,
  createBlockWorldLayer,
  getBlockWorldContainerPeekOffset,
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
      this.visible = true;
      this.name = "";
    }
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
  return base.blocks.find((block) => block.container && block.contentCount > 0);
}

test("container peek transform spreads nested cubes beyond the open shell", () => {
  const first = getBlockWorldContainerPeekOffset({ offset: [0, 1, 0] }, 0, 2);
  const second = getBlockWorldContainerPeekOffset({ offset: [1, 1, 0] }, 1, 2);

  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(second), true);
  assert.ok(first.y >= BLOCK_WORLD_CONTAINER_PEEK_LIFT);
  assert.ok(first.z >= BLOCK_WORLD_CONTAINER_PEEK_FRONT);
  assert.ok(second.z >= BLOCK_WORLD_CONTAINER_PEEK_FRONT);
  assert.notEqual(first.x, second.x, "nested cubes should occupy distinct peek-rail lanes");
  assert.equal(first.bloom.presentationOnly, true);
  assert.equal(second.bloom.presentationOnly, true);
  assert.ok(first.bloom.radius >= BLOCK_WORLD_CONTAINER_BLOOM_RADIUS);
  assert.equal(Math.abs(second.bloom.angle), BLOCK_WORLD_CONTAINER_BLOOM_ANGLE / 2);
  assert.notEqual(first.bloom.angle, second.bloom.angle, "nested cubes should fan at distinct petal angles");
});

test("opening a selected container renders cube-only peek meshes and exposes Hold → Place state", () => {
  const base = createBlockWorldContribution();
  const container = firstOpenableContainer(base);
  assert.ok(container);
  const documentRoot = makeDocument();
  const parent = new (fakeThree().Group)();
  const three = fakeThree();
  const layer = createBlockWorldLayer({ documentRoot, parent, three, projection: base });

  const worldLayer = layer.layer;
  assert.equal(worldLayer.children.some((mesh) => mesh.userData?.blockWorldContent), false);

  layer.selectBlock(container.id, "test");
  const opened = layer.toggleBlock();
  assert.equal(opened.action, "open");
  // Reality Lens open animation: nested cubes rise out of the glass from
  // inside, so advance presentation with reduced motion to snap them to their
  // peek perches before asserting final positions.
  layer.update(1 / 60, 0, { reducedMotion: true });
  const shell = worldLayer.children.find((mesh) => mesh.userData?.blockWorldId === container.id
    && !mesh.userData?.blockWorldContent
    && !mesh.userData?.blockWorldLid);
  const peekMeshes = worldLayer.children.filter((mesh) => mesh.userData?.blockWorldContent);
  assert.ok(shell);
  assert.equal(peekMeshes.length, container.contentCount);
  assert.ok(peekMeshes.every((mesh) => mesh.userData.blockWorldPeek === true));
  assert.ok(peekMeshes.every((mesh) => mesh.userData.blockWorldBloom?.presentationOnly === true));
  assert.ok(peekMeshes.every((mesh) => Number.isFinite(mesh.userData.blockWorldBloom?.angle)));
  assert.ok(peekMeshes.every((mesh) => mesh.position.y > shell.position.y + BLOCK_WORLD_CONTAINER_PEEK_LIFT - 0.01));
  assert.ok(peekMeshes.every((mesh) => mesh.position.z > shell.position.z + BLOCK_WORLD_CONTAINER_PEEK_FRONT - 0.01));

  const status = documentRoot.getElementById("block-world-status").textContent;
  const hint = documentRoot.getElementById("block-world-container-hint").textContent;
  assert.match(status, /PEEK ACTIVE/);
  assert.match(status, /HOLD → PLACE/);
  assert.match(hint, /PEEK ACTIVE · HOLD → PLACE/);
  assert.equal(layer.getSnapshot().canonicalProjection.blocks.find((block) => block.id === container.id).open, false);
});

test("container carry state replaces peek cue with Hold → Place and returns after local placement", () => {
  const base = createBlockWorldContribution();
  const container = firstOpenableContainer(base);
  const documentRoot = makeDocument();
  const three = fakeThree();
  const parent = new three.Group();
  const layer = createBlockWorldLayer({ documentRoot, parent, three, projection: base });

  layer.selectBlock(container.id, "test");
  layer.toggleBlock();
  const grabbed = layer.grabSelected();
  assert.equal(grabbed.action, "grab");
  assert.equal(layer.getSnapshot().holding, true);
  assert.match(documentRoot.getElementById("block-world-status").textContent, /CARRY MODE/);
  assert.match(documentRoot.getElementById("block-world-status").textContent, /PLACE IT/);
  assert.match(documentRoot.getElementById("block-world-container-hint").textContent, /CARRY ACTIVE/);
  assert.match(documentRoot.getElementById("block-world-container-hint").textContent, /HOLD → PLACE/);

  const held = layer.holdSelected({ dx: 0, dy: 0, dz: 0 });
  assert.equal(held.action, "hold");
  const placed = layer.placeHeld();
  assert.equal(placed.action, "place");
  assert.equal(layer.getSnapshot().holding, false);
  assert.match(documentRoot.getElementById("block-world-status").textContent, /PEEK ACTIVE/);
  assert.match(documentRoot.getElementById("block-world-container-hint").textContent, /PEEK ACTIVE/);
});

test("container peek renderer remains cube-only and local-only", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("../src/render/block-world.js", import.meta.url), "utf8");
  assert.match(source, /getBlockWorldContainerPeekOffset/);
  assert.match(source, /blockWorldPeek/);
  assert.match(source, /blockWorldPeekAction = "OPEN → PEEK → HOLD → PLACE"/);
  assert.doesNotMatch(source, /(?:SphereGeometry|CircleGeometry|TorusGeometry)/);
  assert.match(source, /localOnly: true/);
  assert.match(source, /externalNetwork: false/);
  assert.match(source, /executable: false/);
});
