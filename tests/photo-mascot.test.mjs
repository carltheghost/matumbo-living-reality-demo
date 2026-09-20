/**
 * tests/photo-mascot.test.mjs
 *
 * DOM-free unit tests for src/render/photo-mascot.js (node:test + node:assert).
 * No renderer is created.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../vendor/three-r179.1/build/three.module.js";

import { buildPhotoMascot } from "../src/render/photo-mascot.js";

const EPS = 1e-6;

function approxEqual(actual, expected, message) {
  assert.ok(
    Math.abs(actual - expected) < EPS,
    `${message}: expected ${expected}, got ${actual}`,
  );
}

// Minimal stand-in for THREE.TextureLoader: resolves synchronously, DOM-free.
function makeStubLoader(failSrcs = []) {
  return {
    load(src, onLoad, _onProgress, onError) {
      if (failSrcs.includes(src)) {
        if (typeof onError === "function") onError(new Error(`stub: failed to load ${src}`));
        return null;
      }
      const texture = new THREE.Texture();
      texture.name = String(src);
      if (typeof onLoad === "function") onLoad(texture);
      return texture;
    },
  };
}

function findTiltGroup(mascot) {
  let found = null;
  mascot.group.traverse((object) => {
    if (found === null && object.name === "PhotoMascotTilt") found = object;
  });
  return found;
}

function findMotionGroup(mascot) {
  let found = null;
  mascot.group.traverse((object) => {
    if (found === null && object.name === "PhotoMascotMotion") found = object;
  });
  return found;
}

function findPhotoMesh(mascot) {
  let found = null;
  mascot.group.traverse((object) => {
    if (
      found === null &&
      object.isMesh &&
      object.geometry &&
      object.geometry.type === "PlaneGeometry"
    ) {
      found = object;
    }
  });
  return found;
}

function findBackingMesh(mascot) {
  let found = null;
  mascot.group.traverse((object) => {
    if (
      found === null &&
      object.isMesh &&
      object.geometry &&
      object.geometry.type === "ShapeGeometry"
    ) {
      found = object;
    }
  });
  return found;
}

function findGlowSprite(mascot) {
  let found = null;
  mascot.group.traverse((object) => {
    if (found === null && object.isSprite) found = object;
  });
  return found;
}

describe("photo mascot", () => {
  it("build returns a THREE.Group containing photo, backing, and glow", () => {
    const mascot = buildPhotoMascot({ lookSrc: "a.png", aspect: 16 / 9, loader: makeStubLoader() });
    try {
      assert.ok(mascot.group instanceof THREE.Group);
      const photo = findPhotoMesh(mascot);
      assert.ok(photo, "photo plane mesh exists");
      approxEqual(photo.geometry.parameters.width, 16 / 9, "photo width keeps aspect");
      approxEqual(photo.geometry.parameters.height, 1, "photo height is the unit height");
      assert.strictEqual(photo.material.transparent, true);
      const backing = findBackingMesh(mascot);
      assert.ok(backing, "rounded backing mesh exists");
      assert.strictEqual(backing.material.transparent, true);
      approxEqual(backing.material.opacity, 0.25, "backing opacity");
      approxEqual(backing.material.roughness, 0.15, "backing roughness");
      const glow = findGlowSprite(mascot);
      assert.ok(glow, "glow sprite exists");
      assert.strictEqual(glow.material.blending, THREE.AdditiveBlending);
    } finally {
      mascot.dispose();
    }
  });

  it("defaults the photo aspect ratio to 1", () => {
    const mascot = buildPhotoMascot({ loader: makeStubLoader() });
    try {
      const photo = findPhotoMesh(mascot);
      approxEqual(photo.geometry.parameters.width, photo.geometry.parameters.height, "square photo");
    } finally {
      mascot.dispose();
    }
  });

  it("setTilt applies clamped parallax rotation to the inner tilt group", () => {
    const mascot = buildPhotoMascot({ loader: makeStubLoader() });
    try {
      const tilt = findTiltGroup(mascot);
      assert.ok(tilt, "inner tilt group exists");
      mascot.setTilt(0.5, -0.25);
      approxEqual(tilt.rotation.y, 0.5 * 0.12, "rotation.y from nx");
      approxEqual(tilt.rotation.x, 0.25 * 0.12, "rotation.x from -ny");
      mascot.setTilt(10, -10);
      approxEqual(tilt.rotation.y, 0.12, "rotation.y clamped");
      approxEqual(tilt.rotation.x, 0.12, "rotation.x clamped");
      mascot.setTilt(-3, 3);
      approxEqual(tilt.rotation.y, -0.12, "rotation.y clamped negative");
      approxEqual(tilt.rotation.x, -0.12, "rotation.x clamped negative");
    } finally {
      mascot.dispose();
    }
  });

  it("applyMotion maps sample fields to the motion group, leaving the placement group untouched", () => {
    const mascot = buildPhotoMascot({ loader: makeStubLoader() });
    try {
      const tilt = findTiltGroup(mascot);
      const motion = findMotionGroup(mascot);
      const photo = findPhotoMesh(mascot);
      mascot.applyMotion({ bobY: 0.4, swayX: -0.15, tiltZ: 0.2, scalePulse: 0.1, squash: 0.25 });
      assert.strictEqual(motion.position.y, 0.4);
      assert.strictEqual(motion.position.x, -0.15);
      assert.strictEqual(mascot.group.position.y, 0, "outer group keeps the dragged/persisted position");
      assert.strictEqual(mascot.group.position.x, 0);
      approxEqual(tilt.rotation.z, 0.2, "tiltZ on inner group");
      approxEqual(photo.scale.x, 1.1, "scalePulse on x");
      approxEqual(photo.scale.y, 1.1 * 0.75, "squash dips scale.y");
      assert.strictEqual(photo.scale.z, 1);
      mascot.applyMotion({});
      assert.strictEqual(motion.position.y, 0);
      assert.strictEqual(motion.position.x, 0);
      approxEqual(photo.scale.x, 1, "default scale x");
      approxEqual(photo.scale.y, 1, "default scale y");
    } finally {
      mascot.dispose();
    }
  });

  it("faceCamera yaws the group toward the camera without pitching or rolling", () => {
    const mascot = buildPhotoMascot({ loader: makeStubLoader() });
    try {
      const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
      camera.position.set(2, 5, 2);
      camera.lookAt(0, 0, 0);
      mascot.faceCamera(camera);
      approxEqual(mascot.group.rotation.y, Math.atan2(2, 2), "yaw faces camera");
      assert.strictEqual(mascot.group.rotation.x, 0);
      assert.strictEqual(mascot.group.rotation.z, 0);
      assert.doesNotThrow(() => mascot.faceCamera(null));
    } finally {
      mascot.dispose();
    }
  });

  it("setLook swaps the photo texture and disposes the old one", () => {
    const mascot = buildPhotoMascot({ lookSrc: "a.png", loader: makeStubLoader() });
    try {
      const photo = findPhotoMesh(mascot);
      const first = photo.material.map;
      assert.ok(first instanceof THREE.Texture, "initial texture loaded");
      let disposed = false;
      first.addEventListener("dispose", () => { disposed = true; });
      mascot.setLook("b.png");
      const second = photo.material.map;
      assert.ok(second instanceof THREE.Texture, "swapped texture loaded");
      assert.notStrictEqual(second, first);
      assert.strictEqual(disposed, true, "old texture disposed");
    } finally {
      mascot.dispose();
    }
  });

  it("setLook keeps the previous texture when loading fails", () => {
    const mascot = buildPhotoMascot({ lookSrc: "good.png", loader: makeStubLoader(["bad.png"]) });
    try {
      const photo = findPhotoMesh(mascot);
      const first = photo.material.map;
      assert.ok(first, "initial texture present");
      assert.doesNotThrow(() => mascot.setLook("bad.png"));
      assert.strictEqual(photo.material.map, first, "previous texture kept on failure");
    } finally {
      mascot.dispose();
    }
  });

  it("build with the default loader never crashes when the texture cannot load", () => {
    let mascot = null;
    assert.doesNotThrow(() => {
      mascot = buildPhotoMascot({ lookSrc: "assets/avatar/photo-mascot/tumbo-hoodie.png" });
    });
    assert.ok(mascot.group instanceof THREE.Group);
    mascot.dispose();
  });

  it("dispose() detaches, clears children, and is safe to call twice", () => {
    const parent = new THREE.Group();
    const mascot = buildPhotoMascot({ lookSrc: "a.png", loader: makeStubLoader() });
    parent.add(mascot.group);
    assert.doesNotThrow(() => mascot.dispose());
    assert.strictEqual(parent.children.length, 0, "removed from parent");
    assert.strictEqual(mascot.group.children.length, 0, "children cleared");
    assert.strictEqual(mascot.group.parent, null);
    assert.doesNotThrow(() => mascot.dispose(), "second dispose is safe");
  });
});
