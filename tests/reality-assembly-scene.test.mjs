import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {buildRealityAssemblyScene} from '../src/render/reality-assembly-scene.js';
import {REALITY_TAB_FORMS} from '../src/domains/reality-tab-layout.js';
import {surfaceLayout,focusDistance} from '../src/domains/living-surface-layout-engine.js';
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

test('Bot Plaza retains its cylinder skin without CSS3D and yields it to an attached live wrapper',()=>{
  for(const size of [1,24]){
    const parent=new THREE.Scene();
    const scene=buildRealityAssemblyScene({THREE,parent,features:[{id:'bot-plaza',assemblyTier:'tab',sources:['bot-plaza']}]});
    scene.apply({selectedId:'bot-plaza',mode:'present',objects:[{id:'bot-plaza',position:[0,0,0],shape:'cylinder',size,locked:false,open:true}]});
    scene.setActiveGroup('*');
    const node=scene.nodes.get('bot-plaza'),distance=size===1?7.4:45;
    const updateAt=range=>scene.update(.1,0,{reducedMotion:true,cameraDistance:range,cameraPosition:new THREE.Vector3(0,0,range),viewportWidth:420,viewportHeight:700});
    const shellBase=node.shellMaterial.userData.realityLensBaseOpacity;
    const edgeBase=node.edgeMaterial.userData.realityLensBaseOpacity;
    scene.focus('bot-plaza',{distance});
    updateAt(distance);
    assert.equal(node.shellMaterial.opacity,shellBase,`size ${size}: original shell remains without CSS3D`);
    assert.equal(node.edgeMaterial.opacity,edgeBase,`size ${size}: original edge remains without CSS3D`);
    node.livingSurfaceAttached=true;
    updateAt(distance*3.5);
    assert.equal(node.shellMaterial.opacity,shellBase,`size ${size}: original remains during distant approach`);
    scene.update(.016,.016,{cameraDistance:distance,cameraPosition:new THREE.Vector3(0,0,distance),viewportWidth:420,viewportHeight:700});
    assert.ok(node.shellMaterial.opacity>shellBase*.05&&node.shellMaterial.opacity<shellBase,`size ${size}: wrapper handoff eases during approach`);
    updateAt(distance);
    assert.ok(node.shellMaterial.opacity<shellBase*.05,`size ${size}: attached wrapper takes over the shell`);
    assert.ok(node.edgeMaterial.opacity<edgeBase*.05,`size ${size}: attached wrapper takes over the edge`);
    scene.focus(null);
    updateAt(80);
    assert.equal(node.shellMaterial.opacity,shellBase,`size ${size}: overview restores the original form`);
    scene.focus('bot-plaza',{distance});
    updateAt(distance);
    node.livingSurfaceAttached=false;
    updateAt(distance);
    assert.equal(node.shellMaterial.opacity,shellBase,`size ${size}: renderer loss restores the shell immediately`);
    assert.equal(node.edgeMaterial.opacity,edgeBase,`size ${size}: renderer loss restores the edge immediately`);
    assert.equal(node.shape,'cylinder');
    assert.equal(node.size,size);
    scene.destroy();
    assert.equal(parent.children.length,0);
  }
});

test('custom surface profiles shape the physical shell, embedded details, and focus bounds',()=>{
  const card={body:{width:2,height:1.5,depth:.2},contour:'rounded-rectangle',coverage:.88,frontDepth:.24};
  const orb={body:{width:1.8,height:1.8,depth:1.8},contour:'circle'};
  const column={body:{width:1.8,height:2.2,depth:1.8},contour:'cylinder'};
  const definitions=[['custom-card',card],['custom-orb',orb],['custom-column',column]];
  const parent=new THREE.Scene(),features=definitions.map(([id,surfaceProfile])=>({id,assemblyTier:'tab',sources:['example'],surfaceProfile}));
  const scene=buildRealityAssemblyScene({THREE,parent,features});
  const objects=definitions.map(([id],index)=>({id,position:[index*10,0,0],shape:'square',size:1,locked:false,open:false}));
  scene.apply({selectedId:'custom-card',mode:'present',objects});
  scene.setActiveGroup('*');
  scene.update(.1,0,{reducedMotion:true,cameraPosition:new THREE.Vector3(0,0,80),cameraDistance:80});
  const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<.09,`physical ${actual} follows profile ${expected}`);
  for(const [id,profile] of definitions){
    const node=scene.nodes.get(id),wrapper=surfaceLayout({id,shape:'square',profile}).wrapper;
    const bounds=new THREE.Box3().setFromObject(node.tabMesh).getSize(new THREE.Vector3());
    close(bounds.x,wrapper.width);close(bounds.y,wrapper.height);close(bounds.z,wrapper.depth);
    assert.equal(node.surfaceLayout.wrapper.contour,wrapper.contour);
    assert.equal(node.tabMesh.geometry.type,profile.contour==='circle'?'SphereGeometry':profile.contour==='cylinder'?'CylinderGeometry':'ExtrudeGeometry');
  }
  const node=scene.nodes.get('custom-card'),wrapper=node.surfaceLayout.wrapper;
  close(node.sourceObjects[0].position.x,-wrapper.width*.25);
  close(node.sourceObjects[0].position.y,-wrapper.height*.06);
  close(node.sourceObjects[0].position.z,wrapper.frontDepth+.028);
  const viewportWidth=390,viewportHeight=844,occupancy=.55,fov=60;
  const enlarged=objects.map(object=>object.id==='custom-card'?{...object,size:24}:object);
  scene.apply({selectedId:'custom-card',mode:'present',objects:enlarged});
  const planned=focusDistance({shape:'square',profile:card,size:24,approachScale:2.6,viewportWidth,viewportHeight,occupancy,fov});
  scene.focus('custom-card',{distance:planned.distance});
  scene.update(.1,.5,{reducedMotion:true,cameraPosition:new THREE.Vector3(0,0,planned.distance),cameraDistance:planned.distance,viewportWidth,viewportHeight,occupancy,fov});
  const scale=node.root.scale.x,nearest=planned.distance-wrapper.frontDepth*scale;
  const halfTangent=Math.tan(fov*Math.PI/360);
  assert.ok(wrapper.width*scale/(2*nearest*halfTangent*viewportWidth/viewportHeight)<=occupancy+1e-6);
  assert.ok(wrapper.height*scale/(2*nearest*halfTangent)<=occupancy+1e-6);
  assert.equal(node.size,24);
  scene.destroy();assert.equal(parent.children.length,0);
});

test('a registered future shape yields to a built-in form and returns without stale geometry',()=>{
  const profile={body:{width:2.4,height:1.3,depth:.35},contour:'polygon',
    outline:[[-.5,0],[-.25,.5],[.25,.5],[.5,0],[.25,-.5],[-.25,-.5]],coverage:.88,frontDepth:.39};
  const scene=buildRealityAssemblyScene({THREE,parent:new THREE.Scene(),features:[{
    id:'future-archive',assemblyTier:'tab',initialTabShape:'archive-hex',initialSurfaceShape:'archive-hex',surfaceProfile:profile,
  }]});
  const apply=shape=>scene.apply({selectedId:'future-archive',mode:'present',objects:[{
    id:'future-archive',position:[0,0,0],shape,size:1,locked:false,open:false,
  }]});
  try{
    apply('archive-hex');
    let node=scene.nodes.get('future-archive');
    assert.equal(node.shape,'archive-hex');
    assert.equal(node.surfaceLayout.wrapper.width,2.4);
    assert.equal(node.surfaceLayout.wrapper.contour,'polygon');
    apply('phone');
    node=scene.nodes.get('future-archive');
    assert.equal(node.shape,'phone');
    assert.equal(node.surfaceLayout.wrapper.width,REALITY_TAB_FORMS.phone.width);
    assert.equal(node.surfaceLayout.wrapper.contour,'rounded-rectangle');
    apply('archive-hex');
    assert.equal(node.surfaceLayout.wrapper.width,2.4);
    assert.equal(node.surfaceLayout.wrapper.contour,'polygon');
  }finally{scene.destroy();}
});
