import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {buildRealityAssemblyScene} from '../src/render/reality-assembly-scene.js';
test('assembly uses real equal-axis geometry, opens distinct faces and retains existing feature references',()=>{
  const parent=new THREE.Scene(),targets=[],features=[{id:'block-world',sources:['semantic-block-fabric']},{id:'contracts',sources:['contracts-markets']}];
  const scene=buildRealityAssemblyScene({THREE,parent,features,targets});scene.layer.visible=true;
  scene.apply({selectedId:'contracts',mode:'present',objects:[{id:'block-world',position:[0,0,0],open:false},{id:'contracts',position:[5,1,0],open:true}]},{viewMode:'4d'});
  scene.update(.1,0,{reducedMotion:true});const node=scene.nodes.get('contracts');
  assert.equal(node.core.geometry.parameters.width,node.core.geometry.parameters.height);assert.equal(node.faces.length,6);
  assert.ok(node.faces[0].pivot.position.x<-1.5);assert.equal(node.inner.visible,true);assert.equal(node.root.position.x,5);
  assert.deepEqual(scene.getSnapshot().nodeIds,features.map(f=>f.id));assert.equal(scene.getSnapshot().referenceImagesUsedAsTextures,false);
  assert.ok(targets.every(object=>features.some(feature=>feature.id===scene.resolve(object))));
  scene.destroy();assert.equal(parent.children.length,0);assert.equal(targets.length,0);
});
