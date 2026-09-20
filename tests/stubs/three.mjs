// tests/stubs/three.mjs
//
// Minimal THREE stub: only the APIs used by photo-mascot-presence.js.
// Raycaster intersections are controllable from tests via the static hooks:
//   Raycaster.__hits        -> array returned by intersectObject()
//   Raycaster.__planeResult -> Vector3 (or null) returned by ray.intersectPlane()

export class Vector2 {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }
  set(x, y) {
    this.x = x;
    this.y = y;
    return this;
  }
  copy(v) {
    this.x = v.x;
    this.y = v.y;
    return this;
  }
}

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  copy(v) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }
  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }
  add(v) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }
  addScaledVector(v, s) {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }
  project(camera) {
    if (camera && typeof camera.projectVector === "function") {
      return camera.projectVector(this);
    }
    return this;
  }
}

export class Plane {
  constructor() {
    this.normal = new Vector3(0, 0, 1);
    this.constant = 0;
  }
  setFromNormalAndCoplanarPoint(normal, point) {
    this.normal.copy(normal);
    this.constant = -(point.x * normal.x + point.y * normal.y + point.z * normal.z);
    return this;
  }
}

export class Raycaster {
  constructor() {
    this.ray = {
      intersectPlane: (plane, target) => {
        const r = Raycaster.__planeResult;
        if (!r || !target) return null;
        return target.copy(r);
      },
    };
  }
  setFromCamera() {}
  intersectObject() {
    return Raycaster.__hits || [];
  }
}

Raycaster.__hits = [];
Raycaster.__planeResult = null;
