import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { createBlockWorldContribution } from "../src/domains/block-world.js";
import {
  BLOCK_WORLD_GAZE_LOCK_COLOR,
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
    ["block-world-boundary"], ["block-world-proximity-status"], ["block-world-depth-status"],
    ["block-world-depth-boundary"], ["block-world-depth-3d"], ["block-world-depth-4d"],
    ["block-world-depth-5d"], ["block-world-linked-previous"], ["block-world-linked-next"],
    ["block-world-linked-navigation-status"], ["block-world-linked-navigation-trace"],
    ["block-world-inspection"], ["block-world-container-hint"], ["block-world-contents"],
    ["block-world-content-focus"], ["block-world-content-previous"], ["block-world-content-next"],
    ["block-world-content-navigation-status"],
  ].forEach(([id, hidden]) => documentRoot.register(id, hidden));
  return documentRoot;
}

function fakeThree() {
  class Vector {
    constructor() { this.x = 0; this.y = 0; this.z = 0; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  }
  class Group {
    constructor() { this.children = []; this.position = new Vector(); this.visible = true; this.userData = {}; }
    add(child) { this.children.push(child); child.parent = this; }
    remove(child) { this.children = this.children.filter((entry) => entry !== child); }
  }
  class BoxGeometry { dispose() {} }
  class EdgesGeometry { constructor(source) { this.source = source; } dispose() {} }
  class Material {
    constructor(options = {}) { Object.assign(this, options); }
    dispose() {}
  }
  class Mesh {
    constructor(geometry, material) {
      this.geometry = geometry;
      this.material = material;
      this.position = new Vector();
      this.rotation = { x: 0, y: 0 };
      this.scale = { value: 1, setScalar: (value) => { this.scale.value = value; } };
      this.userData = {};
      this.visible = true;
      this.children = [];
    }
    add(child) { this.children.push(child); child.parent = this; }
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

test("fresh gaze lock is a red edge cue on the existing cube and clears without draft mutation", () => {
  const base = createBlockWorldContribution();
  const target = base.blocks.find((block) => block.container && block.contentCount > 0) ?? base.blocks[0];
  assert.ok(target);
  const three = fakeThree();
  const parent = new three.Group();
  const layer = createBlockWorldLayer({
    documentRoot: makeDocument(),
    projection: base,
    three,
    parent,
  });
  const canonicalBefore = JSON.stringify(layer.getSnapshot().canonicalProjection);

  const locked = layer.setGazeLockedBlock(target.id, {
    normalized: { x: 2, y: -2 },
    expiresAt: 123,
    action: "gaze-lock",
    reason: "fresh-gaze",
  });
  assert.equal(locked.gazeLock.active, true);
  assert.equal(locked.gazeLock.blockId, target.id);
  assert.deepEqual(locked.gazeLock.normalized, { x: 1, y: -1 });
  assert.equal(locked.gazeLock.cue, true);
  assert.equal(locked.gazeLock.cueColor, BLOCK_WORLD_GAZE_LOCK_COLOR);
  assert.equal(JSON.stringify(locked.canonicalProjection), canonicalBefore);

  const body = parent.children[0].children.find((mesh) => mesh.userData?.blockWorldId === target.id);
  const cue = body?.children?.find((child) => child.userData?.blockWorldGazeLockCue === true);
  assert.ok(cue, "lock cue stays attached to the owning cube");
  assert.equal(cue.name, "block-world-gaze-lock-cue");
  assert.equal(cue.visible, true);
  assert.equal(cue.userData.blockWorldGazeLockColor, BLOCK_WORLD_GAZE_LOCK_COLOR);
  assert.equal(cue.userData.blockWorldGazeLockSource, "gaze-hand-coupling");
  assert.match(cue.userData.blockWorldGazeLockBoundary, /presentation only/i);

  const cleared = layer.setGazeLockedBlock(null, { reason: "gaze-expired" });
  assert.equal(cleared.gazeLock.active, false);
  assert.equal(cleared.gazeLock.cue, false);
  assert.equal(cue.visible, false);
  assert.equal(cleared.gazeLock.reason, "gaze-expired");
  assert.equal(JSON.stringify(cleared.canonicalProjection), canonicalBefore);
});

test("gaze and XR hand seams expose coupled cue/action boundaries without raw sensor authority", async () => {
  const [main, input, coupling] = await Promise.all([
    readFile(new URL("../src/main.js", import.meta.url), "utf8"),
    readFile(new URL("../src/render/gesture-input.js", import.meta.url), "utf8"),
    readFile(new URL("../src/render/gaze-hand-coupling.js", import.meta.url), "utf8"),
  ]);
  assert.match(main, /setGazeLockedBlock/);
  assert.match(main, /inputSource === 'xr-hand'/);
  assert.match(main, /gesture-xr-select/);
  assert.match(main, /gaze-hand-select/);
  assert.match(main, /target\.id !== resolution\.targetBlockId/);
  assert.match(main, /No raw frames.*arbitrary movement.*camera-driven edits/i);
  assert.match(main, /['\"]grab['\"],\s*['\"]hold['\"],\s*['\"]place['\"],\s*['\"]release['\"]/i);
  assert.match(input, /pointProvided: input\?\.hand \? false : true/);
  assert.match(input, /source, input\?\.hand \? "select"/);
  assert.match(coupling, /native-hand pinch\/point\/open\/inspect or XR-hand select/i);
  assert.doesNotMatch(input, /fetch\s*\(|WebSocket|sendBeacon|localStorage|sessionStorage|indexedDB/);
  assert.doesNotMatch(main, /cameraDrivenBlockEdits:\s*true/);
});
