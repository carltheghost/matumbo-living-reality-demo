import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { BLOCK_WORLD_PORTAL_ROUTE_REGISTRY, createBlockWorldContribution } from "../src/domains/block-world.js";
import { createBlockWorldLayer } from "../src/render/block-world.js";

function makeElement(documentRoot, tag = "div") {
  return {
    ownerDocument: documentRoot,
    tagName: tag.toUpperCase(),
    id: "",
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
    focus() { this.focused = true; },
  };
}

const REQUIRED_IDS = [
  ["block-world-console", true],
  ["block-world-close"],
  ["block-world-replay"],
  ["block-world-add"],
  ["block-world-remove"],
  ["block-world-replace"],
  ["block-world-status"],
  ["block-world-list"],
  ["block-world-palette"],
  ["block-world-trace"],
];

const OPTIONAL_IDS = [
  "block-world-open",
  "block-world-inspect",
  "block-world-move-left",
  "block-world-move-right",
  "block-world-move-forward",
  "block-world-move-back",
  "block-world-move-up",
  "block-world-move-down",
  "block-world-grab",
  "block-world-hold-left",
  "block-world-hold-right",
  "block-world-hold-forward",
  "block-world-hold-back",
  "block-world-hold-up",
  "block-world-hold-down",
  "block-world-place",
  "block-world-routes",
  "block-world-navigation-status",
  "block-world-navigation-trace",
  "block-world-count",
  "block-world-draft-count",
  "block-world-container-count",
  "block-world-content-count",
  "block-world-selection",
  "block-world-boundary",
  "block-world-inspection",
  "block-world-contents",
];

function makeDocument({ optional = true } = {}) {
  const elements = new Map();
  const documentListeners = new Map();
  const documentRoot = {
    createElement(tag) { return makeElement(documentRoot, tag); },
    getElementById(id) { return elements.get(id) ?? null; },
    addEventListener(type, callback) { documentListeners.set(type, callback); },
    register(id, hidden = false) {
      const element = makeElement(documentRoot);
      element.id = id;
      element.hidden = hidden;
      elements.set(id, element);
      return element;
    },
    dispatch(type, event) { documentListeners.get(type)?.(event); },
  };
  REQUIRED_IDS.forEach(([id, hidden]) => documentRoot.register(id, hidden));
  if (optional) OPTIONAL_IDS.forEach((id) => documentRoot.register(id));
  return documentRoot;
}

function fakeThree() {
  class Vector {
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  }
  class Group {
    constructor() {
      this.children = [];
      this.position = new Vector();
      this.visible = true;
    }
    add(child) { this.children.push(child); child.parent = this; }
    remove(child) { this.children = this.children.filter((entry) => entry !== child); }
  }
  class Geometry { dispose() {} }
  class Material { dispose() {} }
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
      this.position = new Vector();
      this.rotation = { y: 0 };
      this.scale = { value: 1, setScalar: (value) => { this.scale.value = value; } };
      this.userData = {};
    }
  }
  return {
    Group,
    BoxGeometry: Geometry,
    Mesh,
    MeshStandardMaterial: Material,
  };
}

test("portal route controls expose an accessible keyboard/button seam without duplicate hand-offs", () => {
  const base = createBlockWorldContribution();
  const portal = base.blocks.find((block) => block.blockType === "portal");
  const documentRoot = makeDocument();
  const events = [];
  const layer = createBlockWorldLayer({
    documentRoot,
    projection: base,
    three: null,
    onNavigate: (snapshot, method) => events.push({ snapshot, method }),
  });

  layer.selectBlock(portal.id, "test");
  const routes = documentRoot.getElementById("block-world-routes");
  assert.equal(routes.children.length, BLOCK_WORLD_PORTAL_ROUTE_REGISTRY.length);
  routes.children.forEach((button) => {
    assert.equal(button.tagName, "BUTTON");
    assert.equal(button.type, "button");
    assert.equal(button.tabIndex, 0);
    assert.equal(button.getAttribute("aria-keyshortcuts"), "Enter Space");
    assert.match(button.getAttribute("aria-label"), /^Open .+ from selected portal cube$/);
    assert.equal(button.getAttribute("aria-pressed"), "false");
  });

  const roomsButton = routes.children.find((button) => button.dataset.routeId === "rooms");
  assert.ok(roomsButton);
  let prevented = false;
  roomsButton.listeners.get("keydown")({
    key: "Enter",
    preventDefault: () => { prevented = true; },
    stopPropagation() {},
  });
  assert.equal(prevented, true);
  assert.equal(events.length, 1);
  assert.equal(events[0].method, "keyboard");
  assert.equal(events[0].snapshot.targetFeature, "rooms");
  assert.equal(events[0].snapshot.accessibility.input, "keyboard");
  assert.equal(events[0].snapshot.renderMode, "static-controls");
  assert.equal(events[0].snapshot.staticFallback, true);
  // A synthetic keyboard harness often emits a click after keydown; the
  // renderer consumes that duplicate while preserving direct button clicks.
  roomsButton.listeners.get("click")();
  assert.equal(events.length, 1);

  // Trusted native keyboard events are left to the browser's normal button
  // click path; the synthetic adapter must not emit a second route.
  const freshRoomsButton = documentRoot.getElementById("block-world-routes").children.find((button) => button.dataset.routeId === "rooms");
  freshRoomsButton.listeners.get("keydown")({ key: "Enter", isTrusted: true });
  assert.equal(events.length, 1);
  freshRoomsButton.listeners.get("click")();
  assert.equal(events.length, 2);
  assert.equal(events[1].method, "button");
  assert.equal(layer.getSnapshot().navigationTrace.length, 2);
  assert.equal(JSON.stringify(layer.getSnapshot().canonicalProjection.blocks), JSON.stringify(base.blocks));
});

test("Escape closes the portal console and a minimal static DOM mount remains usable", () => {
  const documentRoot = makeDocument({ optional: false });
  const layer = createBlockWorldLayer({
    documentRoot,
    projection: createBlockWorldContribution(),
    three: null,
    parent: null,
  });
  const panel = documentRoot.getElementById("block-world-console");
  assert.equal(layer.getSnapshot().renderMode, "static-controls");
  assert.equal(layer.getSnapshot().staticFallback, true);
  assert.equal(panel.dataset.renderMode, "static-controls");
  assert.equal(panel.dataset.staticFallback, "true");
  layer.open();
  assert.equal(panel.hidden, false);
  let prevented = false;
  documentRoot.dispatch("keydown", {
    key: "Escape",
    preventDefault: () => { prevented = true; },
  });
  assert.equal(prevented, true);
  assert.equal(panel.hidden, true);
  assert.doesNotThrow(() => layer.selectBlock(createBlockWorldContribution().blocks[0].id, "minimal-dom"));
});

test("reduced-motion mode disables cube pulse/rotation while portal hand-offs stay local", () => {
  const base = createBlockWorldContribution();
  const portal = base.blocks.find((block) => block.blockType === "portal");
  const three = fakeThree();
  const parent = new three.Group();
  const events = [];
  const layer = createBlockWorldLayer({
    documentRoot: makeDocument(),
    projection: base,
    three,
    parent,
    reducedMotion: true,
    onNavigate: (snapshot) => events.push(snapshot),
  });
  layer.selectBlock(portal.id, "test");
  const selectedMesh = parent.children.flatMap((group) => group.children ?? []).find((mesh) => mesh.userData?.blockWorldId === portal.id);
  assert.ok(selectedMesh);
  layer.update(0.5, 1);
  assert.equal(selectedMesh.rotation.y, 0);
  assert.equal(selectedMesh.scale.value, 1);
  const route = layer.navigatePortal("rooms", "keyboard");
  assert.equal(route.accessibility.motion, "reduced");
  assert.equal(route.accessibility.input, "keyboard");
  assert.equal(events.length, 1);
  assert.equal(events[0].localOnly, true);
  assert.equal(events[0].externalNetwork, false);
  assert.equal(events[0].persistence, false);
  assert.equal(layer.getSnapshot().reducedMotion, true);
  assert.equal(layer.getSnapshot().accessibility.reducedMotion, true);
});

test("index and renderer declare narrow-screen touch targets and a no-WebGL static fallback", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/render/block-world.js", import.meta.url), "utf8");
  const docs = await readFile(new URL("../docs/BLOCK_WORLD_MIGRATION.md", import.meta.url), "utf8");
  assert.match(html, /id="block-world-console"[^>]*aria-describedby="block-world-description block-world-drag-hint"/);
  assert.match(html, /id="block-world-description"/);
  assert.match(html, /@media\(max-width:420px\)/);
  assert.match(html, /\.block-world-route-button\{[^}]*min-height:44px/);
  assert.match(html, /\.block-world-route-button\{[^}]*touch-action:manipulation/);
  assert.match(html, /@media\(prefers-reduced-motion:reduce\)/);
  assert.match(html, /If WebGL or the renderer module cannot start/);
  assert.match(html, /id="feature-nav-fallback-list"/);
  assert.match(html, /CAMERA ORBIT: EMPTY-FIELD DRAG · WHEEL: TRAVEL/);
  assert.match(html, /CUBE DRAG = ONE X\/Z MOVE · EMPTY-FIELD DRAG = CAMERA ORBIT/);
  assert.match(html, /cube field: tap select · double-tap a portal cube to dive inside/);
  assert.match(html, /Drag a cube to move it; drag the empty field to orbit the camera/);
  assert.match(source, /renderMode = three && parent \? "webgl-cubes" : "static-controls"/);
  assert.match(source, /staticFallback/);
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/i);
  assert.doesNotMatch(source, /\b(?:eval|import)\s*\(/i);
  assert.match(docs, /### Mobile and accessibility route audit/);
  assert.match(docs, /cube drag = one bounded local move; empty-field/);
  assert.match(docs, /static-controls/);
  assert.match(docs, /Neither fallback path contacts a provider/);
});
