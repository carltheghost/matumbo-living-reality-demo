import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {buildRealityAssemblyScene,createRealityLensBackdrop,featureTraits,LOD_FAR} from '../src/render/reality-assembly-scene.js';
import {REALITY_TAB_FORM_IDS} from '../src/domains/reality-tab-layout.js';

const FEATURES=[
  {id:'block-world',assemblyTier:'tab',sources:['semantic-block-fabric','block-a']},
  {id:'contracts',assemblyTier:'tab',sources:['contracts-markets']},
  {id:'person',assemblyTier:'tab',sources:['person-studio']},
];
function snapshot(objects){return {selectedId:'contracts',mode:'present',objects};}
function objects(openMap={}){return FEATURES.map((f,i)=>({id:f.id,position:[i*6,1,0],shape:f.id==='block-world'?'sphere':i===1?'rectangle':'phone',size:1,anchor:false,locked:false,open:!!openMap[f.id]}));}
function build(relationships={contracts:['person'],person:['contracts']}){const parent=new THREE.Scene(),targets=[];const scene=buildRealityAssemblyScene({THREE,parent,features:FEATURES,targets,relationships});scene.layer.visible=true;return {parent,targets,scene};}

test('Reality Lens has a generated deep-space backdrop rather than a black void',()=>{
  const texture=createRealityLensBackdrop(THREE,96,48),pixels=texture.image.data;
  assert.equal(texture.isDataTexture,true);
  assert.equal(texture.image.width,96);assert.equal(texture.image.height,48);
  assert.equal(pixels[3],255);
  let blueTotal=0,redTotal=0;
  for(let i=0;i<pixels.length;i+=4){redTotal+=pixels[i];blueTotal+=pixels[i+2];}
  assert.ok(blueTotal>redTotal*2,'the generated night sky should carry blue depth color');
  texture.dispose();
});

test('far zoom leaves only the small gold centre tab; approaching unfolds the spatial field',()=>{
  const {scene,parent}=build();
  scene.apply(snapshot(objects()),{viewMode:'3d'});
  scene.update(.1,0,{reducedMotion:true,cameraDistance:200});
  assert.equal(scene.getSnapshot().lod,'nucleus');
  assert.equal(scene.getSnapshot().singleFixedAnchorCube,false);
  assert.equal(scene.getSnapshot().equalAxisCubes,false);
  assert.equal(scene.worldBlock.visible,false);
  assert.equal(scene.worldBlock.children.length,0);
  const centerTab=scene.nodes.get('block-world');
  assert.equal(centerTab.root.visible,true);assert.equal(centerTab.isTab,true);assert.equal(centerTab.core,undefined);assert.equal(centerTab.shape,'sphere');
  assert.equal(centerTab.shellMaterial.color.getHexString(),'a8874c');
  for(const [id,node] of scene.nodes)if(node.isTab&&id!=='block-world')assert.equal(node.root.visible,false,id);
  scene.update(.1,0,{reducedMotion:true,cameraDistance:110});
  assert.equal(scene.getSnapshot().lod,'unfolding');
  assert.ok(scene.getSnapshot().visibleTabCount>0);
  scene.update(.1,0,{reducedMotion:true,cameraDistance:64});
  assert.equal(scene.getSnapshot().lod,'field');
  for(const [,node] of scene.nodes)assert.equal(node.root.visible,true);
  assert.equal(scene.worldBlock.visible,false);
  scene.destroy();assert.equal(parent.children.length,0);
});

test('lens unfolding begins at 160 and completes at 64 without enlarging distant tabs',()=>{
  assert.equal(LOD_FAR,160);
  const {scene}=build();
  scene.apply(snapshot(objects()),{viewMode:'3d'});
  for(const distance of [200,180,160]){
    scene.update(.1,0,{reducedMotion:true,cameraDistance:distance});
    assert.equal(scene.getSnapshot().lod,'nucleus',`distance ${distance}`);
    for(const [id,node] of scene.nodes)if(node.isTab&&id!=='block-world')assert.equal(node.root.visible,false,`distance ${distance}: ${id}`);
  }
  const tab=scene.nodes.get('contracts');
  for(const distance of [110,90]){
    scene.update(.1,0,{reducedMotion:true,cameraDistance:distance});
    assert.ok(Math.abs(tab.root.scale.x/tab.tabReveal-tab.scale*tab.size)<.001,`distance ${distance}`);
  }
  scene.destroy();
});

test('the far zoom has no substitute giant cube or hidden interior payload',()=>{
  const {scene}=build();
  scene.apply(snapshot(objects()),{viewMode:'3d'});
  scene.update(.1,0,{reducedMotion:true,cameraDistance:200});
  assert.equal(scene.getSnapshot().lod,'nucleus');
  assert.equal(scene.worldBlock.children.length,0);
  assert.equal(scene.worldBlock.visible,false);
  scene.destroy();
});

test('per-feature traits are deterministic and unique per id',()=>{
  const a=featureTraits('contracts'),b=featureTraits('contracts'),c=featureTraits('person');
  assert.deepEqual(a,b);
  assert.notDeepEqual(a,c);
  const {scene}=build();
  assert.deepEqual(scene.nodes.get('contracts').traits,a);
  assert.deepEqual(scene.nodes.get('person').traits,featureTraits('person'));
  scene.destroy();
});

test('approaching a spatial tab reveals its local live objects',()=>{
  const {scene}=build();
  scene.apply(snapshot(objects()),{viewMode:'3d'});
  const node=scene.nodes.get('contracts');
  // Far from the cube: closed.
  scene.update(.1,0,{reducedMotion:true,cameraDistance:12,cameraPosition:new THREE.Vector3(60,1,0)});
  assert.ok(node.open<.2);
  // Approach the tab: its local content appears without any provider call.
  scene.update(.1,0,{reducedMotion:true,cameraDistance:12,cameraPosition:new THREE.Vector3(6,1,0)});
  assert.ok(node.open>.5,node.open);
  assert.equal(node.liveContent.visible,true);
  assert.equal(node.sourceLayer.visible,true);
  assert.equal(node.nestedLayer.visible,true);
  assert.equal(node.sourceObjects.length,1);
  assert.equal(node.nestedObjects.length,1);
  scene.destroy();
});

test('every feature including the former centre is a movable tab with local contents',()=>{
  const {scene}=build();
  scene.apply(snapshot(objects({person:true})),{viewMode:'3d'});
  scene.update(.1,0,{reducedMotion:true,cameraDistance:12});
  const node=scene.nodes.get('person');
  assert.ok(node.open>.9);
  assert.equal(node.isTab,true);
  assert.ok(['phone','square','rectangle','sphere','cylinder','cube','wave'].includes(node.shape));
  assert.equal(node.liveContent.visible,true);
  const formerCenter=scene.nodes.get('block-world');
  assert.equal(formerCenter.isTab,true);assert.equal(formerCenter.shape,'sphere');assert.equal(formerCenter.core,undefined);
  scene.destroy();
});

test('selected close-up views drop long relation lines and keep attention on local contents',()=>{
  const {scene}=build();scene.apply(snapshot(objects()),{viewMode:'3d'});
  scene.update(.1,0,{reducedMotion:true,cameraDistance:10,cameraPosition:new THREE.Vector3(0,2,10)});
  assert.equal(scene.getSnapshot().connectionsVisible,false);
  scene.update(.1,0,{reducedMotion:true,cameraDistance:55,cameraPosition:new THREE.Vector3(0,2,55)});
  assert.equal(scene.getSnapshot().connectionsVisible,true,'relationship hints remain available in the wider field');
  scene.destroy();
});

test('relationship lines come only from authored feature links, never proximity',()=>{
  const {scene}=build({contracts:['person','block-world','unknown-world'],person:['contracts']});
  scene.apply(snapshot(objects()),{viewMode:'3d'});
  scene.update(.1,0,{reducedMotion:true,cameraDistance:55,cameraPosition:new THREE.Vector3(0,2,55)});
  assert.deepEqual(scene.getSnapshot().connectionPairs,[['contracts','person'],['block-world','contracts']]);
  assert.equal(scene.getSnapshot().relationshipSource,'authored feature navigation graph');
  assert.equal(scene.getSnapshot().connectionsVisible,true);
  scene.update(.1,0,{reducedMotion:true,cameraDistance:10,cameraPosition:new THREE.Vector3(0,2,10)});
  assert.equal(scene.getSnapshot().connectionsVisible,false);
  scene.destroy();
});

test('lens mode preserves real depth occlusion and hides distant tabs',()=>{
  const {scene}=build();scene.setLensMode(true);scene.apply(snapshot(objects()),{viewMode:'3d'});
  scene.update(.1,0,{reducedMotion:true,cameraDistance:240,cameraPosition:new THREE.Vector3(0,2,240)});
  assert.equal(scene.getSnapshot().lensMode,true);assert.equal(scene.getSnapshot().lod,'nucleus');
  assert.equal(scene.worldBlock.visible,false);
  assert.ok(scene.getSnapshot().connectionPairs.every(pair=>!pair.includes('block-world')));
  for(const [id,node] of scene.nodes){if(node.isTab){assert.equal(node.root.visible,id==='block-world',id);for(const part of node.formParts){const material=Array.isArray(part.material)?part.material[0]:part.material;if(material?.depthTest!==undefined)assert.equal(material.depthTest,true,id);}}}
  scene.destroy();
});

test('selecting a tab keeps approach layers readable, then clears ornament for the intimate live surface',()=>{
  const {scene}=build();scene.apply(snapshot(objects()),{viewMode:'3d'});scene.focus('contracts');
  const focused=scene.nodes.get('contracts'),context=scene.nodes.get('person');
  scene.update(.1,0,{reducedMotion:true,cameraDistance:14,cameraPosition:new THREE.Vector3(6,1,14)});
  assert.equal(focused.revealStage,1,'automatic approach starts the first layer');
  assert.equal(focused.liveContent.visible,true,'the first layer contains the live feature signal');
  assert.equal(focused.sourceLayer.visible,false,'source structure waits for a deeper approach');
  assert.ok(focused.root.scale.x>1,'focus grows modestly instead of scaling with reversed distance');
  assert.ok(context.contextOpacity<1&&context.contextOpacity>.05,'unrelated features begin fading during approach');
  scene.update(.1,1,{reducedMotion:true,cameraDistance:6,cameraPosition:new THREE.Vector3(6,1,6)});
  assert.equal(scene.getSnapshot().focusIsolated,true);
  assert.equal(focused.revealStage,2,'the selected object continues to unfold by depth');
  assert.equal(focused.liveContent.visible,false,'the mounted live panel owns the close-up instead of decorative duplicate layers');
  assert.equal(focused.sourceLayer.visible,false);
  assert.equal(focused.nestedLayer.visible,false);
  assert.equal(context.root.visible,false,'unrelated tabs clear away at intimate focus');
  scene.destroy();
});

test('each supported tab form rebuilds the same selectable feature object',()=>{
  const {scene,targets}=build();
  for(const shape of REALITY_TAB_FORM_IDS){
    scene.apply({selectedId:'contracts',mode:'present',objects:[
      {id:'block-world',position:[0,1,0],shape:'sphere',size:1,anchor:false,locked:false,open:false},
      {id:'contracts',position:[6,1,0],shape,size:1.25,locked:false,open:false},
      {id:'person',position:[12,1,0],shape:'square',size:1,locked:false,open:false},
    ]},{viewMode:'3d'});
    scene.update(.1,0,{reducedMotion:true,cameraDistance:12});
    const tab=scene.nodes.get('contracts');
    assert.equal(tab.shape,shape);assert.equal(tab.tabMesh.name,`contracts/spatial-tab/${shape}`);
    assert.ok(Math.abs(tab.root.scale.x-1.25)<.001,`${shape} keeps its configured size`);
    if(shape==='cylinder')assert.equal(tab.tabMesh.material,tab.shellMaterial,`${shape} keeps its flush readable facet`);
    if(shape==='sphere')assert.equal(tab.artSurface,tab.tabMesh,'sphere inscriptions wrap the object instead of using a plaque');
    assert.equal(tab.core,undefined);assert.equal(tab.faces,undefined);
    assert.ok(targets.every(object=>scene.resolve(object)),`${shape} ray targets keep their feature ids`);
  }
  scene.destroy();
});
