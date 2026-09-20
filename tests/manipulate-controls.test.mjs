import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MANIPULATE_BOUNDARY,
  MANIPULATE_GIZMO_SIZE_DESKTOP,
  MANIPULATE_GIZMO_SIZE_TOUCH,
  MANIPULATE_MODE_LABELS,
  MANIPULATE_MODES,
  MANIPULATE_SCHEMA_VERSION,
  MANIPULATE_SOURCE,
  MANIPULATE_TOUCH_HIT_MINIMUM,
  createManipulateControls,
  normalizeManipulateMode,
  readObjectTransform,
} from "../src/render/manipulate-controls.js";
import { createBlockWorldContribution } from "../src/domains/block-world.js";
import { createBlockWorldLayer } from "../src/render/block-world.js";

// ---------------------------------------------------------------------------
// Fake TransformControls: mimics the vendored three.js control surface used by
// the wrapper (constructor, setMode/getMode, setSize, setSpace, attach,
// detach, getHelper, addEventListener, dispose). No three.js involved.
// ---------------------------------------------------------------------------
function createFakeTransformControlsClass(log = []) {
  return class FakeTransformControls {
    constructor(camera, domElement = null) {
      this.camera = camera;
      this.domElement = domElement;
      this.object = undefined;
      this.axis = null;
      this.dragging = false;
      this.mode = "translate";
      this.size = 1;
      this.space = "world";
      this.listeners = new Map();
      this.helper = { isHelper: true, added: false };
      log.push(["construct", camera, domElement]);
    }
    setMode(mode) { this.mode = mode; log.push(["setMode", mode]); }
    getMode() { return this.mode; }
    setSize(size) { this.size = size; log.push(["setSize", size]); }
    setSpace(space) { this.space = space; log.push(["setSpace", space]); }
    attach(object) { this.object = object; log.push(["attach", object]); }
    detach() { this.object = undefined; this.axis = null; log.push(["detach"]); }
    getHelper() { return this.helper; }
    addEventListener(type, callback) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(callback);
    }
    dispatch(type, event = {}) {
      for (const callback of this.listeners.get(type) ?? []) callback({ type, ...event });
    }
    dispose() { log.push(["dispose"]); }
  };
}

function fakeObject() {
  return {
    position: { x: 1.23456, y: -2.5, z: 3 },
    rotation: { x: 0.123456, y: 0, z: -0.5 },
    scale: { x: 1.5, y: 1.5, z: 2 },
    userData: {},
  };
}

function controlsWith({ touch = false, scene = null } = {}) {
  const log = [];
  const FakeClass = createFakeTransformControlsClass(log);
  const transformEnds = [];
  const draggingChanges = [];
  const manipulator = createManipulateControls({
    TransformControlsClass: FakeClass,
    scene,
    camera: { isCamera: true },
    domElement: { isDom: true },
    isTouch: touch,
    onTransformEnd: (blockId, transform, context) => transformEnds.push({ blockId, transform, context }),
    onDraggingChange: (dragging, attachment) => draggingChanges.push({ dragging, attachment }),
  });
  return { log, manipulator, transformEnds, draggingChanges, FakeClass };
}

test("mode constants cover move, rotate, and stretch with Reality Lens naming", () => {
  assert.deepEqual([...MANIPULATE_MODES], ["translate", "rotate", "scale"]);
  assert.equal(MANIPULATE_MODE_LABELS.translate, "MOVE");
  assert.equal(MANIPULATE_MODE_LABELS.rotate, "ROTATE");
  assert.equal(MANIPULATE_MODE_LABELS.scale, "STRETCH");
  assert.equal(MANIPULATE_SOURCE, "manipulate-controls");
  assert.equal(MANIPULATE_SCHEMA_VERSION, 1);
  assert.ok(!/world.?eye/i.test(MANIPULATE_BOUNDARY), "World Eye stays retired");
});

test("normalizeManipulateMode is case-insensitive and rejects unknowns", () => {
  assert.equal(normalizeManipulateMode("TRANSLATE"), "translate");
  assert.equal(normalizeManipulateMode(" Rotate "), "rotate");
  assert.equal(normalizeManipulateMode("s"), undefined);
  assert.equal(normalizeManipulateMode("scale"), "scale");
  assert.equal(normalizeManipulateMode(null), null);
  assert.equal(normalizeManipulateMode(undefined), null);
  assert.equal(normalizeManipulateMode("bogus"), undefined);
});

test("mode switching updates state and returns frozen snapshots", () => {
  const { manipulator } = controlsWith();
  assert.equal(manipulator.getMode(), null);
  const moved = manipulator.setMode("translate");
  assert.equal(manipulator.getMode(), "translate");
  assert.equal(moved.action, "mode-change");
  assert.equal(moved.modeLabel, "MOVE");
  assert.ok(Object.isFrozen(moved));
  manipulator.setMode("rotate");
  assert.equal(manipulator.getMode(), "rotate");
  manipulator.setMode("scale");
  assert.equal(manipulator.getMode(), "scale");
});

test("unknown mode is blocked and keeps the previous mode", () => {
  const { manipulator } = controlsWith();
  manipulator.setMode("translate");
  const blocked = manipulator.setMode("spin");
  assert.equal(blocked.action, "mode-blocked");
  assert.equal(blocked.reason, "unknown-mode");
  assert.equal(manipulator.getMode(), "translate");
});

test("setMode(null) detaches and disarms", () => {
  const { log, manipulator } = controlsWith();
  const object = fakeObject();
  manipulator.setMode("translate");
  manipulator.attach(object, "block-1");
  assert.ok(manipulator.getAttached());
  manipulator.setMode(null);
  assert.equal(manipulator.getMode(), null);
  assert.equal(manipulator.getAttached(), null);
  assert.ok(log.some(([op]) => op === "detach"));
});

test("attach is idempotent for the already-attached object", () => {
  const { log, manipulator } = controlsWith();
  const object = fakeObject();
  manipulator.setMode("translate");
  const first = manipulator.attach(object, "block-1", "select");
  assert.equal(first.action, "attach");
  assert.equal(manipulator.getAttached().blockId, "block-1");
  const second = manipulator.attach(object, "block-1", "select");
  assert.equal(second.action, "attach-noop");
  assert.equal(log.filter(([op]) => op === "attach").length, 1);
});

test("attach without a TransformControls class is a blocked no-op", () => {
  const manipulator = createManipulateControls({ camera: { isCamera: true } });
  assert.equal(manipulator.isAvailable(), false);
  const blocked = manipulator.attach(fakeObject(), "block-1");
  assert.equal(blocked.action, "attach-blocked");
  assert.equal(blocked.reason, "unavailable");
  assert.equal(manipulator.getAttached(), null);
  // Mode state still works; the gizmo simply cannot mount.
  manipulator.setMode("rotate");
  assert.equal(manipulator.getMode(), "rotate");
});

test("attach with a missing target is blocked", () => {
  const { manipulator } = controlsWith();
  manipulator.setMode("translate");
  assert.equal(manipulator.attach(null, "block-1").reason, "missing-target");
  assert.equal(manipulator.attach(fakeObject(), null).reason, "missing-target");
  assert.equal(manipulator.getAttached(), null);
});

test("release write-back reports the block id and a plain transform", () => {
  // TransformControls dispatches `mouseUp` only after a genuine gizmo drag,
  // so the wrapper's write-back fires exactly once per release.
  let captured = null;
  const log = [];
  const Fake = createFakeTransformControlsClass(log);
  const Hooked = class extends Fake {
    constructor(...args) { super(...args); captured = this; }
  };
  const ends = [];
  const m = createManipulateControls({
    TransformControlsClass: Hooked,
    camera: { isCamera: true },
    onTransformEnd: (blockId, transform, context) => ends.push({ blockId, transform, context }),
  });
  m.setMode("translate");
  m.attach(fakeObject(), "block-9", "select");
  assert.ok(captured, "fake control instance was constructed");
  captured.dispatch("mouseUp", { mode: "translate" });
  assert.equal(ends.length, 1);
  assert.equal(ends[0].blockId, "block-9");
  assert.deepEqual(ends[0].transform.position, [1.2346, -2.5, 3]);
  assert.deepEqual(ends[0].transform.rotation, [0.1235, 0, -0.5]);
  assert.deepEqual(ends[0].transform.scale, [1.5, 1.5, 2]);
  assert.equal(ends[0].context.reason, "release");
  assert.equal(ends[0].context.mode, "translate");
  assert.ok(Object.isFrozen(ends[0].transform));
  assert.ok(Object.isFrozen(ends[0].transform.position));
});

test("dragging-changed notifies the host so camera controls can pause", () => {
  let captured = null;
  const log = [];
  const Fake = createFakeTransformControlsClass(log);
  const Hooked = class extends Fake {
    constructor(...args) { super(...args); captured = this; }
  };
  const changes = [];
  const m = createManipulateControls({
    TransformControlsClass: Hooked,
    camera: { isCamera: true },
    onDraggingChange: (dragging, attachment) => changes.push({ dragging, attachment }),
  });
  m.setMode("translate");
  const object = fakeObject();
  m.attach(object, "block-2");
  assert.equal(m.isDragging(), false);
  captured.dispatch("dragging-changed", { value: true });
  assert.equal(m.isDragging(), true);
  assert.deepEqual(changes[0], { dragging: true, attachment: { object, blockId: "block-2" } });
  captured.dispatch("dragging-changed", { value: false });
  assert.equal(m.isDragging(), false);
  assert.equal(changes[1].dragging, false);
});

test("touch hit areas stay above the minimum", () => {
  assert.ok(MANIPULATE_GIZMO_SIZE_TOUCH >= MANIPULATE_TOUCH_HIT_MINIMUM);
  assert.ok(MANIPULATE_TOUCH_HIT_MINIMUM >= 1.4);
  const desktop = controlsWith({ touch: false });
  assert.equal(desktop.manipulator.getGizmoSize(), MANIPULATE_GIZMO_SIZE_DESKTOP);
  assert.equal(desktop.manipulator.isTouchMode(), false);
  const touch = controlsWith({ touch: true });
  assert.ok(touch.manipulator.getGizmoSize() >= MANIPULATE_TOUCH_HIT_MINIMUM);
  assert.equal(touch.manipulator.isTouchMode(), true);
  const { log, manipulator } = controlsWith({ touch: false });
  manipulator.setMode("translate");
  manipulator.attach(fakeObject(), "block-7");
  manipulator.setTouchMode(true);
  assert.ok(manipulator.getGizmoSize() >= MANIPULATE_TOUCH_HIT_MINIMUM);
  assert.ok(log.some(([op, size]) => op === "setSize" && size >= MANIPULATE_TOUCH_HIT_MINIMUM));
});

test("detach with nothing attached is a safe no-op", () => {
  const { manipulator } = controlsWith();
  const noop = manipulator.detach("empty-space");
  assert.equal(noop.action, "detach-noop");
  assert.equal(manipulator.getAttached(), null);
  const bare = createManipulateControls();
  assert.equal(bare.detach().action, "detach-noop");
  assert.equal(bare.getMode(), null);
});

test("snapshots carry the simulation-only boundary and no authority", () => {
  const { manipulator } = controlsWith();
  const snapshot = manipulator.getSnapshot();
  assert.equal(snapshot.source, MANIPULATE_SOURCE);
  assert.equal(snapshot.localOnly, true);
  assert.equal(snapshot.simulation, true);
  assert.equal(snapshot.externalNetwork, false);
  assert.equal(snapshot.externalTransfer, false);
  assert.equal(snapshot.persistence, false);
  assert.equal(snapshot.executable, false);
  assert.match(snapshot.boundary, /Local projection only/);
  assert.ok(Object.isFrozen(snapshot));
});

test("readObjectTransform returns rounded plain arrays", () => {
  const transform = readObjectTransform(fakeObject());
  assert.deepEqual(transform.position, [1.2346, -2.5, 3]);
  assert.deepEqual(transform.rotation, [0.1235, 0, -0.5]);
  assert.deepEqual(transform.scale, [1.5, 1.5, 2]);
  assert.ok(Object.isFrozen(transform.position));
  const empty = readObjectTransform(null);
  assert.deepEqual(empty.position, [0, 0, 0]);
  assert.deepEqual(empty.scale, [1, 1, 1]);
});

test("trace stays bounded", () => {
  const { manipulator } = controlsWith();
  for (let index = 0; index < 60; index += 1) manipulator.setMode("translate");
  assert.ok(manipulator.getTrace().length <= 24);
});

// ---------------------------------------------------------------------------
// Block-world integration (no three.js): mode arming, selection routing, and
// snapshot shape stay safe when the 3D surface is unavailable.
// ---------------------------------------------------------------------------
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
  const documentRoot = {
    createElement(tag) { return makeElement(documentRoot, tag); },
    getElementById(id) {
      // Auto-provision: block-world looks up many console ids at init.
      if (!documentRoot.elements.has(id)) {
        const element = makeElement(documentRoot);
        element.id = id;
        documentRoot.elements.set(id, element);
      }
      return documentRoot.elements.get(id);
    },
    addEventListener() {},
    elements: new Map(),
  };
  return documentRoot;
}

function layerWithoutThree() {
  return createBlockWorldLayer({
    documentRoot: makeDocument(),
    projection: createBlockWorldContribution(),
  });
}

test("block-world arms manipulate mode and reports unavailability without three.js", () => {
  const layer = layerWithoutThree();
  assert.equal(layer.getManipulateMode(), null);
  const snapshot = layer.setManipulateMode("translate");
  assert.equal(layer.getManipulateMode(), "translate");
  assert.equal(snapshot.manipulateMode, "translate");
  assert.equal(snapshot.manipulator.available, false);
  assert.equal(snapshot.manipulator.mode, "translate");
});

test("block-world rejects unknown manipulate modes", () => {
  const layer = layerWithoutThree();
  layer.setManipulateMode("translate");
  layer.setManipulateMode("spin");
  assert.equal(layer.getManipulateMode(), "translate");
});

test("block-world disarms manipulate mode and detaches", () => {
  const layer = layerWithoutThree();
  layer.setManipulateMode("rotate");
  const snapshot = layer.setManipulateMode(null);
  assert.equal(layer.getManipulateMode(), null);
  assert.equal(snapshot.manipulateMode, null);
  assert.equal(snapshot.manipulator.mode, null);
  const noop = layer.detachManipulator("empty-space");
  assert.equal(noop.action, "detach-noop");
});

test("block-world selection with an armed mode and no meshes is a safe no-op", () => {
  const layer = layerWithoutThree();
  layer.setManipulateMode("scale");
  const block = createBlockWorldContribution().blocks[0];
  const selected = layer.selectBlock(block.id, "test");
  assert.ok(selected, "selection itself still works without three.js");
  assert.equal(layer.getManipulateMode(), "scale");
  assert.equal(layer.getManipulatorSnapshot().attachedBlockId, null);
});

test("manipulator snapshots ride along in the block-world snapshot", () => {
  const layer = layerWithoutThree();
  const snapshot = layer.getSnapshot();
  assert.equal(snapshot.manipulateMode, null);
  assert.equal(snapshot.manipulator.source, MANIPULATE_SOURCE);
  assert.equal(snapshot.manipulator.localOnly, true);
});

test("external intent source registers and clears with a trace record", () => {
  const { manipulator } = controlsWith();
  const registered = manipulator.setExternalIntentSource({ pick: () => null });
  assert.equal(registered.action, "external-source");
  assert.equal(registered.registered, true);
  assert.equal(registered.external, true);
  const cleared = manipulator.setExternalIntentSource(null);
  assert.equal(cleared.registered, false);
  const bogus = manipulator.setExternalIntentSource({ nope: true });
  assert.equal(bogus.registered, false);
});

test("external grab without a source is blocked and leaves touch behavior alone", () => {
  const { manipulator } = controlsWith();
  const blocked = manipulator.applyExternalIntent({ gesture: "grab", pose: { x: 0.5, y: 0.5 } });
  assert.equal(blocked.action, "external-blocked");
  assert.equal(blocked.reason, "no-source");
  // Direct touch attach still works exactly as before.
  const target = fakeObject();
  const attached = manipulator.attach(target, "block:1", "select");
  assert.equal(attached.action, "attach");
  assert.equal(manipulator.getAttached().blockId, "block:1");
});

test("external grab misses safely and attaches on a host hit", () => {
  const { manipulator } = controlsWith();
  manipulator.setExternalIntentSource({ pick: () => null });
  const miss = manipulator.applyExternalIntent({ gesture: "grab", pose: { x: 0.1, y: 0.9 } });
  assert.equal(miss.action, "external-miss");
  assert.equal(manipulator.getAttached(), null);
  const target = fakeObject();
  manipulator.setExternalIntentSource({ pick: () => ({ object: target, blockId: "block:9" }) });
  const attached = manipulator.applyExternalIntent({ gesture: "grab", pose: { x: 0.5, y: 0.5 } });
  assert.equal(attached.action, "attach");
  assert.equal(manipulator.getMode(), "translate");
  assert.equal(manipulator.getAttached().blockId, "block:9");
  const trace = manipulator.getTrace();
  assert.ok(trace.some((record) => record.action === "external-attach" && record.external === true));
});

test("external drag moves the attached object in world units", () => {
  const { manipulator } = controlsWith();
  const blocked = manipulator.applyExternalIntent({ gesture: "drag", detail: { dx: 0.1, dy: 0, dz: 0 } });
  assert.equal(blocked.action, "external-blocked");
  assert.equal(blocked.reason, "nothing-attached");
  const target = fakeObject();
  const before = target.position.x;
  manipulator.attach(target, "block:2", "select");
  const moved = manipulator.applyExternalIntent({ gesture: "drag", detail: { dx: 0.25, dy: -0.5, dz: 0 } });
  assert.equal(moved.action, "external-translate");
  assert.equal(moved.external, true);
  assert.ok(Math.abs(target.position.x - (before + 0.25 * 4)) < 1e-9, "camera-right maps dx to world x");
  assert.ok(Math.abs(target.position.y - (-2.5 + -0.5 * 4)) < 1e-9, "camera-up maps dy to world y");
});

test("external scale and rotate drive modes with clamped, tagged records", () => {
  const { manipulator } = controlsWith();
  const target = fakeObject();
  manipulator.attach(target, "block:3", "select");
  const scaled = manipulator.applyExternalIntent({ gesture: "scale", detail: { factor: 2 } });
  assert.equal(scaled.action, "external-scale");
  assert.equal(manipulator.getMode(), "scale");
  assert.equal(scaled.factor, 2);
  assert.equal(target.scale.x, 3);
  const clamped = manipulator.applyExternalIntent({ gesture: "scale", detail: { factor: 99 } });
  assert.equal(clamped.factor, 4);
  const rotated = manipulator.applyExternalIntent({ gesture: "rotate", detail: { degrees: 90 } });
  assert.equal(rotated.action, "external-rotate");
  assert.equal(manipulator.getMode(), "rotate");
  assert.ok(Math.abs(target.rotation.y - Math.PI / 2) < 1e-9);
});

test("external release writes back and detaches", () => {
  const { manipulator, transformEnds } = controlsWith();
  const target = fakeObject();
  manipulator.attach(target, "block:4", "select");
  const released = manipulator.applyExternalIntent({ gesture: "release" });
  assert.equal(released.action, "detach");
  assert.equal(manipulator.getAttached(), null);
  assert.equal(transformEnds.length, 1, "gesture release triggers the same write-back as a gizmo release");
  assert.equal(transformEnds[0].blockId, "block:4");
  assert.equal(transformEnds[0].context.reason, "gesture-release");
  const trace = manipulator.getTrace();
  assert.ok(trace.some((record) => record.action === "external-release" && record.external === true));
});

test("unmapped external gestures are ignored, never thrown", () => {
  const { manipulator } = controlsWith();
  const ignored = manipulator.applyExternalIntent({ gesture: "wave-hello" });
  assert.equal(ignored.action, "external-ignored");
  const empty = manipulator.applyExternalIntent();
  assert.equal(empty.action, "external-ignored");
});

test("block-world exposes noteGestureIntent as a safe no-op host", () => {
  const layer = layerWithoutThree();
  assert.equal(typeof layer.noteGestureIntent, "function");
  const record = layer.noteGestureIntent({ gesture: "grab", pose: { x: 0.5, y: 0.5 } });
  assert.ok(record && typeof record.action === "string", "returns a trace record, never throws");
  const released = layer.noteGestureIntent({ gesture: "release" });
  assert.ok(released && typeof released.action === "string");
});
