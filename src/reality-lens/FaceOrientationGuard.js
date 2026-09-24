import * as THREE from "three";

export function applyObjectTabMaterial(material) {
  if (!material) return material;

  material.side = THREE.FrontSide;
  material.transparent = true;
  material.depthWrite = true;
  material.depthTest = true;

  if (material.map) {
    material.map.flipY = false;
    material.map.needsUpdate = true;
  }

  return material;
}

export function applyCubeFaceMaterials(mesh) {
  if (!mesh || !mesh.material) return;

  if (Array.isArray(mesh.material)) {
    mesh.material.forEach((material) =>
      applyObjectTabMaterial(material)
    );
  } else {
    applyObjectTabMaterial(mesh.material);
  }

  mesh.renderOrder = 0;
}
