import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {placeNativeMediaAtRect} from '../src/render/reality-assembly.js';

const screen=(point,camera,width,height)=>{const p=point.clone().project(camera);return{x:(p.x+1)*width/2,y:(1-p.y)*height/2};};

test('native media corners match the reading slot on desktop and phone under a turned, scaled owner',()=>{
  for(const [width,height,left,top,slotWidth,slotHeight] of [[1440,1000,356,370,712,400.5],[390,844,38,310,314,176.625]]){
    const camera=new THREE.PerspectiveCamera(55,width/height,.1,500);
    camera.position.set(7,4,19);camera.lookAt(-2,1,-5);camera.updateMatrixWorld();
    const parent=new THREE.Group();parent.position.set(3,-4,2);parent.rotation.set(.45,-1.1,.2);parent.scale.setScalar(1.7);parent.updateMatrixWorld();
    const object=new THREE.Object3D();parent.add(object);
    const rect={left,top,width:slotWidth,height:slotHeight};
    assert.equal(placeNativeMediaAtRect({THREE,object,camera,rect,width,height}),true);
    for(const [x,y,expectedX,expectedY] of [[-slotWidth/2,slotHeight/2,left,top],[slotWidth/2,slotHeight/2,left+slotWidth,top],[-slotWidth/2,-slotHeight/2,left,top+slotHeight],[slotWidth/2,-slotHeight/2,left+slotWidth,top+slotHeight]]){
      const projected=screen(new THREE.Vector3(x,y,0).applyMatrix4(object.matrixWorld),camera,width,height);
      assert.ok(Math.abs(projected.x-expectedX)<1e-6);assert.ok(Math.abs(projected.y-expectedY)<1e-6);
    }
  }
});

test('native media placement honors perspective zoom without changing its parent or identity',()=>{
  const camera=new THREE.PerspectiveCamera(60,1.6,.1,300);camera.zoom=1.8;camera.updateProjectionMatrix();
  const parent=new THREE.Group(),object=new THREE.Object3D();parent.add(object);
  const rect={left:90,top:80,width:480,height:270};
  assert.equal(placeNativeMediaAtRect({THREE,object,camera,rect,width:800,height:500}),true);
  const topLeft=screen(new THREE.Vector3(-240,135,0).applyMatrix4(object.matrixWorld),camera,800,500);
  assert.ok(Math.abs(topLeft.x-90)<1e-6);assert.ok(Math.abs(topLeft.y-80)<1e-6);
  assert.equal(object.parent,parent);assert.equal(parent.children[0],object);
});

test('unrenderable native slots do not mutate a mounted player transform',()=>{
  const camera=new THREE.PerspectiveCamera(60,1,.1,300),object=new THREE.Object3D();object.position.set(1,2,3);
  for(const rect of [{left:0,top:0,width:0,height:100},{left:NaN,top:0,width:200,height:100}]){
    assert.equal(placeNativeMediaAtRect({THREE,object,camera,rect,width:800,height:800}),false);
    assert.deepEqual(object.position.toArray(),[1,2,3]);
  }
});
