import test from 'node:test';
import assert from 'node:assert/strict';
import { mountBotPresence } from '../src/render/bot-presence.js';

// --- Minimal THREE stand-in -------------------------------------------------
// Only the surface mountBotPresence touches. The raycaster is controllable so
// click-through can be tested deterministically.
const raycastState = { hits: [] };

class FakeObject3D {
  constructor() {
    this.position = { x: 0, y: 0, z: 0, set: (x, y, z) => { this.position.x = x; this.position.y = y; this.position.z = z; } };
    this.rotation = { x: 0, y: 0, z: 0 };
    this.scale = { x: 1, y: 1, z: 1, set: (x, y, z) => { this.scale.x = x; this.scale.y = y; this.scale.z = z; } };
    this.userData = {};
    this.children = [];
  }
  add(child) { this.children.push(child); return this; }
  remove(child) { this.children = this.children.filter((c) => c !== child); return this; }
  traverse(cb) { cb(this); for (const c of this.children) c.traverse(cb); }
  getWorldPosition(target) { target.x = this.position.x; target.y = this.position.y; target.z = this.position.z; return target; }
}
class FakeMesh extends FakeObject3D {
  constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; }
}
class FakeSprite extends FakeObject3D {
  constructor(material) { super(); this.material = material; }
}
class FakeGeometry { dispose() {} }
class FakeMaterial { constructor(params = {}) { Object.assign(this, params); } dispose() {} }
class FakeColor {
  constructor(value) { this.value = value; }
  clone() { return new FakeColor(this.value); }
  lerp() { return this; }
}
class FakeRaycaster {
  setFromCamera() {}
  intersectObjects() { return raycastState.hits; }
}

const FakeThree = {
  Group: FakeObject3D,
  Mesh: FakeMesh,
  Sprite: FakeSprite,
  SphereGeometry: FakeGeometry,
  TorusGeometry: FakeGeometry,
  PlaneGeometry: FakeGeometry,
  MeshPhysicalMaterial: FakeMaterial,
  MeshBasicMaterial: FakeMaterial,
  SpriteMaterial: FakeMaterial,
  CanvasTexture: class { constructor(image) { this.image = image; } dispose() {} },
  TextureLoader: class { load() {} },
  Raycaster: FakeRaycaster,
  Vector2: class { constructor(x = 0, y = 0) { this.x = x; this.y = y; } },
  Vector3: class { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } project() { return this; } },
  Color: FakeColor,
  PointLight: FakeObject3D,
  SRGBColorSpace: 'srgb',
};

// --- Minimal DOM stand-ins ---------------------------------------------------
function makeElement(tag) {
  const el = {
    tag,
    className: '',
    hidden: false,
    textContent: '',
    style: {},
    children: [],
    setAttribute() {},
    appendChild(child) { el.children.push(child); return child; },
    remove() { el.removed = true; },
  };
  if (tag === 'canvas') {
    el.width = 0;
    el.height = 0;
    el.getContext = () => ({ fillText() {} });
  }
  return el;
}
const documentRoot = { createElement: (tag) => makeElement(tag) };

function makeContainer() {
  const listeners = {};
  return {
    listeners,
    appendChild() {},
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  };
}

const scene = { add() {}, remove() {} };
const camera = {};
const bots = [{ id: 'b1', name: 'Scout', enabled: true, avatar: 'orb-teal' }];

// requestAnimationFrame: run the loop body once, never reschedule.
const realRaf = globalThis.requestAnimationFrame;
const realCancelRaf = globalThis.cancelAnimationFrame;
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
test.after(() => {
  globalThis.requestAnimationFrame = realRaf;
  globalThis.cancelAnimationFrame = realCancelRaf;
});

function mount(overrides = {}) {
  const container = makeContainer();
  const presence = mountBotPresence({
    three: FakeThree,
    scene,
    camera,
    container,
    documentRoot,
    getBots: () => bots,
    ...overrides,
  });
  return { presence, container };
}

function click(container, x0, y0, x1, y1) {
  container.listeners.pointerdown[0]({ clientX: x0, clientY: y0 });
  container.listeners.pointerup[0]({ clientX: x1, clientY: y1 });
}

test('orb click fires onOrbClick with the clicked bot id', () => {
  const clicked = [];
  const { container } = mount({ onOrbClick: (id) => clicked.push(id) });
  raycastState.hits = [{ object: { userData: { botId: 'b1' } } }];
  click(container, 100, 100, 102, 101); // moved ~2.2px: a tap, not a drag
  assert.deepEqual(clicked, ['b1']);
});

test('a drag does not fire onOrbClick', () => {
  const clicked = [];
  const { container } = mount({ onOrbClick: (id) => clicked.push(id) });
  raycastState.hits = [{ object: { userData: { botId: 'b1' } } }];
  click(container, 100, 100, 200, 200); // moved > 6px: a drag
  assert.deepEqual(clicked, []);
});

test('clicking empty space does not fire onOrbClick', () => {
  const clicked = [];
  const { container } = mount({ onOrbClick: (id) => clicked.push(id) });
  raycastState.hits = [];
  click(container, 100, 100, 101, 101);
  assert.deepEqual(clicked, []);
});

test('orb click without a handler is a safe no-op', () => {
  const { container } = mount();
  raycastState.hits = [{ object: { userData: { botId: 'b1' } } }];
  assert.doesNotThrow(() => click(container, 100, 100, 101, 101));
});

test('mount requires the three module (codebase convention: three, not THREE)', () => {
  assert.throws(
    () => mountBotPresence({ scene, camera, container: makeContainer(), documentRoot, getBots: () => bots }),
    TypeError,
  );
});

test('speak targets the right orb bubble and destroy detaches listeners', () => {
  const { presence, container } = mount({});
  assert.deepEqual(presence.getBotIds(), ['b1']);
  assert.equal(presence.speak('b1', 'hello'), true);
  assert.equal(presence.speak('missing', 'hello'), false);
  presence.destroy();
  assert.deepEqual(container.listeners.pointerdown ?? [], []);
  assert.deepEqual(container.listeners.pointerup ?? [], []);
});

test('Lens presentation can temporarily hide bot ornaments without removing their state', () => {
  const { presence } = mount({});
  assert.equal(presence.visible, true);
  assert.equal(presence.setVisible(false), false);
  assert.equal(presence.visible, false);
  assert.deepEqual(presence.getBotIds(), ['b1']);
  assert.equal(presence.setVisible(true), true);
  presence.destroy();
});
