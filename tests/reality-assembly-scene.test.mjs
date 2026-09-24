import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {buildRealityAssemblyScene} from '../src/render/reality-assembly-scene.js';
import {createLivingSurfaceMap} from '../src/domains/living-surface-layout-engine.js';

test('cylindrical living objects have a flush readable facet backed by their actual volume',()=>{
  for(const shape of ['cylinder']){
    const parent=new THREE.Scene(),targets=[],feature={id:'agent',assemblyTier:'tab',sources:[]};
    const scene=buildRealityAssemblyScene({THREE,parent,features:[feature],targets});
    scene.apply({selectedId:'agent',mode:'present',objects:[{id:'agent',position:[0,0,0],shape,size:1,locked:false,open:true}]});
    const node=scene.nodes.get('agent'),face=createLivingSurfaceMap(shape).primary;
    node.tabMesh.geometry.computeBoundingBox();
    const bounds=node.tabMesh.geometry.boundingBox;
    assert.ok(Math.abs(bounds.max.z-(face.position[2]-.018))<.00001,'skin and machined cap share the same seam');
    assert.ok(bounds.min.z<-.5,'rear volume is retained');
    assert.ok(bounds.max.x-bounds.min.x>face.width,'shoulders remain around the reading skin');
    scene.destroy();
  }
});
test('the universal XR view keeps exactly five quiet, inscribed feature meshes in one scene',()=>{
  const ids=['contract-atelier','agent','arena','rooms','youtube'],features=[...ids,'offscreen-feature'].map((id,index)=>({id,assemblyTier:'tab',sources:[],lensGroup:'experiences'}));
  const parent=new THREE.Scene(),scene=buildRealityAssemblyScene({THREE,parent,features,targets:[]});
  scene.setLensMode(true);scene.setActiveGroup('*');scene.setVisibleFeatureIds(ids);
  scene.apply({selectedId:'arena',mode:'present',objects:features.map((feature,index)=>({id:feature.id,position:[index*3,0,-5],shape:'sphere',size:1,locked:false,open:false}))});
  scene.update(1/60,12.5,{reducedMotion:true,cameraDistance:8,cameraPosition:new THREE.Vector3(0,.8,3.9)});
  const state=scene.getSnapshot();
  assert.deepEqual(state.featuredLensIds,ids);
  assert.deepEqual([...state.visibleFeatureIds].sort(),[...ids].sort());
  assert.equal(scene.nodes.get('offscreen-feature').root.visible,false);
  assert.equal(state.connectionsVisible,false);
  assert.equal(state.funnelGuideVisible,false);
  assert.equal(state.visibleGroupCount,0);
  for(const id of ids){
    const node=scene.nodes.get(id);
    assert.equal(node.root.rotation.x,0,id);
    assert.equal(node.root.rotation.y,0,id);
    assert.equal(node.liveContent.visible,false,id);
    assert.equal(node.sourceLayer.visible,false,id);
    assert.equal(node.nestedLayer.visible,false,id);
  }
  scene.destroy();assert.equal(parent.children.length,0);
});
test('the former central feature is an ordinary mutable sphere tab like every other identity',()=>{
  const parent=new THREE.Scene(),targets=[],features=[{id:'block-world',assemblyTier:'tab',sources:['semantic-block-fabric']},{id:'contracts',assemblyTier:'tab',sources:['contracts-markets']}];
  const scene=buildRealityAssemblyScene({THREE,parent,features,targets});scene.layer.visible=true;
  scene.apply({selectedId:'contracts',mode:'present',objects:[{id:'block-world',position:[0,0,0],shape:'sphere',size:1,anchor:false,locked:false,open:false},{id:'contracts',position:[5,1,0],shape:'phone',size:1,locked:false,open:true}]},{viewMode:'4d'});
  scene.update(.1,0,{reducedMotion:true});const formerCenter=scene.nodes.get('block-world'),node=scene.nodes.get('contracts');
  assert.equal(formerCenter.isTab,true);assert.equal(formerCenter.core,undefined);assert.equal(formerCenter.shape,'sphere');
  assert.equal(node.isTab,true);assert.equal(node.shape,'phone');
  assert.equal(node.core,undefined);assert.equal(node.faces,undefined);assert.equal(node.tabMesh.name,'contracts/spatial-tab/phone');
  assert.equal(node.liveContent.visible,true);assert.equal(node.root.position.x,5);
  assert.deepEqual(scene.getSnapshot().nodeIds,features.map(f=>f.id));assert.equal(scene.getSnapshot().formerCenterIsMovableTab,true);assert.equal(scene.getSnapshot().singleFixedAnchorCube,false);assert.equal(scene.getSnapshot().referenceImagesUsedAsTextures,false);
  assert.ok(targets.every(object=>features.some(feature=>feature.id===scene.resolve(object))));
  scene.destroy();assert.equal(parent.children.length,0);assert.equal(targets.length,0);
});

test('the overview shows domain markers and reveals child tabs only in the opened domain',()=>{
  const parent=new THREE.Scene(),targets=[],features=[
    {id:'block-world',assemblyTier:'tab',sources:['semantic-block-fabric']},
    {id:'contracts',lensGroup:'value',sources:['contracts-markets']},
    {id:'ledger',lensGroup:'value',sources:['proof-ledger']},
    {id:'person',lensGroup:'people',sources:['person-profile']},
  ];
  const scene=buildRealityAssemblyScene({THREE,parent,features,targets});
  scene.apply({selectedId:'block-world',mode:'present',objects:features.map((feature,index)=>({id:feature.id,position:[index*5,0,-index*4],shape:index?'rectangle':'sphere',size:1,anchor:false,locked:false,open:false}))});
  scene.setActiveGroup(null);
  scene.update(.1,0,{reducedMotion:true,cameraDistance:80,cameraPosition:new THREE.Vector3(54,38,164)});
  assert.equal(scene.nodes.get('contracts').root.visible,false);
  assert.equal(scene.nodes.get('person').root.visible,false);
  assert.equal(scene.groupParents.get('value').root.visible,true);
  assert.equal(scene.groupParents.get('people').root.visible,true);
  assert.equal(scene.getSnapshot().visibleTabCount,0);
  assert.equal(scene.getSnapshot().visibleGroupCount,3);

  scene.setActiveGroup('value');
  scene.update(.1,.5,{reducedMotion:true,cameraDistance:80,cameraPosition:new THREE.Vector3(54,38,164)});
  assert.equal(scene.nodes.get('contracts').root.visible,true);
  assert.equal(scene.nodes.get('ledger').root.visible,true);
  assert.equal(scene.nodes.get('person').root.visible,false);
  assert.equal(scene.groupParents.get('value').root.visible,false);
  assert.equal(scene.groupParents.get('people').root.visible,true);
  scene.destroy();assert.equal(parent.children.length,0);assert.equal(targets.length,0);
});

test('duplicate feature records render as one real-world tab',()=>{
  const parent=new THREE.Scene(),targets=[],features=[
    {id:'block-world',assemblyTier:'tab',sources:['semantic-block-fabric']},
    {id:'muse-agent',lensGroup:'agents',sources:['muse-agent']},
    {id:'muse-agent',lensGroup:'agents',sources:['duplicate-muse-agent-copy']},
  ];
  const scene=buildRealityAssemblyScene({THREE,parent,features,targets});
  assert.equal(scene.nodes.size,2);
  assert.equal([...scene.layer.children].filter(child=>child.name==='muse-agent').length,1);
  assert.equal(scene.groupParents.get('agents').members.length,1);
  assert.equal(scene.getSnapshot().tabCount,2);
  scene.destroy();assert.equal(parent.children.length,0);assert.equal(targets.length,0);
});

test('focus fades context during approach then clears it for the selected working surface',()=>{
  const parent=new THREE.Scene(),targets=[],features=[
    {id:'block-world',assemblyTier:'tab',sources:['semantic-block-fabric']},
    {id:'agent',lensGroup:'agents',sources:['muse-agent','bot-plaza']},
    {id:'muse-agent',lensGroup:'agents',sources:['muse-agent']},
    {id:'neural-mesh',lensGroup:'agents',sources:['skynet-neural-mesh']},
    {id:'contracts',lensGroup:'value',sources:['contracts-markets']},
  ];
  const scene=buildRealityAssemblyScene({THREE,parent,features,targets});
  scene.apply({selectedId:'muse-agent',mode:'present',objects:features.map((feature,index)=>({id:feature.id,position:[index*5,0,-index*4],shape:'rectangle',size:1,anchor:false,locked:false,open:false}))});
  scene.setActiveGroup('*');scene.focus('muse-agent');
  const arrivingPosition=scene.nodes.get('muse-agent').position.clone().add(new THREE.Vector3(0,0,14));
  scene.update(.1,0,{reducedMotion:true,cameraDistance:14,cameraPosition:arrivingPosition});
  const arriving=scene.getSnapshot();
  assert.equal(arriving.focusIsolated,false);
  assert.equal(arriving.visibleFeatureIds.length,features.length);
  assert.equal(scene.nodes.get('agent').root.visible,true);
  assert.equal(scene.nodes.get('neural-mesh').root.visible,true);
  assert.equal(scene.nodes.get('contracts').root.visible,true);
  assert.ok(scene.nodes.get('contracts').contextOpacity<1);
  const intimatePosition=scene.nodes.get('muse-agent').position.clone().add(new THREE.Vector3(0,0,7));
  scene.update(.1,.5,{reducedMotion:true,cameraDistance:7,cameraPosition:intimatePosition});
  const snapshot=scene.getSnapshot();
  assert.equal(snapshot.focusIsolated,true);
  assert.deepEqual(snapshot.visibleFeatureIds,['muse-agent']);
  assert.equal(scene.nodes.get('agent').root.visible,false);
  assert.equal(scene.nodes.get('neural-mesh').root.visible,false);
  assert.equal(scene.nodes.get('contracts').root.visible,false);
  assert.equal(scene.nodes.get('muse-agent').liveContent.visible,false);
  assert.equal(scene.nodes.get('muse-agent').sourceLayer.visible,false);
  assert.equal(snapshot.visibleGroupCount,0);
  assert.equal(snapshot.funnelGuideVisible,false);
  scene.destroy();assert.equal(parent.children.length,0);assert.equal(targets.length,0);
});
