import assert from "node:assert/strict";
import { test } from "node:test";
import { createBlockWorldContribution } from "../src/domains/block-world.js";
import {
  BLOCK_WORLD_CONTAINER_PEEK_LIFT,
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
      this.visible = true;
      this.name = "";
    }
    add(child) { this.children.push(child); child.parent = this; }
    remove(child) { this.children = this.children.filter((entry) => entry !== child); }
  }
  class Geometry { dispose() {} }
  class Material {
    constructor(params = {}) { Object.assign(this, params); this.userData = {}; }
    dispose() {}
  }
  class Mesh extends Group {
    constructor(geometry, material) {
      super();
      this.geometry = geometry;
      this.material = material;
      this.rotation = { x: 0, y: 0, z: 0 };
      this.scale = { value: 1, x: 1, y: 1, z: 1, setScalar: (value) => { this.scale.value = value; this.scale.x = value; this.scale.y = value; this.scale.z = value; } };
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

function bodyMeshes(worldLayer) {
  return worldLayer.children.filter((mesh) => mesh.userData?.blockWorldId
    && !mesh.userData?.blockWorldContent
    && !mesh.userData?.blockWorldLid
    && mesh.userData?.blockWorldContainerCue !== true
    && mesh.userData?.blockWorldContainerSignal !== true);
}

function makeLayer() {
  const base = createBlockWorldContribution();
  const container = firstOpenableContainer(base);
  assert.ok(container);
  const documentRoot = makeDocument();
  const three = fakeThree();
  const parent = new three.Group();
  const layer = createBlockWorldLayer({ documentRoot, parent, three, projection: base });
  return { layer, container, worldLayer: layer.layer };
}

test("block materials are translucent glass with type-tinted glow", () => {
  const { worldLayer } = makeLayer();
  const bodies = bodyMeshes(worldLayer);
  assert.ok(bodies.length > 0);
  bodies.forEach((mesh) => {
    assert.equal(mesh.material.transparent, true, "glass shell must be transparent");
    assert.ok(mesh.material.opacity < 1, "glass shell must let the interior show through");
    assert.equal(mesh.material.depthWrite, false, "glass must not occlude nested contents");
  });
  const containers = bodies.filter((mesh) => mesh.userData?.blockWorldContainer === true);
  assert.ok(containers.length > 0);
  containers.forEach((mesh) => {
    assert.ok(mesh.material.emissiveIntensity >= 0.8, "containers keep a strong accent glow");
  });
});

test("every cube carries an always-visible glass edge frame that is never a raycast target", () => {
  const { worldLayer } = makeLayer();
  const bodies = bodyMeshes(worldLayer);
  assert.ok(bodies.length > 0);
  bodies.forEach((mesh) => {
    const frames = mesh.children.filter((child) => child.name === "block-world-glass-frame");
    assert.equal(frames.length, 1, "each cube gets exactly one glass frame");
    assert.equal(frames[0].userData.blockWorldGlassFrame, true);
    assert.equal(frames[0].userData.blockWorldId, mesh.userData.blockWorldId);
  });
  // Frames live as children of their cube; they are never top-level siblings
  // of the raycastable bodies.
  const strayFrames = worldLayer.children.filter((mesh) => mesh.name === "block-world-glass-frame");
  assert.equal(strayFrames.length, 0);
});

test("opening shrinks the glass shell while the lid swings open like a hatch", () => {
  const { layer, container, worldLayer } = makeLayer();
  layer.selectBlock(container.id, "test");
  layer.toggleBlock();
  layer.update(1 / 60, 0, { reducedMotion: true });
  const shell = worldLayer.children.find((mesh) => mesh.userData?.blockWorldId === container.id
    && !mesh.userData?.blockWorldContent
    && !mesh.userData?.blockWorldLid);
  const lid = worldLayer.children.find((mesh) => mesh.userData?.blockWorldId === container.id
    && mesh.userData?.blockWorldLid === true);
  assert.ok(shell);
  assert.ok(lid);
  assert.ok(shell.scale.value < 1, `glass shell shrinks on open (got ${shell.scale.value})`);
  assert.ok(Math.abs(shell.scale.value - 0.72) < 0.02, `shell shrinks toward 72% (got ${shell.scale.value})`);
  assert.ok(Math.abs(lid.rotation.x - -1.25) < 0.02, `lid swings to the hatch angle (got ${lid.rotation.x})`);
  assert.ok(lid.position.y > shell.position.y + 0.2, "lid lifts above the shell");
});

test("nested contents rise out of the glass from inside", () => {
  const { layer, container, worldLayer } = makeLayer();
  layer.selectBlock(container.id, "test");
  layer.toggleBlock();
  // Before any presentation frame runs, newly opened contents sit at the
  // shell's heart, near invisible — the rise-from-inside intro pose.
  const fresh = worldLayer.children.filter((mesh) => mesh.userData?.blockWorldContent);
  assert.ok(fresh.length > 0);
  fresh.forEach((mesh) => {
    assert.equal(mesh.scale.value, 0.01, "contents start near invisible inside the shell");
  });
  const shellY = worldLayer.children.find((mesh) => mesh.userData?.blockWorldId === container.id
    && !mesh.userData?.blockWorldContent
    && !mesh.userData?.blockWorldLid).position.y;
  fresh.forEach((mesh) => {
    assert.ok(mesh.position.y < shellY + 0.2, "contents start inside the glass, below the peek perch");
  });
  // After presentation advances they reach their peek perches above the rim.
  layer.update(1 / 60, 0, { reducedMotion: true });
  const settled = worldLayer.children.filter((mesh) => mesh.userData?.blockWorldContent);
  assert.ok(settled.every((mesh) => mesh.position.y > shellY + BLOCK_WORLD_CONTAINER_PEEK_LIFT - 0.01));
  assert.ok(settled.every((mesh) => mesh.scale.value > 0.9));
});

test("presentation never mutates the canonical projection", () => {
  const { layer, container } = makeLayer();
  layer.selectBlock(container.id, "test");
  layer.toggleBlock();
  layer.update(1 / 60, 0, { reducedMotion: true });
  const snapshot = layer.getSnapshot();
  const canonical = snapshot.canonicalProjection.blocks.find((block) => block.id === container.id);
  assert.equal(canonical.open, false, "open/close stays canonical; the glass animation is presentation only");
  assert.equal(snapshot.localOnly, true);
});
