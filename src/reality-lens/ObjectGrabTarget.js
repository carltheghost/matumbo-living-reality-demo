import * as THREE from "three";

export class ObjectGrabTarget {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
  }

  updatePointer(x, y) {
    this.pointer.set(x, y);
  }

  hitObject(objects) {
    this.raycaster.setFromCamera(\
      this.pointer,\
      this.camera\
    );

    const hits = this.raycaster.intersectObjects(\
      objects,\
      true\
    );

    if (!hits.length) {
      return null;
    }

    let object = hits[0].object;

    while (object && !object.userData.isRealityObject) {
      object = object.parent;
    }

    return object || null;
  }

  openGrabTarget(objects) {
    const target = this.hitObject(objects);

    if (!target) {
      return null;
    }

    target.userData.opened = true;
    target.userData.tabMode = "object-face";

    return target;
  }
}
