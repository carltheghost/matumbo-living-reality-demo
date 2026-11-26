import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {buildRealityAssemblyScene} from '../src/render/reality-assembly-scene.js';
import {createLivingSurfaceMap,livingSurfaceClipPath} from '../src/domains/living-surface-layout-engine.js';
import {REALITY_TAB_FORMS,WAVE_TAB_PROFILE,waveTabContour} from '../src/domains/reality-tab-layout.js';

test('curved living objects have a flush readable facet backed by their actual volume',()=>{
  for(const shape of ['sphere','cylinder']){
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


test('wave reading skin tracks the real extruded cap contour rather than a flat rectangle',()=>{
  const form=REALITY_TAB_FORMS.wave,face=createLivingSurfaceMap('wave').primary;
  assert.deepEqual(WAVE_TAB_PROFILE,{amplitude:.075,cycles:2,segments:28});
  assert.equal(face.width,form.width);
  assert.equal(face.height,1.288);
  const contour=waveTabContour(form.width,form.height);
  assert.equal(contour.length,58);
  assert.ok(Object.isFrozen(contour)&&contour.every(Object.isFrozen));
  assert.throws(()=>waveTabContour(0,form.height),/positive/);
  // Recover physical coordinates from the *rendered CSS polygon*, then
  // independently compare against the actual Three.js geometry vertices.
  const polygon=livingSurfaceClipPath('wave');
  const pairs=[...polygon.matchAll(/([\d.]+)% ([\d.]+)%/g)].map(([,x,y])=>[(Number(x)/100-.5)*face.width,(.5-Number(y)/100)*face.height]);
  assert.equal(pairs.length,58);
  const parent=new THREE.Scene(),targets=[],feature={id:'agent',assemblyTier:'tab',sources:[]};
  const scene=buildRealityAssemblyScene({THREE,parent,features:[feature],targets});
  try{
    scene.apply({selectedId:'agent',mode:'present',objects:[{id:'agent',position:[0,0,0],shape:'wave',size:1,locked:false,open:true}]});
    const node=scene.nodes.get('agent'),vertices=node.tabMesh.geometry.getAttribute('position');
    assert.equal(node.shape,'wave');
    assert.equal(node.tabMesh.name,'agent/spatial-tab/wave');
    for(const [x,y] of pairs){
      let found=false;
      for(let i=0;i<vertices.count;i++){
        // The unexpanded front cap lies at depth + the visual bevel rim;
        // compare the un-beveled outline, not a bevel-expanded sidewall.
        if(Math.abs(vertices.getX(i)-x)<.00001&&Math.abs(vertices.getY(i)-y)<.00001&&Math.abs(vertices.getZ(i)-(form.depth+.035))<.00001){found=true;break;}
      }
      assert.ok(found,`CSS point ${x},${y} belongs to the actual front cap`);
    }
    const maxY=Math.max(...pairs.map(p=>p[1])),minY=Math.min(...pairs.map(p=>p[1]));
    assert.ok(maxY>form.height/2&&minY<-form.height/2,'crests/troughs extend beyond the nominal rectangle');
  }finally{scene.destroy();}
  assert.equal(parent.children.length,0);
  assert.equal(targets.length,0);
});
