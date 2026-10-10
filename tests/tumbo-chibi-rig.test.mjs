import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {
  CHIBI_RIG_MODES, createTumboGeometryCache, createTumboMaterialSet,
  buildTumboChibiRig, updateTumboChibiRig,
} from '../src/render/tumbo-chibi-rig.js';

function fixture(t) {
  const geometries = createTumboGeometryCache(THREE);
  const materials = createTumboMaterialSet(THREE);
  const rig = buildTumboChibiRig(THREE, geometries, materials, { seed: 0.3 });
  t.after(() => { materials.dispose(); geometries.dispose(); });
  return rig;
}

function pose(rig) {
  return Object.fromEntries(Object.entries(rig.joints).map(([name, joint]) => [name, {
    quaternion: joint.quaternion.toArray(), scale: joint.scale.toArray(),
  }]));
}

test('legacy optional rig imports and builds without DOM or missing gesture exports', t => {
  const rig = fixture(t);
  assert.ok(rig.group.isObject3D);
  assert.equal(rig.hasFaceDecal, false);
  assert.equal(rig.hasChestText, false);
  const frame = updateTumboChibiRig(THREE, rig, { time: 1.25 });
  assert.ok(Object.values(frame).every(Number.isFinite));
});

test('every optional gesture samples finite transforms and returns to idle', t => {
  const rig = fixture(t);
  const idle = updateTumboChibiRig(THREE, rig, { time: 1.25 });
  const idlePose = pose(rig);
  for (const [mode, duration] of Object.entries(CHIBI_RIG_MODES)) {
    const moving = updateTumboChibiRig(THREE, rig, { time: 1.25, mode, modeT: duration / 2 });
    assert.ok(Object.values(moving).every(Number.isFinite), mode);
    assert.ok(Object.values(pose(rig)).every(joint =>
      [...joint.quaternion, ...joint.scale].every(Number.isFinite)), mode);
    if (duration > 0) {
      const landed = updateTumboChibiRig(THREE, rig, { time: 1.25, mode, modeT: duration + 10 });
      assert.deepEqual(pose(rig), idlePose, `${mode} leaves no residual joint rotation`);
      assert.equal(landed.lift, 0);
      assert.equal(landed.bobY, idle.bobY);
      // One full revolution faces the same direction after a completed spin.
      assert.ok(Math.abs(Math.sin(landed.turn)) < 1e-12);
    }
  }
});

test('repeated gesture frames reset joints instead of accumulating rotation', t => {
  const rig = fixture(t);
  const options = { time: 1.25, mode: 'wave', modeT: CHIBI_RIG_MODES.wave / 3 };
  const first = updateTumboChibiRig(THREE, rig, options);
  const firstPose = pose(rig);
  for (let i = 0; i < 10; i++) updateTumboChibiRig(THREE, rig, options);
  assert.deepEqual(pose(rig), firstPose);
  assert.deepEqual(updateTumboChibiRig(THREE, rig, options), first);
});

test('reduced motion restores rest after animated gestures and freezes eye openness', t => {
  const rig = fixture(t);
  updateTumboChibiRig(THREE, rig, { time: 1, mode: 'bow', modeT: 0.8 });
  for (const mode of Object.keys(CHIBI_RIG_MODES)) {
    const frame = updateTumboChibiRig(THREE, rig, { time: 2, mode, modeT: 0.3, reducedMotion: true });
    assert.deepEqual(frame, { bobY: 0, swayY: 0, glow: 0.46, lift: 0, turn: 0 });
    for (const [name, joint] of Object.entries(rig.joints)) {
      assert.ok(joint.quaternion.angleTo(rig.rest[name]) < 1e-7);
    }
    assert.deepEqual(rig.joints.spine.scale.toArray(), [1, 1, 1]);
    assert.ok(rig.blinkBalls.every(eye => eye.scale.y === eye.userData.baseScaleY));
  }
});

test('invalid frame times reject before a valid rig is changed', t => {
  const rig = fixture(t);
  const before = pose(rig);
  assert.throws(() => updateTumboChibiRig(THREE, rig, { time: NaN }), /finite time/);
  assert.throws(() => updateTumboChibiRig(THREE, rig, { time: 1, modeT: Infinity }), /finite modeT/);
  assert.deepEqual(pose(rig), before);
  const safe = updateTumboChibiRig(THREE, rig, { time: 1, seed: 'invalid' });
  assert.ok(Object.values(safe).every(Number.isFinite));
});

test('two explicit rigs retain shared geometry while gestures preserve mesh identity', t => {
  const geometries = createTumboGeometryCache(THREE);
  const materials = createTumboMaterialSet(THREE);
  t.after(() => { materials.dispose(); geometries.dispose(); });
  const first = buildTumboChibiRig(THREE, geometries, materials);
  const count = geometries.size();
  const second = buildTumboChibiRig(THREE, geometries, materials);
  assert.equal(geometries.size(), count);
  const meshes = [];
  first.group.traverse(object => { if (object.isMesh) meshes.push([object, object.geometry]); });
  for (const mode of Object.keys(CHIBI_RIG_MODES)) {
    updateTumboChibiRig(THREE, first, { time: 2, mode, modeT: 0.4 });
    assert.ok(meshes.every(([mesh, geometry]) => mesh.geometry === geometry));
  }
  assert.notEqual(first.group, second.group);
});
