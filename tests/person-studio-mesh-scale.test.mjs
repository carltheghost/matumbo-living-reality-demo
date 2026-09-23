import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {buildPersonStudioScene} from '../src/render/person-studio-scene.js';

// Regression: two wardrobe-display calls once passed the owner THREE.Group as
// the `scale` argument of the local mesh() helper, so m.scale.set(...group)
// threw "Spread syntax requires ...iterable[Symbol.iterator] to be a function"
// and killed the whole 3-D boot before WebGL setup.
test('wardrobe displays build: no owner group is ever spread as a scale',()=>{
  const scene=new THREE.Scene(),targets=[];
  const studio=buildPersonStudioScene({THREE,parent:scene,targets,compact:true});
  let cylinders=0,toruses=0;
  studio.layer.traverse(o=>{
    if(!o.isMesh)return;
    for(const k of ['position','scale'])for(const a of ['x','y','z'])
      assert.ok(Number.isFinite(o[k][a]),`mesh ${k}.${a} must be finite`);
    if(o.geometry?.type==='CylinderGeometry')cylinders++;
    if(o.geometry?.type==='TorusGeometry')toruses++;
  });
  assert.ok(cylinders>0,'hanger-rod cylinder exists');
  assert.ok(toruses>0,'collar torus exists');
  studio.destroy();
  assert.equal(scene.children.length,0,'destroy removes the layer');
});
