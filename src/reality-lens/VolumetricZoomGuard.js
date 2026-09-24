export function keepVolumetricObject(object3D) {
  if (!object3D) return;

  object3D.userData.isVolumetric = true;
  object3D.userData.preventFlatProjection = true;

  if (object3D.geometry) {
    object3D.geometry.computeBoundingSphere();
  }
}

export function validateZoomTarget(object3D) {
  if (!object3D) return false;

  if (object3D.userData.preventFlatProjection) {
    return object3D.geometry !== undefined;
  }

  return false;
}
