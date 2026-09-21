/**
 * Shared fakes for gateway view tests (gateway-tentacles, constellation-overview).
 * Minimal THREE + DOM doubles — just enough surface for the modules under test.
 * Not a *.test.mjs file, so node --test skips it.
 */

function transform3() {
  return {
    x: 0, y: 0, z: 0,
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; },
  };
}

export function makeFakeThree() {
  const raycasters = [];

  class Vector3 {
    constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    clone() { return new Vector3(this.x, this.y, this.z); }
  }

  class Vector2 {
    constructor(x = 0, y = 0) { this.x = x; this.y = y; }
    set(x, y) { this.x = x; this.y = y; return this; }
  }

  class Object3D {
    constructor() {
      this.children = [];
      this.position = transform3();
      this.rotation = transform3();
      this.scale = { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } };
      this.visible = true;
      this.userData = {};
      this.parent = null;
      this.name = "";
      this.frustumCulled = true;
    }
    add(child) { this.children.push(child); child.parent = this; return this; }
    remove(child) {
      const i = this.children.indexOf(child);
      if (i >= 0) this.children.splice(i, 1);
      child.parent = null;
      return this;
    }
  }

  class Geometry {
    constructor() { this.disposed = false; }
    dispose() { this.disposed = true; }
  }
  class BoxGeometry extends Geometry {
    constructor(w, h, d) { super(); this.width = w; this.height = h; this.depth = d; }
  }
  class SphereGeometry extends Geometry {
    constructor(r) { super(); this.radius = r; }
  }
  class EdgesGeometry extends Geometry {
    constructor(geo) { super(); this.source = geo; }
  }
  class BufferGeometry extends Geometry {
    constructor() { super(); this.attributes = {}; }
    setAttribute(name, attr) { this.attributes[name] = attr; return this; }
  }
  class Float32BufferAttribute {
    constructor(array, itemSize) {
      this.array = array; this.itemSize = itemSize;
      this.count = Math.floor(array.length / itemSize);
    }
  }
  class CatmullRomCurve3 {
    constructor(points) { this.points = points; }
    getPoints(n) { return this.points.slice(0, n); }
  }
  class TubeGeometry extends Geometry {
    constructor(curve, tubularSegments, radius, radialSegments, closed) {
      super();
      this.curve = curve; this.tubularSegments = tubularSegments;
      this.radius = radius; this.radialSegments = radialSegments; this.closed = closed;
    }
  }

  class Material {
    constructor(opts = {}) {
      this.disposed = false;
      Object.assign(this, opts);
      if (this.emissiveIntensity === undefined) this.emissiveIntensity = 0;
    }
    dispose() { this.disposed = true; }
  }
  class MeshStandardMaterial extends Material {}
  class LineBasicMaterial extends Material {}

  class Mesh extends Object3D {
    constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; }
  }
  class LineSegments extends Object3D {
    constructor(geometry, material) { super(); this.geometry = geometry; this.material = material; }
  }

  class Raycaster {
    constructor() { this.hits = []; raycasters.push(this); }
    setFromCamera() {}
    intersectObjects() { return this.hits; }
  }

  class Group extends Object3D {}

  return {
    Vector3, Vector2, Group, Mesh, LineSegments,
    BoxGeometry, SphereGeometry, EdgesGeometry, BufferGeometry,
    Float32BufferAttribute, CatmullRomCurve3, TubeGeometry,
    MeshStandardMaterial, LineBasicMaterial, Raycaster,
    _raycasters: raycasters,
  };
}

export function makeElement(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    children: [],
    style: {},
    dataset: {},
    className: "",
    id: "",
    textContent: "",
    hidden: false,
    attributes: {},
    _listeners: {},
    classList: {
      add() {}, remove() {}, toggle() {},
      contains() { return false; },
    },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] ?? null; },
    appendChild(c) { this.children.push(c); return c; },
    append(...cs) { this.children.push(...cs); return this; },
    addEventListener(type, fn) { (this._listeners[type] ??= []).push(fn); },
    removeEventListener() {},
    focus() {},
    remove() { this._removed = true; },
    closest() { return null; },
    querySelector() { return null; },
  };
  return el;
}

export function makeDocument() {
  const listeners = {};
  const head = makeElement("head");
  const body = makeElement("body");
  return {
    head,
    body,
    createElement: (t) => makeElement(t),
    getElementById: () => null,
    addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
    removeEventListener() {},
    _listeners: listeners,
    defaultView: undefined,
  };
}

export function findById(doc, id) {
  const walk = (el) => {
    if (el.id === id) return el;
    for (const child of el.children ?? []) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(doc.body) ?? walk(doc.head);
}

export function fire(elOrDoc, type, event = {}) {
  const handlers = elOrDoc._listeners?.[type] ?? [];
  const full = { preventDefault() {}, target: { tagName: "DIV", closest: () => null }, ...event };
  for (const fn of handlers) fn(full);
}
