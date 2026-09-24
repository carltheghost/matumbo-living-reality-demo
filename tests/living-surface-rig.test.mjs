import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {createLivingSurfaceMap} from '../src/domains/living-surface-layout-engine.js';
import {REALITY_TAB_FORMS} from '../src/domains/reality-tab-layout.js';
import {turnLivingSurfaceTowardCamera} from '../src/render/reality-assembly.js';

test('reading remains attached and front-facing at every camera angle without moving the entity',()=>{
  for(const shape of Object.keys(REALITY_TAB_FORMS))for(const camera of [[0,0,9],[9,3,0],[-8,2,-8],[0,9,.01]]){
    const rig=new THREE.Group(),skin=new THREE.Group(),face=createLivingSurfaceMap(shape).primary;
    rig.position.set(2,1,-3);rig.scale.setScalar(2.6);skin.position.set(...face.position);rig.add(skin);
    const position=rig.position.clone(),localSkin=skin.position.clone(),eye=new THREE.Vector3(...camera).add(position);
    turnLivingSurfaceTowardCamera(rig,eye);
    const toward=eye.clone().sub(skin.getWorldPosition(new THREE.Vector3())).normalize();
    const normal=new THREE.Vector3(0,0,1).applyQuaternion(skin.getWorldQuaternion(new THREE.Quaternion()));
    assert.ok(normal.dot(toward)>.99999,`${shape} is readable at ${camera}`);
    assert.deepEqual(rig.position,position,'reading never edits canonical entity position');
    assert.deepEqual(skin.position,localSkin,'skin never detaches or billboards independently');
    assert.equal(skin.parent,rig);
  }
});

test('reading rejects invalid projection input',()=>{
  assert.throws(()=>turnLivingSurfaceTowardCamera(new THREE.Group(),new THREE.Vector3(NaN,0,1)),/finite/);
});
