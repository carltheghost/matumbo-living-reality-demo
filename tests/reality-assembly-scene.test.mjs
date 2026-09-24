import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {buildRealityAssemblyScene} from '../src/render/reality-assembly-scene.js';
import {REALITY_TAB_FORMS} from '../src/domains/reality-tab-layout.js';
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

test('a large focused form fits the perspective view at arrival and through a fast camera transition',()=>{
  const parent=new THREE.Scene(),features=['sphere','cylinder','phone','cube'].map(shape=>({id:shape,assemblyTier:'tab',sources:[]}));
  const scene=buildRealityAssemblyScene({THREE,parent,features});
  scene.apply({selectedId:'cylinder',mode:'present',objects:features.map((feature,index)=>({id:feature.id,position:[index*40,0,0],shape:feature.id,size:24,locked:false,open:false}))});
  scene.setActiveGroup('*');
  const viewportWidth=420,viewportHeight=700,fov=60,occupancy=.55;
  const checkForm=(node,distance)=>{
    const form=REALITY_TAB_FORMS[node.shape],scale=node.root.scale.x;
    const front=distance-form.depth*scale/2;
    const halfTangent=Math.tan(fov*Math.PI/360);
    assert.ok(front>0);
    assert.ok(form.width*scale/(2*front*halfTangent*viewportWidth/viewportHeight)<=occupancy+1e-9,`${node.shape} width fits`);
    assert.ok(form.height*scale/(2*front*halfTangent)<=occupancy+1e-9,`${node.shape} height fits`);
    assert.equal(node.root.scale.x,node.root.scale.y);
    assert.equal(node.root.scale.x,node.root.scale.z);
    assert.equal(node.size,24);
  };
  for(const feature of features){
    const node=scene.nodes.get(feature.id);
    scene.focus(feature.id,{distance:45});
    scene.update(.1,0,{reducedMotion:true,cameraPosition:node.position.clone().add(new THREE.Vector3(0,0,45)),cameraDistance:45,viewportWidth,viewportHeight,fov,occupancy});
    checkForm(node,45);
    assert.equal(scene.getSnapshot().focusIsolated,true,`${node.shape} reaches readable focus at its planned distance`);
    // The camera can move faster than scale interpolation on a later frame.
    scene.update(.016,.016,{cameraPosition:node.position.clone().add(new THREE.Vector3(0,0,7)),cameraDistance:7,viewportWidth,viewportHeight,fov,occupancy});
    checkForm(node,7);
  }
  scene.destroy();assert.equal(parent.children.length,0);
});
