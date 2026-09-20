import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {buildRealityAssemblyScene,featureTraits,LOD_FAR} from '../src/render/reality-assembly-scene.js';

const FEATURES=[
  {id:'block-world',sources:['semantic-block-fabric','block-a']},
  {id:'contracts',sources:['contracts-markets']},
  {id:'person',sources:['person-studio']},
];
function snapshot(objects){return {selectedId:'contracts',mode:'present',objects};}
function objects(openMap={}){return FEATURES.map((f,i)=>({id:f.id,position:[i*6,1,0],open:!!openMap[f.id]}));}
function build(){const parent=new THREE.Scene(),targets=[];const scene=buildRealityAssemblyScene({THREE,parent,features:FEATURES,targets});scene.layer.visible=true;return {parent,targets,scene};}

test('far zoom merges the world into one giant block; approach reveals the cubes',()=>{
  const {scene,parent}=build();
  scene.apply(snapshot(objects()),{viewMode:'3d'});
  // The constellation stays distinct through the whole normal zoom-out range;
  // only EXTREME far zoom (beyond LOD_FAR) merges into the single world cube.
  scene.update(.1,0,{reducedMotion:true,cameraDistance:200});
  assert.equal(scene.getSnapshot().lod,'world-block');
  assert.equal(scene.worldBlock.visible,true);
  assert.ok(scene.worldBlock.getObjectByName('world-block/core'));
  for(const [,node] of scene.nodes)assert.equal(node.root.visible,false);
  scene.update(.1,0,{reducedMotion:true,cameraDistance:12});
  assert.equal(scene.getSnapshot().lod,'features');
  for(const [,node] of scene.nodes)assert.equal(node.root.visible,true);
  assert.equal(scene.worldBlock.visible,false);
  scene.destroy();assert.equal(parent.children.length,0);
});

test('merge threshold is 160: constellation intact at mid zoom, merge only beyond',()=>{
  assert.equal(LOD_FAR,160);
  const {scene}=build();
  scene.apply(snapshot(objects()),{viewMode:'3d'});
  for(const distance of [60,100,120,150,160]){
    scene.update(.1,0,{reducedMotion:true,cameraDistance:distance});
    assert.equal(scene.getSnapshot().lod,'features',`distance ${distance}`);
    for(const [,node] of scene.nodes)assert.equal(node.root.visible,true,`distance ${distance}`);
  }
  scene.update(.1,0,{reducedMotion:true,cameraDistance:161});
  assert.equal(scene.getSnapshot().lod,'world-block');
  scene.destroy();
});

test('merged far-zoom cube is clean: inner detail gone, pulse kept',()=>{
  const {scene}=build();
  scene.apply(snapshot(objects()),{viewMode:'3d'});
  scene.update(.1,0,{reducedMotion:true,cameraDistance:200});
  assert.equal(scene.getSnapshot().lod,'world-block');
  const cells=[];
  scene.worldBlock.traverse((object)=>{
    if(object.name.startsWith('world-block/cell-'))cells.push(object);
  });
  assert.equal(cells.length,8);
  for(const cell of cells){
    assert.equal(cell.visible,false,`cell ${cell.name}`);
    assert.equal(cell.material.opacity,0,`cell ${cell.name} material`);
  }
  const core=scene.worldBlock.getObjectByName('world-block/core');
  assert.ok(core);
  assert.equal(core.visible,true);
  // The clean cube still pulses: emissiveIntensity varies with time.
  scene.update(.1,0,{reducedMotion:true,cameraDistance:200});
  const dim=core.material.emissiveIntensity;
  scene.update(.1,Math.PI/1.6,{reducedMotion:true,cameraDistance:200});
  const bright=core.material.emissiveIntensity;
  assert.ok(Math.abs(bright-dim)>.1,`dim=${dim} bright=${bright}`);
  scene.destroy();
});

test('per-cube traits are deterministic and unique per id',()=>{
  const a=featureTraits('contracts'),b=featureTraits('contracts'),c=featureTraits('person');
  assert.deepEqual(a,b);
  assert.notDeepEqual(a,c);
  const {scene}=build();
  assert.deepEqual(scene.nodes.get('contracts').traits,a);
  assert.deepEqual(scene.nodes.get('person').traits,featureTraits('person'));
  scene.destroy();
});

test('approaching a cube springs it open; nested cubes open in turn',()=>{
  const {scene}=build();
  scene.apply(snapshot(objects()),{viewMode:'3d'});
  const node=scene.nodes.get('contracts');
  // Far from the cube: closed.
  scene.update(.1,0,{reducedMotion:true,cameraDistance:12,cameraPosition:new THREE.Vector3(60,1,0)});
  assert.ok(node.open<.2);
  // Approach the cube: it springs open without any button press.
  scene.update(.1,0,{reducedMotion:true,cameraDistance:12,cameraPosition:new THREE.Vector3(6,1,0)});
  assert.ok(node.open>.5,node.open);
  assert.equal(node.inner.visible,true);
  assert.ok(node.faces[0].pivot.position.x<-1.5);
  // Nested cells spring open in turn and reveal sub-cubes.
  const cell=node.nested[0];
  assert.ok(cell.open>.5,cell.open);
  assert.ok(cell.subs.every(sub=>sub.visible));
  scene.destroy();
});

test('explicit open still works and every feature cube is glass-volumetric',()=>{
  const {scene}=build();
  scene.apply(snapshot(objects({person:true})),{viewMode:'3d'});
  scene.update(.1,0,{reducedMotion:true,cameraDistance:12});
  const node=scene.nodes.get('person');
  assert.ok(node.open>.9);
  assert.equal(node.faces.length,6);
  assert.equal(node.core.geometry.parameters.width,node.core.geometry.parameters.height);
  // Glass language: transparent panels with low roughness.
  const panelMat=node.faces[0].pivot.children[0].material;
  assert.equal(panelMat.transparent,true);
  assert.ok(panelMat.opacity<.7);
  scene.destroy();
});
