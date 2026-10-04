import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three-r179.1/build/three.module.js';
import {buildRealityAssemblyScene} from '../src/render/reality-assembly-scene.js';
import {REALITY_TAB_FORMS,REALITY_TAB_FORM_IDS} from '../src/domains/reality-tab-layout.js';

test('curved scene bodies retain their whole geometry and independently mapped exterior charts',()=>{
  for(const shape of ['sphere','cylinder']){
    const parent=new THREE.Scene(),targets=[],feature={id:'agent',assemblyTier:'tab',sources:[]};
    const scene=buildRealityAssemblyScene({THREE,parent,features:[feature],targets});
    scene.apply({selectedId:'agent',mode:'present',objects:[{id:'agent',position:[0,0,0],shape,size:1,locked:false,open:true}]});
    const node=scene.nodes.get('agent'),form=REALITY_TAB_FORMS[shape];
    node.tabMesh.geometry.computeBoundingBox();
    const bounds=node.tabMesh.geometry.boundingBox;
    assert.ok(Math.abs(bounds.max.z-form.depth/2)<.00001,'front geometry is not clamped to a flat reading facet');
    assert.ok(Math.abs(bounds.min.z+form.depth/2)<.00001,'full rear geometry is retained');
    assert.equal(node.surfaceCharts.length,6);
    assert.equal(node.tabMesh.geometry.groups.length,6);
    assert.ok(!node.formParts.some(part=>part.name.includes('reading-cap')),'no separate cap substitutes for the curved surface');
    const positions=node.tabMesh.geometry.getAttribute('position');
    if(shape==='sphere')for(let i=0;i<positions.count;i++)assert.ok(Math.abs(Math.hypot(positions.getX(i),positions.getY(i),positions.getZ(i))-form.width/2)<.00001);
    assert.equal(node.tabMesh.parent,node.root);
    assert.ok(targets.includes(node.tabMesh));
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
    assert.ok(entry.isMesh&&entry.geometry.isBufferGeometry,'the entry itself is the whole mapped volumetric body');
    assert.equal(marker.root.visible,true);
    assert.equal(marker.core.visible,false);
    assert.equal(marker.ring.visible,false);
    assert.equal(marker.innerRing.visible,false);
    assert.equal(scene.resolve(entry),null,'a space entry does not pretend to be a feature');
    assert.equal(entry.material[0].isMeshBasicMaterial,true,'the actual front stays legible without scene lighting');
    assert.equal(entry.material.length,entry.geometry.groups.length,'every native chart has its own information material');
    assert.equal(entry.material[1].isMeshBasicMaterial,true,'curved sides remain readable independently of scene lighting');
    assert.equal(entry.material[1].transparent,false);
    assert.equal(entry.userData.spaceSilhouette,{worlds:'cube',people:'sphere',network:'octahedron',value:'cylinder',agents:'torus',experiences:'triangular-prism'}[groupId]);
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
  scene.update(.1,0,{reducedMotion:true,cameraDistance:50});scene.layer.updateMatrixWorld(true);
  for(const marker of scene.groupParents.values()){
    const physicalBounds=new THREE.Box3().setFromObject(marker.entry);
    assert.ok(physicalBounds.min.x>=phone.center[0]-phone.width/2-.001);
    assert.ok(physicalBounds.max.x<=phone.center[0]+phone.width/2+.001);
    assert.ok(physicalBounds.min.y>=phone.center[1]-phone.height/2-.001);
    assert.ok(physicalBounds.max.y<=phone.center[1]+phone.height/2+.001);
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

test('body previews preserve readable copy while every complete shape owns mapped selectable charts',()=>{
  const previousDocument=globalThis.document,text=[],draws=[];
  const context={getImageData(x,y,width,height){return {data:new Uint8ClampedArray(width*height*4)};},putImageData(){},beginPath(){},roundRect(){},clip(){},ellipse(){},moveTo(){},lineTo(){},closePath(){},fill(){},fillRect(){},createLinearGradient(){return {addColorStop(){}};},measureText(value){return {width:String(value).length*18};},fillText(value){text.push(String(value));draws.push({value:String(value),font:this.font});}};
  globalThis.document={createElement(){return {width:0,height:0,getContext(){return context;}};}};
  try{
    const parent=new THREE.Scene(),targets=[],scene=buildRealityAssemblyScene({THREE,parent,features:[{id:'agent',label:'My assistant',description:'Help with useful tasks. More detail stays inside.',sources:['INTERNAL-SOURCE-REFERENCE']}],targets});
    scene.apply({selectedId:'agent',mode:'present',objects:[{id:'agent',position:[0,0,0],shape:'sphere',size:1,open:false}]});
    scene.setSpaceView('agents');scene.update(.1,0,{reducedMotion:true,cameraDistance:30});
    const node=scene.nodes.get('agent');
    assert.equal(node.root.userData.objectTabOwner,'agent');
    assert.ok(text.some(value=>value.includes('My assistant')));
    assert.ok(text.includes('Help with useful tasks.'));
    assert.ok(text.some(value=>value.includes('Open world')));
    assert.ok(text.some(value=>value==='Agents'));
    assert.ok(!text.some(value=>/INTERNAL-SOURCE-REFERENCE|SUPERFICIES|FONTES|CLICCA/.test(value)));
    for(const shape of REALITY_TAB_FORM_IDS){
      const oldBody=node.tabMesh;
      scene.apply({selectedId:'agent',mode:'present',objects:[{id:'agent',position:[0,0,0],shape,size:1,open:false}]});
      scene.update(.1,0,{reducedMotion:true,cameraDistance:30});scene.layer.updateMatrixWorld(true);
      const geometry=node.tabMesh.geometry,uv=geometry.getAttribute('uv');
      assert.equal(geometry.userData.realityShape,shape);
      assert.equal(node.tabMesh.parent,node.root);
      assert.equal(node.root.userData.objectTabOwner,'agent');
      assert.ok(targets.includes(node.tabMesh));
      if(oldBody!==node.tabMesh)assert.ok(!targets.includes(oldBody),'replaced bodies cannot remain phantom hit targets');
      assert.ok(targets.every(target=>scene.resolve(target)==='agent'));
      assert.equal(node.surfaceCharts.length,geometry.groups.length);
      assert.equal(node.tabMesh.material.length,node.surfaceCharts.length);
      for(const group of geometry.groups){
        const material=node.tabMesh.material[group.materialIndex];
        assert.ok(material.map?.isCanvasTexture,`${shape} chart carries the body preview`);
        assert.equal(material.map,node.artTexture,'preview text belongs directly to each mapped body chart');
        assert.equal(material.side,THREE.FrontSide,'hidden back faces cannot project reversed typography through the body');
        for(let i=group.start;i<group.start+group.count;i++)assert.ok(uv.getX(i)>=-.0001&&uv.getX(i)<=1.0001&&uv.getY(i)>=-.0001&&uv.getY(i)<=1.0001);
      }
      assert.ok(!node.formParts.some(part=>part.name.includes('reading-cap')));
      const form=REALITY_TAB_FORMS[shape],x=shape==='torus'?form.width/2-form.depth/2:0;
      const origin=node.tabMesh.localToWorld(new THREE.Vector3(x,0,4));
      const direction=new THREE.Vector3(0,0,-1).applyQuaternion(node.tabMesh.getWorldQuaternion(new THREE.Quaternion()));
      const hits=new THREE.Raycaster(origin,direction).intersectObject(node.tabMesh,false);
      assert.ok(hits.length,`${shape} native body is raycastable`);
      assert.equal(scene.resolve(hits[0].object),'agent');
      assert.ok(node.surfaceCharts[hits[0].face.materialIndex],`${shape} actual hit resolves a chart`);
      if(shape==='torus')assert.equal(new THREE.Raycaster(node.tabMesh.localToWorld(new THREE.Vector3(0,0,4)),direction).intersectObject(node.tabMesh,false).length,0,'the torus hole remains empty in the mounted scene');
    }
    scene.apply({selectedId:'agent',mode:'present',objects:[{id:'agent',position:[0,0,0],shape:'wave',size:1,open:false}]});
    draws.length=0;scene.setSpaceViewport({width:390,height:844});
    assert.ok(draws.some(draw=>draw.value==='My assistant'&&draw.font.includes('84px')),'phone gallery titles retain readable larger typography');
    assert.ok(!draws.some(draw=>draw.value==='Help with useful tasks.'),'small previews reserve their surface for title and action');
    assert.ok(!scene.groupParents.get('agents').entry.children.some(child=>child.isMesh),'entry typography belongs to its own body');
    scene.destroy();assert.equal(parent.children.length,0);assert.equal(targets.length,0);
  }finally{globalThis.document=previousDocument;}
});

test('an active 360 surface preserves deliberate object orientation as the scene updates',()=>{
  const parent=new THREE.Scene(),targets=[],scene=buildRealityAssemblyScene({THREE,parent,features:[{id:'agent',assemblyTier:'tab'}],targets});
  for(const shape of ['cube','sphere','cylinder','triangular-prism','torus']){
    scene.apply({selectedId:'agent',mode:'present',objects:[{id:'agent',position:[0,0,0],shape,size:1,open:true}]});
    const node=scene.nodes.get('agent');node.surface360=true;node.root.rotation.set(.27,.64,-.13);
    const rotation=node.root.quaternion.clone();
    scene.update(.1,13,{reducedMotion:false,cameraDistance:6,cameraPosition:new THREE.Vector3(2,3,6)});
    assert.ok(node.root.quaternion.angleTo(rotation)<1e-7,`${shape} is not forced back toward the camera`);
  }
  scene.destroy();assert.equal(targets.length,0);
});

test('six home spaces expose six complete volumetric families with mapped sides and accurate bounds',()=>{
  const {scene}=spaceScene();scene.setSpaceView(null);scene.setSpaceViewport({width:1440,height:1000});
  scene.update(.1,0,{reducedMotion:true,cameraDistance:50});scene.layer.updateMatrixWorld(true);
  const signatures=new Set(),bounds=scene.getSpaceBounds(null);
  for(const marker of scene.groupParents.values()){
    const entry=marker.entry,positions=entry.geometry.getAttribute('position');
    signatures.add([...positions.array].map(value=>Math.round(value*1000)).join(','));
    entry.geometry.computeBoundingBox();
    assert.ok(entry.geometry.boundingBox.max.z-entry.geometry.boundingBox.min.z>.5,'each entry has actual volume');
    assert.ok(entry.material.includes(marker.entryFace),'the information is a material of the body itself');
    assert.equal(entry.material.length,entry.geometry.groups.length);
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
  assert.equal(signatures.size,6,'home visibly includes cube, sphere, diamond, cylinder, triangular prism and torus');
  const torus=scene.groupParents.get('agents').entry;
  const origin=torus.localToWorld(new THREE.Vector3(0,0,8));
  const direction=new THREE.Vector3(0,0,-1).applyQuaternion(torus.getWorldQuaternion(new THREE.Quaternion()));
  assert.equal(new THREE.Raycaster(origin,direction).intersectObject(torus,false).length,0,'the home torus hole remains empty and cannot open the space');
  scene.destroy();
});
