import * as THREE from "three";

export class LensWindowController {
  constructor(camera, controls) {
    this.camera = camera;
    this.controls = controls;
    this.minDistanceMultiplier = 2.5;
  }

  frameObject(object3D) {
    if (!object3D) return;

    const bounds = new THREE.Box3().setFromObject(object3D);
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());

    const radius = sphere.radius;
    const minimumDistance = radius * this.minDistanceMultiplier;

    const direction = new THREE.Vector3()
      .subVectors(this.camera.position, sphere.center)
      .normalize();

    if (direction.lengthSq() === 0) {
      direction.set(0, 0, 1);
    }

    this.camera.position.copy(\
      sphere.center.clone().add(direction.multiplyScalar(minimumDistance))\
    );

    this.camera.near = Math.max(0.01, radius * 0.01);
    this.camera.far = Math.max(1000, radius * 100);
    this.camera.updateProjectionMatrix();

    if (this.controls) {
      this.controls.target.copy(sphere.center);
      this.controls.update();
    }
  }

  enforceMinimumDistance(object3D) {
    if (!object3D) return;

    const bounds = new THREE.Box3().setFromObject(object3D);
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());

    const minimumDistance =
      sphere.radius * this.minDistanceMultiplier;

    const distance = this.camera.position.distanceTo(\
      sphere.center\
    );

    if (distance < minimumDistance) {
      const direction = new THREE.Vector3()
        .subVectors(this.camera.position, sphere.center)
        .normalize();

      if (direction.lengthSq() === 0) {
        direction.set(0, 0, 1);
      }

      this.camera.position.copy(\
        sphere.center.clone().add(\
          direction.multiplyScalar(minimumDistance)\
        )\
      );
    }
  }
}
