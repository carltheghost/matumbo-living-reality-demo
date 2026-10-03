import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {buildRealityAssemblyScene} from '../src/render/reality-assembly-scene.js';
import {createLivingSurfaceMap} from '../src/domains/living-surface-layout-engine.js';

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
  assert.equal(snapshot.gridVisible,false,'a hidden guide cannot still write depth across entry text');
  scene.destroy();assert.equal(parent.children.length,0);assert.equal(targets.length,0);
});

const SPACE_FEATURES=[
  {id:'block-world',label:'Block World',lensGroup:'worlds',assemblyTier:'tab',sources:['semantic-block-fabric']},
  {id:'person',label:'Person',lensGroup:'people',sources:[]},
  {id:'gateway',label:'Gateway',lensGroup:'network',sources:[]},
  {id:'contracts',label:'Contracts',lensGroup:'value',sources:['contracts-markets']},
  {id:'ledger',label:'Ledger',lensGroup:'value',sources:['proof-ledger']},
  {id:'agent',label:'Agent',lensGroup:'agents',sources:[]},
  {id:'chess',label:'Chess',lensGroup:'experiences',sources:[]},
];
function spaceScene(){
  const parent=new THREE.Scene(),targets=[];
  const scene=buildRealityAssemblyScene({THREE,parent,features:SPACE_FEATURES,targets,relationships:{contracts:['ledger','person']}});
  const objects=SPACE_FEATURES.map((feature,index)=>({id:feature.id,position:[index*7,2,index===0?0:-index*3],shape:'rectangle',size:1,open:false}));
  scene.apply({selectedId:'contracts',mode:'present',objects});
  return {scene,parent,targets,objects};
}

test('calm home exposes six real selectable space bodies while clearing feature clutter',()=>{
  const {scene,parent,targets}=spaceScene();
  scene.setSpaceView(null);
  scene.update(.1,0,{reducedMotion:true,cameraDistance:240});
  const snapshot=scene.getSnapshot();
  assert.equal(snapshot.calmMode,true);
  assert.equal(snapshot.spaceView,'home');
  assert.equal(snapshot.visibleTabCount,0);
  assert.deepEqual(snapshot.visibleFeatureIds,[]);
  assert.deepEqual(snapshot.visibleGroupIds,['worlds','people','network','value','agents','experiences']);
  assert.equal(snapshot.funnelGuideVisible,false);
  assert.equal(snapshot.gridVisible,false);
  assert.equal(snapshot.connectionsVisible,false);
  assert.equal(scene.groupTargets.length,6);
  assert.ok(targets.every(target=>scene.resolve(target)), 'space targets preserve the feature-only identity API');
  for(const entry of scene.groupTargets){
    const groupId=scene.resolveGroup(entry),marker=scene.groupParents.get(groupId);
    assert.ok(entry.isMesh&&entry.geometry.type==='ExtrudeGeometry','the entry itself is a beveled volumetric body');
    assert.equal(marker.root.visible,true);
    assert.equal(marker.core.visible,false);
    assert.equal(marker.ring.visible,false);
    assert.equal(marker.innerRing.visible,false);
    assert.equal(scene.resolve(entry),null,'a space entry does not pretend to be a feature');
    assert.equal(entry.material[0].isMeshBasicMaterial,true,'the actual front stays legible without scene lighting');
    assert.equal(entry.material[1].isMeshPhysicalMaterial,true,'the body shoulders carry actual lit depth');
    assert.equal(entry.material[1].transparent,false);
    assert.equal(entry.userData.spaceSilhouette,groupId);
  }
  scene.destroy();assert.equal(scene.groupTargets.length,0);assert.equal(targets.length,0);assert.equal(parent.children.length,0);
});

test('opening a calm space isolates its objects and keeps saved layout coordinates intact',()=>{
  const {scene,objects}=spaceScene();
  scene.setSpaceView('value');
  scene.update(.1,0,{reducedMotion:true,cameraDistance:50,cameraPosition:new THREE.Vector3(0,1,50)});
  const snapshot=scene.getSnapshot();
  assert.deepEqual(snapshot.visibleFeatureIds,['contracts','ledger']);
  assert.equal(snapshot.visibleGroupCount,0);
  assert.equal(snapshot.connectionsVisible,false,'even authored relation lines stay quiet while choosing a world');
  assert.equal(snapshot.funnelGuideVisible,false);
  assert.deepEqual(scene.getSpaceBounds('value').ids,['contracts','ledger']);
  assert.notDeepEqual(scene.getObjectPosition('contracts').toArray(),objects.find(object=>object.id==='contracts').position);
  for(const object of objects)assert.deepEqual(scene.nodes.get(object.id).position.toArray(),object.position,'presentation does not mutate saved or historical positions');
  for(const id of ['contracts','ledger']){
    const node=scene.nodes.get(id);
    assert.equal(node.sourceLayer.visible,false);
    assert.equal(node.nestedLayer.visible,false);
    assert.equal(node.indicator.visible,false);
    assert.ok(Math.abs(node.root.scale.x-2.2)<.001);
  }
  scene.setSpaceView('*');
  scene.update(.1,0,{reducedMotion:true,cameraDistance:60});
  assert.equal(scene.getSnapshot().calmMode,false);
  assert.equal(scene.getSnapshot().visibleFeatureIds.length,objects.length);
  for(const object of objects)assert.deepEqual(scene.nodes.get(object.id).root.position.toArray(),object.position);
  scene.destroy();
});

test('space bounds include entire entry bodies and phone reflow uses two columns',()=>{
  const {scene}=spaceScene();
  scene.setSpaceView(null);scene.setSpaceViewport({width:1280,height:800});
  const desktop=scene.getSpaceBounds(null),desktopColumns=new Set(scene.groupTargets.map(entry=>scene.getGroupPosition(scene.resolveGroup(entry)).x));
  assert.equal(desktopColumns.size,3);
  scene.setSpaceViewport({width:390,height:844});
  const phone=scene.getSpaceBounds(null),phoneColumns=new Set(scene.groupTargets.map(entry=>scene.getGroupPosition(scene.resolveGroup(entry)).x));
  assert.equal(phoneColumns.size,2);
  assert.ok(phone.width<desktop.width);
  assert.ok(phone.height>desktop.height);
  for(const marker of scene.groupParents.values()){
    const position=scene.getGroupPosition(marker.id);
    assert.ok(position.x-2.8>=phone.center[0]-phone.width/2-.001);
    assert.ok(position.x+2.8<=phone.center[0]+phone.width/2+.001);
    assert.ok(position.y-1.95>=phone.center[1]-phone.height/2-.001);
    assert.ok(position.y+1.95<=phone.center[1]+phone.height/2+.001);
  }
  assert.throws(()=>scene.setSpaceViewport({width:0,height:800}),/positive finite/);
  assert.throws(()=>scene.setSpaceView('unknown-space'),/Unknown Reality Lens domain/);
  scene.destroy();
});

test('focused space camera distances use the compact body position and preserve isolation',()=>{
  const {scene}=spaceScene();
  scene.setSpaceView('value');scene.focus('contracts');
  const cameraPosition=scene.getObjectPosition('contracts').clone().add(new THREE.Vector3(0,0,6));
  scene.update(.1,0,{reducedMotion:true,cameraDistance:80,cameraPosition});
  assert.equal(scene.getSnapshot().focusDistance,6);
  assert.equal(scene.getSnapshot().focusIsolated,true);
  assert.deepEqual(scene.getSnapshot().visibleFeatureIds,['contracts']);
  scene.setSpaceView(null);scene.update(.1,0,{reducedMotion:true,cameraDistance:40});
  assert.equal(scene.getSnapshot().focusedId,null);
  assert.equal(scene.getSnapshot().visibleGroupCount,6);
  scene.destroy();
});

test('busy spaces paginate six desktop or four phone bodies and remember each space page',()=>{
  const features=Array.from({length:13},(_,index)=>({id:`experience-${index}`,label:`Experience ${index}`,lensGroup:'experiences',assemblyTier:'tab',sources:[]}));
  features.push({id:'agent',label:'Agent',lensGroup:'agents',sources:[]});
  const parent=new THREE.Scene(),targets=[],scene=buildRealityAssemblyScene({THREE,parent,features,targets});
  const objects=features.map((feature,index)=>({id:feature.id,position:[index*4,2,index===0?0:-index],shape:'rectangle',size:1,open:false}));
  scene.apply({selectedId:features[0].id,mode:'present',objects});scene.setSpaceView('experiences');
  const update=()=>scene.update(.1,0,{reducedMotion:true,cameraDistance:35});
  update();
  assert.deepEqual(scene.getSpacePage(),{page:0,pageCount:3,pageSize:6,total:13,ids:features.slice(0,6).map(feature=>feature.id)});
  assert.equal(scene.getSnapshot().visibleTabCount,6);
  scene.setSpacePage(1);update();
  assert.deepEqual(scene.getSnapshot().visibleFeatureIds,features.slice(6,12).map(feature=>feature.id));
  assert.deepEqual(scene.getSpaceBounds('experiences').ids,features.slice(6,12).map(feature=>feature.id));
  scene.setSpaceView('agents');update();assert.equal(scene.getSnapshot().visibleTabCount,1);
  scene.setSpaceView('experiences');update();assert.equal(scene.getSpacePage().page,1,'returning to a space preserves its page');
  scene.setSpacePage(2);update();assert.deepEqual(scene.getSnapshot().visibleFeatureIds,['experience-12']);
  scene.setSpacePage(999);assert.equal(scene.getSpacePage().page,2);
  scene.setSpacePage(-2);assert.equal(scene.getSpacePage().page,0);
  assert.throws(()=>scene.setSpacePage(Infinity),/finite number/);
  scene.setSpaceViewport({width:390,height:844});update();
  assert.equal(scene.getSpacePage().pageSize,4);assert.equal(scene.getSpacePage().pageCount,4);assert.equal(scene.getSnapshot().visibleTabCount,4);
  scene.setSpacePage(1);update();assert.deepEqual(scene.getSnapshot().visibleFeatureIds,features.slice(4,8).map(feature=>feature.id));
  scene.focus('experience-12');
  assert.equal(scene.getSpacePage().page,3,'direct selection exposes the page containing that feature');
  const cameraPosition=scene.getObjectPosition('experience-12').clone().add(new THREE.Vector3(0,0,6));
  scene.update(.1,0,{reducedMotion:true,cameraDistance:35,cameraPosition});
  assert.equal(scene.getSnapshot().focusIsolated,true);assert.deepEqual(scene.getSnapshot().visibleFeatureIds,['experience-12']);
  scene.setSpaceViewport({width:1440,height:1000});assert.equal(scene.getSpacePage().page,2,'focused identity survives responsive page-size changes');
  scene.setSpaceView('*');update();assert.equal(scene.getSnapshot().visibleTabCount,features.length);
  for(const object of objects)assert.deepEqual(scene.nodes.get(object.id).position.toArray(),object.position);
  scene.destroy();assert.equal(targets.length,0);assert.equal(parent.children.length,0);
});

test('body previews use readable English and omit diagnostic IDs while curved bodies get a flush native cap',()=>{
  const previousDocument=globalThis.document,text=[],draws=[];
  const context={beginPath(){},roundRect(){},clip(){},ellipse(){},moveTo(){},lineTo(){},closePath(){},fill(){},fillRect(){},createLinearGradient(){return {addColorStop(){}};},measureText(value){return {width:String(value).length*18};},fillText(value){text.push(String(value));draws.push({value:String(value),font:this.font});}};
  globalThis.document={createElement(){return {width:0,height:0,getContext(){return context;}};}};
  try{
    const parent=new THREE.Scene(),targets=[],scene=buildRealityAssemblyScene({THREE,parent,features:[{id:'agent',label:'My assistant',description:'Help with useful tasks. More detail stays inside.',sources:['INTERNAL-SOURCE-REFERENCE']}],targets});
    scene.apply({selectedId:'agent',mode:'present',objects:[{id:'agent',position:[0,0,0],shape:'sphere',size:1,open:false}]});
    scene.setSpaceView('agents');scene.update(.1,0,{reducedMotion:true,cameraDistance:30});
    const node=scene.nodes.get('agent'),cap=node.formParts.find(part=>part.name==='agent/native-reading-cap'),face=createLivingSurfaceMap('sphere').primary;
    assert.ok(cap&&cap.geometry.type==='ShapeGeometry');
    assert.ok(Math.abs(cap.position.z-(face.position[2]-.018))<.0002,'cap closes the existing machined body seam');
    assert.equal(cap.material,node.artMaterial);
    assert.equal(cap.material.isMeshBasicMaterial,true);
    assert.equal(cap.material.side,THREE.FrontSide,'rear cap typography cannot ghost through the reading front');
    assert.equal(cap.material.depthWrite,true,'the information front occludes rear shell geometry');
    assert.ok(cap.material.map.isCanvasTexture);
    assert.equal(node.root.userData.objectTabOwner,'agent');
    assert.equal(node.surfaceBinding.bodyId,'agent');
    assert.deepEqual(cap.position.toArray(),node.surfaceBinding.informationFace.position);
    const capPositions=cap.geometry.getAttribute('position');
    for(let index=0;index<capPositions.count;index++)assert.ok((capPositions.getX(index)/(face.width/2))**2+(capPositions.getY(index)/(face.height/2))**2<=1.001,'the sphere cap follows its circular physical section within contour rounding');
    assert.ok(text.some(value=>value.includes('My assistant')));
    assert.ok(text.includes('Help with useful tasks.'));
    assert.ok(text.some(value=>value.includes('Open world')));
    assert.ok(text.some(value=>value==='Agents'));
    assert.ok(!text.some(value=>/INTERNAL-SOURCE-REFERENCE|SUPERFICIES|FONTES|CLICCA/.test(value)));
    assert.ok(targets.every(target=>scene.resolve(target)==='agent'));
    for(const shape of ['rectangle','phone','wave']){
      scene.apply({selectedId:'agent',mode:'present',objects:[{id:'agent',position:[0,0,0],shape,size:1,open:false}]});
      const uv=node.tabMesh.geometry.getAttribute('uv');let minU=1,maxU=0,minV=1,maxV=0;
      for(const capGroup of node.tabMesh.geometry.groups.filter(group=>group.materialIndex===0))for(let index=capGroup.start;index<capGroup.start+capGroup.count;index++){minU=Math.min(minU,uv.getX(index));maxU=Math.max(maxU,uv.getX(index));minV=Math.min(minV,uv.getY(index));maxV=Math.max(maxV,uv.getY(index));}
      assert.ok(minU>=-.0001&&maxU<=1.0001&&minV>=-.0001&&maxV<=1.0001,`${shape} artwork covers its own cap instead of clamping world-coordinate UVs`);
      assert.ok(maxU-minU>.99&&maxV-minV>.99,`${shape} uses the complete texture`);
    }
    for(const shape of ['rectangle','phone','wave','square','cube','sphere','cylinder']){
      scene.apply({selectedId:'agent',mode:'present',objects:[{id:'agent',position:[0,0,0],shape,size:1,open:false}]});
      const binding=node.surfaceBinding;
      assert.equal(binding.entityId,binding.bodyId);
      assert.equal(binding.shape,shape);
      assert.deepEqual(node.surfaceOutline,binding.contour,'geometry and hit testing share one native contour');
      const nativeCap=node.formParts.find(part=>part.name==='agent/native-reading-cap');
      const nativeGeometry=nativeCap?.geometry??node.tabMesh.geometry;nativeGeometry.computeBoundingBox();
      const physicalZ=nativeCap?nativeCap.position.z:nativeGeometry.boundingBox.max.z;
      assert.ok(Math.abs(physicalZ-binding.informationFace.position[2])<.0002,`${shape} real front and interaction anchor occupy the same physical seam`);
      const image=node.artTexture.image;
      assert.ok(Math.abs(image.width/image.height-binding.informationFace.width/binding.informationFace.height)<.002,`${shape} front typography preserves its physical aspect`);
      if(nativeCap){
        const positions=nativeCap.geometry.getAttribute('position');
        for(let index=0;index<positions.count;index++)assert.ok(binding.contour.some(([x,y])=>Math.abs(x-positions.getX(index))<.0001&&Math.abs(y-positions.getY(index))<.0001),'the curved cap closes the same contour used by its interactive skin');
      }
    }
    scene.apply({selectedId:'agent',mode:'present',objects:[{id:'agent',position:[0,0,0],shape:'wave',size:1,open:false}]});
    draws.length=0;scene.setSpaceViewport({width:390,height:844});
    assert.ok(draws.some(draw=>draw.value==='My assistant'&&draw.font.includes('84px')),'phone gallery titles use readable larger artwork type');
    assert.ok(!draws.some(draw=>draw.value==='Help with useful tasks.'),'small previews reserve their surface for title and action');
    assert.ok(!scene.groupParents.get('agents').entry.children.some(child=>child.isMesh),'entry typography belongs to its cap without a second decorative plaque');
    scene.destroy();assert.equal(parent.children.length,0);assert.equal(targets.length,0);
  }finally{globalThis.document=previousDocument;}
});

test('six entry architectures have distinct physical silhouettes and bounded native fronts',()=>{
  const {scene}=spaceScene();scene.setSpaceView(null);scene.setSpaceViewport({width:1440,height:1000});
  scene.update(.1,0,{reducedMotion:true,cameraDistance:50});scene.layer.updateMatrixWorld(true);
  const signatures=new Set(),bounds=scene.getSpaceBounds(null);
  for(const marker of scene.groupParents.values()){
    const entry=marker.entry,positions=entry.geometry.getAttribute('position');
    signatures.add([...positions.array].map(value=>Math.round(value*1000)).join(','));
    entry.geometry.computeBoundingBox();
    assert.ok(entry.geometry.boundingBox.max.z-entry.geometry.boundingBox.min.z>1.2,'the entry is a solid with visible shoulder depth');
    assert.equal(entry.material[0],marker.entryFace,'the information is the body cap material');
    assert.equal(marker.entryFace.side,THREE.FrontSide);
    assert.equal(marker.entryFace.depthWrite,true);
    const physicalBounds=new THREE.Box3().setFromObject(entry);
    assert.ok(physicalBounds.min.x>=bounds.center[0]-bounds.width/2-.001);
    assert.ok(physicalBounds.max.x<=bounds.center[0]+bounds.width/2+.001);
    assert.ok(physicalBounds.min.y>=bounds.center[1]-bounds.height/2-.001);
    assert.ok(physicalBounds.max.y<=bounds.center[1]+bounds.height/2+.001);
    assert.ok(physicalBounds.min.z>=bounds.center[2]-bounds.depth/2-.001);
    assert.ok(physicalBounds.max.z<=bounds.center[2]+bounds.depth/2+.001);
  }
  assert.equal(signatures.size,6,'space identity changes actual geometry, not just labels');
  scene.destroy();
});
