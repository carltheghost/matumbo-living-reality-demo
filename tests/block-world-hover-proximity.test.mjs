import assert from "node:assert/strict";
import { test } from "node:test";
import { createBlockWorldContribution } from "../src/domains/block-world.js";
import {
  BLOCK_WORLD_PROXIMITY_RADIUS,
  createBlockWorldLayer,
  getBlockWorldProximityScatter,
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
    ["block-world-place"], ["block-world-migration-open"], ["block-world-migration-status"],
    ["block-world-routes"], ["block-world-navigation-status"], ["block-world-navigation-trace"],
    ["block-world-status"], ["block-world-count"], ["block-world-draft-count"],
    ["block-world-container-count"], ["block-world-content-count"], ["block-world-selection"],
    ["block-world-list"], ["block-world-palette"], ["block-world-trace"],
    ["block-world-boundary"], ["block-world-proximity-status"], ["block-world-inspection"],
    ["block-world-container-hint"], ["block-world-contents"],
  ].forEach(([id, hidden]) => documentRoot.register(id, hidden));
  return documentRoot;
}

function fakeThree() {
  class Vector {
    constructor() { this.x = 0; this.y = 0; this.z = 0; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  }
  class Group {
    constructor() { this.children = []; this.position = new Vector(); this.visible = true; }
    add(child) { this.children.push(child); child.parent = this; }
    remove(child) { this.children = this.children.filter((entry) => entry !== child); }
  }
  class BoxGeometry { dispose() {} }
  class EdgesGeometry { constructor(source) { this.source = source; } dispose() {} }
  class Material { dispose() {} }
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
      this.position = new Vector();
      this.rotation = { x: 0, y: 0 };
      this.scale = { value: 1, setScalar: (value) => { this.scale.value = value; } };
      this.userData = {};
      this.visible = true;
    }
    add(child) { (this.children ??= []).push(child); child.parent = this; }
  }
  class LineSegments extends Mesh {}
  return {
    Group,
    BoxGeometry,
    EdgesGeometry,
    Mesh,
    LineSegments,
    MeshStandardMaterial: Material,
    LineBasicMaterial: Material,
  };
}

test("hover is a separate eased preview and does not open or select a container", () => {
  const base = createBlockWorldContribution();
  const container = base.blocks.find((block) => block.container && block.contentCount > 0);
  assert.ok(container);
  const three = fakeThree();
  const parent = new three.Group();
  const layerDocument = makeDocument();
  const layer = createBlockWorldLayer({ documentRoot: layerDocument, projection: base, three, parent });
  const selectedBefore = layer.getSnapshot().selectedId;
  const canonicalBefore = JSON.stringify(layer.getSnapshot().canonicalProjection);

  const hovered = layer.setHoveredBlock(container.id);
  assert.equal(hovered.hoveredId, container.id);
  assert.equal(hovered.selectedId, selectedBefore);
  assert.equal(hovered.hoverPreview.presentationOnly, true);
  assert.equal(hovered.hoverPreview.canonicalOpen, false);
  assert.equal(hovered.hoverPreview.contentCount, container.contentCount);
  assert.equal(hovered.draft.blocks.find((block) => block.id === container.id).open, false);
  assert.equal(JSON.stringify(hovered.canonicalProjection), canonicalBefore);
  const inspection = layerDocument.getElementById("block-world-inspection");
  assert.match(inspection.textContent, /HOVER PREVIEW/i);
  const contentRows = layerDocument.getElementById("block-world-contents").children;
  assert.equal(contentRows.length, container.contentCount);
  assert.ok([...contentRows].every((row) => /HOVER PREVIEW/.test(row.textContent)));

  layer.update(0.15, 1, { hoveredId: container.id });
  const body = parent.children[0].children.find((mesh) => mesh.userData?.blockWorldId === container.id && mesh.userData?.blockWorldContainer);
  assert.ok(body);
  assert.ok(body.position.y > body.userData.blockWorldBasePosition.y, "hover should lift the body");
  assert.ok(body.scale.value > 1, "hover should ease scale above the click-only baseline");
  assert.ok(body.rotation.y > 0, "hover should add a subtle rotation");

  layer.selectBlock(container.id, "canvas");
  assert.equal(layer.getSnapshot().selectedId, container.id);
  assert.equal(layer.getSnapshot().hoveredId, container.id);
  assert.equal(layer.getSnapshot().draft.blocks.find((block) => block.id === container.id).open, false);
  const opened = layer.toggleBlock();
  assert.equal(opened.action, "open");
  assert.equal(layer.getSnapshot().canonicalProjection.blocks.find((block) => block.id === container.id).open, false);
});

test("city proximity scatter is deterministic, reversible, and presentation-only", () => {
  const base = createBlockWorldContribution();
  const three = fakeThree();
  const parent = new three.Group();
  const layerDocument = makeDocument();
  const layer = createBlockWorldLayer({ documentRoot: layerDocument, projection: base, three, parent });
  const canonicalBefore = JSON.stringify(layer.getSnapshot().canonicalProjection);
  const firstScatter = getBlockWorldProximityScatter("block:test", 1);
  const secondScatter = getBlockWorldProximityScatter("block:test", 1);
  assert.deepEqual(firstScatter, secondScatter);
  assert.equal(Object.isFrozen(firstScatter), true);

  const farCamera = { x: 100, y: 100, z: 100 };
  const far = layer.update(0, 0, { cameraPosition: farCamera, proximityRadius: BLOCK_WORLD_PROXIMITY_RADIUS });
  assert.equal(far.proximity.enabled, false, "the lens stays dormant outside the cube field");
  const approached = layer.update(0, 0, {
    cameraPosition: { x: -3.8, y: 2, z: 0 },
    proximityRadius: 4,
    proximityActive: true,
  });
  assert.equal(approached.proximity.enabled, true);
  assert.equal(approached.proximity.mode, "city-skyscraper");
  assert.ok(approached.proximity.farCount > 0);
  assert.ok(approached.proximity.scatteredCount > 0);
  assert.ok(approached.proximity.culledCount > 0);
  assert.equal(approached.proximity.presentationOnly, true);
  assert.equal(approached.proximity.canonicalUnchanged, true);
  const scatteredMesh = parent.children[0].children.find((mesh) => mesh.userData?.blockWorldId === base.blocks[0].id);
  assert.ok(scatteredMesh);
  assert.notDeepEqual(scatteredMesh.userData.blockWorldProximityScatter, { x: 0, y: 0, z: 0 });
  const visibleBlockMeshes = parent.children[0].children.filter((mesh) => mesh.userData?.blockWorldId && !mesh.userData?.blockWorldContainerCue);
  assert.ok(visibleBlockMeshes.some((mesh) => mesh.visible === false), "a distant low-salience cube should recede");
  const selectedMesh = visibleBlockMeshes.find((mesh) => mesh.userData.blockWorldId === approached.selectedId);
  assert.ok(selectedMesh?.visible !== false, "the selected cube remains visible");

  const near = layer.update(0, 0, { cameraPosition: { x: 0, y: 0, z: 0 }, proximityRadius: 80 });
  assert.equal(near.proximity.nearCount, base.blocks.length);
  assert.equal(near.proximity.scatteredCount, 0);
  assert.equal(near.proximityScatterCount, 0);
  assert.equal(near.proximityCulledCount, 0);
  assert.ok(visibleBlockMeshes.every((mesh) => mesh.visible !== false), "disabling proximity restores every cube");
  assert.equal(JSON.stringify(near.canonicalProjection), canonicalBefore);
  assert.equal(near.localOnly, true);
  assert.equal(near.simulation, true);
  assert.match(near.presentationBoundary, /presentation only/i);
});
