import test from "node:test";
import assert from "node:assert/strict";
import { createImmersiveSession, XR_SESSION_OPTIONS } from "../src/render/immersive-session.js";

class FakeVector3 {
  constructor(x = 0, y = 0, z = 0) { this.set(x, y, z); }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  applyMatrix4() { return this; }
  setFromMatrixPosition() { return this; }
}

class FakeMatrix4 {
  identity() { return this; }
  extractRotation() { return this; }
}

class FakeGeometry {
  setFromPoints() { return this; }
  dispose() {}
}

class FakeMaterial {
  constructor(options = {}) { this.options = options; }
  dispose() {}
}

class FakeObject {
  constructor() {
    this.children = [];
    this.parent = null;
    this.visible = true;
    this.userData = {};
    this.matrixWorld = {};
    this.scale = new FakeVector3(1, 1, 1);
  }
  add(child) { this.children.push(child); child.parent = this; return child; }
  remove(child) {
    this.children = this.children.filter((entry) => entry !== child);
    if (child.parent === this) child.parent = null;
  }
  updateWorldMatrix() {}
}

class FakeLine extends FakeObject {
  constructor(geometry, material) {
    super();
    this.geometry = geometry;
    this.material = material;
  }
}

class FakeRaycaster {
  constructor() { this.ray = { origin: new FakeVector3(), direction: new FakeVector3() }; }
  intersectObjects(objects) {
    return objects.length ? [{ object: objects[0], distance: 1 }] : [];
  }
}

const FakeThree = {
  Raycaster: FakeRaycaster,
  Matrix4: FakeMatrix4,
  Vector3: FakeVector3,
  BufferGeometry: FakeGeometry,
  LineBasicMaterial: FakeMaterial,
  Line: FakeLine,
};

function fakeElement() {
  return {
    children: [],
    hidden: false,
    disabled: false,
    style: {},
    dataset: {},
    textContent: "",
    append(...nodes) { this.children.push(...nodes); },
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    remove() {},
  };
}

function createHarness() {
  const body = fakeElement();
  const documentRoot = {
    body,
    createElement: () => fakeElement(),
  };

  const scene = {
    background: { id: "background" },
  };

  const controllers = [new FakeObject(), new FakeObject()];
  const renderer = {
    xr: {
      enabled: false,
      referenceSpace: null,
      session: null,
      getController(index) { return controllers[index]; },
      setReferenceSpaceType(type) { this.referenceSpace = type; },
      async setSession(session) { this.session = session; },
      isPresenting: false,
    },
    getClearAlpha() { return this.clearAlpha ?? 1; },
    setClearAlpha(value) { this.clearAlpha = value; },
  };

  const target = new FakeObject();
  let endHandler = null;
  let ended = false;

  const navigatorRoot = {
    xr: {
      async isSessionSupported(mode) {
        return mode === "immersive-vr" || mode === "immersive-ar";
      },
      async requestSession(mode, options) {
        assert.equal(mode, "immersive-ar");
        assert.deepEqual(options.optionalFeatures, XR_SESSION_OPTIONS.optionalFeatures);
        assert.deepEqual(options.domOverlay, { root: body });
        return {
          inputSources: [],
          addEventListener(type, handler) {
            if (type === "end") endHandler = handler;
          },
          async end() {
            ended = true;
            endHandler?.();
          },
        };
      },
    },
  };

  return {
    body,
    documentRoot,
    scene,
    renderer,
    controllers,
    camera: {},
    controls: { enabled: true },
    target,
    navigatorRoot,
    get ended() { return ended; },
  };
}

test("shared immersive session starts AR on the canonical renderer and restores desktop state", async () => {
  const harness = createHarness();
  const statuses = [];
  const selected = [];

  const session = createImmersiveSession({
    THREE: FakeThree,
    renderer: harness.renderer,
    scene: harness.scene,
    camera: harness.camera,
    controls: harness.controls,
    targets: [harness.target],
    onSelect: (object, metadata) => selected.push({ object, metadata }),
    onStatus: (status) => statuses.push(status),
    documentRoot: harness.documentRoot,
    navigatorRoot: harness.navigatorRoot,
  });

  assert.equal(harness.renderer.xr.enabled, true);
  assert.equal(session.active, false);
  assert.equal(session.getSnapshot().controllerCount, 2);

  const started = await session.start("immersive-ar");
  assert.equal(started, true);
  assert.equal(session.active, true);
  assert.equal(session.mode, "immersive-ar");
  assert.equal(harness.scene.background, null);
  assert.equal(harness.renderer.getClearAlpha(), 0);

  const active = statuses.find((entry) => entry.state === "active");
  assert.equal(active.mode, "immersive-ar");
  assert.equal(active.localOnly, true);
  assert.equal(active.externalExecution, false);

  harness.controllers[0].dispatchEvent?.({ type: "select" });
  assert.equal(selected.length, 0);

  await session.destroy();
  assert.equal(harness.ended, true);
  assert.equal(session.active, false);
  assert.notEqual(harness.scene.background, null);
  assert.equal(harness.renderer.getClearAlpha(), 1);
});
