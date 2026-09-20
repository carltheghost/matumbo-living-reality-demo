/**
 * tests/hand-presence.test.mjs
 *
 * Multi-instance + shared-geometry disposal behaviour for
 * src/render/hand-presence.js (Reality Lens hand presence).
 *
 * The module imports the bare specifier "three", so this file maps it to
 * the vendored three.module.js via node:module's register() before
 * dynamically importing the module under test (top-level await is fine
 * in node:test files).
 *
 * Scene is stubbed ({add, remove} capturing calls); the camera is a real
 * THREE.PerspectiveCamera so landmark math runs for real.
 *
 * Run with: node --test tests/hand-presence.test.mjs
 */
import { register } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { fileURLToPath } from "node:url";
import path from "node:path";

register(
  pathToFileURL(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "three-resolve-hooks.mjs"),
  ).href,
);

const THREE = await import("three");
const { createHandPresence } = await import("../src/render/hand-presence.js");

// ---------------------------------------------------------------------------
// Stubs & fixtures
// ---------------------------------------------------------------------------

function makeScene() {
  return {
    added: [],
    removed: [],
    add(obj) {
      this.added.push(obj);
    },
    remove(obj) {
      this.removed.push(obj);
    },
  };
}

function makeCamera() {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.01, 100);
  camera.position.set(0, 0, 2);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

function makeLandmarks() {
  const landmarks = [];
  for (let i = 0; i < 21; i++) {
    landmarks.push({ x: 0.3 + i * 0.01, y: 0.5, z: 0 });
  }
  return landmarks;
}

function makeHand(handedness = "Right") {
  return { landmarks: makeLandmarks(), handedness };
}

function jointMeshes(scene) {
  return scene.added.filter((obj) => obj.isMesh);
}

function lineObjects(scene) {
  return scene.added.filter((obj) => obj.isLineSegments);
}

// ---------------------------------------------------------------------------
// Tests (sequential: they share the module-level geometry refcount)
// ---------------------------------------------------------------------------

const camera = makeCamera();
const sceneA = makeScene();
const sceneB = makeScene();
let presenceA = null;
let presenceB = null;

test("two instances render joint meshes into both scenes", () => {
  presenceA = createHandPresence(sceneA, camera);
  presenceB = createHandPresence(sceneB, camera);

  presenceA.update([makeHand("Right")]);
  presenceB.update([makeHand("Left")]);

  const meshesA = jointMeshes(sceneA);
  const meshesB = jointMeshes(sceneB);

  assert.equal(meshesA.length, 21, "instance A must add 21 joint meshes");
  assert.equal(meshesB.length, 21, "instance B must add 21 joint meshes");

  // 21 joints + skeleton lines + pinch connector per hand.
  assert.equal(sceneA.added.length, 23);
  assert.equal(sceneB.added.length, 23);
  assert.equal(lineObjects(sceneA).length, 2);

  assert.ok(meshesA.every((m) => m.visible), "joints render visibly");
});

test("disposing A leaves B updating with valid shared geometries", () => {
  presenceA.dispose();

  assert.doesNotThrow(() => {
    presenceB.update([makeHand("Left")]);
  }, "B must keep updating after A is disposed");

  const meshesB = jointMeshes(sceneB);
  assert.equal(meshesB.length, 21);
  assert.ok(
    meshesB.every((m) => m.visible),
    "B's joints stay visible",
  );
  assert.ok(
    meshesB.every((m) => m.geometry != null),
    "shared joint geometries must survive while B is alive",
  );
  assert.ok(
    meshesB.every((m) => m.geometry.parameters != null),
    "shared geometry payload must still be intact",
  );
});

test("disposing both then creating C works (geometries recreated)", () => {
  presenceB.dispose();

  const sceneC = makeScene();
  let presenceC = null;

  assert.doesNotThrow(() => {
    presenceC = createHandPresence(sceneC, camera);
  }, "a new instance after full release must acquire fresh geometries");

  assert.doesNotThrow(() => {
    presenceC.update([makeHand("Right")]);
  }, "C must render without exceptions");

  const meshesC = jointMeshes(sceneC);
  assert.equal(meshesC.length, 21, "C's scene must receive the joint meshes");
  assert.ok(meshesC.every((m) => m.visible));

  presenceC.dispose();
});

test("setVisible(false) hides joints; update keeps them hidden", () => {
  const scene = makeScene();
  const presence = createHandPresence(scene, camera);

  presence.update([makeHand("Right")]);
  assert.ok(
    jointMeshes(scene).every((m) => m.visible),
    "joints visible while the presence is visible",
  );

  presence.setVisible(false);

  assert.ok(
    jointMeshes(scene).every((m) => m.visible === false),
    "setVisible(false) must hide every joint mesh",
  );
  assert.ok(
    lineObjects(scene).every((l) => l.visible === false),
    "skeleton and pinch lines must hide too",
  );

  // update() returns early while invisible: nothing may reappear.
  presence.update([makeHand("Right")]);

  assert.ok(
    jointMeshes(scene).every((m) => m.visible === false),
    "update must not re-show joints while invisible",
  );

  presence.dispose();
});

test("dispose removes the instance meshes from its scene", () => {
  const scene = makeScene();
  const presence = createHandPresence(scene, camera);

  presence.update([makeHand("Right")]);
  const addedCount = scene.added.length;
  assert.ok(addedCount > 0, "update must add meshes to the scene");

  presence.dispose();

  assert.equal(
    scene.removed.length,
    addedCount,
    "every added object (joints, skeleton, pinch line) must be removed",
  );
  for (const obj of scene.added) {
    assert.ok(
      scene.removed.includes(obj),
      "dispose must remove each instance mesh from its scene",
    );
  }
});
